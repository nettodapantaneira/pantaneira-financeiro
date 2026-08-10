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
        return json({ ok:true, app:env.APP_NAME || "Pantaneira Financeiro", version:env.APP_VERSION || "1.3.0" });
      }

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
        const limit=Math.min(Math.max(Number(url.searchParams.get("limit")||50),1),200);
        return json({transactions:await listTransactions(env.DB,limit)});
      }
      if (url.pathname === "/api/suppliers" && request.method === "GET") return json({suppliers:await listSuppliers(env.DB)});
      if (url.pathname === "/api/purchases" && request.method === "GET") return json({purchases:await listPurchases(env.DB,100)});

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
        const paidDate=optionalIsoDate(body.paid_date); if(!paidDate || paidDate<"2026-08-01" || paidDate>"2026-08-10")return json({error:"A data deve estar entre 01/08 e 10/08/2026."},400);
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
        const r=await env.DB.prepare(`INSERT INTO transactions(occurred_at,period_key,direction,amount_cents,source_account_id,destination_account_id,nature,category_id,obligation_id,debt_id,description,notes,payment_method,recurrence_type,status,opening_history)
          VALUES(?,?,?,?,NULL,NULL,?,?,?,NULL,?,?,?,?,?,1)`).bind(occurredAt,periodKey,direction,amount,nature,categoryId,obligationId,description,nullable(body.notes),normalizePaymentMethod(body.payment_method),"eventual","posted").run();
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
            if(!paidDate || paidDate<"2026-08-01" || paidDate>"2026-08-10")return json({error:"A data do histórico inicial deve ficar entre 01/08 e 10/08/2026."},400);
            occurredAt=`${paidDate}T16:00:00.000Z`;
          }
          const periodKey=periodKeyFromIso(occurredAt);
          let categoryId=body.category_id===undefined?current.category_id:(body.category_id==null?null:toInteger(body.category_id,"category_id"));
          categoryId=await validCategoryForNature(env.DB,categoryId,nature);
          let obligationId=direction==="expense"?(body.obligation_id===undefined?current.obligation_id:(body.obligation_id==null?null:toInteger(body.obligation_id,"obligation_id"))):null;
          await validateObligationPayment(env.DB,obligationId,nature,periodKey,amount,id);
          next={occurred_at:occurredAt,period_key:periodKey,direction,amount_cents:amount,source_account_id:null,destination_account_id:null,nature,category_id:categoryId,obligation_id:obligationId,debt_id:null,description,notes:body.notes===undefined?current.notes:nullable(body.notes),payment_method:body.payment_method===undefined?current.payment_method:normalizePaymentMethod(body.payment_method),recurrence_type:current.recurrence_type||"eventual",status:"posted",supplier_id:current.supplier_id,purchase_id:current.purchase_id};
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
  const target=obligations.filter(o=>o.active&&o.counts_in_daily_target);
  const strictTarget=target.filter(o=>!o.flexible);
  const committedStrict=strictTarget.reduce((s,o)=>s+Math.max(0,Number(o.remaining_cents||0)),0);
  const committedFlexible=target.filter(o=>o.flexible).reduce((s,o)=>s+Math.max(0,Number(o.remaining_cents||0)),0);
  const daily=calculateDailyProtection(target,now);
  const {start,end}=localDayUtcRange(now); const {monthStart,nextMonth}=localMonthUtcRange(now);
  const today=await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN direction='income' AND status!='void' THEN amount_cents ELSE 0 END),0) income_cents,
    COALESCE(SUM(CASE WHEN direction='expense' AND status!='void' THEN amount_cents ELSE 0 END),0) expense_cents,
    COALESCE(SUM(CASE WHEN direction='expense' AND nature='personal_withdrawal' AND status!='void' THEN amount_cents ELSE 0 END),0) personal_cents
    FROM transactions WHERE occurred_at>=? AND occurred_at<?`).bind(start,end).first();
  const month=await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN direction='income' AND status!='void' THEN amount_cents ELSE 0 END),0) income_cents,
    COALESCE(SUM(CASE WHEN direction='expense' AND status!='void' THEN amount_cents ELSE 0 END),0) expense_cents,
    COALESCE(SUM(CASE WHEN direction='expense' AND nature='personal_withdrawal' AND status!='void' THEN amount_cents ELSE 0 END),0) personal_cents,
    COALESCE(SUM(CASE WHEN direction='expense' AND nature='business_debt' AND status!='void' THEN amount_cents ELSE 0 END),0) debt_paid_cents,
    COALESCE(SUM(CASE WHEN direction='expense' AND nature='inventory' AND status!='void' THEN amount_cents ELSE 0 END),0) inventory_cents,
    COALESCE(SUM(CASE WHEN opening_history=1 AND direction='income' AND status!='void' THEN amount_cents ELSE 0 END),0) opening_income_cents,
    COALESCE(SUM(CASE WHEN opening_history=1 AND direction='expense' AND status!='void' THEN amount_cents ELSE 0 END),0) opening_expense_cents
    FROM transactions WHERE occurred_at>=? AND occurred_at<?`).bind(monthStart,nextMonth).first();

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
    as_of:now.toISOString(),period_key:periodKeyLocal(now),
    balances:{all_cents:all,business_cents:businessAvailable,business_total_cents:businessTotal,pending_business_cents:pendingBusiness,cash_cents:cash,committed_strict_cents:committedStrict,committed_flexible_cents:committedFlexible,free_strict_cents:businessAvailable-committedStrict},
    daily_protection:daily,
    today:{income_cents:Number(today?.income_cents||0),expense_cents:Number(today?.expense_cents||0),personal_withdrawal_cents:Number(today?.personal_cents||0)},
    month:{income_cents:Number(month?.income_cents||0),expense_cents:Number(month?.expense_cents||0),net_cents:Number(month?.income_cents||0)-Number(month?.expense_cents||0),opening_income_cents:Number(month?.opening_income_cents||0),opening_expense_cents:Number(month?.opening_expense_cents||0),personal_withdrawal_cents:personalUsed,debt_paid_cents:Number(month?.debt_paid_cents||0),inventory_spent_cents:Number(month?.inventory_cents||0)},
    category_spending:categorySpending,
    personal:{ceiling_cents:ceiling,withdrawn_cents:personalUsed,ceiling_remaining_cents:personalRemaining,ceiling_exceeded_cents:personalExceeded,pension:pension?{target_cents:Number(pension.monthly_target_cents||0),paid_cents:Number(pension.paid_current_cents||0),remaining_cents:Math.max(0,Number(pension.monthly_target_cents||0)-Number(pension.paid_current_cents||0))}:null,fixed_items:personalFixed.map(o=>({id:o.id,name:o.name,target_cents:Number(o.monthly_target_cents||0),paid_cents:Number(o.paid_current_cents||0)}))},
    debt_summary:{old_business_balance_cents:oldDebtBalance,active_count:debts.filter(d=>d.status==="active").length},
    accounts,obligations:obligations.slice(0,50),recent_purchases:purchases
  };
}

async function listAccountsWithBalances(db){
  const {results}=await db.prepare(`SELECT a.id,a.name,a.owner_scope,a.account_type,a.opening_balance_cents,a.available_for_spending,a.active,a.notes,
    a.opening_balance_cents
    +COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.destination_account_id=a.id AND t.status!='void'),0)
    -COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.source_account_id=a.id AND t.status!='void'),0) balance_cents
    FROM accounts a WHERE a.active=1 ORDER BY CASE a.owner_scope WHEN 'business' THEN 0 ELSE 1 END,a.id`).all();
  return results.map(r=>({...r,balance_cents:Number(r.balance_cents||0)}));
}

async function accountBalance(db,id){
  return db.prepare(`SELECT a.id,a.name,a.owner_scope,a.account_type,a.opening_balance_cents,a.available_for_spending,
    a.opening_balance_cents+COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.destination_account_id=a.id AND t.status!='void'),0)-COALESCE((SELECT SUM(t.amount_cents) FROM transactions t WHERE t.source_account_id=a.id AND t.status!='void'),0) balance_cents
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

async function listTransactions(db,limit){
  const {results}=await db.prepare(`SELECT t.id,t.occurred_at,t.period_key,t.direction,t.amount_cents,t.source_account_id,t.destination_account_id,t.nature,t.category_id,t.description,t.notes,t.payment_method,t.recurrence_type,t.status,t.opening_history,t.obligation_id,t.debt_id,t.supplier_id,t.purchase_id,
    sa.name source_account,da.name destination_account,c.name category_name,s.name supplier_name,d.name debt_name
    FROM transactions t LEFT JOIN accounts sa ON sa.id=t.source_account_id LEFT JOIN accounts da ON da.id=t.destination_account_id LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN suppliers s ON s.id=t.supplier_id LEFT JOIN debts d ON d.id=t.debt_id
    ORDER BY t.occurred_at DESC,t.id DESC LIMIT ?`).bind(limit).all();
  return results;
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
  const dueDate=payable>0?optionalIsoDate(body.due_date):null; if(payable>0&&!dueDate)throw new Error("Informe o vencimento da parte a pagar.");
  const purchaseDate=body.purchase_date?new Date(body.purchase_date).toISOString():new Date().toISOString();
  const p=await db.prepare(`INSERT INTO purchases(supplier_id,purchase_date,total_cents,paid_now_cents,payable_cents,source_account_id,payment_method,due_date,status,notes,nature,category_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(supplierId,purchaseDate,total,paidNow,payable,source,method,dueDate,payable>0?(paidNow>0?"partial":"open"):"paid",nullable(body.notes),nature,categoryId).run();
  const purchaseId=p.meta.last_row_id; let transactionId=null,obligationId=null;
  if(paidNow>0){
    const tr=await db.prepare(`INSERT INTO transactions(occurred_at,period_key,direction,amount_cents,source_account_id,nature,category_id,description,notes,payment_method,recurrence_type,status,supplier_id,purchase_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(purchaseDate,periodKeyFromIso(purchaseDate),"expense",paidNow,source,nature,categoryId,`Compra - ${supplier?.name||"Fornecedor"}`,nullable(body.notes),method,"eventual","posted",supplierId,purchaseId).run();
    transactionId=tr.meta.last_row_id;
  }
  if(payable>0){
    const dueDay=Number(String(dueDate).slice(8,10));
    const o=await db.prepare(`INSERT INTO obligations(name,scope,nature,category_id,monthly_target_cents,due_day,due_date,recurring,flexible,priority,counts_in_daily_target,personal_ceiling_member,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(`Compra a pagar - ${supplier?.name||"Fornecedor"}`,"business",nature,categoryId,payable,dueDay,dueDate,0,0,2,1,0,`Gerado pela compra #${purchaseId}.`).run();
    obligationId=o.meta.last_row_id;
  }
  await db.prepare("UPDATE purchases SET transaction_id=?,obligation_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(transactionId,obligationId,purchaseId).run();
  return {ok:true,id:purchaseId,transaction_id:transactionId,obligation_id:obligationId,payable_cents:payable};
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
    const daily=Math.ceil(remaining/days); const item={id:o.id,name:o.name,remaining_cents:remaining,daily_cents:daily,days_remaining:days,nature:o.nature,flexible:Boolean(o.flexible),priority:o.priority,overdue:Boolean(o.overdue),due_date:o.due_date||null,due_day:o.due_day||null}; items.push(item);
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
