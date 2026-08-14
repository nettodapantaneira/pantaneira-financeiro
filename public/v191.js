(() => {
  'use strict';

  const VERSION='1.9.1';
  let taxonomy=[];
  let debtMeta=null;
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(c||0)/100);
  const parseMoney=v=>{
    let s=String(v??'').replace(/R\$/gi,'').replace(/\s/g,'').trim();
    if(!s)return 0;
    if(s.includes(',')&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');
    else if(s.includes(','))s=s.replace(',','.');
    const n=Number(s);
    if(!Number.isFinite(n))throw new Error('Valor inválido.');
    return Math.round(n*100);
  };
  const api=async(path,opt={})=>{
    const r=await fetch(path,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})}});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||`Erro ${r.status}`);
    return j;
  };
  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Cuiaba',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

  const natureLabels={
    business_operating:'Empresa · operação',
    inventory:'Empresa · compras e estoque',
    business_debt:'Empresa · acordos e financiamentos',
    personal_withdrawal:'Pessoal',
    income:'Receitas',
    transfer:'Transferências',
    unidentified:'Não identificado'
  };

  const groupOrder=[
    'Estrutura e ocupação','Equipe e administração','Operação da loja',
    'Marketing e vendas','Financeiro e taxas','Manutenção e serviços',
    'Compras e estoque','Casa e moradia','Alimentação pessoal',
    'Mobilidade e viagens','Família e compromissos',
    'Saúde e desenvolvimento','Compras e lazer','Pets',
    'Receitas','Acordos e financiamentos'
  ];

  function toast(msg){
    const existing=q('#toast');
    if(existing){existing.textContent=msg;existing.hidden=false;setTimeout(()=>existing.hidden=true,2800);return;}
    let el=q('#v191Toast');
    if(!el){el=document.createElement('div');el.id='v191Toast';document.body.appendChild(el);}
    el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),2800);
  }

  async function init(){
    installStyles();
    buildDebtDialog();
    setVersion();
    relabelLegacyUI();
    await loadTaxonomy();
    organizeAllVisibleSelects();
    observeSelects();

    // Substitui o fluxo antigo de "Registrar pagamento" dos compromissos.
    window.prepareDebtPayment=openDebtPayment;

    // Garante que botões já renderizados e futuros usem o novo modal.
    document.addEventListener('click',e=>{
      const b=e.target.closest('[data-v18-pay-debt],[data-pay-debt]');
      if(!b)return;
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      openDebtPayment(Number(b.dataset.v18PayDebt||b.dataset.payDebt));
    },true);
  }

  function setVersion(){
    const f=q('.sidebar-foot strong');if(f)f.textContent='v'+VERSION;
  }

  function relabelLegacyUI(){
    const opt=q('#categoryNature option[value="business_debt"]');
    if(opt)opt.textContent='Empresa · acordos e financiamentos';
    const nopt=q('#nature option[value="business_debt"]');
    if(nopt)nopt.textContent='Empresa · acordo / financiamento';
    const eopt=q('#editNature option[value="business_debt"]');
    if(eopt)eopt.textContent='Empresa · acordo / financiamento';

    const debtHint=q('#debtWrap small');
    if(debtHint)debtHint.textContent='Vincule a um acordo, financiamento ou compromisso anterior.';
  }

  async function loadTaxonomy(){
    try{
      const data=await api('/api/categories?all=1');
      taxonomy=(data.categories||[]).map(c=>({...c,id:Number(c.id),parent_id:c.parent_id==null?null:Number(c.parent_id),active:Number(c.active||0)}));
    }catch(e){console.warn('taxonomy',e);}
  }

  function activeCats(nature=null){
    return taxonomy.filter(c=>c.active!==0&&(!nature||c.nature===nature));
  }

  function childrenMap(cats){
    const m=new Map();
    cats.forEach(c=>{
      if(c.parent_id){
        if(!m.has(c.parent_id))m.set(c.parent_id,[]);
        m.get(c.parent_id).push(c);
      }
    });
    return m;
  }

  function categoryPath(cat,byId){
    const names=[cat.name];
    let p=cat.parent_id?byId.get(cat.parent_id):null;
    let guard=0;
    while(p&&guard++<4){names.unshift(p.name);p=p.parent_id?byId.get(p.parent_id):null;}
    return names.join(' › ');
  }

  function organizeSelect(select,nature=null,includeAll=false){
    if(!select||!taxonomy.length)return;
    const current=select.value;
    const cats=activeCats(nature);
    const byId=new Map(taxonomy.map(c=>[c.id,c]));
    const kids=childrenMap(cats);
    const parents=new Set(cats.filter(c=>kids.has(c.id)).map(c=>c.id));
    const leaves=cats.filter(c=>!parents.has(c.id));

    select.innerHTML='';
    if(includeAll){
      const o=document.createElement('option');o.value='';o.textContent='Todas as categorias';select.appendChild(o);
    }

    const grouped=new Map();
    leaves.forEach(c=>{
      const root=findDisplayParent(c,byId,parents);
      const key=root?`${c.nature}|${root.id}`:`${c.nature}|0`;
      if(!grouped.has(key))grouped.set(key,{nature:c.nature,parent:root,items:[]});
      grouped.get(key).items.push(c);
    });

    const groups=[...grouped.values()].sort((a,b)=>{
      const na=Object.keys(natureLabels).indexOf(a.nature),nb=Object.keys(natureLabels).indexOf(b.nature);
      if(na!==nb)return na-nb;
      const ga=groupOrder.indexOf(a.parent?.name),gb=groupOrder.indexOf(b.parent?.name);
      if(ga!==gb)return (ga<0?999:ga)-(gb<0?999:gb);
      return String(a.parent?.name||'Outros').localeCompare(String(b.parent?.name||'Outros'),'pt-BR');
    });

    groups.forEach(g=>{
      const og=document.createElement('optgroup');
      og.label=g.parent
        ? `${natureLabels[g.nature]||g.nature} · ${g.parent.name}`
        : `${natureLabels[g.nature]||g.nature} · Outros`;
      g.items.sort((a,b)=>categoryPath(a,byId).localeCompare(categoryPath(b,byId),'pt-BR')).forEach(c=>{
        const o=document.createElement('option');o.value=String(c.id);
        let label=categoryPath(c,byId);
        if(g.parent&&label.startsWith(g.parent.name+' › '))label=label.slice(g.parent.name.length+3);
        o.textContent=label;
        og.appendChild(o);
      });
      select.appendChild(og);
    });

    if([...select.options].some(o=>o.value===current))select.value=current;
  }

  function findDisplayParent(cat,byId,parentIds){
    let p=cat.parent_id?byId.get(cat.parent_id):null;
    let last=p,guard=0;
    while(p&&guard++<4){last=p;p=p.parent_id?byId.get(p.parent_id):null;}
    return last||null;
  }

  function organizeAllVisibleSelects(){
    const map=[
      ['#category',()=>q('#nature')?.value,false],
      ['#purchaseCategory',()=>q('#purchaseNature')?.value,false],
      ['#openingCategory',()=>q('#openingNature')?.value,false],
      ['#editCategory',()=>q('#editNature')?.value,false],
      ['#ccItemCategory',()=>q('#ccItemScope')?.value==='personal'?'personal_withdrawal':q('#ccItemNature')?.value,false],
      ['#prCategory',()=>null,true]
    ];
    map.forEach(([sel,getNature,all])=>organizeSelect(q(sel),getNature(),all));
  }

  function observeSelects(){
    ['#nature','#purchaseNature','#openingNature','#editNature','#ccItemScope','#ccItemNature'].forEach(s=>{
      q(s)?.addEventListener('change',()=>setTimeout(organizeAllVisibleSelects,30));
    });

    const obs=new MutationObserver(()=>{
      if(!obs._busy){
        obs._busy=true;
        setTimeout(()=>{organizeAllVisibleSelects();decorateCategoryManager();obs._busy=false;},60);
      }
    });
    obs.observe(document.body,{childList:true,subtree:true});

    q('#categoryDialog')?.addEventListener('toggle',decorateCategoryManager);
  }

  function decorateCategoryManager(){
    const host=q('#categoryManagerList');if(!host||!taxonomy.length)return;
    const byId=new Map(taxonomy.map(c=>[c.id,c]));
    qa('[data-edit-category]',host).forEach(btn=>{
      const id=Number(btn.dataset.editCategory),c=byId.get(id);
      if(!c)return;
      const row=btn.closest('.category-row');if(!row)return;
      row.classList.toggle('v191-parent',taxonomy.some(x=>x.active&&x.parent_id===id));
      const strong=q('strong',row);if(strong&&!strong.dataset.v191){
        strong.dataset.v191='1';
        strong.textContent=categoryPath(c,byId);
      }
    });
  }

  function buildDebtDialog(){
    if(q('#v191DebtDialog'))return;
    const d=document.createElement('dialog');d.id='v191DebtDialog';d.className='v191-dialog';
    d.innerHTML=`
      <div class="v191-head"><div><strong>Registrar pagamento</strong><small id="v191DebtTitle"></small></div><button type="button" id="v191DebtClose">×</button></div>
      <form id="v191DebtForm">
        <input type="hidden" id="v191DebtId">
        <div class="v191-balance" id="v191DebtBalance"></div>
        <div class="v191-two">
          <div><label>Valor pago</label><input id="v191DebtAmount" inputmode="decimal" required placeholder="0,00"></div>
          <div><label>Data real do pagamento</label><input id="v191DebtDate" type="date" required></div>
        </div>
        <label>Conta de saída</label><select id="v191DebtAccount" required></select>
        <label>Forma</label><select id="v191DebtMethod">
          <option value="pix">Pix</option><option value="cash">Dinheiro</option>
          <option value="boleto">Boleto</option><option value="transfer">Transferência</option>
          <option value="debit">Débito</option><option value="other">Outra</option>
        </select>
        <div id="v191HistoricalBox" class="v191-historical" hidden>
          <label><input id="v191HistoricalConfirm" type="checkbox"> Este pagamento já estava incluído na fotografia inicial do saldo bancário.</label>
          <small>Será registrado na data correta e reduzirá o compromisso, mas não descontará novamente a conta.</small>
        </div>
        <label>Observação</label><textarea id="v191DebtNotes" rows="2" placeholder="Opcional"></textarea>
        <button class="btn primary" type="submit">Registrar pagamento</button>
      </form>`;
    document.body.appendChild(d);
    q('#v191DebtClose').onclick=()=>d.close();
    q('#v191DebtDate').addEventListener('change',updateHistoricalBox);
    q('#v191DebtForm').addEventListener('submit',saveDebtPayment);
  }

  async function openDebtPayment(id){
    try{
      debtMeta=await api(`/api/debt-payment-meta/${id}`);
      const debt=debtMeta.debt;
      q('#v191DebtId').value=id;
      q('#v191DebtTitle').textContent=debt.name;
      q('#v191DebtBalance').innerHTML=`<span>Saldo atual</span><strong>${debt.current_balance_cents==null?'Saldo a informar':money(debt.current_balance_cents)}</strong>`;
      q('#v191DebtAmount').value='';
      q('#v191DebtDate').value=debtMeta.today||today();
      q('#v191DebtDate').max=debtMeta.today||today();
      q('#v191DebtMethod').value='pix';
      q('#v191DebtNotes').value='';
      q('#v191HistoricalConfirm').checked=false;
      q('#v191DebtAccount').innerHTML=(debtMeta.accounts||[]).map(a=>`<option value="${a.id}">${esc(a.name)}${a.owner_scope==='personal'?' · pessoal':''}</option>`).join('');
      const nubank=(debtMeta.accounts||[]).find(a=>norm(a.name)==='nubank');
      if(nubank)q('#v191DebtAccount').value=String(nubank.id);
      updateHistoricalBox();
      q('#v191DebtDialog').showModal();
      setTimeout(()=>q('#v191DebtAmount').focus(),50);
    }catch(e){toast(e.message);}
  }

  function updateHistoricalBox(){
    if(!debtMeta)return;
    const d=q('#v191DebtDate').value;
    const historical=Boolean(d&&d<=debtMeta.opening_snapshot_date);
    q('#v191HistoricalBox').hidden=!historical;
    if(!historical)q('#v191HistoricalConfirm').checked=false;
  }

  async function saveDebtPayment(e){
    e.preventDefault();
    try{
      const amount=parseMoney(q('#v191DebtAmount').value);
      if(amount<=0)throw new Error('Informe o valor pago.');
      const payload={
        amount_cents:amount,
        paid_date:q('#v191DebtDate').value,
        source_account_id:Number(q('#v191DebtAccount').value),
        payment_method:q('#v191DebtMethod').value,
        notes:q('#v191DebtNotes').value.trim(),
        confirm_historical:q('#v191HistoricalConfirm').checked
      };
      const id=Number(q('#v191DebtId').value);
      const result=await api(`/api/debts/${id}/pay-with-date`,{method:'POST',body:JSON.stringify(payload)});
      q('#v191DebtDialog').close();
      toast(result.historical?'Pagamento histórico registrado sem descontar novamente a conta.':'Pagamento registrado na data correta.');
      sessionStorage.setItem('pf-open-commitments','agreements');
      setTimeout(()=>location.reload(),650);
    }catch(err){toast(err.message);}
  }

  function installStyles(){
    if(q('#v191Styles'))return;
    const s=document.createElement('style');s.id='v191Styles';s.textContent=`
      #v191Toast{position:fixed;right:18px;bottom:18px;z-index:99999;background:#111827;color:white;padding:12px 15px;border-radius:12px;opacity:0;transform:translateY(8px);pointer-events:none;transition:.18s;font:650 12px system-ui;box-shadow:0 12px 34px rgba(0,0,0,.25)}#v191Toast.show{opacity:1;transform:none}
      .v191-dialog{width:min(620px,calc(100vw - 28px));border:0;border-radius:22px;padding:0;box-shadow:0 25px 80px rgba(15,23,42,.28)}.v191-dialog::backdrop{background:rgba(15,23,42,.55)}.v191-head{display:flex;align-items:center;justify-content:space-between;padding:17px 18px;border-bottom:1px solid #e4e8ee}.v191-head div{display:grid;gap:3px}.v191-head strong{font-size:15px}.v191-head small{color:#667085}.v191-head button{border:0;background:transparent;font-size:24px;cursor:pointer}
      #v191DebtForm{padding:18px;display:grid;gap:11px}#v191DebtForm label{font-size:10px;font-weight:850;color:#5f6979}#v191DebtForm input,#v191DebtForm select,#v191DebtForm textarea{width:100%;border:1px solid #d8dee8;border-radius:12px;padding:11px;background:#fff;min-height:42px;font:inherit}#v191DebtForm .btn{margin:4px 0 0}
      .v191-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.v191-two>div{display:grid;gap:5px}.v191-balance{display:flex;align-items:center;justify-content:space-between;background:#f5f7fb;border:1px solid #e1e6ee;border-radius:14px;padding:11px 13px}.v191-balance span{font-size:10px;color:#687386}.v191-balance strong{font-size:15px}
      .v191-historical{background:#fff8e7;border:1px solid #efd68d;border-radius:13px;padding:11px}.v191-historical label{display:flex;align-items:flex-start;gap:8px}.v191-historical input{width:auto!important;min-height:0!important;margin-top:2px}.v191-historical small{display:block;margin:6px 0 0 24px;color:#80651b;line-height:1.4}
      .category-row.v191-parent{background:#f3f5fa;border-color:#dfe4ee}.category-row.v191-parent strong::before{content:'GRUPO';font-size:7px;letter-spacing:.07em;background:#e6eaff;color:#3947c9;border-radius:999px;padding:3px 5px;margin-right:7px;vertical-align:2px}
      select optgroup{font-weight:800;color:#4b5565}
      @media(max-width:600px){.v191-two{grid-template-columns:1fr}}
    `;
    document.head.appendChild(s);
  }

  function reopenIfNeeded(){
    const tab=sessionStorage.getItem('pf-open-commitments');
    if(!tab)return;
    sessionStorage.removeItem('pf-open-commitments');
    setTimeout(()=>{
      document.querySelector('[data-view="dividas"]')?.click();
      setTimeout(()=>document.querySelector(`[data-ctab="${tab}"]`)?.click(),120);
    },250);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().then(reopenIfNeeded));else init().then(reopenIfNeeded);
})();
