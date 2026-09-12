(() => {
  const state = {data:null, auctionRange:'90D', auctionChart:null, fundingTgaChart:null};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = value => Number(value);
  const finite = value => Number.isFinite(Number(value));
  const fmtB = value => {
    const n = num(value);
    if(!Number.isFinite(n)) return '—';
    return Math.abs(n) >= 1000 ? `$${(n/1000).toFixed(2)}T` : `$${n.toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  };
  const fmtPct = (value,digits=1) => finite(value) ? `${num(value).toFixed(digits)}%` : '—';
  const signedPp = value => {
    const n=num(value);
    if(!Number.isFinite(n)) return '—';
    return `${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(3)} pp`;
  };
  const signedB = value => {
    const n=num(value);
    if(!Number.isFinite(n)) return '—';
    return `${n>0?'+':n<0?'−':''}$${Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  };
  const dayMs = value => {
    const t = new Date(`${String(value||'').slice(0,10)}T00:00:00Z`).getTime();
    return Number.isFinite(t) ? t : null;
  };
  const prettyDate = value => {
    const t=dayMs(value);
    return t==null ? String(value||'—') : new Date(t).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
  };
  const addDays = (value,days) => {
    const d=new Date(`${String(value).slice(0,10)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate()+days);
    return d.toISOString().slice(0,10);
  };
  const median = values => {
    const rows=values.map(num).filter(Number.isFinite).sort((a,b)=>a-b);
    if(!rows.length) return null;
    const mid=Math.floor(rows.length/2);
    return rows.length%2 ? rows[mid] : (rows[mid-1]+rows[mid])/2;
  };
  const average = values => {
    const rows=values.map(num).filter(Number.isFinite);
    return rows.length ? rows.reduce((a,b)=>a+b,0)/rows.length : null;
  };
  function destroyCanvas(canvas){
    if(!canvas || !window.Chart) return;
    const existing=Chart.getChart(canvas);
    if(existing) existing.destroy();
  }
  function filterYears(rows,range,dateKey='date'){
    const sorted=(rows||[]).slice().sort((a,b)=>String(a[dateKey]).localeCompare(String(b[dateKey])));
    if(range==='ALL'||!sorted.length) return sorted;
    const years=Number(String(range).replace('Y',''));
    const latest=dayMs(sorted.at(-1)?.[dateKey]);
    if(!Number.isFinite(years)||latest==null) return sorted;
    const cutoff=new Date(latest);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear()-years);
    return sorted.filter(row=>(dayMs(row[dateKey])??-Infinity)>=cutoff.getTime());
  }
  function filterDays(rows,days,dateKey='auction_date'){
    const sorted=(rows||[]).slice().filter(row=>row?.[dateKey]).sort((a,b)=>String(a[dateKey]).localeCompare(String(b[dateKey])));
    if(!sorted.length) return sorted;
    const latest=dayMs(sorted.at(-1)[dateKey]);
    if(latest==null) return sorted;
    const cutoff=latest-days*86400000;
    return sorted.filter(row=>(dayMs(row[dateKey])??-Infinity)>=cutoff);
  }

  function auctionBlock(){ return state.data?.auction_demand_monitor || {}; }
  function ensureAuctionControls(){
    const body=document.querySelector('#auctionDemandPanel .insight-body');
    const chart=document.getElementById('auctionDemandChart')?.closest('.chart-wrap');
    if(!body||!chart) return null;
    let toolbar=document.getElementById('auctionDemandToolbar');
    if(!toolbar){
      toolbar=document.createElement('div');
      toolbar.className='insight-toolbar';
      toolbar.id='auctionDemandToolbar';
      toolbar.innerHTML='<div class="insight-range" id="auctionDemandRanges"></div>';
      chart.insertAdjacentElement('beforebegin',toolbar);
    }
    return document.getElementById('auctionDemandRanges');
  }
  function renderAuctionRanges(){
    const host=ensureAuctionControls();
    if(!host) return;
    host.innerHTML=['30D','60D','90D'].map(range=>`<button type="button" data-auction-range="${range}" class="${range===state.auctionRange?'active':''}">${range}</button>`).join('');
  }
  function auctionRows(){
    const rows=auctionBlock().history?.length ? auctionBlock().history : auctionBlock().recent || [];
    const days=Number(state.auctionRange.replace('D',''))||90;
    return filterDays(rows,days,'auction_date');
  }
  function renderAuction(){
    renderAuctionRanges();
    const rows=auctionRows();
    const latest=rows.at(-1)||{};
    const cards=document.getElementById('auctionDemandCards');
    if(cards){
      const metrics=[
        ['Latest demand',finite(latest.demand_score)?`${num(latest.demand_score).toFixed(0)}/100`:'—',String(latest.demand_label||'—').replace(/\b\w/g,c=>c.toUpperCase())],
        ['Median demand',finite(median(rows.map(r=>r.demand_score)))?`${median(rows.map(r=>r.demand_score)).toFixed(0)}/100`:'—',state.auctionRange],
        ['Median bid/cover',finite(median(rows.map(r=>r.bid_to_cover)))?median(rows.map(r=>r.bid_to_cover)).toFixed(2):'—',`${rows.length} auctions`],
        ['Avg indirect bidders',fmtPct(average(rows.map(r=>r.indirect_share_pct)),1),'Selected period'],
        ['Avg primary dealers',fmtPct(average(rows.map(r=>r.dealer_share_pct)),1),'Selected period'],
      ];
      cards.innerHTML=metrics.map(([label,value,meta])=>`<div class="insight-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`).join('');
    }
    const meta=document.getElementById('auctionDemandMeta');
    if(meta) meta.textContent=rows.length ? `${state.auctionRange} · ${rows.length} auctions · ${prettyDate(rows[0].auction_date)} → ${prettyDate(rows.at(-1).auction_date)}` : `${state.auctionRange} · no auctions in range`;

    const canvas=document.getElementById('auctionDemandChart');
    if(canvas&&window.Chart){
      destroyCanvas(canvas);
      state.auctionChart=new Chart(canvas,{
        type:'line',
        data:{labels:rows.map(r=>r.auction_date),datasets:[{label:'Demand score',data:rows.map(r=>r.demand_score),borderWidth:2,pointRadius:rows.length<=50?2:0,pointHoverRadius:5,tension:.14,spanGaps:true}]},
        options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>{const row=rows[ctx.dataIndex]||{};return ` ${row.security_term||'Treasury'}: ${finite(row.demand_score)?num(row.demand_score).toFixed(0):'—'}/100 · ${row.demand_label||'—'}`;},afterBody:items=>{const row=rows[items?.[0]?.dataIndex]||{};return [`Bid/cover ${finite(row.bid_to_cover)?num(row.bid_to_cover).toFixed(2):'—'}`,`Indirect ${fmtPct(row.indirect_share_pct,1)} · Dealers ${fmtPct(row.dealer_share_pct,1)}`];}}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:10}},y:{min:0,max:100,grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba'},title:{display:true,text:'Demand score (0–100)',color:'#96a6ba'}}}}
      });
    }
    const table=document.getElementById('auctionDemandTable');
    if(table){
      table.innerHTML=rows.slice().reverse().slice(0,15).map(row=>`<tr><td>${esc(prettyDate(row.auction_date))}</td><td>${esc(row.security_term||'—')}</td><td>${esc(finite(row.bid_to_cover)?num(row.bid_to_cover).toFixed(2):'—')}</td><td>${esc(fmtPct(row.indirect_share_pct,1))}</td><td>${esc(fmtPct(row.dealer_share_pct,1))}</td><td>${esc(finite(row.demand_score)?`${num(row.demand_score).toFixed(0)} · ${row.demand_label||'—'}`:'—')}</td></tr>`).join('') || '<tr><td colspan="6">No auction-demand data in selected period.</td></tr>';
    }
  }

  function syncFunding(range){
    const block=state.data?.treasury_funding_pressure||{};
    if(!block.as_of) return;
    const days=({'30D':30,'90D':90,'1Y':365})[range]||90;
    const tga=block.tga||{};
    const history=(tga.history||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const anchor=dayMs(history.at(-1)?.date);
    const visible=anchor==null?history:history.filter(row=>(dayMs(row.date)??-Infinity)>=anchor-days*86400000);
    const canvas=document.getElementById('fundingTgaChart');
    if(canvas&&window.Chart){
      destroyCanvas(canvas);
      state.fundingTgaChart=new Chart(canvas,{type:'line',data:{labels:visible.map(r=>r.date),datasets:[{label:'TGA closing balance',data:visible.map(r=>r.balance_billions),borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:.15,fill:false}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>` ${fmtB(ctx.parsed.y)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:9}},y:{beginAtZero:false,grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:v=>fmtB(v)}}}}});
    }
    const tgaSub=canvas?.closest('.funding-subpanel')?.querySelector('.funding-subhead p');
    if(tgaSub) tgaSub.textContent=`${range} historical lookback · business-daily TGA closing balance.`;

    const end=addDays(block.as_of,days);
    const auctionRows=(block.auctions?.rows||[]).filter(row=>row.issue_date>=block.as_of&&row.issue_date<=end).sort((a,b)=>String(a.issue_date).localeCompare(String(b.issue_date)));
    const auctionMeta=document.getElementById('fundingAuctionMeta');
    const auctionBody=document.getElementById('fundingAuctionTable');
    if(auctionMeta) auctionMeta.textContent=`${auctionRows.length} announced settlements inside selected ${range} horizon`;
    if(auctionBody) auctionBody.innerHTML=auctionRows.length?auctionRows.slice(0,24).map(row=>`<tr><td>${esc(prettyDate(row.issue_date))}</td><td>${esc(prettyDate(row.auction_date))}</td><td>${esc(row.security_type||'—')}</td><td>${esc(row.security_term||'—')}</td><td>${esc(fmtB(row.offering_billions))}</td></tr>`).join(''):'<tr><td colspan="5">No announced auction settlements in selected horizon.</td></tr>';

    const buybackRows=(block.buybacks?.upcoming||[]).filter(row=>{const day=row.settlement_date||row.operation_date;return day>=block.as_of&&day<=end;}).sort((a,b)=>String(a.operation_date).localeCompare(String(b.operation_date)));
    const buybackMeta=document.getElementById('fundingBuybackMeta');
    const buybackBody=document.getElementById('fundingBuybackTable');
    if(buybackMeta) buybackMeta.textContent=`${buybackRows.length} tentative operations inside selected ${range} horizon · maximum caps`;
    if(buybackBody) buybackBody.innerHTML=buybackRows.length?buybackRows.map(row=>`<tr><td>${esc(prettyDate(row.operation_date))}</td><td>${esc(prettyDate(row.settlement_date))}</td><td>${esc(row.operation_type||'—')}</td><td>${esc(row.maturity_bucket||row.security_type||'—')}</td><td>${esc(fmtB(row.max_purchase_billions))}</td></tr>`).join(''):'<tr><td colspan="5">No tentative buybacks in selected horizon.</td></tr>';
  }

  function activeDebtRange(){ return document.querySelector('[data-debt-range].active')?.dataset.debtRange || '10Y'; }
  function syncDebt(){
    const block=state.data?.treasury_debt_cost||{};
    const key=document.getElementById('debtCostRateSeries')?.value;
    const rate=(block.average_rates?.series||[]).find(row=>row.key===key)||(block.average_rates?.series||[])[0];
    if(!rate) return;
    const range=activeDebtRange();
    const rateRows=filterYears(rate.observations||[],range);
    const expenseRows=filterYears(block.interest_expense?.observations||[],range);
    const firstRate=rateRows[0], lastRate=rateRows.at(-1);
    const rateChange=firstRate&&lastRate?num(lastRate.rate_pct)-num(firstRate.rate_pct):null;
    const periodExpense=expenseRows.reduce((sum,row)=>sum+(finite(row.expense_billions)?num(row.expense_billions):0),0);
    const avgExpense=expenseRows.length?periodExpense/expenseRows.length:null;
    const cards=document.getElementById('debtCostCards');
    if(cards){
      const values=[
        [`${rate.label} rate`,fmtPct(lastRate?.rate_pct,3),`Latest in ${range==='ALL'?'visible history':range}`],
        ['Rate change',signedPp(rateChange),range==='ALL'?'All visible history':range],
        ['Interest expense in range',fmtB(periodExpense),`${expenseRows.length} monthly observations`],
        ['Avg monthly interest',fmtB(avgExpense),range==='ALL'?'All visible history':range],
        ['Avg remaining maturity',finite(block.weighted_average_remaining_maturity_years)?`${num(block.weighted_average_remaining_maturity_years).toFixed(2)}Y`:'—','Current MSPD snapshot'],
        ['Next 12M modeled interest',fmtB(block.next_12m_modeled_marketable_interest_billions),'Forward marketable cash-flow model'],
      ];
      cards.innerHTML=values.map(([label,value,meta])=>`<div class="insight-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`).join('');
    }
    const meta=document.getElementById('debtCostMeta');
    if(meta) meta.textContent=`${range==='ALL'?'All history':range} selected · rate ${prettyDate(firstRate?.date)} → ${prettyDate(lastRate?.date)} · expense ${prettyDate(expenseRows[0]?.date)} → ${prettyDate(expenseRows.at(-1)?.date)}`;
  }

  function countryHistory(row,range){
    const monthly=(row?.history||[]).filter(item=>item?.period&&finite(item?.holdings_billions)).map(item=>({period:String(item.period),value:num(item.holdings_billions)})).sort((a,b)=>a.period.localeCompare(b.period));
    if(range!=='ALL'){
      const count=({'1Y':13,'3Y':37,'5Y':61,'10Y':121})[range]||121;
      return monthly.slice(-count);
    }
    const start=monthly[0]?.period||'9999-99';
    const annual=(row?.annual_survey_history||[]).filter(item=>item?.period&&finite(item?.treasury_billions)&&String(item.period)<start).map(item=>({period:String(item.period),value:num(item.treasury_billions)}));
    return [...annual,...monthly].sort((a,b)=>a.period.localeCompare(b.period));
  }
  function syncCountry(attempt=0){
    const select=document.getElementById('trendCountry');
    const active=document.querySelector('[data-country-archive-range].active');
    if((!select||!active)&&attempt<20){ setTimeout(()=>syncCountry(attempt+1),150); return; }
    if(!select||!active) return;
    const row=(state.data?.foreign_holders?.countries||[]).find(item=>item.name===select.value)||(state.data?.foreign_holders?.countries||[])[0];
    if(!row) return;
    const range=active.dataset.countryArchiveRange;
    const rows=countryHistory(row,range);
    const first=rows[0],last=rows.at(-1);
    const change=first&&last?last.value-first.value:null;
    const meta=document.getElementById('foreignTrendMeta');
    if(meta) meta.textContent=`${row.name} · ${range==='ALL'?'All history':range} · ${fmtB(last?.value)} · change ${signedB(change)} · ${rows.length} observations · ${first?.period||'—'} → ${last?.period||'—'}`;
  }

  function initialSync(){
    renderAuction();
    const fundingRange=document.querySelector('[data-funding-range].active')?.dataset.fundingRange||'90D';
    syncFunding(fundingRange);
    syncDebt();
    syncCountry();
  }

  function init(data){
    state.data=data;
    setTimeout(initialSync,0);
    document.addEventListener('click',event=>{
      const auction=event.target.closest?.('[data-auction-range]');
      if(auction){ state.auctionRange=auction.dataset.auctionRange; renderAuction(); return; }
      const funding=event.target.closest?.('[data-funding-range]');
      if(funding) setTimeout(()=>syncFunding(funding.dataset.fundingRange),0);
      if(event.target.closest?.('[data-debt-range]')) setTimeout(syncDebt,0);
      if(event.target.closest?.('[data-country-archive-range]')) setTimeout(()=>syncCountry(),0);
    });
    document.addEventListener('change',event=>{
      if(event.target?.id==='debtCostRateSeries') setTimeout(syncDebt,0);
      if(event.target?.id==='trendCountry') setTimeout(()=>syncCountry(),0);
    });
  }

  if(window.treasuryData) init(window.treasuryData);
  else window.addEventListener('treasury:data-ready',event=>init(event.detail),{once:true});
})();
