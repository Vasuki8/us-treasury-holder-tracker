(() => {
  const state = {data:null, key:'total_public_debt', range:'ALL', chart:null};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtB = value => value == null || !Number.isFinite(Number(value)) ? '—' : `$${Number(value).toLocaleString(undefined,{maximumFractionDigits:1})}B`;

  function block(){ return state.data?.all_time_history || {}; }
  function series(){ return block().series || []; }
  function selected(){ return series().find(row => row.key === state.key) || series()[0]; }

  function cutoffDate(range){
    if(range === 'ALL') return null;
    const years = Number(String(range).replace('Y',''));
    if(!Number.isFinite(years)) return null;
    const row = selected();
    if(!row?.as_of) return null;
    const latest = new Date(`${String(row.as_of).slice(0,7)}-01T00:00:00Z`);
    if(Number.isNaN(latest.getTime())) return null;
    latest.setUTCFullYear(latest.getUTCFullYear() - years);
    return latest;
  }

  function visibleObservations(){
    const rows = selected()?.observations || [];
    const cutoff = cutoffDate(state.range);
    if(!cutoff) return rows;
    return rows.filter(row => {
      const d = new Date(`${String(row.date).slice(0,7)}-01T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d >= cutoff;
    });
  }

  function rangeButtons(){
    const host = document.getElementById('allTimeRanges');
    if(!host) return;
    const ranges = ['1Y','5Y','10Y','20Y','30Y','ALL'];
    host.innerHTML = ranges.map(range => `<button type="button" data-alltime-range="${range}" class="${range===state.range?'active':''}">${range==='ALL'?'All':range}</button>`).join('');
    host.querySelectorAll('[data-alltime-range]').forEach(button => button.addEventListener('click', () => {
      state.range = button.dataset.alltimeRange;
      rangeButtons();
      draw();
    }));
  }

  function populateSelect(){
    const select = document.getElementById('allTimeSeries');
    if(!select) return;
    select.innerHTML = series().map(row => `<option value="${esc(row.key)}">${esc(row.label)}</option>`).join('');
    if(series().some(row => row.key === state.key)) select.value = state.key;
    else if(series()[0]) state.key = series()[0].key;
    select.onchange = () => {
      state.key = select.value;
      state.range = 'ALL';
      rangeButtons();
      draw();
    };
  }

  function renderStats(row){
    const host = document.getElementById('allTimeStats');
    if(!host) return;
    const rows = row?.observations || [];
    const latest = rows[rows.length - 1];
    host.innerHTML = [
      ['First observation', row?.history_start || '—'],
      ['Latest observation', row?.as_of || '—'],
      ['Observations', Number(row?.observation_count || 0).toLocaleString()],
      ['Latest value', fmtB(latest?.value_billions)],
    ].map(([label,value]) => `<div class="all-time-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  }

  function draw(){
    const row = selected();
    const meta = document.getElementById('allTimeMeta');
    if(meta) meta.textContent = row ? `${row.frequency || 'Official cadence'} · ${row.history_start || '—'} to ${row.as_of || '—'} · ${Number(row.observation_count || 0).toLocaleString()} official observations` : (block().note || '');
    renderStats(row);

    const observations = visibleObservations();
    const canvas = document.getElementById('allTimeChart');
    if(!canvas || !row || !window.Chart) return;
    if(state.chart) state.chart.destroy();
    const existing = Chart.getChart(canvas);
    if(existing) existing.destroy();
    state.chart = new Chart(canvas, {
      type:'line',
      data:{labels:observations.map(item=>item.date),datasets:[{label:`${row.label} ($B)`,data:observations.map(item=>item.value_billions),borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:.12}]},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}},tooltip:{callbacks:{label:ctx=>` ${fmtB(ctx.parsed.y)}`}}},scales:{x:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',maxTicksLimit:12}},y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:value=>`$${Number(value).toLocaleString()}B`}}}}
    });
  }

  function csvCell(value){
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
  }

  function buildCsv(){
    const rows = [['series_key','series_label','observation_date','value_billions','frequency','source_url']];
    for(const row of series()){
      for(const observation of row.observations || []) rows.push([row.key,row.label,observation.date,observation.value_billions,row.frequency || '',row.source_url || '']);
    }
    return rows.map(row => row.map(csvCell).join(',')).join('\n');
  }

  function downloadCsv(){
    const blob = new Blob([buildCsv()], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'treasury-all-time-history.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function init(data){
    state.data = data;
    const panel = document.getElementById('allTimeHistoryPanel');
    if(!panel) return;
    if(!series().length){
      panel.querySelector('.all-time-body')?.replaceChildren(Object.assign(document.createElement('div'), {className:'empty-state', textContent:'All-time history is not available yet.'}));
      return;
    }
    populateSelect();
    rangeButtons();
    draw();
    document.getElementById('downloadAllTimeCsv')?.addEventListener('click', downloadCsv);
  }

  if(window.treasuryData) init(window.treasuryData);
  else window.addEventListener('treasury:data-ready', event => init(event.detail), {once:true});
})();
