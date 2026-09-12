(() => {
  const state = {
    data:null,
    range:'1Y',
    curveChart:null,
    historyChart:null,
    spreadChart:null,
    breakevenChart:null,
    refinancingChart:null,
    auctionRange:'3Y',
    auctionKey:null,
    auctionRateChart:null,
    auctionSpreadChart:null,
  };
  const RANGE_VALUES = ['1M','3M','6M','1Y','3Y','5Y','10Y','ALL'];
  const AUCTION_RANGES = ['3M','6M','1Y','3Y','5Y','10Y','ALL'];
  const KEY_TENORS = ['3m','6m','1y','2y','3y','5y','7y','10y','20y','30y'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite = value => Number.isFinite(Number(value));
  const num = value => Number(value);
  const fmtPct = (value,digits=2) => finite(value) ? `${num(value).toFixed(digits)}%` : '—';
  const fmtB = value => {
    const n=num(value);
    if(!Number.isFinite(n)) return '—';
    return Math.abs(n)>=1000 ? `$${(n/1000).toFixed(2)}T` : `$${n.toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  };
  const fmtBps = value => {
    const n=num(value);
    if(!Number.isFinite(n)) return '—';
    return `${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(0)} bps`;
  };
  const changeBps = (latest,first) => finite(latest)&&finite(first) ? (num(latest)-num(first))*100 : null;
  const dayMs = value => {
    const t=new Date(`${String(value||'').slice(0,10)}T00:00:00Z`).getTime();
    return Number.isFinite(t)?t:null;
  };
  const prettyDate = value => {
    const t=dayMs(value);
    return t==null?'—':new Date(t).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
  };
  const median = values => {
    const rows=values.map(num).filter(Number.isFinite).sort((a,b)=>a-b);
    if(!rows.length) return null;
    const mid=Math.floor(rows.length/2);
    return rows.length%2?rows[mid]:(rows[mid-1]+rows[mid])/2;
  };

  function block(){ return state.data?.treasury_yield_curve || {}; }
  function nominal(){ return block().nominal?.history || []; }
  function real(){ return block().real?.history || []; }
  function spreads(){ return block().spreads?.history || []; }
  function breakeven(){ return block().breakeven?.history || []; }
  function auctionBlock(){ return state.data?.treasury_auction_yield_history || {}; }
  function auctionSeries(){ return auctionBlock().series || []; }

  function cutoffFrom(latestDate,range){
    if(range==='ALL') return null;
    const d=new Date(`${latestDate}T00:00:00Z`);
    if(Number.isNaN(d.getTime())) return null;
    if(range.endsWith('M')) d.setUTCMonth(d.getUTCMonth()-Number(range.replace('M','')));
    else d.setUTCFullYear(d.getUTCFullYear()-Number(range.replace('Y','')));
    return d.getTime();
  }
  function filterRange(rows,range=state.range,dateKey='date'){
    const sorted=(rows||[]).slice().filter(r=>r?.[dateKey]).sort((a,b)=>String(a[dateKey]).localeCompare(String(b[dateKey])));
    if(!sorted.length||range==='ALL') return sorted;
    const cutoff=cutoffFrom(sorted.at(-1)[dateKey],range);
    return cutoff==null?sorted:sorted.filter(row=>(dayMs(row[dateKey])??-Infinity)>=cutoff);
  }
  function sampleRows(rows,maxPoints=1200){
    if(rows.length<=maxPoints) return rows;
    const step=(rows.length-1)/(maxPoints-1);
    const out=[];
    for(let i=0;i<maxPoints;i++) out.push(rows[Math.round(i*step)]);
    return out;
  }
  function rowOnOrBefore(rows,date){
    let found=null;
    for(const row of rows){
      if(String(row.date)<=String(date)) found=row;
      else break;
    }
    return found;
  }
  function destroy(canvas){
    if(!canvas||!window.Chart) return;
    const existing=Chart.getChart(canvas);
    if(existing) existing.destroy();
  }

  function ensureExtensions(){
    const panel=document.getElementById('yieldCurvePanel');
    const grid=panel?.querySelector('.insight-grid');
    if(grid&&!document.getElementById('yieldRefinancingChart')){
      const wrap=document.createElement('div');
      wrap.className='insight-subpanel yield-refi-wide';
      wrap.innerHTML='<div class="insight-subhead"><div><h3>Refinancing exposure vs market curve</h3><p>Current principal maturity exposure by remaining-term bucket, overlaid with the latest curve and selected-period-start curve.</p></div></div><div class="chart-wrap insight-chart yield-refi-chart"><canvas id="yieldRefinancingChart"></canvas></div>';
      grid.appendChild(wrap);
    }

    if(panel&&!document.getElementById('auctionYieldPanel')){
      const section=document.createElement('section');
      section.className='panel auction-yield-panel';
      section.id='auctionYieldPanel';
      section.innerHTML=`
        <div class="panel-head">
          <div><h2>Auction Yield History</h2><p id="auctionYieldMeta">Loading Treasury auction result rates…</p></div>
          <div class="panel-actions"><select id="auctionYieldSeries" aria-label="Select Treasury auction yield series"></select><button id="downloadAuctionYieldCsv" type="button">Download auction CSV</button></div>
        </div>
        <div class="insight-body">
          <div class="insight-cards" id="auctionYieldCards"></div>
          <div class="insight-toolbar"><div class="insight-range" id="auctionYieldRanges"></div></div>
          <div class="insight-grid">
            <div class="insight-subpanel"><div class="insight-subhead"><div><h3>Auction result vs par reference</h3><p>Actual auction result rate compared with Treasury's matched-maturity par curve reference.</p></div></div><div class="chart-wrap insight-chart"><canvas id="auctionYieldRateChart"></canvas></div></div>
            <div class="insight-subpanel"><div class="insight-subhead"><div><h3>Result minus par reference</h3><p>Context spread in basis points; this is not an exact when-issued auction tail.</p></div></div><div class="chart-wrap insight-chart"><canvas id="auctionYieldSpreadChart"></canvas></div></div>
          </div>
          <div class="insight-table auction-yield-table"><div class="insight-subhead"><div><h3>Recent selected-term auctions</h3><p id="auctionYieldTableMeta"></p></div></div><div class="table-wrap"><table><thead><tr><th>Auction</th><th>Result</th><th>Par ref.</th><th>Spread</th><th>Coupon</th><th>Bid/cover</th><th>Reopening</th></tr></thead><tbody id="auctionYieldTable"></tbody></table></div></div>
          <div class="note inline-note insight-note" id="auctionYieldNote"></div>
        </div>`;
      panel.insertAdjacentElement('afterend',section);
      document.getElementById('auctionYieldSeries')?.addEventListener('change',event=>{
        state.auctionKey=event.target.value;
        renderAuction();
      });
      document.getElementById('downloadAuctionYieldCsv')?.addEventListener('click',downloadAuctionCsv);
    }
  }

  function renderRanges(){
    const host=document.getElementById('yieldCurveRanges');
    if(!host) return;
    host.innerHTML=RANGE_VALUES.map(range=>`<button type="button" data-yield-range="${range}" class="${range===state.range?'active':''}">${range==='ALL'?'All':range}</button>`).join('');
    host.querySelectorAll('[data-yield-range]').forEach(button=>button.addEventListener('click',()=>{
      state.range=button.dataset.yieldRange;
      renderCurveWorkspace();
    }));
  }

  function curveShape(spread2y,spread3m){
    if(!finite(spread2y)||!finite(spread3m)) return 'Mixed';
    if(num(spread2y)<0&&num(spread3m)<0) return 'Inverted';
    if(num(spread2y)>0&&num(spread3m)>0) return 'Upward sloping';
    return 'Mixed';
  }

  function renderCards(){
    const nrows=filterRange(nominal());
    const srows=filterRange(spreads());
    if(!nrows.length) return;
    const first=nrows[0], latest=nrows.at(-1);
    const firstSpread=srows[0]||{}, latestSpread=srows.at(-1)||{};
    const latestBreakeven=rowOnOrBefore(breakeven(),latest.date)||{};
    const refi=block().refinancing_context||{};
    const cards=[
      ['3M yield',fmtPct(latest['3m']),fmtBps(changeBps(latest['3m'],first['3m']))+' selected change'],
      ['2Y yield',fmtPct(latest['2y']),fmtBps(changeBps(latest['2y'],first['2y']))+' selected change'],
      ['10Y yield',fmtPct(latest['10y']),fmtBps(changeBps(latest['10y'],first['10y']))+' selected change'],
      ['30Y yield',fmtPct(latest['30y']),fmtBps(changeBps(latest['30y'],first['30y']))+' selected change'],
      ['10Y − 2Y',fmtBps(latestSpread['10y_2y_bps']),`${curveShape(latestSpread['10y_2y_bps'],latestSpread['10y_3m_bps'])} · ${fmtBps(num(latestSpread['10y_2y_bps'])-num(firstSpread['10y_2y_bps']))} change`],
      ['10Y − 3M',fmtBps(latestSpread['10y_3m_bps']),`${fmtBps(num(latestSpread['10y_3m_bps'])-num(firstSpread['10y_3m_bps']))} selected change`],
      ['10Y breakeven',fmtPct(latestBreakeven['10y']),`Nominal − real · ${prettyDate(latestBreakeven.date)}`],
      ['12M principal due',fmtB(refi.next_12m_principal_billions),'Current refinancing exposure from maturity wall'],
    ];
    const host=document.getElementById('yieldCurveCards');
    if(host) host.innerHTML=cards.map(([label,value,meta])=>`<div class="insight-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`).join('');
    const meta=document.getElementById('yieldCurveMeta');
    if(meta) meta.textContent=`${state.range==='ALL'?'All available history':state.range} · ${nrows.length.toLocaleString()} nominal observations · ${prettyDate(first.date)} → ${prettyDate(latest.date)} · real curve through ${prettyDate(block().real_as_of)}`;
  }

  function drawCurve(){
    const canvas=document.getElementById('yieldCurveSnapshotChart');
    if(!canvas||!window.Chart) return;
    const nrows=filterRange(nominal());
    if(!nrows.length) return;
    const first=nrows[0], latest=nrows.at(-1);
    const latestReal=rowOnOrBefore(real(),latest.date)||block().real?.latest||{};
    const tenors=block().tenors||KEY_TENORS.map(key=>({key,label:key.toUpperCase()}));
    destroy(canvas);
    state.curveChart=new Chart(canvas,{
      type:'line',
      data:{labels:tenors.map(t=>t.label),datasets:[
        {label:`Latest nominal · ${latest.date}`,data:tenors.map(t=>latest[t.key]),borderWidth:2.4,pointRadius:3,pointHoverRadius:5,tension:.22,spanGaps:true},
        {label:`Start of ${state.range==='ALL'?'history':state.range} · ${first.date}`,data:tenors.map(t=>first[t.key]),borderWidth:1.8,pointRadius:2,pointHoverRadius:4,tension:.22,spanGaps:true,borderDash:[6,4]},
        {label:`Latest real (TIPS) · ${latestReal.date||'—'}`,data:tenors.map(t=>latestReal[t.key]??null),borderWidth:1.8,pointRadius:2,pointHoverRadius:4,tension:.22,spanGaps:true,borderDash:[2,4]},
      ]},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}},tooltip:{callbacks:{label:ctx=>` ${ctx.dataset.label}: ${fmtPct(ctx.parsed.y)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba'}},y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`${Number(v).toFixed(1)}%`},title:{display:true,text:'Par yield',color:'#96a6ba'}}}}
    });
  }

  function drawHistory(){
    const canvas=document.getElementById('yieldHistoryChart');
    if(!canvas||!window.Chart) return;
    const rows=sampleRows(filterRange(nominal()));
    destroy(canvas);
    const defs=[['3m','3M'],['2y','2Y'],['10y','10Y'],['30y','30Y']];
    state.historyChart=new Chart(canvas,{type:'line',data:{labels:rows.map(r=>r.date),datasets:defs.map(([key,label])=>({label,data:rows.map(r=>r[key]),borderWidth:1.8,pointRadius:0,pointHoverRadius:4,tension:.08,spanGaps:false}))},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>` ${ctx.dataset.label}: ${fmtPct(ctx.parsed.y)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:10}},y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`${Number(v).toFixed(1)}%`},title:{display:true,text:'Yield',color:'#96a6ba'}}}}});
  }

  function drawSpreads(){
    const canvas=document.getElementById('yieldSpreadChart');
    if(!canvas||!window.Chart) return;
    const rows=sampleRows(filterRange(spreads()));
    destroy(canvas);
    const defs=[['10y_2y_bps','10Y − 2Y'],['10y_3m_bps','10Y − 3M'],['30y_10y_bps','30Y − 10Y']];
    state.spreadChart=new Chart(canvas,{type:'line',data:{labels:rows.map(r=>r.date),datasets:defs.map(([key,label])=>({label,data:rows.map(r=>r[key]),borderWidth:1.8,pointRadius:0,pointHoverRadius:4,tension:.08,spanGaps:false}))},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>` ${ctx.dataset.label}: ${fmtBps(ctx.parsed.y)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:10}},y:{grid:{color:ctx=>Number(ctx.tick?.value)===0?'rgba(219,230,244,.30)':'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`${v} bps`},title:{display:true,text:'Curve spread',color:'#96a6ba'}}}}});
  }

  function drawBreakeven(){
    const canvas=document.getElementById('breakevenChart');
    if(!canvas||!window.Chart) return;
    const rows=sampleRows(filterRange(breakeven()));
    destroy(canvas);
    const defs=[['5y','5Y'],['10y','10Y'],['30y','30Y']];
    state.breakevenChart=new Chart(canvas,{type:'line',data:{labels:rows.map(r=>r.date),datasets:defs.map(([key,label])=>({label:`${label} breakeven`,data:rows.map(r=>r[key]),borderWidth:1.8,pointRadius:0,pointHoverRadius:4,tension:.08,spanGaps:false}))},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>` ${ctx.dataset.label}: ${fmtPct(ctx.parsed.y)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:10}},y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`${Number(v).toFixed(1)}%`},title:{display:true,text:'Nominal − real yield',color:'#96a6ba'}}}}});
  }

  function drawRefinancingOverlay(){
    const canvas=document.getElementById('yieldRefinancingChart');
    if(!canvas||!window.Chart) return;
    const overlay=block().refinancing_overlay||{};
    const buckets=overlay.buckets||[];
    const nrows=filterRange(nominal());
    if(!buckets.length||!nrows.length) return;
    const first=nrows[0], latest=nrows.at(-1);
    destroy(canvas);
    state.refinancingChart=new Chart(canvas,{
      data:{labels:buckets.map(row=>row.label),datasets:[
        {type:'bar',label:'Principal due by remaining-term bucket',data:buckets.map(row=>row.principal_billions),yAxisID:'y',borderWidth:0,borderRadius:2,order:2},
        {type:'line',label:`Latest nominal curve · ${latest.date}`,data:buckets.map(row=>latest[row.key]),yAxisID:'y1',borderWidth:2.4,pointRadius:3,pointHoverRadius:5,tension:.18,spanGaps:true,order:1},
        {type:'line',label:`Start of ${state.range==='ALL'?'history':state.range} · ${first.date}`,data:buckets.map(row=>first[row.key]),yAxisID:'y1',borderWidth:1.8,pointRadius:2,pointHoverRadius:4,tension:.18,spanGaps:true,borderDash:[6,4],order:1},
      ]},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}},tooltip:{callbacks:{label:ctx=>ctx.dataset.yAxisID==='y'?` ${ctx.dataset.label}: ${fmtB(ctx.parsed.y)}`:` ${ctx.dataset.label}: ${fmtPct(ctx.parsed.y)}`,footer:items=>{const row=buckets[items?.[0]?.dataIndex];return row?`${row.security_count||0} outstanding securities in this bucket`:'';}}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba'}},y:{beginAtZero:true,position:'left',grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>fmtB(v)},title:{display:true,text:'Principal due',color:'#96a6ba'}},y1:{position:'right',grid:{drawOnChartArea:false},ticks:{color:'#96a6ba',callback:v=>`${Number(v).toFixed(1)}%`},title:{display:true,text:'Par yield',color:'#96a6ba'}}}}
    });
  }

  function selectedAuctionSeries(){
    const rows=auctionSeries();
    if(!rows.length) return null;
    if(!state.auctionKey) state.auctionKey=auctionBlock().default_series_key||rows[0].key;
    return rows.find(row=>row.key===state.auctionKey)||rows[0];
  }
  function visibleAuctionRows(){
    const series=selectedAuctionSeries();
    return series?filterRange(series.observations||[],state.auctionRange,'auction_date'):[];
  }
  function renderAuctionControls(){
    const select=document.getElementById('auctionYieldSeries');
    const series=auctionSeries();
    if(select){
      const value=state.auctionKey||auctionBlock().default_series_key||series[0]?.key;
      select.innerHTML=series.map(row=>`<option value="${esc(row.key)}" ${row.key===value?'selected':''}>${esc(row.label)}</option>`).join('');
      state.auctionKey=select.value||value;
    }
    const host=document.getElementById('auctionYieldRanges');
    if(host){
      host.innerHTML=AUCTION_RANGES.map(range=>`<button type="button" data-auction-yield-range="${range}" class="${range===state.auctionRange?'active':''}">${range==='ALL'?'All':range}</button>`).join('');
      host.querySelectorAll('[data-auction-yield-range]').forEach(button=>button.addEventListener('click',()=>{
        state.auctionRange=button.dataset.auctionYieldRange;
        renderAuction();
      }));
    }
  }
  function renderAuctionCards(){
    const series=selectedAuctionSeries();
    const rows=visibleAuctionRows();
    if(!series||!rows.length) return;
    const latest=rows.at(-1);
    const spreads=rows.map(row=>row.result_minus_reference_bps).filter(finite);
    const cards=[
      ['Latest auction result',fmtPct(latest.auction_result_rate_pct,3),`${latest.rate_kind||'Result rate'} · ${prettyDate(latest.auction_date)}`],
      ['Matched par reference',fmtPct(latest.reference_rate_pct,3),latest.reference_date?`${latest.reference_curve_type==='real'?'Real TIPS':'Nominal'} par · ${prettyDate(latest.reference_date)}`:'No matched reference'],
      ['Result − par reference',fmtBps(latest.result_minus_reference_bps),'Context spread, not an exact auction tail'],
      ['Median result',fmtPct(median(rows.map(row=>row.auction_result_rate_pct)),3),`${rows.length} auctions in ${state.auctionRange==='ALL'?'all history':state.auctionRange}`],
      ['Median result − par',fmtBps(median(spreads)),`${spreads.length} matched observations`],
      ['Latest bid / cover',finite(latest.bid_to_cover)?num(latest.bid_to_cover).toFixed(2):'—',latest.reopening?`Reopening: ${latest.reopening}`:'Selected term'],
    ];
    const host=document.getElementById('auctionYieldCards');
    if(host) host.innerHTML=cards.map(([label,value,meta])=>`<div class="insight-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`).join('');
    const meta=document.getElementById('auctionYieldMeta');
    if(meta) meta.textContent=`${series.label} · ${state.auctionRange==='ALL'?'All available history':state.auctionRange} · ${rows.length} auctions · ${prettyDate(rows[0].auction_date)} → ${prettyDate(rows.at(-1).auction_date)}`;
  }
  function drawAuctionRate(){
    const canvas=document.getElementById('auctionYieldRateChart');
    if(!canvas||!window.Chart) return;
    const rows=visibleAuctionRows();
    destroy(canvas);
    state.auctionRateChart=new Chart(canvas,{type:'line',data:{labels:rows.map(row=>row.auction_date),datasets:[
      {label:'Auction result rate',data:rows.map(row=>row.auction_result_rate_pct),borderWidth:2.2,pointRadius:rows.length<=80?2:0,pointHoverRadius:5,tension:.08,spanGaps:false},
      {label:'Matched par reference',data:rows.map(row=>row.reference_rate_pct),borderWidth:1.8,pointRadius:0,pointHoverRadius:4,tension:.08,spanGaps:false,borderDash:[5,4]},
    ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>` ${ctx.dataset.label}: ${fmtPct(ctx.parsed.y,3)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:10}},y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`${Number(v).toFixed(1)}%`},title:{display:true,text:'Rate / yield',color:'#96a6ba'}}}}});
  }
  function drawAuctionSpread(){
    const canvas=document.getElementById('auctionYieldSpreadChart');
    if(!canvas||!window.Chart) return;
    const rows=visibleAuctionRows();
    destroy(canvas);
    state.auctionSpreadChart=new Chart(canvas,{type:'bar',data:{labels:rows.map(row=>row.auction_date),datasets:[{label:'Auction result − par reference',data:rows.map(row=>row.result_minus_reference_bps),borderWidth:0,borderRadius:1}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>` Result − par: ${fmtBps(ctx.parsed.y)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:10}},y:{grid:{color:ctx=>Number(ctx.tick?.value)===0?'rgba(219,230,244,.30)':'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`${v} bps`},title:{display:true,text:'Context spread',color:'#96a6ba'}}}}});
  }
  function renderAuctionTable(){
    const rows=visibleAuctionRows().slice().reverse().slice(0,20);
    const body=document.getElementById('auctionYieldTable');
    const meta=document.getElementById('auctionYieldTableMeta');
    if(meta) meta.textContent=`Showing ${rows.length} latest auctions inside selected ${state.auctionRange==='ALL'?'history':state.auctionRange}`;
    if(body) body.innerHTML=rows.map(row=>`<tr><td>${esc(prettyDate(row.auction_date))}</td><td>${esc(fmtPct(row.auction_result_rate_pct,3))}</td><td>${esc(fmtPct(row.reference_rate_pct,3))}</td><td>${esc(fmtBps(row.result_minus_reference_bps))}</td><td>${esc(fmtPct(row.coupon_rate_pct,3))}</td><td>${esc(finite(row.bid_to_cover)?num(row.bid_to_cover).toFixed(2):'—')}</td><td>${esc(row.reopening||'—')}</td></tr>`).join('')||'<tr><td colspan="7">No auctions in selected period.</td></tr>';
  }
  function renderAuction(){
    if(!auctionSeries().length) return;
    renderAuctionControls();
    renderAuctionCards();
    drawAuctionRate();
    drawAuctionSpread();
    renderAuctionTable();
    const note=document.getElementById('auctionYieldNote');
    if(note) note.textContent=auctionBlock().note||'';
  }

  function csvCell(value){
    const text=String(value??'');
    return /[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;
  }
  function downloadText(filename,text){
    const blob=new Blob([text],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  function downloadCsv(){
    const realMap=new Map(real().map(r=>[r.date,r]));
    const spreadMap=new Map(spreads().map(r=>[r.date,r]));
    const beMap=new Map(breakeven().map(r=>[r.date,r]));
    const header=['date',...KEY_TENORS.map(k=>`nominal_${k}_pct`),'real_5y_pct','real_7y_pct','real_10y_pct','real_20y_pct','real_30y_pct','spread_10y_2y_bps','spread_10y_3m_bps','spread_30y_10y_bps','breakeven_5y_pct','breakeven_10y_pct','breakeven_30y_pct'];
    const rows=[header];
    nominal().forEach(nrow=>{
      const r=realMap.get(nrow.date)||{}; const s=spreadMap.get(nrow.date)||{}; const b=beMap.get(nrow.date)||{};
      rows.push([nrow.date,...KEY_TENORS.map(k=>nrow[k]??''),r['5y']??'',r['7y']??'',r['10y']??'',r['20y']??'',r['30y']??'',s['10y_2y_bps']??'',s['10y_3m_bps']??'',s['30y_10y_bps']??'',b['5y']??'',b['10y']??'',b['30y']??'']);
    });
    downloadText('treasury-yield-curve-history.csv',rows.map(row=>row.map(csvCell).join(',')).join('\n'));
  }
  function downloadAuctionCsv(){
    const series=selectedAuctionSeries();
    if(!series) return;
    const rows=[['auction_date','series','cusip','security_type','security_term','reopening','auction_result_rate_pct','rate_kind','reference_curve_type','reference_tenor','reference_date','reference_rate_pct','result_minus_reference_bps','coupon_rate_pct','bid_to_cover','offering_billions','accepted_billions']];
    for(const row of series.observations||[]) rows.push([row.auction_date,series.label,row.cusip||'',row.security_type||'',row.security_term||'',row.reopening||'',row.auction_result_rate_pct??'',row.rate_kind||'',row.reference_curve_type||'',row.reference_tenor||'',row.reference_date||'',row.reference_rate_pct??'',row.result_minus_reference_bps??'',row.coupon_rate_pct??'',row.bid_to_cover??'',row.offering_billions??'',row.accepted_billions??'']);
    downloadText(`treasury-auction-yield-${series.key}.csv`,rows.map(row=>row.map(csvCell).join(',')).join('\n'));
  }

  function renderCurveWorkspace(){
    renderRanges();
    renderCards();
    drawCurve();
    drawHistory();
    drawSpreads();
    drawBreakeven();
    drawRefinancingOverlay();
    const note=document.getElementById('yieldCurveNote');
    if(note) note.textContent=block().note||'';
  }

  function init(data){
    state.data=data;
    const panel=document.getElementById('yieldCurvePanel');
    if(!panel) return;
    if(!nominal().length){
      panel.querySelector('.insight-body')?.replaceChildren(Object.assign(document.createElement('div'),{className:'empty-state',textContent:'Treasury yield-curve history is not available yet.'}));
      return;
    }
    ensureExtensions();
    renderCurveWorkspace();
    renderAuction();
    document.getElementById('downloadYieldCurveCsv')?.addEventListener('click',downloadCsv);
  }

  if(window.treasuryData) init(window.treasuryData);
  else window.addEventListener('treasury:data-ready',event=>init(event.detail),{once:true});
})();
