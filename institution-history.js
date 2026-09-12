(() => {
  const state = {data:null, key:'hedge_funds', range:'ALL', chart:null};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtB = value => value == null || !Number.isFinite(Number(value)) ? '—' : `$${Number(value).toLocaleString(undefined,{minimumFractionDigits:Number(value)>=1000?0:1,maximumFractionDigits:1})}B`;
  const signedB = value => {
    const n = Number(value);
    if(!Number.isFinite(n)) return '—';
    const sign = n > 0 ? '+' : n < 0 ? '−' : '';
    return `${sign}$${Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  };

  function block(){ return state.data?.institution_holder_history || {}; }
  function series(){ return block().series || []; }
  function selected(){ return series().find(row => row.key === state.key) || series()[0]; }
  function dateMs(value){
    const time = new Date(`${String(value).slice(0,10)}T00:00:00Z`).getTime();
    return Number.isFinite(time) ? time : null;
  }

  function visible(row=selected()){
    const rows = (row?.observations || []).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    if(state.range === 'ALL' || !rows.length) return rows;
    const years = Number(state.range.replace('Y',''));
    const latest = dateMs(rows[rows.length-1].date);
    if(!Number.isFinite(years) || latest == null) return rows;
    const cutoff = new Date(latest);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
    return rows.filter(item => {
      const time = dateMs(item.date);
      return time != null && time >= cutoff.getTime();
    });
  }

  function selectedChange(row=selected()){
    const rows = visible(row);
    if(rows.length < 2) return null;
    return Number(rows[rows.length-1].value_billions) - Number(rows[0].value_billions);
  }

  function ranges(){
    const host = document.getElementById('institutionRanges');
    if(!host) return;
    const values = ['1Y','3Y','5Y','10Y','ALL'];
    host.innerHTML = values.map(value => `<button type="button" data-institution-range="${value}" class="${value===state.range?'active':''}">${value==='ALL'?'All':value}</button>`).join('');
    host.querySelectorAll('[data-institution-range]').forEach(button => button.addEventListener('click', () => {
      state.range = button.dataset.institutionRange;
      ranges();
      draw();
    }));
  }

  function populate(){
    const select = document.getElementById('institutionSeries');
    if(!select) return;
    select.innerHTML = series().map(row => `<option value="${esc(row.key)}">${esc(row.label)}</option>`).join('');
    if(series().some(row => row.key === state.key)) select.value = state.key;
    else if(series()[0]) state.key = series()[0].key;
    select.onchange = () => {
      state.key = select.value;
      state.range = 'ALL';
      ranges();
      draw();
    };
  }

  function renderMeta(row, rows){
    const meta = document.getElementById('institutionMeta');
    if(!meta || !row) return;
    const latest = rows[rows.length-1];
    const change = selectedChange(row);
    const rangeText = state.range === 'ALL' ? 'All history' : state.range;
    meta.innerHTML = `<strong>${esc(fmtB(latest?.value_billions))}</strong><span>${esc(change == null ? '—' : signedB(change))}</span><em>${esc(rangeText)} · latest ${esc(row.as_of || '—')} · history from ${esc(row.history_start || '—')}</em>`;
  }

  function draw(){
    const row = selected();
    const rows = visible(row);
    renderMeta(row, rows);

    const note = document.getElementById('institutionNote');
    if(note) note.textContent = row?.note || block().note || '';

    const canvas = document.getElementById('institutionHistoryChart');
    if(!canvas || !row || !window.Chart) return;
    if(state.chart) state.chart.destroy();
    const existing = Chart.getChart(canvas);
    if(existing) existing.destroy();

    state.chart = new Chart(canvas, {
      type:'line',
      data:{
        labels:rows.map(item => item.date),
        datasets:[{
          label:`${row.label} Treasury holdings ($B)`,
          data:rows.map(item => item.value_billions),
          borderWidth:2,
          pointRadius:rows.length <= 28 ? 2 : 0,
          pointHoverRadius:4,
          pointHitRadius:10,
          tension:.16,
          spanGaps:true,
        }],
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{labels:{color:'#dbe6f4'}},
          tooltip:{callbacks:{label:ctx=>` ${fmtB(ctx.parsed.y)}`}},
        },
        scales:{
          x:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',maxTicksLimit:12}},
          y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:value=>fmtB(value)},title:{display:true,text:'Treasury holdings ($B)',color:'#96a6ba'}},
        },
      },
    });
  }

  function csvCell(value){
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
  }

  function downloadCsv(){
    const rows = [['holder_key','holder','series_id','observation_date','treasury_holdings_billions','frequency','source_url']];
    for(const row of series()){
      for(const observation of row.observations || []) rows.push([row.key,row.label,row.series_id,observation.date,observation.value_billions,row.frequency,row.source_url]);
    }
    const text = rows.map(row => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([text],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'treasury-institution-holder-history.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function init(data){
    state.data = data;
    const panel = document.getElementById('institutionHistoryPanel');
    if(!panel) return;
    if(!series().length){
      panel.querySelector('.institution-body')?.replaceChildren(Object.assign(document.createElement('div'),{className:'empty-state',textContent:'Institution holder history is not available yet.'}));
      return;
    }
    populate();
    ranges();
    draw();
    document.getElementById('downloadInstitutionCsv')?.addEventListener('click',downloadCsv);
  }

  if(window.treasuryData) init(window.treasuryData);
  else window.addEventListener('treasury:data-ready',event=>init(event.detail),{once:true});
})();
