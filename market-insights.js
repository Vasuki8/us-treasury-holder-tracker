(() => {
  const state = {
    data: null,
    ownershipKey: 'foreign_total',
    ownershipRange: 'ALL',
    debtRateKey: 'total_marketable',
    debtRange: '10Y',
    auctionChart: null,
    ownershipChart: null,
    rateChart: null,
    expenseChart: null,
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n = value => Number(value);
  const finite = value => Number.isFinite(Number(value));
  const fmtB = value => {
    const v = n(value);
    if(!Number.isFinite(v)) return '—';
    return Math.abs(v) >= 1000 ? `$${(v/1000).toFixed(2)}T` : `$${v.toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  };
  const fmtPct = (value, digits=2) => finite(value) ? `${n(value).toFixed(digits)}%` : '—';
  const signedPp = value => {
    const v = n(value);
    if(!Number.isFinite(v)) return '—';
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(2)} pp`;
  };
  const signedB = value => {
    const v=n(value);
    if(!Number.isFinite(v)) return '—';
    const sign=v>0?'+':'';
    return `${sign}${fmtB(v)}`;
  };
  const prettyDate = value => {
    if(!value) return '—';
    const d = new Date(`${String(value).slice(0,10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  };
  const dateMs = value => {
    const d = new Date(`${String(value).slice(0,10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  };
  function filterYears(rows, range){
    const sorted=(rows||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    if(range==='ALL'||!sorted.length) return sorted;
    const years=Number(range.replace('Y',''));
    const latest=dateMs(sorted[sorted.length-1].date);
    if(!Number.isFinite(years)||latest==null) return sorted;
    const cutoff=new Date(latest);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear()-years);
    return sorted.filter(row=>dateMs(row.date)>=cutoff.getTime());
  }
  function destroy(chart, canvas){
    if(chart) chart.destroy();
    if(canvas && window.Chart){
      const existing=Chart.getChart(canvas);
      if(existing) existing.destroy();
    }
  }

  function auctionBlock(){ return state.data?.auction_demand_monitor || {}; }
  function renderAuctionDemand(){
    const block=auctionBlock();
    const latest=block.latest||{};
    const cards=document.getElementById('auctionDemandCards');
    if(cards){
      const rows=[
        ['Demand score', finite(latest.demand_score)?`${n(latest.demand_score).toFixed(0)}/100`:'—', String(latest.demand_label||'insufficient data').replace(/\b\w/g,c=>c.toUpperCase())],
        ['Bid-to-cover', finite(latest.bid_to_cover)?n(latest.bid_to_cover).toFixed(2):'—', latest.security_term||'Latest auction'],
        ['Indirect bidders', fmtPct(latest.indirect_share_pct,1), 'Accepted share'],
        ['Primary dealers', fmtPct(latest.dealer_share_pct,1), 'Accepted share'],
      ];
      cards.innerHTML=rows.map(([label,value,meta])=>`<div class="insight-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`).join('');
    }
    const meta=document.getElementById('auctionDemandMeta');
    if(meta) meta.textContent=`Latest ${latest.security_term||'Treasury'} auction ${prettyDate(latest.auction_date)} · ${block.auction_count||0} recent observations`;

    const recent=(block.recent||[]).slice().sort((a,b)=>String(a.auction_date).localeCompare(String(b.auction_date)));
    const canvas=document.getElementById('auctionDemandChart');
    if(canvas&&window.Chart){
      destroy(state.auctionChart,canvas);
      state.auctionChart=new Chart(canvas,{
        type:'line',
        data:{labels:recent.map(row=>row.auction_date),datasets:[{label:'Demand score',data:recent.map(row=>row.demand_score),borderWidth:2,pointRadius:2,pointHoverRadius:5,tension:.14,spanGaps:true}]},
        options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>{const row=recent[ctx.dataIndex]||{};return ` ${row.security_term||'Treasury'}: ${finite(row.demand_score)?n(row.demand_score).toFixed(0):'—'}/100 · ${row.demand_label||'—'}`;},afterBody:items=>{const row=recent[items?.[0]?.dataIndex]||{};return [`Bid/cover ${finite(row.bid_to_cover)?n(row.bid_to_cover).toFixed(2):'—'}`,`Indirect ${fmtPct(row.indirect_share_pct,1)} · Dealers ${fmtPct(row.dealer_share_pct,1)}`];}}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:10,callback:(value,index)=>{const raw=recent[index]?.auction_date;return raw?new Date(`${raw}T00:00:00Z`).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';}}},y:{min:0,max:100,grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`${v}`},title:{display:true,text:'Demand score (0–100)',color:'#96a6ba'}}}}
      });
    }

    const body=document.getElementById('auctionDemandTable');
    if(body){
      body.innerHTML=(block.recent||[]).slice(0,15).map(row=>`<tr><td>${esc(prettyDate(row.auction_date))}</td><td>${esc(row.security_term||'—')}</td><td>${esc(finite(row.bid_to_cover)?n(row.bid_to_cover).toFixed(2):'—')}</td><td>${esc(fmtPct(row.indirect_share_pct,1))}</td><td>${esc(fmtPct(row.dealer_share_pct,1))}</td><td>${esc(finite(row.demand_score)?`${n(row.demand_score).toFixed(0)} · ${row.demand_label||'—'}`:'—')}</td></tr>`).join('') || '<tr><td colspan="6">No recent auction-demand data.</td></tr>';
    }
  }

  function ownershipBlock(){ return state.data?.ownership_share_history || {}; }
  function ownershipSeries(){ return ownershipBlock().series || []; }
  function selectedOwnership(){ return ownershipSeries().find(row=>row.key===state.ownershipKey)||ownershipSeries()[0]; }
  function renderOwnershipRanges(){
    const host=document.getElementById('ownershipShareRanges');
    if(!host) return;
    const ranges=['1Y','3Y','5Y','10Y','ALL'];
    host.innerHTML=ranges.map(range=>`<button type="button" data-own-range="${range}" class="${range===state.ownershipRange?'active':''}">${range==='ALL'?'All':range}</button>`).join('');
    host.querySelectorAll('[data-own-range]').forEach(button=>button.addEventListener('click',()=>{state.ownershipRange=button.dataset.ownRange;renderOwnershipRanges();drawOwnership();}));
  }
  function populateOwnership(){
    const select=document.getElementById('ownershipShareSeries');
    if(!select) return;
    select.innerHTML=ownershipSeries().map(row=>`<option value="${esc(row.key)}">${esc(row.label)}</option>`).join('');
    if(ownershipSeries().some(row=>row.key===state.ownershipKey)) select.value=state.ownershipKey; else if(ownershipSeries()[0]) state.ownershipKey=ownershipSeries()[0].key;
    select.onchange=()=>{state.ownershipKey=select.value;state.ownershipRange='ALL';renderOwnershipRanges();drawOwnership();};
  }
  function drawOwnership(){
    const row=selectedOwnership();
    if(!row) return;
    const rows=filterYears(row.observations||[],state.ownershipRange);
    const first=rows[0], last=rows[rows.length-1];
    const cards=document.getElementById('ownershipShareCards');
    const change=first&&last?n(last.share_pct)-n(first.share_pct):null;
    if(cards) cards.innerHTML=[
      ['Current holdings',fmtB(last?.holdings_billions),`As of ${prettyDate(last?.date)}`],
      ['Share of public debt',fmtPct(last?.share_pct,2),`Denominator ${prettyDate(last?.denominator_date)}`],
      ['Selected-period change',signedPp(change),state.ownershipRange==='ALL'?'All visible history':state.ownershipRange],
    ].map(([label,value,meta])=>`<div class="insight-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`).join('');
    const meta=document.getElementById('ownershipShareMeta');
    if(meta) meta.textContent=`${row.label} · ${row.frequency||'source cadence'} · history from ${row.history_start||'—'}`;
    const note=document.getElementById('ownershipShareNote');
    if(note) note.textContent=ownershipBlock().note||'';

    const canvas=document.getElementById('ownershipShareChart');
    if(!canvas||!window.Chart) return;
    destroy(state.ownershipChart,canvas);
    state.ownershipChart=new Chart(canvas,{
      type:'line',
      data:{labels:rows.map(item=>item.date),datasets:[{label:`${row.label} · % of debt held by public`,data:rows.map(item=>item.share_pct),borderWidth:2,pointRadius:rows.length<=35?2:0,pointHoverRadius:5,tension:.14,spanGaps:true}]},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>{const item=rows[ctx.dataIndex]||{};return ` Share: ${fmtPct(item.share_pct,2)}`;},afterLabel:ctx=>{const item=rows[ctx.dataIndex]||{};return ` Holdings: ${fmtB(item.holdings_billions)} · Public debt: ${fmtB(item.debt_held_by_public_billions)}`;}}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:11}},y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`${v}%`},title:{display:true,text:'Share of debt held by public',color:'#96a6ba'}}}}
    });
  }
  function downloadOwnershipCsv(){
    const out=[['holder_key','holder','date','holdings_billions','debt_held_by_public_billions','denominator_date','share_pct']];
    ownershipSeries().forEach(row=>(row.observations||[]).forEach(obs=>out.push([row.key,row.label,obs.date,obs.holdings_billions,obs.debt_held_by_public_billions,obs.denominator_date,obs.share_pct])));
    downloadRows(out,'treasury-ownership-share-history.csv');
  }

  function debtBlock(){ return state.data?.treasury_debt_cost || {}; }
  function rateSeries(){ return debtBlock().average_rates?.series || []; }
  function selectedRate(){ return rateSeries().find(row=>row.key===state.debtRateKey)||rateSeries()[0]; }
  function renderDebtRanges(){
    const host=document.getElementById('debtCostRanges');
    if(!host) return;
    const ranges=['1Y','3Y','5Y','10Y','ALL'];
    host.innerHTML=ranges.map(range=>`<button type="button" data-debt-range="${range}" class="${range===state.debtRange?'active':''}">${range==='ALL'?'All':range}</button>`).join('');
    host.querySelectorAll('[data-debt-range]').forEach(button=>button.addEventListener('click',()=>{state.debtRange=button.dataset.debtRange;renderDebtRanges();drawDebtCharts();}));
  }
  function populateRates(){
    const select=document.getElementById('debtCostRateSeries');
    if(!select) return;
    select.innerHTML=rateSeries().map(row=>`<option value="${esc(row.key)}">${esc(row.label)}</option>`).join('');
    if(rateSeries().some(row=>row.key===state.debtRateKey)) select.value=state.debtRateKey; else if(rateSeries()[0]) state.debtRateKey=rateSeries()[0].key;
    select.onchange=()=>{state.debtRateKey=select.value;drawDebtCharts();};
  }
  function renderDebtCards(){
    const block=debtBlock();
    const expense=block.interest_expense||{};
    const host=document.getElementById('debtCostCards');
    if(!host) return;
    const cards=[
      ['Avg marketable rate',fmtPct(block.average_marketable_rate_pct,3),`Official · ${block.average_rates?.as_of||'—'}`],
      ['TTM interest expense',fmtB(block.trailing_12m_interest_expense_billions),`Actual through ${expense.as_of||'—'}`],
      ['Interest / GDP',fmtPct(block.interest_expense_to_gdp_pct,2),'TTM expense / latest nominal GDP'],
      ['Avg remaining maturity',finite(block.weighted_average_remaining_maturity_years)?`${n(block.weighted_average_remaining_maturity_years).toFixed(2)}Y`:'—','Current marketable MSPD snapshot'],
      ['Next 12M modeled interest',fmtB(block.next_12m_modeled_marketable_interest_billions),'Marketable security cash-flow model'],
    ];
    host.innerHTML=cards.map(([label,value,meta])=>`<div class="insight-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`).join('');
    const meta=document.getElementById('debtCostMeta');
    if(meta) meta.textContent=`Average rates ${block.average_rates?.as_of||'—'} · interest expense ${expense.as_of||'—'} · FY${expense.fiscal_year||'—'} YTD ${fmtB(expense.fiscal_year_to_date_billions)}`;
    const note=document.getElementById('debtCostNote');
    if(note) note.textContent=block.note||'';
  }
  function drawDebtCharts(){
    const rate=selectedRate();
    const rateRows=filterYears(rate?.observations||[],state.debtRange);
    const expenseRows=filterYears(debtBlock().interest_expense?.observations||[],state.debtRange);
    const rateCanvas=document.getElementById('debtRateChart');
    if(rateCanvas&&window.Chart&&rate){
      destroy(state.rateChart,rateCanvas);
      state.rateChart=new Chart(rateCanvas,{type:'line',data:{labels:rateRows.map(r=>r.date),datasets:[{label:`${rate.label} average rate`,data:rateRows.map(r=>r.rate_pct),borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:.12}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>` ${fmtPct(ctx.parsed.y,3)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:10}},y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>`${v}%`},title:{display:true,text:'Average interest rate',color:'#96a6ba'}}}}});
    }
    const expenseCanvas=document.getElementById('debtExpenseChart');
    if(expenseCanvas&&window.Chart){
      destroy(state.expenseChart,expenseCanvas);
      state.expenseChart=new Chart(expenseCanvas,{type:'bar',data:{labels:expenseRows.map(r=>r.date),datasets:[{label:'Monthly net interest expense',data:expenseRows.map(r=>r.expense_billions),borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>` ${fmtB(ctx.parsed.y)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:10}},y:{beginAtZero:true,grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>fmtB(v)},title:{display:true,text:'Monthly interest expense',color:'#96a6ba'}}}}});
    }
  }

  function csvCell(value){ const text=String(value??''); return /[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text; }
  function downloadRows(rows,name){
    const blob=new Blob([rows.map(row=>row.map(csvCell).join(',')).join('\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }

  function init(data){
    state.data=data;
    renderAuctionDemand();
    populateOwnership(); renderOwnershipRanges(); drawOwnership();
    populateRates(); renderDebtRanges(); renderDebtCards(); drawDebtCharts();
    document.getElementById('downloadOwnershipShareCsv')?.addEventListener('click',downloadOwnershipCsv);
  }

  if(window.treasuryData) init(window.treasuryData);
  else window.addEventListener('treasury:data-ready',event=>init(event.detail),{once:true});
})();
