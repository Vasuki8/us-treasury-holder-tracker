const p8esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p8fmtB=v=>v==null?'—':`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
const p8fmtPct=(v,d=1)=>v==null?'—':`${Number(v).toFixed(d)}%`;
const p8fmtSignedB=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}B`;
const p8fmtSignedPct=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`;
const p8fmtNum=(v,d=2)=>v==null?'—':Number(v).toFixed(d);
let p8data;

function p8dateTime(value){
  if(!value) return '—';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?p8esc(value):p8esc(d.toLocaleString());
}

function ensurePhase8Scaffold(){
  const eyebrow=document.querySelector('.eyebrow');
  if(eyebrow) eyebrow.textContent='OFFICIAL-DATA DASHBOARD · PHASE 8';

  const downloads=document.querySelector('.download-row');
  if(downloads&&!document.getElementById('downloadAlertIntelCsv')){
    downloads.insertAdjacentHTML('beforeend',
      '<button id="downloadAlertIntelCsv" type="button">Download alert intelligence CSV</button>'+
      '<button id="downloadPublicationCsv" type="button">Download source-change CSV</button>'+
      '<button id="downloadConcentrationCsv" type="button">Download concentration CSV</button>');
  }

  const lifecycle=document.getElementById('alertHistoryPanel');
  if(lifecycle&&!document.getElementById('alertIntelPanel')){
    lifecycle.insertAdjacentHTML('afterend',`<section class="panel" id="alertIntelPanel">
      <div class="panel-head">
        <div><h2>Alert Intelligence & Notification Readiness</h2><p id="alertIntelMeta"></p></div>
        <div class="panel-actions">
          <select id="alertIntelScope" aria-label="Filter alert intelligence"><option value="all">All scopes</option><option value="Foreign country">Foreign countries</option><option value="U.S. sector">U.S. sectors</option><option value="Primary dealer">Primary dealer series</option></select>
          <select id="alertIntelLabel" aria-label="Filter diagnostic label"><option value="all">All diagnostics</option><option value="extreme">Extreme</option><option value="elevated">Elevated</option><option value="notable">Notable</option></select>
        </div>
      </div>
      <div class="metric-strip metric-four" id="alertIntelMetrics"></div>
      <div class="table-wrap table-tall phase8-intel-table"><table><thead><tr><th>Severity</th><th>Diagnostic</th><th>Scope</th><th>Holder / series</th><th>Observation</th><th>Change</th><th>Abs-change percentile</th><th>Robust z</th><th>History changes</th></tr></thead><tbody id="alertIntelTable"></tbody></table></div>
      <div class="subsection-head"><strong>New high-severity notification queue</strong><span id="notificationMeta"></span></div>
      <div class="table-wrap phase8-notify-table"><table><thead><tr><th>Event</th><th>Holder / series</th><th>Observation</th><th>Source</th><th>Triggered</th><th>Source health</th></tr></thead><tbody id="notificationTable"></tbody></table></div>
      <div class="note inline-note">Phase 8 never retroactively calls an existing high alert “new.” The notification queue begins from a watermark and only emits future high-severity open, reopen or escalation events.</div>
    </section>`);
  }

  const drill=document.getElementById('securityDrillPanel');
  if(drill&&!document.getElementById('concentrationPanel')){
    drill.insertAdjacentHTML('afterend',`<section class="panel" id="concentrationPanel">
      <div class="panel-head"><div><h2>SOMA CUSIP Concentration Monitor</h2><p id="concentrationMeta"></p></div><input id="concentrationSearch" type="search" placeholder="Search CUSIP, type, maturity…" /></div>
      <div class="metric-strip metric-four" id="concentrationMetrics"></div>
      <div class="table-wrap table-tall concentration-table"><table><thead><tr><th>CUSIP</th><th>Type</th><th>Maturity</th><th>SOMA par</th><th>SOMA % outstanding</th><th>Implied outstanding</th><th>Percentile</th><th>Band</th><th>Original issue</th></tr></thead><tbody id="concentrationTable"></tbody></table></div>
      <div class="note inline-note">“Implied outstanding” is derived from official New York Fed SOMA par and percent-outstanding fields. It is not a separately reported Treasury balance and should be treated as a derived research metric.</div>
    </section>`);
  }

  const provenance=document.getElementById('provenanceTable')?.closest('.panel');
  if(provenance&&!document.getElementById('publicationPanel')){
    provenance.insertAdjacentHTML('afterend',`<section class="panel" id="publicationPanel">
      <div class="panel-head"><div><h2>Official Source Publication Change Log</h2><p id="publicationMeta"></p></div><input id="publicationSearch" type="search" placeholder="Search source or cadence…" /></div>
      <div class="metric-strip metric-four" id="publicationMetrics"></div>
      <div class="subsection-head"><strong>Current source observations</strong><span>Latest official reporting period seen by the tracker.</span></div>
      <div class="table-wrap publication-latest-table"><table><thead><tr><th>Dataset</th><th>Observation</th><th>Cadence</th><th>Status</th><th>Last checked</th></tr></thead><tbody id="publicationLatestTable"></tbody></table></div>
      <div class="subsection-head"><strong>Detected observation changes</strong><span>Only reporting-period changes are logged.</span></div>
      <div class="table-wrap table-tall publication-event-table"><table><thead><tr><th>Event</th><th>Dataset</th><th>Previous observation</th><th>New observation</th><th>Detected</th></tr></thead><tbody id="publicationEventTable"></tbody></table></div>
      <div class="note inline-note">The detected timestamp is when this tracker first saw a new official reporting period. It is not necessarily the publisher’s exact release timestamp.</div>
    </section>`);
  }
}

function renderAlertIntel(){
  const block=p8data?.alert_intelligence||{}, rows=block.rows||[];
  const notifications=p8data?.phase8_notifications||{};
  const meta=document.getElementById('alertIntelMeta');
  if(meta) meta.textContent=block.method||'';

  const metrics=document.getElementById('alertIntelMetrics');
  if(metrics) metrics.innerHTML=[
    ['Current flagged moves',block.row_count??rows.length],
    ['Extreme diagnostics',block.extreme_count??0],
    ['New high notifications',notifications.new_high_count??0],
    ['Active high alerts',notifications.active_high_count??0]
  ].map(([k,v])=>`<div class="mini"><span>${p8esc(k)}</span><strong>${p8esc(v)}</strong></div>`).join('');

  const scope=document.getElementById('alertIntelScope');
  const label=document.getElementById('alertIntelLabel');
  const table=document.getElementById('alertIntelTable');
  const draw=()=>{
    if(!table) return;
    const s=scope?.value||'all', l=label?.value||'all';
    const filtered=rows.filter(r=>(s==='all'||r.scope===s)&&(l==='all'||r.diagnostic_label===l));
    table.innerHTML=filtered.length?filtered.map(r=>`<tr>
      <td><span class="alert-badge ${p8esc(r.severity||'medium')}">${p8esc(r.severity||'—')}</span></td>
      <td><span class="state-badge ${r.diagnostic_label==='extreme'?'mismatch':r.diagnostic_label==='elevated'?'unknown':'active'}">${p8esc(r.diagnostic_label||'—')}</span></td>
      <td>${p8esc(r.scope||'—')}</td><td>${p8esc(r.name||'—')}</td><td>${p8esc(r.as_of||'—')}</td>
      <td class="${(r.change_billions||0)>=0?'up':'down'}">${p8fmtSignedB(r.change_billions)} · ${p8fmtSignedPct(r.change_pct)}</td>
      <td>${p8fmtPct(r.abs_change_percentile)}</td><td>${p8fmtNum(r.robust_z,2)}</td><td>${p8esc(r.history_change_count??0)}</td>
    </tr>`).join(''):'<tr><td colspan="9" class="empty-cell">No alert diagnostics match this filter.</td></tr>';
  };
  if(scope) scope.onchange=draw;
  if(label) label.onchange=draw;
  draw();

  const nmeta=document.getElementById('notificationMeta');
  if(nmeta) nmeta.textContent=`${notifications.new_high_count??0} new · ${notifications.active_high_count??0} active high · watermark ${notifications.last_processed_transition_at?new Date(notifications.last_processed_transition_at).toLocaleString():'initialized now'}`;
  const ntable=document.getElementById('notificationTable');
  const queue=notifications.queue||[];
  if(ntable) ntable.innerHTML=queue.length?queue.map(r=>`<tr>
    <td><span class="transition-badge ${p8esc(r.event||'opened')}">${p8esc((r.event||'event').replaceAll('_',' '))}</span></td>
    <td>${p8esc(r.name||'—')}</td><td>${p8esc(r.observation_date||'—')}</td><td>${p8esc(r.source_name||r.source_key||'—')}</td>
    <td>${p8dateTime(r.triggered_at)}</td><td><span class="pill ${p8esc(r.source_status||'seed')}">${p8esc(r.source_status||'unknown')}</span></td>
  </tr>`).join(''):'<tr><td colspan="6" class="empty-cell">No new high-severity lifecycle transition has occurred since the Phase 8 watermark.</td></tr>';
}

function renderPublicationHistory(){
  const block=p8data?.publication_history||{}, latest=block.latest||[], events=block.events||[];
  const meta=document.getElementById('publicationMeta');
  if(meta) meta.textContent=block.note||'';
  const metrics=document.getElementById('publicationMetrics');
  if(metrics) metrics.innerHTML=[
    ['Tracked sources',block.source_count??latest.length],
    ['Logged changes',block.event_count??events.length],
    ['Changes this run',block.new_event_count??0],
    ['Baseline',block.baseline_initialized_at?p8dateTime(block.baseline_initialized_at):'—']
  ].map(([k,v])=>`<div class="mini"><span>${p8esc(k)}</span><strong>${v}</strong></div>`).join('');

  const search=document.getElementById('publicationSearch');
  const latestTable=document.getElementById('publicationLatestTable');
  const eventTable=document.getElementById('publicationEventTable');
  const draw=()=>{
    const q=(search?.value||'').trim().toLowerCase();
    const lrows=!q?latest:latest.filter(r=>`${r.name||''} ${r.key||''} ${r.frequency||''} ${r.status||''}`.toLowerCase().includes(q));
    const erows=!q?events:events.filter(r=>`${r.name||''} ${r.key||''} ${r.frequency||''}`.toLowerCase().includes(q));
    if(latestTable) latestTable.innerHTML=lrows.map(r=>`<tr><td>${p8esc(r.name||r.key)}</td><td>${p8esc(r.as_of||'—')}</td><td>${p8esc(r.frequency||'—')}</td><td><span class="pill ${p8esc(r.status||'seed')}">${p8esc(r.status||'unknown')}</span></td><td>${p8dateTime(r.checked_at)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty-cell">No source observations match this search.</td></tr>';
    if(eventTable) eventTable.innerHTML=erows.slice(0,100).map(r=>`<tr><td><span class="transition-badge opened">${p8esc((r.event||'change').replaceAll('_',' '))}</span></td><td>${p8esc(r.name||r.key)}</td><td>${p8esc(r.previous_as_of||'—')}</td><td>${p8esc(r.as_of||'—')}</td><td>${p8dateTime(r.at)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty-cell">No reporting-period change has been detected since the Phase 8 baseline was established.</td></tr>';
  };
  if(search) search.oninput=draw;
  draw();
}

function renderConcentration(){
  const block=p8data?.security_concentration||{}, rows=block.top_concentrations||[];
  const meta=document.getElementById('concentrationMeta');
  if(meta) meta.textContent=`As of ${block.as_of||'—'} · ${block.note||''}`;
  const metrics=document.getElementById('concentrationMetrics');
  if(metrics) metrics.innerHTML=[
    ['CUSIPs with % outstanding',`${block.coverage_count??0} / ${block.security_count??0}`],
    ['Weighted avg SOMA share',p8fmtPct(block.weighted_average_soma_pct_outstanding)],
    ['At / above 50%',block.at_or_above_50pct??0],
    ['At / above 70%',block.at_or_above_70pct??0]
  ].map(([k,v])=>`<div class="mini"><span>${p8esc(k)}</span><strong>${v}</strong></div>`).join('');

  const search=document.getElementById('concentrationSearch');
  const table=document.getElementById('concentrationTable');
  const draw=()=>{
    if(!table) return;
    const q=(search?.value||'').trim().toLowerCase();
    const filtered=!q?rows:rows.filter(r=>`${r.cusip||''} ${r.security_type||''} ${r.maturity_date||''} ${r.original_security_term||''}`.toLowerCase().includes(q));
    table.innerHTML=filtered.map(r=>`<tr>
      <td>${p8esc(r.cusip||'—')}</td><td>${p8esc(r.security_type||'—')}</td><td>${p8esc(r.maturity_date||'—')}</td>
      <td>${p8fmtB(r.soma_par_billions)}</td><td>${p8fmtPct(r.soma_pct_outstanding)}</td><td>${p8fmtB(r.implied_outstanding_billions)}</td>
      <td>${p8fmtPct(r.concentration_percentile)}</td><td><span class="state-badge ${r.concentration_band==='very high'?'mismatch':r.concentration_band==='high'||r.concentration_band==='elevated'?'unknown':r.concentration_band==='normal'?'active':'cleared'}">${p8esc(r.concentration_band||'unknown')}</span></td>
      <td>${p8esc(r.original_issue_date||'—')}</td>
    </tr>`).join('')||'<tr><td colspan="9" class="empty-cell">No CUSIP concentration rows match this search.</td></tr>';
  };
  if(search) search.oninput=draw;
  draw();
}

function buildAlertIntelCsv(){
  const rows=[['severity','diagnostic_label','scope','name','period','observation_date','change_billions','change_pct','abs_change_percentile','robust_z','history_change_count','median_change_billions','mad_change_billions','diagnostic_score','alert_id']];
  for(const r of p8data?.alert_intelligence?.rows||[]) rows.push([r.severity,r.diagnostic_label,r.scope,r.name,r.period,r.as_of,r.change_billions,r.change_pct,r.abs_change_percentile,r.robust_z,r.history_change_count,r.median_change_billions,r.mad_change_billions,r.diagnostic_score,r.alert_id]);
  return rows.map(r=>r.map(csvCell).join(',')).join('\n');
}

function buildPublicationCsv(){
  const rows=[['event','dataset_key','dataset','previous_observation','observation','frequency','status','detected_at']];
  for(const r of p8data?.publication_history?.events||[]) rows.push([r.event,r.key,r.name,r.previous_as_of,r.as_of,r.frequency,r.status,r.at]);
  return rows.map(r=>r.map(csvCell).join(',')).join('\n');
}

function buildConcentrationCsv(){
  const rows=[['cusip','security_type','maturity_date','soma_par_billions','soma_pct_outstanding','implied_outstanding_billions','concentration_percentile','concentration_band','original_issue_date','original_security_term','latest_auction_date']];
  for(const r of p8data?.security_concentration?.top_concentrations||[]) rows.push([r.cusip,r.security_type,r.maturity_date,r.soma_par_billions,r.soma_pct_outstanding,r.implied_outstanding_billions,r.concentration_percentile,r.concentration_band,r.original_issue_date,r.original_security_term,r.latest_auction_date]);
  return rows.map(r=>r.map(csvCell).join(',')).join('\n');
}

function wirePhase8Downloads(){
  const a=document.getElementById('downloadAlertIntelCsv');
  const p=document.getElementById('downloadPublicationCsv');
  const c=document.getElementById('downloadConcentrationCsv');
  if(a) a.onclick=()=>downloadBlob('treasury-alert-intelligence.csv',buildAlertIntelCsv(),'text/csv;charset=utf-8');
  if(p) p.onclick=()=>downloadBlob('treasury-source-publication-changes.csv',buildPublicationCsv(),'text/csv;charset=utf-8');
  if(c) c.onclick=()=>downloadBlob('treasury-soma-concentration.csv',buildConcentrationCsv(),'text/csv;charset=utf-8');
}

function mountPhase8(attempt=0){
  ensurePhase8Scaffold();
  const ready=document.getElementById('alertIntelPanel')&&document.getElementById('concentrationPanel')&&document.getElementById('publicationPanel');
  if(!ready&&attempt<32){
    setTimeout(()=>mountPhase8(attempt+1),250);
    return;
  }
  renderAlertIntel();
  renderPublicationHistory();
  renderConcentration();
  wirePhase8Downloads();
}

async function loadPhase8(){
  const r=await fetch(`data/dashboard.json?v=${Date.now()}`);
  if(!r.ok) throw new Error(`dashboard.json ${r.status}`);
  p8data=await r.json();
  mountPhase8();
}

loadPhase8().catch(err=>console.error('Phase 8 UI error',err));
