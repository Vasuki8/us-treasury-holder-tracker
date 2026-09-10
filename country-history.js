(() => {
  const state = { data: null, selected: null, range: '5Y', drawerChart: null, trendChart: null, observer: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtB = value => value == null || !Number.isFinite(Number(value)) ? '—' : `$${Number(value).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  const fmtPct = value => value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(1)}%`;
  const signedB = value => value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value)>=0?'+':''}${Number(value).toFixed(1)}B`;

  function foreign(){ return state.data?.foreign_holders || {}; }
  function countries(){ return foreign().countries || []; }
  function byName(name){ return countries().find(row => row.name === name); }
  function historyFor(row){ return (row?.history || []).slice().sort((a,b) => String(a.period).localeCompare(String(b.period))); }
  function clippedHistory(row, range=state.range){
    const hist = historyFor(row);
    const count = ({'1Y':13,'3Y':37,'5Y':61,'ALL':9999})[range] || 61;
    return hist.slice(-count);
  }
  function tone(value){ return value == null ? '' : Number(value) >= 0 ? 'good' : 'bad'; }

  function buildDrawer(){
    if(document.getElementById('countryHistoryDrawer')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="country-history-backdrop" id="countryHistoryBackdrop" hidden></div>
      <aside class="country-history-drawer" id="countryHistoryDrawer" aria-hidden="true" aria-label="Country Treasury history">
        <div class="country-history-head">
          <div><span>Foreign Treasury holder</span><h3 id="countryHistoryTitle">Country</h3><small id="countryHistoryMeta"></small></div>
          <button class="country-history-close" id="countryHistoryClose" type="button" aria-label="Close country history">×</button>
        </div>
        <div class="country-history-body">
          <div class="country-history-metrics" id="countryHistoryMetrics"></div>
          <div class="country-history-chart-head"><strong>Holdings history</strong><div class="country-range" id="countryHistoryRange"></div></div>
          <div class="country-history-chart"><canvas id="countryHistoryChart"></canvas></div>
          <div class="country-history-flow" id="countryHistoryFlow"></div>
          <p class="country-history-note" id="countryHistoryNote"></p>
          <button class="country-history-open-link" id="countryHistoryResearch" type="button">Open full country research →</button>
        </div>
      </aside>`);
    document.getElementById('countryHistoryClose')?.addEventListener('click', closeDrawer);
    document.getElementById('countryHistoryBackdrop')?.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && document.body.classList.contains('country-history-open')) closeDrawer(); });
    document.getElementById('countryHistoryResearch')?.addEventListener('click', () => {
      closeDrawer();
      document.querySelector('[data-ux4-view="full"]')?.click();
      setTimeout(() => {
        const select = document.getElementById('trendCountry');
        if(select && state.selected){ select.value = state.selected.name; select.dispatchEvent(new Event('change')); }
        document.getElementById('foreignTrendChart')?.closest('.panel')?.scrollIntoView({behavior:'smooth',block:'start'});
      }, 120);
    });
  }

  function rangeButtons(host, active, onSelect){
    if(!host) return;
    host.innerHTML = ['1Y','3Y','5Y','ALL'].map(r => `<button type="button" data-country-range="${r}" class="${r===active?'active':''}">${r==='ALL'?'All':r}</button>`).join('');
    host.querySelectorAll('[data-country-range]').forEach(btn => btn.addEventListener('click', () => onSelect(btn.dataset.countryRange)));
  }

  function drawDrawerChart(){
    const canvas = document.getElementById('countryHistoryChart');
    if(!canvas || !state.selected || !window.Chart) return;
    if(state.drawerChart) state.drawerChart.destroy();
    const hist = clippedHistory(state.selected);
    state.drawerChart = new Chart(canvas, {
      type:'line',
      data:{labels:hist.map(h=>h.period),datasets:[{label:'Treasury holdings ($B)',data:hist.map(h=>h.holdings_billions),borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:.18,fill:false}]},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>` ${fmtB(ctx.parsed.y)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#7890a4',maxTicksLimit:7}},y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#7890a4',callback:v=>`$${v}B`}}}}
    });
  }

  function openDrawer(row){
    if(!row) return;
    buildDrawer();
    state.selected = row;
    state.range = (row.history?.length || 0) >= 61 ? '5Y' : 'ALL';
    const f = foreign();
    document.getElementById('countryHistoryTitle').textContent = row.name || 'Country';
    document.getElementById('countryHistoryMeta').textContent = `Treasury TIC · ${f.as_of || '—'} · monthly`;
    const metrics = [
      ['Holdings',fmtB(row.holdings_billions),''],
      ['1 month',signedB(row.change_billions),tone(row.change_billions)],
      ['1 year',signedB(row.change_12m_billions),tone(row.change_12m_billions)],
      ['5 years',signedB(row.change_60m_billions),tone(row.change_60m_billions)],
      ['Long-term share',fmtPct(row.long_term_share_pct),''],
      ['Short-term share',fmtPct(row.short_term_share_pct),''],
    ];
    document.getElementById('countryHistoryMetrics').innerHTML = metrics.map(([k,v,c]) => `<div class="country-history-metric ${c}"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
    const flow = [
      ['Latest net purchases / sales',signedB(row.net_sales_billions),tone(row.net_sales_billions)],
      ['Long-term valuation change',signedB(row.long_term_valuation_change_billions),tone(row.long_term_valuation_change_billions)],
    ];
    document.getElementById('countryHistoryFlow').innerHTML = flow.map(([k,v,c]) => `<div class="country-history-metric ${c}"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
    document.getElementById('countryHistoryNote').textContent = `History available ${f.history_start || 'from the earliest stored observation'} to ${f.as_of || 'latest'}. TIC country attribution can reflect custodial location rather than the ultimate beneficial owner.`;
    rangeButtons(document.getElementById('countryHistoryRange'),state.range,r=>{state.range=r;rangeButtons(document.getElementById('countryHistoryRange'),r,arguments.callee);drawDrawerChart();});
    // Re-bind without relying on arguments.callee in strict browser environments.
    const host = document.getElementById('countryHistoryRange');
    const bind = r => { state.range=r; rangeButtons(host,r,bind); drawDrawerChart(); };
    rangeButtons(host,state.range,bind);
    drawDrawerChart();
    document.getElementById('countryHistoryBackdrop').hidden = false;
    document.body.classList.add('country-history-open');
    document.getElementById('countryHistoryDrawer').setAttribute('aria-hidden','false');
  }

  function closeDrawer(){
    document.body.classList.remove('country-history-open');
    const drawer = document.getElementById('countryHistoryDrawer');
    const backdrop = document.getElementById('countryHistoryBackdrop');
    if(drawer) drawer.setAttribute('aria-hidden','true');
    if(backdrop) backdrop.hidden = true;
  }

  function decorateForeignPanel(){
    const f = foreign();
    const meta = document.getElementById('foreignMeta');
    if(meta && f.country_count) meta.textContent = `Treasury TIC · ${f.as_of || '—'} · ${f.country_count} countries · history since ${f.history_start || '—'}`;
    const table = document.getElementById('foreignTable');
    if(!table) return;
    table.querySelectorAll('tr').forEach(row => {
      if(row.dataset.countryHistoryReady || !row.cells?.length) return;
      const name = row.cells[0]?.childNodes?.[0]?.textContent?.trim() || row.cells[0]?.innerText?.trim() || '';
      const country = byName(name);
      if(!country) return;
      row.dataset.countryHistoryReady = '1';
      row.title = `Open ${country.name} Treasury holdings history`;
      row.addEventListener('click', e => {
        if(e.target.closest('button,a,input,select')) return;
        openDrawer(country);
      });
    });
  }

  function setupFullTrendExplorer(){
    const select = document.getElementById('trendCountry');
    const canvas = document.getElementById('foreignTrendChart');
    const meta = document.getElementById('foreignTrendMeta');
    const panel = canvas?.closest('.panel');
    if(!select || !canvas || !panel || !countries().length) return;
    const h2 = panel.querySelector('h2');
    if(h2) h2.textContent = 'Foreign Holder History';

    const current = select.value;
    select.innerHTML = countries().map(row => `<option value="${esc(row.name)}">${esc(row.name)}</option>`).join('');
    if(countries().some(row=>row.name===current)) select.value=current;
    else select.value=countries()[0].name;

    let controls = panel.querySelector('.country-trend-range');
    if(!controls){
      controls = document.createElement('div');
      controls.className='country-trend-range';
      meta?.insertAdjacentElement('afterend',controls);
    }
    let range='5Y';
    const draw = () => {
      const row = byName(select.value) || countries()[0];
      if(!row) return;
      const count=({'1Y':13,'3Y':37,'5Y':61,'ALL':9999})[range]||61;
      const hist=historyFor(row).slice(-count);
      if(meta) meta.textContent = `${row.name} · ${fmtB(row.holdings_billions)} · 1Y ${signedB(row.change_12m_billions)} · 5Y ${signedB(row.change_60m_billions)} · ${hist.length} monthly observations shown`;
      const existing = Chart.getChart(canvas);
      if(existing) existing.destroy();
      state.trendChart = new Chart(canvas,{type:'line',data:{labels:hist.map(h=>h.period),datasets:[{label:`${row.name} holdings ($B)`,data:hist.map(h=>h.holdings_billions),borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:.16}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}}},scales:{x:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',maxTicksLimit:12}},y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`$${v}B`}}}}});
    };
    const bindRange = next => { range=next; rangeButtons(controls,range,bindRange); draw(); };
    rangeButtons(controls,range,bindRange);
    select.onchange=draw;
    draw();
  }

  function polish(){ decorateForeignPanel(); }

  async function load(){
    try{
      const r=await fetch(`data/dashboard.json?v=${Date.now()}`);
      if(!r.ok) return;
      state.data=await r.json();
      buildDrawer();
      decorateForeignPanel();
      setupFullTrendExplorer();
      let timer;
      state.observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(polish,80);});
      const table=document.getElementById('foreignTable');
      if(table) state.observer.observe(table,{childList:true,subtree:true});
      setTimeout(decorateForeignPanel,900);
    }catch(err){ console.error('Country history UI error',err); }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',load); else load();
})();
