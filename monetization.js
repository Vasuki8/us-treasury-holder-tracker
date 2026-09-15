(() => {
  const CONFIG = Object.freeze({
    currency:'USD',
    proMonthly:15,
    proAnnual:150,
    apiMonthly:99,
    checkout:{
      proMonthly:'',
      proAnnual:'',
      api:'',
    },
  });
  window.treasuryProductConfig = CONFIG;

  const state = {billing:localStorage.getItem('treasuryBilling') === 'annual' ? 'annual' : 'monthly'};
  const finite = value => Number.isFinite(Number(value));
  const fmtPct = value => finite(value) ? `${Number(value).toFixed(2)}%` : '—';
  const fmtBps = value => {
    const n=Number(value);
    if(!Number.isFinite(n)) return '—';
    return `${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(0)} bps`;
  };
  const fmtMoneyB = value => {
    const n=Number(value);
    if(!Number.isFinite(n)) return '—';
    return Math.abs(n)>=1000 ? `$${(n/1000).toFixed(2)}T` : `$${n.toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  };
  const fmtMoney = value => `$${Number(value).toLocaleString(undefined,{maximumFractionDigits:2})}`;
  const latest = rows => Array.isArray(rows)&&rows.length ? rows[rows.length-1] : null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function modal(){ return document.getElementById('productModalBackdrop'); }
  function openModal(kind='pro'){
    const backdrop=modal();
    if(!backdrop) return;
    const title=document.getElementById('productModalTitle');
    const copy=document.getElementById('productModalCopy');
    if(kind==='api'){
      if(title) title.textContent='Treasury Data API is next in the rollout';
      if(copy) copy.textContent='The public dashboard stays free. The paid API will add authenticated endpoints, higher limits, scheduled exports and normalized Treasury datasets for applications and research workflows.';
    }else{
      if(title) title.textContent='Treasury Pro early access';
      if(copy) copy.textContent='The product layer is ready for checkout. Connect Stripe and we can activate the Pro payment link here without changing the dashboard again. Pro will focus on alerts, scheduled briefs, saved workspaces and automated delivery—not paywalling the public Treasury data.';
    }
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden','false');
    backdrop.querySelector('.product-modal-close')?.focus();
  }
  function closeModal(){
    const backdrop=modal();
    if(!backdrop) return;
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden','true');
  }

  function wireModal(){
    document.querySelectorAll('[data-product-modal]').forEach(button=>button.addEventListener('click',()=>openModal(button.dataset.productModal||'pro')));
    document.querySelectorAll('[data-close-product-modal]').forEach(button=>button.addEventListener('click',closeModal));
    modal()?.addEventListener('click',event=>{ if(event.target===modal()) closeModal(); });
    document.addEventListener('keydown',event=>{ if(event.key==='Escape') closeModal(); });
  }

  function setBilling(next){
    state.billing=next==='annual'?'annual':'monthly';
    localStorage.setItem('treasuryBilling',state.billing);
    document.querySelectorAll('[data-billing]').forEach(button=>button.classList.toggle('active',button.dataset.billing===state.billing));
    const price=document.getElementById('proPrice');
    const cadence=document.getElementById('proCadence');
    const sub=document.getElementById('proPriceSub');
    if(state.billing==='annual'){
      if(price) price.textContent=fmtMoney(CONFIG.proAnnual/12);
      if(cadence) cadence.textContent='/mo';
      if(sub) sub.textContent=`Billed ${fmtMoney(CONFIG.proAnnual)} yearly · 2 months free`;
    }else{
      if(price) price.textContent=fmtMoney(CONFIG.proMonthly);
      if(cadence) cadence.textContent='/mo';
      if(sub) sub.textContent='Billed monthly · cancel anytime';
    }
    const checkout=state.billing==='annual'?CONFIG.checkout.proAnnual:CONFIG.checkout.proMonthly;
    document.querySelectorAll('[data-pro-checkout]').forEach(button=>{
      button.textContent=checkout?'Start Treasury Pro':'Join Pro early access';
      button.dataset.checkoutUrl=checkout||'';
    });
  }

  function wirePricing(){
    document.querySelectorAll('[data-billing]').forEach(button=>button.addEventListener('click',()=>setBilling(button.dataset.billing)));
    document.querySelectorAll('[data-pro-checkout]').forEach(button=>button.addEventListener('click',()=>{
      const url=button.dataset.checkoutUrl;
      if(url) window.location.assign(url); else openModal('pro');
    }));
    document.querySelectorAll('[data-api-checkout]').forEach(button=>button.addEventListener('click',()=>{
      if(CONFIG.checkout.api) window.location.assign(CONFIG.checkout.api); else openModal('api');
    }));
    setBilling(state.billing);
  }

  function demandSnapshot(data){
    const block=data?.auction_demand_monitor||{};
    const row=latest(block.dynamic_history?.observations)||latest(block.recent)||{};
    const score=finite(row.demand_score)?Number(row.demand_score):null;
    const label=row.demand_label||row.label||'Latest auction';
    return {value:score==null?'—':score.toFixed(0),meta:score==null?String(label):`${label} · 0–100 tracker score`};
  }

  function renderLiveSnapshot(data){
    const host=document.getElementById('proSignalGrid');
    if(!host) return;
    const overview=data?.overview||{};
    const yieldBlock=data?.treasury_yield_curve||{};
    const nominal=latest(yieldBlock.nominal?.history)||yieldBlock.nominal?.latest||{};
    const spread=latest(yieldBlock.spreads?.history)||yieldBlock.spreads?.latest||{};
    const funding=data?.treasury_funding_pressure||{};
    const horizon=funding.horizons?.['90D']||{};
    const demand=demandSnapshot(data);
    const cards=[
      ['10Y Treasury',fmtPct(nominal['10y']),nominal.date?`Par yield · ${nominal.date}`:'Official par yield'],
      ['10Y − 2Y',fmtBps(spread['10y_2y_bps']),spread.date?`Curve spread · ${spread.date}`:'Curve spread'],
      ['90D scheduled cash',fmtMoneyB(horizon.gross_scheduled_cash_billions),'Principal + modeled coupon cash'],
      ['Auction demand',demand.value,demand.meta],
    ];
    host.innerHTML=cards.map(([label,value,meta])=>`<article class="pro-signal"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></article>`).join('');
    const meta=document.getElementById('proSignalMeta');
    if(meta){
      const stamp=data?.generated_at ? new Date(data.generated_at).toLocaleString() : 'latest official refresh';
      meta.textContent=`Live public data · ${stamp}`;
    }
    const debt=document.getElementById('proDebtContext');
    if(debt&&finite(overview.total_public_debt)) debt.textContent=`The same underlying public dashboard remains free, including ${fmtMoneyB(Number(overview.total_public_debt)/1e9)} of total public debt context.`;
  }

  function init(){
    wireModal();
    wirePricing();
    if(window.treasuryData) renderLiveSnapshot(window.treasuryData);
    else window.addEventListener('treasury:data-ready',event=>renderLiveSnapshot(event.detail),{once:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
