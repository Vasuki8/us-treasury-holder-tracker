(() => {
  const MODES = [
    { key: 'overview', label: 'Overview', icon: '⌂', hint: 'What matters now' },
    { key: 'explore', label: 'Explore', icon: '◎', hint: 'Holders & securities' },
    { key: 'compare', label: 'Compare', icon: '⇄', hint: 'Relationships & flows' },
    { key: 'monitor', label: 'Monitor', icon: '◉', hint: 'Alerts & releases' },
    { key: 'data', label: 'All Data', icon: '▦', hint: 'Full research library' },
    { key: 'pinned', label: 'Pinned', icon: '★', hint: 'Your workspace' },
  ];

  const DESCRIPTIONS = {
    overview: 'A compact read of current Treasury ownership, market structure, auction demand and freshness.',
    explore: 'Drill into countries, sectors, dealers, SOMA securities, CUSIPs and auction detail.',
    compare: 'Compare holders, study co-movement and inspect cross-holder flow regimes without mixing source cadences.',
    monitor: 'Watch unusual changes, release freshness, source health and the tracker’s accumulated signal history.',
    data: 'Browse every research panel and underlying official-data view in one place.',
    pinned: 'A personal workspace containing only the research panels you have pinned in this browser.',
  };

  function loadPinned() {
    try {
      const value = JSON.parse(localStorage.getItem('treasury-pinned-panels') || '[]');
      return new Set(Array.isArray(value) ? value : []);
    } catch {
      return new Set();
    }
  }

  const state = {
    mode: localStorage.getItem('treasury-ux-mode') || 'overview',
    pinned: loadPinned(),
    observer: null,
    data: null,
  };

  function titleOf(section) {
    return section.querySelector('h2')?.textContent?.trim() || '';
  }

  function slug(text) {
    return String(text || 'panel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'panel';
  }

  function modesFor(section) {
    if (section.id === 'uxOverviewStrip' || section.classList.contains('cards')) return ['overview', 'data'];
    const title = titleOf(section).toLowerCase();
    const group = section.dataset.uiGroup || '';
    const modes = new Set(['data']);

    if (/research brief|market structure map|ownership share snapshot|largest holder changes|auction demand monitor|release calendar/.test(title)) modes.add('overview');
    if (['holders', 'securities', 'auctions'].includes(group)) modes.add('explore');
    if (/holder profile|holder comparison|saved research|co-movement|cross-holder flow|flow intelligence|flow regime|foreign holder 13-month trend|ownership share/.test(title)) modes.add('compare');
    if (['alerts', 'sources', 'history'].includes(group) || /alert|release|freshness|source health|provenance|tracker history|signal history|unusual|research brief|market structure/.test(title)) modes.add('monitor');

    if (/foreign treasury holders|government.*trust-fund|banks|broker-dealer|insurance|pensions|etfs|hedge funds|primary dealer|money-market|domestic.*sector|soma|cusip|auction/.test(title)) modes.add('explore');

    return [...modes];
  }

  function ensurePanelId(section) {
    if (!section.id) section.id = `ux-${slug(titleOf(section))}`;
    return section.id;
  }

  function savePinned() {
    localStorage.setItem('treasury-pinned-panels', JSON.stringify([...state.pinned]));
    updatePinnedCount();
  }

  function panelTools(section) {
    if (!section.classList.contains('panel')) return;
    const id = ensurePanelId(section);
    const head = section.querySelector(':scope > .panel-head');
    if (!head || head.querySelector('.ux-pin')) return;

    let tools = head.querySelector('.ui-panel-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.className = 'ui-panel-tools';
      head.appendChild(tools);
    }

    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'ux-panel-tool ux-pin';
    pin.title = 'Pin this panel to your workspace';
    pin.setAttribute('aria-label', `Pin ${titleOf(section) || 'panel'}`);

    const focus = document.createElement('button');
    focus.type = 'button';
    focus.className = 'ux-panel-tool ux-focus';
    focus.title = 'Open this panel in focus view';
    focus.setAttribute('aria-label', `Focus ${titleOf(section) || 'panel'}`);
    focus.textContent = '⤢';

    const syncPin = () => {
      const active = state.pinned.has(id);
      pin.textContent = active ? '★' : '☆';
      pin.classList.toggle('active', active);
      pin.setAttribute('aria-pressed', String(active));
    };
    syncPin();

    pin.addEventListener('click', (event) => {
      event.stopPropagation();
      if (state.pinned.has(id)) state.pinned.delete(id); else state.pinned.add(id);
      syncPin();
      savePinned();
      if (state.mode === 'pinned') applyMode();
    });

    focus.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFocus(section);
    });

    tools.insertBefore(focus, tools.firstChild);
    tools.insertBefore(pin, tools.firstChild);
  }

  function toggleFocus(section) {
    const current = document.querySelector('.panel.ux-focused');
    if (current && current !== section) current.classList.remove('ux-focused');
    const willOpen = !section.classList.contains('ux-focused');
    if (willOpen && section.classList.contains('ui-collapsed')) section.querySelector('.ui-collapse')?.click();
    const active = section.classList.toggle('ux-focused');
    document.body.classList.toggle('ux-panel-focus', active);
    section.querySelector('.ux-focus').textContent = active ? '×' : '⤢';
    setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
  }

  function closeFocus() {
    const current = document.querySelector('.panel.ux-focused');
    if (!current) return false;
    current.classList.remove('ux-focused');
    current.querySelector('.ux-focus').textContent = '⤢';
    document.body.classList.remove('ux-panel-focus');
    setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
    return true;
  }

  function refreshSections() {
    document.querySelectorAll('main.shell > section').forEach((section) => {
      if (section.id === 'uiFocusBanner') return;
      ensurePanelId(section);
      section.dataset.uxModes = modesFor(section).join(' ');
      panelTools(section);
    });
    applyMode(false);
  }

  function visibleForMode(section, mode) {
    if (section.id === 'uiFocusBanner') return false;
    if (mode === 'pinned') return state.pinned.has(section.id);
    return (section.dataset.uxModes || '').split(' ').includes(mode);
  }

  function applyMode(scroll = true) {
    if (!MODES.some((m) => m.key === state.mode)) state.mode = 'overview';
    document.body.dataset.uxMode = state.mode;
    document.querySelectorAll('.ux-mode-button').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.mode));

    let visible = 0;
    document.querySelectorAll('main.shell > section').forEach((section) => {
      if (section.id === 'uiFocusBanner') {
        section.hidden = true;
        return;
      }
      const show = visibleForMode(section, state.mode);
      section.classList.toggle('ux-mode-hidden', !show);
      if (show) visible += 1;
    });

    const mode = MODES.find((m) => m.key === state.mode);
    const title = document.getElementById('uxModeTitle');
    const copy = document.getElementById('uxModeDescription');
    const count = document.getElementById('uxVisibleCount');
    if (title) title.textContent = mode?.label || 'Workspace';
    if (copy) copy.textContent = DESCRIPTIONS[state.mode] || '';
    if (count) count.textContent = `${visible} ${visible === 1 ? 'panel' : 'panels'}`;

    localStorage.setItem('treasury-ux-mode', state.mode);
    if (scroll) window.scrollTo({ top: document.getElementById('uxWorkspaceTop')?.offsetTop || 0, behavior: 'smooth' });
    updatePinnedEmpty();
  }

  function setMode(mode) {
    if (!MODES.some((m) => m.key === mode)) return;
    closeFocus();
    state.mode = mode;
    applyMode();
  }

  function updatePinnedCount() {
    const count = document.getElementById('uxPinnedCount');
    if (count) count.textContent = state.pinned.size ? String(state.pinned.size) : '';
  }

  function updatePinnedEmpty() {
    let empty = document.getElementById('uxPinnedEmpty');
    const main = document.querySelector('main.shell');
    if (!main) return;
    if (!empty) {
      empty = document.createElement('div');
      empty.id = 'uxPinnedEmpty';
      empty.className = 'ux-pinned-empty';
      empty.innerHTML = '<strong>Your pinned workspace is empty.</strong><span>Open All Data or another workspace and click ☆ on any panel you want to keep here.</span><button type="button">Browse all data</button>';
      empty.querySelector('button').addEventListener('click', () => setMode('data'));
      main.insertBefore(empty, main.querySelector('section'));
    }
    empty.hidden = !(state.mode === 'pinned' && state.pinned.size === 0);
  }

  function buildRail() {
    const main = document.querySelector('main.shell');
    if (!main || document.getElementById('uxRail')) return;

    document.querySelector('.toolbar-chip[data-group="all"]')?.click();
    document.body.classList.remove('ui-focus-mode');

    const layout = document.createElement('div');
    layout.className = 'ux-layout';
    main.parentNode.insertBefore(layout, main);

    const rail = document.createElement('aside');
    rail.id = 'uxRail';
    rail.className = 'ux-rail';
    rail.innerHTML = `
      <div class="ux-rail-head"><span class="ux-rail-logo">T</span><div><strong>Research Terminal</strong><small>Task-based workspace</small></div></div>
      <nav class="ux-mode-nav" aria-label="Research modes"></nav>
      <div class="ux-rail-foot"><span>Tip</span><p>Pin useful panels with ☆ and reopen them from Pinned.</p></div>`;

    const nav = rail.querySelector('.ux-mode-nav');
    MODES.forEach((mode, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ux-mode-button';
      button.dataset.mode = mode.key;
      button.innerHTML = `<span class="ux-mode-icon">${mode.icon}</span><span class="ux-mode-copy"><strong>${mode.label}</strong><small>${mode.hint}</small></span>${mode.key === 'pinned' ? '<em id="uxPinnedCount"></em>' : ''}`;
      button.title = `${mode.label} · Alt+${index + 1}`;
      button.addEventListener('click', () => setMode(mode.key));
      nav.appendChild(button);
    });

    layout.appendChild(rail);
    layout.appendChild(main);
    main.classList.add('ux-main');
    updatePinnedCount();
  }

  function buildContextBar() {
    const main = document.querySelector('main.shell');
    if (!main || document.getElementById('uxWorkspaceTop')) return;
    const bar = document.createElement('div');
    bar.id = 'uxWorkspaceTop';
    bar.className = 'ux-context-bar';
    bar.innerHTML = `
      <div class="ux-context-copy"><span class="ux-context-kicker">Workspace</span><strong id="uxModeTitle">Overview</strong><p id="uxModeDescription"></p></div>
      <div class="ux-context-actions">
        <span id="uxVisibleCount" class="ux-visible-count"></span>
        <button type="button" id="uxCollapseAll" title="Collapse visible panels">Collapse all</button>
        <button type="button" id="uxExpandAll" title="Expand visible panels">Expand all</button>
        <button type="button" id="uxQuickSearch" class="ux-primary-action"><span>⌕</span> Search <kbd>Ctrl K</kbd></button>
      </div>`;
    main.insertBefore(bar, main.firstChild);

    bar.querySelector('#uxQuickSearch').addEventListener('click', () => document.getElementById('openCommandPalette')?.click());
    bar.querySelector('#uxCollapseAll').addEventListener('click', () => setCollapsed(true));
    bar.querySelector('#uxExpandAll').addEventListener('click', () => setCollapsed(false));
  }

  function setCollapsed(collapse) {
    document.querySelectorAll('main.shell > section.panel:not(.ux-mode-hidden)').forEach((section) => {
      const isCollapsed = section.classList.contains('ui-collapsed');
      const button = section.querySelector('.ui-collapse');
      if (button && isCollapsed !== collapse) button.click();
    });
  }

  function targetPanelId(kind) {
    const map = {
      holders: 'holderProfilePanel',
      securities: 'securityTable',
      alerts: 'releaseIntelligencePanel',
      auction: 'auctionDemandPanel',
      sources: 'sourceHealth',
    };
    const raw = document.getElementById(map[kind]);
    return raw?.closest?.('.panel')?.id || raw?.id || null;
  }

  function buildOverviewStrip(data) {
    const main = document.querySelector('main.shell');
    if (!main || document.getElementById('uxOverviewStrip')) return;
    const profiles = data?.holder_profiles?.profile_count ?? data?.holder_profiles?.profiles?.length ?? 0;
    const securities = data?.security_intelligence?.rows?.length ?? data?.soma?.top_holdings?.length ?? 0;
    const sources = data?.provenance?.sources || [];
    const healthy = sources.filter((s) => s.status === 'ok').length;
    const high = data?.alert_intelligence?.high_count ?? 0;
    const latestAuction = data?.auction_demand_monitor?.recent?.[0];
    const auctionDisplay = latestAuction?.demand_label ? `${String(latestAuction.demand_label).replaceAll('_', ' ')}` : '—';

    const strip = document.createElement('section');
    strip.id = 'uxOverviewStrip';
    strip.className = 'ux-overview-strip';
    strip.dataset.uxModes = 'overview data';
    const cards = [
      ['holders', 'Holder profiles', profiles, 'Explore ownership'],
      ['securities', 'CUSIPs tracked', securities, 'Open security research'],
      ['alerts', 'High alerts', high, high ? 'Review active signals' : 'No high alerts'],
      ['auction', 'Latest auction', auctionDisplay, latestAuction?.auction_date || 'Demand monitor'],
      ['sources', 'Healthy sources', sources.length ? `${healthy}/${sources.length}` : '—', 'Open source health'],
    ];
    strip.innerHTML = cards.map(([kind, label, value, hint]) => `<button type="button" class="ux-overview-card" data-ux-kind="${kind}"><span>${label}</span><strong>${value}</strong><small>${hint}</small><em>→</em></button>`).join('');
    const firstSection = [...main.children].find((el) => el.tagName === 'SECTION');
    main.insertBefore(strip, firstSection || null);

    strip.querySelectorAll('.ux-overview-card').forEach((button) => button.addEventListener('click', () => {
      const kind = button.dataset.uxKind;
      if (kind === 'holders' || kind === 'securities' || kind === 'auction') setMode('explore');
      else setMode('monitor');
      setTimeout(() => {
        const id = targetPanelId(kind);
        if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    }));
  }

  async function loadData() {
    try {
      const response = await fetch(`data/dashboard.json?v=${Date.now()}`);
      if (!response.ok) return;
      state.data = await response.json();
      buildOverviewStrip(state.data);
      refreshSections();
    } catch (_) {
      // Core dashboard owns error reporting; navigation remains usable without this summary strip.
    }
  }

  function observe() {
    const main = document.querySelector('main.shell');
    if (!main || state.observer) return;
    let queued = false;
    state.observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        refreshSections();
      });
    });
    state.observer.observe(main, { childList: true, subtree: true });
  }

  function keyboard(event) {
    if (/input|textarea|select/i.test(document.activeElement?.tagName || '')) return;
    if (event.key === 'Escape' && closeFocus()) return;
    if (event.altKey && /^[1-6]$/.test(event.key)) {
      event.preventDefault();
      setMode(MODES[Number(event.key) - 1].key);
    }
  }

  function polishHero() {
    const eyebrow = document.querySelector('.eyebrow');
    if (eyebrow) eyebrow.textContent = 'INTERACTIVE OFFICIAL-DATA RESEARCH TERMINAL';
    const lede = document.querySelector('.lede');
    if (lede) lede.textContent = 'Explore who owns Treasuries, compare holder behavior, monitor releases and alerts, and drill into auctions and CUSIPs — without mixing incompatible reporting cadences.';
  }

  function init() {
    polishHero();
    buildRail();
    buildContextBar();
    refreshSections();
    observe();
    loadData();
    document.addEventListener('keydown', keyboard);
    setTimeout(refreshSections, 800);
    setTimeout(refreshSections, 1900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
