const p8esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p8fmtB=v=>v==null?'—':`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
const p8fmtPct=v=>v==null?'—':`${Number(v).toFixed(1)}%`;
const p8fmtSigned=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}B`;
const p8fmtZ=v=>v==null?'—':Number(v).toFixed(2);
let p8data;

function ensurePhase8Scaffold(){
  const eyebrow=document.querySelector('.eyebrow');
  if(eyebrow) eyebrow.textContent='OFFICIAL-DATA DASHBOARD · PHASE 8';

  const lifecycle=document.getElementById('alertHistoryPanel');
  if(lifecycle&&!document.getElementById('releaseIntelligencePanel')){
    lifecycle.insertAdjacentHTML('afterend',`<section class="panel" id="releaseIntelligencePanel">
      <div class="panel-head">
        <div><h2>Release & Alert Intelligence</h2><p id="releaseIntelMeta"></p></div>
        <select id="intelScope"><option value="all">All scopes</option><option value="Foreign country">Foreign countries</option><option value="U.S. sector">U.S. sectors</option><option value="Primary dealer">Primary dealer series</option></select>
      </div>
      <div class="metric-strip metric-four" id="releaseIntelMetrics"></div>
      <div class="grid-2">
        <div>
          <div class="subsection-head"><strong>Statistical alert diagnostics</strong><span>Percentile and robust z-score add context to the threshold screen.</span></div>
          <div class="table-wrap table-tall"><table><thead><tr><th>Severity</th><th>Holder / series</th><th>Change</th><th>Abs-move percentile</th><th>Robust z</th><th>History</th><th>New?</th></tr></thead><tbody id="intelAlertTable"></tbody></table></div>
        </div>
        <div>
          <div class="subsection-head"><strong>New source observations</strong><span>Detected only when an official dataset advances to a new observation date.</span></div>
          <div class="table-wrap table-tall"><table><thead><tr><th>Dataset</th><th>Observation</th><th>Cadence</th><th>Detected</th></tr></thead><tbody id="releaseEventTable"></tbody></table></div>
        </div>
      </div>
      <div class="note inline-note">Phase 8 notification readiness is deliberately conservative: only newly opened/reopened high-severity episodes or alerts that escalate to high severity enter the notification-ready queue.</div>
    </section>`);
  }

  const drill=document.getElementById('securityDrillPanel');
  if(drill&&!document.getElementById('cusipConcentrationPanel')){
    drill.insertAdjacentHTML('afterend',`<section class="panel" id="cusipConcentrationPanel">
      <div class="panel-head"><div><h2>CUSIP Concentration Analytics</h2><p id="cusipConcentrationMeta"></p></div></div>
      <div class="metric-strip metric-four" id="cusipConcentrationMetrics"></div>
      <div class="table-wrap table-tall concentration-table"><table><thead><tr><th>Rank</th><th>CUSIP</th><th>Type</th><th>Maturity</th><th>SOMA par</th><th>SOMA % outstanding</th><th>Implied outstanding</th><th>Tier</th><th>Years left</th></tr></thead><tbody id="cusipConcentrationTable"></tbody></table></div>
      <div class="note inline-note">Implied outstanding is derived from SOMA par divided by SOMA's reported percentage outstanding. It is shown as a diagnostic rather than a separate official outstanding-amount feed.</div>
    </section>`);
  }
}

function p8date(value){
  if(!value) return '—';
  const d=new Date(value);
  return Number.isNaN(d.getTime())?p8esc(value):p8esc(d.toLocaleString());
}

function renderReleaseIntelligence(){
  const alerts=p8data.alert_intelligence||{}, publications=p8data.source_publications||{};
  const meta=document.getElementById('releaseIntelMeta');
  if(meta) meta.textContent=alerts.method||'';
  const metrics=document.getElementById('releaseIntelMetrics');
  if(metrics) metrics.innerHTML=[
    ['Active statistical alerts',alerts.alert_count??0],
    ['High severity',alerts.high_count??0],
    ['Notification-ready',alerts.notification_ready_count??0],
    ['New source observations',publications.current_release_count??0]
  ].map(([k,v])=>`<div class="mini"><span>${p8esc(k)}</span><strong>${p8esc(v)}</strong></div>`).join('');

  const scope=document.getElementById('intelScope');
  const table=document.getElementById('intelAlertTable');
  const draw=()=>{
    if(!table) return;
    const selected=scope?.value||'all';
    const rows=(alerts.rows||[]).filter(r=>selected==='all'||r.scope===selected);
    table.innerHTML=rows.length?rows.map(r=>`<tr>
      <td><span class="alert-badge ${p8esc(r.severity||'medium')}">${p8esc(r.severity||'—')}</span></td>
      <td>${p8esc(r.name||'—')}</td>
      <td class="${(r.change_billions||0)>=0?'up':'down'}">${p8fmtSigned(r.change_billions)}</td>
      <td>${p8fmtPct(r.abs_change_percentile)}</td>
      <td>${p8fmtZ(r.robust_z_score)}</td>
      <td>${p8esc(r.history_change_count??0)}</td>
      <td>${r.new_this_run?'<span class="state-badge active">NEW</span>':'—'}</td>
    </tr>`).join(''):'<tr><td colspan="7" class="empty-cell">No alerts match this scope.</td></tr>';
  };
  if(scope) scope.onchange=draw;
  draw();

  const releaseTable=document.getElementById('releaseEventTable');
  if(releaseTable){
    const rows=publications.current_releases||[];
    releaseTable.innerHTML=rows.length?rows.map(r=>`<tr><td>${p8esc(r.source_name||r.source_key||'—')}</td><td>${p8esc(r.observation_date||'—')}</td><td>${p8esc(r.frequency||'—')}</td><td>${p8date(r.detected_at)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-cell">No tracked source advanced to a new observation on this updater run.</td></tr>';
  }
}

function renderCusipConcentration(){
  const block=p8data.cusip_concentration||{}, rows=block.top_securities||[];
  const meta=document.getElementById('cusipConcentrationMeta');
  if(meta) meta.textContent=block.note||'';
  const metrics=document.getElementById('cusipConcentrationMetrics');
  if(metrics) metrics.innerHTML=[
    ['Securities ranked',block.security_count??rows.length],
    ['Very high ≥50%',block.very_high_count??0],
    ['High or above ≥25%',block.high_or_above_count??0],
    ['Median SOMA share',p8fmtPct(block.median_soma_pct_outstanding)]
  ].map(([k,v])=>`<div class="mini"><span>${p8esc(k)}</span><strong>${p8esc(v)}</strong></div>`).join('');

  const table=document.getElementById('cusipConcentrationTable');
  if(table) table.innerHTML=rows.map(r=>`<tr>
    <td>${p8esc(r.soma_concentration_rank??'—')}</td><td>${p8esc(r.cusip||'—')}</td><td>${p8esc(r.security_type||'—')}</td><td>${p8esc(r.maturity_date||'—')}</td>
    <td>${p8fmtB(r.soma_par_billions)}</td><td>${p8fmtPct(r.soma_pct_outstanding)}</td><td>${p8fmtB(r.implied_outstanding_billions)}</td>
    <td><span class="concentration-badge ${p8esc(String(r.soma_concentration_tier||'unknown').toLowerCase().replaceAll(' ','-'))}">${p8esc(r.soma_concentration_tier||'—')}</span></td>
    <td>${r.years_to_maturity==null?'—':Number(r.years_to_maturity).toFixed(2)}</td>
  </tr>`).join('');
}

async function loadPhase8(){
  ensurePhase8Scaffold();
  const r=await fetch(`data/dashboard.json?v=${Date.now()}`);
  if(!r.ok) throw new Error(`dashboard.json ${r.status}`);
  p8data=await r.json();
  renderReleaseIntelligence();
  renderCusipConcentration();
}

loadPhase8().catch(err=>console.error('Phase 8 UI error',err));
