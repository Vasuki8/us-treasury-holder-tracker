const p10esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p10pct=(v,d=1)=>v==null?'—':`${Number(v).toFixed(d)}%`;
const p10signedPct=(v,d=1)=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(d)} pp`;
let p10data;
let p10RegimeChart;

function ensurePhase10Scaffold(){
  const eyebrow=document.querySelector('.eyebrow');
  if(eyebrow) eyebrow.textContent='OFFICIAL-DATA DASHBOARD · PHASE 10';

  const lede=document.querySelector('.lede');
  if(lede) lede.textContent='Who holds U.S. Treasury securities — with source-specific dates, holder drill-downs, cross-holder flow regimes, release-freshness diagnostics, persistent alerts and CUSIP-level concentration intelligence.';

  const downloads=document.querySelector('.download-row');
  if(downloads&&!document.getElementById('downloadReleaseCalendarCsv')){
    downloads.insertAdjacentHTML('beforeend','<button id="downloadReleaseCalendarCsv" type="button">Download release calendar CSV</button><button id="downloadRegimeHistoryCsv" type="button">Download regime history CSV</button>');
  }

  const overview=document.getElementById('overviewCards');
  if(overview&&!document.getElementById('researchBriefPanel')){
    overview.insertAdjacentHTML('afterend',`<section class="panel research-brief-panel" id="researchBriefPanel">
      <div class="panel-head"><div><h2>Research Brief</h2><p id="researchBriefMeta"></p></div><span class="phase-chip">RULE-BASED · OFFICIAL DATA</span></div>
      <div id="researchBriefCards" class="insight-grid"></div>
    </section>`);
  }

  const publication=document.getElementById('publicationPanel');
  if(publication&&!document.getElementById('releaseCalendarPanel')){
    publication.insertAdjacentHTML('afterend',`<section class="panel" id="releaseCalendarPanel">
      <div class="panel-head">
        <div><h2>Release Calendar & Freshness Monitor</h2><p id="releaseCalendarMeta"></p></div>
        <div class="panel-actions"><select id="releaseStatusFilter"><option value="all">All statuses</option><option value="attention">Needs attention</option><option value="overdue">Overdue</option><option value="due_soon">Due soon</option><option value="new_release">New release</option><option value="scheduled">Scheduled</option><option value="access_limited">Access limited</option></select><input id="releaseSearch" type="search" placeholder="Search dataset…" /></div>
      </div>
      <div class="metric-strip metric-four" id="releaseCalendarMetrics"></div>
      <div class="table-wrap table-tall release-calendar-table"><table><thead><tr><th>Status</th><th>Dataset</th><th>Last observation</th><th>Expected next obs.</th><th>Expected publication</th><th>Timing</th><th>Cadence</th></tr></thead><tbody id="releaseCalendarTable"></tbody></table></div>
      <div class="note inline-note">Expected dates are operational estimates based on normal source cadence, not publisher commitments. The calendar deliberately avoids calling event-driven auctions or access-limited SEC bulk feeds overdue from cadence alone.</div>
    </section>`);
  }

  const flow=document.getElementById('flowIntelligencePanel');
  if(flow&&!document.getElementById('flowRegimePanel')){
    flow.insertAdjacentHTML('afterend',`<section class="panel" id="flowRegimePanel">
      <div class="panel-head"><div><h2>Flow Regime History</h2><p id="flowRegimeMeta"></p></div><select id="regimeScopeSelect"></select></div>
      <div class="metric-strip metric-four" id="regimeHeadlineMetrics"></div>
      <div class="grid-2">
        <div class="chart-wrap"><canvas id="regimeHistoryChart"></canvas></div>
        <div class="table-wrap"><table><thead><tr><th>Scope</th><th>Regime</th><th>Breadth</th><th>Δ breadth</th><th>Duration</th><th>Observation</th></tr></thead><tbody id="currentRegimeTable"></tbody></table></div>
      </div>
      <div class="subsection-head"><strong>Cross-scope regime transitions</strong><span>Directional comparison only; monthly and quarterly dollar changes remain separate.</span></div>
      <div class="table-wrap table-tall"><table><thead><tr><th>Detected</th><th>Regime</th><th>Foreign breadth</th><th>U.S. sector breadth</th><th>Gap</th><th>Changed?</th></tr></thead><tbody id="crossRegimeTable"></tbody></table></div>
      <div class="note inline-note">A history point is stored only when a source observation changes. Daily updater runs with unchanged monthly/quarterly/weekly data do not create duplicate regime points.</div>
    </section>`);
  }
}

function p10StatusLabel(status){
  return String(status||'unknown').replaceAll('_',' ');
}

function p10Timing(row){
  if(row.days_to_expected==null) return '—';
  const n=Number(row.days_to_expected);
  if(row.calendar_status==='overdue') return `${Number(row.overdue_days||0)}d overdue`;
  if(n<0) return `${Math.abs(n)}d past estimate`;
  if(n===0) return 'Expected today';
  if(n===1) return 'Expected tomorrow';
  return `In ${n} days`;
}

function renderResearchBrief(){
  const block=p10data?.research_brief||{};
  const meta=document.getElementById('researchBriefMeta');
  if(meta) meta.textContent=block.note||'';
  const cards=document.getElementById('researchBriefCards');
  const items=block.items||[];
  if(cards) cards.innerHTML=items.length?items.map(item=>`<article class="insight-card ${p10esc(item.severity||'neutral')}"><div class="insight-top"><span>${p10esc(item.category||'Research')}</span><span class="insight-state">${p10esc(item.severity||'neutral')}</span></div><strong>${p10esc(item.title||'Insight')}</strong><p>${p10esc(item.text||'')}</p><small>${p10esc(item.caveat||'')}</small></article>`).join(''):'<div class="empty-state">No rule-based research brief is available yet.</div>';
}

function renderReleaseCalendar(){
  const block=p10data?.release_calendar||{}, rows=block.rows||[], counts=block.status_counts||{};
  const meta=document.getElementById('releaseCalendarMeta');
  if(meta) meta.textContent=`Tracker date ${block.today||'—'} · ${block.note||''}`;
  const metrics=document.getElementById('releaseCalendarMetrics');
  if(metrics) metrics.innerHTML=[
    ['Needs attention',block.attention_count??0],
    ['Overdue estimates',counts.overdue??0],
    ['Due / due soon',(counts.due_now??0)+(counts.grace_window??0)+(counts.due_soon??0)],
    ['New observations today',counts.new_release??0]
  ].map(([k,v])=>`<div class="mini"><span>${p10esc(k)}</span><strong>${p10esc(v)}</strong></div>`).join('');

  const filter=document.getElementById('releaseStatusFilter');
  const search=document.getElementById('releaseSearch');
  const table=document.getElementById('releaseCalendarTable');
  const attention=new Set(['overdue','source_error','due_now','grace_window','due_soon']);
  const draw=()=>{
    if(!table) return;
    const f=filter?.value||'all', q=(search?.value||'').trim().toLowerCase();
    const filtered=rows.filter(row=>{
      const status=row.calendar_status||'';
      const statusOk=f==='all'||(f==='attention'?attention.has(status):status===f);
      const text=`${row.name||''} ${row.key||''} ${row.frequency||''} ${row.method||''}`.toLowerCase();
      return statusOk&&(!q||text.includes(q));
    });
    table.innerHTML=filtered.length?filtered.map(row=>`<tr title="${p10esc(row.method||'')}"><td><span class="calendar-badge ${p10esc(row.calendar_status||'unscheduled')}">${p10esc(p10StatusLabel(row.calendar_status))}</span></td><td>${p10esc(row.name||row.key||'—')}</td><td>${p10esc(row.last_observation||'—')}</td><td>${p10esc(row.expected_next_observation||'—')}</td><td>${p10esc(row.expected_publication_date||'—')}</td><td>${p10esc(p10Timing(row))}</td><td>${p10esc(row.frequency||'—')}</td></tr>`).join(''):'<tr><td colspan="7" class="empty-cell">No datasets match this filter.</td></tr>';
  };
  if(filter) filter.onchange=draw;
  if(search) search.oninput=draw;
  draw();
}

function regimeEventsFor(scope){
  return (p10data?.flow_regime_history?.events||[]).filter(r=>r.scope===scope);
}

function renderRegimeChart(){
  const select=document.getElementById('regimeScopeSelect');
  const canvas=document.getElementById('regimeHistoryChart');
  if(!select||!canvas||!window.Chart) return;
  const rows=regimeEventsFor(select.value);
  const labels=rows.map(r=>(r.observation_dates||[]).join(' / ')||String(r.detected_at||'').slice(0,10));
  if(p10RegimeChart) p10RegimeChart.destroy();
  p10RegimeChart=new Chart(canvas,{type:'line',data:{labels,datasets:[{label:'Accumulation breadth %',data:rows.map(r=>r.accumulation_breadth_pct),tension:.2},{label:'Neutral 50%',data:rows.map(()=>50),borderDash:[5,5],pointRadius:0}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true}},scales:{y:{min:0,max:100,ticks:{callback:v=>`${v}%`}}}}});
}

function renderFlowRegimes(){
  const block=p10data?.flow_regime_history||{}, current=block.current||[];
  const meta=document.getElementById('flowRegimeMeta');
  if(meta) meta.textContent=block.note||'';
  const cross=block.current_cross_scope||{};
  const foreign=current.find(r=>r.scope==='Foreign country')||{};
  const domestic=current.find(r=>r.scope==='U.S. sector')||{};
  const metrics=document.getElementById('regimeHeadlineMetrics');
  if(metrics) metrics.innerHTML=[
    ['Foreign breadth',p10pct(foreign.accumulation_breadth_pct)],
    ['U.S. sector breadth',p10pct(domestic.accumulation_breadth_pct)],
    ['Current cross-scope regime',p10esc(cross.regime||'—')],
    ['Stored regime points',block.event_count??0]
  ].map(([k,v])=>`<div class="mini"><span>${p10esc(k)}</span><strong>${v}</strong></div>`).join('');

  const table=document.getElementById('currentRegimeTable');
  if(table) table.innerHTML=current.map(r=>`<tr><td>${p10esc(r.scope)}</td><td><span class="regime-badge ${p10esc(String(r.regime||'mixed').replaceAll(' ','-'))}">${p10esc(r.regime||'—')}</span></td><td>${p10pct(r.accumulation_breadth_pct)}</td><td>${p10signedPct(r.breadth_change_pp)}</td><td>${p10esc(r.regime_duration_observations??1)} obs.</td><td>${p10esc((r.observation_dates||[]).join(', ')||'—')}</td></tr>`).join('');

  const select=document.getElementById('regimeScopeSelect');
  if(select){
    const scopes=current.map(r=>r.scope).filter(Boolean);
    const old=select.value;
    select.innerHTML=scopes.map(s=>`<option value="${p10esc(s)}">${p10esc(s)}</option>`).join('');
    if(scopes.includes(old)) select.value=old;
    select.onchange=renderRegimeChart;
  }
  renderRegimeChart();

  const crossTable=document.getElementById('crossRegimeTable');
  const crossRows=(block.cross_scope_events||[]).slice().reverse().slice(0,50);
  if(crossTable) crossTable.innerHTML=crossRows.length?crossRows.map(r=>`<tr><td>${p10esc(String(r.detected_at||'').replace('T',' ').replace('Z',' UTC'))}</td><td><span class="regime-badge cross">${p10esc(r.regime||'—')}</span></td><td>${p10pct(r.foreign_breadth_pct)}</td><td>${p10pct(r.us_sector_breadth_pct)}</td><td>${p10signedPct(r.divergence_pct_points)}</td><td>${r.regime_changed?'<span class="state-badge unknown">changed</span>':'—'}</td></tr>`).join(''):'<tr><td colspan="6" class="empty-cell">Cross-scope regime history will grow as official source periods advance.</td></tr>';
}

function p10csvCell(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}
function p10download(name,text){const blob=new Blob([text],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);}
function releaseCalendarCsv(){
  const rows=[['status','dataset_key','dataset','frequency','last_observation','expected_next_observation','expected_publication_date','days_to_expected','overdue_days','source_status','schedule_kind','method']];
  for(const r of p10data?.release_calendar?.rows||[]) rows.push([r.calendar_status,r.key,r.name,r.frequency,r.last_observation,r.expected_next_observation,r.expected_publication_date,r.days_to_expected,r.overdue_days,r.source_status,r.schedule_kind,r.method]);
  return rows.map(r=>r.map(p10csvCell).join(',')).join('\n');
}
function regimeHistoryCsv(){
  const rows=[['event_id','scope','regime','detected_at','observation_dates','frequencies','breadth_pct','momentum_score','breadth_change_pp','accumulating','reducing','flat','median_change_pct','previous_regime','regime_changed']];
  for(const r of p10data?.flow_regime_history?.events||[]) rows.push([r.event_id,r.scope,r.regime,r.detected_at,(r.observation_dates||[]).join('|'),(r.frequencies||[]).join('|'),r.accumulation_breadth_pct,r.momentum_score,r.breadth_change_pp,r.accumulating_count,r.reducing_count,r.flat_count,r.median_change_pct,r.previous_regime,r.regime_changed]);
  return rows.map(r=>r.map(p10csvCell).join(',')).join('\n');
}
function wirePhase10Downloads(){
  document.getElementById('downloadReleaseCalendarCsv')?.addEventListener('click',()=>p10download('treasury-release-calendar.csv',releaseCalendarCsv()));
  document.getElementById('downloadRegimeHistoryCsv')?.addEventListener('click',()=>p10download('treasury-flow-regime-history.csv',regimeHistoryCsv()));
}

async function loadPhase10(){
  ensurePhase10Scaffold();
  const r=await fetch(`data/dashboard.json?v=${Date.now()}`);
  if(!r.ok) throw new Error(`dashboard.json ${r.status}`);
  p10data=await r.json();
  ensurePhase10Scaffold();
  renderResearchBrief();
  renderReleaseCalendar();
  renderFlowRegimes();
  wirePhase10Downloads();
}

loadPhase10().catch(err=>console.error('Phase 10 UI error',err));
