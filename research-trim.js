(() => {
  const removedPanelIds = new Set([
    'holderProfilePanel',
    'holderComparePanel',
    'comovementPanel',
    'savedViewsPanel',
    'flowIntelligencePanel',
    'securityDrillPanel',
    'concentrationPanel',
    'auctionDemandPanel'
  ]);

  const removedTitlePatterns = [
    /federal government\s*&\s*trust-fund treasury holders/i,
    /holder profile explorer/i,
    /holder comparison workspace/i,
    /federal reserve soma treasury portfolio/i,
    /soma concentration\s*&\s*maturity view/i,
    /banks\s*&\s*broker-dealer treasury holdings/i,
    /insurance, pensions, etfs\s*&\s*hedge funds/i,
    /primary dealer treasury market positioning/i,
    /largest holder changes/i,
    /cross-holder flow intelligence/i,
    /cusip security intelligence/i,
    /treasury security drill-down/i,
    /soma cusip concentration monitor/i,
    /money-market funds holding treasuries/i,
    /treasury auction takedown/i,
    /auction demand monitor/i,
    /domestic\s*&\s*sector holders/i
  ];

  const titleRemoved = value => removedTitlePatterns.some(rx => rx.test(String(value || '')));

  function trimNavigationData(){
    try {
      if (typeof p11data === 'undefined' || !p11data?.navigation_index?.entries) return;
      p11data.navigation_index.entries = p11data.navigation_index.entries.filter(entry => {
        if (entry.type === 'holder' || entry.type === 'security') return false;
        if (removedPanelIds.has(entry.target_panel)) return false;
        return !titleRemoved(entry.title) && !titleRemoved(entry.subtitle);
      });
      p11data.navigation_index.entry_count = p11data.navigation_index.entries.length;
      if (typeof renderCommandResults === 'function' && document.getElementById('commandPalette')?.hidden === false) {
        renderCommandResults();
      }
    } catch (err) {
      console.warn('Research trim navigation update skipped', err);
    }
  }

  function trimUi(){
    document.querySelectorAll('main.shell > section.panel').forEach(section => {
      const title = section.querySelector('h2')?.textContent?.trim() || '';
      if (titleRemoved(title)) section.classList.add('research-removed');
    });

    removedPanelIds.forEach(id => document.getElementById(id)?.classList.add('research-removed'));

    document.querySelectorAll('.ux-mode-button[data-mode="compare"], #uxCompareTray').forEach(el => {
      el.classList.add('research-removed');
    });

    document.querySelectorAll('#uxPulse [data-pulse-target], .structure-card[data-structure-target]').forEach(el => {
      if (removedPanelIds.has(el.dataset.pulseTarget) || removedPanelIds.has(el.dataset.structureTarget) || el.dataset.structureTarget === 'dealerTable') {
        el.classList.add('research-removed');
      }
    });

    const lede = document.querySelector('.hero .lede');
    if (lede) lede.textContent = 'Track major foreign Treasury holders, long-run country trends, ownership shares, source freshness and official-data research signals — while preserving each source\'s real reporting date and cadence.';

    trimNavigationData();
  }

  function init(){
    trimUi();
    let timer;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(trimUi, 60);
    }).observe(document.body, {childList:true, subtree:true});
    setTimeout(trimUi, 500);
    setTimeout(trimUi, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
