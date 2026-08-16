(() => {
  'use strict';
  const V='1.8.1';
  const refs={accounts:[],categories:[],obligations:[],debts:[]};
  const q=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const api=async(path,opt={})=>{const r=await fetch(path,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Erro ${r.status}`);return j;};
  const money=c=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(c||0)/100);
  const parseMoney=v=>{let s=String(v??'').replace(/R\$/gi,'').replace(/\s/g,'').trim();if(!s)return 0;if(s.includes(',')&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');else if(s.includes(','))s=s.replace(',','.');const n=Number(s);if(!Number.isFinite(n))throw new Error('Valor inválido.');return Math.round(n*100);};
  function toast(msg){
    let el=q('#v181Toast');
    if(!el){el=document.createElement('div');el.id='v181Toast';Object.assign(el.style,{position:'fixed',right:'18px',bottom:'18px',zIndex:'99999',background:'#111827',color:'#fff',padding:'12px 15px',borderRadius:'12px',boxShadow:'0 8px 30px rgba(0,0,0,.22)',font:'600 13px system-ui',maxWidth:'360px'});document.body.appendChild(el);}
    el.textContent=msg;el.hidden=false;clearTimeout(el._t);el._t=setTimeout(()=>el.hidden=true,2600);
  }
  async function loadRefs(){
    const [a,c,o,d]=await Promise.all([api('/api/accounts'),api('/api/categories?all=1'),api('/api/obligations'),api('/api/debts')]);
    refs.accounts=a.accounts||[];refs.categories=c.categories||[];refs.obligations=o.obligations||[];refs.debts=d.debts||[];
    window.state=window.state||{};
    Object.assign(window.state,refs);
    return refs;
  }
  window.toast=window.toast||toast;
  window.loadAll=window.loadAll||loadRefs;
  window.showView=window.showView||function(name){
    const btn=document.querySelector(`[data-view="${name}"]`);
    if(btn){btn.click();return;}
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  };
  window.editDebt=window.editDebt||async function(id){
    const d=refs.debts.find(x=>Number(x.id)===Number(id));if(!d)return;
    const v=prompt(`Saldo atual de ${d.name}`,d.current_balance_cents==null?'':(Number(d.current_balance_cents)/100).toFixed(2).replace('.',','));if(v==null)return;
    await api(`/api/debts/${id}`,{method:'PATCH',body:JSON.stringify({current_balance_cents:String(v).trim()?parseMoney(v):null})});await loadRefs();toast('Saldo atualizado.');
    document.querySelector('[data-ctab="previous"]')?.click();
  };
  window.createDebt=window.createDebt||async function(){
    const name=prompt('Nome do compromisso anterior / credor');if(!name)return;
    const value=prompt('Saldo atual conhecido (pode deixar vazio)','');if(value==null)return;
    const personal=confirm('É um compromisso pessoal? OK = pessoal / Cancelar = empresa');
    await api('/api/debts',{method:'POST',body:JSON.stringify({name,creditor:name,scope:personal?'personal':'business',current_balance_cents:String(value).trim()?parseMoney(value):null,debt_kind:personal?'personal_agreement':'old',flexible:true})});await loadRefs();toast('Compromisso anterior cadastrado.');document.querySelector('[data-ctab="previous"]')?.click();
  };
  window.prepareDebtPayment=window.prepareDebtPayment||function(id){
    const d=refs.debts.find(x=>Number(x.id)===Number(id));if(!d)return;
    window.showView('lancar');
    setTimeout(()=>{
      const expenseBtn=document.querySelector('#directionSelector [data-value="expense"]');expenseBtn?.click();
      const nature=q('#nature');if(nature){nature.value=d.scope==='personal'?'personal_withdrawal':'business_debt';nature.dispatchEvent(new Event('change',{bubbles:true}));}
      setTimeout(()=>{const debt=q('#debt');if(debt)debt.value=String(id);const desc=q('#description');if(desc)desc.value=`Pagamento ${d.name}`;q('#amount')?.focus();},40);
    },40);
  };
  function fillAccounts(select,preferredId=null,allowEmpty=false,preferMercado=false){
    if(!select)return;
    const active=refs.accounts.filter(a=>Number(a.active)!==0);
    select.innerHTML=(allowEmpty?'<option value="">Nenhuma</option>':'')+active.map(a=>`<option value="${a.id}">${esc(a.name)}${a.owner_scope==='personal'?' · pessoal':''}</option>`).join('');
    let target=preferredId?String(preferredId):'';
    if(!target&&preferMercado){const mp=active.find(a=>String(a.name||'').trim().toLowerCase()==='mercado pago');if(mp)target=String(mp.id);}
    if(target&&[...select.options].some(o=>o.value===target))select.value=target;
  }
  function repairPaymentDialog(){
    const sel=q('#ccPayAccount');if(!sel)return;
    const info=(q('#ccPayInfo')?.textContent||'').toLowerCase();
    const preferMp=info.includes('mercado pago');
    if(sel.options.length===0||!sel.value)fillAccounts(sel,null,false,preferMp);
  }
  function repairCardDialog(){
    const sel=q('#ccPreferred');if(!sel)return;
    const current=sel.value||'';const name=(q('#ccCardName')?.value||'').toLowerCase();const issuer=(q('#ccIssuer')?.value||'').toLowerCase();
    fillAccounts(sel,current,true,name.includes('mercado pago')||issuer.includes('mercado pago'));
  }
  function repairItemCategories(){
    const sel=q('#ccItemCategory');if(!sel)return;
    const personal=q('#ccItemScope')?.value==='personal';const nature=personal?'personal_withdrawal':(q('#ccItemNature')?.value||'business_operating');
    const current=sel.value;const cats=refs.categories.filter(c=>c.nature===nature&&Number(c.active)!==0);
    sel.innerHTML=cats.map(c=>`<option value="${c.id}">${esc(c.parent_name?`${c.parent_name} › ${c.name}`:c.name)}</option>`).join('');
    if(current&&[...sel.options].some(o=>o.value===current))sel.value=current;
  }
  function observeDialogs(){
    const obs=new MutationObserver(()=>{
      if(q('#ccPayDialog')?.open)repairPaymentDialog();
      if(q('#ccCardDialog')?.open)repairCardDialog();
      if(q('#ccItemDialog')?.open)repairItemCategories();
    });
    ['#ccPayDialog','#ccCardDialog','#ccItemDialog'].forEach(s=>{const el=q(s);if(el)obs.observe(el,{attributes:true,attributeFilter:['open']});});
    q('#ccItemScope')?.addEventListener('change',()=>setTimeout(repairItemCategories,0));
    q('#ccItemNature')?.addEventListener('change',()=>setTimeout(repairItemCategories,0));
  }
  async function init(){
    try{await loadRefs();}catch(e){console.warn('v1.8.1 refs',e);}
    observeDialogs();
    
    document.querySelectorAll('.metric strong').forEach(el=>{if(/^1\.8\.0$/.test(el.textContent.trim()))el.textContent=V;});
    repairPaymentDialog();repairCardDialog();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
