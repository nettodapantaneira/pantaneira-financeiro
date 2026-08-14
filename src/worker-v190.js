import worker183 from './worker-v183.js';

const TZ = 'America/Cuiaba';
const SALES_CATEGORIES = new Set(['vendas da loja','receita de vendas']);
const FEE_CATEGORIES = new Set(['taxas bancarias e maquininhas','tarifas e juros']);
const BILL_PAYMENT_CATEGORY = 'pagamento de fatura de cartao';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/pro-reports' && request.method === 'GET') {
        const auth = await requireAppSession(request, env, ctx);
        if (auth) return auth;
        return json(await buildProfessionalReport(env.DB, url));
      }

      const res = await worker183.fetch(request, env, ctx);

      if (url.pathname === '/api/health' && res.ok) {
        const data = await res.clone().json().catch(() => ({}));
        return json({ ...data, version: '1.9.0' }, res.status);
      }

      const type = res.headers.get('content-type') || '';
      if (res.ok && type.includes('text/html')) {
        let html = await res.text();
        if (!html.includes('/v190.js')) {
          html = html.replace('</body>', '<script src="/v190.js?v=1.9.0"></script></body>');
        }
        const headers = new Headers(res.headers);
        headers.delete('content-length');
        headers.set('cache-control', 'no-cache');
        return new Response(html, { status: res.status, headers });
      }

      return res;
    } catch (error) {
      console.error('v1.9.0 reports error', error);
      if (url.pathname.startsWith('/api/')) {
        return json({ error: String(error?.message || error) }, 400);
      }
      return worker183.fetch(request, env, ctx);
    }
  }
};

async function requireAppSession(request, env, ctx) {
  const probeUrl = new URL('/api/accounts', request.url);
  const probe = new Request(probeUrl, { method: 'GET', headers: request.headers });
  const res = await worker183.fetch(probe, env, ctx);
  if (res.status === 401) return json({ error: 'Sessão expirada.' }, 401);
  if (!res.ok) return json({ error: 'Não foi possível validar a sessão.' }, res.status);
  return null;
}

async function buildProfessionalReport(db, url) {
  const today = localDate();
  const first = today.slice(0, 8) + '01';

  const dateFrom = validDate(url.searchParams.get('date_from')) || first;
  const dateTo = validDate(url.searchParams.get('date_to')) || today;
  if (dateFrom > dateTo) throw new Error('A data inicial não pode ser maior que a data final.');

  const days = daysBetweenInclusive(dateFrom, dateTo);
  if (days > 1096) throw new Error('Selecione um período de até 3 anos.');

  const accountId = positiveNullable(url.searchParams.get('account_id'));
  const scope = ['business','personal'].includes(url.searchParams.get('scope')) ? url.searchParams.get('scope') : '';
  const categoryId = positiveNullable(url.searchParams.get('category_id'));
  const movementType = ['income','expense','transfer','card_purchase'].includes(url.searchParams.get('movement_type')) ? url.searchParams.get('movement_type') : '';
  const q = norm(url.searchParams.get('q') || '');

  const previousTo = addDays(dateFrom, -1);
  const previousFrom = addDays(previousTo, -(days - 1));

  const [
    transactions,
    previousTransactions,
    cardItems,
    previousCardItems,
    bills,
    categories,
    accounts,
    obligations,
    debts
  ] = await Promise.all([
    loadTransactions(db, dateFrom, dateTo),
    loadTransactions(db, previousFrom, previousTo),
    loadCardItems(db, dateFrom, dateTo),
    loadCardItems(db, previousFrom, previousTo),
    loadBills(db),
    loadCategories(db),
    loadAccounts(db),
    loadObligations(db, dateFrom, dateTo),
    loadDebts(db, dateFrom, dateTo)
  ]);

  const filters = { account_id: accountId, scope, category_id: categoryId, movement_type: movementType, q };
  const filteredTransactions = filterTransactions(transactions, filters);
  const filteredPrevTransactions = filterTransactions(previousTransactions, filters);
  const filteredCardItems = filterCardItems(cardItems, filters);
  const filteredPrevCardItems = filterCardItems(previousCardItems, filters);

  const selectedBills = filterBills(bills, dateFrom, dateTo, filters);
  const previousBills = filterBills(bills, previousFrom, previousTo, filters);

  const summary = summarize(filteredTransactions, filteredCardItems, accountId);
  const previous = summarize(filteredPrevTransactions, filteredPrevCardItems, accountId);

  const daily = buildDailySeries(filteredTransactions, dateFrom, dateTo, accountId);
  const categoryRows = buildCategorySummary(filteredTransactions, filteredCardItems);
  const accountRows = buildAccountSummary(filteredTransactions, accounts);
  const movementRows = buildMovementRows(filteredTransactions, filteredCardItems);
  const quality = buildQuality(transactions, selectedBills, cardItems, dateFrom, dateTo);

  return {
    version: '1.9.0',
    generated_at: new Date().toISOString(),
    meta: {
      date_from: dateFrom,
      date_to: dateTo,
      days,
      previous_from: previousFrom,
      previous_to: previousTo,
      timezone: TZ
    },
    filters,
    summary,
    previous,
    daily,
    categories: categoryRows,
    accounts: accountRows,
    movements: movementRows.slice(0, 1500),
    movements_total: movementRows.length,
    bills: selectedBills,
    previous_bills: previousBills,
    obligations,
    debts,
    quality,
    catalogs: {
      accounts: accounts.map(a => ({
        id: Number(a.id), name: a.name, owner_scope: a.owner_scope,
        account_type: a.account_type, balance_cents: Number(a.balance_cents || 0)
      })),
      categories: categories.map(c => ({
        id: Number(c.id), name: c.name, parent_name: c.parent_name || null,
        nature: c.nature, active: Number(c.active || 0)
      }))
    }
  };
}

async function loadTransactions(db, from, to) {
  const r = await db.prepare(`
    SELECT
      t.id,t.occurred_at,t.period_key,t.direction,t.amount_cents,t.nature,
      t.description,t.notes,t.payment_method,t.status,t.opening_history,
      t.category_id,t.obligation_id,t.debt_id,t.source_account_id,t.destination_account_id,
      c.name category_name,pc.name parent_category_name,
      sa.name source_account,sa.owner_scope source_owner_scope,
      da.name destination_account,da.owner_scope destination_owner_scope,
      o.name obligation_name,d.name debt_name
    FROM transactions t
    LEFT JOIN categories c ON c.id=t.category_id
    LEFT JOIN categories pc ON pc.id=c.parent_id
    LEFT JOIN accounts sa ON sa.id=t.source_account_id
    LEFT JOIN accounts da ON da.id=t.destination_account_id
    LEFT JOIN obligations o ON o.id=t.obligation_id
    LEFT JOIN debts d ON d.id=t.debt_id
    WHERE t.status!='void'
      AND substr(t.occurred_at,1,10) BETWEEN ? AND ?
    ORDER BY t.occurred_at,t.id
    LIMIT 12000
  `).bind(from,to).all();
  return (r.results || []).map(normalizeNumbers);
}

async function loadCardItems(db, from, to) {
  const r = await db.prepare(`
    SELECT
      i.id,i.bill_id,i.purchase_date,i.description,i.amount_cents,i.scope,i.nature,
      i.category_id,i.installment_number,i.installment_total,i.notes,i.status,
      c.name category_name,pc.name parent_category_name,
      b.period_key bill_period,b.due_date,b.status bill_status,b.total_cents bill_total_cents,
      cc.id card_id,cc.name card_name,cc.issuer,cc.preferred_account_id
    FROM credit_card_items i
    JOIN credit_card_bills b ON b.id=i.bill_id
    JOIN credit_cards cc ON cc.id=b.card_id
    LEFT JOIN categories c ON c.id=i.category_id
    LEFT JOIN categories pc ON pc.id=c.parent_id
    WHERE i.status='posted'
      AND i.purchase_date BETWEEN ? AND ?
    ORDER BY i.purchase_date,i.id
    LIMIT 12000
  `).bind(from,to).all();
  return (r.results || []).map(normalizeNumbers);
}

async function loadBills(db) {
  const r = await db.prepare(`
    SELECT
      b.id,b.card_id,b.period_key,b.total_cents,b.due_date,b.closing_date,b.status,b.notes,
      c.name card_name,c.issuer,c.limit_cents,c.preferred_account_id,
      COALESCE((SELECT SUM(p.amount_cents) FROM credit_card_payments p WHERE p.bill_id=b.id AND p.status='posted'),0) paid_cents,
      COALESCE((SELECT SUM(i.amount_cents) FROM credit_card_items i WHERE i.bill_id=b.id AND i.status='posted' AND i.scope='business'),0) business_cents,
      COALESCE((SELECT SUM(i.amount_cents) FROM credit_card_items i WHERE i.bill_id=b.id AND i.status='posted' AND i.scope='personal'),0) personal_cents,
      COALESCE((SELECT SUM(i.amount_cents) FROM credit_card_items i WHERE i.bill_id=b.id AND i.status='posted'),0) detailed_cents
    FROM credit_card_bills b
    JOIN credit_cards c ON c.id=b.card_id
    WHERE b.status!='void'
    ORDER BY b.due_date,b.id
  `).all();
  return (r.results || []).map(x => {
    x = normalizeNumbers(x);
    const total = Number(x.total_cents || 0);
    const paid = Number(x.paid_cents || 0);
    const detailed = Number(x.detailed_cents || 0);
    return {
      ...x,
      remaining_cents: Math.max(0,total-paid),
      undetailed_cents: Math.max(0,total-detailed)
    };
  });
}

async function loadCategories(db) {
  const r = await db.prepare(`
    SELECT c.id,c.name,c.nature,c.parent_id,c.active,p.name parent_name
    FROM categories c
    LEFT JOIN categories p ON p.id=c.parent_id
    ORDER BY c.nature,COALESCE(p.name,c.name),c.name
  `).all();
  return (r.results || []).map(normalizeNumbers);
}

async function loadAccounts(db) {
  const r = await db.prepare(`
    SELECT
      a.id,a.name,a.owner_scope,a.account_type,a.active,
      a.opening_balance_cents
      +COALESCE((SELECT SUM(t.amount_cents) FROM transactions t
        WHERE t.destination_account_id=a.id AND t.status!='void' AND COALESCE(t.opening_history,0)=0),0)
      -COALESCE((SELECT SUM(t.amount_cents) FROM transactions t
        WHERE t.source_account_id=a.id AND t.status!='void' AND COALESCE(t.opening_history,0)=0),0)
      +COALESCE((SELECT SUM(x.difference_cents) FROM account_balance_adjustments x WHERE x.account_id=a.id),0) balance_cents
    FROM accounts a
    WHERE a.active=1
    ORDER BY CASE a.owner_scope WHEN 'business' THEN 0 ELSE 1 END,a.id
  `).all();
  return (r.results || []).map(normalizeNumbers);
}

async function loadObligations(db, from, to) {
  const r = await db.prepare(`
    SELECT
      o.id,o.name,o.scope,o.nature,o.monthly_target_cents,o.due_day,o.due_date,
      o.recurring,o.flexible,o.priority,o.active,o.notes,c.name category_name,
      COALESCE((SELECT SUM(t.amount_cents) FROM transactions t
        WHERE t.obligation_id=o.id AND t.status!='void' AND t.direction='expense'
          AND substr(t.occurred_at,1,10) BETWEEN ? AND ?),0) paid_in_period_cents
    FROM obligations o
    LEFT JOIN categories c ON c.id=o.category_id
    WHERE o.active=1
    ORDER BY o.priority,COALESCE(o.due_date,'9999-12-31'),o.due_day,o.name
  `).bind(from,to).all();
  return (r.results || [])
    .map(normalizeNumbers)
    .filter(o => !String(o.notes || '').includes('[CARD_BILL'));
}

async function loadDebts(db, from, to) {
  const r = await db.prepare(`
    SELECT
      d.id,d.name,d.scope,d.original_balance_cents,d.current_balance_cents,
      d.monthly_target_cents,d.installment_cents,d.due_day,d.flexible,d.priority,d.status,d.notes,
      COALESCE((SELECT SUM(t.amount_cents) FROM transactions t
        WHERE t.debt_id=d.id AND t.status!='void' AND t.direction='expense'
          AND substr(t.occurred_at,1,10) BETWEEN ? AND ?),0) paid_in_period_cents
    FROM debts d
    WHERE d.status IN ('active','unknown')
    ORDER BY d.priority,d.name
  `).bind(from,to).all();
  return (r.results || []).map(normalizeNumbers);
}

function filterTransactions(rows, f) {
  return rows.filter(t => {
    if (f.account_id && Number(t.source_account_id) !== f.account_id && Number(t.destination_account_id) !== f.account_id) return false;
    if (f.category_id && Number(t.category_id) !== f.category_id) return false;
    if (f.movement_type && t.direction !== f.movement_type) return false;

    const tscope = transactionScope(t);
    if (f.scope && tscope !== f.scope) return false;

    if (f.q) {
      const hay = norm([
        t.description,t.notes,t.category_name,t.parent_category_name,
        t.source_account,t.destination_account,t.obligation_name,t.debt_name
      ].filter(Boolean).join(' '));
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });
}

function filterCardItems(rows, f) {
  return rows.filter(i => {
    if (f.account_id) return false;
    if (f.category_id && Number(i.category_id) !== f.category_id) return false;
    if (f.movement_type && f.movement_type !== 'card_purchase') return false;
    if (f.scope && i.scope !== f.scope) return false;
    if (f.q) {
      const hay = norm([i.description,i.notes,i.category_name,i.parent_category_name,i.card_name,i.issuer].filter(Boolean).join(' '));
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });
}

function filterBills(rows, from, to, f) {
  const fromPeriod = from.slice(0,7), toPeriod = to.slice(0,7);
  return rows.filter(b => {
    const inRange = (b.due_date >= from && b.due_date <= to) || (b.period_key >= fromPeriod && b.period_key <= toPeriod);
    if (!inRange) return false;
    if (f.account_id && Number(b.preferred_account_id) !== f.account_id) return false;
    if (f.scope === 'personal' && Number(b.personal_cents || 0) <= 0) return false;
    if (f.scope === 'business' && Number(b.business_cents || 0) <= 0 && Number(b.undetailed_cents || 0) <= 0) return false;
    if (f.q && !norm(`${b.card_name} ${b.issuer || ''} ${b.period_key} ${b.notes || ''}`).includes(f.q)) return false;
    return true;
  });
}

function summarize(transactions, cardItems, accountId) {
  const s = {
    income_cents:0,sales_cents:0,other_income_cents:0,
    expense_cents:0,business_operating_cents:0,inventory_cents:0,
    debt_cents:0,personal_cents:0,fees_cents:0,bill_payments_cents:0,
    transfer_in_cents:0,transfer_out_cents:0,transfer_total_cents:0,
    net_cash_cents:0,operational_cash_result_cents:0,
    card_business_cents:0,card_personal_cents:0,card_total_cents:0,
    managerial_business_outflow_cents:0,managerial_result_cents:0,
    movement_count:0
  };

  for (const t of transactions) {
    const v = Number(t.amount_cents || 0);
    s.movement_count++;

    if (t.direction === 'income') {
      s.income_cents += v;
      if (SALES_CATEGORIES.has(norm(t.category_name))) s.sales_cents += v;
      else s.other_income_cents += v;
    } else if (t.direction === 'expense') {
      s.expense_cents += v;
      if (t.nature === 'business_operating') s.business_operating_cents += v;
      if (t.nature === 'inventory') s.inventory_cents += v;
      if (t.nature === 'business_debt') s.debt_cents += v;
      if (t.nature === 'personal_withdrawal') s.personal_cents += v;
      if (FEE_CATEGORIES.has(norm(t.category_name))) s.fees_cents += v;
      if (norm(t.category_name) === BILL_PAYMENT_CATEGORY || String(t.notes || '').includes('[CARD_BILL:')) {
        s.bill_payments_cents += v;
      }
    } else if (t.direction === 'transfer') {
      s.transfer_total_cents += v;
      if (accountId) {
        if (Number(t.destination_account_id) === accountId) s.transfer_in_cents += v;
        if (Number(t.source_account_id) === accountId) s.transfer_out_cents += v;
      }
    }
  }

  for (const i of cardItems) {
    const v = Number(i.amount_cents || 0);
    s.card_total_cents += v;
    if (i.scope === 'personal') s.card_personal_cents += v;
    else s.card_business_cents += v;
  }

  s.net_cash_cents = s.income_cents - s.expense_cents + s.transfer_in_cents - s.transfer_out_cents;
  s.operational_cash_result_cents = s.income_cents - s.business_operating_cents - s.inventory_cents;

  const cashBusinessWithoutBillSettlement = Math.max(
    0,
    s.business_operating_cents + s.inventory_cents - Math.min(s.bill_payments_cents, s.business_operating_cents + s.inventory_cents)
  );

  s.managerial_business_outflow_cents = cashBusinessWithoutBillSettlement + s.card_business_cents;
  s.managerial_result_cents = s.income_cents - s.managerial_business_outflow_cents;
  s.managerial_margin_pct = s.income_cents > 0 ? (s.managerial_result_cents / s.income_cents) * 100 : null;

  return s;
}

function buildDailySeries(transactions, from, to, accountId) {
  const map = new Map();
  for (let d=from; d<=to; d=addDays(d,1)) {
    map.set(d,{date:d,income_cents:0,expense_cents:0,transfer_in_cents:0,transfer_out_cents:0,net_cents:0});
    if (d === to) break;
  }

  for (const t of transactions) {
    const d = String(t.occurred_at).slice(0,10);
    if (!map.has(d)) continue;
    const x = map.get(d), v = Number(t.amount_cents || 0);
    if (t.direction === 'income') x.income_cents += v;
    if (t.direction === 'expense') x.expense_cents += v;
    if (t.direction === 'transfer' && accountId) {
      if (Number(t.destination_account_id) === accountId) x.transfer_in_cents += v;
      if (Number(t.source_account_id) === accountId) x.transfer_out_cents += v;
    }
  }

  let cumulative = 0;
  return [...map.values()].map(x => {
    x.net_cents = x.income_cents - x.expense_cents + x.transfer_in_cents - x.transfer_out_cents;
    cumulative += x.net_cents;
    return {...x,cumulative_cents:cumulative};
  });
}

function buildCategorySummary(transactions, cardItems) {
  const map = new Map();

  const ensure = (id,name,parent,nature) => {
    const key = `${id || 0}|${nature || ''}|${name || 'Sem categoria'}`;
    if (!map.has(key)) map.set(key,{
      category_id:id ? Number(id) : null,
      name:name || 'Sem categoria',
      parent_name:parent || null,
      nature:nature || 'unidentified',
      cash_cents:0,card_cents:0,managerial_cents:0,count:0
    });
    return map.get(key);
  };

  for (const t of transactions) {
    if (t.direction !== 'expense') continue;
    const x = ensure(t.category_id,t.category_name,t.parent_category_name,t.nature);
    const v = Number(t.amount_cents || 0);
    x.cash_cents += v;
    x.count++;
    const isBillPayment = norm(t.category_name) === BILL_PAYMENT_CATEGORY || String(t.notes || '').includes('[CARD_BILL:');
    if (!isBillPayment) x.managerial_cents += v;
  }

  for (const i of cardItems) {
    const x = ensure(i.category_id,i.category_name,i.parent_category_name,i.nature);
    const v = Number(i.amount_cents || 0);
    x.card_cents += v;
    x.managerial_cents += v;
    x.count++;
  }

  return [...map.values()]
    .map(x => ({...x,total_cents:x.cash_cents+x.card_cents}))
    .sort((a,b) => b.managerial_cents-a.managerial_cents || b.total_cents-a.total_cents);
}

function buildAccountSummary(transactions, accounts) {
  const map = new Map(accounts.map(a => [Number(a.id),{
    id:Number(a.id),name:a.name,owner_scope:a.owner_scope,account_type:a.account_type,
    current_balance_cents:Number(a.balance_cents || 0),
    income_cents:0,expense_cents:0,transfer_in_cents:0,transfer_out_cents:0,net_cents:0,count:0
  }]));

  for (const t of transactions) {
    const v = Number(t.amount_cents || 0);
    if (t.direction === 'income' && t.destination_account_id && map.has(Number(t.destination_account_id))) {
      const x=map.get(Number(t.destination_account_id));x.income_cents+=v;x.count++;
    } else if (t.direction === 'expense' && t.source_account_id && map.has(Number(t.source_account_id))) {
      const x=map.get(Number(t.source_account_id));x.expense_cents+=v;x.count++;
    } else if (t.direction === 'transfer') {
      if (t.destination_account_id && map.has(Number(t.destination_account_id))) {
        const x=map.get(Number(t.destination_account_id));x.transfer_in_cents+=v;x.count++;
      }
      if (t.source_account_id && map.has(Number(t.source_account_id))) {
        const x=map.get(Number(t.source_account_id));x.transfer_out_cents+=v;x.count++;
      }
    }
  }

  return [...map.values()].map(x => ({
    ...x,
    net_cents:x.income_cents-x.expense_cents+x.transfer_in_cents-x.transfer_out_cents
  }));
}

function buildMovementRows(transactions, cardItems) {
  const rows = [];

  for (const t of transactions) {
    rows.push({
      kind:'cash',
      id:Number(t.id),
      date:String(t.occurred_at).slice(0,10),
      occurred_at:t.occurred_at,
      description:t.description,
      movement_type:t.direction,
      scope:transactionScope(t),
      nature:t.nature,
      category_id:t.category_id ? Number(t.category_id) : null,
      category_name:t.category_name || 'Sem categoria',
      parent_category_name:t.parent_category_name || null,
      account:t.direction==='transfer'
        ? `${t.source_account || 'Origem'} → ${t.destination_account || 'Destino'}`
        : t.direction==='income' ? (t.destination_account || 'Destino não informado') : (t.source_account || 'Origem não informada'),
      payment_method:t.payment_method,
      amount_cents:Number(t.amount_cents || 0),
      opening_history:Number(t.opening_history || 0),
      status:t.status,
      obligation_name:t.obligation_name || null,
      debt_name:t.debt_name || null
    });
  }

  for (const i of cardItems) {
    rows.push({
      kind:'card',
      id:Number(i.id),
      date:i.purchase_date,
      occurred_at:`${i.purchase_date}T23:59:59`,
      description:i.description,
      movement_type:'card_purchase',
      scope:i.scope,
      nature:i.nature,
      category_id:i.category_id ? Number(i.category_id) : null,
      category_name:i.category_name || 'Sem categoria',
      parent_category_name:i.parent_category_name || null,
      account:`${i.card_name} · fatura ${i.bill_period}`,
      payment_method:'credit',
      amount_cents:Number(i.amount_cents || 0),
      opening_history:0,
      status:i.status,
      bill_id:Number(i.bill_id),
      installment_number:i.installment_number ? Number(i.installment_number) : null,
      installment_total:i.installment_total ? Number(i.installment_total) : null
    });
  }

  return rows.sort((a,b) => String(b.occurred_at).localeCompare(String(a.occurred_at)) || b.id-a.id);
}

function buildQuality(allTransactions, selectedBills, allCardItems, from, to) {
  const tx = allTransactions.filter(t => String(t.occurred_at).slice(0,10)>=from && String(t.occurred_at).slice(0,10)<=to);
  const pending = tx.filter(t => t.status === 'pending_reclassification');
  const unidentified = tx.filter(t => !t.category_id || t.nature === 'unidentified' || norm(t.category_name) === 'nao identificado');
  const uncategorizedCard = allCardItems.filter(i => i.purchase_date>=from && i.purchase_date<=to && !i.category_id);
  const undetailed = selectedBills.reduce((s,b) => s+Number(b.undetailed_cents || 0),0);

  return {
    pending_reclassification_count:pending.length,
    unidentified_count:unidentified.length,
    unidentified_cents:unidentified.reduce((s,x)=>s+Number(x.amount_cents || 0),0),
    uncategorized_card_count:uncategorizedCard.length,
    undetailed_card_cents:undetailed,
    historical_reconstruction_count:tx.filter(t=>Number(t.opening_history || 0)===1).length
  };
}

function transactionScope(t) {
  if (t.nature === 'personal_withdrawal') return 'personal';
  if (t.direction === 'transfer') {
    if (t.source_owner_scope === 'personal' && t.destination_owner_scope === 'personal') return 'personal';
    return 'business';
  }
  return 'business';
}

function normalizeNumbers(row) {
  if (!row) return row;
  const out = {...row};
  for (const [k,v] of Object.entries(out)) {
    if (/_cents$/.test(k) || /_id$/.test(k) || ['id','active','opening_history','installment_number','installment_total','priority','due_day','closing_day','limit_cents'].includes(k)) {
      if (v !== null && v !== undefined && v !== '') out[k] = Number(v);
    }
  }
  return out;
}

function positiveNullable(v) {
  if (v === null || v === undefined || v === '') return null;
  const n=Number(v);
  return Number.isInteger(n) && n>0 ? n : null;
}

function validDate(v) {
  const s=String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d=new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

function addDays(dateStr, amount) {
  const d=new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate()+amount);
  return d.toISOString().slice(0,10);
}

function daysBetweenInclusive(a,b) {
  const x=new Date(`${a}T12:00:00Z`),y=new Date(`${b}T12:00:00Z`);
  return Math.floor((y-x)/86400000)+1;
}

function localDate() {
  return new Intl.DateTimeFormat('en-CA',{
    timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date());
}

function norm(v) {
  return String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/\s+/g,' ').trim();
}

function json(data,status=200) {
  return new Response(JSON.stringify(data),{
    status,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
  });
}
