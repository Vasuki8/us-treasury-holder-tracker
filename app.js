const fmtB = v => v == null ? '—' : `$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
const fmtT = v => v == null ? '—' : `$${(Number(v)/1e12).toLocaleString(undefined,{maximumFractionDigits:3})}T`;
const fmtUSD = v => v == null ? '—' : (Number(v)>=1e12?fmtT(v):`$${(Number(v)/1e9).toLocaleString(undefined,{maximumFractionDigits:1})}B`);
const fmtPct = v => v == null ? '—' : `${Number(v).toFixed(1)}%`;
const signedB = v => v == null ? '—' : `${Number(v)>=0?'+':''}${Number(v).toFixed(1)}B`;
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let data;
const charts = {};

function destroyChart(key){
  if(charts[key]){ charts[key].destroy(); charts[key]=null; }
}

async function load(){
  const r = await fetch(`data/dashboard.json?v=${Date.now()}`);
  if(!r.ok) throw new Error(`dashboard.json ${r.status}`);
  data = await r.json();
  document.getElementById('updateStatus').textContent = data.generated_at
    ? `Checked ${new Date(data.generated_at).toLocaleString()}`
    : 'Awaiting first refresh';

  renderOverview();
  renderForeign();
  renderSoma();
  renderInstitutions();
  renderDealers();
  renderMmf();
  renderAuctions();
  renderSectors();
  renderHistory();
  renderSources();
  wireDownloads();
}

function renderOverview(){
  const o=data.overview||{}, f=data.fed||{}, x=data.foreign_holders||{}, m=data.money_market_funds||{};
  const inst=data.institutional_aggregates||{}, pd=data.primary_dealers||{};
  const banks=(inst.institutions||[]).find(x=>x.name==='U.S.-chartered depository institutions')||{};
  const dealers=(pd.series||[]).find(x=>x.keyid==='PDPOSGST-TOT')||{};

  const cards=[
    ['Total public debt',fmtUSD(o.total_public_debt),o.as_of?`Fiscal Data · ${o.as_of}`:'Awaiting fetch'],
    ['Debt held by public',fmtUSD(o.debt_held_by_public),o.as_of?`Fiscal Data · ${o.as_of}`:'Business daily'],
    ['Federal Reserve',fmtB(f.treasury_holdings_billions),`H.4.1 · ${f.as_of||'latest weekly'}`],
    ['Foreign holders',fmtB(x.grand_total_billions),`TIC · ${x.as_of||'latest monthly'}`],
    ['U.S. banks',fmtB(banks.holdings_billions),`Financial Accounts · ${banks.as_of||'latest quarterly'}`],
    ['Primary dealers net',fmtB(dealers.value_billions),`NY Fed · ${dealers.as_of||'latest weekly'}`],
    ['MMF direct Treasuries',fmtB(m.direct_treasury_total_billions),`SEC N-MFP · ${m.as_of||'latest monthly'}`],
    ['MMF Treasury repo',fmtB(m.treasury_repo_total_billions),`Separate from direct ownership · ${m.as_of||'—'}`]
  ];
  document.getElementById('overviewCards').innerHTML=cards.map(c=>
    `<div class="card"><div class="kicker">${esc(c[0])}</div><div class="value">${esc(c[1])}</div><div class="meta">${esc(c[2])}</div></div>`
  ).join('');
}

function renderForeign(){
  const x=data.foreign_holders||{}, countries=x.countries||[];
  document.getElementById('foreignMeta').textContent=`TIC · ${x.as_of||'—'} · ${x.frequency||''}`;
  const draw=rows=>{
    document.getElementById('foreignTable').innerHTML=rows.map(r=>
      `<tr><td>${esc(r.name)}</td><td>${fmtB(r.holdings_billions)}</td><td class="${(r.change_billions||0)>=0?'up':'down'}">${r.change_billions==null?'—':`${r.change_billions>=0?'+':''}${Number(r.change_billions).toFixed(1)}B`}</td></tr>`
    ).join('');
  };
  draw(countries);
  const search=document.getElementById('countrySearch');
  search.oninput=e=>draw(countries.filter(r=>String(r.name).toLowerCase().includes(e.target.value.toLowerCase())));

  destroyChart('foreign');
  const top=countries.slice(0,12);
  if(top.length){
    charts.foreign=new Chart(document.getElementById('foreignChart'),{
      type:'bar',
      data:{labels:top.map(x=>x.name),datasets:[{label:'Holdings ($B)',data:top.map(x=>x.holdings_billions)}]},
      options:baseHorizontalOptions()
    });
  }
}

function renderSoma(){
  const s=data.soma||{}, rows=s.top_holdings||[], byType=s.by_type||[];
  document.getElementById('somaMeta').textContent=`New York Fed SOMA · ${s.as_of||'—'} · ${s.frequency||''}`;
  document.getElementById('somaMetrics').innerHTML=[
    ['Treasury total',fmtB(s.treasury_total_billions)],
    ['CUSIPs',s.security_count==null?'—':Number(s.security_count).toLocaleString()]
  ].map(([k,v])=>`<div class="mini"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');

  document.getElementById('somaTable').innerHTML=rows.map(r=>
    `<tr><td>${esc(r.cusip||'—')}</td><td>${esc(r.security_type||'—')}</td><td>${esc(r.maturity_date||'—')}</td><td>${fmtB(r.par_value_billions)}</td></tr>`
  ).join('');

  destroyChart('soma');
  if(byType.length){
    charts.soma=new Chart(document.getElementById('somaChart'),{
      type:'doughnut',
      data:{labels:byType.map(x=>x.name),datasets:[{data:byType.map(x=>x.holdings_billions)}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#dbe6f4'}}}}
    });
  }
}

function renderInstitutions(){
  const block=data.institutional_aggregates||{}, rows=block.institutions||[];
  document.getElementById('institutionMeta').textContent=`Federal Reserve Financial Accounts via FRED · latest observation ${block.as_of||'—'}`;
  document.getElementById('institutionTable').innerHTML=rows.map(r=>
    `<tr><td>${esc(r.name)}</td><td>${fmtB(r.holdings_billions)}</td><td>${esc(r.as_of||'—')}</td><td>${esc(r.series||'—')}</td></tr>`
  ).join('');

  destroyChart('institution');
  if(rows.length){
    const labels=[...new Set(rows.flatMap(r=>(r.history||[]).map(h=>h.date)))].sort();
    const datasets=rows.map(r=>{
      const map=new Map((r.history||[]).map(h=>[h.date,h.value_billions]));
      return {label:r.name,data:labels.map(d=>map.has(d)?map.get(d):null),spanGaps:true};
    });
    charts.institution=new Chart(document.getElementById('institutionChart'),{
      type:'line',data:{labels,datasets},options:lineOptions('$B')
    });
  }
}

function renderDealers(){
  const block=data.primary_dealers||{}, rows=block.series||[];
  document.getElementById('dealerMeta').textContent=`New York Fed Primary Dealer Statistics · ${block.as_of||'—'} · ${block.frequency||''}`;
  document.getElementById('dealerMetrics').innerHTML=rows.map(r=>
    `<div class="mini"><span>${esc(r.name)}</span><strong>${fmtB(r.value_billions)}</strong><small class="${(r.weekly_change_billions||0)>=0?'up':'down'}">${signedB(r.weekly_change_billions)} WoW</small></div>`
  ).join('');
  document.getElementById('dealerTable').innerHTML=rows.map(r=>
    `<tr><td>${esc(r.name)}</td><td>${fmtB(r.value_billions)}</td><td class="${(r.weekly_change_billions||0)>=0?'up':'down'}">${signedB(r.weekly_change_billions)}</td><td>${esc(r.as_of||'—')}</td></tr>`
  ).join('');

  destroyChart('dealers');
  if(rows.length){
    const labels=[...new Set(rows.flatMap(r=>(r.history||[]).map(h=>h.date)))].sort();
    const datasets=rows.map(r=>{
      const map=new Map((r.history||[]).map(h=>[h.date,h.value_billions]));
      return {label:r.name,data:labels.map(d=>map.has(d)?map.get(d):null),spanGaps:true};
    });
    charts.dealers=new Chart(document.getElementById('dealerChart'),{
      type:'line',data:{labels,datasets},options:lineOptions('$B')
    });
  }
}

function renderMmf(){
  const m=data.money_market_funds||{}, funds=m.funds||[];
  document.getElementById('mmfMeta').textContent=`SEC Form N-MFP · ${m.as_of||'—'} · ${m.fund_count??'—'} funds with Treasury exposure`;
  document.getElementById('mmfMetrics').innerHTML=[
    ['Direct Treasuries',fmtB(m.direct_treasury_total_billions)],
    ['Treasury repo',fmtB(m.treasury_repo_total_billions)],
    ['Funds',m.fund_count==null?'—':Number(m.fund_count).toLocaleString()]
  ].map(([k,v])=>`<div class="mini"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');

  const draw=rows=>{
    document.getElementById('mmfTable').innerHTML=rows.length?rows.map(r=>
      `<tr><td>${esc(r.name)}</td><td>${esc(r.series_id||'—')}</td><td>${fmtB(r.direct_treasury_billions)}</td><td>${fmtB(r.treasury_repo_billions)}</td><td>${fmtB(r.net_assets_billions)}</td></tr>`
    ).join(''):`<tr><td colspan="5" class="empty-cell">No current N-MFP rows available; check Source Health for retrieval status.</td></tr>`;
  };
  draw(funds);
  const search=document.getElementById('fundSearch');
  search.oninput=e=>draw(funds.filter(r=>String(r.name).toLowerCase().includes(e.target.value.toLowerCase())));
}

function renderAuctions(){
  const a=data.auctions||{}, cats=a.categories||[], rows=a.recent_auctions||[];
  document.getElementById('auctionMeta').textContent=`U.S. Treasury · latest auction ${a.as_of||'—'} · rolling ${a.window_days||90}-day competitive takedown`;
  document.getElementById('auctionTable').innerHTML=rows.map(r=>
    `<tr><td>${esc(r.auction_date||'—')}</td><td>${esc(`${r.security_term||''} ${r.security_type||''}`.trim())}</td><td>${fmtB(r.accepted_billions)}</td><td>${r.bid_to_cover==null?'—':Number(r.bid_to_cover).toFixed(2)}</td><td>${fmtPct(r.dealer_share_pct)}</td><td>${fmtPct(r.indirect_share_pct)}</td><td>${fmtPct(r.direct_share_pct)}</td></tr>`
  ).join('');

  destroyChart('auction');
  if(cats.length){
    charts.auction=new Chart(document.getElementById('auctionChart'),{
      type:'bar',
      data:{labels:cats.map(x=>x.name),datasets:[{label:'Share of competitive awards (%)',data:cats.map(x=>x.share_pct)}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100,grid:{color:'#223047'},ticks:{color:'#96a6ba',callback:v=>`${v}%`}},x:{grid:{display:false},ticks:{color:'#dbe6f4'}}}}
    });
  }
}

function renderSectors(){
  const x=data.domestic_sectors||{}, rows=(x.holders||[]).slice().sort((a,b)=>b.holdings_billions-a.holdings_billions);
  document.getElementById('sectorMeta').textContent=`Federal Reserve Financial Accounts · ${x.as_of||'—'} · ${x.frequency||''}`;
  document.getElementById('sectorTable').innerHTML=rows.map(r=>
    `<tr><td>${esc(r.name)}</td><td>${fmtB(r.holdings_billions)}</td><td>${esc(r.series)}</td></tr>`
  ).join('');

  destroyChart('sector');
  if(rows.length){
    charts.sector=new Chart(document.getElementById('sectorChart'),{
      type:'bar',
      data:{labels:rows.map(x=>x.name),datasets:[{label:'Holdings ($B)',data:rows.map(x=>x.holdings_billions)}]},
      options:baseHorizontalOptions()
    });
  }
}

function renderHistory(){
  const rows=data.history||[];
  const empty=document.getElementById('historyEmpty');
  destroyChart('history');
  if(rows.length<2){
    empty.hidden=false;
    return;
  }
  empty.hidden=true;
  const labels=rows.map(x=>x.snapshot_date);
  const datasets=[
    {label:'Debt held by public',data:rows.map(x=>x.debt_held_by_public_trillions)},
    {label:'Foreign holders',data:rows.map(x=>x.foreign_holdings_billions==null?null:x.foreign_holdings_billions/1000)},
    {label:'Federal Reserve',data:rows.map(x=>x.fed_treasuries_billions==null?null:x.fed_treasuries_billions/1000)},
    {label:'U.S. banks',data:rows.map(x=>x.us_banks_treasuries_billions==null?null:x.us_banks_treasuries_billions/1000)}
  ];
  charts.history=new Chart(document.getElementById('historyChart'),{
    type:'line',data:{labels,datasets},options:lineOptions('$T')
  });
}

function renderSources(){
  const names={
    overview:'Treasury Fiscal Data — Debt to Penny',
    fed:'Federal Reserve H.4.1 — via FRED',
    foreign_holders:'Treasury — TIC',
    domestic_sectors:'Federal Reserve Financial Accounts — via FRED',
    soma:'New York Fed — SOMA',
    primary_dealers:'New York Fed — Primary Dealer Statistics',
    institutional_aggregates:'Federal Reserve — Banks & Dealers via FRED',
    money_market_funds:'SEC — Form N-MFP',
    auctions:'Treasury — Auctions'
  };
  document.getElementById('sourceHealth').innerHTML=Object.entries(names).map(([k,n])=>{
    const s=(data.sources||{})[k]||{};
    return `<div class="source"><strong>${esc(n)}</strong><small>${s.checked_at?new Date(s.checked_at).toLocaleString():'Not checked yet'}</small><br><span class="pill ${esc(s.status||'seed')}">${esc(s.status||'unknown')}</span>${s.message?`<div class="error-text">${esc(s.message)}</div>`:''}</div>`;
  }).join('');
}

function baseHorizontalOptions(){
  return {indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'#223047'},ticks:{color:'#96a6ba'}},y:{grid:{display:false},ticks:{color:'#dbe6f4'}}}};
}

function lineOptions(unit){
  return {responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#dbe6f4'}}},scales:{x:{grid:{color:'#223047'},ticks:{color:'#96a6ba',maxTicksLimit:10}},y:{grid:{color:'#223047'},ticks:{color:'#96a6ba',callback:v=>`${v}${unit}`}}}};
}

function wireDownloads(){
  document.getElementById('downloadJson').onclick=()=>downloadBlob('treasury-dashboard.json',JSON.stringify(data,null,2),'application/json');
  document.getElementById('downloadCsv').onclick=()=>downloadBlob('treasury-holder-snapshot.csv',buildSnapshotCsv(),'text/csv;charset=utf-8');
}

function buildSnapshotCsv(){
  const rows=[['category','holder','value_billions','as_of','detail']];
  const o=data.overview||{};
  if(o.total_public_debt!=null) rows.push(['overview','Total public debt',o.total_public_debt/1e9,o.as_of,'']);
  if(o.debt_held_by_public!=null) rows.push(['overview','Debt held by public',o.debt_held_by_public/1e9,o.as_of,'']);
  if(o.intragovernmental_holdings!=null) rows.push(['overview','Intragovernmental holdings',o.intragovernmental_holdings/1e9,o.as_of,'']);
  const f=data.fed||{};
  rows.push(['federal_reserve','Federal Reserve Treasury holdings',f.treasury_holdings_billions??'',f.as_of||'','H.4.1']);
  for(const x of data.foreign_holders?.countries||[]) rows.push(['foreign_country',x.name,x.holdings_billions,data.foreign_holders?.as_of||'','TIC']);
  for(const x of data.domestic_sectors?.holders||[]) rows.push(['domestic_sector',x.name,x.holdings_billions,data.domestic_sectors?.as_of||'',x.series||'']);
  for(const x of data.institutional_aggregates?.institutions||[]) rows.push(['institution_sector',x.name,x.holdings_billions,x.as_of||'',x.series||'']);
  for(const x of data.primary_dealers?.series||[]) rows.push(['primary_dealer_aggregate',x.name,x.value_billions,x.as_of||'',x.keyid||'']);
  for(const x of data.soma?.by_type||[]) rows.push(['soma',x.name,x.holdings_billions,data.soma?.as_of||'','']);
  for(const x of data.money_market_funds?.funds||[]) rows.push(['money_market_fund',x.name,x.direct_treasury_billions,x.report_date||'',`repo=${x.treasury_repo_billions??''}; series=${x.series_id||''}`]);
  return rows.map(r=>r.map(csvCell).join(',')).join('\n');
}

function csvCell(v){
  const s=String(v??'');
  return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;
}

function downloadBlob(filename,content,type){
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

load().catch(err=>{
  document.getElementById('updateStatus').textContent='Data load error';
  console.error(err);
});
