const p7esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p7fmtB=v=>v==null?'—':`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
const p7fmtPct=v=>v==null?'—':`${Number(v).toFixed(1)}%`;
const p7fmtSignedPct=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`;
const p7fmtSignedB=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}B`;
const p7fmtNum=(v,d=2)=>v==null?'—':Number(v).toFixed(d);
let p7data;

function p7sourceUrl(key){
  const row=(p7data?.provenance?.sources||[]).find(r=>r.key===key);
  return row?.urls?.[0]?.url||null;
}

function p7sourceLink(key,label='official source'){
  const url=p7sourceUrl(key);
  return url?`<a class="audit-link" href="${p7esc(url)}" target="_blank" rel="noopener noreferrer">${p7esc(label)}</a>`:'';
}

function p7dateTime(value){
  if(!value) return '—';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?p7esc(value):p7esc(d.toLocaleString());
}

function ensurePhase7Scaffold(){
  const eyebrow=document.querySelector('.eyebrow');
  if(eyebrow) eyebrow.textContent='OFFICIAL-DATA DASHBOARD · PHASE 7';

  const downloads=document.querySelector('.download-row');
  if(downloads&&!document.getElementById('downloadAlertHistoryCsv')){
    downloads.insertAdjacentHTML('beforeend','<button id="downloadAlertHistoryCsv" type="button">Download alert history CSV</button><button id="downloadSecurityCsv" type="button">Download security CSV</button>');
  }

  const alertPanel=document.getElementById('alertTable')?.closest('.panel');
  if(alertPanel&&!document.getElementById('alertHistoryPanel')){
    alertPanel.insertAdjacentHTML('afterend',`<section class="panel" id="alertHistoryPanel">
      <div class="panel-head">
        <div><h2>Alert Lifecycle History</h2><p id="alertHistoryMeta"></p></div>
        <div class="panel-actions">
          <select id="alertHistoryState" aria-label="Filter alert history state"><option value="all">All episodes</option><option value="active">Active</option><option value="cleared">Cleared</option></select>
          <input id="alertHistorySearch" type="search" placeholder="Search holder / series…" />
        </div>
      </div>
      <div class="metric-strip metric-four" id="alertHistoryMetrics"></div>
      <div class="table-wrap table-tall lifecycle-table"><table><thead><tr><th>State</th><th>Severity</th><th>Scope</th><th>Holder / series</th><th>Observation</th><th>Change</th><th>First seen</th><th>Last seen / cleared</th><th>Runs seen</th></tr></thead><tbody id="alertHistoryTable"></tbody></table></div>
      <div class="subsection-head"><strong>Recent lifecycle transitions</strong><span>Open, clear, reopen and severity-change events are retained across updater runs.</span></div>
      <div class="table-wrap transition-table"><table><thead><tr><th>Event</th><th>Holder / series</th><th>Observation</th><th>Timestamp</th><th>Replacement observation</th></tr></thead><tbody id="alertTransitionTable"></tbody></table></div>
      <div class="note inline-note">A signal is not marked cleared just because a source fetch fails. The lifecycle closes an episode only after a healthy refresh confirms that the flagged observation is no longer current.</div>
    </section>`);
  }

  const securityPanel=document.getElementById('securityTable')?.closest('.panel');
  if(securityPanel&&!document.getElementById('securityDrillPanel')){
    securityPanel.insertAdjacentHTML('afterend',`<section class="panel" id="securityDrillPanel">
      <div class="panel-head">
        <div><h2>Treasury Security Drill-down</h2><p id="securityDrillMeta"></p></div>
        <select id="securityDrillSelect" aria-label="Select Treasury CUSIP"></select>
      </div>
      <div class="metric-strip metric-four" id="securityDrillMetrics"></div>
      <div class="detail-grid" id="securityDrillDetails"></div>
      <div class="subsection-head"><strong>Auction / reopening history</strong><span>Latest Treasury auction records for the selected CUSIP.</span></div>
      <div class="table-wrap table-tall security-history-table"><table><thead><tr><th>Auction date</th><th>Issue date</th><th>Offering</th><th>Bid / cover</th><th>High yield</th><th>Investment rate</th><th>Price</th><th>Reopening</th></tr></thead><tbody id="securityAuctionHistory"></tbody></table></div>
      <div class="note inline-note">The drill-down cross-checks New York Fed SOMA holdings with Treasury auction history. Auction awards and issuance metadata provide security context; they do not identify the security's current beneficial owners.</div>
    </section>`);
  }
}

function renderAlertHistory(){
  const block=p7data?.alert_history||{}, episodes=block.episodes||[], transitions=block.transitions||[];
  const meta=document.getElementById('alertHistoryMeta');
  if(meta) meta.textContent=block.note||'Lifecycle history begins accumulating after Phase 7 is deployed.';
  const metrics=document.getElementById('alertHistoryMetrics');
  if(metrics) metrics.innerHTML=[
    ['Active episodes',block.active_count??episodes.filter(r=>r.state==='active').length],
    ['Cleared episodes',block.cleared_count??episodes.filter(r=>r.state==='cleared').length],
    ['Stored episodes',block.episode_count??episodes.length],
    ['Lifecycle events',block.transition_count??transitions.length]
  ].map(([k,v])=>`<div class="mini"><span>${p7esc(k)}</span><strong>${p7esc(v)}</strong></div>`).join('');

  const table=document.getElementById('alertHistoryTable');
  const state=document.getElementById('alertHistoryState');
  const search=document.getElementById('alertHistorySearch');
  const draw=()=>{
    if(!table) return;
    const selected=state?.value||'all';
    const q=(search?.value||'').trim().toLowerCase();
    const filtered=episodes.filter(r=>(selected==='all'||r.state===selected)&&(!q||`${r.scope||''} ${r.name||''} ${r.period||''} ${r.as_of||''}`.toLowerCase().includes(q)));
    table.innerHTML=filtered.length?filtered.map(r=>{
      const end=r.state==='cleared'?r.cleared_at:r.last_seen_at;
      return `<tr>
        <td><span class="state-badge ${p7esc(r.state||'unknown')}">${p7esc(r.state||'unknown')}</span></td>
        <td><span class="alert-badge ${p7esc(r.severity||'medium')}">${p7esc(r.severity||'—')}</span></td>
        <td>${p7esc(r.scope||'—')}</td><td>${p7esc(r.name||'—')}</td><td>${p7esc(r.as_of||'—')}</td>
        <td class="${(r.change_billions||0)>=0?'up':'down'}">${p7fmtSignedB(r.change_billions)} · ${p7fmtSignedPct(r.change_pct)}</td>
        <td>${p7dateTime(r.first_seen_at)}</td><td>${p7dateTime(end)}</td><td>${p7esc(r.seen_count??0)}</td>
      </tr>`;
    }).join(''):`<tr><td colspan="9" class="empty-cell">No lifecycle episodes match this filter.</td></tr>`;
  };
  if(state) state.onchange=draw;
  if(search) search.oninput=draw;
  draw();

  const transitionTable=document.getElementById('alertTransitionTable');
  if(transitionTable){
    transitionTable.innerHTML=transitions.slice(0,50).map(r=>`<tr>
      <td><span class="transition-badge ${p7esc(r.event||'event')}">${p7esc((r.event||'event').replaceAll('_',' '))}</span></td>
      <td>${p7esc(r.name||'—')}</td><td>${p7esc(r.as_of||'—')}</td><td>${p7dateTime(r.at)}</td><td>${p7esc(r.replacement_observation||'—')}</td>
    </tr>`).join('')||'<tr><td colspan="5" class="empty-cell">Lifecycle transitions will accumulate as source observations change.</td></tr>';
  }
}

function securityRate(row){
  if(row.soma_coupon_rate_pct!=null) return {label:'SOMA coupon',value:`${p7fmtNum(row.soma_coupon_rate_pct,3)}%`};
  if(row.auction_interest_rate_pct!=null) return {label:'Auction coupon',value:`${p7fmtNum(row.auction_interest_rate_pct,3)}%`};
  if(row.latest_high_investment_rate_pct!=null) return {label:'Investment rate',value:`${p7fmtNum(row.latest_high_investment_rate_pct,3)}%`};
  if(row.latest_high_yield_pct!=null) return {label:'High yield',value:`${p7fmtNum(row.latest_high_yield_pct,3)}%`};
  return {label:'Rate',value:'—'};
}

function detailItem(label,value,extraClass=''){
  return `<div class="detail-item ${p7esc(extraClass)}"><span>${p7esc(label)}</span><strong>${value==null?'—':value}</strong></div>`;
}

function renderSecurityDrill(){
  const block=p7data?.security_intelligence||{}, rows=block.rows||[];
  const select=document.getElementById('securityDrillSelect');
  if(!select) return;

  const current=select.value;
  select.innerHTML=rows.map((r,i)=>`<option value="${p7esc(r.cusip)}" ${(current?r.cusip===current:i===0)?'selected':''}>${p7esc(r.cusip)} · ${p7esc(r.security_type||'Treasury')} · ${p7esc(r.maturity_date||'—')}</option>`).join('');

  const draw=()=>{
    const row=rows.find(r=>r.cusip===select.value)||rows[0];
    const meta=document.getElementById('securityDrillMeta');
    const metrics=document.getElementById('securityDrillMetrics');
    const details=document.getElementById('securityDrillDetails');
    const history=document.getElementById('securityAuctionHistory');
    if(!row){
      if(meta) meta.textContent='No SOMA CUSIP rows are available.';
      return;
    }

    const status=block.metadata_status||{};
    const source=status.source_url?` · <a class="inline-source" href="${p7esc(status.source_url)}" target="_blank" rel="noopener noreferrer">Treasury auction source</a>`:'';
    if(meta) meta.innerHTML=`Auction metadata ${p7esc(status.status||'unknown')} · ${p7fmtPct(block.auction_metadata_coverage_pct)} coverage · ${p7esc(block.maturity_mismatch_count??0)} maturity mismatches${source}`;

    const rate=securityRate(row);
    if(metrics) metrics.innerHTML=[
      ['SOMA par',p7fmtB(row.soma_par_billions)],
      ['SOMA % outstanding',p7fmtPct(row.soma_pct_outstanding)],
      [rate.label,rate.value],
      ['Years to maturity',row.years_to_maturity==null?'—':p7fmtNum(row.years_to_maturity,2)]
    ].map(([k,v])=>`<div class="mini"><span>${p7esc(k)}</span><strong>${v}</strong></div>`).join('');

    if(details){
      const consistency=row.maturity_consistency||'unknown';
      const consistencyClass=consistency==='match'?'match':consistency==='mismatch'?'mismatch':'unknown';
      details.innerHTML=[
        detailItem('CUSIP',p7esc(row.cusip)),
        detailItem('Security type',p7esc(row.security_type||row.auction_security_type||'—')),
        detailItem('Auction term',p7esc(row.auction_security_term||'—')),
        detailItem('Original term',p7esc(row.original_security_term||'—')),
        detailItem('Original issue date',p7esc(row.original_issue_date||'—')),
        detailItem('Latest issue date',p7esc(row.issue_date||'—')),
        detailItem('SOMA maturity',p7esc(row.maturity_date||'—')),
        detailItem('Auction maturity',p7esc(row.auction_maturity_date||'—')),
        detailItem('Maturity cross-check',`<span class="state-badge ${p7esc(consistencyClass)}">${p7esc(consistency)}</span>`),
        detailItem('Original term length',row.original_term_years==null?'—':`${p7fmtNum(row.original_term_years,2)} years`),
        detailItem('Term remaining',p7fmtPct(row.remaining_term_pct)),
        detailItem('Security age',row.security_age_years==null?'—':`${p7fmtNum(row.security_age_years,2)} years`),
        detailItem('Auction records',p7esc(row.auction_count??0)),
        detailItem('Reopenings',p7esc(row.reopening_count??0)),
        detailItem('Latest auction',p7esc(row.latest_auction_date||'—')),
        detailItem('Latest offering',p7fmtB(row.auction_offering_billions)),
        detailItem('Latest bid / cover',p7fmtNum(row.latest_bid_to_cover,2)),
        detailItem('Latest auction price',p7fmtNum(row.latest_auction_price,6)),
        detailItem('High yield',row.latest_high_yield_pct==null?'—':`${p7fmtNum(row.latest_high_yield_pct,3)}%`),
        detailItem('Investment rate',row.latest_high_investment_rate_pct==null?'—':`${p7fmtNum(row.latest_high_investment_rate_pct,3)}%`),
        detailItem('Matched sources',(row.source_keys||[]).map(k=>p7sourceLink(k,k.toUpperCase())||p7esc(k.toUpperCase())).join(' ')||'—')
      ].join('');
    }

    const auctionHistory=row.auction_history||[];
    if(history) history.innerHTML=auctionHistory.length?auctionHistory.map(a=>`<tr>
      <td>${p7esc(a.auction_date||'—')}</td><td>${p7esc(a.issue_date||'—')}</td><td>${p7fmtB(a.offering_billions)}</td><td>${p7fmtNum(a.bid_to_cover,2)}</td>
      <td>${a.high_yield_pct==null?'—':`${p7fmtNum(a.high_yield_pct,3)}%`}</td><td>${a.high_investment_rate_pct==null?'—':`${p7fmtNum(a.high_investment_rate_pct,3)}%`}</td>
      <td>${p7fmtNum(a.price,6)}</td><td>${a.reopening?'Yes':'No'}</td>
    </tr>`).join(''):'<tr><td colspan="8" class="empty-cell">No Treasury auction-history match is available for this CUSIP.</td></tr>';
  };

  select.onchange=draw;
  draw();
}

function wireSecurityTableDrill(){
  const table=document.getElementById('securityTable');
  if(!table||table.dataset.phase7Drill==='1') return;
  table.dataset.phase7Drill='1';
  table.addEventListener('click',event=>{
    const tr=event.target.closest('tr');
    const cusip=tr?.querySelector('td')?.textContent?.trim();
    if(!cusip) return;
    const select=document.getElementById('securityDrillSelect');
    if(!select||![...select.options].some(o=>o.value===cusip)) return;
    select.value=cusip;
    select.dispatchEvent(new Event('change'));
    document.getElementById('securityDrillPanel')?.scrollIntoView({behavior:'smooth',block:'start'});
  });
}

function buildAlertHistoryCsv(){
  const rows=[['alert_id','state','severity','scope','name','period','observation_date','previous_observation','current_billions','change_billions','change_pct','baseline_abs_change_billions','multiple_of_baseline','first_seen_at','last_seen_at','cleared_at','seen_count','reason']];
  for(const r of p7data?.alert_history?.episodes||[]) rows.push([r.alert_id,r.state,r.severity,r.scope,r.name,r.period,r.as_of,r.previous_as_of,r.current_billions,r.change_billions,r.change_pct,r.baseline_abs_change_billions,r.multiple_of_baseline,r.first_seen_at,r.last_seen_at,r.cleared_at,r.seen_count,r.reason]);
  return rows.map(r=>r.map(csvCell).join(',')).join('\n');
}

function buildSecurityCsv(){
  const rows=[['cusip','security_type','maturity_date','soma_par_billions','soma_pct_outstanding','soma_coupon_rate_pct','years_to_maturity','original_issue_date','issue_date','auction_security_term','original_security_term','auction_count','reopening_count','latest_auction_date','auction_offering_billions','latest_bid_to_cover','latest_high_yield_pct','latest_high_investment_rate_pct','latest_auction_price','original_term_years','remaining_term_pct','maturity_consistency','nport_fund_value_billions','nport_fund_count','source_keys']];
  for(const r of p7data?.security_intelligence?.rows||[]) rows.push([r.cusip,r.security_type,r.maturity_date,r.soma_par_billions,r.soma_pct_outstanding,r.soma_coupon_rate_pct,r.years_to_maturity,r.original_issue_date,r.issue_date,r.auction_security_term,r.original_security_term,r.auction_count,r.reopening_count,r.latest_auction_date,r.auction_offering_billions,r.latest_bid_to_cover,r.latest_high_yield_pct,r.latest_high_investment_rate_pct,r.latest_auction_price,r.original_term_years,r.remaining_term_pct,r.maturity_consistency,r.nport_fund_value_billions,r.nport_fund_count,(r.source_keys||[]).join('|')]);
  return rows.map(r=>r.map(csvCell).join(',')).join('\n');
}

function wirePhase7Downloads(){
  const alerts=document.getElementById('downloadAlertHistoryCsv');
  const security=document.getElementById('downloadSecurityCsv');
  if(alerts) alerts.onclick=()=>downloadBlob('treasury-alert-lifecycle-history.csv',buildAlertHistoryCsv(),'text/csv;charset=utf-8');
  if(security) security.onclick=()=>downloadBlob('treasury-security-metadata.csv',buildSecurityCsv(),'text/csv;charset=utf-8');
}

function mountPhase7(attempt=0){
  ensurePhase7Scaffold();
  const ready=document.getElementById('alertHistoryPanel')&&document.getElementById('securityDrillPanel');
  if(!ready&&attempt<24){
    setTimeout(()=>mountPhase7(attempt+1),250);
    return;
  }
  renderAlertHistory();
  renderSecurityDrill();
  wireSecurityTableDrill();
  wirePhase7Downloads();
}

async function loadPhase7(){
  const r=await fetch(`data/dashboard.json?v=${Date.now()}`);
  if(!r.ok) throw new Error(`dashboard.json ${r.status}`);
  p7data=await r.json();
  mountPhase7();
}

loadPhase7().catch(err=>console.error('Phase 7 UI error',err));
