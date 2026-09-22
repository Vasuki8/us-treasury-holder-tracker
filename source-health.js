(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {current:'Current',expected_lag:'Expected lag',stale:'Stale',unavailable:'Unavailable',runner_limited:'Runner limited'};
  const cadence = {business_daily:'Business daily',daily:'Daily',weekly:'Weekly',monthly:'Monthly',quarterly:'Quarterly',auction:'Event driven'};

  function render(data){
    const host = document.getElementById('sourceHealthGrid');
    const meta = document.getElementById('sourceHealthMeta');
    const note = document.getElementById('sourceHealthNote');
    if(!host) return;
    const rows = Array.isArray(data && data.sources) ? data.sources : [];
    if(meta){
      const c = (data && data.counts) || {};
      meta.textContent = rows.length + ' source families · ' + (c.current || 0) + ' current · ' + (c.expected_lag || 0) + ' expected lag · ' + ((c.stale || 0) + (c.unavailable || 0)) + ' need attention' + (c.runner_limited ? ' · ' + c.runner_limited + ' runner-limited' : '');
    }
    host.innerHTML = rows.map(row => {
      const age = Number.isFinite(Number(row.age_days)) ? Number(row.age_days) + 'd old' : 'No current observation';
      const status = row.status || 'unavailable';
      return '<article class="source-health-card ' + esc(status) + '">' +
        '<div class="source-health-top"><strong>' + esc(row.label) + '</strong><span>' + esc(labels[status] || status) + '</span></div>' +
        '<div class="source-health-value">' + esc(row.observation_date || '—') + '</div>' +
        '<div class="source-health-meta">' + esc(cadence[row.cadence] || row.cadence || 'Unknown cadence') + ' · ' + esc(age) + '</div>' +
        '<p>' + esc(row.note || '') + '</p>' +
        '<a href="' + esc(row.source_url) + '" target="_blank" rel="noopener noreferrer">Official source</a>' +
      '</article>';
    }).join('');
    if(note) note.textContent = (data && data.methodology) || '';
  }

  async function load(){
    try{
      const response = await fetch('data/source-health.json?v=' + Date.now());
      if(!response.ok) throw new Error('source-health.json ' + response.status);
      render(await response.json());
    }catch(error){
      console.warn('Source health unavailable', error);
      const meta = document.getElementById('sourceHealthMeta');
      const host = document.getElementById('sourceHealthGrid');
      if(meta) meta.textContent = 'Source-health artifact is temporarily unavailable.';
      if(host) host.innerHTML = '<div class="empty-state">The dashboard data remains available; only the source-health summary could not be loaded.</div>';
    }
  }
  load();
})();
