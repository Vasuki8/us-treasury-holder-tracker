(() => {
  const publicConfig = window.treasuryBillingConfig || {};
  const plans = publicConfig.plans || {};
  const CONFIG = Object.freeze({
    currency:publicConfig.currency || 'USD',
    proMonthly:Number(plans.proMonthly?.price ?? 15),
    proAnnual:Number(plans.proAnnual?.price ?? 150),
    apiMonthly:Number(plans.apiMonthly?.price ?? 99),
    checkout:Object.freeze({
      proMonthly:publicConfig.checkout?.proMonthly || '',
      proAnnual:publicConfig.checkout?.proAnnual || '',
      api:publicConfig.checkout?.api || '',
    }),
  });
  window.treasuryProductConfig = CONFIG;

  const savedBilling = localStorage.getItem('treasuryBilling') === 'annual' ? 'annual' : 'monthly';
  const savedAlert = (() => {
    try { return JSON.parse(localStorage.getItem('treasuryAlertDraft') || 'null') || {}; }
    catch { return {}; }
  })();
  const state = {
    billing:savedBilling,
    data:null,
    alertDraft:{
      metric:savedAlert.metric || 'yield-10y',
      condition:savedAlert.condition === 'below' ? 'below' : 'above',
      threshold:Number.isFinite(Number(savedAlert.threshold)) ? Number(savedAlert.threshold) : null,
    },
  };

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
  const emitProductEvent = (name,detail={}) => window.dispatchEvent(new CustomEvent('treasury:product-event',{detail:{name,...detail}}));

  function modal(){ return document.getElementById('productModalBackdrop'); }
  function openModal(kind='pro'){
    const backdrop=modal();
    if(!backdrop) return;
    const title=document.getElementById('productModalTitle');
    const copy=document.getElementById('productModalCopy');
    if(kind==='api'){
      if(title) title.textContent='Treasury Data API pilot';
      if(copy) copy.textContent='The public dashboard stays free. The paid API will add authenticated endpoints, higher limits, scheduled exports and normalized Treasury datasets for applications and research workflows. Billing will activate after the authenticated API backend is deployed.';
    }else{
      if(title) title.textContent='Treasury Pro early access';
      if(copy) copy.textContent='The product and pricing layer is ready. Paid checkout will activate after Stripe and the entitlement backend are connected. Treasury Pro is built around alerts, scheduled briefs, saved workspaces and automated delivery—not paywalling public Treasury facts.';
    }
    emitProductEvent('modal_open',{kind});
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
    document.querySelectorAll('[data-billing]').forEach(button=>button.addEventListener('click',()=>{
      setBilling(button.dataset.billing);
      emitProductEvent('billing_toggle',{billing:state.billing});
    }));
    document.querySelectorAll('[data-pro-checkout]').forEach(button=>button.addEventListener('click',()=>{
      const url=button.dataset.checkoutUrl;
      emitProductEvent('checkout_start',{plan:state.billing==='annual'?'pro_annual':'pro_monthly',active:Boolean(url)});
      if(url) window.location.assign(url); else openModal('pro');
    }));
    document.querySelectorAll('[data-api-checkout]').forEach(button=>button.addEventListener('click',()=>{
      emitProductEvent('checkout_start',{plan:'api_monthly',active:Boolean(CONFIG.checkout.api)});
      if(CONFIG.checkout.api) window.location.assign(CONFIG.checkout.api); else openModal('api');
    }));
    setBilling(state.billing);
  }

  function demandRow(data){
    const block=data?.auction_demand_monitor||{};
    return latest(block.dynamic_history?.observations)||latest(block.recent)||{};
  }
  function demandSnapshot(data){
    const row=demandRow(data);
    const score=finite(row.demand_score)?Number(row.demand_score):null;
    const label=row.demand_label||row.label||'Latest auction';
    return {value:score==null?'—':score.toFixed(0),meta:score==null?String(label):`${label} · 0–100 tracker score`};
  }

  function metricCatalog(data){
    const yieldBlock=data?.treasury_yield_curve||{};
    const nominal=latest(yieldBlock.nominal?.history)||yieldBlock.nominal?.latest||{};
    const spread=latest(yieldBlock.spreads?.history)||yieldBlock.spreads?.latest||{};
    const funding=data?.treasury_funding_pressure||{};
    const horizon=funding.horizons?.['90D']||{};
    const demand=demandRow(data);
    return {
      'yield-10y':{label:'10Y Treasury yield',value:finite(nominal['10y'])?Number(nominal['10y']):null,unit:'%',digits:2,defaultThreshold:5},
      'spread-10y2y':{label:'10Y − 2Y spread',value:finite(spread['10y_2y_bps'])?Number(spread['10y_2y_bps']):null,unit:'bps',digits:0,defaultThreshold:0},
      'funding-90d':{label:'90D scheduled cash',value:finite(horizon.gross_scheduled_cash_billions)?Number(horizon.gross_scheduled_cash_billions):null,unit:'$B',digits:0,defaultThreshold:5000},
      'auction-demand':{label:'Auction demand score',value:finite(demand.demand_score)?Number(demand.demand_score):null,unit:'score',digits:0,defaultThreshold:35},
    };
  }

  function formatMetric(metric){
    if(!metric||!finite(metric.value)) return '—';
    if(metric.unit==='%') return `${Number(metric.value).toFixed(metric.digits)}%`;
    if(metric.unit==='bps') return `${Number(metric.value)>0?'+':''}${Number(metric.value).toFixed(metric.digits)} bps`;
    if(metric.unit==='$B') return fmtMoneyB(metric.value);
    return Number(metric.value).toFixed(metric.digits);
  }

  function renderAlertBuilder(){
    if(!state.data) return;
    const catalog=metricCatalog(state.data);
    const metricSelect=document.getElementById('alertMetric');
    const conditionSelect=document.getElementById('alertCondition');
    const thresholdInput=document.getElementById('alertThreshold');
    if(!metricSelect||!conditionSelect||!thresholdInput) return;

    if(!metricSelect.options.length){
      metricSelect.innerHTML=Object.entries(catalog).map(([key,item])=>`<option value="${esc(key)}">${esc(item.label)}</option>`).join('');
    }
    if(!catalog[state.alertDraft.metric]) state.alertDraft.metric='yield-10y';
    metricSelect.value=state.alertDraft.metric;
    conditionSelect.value=state.alertDraft.condition;
    const metric=catalog[state.alertDraft.metric];
    if(!finite(state.alertDraft.threshold)) state.alertDraft.threshold=metric.defaultThreshold;
    thresholdInput.value=String(state.alertDraft.threshold);
    thresholdInput.step=metric.digits===0?'1':'0.01';

    const threshold=Number(state.alertDraft.threshold);
    const current=Number(metric.value);
    const triggered=Number.isFinite(current)&&Number.isFinite(threshold)
      ? (state.alertDraft.condition==='above'?current>threshold:current<threshold)
      : null;
    const currentNode=document.getElementById('alertCurrentValue');
    const stateNode=document.getElementById('alertPreviewState');
    const metaNode=document.getElementById('alertPreviewMeta');
    if(currentNode) currentNode.textContent=formatMetric(metric);
    if(stateNode){
      stateNode.classList.toggle('triggered',triggered===true);
      stateNode.classList.toggle('quiet',triggered===false);
      stateNode.textContent=triggered===null?'Waiting for data':triggered?'Would trigger now':'Would stay quiet';
    }
    if(metaNode){
      const operator=state.alertDraft.condition==='above'?'above':'below';
      const thresholdLabel=metric.unit==='$B'?fmtMoneyB(threshold):metric.unit==='%'?`${threshold.toFixed(2)}%`:metric.unit==='bps'?`${threshold.toFixed(0)} bps`:threshold.toFixed(0);
      metaNode.textContent=`Preview rule: ${metric.label} ${operator} ${thresholdLabel}. No notification is sent from this public preview.`;
    }
  }

  function persistAlertDraft(){
    localStorage.setItem('treasuryAlertDraft',JSON.stringify(state.alertDraft));
  }

  function wireAlertBuilder(){
    const metricSelect=document.getElementById('alertMetric');
    const conditionSelect=document.getElementById('alertCondition');
    const thresholdInput=document.getElementById('alertThreshold');
    metricSelect?.addEventListener('change',()=>{
      const catalog=metricCatalog(state.data||{});
      state.alertDraft.metric=metricSelect.value;
      state.alertDraft.threshold=catalog[state.alertDraft.metric]?.defaultThreshold ?? 0;
      persistAlertDraft();
      renderAlertBuilder();
      emitProductEvent('alert_preview_change',{field:'metric',metric:state.alertDraft.metric});
    });
    conditionSelect?.addEventListener('change',()=>{
      state.alertDraft.condition=conditionSelect.value==='below'?'below':'above';
      persistAlertDraft();
      renderAlertBuilder();
      emitProductEvent('alert_preview_change',{field:'condition',condition:state.alertDraft.condition});
    });
    thresholdInput?.addEventListener('input',()=>{
      const value=Number(thresholdInput.value);
      state.alertDraft.threshold=Number.isFinite(value)?value:null;
      persistAlertDraft();
      renderAlertBuilder();
    });
    document.getElementById('saveAlertPreview')?.addEventListener('click',()=>{
      persistAlertDraft();
      emitProductEvent('alert_preview_save',{metric:state.alertDraft.metric,condition:state.alertDraft.condition});
      openModal('pro');
    });
  }

  function renderLiveSnapshot(data){
    state.data=data;
    const host=document.getElementById('proSignalGrid');
    if(host){
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
      const debt=document.getElementById('proDebtContext');
      if(debt&&finite(overview.total_public_debt)) debt.textContent=`The same underlying public dashboard remains free, including ${fmtMoneyB(Number(overview.total_public_debt)/1e9)} of total public debt context.`;
    }
    const meta=document.getElementById('proSignalMeta');
    if(meta){
      const stamp=data?.generated_at ? new Date(data.generated_at).toLocaleString() : 'latest official refresh';
      meta.textContent=`Live public data · ${stamp}`;
    }
    renderAlertBuilder();
  }

  function init(){
    wireModal();
    wirePricing();
    wireAlertBuilder();
    if(window.treasuryData) renderLiveSnapshot(window.treasuryData);
    else window.addEventListener('treasury:data-ready',event=>renderLiveSnapshot(event.detail),{once:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
