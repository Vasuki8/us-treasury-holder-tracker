(() => {
  function normalizePeekButtons(){
    document.querySelectorAll('.ux3-peek').forEach((button) => {
      if(button.dataset.ux3IconReady) return;
      button.dataset.ux3IconReady = '1';
      button.innerHTML = '<svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="5" r="1" fill="currentColor"/><path d="M8 7.2v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    });
  }

  let queued = false;
  const observer = new MutationObserver(() => {
    if(queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; normalizePeekButtons(); });
  });

  function init(){
    normalizePeekButtons();
    observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(normalizePeekButtons,900);
    setTimeout(normalizePeekButtons,1800);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
