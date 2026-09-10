(() => {
  const STORE_KEY = 'treasury-ux-v3-compare';
  const state = { data: null, basket: [], observer: null, lastInspector: null };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtB = (v) => v == null || !Number.isFinite(Number(v)) ? '—' : `$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  const fmtPct = (v, d=1) => v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(d)}%`;
  const fmtSignedB = (v) => v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v)>=0?'+':''}${Number(v).toFixed(1)}B`;
  const fmtSignedPct = (v) => v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`;

  function loadBasket(){
    try{
      const rows = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(rows) ? rows.slice(0,2) : [];
    }catch{return [];}
  }
  state.basket = loadBasket();

  function saveBasket(){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(state.basket)); }catch{}
    renderCompareTray();
  }

  function setMode(mode){
    const button = document.querySelector(`.ux-mode-button[data-mode="${mode}"]`);
    if(button) button.click();
  }

  function scrollToPanel(id){
    const el = document.getElementById(id);
    if(el) setTimeout(() => el.scrollIntoView({behavior:'smooth',block:'start'}), 70);
  }

  function panelForNode(node){ return node?.closest?.('section.panel'); }

  function buildPulse(){
    const host = document.getElementById('uxWorkspaceTop');
    if(!host || document.getElementById('uxPulse')) return;
    const pulse = document.createElement('div');
    pulse.id = 'uxPulse';
    pulse.className = 'ux3-pulse';
    host.insertAdjacentElement('afterend', pulse);
  }

  function pulseItem(label, value, note, target, tone='neutral'){
    return `<button type="button" class="ux3-pulse-item ${tone}" data-pulse-target="${esc(target)}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></button>`;
  }

  function renderPulse(){
    const pulse = document.getElementById('uxPulse');
    if(!pulse || !state.data) return;
    const d = state.data;
    const overall = d.market_structure_map?.overall_state || 'Mixed';
    const auction = d.auction_demand_monitor?.recent?.[0] || {};
    const high = d.alert_intelligence?.high_count ?? 0;
    const releases = d.source_publications?.current_release_count ?? 0;
    const sources = d.provenance?.sources || [];
    const healthy = sources.filter(s => s.status === 'ok').length;
    const auctionScore = auction.demand_score == null ? '—' : `${Number(auction.demand_score).toFixed(0)}/100`;
    const overallTone = /supportive|strong|firm|accum/i.test(overall) ? 'good' : /cautious|soft|weak|stress/i.test(overall) ? 'warn' : 'neutral';
    pulse.innerHTML = [
      pulseItem('Market state', overall, 'Open structure map', 'marketStructurePanel', overallTone),
      pulseItem('Auction demand', auctionScore, auction.demand_label ? String(auction.demand_label).replaceAll('_',' ') : 'Latest auction', 'auctionDemandPanel', Number(auction.demand_score ?? 50) < 40 ? 'warn':'neutral'),
      pulseItem('High alerts', String(high), high ? 'Needs review' : 'No high alerts', 'releaseIntelligencePanel', high ? 'bad':'good'),
      pulseItem('New releases', String(releases), releases ? 'Fresh observations detected' : 'No new source release', 'releaseCalendarPanel', releases ? 'good':'neutral'),
      pulseItem('Source health', sources.length ? `${healthy}/${sources.length}` : '—', 'Official feeds healthy', 'sourceHealth', sources.length && healthy < sources.length ? 'warn':'good')
    ].join('');
    pulse.querySelectorAll('[data-pulse-target]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.pulseTarget;
      if(/alert|release|source/i.test(id)) setMode('monitor');
      else if(/auction/i.test(id)) setMode('explore');
      else setMode('overview');
      scrollToPanel(id);
    }));
  }

  function buildInspector(){
    if(document.getElementById('uxInspector')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="ux3-inspector-backdrop" id="uxInspectorBackdrop" hidden></div>
      <aside class="ux3-inspector" id="uxInspector" aria-hidden="true" aria-label="Research inspector">
        <div class="ux3-inspector-head"><div><span>Context inspector</span><strong id="uxInspectorTitle">Selection</strong><small id="uxInspectorMeta"></small></div><button type="button" id="uxInspectorClose" aria-label="Close inspector">×</button></div>
        <div class="ux3-inspector-body" id="uxInspectorBody"></div>
        <div class="ux3-inspector-actions" id="uxInspectorActions"></div>
      </aside>
      <div class="ux3-toast" id="ux3Toast" role="status" aria-live="polite"></div>`);
    document.getElementById('uxInspectorClose')?.addEventListener('click', closeInspector);
    document.getElementById('uxInspectorBackdrop')?.addEventListener('click', closeInspector);
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && document.body.classList.contains('ux3-inspector-open')) closeInspector(); });
  }

  function inspectorMetric(label, value, cls=''){
    return `<div class="ux3-inspector-metric ${cls}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  function holderByName(name, scope){
    const profiles = state.data?.holder_profiles?.profiles || [];
    return profiles.find(p => p.name === name && (!scope || p.scope === scope)) || profiles.find(p => p.name === name);
  }

  function securityByCusip(cusip){
    const rows = state.data?.security_intelligence?.rows || [];
    return rows.find(r => String(r.cusip) === String(cusip)) || (state.data?.soma?.top_holdings || []).find(r => String(r.cusip) === String(cusip));
  }

  function concentrationByCusip(cusip){
    return (state.data?.cusip_concentration?.top_securities || []).find(r => String(r.cusip) === String(cusip));
  }

  function auctionByText(row){
    const text = row?.innerText || '';
    const recent = state.data?.auction_demand_monitor?.recent || [];
    return recent.find(a => text.includes(a.auction_date || '') && (!a.security_term || text.includes(a.security_term))) || recent.find(a => text.includes(a.auction_date || ''));
  }

  function openInspector(kind, item){
    if(!item) return;
    buildInspector();
    state.lastInspector = { kind, item };
    const title = document.getElementById('uxInspectorTitle');
    const meta = document.getElementById('uxInspectorMeta');
    const body = document.getElementById('uxInspectorBody');
    const actions = document.getElementById('uxInspectorActions');
    if(!title || !meta || !body || !actions) return;

    if(kind === 'holder'){
      title.textContent = item.name || 'Holder';
      meta.textContent = `${item.scope || 'Holder'} · ${item.frequency || '—'} · ${item.as_of || '—'}`;
      const share = item.scope === 'Foreign country' ? item.share_of_foreign_total_pct : item.share_of_tracked_scope_pct;
      body.innerHTML = `<div class="ux3-inspector-grid">
        ${inspectorMetric('Current', fmtB(item.current_billions))}
        ${inspectorMetric('Latest change', fmtSignedB(item.change_billions), Number(item.change_billions||0)>=0?'good':'bad')}
        ${inspectorMetric('Change %', fmtSignedPct(item.change_pct), Number(item.change_pct||0)>=0?'good':'bad')}
        ${inspectorMetric('Rank', item.rank_within_scope ?? '—')}
        ${inspectorMetric('Tracked share', fmtPct(share))}
        ${inspectorMetric('Alert', item.alert_severity || 'None', item.alert_severity === 'high'?'bad':'')}
      </div><div class="ux3-inspector-copy"><span>Source</span><strong>${esc(item.source_name || item.source_key || 'Official source')}</strong><p>${esc(item.concept === 'market_positioning' ? 'This series is market positioning, not an ownership balance.' : 'This profile represents the latest holdings reported on its source cadence.')}</p></div>`;
      actions.innerHTML = `<button type="button" data-inspector-action="profile">Open full profile</button><button type="button" class="primary" data-inspector-action="compare">Add to compare</button>`;
    } else if(kind === 'security'){
      const c = concentrationByCusip(item.cusip) || {};
      title.textContent = item.cusip || 'CUSIP';
      meta.textContent = `${item.security_type || 'Treasury security'} · maturity ${item.maturity_date || '—'}`;
      body.innerHTML = `<div class="ux3-inspector-grid">
        ${inspectorMetric('SOMA par', fmtB(item.soma_par_billions ?? item.par_value_billions))}
        ${inspectorMetric('SOMA % outstanding', fmtPct(item.soma_pct_outstanding ?? c.soma_pct_outstanding))}
        ${inspectorMetric('Years to maturity', item.years_to_maturity == null ? '—' : Number(item.years_to_maturity).toFixed(2))}
        ${inspectorMetric('Concentration', c.soma_concentration_tier || item.soma_concentration_tier || '—')}
        ${inspectorMetric('Concentration rank', c.soma_concentration_rank ?? item.soma_concentration_rank ?? '—')}
        ${inspectorMetric('Implied outstanding', fmtB(c.implied_outstanding_billions ?? item.implied_outstanding_billions))}
      </div><div class="ux3-inspector-copy"><span>Research context</span><strong>${esc(item.original_term || item.auction_term || item.security_type || 'Treasury')}</strong><p>${esc(item.maturity_cross_check || item.metadata_status || 'Matched security-level context from available official-source blocks.')}</p></div>`;
      actions.innerHTML = `<button type="button" class="primary" data-inspector-action="security">Open CUSIP drill-down</button>`;
    } else if(kind === 'auction'){
      title.textContent = `${item.security_term || 'Treasury'} auction`;
      meta.textContent = `${item.auction_date || '—'} · ${item.demand_label ? String(item.demand_label).replaceAll('_',' ') : 'Demand monitor'}`;
      body.innerHTML = `<div class="ux3-inspector-grid">
        ${inspectorMetric('Demand score', item.demand_score == null ? '—' : `${Number(item.demand_score).toFixed(0)}/100`)}
        ${inspectorMetric('Bid-to-cover', item.bid_to_cover == null ? '—' : Number(item.bid_to_cover).toFixed(2))}
        ${inspectorMetric('Indirect share', fmtPct(item.indirect_share_pct))}
        ${inspectorMetric('Dealer share', fmtPct(item.dealer_share_pct))}
        ${inspectorMetric('Direct share', fmtPct(item.direct_share_pct))}
        ${inspectorMetric('Term', item.security_term || '—')}
      </div><div class="ux3-inspector-copy"><span>Interpretation</span><strong>${esc(item.demand_label ? String(item.demand_label).replaceAll('_',' ') : 'Auction demand')}</strong><p>The score is a transparent research heuristic based on bid-to-cover and bidder mix; it is not an official Treasury statistic.</p></div>`;
      actions.innerHTML = `<button type="button" class="primary" data-inspector-action="auction">Open auction monitor</button>`;
    }

    actions.querySelectorAll('[data-inspector-action]').forEach(btn => btn.addEventListener('click', () => handleInspectorAction(btn.dataset.inspectorAction)));
    document.body.classList.add('ux3-inspector-open');
    document.getElementById('uxInspector')?.setAttribute('aria-hidden','false');
    document.getElementById('uxInspectorBackdrop').hidden = false;
  }

  function closeInspector(){
    document.body.classList.remove('ux3-inspector-open');
    document.getElementById('uxInspector')?.setAttribute('aria-hidden','true');
    const back = document.getElementById('uxInspectorBackdrop'); if(back) back.hidden = true;
  }

  function handleInspectorAction(action){
    const current = state.lastInspector;
    if(!current) return;
    const item = current.item;
    if(action === 'profile'){
      closeInspector(); setMode('explore');
      setTimeout(() => {
        const scope = document.getElementById('holderProfileScope');
        const select = document.getElementById('holderProfileSelect');
        if(scope && select){ scope.value = item.scope; scope.dispatchEvent(new Event('change')); select.value = item.profile_id; select.dispatchEvent(new Event('change')); }
        scrollToPanel('holderProfilePanel');
      }, 120);
    }
    if(action === 'compare') addToCompare(item);
    if(action === 'security'){
      closeInspector(); setMode('explore');
      setTimeout(() => {
        const select = document.getElementById('securityDrillSelect');
        if(select && [...select.options].some(o => o.value === String(item.cusip))){ select.value = String(item.cusip); select.dispatchEvent(new Event('change')); }
        scrollToPanel('securityDrillPanel');
      },120);
    }
    if(action === 'auction'){ closeInspector(); setMode('explore'); scrollToPanel('auctionDemandPanel'); }
  }

  function toast(message){
    const el = document.getElementById('ux3Toast'); if(!el) return;
    el.textContent = message; el.classList.add('show');
    clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function addToCompare(profile){
    if(!profile?.profile_id) return;
    if(state.basket.some(p => p.profile_id === profile.profile_id)){ toast('Already in comparison'); return; }
    if(state.basket.length && state.basket[0].scope !== profile.scope){
      state.basket = [profile];
      toast(`Comparison reset to ${profile.scope}; scopes must match.`);
    } else {
      state.basket.push(profile);
      if(state.basket.length > 2) state.basket.shift();
      toast(state.basket.length === 2 ? 'Comparison ready' : 'Added to comparison');
    }
    saveBasket();
  }

  function buildCompareTray(){
    if(document.getElementById('uxCompareTray')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="ux3-compare-tray" id="uxCompareTray" hidden><div class="ux3-compare-copy"><span>Compare basket</span><strong id="uxCompareScope">Choose two holders from the same scope</strong></div><div class="ux3-compare-items" id="uxCompareItems"></div><button type="button" id="uxCompareNow" class="primary">Compare now</button><button type="button" id="uxCompareClear">Clear</button></div>`);
    document.getElementById('uxCompareClear')?.addEventListener('click', () => { state.basket=[]; saveBasket(); });
    document.getElementById('uxCompareNow')?.addEventListener('click', openBasketComparison);
    renderCompareTray();
  }

  function renderCompareTray(){
    const tray = document.getElementById('uxCompareTray');
    const items = document.getElementById('uxCompareItems');
    const scope = document.getElementById('uxCompareScope');
    const go = document.getElementById('uxCompareNow');
    if(!tray || !items || !scope || !go) return;
    tray.hidden = state.basket.length === 0;
    scope.textContent = state.basket.length ? `${state.basket[0].scope} · ${state.basket.length}/2 selected` : 'Choose two holders from the same scope';
    items.innerHTML = state.basket.map((p,i) => `<button type="button" class="ux3-compare-chip" data-remove-compare="${i}"><span>${esc(p.name)}</span><em>×</em></button>`).join('');
    items.querySelectorAll('[data-remove-compare]').forEach(btn => btn.addEventListener('click', () => { state.basket.splice(Number(btn.dataset.removeCompare),1); saveBasket(); }));
    go.disabled = state.basket.length !== 2;
  }

  function openBasketComparison(){
    if(state.basket.length !== 2) return;
    const [a,b] = state.basket;
    if(a.scope !== b.scope){ toast('Choose two holders from the same scope'); return; }
    closeInspector(); setMode('compare');
    setTimeout(() => {
      const scope = document.getElementById('compareScope'), ae = document.getElementById('compareA'), be = document.getElementById('compareB');
      if(scope && ae && be){
        scope.value = a.scope; scope.dispatchEvent(new Event('change'));
        if([...ae.options].some(o => o.value === a.profile_id)) ae.value = a.profile_id;
        if([...be.options].some(o => o.value === b.profile_id)) be.value = b.profile_id;
        be.dispatchEvent(new Event('change'));
      }
      scrollToPanel('holderComparePanel');
    }, 150);
  }

  function tableScope(tableId){
    return ({foreignTable:'Foreign country',institutionTable:'U.S. sector',extendedTable:'U.S. sector',dealerTable:'Primary dealer',flowMoverTable:null})[tableId] ?? null;
  }

  function inspectFromRow(table, row){
    const id = table.id;
    const first = row.cells?.[0]?.innerText?.trim() || '';
    if(['foreignTable','institutionTable','extendedTable','dealerTable'].includes(id)){
      const profile = holderByName(first, tableScope(id)); if(profile) openInspector('holder',profile); return;
    }
    if(id === 'flowMoverTable'){
      const name = row.cells?.[2]?.innerText?.trim();
      const scope = row.cells?.[0]?.innerText?.trim();
      const profile = holderByName(name, scope); if(profile) openInspector('holder',profile); return;
    }
    if(id === 'securityTable'){
      const security = securityByCusip(first); if(security) openInspector('security',security); return;
    }
    if(id === 'auctionDemandTable' || id === 'auctionTable'){
      const auction = auctionByText(row); if(auction) openInspector('auction',auction);
    }
  }

  function injectPeekButtons(){
    const ids = ['foreignTable','institutionTable','extendedTable','dealerTable','flowMoverTable','securityTable','auctionDemandTable','auctionTable'];
    ids.forEach(id => {
      const table = document.getElementById(id); if(!table) return;
      table.querySelectorAll('tr').forEach(row => {
        if(!row.cells?.length || row.querySelector('.ux3-peek')) return;
        const cell = row.cells[0];
        const btn = document.createElement('button');
        btn.type='button'; btn.className='ux3-peek'; btn.textContent='i'; btn.title='Quick inspect'; btn.setAttribute('aria-label','Quick inspect row');
        btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); inspectFromRow(table,row); });
        cell.appendChild(btn);
      });
    });
  }

  function parseSortValue(text){
    const t = String(text || '').trim().replace(/[,$]/g,'').replace(/\s+/g,' ');
    if(/^[-+]?\d+(\.\d+)?\s*[BTM%]?$/i.test(t)){
      let n = parseFloat(t); const unit = t.match(/[BTM%]$/i)?.[0]?.toUpperCase();
      if(unit === 'T') n *= 1000; if(unit === 'M') n /= 1000; return {type:'number',value:n};
    }
    const d = Date.parse(t); if(!Number.isNaN(d) && /\d{4}/.test(t)) return {type:'number',value:d};
    return {type:'text',value:t.toLowerCase()};
  }

  function makeSortable(){
    document.querySelectorAll('.table-wrap table').forEach(table => {
      if(table.dataset.ux3Sortable) return; table.dataset.ux3Sortable='1';
      table.querySelectorAll('thead th').forEach((th,index) => {
        th.classList.add('ux3-sortable'); th.tabIndex = 0; th.setAttribute('role','button'); th.title = `${th.textContent.trim()} · click to sort`;
        const sort = () => {
          const tbody = table.tBodies?.[0]; if(!tbody) return;
          const asc = th.dataset.sortDir !== 'asc';
          table.querySelectorAll('th').forEach(h => { h.dataset.sortDir=''; h.removeAttribute('aria-sort'); });
          th.dataset.sortDir = asc ? 'asc':'desc'; th.setAttribute('aria-sort',asc?'ascending':'descending');
          const rows = [...tbody.rows];
          rows.sort((a,b) => {
            const av = parseSortValue(a.cells[index]?.innerText), bv = parseSortValue(b.cells[index]?.innerText);
            const cmp = av.type === 'number' && bv.type === 'number' ? av.value - bv.value : String(av.value).localeCompare(String(bv.value));
            return asc ? cmp : -cmp;
          });
          rows.forEach(r => tbody.appendChild(r));
        };
        th.addEventListener('click', sort);
        th.addEventListener('keydown', e => { if(e.key==='Enter' || e.key===' '){ e.preventDefault(); sort(); } });
      });
    });
  }

  function addGlossary(){
    const terms = [
      [/\bSOMA\b/i,'System Open Market Account — securities held by the Federal Reserve Bank of New York for the Federal Reserve.'],
      [/\bTIC\b/i,'Treasury International Capital — monthly U.S. Treasury data on foreign holdings.'],
      [/\bCUSIP\b/i,'Nine-character identifier used for U.S. securities.'],
      [/Bid-to-cover|B\/C/i,'Total competitive bids received divided by the amount accepted at a Treasury auction.'],
      [/Indirect/i,'Auction awards to indirect bidders, including many foreign and domestic institutional investors.'],
      [/Primary Dealer/i,'Trading counterparties of the New York Fed; dealer positions are market-positioning data, not a holder register.'],
      [/QoQ/i,'Quarter over quarter.'],
      [/YoY|1Y/i,'Year over year / one-year change.'],
      [/WoW/i,'Week over week.']
    ];
    document.querySelectorAll('h2, th').forEach(el => {
      if(el.dataset.ux3Glossary) return;
      const text = el.textContent || '';
      const hit = terms.find(([re]) => re.test(text));
      if(hit){ el.dataset.ux3Glossary='1'; el.title = hit[1]; el.classList.add('ux3-glossary'); }
    });
  }

  function syncDeepLink(){
    document.querySelectorAll('.ux-mode-button').forEach(btn => {
      if(btn.dataset.ux3Hash) return; btn.dataset.ux3Hash='1';
      btn.addEventListener('click', () => {
        const params = new URLSearchParams(location.hash.slice(1)); params.set('mode',btn.dataset.mode); params.delete('panel');
        history.replaceState(null,'',`${location.pathname}${location.search}#${params.toString()}`);
      });
    });
  }

  function applyDeepLink(){
    const params = new URLSearchParams(location.hash.slice(1));
    const mode = params.get('mode'), panel = params.get('panel');
    if(mode) document.querySelector(`.ux-mode-button[data-mode="${CSS.escape(mode)}"]`)?.click();
    if(panel) setTimeout(() => scrollToPanel(panel),180);
  }

  function enhancePanelTools(){
    document.querySelectorAll('section.panel').forEach(panel => {
      const tools = panel.querySelector(':scope > .panel-head .ui-panel-tools');
      if(!tools || tools.querySelector('.ux3-link')) return;
      const btn = document.createElement('button'); btn.type='button'; btn.className='ux-panel-tool ux3-link'; btn.textContent='↗'; btn.title='Copy a link to this panel';
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const mode = document.body.dataset.uxMode || 'data';
        const url = `${location.origin}${location.pathname}${location.search}#mode=${encodeURIComponent(mode)}&panel=${encodeURIComponent(panel.id)}`;
        try{ await navigator.clipboard.writeText(url); toast('Panel link copied'); }catch{ location.hash = `mode=${encodeURIComponent(mode)}&panel=${encodeURIComponent(panel.id)}`; }
      });
      tools.insertBefore(btn,tools.firstChild);
    });
  }

  function observe(){
    if(state.observer) return;
    state.observer = new MutationObserver(() => {
      clearTimeout(state._timer);
      state._timer = setTimeout(() => { injectPeekButtons(); makeSortable(); addGlossary(); enhancePanelTools(); syncDeepLink(); },80);
    });
    state.observer.observe(document.body,{childList:true,subtree:true});
  }

  async function loadData(){
    try{
      const r = await fetch(`data/dashboard.json?v=${Date.now()}`); if(!r.ok) return;
      state.data = await r.json(); renderPulse(); injectPeekButtons();
    }catch{}
  }

  function init(){
    buildPulse(); buildInspector(); buildCompareTray();
    injectPeekButtons(); makeSortable(); addGlossary(); enhancePanelTools(); syncDeepLink(); observe(); loadData();
    setTimeout(() => { injectPeekButtons(); makeSortable(); addGlossary(); enhancePanelTools(); renderPulse(); },1200);
    setTimeout(applyDeepLink,500);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
