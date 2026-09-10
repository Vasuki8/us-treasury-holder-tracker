const p11esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p11fmtB=v=>v==null?'—':`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
const p11fmtPct=(v,d=1)=>v==null?'—':`${Number(v).toFixed(d)}%`;
const p11fmtSignedPct=(v,d=1)=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(d)}%`;
let p11data;
let p11CompareChart;
let p11PaletteResults=[];
let p11PaletteIndex=0;

function p11Profiles(){return p11data?.holder_profiles?.profiles||[];}
function p11Pairs(){return p11data?.holder_comovement?.pairs||[];}

function ensurePhase11Scaffold(){
  const eyebrow=document.querySelector('.eyebrow');
  if(eyebrow) eyebrow.textContent='OFFICIAL-DATA DASHBOARD · PHASE 11';

  const heroSide=document.querySelector('.hero-side');
  if(heroSide&&!document.getElementById('openCommandPalette')){
    heroSide.insertAdjacentHTML('afterbegin','<button id="openCommandPalette" class="command-trigger" type="button" aria-label="Open dashboard search"><span>Search dashboard</span><kbd>Ctrl K</kbd></button>');
  }

  if(!document.getElementById('commandPalette')){
    document.body.insertAdjacentHTML('beforeend',`<div class="command-overlay" id="commandPalette" hidden>
      <div class="command-dialog" role="dialog" aria-modal="true" aria-label="Search Treasury tracker">
        <div class="command-search-row"><span class="command-icon">⌕</span><input id="commandSearch" type="search" autocomplete="off" placeholder="Search holders, CUSIPs, sources, alerts, sections…" /><kbd>Esc</kbd></div>
        <div class="command-hint"><span><b>↑↓</b> navigate</span><span><b>Enter</b> open</span><span id="commandCount"></span></div>
        <div id="commandResults" class="command-results"></div>
      </div>
    </div>`);
  }

  const profilePanel=document.getElementById('holderProfilePanel');
  if(profilePanel&&!document.getElementById('holderComparePanel')){
    profilePanel.insertAdjacentHTML('afterend',`<section class="panel" id="holderComparePanel">
      <div class="panel-head">
        <div><h2>Holder Comparison Workspace</h2><p id="holderCompareMeta"></p></div>
        <div class="panel-actions"><select id="compareScope"></select><select id="compareA"></select><span class="versus">vs</span><select id="compareB"></select></div>
      </div>
      <div class="metric-strip metric-four" id="compareMetrics"></div>
      <div class="grid-2">
        <div class="chart-wrap"><canvas id="holderCompareChart"></canvas></div>
        <div>
          <div class="comparison-summary" id="comparisonSummary"></div>
          <div class="table-wrap"><table><thead><tr><th>Metric</th><th id="compareAHead">A</th><th id="compareBHead">B</th></tr></thead><tbody id="compareTable"></tbody></table></div>
        </div>
      </div>
      <div class="note inline-note">The chart normalizes each selected series to 100 at its own first stored observation. Comparisons are restricted to the same semantic scope, so monthly foreign holdings are not mixed with quarterly U.S. sectors or weekly dealer positioning.</div>
    </section>`);
  }

  const comparePanel=document.getElementById('holderComparePanel');
  if(comparePanel&&!document.getElementById('comovementPanel')){
    comparePanel.insertAdjacentHTML('afterend',`<section class="panel" id="comovementPanel">
      <div class="panel-head"><div><h2>Holder Co-Movement Lens</h2><p id="comovementMeta"></p></div><select id="comovementScope"></select></div>
      <div class="metric-strip metric-four" id="comovementMetrics"></div>
      <div class="grid-2">
        <div><div class="subsection-head"><strong>Strongest positive co-movement</strong><span>Click a pair to compare.</span></div><div class="table-wrap"><table><thead><tr><th>Pair</th><th>Correlation</th><th>Same direction</th><th>Overlap</th></tr></thead><tbody id="positivePairTable"></tbody></table></div></div>
        <div><div class="subsection-head"><strong>Lowest correlation</strong><span>Divergent or weakly related histories.</span></div><div class="table-wrap"><table><thead><tr><th>Pair</th><th>Correlation</th><th>Same direction</th><th>Overlap</th></tr></thead><tbody id="lowPairTable"></tbody></table></div></div>
      </div>
      <div class="note inline-note">Correlation uses period-to-period percentage changes on common observation dates and requires at least six overlapping changes. Association does not imply causation.</div>
    </section>`);
  }
}

function p11TypeLabel(type){return ({section:'Section',holder:'Holder',security:'CUSIP',source:'Source',alert:'Alert'})[type]||type;}
function p11TypeIcon(type){return ({section:'▦',holder:'◎',security:'◇',source:'↗',alert:'!'})[type]||'•';}

function commandScore(entry,q){
  const query=q.toLowerCase().trim();
  if(!query) return entry.type==='section'?20:5;
  const title=String(entry.title||'').toLowerCase();
  const subtitle=String(entry.subtitle||'').toLowerCase();
  const keywords=String(entry.keywords||'').toLowerCase();
  let score=0;
  if(title===query) score+=120;
  if(title.startsWith(query)) score+=80;
  if(title.includes(query)) score+=55;
  if(subtitle.includes(query)) score+=25;
  if(keywords.includes(query)) score+=20;
  for(const token of query.split(/\s+/).filter(Boolean)){
    if(title.includes(token)) score+=12;
    else if(keywords.includes(token)) score+=5;
    else return -1;
  }
  return score;
}

function renderCommandResults(){
  const input=document.getElementById('commandSearch');
  const out=document.getElementById('commandResults');
  const count=document.getElementById('commandCount');
  if(!input||!out) return;
  const q=input.value;
  p11PaletteResults=(p11data?.navigation_index?.entries||[])
    .map(entry=>({entry,score:commandScore(entry,q)}))
    .filter(x=>x.score>=0)
    .sort((a,b)=>b.score-a.score||String(a.entry.title).localeCompare(String(b.entry.title)))
    .slice(0,14)
    .map(x=>x.entry);
  p11PaletteIndex=Math.max(0,Math.min(p11PaletteIndex,p11PaletteResults.length-1));
  if(count) count.textContent=`${p11data?.navigation_index?.entry_count??0} searchable items`;
  out.innerHTML=p11PaletteResults.length?p11PaletteResults.map((entry,i)=>`<button type="button" class="command-result ${i===p11PaletteIndex?'selected':''}" data-command-index="${i}"><span class="command-result-icon">${p11esc(p11TypeIcon(entry.type))}</span><span class="command-result-copy"><strong>${p11esc(entry.title)}</strong><small>${p11esc(entry.subtitle||'')}</small></span><span class="command-result-type">${p11esc(p11TypeLabel(entry.type))}</span></button>`).join(''):'<div class="command-empty">No matching dashboard item.</div>';
  out.querySelectorAll('.command-result').forEach(btn=>btn.addEventListener('click',()=>activateCommandResult(p11PaletteResults[Number(btn.dataset.commandIndex)])));
}

function openCommandPalette(){
  const overlay=document.getElementById('commandPalette');
  const input=document.getElementById('commandSearch');
  if(!overlay||!input) return;
  overlay.hidden=false;
  document.body.classList.add('command-open');
  input.value='';p11PaletteIndex=0;renderCommandResults();
  requestAnimationFrame(()=>input.focus());
}
function closeCommandPalette(){
  const overlay=document.getElementById('commandPalette');
  if(overlay) overlay.hidden=true;
  document.body.classList.remove('command-open');
}
function scrollTarget(id){
  const el=document.getElementById(id);
  if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
}

function openHolderProfile(profileId,scope){
  const scopeEl=document.getElementById('holderProfileScope');
  const select=document.getElementById('holderProfileSelect');
  if(scopeEl&&select){
    if(scope) scopeEl.value=scope;
    scopeEl.dispatchEvent(new Event('change'));
    if([...select.options].some(o=>o.value===profileId)){
      select.value=profileId;
      select.dispatchEvent(new Event('change'));
    }
  }
  scrollTarget('holderProfilePanel');
}
function openSecurity(cusip){
  const select=document.getElementById('securityDrillSelect');
  if(select&&[...select.options].some(o=>o.value===cusip)){
    select.value=cusip;select.dispatchEvent(new Event('change'));scrollTarget('securityDrillPanel');return;
  }
  const search=document.getElementById('cusipSearch');
  if(search){search.value=cusip;search.dispatchEvent(new Event('input'));}
  scrollTarget('securityTable');
}
function openSource(key,title){
  const search=document.getElementById('releaseSearch');
  if(search){search.value=key||title||'';search.dispatchEvent(new Event('input'));}
  scrollTarget('releaseCalendarPanel');
}
function activateCommandResult(entry){
  if(!entry) return;
  closeCommandPalette();
  if(entry.type==='holder') return openHolderProfile(entry.target_key,entry.scope);
  if(entry.type==='security') return openSecurity(entry.target_key);
  if(entry.type==='source') return openSource(entry.target_key,entry.title);
  if(entry.type==='alert'){
    if(entry.profile_id) return openHolderProfile(entry.profile_id,entry.scope);
    return scrollTarget(entry.target_panel||'alertIntelPanel');
  }
  scrollTarget(entry.target_panel);
}

function wireCommandPalette(){
  document.getElementById('openCommandPalette')?.addEventListener('click',openCommandPalette);
  const overlay=document.getElementById('commandPalette');
  const input=document.getElementById('commandSearch');
  input?.addEventListener('input',()=>{p11PaletteIndex=0;renderCommandResults();});
  overlay?.addEventListener('click',e=>{if(e.target===overlay) closeCommandPalette();});
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommandPalette();return;}
    if(overlay?.hidden!==false) return;
    if(e.key==='Escape'){e.preventDefault();closeCommandPalette();return;}
    if(e.key==='ArrowDown'){e.preventDefault();p11PaletteIndex=Math.min(p11PaletteResults.length-1,p11PaletteIndex+1);renderCommandResults();return;}
    if(e.key==='ArrowUp'){e.preventDefault();p11PaletteIndex=Math.max(0,p11PaletteIndex-1);renderCommandResults();return;}
    if(e.key==='Enter'&&document.activeElement===input){e.preventDefault();activateCommandResult(p11PaletteResults[p11PaletteIndex]);}
  });
}

function p11Profile(id){return p11Profiles().find(p=>p.profile_id===id);}
function historyTotalChange(profile){
  const h=profile?.history||[];if(h.length<2) return null;
  const first=Number(h[0].value_billions),last=Number(h[h.length-1].value_billions);
  return first?((last-first)/Math.abs(first))*100:null;
}
function normalizeHistory(profile){
  const h=profile?.history||[];if(!h.length) return [];
  const base=Number(h[0].value_billions);if(!Number.isFinite(base)||base===0) return [];
  return h.map(r=>({date:r.date,value:Number(r.value_billions)/Math.abs(base)*100}));
}
function findPair(aId,bId){return p11Pairs().find(p=>(p.profile_a_id===aId&&p.profile_b_id===bId)||(p.profile_a_id===bId&&p.profile_b_id===aId));}

function renderCompareSelectors(){
  const scope=document.getElementById('compareScope'),a=document.getElementById('compareA'),b=document.getElementById('compareB');
  if(!scope||!a||!b) return;
  const scopes=[...new Set(p11Profiles().map(p=>p.scope).filter(Boolean))];
  scope.innerHTML=scopes.map(s=>`<option value="${p11esc(s)}">${p11esc(s)}</option>`).join('');
  const refresh=()=>{
    const rows=p11Profiles().filter(p=>p.scope===scope.value);
    const oldA=a.value,oldB=b.value;
    const options=rows.map(p=>`<option value="${p11esc(p.profile_id)}">${p11esc(p.name)}</option>`).join('');
    a.innerHTML=options;b.innerHTML=options;
    if(rows.some(p=>p.profile_id===oldA)) a.value=oldA;
    if(rows.some(p=>p.profile_id===oldB)) b.value=oldB; else if(rows[1]) b.value=rows[1].profile_id;
    if(a.value===b.value&&rows[1]) b.value=rows[1].profile_id;
    renderComparison();
  };
  scope.onchange=refresh;a.onchange=renderComparison;b.onchange=renderComparison;refresh();
}

function renderComparison(){
  const a=p11Profile(document.getElementById('compareA')?.value),b=p11Profile(document.getElementById('compareB')?.value);
  if(!a||!b) return;
  const meta=document.getElementById('holderCompareMeta');
  if(meta) meta.textContent=`${a.scope} · ${a.frequency||'—'} · normalized histories preserve each source's reporting cadence.`;
  const pair=findPair(a.profile_id,b.profile_id);
  const metrics=document.getElementById('compareMetrics');
  if(metrics) metrics.innerHTML=[
    ['Latest spread',a.current_billions!=null&&b.current_billions!=null?p11fmtB(Number(a.current_billions)-Number(b.current_billions)):'—'],
    ['Latest change gap',a.change_pct!=null&&b.change_pct!=null?`${(Number(a.change_pct)-Number(b.change_pct)>=0?'+':'')}${(Number(a.change_pct)-Number(b.change_pct)).toFixed(1)} pp`:'—'],
    ['Change correlation',pair?Number(pair.correlation).toFixed(2):'Not enough overlap'],
    ['Common change points',pair?.overlapping_change_points??'—']
  ].map(([k,v])=>`<div class="mini"><span>${p11esc(k)}</span><strong>${p11esc(v)}</strong></div>`).join('');

  const aHead=document.getElementById('compareAHead'),bHead=document.getElementById('compareBHead');
  if(aHead) aHead.textContent=a.name;if(bHead) bHead.textContent=b.name;
  const table=document.getElementById('compareTable');
  const rows=[
    ['Current',p11fmtB(a.current_billions),p11fmtB(b.current_billions)],
    ['Latest observation',a.as_of||'—',b.as_of||'—'],
    ['Latest change',p11fmtSignedPct(a.change_pct),p11fmtSignedPct(b.change_pct)],
    ['Stored-history change',p11fmtSignedPct(historyTotalChange(a)),p11fmtSignedPct(historyTotalChange(b))],
    ['Rank in scope',a.rank_within_scope??'—',b.rank_within_scope??'—'],
    ['History points',(a.history||[]).length,(b.history||[]).length],
    ['Source',a.source_name||a.source_key||'—',b.source_name||b.source_key||'—']
  ];
  if(table) table.innerHTML=rows.map(r=>`<tr><td>${p11esc(r[0])}</td><td>${p11esc(r[1])}</td><td>${p11esc(r[2])}</td></tr>`).join('');

  const summary=document.getElementById('comparisonSummary');
  if(summary){
    if(pair) summary.innerHTML=`<div class="comparison-callout"><span>Historical co-movement</span><strong>${Number(pair.correlation).toFixed(2)} correlation</strong><p>${p11fmtPct(pair.same_direction_pct)} of ${pair.overlapping_change_points} overlapping period-to-period changes moved in the same direction. Median absolute change-spread: ${Number(pair.median_abs_change_spread_pct_points).toFixed(2)} percentage points.</p><small>${p11esc(pair.first_overlap)} → ${p11esc(pair.last_overlap)}</small></div>`;
    else summary.innerHTML='<div class="comparison-callout"><span>Historical co-movement</span><strong>Insufficient common history</strong><p>At least six overlapping period-to-period changes are required for the co-movement statistic.</p></div>';
  }

  const na=normalizeHistory(a),nb=normalizeHistory(b),dates=[...new Set([...na.map(r=>r.date),...nb.map(r=>r.date)])].sort();
  const ma=new Map(na.map(r=>[r.date,r.value])),mb=new Map(nb.map(r=>[r.date,r.value]));
  const canvas=document.getElementById('holderCompareChart');
  if(canvas&&window.Chart){
    if(p11CompareChart) p11CompareChart.destroy();
    p11CompareChart=new Chart(canvas,{type:'line',data:{labels:dates,datasets:[{label:a.name,data:dates.map(d=>ma.has(d)?ma.get(d):null),tension:.2,spanGaps:false},{label:b.name,data:dates.map(d=>mb.has(d)?mb.get(d):null),tension:.2,spanGaps:false}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},scales:{y:{ticks:{callback:v=>`${Number(v).toFixed(0)}`},title:{display:true,text:'Normalized index (first observation = 100)'}}}}});
  }
}

function selectComparisonPair(aId,bId,scope){
  const scopeEl=document.getElementById('compareScope'),a=document.getElementById('compareA'),b=document.getElementById('compareB');
  if(!scopeEl||!a||!b) return;
  scopeEl.value=scope;scopeEl.dispatchEvent(new Event('change'));
  if([...a.options].some(o=>o.value===aId)) a.value=aId;
  if([...b.options].some(o=>o.value===bId)) b.value=bId;
  renderComparison();scrollTarget('holderComparePanel');
}

function pairRow(pair){return `<tr class="pair-row" data-a="${p11esc(pair.profile_a_id)}" data-b="${p11esc(pair.profile_b_id)}" data-scope="${p11esc(pair.scope)}"><td>${p11esc(pair.profile_a_name)} ↔ ${p11esc(pair.profile_b_name)}</td><td>${Number(pair.correlation).toFixed(2)}</td><td>${p11fmtPct(pair.same_direction_pct)}</td><td>${p11esc(pair.overlapping_change_points)}</td></tr>`;}
function wirePairRows(container){container?.querySelectorAll('.pair-row').forEach(row=>row.addEventListener('click',()=>selectComparisonPair(row.dataset.a,row.dataset.b,row.dataset.scope)));}

function renderComovement(){
  const block=p11data?.holder_comovement||{},scopes=block.scopes||[];
  const meta=document.getElementById('comovementMeta');if(meta) meta.textContent=`${block.method||''} ${block.note||''}`;
  const select=document.getElementById('comovementScope');if(!select) return;
  select.innerHTML=scopes.map(s=>`<option value="${p11esc(s.scope)}">${p11esc(s.scope)}</option>`).join('');
  const draw=()=>{
    const row=scopes.find(s=>s.scope===select.value)||scopes[0];if(!row) return;
    const strongest=(row.strongest_positive||[])[0],lowest=(row.lowest_correlation||[])[0];
    const metrics=document.getElementById('comovementMetrics');
    if(metrics) metrics.innerHTML=[
      ['Eligible profiles',row.eligible_profiles??0],['Comparable pairs',row.pair_count??0],['Median correlation',row.median_correlation==null?'—':Number(row.median_correlation).toFixed(2)],['Correlation range',strongest&&lowest?`${Number(lowest.correlation).toFixed(2)} → ${Number(strongest.correlation).toFixed(2)}`:'—']
    ].map(([k,v])=>`<div class="mini"><span>${p11esc(k)}</span><strong>${p11esc(v)}</strong></div>`).join('');
    const pos=document.getElementById('positivePairTable'),low=document.getElementById('lowPairTable');
    if(pos){pos.innerHTML=(row.strongest_positive||[]).map(pairRow).join('')||'<tr><td colspan="4" class="empty-cell">Not enough overlapping history.</td></tr>';wirePairRows(pos);}
    if(low){low.innerHTML=(row.lowest_correlation||[]).map(pairRow).join('')||'<tr><td colspan="4" class="empty-cell">Not enough overlapping history.</td></tr>';wirePairRows(low);}
  };
  select.onchange=draw;draw();
}

async function loadPhase11(){
  ensurePhase11Scaffold();
  const r=await fetch(`data/dashboard.json?v=${Date.now()}`);if(!r.ok) throw new Error(`dashboard.json ${r.status}`);
  p11data=await r.json();
  ensurePhase11Scaffold();
  wireCommandPalette();
  renderCompareSelectors();
  renderComovement();
}

loadPhase11().catch(err=>console.error('Phase 11 UI error',err));
