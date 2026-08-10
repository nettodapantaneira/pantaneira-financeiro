const state={dashboard:null,accounts:[],categories:[],obligations:[],debts:[],transactions:[],suppliers:[],purchases:[]};
const $=id=>document.getElementById(id);
const money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(c)||0)/100);
const pct=(a,b)=>b>0?Math.max(0,Math.min(100,Math.round(a/b*100))):0;

boot();

async function boot(){
  registerServiceWorker(); $('loginView').hidden=true; $('app').hidden=true;
  const status=await api('/api/auth/status',{},false).catch(()=>({configured:false,authenticated:false}));
  if(!status.configured){$('loginView').hidden=false;$('loginHint').textContent='Configure APP_PASSWORD e SESSION_SECRET no Cloudflare.';return;}
  if(!status.authenticated){$('loginView').hidden=false;return;}
  $('app').hidden=false; bindEvents(); await loadAll();
}

$('loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/auth/login',{method:'POST',body:JSON.stringify({password:$('password').value})},false);location.reload();}catch(err){toast(err.message);}});

function bindEvents(){
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  $('fab').addEventListener('click',()=>showView('lancar')); $('refreshBtn').addEventListener('click',loadAll); $('logoutBtn').addEventListener('click',logout);
  $('transactionForm').addEventListener('submit',saveTransaction); $('purchaseForm').addEventListener('submit',savePurchase); $('cashForm').addEventListener('submit',reconcileCash);
  $('showProtectionBtn').addEventListener('click',()=>$('protectionDialog').showModal()); $('closeProtection').addEventListener('click',()=>$('protectionDialog').close());
  document.querySelectorAll('#directionSelector button').forEach(b=>b.addEventListener('click',()=>setDirection(b.dataset.value)));
  $('nature').addEventListener('change',renderSelectors); $('amount').addEventListener('input',renderWithdrawalPreview); $('obligation').addEventListener('change',renderWithdrawalPreview);
  $('purchaseTotal').addEventListener('input',renderPurchaseSummary); $('purchasePaidNow').addEventListener('input',renderPurchaseSummary);
  $('newObligationBtn').addEventListener('click',createObligation); $('newDebtBtn').addEventListener('click',createDebt);
}

async function loadAll(){
  try{
    const [dashboard,accounts,categories,obligations,debts,transactions,suppliers,purchases]=await Promise.all([
      api('/api/dashboard'),api('/api/accounts'),api('/api/categories'),api('/api/obligations'),api('/api/debts'),api('/api/transactions?limit=40'),api('/api/suppliers'),api('/api/purchases')
    ]);
    Object.assign(state,{dashboard,accounts:accounts.accounts,categories:categories.categories,obligations:obligations.obligations,debts:debts.debts,transactions:transactions.transactions,suppliers:suppliers.suppliers,purchases:purchases.purchases});
    renderAll();
  }catch(err){if(err.status===401){location.reload();return;}toast(err.message);}
}

function renderAll(){
  const d=state.dashboard;
  $('freeMoney').textContent=money(d.balances.free_strict_cents); $('freeMoney').classList.toggle('negative',d.balances.free_strict_cents<0);
  $('businessBalance').textContent=money(d.balances.business_cents); $('pendingBalance').textContent=money(d.balances.pending_business_cents); $('businessTotal').textContent=money(d.balances.business_total_cents); $('committed').textContent=money(d.balances.committed_strict_cents);
  $('protectTotal').textContent=money(d.daily_protection.total_cents); $('protectBusiness').textContent=money(d.daily_protection.business_cents); $('protectDebt').textContent=money(d.daily_protection.debt_cents); $('protectInventory').textContent=money(d.daily_protection.inventory_cents);
  $('todayIncome').textContent=money(d.today.income_cents); $('todayExpense').textContent=money(d.today.expense_cents); $('todayPersonal').textContent=money(d.today.personal_withdrawal_cents); $('cashBalance').textContent=money(d.balances.cash_cents); $('cashExpected').textContent=money(d.balances.cash_cents);
  $('monthPersonal').textContent=money(d.month.personal_withdrawal_cents); $('monthInventory').textContent=money(d.month.inventory_spent_cents); $('monthDebt').textContent=money(d.month.debt_paid_cents); $('monthDebtReport').textContent=money(d.month.debt_paid_cents); $('oldDebtBalance').textContent=money(d.debt_summary.old_business_balance_cents);
  renderPersonal(); renderObligations(); renderDebts(); renderTransactions(); renderAccounts(); renderProtection(); renderSelectors(); renderPurchases(); renderPurchaseSummary();
}

function renderPersonal(){
  const p=state.dashboard.personal; $('personalUsed').textContent=money(p.withdrawn_cents); $('personalCeiling').textContent=money(p.ceiling_cents); $('personalProgress').style.width=`${pct(p.withdrawn_cents,p.ceiling_cents)}%`;
  $('personalRemaining').textContent=p.ceiling_exceeded_cents>0?`Excedido ${money(p.ceiling_exceeded_cents)}`:`Restante no teto ${money(p.ceiling_remaining_cents)}`;
  $('pensionStatus').textContent=p.pension?`Pensão paga ${money(p.pension.paid_cents)} · falta ${money(p.pension.remaining_cents)}`:'Pensão não cadastrada';
  $('personalAlert').hidden=p.ceiling_exceeded_cents<=0; if(p.ceiling_exceeded_cents>0)$('personalAlert').textContent=`Atenção: retiradas pessoais ultrapassaram o teto fixo em ${money(p.ceiling_exceeded_cents)}.`;
}

function renderObligations(){
  const active=state.obligations.filter(o=>o.active);
  $('obligationsList').innerHTML=active.map(o=>obligationCard(o,false)).join('')||empty('Nenhuma conta cadastrada.');
  const priority=active.filter(o=>o.counts_in_daily_target&&Number(o.remaining_cents)>0).slice(0,6);
  $('obligationPreview').innerHTML=priority.map(o=>obligationCard(o,true)).join('')||empty('Nenhuma obrigação automática pendente.');
  document.querySelectorAll('[data-reserve]').forEach(b=>b.addEventListener('click',()=>addReserve(Number(b.dataset.reserve))));
  document.querySelectorAll('[data-edit-obligation]').forEach(b=>b.addEventListener('click',()=>editObligation(Number(b.dataset.editObligation))));
  document.querySelectorAll('[data-pay-obligation]').forEach(b=>b.addEventListener('click',()=>prepareObligationPayment(Number(b.dataset.payObligation))));
}

function obligationCard(o,compact){
  const target=Number(o.monthly_target_cents||0),paid=Number(o.paid_cents||0),reserved=Number(o.reserved_cents||0),remaining=Number(o.remaining_cents||0); const covered=Math.max(Number(o.reserved_total_cents||0),paid);
  const labels=[]; if(o.due_date)labels.push(`vence ${dateBR(o.due_date)}`); else if(o.due_day)labels.push(`vence dia ${o.due_day}`); if(o.overdue)labels.push('ATRASADA'); if(o.personal_ceiling_member)labels.push('teto pessoal'); if(!o.counts_in_daily_target)labels.push('sem reserva automática');
  return `<article class="list-card ${o.overdue?'overdue':''}"><div class="row top"><div><h3>${esc(o.name)}</h3><p>${labelNature(o.nature)}${labels.length?' · '+labels.join(' · '):''}</p></div><div class="money">${money(target)}</div></div>
    ${target>0?`<div class="progress"><span style="width:${pct(covered,target)}%"></span></div><div class="subline"><span>${paid?`Pago ${money(paid)}`:'Pago R$ 0,00'}${reserved?` · reservado ${money(reserved)}`:''}</span><span>Falta ${money(remaining)}</span></div>`:''}
    ${compact?'':`<div class="actions"><button class="mini-btn" data-pay-obligation="${o.id}">Pagar</button>${o.counts_in_daily_target?`<button class="mini-btn" data-reserve="${o.id}">+ Reservar</button>`:''}<button class="mini-btn" data-edit-obligation="${o.id}">Editar</button></div>`}</article>`;
}

function renderDebts(){
  $('debtsList').innerHTML=state.debts.map(d=>{
    const old=d.debt_kind==='old'||d.debt_kind==='personal_agreement'; const scope=d.scope==='personal'?'Pessoal':'Empresa';
    return `<article class="list-card"><div class="row top"><div><h3>${esc(d.name)}</h3><p>${scope} · ${old?'dívida antiga':'parcela corrente'}${d.creditor?` · ${esc(d.creditor)}`:''}</p></div><div class="money">${d.current_balance_cents==null?'Saldo a informar':money(d.current_balance_cents)}</div></div><div class="subline debt-line"><span>Pago no mês ${money(d.paid_month_cents||0)}</span><span>${d.flexible?'conforme caixa':(d.installment_cents?`parcela ${money(d.installment_cents)}`:'')}</span></div><div class="actions"><button class="mini-btn" data-pay-debt="${d.id}">Registrar pagamento</button><button class="mini-btn" data-edit-debt="${d.id}">Editar saldo</button></div></article>`;
  }).join('')||empty('Nenhuma dívida cadastrada.');
  document.querySelectorAll('[data-pay-debt]').forEach(b=>b.addEventListener('click',()=>prepareDebtPayment(Number(b.dataset.payDebt)))); document.querySelectorAll('[data-edit-debt]').forEach(b=>b.addEventListener('click',()=>editDebt(Number(b.dataset.editDebt))));
}

function renderTransactions(){
  $('transactionsList').innerHTML=state.transactions.map(t=>`<article class="list-card"><div class="row top"><div><h3>${esc(t.description)}</h3><p>${dateTimeBR(t.occurred_at)} · ${esc(t.source_account||t.destination_account||'sem movimentação de conta')}${t.supplier_name?` · ${esc(t.supplier_name)}`:''}${t.status==='pending_reclassification'?' · NÃO IDENTIFICADO':''}</p></div><div class="money ${t.direction==='income'?'positive':''}">${t.direction==='income'?'+':'-'}${money(t.amount_cents)}</div></div><div class="subline"><span>${labelNature(t.nature)}</span><span>${esc(t.category_name||'')}</span></div></article>`).join('')||empty('Nenhum lançamento ainda.');
}

function renderAccounts(){
  const business=state.accounts.filter(a=>a.owner_scope==='business');
  $('accountCards').innerHTML=business.map(a=>`<article class="list-card"><div class="row"><div><h3>${esc(a.name)}</h3><p>${accountType(a.account_type)}${Number(a.available_for_spending)===0?' · a compensar':''}</p></div><div class="right"><div class="money">${money(a.balance_cents)}</div><button class="text-mini" data-adjust-account="${a.id}">ajustar inicial</button></div></div></article>`).join('');
  document.querySelectorAll('[data-adjust-account]').forEach(b=>b.addEventListener('click',()=>adjustOpening(Number(b.dataset.adjustAccount))));
}

function renderPurchases(){
  $('purchasesList').innerHTML=state.purchases.slice(0,15).map(p=>`<article class="list-card"><div class="row top"><div><h3>${esc(p.supplier_name)}</h3><p>${dateBR(p.purchase_date)} · ${p.status==='paid'?'paga':p.status==='partial'?'parcial':'a pagar'}${p.due_date?` · vence ${dateBR(p.due_date)}`:''}</p></div><div class="money">${money(p.total_cents)}</div></div><div class="subline"><span>Pago na compra ${money(p.paid_now_cents)}${Number(p.later_paid_cents)>0?` + depois ${money(p.later_paid_cents)}`:''}</span><span>A prazo ${money(p.payable_cents)}</span></div></article>`).join('')||empty('Nenhuma compra registrada neste mês.');
}

function renderProtection(){
  const items=state.dashboard.daily_protection.items; $('protectionItems').innerHTML=items.map(i=>`<article class="list-card ${i.overdue?'overdue':''}"><div class="row top"><div><h3>${esc(i.name)}</h3><p>${i.overdue?'Atrasada · ':''}${i.days_remaining} dia(s) de operação para cobrir</p></div><div class="money">${money(i.daily_cents)}/dia</div></div><div class="subline"><span>Falta ${money(i.remaining_cents)}</span><span>${labelNature(i.nature)}</span></div></article>`).join('')||empty('Nada para proteger automaticamente hoje.');
}

function renderSelectors(){
  const direction=$('direction').value; let nature=$('nature').value;
  if(direction==='income'){nature='income';$('nature').value='income';} if(direction==='transfer'){nature='transfer';$('nature').value='transfer';}
  $('nature').disabled=direction!=='expense';
  renderCategorySelect(nature); renderObligationSelect(nature); renderDebtSelect(nature); renderSupplierSelect(); renderAccountSelects();
  $('sourceWrap').hidden=direction==='income'; $('destinationWrap').hidden=direction==='expense'; $('obligationWrap').hidden=direction!=='expense'||!['business_operating','inventory','business_debt','personal_withdrawal'].includes(nature);
  $('debtWrap').hidden=direction!=='expense'||!['business_debt','personal_withdrawal'].includes(nature); $('supplierWrap').hidden=direction!=='expense'||nature!=='inventory';
  renderWithdrawalPreview();
}

function renderCategorySelect(nature){const cats=state.categories.filter(c=>c.nature===nature);$('category').innerHTML=`<option value="">${cats.length?'Selecione':'Sem categoria'}</option>`+cats.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');}
function renderObligationSelect(nature){const opts=state.obligations.filter(o=>o.active&&o.nature===nature);$('obligation').innerHTML='<option value="">Nenhum / não se aplica</option>'+opts.map(o=>`<option value="${o.id}">${esc(o.name)} · falta ${money(o.remaining_cents)}</option>`).join('');}
function renderDebtSelect(nature){const scope=nature==='personal_withdrawal'?'personal':'business';const opts=state.debts.filter(d=>d.status==='active'&&d.scope===scope);$('debt').innerHTML='<option value="">Nenhuma / não se aplica</option>'+opts.map(d=>`<option value="${d.id}">${esc(d.name)}${d.current_balance_cents!=null?` · ${money(d.current_balance_cents)}`:''}</option>`).join('');}
function renderSupplierSelect(){const opts='<option value="">Nenhum</option>'+state.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');$('supplier').innerHTML=opts;$('purchaseSupplier').innerHTML='<option value="">Selecione ou cadastre abaixo</option>'+state.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');}
function renderAccountSelects(){const opts=state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} · ${money(a.balance_cents)}</option>`).join('');$('sourceAccount').innerHTML=opts;$('destinationAccount').innerHTML=opts;$('purchaseSource').innerHTML=opts;}

function setDirection(v){$('direction').value=v;document.querySelectorAll('#directionSelector button').forEach(b=>b.classList.toggle('selected',b.dataset.value===v));if(v==='expense'&&['income','transfer'].includes($('nature').value))$('nature').value='business_operating';renderSelectors();}

async function saveTransaction(e){
  e.preventDefault();
  try{
    const amount=parseMoney($('amount').value); const direction=$('direction').value; const nature=$('nature').value;
    if(nature==='personal_withdrawal'&&direction==='expense'){
      const p=state.dashboard.personal,free=state.dashboard.balances.free_strict_cents; const msgs=[];
      if(amount>p.ceiling_remaining_cents)msgs.push(`A retirada ultrapassa em ${money(amount-p.ceiling_remaining_cents)} o teto pessoal restante do mês.`);
      if(free-amount<0)msgs.push(`Depois da retirada, o caixa livre ficará em ${money(free-amount)}.`);
      if(msgs.length&&!confirm(`${msgs.join('\n')}\n\nA retirada é necessária? Clique OK para registrar mesmo assim.`))return;
    }
    const payload={direction,amount_cents:amount,description:$('description').value.trim(),nature,category_id:numOrNull($('category').value),obligation_id:numOrNull($('obligation').value),debt_id:numOrNull($('debt').value),supplier_id:numOrNull($('supplier').value),source_account_id:direction==='income'?null:numOrNull($('sourceAccount').value),destination_account_id:direction==='expense'?null:numOrNull($('destinationAccount').value),payment_method:$('paymentMethod').value,notes:$('notes').value.trim()||null};
    const result=await api('/api/transactions',{method:'POST',body:JSON.stringify(payload)}); toast(result.warnings?.length?`Salvo. ${result.warnings.join(' ')}`:'Lançamento salvo.'); $('transactionForm').reset(); setDirection('expense'); await loadAll(); showView('hoje');
  }catch(err){toast(err.message);}
}

function renderWithdrawalPreview(){
  if(!state.dashboard||$('direction').value!=='expense'||$('nature').value!=='personal_withdrawal'){$('withdrawalPreview').hidden=true;return;}
  const amount=safeParseMoney($('amount').value); const p=state.dashboard.personal; $('withdrawalPreview').hidden=false;
  $('withdrawalPreview').innerHTML=`Teto pessoal do mês: <b>${money(p.ceiling_cents)}</b><br>Já retirado: <b>${money(p.withdrawn_cents)}</b><br>Restante antes desta retirada: <b>${money(p.ceiling_remaining_cents)}</b>${amount?`<br>Após este lançamento: <b>${money(p.ceiling_remaining_cents-amount)}</b>`:''}`;
}

async function savePurchase(e){
  e.preventDefault();
  try{
    const total=parseMoney($('purchaseTotal').value),paid=parseMoney($('purchasePaidNow').value); if(paid>total)throw new Error('O valor pago agora não pode ser maior que a compra.'); const payable=total-paid;
    const supplierId=numOrNull($('purchaseSupplier').value),supplierName=$('purchaseSupplierNew').value.trim(); if(!supplierId&&!supplierName)throw new Error('Informe o fornecedor.'); if(payable>0&&!$('purchaseDueDate').value)throw new Error('Informe o vencimento do valor que ficará a pagar.');
    const payload={supplier_id:supplierId,supplier_name:supplierName||null,total_cents:total,paid_now_cents:paid,source_account_id:paid>0?numOrNull($('purchaseSource').value):null,payment_method:paid>0?$('purchaseMethod').value:null,due_date:payable>0?$('purchaseDueDate').value:null,notes:$('purchaseNotes').value.trim()||null};
    await api('/api/purchases',{method:'POST',body:JSON.stringify(payload)}); toast(payable>0?`Compra salva. ${money(payable)} virou conta a pagar.`:'Compra à vista salva.'); $('purchaseForm').reset(); await loadAll(); showView('hoje');
  }catch(err){toast(err.message);}
}

function renderPurchaseSummary(){
  const total=safeParseMoney($('purchaseTotal').value),paid=safeParseMoney($('purchasePaidNow').value),rest=Math.max(0,total-paid); $('purchaseDueWrap').hidden=rest<=0; $('purchasePaymentWrap').hidden=paid<=0; $('purchaseSummary').hidden=total<=0;
  if(total>0)$('purchaseSummary').innerHTML=`Compra: <b>${money(total)}</b><br>Pago agora: <b>${money(paid)}</b><br>Fica a pagar: <b>${money(rest)}</b>${rest>0?'<br>O valor a prazo entrará automaticamente nos compromissos da empresa.':''}`;
}

async function reconcileCash(e){e.preventDefault();try{const cash=state.accounts.find(a=>a.owner_scope==='business'&&a.account_type==='cash');if(!cash)throw new Error('Conta de dinheiro não encontrada.');const result=await api('/api/cash/reconcile',{method:'POST',body:JSON.stringify({account_id:cash.id,actual_balance_cents:parseMoney($('cashActual').value)})});$('cashResult').hidden=false;$('cashResult').innerHTML=result.difference_cents===0?'Caixa conferido. Nenhuma diferença.':`Esperado ${money(result.expected_cents)} · contado ${money(result.actual_cents)} · diferença <b>${money(result.difference_cents)}</b>. ${result.difference_cents<0?'Criamos uma saída não identificada para você classificar depois.':'Criamos uma entrada não identificada.'}`;await loadAll();}catch(err){toast(err.message);}}

function prepareDebtPayment(id){const d=state.debts.find(x=>x.id===id);if(!d)return;showView('lancar');setDirection('expense');$('nature').value=d.scope==='personal'?'personal_withdrawal':'business_debt';renderSelectors();$('debt').value=String(id);$('description').value=`Pagamento ${d.name}`;$('amount').focus();}
function prepareObligationPayment(id){const o=state.obligations.find(x=>x.id===id);if(!o)return;showView('lancar');setDirection('expense');$('nature').value=o.nature;renderSelectors();$('obligation').value=String(id);if(o.debt_id)$('debt').value=String(o.debt_id);$('description').value=`Pagamento ${o.name}`;$('amount').focus();renderWithdrawalPreview();}

async function addReserve(id){const o=state.obligations.find(x=>x.id===id);if(!o)return;const value=prompt(`Quanto deseja marcar como reservado para ${o.name}?`);if(value==null)return;try{await api('/api/reserves',{method:'POST',body:JSON.stringify({obligation_id:id,amount_cents:parseMoney(value)})});toast('Reserva registrada.');await loadAll();}catch(err){toast(err.message);}}
async function editObligation(id){const o=state.obligations.find(x=>x.id===id);if(!o)return;const value=prompt(`Valor mensal de ${o.name}`,centsToInput(o.monthly_target_cents));if(value==null)return;const due=prompt('Dia de vencimento (vazio se não houver)',o.due_day||'');try{await api(`/api/obligations/${id}`,{method:'PATCH',body:JSON.stringify({monthly_target_cents:parseMoney(value),due_day:due||null})});toast('Conta atualizada.');await loadAll();}catch(err){toast(err.message);}}
async function createObligation(){const name=prompt('Nome da conta/compromisso');if(!name)return;const scope=confirm('É uma despesa pessoal? OK = pessoal / Cancelar = empresa')?'personal':'business';const nature=scope==='personal'?'personal_withdrawal':'business_operating';const value=prompt('Valor mensal','0,00');if(value==null)return;const due=prompt('Dia de vencimento (opcional)','');try{await api('/api/obligations',{method:'POST',body:JSON.stringify({name,scope,nature,monthly_target_cents:parseMoney(value),due_day:due||null,counts_in_daily_target:scope==='business',personal_ceiling_member:false})});toast('Conta cadastrada.');await loadAll();}catch(err){toast(err.message);}}
async function editDebt(id){const d=state.debts.find(x=>x.id===id);if(!d)return;const value=prompt(`Saldo atual de ${d.name}`,d.current_balance_cents==null?'':centsToInput(d.current_balance_cents));if(value==null)return;try{await api(`/api/debts/${id}`,{method:'PATCH',body:JSON.stringify({current_balance_cents:value.trim()?parseMoney(value):null})});toast('Saldo da dívida atualizado.');await loadAll();}catch(err){toast(err.message);}}
async function createDebt(){const name=prompt('Nome da dívida antiga / credor');if(!name)return;const value=prompt('Saldo atual conhecido (pode deixar vazio)','');const personal=confirm('Essa dívida é pessoal? OK = pessoal / Cancelar = empresa');try{await api('/api/debts',{method:'POST',body:JSON.stringify({name,creditor:name,scope:personal?'personal':'business',current_balance_cents:value.trim()?parseMoney(value):null,debt_kind:personal?'personal_agreement':'old',flexible:true})});toast('Dívida antiga cadastrada.');await loadAll();}catch(err){toast(err.message);}}
async function adjustOpening(id){const a=state.accounts.find(x=>x.id===id);if(!a)return;const value=prompt(`Saldo inicial de ${a.name}. Use apenas para corrigir a fotografia inicial.`,centsToInput(a.opening_balance_cents));if(value==null)return;try{await api(`/api/accounts/${id}/opening-balance`,{method:'POST',body:JSON.stringify({opening_balance_cents:parseMoney(value)})});toast('Saldo inicial atualizado.');await loadAll();}catch(err){toast(err.message);}}

function showView(name){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));window.scrollTo({top:0,behavior:'smooth'});}
async function logout(){await api('/api/auth/logout',{method:'POST'});location.reload();}
async function api(url,options={},auth=true){const r=await fetch(url,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});let data={};try{data=await r.json();}catch{}if(!r.ok){const e=new Error(data.error||`Erro ${r.status}`);e.status=r.status;throw e;}return data;}
function parseMoney(v){const s=String(v??'').trim().replace(/\s/g,'');if(!s)throw new Error('Informe o valor.');let normalized=s;if(s.includes(','))normalized=s.replace(/\./g,'').replace(',','.');const n=Number(normalized);if(!Number.isFinite(n)||n<0)throw new Error('Valor inválido.');return Math.round(n*100);}
function safeParseMoney(v){try{return parseMoney(v);}catch{return 0;}}
function centsToInput(c){return (Number(c||0)/100).toFixed(2).replace('.',',');}
function numOrNull(v){return v?Number(v):null;}
function labelNature(n){return ({business_operating:'Empresa · operação',inventory:'Compra/estoque',business_debt:'Dívida empresa',personal_withdrawal:'Retirada pessoal',income:'Receita',transfer:'Transferência',unidentified:'Não identificado'})[n]||n;}
function accountType(t){return ({bank:'Conta bancária',cash:'Dinheiro físico',card:'Cartão',other:'Outro ativo'})[t]||t;}
function dateTimeBR(v){return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Cuiaba',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v));}
function dateBR(v){const s=String(v).slice(0,10);const [y,m,d]=s.split('-');return d&&m&&y?`${d}/${m}/${y}`:s;}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function empty(t){return `<div class="notice muted">${esc(t)}</div>`;}
let toastTimer;function toast(t){$('toast').textContent=t;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4200);}
function registerServiceWorker(){if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});}
