const p9esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p9fmtB=v=>v==null?'—':`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
const p9fmtPct=(v,d=1)=>v==null?'—':`${Number(v).toFixed(d)}%`;
const p9fmtSignedB=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}B`;
const p9fmtSignedPct=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`;
let p9data;
let p9profileChart;
let p9breadthChart;

function ensurePhase9Scaffold(){
  const eyebrow=document.querySelector('.eyebrow');
  if(eyebrow) eyebrow.textContent='OFFICIAL-DATA DASHBOARD · PHASE 9';

  const downloads=document.querySelector('.download-row');
  if(downloads&&!document.getElementById('downloadHolderProfilesCsv')){
    downloads.insertAdjacentHTML('beforeend','<button id="downloadHolderProfilesCsv" type="button">Download holder profiles CSV</button><button id="downloadFlowCsv" type="button">Download flow intelligence CSV</button>');
  }

  const foreignTrend=document.getElementById('foreignTrendChart')?.closest('.panel');
  if(foreignTrend&&!document.getElementById('holderProfilePanel')){
    foreignTrend.insertAdjacentHTML('afterend',`<section class="panel" id="holderProfilePanel">
      <div class="panel-head">
        <div><h2>Holder Profile Explorer</h2><p id="holderProfileMeta"></p></div>
        <div class="panel-actions"><select id="holderProfileScope"></select><select id="holderProfileSelect"></select></div>
      </div>
      <div class="metric-strip metric-four" id="holderProfileMetrics"></div>
      <div class="grid-2">
        <div><div class="chart-wrap"><canvas id="holderProfileChart"></canvas></div></div>
        <div>
          <div class="detail-grid" id="holderProfileDetails"></div>
          <div class="table-wrap table-tall"><table><thead><tr><th>Observation</th><th>Value</th><th>Change</th><th>Change %</th></tr></thead><tbody id="holderProfileHistory"></tbody></table></div>
        </div>
      </div>
      <div class="note inline-note">Profiles preserve source semantics: foreign countries and U.S. sectors represent holdings; primary-dealer profiles represent market positioning, not ownership. “Share of tracked scope” is a navigation/concentration aid and is not a universal Treasury ownership share.</div>
    </section>`);
  }

  const moverPanel=document.getElementById('moverTable')?.closest('.panel');
  if(moverPanel&&!document.getElementById('flowIntelligencePanel')){
    moverPanel.insertAdjacentHTML('afterend',`<section class="panel" id="flowIntelligencePanel">
      <div class="panel-head"><div><h2>Cross-Holder Flow Intelligence</h2><p id="flowIntelMeta"></p></div></div>
      <div class="metric-strip metric-four" id="flowHeadlineMetrics"></div>
      <div class="grid-2">
        <div class="chart-wrap compact"><canvas id="flowBreadthChart"></canvas></div>
        <div class="table-wrap"><table><thead><tr><th>Scope</th><th>Cadence</th><th>Accumulating</th><th>Reducing</th><th>Breadth</th><th>Median change</th></tr></thead><tbody id="flowScopeTable"></tbody></table></div>
      </div>
      <div class="subsection-head"><strong>Largest latest changes by scope</strong><span>Changes are never summed across monthly, quarterly and weekly datasets.</span></div>
      <div class="table-wrap table-tall"><table><thead><tr><th>Scope</th><th>Direction</th><th>Holder / series</th><th>Observation</th><th>Change</th><th>Change %</th></tr></thead><tbody id="flowMoverTable"></tbody></table></div>
      <div class="subsection-head"><strong>Cross-scope signals</strong><span>Directional breadth only; different source cadences remain separate.</span></div>
      <div id="flowSignals" class="signal-grid"></div>
      <div class="note inline-note">Phase 9 deliberately avoids a fake “net Treasury flow” created by adding monthly TIC changes, quarterly Financial Accounts changes and weekly dealer positions. Cross-scope comparisons use directional breadth and are labeled with their cadence limitations.</div>
    </section>`);
  }
}

function p9detail(label,value){return `<div class="detail-item"><span>${p9esc(label)}</span><strong>${value??'—'}</strong></div>`;}

function holderProfiles(){return p9data?.holder_profiles?.profiles||[];}

function renderProfileSelectors(){
  const profiles=holderProfiles();
  const scope=document.getElementById('holderProfileScope');
  const select=document.getElementById('holderProfileSelect');
  if(!scope||!select) return;
  const scopes=[...new Set(profiles.map(p=>p.scope).filter(Boolean))];
  scope.innerHTML=scopes.map(s=>`<option value="${p9esc(s)}">${p9esc(s)}</option>`).join('');
  const refresh=()=>{
    const filtered=profiles.filter(p=>p.scope===scope.value);
    const old=select.value;
    select.innerHTML=filtered.map(p=>`<option value="${p9esc(p.profile_id)}">${p9esc(p.name)}</option>`).join('');
    if(filtered.some(p=>p.profile_id===old)) select.value=old;
    renderSelectedProfile();
  };
  scope.onchange=refresh;
  select.onchange=renderSelectedProfile;
  refresh();
}

function renderSelectedProfile(){
  const select=document.getElementById('holderProfileSelect');
  if(!select) return;
  const profile=holderProfiles().find(p=>p.profile_id===select.value);
  if(!profile) return;
  const meta=document.getElementById('holderProfileMeta');
  if(meta) meta.textContent=`${profile.scope} · ${profile.frequency||'—'} · ${profile.source_name||profile.source_key||'—'} · latest observation ${profile.as_of||'—'}`;

  const metrics=document.getElementById('holderProfileMetrics');
  const share=profile.scope==='Foreign country'?profile.share_of_foreign_total_pct:profile.share_of_tracked_scope_pct;
  if(metrics) metrics.innerHTML=[
    ['Current',p9fmtB(profile.current_billions)],
    ['Latest change',`${p9fmtSignedB(profile.change_billions)} · ${p9fmtSignedPct(profile.change_pct)}`],
    ['Rank in scope',profile.rank_within_scope??'—'],
    [profile.scope==='Foreign country'?'Share of foreign total':'Share of tracked scope',p9fmtPct(share)]
  ].map(([k,v])=>`<div class="mini"><span>${p9esc(k)}</span><strong>${v}</strong></div>`).join('');

  const details=document.getElementById('holderProfileDetails');
  if(details) details.innerHTML=
    p9detail('Concept',p9esc(profile.concept==='market_positioning'?'Market positioning':'Current holdings'))+
    p9detail('Series',p9esc(profile.series||'—'))+
    p9detail('Alert severity',profile.alert_severity?`<span class="alert-badge ${p9esc(profile.alert_severity)}">${p9esc(profile.alert_severity)}</span>`:'—')+
    p9detail('Diagnostic',p9esc(profile.diagnostic_label||'—'))+
    p9detail('Abs-move percentile',p9fmtPct(profile.abs_change_percentile))+
    p9detail('Robust z',profile.robust_z==null?'—':Number(profile.robust_z).toFixed(2))+
    p9detail('Source',profile.source_url?`<a class="audit-link" href="${p9esc(profile.source_url)}" target="_blank" rel="noopener">${p9esc(profile.source_name||'Official source')}</a>`:p9esc(profile.source_name||'—'))+
    p9detail('First alert seen',p9esc(profile.alert_first_seen_at||'—'));

  const history=profile.history||[];
  const table=document.getElementById('holderProfileHistory');
  if(table){
    const rows=[];
    for(let i=history.length-1;i>=0;i--){
      const cur=history[i], prev=i>0?history[i-1]:null;
      const ch=prev?Number(cur.value_billions)-Number(prev.value_billions):null;
      const pct=prev&&Number(prev.value_billions)!==0?ch/Math.abs(Number(prev.value_billions))*100:null;
      rows.push(`<tr><td>${p9esc(cur.date)}</td><td>${p9fmtB(cur.value_billions)}</td><td class="${ch==null?'':ch>=0?'up':'down'}">${p9fmtSignedB(ch)}</td><td>${p9fmtSignedPct(pct)}</td></tr>`);
    }
    table.innerHTML=rows.join('')||'<tr><td colspan="4" class="empty-cell">This profile has no historical series stored yet.</td></tr>';
  }

  const canvas=document.getElementById('holderProfileChart');
  if(canvas&&window.Chart){
    if(p9profileChart) p9profileChart.destroy();
    p9profileChart=new Chart(canvas,{type:'line',data:{labels:history.map(h=>h.date),datasets:[{label:profile.name,data:history.map(h=>h.value_billions),tension:.2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>`$${Number(v).toLocaleString()}B`}}}}});
  }
}

function renderFlow(){
  const block=p9data?.flow_intelligence||{}, summaries=block.scope_summaries||[];
  const meta=document.getElementById('flowIntelMeta');
  if(meta) meta.textContent=block.note||'';

  const foreign=block.foreign_concentration||{};
  const sectors=summaries.find(s=>s.scope==='U.S. sector')||{};
  const foreigners=summaries.find(s=>s.scope==='Foreign country')||{};
  const dealers=summaries.find(s=>s.scope==='Primary dealer')||{};
  const metrics=document.getElementById('flowHeadlineMetrics');
  if(metrics) metrics.innerHTML=[
    ['Foreign accumulation breadth',p9fmtPct(foreigners.accumulation_breadth_pct)],
    ['U.S. sector accumulation breadth',p9fmtPct(sectors.accumulation_breadth_pct)],
    ['Dealer-series positive breadth',p9fmtPct(dealers.accumulation_breadth_pct)],
    ['Top-10 foreign share',p9fmtPct(foreign.top10_share_pct)]
  ].map(([k,v])=>`<div class="mini"><span>${p9esc(k)}</span><strong>${v}</strong></div>`).join('');

  const scopeTable=document.getElementById('flowScopeTable');
  if(scopeTable) scopeTable.innerHTML=summaries.map(s=>`<tr><td>${p9esc(s.scope)}</td><td>${p9esc((s.frequencies||[]).join(', ')||'—')}</td><td class="up">${p9esc(s.accumulating_count??0)}</td><td class="down">${p9esc(s.reducing_count??0)}</td><td>${p9fmtPct(s.accumulation_breadth_pct)}</td><td>${p9fmtSignedPct(s.median_change_pct)}</td></tr>`).join('');

  const moverRows=[];
  for(const s of summaries){
    for(const r of s.top_accumulators||[]) moverRows.push({scope:s.scope,direction:'Accumulating',...r});
    for(const r of s.top_reducers||[]) moverRows.push({scope:s.scope,direction:'Reducing',...r});
  }
  const moverTable=document.getElementById('flowMoverTable');
  if(moverTable) moverTable.innerHTML=moverRows.map(r=>`<tr><td>${p9esc(r.scope)}</td><td><span class="state-badge ${r.direction==='Accumulating'?'active':'mismatch'}">${p9esc(r.direction)}</span></td><td>${p9esc(r.name)}</td><td>${p9esc(r.as_of||'—')}</td><td class="${(r.change_billions||0)>=0?'up':'down'}">${p9fmtSignedB(r.change_billions)}</td><td>${p9fmtSignedPct(r.change_pct)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty-cell">No latest changes are available.</td></tr>';

  const signals=document.getElementById('flowSignals');
  const sigs=block.signals||[];
  if(signals) signals.innerHTML=sigs.length?sigs.map(s=>`<article class="signal-card"><span>${p9esc((s.type||'signal').replaceAll('_',' '))}</span><strong>${p9esc(s.label||'Signal')}</strong><p>${p9esc(s.description||'')}</p><small>${p9esc(s.caveat||'')}</small></article>`).join(''):'<div class="empty-state">No strong cross-scope breadth divergence or broad accumulation/reduction signal is active.</div>';

  const canvas=document.getElementById('flowBreadthChart');
  if(canvas&&window.Chart){
    if(p9breadthChart) p9breadthChart.destroy();
    p9breadthChart=new Chart(canvas,{type:'bar',data:{labels:summaries.map(s=>s.scope),datasets:[{label:'Accumulation breadth %',data:summaries.map(s=>s.accumulation_breadth_pct)}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{min:0,max:100,ticks:{callback:v=>`${v}%`}}}}});
  }
}

function csvCell(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}
function downloadText(name,text,type='text/csv;charset=utf-8'){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);}

function holderProfilesCsv(){
  const rows=[['profile_id','scope','name','concept','frequency','as_of','current_billions','previous_billions','change_billions','change_pct','rank_within_scope','share_of_tracked_scope_pct','share_of_foreign_total_pct','alert_severity','diagnostic_label','abs_change_percentile','robust_z','series','source_name','source_url']];
  for(const p of holderProfiles()) rows.push([p.profile_id,p.scope,p.name,p.concept,p.frequency,p.as_of,p.current_billions,p.previous_billions,p.change_billions,p.change_pct,p.rank_within_scope,p.share_of_tracked_scope_pct,p.share_of_foreign_total_pct,p.alert_severity,p.diagnostic_label,p.abs_change_percentile,p.robust_z,p.series,p.source_name,p.source_url]);
  return rows.map(r=>r.map(csvCell).join(',')).join('\n');
}

function flowCsv(){
  const rows=[['scope','concept','profile_count','change_count','accumulating_count','reducing_count','flat_count','accumulation_breadth_pct','median_change_pct','observation_dates','frequencies','reported_total_change_billions']];
  for(const s of p9data?.flow_intelligence?.scope_summaries||[]) rows.push([s.scope,s.concept,s.profile_count,s.change_count,s.accumulating_count,s.reducing_count,s.flat_count,s.accumulation_breadth_pct,s.median_change_pct,(s.observation_dates||[]).join('|'),(s.frequencies||[]).join('|'),s.reported_total_change_billions]);
  return rows.map(r=>r.map(csvCell).join(',')).join('\n');
}

function wirePhase9Downloads(){
  document.getElementById('downloadHolderProfilesCsv')?.addEventListener('click',()=>downloadText('treasury-holder-profiles.csv',holderProfilesCsv()));
  document.getElementById('downloadFlowCsv')?.addEventListener('click',()=>downloadText('treasury-flow-intelligence.csv',flowCsv()));
}

function wireProfileShortcuts(){
  const mapping=[['foreignTable','Foreign country'],['institutionTable','U.S. sector'],['extendedTable','U.S. sector'],['dealerTable','Primary dealer']];
  for(const [id,scope] of mapping){
    const table=document.getElementById(id);
    if(!table||table.dataset.p9wired) continue;
    table.dataset.p9wired='1';
    table.addEventListener('click',event=>{
      const row=event.target.closest('tr'); if(!row) return;
      const name=row.cells?.[0]?.textContent?.trim(); if(!name) return;
      const p=holderProfiles().find(x=>x.scope===scope&&x.name===name); if(!p) return;
      const scopeEl=document.getElementById('holderProfileScope'), select=document.getElementById('holderProfileSelect');
      if(scopeEl&&select){scopeEl.value=scope;scopeEl.dispatchEvent(new Event('change'));select.value=p.profile_id;select.dispatchEvent(new Event('change'));document.getElementById('holderProfilePanel')?.scrollIntoView({behavior:'smooth'});}
    });
  }
}

async function loadPhase9(){
  ensurePhase9Scaffold();
  const r=await fetch(`data/dashboard.json?v=${Date.now()}`);
  if(!r.ok) throw new Error(`dashboard.json ${r.status}`);
  p9data=await r.json();
  const meta=document.getElementById('holderProfileMeta');
  if(meta) meta.textContent=p9data?.holder_profiles?.note||'';
  renderProfileSelectors();
  renderFlow();
  wirePhase9Downloads();
  setTimeout(wireProfileShortcuts,500);
}

loadPhase9().catch(err=>console.error('Phase 9 UI error',err));
