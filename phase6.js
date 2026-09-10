const p6fmtB=v=>v==null?'—':`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
const p6fmtPct=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`;
const p6signedB=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}B`;
const p6esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
let p6data;

async function loadPhase6(){
  const r=await fetch(`data/dashboard.json?v=${Date.now()}`);
  if(!r.ok) throw new Error(`dashboard.json ${r.status}`);
  p6data=await r.json();
  renderUnusualAlerts();
  renderProvenance();
  wirePhase6Downloads();
}

function renderUnusualAlerts(){
  const block=p6data.unusual_change_alerts||{}, rows=block.alerts||[];
  const meta=document.getElementById('alertMeta');
  if(meta) meta.textContent=block.method||'';
  const metrics=document.getElementById('alertMetrics');
  if(metrics) metrics.innerHTML=[
    ['Flagged changes',block.alert_count??rows.length],
    ['High severity',block.high_count??rows.filter(r=>r.severity==='high').length],
    ['Method','History-relative']
  ].map(([k,v])=>`<div class="mini"><span>${p6esc(k)}</span><strong>${p6esc(v)}</strong></div>`).join('');

  const table=document.getElementById('alertTable');
  const scope=document.getElementById('alertScope');
  if(!table) return;
  const draw=()=>{
    const selected=scope?.value||'all';
    const filtered=selected==='all'?rows:rows.filter(r=>r.scope===selected);
    table.innerHTML=filtered.length?filtered.map(r=>`<tr>
      <td><span class="alert-badge ${p6esc(r.severity||'medium')}">${p6esc(r.severity||'flag')}</span></td>
      <td>${p6esc(r.scope)}</td>
      <td>${p6esc(r.name)}</td>
      <td>${p6esc(r.period)}</td>
      <td class="${(r.change_billions||0)>=0?'up':'down'}">${p6signedB(r.change_billions)}</td>
      <td class="${(r.change_pct||0)>=0?'up':'down'}">${p6fmtPct(r.change_pct)}</td>
      <td>${r.multiple_of_baseline==null?'—':`${Number(r.multiple_of_baseline).toFixed(1)}×`}</td>
      <td>${p6esc(r.as_of||'—')}</td>
    </tr>`).join(''):`<tr><td colspan="8" class="empty-cell">No changes currently meet the unusual-change screening rule for this filter.</td></tr>`;
  };
  if(scope) scope.onchange=draw;
  draw();
}

function renderProvenance(){
  const block=p6data.provenance||{}, rows=block.sources||[];
  const meta=document.getElementById('provenanceMeta');
  if(meta) meta.textContent=block.note||'';
  const metrics=document.getElementById('provenanceMetrics');
  if(metrics){
    const healthy=rows.filter(r=>r.status==='ok').length;
    const problems=rows.filter(r=>r.status==='error').length;
    metrics.innerHTML=[
      ['Tracked sources',block.source_count??rows.length],
      ['Series IDs',block.series_count??0],
      ['Healthy sources',healthy],
      ['Source errors',problems]
    ].map(([k,v])=>`<div class="mini"><span>${p6esc(k)}</span><strong>${p6esc(v)}</strong></div>`).join('');
  }

  const table=document.getElementById('provenanceTable');
  const search=document.getElementById('provenanceSearch');
  if(!table) return;
  const draw=()=>{
    const q=(search?.value||'').toLowerCase().trim();
    const filtered=!q?rows:rows.filter(r=>`${r.name||''} ${r.key||''} ${r.frequency||''} ${r.status||''}`.toLowerCase().includes(q));
    table.innerHTML=filtered.map(r=>{
      const links=(r.urls||[]).map(u=>`<a class="audit-link" href="${p6esc(u.url)}" target="_blank" rel="noopener noreferrer">${p6esc(u.label)}</a>`).join(' ');
      return `<tr>
        <td>${p6esc(r.name)}</td>
        <td>${p6esc(r.as_of||'—')}</td>
        <td>${p6esc(r.frequency||'—')}</td>
        <td><span class="pill ${p6esc(r.status||'seed')}">${p6esc(r.status||'unknown')}</span></td>
        <td>${r.checked_at?p6esc(new Date(r.checked_at).toLocaleString()):'—'}</td>
        <td class="links-cell">${links||'—'}</td>
      </tr>`;
    }).join('');
  };
  if(search) search.oninput=draw;
  draw();
}

function wirePhase6Downloads(){
  const h=document.getElementById('downloadHistoryCsv');
  const s=document.getElementById('downloadSourceCsv');
  const a=document.getElementById('downloadAlertsCsv');
  if(h) h.onclick=()=>downloadBlob('treasury-holder-history.csv',buildPhase6HistoryCsv(),'text/csv;charset=utf-8');
  if(s) s.onclick=()=>downloadBlob('treasury-source-provenance.csv',buildPhase6SourceCsv(),'text/csv;charset=utf-8');
  if(a) a.onclick=()=>downloadBlob('treasury-unusual-change-alerts.csv',buildPhase6AlertsCsv(),'text/csv;charset=utf-8');
}

function buildPhase6HistoryCsv(){
  const rows=[['dataset','series','name','observation_date','value_billions','metric']];
  for(const r of p6data.foreign_holders?.countries||[]){
    for(const h of r.history||[]) rows.push(['TIC','',r.name,h.period,h.holdings_billions,'Treasury holdings']);
  }
  for(const r of p6data.institutional_aggregates?.institutions||[]){
    for(const h of r.history||[]) rows.push(['Financial Accounts',r.series||'',r.name,h.date,h.value_billions,'Treasury holdings']);
  }
  for(const r of p6data.extended_holders?.holders||[]){
    for(const h of r.history||[]) rows.push(['Financial Accounts',r.series||'',r.name,h.date,h.value_billions,'Treasury holdings']);
  }
  for(const r of p6data.primary_dealers?.series||[]){
    for(const h of r.history||[]) rows.push(['NY Fed Primary Dealers',r.keyid||r.series||'',r.name,h.date,h.value_billions,'Net position / fails']);
  }
  for(const h of p6data.history||[]){
    if(h.debt_held_by_public_trillions!=null) rows.push(['Tracker snapshot','','Debt held by public',h.snapshot_date,Number(h.debt_held_by_public_trillions)*1000,'Daily tracker snapshot']);
    if(h.foreign_holdings_billions!=null) rows.push(['Tracker snapshot','','Foreign holders',h.snapshot_date,h.foreign_holdings_billions,'Daily tracker snapshot']);
    if(h.fed_treasuries_billions!=null) rows.push(['Tracker snapshot','','Federal Reserve',h.snapshot_date,h.fed_treasuries_billions,'Daily tracker snapshot']);
    if(h.us_banks_treasuries_billions!=null) rows.push(['Tracker snapshot','','U.S. banks',h.snapshot_date,h.us_banks_treasuries_billions,'Daily tracker snapshot']);
  }
  return rows.map(r=>r.map(csvCell).join(',')).join('\n');
}

function buildPhase6SourceCsv(){
  const rows=[['type','section','name','series','as_of','frequency','status','checked_at','source_url']];
  for(const r of p6data.provenance?.sources||[]){
    const urls=(r.urls||[]).map(u=>u.url).join(' | ');
    rows.push(['source',r.key,r.name,'',r.as_of||'',r.frequency||'',r.status||'',r.checked_at||'',urls]);
  }
  for(const r of p6data.provenance?.series||[]){
    rows.push(['series',r.section,r.name||'',r.series||'',r.as_of||'','','','',r.source_url||'']);
  }
  return rows.map(r=>r.map(csvCell).join(',')).join('\n');
}

function buildPhase6AlertsCsv(){
  const rows=[['severity','scope','name','period','as_of','previous_as_of','current_billions','change_billions','change_pct','baseline_abs_change_billions','multiple_of_baseline','reason']];
  for(const r of p6data.unusual_change_alerts?.alerts||[]){
    rows.push([r.severity,r.scope,r.name,r.period,r.as_of,r.previous_as_of,r.current_billions,r.change_billions,r.change_pct,r.baseline_abs_change_billions,r.multiple_of_baseline,r.reason]);
  }
  return rows.map(r=>r.map(csvCell).join(',')).join('\n');
}

loadPhase6().catch(err=>console.error('Phase 6 UI error',err));
