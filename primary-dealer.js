(() => {
  const state = {data:null, key:'PDPOSGST-TOT', range:'5Y', chart:null};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtB = value => {
    const n = Number(value);
    if(!Number.isFinite(n)) return '—';
    const sign = n < 0 ? '−' : '';
    return `${sign}$${Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  };
  const signedB = value => {
    const n = Number(value);
    if(!Number.isFinite(n)) return '—';
    return `${n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  };

  function block(){ return state.data?.primary_dealer_positioning || {}; }
  function series(){ return block().series || []; }
  function selected(){ return series().find(row => row.keyid === state.key) || series()[0]; }
  function ms(value){
    const time = new Date(`${String(value || '').slice(0,10)}T00:00:00Z`).getTime();
    return Number.isFinite(time) ? time : null;
  }
  function visible(row=selected()){
    const rows=(row?.history || []).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    if(state.range==='ALL' || !rows.length) return rows;
    const years=Number(state.range.replace('Y',''));
    const latest=ms(rows.at(-1)?.date);
    if(!Number.isFinite(years) || latest==null) return rows;
    const cutoff=new Date(latest);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear()-years);
    return rows.filter(item => (ms(item.date) ?? -Infinity) >= cutoff.getTime());
  }
  function rangeChange(row=selected()){
    const rows=visible(row);
    if(rows.length<2) return null;
    return Number(rows.at(-1).value_billions)-Number(rows[0].value_billions);
  }

  function populate(){
    const select=document.getElementById('dealerSeries');
    if(!select) return;
    select.innerHTML=series().map(row=>`<option value="${esc(row.keyid)}">${esc(row.name)}</option>`).join('');
    if(series().some(row=>row.keyid===state.key)) select.value=state.key;
    else if(series()[0]) state.key=series()[0].keyid;
    select.onchange=()=>{ state.key=select.value; state.range='5Y'; ranges(); render(); };
  }

  function ranges(){
    const host=document.getElementById('dealerRanges');
    if(!host) return;
    host.innerHTML=['1Y','3Y','5Y','10Y','ALL'].map(value=>`<button type="button" data-dealer-range="${value}" class="${value===state.range?'active':''}">${value==='ALL'?'All':value}</button>`).join('');
    host.querySelectorAll('[data-dealer-range]').forEach(button=>button.addEventListener('click',()=>{
      state.range=button.dataset.dealerRange;
      ranges();
      render();
    }));
  }

  function renderStats(row, rows){
    const host=document.getElementById('dealerStats');
    const meta=document.getElementById('dealerMeta');
    if(!row || !host) return;
    const latest=rows.at(-1);
    const first=rows[0];
    const change=rangeChange(row);
    host.innerHTML=[
      ['Current net position',fmtB(latest?.value_billions),`As of ${row.as_of || '—'}`],
      ['1W change',signedB(row.weekly_change_billions),'Latest weekly move'],
      ['Selected-range change',signedB(change),state.range==='ALL'?'All available history':state.range],
      ['Visible history',`${first?.date || '—'} → ${latest?.date || '—'}`,`${rows.length.toLocaleString()} weekly observations`],
    ].map(([label,value,sub])=>`<div class="dealer-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`).join('');
    if(meta) meta.textContent=`${row.name} · weekly aggregate net outright position · latest ${row.as_of || '—'}`;
  }

  function draw(row, rows){
    const canvas=document.getElementById('primaryDealerChart');
    if(!canvas || !row || !window.Chart) return;
    const existing=Chart.getChart(canvas);
    if(existing) existing.destroy();
    if(state.chart) state.chart.destroy();

    state.chart=new Chart(canvas,{
      type:'line',
      data:{
        labels:rows.map(item=>item.date),
        datasets:[{
          label:row.name,
          data:rows.map(item=>item.value_billions),
          borderWidth:2,
          pointRadius:rows.length<=80?1.5:0,
          pointHoverRadius:4,
          pointHitRadius:9,
          tension:.12,
          fill:false,
        }],
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{label:ctx=>` ${fmtB(ctx.parsed.y)}`}},
        },
        scales:{
          x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:12}},
          y:{
            grid:{color:ctx=>Number(ctx.tick?.value)===0?'rgba(219,230,244,.28)':'rgba(148,184,221,.08)'},
            ticks:{color:'#96a6ba',callback:value=>fmtB(value)},
            title:{display:true,text:'Net position ($B)',color:'#96a6ba'},
          },
        },
      },
    });
  }

  function render(){
    const row=selected();
    const rows=visible(row);
    renderStats(row,rows);
    draw(row,rows);
    const note=document.getElementById('dealerNote');
    if(note) note.textContent=block().note || '';
  }

  function csvCell(value){
    const text=String(value ?? '');
    return /[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;
  }
  function downloadCsv(){
    const rows=[['keyid','series','observation_date','net_position_billions','source_url']];
    for(const row of series()) for(const observation of row.history || []) rows.push([row.keyid,row.name,observation.date,observation.value_billions,block().source_url]);
    const csv=rows.map(row=>row.map(csvCell).join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='primary-dealer-treasury-positioning.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function init(data){
    state.data=data;
    const panel=document.getElementById('primaryDealerPanel');
    if(!panel) return;
    if(!series().length){
      panel.querySelector('.dealer-body')?.replaceChildren(Object.assign(document.createElement('div'),{className:'empty-state',textContent:'Primary dealer positioning is not available yet.'}));
      return;
    }
    populate();
    ranges();
    render();
    document.getElementById('downloadDealerCsv')?.addEventListener('click',downloadCsv);
  }

  if(window.treasuryData) init(window.treasuryData);
  else window.addEventListener('treasury:data-ready',event=>init(event.detail),{once:true});
})();
