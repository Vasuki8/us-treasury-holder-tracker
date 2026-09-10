(() => {
  const GROUPS = [
    { key: 'all', label: 'All' },
    { key: 'market', label: 'Market Structure' },
    { key: 'holders', label: 'Holders' },
    { key: 'securities', label: 'Securities' },
    { key: 'auctions', label: 'Auctions' },
    { key: 'alerts', label: 'Alerts & Releases' },
    { key: 'sources', label: 'Sources' },
    { key: 'history', label: 'History' },
  ];

  const state = {
    activeGroup: 'all',
    dense: localStorage.getItem('treasury-ui-density') === 'dense',
    observer: null,
  };

  function panelTitle(section) {
    return section.querySelector('h2')?.textContent?.trim() || '';
  }

  function classify(title, section) {
    const t = title.toLowerCase();
    if (section.classList.contains('cards')) return 'market';
    if (/source health|source provenance|provenance|audit trail/.test(t)) return 'sources';
    if (/tracker history|history timeline/.test(t)) return 'history';
    if (/release|freshness|alert|unusual|signal history/.test(t)) return 'alerts';
    if (/auction/.test(t)) return 'auctions';
    if (/cusip|security intelligence|soma concentration|security drill|treasury portfolio/.test(t)) return 'securities';
    if (/market structure|research brief|ownership share|flow regime|breadth|co-movement/.test(t)) return 'market';
    if (/holder|foreign|government|trust-fund|bank|broker|insurance|pension|hedge|etf|primary dealer|money-market|domestic|sector/.test(t)) return 'holders';
    return 'market';
  }

  function slugify(text) {
    return String(text || 'panel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'panel';
  }

  function ensurePanelTools(section) {
    if (!section.classList.contains('panel')) return;
    const head = section.querySelector(':scope > .panel-head');
    if (!head || head.querySelector('.ui-collapse')) return;

    if (!section.id) section.id = `ui-${slugify(panelTitle(section))}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-collapse';
    button.setAttribute('aria-label', `Collapse ${panelTitle(section) || 'section'}`);
    button.setAttribute('title', 'Collapse / expand section');
    button.textContent = '⌄';

    const existingActions = head.querySelector('.panel-actions');
    if (existingActions) {
      existingActions.appendChild(button);
    } else {
      const tools = document.createElement('div');
      tools.className = 'ui-panel-tools';
      tools.appendChild(button);
      head.appendChild(tools);
    }

    const storageKey = `treasury-collapse:${section.id}`;
    if (localStorage.getItem(storageKey) === '1') {
      section.classList.add('ui-collapsed');
      button.setAttribute('aria-expanded', 'false');
    } else {
      button.setAttribute('aria-expanded', 'true');
    }

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const collapsed = section.classList.toggle('ui-collapsed');
      button.setAttribute('aria-expanded', String(!collapsed));
      localStorage.setItem(storageKey, collapsed ? '1' : '0');
    });
  }

  function classifySections() {
    const sections = document.querySelectorAll('main.shell > section');
    sections.forEach((section) => {
      const title = panelTitle(section);
      const group = classify(title, section);
      section.dataset.uiGroup = group;
      ensurePanelTools(section);
      section.classList.toggle('ui-selected-group', state.activeGroup === 'all' || state.activeGroup === group);
    });
  }

  function buildToolbar() {
    if (document.getElementById('researchToolbar')) return;
    const hero = document.querySelector('header.hero');
    if (!hero) return;

    const toolbar = document.createElement('nav');
    toolbar.id = 'researchToolbar';
    toolbar.className = 'research-toolbar';
    toolbar.setAttribute('aria-label', 'Treasury research workspace navigation');
    toolbar.innerHTML = `
      <div class="toolbar-brand">
        <span class="toolbar-mark">T</span>
        <div><strong>Research Workspace</strong><small id="uiDatasetCount">Live official-data views</small></div>
      </div>
      <div class="toolbar-nav" id="uiGroupNav"></div>
      <div class="toolbar-actions">
        <span class="toolbar-count" id="uiCounts"></span>
        <button class="toolbar-action" id="uiSearch" type="button" title="Search dashboard"><span>⌕</span><span class="ui-action-label">Search</span><kbd>Ctrl K</kbd></button>
        <button class="toolbar-action" id="uiDensity" type="button" title="Toggle compact layout"><span>≡</span><span class="ui-action-label">Density</span></button>
      </div>`;

    hero.insertAdjacentElement('afterend', toolbar);

    const nav = toolbar.querySelector('#uiGroupNav');
    GROUPS.forEach((group) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `toolbar-chip${group.key === 'all' ? ' active' : ''}`;
      button.dataset.group = group.key;
      button.textContent = group.label;
      button.addEventListener('click', () => setGroup(group.key));
      nav.appendChild(button);
    });

    toolbar.querySelector('#uiSearch').addEventListener('click', () => {
      const paletteTrigger = document.getElementById('openCommandPalette');
      if (paletteTrigger) paletteTrigger.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    });

    toolbar.querySelector('#uiDensity').addEventListener('click', toggleDensity);
    applyDensity();
  }

  function ensureFocusBanner() {
    const main = document.querySelector('main.shell');
    if (!main || document.getElementById('uiFocusBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'uiFocusBanner';
    banner.className = 'ui-focus-banner';
    banner.innerHTML = '<span id="uiFocusCopy"></span><button type="button" id="uiShowAll">Show all sections</button>';
    main.insertBefore(banner, main.firstChild);
    banner.querySelector('#uiShowAll').addEventListener('click', () => setGroup('all'));
  }

  function setGroup(group) {
    state.activeGroup = group;
    document.body.classList.toggle('ui-focus-mode', group !== 'all');
    document.querySelectorAll('.toolbar-chip').forEach((button) => button.classList.toggle('active', button.dataset.group === group));
    classifySections();

    const label = GROUPS.find((g) => g.key === group)?.label || group;
    const copy = document.getElementById('uiFocusCopy');
    if (copy) copy.textContent = group === 'all' ? '' : `Focused view: ${label}. Other research sections are temporarily hidden.`;

    if (group !== 'all') {
      const first = document.querySelector(`main.shell > section[data-ui-group="${group}"]`);
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    sessionStorage.setItem('treasury-ui-group', group);
  }

  function toggleDensity() {
    state.dense = !state.dense;
    localStorage.setItem('treasury-ui-density', state.dense ? 'dense' : 'comfortable');
    applyDensity();
  }

  function applyDensity() {
    document.body.classList.toggle('ui-dense', state.dense);
    const button = document.getElementById('uiDensity');
    if (button) {
      button.classList.toggle('active', state.dense);
      button.setAttribute('aria-pressed', String(state.dense));
      button.setAttribute('title', state.dense ? 'Use comfortable layout' : 'Use compact layout');
    }
  }

  function ensureBackTop() {
    if (document.getElementById('uiBackTop')) return;
    const button = document.createElement('button');
    button.id = 'uiBackTop';
    button.className = 'ui-backtop';
    button.type = 'button';
    button.setAttribute('aria-label', 'Back to top');
    button.textContent = '↑';
    button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    document.body.appendChild(button);
    const onScroll = () => button.classList.toggle('visible', window.scrollY > 700);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  async function updateCounts() {
    try {
      const response = await fetch(`data/dashboard.json?v=${Date.now()}`);
      if (!response.ok) return;
      const data = await response.json();
      const holders = data.holder_profiles?.profiles?.length ?? 0;
      const cusips = data.security_intelligence?.rows?.length ?? data.soma?.top_holdings?.length ?? 0;
      const sources = data.provenance?.sources?.length ?? Object.keys(data.sources || {}).length;
      const count = document.getElementById('uiCounts');
      const subtitle = document.getElementById('uiDatasetCount');
      if (count) count.textContent = `${holders} holders · ${cusips} CUSIPs`;
      if (subtitle) subtitle.textContent = `${sources} source groups · live official-data views`;
    } catch (_) {
      // The core dashboard handles data-load errors; the UI layer stays non-blocking.
    }
  }

  function keyboardShortcuts(event) {
    if (event.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
      event.preventDefault();
      document.getElementById('uiSearch')?.click();
    }
    if (event.key === 'Escape' && state.activeGroup !== 'all' && !document.body.classList.contains('command-open')) {
      setGroup('all');
    }
  }

  function observeDynamicPanels() {
    const main = document.querySelector('main.shell');
    if (!main || state.observer) return;
    let queued = false;
    state.observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        classifySections();
      });
    });
    state.observer.observe(main, { childList: true, subtree: true });
  }

  function init() {
    buildToolbar();
    ensureFocusBanner();
    ensureBackTop();
    classifySections();
    observeDynamicPanels();
    updateCounts();
    document.addEventListener('keydown', keyboardShortcuts);

    const remembered = sessionStorage.getItem('treasury-ui-group');
    if (remembered && GROUPS.some((g) => g.key === remembered)) setGroup(remembered);

    // Phase scripts inject several panels asynchronously after their data fetches.
    setTimeout(classifySections, 700);
    setTimeout(classifySections, 1800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
