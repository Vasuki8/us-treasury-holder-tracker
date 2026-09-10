(() => {
  function normalizePeekButtons(){
    document.querySelectorAll('.ux3-peek').forEach((button) => {
      if(button.dataset.ux3IconReady) return;
      button.dataset.ux3IconReady = '1';
      button.innerHTML = '<svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="5" r="1" fill="currentColor"/><path d="M8 7.2v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    });
  }

  function loadCleanVisualLayer(){
    if(!document.getElementById('ux4InlineTrim')){
      const style=document.createElement('style');
      style.id='ux4InlineTrim';
      style.textContent='body.ux4-essential .ux-mode-button[data-mode="compare"],body.ux4-essential .ux-mode-button[data-mode="data"],body.ux4-essential .ux-mode-button[data-mode="pinned"]{display:none!important}body.ux4-essential main.shell>section.note:not(.panel){display:none!important}';
      document.head.appendChild(style);
    }
    if(!document.querySelector('link[data-ux4]')){
      const link=document.createElement('link');
      link.rel='stylesheet';
      link.href='ux-v4.css';
      link.dataset.ux4='1';
      document.head.appendChild(link);
    }
    if(!document.querySelector('link[data-ux5]')){
      const link=document.createElement('link');
      link.rel='stylesheet';
      link.href='ux-v5.css';
      link.dataset.ux5='1';
      document.head.appendChild(link);
    }
    if(!document.querySelector('script[data-ux4]')){
      const script=document.createElement('script');
      script.src='ux-v4.js';
      script.defer=true;
      script.dataset.ux4='1';
      document.body.appendChild(script);
    }
  }

  let queued = false;
  const observer = new MutationObserver(() => {
    if(queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; normalizePeekButtons(); });
  });

  function init(){
    normalizePeekButtons();
    loadCleanVisualLayer();
    observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(normalizePeekButtons,900);
    setTimeout(normalizePeekButtons,1800);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
