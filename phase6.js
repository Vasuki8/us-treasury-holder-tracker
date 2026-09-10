const p6fmtB=v=>v==null?'—':`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
const p6fmtPct=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}%`;
const p6plainPct=v=>v==null?'—':`${Number(v).toFixed(1)}%`;
const p6signedB=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}B`;
const p6esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let p6data;

function ensurePhase6Scaffold(){
  const eyebrow=document.querySelector('.eyebrow');
  if(eyebrow) eyebrow.textContent='OFFICIAL-DATA DASHBOARD · PHASE 6';

  const downloads=document.querySelector('.download-row');
  if(downloads&&!document.getElementById('downloadHistoryCsv')){
    downloads.insertAdjacentHTML('beforeend','<button id="downloadHistoryCsv" type="button">Download history CSV</button><button id="downloadSourceCsv" type="button">Download sources CSV</button>');
  }

  const moverPanel=document.getElementById('moverTable')?.closest('.panel');
  if(moverPanel&&!document.getElementById('alertTable')){
    moverPanel.insertAdjacentHTML('afterend',`<section class="panel">
      <div class="panel-head">
        <div><h2>Unusual Holder-Change Monitor</h2><p id="alertMeta"></p></div>
        <div class="panel-actions"><select id="alertScope" aria-label="Filter unusual changes"><option value="all">All scopes</option><option value="Foreign country">Foreign countries</option><option value="U.S. sector">U.S. sectors</option><option value="Primary dealer">Primary dealer series</option></select><button id="downloadAlertsCsv" type="button">Download alerts CSV</button></div>
      </div>
      <div class="metric-strip" id="alertMetrics"></div>
      <div class="table-wrap table-tall"><table><thead><tr><th>Severity</th><th>Scope</th><th>Holder / series</th><th>Period</th><th>Change</th><th>% change</th><th>Vs baseline</th><th>As of</th></tr></thead><tbody id="alertTable"></tbody></table></div>
      <div class="note inline-note">Flags identify changes that are unusually large relative to the available history and a source-specific dollar floor. They are research signals, not forecasts or trading recommendations.</div>
    </section>`);
  }

  const sourcePanel=document.getElementById('sourceHealth')?.closest('.panel');
  if(sourcePanel&&!document.getElementById('provenanceTable')){
    sourcePanel.insertAdjacentHTML('afterend',`<section class="panel">
      <div class="panel-head"><div><h2>Audit Trail & Source Provenance</h2><p id="provenanceMeta"></p></div><input id="provenanceSearch" type="search" placeholder="Search source, cadence, status…" /></div>
      <div class="metric-strip metric-four" id="provenanceMetrics"></div>
      <div class="table-wrap table-tall provenance-table"><table><thead><tr><th>Dataset</th><th>Observation date</th><th>Cadence</th><th>Health</th><th>Last checked</th><th>Official links</th></tr></thead><tbody id="provenanceTable"></tbody></table></div>
      <div class="note inline-note">Observation date and retrieval time are intentionally separate. A healthy source can legitimately report an older monthly or quarterly observation even though the website checked it today.</div>
    </section>`);
  }
}

async function loadPhase6(){
  ensurePhase6Scaffold();
  const r=await fetch(`data/dashboard.json?v=${Date.now()}`);
  if(!r.ok) throw new Error(`dashboard.json ${r.status}`);
  p6data=await r.json();
  renderUnusualAlerts();
  renderProvenance();
  renderSecurityAuditTable();
  wirePhase6Downloads();
  decorateMajorSourceLinks();
  setTimeout(decorateMajorSourceLinks,500);
  setTimeout(decorateMajorSourceLinks,1500);
  setTimeout(renderSecurityAuditTable,700);
}

function p6SourceUrl(key){
  const row=(p6data.provenance?.sources||[]).find(r=>r.key===key);
  return row?.urls?.[0]?.url||null;
}

function p6AppendSource(targetId,key){
  const el=document.getElementById(targetId), url=p6SourceUrl(key);
  if(!el||!url||el.querySelector('.inline-source')) return;
  const span=document.createElement('span');
  span.className='inline-source';
  span.innerHTML=` · <a href="${p6esc(url)}" target="_blank" rel="noopener noreferrer">official source</a>`;
  el.appendChild(span);
}

function decorateMajorSourceLinks(){
  const targets={
    govMeta:'government_accounts',foreignMeta:'foreign_holders',somaMeta:'soma',institutionMeta:'institutional_aggregates',
    extendedMeta:'extended_holders',dealerMeta:'primary_dealers',mmfMeta:'money_market_funds',auctionMeta:'auctions',sectorMeta:'domestic_sectors'
  };
  for(const [id,key] of Object.entries(targets)) p6AppendSource(id,key);

  const cards=[...(document.querySelectorAll('#overviewCards .card')||[])];
  const keys=['overview','overview','fed','foreign_holders','institutional_aggregates','primary_dealers','money_market_funds','money_market_funds'];
  cards.forEach((card,i)=>{
    const meta=card.querySelector('.meta'), url=p6SourceUrl(keys[i]);
    if(!meta||!url||meta.querySelector('.inline-source')) return;
    const span=document.createElement('span');
    span.className='inline-source';
    span.innerHTML=` · <a href="${p6esc(url)}" target="_blank" rel="noopener noreferrer">source</a>`;
    meta.appendChild(span);
  });
}

function renderSecurityAuditTable(){
  const block=p6data.security_intelligence||{}, rows=block.rows||[];
  const table=document.getElementById('securityTable');
  const search=document.getElementById('cusipSearch');
  if(!table) return;
  const head=table.closest('table')?.querySelector('thead tr');
  if(head&&!head.querySelector('[data-p6-security-col]')){
    head.insertAdjacentHTML('beforeend','<th data-p6-security-col="maturity">Years to maturity</th><th data-p6-security-col="sources">Matched sources</th>');
  }
  const draw=()=>{
    const q=(search?.value||'').trim().toLowerCase();
    const filtered=!q?rows:rows.filter(r=>`${r.cusip||''} ${r.security_type||''} ${r.maturity_date||''} ${r.auction_security_term||''} ${(r.source_keys||[]).join(' ')}`.toLowerCase().includes(q));
    table.innerHTML=filtered.map(r=>{
      const sources=(r.source_keys||[]).map(key=>{
        const url=p6SourceUrl(key);
        return url?`<a class="audit-link" href="${p6esc(url)}" target="_blank" rel="noopener noreferrer">${p6esc(key.toUpperCase())}</a>`:p6esc(key.toUpperCase());
      }).join(' ');
      return `<tr><td>${p6esc(r.cusip)}</td><td>${p6esc(r.security_type||'—')}</td><td>${p6esc(r.maturity_date||'—')}</td><td>${p6fmtB(r.soma_par_billions)}</td><td>${p6plainPct(r.soma_pct_outstanding)}</td><td>${p6esc(r.latest_auction_date||'—')}</td><td>${p6fmtB(r.auction_offering_billions)}</td><td>${p6fmtB(r.nport_fund_value_billions)}</td><td>${r.nport_fund_count??'—'}</td><td>${r.years_to_maturity==null?'—':Number(r.years_to_maturity).toFixed(1)}</td><td class="links-cell">${sources||'—'}</td></tr>`;
    }).join('');
  };
  if(search) search.oninput=draw;
  draw();
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
