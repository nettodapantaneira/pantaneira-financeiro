const SESSION_COOKIE = "pf_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const APP_TIMEZONE = "America/Cuiaba";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, app: env.APP_NAME || "Pantaneira Financeiro", version: env.APP_VERSION || "1.0.0" });
      }

      if (url.pathname === "/api/auth/status" && request.method === "GET") {
        const configured = Boolean(env.APP_PASSWORD && env.SESSION_SECRET);
        const authenticated = configured ? await isAuthenticated(request, env) : false;
        return json({ configured, authenticated });
      }

      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        if (!env.APP_PASSWORD || !env.SESSION_SECRET) {
          return json({ error: "Segredos de autenticação ainda não configurados." }, 503);
        }
        const body = await readJson(request);
        if (!body.password || !safeEqual(String(body.password), String(env.APP_PASSWORD))) {
          return json({ error: "Senha inválida." }, 401);
        }
        const token = await createSession(env);
        return json({ ok: true }, 200, {
          "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`
        });
      }

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        return json({ ok: true }, 200, {
          "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
        });
      }

      if (!(await isAuthenticated(request, env))) {
        return json({ error: "Não autorizado." }, 401);
      }

      if (url.pathname === "/api/dashboard" && request.method === "GET") {
        return json(await buildDashboard(env.DB));
      }

      if (url.pathname === "/api/accounts" && request.method === "GET") {
        return json({ accounts: await listAccountsWithBalances(env.DB) });
      }

      const accountBalanceMatch = url.pathname.match(/^\/api\/accounts\/(\d+)\/opening-balance$/);
      if (accountBalanceMatch && request.method === "POST") {
        const accountId = Number(accountBalanceMatch[1]);
        const body = await readJson(request);
        const opening = toInteger(body.opening_balance_cents, "opening_balance_cents");
        const result = await env.DB.prepare(
          "UPDATE accounts SET opening_balance_cents=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
        ).bind(opening, accountId).run();
        if (!result.meta.changes) return json({ error: "Conta não encontrada." }, 404);
        return json({ ok: true });
      }

      if (url.pathname === "/api/categories" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT id,name,nature,parent_id FROM categories WHERE active=1 ORDER BY nature,name"
        ).all();
        return json({ categories: results });
      }

      if (url.pathname === "/api/obligations" && request.method === "GET") {
        return json({ obligations: await listObligations(env.DB) });
      }

      if (url.pathname === "/api/obligations" && request.method === "POST") {
        const body = await readJson(request);
        const name = String(body.name || "").trim();
        if (!name) return json({ error: "Nome obrigatório." }, 400);
        const nature = String(body.nature || "business_operating");
        if (!["business_operating","inventory","business_debt","personal_withdrawal"].includes(nature)) return json({ error: "Natureza inválida." }, 400);
        const scope = nature === "personal_withdrawal" ? "personal" : (body.scope === "personal" ? "personal" : "business");
        const target = toNonNegativeInteger(body.monthly_target_cents, "monthly_target_cents");
        const dueDay = optionalDueDay(body.due_day);
        let categoryId = body.category_id == null ? null : toInteger(body.category_id, "category_id");
        if (!categoryId) {
          const cat = await env.DB.prepare("SELECT id FROM categories WHERE nature=? AND active=1 ORDER BY id LIMIT 1").bind(nature).first();
          categoryId = cat?.id || null;
        }
        const result = await env.DB.prepare(
          `INSERT INTO obligations(name,scope,nature,category_id,monthly_target_cents,due_day,recurring,flexible,priority,counts_in_daily_target,notes)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(name,scope,nature,categoryId,target,dueDay,1,body.flexible?1:0,Number(body.priority||3),body.counts_in_daily_target===false?0:1,nullable(body.notes)).run();
        return json({ ok: true, id: result.meta.last_row_id }, 201);
      }

      const obligationMatch = url.pathname.match(/^\/api\/obligations\/(\d+)$/);
      if (obligationMatch && request.method === "PATCH") {
        const id = Number(obligationMatch[1]);
        const body = await readJson(request);
        const current = await env.DB.prepare("SELECT * FROM obligations WHERE id=?").bind(id).first();
        if (!current) return json({ error: "Compromisso não encontrado." }, 404);
        const updated = {
          name: body.name == null ? current.name : String(body.name).trim(),
          monthly_target_cents: body.monthly_target_cents == null ? current.monthly_target_cents : toNonNegativeInteger(body.monthly_target_cents,"monthly_target_cents"),
          due_day: body.due_day === undefined ? current.due_day : optionalDueDay(body.due_day),
          flexible: body.flexible === undefined ? current.flexible : (body.flexible?1:0),
          priority: body.priority == null ? current.priority : toInteger(body.priority,"priority"),
          counts_in_daily_target: body.counts_in_daily_target === undefined ? current.counts_in_daily_target : (body.counts_in_daily_target?1:0),
          active: body.active === undefined ? current.active : (body.active?1:0),
          notes: body.notes === undefined ? current.notes : nullable(body.notes)
        };
        await env.DB.prepare(
          `UPDATE obligations SET name=?,monthly_target_cents=?,due_day=?,flexible=?,priority=?,counts_in_daily_target=?,active=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`
        ).bind(updated.name,updated.monthly_target_cents,updated.due_day,updated.flexible,updated.priority,updated.counts_in_daily_target,updated.active,updated.notes,id).run();
        return json({ ok:true });
      }

      if (url.pathname === "/api/reserves" && request.method === "POST") {
        const body = await readJson(request);
        const obligationId = toInteger(body.obligation_id, "obligation_id");
        const amount = toPositiveInteger(body.amount_cents, "amount_cents");
        let periodKey = body.period_key || null;
        if (!periodKey) {
          const obligation = await env.DB.prepare("SELECT due_day FROM obligations WHERE id=? AND active=1").bind(obligationId).first();
          if (!obligation) return json({ error: "Compromisso não encontrado." }, 404);
          periodKey = targetPeriodKeyForObligation(new Date(), obligation.due_day);
        }
        await env.DB.prepare(
          "INSERT INTO reserves(obligation_id,period_key,amount_cents,notes) VALUES(?,?,?,?)"
        ).bind(obligationId, periodKey, amount, nullable(body.notes)).run();
        return json({ ok: true });
      }

      if (url.pathname === "/api/debts" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT id,name,creditor,scope,original_balance_cents,current_balance_cents,monthly_target_cents,installment_cents,due_day,flexible,priority,status,notes
           FROM debts ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, priority, name`
        ).all();
        return json({ debts: results });
      }

      if (url.pathname === "/api/debts" && request.method === "POST") {
        const body = await readJson(request);
        const name = String(body.name || "").trim();
        if (!name) return json({ error:"Nome da dívida obrigatório." },400);
        const scope = body.scope === "personal" ? "personal" : "business";
        const balance = body.current_balance_cents == null || body.current_balance_cents === "" ? null : toPositiveInteger(body.current_balance_cents,"current_balance_cents");
        const monthly = body.monthly_target_cents == null || body.monthly_target_cents === "" ? null : toPositiveInteger(body.monthly_target_cents,"monthly_target_cents");
        const installment = body.installment_cents == null || body.installment_cents === "" ? null : toPositiveInteger(body.installment_cents,"installment_cents");
        const dueDay = optionalDueDay(body.due_day);
        const result = await env.DB.prepare(
          `INSERT INTO debts(name,creditor,scope,original_balance_cents,current_balance_cents,monthly_target_cents,installment_cents,due_day,flexible,priority,status,notes)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(name,nullable(body.creditor),scope,balance,balance,monthly,installment,dueDay,body.flexible?1:0,Number(body.priority||2),"active",nullable(body.notes)).run();
        const debtId = result.meta.last_row_id;
        const target = monthly || installment;
        if (target) {
          const nature = scope === "personal" ? "personal_withdrawal" : "business_debt";
          const categoryName = scope === "personal" ? "Acordos pessoais" : "Empréstimos e acordos";
          const cat = await env.DB.prepare("SELECT id FROM categories WHERE name=? AND nature=? LIMIT 1").bind(categoryName,nature).first();
          await env.DB.prepare(
            `INSERT INTO obligations(name,scope,nature,category_id,debt_id,monthly_target_cents,due_day,recurring,flexible,priority,counts_in_daily_target,notes)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
          ).bind(`Pagamento ${name}`,scope,nature,cat?.id||null,debtId,target,dueDay,1,body.flexible?1:0,Number(body.priority||2),1,"Criado automaticamente com a dívida.").run();
        }
        return json({ok:true,id:debtId},201);
      }

      const debtMatch = url.pathname.match(/^\/api\/debts\/(\d+)$/);
      if (debtMatch && request.method === "PATCH") {
        const id=Number(debtMatch[1]);
        const body=await readJson(request);
        const current=await env.DB.prepare("SELECT * FROM debts WHERE id=?").bind(id).first();
        if(!current)return json({error:"Dívida não encontrada."},404);
        const currentBalance=body.current_balance_cents===undefined?current.current_balance_cents:(body.current_balance_cents==null||body.current_balance_cents===""?null:toPositiveInteger(body.current_balance_cents,"current_balance_cents"));
        const monthly=body.monthly_target_cents===undefined?current.monthly_target_cents:(body.monthly_target_cents==null||body.monthly_target_cents===""?null:toPositiveInteger(body.monthly_target_cents,"monthly_target_cents"));
        const due=body.due_day===undefined?current.due_day:optionalDueDay(body.due_day);
        await env.DB.prepare(`UPDATE debts SET current_balance_cents=?,monthly_target_cents=?,due_day=?,flexible=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(currentBalance,monthly,due,body.flexible===undefined?current.flexible:(body.flexible?1:0),body.notes===undefined?current.notes:nullable(body.notes),id).run();
        if(monthly!=null){
          await env.DB.prepare("UPDATE obligations SET monthly_target_cents=?,due_day=?,flexible=?,updated_at=CURRENT_TIMESTAMP WHERE debt_id=? AND active=1")
            .bind(monthly,due,body.flexible===undefined?current.flexible:(body.flexible?1:0),id).run();
        }
        return json({ok:true});
      }

      if (url.pathname === "/api/transactions" && request.method === "GET") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 200);
        return json({ transactions: await listTransactions(env.DB, limit) });
      }

      if (url.pathname === "/api/transactions" && request.method === "POST") {
        const body = await readJson(request);
        const transaction = validateTransaction(body);
        const result = await env.DB.prepare(
          `INSERT INTO transactions(
            occurred_at,period_key,direction,amount_cents,source_account_id,destination_account_id,nature,category_id,obligation_id,debt_id,description,notes,payment_method,recurrence_type,status
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          transaction.occurred_at,
          transaction.period_key,
          transaction.direction,
          transaction.amount_cents,
          transaction.source_account_id,
          transaction.destination_account_id,
          transaction.nature,
          transaction.category_id,
          transaction.obligation_id,
          transaction.debt_id,
          transaction.description,
          transaction.notes,
          transaction.payment_method,
          transaction.recurrence_type,
          "posted"
        ).run();

        if (transaction.debt_id && transaction.direction === "expense") {
          await env.DB.prepare(
            `UPDATE debts
             SET current_balance_cents = CASE
               WHEN current_balance_cents IS NULL THEN NULL
               ELSE MAX(0, current_balance_cents - ?)
             END,
             status = CASE
               WHEN current_balance_cents IS NOT NULL AND current_balance_cents - ? <= 0 THEN 'paid'
               ELSE status
             END,
             updated_at=CURRENT_TIMESTAMP
             WHERE id=?`
          ).bind(transaction.amount_cents, transaction.amount_cents, transaction.debt_id).run();
        }

        return json({ ok: true, id: result.meta.last_row_id }, 201);
      }

      const transactionMatch = url.pathname.match(/^\/api\/transactions\/(\d+)$/);
      if (transactionMatch && request.method === "PATCH") {
        const id=Number(transactionMatch[1]);
        const body=await readJson(request);
        const current=await env.DB.prepare("SELECT * FROM transactions WHERE id=?").bind(id).first();
        if(!current)return json({error:"Lançamento não encontrado."},404);
        const nature=body.nature===undefined?current.nature:String(body.nature);
        const allowed=["business_operating","inventory","business_debt","personal_withdrawal","income","transfer","unidentified"];
        if(!allowed.includes(nature))return json({error:"Natureza inválida."},400);
        let categoryId=body.category_id===undefined?current.category_id:(body.category_id==null?null:toInteger(body.category_id,"category_id"));
        if(!categoryId && nature!=="unidentified"){
          const cat=await env.DB.prepare("SELECT id FROM categories WHERE nature=? AND active=1 ORDER BY id LIMIT 1").bind(nature).first();
          categoryId=cat?.id||null;
        }
        await env.DB.prepare(`UPDATE transactions SET nature=?,category_id=?,description=?,notes=?,status=? WHERE id=?`)
          .bind(nature,categoryId,body.description===undefined?current.description:String(body.description).trim(),body.notes===undefined?current.notes:nullable(body.notes),body.status||"posted",id).run();
        return json({ok:true});
      }

      if (url.pathname === "/api/cash/reconcile" && request.method === "POST") {
        const body = await readJson(request);
        const accountId = toInteger(body.account_id, "account_id");
        const actual = toInteger(body.actual_balance_cents, "actual_balance_cents");
        const account = await accountBalance(env.DB, accountId);
        if (!account) return json({ error: "Conta não encontrada." }, 404);
        if (account.account_type !== "cash") return json({ error: "A conferência só pode ser feita em conta do tipo dinheiro." }, 400);

        const difference = actual - account.balance_cents;
        let transactionId = null;

        if (difference !== 0) {
          const unidentified = await env.DB.prepare("SELECT id FROM categories WHERE nature='unidentified' LIMIT 1").first();
          const occurredAt = new Date().toISOString();
          const amount = Math.abs(difference);
          const direction = difference < 0 ? "expense" : "income";
          const insert = await env.DB.prepare(
            `INSERT INTO transactions(occurred_at,period_key,direction,amount_cents,source_account_id,destination_account_id,nature,category_id,description,notes,payment_method,recurrence_type,status)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
          ).bind(
            occurredAt,
            periodKeyFromIso(occurredAt),
            direction,
            amount,
            direction === "expense" ? accountId : null,
            direction === "income" ? accountId : null,
            "unidentified",
            unidentified?.id || null,
            difference < 0 ? "Saída de dinheiro não identificada" : "Entrada de dinheiro não identificada",
            "Gerado automaticamente pela conferência de dinheiro. Reclassificar quando identificar.",
            "cash",
            "eventual",
            "pending_reclassification"
          ).run();
          transactionId = insert.meta.last_row_id;
        }

        await env.DB.prepare(
          `INSERT INTO cash_reconciliations(account_id,expected_cents,actual_cents,difference_cents,transaction_id,notes)
           VALUES(?,?,?,?,?,?)`
        ).bind(accountId, account.balance_cents, actual, difference, transactionId, nullable(body.notes)).run();

        return json({ ok: true, expected_cents: account.balance_cents, actual_cents: actual, difference_cents: difference, transaction_id: transactionId });
      }

      return json({ error: "Rota não encontrada." }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || "Erro interno." }, 500);
    }
  }
};

async function buildDashboard(db) {
  const now = new Date();
  const periodKey = periodKeyLocal(now);
  const accounts = await listAccountsWithBalances(db);
  const obligations = await listObligations(db, now);

  let totalBalance = 0;
  let businessBalance = 0;
  let businessTotalBalance = 0;
  let pendingBusinessBalance = 0;
  let cashBalance = 0;
  for (const account of accounts) {
    totalBalance += account.balance_cents;
    if (account.owner_scope === "business") {
      businessTotalBalance += account.balance_cents;
      if (Number(account.available_for_spending ?? 1) === 1) businessBalance += account.balance_cents;
      else pendingBusinessBalance += account.balance_cents;
    }
    if (account.account_type === "cash" && account.owner_scope === "business") cashBalance += account.balance_cents;
  }

  const activeTarget = obligations.filter(o => o.active && o.counts_in_daily_target);
  const committed = activeTarget.reduce((sum, o) => sum + Math.max(0, Number(o.remaining_cents || 0)), 0);
  const daily = calculateDailyProtection(activeTarget, now);

  const { start, end } = localDayUtcRange(now);
  const today = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN direction='income' AND status!='void' THEN amount_cents ELSE 0 END),0) AS income_cents,
       COALESCE(SUM(CASE WHEN direction='expense' AND status!='void' THEN amount_cents ELSE 0 END),0) AS expense_cents,
       COALESCE(SUM(CASE WHEN direction='expense' AND nature='personal_withdrawal' AND status!='void' THEN amount_cents ELSE 0 END),0) AS personal_cents
     FROM transactions WHERE occurred_at >= ? AND occurred_at < ?`
  ).bind(start, end).first();

  const { monthStart, nextMonth } = localMonthUtcRange(now);
  const month = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN direction='expense' AND nature='personal_withdrawal' AND status!='void' THEN amount_cents ELSE 0 END),0) AS personal_cents,
       COALESCE(SUM(CASE WHEN direction='expense' AND nature='business_debt' AND status!='void' THEN amount_cents ELSE 0 END),0) AS debt_paid_cents,
       COALESCE(SUM(CASE WHEN direction='expense' AND nature='inventory' AND status!='void' THEN amount_cents ELSE 0 END),0) AS inventory_cents
     FROM transactions WHERE occurred_at >= ? AND occurred_at < ?`
  ).bind(monthStart, nextMonth).first();

  const flexibleCommitted = activeTarget.filter(o => o.flexible).reduce((s,o) => s + Math.max(0,Number(o.remaining_cents || 0)),0);
  const strictCommitted = Math.max(0, committed - flexibleCommitted);
  const freeStrict = businessBalance - strictCommitted;

  return {
    as_of: now.toISOString(),
    period_key: periodKey,
    balances: {
      all_cents: totalBalance,
      business_cents: businessBalance,
      business_total_cents: businessTotalBalance,
      pending_business_cents: pendingBusinessBalance,
      cash_cents: cashBalance,
      committed_strict_cents: strictCommitted,
      committed_flexible_cents: flexibleCommitted,
      free_strict_cents: freeStrict
    },
    daily_protection: daily,
    today: {
      income_cents: Number(today?.income_cents || 0),
      expense_cents: Number(today?.expense_cents || 0),
      personal_withdrawal_cents: Number(today?.personal_cents || 0)
    },
    month: {
      personal_withdrawal_cents: Number(month?.personal_cents || 0),
      debt_paid_cents: Number(month?.debt_paid_cents || 0),
      inventory_spent_cents: Number(month?.inventory_cents || 0)
    },
    accounts,
    obligations: obligations.slice(0, 30)
  };
}

async function listAccountsWithBalances(db) {
  const { results } = await db.prepare(
    `SELECT a.id,a.name,a.owner_scope,a.account_type,a.opening_balance_cents,a.available_for_spending,a.active,a.notes,
      a.opening_balance_cents
      + COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.destination_account_id=a.id AND t.status!='void'),0)
      - COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.source_account_id=a.id AND t.status!='void'),0)
      AS balance_cents
     FROM accounts a WHERE a.active=1 ORDER BY a.owner_scope,a.id`
  ).all();
  return results.map(r => ({ ...r, balance_cents: Number(r.balance_cents || 0) }));
}

async function accountBalance(db, accountId) {
  return db.prepare(
    `SELECT a.id,a.name,a.owner_scope,a.account_type,a.opening_balance_cents,a.available_for_spending,
      a.opening_balance_cents
      + COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.destination_account_id=a.id AND t.status!='void'),0)
      - COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.source_account_id=a.id AND t.status!='void'),0)
      AS balance_cents
     FROM accounts a WHERE a.id=? AND a.active=1`
  ).bind(accountId).first();
}

async function listObligations(db, now = new Date()) {
  const currentKey = periodKeyLocal(now);
  const nextKey = nextPeriodKey(currentKey);
  const { results } = await db.prepare(
    `SELECT o.id,o.name,o.scope,o.nature,o.monthly_target_cents,o.due_day,o.recurring,o.flexible,o.priority,o.counts_in_daily_target,o.active,o.notes,
            c.name AS category_name,o.debt_id,
            COALESCE((SELECT SUM(r.amount_cents) FROM reserves r WHERE r.obligation_id=o.id AND r.period_key=?),0) AS reserve_current_cents,
            COALESCE((SELECT SUM(r.amount_cents) FROM reserves r WHERE r.obligation_id=o.id AND r.period_key=?),0) AS reserve_next_cents,
            COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.obligation_id=o.id AND t.period_key=? AND t.direction='expense' AND t.status!='void'),0) AS paid_current_cents,
            COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.obligation_id=o.id AND t.period_key=? AND t.direction='expense' AND t.status!='void'),0) AS paid_next_cents
     FROM obligations o
     LEFT JOIN categories c ON c.id=o.category_id
     WHERE o.active=1
     ORDER BY o.priority, CASE WHEN o.due_day IS NULL THEN 99 ELSE o.due_day END, o.name`
  ).bind(currentKey, nextKey, currentKey, nextKey).all();

  const local = localDateParts(now);
  return results.map(r => {
    const targetPeriodKey = r.due_day && local.day > Number(r.due_day) ? nextKey : currentKey;
    const reservedTotal = Number(targetPeriodKey === nextKey ? r.reserve_next_cents : r.reserve_current_cents) || 0;
    const paid = Number(targetPeriodKey === nextKey ? r.paid_next_cents : r.paid_current_cents) || 0;
    const availableReserved = Math.max(0, reservedTotal - paid);
    const target = Number(r.monthly_target_cents || 0);
    const covered = Math.max(reservedTotal, paid);
    const remaining = Math.max(0, target - covered);
    return {
      ...r,
      target_period_key: targetPeriodKey,
      reserved_cents: availableReserved,
      reserved_total_cents: reservedTotal,
      paid_cents: paid,
      remaining_cents: remaining
    };
  });
}

async function listTransactions(db, limit) {
  const { results } = await db.prepare(
    `SELECT t.id,t.occurred_at,t.direction,t.amount_cents,t.nature,t.description,t.notes,t.payment_method,t.recurrence_type,t.status,
            sa.name AS source_account, da.name AS destination_account, c.name AS category_name
     FROM transactions t
     LEFT JOIN accounts sa ON sa.id=t.source_account_id
     LEFT JOIN accounts da ON da.id=t.destination_account_id
     LEFT JOIN categories c ON c.id=t.category_id
     ORDER BY t.occurred_at DESC,t.id DESC LIMIT ?`
  ).bind(limit).all();
  return results;
}

function calculateDailyProtection(obligations, now) {
  const groups = { business_cents: 0, debt_cents: 0, personal_cents: 0, inventory_cents: 0, flexible_cents: 0, total_cents: 0 };
  const items = [];

  for (const o of obligations) {
    const remaining = Math.max(0, Number(o.remaining_cents || 0));
    if (remaining <= 0) continue;

    let days;
    if (o.due_day) {
      const due = nextDueDate(now, Number(o.due_day));
      days = Math.max(1, countWorkingDaysInclusive(now, due));
    } else {
      days = 25;
    }

    const daily = Math.ceil(remaining / days);
    items.push({ id: o.id, name: o.name, remaining_cents: remaining, daily_cents: daily, days_remaining: days, nature: o.nature, flexible: Boolean(o.flexible), priority: o.priority });

    if (o.flexible) groups.flexible_cents += daily;
    if (o.nature === "business_operating") groups.business_cents += daily;
    else if (o.nature === "business_debt") groups.debt_cents += daily;
    else if (o.nature === "personal_withdrawal") groups.personal_cents += daily;
    else if (o.nature === "inventory") groups.inventory_cents += daily;
    groups.total_cents += daily;
  }

  return { ...groups, items };
}

function nextDueDate(now, dueDay) {
  const p = localDateParts(now);
  const make = (y, month1) => {
    const last = new Date(Date.UTC(y, month1, 0)).getUTCDate();
    return new Date(Date.UTC(y, month1 - 1, Math.min(dueDay, last)));
  };
  const current = make(p.year, p.month);
  const today = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (current >= today) return current;
  const n = new Date(Date.UTC(p.year, p.month, 1));
  return make(n.getUTCFullYear(), n.getUTCMonth() + 1);
}

function countWorkingDaysInclusive(startInstant, duePseudoDate) {
  const p = localDateParts(startInstant);
  const s = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const e = new Date(duePseudoDate);
  let count = 0;
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0) count += 1; // segunda a sábado
  }
  return count;
}

function validateTransaction(body) {
  const direction = String(body.direction || "");
  if (!["income","expense","transfer"].includes(direction)) throw new Error("direction inválido.");
  const nature = String(body.nature || "");
  const allowedNature = ["business_operating","inventory","business_debt","personal_withdrawal","income","transfer","unidentified"];
  if (!allowedNature.includes(nature)) throw new Error("nature inválido.");
  const amount = toPositiveInteger(body.amount_cents, "amount_cents");
  const description = String(body.description || "").trim();
  if (!description) throw new Error("Descrição obrigatória.");

  const source = body.source_account_id == null ? null : toInteger(body.source_account_id, "source_account_id");
  const destination = body.destination_account_id == null ? null : toInteger(body.destination_account_id, "destination_account_id");
  if (direction === "expense" && !source) throw new Error("Informe de onde saiu o dinheiro.");
  if (direction === "income" && !destination) throw new Error("Informe onde o dinheiro entrou.");
  if (direction === "transfer" && (!source || !destination || source === destination)) throw new Error("Transferência exige contas de origem e destino diferentes.");

  const occurredAt = body.occurred_at ? new Date(body.occurred_at).toISOString() : new Date().toISOString();
  return {
    occurred_at: occurredAt,
    period_key: periodKeyFromIso(occurredAt),
    direction,
    amount_cents: amount,
    source_account_id: source,
    destination_account_id: destination,
    nature,
    category_id: body.category_id == null ? null : toInteger(body.category_id, "category_id"),
    obligation_id: body.obligation_id == null ? null : toInteger(body.obligation_id, "obligation_id"),
    debt_id: body.debt_id == null ? null : toInteger(body.debt_id, "debt_id"),
    description,
    notes: nullable(body.notes),
    payment_method: nullable(body.payment_method),
    recurrence_type: body.recurrence_type === "recurring" ? "recurring" : "eventual"
  };
}

async function isAuthenticated(request, env) {
  if (!env.APP_PASSWORD || !env.SESSION_SECRET) return false;
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) return false;
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) return false;
  const expected = await sign(payloadPart, env.SESSION_SECRET);
  if (!safeEqual(signaturePart, expected)) return false;
  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart));
    return Number(payload.exp || 0) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function createSession(env) {
  const payload = { exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, app: "pantaneira-financeiro" };
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signaturePart = await sign(payloadPart, env.SESSION_SECRET);
  return `${payloadPart}.${signaturePart}`;
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function parseCookies(header) {
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function base64UrlEncode(value) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return atob(normalized);
}
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function localDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const map = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}
function periodKeyLocal(date) {
  const p = localDateParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}
function nextPeriodKey(periodKey) {
  const [year, month] = periodKey.split("-").map(Number);
  const d = new Date(Date.UTC(year, month, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function targetPeriodKeyForObligation(date, dueDay) {
  const current = periodKeyLocal(date);
  if (!dueDay) return current;
  return localDateParts(date).day > Number(dueDay) ? nextPeriodKey(current) : current;
}
function periodKeyFromIso(iso) { return periodKeyLocal(new Date(iso)); }
function localDayUtcRange(date) {
  const p = localDateParts(date);
  const start = new Date(Date.UTC(p.year, p.month - 1, p.day, 4, 0, 0, 0));
  const end = new Date(Date.UTC(p.year, p.month - 1, p.day + 1, 4, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}
function localMonthUtcRange(date) {
  const p = localDateParts(date);
  const monthStart = new Date(Date.UTC(p.year, p.month - 1, 1, 4, 0, 0, 0));
  const nextMonth = new Date(Date.UTC(p.year, p.month, 1, 4, 0, 0, 0));
  return { monthStart: monthStart.toISOString(), nextMonth: nextMonth.toISOString() };
}
function optionalDueDay(value) {
  if (value == null || value === "") return null;
  const n = toInteger(value, "due_day");
  if (n < 1 || n > 31) throw new Error("due_day deve estar entre 1 e 31.");
  return n;
}
function nullable(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}
function toInteger(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${field} deve ser inteiro.`);
  return n;
}
function toPositiveInteger(value, field) {
  const n = toInteger(value, field);
  if (n <= 0) throw new Error(`${field} deve ser maior que zero.`);
  return n;
}
function toNonNegativeInteger(value, field) {
  const n = toInteger(value, field);
  if (n < 0) throw new Error(`${field} não pode ser negativo.`);
  return n;
}
async function readJson(request) {
  try { return await request.json(); } catch { throw new Error("JSON inválido."); }
}
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders }
  });
}
