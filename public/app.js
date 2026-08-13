const state={dashboard:null,analysis:null,analysisPeriod:null,periods:[],accounts:[],categories:[],obligations:[],debts:[],transactions:[],historyTransactions:[],suppliers:[],purchases:[],analysisSegments:[],homeSegments:[],bulkTransactions:[]};
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
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  $('fab').addEventListener('click',()=>showView('lancar')); $('refreshBtn').addEventListener('click',loadAll); $('logoutBtn').addEventListener('click',logout);
  $('quickIncomeBtn')?.addEventListener('click',()=>prepareQuickMovement('income')); $('quickExpenseBtn')?.addEventListener('click',()=>prepareQuickMovement('expense')); $('quickTransferBtn')?.addEventListener('click',()=>prepareQuickMovement('transfer')); $('quickPurchaseHomeBtn')?.addEventListener('click',()=>{showView('lancar');setTimeout(()=>$('purchaseSection')?.scrollIntoView({behavior:'smooth',block:'start'}),80);});
  $('openMovementsHomeBtn')?.addEventListener('click',()=>showView('lancar')); $('openAnalysisHomeBtn')?.addEventListener('click',()=>showView('relatorios')); $('openCategoryAnalysisHomeBtn')?.addEventListener('click',()=>showView('relatorios'));
  $('openAccountsOverviewBtn')?.addEventListener('click',()=>showView('contas')); $('openHistoryBtn')?.addEventListener('click',()=>showView('antes')); $('backToMovementsBtn')?.addEventListener('click',()=>showView('lancar')); $('jumpPurchaseBtn')?.addEventListener('click',()=>{showView('lancar');setTimeout(()=>$('purchaseSection')?.scrollIntoView({behavior:'smooth',block:'start'}),80);});
  $('bulkEditBtn')?.addEventListener('click',openBulkReclassPage); $('backFromBulkBtn')?.addEventListener('click',()=>showView('lancar')); $('bulkSearchBtn')?.addEventListener('click',searchBulkTransactions); $('bulkClearBtn')?.addEventListener('click',clearBulkFilters); $('bulkSearch')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchBulkTransactions();}}); $('bulkSelectAll')?.addEventListener('change',toggleBulkSelectAll); $('bulkNature')?.addEventListener('change',renderBulkClassificationSelectors); $('bulkReplaceDescription')?.addEventListener('change',()=>{$('bulkDescription').disabled=!$('bulkReplaceDescription').checked;}); $('bulkAgreementPreset')?.addEventListener('click',fillCorporateAgreementPreset); $('bulkApplyBtn')?.addEventListener('click',applyBulkReclassification); $('bulkCorrectAccountBtn')?.addEventListener('click',applyBulkAccountCorrection); document.querySelectorAll('[data-bulk-range]').forEach(b=>b.addEventListener('click',()=>setBulkRange(b.dataset.bulkRange)));
  $('transactionForm').addEventListener('submit',saveTransaction); $('openingHistoryForm').addEventListener('submit',saveOpeningHistory); $('purchaseForm').addEventListener('submit',savePurchase); $('cashForm').addEventListener('submit',reconcileCash);
  $('showProtectionBtn').addEventListener('click',()=>$('protectionDialog').showModal()); $('closeProtection').addEventListener('click',()=>$('protectionDialog').close());
  document.querySelectorAll('#directionSelector button').forEach(b=>b.addEventListener('click',()=>setDirection(b.dataset.value))); document.querySelectorAll('#openingDirectionSelector button').forEach(b=>b.addEventListener('click',()=>setOpeningDirection(b.dataset.value)));
  $('nature').addEventListener('change',renderSelectors); $('openingNature').addEventListener('change',renderOpeningSelectors); $('amount').addEventListener('input',renderWithdrawalPreview); $('obligation').addEventListener('change',renderWithdrawalPreview);
  $('purchaseTotal').addEventListener('input',renderPurchaseSummary); $('purchasePaidNow').addEventListener('input',renderPurchaseSummary); $('purchaseNature').addEventListener('change',renderPurchaseCategory);
  $('newObligationBtn').addEventListener('click',createObligation); $('newDebtBtn').addEventListener('click',createDebt);
  $('closeEditTransaction').addEventListener('click',()=>$('editTransactionDialog').close()); $('editTransactionForm').addEventListener('submit',saveTransactionEdit); $('voidTransactionBtn').addEventListener('click',voidCurrentTransaction);
  $('editDirection').addEventListener('change',renderEditSelectors); $('editNature').addEventListener('change',renderEditSelectors);
  $('manageCategoriesBtn').addEventListener('click',openCategoryManager); $('manageOpeningCategoriesBtn').addEventListener('click',openCategoryManager); $('managePurchaseCategoriesBtn').addEventListener('click',openCategoryManager); $('manageCategoriesSummaryBtn').addEventListener('click',openCategoryManager);
  $('closeCategoryDialog').addEventListener('click',()=>$('categoryDialog').close()); $('categoryForm').addEventListener('submit',saveCategory); $('categoryNature').addEventListener('change',renderCategoryParentOptions); $('cancelCategoryEdit').addEventListener('click',resetCategoryForm);
  $('closeDetailDialog').addEventListener('click',()=>$('detailDialog').close());
  bindDetailTrigger('todayPersonalMetric',()=>openTransactionDetail({title:'Retiradas pessoais de hoje',today:true,direction:'expense',nature:'personal_withdrawal'}));
  bindDetailTrigger('todayExpenseMetric',()=>openTransactionDetail({title:'Saídas de hoje',today:true,direction:'expense'}));
  bindDetailTrigger('todayIncomeMetric',()=>openTransactionDetail({title:'Entradas de hoje',today:true,direction:'income'}));
  bindDetailTrigger('personalMonthCard',()=>openTransactionDetail({title:'Retiradas pessoais do mês',period_key:state.dashboard?.period_key,direction:'expense',nature:'personal_withdrawal'}));
  bindDetailTrigger('monthPersonalMetric',()=>openTransactionDetail({title:'Retiradas pessoais do mês',period_key:state.analysisPeriod||state.dashboard?.period_key,direction:'expense',nature:'personal_withdrawal'}));
  bindDetailTrigger('monthIncomeMetric',()=>openTransactionDetail({title:'Entradas do mês',period_key:state.dashboard?.period_key,direction:'income'}));
  bindDetailTrigger('monthExpenseMetric',()=>openTransactionDetail({title:'Todas as saídas do mês',period_key:state.dashboard?.period_key,direction:'expense'}));
  bindDetailTrigger('monthExpenseReportMetric',()=>openTransactionDetail({title:'Todas as saídas do mês',period_key:state.analysisPeriod||state.dashboard?.period_key,direction:'expense'}));
  $('analysisIncomeDetail').addEventListener('click',()=>openTransactionDetail({title:'Entradas do mês',period_key:state.analysisPeriod||state.dashboard?.period_key,direction:'income'}));
  $('analysisExpenseDetail').addEventListener('click',()=>openTransactionDetail({title:'Saídas do mês',period_key:state.analysisPeriod||state.dashboard?.period_key,direction:'expense'}));
  $('analysisPeriod').addEventListener('change',()=>loadAnalysisPeriod($('analysisPeriod').value));
  $('categoryDonut').addEventListener('click',openDonutSegment); $('homeCategoryDonut')?.addEventListener('click',openHomeDonutSegment);
  $('categoryDonut').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(state.analysisSegments[0])openCategoryDetail(state.analysisSegments[0].id,state.analysisSegments[0].label);}});
}

async function loadAll(){
  try{
    const [dashboard,accounts,categories,obligations,debts,transactions,historyTransactions,suppliers,purchases,periods]=await Promise.all([
      api('/api/dashboard'),api('/api/accounts'),api('/api/categories?all=1'),api('/api/obligations'),api('/api/debts'),api('/api/transactions?limit=160'),api('/api/transactions?limit=200&opening_history=1'),api('/api/suppliers'),api('/api/purchases'),api('/api/periods')
    ]);
    const analysisPeriod=state.analysisPeriod||dashboard.period_key; const analysis=await api(`/api/month-summary?period_key=${encodeURIComponent(analysisPeriod)}`);
    Object.assign(state,{dashboard,analysis,analysisPeriod,periods:periods.periods||[],accounts:accounts.accounts,categories:categories.categories,obligations:obligations.obligations,debts:debts.debts,transactions:transactions.transactions,historyTransactions:historyTransactions.transactions,suppliers:suppliers.suppliers,purchases:purchases.purchases});
    renderAll();
  }catch(err){if(err.status===401){location.reload();return;}toast(err.message);}
}

function renderAll(){
  const d=state.dashboard;
  const horizon=d.cash_horizon||{};
  const currentFree=Number(horizon.current_free_cents??d.balances.free_strict_cents??0);
  const currentCommitted=Number(horizon.current_commitments_cents??d.balances.committed_strict_cents??0);
  const futureCommitted=Number(horizon.future_commitments_cents??d.balances.future_committed_strict_cents??0);
  const futureDaily=Number(horizon.future_daily_reserve_cents??d.daily_protection.total_cents??0);
  $('freeMoney').textContent=money(currentFree); $('freeMoney').classList.toggle('negative',currentFree<0); $('freeMoney').classList.toggle('positive',currentFree>=0);
  $('businessBalance').textContent=money(d.balances.business_cents); $('pendingBalance').textContent=money(d.balances.pending_business_cents); $('businessTotal').textContent=money(d.balances.business_total_cents); $('committed').textContent=money(currentCommitted);
  if($('futureCommitted'))$('futureCommitted').textContent=money(futureCommitted);
  if($('futureReserveDaily'))$('futureReserveDaily').textContent=`${money(futureDaily)}/dia`;
  if($('currentPeriodLabel'))$('currentPeriodLabel').textContent=`${periodLabelClient(d.period_key).toUpperCase()} · A COBRIR`;
  if($('futurePeriodLabel'))$('futurePeriodLabel').textContent=futureCommitted>0?'meses seguintes · ainda não vencidos':'nenhum compromisso futuro pendente';
  $('protectTotal').textContent=`${money(futureDaily)}/dia`; $('protectBusiness').textContent=money(d.daily_protection.business_cents); $('protectDebt').textContent=money(d.daily_protection.debt_cents); $('protectInventory').textContent=money(d.daily_protection.inventory_cents);
  $('todayIncome').textContent=money(d.today.income_cents); $('todayExpense').textContent=money(d.today.expense_cents); $('todayPersonal').textContent=money(d.today.personal_withdrawal_cents); $('cashBalance').textContent=money(d.balances.cash_cents); $('cashExpected').textContent=money(d.balances.cash_cents);
  $('monthIncome').textContent=money(d.month.income_cents); $('monthExpense').textContent=money(d.month.expense_cents); $('monthNet').textContent=money(d.month.net_cents); $('monthNet').classList.toggle('negative',d.month.net_cents<0); $('monthNet').classList.toggle('positive',d.month.net_cents>=0);
  $('monthIncomeReport').textContent=money(d.month.sales_cents||0); if($('monthOldReceipts'))$('monthOldReceipts').textContent=money(d.month.old_receipts_cents||0); $('monthExpenseReport').textContent=money(d.month.expense_cents);
  $('monthPersonal').textContent=money(d.month.personal_withdrawal_cents); $('monthInventory').textContent=money(d.month.inventory_spent_cents); $('monthDebt').textContent=money(d.month.debt_paid_cents); $('monthDebtReport').textContent=money(d.month.debt_paid_cents); $('oldDebtBalance').textContent=money(d.debt_summary.old_business_balance_cents);
  renderPersonal(); renderObligations(); renderDebts(); renderTransactions(); renderOpeningTransactions(); renderAccounts(); renderAccountOverview(); renderProtection(); renderSelectors(); renderOpeningSelectors(); renderPurchases(); renderPurchaseCategory(); renderPurchaseSummary(); renderAnalysisDashboard(); renderHomeDashboard();
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
  const currentKey=state.dashboard.period_key;
  const priority=active.filter(o=>o.counts_in_daily_target&&Number(o.remaining_cents)>0&&String(o.target_period_key||currentKey)>currentKey).slice(0,6);
  $('obligationPreview').innerHTML=priority.map(o=>obligationCard(o,true)).join('')||empty('Nenhum compromisso de ciclo futuro para reservar agora.');
  document.querySelectorAll('[data-reserve]').forEach(b=>b.addEventListener('click',()=>addReserve(Number(b.dataset.reserve))));
  document.querySelectorAll('[data-edit-obligation]').forEach(b=>b.addEventListener('click',()=>editObligation(Number(b.dataset.editObligation))));
  document.querySelectorAll('[data-pay-obligation]').forEach(b=>b.addEventListener('click',()=>prepareObligationPayment(Number(b.dataset.payObligation))));
  document.querySelectorAll('[data-opening-paid]').forEach(b=>b.addEventListener('click',()=>markPaidBeforeOpening(Number(b.dataset.openingPaid))));
}

function obligationCard(o,compact){
  const target=Number(o.monthly_target_cents||0),paid=Number(o.paid_cents||0),reserved=Number(o.reserved_cents||0),remaining=Number(o.remaining_cents||0); const covered=Math.max(Number(o.reserved_total_cents||0),paid);
  const labels=[];
  if(o.target_period_key)labels.push(`referência ${periodLabelClient(o.target_period_key)}`);
  if(o.due_date)labels.push(`vence ${dateBR(o.due_date)}`); else if(o.due_day&&o.target_period_key)labels.push(`vence ${dateBR(dueDateForPeriodClient(o.target_period_key,o.due_day))}`); else if(o.due_day)labels.push(`vence dia ${o.due_day}`);
  const currentKey=state.dashboard?.period_key; const rolled=Boolean(currentKey&&o.target_period_key&&o.target_period_key!==currentKey);
  if(rolled&&Number(o.paid_current_cents||0)>=target&&target>0)labels.push(`${periodLabelClient(currentKey)} quitado`);
  if(o.overdue)labels.push('ATRASADA'); if(o.personal_ceiling_member)labels.push('teto pessoal'); if(!o.counts_in_daily_target)labels.push('sem reserva automática');
  return `<article class="list-card ${o.overdue?'overdue':''}"><div class="row top"><div><h3>${esc(o.name)}</h3><p>${labelNature(o.nature)}${labels.length?' · '+labels.join(' · '):''}</p></div><div class="money">${money(target)}</div></div>
    ${target>0?`<div class="progress"><span style="width:${pct(covered,target)}%"></span></div><div class="subline"><span>${paid?`Pago ${money(paid)}`:'Pago R$ 0,00'}${reserved?` · reservado ${money(reserved)}`:''}</span><span>Falta ${money(remaining)}</span></div>`:''}
    ${compact?'':`<div class="actions"><button class="mini-btn" data-pay-obligation="${o.id}">Pagar agora</button>${remaining>0?`<button class="mini-btn" data-opening-paid="${o.id}">Já pago antes do app</button>`:''}${o.counts_in_daily_target?`<button class="mini-btn" data-reserve="${o.id}">+ Reservar</button>`:''}<button class="mini-btn" data-edit-obligation="${o.id}">Editar</button></div>`}</article>`;
}

function renderDebts(){
  $('debtsList').innerHTML=state.debts.map(d=>{
    const old=d.debt_kind==='old'||d.debt_kind==='personal_agreement'; const scope=d.scope==='personal'?'Pessoal':'Empresa';
    return `<article class="list-card"><div class="row top"><div><h3>${esc(d.name)}</h3><p>${scope} · ${old?'dívida antiga':'parcela corrente'}${d.creditor?` · ${esc(d.creditor)}`:''}</p></div><div class="money">${d.current_balance_cents==null?'Saldo a informar':money(d.current_balance_cents)}</div></div><div class="subline debt-line"><span>Pago no mês ${money(d.paid_month_cents||0)}</span><span>${d.flexible?'conforme caixa':(d.installment_cents?`parcela ${money(d.installment_cents)}`:'')}</span></div><div class="actions"><button class="mini-btn" data-pay-debt="${d.id}">Registrar pagamento</button><button class="mini-btn" data-edit-debt="${d.id}">Editar saldo</button></div></article>`;
  }).join('')||empty('Nenhuma dívida cadastrada.');
  document.querySelectorAll('[data-pay-debt]').forEach(b=>b.addEventListener('click',()=>prepareDebtPayment(Number(b.dataset.payDebt)))); document.querySelectorAll('[data-edit-debt]').forEach(b=>b.addEventListener('click',()=>editDebt(Number(b.dataset.editDebt))));
}

function renderTransactions(){
  $('transactionsList').innerHTML=state.transactions.map(t=>transactionCard(t,false)).join('')||empty('Nenhum lançamento ainda.');
  document.querySelectorAll('#transactionsList [data-edit-transaction]').forEach(b=>b.addEventListener('click',()=>openTransactionEditor(Number(b.dataset.editTransaction))));
}

function renderOpeningTransactions(){
  const items=state.historyTransactions||[];
  $('openingTransactionsList').innerHTML=items.map(t=>transactionCard(t,true)).join('')||empty('Ainda não informou gastos ou entradas anteriores à implantação.');
  document.querySelectorAll('#openingTransactionsList [data-edit-transaction]').forEach(b=>b.addEventListener('click',()=>openTransactionEditor(Number(b.dataset.editTransaction))));
}

function transactionCard(t,openingOnly){
  const isVoid=t.status==='void',opening=Number(t.opening_history)===1;
  const account=t.source_account||t.destination_account||(opening?'histórico · origem não informada':'sem movimentação de conta');
  const when=openingOnly?dateBR(t.occurred_at):dateTimeBR(t.occurred_at);
  const meta=[when,account,t.supplier_name||null,t.status==='pending_reclassification'?'NÃO IDENTIFICADO':null,opening&&!openingOnly?'ANTES DO APP':null,isVoid?'CANCELADO':null].filter(Boolean).map(esc).join(' · ');
  const sign=t.direction==='income'?'+':t.direction==='transfer'?'↔':'-';
  return `<article class="list-card ${isVoid?'voided':''}"><div class="row top"><div><h3>${esc(t.description)}</h3><p>${meta}</p></div><div class="money ${t.direction==='income'?'positive':''}">${sign}${money(t.amount_cents)}</div></div><div class="subline"><span>${labelNature(t.nature)}</span><span>${esc(t.category_name||'')}</span></div>${isVoid?'':`<div class="edit-actions"><button class="mini-btn" data-edit-transaction="${t.id}">Editar</button></div>`}</article>`;
}

function renderAccounts(){
  const business=state.accounts.filter(a=>a.owner_scope==='business');
  $('accountCards').innerHTML=business.map(a=>`<article class="list-card"><div class="row"><div><h3>${esc(a.name)}</h3><p>${accountType(a.account_type)}${Number(a.available_for_spending)===0?' · a compensar':''}</p></div><div class="right"><div class="money">${money(a.balance_cents)}</div>${Number(a.available_for_spending)===1&&a.account_type!=='cash'?`<button class="text-mini" data-reconcile-account="${a.id}">conciliar saldo</button>`:a.account_type==='cash'?'<span class="muted small">use Conferir dinheiro</span>':'<span class="muted small">aguardando compensação</span>'}</div></div></article>`).join('');
  document.querySelectorAll('[data-reconcile-account]').forEach(b=>b.addEventListener('click',()=>reconcileAccount(Number(b.dataset.reconcileAccount))));
}

function renderAccountOverview(){
  const host=$('accountOverview');if(!host)return;const business=state.accounts.filter(a=>a.owner_scope==='business');
  host.innerHTML=business.map(a=>{const pending=Number(a.available_for_spending)===0;const cls=a.account_type==='cash'?'cash':pending?'pending':'bank';return `<button type="button" class="account-mini ${cls}" data-account-overview="${a.id}"><span class="account-mini-icon">${a.account_type==='cash'?'R$':pending?'⌛':'●'}</span><span class="account-mini-copy"><small>${esc(a.name)}</small><strong>${money(a.balance_cents)}</strong><em>${pending?'a compensar':a.account_type==='cash'?'em dinheiro':'disponível'}</em></span></button>`;}).join('')||'<div class="notice muted">Nenhuma conta cadastrada.</div>';
  host.querySelectorAll('[data-account-overview]').forEach(b=>b.addEventListener('click',()=>showView('contas')));
}

function renderPurchases(){
  $('purchasesList').innerHTML=state.purchases.slice(0,15).map(p=>`<article class="list-card"><div class="row top"><div><h3>${esc(p.supplier_name)}</h3><p>${dateBR(p.purchase_date)} · ${esc(p.category_name||'Sem categoria')} · ${p.status==='paid'?'paga':p.status==='partial'?'parcial':'a pagar'}${p.due_date?` · vence ${dateBR(p.due_date)}`:''}</p></div><div class="money">${money(p.total_cents)}</div></div><div class="subline"><span>Pago na compra ${money(p.paid_now_cents)}${Number(p.later_paid_cents)>0?` + depois ${money(p.later_paid_cents)}`:''}</span><span>A prazo ${money(p.payable_cents)}</span></div></article>`).join('')||empty('Nenhuma compra registrada neste mês.');
}

function renderProtection(){
  const items=state.dashboard.daily_protection.items; $('protectionItems').innerHTML=items.map(i=>{const ref=i.target_period_key?`Referência ${periodLabelClient(i.target_period_key)} · `:'';const due=i.effective_due_date?`vence ${dateBR(i.effective_due_date)} · `:'';return `<article class="list-card ${i.overdue?'overdue':''}"><div class="row top"><div><h3>${esc(i.name)}</h3><p>${i.overdue?'Atrasada · ':''}${ref}${due}${i.days_remaining} dia(s) de operação para cobrir</p></div><div class="money">${money(i.daily_cents)}/dia</div></div><div class="subline"><span>Falta ${money(i.remaining_cents)}</span><span>${labelNature(i.nature)}</span></div></article>`;}).join('')||empty('Nada para reservar automaticamente hoje.');
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

function categoryLabel(c){return c.parent_name?`${c.parent_name} › ${c.name}`:c.name;}
function activeCategories(nature){return state.categories.filter(c=>Number(c.active)!==0&&c.nature===nature);}
function renderCategorySelect(nature){const cats=activeCategories(nature);$('category').innerHTML=`<option value="">${cats.length?'Selecione':'Sem categoria'}</option>`+cats.map(c=>`<option value="${c.id}">${esc(categoryLabel(c))}</option>`).join('');}
function renderObligationSelect(nature){const opts=state.obligations.filter(o=>o.active&&o.nature===nature);$('obligation').innerHTML='<option value="">Nenhum / não se aplica</option>'+opts.map(o=>`<option value="${o.id}">${esc(o.name)} · falta ${money(o.remaining_cents)}</option>`).join('');}
function renderDebtSelect(nature){const scope=nature==='personal_withdrawal'?'personal':'business';const opts=state.debts.filter(d=>d.status==='active'&&d.scope===scope);$('debt').innerHTML='<option value="">Nenhuma / não se aplica</option>'+opts.map(d=>`<option value="${d.id}">${esc(d.name)}${d.current_balance_cents!=null?` · ${money(d.current_balance_cents)}`:''}</option>`).join('');}
function renderSupplierSelect(){const opts='<option value="">Nenhum</option>'+state.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');$('supplier').innerHTML=opts;$('purchaseSupplier').innerHTML='<option value="">Selecione ou cadastre abaixo</option>'+state.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');}
function renderAccountSelects(){const opts=state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} · ${money(a.balance_cents)}</option>`).join('');$('sourceAccount').innerHTML=opts;$('destinationAccount').innerHTML=opts;$('purchaseSource').innerHTML=opts;}
function renderPurchaseCategory(){const nature=$('purchaseNature').value;const cats=activeCategories(nature);$('purchaseCategory').innerHTML='<option value="">Selecione</option>'+cats.map(c=>`<option value="${c.id}">${esc(categoryLabel(c))}</option>`).join('');}

function setOpeningDirection(v){
  $('openingDirection').value=v; document.querySelectorAll('#openingDirectionSelector button').forEach(b=>b.classList.toggle('selected',b.dataset.value===v));
  if(v==='income')$('openingNature').value='income'; else if($('openingNature').value==='income')$('openingNature').value='personal_withdrawal';
  renderOpeningSelectors();
}
function renderOpeningSelectors(){
  const direction=$('openingDirection').value; let nature=$('openingNature').value;
  if(direction==='income'){nature='income';$('openingNature').value='income';}
  $('openingNature').disabled=direction==='income';
  const cats=activeCategories(nature); $('openingCategory').innerHTML=`<option value="">${cats.length?'Selecione':'Sem categoria'}</option>`+cats.map(c=>`<option value="${c.id}">${esc(categoryLabel(c))}</option>`).join('');
  const obligations=direction==='expense'?state.obligations.filter(o=>o.active&&o.nature===nature):[]; $('openingObligation').innerHTML='<option value="">Nenhum / não se aplica</option>'+obligations.map(o=>`<option value="${o.id}">${esc(o.name)} · falta ${money(o.remaining_cents)}</option>`).join('');
  $('openingObligationWrap').hidden=direction!=='expense';
  $('openingAccountLabel').textContent=direction==='income'?'Onde entrou? (se lembrar)':'De onde saiu? (se lembrar)';
  $('openingAccount').innerHTML='<option value="">Não lembro / não informar</option>'+state.accounts.filter(a=>a.owner_scope==='business').map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');
}

async function saveOpeningHistory(e){
  e.preventDefault();
  try{
    const direction=$('openingDirection').value,nature=$('openingNature').value,amount=parseMoney($('openingAmount').value),date=$('openingDate').value;
    if(!date||date<'2026-07-01'||date>'2026-08-10')throw new Error('A data histórica deve ficar entre 01/07 e 10/08/2026.');
    const openingCategoryId=numOrNull($('openingCategory').value); if(!openingCategoryId)throw new Error('Escolha ou cadastre uma categoria.');
    const payload={direction,amount_cents:amount,description:$('openingDescription').value.trim(),nature,category_id:openingCategoryId,obligation_id:direction==='expense'?numOrNull($('openingObligation').value):null,account_id:numOrNull($('openingAccount').value),paid_date:date,payment_method:$('openingPaymentMethod').value,notes:$('openingNotes').value.trim()||null};
    await api('/api/opening-history',{method:'POST',body:JSON.stringify(payload)}); toast('Histórico salvo sem alterar os saldos atuais.'); $('openingHistoryForm').reset(); $('openingDate').value='2026-08-10'; setOpeningDirection('expense'); await loadAll(); showView('antes');
  }catch(err){toast(err.message);}
}

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
    const categoryId=direction==='transfer'?null:numOrNull($('category').value); if(direction!=='transfer'&&!categoryId)throw new Error('Escolha ou cadastre uma categoria.');
    const payload={direction,amount_cents:amount,description:$('description').value.trim(),nature,category_id:categoryId,obligation_id:numOrNull($('obligation').value),debt_id:numOrNull($('debt').value),supplier_id:numOrNull($('supplier').value),source_account_id:direction==='income'?null:numOrNull($('sourceAccount').value),destination_account_id:direction==='expense'?null:numOrNull($('destinationAccount').value),payment_method:$('paymentMethod').value,notes:$('notes').value.trim()||null};
    const result=await api('/api/transactions',{method:'POST',body:JSON.stringify(payload)}); toast(result.warnings?.length?`Salvo. ${result.warnings.join(' ')}`:'Lançamento salvo.'); $('transactionForm').reset(); setDirection('expense'); await loadAll(); showView('hoje');
  }catch(err){toast(err.message);}
}

function renderWithdrawalPreview(){
  if(!state.dashboard||$('direction').value!=='expense'||$('nature').value!=='personal_withdrawal'){$('withdrawalPreview').hidden=true;return;}
  const amount=safeParseMoney($('amount').value); const p=state.dashboard.personal; $('withdrawalPreview').hidden=false;
  $('withdrawalPreview').innerHTML=`Teto pessoal do mês: <b>${money(p.ceiling_cents)}</b><br>Já retirado: <b>${money(p.withdrawn_cents)}</b><br>Restante antes desta retirada: <b>${money(p.ceiling_remaining_cents)}</b>${amount?`<br>Após este lançamento: <b>${money(p.ceiling_remaining_cents-amount)}</b>`:''}`;
}


function openTransactionEditor(id){
  const t=state.transactions.find(x=>Number(x.id)===Number(id)); if(!t)return;
  $('editTransactionId').value=String(t.id); $('editOpeningNotice').hidden=!Number(t.opening_history);
  $('editDate').value=String(t.occurred_at).slice(0,10); $('editDirection').value=t.direction; $('editAmount').value=centsToInput(t.amount_cents); $('editDescription').value=t.description||''; $('editNature').value=t.nature; $('editPaymentMethod').value=t.payment_method||'other'; $('editNotes').value=t.notes||'';
  $('editDirection').disabled=Boolean(Number(t.opening_history))?false:false;
  renderEditSelectors(t);
  $('editTransactionDialog').showModal();
}

function renderEditSelectors(selected=null){
  const id=Number($('editTransactionId').value||0); const t=selected||state.transactions.find(x=>Number(x.id)===id)||{}; const opening=Boolean(Number(t.opening_history));
  let direction=$('editDirection').value,nature=$('editNature').value;
  if(direction==='income'){nature='income';$('editNature').value='income';} else if(direction==='transfer'){nature='transfer';$('editNature').value='transfer';} else if(['income','transfer','unidentified'].includes(nature)){nature='business_operating';$('editNature').value=nature;}
  if(opening&&direction==='transfer'){direction='expense';$('editDirection').value='expense';nature='business_operating';$('editNature').value=nature;}
  $('editNature').disabled=direction!=='expense';
  const cats=activeCategories(nature); $('editCategory').innerHTML='<option value="">Sem categoria</option>'+cats.map(c=>`<option value="${c.id}">${esc(categoryLabel(c))}</option>`).join('');
  const obs=state.obligations.filter(o=>o.active&&o.nature===nature); $('editObligation').innerHTML='<option value="">Nenhum / não se aplica</option>'+obs.map(o=>`<option value="${o.id}">${esc(o.name)} · falta ${money(o.remaining_cents)}</option>`).join('');
  const debtScope=nature==='personal_withdrawal'?'personal':'business'; const debts=state.debts.filter(d=>d.scope===debtScope&&(d.status==='active'||Number(d.id)===Number(t.debt_id))); $('editDebt').innerHTML='<option value="">Nenhuma / não se aplica</option>'+debts.map(d=>`<option value="${d.id}">${esc(d.name)}${d.current_balance_cents!=null?` · ${money(d.current_balance_cents)}`:''}</option>`).join('');
  const accounts=state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)} · ${money(a.balance_cents)}</option>`).join(''); $('editSourceAccount').innerHTML=accounts; $('editDestinationAccount').innerHTML=accounts;
  $('editSourceWrap').hidden=opening||direction==='income'; $('editDestinationWrap').hidden=opening||direction==='expense'; $('editObligationWrap').hidden=direction!=='expense'||!['business_operating','inventory','business_debt','personal_withdrawal'].includes(nature); $('editDebtWrap').hidden=opening||direction!=='expense'||!['business_debt','personal_withdrawal'].includes(nature);
  if(t.category_id!=null && [...$('editCategory').options].some(o=>Number(o.value)===Number(t.category_id)))$('editCategory').value=String(t.category_id);
  if(t.obligation_id!=null && [...$('editObligation').options].some(o=>Number(o.value)===Number(t.obligation_id)))$('editObligation').value=String(t.obligation_id);
  if(t.debt_id!=null && [...$('editDebt').options].some(o=>Number(o.value)===Number(t.debt_id)))$('editDebt').value=String(t.debt_id);
  if(t.source_account_id!=null)$('editSourceAccount').value=String(t.source_account_id); if(t.destination_account_id!=null)$('editDestinationAccount').value=String(t.destination_account_id);
  $('voidTransactionBtn').textContent='Cancelar lançamento';
}

async function saveTransactionEdit(e){
  e.preventDefault();
  const id=Number($('editTransactionId').value); const current=state.transactions.find(x=>Number(x.id)===id); if(!current)return;
  try{
    const opening=Boolean(Number(current.opening_history)),direction=$('editDirection').value,nature=$('editNature').value;
    const editDate=$('editDate').value; if(!editDate)throw new Error('Informe a data.');
    const payload={occurred_at:`${editDate}T16:00:00.000Z`, direction, amount_cents:parseMoney($('editAmount').value), description:$('editDescription').value.trim(), nature, category_id:numOrNull($('editCategory').value), obligation_id:direction==='expense'?numOrNull($('editObligation').value):null, debt_id:!opening&&direction==='expense'?numOrNull($('editDebt').value):null, source_account_id:!opening&&direction!=='income'?numOrNull($('editSourceAccount').value):null, destination_account_id:!opening&&direction!=='expense'?numOrNull($('editDestinationAccount').value):null, payment_method:$('editPaymentMethod').value, notes:$('editNotes').value.trim()||null};
    await api(`/api/transactions/${id}`,{method:'PATCH',body:JSON.stringify(payload)}); $('editTransactionDialog').close(); toast('Lançamento corrigido. Saldos e relatórios recalculados.'); await loadAll();
  }catch(err){toast(err.message);}
}

async function voidCurrentTransaction(){
  const id=Number($('editTransactionId').value); const t=state.transactions.find(x=>Number(x.id)===id); if(!t)return;
  if(!confirm(`Cancelar este lançamento?\n\n${t.description} · ${money(t.amount_cents)}\n\nEle deixará de afetar saldos e relatórios, mas continuará no histórico como CANCELADO.`))return;
  try{await api(`/api/transactions/${id}`,{method:'DELETE'}); $('editTransactionDialog').close(); toast('Lançamento cancelado e cálculos atualizados.'); await loadAll();}catch(err){toast(err.message);}
}

async function savePurchase(e){
  e.preventDefault();
  try{
    const total=parseMoney($('purchaseTotal').value),paid=parseMoney($('purchasePaidNow').value); if(paid>total)throw new Error('O valor pago agora não pode ser maior que a compra.'); const payable=total-paid;
    const supplierId=numOrNull($('purchaseSupplier').value),supplierName=$('purchaseSupplierNew').value.trim(); if(!supplierId&&!supplierName)throw new Error('Informe o fornecedor.'); if(payable>0&&!$('purchaseDueDate').value)throw new Error('Informe o vencimento do valor que ficará a pagar.');
    const purchaseCategoryId=numOrNull($('purchaseCategory').value); if(!purchaseCategoryId)throw new Error('Escolha ou cadastre a categoria da compra.');
    const payload={nature:$('purchaseNature').value,category_id:purchaseCategoryId,supplier_id:supplierId,supplier_name:supplierName||null,total_cents:total,paid_now_cents:paid,source_account_id:paid>0?numOrNull($('purchaseSource').value):null,payment_method:paid>0?$('purchaseMethod').value:null,due_date:payable>0?$('purchaseDueDate').value:null,notes:$('purchaseNotes').value.trim()||null};
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

async function markPaidBeforeOpening(id){
  const o=state.obligations.find(x=>x.id===id); if(!o)return;
  const remaining=Number(o.remaining_cents||0); if(remaining<=0){toast('Esta conta já está paga no período.');return;}
  const value=prompt(`Quanto de ${o.name} já foi pago antes de começar o app?\nIsso NÃO será descontado novamente dos saldos atuais.`,centsToInput(remaining));
  if(value==null)return;
  const paidDate=prompt('Data aproximada do pagamento (AAAA-MM-DD). Se não souber, deixe vazio.','');
  if(paidDate==null)return;
  const msg=`Confirmar ${money(parseMoney(value))} como JÁ PAGO antes da fotografia inicial?\n\nO compromisso será reduzido, mas Mercado Pago/Nubank/Dinheiro NÃO serão descontados novamente.`;
  if(!confirm(msg))return;
  try{
    await api(`/api/obligations/${id}/opening-paid`,{method:'POST',body:JSON.stringify({amount_cents:parseMoney(value),paid_date:paidDate.trim()||null})});
    toast('Pagamento anterior registrado sem alterar os saldos atuais.'); await loadAll();
  }catch(err){toast(err.message);}
}

async function addReserve(id){const o=state.obligations.find(x=>x.id===id);if(!o)return;const value=prompt(`Quanto deseja marcar como reservado para ${o.name}?`);if(value==null)return;try{await api('/api/reserves',{method:'POST',body:JSON.stringify({obligation_id:id,amount_cents:parseMoney(value)})});toast('Reserva registrada.');await loadAll();}catch(err){toast(err.message);}}
async function editObligation(id){const o=state.obligations.find(x=>x.id===id);if(!o)return;const value=prompt(`Valor mensal de ${o.name}`,centsToInput(o.monthly_target_cents));if(value==null)return;const due=prompt('Dia de vencimento (vazio se não houver)',o.due_day||'');try{await api(`/api/obligations/${id}`,{method:'PATCH',body:JSON.stringify({monthly_target_cents:parseMoney(value),due_day:due||null})});toast('Conta atualizada.');await loadAll();}catch(err){toast(err.message);}}
async function createObligation(){const name=prompt('Nome da conta/compromisso');if(!name)return;const scope=confirm('É uma despesa pessoal? OK = pessoal / Cancelar = empresa')?'personal':'business';const nature=scope==='personal'?'personal_withdrawal':'business_operating';const value=prompt('Valor mensal','0,00');if(value==null)return;const due=prompt('Dia de vencimento (opcional)','');try{await api('/api/obligations',{method:'POST',body:JSON.stringify({name,scope,nature,monthly_target_cents:parseMoney(value),due_day:due||null,counts_in_daily_target:scope==='business',personal_ceiling_member:false})});toast('Conta cadastrada.');await loadAll();}catch(err){toast(err.message);}}
async function editDebt(id){const d=state.debts.find(x=>x.id===id);if(!d)return;const value=prompt(`Saldo atual de ${d.name}`,d.current_balance_cents==null?'':centsToInput(d.current_balance_cents));if(value==null)return;try{await api(`/api/debts/${id}`,{method:'PATCH',body:JSON.stringify({current_balance_cents:value.trim()?parseMoney(value):null})});toast('Saldo da dívida atualizado.');await loadAll();}catch(err){toast(err.message);}}
async function createDebt(){const name=prompt('Nome da dívida antiga / credor');if(!name)return;const value=prompt('Saldo atual conhecido (pode deixar vazio)','');const personal=confirm('Essa dívida é pessoal? OK = pessoal / Cancelar = empresa');try{await api('/api/debts',{method:'POST',body:JSON.stringify({name,creditor:name,scope:personal?'personal':'business',current_balance_cents:value.trim()?parseMoney(value):null,debt_kind:personal?'personal_agreement':'old',flexible:true})});toast('Dívida antiga cadastrada.');await loadAll();}catch(err){toast(err.message);}}
async function adjustOpening(id){const a=state.accounts.find(x=>x.id===id);if(!a)return;const value=prompt(`Saldo inicial de ${a.name}. Use apenas para corrigir a fotografia inicial.`,centsToInput(a.opening_balance_cents));if(value==null)return;try{await api(`/api/accounts/${id}/opening-balance`,{method:'POST',body:JSON.stringify({opening_balance_cents:parseMoney(value)})});toast('Saldo inicial atualizado.');await loadAll();}catch(err){toast(err.message);}}
async function reconcileAccount(id){const a=state.accounts.find(x=>Number(x.id)===id);if(!a)return;const value=prompt(`Saldo real agora em ${a.name}:`,centsToInput(a.balance_cents));if(value==null)return;const reason=prompt('Motivo do ajuste (ex.: conciliação com extrato, taxa esquecida, lançamento faltante):','Conciliação com saldo real');if(reason==null)return;const next=parseMoney(value),diff=next-Number(a.balance_cents||0);if(diff===0){toast('O saldo já está conciliado.');return;}if(!confirm(`Saldo no app: ${money(a.balance_cents)}
Saldo real: ${money(next)}
Diferença: ${diff>=0?'+ ':''}${money(diff)}

Registrar ajuste sem apagar o histórico?`))return;try{await api(`/api/accounts/${id}/reconcile`,{method:'POST',body:JSON.stringify({new_balance_cents:next,reason})});toast('Saldo conciliado com registro de auditoria.');await loadAll();}catch(err){toast(err.message);}}

function localYmd(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Cuiaba',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const map=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function addDaysYmd(ymd,days){const [y,m,d]=ymd.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d+days));return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;}
function monthStartYmd(ymd){return `${ymd.slice(0,7)}-01`;}
function openBulkReclassPage(){
  showView('pesquisa');
  $('bulkAccount').innerHTML='<option value="">Todas as contas</option>'+state.accounts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');
  $('bulkCorrectAccount').innerHTML='<option value="">Selecione a conta correta</option>'+state.accounts.filter(a=>a.owner_scope==='business').map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');
  $('bulkSearch').value=''; $('bulkAccount').value=''; $('bulkDirection').value=''; state.bulkTransactions=[];
  setBulkRange('month',false); resetBulkEditor(); renderBulkResults(); searchBulkTransactions(); setTimeout(()=>$('bulkSearch')?.focus(),80);
}
function resetBulkEditor(){
  $('bulkSelectAll').checked=false; $('bulkNature').value='business_operating'; $('bulkReplaceDescription').checked=false; $('bulkDescription').value=''; $('bulkDescription').disabled=true; renderBulkClassificationSelectors(); updateBulkSelectedCount();
}
function setBulkRange(range,runSearch=true){
  const today=localYmd(); let from='',to='';
  if(range==='today'){from=today;to=today;}
  else if(range==='yesterday'){from=addDaysYmd(today,-1);to=from;}
  else if(range==='7days'){from=addDaysYmd(today,-6);to=today;}
  else if(range==='month'){from=monthStartYmd(today);to=today;}
  $('bulkDateFrom').value=from; $('bulkDateTo').value=to;
  document.querySelectorAll('[data-bulk-range]').forEach(b=>b.classList.toggle('active',b.dataset.bulkRange===range));
  if(runSearch)searchBulkTransactions();
}
function clearBulkFilters(){
  $('bulkSearch').value=''; $('bulkAccount').value=''; $('bulkDirection').value=''; setBulkRange('month',false); searchBulkTransactions();
}
async function searchBulkTransactions(){
  let q=$('bulkSearch').value.trim(),accountId=$('bulkAccount').value; const direction=$('bulkDirection').value,dateFrom=$('bulkDateFrom').value,dateTo=$('bulkDateTo').value;
  if(!accountId&&q){const accountMatch=state.accounts.find(a=>normalizeClient(a.name)===normalizeClient(q));if(accountMatch){accountId=String(accountMatch.id);$('bulkAccount').value=accountId;q='';}}
  if(dateFrom&&dateTo&&dateFrom>dateTo){toast('A data inicial não pode ser maior que a data final.');return;}
  const params=new URLSearchParams({limit:'500',search_scope:'content'}); if(q)params.set('q',q); if(accountId)params.set('account_id',accountId); if(direction)params.set('direction',direction); if(dateFrom)params.set('date_from',dateFrom); if(dateTo)params.set('date_to',dateTo);
  try{const data=await api(`/api/transactions?${params.toString()}`);state.bulkTransactions=(data.transactions||[]).filter(t=>t.status!=='void');renderBulkResults();}catch(err){toast(err.message);}
}
function bulkAccountLabel(t){if(t.direction==='transfer')return `${t.source_account||'Origem?'} → ${t.destination_account||'Destino?'}`;if(t.direction==='income')return t.destination_account||'Destino não informado';return t.source_account||'Origem não informada';}
function bulkDirectionLabel(t){return t.direction==='income'?'Entrada':t.direction==='transfer'?'Transferência':'Saída';}
function bulkSelectable(t){return t.direction==='expense'&&t.status!=='void'&&!t.purchase_id;}
function renderBulkResults(){
  const rows=state.bulkTransactions||[]; $('bulkSelectAll').checked=false;
  const income=rows.filter(t=>t.direction==='income').reduce((a,t)=>a+Number(t.amount_cents||0),0),expense=rows.filter(t=>t.direction==='expense').reduce((a,t)=>a+Number(t.amount_cents||0),0);
  $('bulkResultsCount').textContent=String(rows.length); $('bulkIncomeTotal').textContent=money(income); $('bulkExpenseTotal').textContent=money(expense);
  const filters=[]; if($('bulkAccount').value){const a=state.accounts.find(x=>String(x.id)===$('bulkAccount').value);if(a)filters.push(`Conta: ${a.name}`);} if($('bulkDateFrom').value||$('bulkDateTo').value)filters.push(`Período: ${dateBR($('bulkDateFrom').value||$('bulkDateTo').value)} a ${dateBR($('bulkDateTo').value||$('bulkDateFrom').value)}`); if($('bulkDirection').value)filters.push(`Tipo: ${$('bulkDirection').selectedOptions[0].textContent}`); if($('bulkSearch').value.trim())filters.push(`Busca: “${$('bulkSearch').value.trim()}”`); $('bulkFilterSummary').textContent=filters.join(' · ')||'Todos os lançamentos encontrados.';
  $('bulkResults').innerHTML=rows.map(t=>{const cat=categoryDisplayForTransaction(t),account=bulkAccountLabel(t),selectable=bulkSelectable(t),sign=t.direction==='income'?'+':t.direction==='expense'?'-':'',valueClass=t.direction==='income'?'positive':t.direction==='expense'?'negative':'',reason=!selectable?(t.purchase_id?'Compra vinculada — edite pela compra':t.direction!=='expense'?'Consulta somente':'Não selecionável'):'';return `<label class="bulk-report-row${selectable?'':' not-selectable'}"><input type="checkbox" class="bulk-check" value="${t.id}" ${selectable?'':'disabled'}><div class="bulk-report-date"><strong>${dateOnlyBR(t.occurred_at)}</strong><small>${dateTimeOnlyBR(t.occurred_at)}</small></div><div class="bulk-report-main"><strong>${esc(t.description)}</strong><small>#${t.id}${t.notes?` · ${esc(t.notes)}`:''}</small><div class="bulk-report-tags"><span>${esc(cat)}</span><span class="account">${esc(account)}</span><span>${bulkDirectionLabel(t)}</span>${t.debt_name?`<span>${esc(t.debt_name)}</span>`:''}</div>${reason?`<small class="bulk-row-reason">${esc(reason)}</small>`:''}</div><div class="bulk-report-value ${valueClass}">${sign}${money(t.amount_cents)}</div></label>`;}).join('')||'<div class="empty">Nenhum lançamento encontrado com estes filtros.</div>';
  document.querySelectorAll('.bulk-check').forEach(c=>c.addEventListener('change',updateBulkSelectedCount)); updateBulkSelectedCount();
}
function toggleBulkSelectAll(){document.querySelectorAll('.bulk-check:not(:disabled)').forEach(c=>c.checked=$('bulkSelectAll').checked);updateBulkSelectedCount();}
function selectedBulkIds(){return [...document.querySelectorAll('.bulk-check:checked')].map(c=>Number(c.value));}
function updateBulkSelectedCount(){const n=selectedBulkIds().length;if($('bulkSelectedCount'))$('bulkSelectedCount').textContent=String(n);}
function renderBulkClassificationSelectors(){
  const nature=$('bulkNature').value,cats=activeCategories(nature); $('bulkCategory').innerHTML='<option value="">Selecione</option>'+cats.map(c=>`<option value="${c.id}">${esc(categoryLabel(c))}</option>`).join('');
  const scope=nature==='personal_withdrawal'?'personal':'business',show=['business_debt','personal_withdrawal'].includes(nature); $('bulkDebtWrap').hidden=!show;
  $('bulkDebt').innerHTML='<option value="">Nenhuma / não vincular</option>'+state.debts.filter(d=>d.scope===scope&&d.status!=='paid').map(d=>`<option value="${d.id}">${esc(d.name)}${d.current_balance_cents!=null?` · ${money(d.current_balance_cents)}`:''}</option>`).join('');
}
function fillCorporateAgreementPreset(){
  $('bulkNature').value='business_debt'; renderBulkClassificationSelectors();
  const cat=state.categories.find(c=>c.nature==='business_debt'&&normalizeClient(c.name)==='aquisicao de participacao societaria'); if(cat)$('bulkCategory').value=String(cat.id);
  const debt=state.debts.find(d=>d.scope==='business'&&normalizeClient(d.name)==='acordo societario'); if(debt)$('bulkDebt').value=String(debt.id);
  $('bulkReplaceDescription').checked=true; $('bulkDescription').disabled=false; $('bulkDescription').value='Pagamento de acordo societário';
}
async function applyBulkReclassification(){
  const ids=selectedBulkIds(); if(!ids.length){toast('Selecione pelo menos um lançamento.');return;} const categoryId=numOrNull($('bulkCategory').value); if(!categoryId){toast('Selecione a categoria de destino.');return;}
  const payload={ids,nature:$('bulkNature').value,category_id:categoryId,debt_id:numOrNull($('bulkDebt').value),replace_description:$('bulkReplaceDescription').checked,description:$('bulkDescription').value.trim()};
  if(!confirm(`Reclassificar ${ids.length} lançamento${ids.length===1?'':'s'}?\n\nValor, data e conta de origem NÃO serão alterados.`))return;
  try{const result=await api('/api/transactions/bulk-reclassify',{method:'POST',body:JSON.stringify(payload)});toast(`${result.updated} lançamento(s) reclassificado(s).`);await loadAll();await searchBulkTransactions();}catch(err){toast(err.message);}
}
async function applyBulkAccountCorrection(){
  const ids=selectedBulkIds(); if(!ids.length){toast('Selecione pelo menos uma saída.');return;}
  const accountId=numOrNull($('bulkCorrectAccount').value); if(!accountId){toast('Selecione a conta correta.');return;}
  const account=state.accounts.find(a=>Number(a.id)===Number(accountId));
  if(!confirm(`Corrigir a conta de ${ids.length} lançamento${ids.length===1?'':'s'} para ${account?.name||'a conta selecionada'}?

Somente a conta de saída será alterada. Valor, data, categoria, dívida e descrição permanecerão iguais.`))return;
  try{
    const result=await api('/api/transactions/bulk-account-correct',{method:'POST',body:JSON.stringify({ids,account_id:accountId})});
    toast(`${result.updated} lançamento(s) corrigido(s) para ${result.account_name}.`);
    await loadAll(); await searchBulkTransactions();
  }catch(err){toast(err.message);}
}

function normalizeClient(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}

function natureGroupLabel(n){return ({business_operating:'Empresa · operação',inventory:'Empresa · compras/estoque',business_debt:'Empresa · dívidas',personal_withdrawal:'Pessoal',income:'Receitas'})[n]||labelNature(n);}

function openCategoryManager(){resetCategoryForm();renderCategoryManager();$('categoryDialog').showModal();}
function resetCategoryForm(){
  $('categoryEditId').value=''; $('categoryName').value=''; $('categoryNature').disabled=false; $('categoryNature').value=$('nature')?.value&&['business_operating','inventory','business_debt','personal_withdrawal','income'].includes($('nature').value)?$('nature').value:'business_operating'; $('cancelCategoryEdit').hidden=true; renderCategoryParentOptions();
}
function renderCategoryParentOptions(selectedId=null){
  const nature=$('categoryNature').value,id=Number($('categoryEditId').value||0); const parents=state.categories.filter(c=>Number(c.active)!==0&&c.nature===nature&&!c.parent_id&&Number(c.id)!==id);
  $('categoryParent').innerHTML='<option value="">Nenhuma</option>'+parents.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join(''); if(selectedId)$('categoryParent').value=String(selectedId);
}
function renderCategoryManager(){
  const groups=['business_operating','inventory','business_debt','personal_withdrawal','income'];
  $('categoryManagerList').innerHTML=groups.map(n=>{
    const items=state.categories.filter(c=>c.nature===n).sort((a,b)=>categoryLabel(a).localeCompare(categoryLabel(b),'pt-BR'));
    if(!items.length)return '';
    return `<div class="category-group"><h3>${esc(natureGroupLabel(n))}</h3>${items.map(c=>`<article class="category-row ${Number(c.active)===0?'inactive':''}"><div><strong>${esc(categoryLabel(c))}</strong>${Number(c.active)===0?'<small>Desativada</small>':''}</div><div class="category-actions"><button class="mini-btn" data-edit-category="${c.id}">Editar</button><button class="mini-btn" data-toggle-category="${c.id}">${Number(c.active)===0?'Reativar':'Desativar'}</button></div></article>`).join('')}</div>`;
  }).join('');
  document.querySelectorAll('[data-edit-category]').forEach(b=>b.addEventListener('click',()=>startCategoryEdit(Number(b.dataset.editCategory))));
  document.querySelectorAll('[data-toggle-category]').forEach(b=>b.addEventListener('click',()=>toggleCategory(Number(b.dataset.toggleCategory))));
}
function startCategoryEdit(id){const c=state.categories.find(x=>Number(x.id)===id);if(!c)return;$('categoryEditId').value=String(c.id);$('categoryName').value=c.name;$('categoryNature').value=c.nature;$('categoryNature').disabled=true;$('cancelCategoryEdit').hidden=false;renderCategoryParentOptions(c.parent_id);$('categoryName').focus();}
async function saveCategory(e){
  e.preventDefault(); try{const id=Number($('categoryEditId').value||0);const payload={name:$('categoryName').value.trim(),nature:$('categoryNature').value,parent_id:numOrNull($('categoryParent').value)}; if(id)await api(`/api/categories/${id}`,{method:'PATCH',body:JSON.stringify({name:payload.name,parent_id:payload.parent_id})}); else await api('/api/categories',{method:'POST',body:JSON.stringify(payload)}); toast(id?'Categoria atualizada.':'Categoria criada.'); await loadAll(); resetCategoryForm(); renderCategoryManager();}catch(err){toast(err.message);}
}
async function toggleCategory(id){const c=state.categories.find(x=>Number(x.id)===id);if(!c)return;const active=Number(c.active)===0;if(!active&&!confirm(`Desativar a categoria “${c.name}”?\n\nOs lançamentos antigos continuam preservados.`))return;try{await api(`/api/categories/${id}`,{method:'PATCH',body:JSON.stringify({active})});toast(active?'Categoria reativada.':'Categoria desativada.');await loadAll();renderCategoryManager();}catch(err){toast(err.message);}}


function prepareQuickMovement(direction){
  showView('lancar'); setDirection(direction);
  if(direction==='expense'){$('nature').value='business_operating';renderSelectors();}
  setTimeout(()=>$('amount')?.focus(),80);
}

function renderHomeDashboard(){
  const d=state.dashboard;if(!d)return;
  const inc=Number(d.month?.income_cents||0),exp=Number(d.month?.expense_cents||0),max=Math.max(inc,exp,1);
  if($('homeIncomeBar'))$('homeIncomeBar').style.height=`${Math.max(8,Math.round(78*inc/max))}px`;
  if($('homeExpenseBar'))$('homeExpenseBar').style.height=`${Math.max(8,Math.round(78*exp/max))}px`;
  const recent=(state.transactions||[]).filter(t=>t.status!=='void').slice(0,5);
  if($('homeRecentTransactions')){
    $('homeRecentTransactions').innerHTML=recent.map(t=>transactionCard(t,false)).join('')||empty('Nenhum lançamento ainda.');
    document.querySelectorAll('#homeRecentTransactions [data-edit-transaction]').forEach(b=>b.addEventListener('click',()=>openTransactionEditor(Number(b.dataset.editTransaction))));
  }
  const items=(d.category_spending||[]).filter(x=>Number(x.total_cents)>0);const total=items.reduce((a,x)=>a+Number(x.total_cents||0),0);const top=items.slice(0,5);const colors=['#4650E8','#3C7F86','#51327F','#D57724','#D348B9'];let angle=0,parts=[];state.homeSegments=[];
  top.forEach((x,i)=>{const share=total?Number(x.total_cents)/total:0;const end=angle+share*360;const label=x.parent_name?`${x.parent_name} › ${x.name}`:x.name;parts.push(`${colors[i%colors.length]} ${angle}deg ${end}deg`);state.homeSegments.push({id:Number(x.id),label,start:angle,end,total_cents:Number(x.total_cents||0)});angle=end;});if(angle<360)parts.push(`#EEF1F6 ${angle}deg 360deg`);
  if($('homeCategoryDonut'))$('homeCategoryDonut').style.background=parts.length?`conic-gradient(${parts.join(',')})`:'#EEF1F6';if($('homeCategoryTotal'))$('homeCategoryTotal').textContent=money(total);
  if($('homeCategoryLegend')){$('homeCategoryLegend').innerHTML=top.map((x,i)=>{const label=x.parent_name?`${x.parent_name} › ${x.name}`:x.name;return `<button type="button" data-home-category-detail="${x.id}"><span class="legend-dot" style="background:${colors[i%colors.length]}"></span><div><strong>${esc(label)}</strong><small>${money(x.total_cents)} · ${total?Math.round(Number(x.total_cents)/total*100):0}%</small></div></button>`;}).join('')||'<p class="muted small">Sem saídas categorizadas no mês.</p>';document.querySelectorAll('[data-home-category-detail]').forEach(b=>b.addEventListener('click',()=>{const seg=state.homeSegments.find(x=>x.id===Number(b.dataset.homeCategoryDetail));if(seg)openTransactionDetail({title:seg.label,subtitle:`Gastos desta categoria em ${periodLabelClient(d.period_key)}`,period_key:d.period_key,direction:'expense',category_id:seg.id});}));}
}

function openHomeDonutSegment(event){
  if(!state.homeSegments.length){showView('relatorios');return;}const rect=$('homeCategoryDonut').getBoundingClientRect();const x=event.clientX-(rect.left+rect.width/2),y=event.clientY-(rect.top+rect.height/2);if(Math.hypot(x,y)<rect.width*.28){openTransactionDetail({title:'Todas as saídas do mês',period_key:state.dashboard?.period_key,direction:'expense'});return;}let angle=Math.atan2(y,x)*180/Math.PI+90;if(angle<0)angle+=360;const seg=state.homeSegments.find(s=>angle>=s.start&&angle<s.end);if(seg)openTransactionDetail({title:seg.label,subtitle:`Gastos desta categoria em ${periodLabelClient(state.dashboard?.period_key)}`,period_key:state.dashboard?.period_key,direction:'expense',category_id:seg.id});
}

function renderAnalysisDashboard(){
  const d=state.analysis||{period_key:state.dashboard?.period_key,month:state.dashboard?.month||{},category_spending:state.dashboard?.category_spending||[]};if(!d)return;
  const options=[...new Set([...(state.periods||[]),d.period_key,'2026-07','2026-08'])].filter(Boolean).sort().reverse();
  $('analysisPeriod').innerHTML=options.map(k=>`<option value="${k}">${periodLabelClient(k)}</option>`).join('');$('analysisPeriod').value=d.period_key;state.analysisPeriod=d.period_key;
  const inc=Number(d.month.income_cents||0),exp=Number(d.month.expense_cents||0),max=Math.max(inc,exp,1); $('analysisIncome').textContent=money(inc);$('analysisExpense').textContent=money(exp);$('analysisNetBadge').textContent=`${d.month.net_cents>=0?'+ ':''}${money(d.month.net_cents)}`;$('analysisNetBadge').classList.toggle('negative',d.month.net_cents<0);$('incomeFlowBar').style.height=`${Math.max(10,Math.round(110*inc/max))}px`;$('expenseFlowBar').style.height=`${Math.max(10,Math.round(110*exp/max))}px`;
  $('monthIncomeReport').textContent=money(d.month.sales_cents||0);if($('monthOldReceipts'))$('monthOldReceipts').textContent=money(d.month.old_receipts_cents||0);$('monthExpenseReport').textContent=money(exp);$('monthPersonal').textContent=money(d.month.personal_withdrawal_cents||0);$('monthInventory').textContent=money(d.month.inventory_spent_cents||0);$('monthDebtReport').textContent=money(d.month.debt_paid_cents||0);
  const items=(d.category_spending||[]).filter(x=>Number(x.total_cents)>0);const total=items.reduce((a,x)=>a+Number(x.total_cents||0),0);$('categoryExpenseTotal').textContent=money(total);$('categoryDonutTotal').textContent=money(total);const top=items.slice(0,7);const colors=['#4A4EE8','#3C7F86','#51327F','#D57724','#D348B9','#31515A','#8B95A7'];let angle=0,parts=[];state.analysisSegments=[];top.forEach((x,i)=>{const share=total?Number(x.total_cents)/total:0;const end=angle+share*360;const label=x.parent_name?`${x.parent_name} › ${x.name}`:x.name;parts.push(`${colors[i%colors.length]} ${angle}deg ${end}deg`);state.analysisSegments.push({id:Number(x.id),label,start:angle,end,total_cents:Number(x.total_cents||0)});angle=end;});if(angle<360)parts.push(`#EEF1F6 ${angle}deg 360deg`);$('categoryDonut').style.background=parts.length?`conic-gradient(${parts.join(',')})`:'#EEF1F6';$('categoryLegend').innerHTML=top.map((x,i)=>{const label=x.parent_name?`${x.parent_name} › ${x.name}`:x.name;return `<button type="button" class="legend-row" data-category-detail="${x.id}" aria-label="Ver lançamentos de ${esc(label)}"><span class="legend-dot" style="background:${colors[i%colors.length]}"></span><div><strong>${esc(label)}</strong><small>${money(x.total_cents)} · ${total?Math.round(Number(x.total_cents)/total*100):0}% · ver detalhes</small></div></button>`;}).join('')||'<p class="muted">Ainda não há saídas categorizadas no mês.</p>';
  document.querySelectorAll('[data-category-detail]').forEach(b=>b.addEventListener('click',()=>{const seg=state.analysisSegments.find(x=>x.id===Number(b.dataset.categoryDetail));if(seg)openCategoryDetail(seg.id,seg.label);}));
}

async function loadAnalysisPeriod(periodKey){try{state.analysisPeriod=periodKey;state.analysis=await api(`/api/month-summary?period_key=${encodeURIComponent(periodKey)}`);renderAnalysisDashboard();}catch(err){toast(err.message);}}
function periodLabelClient(key){const [y,m]=String(key).split('-').map(Number);return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,1)));}

function bindDetailTrigger(id,fn){const el=$(id);if(!el)return;el.addEventListener('click',fn);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn();}});}

function openDonutSegment(event){
  if(!state.analysisSegments.length)return; const rect=$('categoryDonut').getBoundingClientRect(); const x=event.clientX-(rect.left+rect.width/2),y=event.clientY-(rect.top+rect.height/2);
  if(Math.hypot(x,y)<rect.width*.28){openTransactionDetail({title:'Todas as saídas do mês',period_key:state.analysisPeriod||state.dashboard?.period_key,direction:'expense'});return;}
  let angle=Math.atan2(y,x)*180/Math.PI+90;if(angle<0)angle+=360;const seg=state.analysisSegments.find(s=>angle>=s.start&&angle<s.end);if(seg)openCategoryDetail(seg.id,seg.label);
}

function openCategoryDetail(categoryId,label){return openTransactionDetail({title:label,subtitle:`Gastos desta categoria em ${periodLabelClient(state.analysisPeriod||state.dashboard?.period_key)}`,period_key:state.analysisPeriod||state.dashboard?.period_key,direction:'expense',category_id:categoryId});}

async function openTransactionDetail(filters){
  try{
    const q=new URLSearchParams({limit:'200'});['direction','nature','period_key','category_id'].forEach(k=>{if(filters[k]!=null&&filters[k]!=='')q.set(k,String(filters[k]));});if(filters.today)q.set('today','1');
    const data=await api(`/api/transactions?${q.toString()}`); const items=(data.transactions||[]).filter(t=>t.status!=='void'); const total=items.reduce((sum,t)=>sum+Number(t.amount_cents||0),0);
    $('detailTitle').textContent=filters.title||'Detalhes';$('detailSubtitle').textContent=filters.subtitle||`${items.length} lançamento(s)`;
    $('detailSummary').innerHTML=`<div><span>Total</span><strong>${money(total)}</strong></div><div><span>Lançamentos</span><strong>${items.length}</strong></div>`;
    $('detailTransactions').innerHTML=items.map(detailTransactionCard).join('')||'<div class="detail-empty">Nenhum lançamento encontrado neste filtro.</div>';
    document.querySelectorAll('#detailTransactions [data-detail-edit]').forEach(b=>b.addEventListener('click',()=>{const id=Number(b.dataset.detailEdit),t=items.find(x=>Number(x.id)===id);if(t&&!state.transactions.some(x=>Number(x.id)===id))state.transactions.push(t);$('detailDialog').close();openTransactionEditor(id);}));
    $('detailDialog').showModal();
  }catch(err){toast(err.message);}
}

function detailTransactionCard(t){
  const cat=categoryDisplayForTransaction(t);const opening=Number(t.opening_history)===1;const origin=t.direction==='income'?(t.destination_account||(opening?'Histórico · destino não informado':'Destino não informado')):(t.source_account||(opening?'Histórico · origem não registrada':'Origem não informada')); const payment=paymentMethodLabel(t.payment_method);
  const extras=[t.supplier_name?`Fornecedor: ${t.supplier_name}`:null,t.debt_name?`Dívida: ${t.debt_name}`:null,t.notes?`Obs.: ${t.notes}`:null].filter(Boolean);
  return `<article class="list-card detail-card"><div class="row top"><div><h3>${esc(t.description)}</h3><p>${dateTimeBR(t.occurred_at)}${opening?' · ANTES DO APP':''}</p></div><div class="money ${t.direction==='income'?'positive':''}">${t.direction==='income'?'+':'-'}${money(t.amount_cents)}</div></div><div class="detail-meta"><span class="detail-category">${esc(cat)}</span><span class="detail-origin">${t.direction==='income'?'Entrou em':'Saiu de'}: ${esc(origin)}</span><span>Forma: ${esc(payment)}</span>${extras.map(x=>`<span>${esc(x)}</span>`).join('')}</div><div class="edit-actions"><button class="mini-btn" data-detail-edit="${t.id}">Editar lançamento</button></div></article>`;
}

function categoryDisplayForTransaction(t){const c=state.categories.find(x=>Number(x.id)===Number(t.category_id));return c?categoryLabel(c):(t.parent_category_name?`${t.parent_category_name} › ${t.category_name||''}`:(t.category_name||labelNature(t.nature)));}
function paymentMethodLabel(v){return ({pix:'Pix',cash:'Dinheiro',debit:'Débito',credit:'Crédito',transfer:'Transferência',boleto:'Boleto',other:'Outra / não informado'})[v]||'Não informado';}

function showView(name){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));const navName=(name==='antes'||name==='pesquisa')?'lancar':name==='caixa'?'contas':name;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===navName));window.scrollTo({top:0,behavior:'smooth'});}
async function logout(){await api('/api/auth/logout',{method:'POST'});location.reload();}
async function api(url,options={},auth=true){const r=await fetch(url,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});let data={};try{data=await r.json();}catch{}if(!r.ok){const e=new Error(data.error||`Erro ${r.status}`);e.status=r.status;throw e;}return data;}
function parseMoney(v){const s=String(v??'').trim().replace(/\s/g,'');if(!s)throw new Error('Informe o valor.');let normalized=s;if(s.includes(','))normalized=s.replace(/\./g,'').replace(',','.');const n=Number(normalized);if(!Number.isFinite(n)||n<0)throw new Error('Valor inválido.');return Math.round(n*100);}
function safeParseMoney(v){try{return parseMoney(v);}catch{return 0;}}
function centsToInput(c){return (Number(c||0)/100).toFixed(2).replace('.',',');}
function numOrNull(v){return v?Number(v):null;}
function labelNature(n){return ({business_operating:'Empresa · operação',inventory:'Compra/estoque',business_debt:'Dívida empresa',personal_withdrawal:'Retirada pessoal',income:'Receita',transfer:'Transferência',unidentified:'Não identificado'})[n]||n;}
function accountType(t){return ({bank:'Conta bancária',cash:'Dinheiro físico',card:'Cartão',other:'Outro ativo'})[t]||t;}
function dueDateForPeriodClient(key,dueDay){const [y,m]=String(key).split('-').map(Number);const last=new Date(Date.UTC(y,m,0)).getUTCDate();const day=Math.min(Number(dueDay||1),last);return `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}
function dateTimeBR(v){return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Cuiaba',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v));}
function dateTimeOnlyBR(v){return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Cuiaba',hour:'2-digit',minute:'2-digit'}).format(new Date(v));}
function dateOnlyBR(v){return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Cuiaba',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(v));}
function dateBR(v){const s=String(v).slice(0,10);const [y,m,d]=s.split('-');return d&&m&&y?`${d}/${m}/${y}`:s;}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function empty(t){return `<div class="notice muted">${esc(t)}</div>`;}
let toastTimer;function toast(t){$('toast').textContent=t;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4200);}
function registerServiceWorker(){if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});}
