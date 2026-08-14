import worker190 from './worker-v190.js';

const TZ='America/Cuiaba';

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);

    try{
      const metaMatch=url.pathname.match(/^\/api\/debt-payment-meta\/(\d+)$/);
      if(metaMatch && request.method==='GET'){
        const auth=await requireSession(request,env,ctx);
        if(auth)return auth;
        return json(await debtPaymentMeta(env.DB,Number(metaMatch[1])));
      }

      const payMatch=url.pathname.match(/^\/api\/debts\/(\d+)\/pay-with-date$/);
      if(payMatch && request.method==='POST'){
        const auth=await requireSession(request,env,ctx);
        if(auth)return auth;
        const body=await request.json().catch(()=>({}));
        return json(await payDebtWithDate(env.DB,Number(payMatch[1]),body),201);
      }

      const res=await worker190.fetch(request,env,ctx);

      if(url.pathname==='/api/health' && res.ok){
        const data=await res.clone().json().catch(()=>({}));
        return json({...data,version:'1.9.1'},res.status);
      }

      const type=res.headers.get('content-type')||'';
      if(res.ok && type.includes('text/html')){
        let html=await res.text();
        if(!html.includes('/v191.js')){
          html=html.replace('</body>','<script src="/v191.js?v=1.9.1"></script></body>');
        }
        const headers=new Headers(res.headers);
        headers.delete('content-length');
        headers.set('cache-control','no-cache');
        return new Response(html,{status:res.status,headers});
      }

      return res;
    }catch(error){
      console.error('v1.9.1',error);
      if(url.pathname.startsWith('/api/'))return json({error:String(error?.message||error)},400);
      return worker190.fetch(request,env,ctx);
    }
  }
};

async function requireSession(request,env,ctx){
  const probe=new Request(new URL('/api/accounts',request.url),{method:'GET',headers:request.headers});
  const r=await worker190.fetch(probe,env,ctx);
  if(r.status===401)return json({error:'Sessão expirada.'},401);
  if(!r.ok)return json({error:'Não foi possível validar a sessão.'},r.status);
  return null;
}

async function debtPaymentMeta(db,id){
  const debt=await db.prepare(`
    SELECT id,name,scope,current_balance_cents,original_balance_cents,status,flexible,debt_kind
    FROM debts WHERE id=? LIMIT 1
  `).bind(id).first();
  if(!debt)throw new Error('Compromisso não encontrado.');

  const accounts=(await db.prepare(`
    SELECT id,name,owner_scope,account_type,active
    FROM accounts
    WHERE active=1
    ORDER BY CASE owner_scope WHEN 'business' THEN 0 ELSE 1 END,id
  `).all()).results||[];

  const categories=(await db.prepare(`
    SELECT id,name,nature,parent_id
    FROM categories
    WHERE active=1
    ORDER BY name
  `).all()).results||[];

  const snapshot=(await getSetting(db,'opening_snapshot_date'))||'2026-08-10';

  return {debt,accounts,categories,opening_snapshot_date:snapshot,today:localDate()};
}

async function payDebtWithDate(db,id,body){
  const debt=await db.prepare('SELECT * FROM debts WHERE id=? LIMIT 1').bind(id).first();
  if(!debt)throw new Error('Compromisso não encontrado.');
  if(debt.status==='paid')throw new Error('Este compromisso já está marcado como pago.');

  const amount=toPositiveInt(body.amount_cents,'Valor');
  const paidDate=validDate(body.paid_date);
  if(!paidDate)throw new Error('Informe uma data válida.');
  const today=localDate();
  if(paidDate>today)throw new Error('A data do pagamento não pode estar no futuro.');

  const sourceId=toPositiveInt(body.source_account_id,'Conta');
  const account=await db.prepare('SELECT id,name,active FROM accounts WHERE id=? LIMIT 1').bind(sourceId).first();
  if(!account||!Number(account.active))throw new Error('Conta de saída inválida.');

  if(debt.current_balance_cents!=null && amount>Number(debt.current_balance_cents)){
    throw new Error(`O pagamento supera o saldo atual do compromisso (${brl(debt.current_balance_cents)}).`);
  }

  const snapshot=(await getSetting(db,'opening_snapshot_date'))||'2026-08-10';
  const historical=paidDate<=snapshot;

  if(historical && body.confirm_historical!==true){
    throw new Error(`A data ${formatDateBR(paidDate)} pertence ao período anterior à fotografia inicial. Marque a confirmação para registrar sem descontar novamente o saldo bancário.`);
  }

  const nature=debt.scope==='personal'?'personal_withdrawal':'business_debt';
  const category=await chooseDebtCategory(db,debt,nature,body.category_id);
  const occurredAt=`${paidDate}T16:00:00.000Z`;
  const description=isCorporateAgreement(debt)
    ? 'Pagamento de acordo societário'
    : `Pagamento ${debt.name}`;

  const notes=[
    String(body.notes||'').trim(),
    historical?'Pagamento histórico: não altera o saldo bancário atual.':'',
    'Registrado pelo módulo Compromissos v1.9.1.'
  ].filter(Boolean).join(' · ');

  const r=await db.prepare(`
    INSERT INTO transactions(
      occurred_at,period_key,direction,amount_cents,
      source_account_id,destination_account_id,nature,category_id,
      obligation_id,debt_id,description,notes,payment_method,
      recurrence_type,status,opening_history
    )
    VALUES(?,?,?,?,?,NULL,?,?,NULL,?,?,?,?, 'eventual','posted',?)
  `).bind(
    occurredAt,paidDate.slice(0,7),'expense',amount,
    sourceId,nature,category?.id||null,
    id,description,notes,normalizeMethod(body.payment_method),
    historical?1:0
  ).run();

  if(debt.current_balance_cents!=null){
    const next=Math.max(0,Number(debt.current_balance_cents)-amount);
    await db.prepare(`
      UPDATE debts
      SET current_balance_cents=?,
          status=CASE WHEN ?=0 THEN 'paid' ELSE status END,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(next,next,id).run();
  }

  return {
    ok:true,
    id:r.meta.last_row_id,
    historical,
    balance_changed:!historical,
    paid_date:paidDate,
    amount_cents:amount,
    category_name:category?.name||null,
    account_name:account.name
  };
}

async function chooseDebtCategory(db,debt,nature,requested){
  if(requested){
    const c=await db.prepare('SELECT id,name,nature FROM categories WHERE id=? AND active=1').bind(Number(requested)).first();
    if(c&&c.nature===nature)return c;
  }

  if(nature==='business_debt'){
    const preferred=isCorporateAgreement(debt)?'Aquisição de participação societária':'Empréstimos e acordos';
    const c=await db.prepare(`
      SELECT id,name,nature FROM categories
      WHERE name=? AND nature='business_debt' AND active=1
      ORDER BY id LIMIT 1
    `).bind(preferred).first();
    if(c)return c;
  }

  if(nature==='personal_withdrawal'){
    const c=await db.prepare(`
      SELECT id,name,nature FROM categories
      WHERE name='Família e pensão' AND nature='personal_withdrawal' AND active=1
      ORDER BY id LIMIT 1
    `).first();
    if(c)return c;
  }

  return db.prepare(`
    SELECT id,name,nature FROM categories
    WHERE nature=? AND active=1
    ORDER BY id LIMIT 1
  `).bind(nature).first();
}

function isCorporateAgreement(debt){
  const n=norm(`${debt.name||''} ${debt.notes||''}`);
  return n.includes('acordo societ')||n.includes('participacao');
}

async function getSetting(db,key){
  const r=await db.prepare('SELECT value FROM settings WHERE key=? LIMIT 1').bind(key).first();
  return r?.value||null;
}

function toPositiveInt(v,label){
  const n=Number(v);
  if(!Number.isInteger(n)||n<=0)throw new Error(`${label} inválido.`);
  return n;
}
function validDate(v){
  const s=String(v||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
  const d=new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime())?null:s;
}
function normalizeMethod(v){
  const s=String(v||'pix');
  return ['pix','cash','debit','credit','transfer','boleto','other'].includes(s)?s:'other';
}
function localDate(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
function norm(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}
function brl(c){
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(c||0)/100);
}
function formatDateBR(v){
  const [y,m,d]=String(v).split('-');return `${d}/${m}/${y}`;
}
function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
  });
}
