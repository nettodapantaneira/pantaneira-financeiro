import baseWorker from './worker.js';

const TZ = 'America/Cuiaba';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        const res = await baseWorker.fetch(request, env, ctx);
        const data = await res.clone().json().catch(() => ({}));
        return json({ ...data, version: '1.8.0' }, res.status);
      }

      if (url.pathname === '/api/internal/finance-command' && request.method === 'POST') {
        const clone = request.clone();
        const body = await clone.json().catch(() => null);
        if (body && isYieldCommand(body.text)) {
          const handled = await handleYieldFinanceCommand(body, request, env);
          if (handled) return handled;
        }
        return baseWorker.fetch(request, env, ctx);
      }

      if (url.pathname === '/api/dashboard' && request.method === 'GET') {
        const res = await baseWorker.fetch(request, env, ctx);
        if (!res.ok) return res;
        const data = await res.json();
        return json(await augmentDashboard(env.DB, data));
      }

      if (url.pathname === '/api/month-summary' && request.method === 'GET') {
        const res = await baseWorker.fetch(request, env, ctx);
        if (!res.ok) return res;
        const data = await res.json();
        return json(await augmentMonthSummary(env.DB, data));
      }

      if (url.pathname.startsWith('/api/credit-card') || url.pathname.startsWith('/api/card-')) {
        const auth = await requireAppSession(request, env, ctx);
        if (auth) return auth;
        return await handleCardApi(request, env);
      }

      const res = await baseWorker.fetch(request, env, ctx);
      const type = res.headers.get('content-type') || '';
      if (res.ok && type.includes('text/html')) {
        let html = await res.text();
        if (!html.includes('/v180.js')) {
          html = html.replace('</body>', '<script src="/v180.js?v=1.8.0"></script></body>');
        }
        const headers = new Headers(res.headers);
        headers.delete('content-length');
        headers.set('cache-control', 'no-cache');
        return new Response(html, { status: res.status, headers });
      }
      return res;
    } catch (error) {
      console.error('v1.8.0 wrapper error', error);
      if (url.pathname.startsWith('/api/')) return json({ error: String(error?.message || error) }, 400);
      return new Response('Erro interno.', { status: 500 });
    }
  }
};

async function requireAppSession(request, env, ctx) {
  const probeUrl = new URL('/api/accounts', request.url);
  const probe = new Request(probeUrl, { method: 'GET', headers: request.headers });
  const res = await baseWorker.fetch(probe, env, ctx);
  if (res.status === 401) return json({ error: 'Sessão expirada.' }, 401);
  if (!res.ok) return json({ error: 'Não foi possível validar a sessão.' }, res.status);
  return null;
}

async function handleCardApi(request, env) {
  const url = new URL(request.url);
  const db = env.DB;

  if (url.pathname === '/api/credit-cards' && request.method === 'GET') {
    return json(await listCards(db));
  }
  if (url.pathname === '/api/credit-cards' && request.method === 'POST') {
    const b = await readJson(request);
    const name = textRequired(b.name, 'Nome do cartão');
    const preferred = nullableInt(b.preferred_account_id);
    if (preferred) await assertAccount(db, preferred);
    const r = await db.prepare(`INSERT INTO credit_cards(name,issuer,limit_cents,closing_day,due_day,preferred_account_id,mixed_use,notes)
      VALUES(?,?,?,?,?,?,1,?)`).bind(
        name, nullableText(b.issuer), nullableMoneyInt(b.limit_cents), nullableDay(b.closing_day), nullableDay(b.due_day), preferred, nullableText(b.notes)
      ).run();
    await revision(db, 'card', r.meta.last_row_id, 'create', null, await row(db, 'credit_cards', r.meta.last_row_id));
    return json({ ok: true, id: r.meta.last_row_id }, 201);
  }

  let m = url.pathname.match(/^\/api\/credit-cards\/(\d+)$/);
  if (m && request.method === 'PATCH') {
    const id = Number(m[1]), current = await row(db, 'credit_cards', id);
    if (!current) return json({ error: 'Cartão não encontrado.' }, 404);
    const b = await readJson(request);
    const preferred = b.preferred_account_id === undefined ? current.preferred_account_id : nullableInt(b.preferred_account_id);
    if (preferred) await assertAccount(db, preferred);
    const next = {
      name: b.name === undefined ? current.name : textRequired(b.name, 'Nome do cartão'),
      issuer: b.issuer === undefined ? current.issuer : nullableText(b.issuer),
      limit_cents: b.limit_cents === undefined ? current.limit_cents : nullableMoneyInt(b.limit_cents),
      closing_day: b.closing_day === undefined ? current.closing_day : nullableDay(b.closing_day),
      due_day: b.due_day === undefined ? current.due_day : nullableDay(b.due_day),
      preferred_account_id: preferred,
      active: b.active === undefined ? current.active : (b.active ? 1 : 0),
      notes: b.notes === undefined ? current.notes : nullableText(b.notes)
    };
    await db.prepare(`UPDATE credit_cards SET name=?,issuer=?,limit_cents=?,closing_day=?,due_day=?,preferred_account_id=?,active=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(next.name,next.issuer,next.limit_cents,next.closing_day,next.due_day,next.preferred_account_id,next.active,next.notes,id).run();
    await revision(db, 'card', id, 'edit', current, await row(db, 'credit_cards', id));
    return json({ ok: true });
  }

  if (url.pathname === '/api/card-bills' && request.method === 'POST') {
    const b = await readJson(request);
    const cardId = positiveInt(b.card_id, 'card_id');
    const card = await row(db, 'credit_cards', cardId);
    if (!card || !Number(card.active)) return json({ error: 'Cartão não encontrado ou inativo.' }, 404);
    const period = periodKey(b.period_key);
    const total = nonNegativeInt(b.total_cents, 'total_cents');
    const dueDate = isoDate(b.due_date, 'Vencimento');
    const closingDate = b.closing_date ? isoDate(b.closing_date, 'Fechamento') : null;
    const exists = await db.prepare('SELECT id FROM credit_card_bills WHERE card_id=? AND period_key=?').bind(cardId, period).first();
    if (exists) return json({ error: 'Já existe uma fatura deste cartão para essa competência.' }, 409);
    const cat = await ensureBillCategory(db);
    const o = await db.prepare(`INSERT INTO obligations(name,scope,nature,category_id,monthly_target_cents,due_day,due_date,recurring,flexible,priority,counts_in_daily_target,personal_ceiling_member,active,notes)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?)`).bind(
        `Fatura ${card.name} · ${periodLabel(period)}`,'business','business_debt',cat,total,dayFromDate(dueDate),dueDate,0,0,1,1,0,`[CARD_BILL] ${period}`
      ).run();
    const r = await db.prepare(`INSERT INTO credit_card_bills(card_id,period_key,total_cents,due_date,closing_date,obligation_id,status,notes)
      VALUES(?,?,?,?,?,?,?,?)`).bind(cardId,period,total,dueDate,closingDate,o.meta.last_row_id,total===0?'paid':'open',nullableText(b.notes)).run();
    await syncBill(db, r.meta.last_row_id);
    await revision(db, 'bill', r.meta.last_row_id, 'create', null, await row(db, 'credit_card_bills', r.meta.last_row_id));
    return json({ ok: true, id: r.meta.last_row_id }, 201);
  }

  m = url.pathname.match(/^\/api\/card-bills\/(\d+)$/);
  if (m && request.method === 'GET') {
    const data = await billDetails(db, Number(m[1]));
    if (!data) return json({ error: 'Fatura não encontrada.' }, 404);
    return json(data);
  }
  if (m && request.method === 'PATCH') {
    const id = Number(m[1]), current = await row(db, 'credit_card_bills', id);
    if (!current) return json({ error: 'Fatura não encontrada.' }, 404);
    const b = await readJson(request);
    const paid = await billPaid(db,id);
    const total = b.total_cents === undefined ? Number(current.total_cents) : nonNegativeInt(b.total_cents,'total_cents');
    if (total < paid) return json({ error: `O total não pode ficar abaixo do que já foi pago (${brl(paid)}).` }, 400);
    const dueDate = b.due_date === undefined ? current.due_date : isoDate(b.due_date,'Vencimento');
    const closingDate = b.closing_date === undefined ? current.closing_date : (b.closing_date ? isoDate(b.closing_date,'Fechamento') : null);
    const notes = b.notes === undefined ? current.notes : nullableText(b.notes);
    await db.prepare('UPDATE credit_card_bills SET total_cents=?,due_date=?,closing_date=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .bind(total,dueDate,closingDate,notes,id).run();
    await syncBill(db,id);
    await revision(db,'bill',id,'edit',current,await row(db,'credit_card_bills',id));
    return json({ok:true});
  }

  m = url.pathname.match(/^\/api\/card-bills\/(\d+)\/items$/);
  if (m && request.method === 'POST') {
    const billId=Number(m[1]); if(!await row(db,'credit_card_bills',billId))return json({error:'Fatura não encontrada.'},404);
    const b=await readJson(request); const item=await validateItem(db,b);
    const r=await db.prepare(`INSERT INTO credit_card_items(bill_id,purchase_date,description,amount_cents,scope,nature,category_id,installment_number,installment_total,notes)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(billId,item.purchase_date,item.description,item.amount_cents,item.scope,item.nature,item.category_id,item.installment_number,item.installment_total,item.notes).run();
    await revision(db,'item',r.meta.last_row_id,'create',null,await row(db,'credit_card_items',r.meta.last_row_id));
    await reallocateBill(db,billId);
    return json({ok:true,id:r.meta.last_row_id},201);
  }

  m = url.pathname.match(/^\/api\/card-items\/(\d+)$/);
  if (m && request.method === 'PATCH') {
    const id=Number(m[1]),current=await row(db,'credit_card_items',id);if(!current)return json({error:'Compra não encontrada.'},404);
    const b=await readJson(request);const item=await validateItem(db,{...current,...b});
    await db.prepare(`UPDATE credit_card_items SET purchase_date=?,description=?,amount_cents=?,scope=?,nature=?,category_id=?,installment_number=?,installment_total=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(item.purchase_date,item.description,item.amount_cents,item.scope,item.nature,item.category_id,item.installment_number,item.installment_total,item.notes,id).run();
    await revision(db,'item',id,'edit',current,await row(db,'credit_card_items',id));await reallocateBill(db,current.bill_id);return json({ok:true});
  }
  if (m && request.method === 'DELETE') {
    const id=Number(m[1]),current=await row(db,'credit_card_items',id);if(!current)return json({error:'Compra não encontrada.'},404);
    await db.prepare("UPDATE credit_card_items SET status='void',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
    await revision(db,'item',id,'void',current,await row(db,'credit_card_items',id));await reallocateBill(db,current.bill_id);return json({ok:true});
  }

  m = url.pathname.match(/^\/api\/card-bills\/(\d+)\/payments$/);
  if (m && request.method === 'POST') {
    const billId=Number(m[1]);const bill=await row(db,'credit_card_bills',billId);if(!bill)return json({error:'Fatura não encontrada.'},404);
    const b=await readJson(request);const amount=positiveInt(b.amount_cents,'amount_cents');const paid=await billPaid(db,billId);const remaining=Math.max(0,Number(bill.total_cents)-paid);
    if(amount>remaining)return json({error:`O pagamento supera o restante da fatura (${brl(remaining)}).`},400);
    const accountId=positiveInt(b.source_account_id,'source_account_id');await assertAccount(db,accountId);
    const paidDate=isoDate(b.paid_date||localDate(),'Data do pagamento');const occurredAt=`${paidDate}T16:00:00.000Z`;const cat=await ensureBillCategory(db);
    const tr=await db.prepare(`INSERT INTO transactions(occurred_at,period_key,direction,amount_cents,source_account_id,destination_account_id,nature,category_id,obligation_id,debt_id,description,notes,payment_method,recurrence_type,status,opening_history)
      VALUES(?,?,?,?,?,NULL,'business_debt',?,NULL,NULL,?,?,?,?, 'posted',0)`).bind(
        occurredAt,paidDate.slice(0,7),'expense',amount,accountId,cat,`Pagamento fatura ${await billDisplayName(db,billId)}`,`[CARD_BILL:${billId}] ${nullableText(b.notes)||''}`,normalizeMethod(b.payment_method),'eventual'
      ).run();
    const p=await db.prepare(`INSERT INTO credit_card_payments(bill_id,amount_cents,paid_at,source_account_id,payment_method,transaction_id,notes)
      VALUES(?,?,?,?,?,?,?)`).bind(billId,amount,occurredAt,accountId,normalizeMethod(b.payment_method),tr.meta.last_row_id,nullableText(b.notes)).run();
    await revision(db,'payment',p.meta.last_row_id,'create',null,await row(db,'credit_card_payments',p.meta.last_row_id));
    await reallocateBill(db,billId);await syncBill(db,billId);
    return json({ok:true,id:p.meta.last_row_id,transaction_id:tr.meta.last_row_id},201);
  }

  m = url.pathname.match(/^\/api\/card-payments\/(\d+)$/);
  if (m && request.method === 'PATCH') {
    const id=Number(m[1]),current=await row(db,'credit_card_payments',id);if(!current||current.status==='void')return json({error:'Pagamento não encontrado.'},404);
    const b=await readJson(request);const bill=await row(db,'credit_card_bills',current.bill_id);const other=await billPaid(db,current.bill_id,id);
    const amount=b.amount_cents===undefined?Number(current.amount_cents):positiveInt(b.amount_cents,'amount_cents');if(amount>Number(bill.total_cents)-other)return json({error:`O pagamento supera o restante da fatura (${brl(Number(bill.total_cents)-other)}).`},400);
    const accountId=b.source_account_id===undefined?Number(current.source_account_id):positiveInt(b.source_account_id,'source_account_id');await assertAccount(db,accountId);
    const paidDate=b.paid_date===undefined?String(current.paid_at).slice(0,10):isoDate(b.paid_date,'Data do pagamento');const paidAt=`${paidDate}T16:00:00.000Z`;const method=b.payment_method===undefined?current.payment_method:normalizeMethod(b.payment_method);const notes=b.notes===undefined?current.notes:nullableText(b.notes);
    const tr=await row(db,'transactions',current.transaction_id);if(!tr)return json({error:'Lançamento financeiro vinculado não encontrado.'},409);
    await db.prepare(`UPDATE transactions SET occurred_at=?,period_key=?,amount_cents=?,source_account_id=?,notes=?,payment_method=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(paidAt,paidDate.slice(0,7),amount,accountId,`[CARD_BILL:${current.bill_id}] ${notes||''}`,method,current.transaction_id).run();
    await db.prepare(`INSERT INTO transaction_revisions(transaction_id,action,before_json,after_json) VALUES(?,?,?,?)`).bind(current.transaction_id,'edit',JSON.stringify(tr),JSON.stringify(await row(db,'transactions',current.transaction_id))).run();
    await db.prepare(`UPDATE credit_card_payments SET amount_cents=?,paid_at=?,source_account_id=?,payment_method=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(amount,paidAt,accountId,method,notes,id).run();
    await revision(db,'payment',id,'edit',current,await row(db,'credit_card_payments',id));await reallocateBill(db,current.bill_id);await syncBill(db,current.bill_id);return json({ok:true});
  }
  if (m && request.method === 'DELETE') {
    const id=Number(m[1]),current=await row(db,'credit_card_payments',id);if(!current)return json({error:'Pagamento não encontrado.'},404);if(current.status==='void')return json({ok:true,already_void:true});
    const tr=await row(db,'transactions',current.transaction_id);
    if(tr){await db.prepare("UPDATE transactions SET status='void',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(current.transaction_id).run();await db.prepare(`INSERT INTO transaction_revisions(transaction_id,action,before_json,after_json) VALUES(?,?,?,?)`).bind(current.transaction_id,'void',JSON.stringify(tr),JSON.stringify(await row(db,'transactions',current.transaction_id))).run();}
    await db.prepare("UPDATE credit_card_payments SET status='void',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();await revision(db,'payment',id,'void',current,await row(db,'credit_card_payments',id));await reallocateBill(db,current.bill_id);await syncBill(db,current.bill_id);return json({ok:true});
  }

  return json({ error: 'Rota de cartão não encontrada.' }, 404);
}

async function listCards(db){
  const cards=(await db.prepare(`SELECT c.*,a.name preferred_account_name FROM credit_cards c LEFT JOIN accounts a ON a.id=c.preferred_account_id WHERE c.active=1 ORDER BY c.name`).all()).results||[];
  const bills=(await db.prepare(`SELECT b.*,c.name card_name,c.issuer,c.limit_cents,c.preferred_account_id,
    COALESCE((SELECT SUM(p.amount_cents) FROM credit_card_payments p WHERE p.bill_id=b.id AND p.status='posted'),0) paid_cents,
    COALESCE((SELECT SUM(i.amount_cents) FROM credit_card_items i WHERE i.bill_id=b.id AND i.status='posted' AND i.scope='business'),0) business_cents,
    COALESCE((SELECT SUM(i.amount_cents) FROM credit_card_items i WHERE i.bill_id=b.id AND i.status='posted' AND i.scope='personal'),0) personal_cents,
    COALESCE((SELECT SUM(i.amount_cents) FROM credit_card_items i WHERE i.bill_id=b.id AND i.status='posted'),0) detailed_cents
    FROM credit_card_bills b JOIN credit_cards c ON c.id=b.card_id WHERE b.status!='void' ORDER BY b.due_date,b.id`).all()).results||[];
  return {cards,bills:bills.map(enrichBill)};
}

async function billDetails(db,id){
  const bill=await db.prepare(`SELECT b.*,c.name card_name,c.issuer,c.limit_cents,c.preferred_account_id,c.due_day,c.closing_day FROM credit_card_bills b JOIN credit_cards c ON c.id=b.card_id WHERE b.id=?`).bind(id).first();if(!bill)return null;
  const items=(await db.prepare(`SELECT i.*,c.name category_name,p.name parent_category_name FROM credit_card_items i LEFT JOIN categories c ON c.id=i.category_id LEFT JOIN categories p ON p.id=c.parent_id WHERE i.bill_id=? AND i.status='posted' ORDER BY i.purchase_date,i.id`).bind(id).all()).results||[];
  const payments=(await db.prepare(`SELECT p.*,a.name source_account_name FROM credit_card_payments p LEFT JOIN accounts a ON a.id=p.source_account_id WHERE p.bill_id=? AND p.status='posted' ORDER BY p.paid_at,p.id`).bind(id).all()).results||[];
  const paid=payments.reduce((s,p)=>s+Number(p.amount_cents||0),0),business=items.filter(i=>i.scope==='business').reduce((s,i)=>s+Number(i.amount_cents||0),0),personal=items.filter(i=>i.scope==='personal').reduce((s,i)=>s+Number(i.amount_cents||0),0),detailed=business+personal;
  return {bill:enrichBill({...bill,paid_cents:paid,business_cents:business,personal_cents:personal,detailed_cents:detailed}),items,payments};
}

function enrichBill(b){const total=Number(b.total_cents||0),paid=Number(b.paid_cents||0),remaining=Math.max(0,total-paid),detailed=Number(b.detailed_cents||0);return {...b,paid_cents:paid,remaining_cents:remaining,undetailed_cents:Math.max(0,total-detailed),over_detailed_cents:Math.max(0,detailed-total)};}

async function validateItem(db,b){
  const scope=b.scope==='personal'?'personal':'business';let nature=String(b.nature||'');
  if(scope==='personal')nature='personal_withdrawal';else if(!['business_operating','inventory','business_debt'].includes(nature))nature='business_operating';
  let category=nullableInt(b.category_id);if(category){const c=await db.prepare('SELECT id,nature,active FROM categories WHERE id=?').bind(category).first();if(!c||!Number(c.active)||c.nature!==nature)throw new Error('Categoria incompatível com a classificação da compra.');}
  if(!category){const c=await db.prepare('SELECT id FROM categories WHERE nature=? AND active=1 ORDER BY id LIMIT 1').bind(nature).first();category=c?.id||null;}
  const installmentTotal=b.installment_total?positiveInt(b.installment_total,'installment_total'):null;const installmentNumber=b.installment_number?positiveInt(b.installment_number,'installment_number'):null;if(installmentNumber&&installmentTotal&&installmentNumber>installmentTotal)throw new Error('A parcela atual não pode ser maior que o total de parcelas.');
  return {purchase_date:isoDate(String(b.purchase_date||'').slice(0,10)||localDate(),'Data da compra'),description:textRequired(b.description,'Descrição'),amount_cents:positiveInt(b.amount_cents,'amount_cents'),scope,nature,category_id:category,installment_number:installmentNumber,installment_total:installmentTotal,notes:nullableText(b.notes)};
}

async function syncBill(db,billId){
  const bill=await row(db,'credit_card_bills',billId);if(!bill)return;const paid=await billPaid(db,billId),remaining=Math.max(0,Number(bill.total_cents)-paid);let status=remaining===0?'paid':paid>0?'partial':'open';if(remaining>0&&String(bill.due_date)<localDate())status='overdue';
  await db.prepare('UPDATE credit_card_bills SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(status,billId).run();
  if(bill.obligation_id){await db.prepare(`UPDATE obligations SET monthly_target_cents=?,due_day=?,due_date=?,active=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(remaining,dayFromDate(bill.due_date),bill.due_date,remaining>0?1:0,`[CARD_BILL:${billId}] saldo restante da fatura`,bill.obligation_id).run();}
}

async function reallocateBill(db,billId){
  const payments=(await db.prepare("SELECT * FROM credit_card_payments WHERE bill_id=? AND status='posted' ORDER BY paid_at,id").bind(billId).all()).results||[];
  const items=(await db.prepare("SELECT * FROM credit_card_items WHERE bill_id=? AND status='posted' ORDER BY purchase_date,id").bind(billId).all()).results||[];
  if(payments.length){const ids=payments.map(p=>p.id),ph=ids.map(()=>'?').join(',');await db.prepare(`DELETE FROM credit_card_payment_allocations WHERE payment_id IN (${ph})`).bind(...ids).run();}
  const remain=new Map(items.map(i=>[i.id,Number(i.amount_cents)]));
  for(const p of payments){let left=Number(p.amount_cents);for(const i of items){if(left<=0)break;const avail=remain.get(i.id)||0;if(avail<=0)continue;const use=Math.min(left,avail);await db.prepare('INSERT INTO credit_card_payment_allocations(payment_id,item_id,amount_cents) VALUES(?,?,?)').bind(p.id,i.id,use).run();remain.set(i.id,avail-use);left-=use;}}
}

async function billPaid(db,billId,excludeId=null){let sql="SELECT COALESCE(SUM(amount_cents),0) total FROM credit_card_payments WHERE bill_id=? AND status='posted'",binds=[billId];if(excludeId){sql+=' AND id!=?';binds.push(excludeId);}return Number((await db.prepare(sql).bind(...binds).first())?.total||0);}

async function augmentDashboard(db,data){
  const key=data?.period_key;if(!key)return data;const stats=await cardAttribution(db,key,localDate());
  applyAttribution(data,stats,true);return data;
}
async function augmentMonthSummary(db,data){const key=data?.period_key;if(!key)return data;const stats=await cardAttribution(db,key,null);applyAttribution(data,stats,false);return data;}

async function cardAttribution(db,period,today){
  const payment=await db.prepare(`SELECT COALESCE(SUM(amount_cents),0) total FROM credit_card_payments WHERE status='posted' AND substr(paid_at,1,7)=?`).bind(period).first();
  const allocated=(await db.prepare(`SELECT i.category_id,i.nature,i.scope,c.name,c.parent_id,pc.name parent_name,SUM(a.amount_cents) total_cents
    FROM credit_card_payment_allocations a JOIN credit_card_payments p ON p.id=a.payment_id JOIN credit_card_items i ON i.id=a.item_id LEFT JOIN categories c ON c.id=i.category_id LEFT JOIN categories pc ON pc.id=c.parent_id
    WHERE p.status='posted' AND i.status='posted' AND substr(p.paid_at,1,7)=? GROUP BY i.category_id,i.nature,i.scope,c.name,c.parent_id,pc.name`).bind(period).all()).results||[];
  const allocatedTotal=allocated.reduce((s,r)=>s+Number(r.total_cents||0),0);const personal=allocated.filter(r=>r.scope==='personal').reduce((s,r)=>s+Number(r.total_cents||0),0);const inventory=allocated.filter(r=>r.nature==='inventory').reduce((s,r)=>s+Number(r.total_cents||0),0);
  let todayPersonal=0;if(today){todayPersonal=Number((await db.prepare(`SELECT COALESCE(SUM(a.amount_cents),0) total FROM credit_card_payment_allocations a JOIN credit_card_payments p ON p.id=a.payment_id JOIN credit_card_items i ON i.id=a.item_id WHERE p.status='posted' AND i.status='posted' AND i.scope='personal' AND substr(p.paid_at,1,10)=?`).bind(today).first())?.total||0);}
  return {paymentTotal:Number(payment?.total||0),allocated,allocatedTotal,personal,inventory,todayPersonal,unallocated:Math.max(0,Number(payment?.total||0)-allocatedTotal)};
}

function applyAttribution(data,s,withToday){
  if(!data.month)return;data.month.personal_withdrawal_cents=Number(data.month.personal_withdrawal_cents||0)+s.personal;data.month.inventory_spent_cents=Number(data.month.inventory_spent_cents||0)+s.inventory;data.month.debt_paid_cents=Math.max(0,Number(data.month.debt_paid_cents||0)-s.paymentTotal);
  if(withToday&&data.today)data.today.personal_withdrawal_cents=Number(data.today.personal_withdrawal_cents||0)+s.todayPersonal;
  if(withToday&&data.personal){data.personal.withdrawn_cents=Number(data.personal.withdrawn_cents||0)+s.personal;const ceiling=Number(data.personal.ceiling_cents||0);data.personal.ceiling_remaining_cents=Math.max(0,ceiling-data.personal.withdrawn_cents);data.personal.ceiling_exceeded_cents=Math.max(0,data.personal.withdrawn_cents-ceiling);}
  const list=Array.isArray(data.category_spending)?data.category_spending.map(x=>({...x,total_cents:Number(x.total_cents||0)})):[];const payRow=list.find(x=>x.name==='Pagamento de fatura de cartão');if(payRow)payRow.total_cents=Math.max(0,payRow.total_cents-s.paymentTotal+s.unallocated);
  for(const a of s.allocated){const id=Number(a.category_id||0);let x=list.find(r=>Number(r.id||0)===id&&id);if(!x){x={id:id||`card-${a.nature}-${a.name||'sem-categoria'}`,name:a.name||'Compra no cartão',nature:a.nature,parent_name:a.parent_name||'',total_cents:0};list.push(x);}x.total_cents+=Number(a.total_cents||0);}
  data.category_spending=list.filter(x=>Number(x.total_cents)>0).sort((a,b)=>Number(b.total_cents)-Number(a.total_cents));
}

async function handleYieldFinanceCommand(body,request,env){
  const secret=String(request.headers.get('x-finance-bot-secret')||'');if(!secret||!env.FINANCE_BOT_SECRET||secret!==String(env.FINANCE_BOT_SECRET))return json({error:'Não autorizado.'},401);
  if(!samePhone(body.from,env.WHATSAPP_ALLOWED_NUMBER))return json({error:'Número não autorizado.'},403);
  const parsed=parseYieldCommand(body.text);if(!parsed)return null;
  const account=await env.DB.prepare("SELECT id,name FROM accounts WHERE active=1 AND lower(trim(name))='mercado pago' LIMIT 1").first();if(!account)return json({error:'Conta Mercado Pago não encontrada.'},400);
  let cat=await env.DB.prepare("SELECT id FROM categories WHERE nature='income' AND lower(trim(name))='rendimentos financeiros' AND active=1 LIMIT 1").first();if(!cat){const r=await env.DB.prepare("INSERT INTO categories(name,nature) VALUES('Rendimentos financeiros','income')").run();cat={id:r.meta.last_row_id};}
  const now=new Date(),occurredAt=now.toISOString(),period=localPeriod(now);const r=await env.DB.prepare(`INSERT INTO transactions(occurred_at,period_key,direction,amount_cents,source_account_id,destination_account_id,nature,category_id,obligation_id,debt_id,description,notes,payment_method,recurrence_type,status,opening_history)
    VALUES(?,?,'income',?,NULL,?,'income',?,NULL,NULL,'Rendimento CDI Mercado Pago',?,'other','eventual','posted',0)`).bind(occurredAt,period,parsed.amount_cents,account.id,'Lançado pelo WhatsApp como rendimento financeiro; não é faturamento de vendas.').run();
  return json({ok:true,id:r.meta.last_row_id,reply:`Rendimento registrado: ${brl(parsed.amount_cents)} · Mercado Pago · Rendimentos financeiros.`});
}

function isYieldCommand(text){return Boolean(parseYieldCommand(text));}
function parseYieldCommand(text){const n=norm(text);if(!/^(entrou|recebi)\b/.test(n)||!/(rendimento|rendimentos|cdi)\b/.test(n)||!/(mercado pago|mercadopago)\b/.test(n))return null;const raw=String(text||'').trim().replace(/^\s*(entrou|recebi)\s+/i,'');const m=raw.match(/^((?:\d{1,3}(?:\.\d{3})+|\d+)(?:[,.]\d{1,2})?)/);if(!m)return null;const cents=parseBRMoney(m[1]);return cents>0?{amount_cents:cents}:null;}
function parseBRMoney(v){let s=String(v).trim().replace(/R\$/gi,'').replace(/\s/g,'');if(s.includes(',')&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');else if(s.includes(','))s=s.replace(',','.');else if((s.match(/\./g)||[]).length>1)s=s.replace(/\./g,'');else if(/^\d{1,3}\.\d{3}$/.test(s))s=s.replace('.','');const n=Number(s);return Number.isFinite(n)?Math.round(n*100):0;}

async function ensureBillCategory(db){let c=await db.prepare("SELECT id FROM categories WHERE name='Pagamento de fatura de cartão' AND nature='business_debt' AND active=1 LIMIT 1").first();if(!c){const r=await db.prepare("INSERT INTO categories(name,nature) VALUES('Pagamento de fatura de cartão','business_debt')").run();c={id:r.meta.last_row_id};}return c.id;}
async function assertAccount(db,id){const a=await db.prepare('SELECT id,active FROM accounts WHERE id=?').bind(id).first();if(!a||!Number(a.active))throw new Error('Conta de pagamento inválida.');return a;}
async function billDisplayName(db,id){const r=await db.prepare(`SELECT c.name card_name,b.period_key FROM credit_card_bills b JOIN credit_cards c ON c.id=b.card_id WHERE b.id=?`).bind(id).first();return r?`${r.card_name} · ${periodLabel(r.period_key)}`:`cartão #${id}`;}
async function row(db,table,id){const allowed=new Set(['credit_cards','credit_card_bills','credit_card_items','credit_card_payments','transactions']);if(!allowed.has(table))throw new Error('Tabela inválida.');return await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();}
async function revision(db,type,id,action,before,after){await db.prepare('INSERT INTO credit_card_revisions(entity_type,entity_id,action,before_json,after_json) VALUES(?,?,?,?,?)').bind(type,id,action,before?JSON.stringify(before):null,after?JSON.stringify(after):null).run();}

function readJson(request){return request.json().catch(()=>{throw new Error('JSON inválido.');});}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function textRequired(v,label){const s=String(v??'').trim();if(!s)throw new Error(`${label} obrigatório.`);return s;}
function nullableText(v){const s=String(v??'').trim();return s||null;}
function positiveInt(v,label){const n=Number(v);if(!Number.isInteger(n)||n<=0)throw new Error(`${label} inválido.`);return n;}
function nonNegativeInt(v,label){const n=Number(v);if(!Number.isInteger(n)||n<0)throw new Error(`${label} inválido.`);return n;}
function nullableMoneyInt(v){if(v===null||v===undefined||v==='')return null;return nonNegativeInt(v,'valor');}
function nullableInt(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);if(!Number.isInteger(n)||n<=0)throw new Error('Identificador inválido.');return n;}
function nullableDay(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);if(!Number.isInteger(n)||n<1||n>31)throw new Error('Dia deve ficar entre 1 e 31.');return n;}
function isoDate(v,label){const s=String(v||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(`${s}T12:00:00Z`)))throw new Error(`${label} inválido.`);return s;}
function periodKey(v){const s=String(v||'');if(!/^\d{4}-\d{2}$/.test(s))throw new Error('Competência inválida.');return s;}
function dayFromDate(v){return Number(String(v).slice(8,10));}
function normalizeMethod(v){const m=norm(v||'transfer').replace(/\s/g,'_');return ['pix','cash','debit','credit','transfer','boleto','other'].includes(m)?m:'transfer';}
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
function digits(v){return String(v||'').replace(/\D/g,'');}
function samePhone(a,b){const aa=digits(a),bb=digits(b);if(!aa||!bb)return false;if(aa===bb)return true;const variants=x=>{const out=new Set([x]);let y=x.startsWith('55')?x.slice(2):x;out.add(y);if(y.length===11&&y[2]==='9')out.add(y.slice(0,2)+y.slice(3));if(y.length===10)out.add(y.slice(0,2)+'9'+y.slice(2));return out;};const A=variants(aa),B=variants(bb);for(const x of A)if(B.has(x))return true;return false;}
function brl(c){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(c||0)/100);}
function periodLabel(k){const [y,m]=String(k).split('-');const names=['','jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];return `${names[Number(m)]||m}/${y}`;}
function localDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function localPeriod(d=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit'}).formatToParts(d);const y=parts.find(p=>p.type==='year')?.value,m=parts.find(p=>p.type==='month')?.value;return `${y}-${m}`;}
