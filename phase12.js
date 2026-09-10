const p12esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p12pct=(v,d=1)=>v==null?'—':`${Number(v).toFixed(d)}%`;
const p12fmtB=v=>v==null?'—':`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
let p12data;
let p12AuctionChart;
const P12_SAVED_KEY='treasuryTrackerSavedComparisonsV1';

function ensurePhase12Scaffold(){
  const eyebrow=document.querySelector('.eyebrow');if(eyebrow) eyebrow.textContent='OFFICIAL-DATA DASHBOARD · PHASE 12';
  const research=document.getElementById('researchBriefPanel');
  if(research&&!document.getElementById('marketStructurePanel')){
    research.insertAdjacentHTML('afterend',`<section class="panel market-structure-panel" id="marketStructurePanel">
      <div class="panel-head"><div><h2>Market Structure Map</h2><p id="marketStructureMeta"></p></div><span class="structure-state" id="marketStructureState"></span></div>
      <div id="marketStructureGrid" class="structure-grid"></div>
      <div class="note inline-note">This map keeps each official dataset on its own observation date. The labels organize current evidence; they are not a synthetic trading signal and no monthly, quarterly or weekly values are added together.</div>
    </section>`);
  }

  const auctionTable=document.getElementById('auctionTable');
  const auctionPanel=auctionTable?.closest('.panel');
  if(auctionPanel&&!document.getElementById('auctionDemandPanel')){
    auctionPanel.insertAdjacentHTML('afterend',`<section class="panel" id="auctionDemandPanel">
      <div class="panel-head"><div><h2>Auction Demand Monitor</h2><p id="auctionDemandMeta"></p></div><select id="auctionDemandTerm"><option value="all">All recent terms</option></select></div>
      <div class="metric-strip metric-four" id="auctionDemandMetrics"></div>
      <div class="grid-2">
        <div class="chart-wrap"><canvas id="auctionDemandChart"></canvas></div>
        <div class="table-wrap table-tall auction-demand-table"><table><thead><tr><th>Date</th><th>Term</th><th>B/C</th><th>Indirect</th><th>Dealer</th><th>Demand score</th><th>Reading</th></tr></thead><tbody id="auctionDemandTable"></tbody></table></div>
      </div>
      <div class="subsection-head"><strong>Recent term baselines</strong><span>Median bidder mix and bid-to-cover in the stored 90-day auction window.</span></div>
      <div class="table-wrap"><table><thead><tr><th>Term</th><th>Auctions</th><th>Median B/C</th><th>Median indirect</th><th>Median dealer</th><th>Median direct</th></tr></thead><tbody id="auctionTermTable"></tbody></table></div>
      <div class="note inline-note">The demand score is a transparent research heuristic: bid-to-cover percentile, indirect-bidder-share percentile and inverse dealer-share percentile. It is not an official Treasury statistic.</div>
    </section>`);
  }

  const compare=document.getElementById('holderComparePanel');
  if(compare&&!document.getElementById('saveComparison')){
    const actions=compare.querySelector('.panel-actions');
    actions?.insertAdjacentHTML('beforeend','<button id="saveComparison" type="button">Save comparison</button>');
  }
  if(compare&&!document.getElementById('savedViewsPanel')){
    compare.insertAdjacentHTML('afterend',`<section class="panel saved-views-panel" id="savedViewsPanel">
      <div class="panel-head"><div><h2>Saved Research Views</h2><p>Comparisons are stored only in this browser, so recurring research pairs can be reopened instantly.</p></div><button id="clearSavedViews" type="button">Clear saved</button></div>
      <div id="savedViewsGrid" class="saved-view-grid"></div>
    </section>`);
  }
}

function structureTarget(key){return ({foreign:'flowIntelligencePanel',domestic:'flowIntelligencePanel',dealer_breadth:'flowIntelligencePanel',auction_demand:'auctionDemandPanel',soma_concentration:'concentrationPanel',alerts:'alertIntelPanel',freshness:'releaseCalendarPanel',dealer_position:'dealerTable'})[key]||'overviewCards';}
function renderMarketStructure(){
  const block=p12data?.market_structure_map||{},dims=block.dimensions||[];
  const meta=document.getElementById('marketStructureMeta');if(meta) meta.textContent=block.note||'';
  const state=document.getElementById('marketStructureState');if(state){state.textContent=block.overall_state||'—';state.className=`structure-state ${String(block.overall_state||'mixed').replaceAll(' ','-')}`;}
  const grid=document.getElementById('marketStructureGrid');
  if(grid) grid.innerHTML=dims.map(row=>`<button type="button" class="structure-card ${p12esc(row.state||'unknown')}" data-structure-target="${p12esc(structureTarget(row.key))}"><div class="structure-card-top"><span>${p12esc(row.label||row.key)}</span><span class="structure-dot"></span></div><strong>${p12esc(row.display||'—')}</strong><em>${p12esc(row.reading||'')}</em><p>${p12esc(row.detail||'')}</p><small>${row.observation?`Observation ${p12esc(row.observation)}`:'Observation —'}</small></button>`).join('');
  grid?.querySelectorAll('.structure-card').forEach(btn=>btn.addEventListener('click',()=>document.getElementById(btn.dataset.structureTarget)?.scrollIntoView({behavior:'smooth',block:'start'})));
}

function demandBadge(label){return `<span class="demand-badge ${p12esc(label||'insufficient-data')}">${p12esc(label||'—')}</span>`;}
function renderAuctionDemand(){
  const block=p12data?.auction_demand_monitor||{},all=block.recent||[];
  const meta=document.getElementById('auctionDemandMeta');if(meta) meta.textContent=`As of ${block.as_of||'—'} · ${block.method||''}`;
  const select=document.getElementById('auctionDemandTerm');
  if(select&&select.options.length<=1){
    const terms=[...new Set(all.map(r=>r.security_term).filter(Boolean))].sort();
    select.insertAdjacentHTML('beforeend',terms.map(t=>`<option value="${p12esc(t)}">${p12esc(t)}</option>`).join(''));
  }
  const draw=()=>{
    const term=select?.value||'all',rows=term==='all'?all:all.filter(r=>r.security_term===term),latest=rows[0]||{};
    const metrics=document.getElementById('auctionDemandMetrics');
    if(metrics) metrics.innerHTML=[['Latest demand',latest.demand_score==null?'—':`${Number(latest.demand_score).toFixed(0)}/100`],['Bid-to-cover',latest.bid_to_cover==null?'—':Number(latest.bid_to_cover).toFixed(2)],['Indirect share',p12pct(latest.indirect_share_pct)],['Dealer share',p12pct(latest.dealer_share_pct)]].map(([k,v])=>`<div class="mini"><span>${p12esc(k)}</span><strong>${p12esc(v)}</strong></div>`).join('');
    const table=document.getElementById('auctionDemandTable');
    if(table) table.innerHTML=rows.map(r=>`<tr><td>${p12esc(r.auction_date||'—')}</td><td>${p12esc(r.security_term||'—')}</td><td>${r.bid_to_cover==null?'—':Number(r.bid_to_cover).toFixed(2)}</td><td>${p12pct(r.indirect_share_pct)}</td><td>${p12pct(r.dealer_share_pct)}</td><td>${r.demand_score==null?'—':Number(r.demand_score).toFixed(0)}</td><td>${demandBadge(r.demand_label)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty-cell">No auctions match this term.</td></tr>';
    const chronological=rows.slice().reverse();const canvas=document.getElementById('auctionDemandChart');
    if(canvas&&window.Chart){if(p12AuctionChart)p12AuctionChart.destroy();p12AuctionChart=new Chart(canvas,{type:'line',data:{labels:chronological.map(r=>`${r.auction_date} ${r.security_term||''}`),datasets:[{label:'Demand score',data:chronological.map(r=>r.demand_score),tension:.2},{label:'Balanced 50',data:chronological.map(()=>50),borderDash:[5,5],pointRadius:0}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},scales:{y:{min:0,max:100,ticks:{callback:v=>v}}}}});}
  };
  if(select) select.onchange=draw;draw();
  const termTable=document.getElementById('auctionTermTable');
  if(termTable) termTable.innerHTML=(block.term_stats||[]).map(r=>`<tr><td>${p12esc(r.security_term)}</td><td>${p12esc(r.auction_count)}</td><td>${r.median_bid_to_cover==null?'—':Number(r.median_bid_to_cover).toFixed(2)}</td><td>${p12pct(r.median_indirect_share_pct)}</td><td>${p12pct(r.median_dealer_share_pct)}</td><td>${p12pct(r.median_direct_share_pct)}</td></tr>`).join('');
}

function loadSavedViews(){try{const value=JSON.parse(localStorage.getItem(P12_SAVED_KEY)||'[]');return Array.isArray(value)?value:[];}catch{return [];}}
function storeSavedViews(rows){try{localStorage.setItem(P12_SAVED_KEY,JSON.stringify(rows.slice(0,20)));}catch{}}
function currentComparisonView(){
  const scope=document.getElementById('compareScope')?.value,a=document.getElementById('compareA')?.value,b=document.getElementById('compareB')?.value;
  if(!scope||!a||!b||a===b) return null;
  const pa=(p12data?.holder_profiles?.profiles||[]).find(p=>p.profile_id===a),pb=(p12data?.holder_profiles?.profiles||[]).find(p=>p.profile_id===b);
  if(!pa||!pb) return null;
  return {id:`${scope}|${a}|${b}`,scope,a,b,aName:pa.name,bName:pb.name,savedAt:new Date().toISOString()};
}
function saveCurrentComparison(){
  const view=currentComparisonView();if(!view)return;
  let rows=loadSavedViews().filter(r=>r.id!==view.id);rows.unshift(view);storeSavedViews(rows);renderSavedViews();
  const btn=document.getElementById('saveComparison');if(btn){const old=btn.textContent;btn.textContent='Saved';setTimeout(()=>btn.textContent=old,900);}
}
function renderSavedViews(){
  const grid=document.getElementById('savedViewsGrid'),rows=loadSavedViews();if(!grid)return;
  grid.innerHTML=rows.length?rows.map((r,i)=>`<article class="saved-view-card"><div><span>${p12esc(r.scope)}</span><strong>${p12esc(r.aName)} <em>vs</em> ${p12esc(r.bName)}</strong><small>Saved ${p12esc(new Date(r.savedAt).toLocaleString())}</small></div><div class="saved-view-actions"><button type="button" data-open-saved="${i}">Open</button><button type="button" data-delete-saved="${i}">×</button></div></article>`).join(''):'<div class="empty-state saved-empty">Save a holder comparison and it will appear here on this browser.</div>';
  grid.querySelectorAll('[data-open-saved]').forEach(btn=>btn.addEventListener('click',()=>{const r=loadSavedViews()[Number(btn.dataset.openSaved)];if(r&&typeof selectComparisonPair==='function')selectComparisonPair(r.a,r.b,r.scope);}));
  grid.querySelectorAll('[data-delete-saved]').forEach(btn=>btn.addEventListener('click',()=>{const rows=loadSavedViews();rows.splice(Number(btn.dataset.deleteSaved),1);storeSavedViews(rows);renderSavedViews();}));
}
function wireSavedViews(){
  document.getElementById('saveComparison')?.addEventListener('click',saveCurrentComparison);
  document.getElementById('clearSavedViews')?.addEventListener('click',()=>{storeSavedViews([]);renderSavedViews();});
  renderSavedViews();
}

async function loadPhase12(){
  ensurePhase12Scaffold();
  const r=await fetch(`data/dashboard.json?v=${Date.now()}`);if(!r.ok)throw new Error(`dashboard.json ${r.status}`);p12data=await r.json();
  ensurePhase12Scaffold();renderMarketStructure();renderAuctionDemand();wireSavedViews();
}
loadPhase12().catch(err=>console.error('Phase 12 UI error',err));
