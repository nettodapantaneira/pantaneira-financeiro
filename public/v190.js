(() => {
  'use strict';

  const VERSION='1.9.0';
  let report=null;
  let activeTab='executive';
  let catalogs={accounts:[],categories:[]};

  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(c||0)/100);
  const number=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
  const pct=n=>Number.isFinite(Number(n))?new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}).format(Number(n))+'%':'—';
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Cuiaba',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const dateBR=v=>{if(!v)return'—';const [y,m,d]=String(v).slice(0,10).split('-');return`${d}/${m}/${y}`;};
  const periodBR=v=>{const [y,m]=String(v||'').split('-');const names=['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];return`${names[Number(m)]||m}/${y}`;};
  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const api=async(path)=>{const r=await fetch(path,{headers:{'accept':'application/json'}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Erro ${r.status}`);return j;};
  const toastMsg=msg=>{const t=q('#toast');if(t){t.textContent=msg;t.hidden=false;setTimeout(()=>t.hidden=true,2600);}else alert(msg);};

  function init(){
    installStyles();
    addNavigation();
    buildView();
    bindExistingNavigation();
    setVersion();
    const [from,to]=monthRange(today());
    q('#prFrom').value=from;q('#prTo').value=to;
    setPresetActive('month');
  }

  function setVersion(){
    const f=q('.sidebar-foot strong');if(f)f.textContent='v'+VERSION;
  }

  function addNavigation(){
    const side=q('.sidebar-nav');
    if(side&&!q('#proReportNav')){
      const analysis=side.querySelector('[data-view="relatorios"]');
      const b=document.createElement('button');
      b.type='button';b.id='proReportNav';b.innerHTML='<span>▥</span><b>Relatórios</b>';
      side.insertBefore(b,analysis||null);
      b.addEventListener('click',openReports);
    }

    const bottom=q('.bottom-nav');
    if(bottom&&!q('#proReportBottomNav')){
      const analysis=bottom.querySelector('[data-view="relatorios"]');
      const b=document.createElement('button');
      b.type='button';b.id='proReportBottomNav';b.innerHTML='<span>▥</span><small>Relatórios</small>';
      bottom.insertBefore(b,analysis||null);
      b.addEventListener('click',openReports);
    }
  }

  function bindExistingNavigation(){
    qa('[data-view]').forEach(b=>b.addEventListener('click',()=>{
      q('#proReportNav')?.classList.remove('active');
      q('#proReportBottomNav')?.classList.remove('active');
    }));
  }

  function openReports(){
    qa('.view').forEach(v=>v.classList.remove('active'));
    q('#view-pro-reports')?.classList.add('active');
    qa('[data-view]').forEach(b=>b.classList.remove('active'));
    q('#proReportNav')?.classList.add('active');
    q('#proReportBottomNav')?.classList.add('active');
    const title=q('.topbar-title');if(title)title.textContent='Relatórios';
    window.scrollTo({top:0,behavior:'smooth'});
    if(!report)runReport();
  }

  function buildView(){
    if(q('#view-pro-reports'))return;
    const main=q('main');if(!main)return;
    const view=document.createElement('section');
    view.id='view-pro-reports';view.className='view';
    view.innerHTML=`
      <div class="pr-shell">
        <div class="pr-heading">
          <div><span class="page-kicker">GESTÃO FINANCEIRA</span><h1>Relatórios</h1><p>Visão executiva, fluxo de caixa, movimentações, categorias, cartões e compromissos — com rastreabilidade até cada lançamento.</p></div>
          <div class="pr-heading-actions"><button class="btn secondary" id="prPrint">Imprimir / PDF</button><button class="btn primary" id="prCsv">Exportar CSV</button></div>
        </div>

        <section class="pr-filter-card">
          <div class="pr-presets">
            <button data-pr-preset="today">Hoje</button>
            <button data-pr-preset="yesterday">Ontem</button>
            <button data-pr-preset="7">7 dias</button>
            <button data-pr-preset="month" class="active">Mês atual</button>
            <button data-pr-preset="prevmonth">Mês anterior</button>
            <button data-pr-preset="90">90 dias</button>
            <button data-pr-preset="year">Ano</button>
          </div>
          <div class="pr-filter-grid">
            <div><label>Data inicial</label><input id="prFrom" type="date"></div>
            <div><label>Data final</label><input id="prTo" type="date"></div>
            <div><label>Conta</label><select id="prAccount"><option value="">Todas as contas</option></select></div>
            <div><label>Empresa / Pessoal</label><select id="prScope"><option value="">Tudo</option><option value="business">Empresa</option><option value="personal">Pessoal</option></select></div>
            <div><label>Tipo de movimento</label><select id="prMovementType"><option value="">Todos</option><option value="income">Entradas</option><option value="expense">Saídas</option><option value="transfer">Transferências</option><option value="card_purchase">Compras no cartão</option></select></div>
            <div><label>Categoria</label><select id="prCategory"><option value="">Todas as categorias</option></select></div>
            <div class="pr-search-field"><label>Buscar</label><input id="prSearch" placeholder="Descrição, conta, categoria, compromisso..."></div>
            <div class="pr-run-wrap"><button id="prRun" class="btn primary">Atualizar relatório</button></div>
          </div>
        </section>

        <div id="prContext" class="pr-context"></div>

        <div class="pr-tabs" id="prTabs">
          <button data-pr-tab="executive" class="active">Visão executiva</button>
          <button data-pr-tab="cashflow">Fluxo de caixa</button>
          <button data-pr-tab="movements">Movimentações</button>
          <button data-pr-tab="categories">Categorias</button>
          <button data-pr-tab="cards">Cartões e faturas</button>
          <button data-pr-tab="commitments">Compromissos</button>
        </div>

        <div id="prLoading" class="pr-loading" hidden><span></span><b>Gerando relatório...</b></div>
        <div id="prBody"></div>
        <div class="pr-print-footer">Pantaneira Financeiro · relatório gerencial · gerado em <span id="prGenerated"></span></div>
      </div>`;
    main.appendChild(view);

    qa('[data-pr-preset]').forEach(b=>b.addEventListener('click',()=>applyPreset(b.dataset.prPreset)));
    q('#prRun').addEventListener('click',runReport);
    q('#prSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();runReport();}});
    q('#prFrom').addEventListener('change',()=>setPresetActive(null));
    q('#prTo').addEventListener('change',()=>setPresetActive(null));
    qa('[data-pr-tab]').forEach(b=>b.addEventListener('click',()=>{activeTab=b.dataset.prTab;qa('[data-pr-tab]').forEach(x=>x.classList.toggle('active',x===b));renderActiveTab();}));
    q('#prPrint').addEventListener('click',()=>window.print());
    q('#prCsv').addEventListener('click',exportCsv);
  }

  function installStyles(){
    if(q('#v190Styles'))return;
    const st=document.createElement('style');st.id='v190Styles';st.textContent=`
      #view-pro-reports{max-width:1220px;margin:0 auto}.pr-shell{display:grid;gap:14px}.pr-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.pr-heading h1{margin:4px 0 5px;font-size:29px;letter-spacing:-.035em}.pr-heading p{margin:0;color:#697386;font-size:13px;max-width:760px;line-height:1.45}.pr-heading-actions{display:flex;gap:8px}.pr-heading-actions .btn{margin:0;white-space:nowrap}
      .pr-filter-card{background:#fff;border:1px solid #dfe4ec;border-radius:22px;padding:16px;box-shadow:0 6px 24px rgba(18,32,58,.035)}.pr-presets{display:flex;gap:7px;overflow:auto;padding-bottom:12px}.pr-presets button{border:1px solid #e0e5ed;background:#f8f9fb;color:#596477;border-radius:999px;padding:7px 11px;font-size:10px;font-weight:850;white-space:nowrap;cursor:pointer}.pr-presets button.active{background:#eef2ff;border-color:#ccd4ff;color:#3548d7}.pr-filter-grid{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:9px;align-items:end}.pr-filter-grid>div{display:grid;gap:5px}.pr-filter-grid label{font-size:10px;font-weight:850;color:#667085}.pr-filter-grid input,.pr-filter-grid select{width:100%;border:1px solid #d9dfe8;background:#fff;border-radius:11px;padding:10px 11px;min-height:41px;outline:none;font-size:11px}.pr-filter-grid input:focus,.pr-filter-grid select:focus{border-color:#7080e8;box-shadow:0 0 0 3px rgba(70,80,232,.08)}.pr-search-field{grid-column:span 3}.pr-run-wrap{grid-column:span 3}.pr-run-wrap .btn{width:100%;margin:0;min-height:41px}
      .pr-context{font-size:11px;color:#687386;padding:0 3px;display:flex;gap:7px;flex-wrap:wrap}.pr-context span{background:#eef1f5;border-radius:999px;padding:5px 9px}.pr-tabs{display:flex;gap:5px;overflow:auto;background:#e9edf2;border-radius:14px;padding:5px}.pr-tabs button{border:0;background:transparent;color:#657084;border-radius:10px;padding:10px 12px;font-size:11px;font-weight:850;white-space:nowrap;cursor:pointer}.pr-tabs button.active{background:#fff;color:#101828;box-shadow:0 1px 5px rgba(16,24,40,.08)}
      .pr-loading{background:#fff;border:1px solid #e2e6ed;border-radius:18px;padding:28px;display:flex;align-items:center;justify-content:center;gap:10px;color:#667085}.pr-loading span{width:18px;height:18px;border:2px solid #d8deea;border-top-color:#4a4ee8;border-radius:50%;animation:prspin .8s linear infinite}@keyframes prspin{to{transform:rotate(360deg)}}
      .pr-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.pr-kpi{background:#fff;border:1px solid #dfe4ec;border-radius:18px;padding:15px;min-height:115px;display:grid;align-content:space-between}.pr-kpi .label{font-size:10px;font-weight:850;color:#687386;text-transform:uppercase;letter-spacing:.055em}.pr-kpi strong{font-size:23px;letter-spacing:-.035em}.pr-kpi small{font-size:9px;color:#8791a2}.pr-delta{display:inline-flex;align-items:center;width:max-content;border-radius:999px;padding:4px 7px;font-size:9px;font-weight:850;background:#eef1f5;color:#687386}.pr-delta.good{background:#e9f8ef;color:#067647}.pr-delta.bad{background:#fff0ef;color:#b42318}.pr-kpi.primary{border-color:#d6dcff;background:linear-gradient(145deg,#fff,#f7f8ff)}
      .pr-grid-2{display:grid;grid-template-columns:1.35fr .65fr;gap:12px}.pr-panel{background:#fff;border:1px solid #dfe4ec;border-radius:20px;padding:16px}.pr-panel-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}.pr-panel-head h2,.pr-panel-head h3{margin:0;font-size:16px}.pr-panel-head p{margin:4px 0 0;color:#7b8495;font-size:10px;line-height:1.4}.pr-chip{border-radius:999px;background:#f1f3f7;padding:5px 8px;font-size:9px;font-weight:850;color:#5f697a;white-space:nowrap}
      .pr-secondary{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.pr-mini{border:1px solid #e3e7ed;border-radius:15px;padding:12px;background:#fafbfc}.pr-mini span{display:block;font-size:9px;color:#7b8495;text-transform:uppercase;letter-spacing:.04em}.pr-mini strong{display:block;font-size:16px;margin-top:5px}.pr-mini small{font-size:9px;color:#8b94a3}
      .pr-chart{height:190px;display:flex;align-items:flex-end;gap:5px;padding:15px 2px 24px;border-bottom:1px solid #e7eaf0;overflow:hidden}.pr-chart-group{flex:1;min-width:8px;display:flex;align-items:flex-end;justify-content:center;gap:2px;height:100%;position:relative}.pr-chart-bar{width:min(12px,44%);border-radius:5px 5px 1px 1px;min-height:1px}.pr-chart-bar.income{background:#7fbd79}.pr-chart-bar.expense{background:#4a4ee8}.pr-chart-group label{position:absolute;bottom:-20px;font-size:7px;color:#8b94a3;white-space:nowrap}.pr-chart-legend{display:flex;gap:12px;margin-top:9px;font-size:9px;color:#687386}.pr-chart-legend i{display:inline-block;width:8px;height:8px;border-radius:3px;margin-right:4px}.pr-chart-legend .income i{background:#7fbd79}.pr-chart-legend .expense i{background:#4a4ee8}
      .pr-quality{display:grid;gap:8px}.pr-quality-row{display:flex;justify-content:space-between;gap:12px;border:1px solid #e5e9ef;border-radius:12px;padding:10px}.pr-quality-row span{font-size:10px;color:#657084}.pr-quality-row b{font-size:11px}.pr-quality-row.warn{background:#fff9e9;border-color:#f3df9b}.pr-quality-row.good{background:#f1fbf4;border-color:#ccebd5}
      .pr-table-wrap{overflow:auto;border:1px solid #e2e6ed;border-radius:16px}.pr-table{width:100%;border-collapse:collapse;min-width:760px;background:#fff}.pr-table th{position:sticky;top:0;background:#f7f8fa;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.04em;color:#687386;padding:10px;border-bottom:1px solid #e2e6ed;white-space:nowrap}.pr-table td{padding:10px;border-bottom:1px solid #edf0f4;font-size:10px;color:#344054;vertical-align:top}.pr-table tr:last-child td{border-bottom:0}.pr-table td strong{font-size:11px;color:#101828}.pr-table .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.pr-table .positive{color:#067647}.pr-table .negative{color:#b42318}.pr-table .muted{color:#8a93a2}.pr-table tbody tr:hover{background:#fafbfe}
      .pr-category-row{display:grid;grid-template-columns:minmax(170px,1fr) 3fr auto;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid #edf0f4}.pr-category-row:last-child{border-bottom:0}.pr-category-row strong{font-size:11px}.pr-category-row small{display:block;color:#8a93a2;font-size:9px;margin-top:2px}.pr-category-bar{height:8px;background:#eef1f5;border-radius:999px;overflow:hidden}.pr-category-bar i{display:block;height:100%;background:#4a4ee8;border-radius:999px}.pr-category-value{text-align:right}.pr-category-value b{display:block;font-size:11px}.pr-category-value small{font-size:8px}
      .pr-account-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.pr-account-card{border:1px solid #e2e6ed;border-radius:14px;padding:11px}.pr-account-card .top{display:flex;justify-content:space-between;gap:10px}.pr-account-card strong{font-size:11px}.pr-account-card .balance{font-size:13px}.pr-account-card .line{display:flex;justify-content:space-between;margin-top:7px;color:#7b8495;font-size:9px}
      .pr-note{background:#f7f8fb;border:1px solid #e3e7ed;border-radius:13px;padding:11px;font-size:10px;color:#657084;line-height:1.45}.pr-note b{color:#344054}.pr-badge{display:inline-flex;border-radius:999px;padding:4px 7px;background:#eef1f5;font-size:8px;font-weight:850;color:#657084}.pr-badge.personal{background:#fff0fb;color:#a23782}.pr-badge.business{background:#eef3ff;color:#3649d7}.pr-badge.open{background:#eef3ff;color:#3649d7}.pr-badge.partial{background:#fff5df;color:#996400}.pr-badge.paid{background:#eaf9ef;color:#067647}.pr-badge.overdue{background:#fff0ef;color:#b42318}
      .pr-section-gap{margin-top:12px}.pr-empty{padding:28px;text-align:center;border:1px dashed #ced5df;border-radius:16px;background:#fff;color:#7b8495;font-size:11px}.pr-print-footer{display:none}.pr-drill{cursor:pointer}.pr-drill:hover strong{text-decoration:underline}
      @media(max-width:980px){.pr-filter-grid{grid-template-columns:repeat(3,1fr)}.pr-search-field,.pr-run-wrap{grid-column:span 3}.pr-kpis{grid-template-columns:1fr 1fr}.pr-grid-2{grid-template-columns:1fr}.pr-secondary{grid-template-columns:1fr 1fr}}
      @media(max-width:620px){#view-pro-reports{max-width:none}.pr-heading{display:block}.pr-heading-actions{margin-top:10px;display:grid;grid-template-columns:1fr 1fr}.pr-filter-card{padding:13px}.pr-filter-grid{grid-template-columns:1fr 1fr}.pr-search-field,.pr-run-wrap{grid-column:1/-1}.pr-kpis{grid-template-columns:1fr 1fr}.pr-kpi{min-height:105px;padding:12px}.pr-kpi strong{font-size:19px}.pr-secondary{grid-template-columns:1fr 1fr}.pr-account-grid{grid-template-columns:1fr}.pr-category-row{grid-template-columns:1.2fr 1fr auto}.bottom-nav{grid-template-columns:repeat(6,1fr)!important}.bottom-nav small{font-size:7px!important}}
      @media print{
        body{background:#fff!important}.desktop-sidebar,.topbar,.bottom-nav,.fab,.pr-filter-card,.pr-tabs,.pr-heading-actions,#toast{display:none!important}main{padding:0!important;margin:0!important;max-width:none!important}.view{display:none!important}#view-pro-reports{display:block!important;max-width:none!important}.pr-shell{gap:10px}.pr-heading{display:block}.pr-heading h1{font-size:24px}.pr-panel,.pr-kpi{break-inside:avoid;box-shadow:none}.pr-table-wrap{overflow:visible;border-color:#bbb}.pr-table{min-width:0}.pr-table th{position:static}.pr-print-footer{display:block;margin-top:14px;padding-top:8px;border-top:1px solid #bbb;font-size:9px;color:#666}.pr-chart{height:150px}@page{size:landscape;margin:10mm}
      }
    `;document.head.appendChild(st);
  }

  async function runReport(){
    try{
      q('#prLoading').hidden=false;q('#prBody').innerHTML='';
      const p=new URLSearchParams();
      p.set('date_from',q('#prFrom').value);p.set('date_to',q('#prTo').value);
      if(q('#prAccount').value)p.set('account_id',q('#prAccount').value);
      if(q('#prScope').value)p.set('scope',q('#prScope').value);
      if(q('#prMovementType').value)p.set('movement_type',q('#prMovementType').value);
      if(q('#prCategory').value)p.set('category_id',q('#prCategory').value);
      if(q('#prSearch').value.trim())p.set('q',q('#prSearch').value.trim());
      report=await api('/api/pro-reports?'+p.toString());
      catalogs=report.catalogs||catalogs;
      fillFilters();
      renderContext();
      renderActiveTab();
      q('#prGenerated').textContent=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(report.generated_at));
    }catch(e){q('#prBody').innerHTML=`<div class="pr-empty">${esc(e.message)}</div>`;toastMsg(e.message);}
    finally{q('#prLoading').hidden=true;}
  }

  function fillFilters(){
    const a=q('#prAccount'),c=q('#prCategory');
    const av=a.value,cv=c.value;
    a.innerHTML='<option value="">Todas as contas</option>'+catalogs.accounts.map(x=>`<option value="${x.id}">${esc(x.name)}${x.owner_scope==='personal'?' · pessoal':''}</option>`).join('');
    c.innerHTML='<option value="">Todas as categorias</option>'+catalogs.categories.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.parent_name?`${x.parent_name} › ${x.name}`:x.name)}</option>`).join('');
    if([...a.options].some(o=>o.value===av))a.value=av;
    if([...c.options].some(o=>o.value===cv))c.value=cv;
  }

  function renderContext(){
    const chips=[`${dateBR(report.meta.date_from)} a ${dateBR(report.meta.date_to)}`];
    if(q('#prAccount').value)chips.push('Conta: '+q('#prAccount').selectedOptions[0].textContent);
    if(q('#prScope').value)chips.push(q('#prScope').selectedOptions[0].textContent);
    if(q('#prMovementType').value)chips.push(q('#prMovementType').selectedOptions[0].textContent);
    if(q('#prCategory').value)chips.push('Categoria: '+q('#prCategory').selectedOptions[0].textContent);
    if(q('#prSearch').value.trim())chips.push('Busca: '+q('#prSearch').value.trim());
    chips.push(`${number(report.summary.movement_count)} movimentos de caixa`);
    q('#prContext').innerHTML=chips.map(x=>`<span>${esc(x)}</span>`).join('');
  }

  function renderActiveTab(){
    if(!report)return;
    const body=q('#prBody');
    if(activeTab==='executive')body.innerHTML=renderExecutive();
    if(activeTab==='cashflow')body.innerHTML=renderCashflow();
    if(activeTab==='movements')body.innerHTML=renderMovements();
    if(activeTab==='categories')body.innerHTML=renderCategories();
    if(activeTab==='cards')body.innerHTML=renderCards();
    if(activeTab==='commitments')body.innerHTML=renderCommitments();
    bindDrilldowns();
  }

  function renderExecutive(){
    const s=report.summary,p=report.previous,qc=report.quality;
    return `
      <div class="pr-kpis">
        ${kpi('Faturamento de vendas',s.sales_cents,comparePct(s.sales_cents,p.sales_cents),'Vendas registradas no período','primary')}
        ${kpi('Entradas totais',s.income_cents,comparePct(s.income_cents,p.income_cents),'Vendas, rendimentos e outras entradas; não inclui capital de giro')}
        ${kpi('Saídas de caixa',s.expense_cents,comparePct(s.expense_cents,p.expense_cents,true),'Dinheiro que efetivamente saiu das contas')}
        ${kpi('Resultado de caixa',s.net_cash_cents,compareMoney(s.net_cash_cents,p.net_cash_cents),'Entradas + financiamentos − saídas ± transferências da conta filtrada',s.net_cash_cents<0?'':'primary')}
      </div>

      <div class="pr-secondary pr-section-gap">
        ${mini('Resultado operacional',s.operational_cash_result_cents,'Entradas sem financiamento − operação − compras/estoque')}
        ${mini('Financiamentos recebidos',s.financing_in_cents,'Capital de giro / crédito recebido; não é receita')}
        ${mini('Retiradas pessoais',s.personal_cents,'Pagas pelo caixa no período')}
        ${mini('Compras / estoque',s.inventory_cents,'Pagamentos à vista e saídas classificadas')}
        ${mini('Taxas financeiras',s.fees_cents,'Maquininhas, tarifas e juros')}
      </div>

      <div class="pr-grid-2 pr-section-gap">
        <section class="pr-panel">
          <div class="pr-panel-head"><div><h2>Evolução do caixa</h2><p>Entradas e saídas do período. Transferências internas não inflam o total quando todas as contas estão selecionadas.</p></div><span class="pr-chip">${report.meta.days} dia${report.meta.days===1?'':'s'}</span></div>
          ${renderChart(report.daily)}
          <div class="pr-chart-legend"><span class="income"><i></i>Entradas</span><span class="expense"><i></i>Saídas</span></div>
        </section>
        <section class="pr-panel">
          <div class="pr-panel-head"><div><h2>Qualidade dos dados</h2><p>Pontos que podem reduzir a precisão dos relatórios.</p></div></div>
          <div class="pr-quality">
            ${qualityRow('Faturas ainda “a detalhar”',qc.undetailed_card_cents,money(qc.undetailed_card_cents),qc.undetailed_card_cents>0)}
            ${qualityRow('Lançamentos não identificados',qc.unidentified_count,`${qc.unidentified_count} · ${money(qc.unidentified_cents)}`,qc.unidentified_count>0)}
            ${qualityRow('Pendentes de reclassificação',qc.pending_reclassification_count,String(qc.pending_reclassification_count),qc.pending_reclassification_count>0)}
            ${qualityRow('Compras de cartão sem categoria',qc.uncategorized_card_count,String(qc.uncategorized_card_count),qc.uncategorized_card_count>0)}
            ${qualityRow('Histórico reconstruído no período',qc.historical_reconstruction_count,String(qc.historical_reconstruction_count),false)}
          </div>
        </section>
      </div>

      <div class="pr-grid-2 pr-section-gap">
        <section class="pr-panel">
          <div class="pr-panel-head"><div><h2>Maiores categorias de saída</h2><p>Visão gerencial soma saídas normais + compras detalhadas no cartão, sem contar pagamento de fatura duas vezes.</p></div><button class="pr-chip pr-drill" data-go-tab="categories">Ver todas</button></div>
          ${renderTopCategories(report.categories.slice(0,8))}
        </section>
        <section class="pr-panel">
          <div class="pr-panel-head"><div><h2>Saldo atual por conta</h2><p>Fotografia atual. Não representa o saldo no último dia do período selecionado.</p></div></div>
          <div class="pr-account-grid">${report.accounts.filter(a=>a.owner_scope==='business').map(accountCard).join('')||'<div class="pr-empty">Sem contas.</div>'}</div>
        </section>
      </div>

      <div class="pr-section-gap pr-note"><b>Leitura gerencial:</b> “Resultado operacional” é uma visão de gestão do caixa, não uma DRE fiscal/contábil. Compras detalhadas no cartão aparecem como consumo gerencial na data da compra; o pagamento da fatura permanece no fluxo de caixa, mas é neutralizado na análise por categoria para evitar duplicidade.</div>
    `;
  }

  function renderCashflow(){
    let cumulative=0;
    const rows=report.daily.map(d=>{cumulative=Number(d.cumulative_cents||0);return`<tr><td><strong>${dateBR(d.date)}</strong></td><td class="num positive">${money(d.income_cents)}</td><td class="num negative">${money(d.expense_cents)}</td><td class="num">${money(d.transfer_in_cents)}</td><td class="num">${money(d.transfer_out_cents)}</td><td class="num ${d.net_cents<0?'negative':'positive'}">${money(d.net_cents)}</td><td class="num ${cumulative<0?'negative':'positive'}">${money(cumulative)}</td></tr>`}).join('');
    return `
      <section class="pr-panel">
        <div class="pr-panel-head"><div><h2>Fluxo de caixa diário</h2><p>Movimento efetivo de dinheiro. Se uma conta específica estiver filtrada, transferências de entrada e saída afetam o saldo dessa conta.</p></div><span class="pr-chip">${dateBR(report.meta.date_from)} → ${dateBR(report.meta.date_to)}</span></div>
        <div class="pr-table-wrap"><table class="pr-table"><thead><tr><th>Data</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Transf. entrada</th><th class="num">Transf. saída</th><th class="num">Resultado dia</th><th class="num">Acumulado</th></tr></thead><tbody>${rows||'<tr><td colspan="7">Sem movimentos no período.</td></tr>'}</tbody></table></div>
      </section>
      <div class="pr-secondary pr-section-gap">
        ${mini('Entradas',report.summary.income_cents,'No período')}
        ${mini('Saídas',report.summary.expense_cents,'No período')}
        ${mini('Transferências',report.summary.transfer_total_cents,'Movimentação entre contas')}
        ${mini('Resultado líquido',report.summary.net_cash_cents,'Efeito no caixa')}
      </div>
    `;
  }

  function renderMovements(){
    const rows=report.movements.map(m=>{
      const isCard=m.kind==='card',sign=m.movement_type==='income'?'+':m.movement_type==='transfer'?'':'-';
      const cls=m.movement_type==='income'?'positive':m.movement_type==='transfer'?'':'negative';
      const scope=m.scope==='personal'?'<span class="pr-badge personal">Pessoal</span>':'<span class="pr-badge business">Empresa</span>';
      const type=isCard?'Compra no cartão':m.movement_type==='income'?'Entrada':m.movement_type==='expense'?'Saída':'Transferência';
      const cat=m.parent_category_name?`${m.parent_category_name} › ${m.category_name}`:m.category_name;
      const hist=m.opening_history?'<span class="pr-badge">Histórico</span>':'';
      return `<tr><td><strong>${dateBR(m.date)}</strong></td><td><strong>${esc(m.description)}</strong><div>${scope} ${hist}</div></td><td>${esc(type)}</td><td>${esc(cat||'Sem categoria')}</td><td>${esc(m.account||'—')}</td><td>${esc(methodLabel(m.payment_method))}</td><td class="num ${cls}">${sign}${money(m.amount_cents)}</td></tr>`;
    }).join('');
    return `
      <section class="pr-panel">
        <div class="pr-panel-head"><div><h2>Movimentações detalhadas</h2><p>Caixa e compras no cartão no mesmo relatório, identificadas separadamente.</p></div><span class="pr-chip">${number(report.movements_total)} registros</span></div>
        ${report.movements_total>1500?'<div class="pr-note">O período retornou mais de 1.500 registros. Refine os filtros para visualizar tudo em tela.</div>':''}
        <div class="pr-table-wrap"><table class="pr-table"><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Categoria</th><th>Conta / cartão</th><th>Forma</th><th class="num">Valor</th></tr></thead><tbody>${rows||'<tr><td colspan="7">Nenhum movimento encontrado.</td></tr>'}</tbody></table></div>
      </section>`;
  }

  function renderCategories(){
    const total=Math.max(1,...report.categories.map(x=>Number(x.managerial_cents||0)));
    const rows=report.categories.map(x=>{
      const label=x.parent_name?`${x.parent_name} › ${x.name}`:x.name;
      return `<tr class="pr-drill" data-category="${x.category_id||''}"><td><strong>${esc(label)}</strong><div class="muted">${esc(natureLabel(x.nature))} · ${number(x.count)} movimento${x.count===1?'':'s'}</div></td><td class="num">${money(x.cash_cents)}</td><td class="num">${money(x.card_cents)}</td><td class="num"><strong>${money(x.managerial_cents)}</strong></td></tr>`;
    }).join('');
    return `
      <div class="pr-grid-2">
        <section class="pr-panel">
          <div class="pr-panel-head"><div><h2>Ranking por categoria</h2><p>Base gerencial: saídas de caixa + compras detalhadas no cartão, neutralizando pagamento de fatura.</p></div></div>
          ${report.categories.length?report.categories.slice(0,12).map(x=>{const label=x.parent_name?`${x.parent_name} › ${x.name}`:x.name;const w=Math.max(2,Math.round(Number(x.managerial_cents||0)/total*100));return`<div class="pr-category-row pr-drill" data-category="${x.category_id||''}"><div><strong>${esc(label)}</strong><small>${esc(natureLabel(x.nature))}</small></div><div class="pr-category-bar"><i style="width:${w}%"></i></div><div class="pr-category-value"><b>${money(x.managerial_cents)}</b><small>${number(x.count)} mov.</small></div></div>`}).join(''):'<div class="pr-empty">Sem categorias no período.</div>'}
        </section>
        <section class="pr-panel">
          <div class="pr-panel-head"><div><h2>Composição</h2><p>Separação entre caixa e cartão.</p></div></div>
          <div class="pr-secondary" style="grid-template-columns:1fr 1fr">
            ${mini('Operação',report.summary.business_operating_cents,'Saídas de caixa')}
            ${mini('Estoque',report.summary.inventory_cents,'Saídas de caixa')}
            ${mini('Cartão · empresa',report.summary.card_business_cents,'Compras detalhadas')}
            ${mini('Cartão · pessoal',report.summary.card_personal_cents,'Compras detalhadas')}
          </div>
        </section>
      </div>
      <section class="pr-panel pr-section-gap">
        <div class="pr-panel-head"><div><h2>Todas as categorias</h2><p>Clique em uma categoria para abrir as movimentações correspondentes.</p></div></div>
        <div class="pr-table-wrap"><table class="pr-table"><thead><tr><th>Categoria</th><th class="num">Caixa</th><th class="num">Cartão</th><th class="num">Gerencial</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Sem dados.</td></tr>'}</tbody></table></div>
      </section>`;
  }

  function renderCards(){
    const bills=report.bills||[];
    const rows=bills.map(b=>{
      const st=b.status==='paid'?'paid':b.status==='partial'?'partial':b.status==='overdue'?'overdue':'open';
      const stText={paid:'Paga',partial:'Parcial',overdue:'Vencida',open:'Aberta'}[st];
      return `<tr><td><strong>${esc(b.card_name)}</strong><div class="muted">${periodBR(b.period_key)}</div></td><td>${dateBR(b.due_date)}</td><td><span class="pr-badge ${st}">${stText}</span></td><td class="num">${money(b.total_cents)}</td><td class="num">${money(b.business_cents)}</td><td class="num">${money(b.personal_cents)}</td><td class="num">${money(b.undetailed_cents)}</td><td class="num">${money(b.paid_cents)}</td><td class="num"><strong>${money(b.remaining_cents)}</strong></td></tr>`;
    }).join('');
    const total=bills.reduce((s,b)=>s+Number(b.total_cents||0),0),paid=bills.reduce((s,b)=>s+Number(b.paid_cents||0),0),remaining=bills.reduce((s,b)=>s+Number(b.remaining_cents||0),0),und=bills.reduce((s,b)=>s+Number(b.undetailed_cents||0),0);
    return `
      <div class="pr-secondary">
        ${mini('Faturas no período',total,`${bills.length} fatura${bills.length===1?'':'s'}`)}
        ${mini('Pago',paid,'Pagamentos registrados')}
        ${mini('Restante',remaining,'Ainda a pagar')}
        ${mini('A detalhar',und,'Sem classificação Empresa/Pessoal')}
      </div>
      <section class="pr-panel pr-section-gap">
        <div class="pr-panel-head"><div><h2>Cartões e faturas</h2><p>Faturas cuja competência ou vencimento está dentro do período selecionado.</p></div></div>
        <div class="pr-table-wrap"><table class="pr-table"><thead><tr><th>Cartão / fatura</th><th>Vencimento</th><th>Status</th><th class="num">Total</th><th class="num">Empresa</th><th class="num">Pessoal</th><th class="num">A detalhar</th><th class="num">Pago</th><th class="num">Restante</th></tr></thead><tbody>${rows||'<tr><td colspan="9">Nenhuma fatura no período.</td></tr>'}</tbody></table></div>
      </section>
      <div class="pr-note pr-section-gap"><b>Sem duplicidade:</b> compras detalhadas entram na análise gerencial na data da compra. O pagamento da fatura entra no fluxo de caixa, mas não é somado novamente ao ranking gerencial de categorias.</div>`;
  }

  function renderCommitments(){
    const obs=(report.obligations||[]).map(o=>{
      const due=o.due_date?dateBR(o.due_date):(o.due_day?`dia ${o.due_day}`:'—');
      const remaining=Math.max(0,Number(o.monthly_target_cents||0)-Number(o.paid_in_period_cents||0));
      return `<tr><td><strong>${esc(o.name)}</strong><div class="muted">${esc(o.category_name||natureLabel(o.nature))}</div></td><td>${o.scope==='personal'?'<span class="pr-badge personal">Pessoal</span>':'<span class="pr-badge business">Empresa</span>'}</td><td>${esc(due)}</td><td class="num">${money(o.monthly_target_cents)}</td><td class="num">${money(o.paid_in_period_cents)}</td><td class="num"><strong>${money(remaining)}</strong></td></tr>`;
    }).join('');
    const debts=(report.debts||[]).map(d=>`<tr><td><strong>${esc(d.name)}</strong><div class="muted">${d.flexible?'Conforme caixa':'Programado'}</div></td><td>${d.scope==='personal'?'<span class="pr-badge personal">Pessoal</span>':'<span class="pr-badge business">Empresa</span>'}</td><td class="num">${d.original_balance_cents==null?'—':money(d.original_balance_cents)}</td><td class="num">${d.current_balance_cents==null?'Saldo a informar':money(d.current_balance_cents)}</td><td class="num">${money(d.paid_in_period_cents)}</td></tr>`).join('');
    return `
      <section class="pr-panel">
        <div class="pr-panel-head"><div><h2>Contas e compromissos ativos</h2><p>Meta cadastrada e pagamentos vinculados dentro do período selecionado. Faturas de cartão ficam no relatório próprio.</p></div></div>
        <div class="pr-table-wrap"><table class="pr-table"><thead><tr><th>Compromisso</th><th>Escopo</th><th>Vencimento</th><th class="num">Referência</th><th class="num">Pago no período</th><th class="num">Diferença</th></tr></thead><tbody>${obs||'<tr><td colspan="6">Nenhum compromisso ativo.</td></tr>'}</tbody></table></div>
      </section>
      <section class="pr-panel pr-section-gap">
        <div class="pr-panel-head"><div><h2>Acordos e financiamentos</h2><p>Saldo atual da obrigação e quanto foi pago no período do relatório.</p></div></div>
        <div class="pr-table-wrap"><table class="pr-table"><thead><tr><th>Compromisso</th><th>Escopo</th><th class="num">Saldo inicial</th><th class="num">Saldo atual</th><th class="num">Pago no período</th></tr></thead><tbody>${debts||'<tr><td colspan="5">Nenhum acordo ativo.</td></tr>'}</tbody></table></div>
      </section>`;
  }

  function bindDrilldowns(){
    qa('[data-go-tab]').forEach(b=>b.onclick=()=>{activeTab=b.dataset.goTab;qa('[data-pr-tab]').forEach(x=>x.classList.toggle('active',x.dataset.prTab===activeTab));renderActiveTab();});
    qa('[data-category]').forEach(el=>el.onclick=()=>{
      const id=el.dataset.category;if(id){q('#prCategory').value=id;activeTab='movements';qa('[data-pr-tab]').forEach(x=>x.classList.toggle('active',x.dataset.prTab===activeTab));runReport();}
    });
  }

  function kpi(label,value,delta,sub,extra=''){
    return `<article class="pr-kpi ${extra}"><span class="label">${esc(label)}</span><strong class="${value<0?'negative':''}">${money(value)}</strong><span class="pr-delta ${delta.cls}">${esc(delta.text)}</span><small>${esc(sub)}</small></article>`;
  }
  function mini(label,value,sub){return`<div class="pr-mini"><span>${esc(label)}</span><strong class="${Number(value)<0?'negative':''}">${money(value)}</strong><small>${esc(sub)}</small></div>`;}
  function qualityRow(label,raw,value,warn){return`<div class="pr-quality-row ${warn?'warn':'good'}"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;}
  function comparePct(cur,prev,invert=false){
    cur=Number(cur||0);prev=Number(prev||0);
    if(prev===0)return{text:cur===0?'sem variação':'sem base anterior',cls:''};
    const d=(cur-prev)/Math.abs(prev)*100;
    const good=invert?d<=0:d>=0;
    return{text:`${d>=0?'+':''}${pct(d)} vs período anterior`,cls:good?'good':'bad'};
  }
  function compareMoney(cur,prev){const d=Number(cur||0)-Number(prev||0);return{text:`${d>=0?'+':''}${money(d)} vs período anterior`,cls:d>=0?'good':'bad'};}

  function renderChart(daily){
    const series=compressSeries(daily);
    const max=Math.max(1,...series.flatMap(x=>[x.income,x.expense]));
    return `<div class="pr-chart">${series.map((x,i)=>`<div class="pr-chart-group" title="${esc(x.label)} · Entradas ${money(x.income)} · Saídas ${money(x.expense)}"><i class="pr-chart-bar income" style="height:${Math.max(1,Math.round(x.income/max*100))}%"></i><i class="pr-chart-bar expense" style="height:${Math.max(1,Math.round(x.expense/max*100))}%"></i>${series.length<=18||i%Math.ceil(series.length/12)===0?`<label>${esc(x.short)}</label>`:''}</div>`).join('')}</div>`;
  }
  function compressSeries(daily){
    if(daily.length<=35)return daily.map(x=>({label:dateBR(x.date),short:x.date.slice(8,10),income:Number(x.income_cents||0),expense:Number(x.expense_cents||0)}));
    const map=new Map();
    daily.forEach(x=>{const k=x.date.slice(0,7);if(!map.has(k))map.set(k,{label:periodBR(k),short:periodBR(k).split('/')[0],income:0,expense:0});const y=map.get(k);y.income+=Number(x.income_cents||0);y.expense+=Number(x.expense_cents||0);});
    return [...map.values()];
  }
  function renderTopCategories(rows){
    if(!rows.length)return'<div class="pr-empty">Sem saídas categorizadas no período.</div>';
    const max=Math.max(1,...rows.map(x=>Number(x.managerial_cents||0)));
    return rows.map(x=>{const label=x.parent_name?`${x.parent_name} › ${x.name}`:x.name;return`<div class="pr-category-row pr-drill" data-category="${x.category_id||''}"><div><strong>${esc(label)}</strong><small>${esc(natureLabel(x.nature))}</small></div><div class="pr-category-bar"><i style="width:${Math.max(2,Math.round(Number(x.managerial_cents||0)/max*100))}%"></i></div><div class="pr-category-value"><b>${money(x.managerial_cents)}</b><small>gerencial</small></div></div>`}).join('');
  }
  function accountCard(a){return`<div class="pr-account-card"><div class="top"><strong>${esc(a.name)}</strong><b class="balance">${money(a.current_balance_cents)}</b></div><div class="line"><span>Movimento no período</span><b class="${a.net_cents<0?'negative':'positive'}">${money(a.net_cents)}</b></div></div>`;}
  function natureLabel(n){return({business_operating:'Empresa · operação',inventory:'Empresa · compras/estoque',business_debt:'Empresa · acordos/financiamentos',personal_withdrawal:'Pessoal',income:'Receita',transfer:'Transferência',unidentified:'Não identificado'})[n]||n||'—';}
  function methodLabel(m){return({pix:'Pix',cash:'Dinheiro',debit:'Débito',credit:'Crédito',transfer:'Transferência',boleto:'Boleto',other:'Outra'})[m]||m||'—';}

  function applyPreset(name){
    const t=today();let from=t,to=t;
    if(name==='yesterday'){from=to=addDays(t,-1);}
    if(name==='7'){from=addDays(t,-6);}
    if(name==='month'){[from,to]=monthRange(t);}
    if(name==='prevmonth'){const prev=addMonths(t,-1);[from,to]=monthRange(prev);}
    if(name==='90'){from=addDays(t,-89);}
    if(name==='year'){from=t.slice(0,4)+'-01-01';}
    q('#prFrom').value=from;q('#prTo').value=to;setPresetActive(name);runReport();
  }
  function setPresetActive(name){qa('[data-pr-preset]').forEach(b=>b.classList.toggle('active',b.dataset.prPreset===name));}
  function monthRange(d){const [y,m]=d.split('-').map(Number);const last=new Date(Date.UTC(y,m,0)).getUTCDate();return[`${y}-${String(m).padStart(2,'0')}-01`,`${y}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`];}
  function addDays(s,n){const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
  function addMonths(s,n){const d=new Date(s+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,10);}

  function exportCsv(){
    if(!report)return;
    let rows=[],name=`relatorio-${activeTab}-${report.meta.date_from}-a-${report.meta.date_to}.csv`;
    if(activeTab==='movements'){
      rows=[['Data','Descrição','Tipo','Escopo','Categoria','Conta/Cartão','Forma','Valor']];
      report.movements.forEach(m=>rows.push([dateBR(m.date),m.description,m.movement_type,m.scope,m.parent_category_name?`${m.parent_category_name} > ${m.category_name}`:m.category_name,m.account,methodLabel(m.payment_method),(Number(m.amount_cents||0)/100).toFixed(2).replace('.',',')]));
    }else if(activeTab==='cashflow'){
      rows=[['Data','Entradas','Saídas','Transferências entrada','Transferências saída','Resultado','Acumulado']];
      report.daily.forEach(d=>rows.push([dateBR(d.date),dec(d.income_cents),dec(d.expense_cents),dec(d.transfer_in_cents),dec(d.transfer_out_cents),dec(d.net_cents),dec(d.cumulative_cents)]));
    }else if(activeTab==='categories'){
      rows=[['Categoria','Natureza','Caixa','Cartão','Gerencial','Movimentos']];
      report.categories.forEach(x=>rows.push([x.parent_name?`${x.parent_name} > ${x.name}`:x.name,natureLabel(x.nature),dec(x.cash_cents),dec(x.card_cents),dec(x.managerial_cents),x.count]));
    }else if(activeTab==='cards'){
      rows=[['Cartão','Fatura','Vencimento','Status','Total','Empresa','Pessoal','A detalhar','Pago','Restante']];
      report.bills.forEach(b=>rows.push([b.card_name,periodBR(b.period_key),dateBR(b.due_date),b.status,dec(b.total_cents),dec(b.business_cents),dec(b.personal_cents),dec(b.undetailed_cents),dec(b.paid_cents),dec(b.remaining_cents)]));
    }else if(activeTab==='commitments'){
      rows=[['Tipo','Nome','Escopo','Referência/Saldo','Pago no período']];
      report.obligations.forEach(o=>rows.push(['Compromisso',o.name,o.scope,dec(o.monthly_target_cents),dec(o.paid_in_period_cents)]));
      report.debts.forEach(d=>rows.push(['Acordo/financiamento',d.name,d.scope,d.current_balance_cents==null?'Saldo a informar':dec(d.current_balance_cents),dec(d.paid_in_period_cents)]));
    }else{
      const s=report.summary;
      rows=[['Indicador','Valor'],['Faturamento de vendas',dec(s.sales_cents)],['Entradas totais (sem financiamentos)',dec(s.income_cents)],['Financiamentos recebidos',dec(s.financing_in_cents)],['Saídas de caixa',dec(s.expense_cents)],['Resultado de caixa',dec(s.net_cash_cents)],['Operação',dec(s.business_operating_cents)],['Compras/estoque',dec(s.inventory_cents)],['Retiradas pessoais',dec(s.personal_cents)],['Acordos/financiamentos pagos',dec(s.debt_cents)],['Taxas financeiras',dec(s.fees_cents)],['Compras cartão empresa',dec(s.card_business_cents)],['Compras cartão pessoal',dec(s.card_personal_cents)]];
    }
    downloadCsv(name,rows);
  }
  function dec(c){return(Number(c||0)/100).toFixed(2).replace('.',',');}
  function downloadCsv(name,rows){
    const txt='\ufeff'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\r\n');
    const blob=new Blob([txt],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    toastMsg('CSV gerado.');
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
