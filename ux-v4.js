(() => {
  const VIEW_KEY = 'treasury-ux-v5-view';
  const CORE_TITLES = [
    /research brief/i,
    /market structure map/i,
    /foreign treasury holders/i,
    /ownership share snapshot/i,
    /auction demand monitor/i,
    /largest holder changes/i,
  ];

  function titleOf(section) {
    return section?.querySelector?.('h2')?.textContent?.trim() || '';
  }

  function currentView() {
    return localStorage.getItem(VIEW_KEY) === 'full' ? 'full' : 'core';
  }

  function setView(view) {
    const full = view === 'full';
    document.body.classList.toggle('ux4-full', full);
    document.body.classList.toggle('ux4-essential', !full);
    document.body.classList.toggle('ux5-core', !full);
    localStorage.setItem(VIEW_KEY, full ? 'full' : 'core');

    document.querySelectorAll('[data-ux4-view]').forEach(btn => {
      const active = btn.dataset.ux4View === (full ? 'full' : 'core');
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    const trigger = document.getElementById('ux4DataMenuButton');
    if (trigger) trigger.textContent = full ? 'More ···' : 'More';
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
      const core = CORE_TITLES.some(rx => rx.test(title));
      section.classList.toggle('ux4-secondary', !core);
      section.classList.toggle('ux4-essential-panel', core);
    });
  }

  function trimOverviewCards() {
    const host = document.getElementById('overviewCards');
    if (!host) return;
    const keep = /^(total public debt|debt held by public|federal reserve|foreign holders)$/i;
    host.querySelectorAll(':scope > .card').forEach(card => {
      const label = card.querySelector('.kicker')?.textContent?.trim() || '';
      card.classList.toggle('ux5-overview-extra', !keep.test(label));
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
      button.title = 'Show explanation';
      button.setAttribute('aria-label', `Show explanation for ${titleOf(section) || 'this panel'}`);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', event => {
        event.stopPropagation();
        const open = section.classList.toggle('ux4-show-notes');
        button.classList.toggle('active', open);
        button.setAttribute('aria-pressed', String(open));
        button.title = open ? 'Hide explanation' : 'Show explanation';
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
    toggle.innerHTML = '<button type="button" data-ux4-view="core">Core</button><button type="button" data-ux4-view="full">Research</button>';
    toggle.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.ux4View)));
    actions.insertBefore(toggle, actions.firstChild);
  }

  function buildDataMenu() {
    const side = document.querySelector('.hero-side');
    if (!side || document.getElementById('ux4DataMenu')) return;
    const menu = document.createElement('div');
    menu.id = 'ux4DataMenu';
    menu.className = 'ux4-data-menu';
    menu.innerHTML = '<button type="button" id="ux4DataMenuButton" aria-expanded="false">More</button><div class="ux4-data-popover" id="ux4DataPopover" hidden><button type="button" data-action="full">Open full research view</button><button type="button" data-export="json">Download JSON</button><button type="button" data-export="csv">Download snapshot CSV</button></div>';
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
    const heading = document.querySelector('.hero h1');
    const lede = document.querySelector('.hero .lede');
    if (eyebrow) eyebrow.textContent = 'U.S. TREASURY OWNERSHIP';
    if (heading) heading.textContent = 'Who Owns U.S. Treasuries?';
    if (lede) lede.textContent = 'Track the largest holders, country flows and auction demand — with official data and country history back to 2011.';
  }

  function simplifyAdvancedNavigation() {
    document.querySelectorAll('.ux-mode-button[data-mode="compare"], .ux-mode-button[data-mode="data"], .ux-mode-button[data-mode="pinned"]').forEach(button => {
      button.dataset.ux4AdvancedNav = 'true';
    });
  }

  function refreshVisibleCount() {
    const count = document.getElementById('uxVisibleCount');
    if (!count) return;
    const visible = [...document.querySelectorAll('main.shell > section')].filter(section => {
      const style = getComputedStyle(section);
      return !section.hidden && style.display !== 'none';
    }).length;
    count.textContent = `${visible} sections`;
  }

  function polish() {
    classifyPanels();
    trimOverviewCards();
    markUnavailablePanels();
    addInfoToggles();
    simplifyAdvancedNavigation();
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
        timer = setTimeout(() => { polish(); setView(currentView()); }, 80);
      }).observe(main, {childList:true, subtree:true});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
