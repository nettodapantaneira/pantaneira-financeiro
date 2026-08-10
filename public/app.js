const state = { dashboard:null, accounts:[], categories:[], obligations:[], debts:[], transactions:[] };
const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(cents)||0)/100);
const pct = (a,b) => b > 0 ? Math.min(100,Math.round((a/b)*100)) : 0;

boot();

async function boot(){
  registerServiceWorker();
  $('loginView').hidden=true;
  $('app').hidden=true;
  const status = await api('/api/auth/status',{},false).catch(()=>({configured:false,authenticated:false}));
  if(!status.configured){
    $('loginView').hidden=false;
    $('loginHint').textContent='Antes do primeiro acesso, configure APP_PASSWORD e SESSION_SECRET no Cloudflare.';
    return;
  }
  if(!status.authenticated){
    $('loginView').hidden=false;
    return;
  }
  $('loginView').hidden=true;
  $('app').hidden=false;
  bindEvents();
  await loadAll();
}

function bindEvents(){
  document.querySelectorAll('.bottom-nav button').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.view)));
  $('fab').addEventListener('click',()=>showView('lancar'));
  $('refreshBtn').addEventListener('click',loadAll);
  $('logoutBtn').addEventListener('click',logout);
  $('transactionForm').addEventListener('submit',saveTransaction);
  $('cashForm').addEventListener('submit',reconcileCash);
  $('showProtectionBtn').addEventListener('click',()=>$('protectionDialog').showModal());
  $('closeProtection').addEventListener('click',()=>$('protectionDialog').close());
  document.querySelectorAll('#directionSelector button').forEach(btn=>btn.addEventListener('click',()=>setDirection(btn.dataset.value)));
  $('nature').addEventListener('change',()=>{renderCategorySelect();renderObligationSelect();});
  $('newObligationBtn').addEventListener('click',createObligation);
  $('newDebtBtn').addEventListener('click',createDebt);
}

$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    await api('/api/auth/login',{method:'POST',body:JSON.stringify({password:$('password').value})},false);
    location.reload();
  }catch(err){ toast(err.message); }
});

async function loadAll(){
  try{
    const [dashboard,accounts,categories,obligations,debts,transactions]=await Promise.all([
      api('/api/dashboard'),api('/api/accounts'),api('/api/categories'),api('/api/obligations'),api('/api/debts'),api('/api/transactions?limit=30')
    ]);
    state.dashboard=dashboard; state.accounts=accounts.accounts; state.categories=categories.categories; state.obligations=obligations.obligations; state.debts=debts.debts; state.transactions=transactions.transactions;
    renderAll();
  }catch(err){
    if(err.status===401){ location.reload(); return; }
    toast(err.message);
  }
}

function renderAll(){
  const d=state.dashboard;
  $('freeMoney').textContent=money(d.balances.free_strict_cents);
  $('freeMoney').classList.toggle('negative',d.balances.free_strict_cents<0);
  $('businessBalance').textContent=money(d.balances.business_cents);
  $('committed').textContent=money(d.balances.committed_strict_cents);
  $('protectTotal').textContent=money(d.daily_protection.total_cents);
  $('protectBusiness').textContent=money(d.daily_protection.business_cents);
  $('protectDebt').textContent=money(d.daily_protection.debt_cents);
  $('protectPersonal').textContent=money(d.daily_protection.personal_cents);
  $('protectFlexible').textContent=money(d.daily_protection.flexible_cents);
  $('todayIncome').textContent=money(d.today.income_cents);
  $('todayExpense').textContent=money(d.today.expense_cents);
  $('todayPersonal').textContent=money(d.today.personal_withdrawal_cents);
  $('cashBalance').textContent=money(d.balances.cash_cents);
  $('cashExpected').textContent=money(d.balances.cash_cents);
  $('monthPersonal').textContent=money(d.month.personal_withdrawal_cents);
  $('monthDebt').textContent=money(d.month.debt_paid_cents);
  $('monthInventory').textContent=money(d.month.inventory_spent_cents);
  renderObligations(); renderDebts(); renderTransactions(); renderAccounts(); renderProtection(); renderSelectors();
}

function renderObligations(){
  const html=state.obligations.map(o=>obligationCard(o)).join('');
  $('obligationsList').innerHTML=html || empty('Nenhuma conta cadastrada.');
  $('obligationPreview').innerHTML=state.obligations.filter(o=>o.counts_in_daily_target).slice(0,5).map(o=>obligationCard(o,true)).join('');
  document.querySelectorAll('[data-reserve]').forEach(btn=>btn.addEventListener('click',()=>addReserve(Number(btn.dataset.reserve))));
  document.querySelectorAll('[data-edit-obligation]').forEach(btn=>btn.addEventListener('click',()=>editObligation(Number(btn.dataset.editObligation))));
}

function obligationCard(o,compact=false){
  const reserved=Number(o.reserved_cents||0), paid=Number(o.paid_cents||0), target=Number(o.monthly_target_cents||0), missing=Number(o.remaining_cents||0);
  const covered=Math.min(target, Math.max(Number(o.reserved_total_cents||0), paid));
  return `<article class="list-card">
    <div class="row top"><div><h3>${esc(o.name)}</h3><p>${labelNature(o.nature)}${o.due_day?` · vence dia ${o.due_day}`:''}${o.flexible?' · flexível':''}</p></div><div class="money">${money(target)}</div></div>
    <div class="progress"><span style="width:${pct(covered,target)}%"></span></div>
    <div class="subline"><span>Reservado livre ${money(reserved)}${paid?` · pago ${money(paid)}`:''}</span><span>Falta ${money(missing)}</span></div>
    ${compact?'':`<div class="row" style="margin-top:12px"><span class="muted small">Período ${esc(o.target_period_key||'')} · prioridade ${o.priority}</span><div><button class="mini-btn" data-edit-obligation="${o.id}">Editar</button> <button class="mini-btn" data-reserve="${o.id}">+ Reservar</button></div></div>`}
  </article>`;
}

function renderDebts(){
  $('debtsList').innerHTML=state.debts.map(d=>`<article class="list-card"><div class="row top"><div><h3>${esc(d.name)}</h3><p>${esc(d.creditor||'Credor não informado')}${d.due_day?` · vence dia ${d.due_day}`:''}${d.flexible?' · flexível':''}</p></div><div class="money">${d.current_balance_cents==null?'Saldo a informar':money(d.current_balance_cents)}</div></div><div class="row" style="margin-top:12px"><div class="subline" style="flex:1"><span>Meta/mês ${d.monthly_target_cents?money(d.monthly_target_cents):'—'}</span><span>${d.status}</span></div><button class="mini-btn" data-edit-debt="${d.id}">Editar</button></div></article>`).join('') || empty('Nenhuma dívida cadastrada.');
  document.querySelectorAll('[data-edit-debt]').forEach(btn=>btn.addEventListener('click',()=>editDebt(Number(btn.dataset.editDebt))));
}

function renderTransactions(){
  $('transactionsList').innerHTML=state.transactions.map(t=>`<article class="list-card"><div class="row top"><div><h3>${esc(t.description)}</h3><p>${esc(t.category_name||labelNature(t.nature))} · ${new Date(t.occurred_at).toLocaleDateString('pt-BR')} · ${esc(t.payment_method||'')}</p>${t.status==='pending_reclassification'?'<p class="negative">⚠ precisa identificar/reclassificar</p>':''}</div><div class="money ${t.direction==='expense'?'negative':t.direction==='income'?'positive':''}">${t.direction==='expense'?'- ':t.direction==='income'?'+ ':''}${money(t.amount_cents)}</div></div>${t.status==='pending_reclassification'?`<div class="row" style="margin-top:12px"><span class="muted small">Diferença de conferência</span><button class="mini-btn" data-identify="${t.id}">Identificar</button></div>`:''}</article>`).join('') || empty('Nenhum lançamento ainda.');
  document.querySelectorAll('[data-identify]').forEach(btn=>btn.addEventListener('click',()=>identifyTransaction(Number(btn.dataset.identify))));
}

function renderAccounts(){
  $('accountsSetup').innerHTML=state.accounts.map(a=>`<article class="list-card"><div class="row"><div><h3>${esc(a.name)}</h3><p>${a.account_type==='cash'?'Dinheiro físico':a.owner_scope==='business'?'Empresa':'Pessoal'}</p></div><div class="money">${money(a.balance_cents)}</div></div><div class="row" style="margin-top:12px"><span class="muted small">Saldo inicial: ${money(a.opening_balance_cents)}</span><button class="mini-btn" data-opening="${a.id}">Definir saldo inicial</button></div></article>`).join('');
  document.querySelectorAll('[data-opening]').forEach(btn=>btn.addEventListener('click',()=>setOpeningBalance(Number(btn.dataset.opening))));
}

function renderProtection(){
  $('protectionItems').innerHTML=state.dashboard.daily_protection.items.map(i=>`<article class="list-card"><div class="row top"><div><h3>${esc(i.name)}</h3><p>Faltam ${money(i.remaining_cents)} · ${i.days_remaining} dia(s) úteis considerados</p></div><div class="money">${money(i.daily_cents)}/dia</div></div></article>`).join('') || empty('Nada a proteger hoje.');
}

function renderSelectors(){
  const options=state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} · ${money(a.balance_cents)}</option>`).join('');
  $('sourceAccount').innerHTML=options;
  $('destinationAccount').innerHTML=options;
  renderCategorySelect();
  renderObligationSelect();
}

function renderCategorySelect(){
  const nature=$('nature').value;
  const matches=state.categories.filter(c=>c.nature===nature || (nature==='business_debt'&&c.nature==='business_debt') || (nature==='income'&&c.nature==='income'));
  $('category').innerHTML='<option value="">Sem categoria</option>'+matches.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

function renderObligationSelect(){
  const nature=$('nature').value;
  const matches=state.obligations.filter(o=>o.nature===nature);
  $('obligation').innerHTML='<option value="">Não vincular</option>'+matches.map(o=>`<option value="${o.id}">${esc(o.name)} · falta ${money(o.remaining_cents)}</option>`).join('');
}

function setDirection(value){
  $('direction').value=value;
  document.querySelectorAll('#directionSelector button').forEach(b=>b.classList.toggle('selected',b.dataset.value===value));
  $('sourceWrap').hidden=value==='income';
  $('destinationWrap').hidden=value==='expense';
  $('obligationWrap').hidden=value!=='expense';
  if(value==='income') $('nature').value='income';
  if(value==='transfer') $('nature').value='transfer';
  if(value==='expense' && ['income','transfer'].includes($('nature').value)) $('nature').value='business_operating';
  renderCategorySelect();
  renderObligationSelect();
}

async function saveTransaction(e){
  e.preventDefault();
  try{
    const direction=$('direction').value;
    const obligationId=$('obligation').value?Number($('obligation').value):null;
    const linkedObligation=obligationId?state.obligations.find(o=>o.id===obligationId):null;
    const payload={
      direction,
      amount_cents:parseMoney($('amount').value),
      description:$('description').value.trim(),
      nature:$('nature').value,
      category_id:$('category').value?Number($('category').value):null,
      obligation_id:direction==='expense'?obligationId:null,
      debt_id:direction==='expense'&&linkedObligation?.debt_id?Number(linkedObligation.debt_id):null,
      source_account_id:direction==='income'?null:Number($('sourceAccount').value),
      destination_account_id:direction==='expense'?null:Number($('destinationAccount').value),
      payment_method:$('paymentMethod').value,
      notes:$('notes').value.trim()||null,
      recurrence_type:'eventual'
    };
    await api('/api/transactions',{method:'POST',body:JSON.stringify(payload)});
    $('transactionForm').reset(); setDirection('expense');
    toast('Lançamento salvo.'); await loadAll(); showView('hoje');
  }catch(err){ toast(err.message); }
}

async function createObligation(){
  const name=prompt('Nome da conta/compromisso:'); if(!name)return;
  const value=prompt('Valor mensal ou meta mensal:'); if(value==null)return;
  const kind=(prompt('Tipo: empresa, pessoal ou estoque','empresa')||'').trim().toLowerCase();
  const nature=kind.startsWith('p')?'personal_withdrawal':kind.startsWith('e')?'business_operating':kind.startsWith('est')?'inventory':'business_operating';
  const dueRaw=prompt('Dia do vencimento (deixe vazio se não souber):','');
  try{
    await api('/api/obligations',{method:'POST',body:JSON.stringify({name:name.trim(),nature,scope:nature==='personal_withdrawal'?'personal':'business',monthly_target_cents:parseMoney(value),due_day:dueRaw?Number(dueRaw):null,flexible:false,counts_in_daily_target:nature!=='inventory'})});
    toast('Compromisso cadastrado.'); await loadAll();
  }catch(err){toast(err.message)}
}

async function editObligation(id){
  const o=state.obligations.find(x=>x.id===id); if(!o)return;
  const value=prompt(`Valor/meta mensal de ${o.name}:`,(o.monthly_target_cents/100).toFixed(2).replace('.',',')); if(value==null)return;
  const dueRaw=prompt('Dia do vencimento (vazio = sem vencimento definido):',o.due_day||''); if(dueRaw==null)return;
  try{await api(`/api/obligations/${id}`,{method:'PATCH',body:JSON.stringify({monthly_target_cents:parseMoney(value),due_day:dueRaw?Number(dueRaw):null})});toast('Compromisso atualizado.');await loadAll()}catch(err){toast(err.message)}
}

async function createDebt(){
  const name=prompt('Nome da dívida:'); if(!name)return;
  const creditor=prompt('Credor (banco, fornecedor, pessoa):','')||'';
  const balanceRaw=prompt('Saldo total devedor (vazio se ainda não souber):',''); if(balanceRaw==null)return;
  const targetRaw=prompt('Quanto pretende/parcela pagar por mês (vazio se não souber):',''); if(targetRaw==null)return;
  const dueRaw=prompt('Dia do vencimento (vazio se não houver):',''); if(dueRaw==null)return;
  try{
    await api('/api/debts',{method:'POST',body:JSON.stringify({name:name.trim(),creditor:creditor.trim()||null,scope:'business',current_balance_cents:balanceRaw?parseMoney(balanceRaw):null,monthly_target_cents:targetRaw?parseMoney(targetRaw):null,due_day:dueRaw?Number(dueRaw):null,flexible:false})});
    toast('Dívida cadastrada.');await loadAll();
  }catch(err){toast(err.message)}
}

async function editDebt(id){
  const d=state.debts.find(x=>x.id===id); if(!d)return;
  const balanceRaw=prompt(`Saldo atual de ${d.name}:`,d.current_balance_cents==null?'':(d.current_balance_cents/100).toFixed(2).replace('.',',')); if(balanceRaw==null)return;
  const targetRaw=prompt('Meta/parcela mensal:',d.monthly_target_cents==null?'':(d.monthly_target_cents/100).toFixed(2).replace('.',',')); if(targetRaw==null)return;
  const dueRaw=prompt('Dia do vencimento:',d.due_day||''); if(dueRaw==null)return;
  try{await api(`/api/debts/${id}`,{method:'PATCH',body:JSON.stringify({current_balance_cents:balanceRaw?parseMoney(balanceRaw):null,monthly_target_cents:targetRaw?parseMoney(targetRaw):null,due_day:dueRaw?Number(dueRaw):null})});toast('Dívida atualizada.');await loadAll()}catch(err){toast(err.message)}
}

async function identifyTransaction(id){
  const t=state.transactions.find(x=>x.id===id); if(!t)return;
  const description=prompt('O que foi esse dinheiro?',t.description==='Saída de dinheiro não identificada'?'':t.description); if(!description)return;
  const kind=(prompt('Classifique: pessoal, empresa, estoque ou dívida','pessoal')||'').trim().toLowerCase();
  const nature=kind.startsWith('p')?'personal_withdrawal':kind.startsWith('est')?'inventory':kind.startsWith('d')?'business_debt':'business_operating';
  try{await api(`/api/transactions/${id}`,{method:'PATCH',body:JSON.stringify({description:description.trim(),nature,status:'posted'})});toast('Diferença identificada.');await loadAll()}catch(err){toast(err.message)}
}

async function addReserve(id){
  const o=state.obligations.find(x=>x.id===id); if(!o)return;
  const value=prompt(`Quanto deseja reservar para ${o.name}?`); if(value==null)return;
  try{ await api('/api/reserves',{method:'POST',body:JSON.stringify({obligation_id:id,amount_cents:parseMoney(value)})}); toast('Reserva registrada.'); await loadAll(); }catch(err){toast(err.message)}
}

async function setOpeningBalance(id){
  const a=state.accounts.find(x=>x.id===id); if(!a)return;
  const value=prompt(`Saldo inicial de ${a.name}:`,(a.opening_balance_cents/100).toFixed(2).replace('.',',')); if(value==null)return;
  try{ await api(`/api/accounts/${id}/opening-balance`,{method:'POST',body:JSON.stringify({opening_balance_cents:parseSignedMoney(value)})}); toast('Saldo inicial atualizado.'); await loadAll(); }catch(err){toast(err.message)}
}

async function reconcileCash(e){
  e.preventDefault();
  const cash=state.accounts.find(a=>a.owner_scope==='business'&&a.account_type==='cash'); if(!cash)return toast('Conta de dinheiro físico não encontrada.');
  try{
    const r=await api('/api/cash/reconcile',{method:'POST',body:JSON.stringify({account_id:cash.id,actual_balance_cents:parseSignedMoney($('cashActual').value)})});
    $('cashResult').hidden=false;
    $('cashResult').innerHTML=`Esperado: <b>${money(r.expected_cents)}</b><br>Contado: <b>${money(r.actual_cents)}</b><br>Diferença: <b class="${r.difference_cents<0?'negative':r.difference_cents>0?'positive':''}">${money(r.difference_cents)}</b>${r.difference_cents!==0?'<br><br>A diferença foi criada como lançamento não identificado para você reclassificar depois.':''}`;
    await loadAll();
  }catch(err){toast(err.message)}
}

function showView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  window.scrollTo({top:0,behavior:'smooth'});
}

async function logout(){ await api('/api/auth/logout',{method:'POST'}).catch(()=>{}); location.reload(); }

async function api(url,options={},auth=true){
  const res=await fetch(url,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  let data={}; try{data=await res.json()}catch{}
  if(!res.ok){ const e=new Error(data.error||`Erro ${res.status}`); e.status=res.status; throw e; }
  return data;
}

function parseMoney(v){ const n=Number(String(v).replace(/\./g,'').replace(',','.')); if(!Number.isFinite(n)||n<=0)throw new Error('Informe um valor válido.'); return Math.round(n*100); }
function parseSignedMoney(v){ const n=Number(String(v).replace(/\./g,'').replace(',','.')); if(!Number.isFinite(n))throw new Error('Informe um valor válido.'); return Math.round(n*100); }
function labelNature(n){return({business_operating:'Empresa · operação',inventory:'Compras/estoque',business_debt:'Dívida da empresa',personal_withdrawal:'Retirada pessoal',income:'Receita',transfer:'Transferência',unidentified:'Não identificado'})[n]||n}
function empty(text){return `<div class="notice muted">${esc(text)}</div>`}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function toast(text){const t=$('toast');t.textContent=text;t.hidden=false;clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.hidden=true,3200)}
function registerServiceWorker(){if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{})}
