const SESSION_COOKIE = "pf_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const APP_TIMEZONE = "America/Cuiaba";
const ALLOWED_NATURES = ["business_operating","inventory","business_debt","personal_withdrawal","income","transfer","unidentified"];
const ALLOWED_PAYMENT_METHODS = ["pix","cash","debit","credit","transfer","boleto","other"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok:true, app:env.APP_NAME || "Pantaneira Financeiro", version:env.APP_VERSION || "1.7.7" });
      }

      if (url.pathname === "/api/whatsapp/webhook" && request.method === "GET") return verifyWhatsAppWebhook(url,env);
      if (url.pathname === "/api/whatsapp/webhook" && request.method === "POST") return handleWhatsAppWebhook(request,env);

      if (url.pathname === "/api/internal/finance-command" && request.method === "POST") return handleInternalFinanceCommand(request,env);

      if (url.pathname === "/api/auth/status" && request.method === "GET") {
        const configured = Boolean(env.APP_PASSWORD && env.SESSION_SECRET);
        return json({ configured, authenticated: configured ? await isAuthenticated(request, env) : false });
      }

      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        if (!env.APP_PASSWORD || !env.SESSION_SECRET) return json({error:"Segredos de autenticação ainda não configurados."},503);
        const body = await readJson(request);
        if (!body.password || !safeEqual(String(body.password), String(env.APP_PASSWORD))) return json({error:"Senha inválida."},401);
        const token = await createSession(env);
        return json({ok:true},200,{"Set-Cookie":`${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`});
      }

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        return json({ok:true},200,{"Set-Cookie":`${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`});
      }

      if (!(await isAuthenticated(request, env))) return json({error:"Não autorizado."},401);

      if (url.pathname === "/api/dashboard" && request.method === "GET") return json(await buildDashboard(env.DB));
      if (url.pathname === "/api/month-summary" && request.method === "GET") {
        const periodKey=validatePeriodKey(url.searchParams.get("period_key")||periodKeyLocal(new Date()));
        return json(await buildMonthSummary(env.DB,periodKey));
      }
      if (url.pathname === "/api/periods" && request.method === "GET") return json({periods:await listPeriods(env.DB)});
      if (url.pathname === "/api/accounts" && request.method === "GET") return json({accounts:await listAccountsWithBalances(env.DB)});
      if (url.pathname === "/api/categories" && request.method === "GET") {
        const includeInactive=url.searchParams.get("all")==="1";
        const sql=`SELECT c.id,c.name,c.nature,c.parent_id,c.active,p.name parent_name
          FROM categories c LEFT JOIN categories p ON p.id=c.parent_id
          ${includeInactive?"":"WHERE c.active=1"}
          ORDER BY c.nature,COALESCE(p.name,c.name),CASE WHEN c.parent_id IS NULL THEN 0 ELSE 1 END,c.name`;
        return json({categories:(await env.DB.prepare(sql).all()).results});
      }
      if (url.pathname === "/api/categories" && request.method === "POST") {
        const body=await readJson(request); const name=String(body.name||"").trim(); const nature=String(body.nature||"");
        if(!name)return json({error:"Nome da categoria obrigatório."},400);
        if(!ALLOWED_NATURES.includes(nature)||["transfer","unidentified"].includes(nature))return json({error:"Natureza de categoria inválida."},400);
        let parentId=body.parent_id==null?null:toInteger(body.parent_id,"parent_id");
        if(parentId){const parent=await env.DB.prepare("SELECT id,nature,active FROM categories WHERE id=?").bind(parentId).first();if(!parent||!Number(parent.active)||parent.nature!==nature)return json({error:"Categoria principal inválida ou de outra natureza."},400);}
        try{
          const r=await env.DB.prepare("INSERT INTO categories(name,nature,parent_id,active) VALUES(?,?,?,1)").bind(name,nature,parentId).run();
          return json({ok:true,id:r.meta.last_row_id},201);
        }catch(err){if(String(err?.message||err).toLowerCase().includes("unique"))return json({error:"Já existe uma categoria com esse nome nesta natureza."},409);throw err;}
      }
      const categoryMatch=url.pathname.match(/^\/api\/categories\/(\d+)$/);
      if(categoryMatch && request.method==="PATCH"){
        const id=Number(categoryMatch[1]); const body=await readJson(request); const current=await env.DB.prepare("SELECT * FROM categories WHERE id=?").bind(id).first(); if(!current)return json({error:"Categoria não encontrada."},404);
        const name=body.name===undefined?current.name:String(body.name||"").trim(); if(!name)return json({error:"Nome obrigatório."},400);
        const active=body.active===undefined?Number(current.active):(body.active?1:0);
        let parentId=body.parent_id===undefined?current.parent_id:(body.parent_id==null?null:toInteger(body.parent_id,"parent_id"));
        if(parentId===id)return json({error:"Uma categoria não pode ser filha dela mesma."},400);
        if(parentId){const parent=await env.DB.prepare("SELECT id,nature,active FROM categories WHERE id=?").bind(parentId).first();if(!parent||!Number(parent.active)||parent.nature!==current.nature)return json({error:"Categoria principal inválida ou de outra natureza."},400);}
        try{await env.DB.prepare("UPDATE categories SET name=?,parent_id=?,active=? WHERE id=?").bind(name,parentId,active,id).run();return json({ok:true});}
        catch(err){if(String(err?.message||err).toLowerCase().includes("unique"))return json({error:"Já existe uma categoria com esse nome nesta natureza."},409);throw err;}
      }
      if (url.pathname === "/api/obligations" && request.method === "GET") return json({obligations:await listObligations(env.DB)});
      if (url.pathname === "/api/debts" && request.method === "GET") return json({debts:await listDebts(env.DB)});
      if (url.pathname === "/api/transactions" && request.method === "GET") {
        const limit=Math.min(Math.max(Number(url.searchParams.get("limit")||50),1),500);
        const filters={
          direction:url.searchParams.get("direction")||null,
          nature:url.searchParams.get("nature")||null,
          period_key:url.searchParams.get("period_key")||null,
          category_id:url.searchParams.get("category_id")||null,
          opening_history:url.searchParams.get("opening_history")||null,
          today:url.searchParams.get("today")==="1",
          q:url.searchParams.get("q")||null,
          search_scope:url.searchParams.get("search_scope")||null,
          account_id:url.searchParams.get("account_id")||null,
          date_from:url.searchParams.get("date_from")||null,
          date_to:url.searchParams.get("date_to")||null
        };
        return json({transactions:await listTransactions(env.DB,limit,filters)});
      }
      if(url.pathname==="/api/transactions/bulk-reclassify" && request.method==="POST"){
        const body=await readJson(request);
        return json(await bulkReclassifyTransactions(env.DB,body));
      }
      if(url.pathname==="/api/transactions/bulk-account-correct" && request.method==="POST"){
        const body=await readJson(request);
        return json(await bulkCorrectTransactionAccount(env.DB,body));
      }
      if (url.pathname === "/api/suppliers" && request.method === "GET") return json({suppliers:await listSuppliers(env.DB)});
      if (url.pathname === "/api/purchases" && request.method === "GET") return json({purchases:await listPurchases(env.DB,100)});

      const reconcileAccountMatch=url.pathname.match(/^\/api\/accounts\/(\d+)\/reconcile$/);
      if(reconcileAccountMatch && request.method==="POST"){
        const id=Number(reconcileAccountMatch[1]); const body=await readJson(request);
        const account=await accountBalance(env.DB,id); if(!account)return json({error:"Conta não encontrada."},404);
        if(Number(account.available_for_spending??1)===0)return json({error:"Ativos a compensar devem ser tratados pela compensação, não por conciliação de saldo."},400);
        const newBalance=toNonNegativeInteger(body.new_balance_cents,"new_balance_cents");
        const previous=Number(account.balance_cents||0); const diff=newBalance-previous;
        if(diff===0)return json({ok:true,no_change:true,balance_cents:previous});
        await env.DB.prepare(`INSERT INTO account_balance_adjustments(account_id,previous_balance_cents,new_balance_cents,difference_cents,reason,notes) VALUES(?,?,?,?,?,?)`)
          .bind(id,previous,newBalance,diff,nullable(body.reason),nullable(body.notes)).run();
        return json({ok:true,previous_balance_cents:previous,new_balance_cents:newBalance,difference_cents:diff});
      }

      const openingMatch=url.pathname.match(/^\/api\/accounts\/(\d+)\/opening-balance$/);
      if(openingMatch && request.method==="POST"){
        const body=await readJson(request); const opening=toInteger(body.opening_balance_cents,"opening_balance_cents");
        const result=await env.DB.prepare("UPDATE accounts SET opening_balance_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(opening,Number(openingMatch[1])).run();
        if(!result.meta.changes)return json({error:"Conta não encontrada."},404);
        return json({ok:true});
      }

      if(url.pathname==="/api/suppliers" && request.method==="POST"){
        const body=await readJson(request); const name=String(body.name||"").trim();
        if(!name)return json({error:"Nome do fornecedor obrigatório."},400);
        const existing=await env.DB.prepare("SELECT id FROM suppliers WHERE lower(name)=lower(?) LIMIT 1").bind(name).first();
        if(existing)return json({ok:true,id:existing.id,existing:true});
        const r=await env.DB.prepare("INSERT INTO suppliers(name,notes) VALUES(?,?)").bind(name,nullable(body.notes)).run();
        return json({ok:true,id:r.meta.last_row_id},201);
      }

      if(url.pathname==="/api/purchases" && request.method==="POST"){
        const body=await readJson(request);
        const response=await createPurchase(env.DB,body);
        return json(response,201);
      }

      if(url.pathname==="/api/obligations" && request.method==="POST"){
        const body=await readJson(request);
        const name=String(body.name||"").trim(); if(!name)return json({error:"Nome obrigatório."},400);
        const nature=String(body.nature||"business_operating");
        if(!["business_operating","inventory","business_debt","personal_withdrawal"].includes(nature))return json({error:"Natureza inválida."},400);
        const scope=nature==="personal_withdrawal"?"personal":(body.scope==="personal"?"personal":"business");
        const target=toNonNegativeInteger(body.monthly_target_cents??0,"monthly_target_cents");
        const dueDay=optionalDueDay(body.due_day); const dueDate=optionalIsoDate(body.due_date);
        let categoryId=body.category_id==null?null:toInteger(body.category_id,"category_id");
        if(!categoryId){ const c=await env.DB.prepare("SELECT id FROM categories WHERE nature=? AND active=1 ORDER BY id LIMIT 1").bind(nature).first(); categoryId=c?.id||null; }
        const r=await env.DB.prepare(`INSERT INTO obligations(name,scope,nature,category_id,monthly_target_cents,due_day,due_date,recurring,flexible,priority,counts_in_daily_target,personal_ceiling_member,notes)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(name,scope,nature,categoryId,target,dueDay,dueDate,body.recurring===false?0:1,body.flexible?1:0,Number(body.priority||3),body.counts_in_daily_target===false?0:1,body.personal_ceiling_member?1:0,nullable(body.notes)).run();
        return json({ok:true,id:r.meta.last_row_id},201);
      }

      const obligationMatch=url.pathname.match(/^\/api\/obligations\/(\d+)$/);
      if(obligationMatch && request.method==="PATCH"){
        const id=Number(obligationMatch[1]); const body=await readJson(request);
        const current=await env.DB.prepare("SELECT * FROM obligations WHERE id=?").bind(id).first(); if(!current)return json({error:"Compromisso não encontrado."},404);
        const v={
          name:body.name==null?current.name:String(body.name).trim(),
          monthly_target_cents:body.monthly_target_cents==null?current.monthly_target_cents:toNonNegativeInteger(body.monthly_target_cents,"monthly_target_cents"),
          due_day:body.due_day===undefined?current.due_day:optionalDueDay(body.due_day),
          due_date:body.due_date===undefined?current.due_date:optionalIsoDate(body.due_date),
          flexible:body.flexible===undefined?current.flexible:(body.flexible?1:0),
          priority:body.priority==null?current.priority:toInteger(body.priority,"priority"),
          counts:body.counts_in_daily_target===undefined?current.counts_in_daily_target:(body.counts_in_daily_target?1:0),
          ceiling:body.personal_ceiling_member===undefined?current.personal_ceiling_member:(body.personal_ceiling_member?1:0),
          active:body.active===undefined?current.active:(body.active?1:0),
          notes:body.notes===undefined?current.notes:nullable(body.notes)
        };
        await env.DB.prepare(`UPDATE obligations SET name=?,monthly_target_cents=?,due_day=?,due_date=?,flexible=?,priority=?,counts_in_daily_target=?,personal_ceiling_member=?,active=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(v.name,v.monthly_target_cents,v.due_day,v.due_date,v.flexible,v.priority,v.counts,v.ceiling,v.active,v.notes,id).run();
        return json({ok:true});
      }

      const openingPaidMatch=url.pathname.match(/^\/api\/obligations\/(\d+)\/opening-paid$/);
      if(openingPaidMatch && request.method==="POST"){
        const id=Number(openingPaidMatch[1]); const body=await readJson(request);
        const obligation=await env.DB.prepare("SELECT * FROM obligations WHERE id=? AND active=1").bind(id).first();
        if(!obligation)return json({error:"Compromisso não encontrado."},404);
        const periodKey=String(body.period_key||targetPeriodForRawObligation(obligation,new Date()));
        const paidRow=await env.DB.prepare("SELECT COALESCE(SUM(amount_cents),0) total FROM transactions WHERE obligation_id=? AND period_key=? AND direction='expense' AND status!='void'").bind(id,periodKey).first();
        const alreadyPaid=Number(paidRow?.total||0); const target=Number(obligation.monthly_target_cents||0); const remaining=Math.max(0,target-alreadyPaid);
        if(remaining<=0)return json({error:"Esta conta já está marcada como paga no período."},400);
        const amount=body.amount_cents==null?remaining:toPositiveInteger(body.amount_cents,"amount_cents");
        if(amount>remaining)return json({error:`O valor informado supera o que falta pagar (${formatCents(remaining)}).`},400);
        let paidDate=null;
        if(body.paid_date!=null && body.paid_date!=="") paidDate=optionalIsoDate(body.paid_date);
        const occurredAt=paidDate?`${paidDate}T16:00:00.000Z`:`${periodKey}-01T16:00:00.000Z`;
        await env.DB.prepare(`INSERT INTO transactions(occurred_at,period_key,direction,amount_cents,source_account_id,destination_account_id,nature,category_id,obligation_id,debt_id,description,notes,payment_method,recurrence_type,status,opening_history)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).bind(
            occurredAt,periodKey,"expense",amount,null,null,obligation.nature,obligation.category_id,id,null,
            `${obligation.name} - pago antes da implantação`,
            `Pagamento ocorrido antes da fotografia inicial dos saldos. Não movimenta conta para evitar desconto em duplicidade.${paidDate?` Data informada: ${paidDate}.`:" Data exata não informada."}`,
            "other","eventual","posted"
          ).run();
        return json({ok:true,amount_cents:amount,period_key:periodKey});
      }

      if(url.pathname==="/api/reserves" && request.method==="POST"){
        const body=await readJson(request); const obligationId=toInteger(body.obligation_id,"obligation_id"); const amount=toPositiveInteger(body.amount_cents,"amount_cents");
        const obligation=await env.DB.prepare("SELECT * FROM obligations WHERE id=? AND active=1").bind(obligationId).first(); if(!obligation)return json({error:"Compromisso não encontrado."},404);
        const periodKey=body.period_key||targetPeriodForRawObligation(obligation,new Date());
        await env.DB.prepare("INSERT INTO reserves(obligation_id,period_key,amount_cents,notes) VALUES(?,?,?,?)").bind(obligationId,periodKey,amount,nullable(body.notes)).run();
        return json({ok:true});
      }

      if(url.pathname==="/api/debts" && request.method==="POST"){
        const body=await readJson(request); const name=String(body.name||"").trim(); if(!name)return json({error:"Nome da dívida obrigatório."},400);
        const scope=body.scope==="personal"?"personal":"business";
        const balance=optionalPositiveInteger(body.current_balance_cents,"current_balance_cents");
        const monthly=optionalPositiveInteger(body.monthly_target_cents,"monthly_target_cents");
        const installment=optionalPositiveInteger(body.installment_cents,"installment_cents");
        const kind=String(body.debt_kind||"old"); const flexible=body.flexible===undefined?(kind!=="current_installment"):(body.flexible?1:0);
        const r=await env.DB.prepare(`INSERT INTO debts(name,creditor,scope,original_balance_cents,current_balance_cents,monthly_target_cents,installment_cents,due_day,flexible,priority,status,notes,debt_kind)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(name,nullable(body.creditor),scope,balance,balance,monthly,installment,optionalDueDay(body.due_day),flexible,Number(body.priority||2),"active",nullable(body.notes),kind).run();
        const debtId=r.meta.last_row_id;
        const target=installment||monthly;
        if(target && kind==="current_installment") await createDebtObligation(env.DB,debtId,name,scope,target,optionalDueDay(body.due_day),Number(body.priority||2));
        return json({ok:true,id:debtId},201);
      }

      const debtMatch=url.pathname.match(/^\/api\/debts\/(\d+)$/);
      if(debtMatch && request.method==="PATCH"){
        const id=Number(debtMatch[1]); const body=await readJson(request); const current=await env.DB.prepare("SELECT * FROM debts WHERE id=?").bind(id).first(); if(!current)return json({error:"Dívida não encontrada."},404);
        const balance=body.current_balance_cents===undefined?current.current_balance_cents:optionalPositiveInteger(body.current_balance_cents,"current_balance_cents");
        const monthly=body.monthly_target_cents===undefined?current.monthly_target_cents:optionalPositiveInteger(body.monthly_target_cents,"monthly_target_cents");
        const installment=body.installment_cents===undefined?current.installment_cents:optionalPositiveInteger(body.installment_cents,"installment_cents");
        const due=body.due_day===undefined?current.due_day:optionalDueDay(body.due_day);
        const flex=body.flexible===undefined?current.flexible:(body.flexible?1:0);
        const kind=body.debt_kind===undefined?current.debt_kind:String(body.debt_kind);
        await env.DB.prepare("UPDATE debts SET current_balance_cents=?,monthly_target_cents=?,installment_cents=?,due_day=?,flexible=?,debt_kind=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(balance,monthly,installment,due,flex,kind,body.notes===undefined?current.notes:nullable(body.notes),id).run();
        return json({ok:true});
      }

      if(url.pathname==="/api/opening-history" && request.method==="POST"){
        const body=await readJson(request);
        const direction=String(body.direction||""); if(!["income","expense"].includes(direction))return json({error:"Histórico anterior aceita somente entrada ou saída."},400);
        let nature=String(body.nature||"");
        if(direction==="income") nature="income";
        if(direction==="expense" && !["business_operating","inventory","business_debt","personal_withdrawal"].includes(nature))return json({error:"Natureza inválida para saída anterior."},400);
        const amount=toPositiveInteger(body.amount_cents,"amount_cents"); const description=String(body.description||"").trim(); if(!description)return json({error:"Descrição obrigatória."},400);
        const paidDate=optionalIsoDate(body.paid_date); const historicalStart=(await getSetting(env.DB,"historical_entry_start_date"))||"2026-07-01"; const historicalEnd=(await getSetting(env.DB,"historical_entry_end_date"))||"2026-08-10";
        if(!paidDate || paidDate<historicalStart || paidDate>historicalEnd)return json({error:`A data histórica deve ficar entre ${historicalStart} e ${historicalEnd}.`},400);
        const occurredAt=`${paidDate}T16:00:00.000Z`; const periodKey=periodKeyFromIso(occurredAt);
        let categoryId=body.category_id==null?null:toInteger(body.category_id,"category_id");
        if(categoryId){const cat=await env.DB.prepare("SELECT id,nature FROM categories WHERE id=? AND active=1").bind(categoryId).first(); if(!cat||cat.nature!==nature)return json({error:"Categoria incompatível com a natureza escolhida."},400);}
        if(!categoryId){const c=await env.DB.prepare("SELECT id FROM categories WHERE nature=? AND active=1 ORDER BY id LIMIT 1").bind(nature).first(); categoryId=c?.id||null;}
        let obligationId=direction==="expense"&&body.obligation_id!=null?toInteger(body.obligation_id,"obligation_id"):null;
        if(obligationId){
          const o=await env.DB.prepare("SELECT * FROM obligations WHERE id=? AND active=1").bind(obligationId).first(); if(!o)return json({error:"Conta/compromisso não encontrado."},404);
          if(o.nature!==nature)return json({error:"A conta selecionada não combina com a natureza do lançamento."},400);
          const paidRow=await env.DB.prepare("SELECT COALESCE(SUM(amount_cents),0) total FROM transactions WHERE obligation_id=? AND period_key=? AND direction='expense' AND status!='void'").bind(obligationId,periodKey).first();
          const remaining=Math.max(0,Number(o.monthly_target_cents||0)-Number(paidRow?.total||0)); if(amount>remaining)return json({error:`O valor supera o que falta pagar desta conta (${formatCents(remaining)}).`},400);
        }
        const historicalAccount=body.account_id==null?null:toInteger(body.account_id,"account_id");
        if(historicalAccount){const a=await env.DB.prepare("SELECT id FROM accounts WHERE id=? AND active=1").bind(historicalAccount).first();if(!a)return json({error:"Conta/origem histórica inválida."},400);}
        const sourceAccount=direction==="expense"?historicalAccount:null; const destinationAccount=direction==="income"?historicalAccount:null;
        const r=await env.DB.prepare(`INSERT INTO transactions(occurred_at,period_key,direction,amount_cents,source_account_id,destination_account_id,nature,category_id,obligation_id,debt_id,description,notes,payment_method,recurrence_type,status,opening_history)
          VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,1)`).bind(occurredAt,periodKey,direction,amount,sourceAccount,destinationAccount,nature,categoryId,obligationId,description,nullable(body.notes),normalizePaymentMethod(body.payment_method),"eventual","posted").run();
        return json({ok:true,id:r.meta.last_row_id,does_not_change_balance:true},201);
      }

      if(url.pathname==="/api/transactions" && request.method==="POST"){
        const body=await readJson(request); const t=validateTransaction(body);
        if(t.obligation_id && !t.supplier_id){
          const p=await env.DB.prepare("SELECT supplier_id,purchase_id FROM purchases WHERE obligation_id=? ORDER BY id DESC LIMIT 1").bind(t.obligation_id).first();
          if(p){t.supplier_id=p.supplier_id;t.purchase_id=p.id;}
        }
        const r=await env.DB.prepare(`INSERT INTO transactions(occurred_at,period_key,direction,amount_cents,source_account_id,destination_account_id,nature,category_id,obligation_id,debt_id,description,notes,payment_method,recurrence_type,status,supplier_id,purchase_id)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(t.occurred_at,t.period_key,t.direction,t.amount_cents,t.source_account_id,t.destination_account_id,t.nature,t.category_id,t.obligation_id,t.debt_id,t.description,t.notes,t.payment_method,t.recurrence_type,"posted",t.supplier_id,t.purchase_id).run();

        if(t.debt_id && t.direction==="expense") await reduceDebt(env.DB,t.debt_id,t.amount_cents);
        if(t.purchase_id || t.obligation_id) await syncPurchaseFromTransaction(env.DB,t.purchase_id,t.obligation_id);
        const dashboard=await buildDashboard(env.DB);
        const warnings=[];
        if(t.nature==="personal_withdrawal"){
          if(dashboard.personal.ceiling_exceeded_cents>0) warnings.push(`Teto pessoal ultrapassado em ${formatCents(dashboard.personal.ceiling_exceeded_cents)}.`);
          if(dashboard.balances.free_strict_cents<0) warnings.push(`Esta retirada mantém o caixa livre negativo em ${formatCents(Math.abs(dashboard.balances.free_strict_cents))}.`);
        }
        return json({ok:true,id:r.meta.last_row_id,warnings},201);
      }

      const transactionMatch=url.pathname.match(/^\/api\/transactions\/(\d+)$/);
      if(transactionMatch && request.method==="PATCH"){
        const id=Number(transactionMatch[1]); const body=await readJson(request);
        const current=await env.DB.prepare("SELECT * FROM transactions WHERE id=?").bind(id).first();
        if(!current)return json({error:"Lançamento não encontrado."},404);
        if(current.status==="void")return json({error:"Lançamento cancelado não pode ser editado."},400);

        const requestedSource=body.source_account_id===undefined?current.source_account_id:(body.source_account_id==null?null:Number(body.source_account_id));
        const requestedDestination=body.destination_account_id===undefined?current.destination_account_id:(body.destination_account_id==null?null:Number(body.destination_account_id));
        const accountChanged=Number(requestedSource||0)!==Number(current.source_account_id||0)||Number(requestedDestination||0)!==Number(current.destination_account_id||0);
        if(accountChanged && body.allow_account_change!==true){
          return json({error:"Por segurança, a conta de um lançamento não pode ser alterada pela edição comum. Use Pesquisar lançamentos → Corrigir conta dos selecionados."},400);
        }

        const isOpening=Number(current.opening_history||0)===1;
        if(current.purchase_id && !current.obligation_id && !isOpening && (body.amount_cents!==undefined || body.direction!==undefined || body.source_account_id!==undefined || body.destination_account_id!==undefined)){
          return json({error:"Este lançamento é o pagamento inicial de uma compra. Para não desalinhar a compra, edite apenas descrição, categoria ou observação por enquanto."},400);
        }

        let next;
        if(isOpening){
          const direction=body.direction===undefined?current.direction:String(body.direction);
          if(!["income","expense"].includes(direction))return json({error:"Histórico anterior aceita somente entrada ou saída."},400);
          let nature=body.nature===undefined?current.nature:String(body.nature);
          if(direction==="income")nature="income";
          if(direction==="expense" && !["business_operating","inventory","business_debt","personal_withdrawal"].includes(nature))return json({error:"Natureza inválida para saída anterior."},400);
          const amount=body.amount_cents===undefined?Number(current.amount_cents):toPositiveInteger(body.amount_cents,"amount_cents");
          const description=body.description===undefined?current.description:String(body.description||"").trim(); if(!description)return json({error:"Descrição obrigatória."},400);
          let occurredAt=current.occurred_at;
          if(body.occurred_at!==undefined){
            const paidDate=optionalIsoDate(String(body.occurred_at).slice(0,10));
            const historicalStart=(await getSetting(env.DB,"historical_entry_start_date"))||"2026-07-01"; const historicalEnd=(await getSetting(env.DB,"historical_entry_end_date"))||"2026-08-10";
            if(!paidDate || paidDate<historicalStart || paidDate>historicalEnd)return json({error:`A data histórica deve ficar entre ${historicalStart} e ${historicalEnd}.`},400);
            occurredAt=`${paidDate}T16:00:00.000Z`;
          }
          const periodKey=periodKeyFromIso(occurredAt);
          let categoryId=body.category_id===undefined?current.category_id:(body.category_id==null?null:toInteger(body.category_id,"category_id"));
          categoryId=await validCategoryForNature(env.DB,categoryId,nature);
          let obligationId=direction==="expense"?(body.obligation_id===undefined?current.obligation_id:(body.obligation_id==null?null:toInteger(body.obligation_id,"obligation_id"))):null;
          await validateObligationPayment(env.DB,obligationId,nature,periodKey,amount,id);
          const historicalAccount=body.source_account_id??body.destination_account_id??current.source_account_id??current.destination_account_id??null;
          const historicalAccountId=historicalAccount==null?null:toInteger(historicalAccount,"historical_account_id");
          next={occurred_at:occurredAt,period_key:periodKey,direction,amount_cents:amount,source_account_id:direction==="expense"?historicalAccountId:null,destination_account_id:direction==="income"?historicalAccountId:null,nature,category_id:categoryId,obligation_id:obligationId,debt_id:null,description,notes:body.notes===undefined?current.notes:nullable(body.notes),payment_method:body.payment_method===undefined?current.payment_method:normalizePaymentMethod(body.payment_method),recurrence_type:current.recurrence_type||"eventual",status:"posted",supplier_id:current.supplier_id,purchase_id:current.purchase_id};
        }else{
          const candidate={
            direction:body.direction===undefined?current.direction:body.direction,
            amount_cents:body.amount_cents===undefined?Number(current.amount_cents):body.amount_cents,
            source_account_id:body.source_account_id===undefined?current.source_account_id:body.source_account_id,
            destination_account_id:body.destination_account_id===undefined?current.destination_account_id:body.destination_account_id,
            nature:body.nature===undefined?current.nature:body.nature,
            category_id:body.category_id===undefined?current.category_id:body.category_id,
            obligation_id:body.obligation_id===undefined?current.obligation_id:body.obligation_id,
            debt_id:body.debt_id===undefined?current.debt_id:body.debt_id,
            supplier_id:body.supplier_id===undefined?current.supplier_id:body.supplier_id,
            purchase_id:body.purchase_id===undefined?current.purchase_id:body.purchase_id,
            description:body.description===undefined?current.description:body.description,
            notes:body.notes===undefined?current.notes:body.notes,
            payment_method:body.payment_method===undefined?current.payment_method:body.payment_method,
            recurrence_type:body.recurrence_type===undefined?current.recurrence_type:body.recurrence_type,
            occurred_at:body.occurred_at===undefined?current.occurred_at:body.occurred_at
          };
          next=validateTransaction(candidate);
          next.category_id=await validCategoryForNature(env.DB,next.category_id,next.nature);
          await validateObligationPayment(env.DB,next.obligation_id,next.nature,next.period_key,next.amount_cents,id);
        }

        const beforeJson=JSON.stringify(current);
        if(current.debt_id && current.direction==="expense" && current.status!=="void" && !isOpening) await restoreDebt(env.DB,Number(current.debt_id),Number(current.amount_cents));

        await env.DB.prepare(`UPDATE transactions SET occurred_at=?,period_key=?,direction=?,amount_cents=?,source_account_id=?,destination_account_id=?,nature=?,category_id=?,obligation_id=?,debt_id=?,description=?,notes=?,payment_method=?,recurrence_type=?,status=?,supplier_id=?,purchase_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(next.occurred_at,next.period_key,next.direction,next.amount_cents,next.source_account_id,next.destination_account_id,next.nature,next.category_id,next.obligation_id,next.debt_id,next.description,next.notes,next.payment_method,next.recurrence_type,next.status||"posted",next.supplier_id,next.purchase_id,id).run();

        if(next.debt_id && next.direction==="expense" && !isOpening) await reduceDebt(env.DB,Number(next.debt_id),Number(next.amount_cents));
        if(current.purchase_id || current.obligation_id) await syncPurchaseFromTransaction(env.DB,current.purchase_id,current.obligation_id);
        if(next.purchase_id || next.obligation_id) await syncPurchaseFromTransaction(env.DB,next.purchase_id,next.obligation_id);
        const updated=await env.DB.prepare("SELECT * FROM transactions WHERE id=?").bind(id).first();
        await logTransactionRevision(env.DB,id,"edit",beforeJson,JSON.stringify(updated));
        return json({ok:true,transaction:updated});
      }

      if(transactionMatch && request.method==="DELETE"){
        const id=Number(transactionMatch[1]);
        const current=await env.DB.prepare("SELECT * FROM transactions WHERE id=?").bind(id).first();
        if(!current)return json({error:"Lançamento não encontrado."},404);
        if(current.status==="void")return json({ok:true,already_void:true});
        if(current.purchase_id && !current.obligation_id && !Number(current.opening_history||0))return json({error:"Este lançamento pertence ao pagamento inicial de uma compra. O cancelamento da compra será tratado na tela de Compras."},400);
        const beforeJson=JSON.stringify(current);
        if(current.debt_id && current.direction==="expense" && !Number(current.opening_history||0)) await restoreDebt(env.DB,Number(current.debt_id),Number(current.amount_cents));
        await env.DB.prepare("UPDATE transactions SET status='void',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
        if(current.purchase_id || current.obligation_id) await syncPurchaseFromTransaction(env.DB,current.purchase_id,current.obligation_id);
        const updated=await env.DB.prepare("SELECT * FROM transactions WHERE id=?").bind(id).first();
        await logTransactionRevision(env.DB,id,"void",beforeJson,JSON.stringify(updated));
        return json({ok:true});
      }

      if(url.pathname==="/api/cash/reconcile" && request.method==="POST"){
        const body=await readJson(request); const accountId=toInteger(body.account_id,"account_id"); const actual=toInteger(body.actual_balance_cents,"actual_balance_cents");
        const account=await accountBalance(env.DB,accountId); if(!account)return json({error:"Conta não encontrada."},404); if(account.account_type!=="cash")return json({error:"A conferência só pode ser feita em conta do tipo dinheiro."},400);
        const difference=actual-Number(account.balance_cents||0); let transactionId=null;
        if(difference!==0){
          const c=await env.DB.prepare("SELECT id FROM categories WHERE nature='unidentified' LIMIT 1").first(); const occurredAt=new Date().toISOString(); const amount=Math.abs(difference); const direction=difference<0?"expense":"income";
          const r=await env.DB.prepare(`INSERT INTO transactions(occurred_at,period_key,direction,amount_cents,source_account_id,destination_account_id,nature,category_id,description,notes,payment_method,recurrence_type,status)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(occurredAt,periodKeyFromIso(occurredAt),direction,amount,direction==="expense"?accountId:null,direction==="income"?accountId:null,"unidentified",c?.id||null,difference<0?"Saída de dinheiro não identificada":"Entrada de dinheiro não identificada","Gerado automaticamente pela conferência. Reclassificar quando identificar.","cash","eventual","pending_reclassification").run();
          transactionId=r.meta.last_row_id;
        }
        await env.DB.prepare("INSERT INTO cash_reconciliations(account_id,expected_cents,actual_cents,difference_cents,transaction_id,notes) VALUES(?,?,?,?,?,?)")
          .bind(accountId,account.balance_cents,actual,difference,transactionId,nullable(body.notes)).run();
        return json({ok:true,expected_cents:account.balance_cents,actual_cents:actual,difference_cents:difference,transaction_id:transactionId});
      }

      return json({error:"Rota não encontrada."},404);
    } catch(error) {
      console.error(error);
      return json({error:error?.message||"Erro interno."},500);
    }
  }
};

async function buildDashboard(db){
  const now=new Date(); const accounts=await listAccountsWithBalances(db); const obligations=await listObligations(db,now);
  let businessAvailable=0,businessTotal=0,pendingBusiness=0,cash=0,all=0;
  for(const a of accounts){
    const b=Number(a.balance_cents||0); all+=b;
    if(a.owner_scope==="business"){
      businessTotal+=b; if(Number(a.available_for_spending??1)===1)businessAvailable+=b; else pendingBusiness+=b;
      if(a.account_type==="cash")cash+=b;
    }
  }
  const currentKey=periodKeyLocal(now);
  const target=obligations.filter(o=>o.active&&o.counts_in_daily_target);
  // v1.7.7 — separa obrigação do mês atual/atrasada de compromissos de ciclos futuros.
  // Isso evita transformar uma reserva para setembro em "rombo" de agosto.
  const currentTarget=target.filter(o=>String(o.target_period_key||currentKey)<=currentKey);
  const futureTarget=target.filter(o=>String(o.target_period_key||currentKey)>currentKey);
  const currentStrictTarget=currentTarget.filter(o=>!o.flexible);
  const futureStrictTarget=futureTarget.filter(o=>!o.flexible);
  const committedStrict=currentStrictTarget.reduce((sum,o)=>sum+Math.max(0,Number(o.remaining_cents||0)),0);
  const committedFlexible=currentTarget.filter(o=>o.flexible).reduce((sum,o)=>sum+Math.max(0,Number(o.remaining_cents||0)),0);
  const futureCommittedStrict=futureStrictTarget.reduce((sum,o)=>sum+Math.max(0,Number(o.remaining_cents||0)),0);
  const futureCommittedFlexible=futureTarget.filter(o=>o.flexible).reduce((sum,o)=>sum+Math.max(0,Number(o.remaining_cents||0)),0);
  // O rateio diário do painel passa a olhar somente ciclos futuros.
  const daily=calculateDailyProtection(futureTarget,now);
  const {start,end}=localDayUtcRange(now); const {monthStart,nextMonth}=localMonthUtcRange(now);
  const today=await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN t.direction='income' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) income_cents,
    COALESCE(SUM(CASE WHEN t.direction='income' AND t.status!='void' AND c.name IN ('Vendas da loja','Receita de vendas') THEN t.amount_cents ELSE 0 END),0) sales_cents,
    COALESCE(SUM(CASE WHEN t.direction='income' AND t.status!='void' AND c.name='Recebimento de vendas anteriores' THEN t.amount_cents ELSE 0 END),0) old_receipts_cents,
    COALESCE(SUM(CASE WHEN t.direction='expense' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) expense_cents,
    COALESCE(SUM(CASE WHEN t.direction='expense' AND t.nature='personal_withdrawal' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) personal_cents
    FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
    WHERE t.occurred_at>=? AND t.occurred_at<?`).bind(start,end).first();
  const month=await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN t.direction='income' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) income_cents,
    COALESCE(SUM(CASE WHEN t.direction='income' AND t.status!='void' AND c.name IN ('Vendas da loja','Receita de vendas') THEN t.amount_cents ELSE 0 END),0) sales_cents,
    COALESCE(SUM(CASE WHEN t.direction='income' AND t.status!='void' AND c.name='Recebimento de vendas anteriores' THEN t.amount_cents ELSE 0 END),0) old_receipts_cents,
    COALESCE(SUM(CASE WHEN t.direction='expense' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) expense_cents,
    COALESCE(SUM(CASE WHEN t.direction='expense' AND t.nature='personal_withdrawal' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) personal_cents,
    COALESCE(SUM(CASE WHEN t.direction='expense' AND t.nature='business_debt' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) debt_paid_cents,
    COALESCE(SUM(CASE WHEN t.direction='expense' AND t.nature='inventory' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) inventory_cents,
    COALESCE(SUM(CASE WHEN t.opening_history=1 AND t.direction='income' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) opening_income_cents,
    COALESCE(SUM(CASE WHEN t.opening_history=1 AND t.direction='expense' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) opening_expense_cents
    FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
    WHERE t.occurred_at>=? AND t.occurred_at<?`).bind(monthStart,nextMonth).first();

  const categorySpending=(await db.prepare(`SELECT c.id,c.name,c.nature,COALESCE(p.name,'') parent_name,SUM(t.amount_cents) total_cents
    FROM transactions t JOIN categories c ON c.id=t.category_id LEFT JOIN categories p ON p.id=c.parent_id
    WHERE t.occurred_at>=? AND t.occurred_at<? AND t.direction='expense' AND t.status!='void'
    GROUP BY c.id,c.name,c.nature,p.name ORDER BY total_cents DESC,c.name`).bind(monthStart,nextMonth).all()).results
    .map(r=>({...r,total_cents:Number(r.total_cents||0)}));

  const personalFixed=obligations.filter(o=>o.scope==="personal"&&Number(o.personal_ceiling_member||0)===1);
  const ceiling=personalFixed.reduce((s,o)=>s+Number(o.monthly_target_cents||0),0) || Number((await getSetting(db,"personal_fixed_ceiling_cents"))||291800);
  const personalUsed=Number(month?.personal_cents||0); const personalRemaining=Math.max(0,ceiling-personalUsed); const personalExceeded=Math.max(0,personalUsed-ceiling);
  const pension=personalFixed.find(o=>o.name==="Pensão")||null;

  const debts=await listDebts(db);
  const oldDebtBalance=debts.filter(d=>d.scope==="business"&&d.debt_kind==="old"&&d.status==="active"&&d.current_balance_cents!=null).reduce((s,d)=>s+Number(d.current_balance_cents||0),0);
  const purchases=await listPurchases(db,5);

  return {
    as_of:now.toISOString(),period_key:currentKey,
    balances:{
      all_cents:all,
      business_cents:businessAvailable,
      business_total_cents:businessTotal,
      pending_business_cents:pendingBusiness,
      cash_cents:cash,
      // Compatibilidade: estes campos agora representam somente o que está vencido ou pertence ao mês atual.
      committed_strict_cents:committedStrict,
      committed_flexible_cents:committedFlexible,
      free_strict_cents:businessAvailable-committedStrict,
      future_committed_strict_cents:futureCommittedStrict,
      future_committed_flexible_cents:futureCommittedFlexible
    },
    cash_horizon:{
      current_period_key:currentKey,
      current_commitments_cents:committedStrict,
      current_flexible_cents:committedFlexible,
      current_free_cents:businessAvailable-committedStrict,
      current_items_count:currentTarget.filter(o=>Number(o.remaining_cents||0)>0).length,
      future_commitments_cents:futureCommittedStrict,
      future_flexible_cents:futureCommittedFlexible,
      future_daily_reserve_cents:Number(daily.total_cents||0),
      future_items_count:futureTarget.filter(o=>Number(o.remaining_cents||0)>0).length
    },
    daily_protection:daily,
    today:{income_cents:Number(today?.income_cents||0),sales_cents:Number(today?.sales_cents||0),old_receipts_cents:Number(today?.old_receipts_cents||0),expense_cents:Number(today?.expense_cents||0),personal_withdrawal_cents:Number(today?.personal_cents||0)},
    month:{income_cents:Number(month?.income_cents||0),sales_cents:Number(month?.sales_cents||0),old_receipts_cents:Number(month?.old_receipts_cents||0),expense_cents:Number(month?.expense_cents||0),net_cents:Number(month?.income_cents||0)-Number(month?.expense_cents||0),opening_income_cents:Number(month?.opening_income_cents||0),opening_expense_cents:Number(month?.opening_expense_cents||0),personal_withdrawal_cents:personalUsed,debt_paid_cents:Number(month?.debt_paid_cents||0),inventory_spent_cents:Number(month?.inventory_cents||0)},
    category_spending:categorySpending,
    personal:{ceiling_cents:ceiling,withdrawn_cents:personalUsed,ceiling_remaining_cents:personalRemaining,ceiling_exceeded_cents:personalExceeded,pension:pension?{target_cents:Number(pension.monthly_target_cents||0),paid_cents:Number(pension.paid_current_cents||0),remaining_cents:Math.max(0,Number(pension.monthly_target_cents||0)-Number(pension.paid_current_cents||0))}:null,fixed_items:personalFixed.map(o=>({id:o.id,name:o.name,target_cents:Number(o.monthly_target_cents||0),paid_cents:Number(o.paid_current_cents||0)}))},
    debt_summary:{old_business_balance_cents:oldDebtBalance,active_count:debts.filter(d=>d.status==="active").length},
    accounts,obligations:obligations.slice(0,50),recent_purchases:purchases
  };
}

async function buildMonthSummary(db,periodKey){
  periodKey=validatePeriodKey(periodKey);
  const month=await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN t.direction='income' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) income_cents,
    COALESCE(SUM(CASE WHEN t.direction='income' AND t.status!='void' AND c.name IN ('Vendas da loja','Receita de vendas') THEN t.amount_cents ELSE 0 END),0) sales_cents,
    COALESCE(SUM(CASE WHEN t.direction='income' AND t.status!='void' AND c.name='Recebimento de vendas anteriores' THEN t.amount_cents ELSE 0 END),0) old_receipts_cents,
    COALESCE(SUM(CASE WHEN t.direction='expense' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) expense_cents,
    COALESCE(SUM(CASE WHEN t.direction='expense' AND t.nature='personal_withdrawal' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) personal_cents,
    COALESCE(SUM(CASE WHEN t.direction='expense' AND t.nature='business_debt' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) debt_paid_cents,
    COALESCE(SUM(CASE WHEN t.direction='expense' AND t.nature='inventory' AND t.status!='void' THEN t.amount_cents ELSE 0 END),0) inventory_cents
    FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
    WHERE t.period_key=?`).bind(periodKey).first();
  const categorySpending=(await db.prepare(`SELECT c.id,c.name,c.nature,COALESCE(p.name,'') parent_name,SUM(t.amount_cents) total_cents
    FROM transactions t JOIN categories c ON c.id=t.category_id LEFT JOIN categories p ON p.id=c.parent_id
    WHERE t.period_key=? AND t.direction='expense' AND t.status!='void'
    GROUP BY c.id,c.name,c.nature,p.name ORDER BY total_cents DESC,c.name`).bind(periodKey).all()).results.map(r=>({...r,total_cents:Number(r.total_cents||0)}));
  const income=Number(month?.income_cents||0),expense=Number(month?.expense_cents||0);
  return {period_key:periodKey,month:{income_cents:income,sales_cents:Number(month?.sales_cents||0),old_receipts_cents:Number(month?.old_receipts_cents||0),expense_cents:expense,net_cents:income-expense,personal_withdrawal_cents:Number(month?.personal_cents||0),debt_paid_cents:Number(month?.debt_paid_cents||0),inventory_spent_cents:Number(month?.inventory_cents||0)},category_spending:categorySpending};
}

async function listPeriods(db){
  const rows=(await db.prepare(`SELECT DISTINCT period_key FROM transactions WHERE status!='void' ORDER BY period_key DESC`).all()).results.map(r=>r.period_key);
  const current=periodKeyLocal(new Date()); if(!rows.includes(current))rows.unshift(current); if(!rows.includes('2026-07'))rows.push('2026-07');
  return [...new Set(rows)].sort().reverse();
}

async function listAccountsWithBalances(db){
  const {results}=await db.prepare(`SELECT a.id,a.name,a.owner_scope,a.account_type,a.opening_balance_cents,a.available_for_spending,a.active,a.notes,
    a.opening_balance_cents
    +COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.destination_account_id=a.id AND t.status!='void' AND COALESCE(t.opening_history,0)=0),0)
    -COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.source_account_id=a.id AND t.status!='void' AND COALESCE(t.opening_history,0)=0),0)
    +COALESCE((SELECT SUM(x.difference_cents) FROM account_balance_adjustments x WHERE x.account_id=a.id),0) balance_cents
    FROM accounts a WHERE a.active=1 ORDER BY CASE a.owner_scope WHEN 'business' THEN 0 ELSE 1 END,a.id`).all();
  return results.map(r=>({...r,balance_cents:Number(r.balance_cents||0)}));
}

async function accountBalance(db,id){
  return db.prepare(`SELECT a.id,a.name,a.owner_scope,a.account_type,a.opening_balance_cents,a.available_for_spending,
    a.opening_balance_cents+COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.destination_account_id=a.id AND t.status!='void' AND COALESCE(t.opening_history,0)=0),0)-COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.source_account_id=a.id AND t.status!='void' AND COALESCE(t.opening_history,0)=0),0)+COALESCE((SELECT SUM(x.difference_cents) FROM account_balance_adjustments x WHERE x.account_id=a.id),0) balance_cents
    FROM accounts a WHERE a.id=? AND a.active=1`).bind(id).first();
}

async function listObligations(db,now=new Date()){
  const currentKey=periodKeyLocal(now),nextKey=nextPeriodKey(currentKey);
  const {results}=await db.prepare(`SELECT o.id,o.name,o.scope,o.nature,o.monthly_target_cents,o.due_day,o.due_date,o.recurring,o.flexible,o.priority,o.counts_in_daily_target,o.personal_ceiling_member,o.active,o.notes,c.name category_name,o.debt_id,
    COALESCE((SELECT SUM(r.amount_cents) FROM reserves r WHERE r.obligation_id=o.id AND r.period_key=?),0) reserve_current_cents,
    COALESCE((SELECT SUM(r.amount_cents) FROM reserves r WHERE r.obligation_id=o.id AND r.period_key=?),0) reserve_next_cents,
    COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.obligation_id=o.id AND t.period_key=? AND t.direction='expense' AND t.status!='void'),0) paid_current_cents,
    COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.obligation_id=o.id AND t.period_key=? AND t.direction='expense' AND t.status!='void'),0) paid_next_cents,
    COALESCE((SELECT SUM(r.amount_cents) FROM reserves r WHERE r.obligation_id=o.id AND o.due_date IS NOT NULL AND r.period_key=substr(o.due_date,1,7)),0) reserve_due_cents,
    COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.obligation_id=o.id AND o.due_date IS NOT NULL AND t.period_key=substr(o.due_date,1,7) AND t.direction='expense' AND t.status!='void'),0) paid_due_cents
    FROM obligations o LEFT JOIN categories c ON c.id=o.category_id WHERE o.active=1
    ORDER BY o.priority,CASE WHEN o.due_date IS NOT NULL THEN o.due_date WHEN o.due_day IS NULL THEN '9999-12-31' ELSE printf('9999-01-%02d',o.due_day) END,o.name`)
    .bind(currentKey,nextKey,currentKey,nextKey).all();
  return results.map(r=>{
    const target=Number(r.monthly_target_cents||0); let targetPeriod=currentKey,reservedTotal=Number(r.reserve_current_cents||0),paid=Number(r.paid_current_cents||0);
    if(!Number(r.recurring) && r.due_date){targetPeriod=String(r.due_date).slice(0,7);reservedTotal=Number(r.reserve_due_cents||0);paid=Number(r.paid_due_cents||0);}
    else if(Number(r.recurring)){
      const currentCovered=Math.max(Number(r.reserve_current_cents||0),Number(r.paid_current_cents||0));
      if(target>0 && currentCovered>=target){targetPeriod=nextKey;reservedTotal=Number(r.reserve_next_cents||0);paid=Number(r.paid_next_cents||0);}
    }
    const availableReserved=Math.max(0,reservedTotal-paid); const covered=Math.max(reservedTotal,paid); const remaining=Math.max(0,target-covered);
    return {...r,target_period_key:targetPeriod,reserved_cents:availableReserved,reserved_total_cents:reservedTotal,paid_cents:paid,paid_current_cents:Number(r.paid_current_cents||0),remaining_cents:remaining,overdue:isObligationOverdue(r,targetPeriod,remaining,now)};
  });
}

async function listDebts(db){
  const key=periodKeyLocal(new Date());
  const {results}=await db.prepare(`SELECT d.id,d.name,d.creditor,d.scope,d.original_balance_cents,d.current_balance_cents,d.monthly_target_cents,d.installment_cents,d.due_day,d.flexible,d.priority,d.status,d.notes,d.debt_kind,
    COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.debt_id=d.id AND t.direction='expense' AND t.period_key=? AND t.status!='void'),0) paid_month_cents
    FROM debts d ORDER BY CASE d.status WHEN 'active' THEN 0 ELSE 1 END,CASE d.debt_kind WHEN 'old' THEN 0 ELSE 1 END,d.priority,d.name`).bind(key).all();
  return results;
}

async function listTransactions(db,limit,filters={}){
  const where=[]; const binds=[];
  if(filters.direction){where.push("t.direction=?");binds.push(filters.direction);}
  if(filters.nature){where.push("t.nature=?");binds.push(filters.nature);}
  if(filters.period_key){where.push("t.period_key=?");binds.push(filters.period_key);}
  if(filters.category_id){where.push("t.category_id=?");binds.push(toInteger(filters.category_id,"category_id"));}
  if(filters.account_id){
    const accountId=toInteger(filters.account_id,"account_id");
    where.push("(t.source_account_id=? OR t.destination_account_id=?)");
    binds.push(accountId,accountId);
  }
  if(filters.date_from){
    const dateFrom=optionalIsoDate(filters.date_from);
    where.push("date(datetime(t.occurred_at,'-4 hours'))>=date(?)");
    binds.push(dateFrom);
  }
  if(filters.date_to){
    const dateTo=optionalIsoDate(filters.date_to);
    where.push("date(datetime(t.occurred_at,'-4 hours'))<=date(?)");
    binds.push(dateTo);
  }
  if(filters.q){
    const rawQ=String(filters.q).trim().toLowerCase();
    const q=`%${rawQ}%`;
    const digits=rawQ.replace(/\D/g,"");
    const textParts=[
      "lower(COALESCE(t.description,'')) LIKE ?",
      "lower(COALESCE(t.notes,'')) LIKE ?",
      "lower(COALESCE(c.name,'')) LIKE ?",
      "lower(COALESCE(pc.name,'')) LIKE ?",
      "lower(COALESCE(d.name,'')) LIKE ?",
      "lower(COALESCE(s.name,'')) LIKE ?"
    ];
    binds.push(q,q,q,q,q,q);
    if(filters.search_scope!=="content"){
      textParts.push("lower(COALESCE(sa.name,'')) LIKE ?","lower(COALESCE(da.name,'')) LIKE ?");
      binds.push(q,q);
    }
    if(digits){textParts.push("CAST(t.amount_cents AS TEXT) LIKE ?");binds.push(`%${digits}%`);}
    where.push(`(${textParts.join(" OR ")})`);
  }
  if(filters.opening_history!==null&&filters.opening_history!==undefined&&filters.opening_history!==""){where.push("t.opening_history=?");binds.push(String(filters.opening_history)==="1"?1:0);}
  if(filters.today){const {start,end}=localDayUtcRange(new Date());where.push("t.occurred_at>=? AND t.occurred_at<?");binds.push(start,end);}
  const clause=where.length?`WHERE ${where.join(" AND ")}`:"";
  const sql=`SELECT t.id,t.occurred_at,t.period_key,t.direction,t.amount_cents,t.source_account_id,t.destination_account_id,t.nature,t.category_id,t.description,t.notes,t.payment_method,t.recurrence_type,t.status,t.opening_history,t.obligation_id,t.debt_id,t.supplier_id,t.purchase_id,
    sa.name source_account,da.name destination_account,c.name category_name,pc.name parent_category_name,s.name supplier_name,d.name debt_name
    FROM transactions t LEFT JOIN accounts sa ON sa.id=t.source_account_id LEFT JOIN accounts da ON da.id=t.destination_account_id LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN categories pc ON pc.id=c.parent_id LEFT JOIN suppliers s ON s.id=t.supplier_id LEFT JOIN debts d ON d.id=t.debt_id
    ${clause} ORDER BY t.occurred_at DESC,t.id DESC LIMIT ?`;
  const {results}=await db.prepare(sql).bind(...binds,limit).all();
  return results;
}

async function bulkReclassifyTransactions(db,body){
  const ids=Array.from(new Set((Array.isArray(body.ids)?body.ids:[]).map(Number).filter(id=>Number.isInteger(id)&&id>0)));
  if(!ids.length)throw new Error("selecione pelo menos um lançamento.");
  if(ids.length>200)throw new Error("selecione no máximo 200 lançamentos por vez.");

  const nature=String(body.nature||"");
  if(!["business_operating","inventory","business_debt","personal_withdrawal"].includes(nature))throw new Error("natureza inválida para reclassificação em lote.");
  const categoryId=await validCategoryForNature(db,body.category_id,nature);
  if(!categoryId)throw new Error("selecione uma categoria compatível.");

  let debtId=body.debt_id==null||body.debt_id===""?null:toInteger(body.debt_id,"debt_id");
  if(debtId){
    if(!["business_debt","personal_withdrawal"].includes(nature))throw new Error("uma dívida só pode ser vinculada a uma saída de dívida.");
    const debt=await db.prepare("SELECT id,scope,status FROM debts WHERE id=?").bind(debtId).first();
    if(!debt||debt.status==="paid")throw new Error("dívida selecionada não está disponível.");
    const expectedScope=nature==="personal_withdrawal"?"personal":"business";
    if(debt.scope!==expectedScope)throw new Error("a dívida selecionada não combina com a natureza escolhida.");
  }

  const replaceDescription=body.replace_description===true;
  const description=replaceDescription?String(body.description||"").trim():null;
  if(replaceDescription&&!description)throw new Error("informe a descrição que será aplicada aos selecionados.");

  const placeholders=ids.map(()=>"?").join(",");
  const rows=(await db.prepare(`SELECT * FROM transactions WHERE id IN (${placeholders}) ORDER BY id`).bind(...ids).all()).results||[];
  if(rows.length!==ids.length)throw new Error("um ou mais lançamentos não foram encontrados.");

  const debtDelta=new Map();
  const statements=[];
  for(const current of rows){
    if(current.status==="void")throw new Error(`o lançamento #${current.id} está cancelado e não pode ser reclassificado.`);
    if(current.direction!=="expense")throw new Error(`o lançamento #${current.id} não é uma saída. A seleção em lote desta versão corrige apenas saídas.`);
    if(current.purchase_id)throw new Error(`o lançamento #${current.id} pertence a uma compra por fornecedor e precisa ser tratado na própria compra.`);

    let obligationId=current.obligation_id;
    if(obligationId){
      const obligation=await db.prepare("SELECT nature FROM obligations WHERE id=?").bind(obligationId).first();
      if(!obligation||obligation.nature!==nature)obligationId=null;
    }

    const opening=Number(current.opening_history||0)===1;
    if(!opening&&current.debt_id)debtDelta.set(Number(current.debt_id),(debtDelta.get(Number(current.debt_id))||0)+Number(current.amount_cents));
    if(!opening&&debtId)debtDelta.set(Number(debtId),(debtDelta.get(Number(debtId))||0)-Number(current.amount_cents));

    const next={...current,nature,category_id:categoryId,debt_id:debtId,obligation_id:obligationId,description:replaceDescription?description:current.description};
    statements.push(db.prepare(`UPDATE transactions SET nature=?,category_id=?,debt_id=?,obligation_id=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(nature,categoryId,debtId,obligationId,next.description,current.id));
    statements.push(db.prepare("INSERT INTO transaction_revisions(transaction_id,action,before_json,after_json) VALUES(?,?,?,?)")
      .bind(current.id,"edit",JSON.stringify(current),JSON.stringify(next)));
  }

  for(const [id,delta] of debtDelta.entries()){
    if(!delta)continue;
    statements.push(db.prepare(`UPDATE debts SET
      current_balance_cents=CASE WHEN current_balance_cents IS NULL THEN NULL ELSE MAX(0,current_balance_cents+?) END,
      status=CASE WHEN current_balance_cents IS NULL THEN status WHEN MAX(0,current_balance_cents+?)<=0 THEN 'paid' ELSE 'active' END,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(delta,delta,id));
  }

  await db.batch(statements);
  return {ok:true,updated:rows.length,ids};
}

async function bulkCorrectTransactionAccount(db,body){
  const ids=Array.from(new Set((Array.isArray(body.ids)?body.ids:[]).map(Number).filter(id=>Number.isInteger(id)&&id>0)));
  if(!ids.length)throw new Error("selecione pelo menos um lançamento.");
  if(ids.length>200)throw new Error("selecione no máximo 200 lançamentos por vez.");
  const accountId=toInteger(body.account_id,"account_id");
  const account=await db.prepare("SELECT id,name,owner_scope FROM accounts WHERE id=?").bind(accountId).first();
  if(!account||account.owner_scope!=="business")throw new Error("selecione uma conta empresarial válida.");

  const placeholders=ids.map(()=>"?").join(",");
  const rows=(await db.prepare(`SELECT * FROM transactions WHERE id IN (${placeholders}) ORDER BY id`).bind(...ids).all()).results||[];
  if(rows.length!==ids.length)throw new Error("um ou mais lançamentos não foram encontrados.");

  const statements=[];
  let updated=0;
  for(const current of rows){
    if(current.status==="void")throw new Error(`o lançamento #${current.id} está cancelado.`);
    if(Number(current.opening_history||0)===1)throw new Error(`o lançamento #${current.id} é histórico anterior e não altera saldo atual.`);
    if(current.direction!=="expense")throw new Error(`o lançamento #${current.id} não é uma saída.`);
    if(current.purchase_id)throw new Error(`o lançamento #${current.id} pertence a uma compra por fornecedor e deve ser corrigido pela compra.`);
    if(Number(current.source_account_id||0)===Number(accountId))continue;
    const next={...current,source_account_id:accountId,destination_account_id:null};
    statements.push(db.prepare("UPDATE transactions SET source_account_id=?,destination_account_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(accountId,current.id));
    statements.push(db.prepare("INSERT INTO transaction_revisions(transaction_id,action,before_json,after_json) VALUES(?,?,?,?)")
      .bind(current.id,"edit",JSON.stringify(current),JSON.stringify(next)));
    updated++;
  }
  if(statements.length)await db.batch(statements);
  return {ok:true,updated,ids,account_id:accountId,account_name:account.name};
}

async function listSuppliers(db){
  return (await db.prepare(`SELECT s.id,s.name,s.notes,s.active,
    COALESCE((SELECT SUM(p.total_cents) FROM purchases p WHERE p.supplier_id=s.id AND substr(p.purchase_date,1,7)=?),0) month_total_cents
    FROM suppliers s WHERE s.active=1 ORDER BY s.name`).bind(periodKeyLocal(new Date())).all()).results;
}

async function listPurchases(db,limit=100){
  return (await db.prepare(`SELECT p.id,p.purchase_date,p.total_cents,p.paid_now_cents,p.payable_cents,p.due_date,p.status,p.payment_method,p.notes,p.nature,p.category_id,s.name supplier_name,a.name source_account,c.name category_name,
    COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.obligation_id=p.obligation_id AND t.direction='expense' AND t.status!='void'),0) later_paid_cents
    FROM purchases p JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN accounts a ON a.id=p.source_account_id LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.purchase_date DESC,p.id DESC LIMIT ?`).bind(limit).all()).results;
}

async function createPurchase(db,body){
  const total=toPositiveInteger(body.total_cents,"total_cents"); const paidNow=toNonNegativeInteger(body.paid_now_cents??total,"paid_now_cents"); if(paidNow>total)throw new Error("Valor pago agora não pode ser maior que o total da compra.");
  const nature=body.nature==="business_operating"?"business_operating":"inventory";
  let categoryId=body.category_id==null?null:toInteger(body.category_id,"category_id"); categoryId=await validCategoryForNature(db,categoryId,nature);
  const payable=total-paidNow; const supplierId=await ensureSupplier(db,body); const supplier=await db.prepare("SELECT name FROM suppliers WHERE id=?").bind(supplierId).first();
  const source=paidNow>0?toInteger(body.source_account_id,"source_account_id"):null; const method=paidNow>0?normalizePaymentMethod(body.payment_method):null;
  const dueDate=payable>0&&body.due_date?optionalIsoDate(body.due_date):null;
  const purchaseDate=body.purchase_date?new Date(body.purchase_date).toISOString():new Date().toISOString();
  const p=await db.prepare(`INSERT INTO purchases(supplier_id,purchase_date,total_cents,paid_now_cents,payable_cents,source_account_id,payment_method,due_date,status,notes,nature,category_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(supplierId,purchaseDate,total,paidNow,payable,source,method,dueDate,payable>0?(paidNow>0?"partial":"open"):"paid",nullable(body.notes),nature,categoryId).run();
  const purchaseId=p.meta.last_row_id; let transactionId=null,obligationId=null;
  try{
    if(paidNow>0){
      const tr=await db.prepare(`INSERT INTO transactions(occurred_at,period_key,direction,amount_cents,source_account_id,nature,category_id,description,notes,payment_method,recurrence_type,status,supplier_id,purchase_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(purchaseDate,periodKeyFromIso(purchaseDate),"expense",paidNow,source,nature,categoryId,`Compra - ${supplier?.name||"Fornecedor"}`,nullable(body.notes),method,"eventual","posted",supplierId,purchaseId).run();
      transactionId=tr.meta.last_row_id;
    }
    if(payable>0){
      const dueDay=dueDate?Number(String(dueDate).slice(8,10)):null;
      const countsInDailyTarget=dueDate?1:0;
      const obligationNote=dueDate
        ? `Gerado pela compra #${purchaseId}.`
        : `Gerado pela compra #${purchaseId}. Vencimento ainda não informado; não entra na proteção diária até ser definido.`;
      const o=await db.prepare(`INSERT INTO obligations(name,scope,nature,category_id,monthly_target_cents,due_day,due_date,recurring,flexible,priority,counts_in_daily_target,personal_ceiling_member,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(`Compra a pagar - ${supplier?.name||"Fornecedor"}`,"business",nature,categoryId,payable,dueDay,dueDate,0,0,2,countsInDailyTarget,0,obligationNote).run();
      obligationId=o.meta.last_row_id;
    }
    await db.prepare("UPDATE purchases SET transaction_id=?,obligation_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(transactionId,obligationId,purchaseId).run();
    return {ok:true,id:purchaseId,transaction_id:transactionId,obligation_id:obligationId,payable_cents:payable};
  }catch(error){
    // Compensação: não deixa compra parcial/órfã caso uma etapa posterior falhe.
    if(transactionId){
      await db.prepare("DELETE FROM transactions WHERE id=? AND purchase_id=?").bind(transactionId,purchaseId).run().catch(()=>{});
    }
    if(obligationId){
      await db.prepare("DELETE FROM obligations WHERE id=?").bind(obligationId).run().catch(()=>{});
    }
    await db.prepare("DELETE FROM purchases WHERE id=?").bind(purchaseId).run().catch(()=>{});
    throw error;
  }
}

async function ensureSupplier(db,body){
  if(body.supplier_id!=null)return toInteger(body.supplier_id,"supplier_id");
  const name=String(body.supplier_name||"").trim(); if(!name)throw new Error("Informe o fornecedor.");
  const existing=await db.prepare("SELECT id FROM suppliers WHERE lower(name)=lower(?) LIMIT 1").bind(name).first(); if(existing)return existing.id;
  const r=await db.prepare("INSERT INTO suppliers(name) VALUES(?)").bind(name).run(); return r.meta.last_row_id;
}

async function createDebtObligation(db,debtId,name,scope,target,dueDay,priority){
  const nature=scope==="personal"?"personal_withdrawal":"business_debt"; const categoryName=scope==="personal"?"Acordos pessoais":"Empréstimos e acordos";
  const c=await db.prepare("SELECT id FROM categories WHERE name=? AND nature=? LIMIT 1").bind(categoryName,nature).first();
  await db.prepare(`INSERT INTO obligations(name,scope,nature,category_id,debt_id,monthly_target_cents,due_day,recurring,flexible,priority,counts_in_daily_target,personal_ceiling_member,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(`Pagamento ${name}`,scope,nature,c?.id||null,debtId,target,dueDay,1,0,priority,1,0,"Criado automaticamente para parcela corrente.").run();
}

async function reduceDebt(db,debtId,amount){
  await db.prepare(`UPDATE debts SET current_balance_cents=CASE WHEN current_balance_cents IS NULL THEN NULL ELSE MAX(0,current_balance_cents-?) END,
    status=CASE WHEN current_balance_cents IS NOT NULL AND current_balance_cents-?<=0 THEN 'paid' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(amount,amount,debtId).run();
}

async function restoreDebt(db,debtId,amount){
  await db.prepare(`UPDATE debts SET current_balance_cents=CASE WHEN current_balance_cents IS NULL THEN NULL ELSE current_balance_cents+? END,
    status=CASE WHEN current_balance_cents IS NULL THEN status ELSE 'active' END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(amount,debtId).run();
}

async function validCategoryForNature(db,categoryId,nature){
  let id=categoryId==null?null:Number(categoryId);
  if(id){
    const cat=await db.prepare("SELECT id,nature FROM categories WHERE id=? AND active=1").bind(id).first();
    if(!cat || cat.nature!==nature)throw new Error("Categoria incompatível com a natureza escolhida.");
    return id;
  }
  if(nature==="unidentified")return null;
  const c=await db.prepare("SELECT id FROM categories WHERE nature=? AND active=1 ORDER BY id LIMIT 1").bind(nature).first();
  return c?.id||null;
}

async function validateObligationPayment(db,obligationId,nature,periodKey,amount,excludeTransactionId=null){
  if(!obligationId)return;
  const o=await db.prepare("SELECT * FROM obligations WHERE id=? AND active=1").bind(obligationId).first();
  if(!o)throw new Error("Conta/compromisso não encontrado.");
  if(o.nature!==nature)throw new Error("A conta selecionada não combina com a natureza do lançamento.");
  const row=await db.prepare("SELECT COALESCE(SUM(amount_cents),0) total FROM transactions WHERE obligation_id=? AND period_key=? AND direction='expense' AND status!='void' AND id!=?")
    .bind(obligationId,periodKey,excludeTransactionId||-1).first();
  const remaining=Math.max(0,Number(o.monthly_target_cents||0)-Number(row?.total||0));
  if(Number(amount)>remaining)throw new Error(`O valor supera o que falta pagar desta conta (${formatCents(remaining)}).`);
}

async function logTransactionRevision(db,transactionId,action,beforeJson,afterJson){
  await db.prepare("INSERT INTO transaction_revisions(transaction_id,action,before_json,after_json) VALUES(?,?,?,?)")
    .bind(transactionId,action,beforeJson,afterJson||null).run();
}

async function syncPurchaseFromTransaction(db,purchaseId,obligationId){
  let p=null; if(purchaseId)p=await db.prepare("SELECT * FROM purchases WHERE id=?").bind(purchaseId).first();
  if(!p&&obligationId)p=await db.prepare("SELECT * FROM purchases WHERE obligation_id=? ORDER BY id DESC LIMIT 1").bind(obligationId).first(); if(!p)return;
  const later=Number((await db.prepare("SELECT COALESCE(SUM(amount_cents),0) total FROM transactions WHERE obligation_id=? AND direction='expense' AND status!='void'").bind(p.obligation_id||-1).first())?.total||0);
  const remaining=Math.max(0,Number(p.payable_cents||0)-later); const status=remaining<=0?"paid":(Number(p.paid_now_cents||0)+later>0?"partial":"open");
  await db.prepare("UPDATE purchases SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status,p.id).run();
}

function calculateDailyProtection(obligations,now){
  const groups={business_cents:0,debt_cents:0,inventory_cents:0,flexible_cents:0,total_cents:0}; const items=[];
  for(const o of obligations){
    const remaining=Math.max(0,Number(o.remaining_cents||0)); if(!remaining)continue;
    let due=null;
    if(o.due_date)due=parseLocalDate(o.due_date);
    else if(o.due_day)due=dueDateForPeriod(o.target_period_key,Number(o.due_day));
    else due=endOfPeriodDate(o.target_period_key);
    let days=Math.max(1,countWorkingDaysInclusive(now,due));
    const daily=Math.ceil(remaining/days); const item={id:o.id,name:o.name,remaining_cents:remaining,daily_cents:daily,days_remaining:days,nature:o.nature,flexible:Boolean(o.flexible),priority:o.priority,overdue:Boolean(o.overdue),due_date:o.due_date||null,due_day:o.due_day||null,target_period_key:o.target_period_key||null,effective_due_date:due.toISOString().slice(0,10)}; items.push(item);
    if(o.flexible)groups.flexible_cents+=daily;
    if(o.nature==="business_operating")groups.business_cents+=daily; else if(o.nature==="business_debt")groups.debt_cents+=daily; else if(o.nature==="inventory")groups.inventory_cents+=daily;
    groups.total_cents+=daily;
  }
  return {...groups,items};
}

function isObligationOverdue(o,targetPeriod,remaining,now){
  if(remaining<=0)return false; const today=localPseudoDate(now);
  if(o.due_date)return parseLocalDate(o.due_date)<today;
  if(o.due_day){const due=dueDateForPeriod(targetPeriod,Number(o.due_day));return due<today;}
  return false;
}

function targetPeriodForRawObligation(o,date){if(!Number(o.recurring)&&o.due_date)return String(o.due_date).slice(0,7);return periodKeyLocal(date);}
function dueDateForPeriod(periodKey,dueDay){const [y,m]=periodKey.split("-").map(Number);const last=new Date(Date.UTC(y,m,0)).getUTCDate();return new Date(Date.UTC(y,m-1,Math.min(dueDay,last)));}
function endOfPeriodDate(periodKey){const [y,m]=periodKey.split("-").map(Number);return new Date(Date.UTC(y,m,0));}
function parseLocalDate(value){const [y,m,d]=String(value).slice(0,10).split("-").map(Number);return new Date(Date.UTC(y,m-1,d));}
function localPseudoDate(date){const p=localDateParts(date);return new Date(Date.UTC(p.year,p.month-1,p.day));}
function countWorkingDaysInclusive(startInstant,duePseudoDate){const s=localPseudoDate(startInstant),e=new Date(duePseudoDate);if(e<s)return 1;let count=0;for(let d=new Date(s);d<=e;d.setUTCDate(d.getUTCDate()+1)){if(d.getUTCDay()!==0)count++;}return Math.max(1,count);}

function validateTransaction(body){
  const direction=String(body.direction||""); if(!["income","expense","transfer"].includes(direction))throw new Error("Tipo de lançamento inválido.");
  const nature=String(body.nature||""); if(!ALLOWED_NATURES.includes(nature))throw new Error("Natureza inválida.");
  const amount=toPositiveInteger(body.amount_cents,"amount_cents"); const description=String(body.description||"").trim(); if(!description)throw new Error("Descrição obrigatória.");
  const source=body.source_account_id==null?null:toInteger(body.source_account_id,"source_account_id"); const destination=body.destination_account_id==null?null:toInteger(body.destination_account_id,"destination_account_id");
  if(direction==="expense"&&!source)throw new Error("Informe de onde saiu o dinheiro."); if(direction==="income"&&!destination)throw new Error("Informe onde o dinheiro entrou."); if(direction==="transfer"&&(!source||!destination||source===destination))throw new Error("Transferência exige origem e destino diferentes.");
  const occurredAt=body.occurred_at?new Date(body.occurred_at).toISOString():new Date().toISOString();
  return {occurred_at:occurredAt,period_key:periodKeyFromIso(occurredAt),direction,amount_cents:amount,source_account_id:source,destination_account_id:destination,nature,category_id:body.category_id==null?null:toInteger(body.category_id,"category_id"),obligation_id:body.obligation_id==null?null:toInteger(body.obligation_id,"obligation_id"),debt_id:body.debt_id==null?null:toInteger(body.debt_id,"debt_id"),supplier_id:body.supplier_id==null?null:toInteger(body.supplier_id,"supplier_id"),purchase_id:body.purchase_id==null?null:toInteger(body.purchase_id,"purchase_id"),description,notes:nullable(body.notes),payment_method:normalizePaymentMethod(body.payment_method),recurrence_type:body.recurrence_type==="recurring"?"recurring":"eventual"};
}


async function handleInternalFinanceCommand(request,env){
  if(!env.FINANCE_BOT_SECRET)return json({error:"FINANCE_BOT_SECRET não configurado."},503);
  const provided=String(request.headers.get("X-Finance-Bot-Secret")||"");
  if(!safeEqual(provided,String(env.FINANCE_BOT_SECRET)))return json({error:"Não autorizado."},401);
  const body=await readJson(request);const from=digitsOnly(body.from||"");const allowed=String(env.WHATSAPP_ALLOWED_NUMBER||"").split(",").map(digitsOnly).filter(Boolean);
  if(!from||!allowed.includes(from))return json({error:"Número não autorizado."},403);
  const text=String(body.text||"").trim();if(!text)return json({error:"Comando vazio."},400);
  try{const result=await executeWhatsAppCommand(env.DB,text);return json({ok:true,reply:result?.reply||"Comando processado."});}
  catch(err){return json({ok:false,reply:`Não consegui registrar: ${err.message}`,error:String(err.message||err)},400);}
}

function verifyWhatsAppWebhook(url,env){
  const mode=url.searchParams.get("hub.mode"),token=url.searchParams.get("hub.verify_token"),challenge=url.searchParams.get("hub.challenge");
  if(mode==="subscribe"&&env.WHATSAPP_VERIFY_TOKEN&&safeEqual(String(token||""),String(env.WHATSAPP_VERIFY_TOKEN)))return new Response(String(challenge||""),{status:200,headers:{"Content-Type":"text/plain"}});
  return new Response("Forbidden",{status:403});
}

async function handleWhatsAppWebhook(request,env){
  const raw=await request.text();
  if(env.WHATSAPP_APP_SECRET){const sig=request.headers.get("X-Hub-Signature-256")||"";if(!(await verifyMetaSignature(raw,sig,env.WHATSAPP_APP_SECRET)))return new Response("Invalid signature",{status:401});}
  let payload;try{payload=JSON.parse(raw);}catch{return new Response("Bad payload",{status:400});}
  const messages=[];for(const entry of payload.entry||[])for(const change of entry.changes||[]){const value=change.value||{};for(const m of value.messages||[])messages.push(m);}
  for(const m of messages){if(m.type!=="text"||!m.text?.body)continue;await processWhatsAppText(env,m).catch(()=>{});}
  return new Response("EVENT_RECEIVED",{status:200});
}

async function processWhatsAppText(env,m){
  const from=digitsOnly(m.from||""); const allowed=String(env.WHATSAPP_ALLOWED_NUMBER||"").split(",").map(digitsOnly).filter(Boolean);
  const ins=await env.DB.prepare("INSERT OR IGNORE INTO whatsapp_messages(message_id,wa_from,message_type,text_body) VALUES(?,?,?,?)").bind(String(m.id||crypto.randomUUID()),from,m.type,String(m.text.body||"")).run();
  if(!ins.meta.changes)return;
  if(!allowed.length||!allowed.includes(from)){await env.DB.prepare("UPDATE whatsapp_messages SET processed=1,result_json=? WHERE message_id=?").bind(JSON.stringify({ignored:"unauthorized"}),m.id).run();return;}
  const text=String(m.text.body||"").trim();let result;
  try{result=await executeWhatsAppCommand(env.DB,text);}
  catch(err){result={reply:`Não consegui registrar: ${err.message}\n\nExemplos:\n• gasto 45 marmita dinheiro\n• gasto 120 mercado pessoal mercado pago pix\n• paguei 500 chico nubank pix\n• entrou 850 vendas mercado pago\n• 05/07 gasto 80 combustível pessoal dinheiro\n• saldo\n• resumo julho`};}
  await env.DB.prepare("UPDATE whatsapp_messages SET processed=1,result_json=? WHERE message_id=?").bind(JSON.stringify(result),m.id).run();
  if(result?.reply)await sendWhatsAppText(env,from,result.reply);
}

async function executeWhatsAppCommand(db,input){
  const raw=input.trim(),norm=normalizeText(raw);

  if(norm==="ajuda"||norm==="help")return {reply:[
    "Pantaneira Financeiro pelo WhatsApp:",
    "• gasto 45 marmita dinheiro",
    "• entrou 500 vendas mercado pago pix",
    "• recebi 780 boleto antigo mercado pago",
    "• compra 850 Super Compras mercado pago pix",
    "• compra 1200 J.C. Dal Magro a prazo",
    "• compra 1200 J.C. Dal Magro a prazo vence 20/08",
    "• transfere 27 mercado pago para nubank pix",
    "• paguei 500 chico nubank pix",
    "• saldo",
    "• resumo agosto",
    "",
    "Compra à vista registra fornecedor e reduz a conta.",
    "Compra a prazo cria conta a pagar e não reduz saldo agora."
  ].join("\n")};

  if(norm==="saldo"||norm.startsWith("saldo ")){
    const d=await buildDashboard(db);
    const acc=d.accounts.filter(a=>a.owner_scope==="business").map(a=>`${a.name}: ${formatCents(a.balance_cents)}${Number(a.available_for_spending)===0?" (a compensar)":""}`).join("\n");
    return {reply:`SALDOS\n${acc}\n\nSaldo livre do mês: ${formatCents(d.balances.free_strict_cents)}\nA cobrir no mês: ${formatCents(d.balances.committed_strict_cents)}\nPróximos compromissos: ${formatCents(d.balances.future_committed_strict_cents||0)}\nReserva futura sugerida: ${formatCents(d.daily_protection.total_cents||0)}/dia`};
  }

  if(norm.startsWith("resumo")){
    const key=parseRequestedPeriod(norm),d=await buildMonthSummary(db,key);
    return {reply:`RESUMO ${periodLabel(key)}\nEntradas totais: ${formatCents(d.month.income_cents)}\nVendas atuais: ${formatCents(d.month.sales_cents)}\nRecebimentos de vendas anteriores: ${formatCents(d.month.old_receipts_cents)}\nSaídas: ${formatCents(d.month.expense_cents)}\nEntrou - saiu: ${formatCents(d.month.net_cents)}\nPessoal: ${formatCents(d.month.personal_withdrawal_cents)}\nDívidas: ${formatCents(d.month.debt_paid_cents)}\nCompras/estoque: ${formatCents(d.month.inventory_spent_cents)}`};
  }

  let text=raw,date=null;
  const dm=text.match(/^\s*(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\s+/);
  if(dm){
    let y=dm[3]?Number(dm[3]):2026;if(y<100)y+=2000;
    date=`${y}-${String(Number(dm[2])).padStart(2,"0")}-${String(Number(dm[1])).padStart(2,"0")}`;
    optionalIsoDate(date);
    text=text.slice(dm[0].length);
  }

  const n=normalizeText(text);

  if(/^(compra|comprei)\b/.test(n)){
    if(date)throw new Error("compra de estoque pelo WhatsApp usa a data atual; para histórico, registre pelo app.");
    return executeWhatsAppPurchaseCommand(db,text);
  }

  if(/^(transfere|transferir|transferencia)\b/.test(n)){
    if(date)throw new Error("transferência pelo WhatsApp usa a data atual; para histórico, registre pelo app.");
    return executeWhatsAppTransferCommand(db,text);
  }

  const direction=n.match(/^(entrou|recebi|vendi|venda)\b/)?"income":(n.match(/^(gasto|gastei|paguei|saida|saiu)\b/)?"expense":null);
  if(!direction)throw new Error("comece com GASTO/PAGUEI, ENTROU/RECEBI ou COMPRA.");

  const amountInfo=extractWhatsAppMoney(text);
  if(!amountInfo)throw new Error("não encontrei o valor.");
  const amount=amountInfo.cents;

  const accounts=await listAccountsWithBalances(db);
  const account=findAccountAlias(accounts,n);
  const categories=(await db.prepare("SELECT id,name,nature,parent_id,active FROM categories WHERE active=1").all()).results;

  let cat=null;
  const corporateAgreementAlias=direction==="expense"&&isCorporateAgreementAlias(n);
  const oldReceipt=direction==="income"&&isOldSaleReceiptCommand(n);
  if(corporateAgreementAlias){
    cat=categories.find(c=>c.nature==="business_debt"&&normalizeText(c.name)==="aquisicao de participacao societaria");
    if(!cat)throw new Error("categoria empresarial do acordo societário ainda não está disponível. Aguarde a migration da v1.7.7.");
  }else if(oldReceipt){
    cat=categories.find(c=>c.nature==="income"&&normalizeText(c.name)==="recebimento de vendas anteriores");
    if(!cat)throw new Error("categoria 'Recebimento de vendas anteriores' não encontrada. Aguarde a migration da versão 1.7.0.");
  }else{
    cat=await findWhatsAppCategory(db,categories,n,direction,accounts);
  }
  if(!cat)throw new Error("categoria não reconhecida. Use o nome da categoria ou subcategoria cadastrada no app.");

  let nature=direction==="income"?"income":cat.nature;
  let debtId=null,obligationId=null;

  if(direction==="expense"){
    const debts=await listDebts(db);
    if(corporateAgreementAlias){
      const agreement=debts.find(d=>d.scope==="business"&&normalizeText(d.name)==="acordo societario");
      if(!agreement)throw new Error("dívida empresarial 'Acordo societário' ainda não está disponível. Aguarde a migration da v1.7.7.");
      debtId=Number(agreement.id);
      nature="business_debt";
      obligationId=null;
    }else{
      const debt=debts.find(d=>normalizeText(n).includes(normalizeText(d.name))||normalizeText(n).includes(normalizeText(d.creditor||""))||(normalizeText(d.name).includes("chico")&&n.includes("chico")));
      if(debt){
        debtId=Number(debt.id);
        nature=debt.scope==="personal"?"personal_withdrawal":"business_debt";
        const debtCat=categories.find(c=>c.nature===nature);
        if(debtCat)cat.id=debtCat.id;
      }
      const obs=(await db.prepare("SELECT id,name,nature,active FROM obligations WHERE active=1").all()).results.find(o=>n.includes(normalizeText(o.name)));
      if(obs&&obs.nature===nature)obligationId=Number(obs.id);
    }
  }

  const historicalEnd=(await getSetting(db,"historical_entry_end_date"))||"2026-08-10";
  const historicalStart=(await getSetting(db,"historical_entry_start_date"))||"2026-07-01";
  const historical=Boolean(date&&date>=historicalStart&&date<=historicalEnd);
  if(date&&date>localIsoDate(new Date()))throw new Error("não é permitido lançar uma data futura pelo WhatsApp.");
  if(!historical&&!account)throw new Error("informe a conta: mercado pago, nubank ou dinheiro.");

  const occurredAt=`${date||localIsoDate(new Date())}T16:00:00.000Z`;
  const periodKey=periodKeyFromIso(occurredAt);
  const description=corporateAgreementAlias
    ? "Pagamento de acordo societário"
    : (oldReceipt ? buildOldReceiptDescription(text,amountInfo.match,accounts) : buildWhatsappDescription(text,amountInfo.match));

  const method=n.includes("pix")?"pix":n.includes("dinheiro")?"cash":n.includes("debito")?"debit":n.includes("credito")?"credit":n.includes("boleto")?"boleto":n.includes("transfer")?"transfer":"other";
  const source=direction==="expense"?(account?.id||null):null;
  const destination=direction==="income"?(account?.id||null):null;

  const r=await db.prepare(`INSERT INTO transactions(occurred_at,period_key,direction,amount_cents,source_account_id,destination_account_id,nature,category_id,obligation_id,debt_id,description,notes,payment_method,recurrence_type,status,opening_history) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(occurredAt,periodKey,direction,amount,source,destination,nature,cat.id,obligationId,debtId,description,corporateAgreementAlias?"Pagamento de acordo societário lançado pelo WhatsApp":(oldReceipt?"Recebimento de venda anterior lançado pelo WhatsApp":"Lançado pelo WhatsApp"),method,"eventual","posted",historical?1:0).run();

  if(debtId&&direction==="expense"&&!historical)await reduceDebt(db,debtId,amount);

  const parentCategory=cat.parent_id?categories.find(c=>Number(c.id)===Number(cat.parent_id)):null;
  const categoryLabel=parentCategory?`${parentCategory.name} → ${cat.name}`:cat.name;
  const prefix=historical?"Histórico registrado sem alterar o saldo atual":"Registrado";

  return {reply:`${prefix}: ${direction==="income"?"entrada":"saída"} de ${formatCents(amount)}\nCategoria: ${categoryLabel}\n${account?`${direction==="income"?"Entrou em":"Saiu de"}: ${account.name}\n`:""}${date?`Data: ${date.split('-').reverse().join('/')}\n`:""}ID #${r.meta.last_row_id}`};
}

function isCorporateAgreementAlias(n){
  const text=normalizeText(n);
  return /\belaine\b/.test(text)||/\bacordo societario\b/.test(text)||/\baquisicao societaria\b/.test(text)||/\bacordo empresa\b/.test(text);
}

function isOldSaleReceiptCommand(n){
  return /\b(boleto antigo|venda antiga|vendas antigas|recebimento antigo|recebimento de venda anterior|venda anterior)\b/.test(normalizeText(n));
}

function extractWhatsAppDueDate(text){
  const normalized=String(text||"");
  const m=normalized.match(/\b(?:vence|vencimento|vcto)\s*(?:em\s*)?(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/i);
  if(!m)return null;
  let y=m[3]?Number(m[3]):localDateParts(new Date()).year;
  if(y<100)y+=2000;
  const iso=`${y}-${String(Number(m[2])).padStart(2,"0")}-${String(Number(m[1])).padStart(2,"0")}`;
  return optionalIsoDate(iso);
}

function stripPurchaseControlPhrases(value,accounts=[]){
  let out=String(value||"");
  out=out.replace(/^(compra|comprei)\s*/i,"");
  out=out.replace(/(?:R\$\s*)?\d+(?:[.,]\d+)*/i," ");
  out=out.replace(/\b(?:vence|vencimento|vcto)\s*(?:em\s*)?\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/ig," ");
  out=out.replace(/\b(?:a|à)\s+prazo\b/ig," ");
  out=out.replace(/\b(?:a|à)\s+vista\b/ig," ");
  out=out.replace(/\b(?:pix|debito|débito|credito|crédito|boleto|transferencia|transferência|transfer)\b/ig," ");

  const accountNames=(accounts||[]).map(a=>String(a.name||"")).filter(Boolean).sort((a,b)=>b.length-a.length);
  for(const name of accountNames){
    out=out.replace(new RegExp(escapeWhatsappRegex(name),"ig")," ");
  }
  out=out.replace(/\bmercado\s+pago\b/ig," ");
  out=out.replace(/\bnubank\b/ig," ");
  out=out.replace(/\bdinheiro(?:\s+fisico|\s+físico)?\b/ig," ");
  out=out.replace(/\bcaixa\b/ig," ");
  out=out.replace(/^\s*fornecedor\s*[:\-]?\s*/i," ");
  return out.replace(/\s+/g," ").trim();
}

async function recoverRecentOrphanWhatsAppPurchase(db,{supplierName,total,account,method,inventoryCategory}){
  const orphan=await db.prepare(`
    SELECT p.id,p.purchase_date,p.supplier_id,p.payment_method,s.name supplier_name
    FROM purchases p
    JOIN suppliers s ON s.id=p.supplier_id
    WHERE lower(s.name)=lower(?)
      AND p.total_cents=?
      AND p.paid_now_cents=?
      AND p.payable_cents=0
      AND p.source_account_id=?
      AND p.transaction_id IS NULL
      AND p.obligation_id IS NULL
      AND p.notes='Compra lançada pelo WhatsApp'
      AND datetime(p.created_at)>=datetime('now','-6 hours')
    ORDER BY p.id DESC
    LIMIT 1
  `).bind(supplierName,total,total,account.id).first();

  if(!orphan)return null;

  const tr=await db.prepare(`INSERT INTO transactions(occurred_at,period_key,direction,amount_cents,source_account_id,nature,category_id,description,notes,payment_method,recurrence_type,status,supplier_id,purchase_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      orphan.purchase_date,
      periodKeyFromIso(orphan.purchase_date),
      "expense",
      total,
      account.id,
      "inventory",
      inventoryCategory.id,
      `Compra - ${orphan.supplier_name||supplierName}`,
      "Compra lançada pelo WhatsApp · recuperação automática v1.7.7",
      orphan.payment_method||method,
      "eventual",
      "posted",
      orphan.supplier_id,
      orphan.id
    ).run();

  const transactionId=tr.meta.last_row_id;
  await db.prepare("UPDATE purchases SET transaction_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(transactionId,orphan.id).run();

  return {ok:true,id:orphan.id,transaction_id:transactionId,obligation_id:null,payable_cents:0,recovered:true};
}

async function executeWhatsAppPurchaseCommand(db,text){
  const n=normalizeText(text);
  const amountInfo=extractWhatsAppMoney(text);
  if(!amountInfo)throw new Error("não encontrei o valor da compra.");
  const total=amountInfo.cents;

  const accounts=await listAccountsWithBalances(db);
  const account=findAccountAlias(accounts,n);
  const onCredit=/\b(a prazo|prazo)\b/.test(n);
  const dueDate=extractWhatsAppDueDate(text);
  const supplierName=stripPurchaseControlPhrases(text,accounts);
  if(!supplierName)throw new Error("informe o fornecedor. Ex.: compra 850 Super Compras mercado pago pix.");

  if(onCredit&&account)throw new Error("para compra parcialmente paga, use a tela de Compra por fornecedor no app.");
  if(!onCredit&&!account)throw new Error("compra à vista precisa da conta: mercado pago, nubank ou dinheiro.");

  const categories=(await db.prepare("SELECT id,name,nature,parent_id,active FROM categories WHERE active=1").all()).results;
  const inventoryCategory=
    categories.find(c=>c.nature==="inventory"&&normalizeText(c.name)==="compras e estoque")
    ||categories.find(c=>c.nature==="inventory"&&normalizeText(c.name)==="mercadoria para revenda")
    ||categories.find(c=>c.nature==="inventory");
  if(!inventoryCategory)throw new Error("nenhuma categoria de estoque está cadastrada.");

  const method=n.includes("pix")?"pix":n.includes("dinheiro")?"cash":n.includes("debito")?"debit":n.includes("credito")?"credit":n.includes("boleto")?"boleto":n.includes("transfer")?"transfer":"other";

  let result=null;
  if(!onCredit){
    result=await recoverRecentOrphanWhatsAppPurchase(db,{supplierName,total,account,method,inventoryCategory});
  }
  if(!result){
    result=await createPurchase(db,{
      total_cents:total,
      paid_now_cents:onCredit?0:total,
      supplier_name:supplierName,
      source_account_id:onCredit?null:account.id,
      payment_method:onCredit?null:method,
      due_date:onCredit?dueDate:null,
      purchase_date:new Date().toISOString(),
      nature:"inventory",
      category_id:inventoryCategory.id,
      notes:"Compra lançada pelo WhatsApp"
    });
  }

  if(onCredit){
    return {reply:[
      `Compra registrada: ${formatCents(total)}`,
      `Fornecedor: ${supplierName}`,
      `Categoria: ${inventoryCategory.name}`,
      "Pagamento: a prazo",
      dueDate?`Vencimento: ${dueDate.split("-").reverse().join("/")}`:"Vencimento: não informado",
      "Saldo bancário: não alterado",
      `Compra #${result.id} · Conta a pagar #${result.obligation_id}`,
      !dueDate?"Atenção: informe o vencimento no app para entrar na proteção diária.":null
    ].filter(Boolean).join("\n")};
  }

  return {reply:[
    `Compra registrada: ${formatCents(total)}`,
    `Fornecedor: ${supplierName}`,
    `Categoria: ${inventoryCategory.name}`,
    `Saiu de: ${account.name}`,
    `Compra #${result.id} · Lançamento #${result.transaction_id}`,
    result.recovered?"Tentativa anterior recuperada; nenhuma compra duplicada foi criada.":null
  ].filter(Boolean).join("\n")};
}

function buildOldReceiptDescription(text,amountText,accounts=[]){
  let s=String(text||"").replace(amountText,"").replace(/^(recebi|entrou|vendi|venda)\s*/i," ");
  s=s.replace(/\b(?:boleto antigo|venda antiga|vendas antigas|recebimento antigo|recebimento de venda anterior|venda anterior)\b/ig," ");
  s=s.replace(/\b(?:pix|debito|débito|credito|crédito|boleto|transferencia|transferência|transfer)\b/ig," ");
  for(const a of accounts||[])s=s.replace(new RegExp(escapeWhatsappRegex(a.name),"ig")," ");
  s=s.replace(/\bmercado\s+pago\b/ig," ").replace(/\bnubank\b/ig," ").replace(/\bdinheiro(?:\s+fisico|\s+físico)?\b/ig," ");
  s=s.replace(/\s+/g," ").trim();
  return s?`Recebimento de venda anterior - ${s}`:"Recebimento de venda anterior";
}

function whatsappMatchText(value){
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function whatsappComparableToken(value){
  let token=String(value||"").trim();
  if(token.length>4&&token.endsWith("s"))token=token.slice(0,-1);
  return token;
}

function whatsappTokens(value){
  const stop=new Set(["de","da","do","das","dos","e","em","para","por","com"]);
  return whatsappMatchText(value)
    .split(" ")
    .map(whatsappComparableToken)
    .filter(t=>t.length>=2&&!stop.has(t));
}

function escapeWhatsappRegex(value){
  return String(value||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
}

function stripWhatsAppNonCategoryTokens(n,accounts=[]){
  let clean=` ${whatsappMatchText(n)} `;
  const phrases=[
    ...(accounts||[]).map(a=>whatsappMatchText(a.name)),
    "mercado pago","dinheiro fisico","dinheiro","nubank","caixa",
    "pix","debito","credito","boleto","transferencia","transfer",
    "gasto","gastei","paguei","saida","saiu","entrou","recebi","vendi","venda"
  ].filter(Boolean).sort((a,b)=>b.length-a.length);

  for(const phrase of phrases){
    clean=clean.replace(new RegExp(`\\b${escapeWhatsappRegex(phrase)}\\b`,"g")," ");
  }

  clean=clean
    .replace(/\br\s*\$/g," ")
    .replace(/\b\d+(?:[.,]\d+)?\b/g," ")
    .replace(/\s+/g," ")
    .trim();

  return clean;
}

function whatsappCategoryScore(category,cleanText){
  const name=whatsappMatchText(category?.name||"");
  if(!name)return 0;
  const padded=` ${cleanText} `;
  if(padded.includes(` ${name} `))return 10000+name.length;

  const catTokens=whatsappTokens(name);
  const textTokens=whatsappTokens(cleanText);
  if(!catTokens.length||!textTokens.length)return 0;

  const allMatch=catTokens.every(ct=>textTokens.some(tt=>tt===ct));
  if(allMatch)return 8000+(catTokens.length*100)+name.length;

  if(catTokens.length===1&&textTokens.includes(catTokens[0]))return 6000+name.length;
  return 0;
}

async function findWhatsAppCategory(db,categories,n,direction,accounts=[]){
  if(direction==="income"){
    return categories.find(c=>c.nature==="income"&&normalizeText(c.name)==="vendas da loja")
      ||categories.find(c=>c.nature==="income"&&normalizeText(c.name)==="receita de vendas")
      ||categories.find(c=>c.nature==="income"&&(normalizeText(c.name).includes("vendas")||normalizeText(c.name).includes("receita")))
      ||categories.find(c=>c.nature==="income");
  }

  const clean=stripWhatsAppNonCategoryTokens(n,accounts);

  const scored=categories
    .map(c=>({category:c,score:whatsappCategoryScore(c,clean)}))
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score || whatsappMatchText(b.category.name).length-whatsappMatchText(a.category.name).length);

  if(scored.length)return {...scored[0].category};

  const aliases=[
    ["agua mineral","Água mineral e consumo da loja"],
    ["limpeza","Produtos de limpeza"],
    ["marmita","Marmita"],
    ["lanche","Lanche"],
    ["mercado pessoal","Mercado pessoal"],
    ["mercado","Mercado pessoal"],
    ["combustivel pessoal","Combustível pessoal"],
    ["gasolina pessoal","Combustível pessoal"],
    ["gasolina loja","Combustível empresa"],
    ["combustivel empresa","Combustível empresa"],
    ["gasolina","Combustível pessoal"],
    ["chatgpt","Sistemas e aplicativos"],
    ["canva","Sistemas e aplicativos"],
    ["vectorize","Sistemas e aplicativos"],
    ["erp","Sistemas e aplicativos"],
    ["pensao","Família e pensão"],
    ["doacao","Doações"],
    ["aluguel casa","Moradia"],
    ["aluguel loja","Aluguel e ocupação"],
    ["frete","Fretes e entregas"]
  ];

  const padded=` ${clean} `;
  for(const [alias,name] of aliases){
    const a=whatsappMatchText(alias);
    if(padded.includes(` ${a} `)){
      const c=categories.find(x=>normalizeText(x.name)===normalizeText(name));
      if(c)return {...c};
    }
  }

  return null;
}

function findAccountAlias(accounts,n){const aliases=[["mercado pago","Mercado Pago"],[" mp ","Mercado Pago"],["nubank","Nubank"],["dinheiro","Dinheiro físico"],["caixa","Dinheiro físico"]];for(const [alias,name] of aliases)if((` ${n} `).includes(alias.trim()==="mp"?" mp ":alias)){const a=accounts.find(x=>normalizeText(x.name)===normalizeText(name));if(a)return a;}return accounts.find(a=>n.includes(normalizeText(a.name)))||null;}
function buildWhatsappDescription(text,amountText){let s=text.replace(amountText,"").replace(/^(gasto|gastei|paguei|saida|saiu|entrou|recebi|vendi|venda|compra|comprei|transfere|transferir|transferencia|transferência)\s*/i,"").trim();return s||"Lançamento WhatsApp";}
function parseRequestedPeriod(n){const now=periodKeyLocal(new Date());if(n.includes("julho"))return "2026-07";if(n.includes("agosto"))return "2026-08";const m=n.match(/\b(\d{4})-(0[1-9]|1[0-2])\b/);return m?m[0]:now;}
function periodLabel(key){const [y,m]=key.split("-").map(Number);return new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(y,m-1,1))).toUpperCase();}
function normalizeText(v){return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();}
function digitsOnly(v){return String(v||"").replace(/\D/g,"");}
function extractWhatsAppMoney(value){
  const match=String(value||"").match(/(?:R\$\s*)?(\d+(?:[.,]\d+)*)/i);
  if(!match)return null;
  return {match:match[0],token:match[1],cents:parsePtMoneyToCents(match[1])};
}
function parsePtMoneyToCents(v){
  let s=String(v||"").trim().replace(/\s+/g,"");
  if(!/^\d+(?:[.,]\d+)*$/.test(s))throw new Error("valor inválido.");
  const hasComma=s.includes(","),hasDot=s.includes(".");
  let normalized=s;
  if(hasComma&&hasDot){
    const decimalSep=s.lastIndexOf(",")>s.lastIndexOf(".")?",":".";
    const thousandSep=decimalSep===","?".":",";
    const parts=s.split(decimalSep);
    if(parts.length!==2||parts[1].length>2)throw new Error("valor inválido.");
    normalized=parts[0].split(thousandSep).join("")+(parts[1]?`.${parts[1]}`:"");
  }else if(hasComma||hasDot){
    const sep=hasComma?",":".";
    const parts=s.split(sep);
    if(parts.length===2){
      const [left,right]=parts;
      if(right.length===3&&left.length<=3)normalized=left+right;
      else if(right.length<=2)normalized=`${left}.${right}`;
      else throw new Error("valor inválido.");
    }else{
      if(parts.slice(1).every(part=>part.length===3))normalized=parts.join("");
      else throw new Error("valor inválido.");
    }
  }
  const n=Number(normalized);
  if(!Number.isFinite(n)||n<=0)throw new Error("valor inválido.");
  return Math.round(n*100);
}
function findWhatsAppAccountMentions(accounts,value){
  const n=normalizeText(value);
  const defs=[
    {name:"Mercado Pago",aliases:["mercado pago"," mp "]},
    {name:"Nubank",aliases:["nubank"]},
    {name:"Dinheiro físico",aliases:["dinheiro fisico","dinheiro","caixa"]}
  ];
  const found=[];
  for(const def of defs){
    const account=accounts.find(a=>normalizeText(a.name)===normalizeText(def.name));
    if(!account)continue;
    let best=-1;
    for(const aliasRaw of def.aliases){
      const alias=aliasRaw.trim();
      let idx=-1;
      if(alias==="mp"){
        const m=(` ${n} `).match(/\smp\s/);
        idx=m?m.index:-1;
      }else idx=n.indexOf(alias);
      if(idx>=0&&(best<0||idx<best))best=idx;
    }
    if(best>=0)found.push({account,index:best});
  }
  return found.sort((a,b)=>a.index-b.index).map(x=>x.account);
}
async function executeWhatsAppTransferCommand(db,text){
  const amountInfo=extractWhatsAppMoney(text);
  if(!amountInfo)throw new Error("não encontrei o valor da transferência.");
  const accounts=await listAccountsWithBalances(db);
  const mentions=findWhatsAppAccountMentions(accounts,text);
  if(mentions.length<2)throw new Error("informe origem e destino. Ex.: transfere 27 mercado pago para nubank pix.");
  const source=mentions[0],destination=mentions[1];
  if(Number(source.id)===Number(destination.id))throw new Error("origem e destino precisam ser contas diferentes.");
  const n=normalizeText(text);
  const method=n.includes("pix")?"pix":"transfer";
  const occurredAt=new Date().toISOString();
  const r=await db.prepare(`INSERT INTO transactions(occurred_at,period_key,direction,amount_cents,source_account_id,destination_account_id,nature,category_id,description,notes,payment_method,recurrence_type,status,opening_history) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(occurredAt,periodKeyFromIso(occurredAt),"transfer",amountInfo.cents,source.id,destination.id,"transfer",null,`Transferência ${source.name} → ${destination.name}`,"Transferência entre contas lançada pelo WhatsApp",method,"eventual","posted",0).run();
  return {reply:`Transferência registrada: ${formatCents(amountInfo.cents)}\nOrigem: ${source.name}\nDestino: ${destination.name}\nForma: ${method==="pix"?"Pix":"Transferência"}\nID #${r.meta.last_row_id}`};
}
function localIsoDate(date){const p=localDateParts(date);return `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;}
async function verifyMetaSignature(raw,header,secret){if(!header.startsWith("sha256="))return false;const expected=await hmacHex(raw,secret);return safeEqual(header.slice(7),expected);}
async function hmacHex(value,secret){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const out=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value)));return [...out].map(b=>b.toString(16).padStart(2,"0")).join("");}
async function sendWhatsAppText(env,to,body){if(!env.WHATSAPP_ACCESS_TOKEN||!env.WHATSAPP_PHONE_NUMBER_ID)return;const version=String(env.WHATSAPP_GRAPH_VERSION||"v26.0");await fetch(`https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:"POST",headers:{Authorization:`Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to,type:"text",text:{body}})});}

async function getSetting(db,key){const r=await db.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();return r?.value??null;}

async function isAuthenticated(request,env){
  if(!env.APP_PASSWORD||!env.SESSION_SECRET)return false; const token=parseCookies(request.headers.get("Cookie")||"")[SESSION_COOKIE]; if(!token)return false;
  const [payload,signature]=token.split("."); if(!payload||!signature)return false; const expected=await sign(payload,env.SESSION_SECRET); if(!safeEqual(signature,expected))return false;
  try{return Number(JSON.parse(base64UrlDecode(payload)).exp||0)>Math.floor(Date.now()/1000);}catch{return false;}
}
async function createSession(env){const payload=base64UrlEncode(JSON.stringify({exp:Math.floor(Date.now()/1000)+SESSION_TTL_SECONDS,app:"pantaneira-financeiro"}));return `${payload}.${await sign(payload,env.SESSION_SECRET)}`;}
async function sign(value,secret){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value))));}
function safeEqual(a,b){if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0;}
function parseCookies(header){const out={};for(const part of header.split(";")){const i=part.indexOf("=");if(i>0)out[part.slice(0,i).trim()]=part.slice(i+1).trim();}return out;}
function base64UrlEncode(v){return btoa(v).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
function base64UrlDecode(v){const n=v.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((v.length+3)%4);return atob(n);}
function bytesToBase64Url(bytes){let b="";for(const x of bytes)b+=String.fromCharCode(x);return btoa(b).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
function localDateParts(date){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:APP_TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);const map=Object.fromEntries(parts.filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));return {year:Number(map.year),month:Number(map.month),day:Number(map.day)};}
function periodKeyLocal(date){const p=localDateParts(date);return `${p.year}-${String(p.month).padStart(2,"0")}`;}
function nextPeriodKey(key){const [y,m]=key.split("-").map(Number);const d=new Date(Date.UTC(y,m,1));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;}
function periodKeyFromIso(iso){return periodKeyLocal(new Date(iso));}
function localDayUtcRange(date){const p=localDateParts(date);return {start:new Date(Date.UTC(p.year,p.month-1,p.day,4)).toISOString(),end:new Date(Date.UTC(p.year,p.month-1,p.day+1,4)).toISOString()};}
function localMonthUtcRange(date){const p=localDateParts(date);return {monthStart:new Date(Date.UTC(p.year,p.month-1,1,4)).toISOString(),nextMonth:new Date(Date.UTC(p.year,p.month,1,4)).toISOString()};}
function validatePeriodKey(v){const s=String(v||"");if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(s))throw new Error("Período inválido.");return s;}
function optionalDueDay(v){if(v==null||v==="")return null;const n=toInteger(v,"due_day");if(n<1||n>31)throw new Error("Dia de vencimento deve estar entre 1 e 31.");return n;}
function optionalIsoDate(v){if(v==null||v==="")return null;const s=String(v).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(new Date(`${s}T12:00:00Z`).valueOf()))throw new Error("Data inválida.");return s;}
function normalizePaymentMethod(v){if(v==null||v==="")return null;const s=String(v);if(!ALLOWED_PAYMENT_METHODS.includes(s))throw new Error("Forma de pagamento inválida.");return s;}
function nullable(v){if(v==null)return null;const s=String(v).trim();return s||null;}
function toInteger(v,f){const n=Number(v);if(!Number.isInteger(n))throw new Error(`${f} deve ser inteiro.`);return n;}
function toPositiveInteger(v,f){const n=toInteger(v,f);if(n<=0)throw new Error(`${f} deve ser maior que zero.`);return n;}
function optionalPositiveInteger(v,f){if(v==null||v==="")return null;return toPositiveInteger(v,f);}
function toNonNegativeInteger(v,f){const n=toInteger(v,f);if(n<0)throw new Error(`${f} não pode ser negativo.`);return n;}
function formatCents(c){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(c||0)/100);}
async function readJson(request){try{return await request.json();}catch{throw new Error("JSON inválido.");}}
function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...extra}});}
