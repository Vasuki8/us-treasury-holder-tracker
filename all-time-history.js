(() => {
  const state = {data:null, key:'total_public_debt', range:'ALL', chart:null};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtT = valueBillions => valueBillions == null || !Number.isFinite(Number(valueBillions)) ? '—' : `$${(Number(valueBillions)/1000).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:3})}T`;
  const fmtPct = value => value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`;
  const fmtChangeT = valueBillions => {
    const n = Number(valueBillions);
    if(!Number.isFinite(n)) return '—';
    const sign = n > 0 ? '+' : n < 0 ? '−' : '';
    return `${sign}$${Math.abs(n/1000).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:3})}T`;
  };

  function block(){ return state.data?.all_time_history || {}; }
  function series(){ return block().series || []; }
  function selected(){ return series().find(row => row.key === state.key) || series()[0]; }
  function nominalGdp(){ return series().find(row => row.key === 'nominal_gdp'); }
  function totalDebt(){ return series().find(row => row.key === 'total_public_debt'); }

  function dateTime(value){
    const time = new Date(`${String(value).slice(0,10)}T00:00:00Z`).getTime();
    return Number.isFinite(time) ? time : null;
  }

  function cutoffDate(range){
    if(range === 'ALL') return null;
    const years = Number(String(range).replace('Y',''));
    if(!Number.isFinite(years)) return null;
    const row = selected();
    if(!row?.as_of) return null;
    const latest = new Date(`${String(row.as_of).slice(0,10)}T00:00:00Z`);
    if(Number.isNaN(latest.getTime())) return null;
    latest.setUTCFullYear(latest.getUTCFullYear() - years);
    return latest;
  }

  function visibleObservations(row=selected()){
    const rows = row?.observations || [];
    const cutoff = cutoffDate(state.range);
    if(!cutoff) return rows;
    return rows.filter(item => {
      const time = dateTime(item.date);
      return time != null && time >= cutoff.getTime();
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

  function cagrFor(row){
    const rows = visibleObservations(row).filter(item => Number.isFinite(Number(item.value_billions)));
    if(rows.length < 2) return null;
    const first = rows[0];
    const latest = rows[rows.length - 1];
    const start = Number(first.value_billions);
    const end = Number(latest.value_billions);
    const startTime = dateTime(first.date);
    const endTime = dateTime(latest.date);
    if(start <= 0 || end <= 0 || startTime == null || endTime == null || endTime <= startTime) return null;
    const years = (endTime - startTime) / (365.2425 * 24 * 60 * 60 * 1000);
    if(years <= 0) return null;
    return (Math.pow(end / start, 1 / years) - 1) * 100;
  }

  function changeFor(row){
    const rows = visibleObservations(row).filter(item => Number.isFinite(Number(item.value_billions)));
    if(rows.length < 2) return null;
    const first = Number(rows[0].value_billions);
    const latest = Number(rows[rows.length - 1].value_billions);
    if(!Number.isFinite(first) || !Number.isFinite(latest)) return null;
    return latest - first;
  }

  function renderStats(row, treasuryRow, gdp){
    const host = document.getElementById('allTimeStats');
    if(!host) return;
    const rows = visibleObservations(row);
    const first = rows[0];
    const latest = rows[rows.length - 1];
    const debtChange = row?.key === 'total_public_debt' ? changeFor(row) : null;
    const stats = [
      {
        label:'Observation range',
        value:first?.date && latest?.date ? `${first.date} → ${latest.date}` : '—',
      },
      {
        label:'Latest value',
        value:fmtT(latest?.value_billions),
        meta:debtChange == null ? null : `Selected-period change: ${fmtChangeT(debtChange)}`,
      },
      {label:'Debt CAGR', value:fmtPct(cagrFor(treasuryRow))},
      {label:'Nominal GDP CAGR', value:fmtPct(cagrFor(gdp))},
    ];
    host.innerHTML = stats.map(({label,value,meta}) => `<div class="all-time-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong>${meta ? `<small>${esc(meta)}</small>` : ''}</div>`).join('');
  }

  function timelineDates(...rows){
    const dates = new Set();
    for(const row of rows){
      for(const item of visibleObservations(row)){
        if(item?.date) dates.add(String(item.date));
      }
    }
    return [...dates].sort();
  }

  function alignLatestObservation(row, labels){
    const points = (row?.observations || [])
      .map(item => ({
        date:String(item.date),
        time:dateTime(item.date),
        value:Number(item.value_billions)/1000,
      }))
      .filter(item => item.time != null && Number.isFinite(item.value))
      .sort((a,b) => a.time - b.time);

    const values = [];
    let index = -1;
    for(const label of labels){
      const time = dateTime(label);
      while(index + 1 < points.length && time != null && points[index + 1].time <= time) index += 1;
      values.push(index < 0 ? null : points[index].value);
    }
    return values;
  }

  function draw(){
    const row = selected();
    const gdp = nominalGdp();
    const treasuryRow = row?.key === 'nominal_gdp' ? totalDebt() : row;
    const meta = document.getElementById('allTimeMeta');
    if(meta) meta.textContent = row ? `${row.frequency || 'Official cadence'} · selected range ${state.range === 'ALL' ? 'All' : state.range} · chart values in $ trillions${gdp && treasuryRow ? ' · hover across the timeline to compare Treasury debt and nominal GDP together' : ''}` : (block().note || '');
    renderStats(row, treasuryRow, gdp);

    const canvas = document.getElementById('allTimeChart');
    if(!canvas || !row || !window.Chart || !treasuryRow) return;
    if(state.chart) state.chart.destroy();
    const existing = Chart.getChart(canvas);
    if(existing) existing.destroy();

    const labels = timelineDates(treasuryRow, gdp);
    const treasuryValues = alignLatestObservation(treasuryRow, labels);
    const gdpValues = gdp ? alignLatestObservation(gdp, labels) : [];

    const datasets = [{
      label:`${treasuryRow.label} ($T)`,
      data:treasuryValues,
      borderWidth:2,
      pointRadius:0,
      pointHoverRadius:4,
      pointHitRadius:12,
      tension:.12,
      spanGaps:true,
      borderDash:[3,5],
    }];

    if(gdp && gdpValues.some(value => value != null)){
      datasets.push({
        label:'Nominal GDP (SAAR, $T)',
        data:gdpValues,
        borderWidth:2,
        pointRadius:0,
        pointHoverRadius:4,
        pointHitRadius:12,
        stepped:'after',
        spanGaps:true,
      });
    }

    state.chart = new Chart(canvas, {
      type:'line',
      data:{labels,datasets},
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',axis:'x',intersect:false},
        hover:{mode:'index',axis:'x',intersect:false},
        plugins:{
          legend:{labels:{color:'#dbe6f4'}},
          tooltip:{
            position:'nearest',
            callbacks:{
              title:items=>items?.length ? `Timeline: ${items[0].label}` : '',
              label:ctx=>{
                const value = Number(ctx.parsed.y);
                if(!Number.isFinite(value)) return '';
                return ` ${ctx.dataset.label}: $${value.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:3})}T`;
              }
            }
          }
        },
        scales:{
          x:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',maxTicksLimit:12}},
          y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:value=>`$${Number(value).toLocaleString(undefined,{maximumFractionDigits:1})}T`},title:{display:true,text:'USD trillions',color:'#96a6ba'}}
        }
      }
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

  function defaultForeignHistoryToAll(attempt=0){
    const button = document.querySelector('#foreignHistoryPanel .country-trend-range [data-country-range="ALL"]');
    if(button){
      if(!button.classList.contains('active')) button.click();
      return;
    }
    if(attempt < 12) setTimeout(() => defaultForeignHistoryToAll(attempt + 1), 150);
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
    defaultForeignHistoryToAll();
  }

  if(window.treasuryData) init(window.treasuryData);
  else window.addEventListener('treasury:data-ready', event => init(event.detail), {once:true});
})();
