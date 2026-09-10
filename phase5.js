const p5fmtB=v=>v==null?'—':`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
const p5fmtPct=v=>v==null?'—':`${Number(v).toFixed(1)}%`;
const p5signed=v=>v==null?'—':`${Number(v)>=0?'+':''}${Number(v).toFixed(1)}B`;
const p5esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const p5charts={};
let p5data;

async function loadPhase5(){
  const r=await fetch(`data/dashboard.json?v=${Date.now()}`);
  if(!r.ok) throw new Error(`dashboard.json ${r.status}`);
  p5data=await r.json();
  renderGovernmentAccounts();
  renderForeignMultiPeriod();
  renderForeignTrendExplorer();
  renderOwnershipShares();
  renderSomaConcentration();
  appendPhase5SourceHealth();
}

function p5destroy(key){if(p5charts[key]){p5charts[key].destroy();p5charts[key]=null;}}

function renderGovernmentAccounts(){
  const g=p5data.government_accounts||{}, rows=g.holders||[];
  const meta=document.getElementById('govMeta');
  if(meta) meta.textContent=`Treasury Monthly Treasury Statement · ${g.as_of||'—'} · ${g.holder_count??rows.length} detailed account lines`;
  const metrics=document.getElementById('govMetrics');
  if(metrics) metrics.innerHTML=[
    ['Detailed leaf total',p5fmtB(g.leaf_total_billions)],
    ['Social Security-related',p5fmtB(g.social_security_billions)],
    ['Medicare-related',p5fmtB(g.medicare_billions)],
    ['Federal retirement-related',p5fmtB(g.federal_retirement_billions)]
  ].map(([k,v])=>`<div class="mini"><span>${p5esc(k)}</span><strong>${p5esc(v)}</strong></div>`).join('');

  const table=document.getElementById('govTable');
  const search=document.getElementById('govSearch');
  if(!table) return;
  const draw=()=>{
    const q=(search?.value||'').toLowerCase().trim();
    const filtered=!q?rows:rows.filter(r=>`${r.name||''} ${r.account_type||''}`.toLowerCase().includes(q));
    table.innerHTML=filtered.map(r=>`<tr><td>${p5esc(r.name)}</td><td>${p5esc(r.account_type||'—')}</td><td>${p5fmtB(r.holdings_billions)}</td></tr>`).join('');
  };
  if(search) search.oninput=draw;
  draw();
}

function renderForeignMultiPeriod(){
  const x=p5data.foreign_holders||{}, rows=x.countries||[];
  const table=document.getElementById('foreignTable');
  const search=document.getElementById('countrySearch');
  if(!table) return;
  const draw=()=>{
    const q=(search?.value||'').toLowerCase().trim();
    const filtered=!q?rows:rows.filter(r=>String(r.name||'').toLowerCase().includes(q));
    table.innerHTML=filtered.map(r=>`<tr><td>${p5esc(r.name)}</td><td>${p5fmtB(r.holdings_billions)}</td><td class="${(r.change_billions||0)>=0?'up':'down'}">${p5signed(r.change_billions)}</td><td class="${(r.change_3m_billions||0)>=0?'up':'down'}">${p5signed(r.change_3m_billions)}</td><td class="${(r.change_12m_billions||0)>=0?'up':'down'}">${p5signed(r.change_12m_billions)}</td></tr>`).join('');
  };
  if(search) search.oninput=draw;
  draw();
}

function renderForeignTrendExplorer(){
  const x=p5data.foreign_holders||{}, countries=x.countries||[];
  const select=document.getElementById('trendCountry');
  const meta=document.getElementById('foreignTrendMeta');
  const canvas=document.getElementById('foreignTrendChart');
  if(!select||!canvas) return;

  const choices=countries.slice(0,30);
  select.innerHTML=choices.map((r,i)=>`<option value="${p5esc(r.name)}" ${i===0?'selected':''}>${p5esc(r.name)}</option>`).join('');

  const draw=()=>{
    const row=countries.find(r=>r.name===select.value)||choices[0];
    if(!row) return;
    const hist=(row.history||[]).slice().reverse();
    if(meta) meta.textContent=`${row.name} · latest ${p5fmtB(row.holdings_billions)} · 3M ${p5signed(row.change_3m_billions)} · 12M ${p5signed(row.change_12m_billions)}`;
    p5destroy('foreignTrend');
    p5charts.foreignTrend=new Chart(canvas,{type:'line',data:{labels:hist.map(h=>h.period),datasets:[{label:`${row.name} holdings ($B)`,data:hist.map(h=>h.holdings_billions)}]},options:p5lineOptions()});
  };
  select.onchange=draw;
  draw();
}

function renderOwnershipShares(){
  const s=p5data.ownership_shares||{}, rows=s.rows||[];
  const meta=document.getElementById('shareMeta');
  if(meta) meta.textContent=s.note||'';
  const table=document.getElementById('shareTable');
  if(table) table.innerHTML=rows.map(r=>`<tr><td>${p5esc(r.name)}</td><td>${p5fmtB(r.holdings_billions)}</td><td>${p5esc(r.denominator)}</td><td>${p5fmtPct(r.share_pct)}</td></tr>`).join('');

  const canvas=document.getElementById('shareChart');
  p5destroy('shares');
  if(canvas&&rows.length){
    p5charts.shares=new Chart(canvas,{type:'bar',data:{labels:rows.map(r=>r.name),datasets:[{label:'Share of relevant denominator (%)',data:rows.map(r=>r.share_pct)}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'#223047'},ticks:{color:'#96a6ba',callback:v=>`${v}%`}},x:{grid:{display:false},ticks:{color:'#dbe6f4'}}}}});
  }
}

function renderSomaConcentration(){
  const s=p5data.soma_concentration||{}, rows=s.maturity_buckets||[];
  const meta=document.getElementById('somaConcentrationMeta');
  if(meta) meta.textContent=`SOMA ${s.as_of||'—'} · top-10 stored CUSIPs ${p5fmtB(s.top10_par_billions)} (${p5fmtPct(s.top10_share_pct)} of total SOMA Treasury par)`;
  const table=document.getElementById('somaConcentrationTable');
  if(table) table.innerHTML=rows.map(r=>`<tr><td>${p5esc(r.name)}</td><td>${p5fmtB(r.par_billions)}</td></tr>`).join('');
  const canvas=document.getElementById('somaConcentrationChart');
  p5destroy('somaConcentration');
  if(canvas&&rows.length){
    p5charts.somaConcentration=new Chart(canvas,{type:'bar',data:{labels:rows.map(r=>r.name),datasets:[{label:'Stored SOMA par ($B)',data:rows.map(r=>r.par_billions)}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'#223047'},ticks:{color:'#96a6ba'}},x:{grid:{display:false},ticks:{color:'#dbe6f4'}}}}});
  }
}

function appendPhase5SourceHealth(){
  const grid=document.getElementById('sourceHealth');
  if(!grid) return;
  const key='government_accounts', name='Treasury MTS — Government Account Investments';
  if(grid.querySelector(`[data-phase5-source="${key}"]`)) return;
  const s=(p5data.sources||{})[key]||{};
  const div=document.createElement('div');
  div.className='source';
  div.dataset.phase5Source=key;
  div.innerHTML=`<strong>${p5esc(name)}</strong><small>${s.checked_at?new Date(s.checked_at).toLocaleString():'Not checked yet'}</small><br><span class="pill ${p5esc(s.status||'seed')}">${p5esc(s.status||'unknown')}</span>${s.message?`<div class="error-text">${p5esc(s.message)}</div>`:''}`;
  grid.appendChild(div);
}

function p5lineOptions(){return{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}}},scales:{x:{grid:{color:'#223047'},ticks:{color:'#96a6ba'}},y:{grid:{color:'#223047'},ticks:{color:'#96a6ba',callback:v=>`$${v}B`}}}};}

loadPhase5().catch(err=>console.error('Phase 5 UI error',err));

if(!document.querySelector('script[data-phase6-loader]')){
  const p6=document.createElement('script');
  p6.src='phase6.js';
  p6.dataset.phase6Loader='true';
  document.body.appendChild(p6);
}
