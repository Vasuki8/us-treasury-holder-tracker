const p4fmtB = v => v == null ? '—' : `$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
const p4fmtPct = v => v == null ? '—' : `${Number(v).toFixed(1)}%`;
const p4signedB = v => v == null ? '—' : `${Number(v)>=0?'+':''}${Number(v).toFixed(1)}B`;
const p4esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p4charts = {};
let p4data;

async function loadPhase4(){
  const r=await fetch(`data/dashboard.json?v=${Date.now()}`);
  if(!r.ok) throw new Error(`dashboard.json ${r.status}`);
  p4data=await r.json();
  renderExtendedHolders();
  renderMoverMonitor();
  renderSecurityIntelligence();
  renderNportStatus();
  appendPhase4SourceHealth();
}

function p4destroy(key){
  if(p4charts[key]){p4charts[key].destroy();p4charts[key]=null;}
}

function renderExtendedHolders(){
  const block=p4data.extended_holders||{}, rows=block.holders||[];
  const meta=document.getElementById('extendedMeta');
  if(meta) meta.textContent=`Federal Reserve Financial Accounts via FRED · latest observation ${block.as_of||'—'}`;
  const table=document.getElementById('extendedTable');
  if(table){
    table.innerHTML=rows.map(r=>`<tr><td>${p4esc(r.name)}</td><td>${p4fmtB(r.holdings_billions)}</td><td class="${(r.qoq_change_billions||0)>=0?'up':'down'}">${p4signedB(r.qoq_change_billions)}</td><td class="${(r.yoy_change_billions||0)>=0?'up':'down'}">${p4signedB(r.yoy_change_billions)}</td><td>${p4esc(r.as_of||'—')}</td></tr>`).join('');
  }

  const canvas=document.getElementById('extendedChart');
  p4destroy('extended');
  if(canvas&&rows.length){
    const labels=[...new Set(rows.flatMap(r=>(r.history||[]).map(h=>h.date)))].sort();
    const datasets=rows.map(r=>{
      const m=new Map((r.history||[]).map(h=>[h.date,h.value_billions]));
      return {label:r.name,data:labels.map(d=>m.has(d)?m.get(d):null),spanGaps:true};
    });
    p4charts.extended=new Chart(canvas,{type:'line',data:{labels,datasets},options:p4lineOptions('$B')});
  }
}

function renderMoverMonitor(){
  const block=p4data.change_leaderboard||{};
  const rows=block.largest_absolute_moves||[];
  const scope=document.getElementById('moverScope');
  const table=document.getElementById('moverTable');
  const meta=document.getElementById('moverMeta');
  if(meta) meta.textContent=block.note||'Largest reported changes across holder datasets.';
  if(!table) return;

  const draw=()=>{
    const selected=scope?.value||'all';
    const filtered=selected==='all'?rows:rows.filter(r=>r.scope===selected);
    table.innerHTML=filtered.map(r=>`<tr><td>${p4esc(r.scope)}</td><td>${p4esc(r.name)}</td><td>${p4esc(r.period)}</td><td>${p4fmtB(r.current_billions)}</td><td class="${(r.change_billions||0)>=0?'up':'down'}">${p4signedB(r.change_billions)}</td></tr>`).join('');
  };
  if(scope) scope.onchange=draw;
  draw();
}

function renderSecurityIntelligence(){
  const block=p4data.security_intelligence||{}, rows=block.rows||[];
  const meta=document.getElementById('securityMeta');
  if(meta) meta.textContent=`SOMA as of ${block.as_of||'—'} · ${block.row_count??0} tracked CUSIPs · ${block.auction_matches??0} recent-auction matches · ${block.nport_matches??0} N-PORT matches`;
  const metrics=document.getElementById('securityMetrics');
  if(metrics) metrics.innerHTML=[
    ['Tracked SOMA CUSIPs',block.row_count??0],
    ['Recent auction matches',block.auction_matches??0],
    ['N-PORT matches',block.nport_matches??0]
  ].map(([k,v])=>`<div class="mini"><span>${p4esc(k)}</span><strong>${p4esc(v)}</strong></div>`).join('');

  const table=document.getElementById('securityTable');
  const search=document.getElementById('cusipSearch');
  if(!table) return;
  const draw=()=>{
    const q=(search?.value||'').trim().toLowerCase();
    const filtered=!q?rows:rows.filter(r=>`${r.cusip||''} ${r.security_type||''} ${r.maturity_date||''} ${r.auction_security_term||''}`.toLowerCase().includes(q));
    table.innerHTML=filtered.map(r=>`<tr><td>${p4esc(r.cusip)}</td><td>${p4esc(r.security_type||'—')}</td><td>${p4esc(r.maturity_date||'—')}</td><td>${p4fmtB(r.soma_par_billions)}</td><td>${p4fmtPct(r.soma_pct_outstanding)}</td><td>${p4esc(r.latest_auction_date||'—')}</td><td>${p4fmtB(r.auction_offering_billions)}</td><td>${p4fmtB(r.nport_fund_value_billions)}</td><td>${r.nport_fund_count??'—'}</td></tr>`).join('');
  };
  if(search) search.oninput=draw;
  draw();
}

function renderNportStatus(){
  const n=p4data.nport||{};
  const el=document.getElementById('nportStatus');
  if(!el) return;
  if(n.cache_status==='available'){
    el.innerHTML=`<strong>N-PORT cache available.</strong> ${p4esc(n.quarter||n.latest_available_quarter||'')} · ${Number(n.fund_count||0).toLocaleString()} funds · ${p4fmtB(n.direct_treasury_total_billions)} direct Treasury market value.`;
  }else{
    el.innerHTML=`<strong>N-PORT security-level cache pending.</strong> Latest published SEC bulk set: ${p4esc(n.latest_available_quarter||'—')}. The dashboard still shows official aggregate ETF holdings from Federal Reserve data while the separate quarterly SEC ingestion workflow is pending.`;
  }
}

function appendPhase4SourceHealth(){
  const grid=document.getElementById('sourceHealth');
  if(!grid) return;
  const names={extended_holders:'Federal Reserve — Insurance, Pensions, ETFs & Hedge Funds',nport:'SEC — Form N-PORT quarterly cache'};
  for(const [key,name] of Object.entries(names)){
    if(grid.querySelector(`[data-phase4-source="${key}"]`)) continue;
    const s=(p4data.sources||{})[key]||{};
    const div=document.createElement('div');
    div.className='source';
    div.dataset.phase4Source=key;
    div.innerHTML=`<strong>${p4esc(name)}</strong><small>${s.checked_at?new Date(s.checked_at).toLocaleString():'Not checked yet'}</small><br><span class="pill ${p4esc(s.status||'seed')}">${p4esc(s.status||'unknown')}</span>${s.message?`<div class="error-text">${p4esc(s.message)}</div>`:''}`;
    grid.appendChild(div);
  }
}

function p4lineOptions(unit){
  return {responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}}},scales:{x:{grid:{color:'#223047'},ticks:{color:'#96a6ba',maxTicksLimit:10}},y:{grid:{color:'#223047'},ticks:{color:'#96a6ba',callback:v=>`${v}${unit}`}}}};
}

loadPhase4().catch(err=>console.error('Phase 4 UI error',err));
