(() => {
  const VIEW_KEY = 'treasury-ux-v4-view';
  const ESSENTIAL_TITLES = [
    /research brief/i,
    /market structure map/i,
    /foreign treasury holders/i,
    /ownership share snapshot/i,
    /auction demand monitor/i,
    /holder profile/i,
    /holder comparison/i,
    /cusip security intelligence/i,
    /security drill/i,
    /largest holder changes/i,
    /release intelligence/i,
    /release calendar/i,
    /alert intelligence/i,
    /source health/i,
  ];
  const ALWAYS_SECONDARY = [
    /13-month trend/i,
    /government.*trust-fund/i,
    /soma concentration/i,
    /banks.*broker-dealer/i,
    /insurance.*pensions/i,
    /primary dealer treasury market positioning/i,
    /money-market funds/i,
    /treasury auction takedown/i,
    /domestic.*sector holders/i,
    /tracker history/i,
    /provenance/i,
    /saved research views/i,
    /co-movement/i,
    /cross-holder/i,
    /signal history/i,
    /lifecycle/i,
  ];

  function titleOf(section) {
    return section?.querySelector?.('h2')?.textContent?.trim() || '';
  }

  function currentView() {
    return localStorage.getItem(VIEW_KEY) === 'full' ? 'full' : 'essential';
  }

  function setView(view) {
    const full = view === 'full';
    document.body.classList.toggle('ux4-full', full);
    document.body.classList.toggle('ux4-essential', !full);
    localStorage.setItem(VIEW_KEY, full ? 'full' : 'essential');
    document.querySelectorAll('[data-ux4-view]').forEach(btn => {
      const active = btn.dataset.ux4View === (full ? 'full' : 'essential');
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    const chip = document.getElementById('ux4CleanChip');
    if (chip) chip.textContent = full ? 'Full research view' : 'Essential view';
    refreshVisibleCount();
    window.dispatchEvent(new Event('resize'));
  }

  function classifyPanels() {
    document.querySelectorAll('main.shell > section').forEach(section => {
      const title = titleOf(section);
      if (section.id === 'overviewCards') return;
      if (section.id === 'uxOverviewStrip') {
        section.classList.add('ux4-secondary');
        return;
      }
      if (!title) return;
      const essential = ESSENTIAL_TITLES.some(rx => rx.test(title));
      const forcedSecondary = ALWAYS_SECONDARY.some(rx => rx.test(title));
      section.classList.toggle('ux4-secondary', forcedSecondary || !essential);
      if (essential && !forcedSecondary) section.classList.add('ux4-essential-panel');
    });
  }

  function markUnavailablePanels() {
    document.querySelectorAll('main.shell > section.panel').forEach(section => {
      const title = titleOf(section);
      if (!/money-market funds|n-port|form n-port/i.test(title)) return;
      const rows = [...section.querySelectorAll('tbody tr')];
      const usefulRows = rows.filter(row => !row.querySelector('.empty-cell') && !/no data|unavailable|pending|not ingested/i.test(row.textContent || ''));
      const text = section.textContent || '';
      const unavailable = usefulRows.length === 0 && /403|pending|unavailable|not ingested|no data/i.test(text);
      section.classList.toggle('ux4-empty-panel', unavailable);
    });
  }

  function addInfoToggles() {
    document.querySelectorAll('main.shell > section.panel').forEach(section => {
      if (!section.querySelector('.inline-note')) return;
      const tools = section.querySelector(':scope > .panel-head .ui-panel-tools') || section.querySelector(':scope > .panel-head');
      if (!tools || tools.querySelector('.ux4-info')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ux4-info';
      button.textContent = 'i';
      button.title = 'Show methodology and notes';
      button.setAttribute('aria-label', `Show notes for ${titleOf(section) || 'this panel'}`);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', event => {
        event.stopPropagation();
        const open = section.classList.toggle('ux4-show-notes');
        button.classList.toggle('active', open);
        button.setAttribute('aria-pressed', String(open));
        button.title = open ? 'Hide methodology and notes' : 'Show methodology and notes';
      });
      tools.prepend(button);
    });
  }

  function buildViewToggle() {
    const actions = document.querySelector('#uxWorkspaceTop .ux-context-actions');
    if (!actions || document.getElementById('ux4ViewToggle')) return;
    const toggle = document.createElement('div');
    toggle.id = 'ux4ViewToggle';
    toggle.className = 'ux4-view-toggle';
    toggle.setAttribute('aria-label', 'Dashboard detail level');
    toggle.innerHTML = '<button type="button" data-ux4-view="essential">Essential</button><button type="button" data-ux4-view="full">Full</button>';
    toggle.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.ux4View)));
    actions.insertBefore(toggle, actions.firstChild);
  }

  function buildDataMenu() {
    const side = document.querySelector('.hero-side');
    if (!side || document.getElementById('ux4DataMenu')) return;
    const menu = document.createElement('div');
    menu.id = 'ux4DataMenu';
    menu.className = 'ux4-data-menu';
    menu.innerHTML = '<button type="button" id="ux4DataMenuButton" aria-expanded="false">Data & exports ···</button><div class="ux4-data-popover" id="ux4DataPopover" hidden><button type="button" data-export="json">Download JSON</button><button type="button" data-export="csv">Download snapshot CSV</button><button type="button" data-action="full">Open full research view</button></div>';
    side.appendChild(menu);
    const trigger = menu.querySelector('#ux4DataMenuButton');
    const popover = menu.querySelector('#ux4DataPopover');
    const close = () => { popover.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      popover.hidden = !popover.hidden;
      trigger.setAttribute('aria-expanded', String(!popover.hidden));
    });
    menu.querySelector('[data-export="json"]')?.addEventListener('click', () => { document.getElementById('downloadJson')?.click(); close(); });
    menu.querySelector('[data-export="csv"]')?.addEventListener('click', () => { document.getElementById('downloadCsv')?.click(); close(); });
    menu.querySelector('[data-action="full"]')?.addEventListener('click', () => { setView('full'); close(); document.getElementById('uxWorkspaceTop')?.scrollIntoView({behavior:'smooth'}); });
    document.addEventListener('click', event => { if (!menu.contains(event.target)) close(); });
  }

  function simplifyHero() {
    const eyebrow = document.querySelector('.hero .eyebrow');
    const lede = document.querySelector('.hero .lede');
    if (eyebrow) eyebrow.textContent = 'TREASURY INTELLIGENCE';
    if (lede) lede.textContent = 'See who holds U.S. Treasuries, what is changing, and where market structure is moving — using official data with each source kept on its real reporting date.';
    const side = document.querySelector('.hero-side');
    if (side && !document.getElementById('ux4CleanChip')) {
      const chip = document.createElement('span');
      chip.id = 'ux4CleanChip';
      chip.className = 'ux4-clean-chip';
      side.prepend(chip);
    }
  }

  function simplifyRail() {
    document.querySelectorAll('.ux-mode-button[data-mode="data"], .ux-mode-button[data-mode="pinned"]').forEach(button => {
      button.dataset.ux4AdvancedNav = 'true';
    });
  }

  function refreshVisibleCount() {
    const count = document.getElementById('uxVisibleCount');
    if (!count) return;
    const visible = [...document.querySelectorAll('main.shell > section')].filter(section => {
      const style = getComputedStyle(section);
      return !section.hidden && style.display !== 'none' && !section.classList.contains('ux-mode-hidden');
    }).length;
    count.textContent = `${visible} ${visible === 1 ? 'view' : 'views'}`;
  }

  function polish() {
    classifyPanels();
    markUnavailablePanels();
    addInfoToggles();
    simplifyRail();
    refreshVisibleCount();
  }

  function init() {
    document.body.classList.add('ux4-clean');
    simplifyHero();
    buildDataMenu();
    buildViewToggle();
    polish();
    setView(currentView());

    const main = document.querySelector('main.shell');
    if (main) {
      let timer;
      new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(polish, 80);
      }).observe(main, {childList:true, subtree:true});
    }

    document.addEventListener('click', event => {
      if (event.target.closest('.ux-mode-button')) setTimeout(() => { polish(); setView(currentView()); }, 80);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
