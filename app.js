const fmtB = v => v == null ? '—' : `$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
const fmtT = v => v == null ? '—' : `$${(Number(v)/1e12).toLocaleString(undefined,{maximumFractionDigits:3})}T`;
const fmtUSD = v => v == null ? '—' : (Number(v)>=1e12?fmtT(v):`$${(Number(v)/1e9).toLocaleString(undefined,{maximumFractionDigits:1})}B`);
let data, foreignChart, sectorChart;

async function load(){
  const r=await fetch(`data/dashboard.json?v=${Date.now()}`); data=await r.json();
  document.getElementById('updateStatus').textContent=`Checked ${new Date(data.generated_at).toLocaleString()}`;
  renderOverview(); renderForeign(); renderSectors(); renderSources();
}
function renderOverview(){
  const o=data.overview||{}, f=data.fed||{}, x=data.foreign_holders||{};
  const cards=[
    ['Total public debt',fmtUSD(o.total_public_debt),o.as_of?`Fiscal Data · ${o.as_of}`:'Awaiting first automated fetch'],
    ['Debt held by public',fmtUSD(o.debt_held_by_public),o.as_of?`Fiscal Data · ${o.as_of}`:'Business-daily source'],
    ['Federal Reserve',fmtB(f.treasury_holdings_billions),`H.4.1 · ${f.as_of||'latest weekly'}`],
    ['Foreign holders',fmtB(x.grand_total_billions),`TIC · ${x.as_of||'latest monthly'}`]
  ];
  document.getElementById('overviewCards').innerHTML=cards.map(c=>`<div class="card"><div class="kicker">${c[0]}</div><div class="value">${c[1]}</div><div class="meta">${c[2]}</div></div>`).join('');
}
function renderForeign(){
  const x=data.foreign_holders||{}; const countries=x.countries||[];
  document.getElementById('foreignMeta').textContent=`TIC · ${x.as_of||'—'} · ${x.frequency||''}`;
  const draw=(rows)=>{
    document.getElementById('foreignTable').innerHTML=rows.map(r=>`<tr><td>${r.name}</td><td>${fmtB(r.holdings_billions)}</td><td class="${(r.change_billions||0)>=0?'up':'down'}">${r.change_billions==null?'—':`${r.change_billions>=0?'+':''}${r.change_billions.toFixed(1)}B`}</td></tr>`).join('');
  }; draw(countries);
  document.getElementById('countrySearch').addEventListener('input',e=>draw(countries.filter(r=>r.name.toLowerCase().includes(e.target.value.toLowerCase()))));
  const top=countries.slice(0,12);
  foreignChart=new Chart(document.getElementById('foreignChart'),{type:'bar',data:{labels:top.map(x=>x.name),datasets:[{label:'Holdings ($B)',data:top.map(x=>x.holdings_billions)}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'#223047'},ticks:{color:'#96a6ba'}},y:{grid:{display:false},ticks:{color:'#dbe6f4'}}}}});
}
function renderSectors(){
  const x=data.domestic_sectors||{}, rows=(x.holders||[]).sort((a,b)=>b.holdings_billions-a.holdings_billions);
  document.getElementById('sectorMeta').textContent=`Federal Reserve Financial Accounts · ${x.as_of||'—'} · ${x.frequency||''}`;
  document.getElementById('sectorTable').innerHTML=rows.map(r=>`<tr><td>${r.name}</td><td>${fmtB(r.holdings_billions)}</td><td>${r.series}</td></tr>`).join('');
  sectorChart=new Chart(document.getElementById('sectorChart'),{type:'bar',data:{labels:rows.map(x=>x.name),datasets:[{label:'Holdings ($B)',data:rows.map(x=>x.holdings_billions)}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{color:'#223047'},ticks:{color:'#96a6ba'}},y:{grid:{display:false},ticks:{color:'#dbe6f4'}}}}});
}
function renderSources(){
  const names={overview:'Fiscal Data — Debt to Penny',fed:'Federal Reserve — H.4.1',foreign_holders:'Treasury — TIC',domestic_sectors:'Federal Reserve — Financial Accounts'};
  document.getElementById('sourceHealth').innerHTML=Object.entries(names).map(([k,n])=>{const s=(data.sources||{})[k]||{};return `<div class="source"><strong>${n}</strong><small>${s.checked_at?new Date(s.checked_at).toLocaleString():'Not checked yet'}</small><br><span class="pill ${s.status||'seed'}">${s.status||'unknown'}</span></div>`}).join('');
}
load().catch(err=>{document.getElementById('updateStatus').textContent='Data load error';console.error(err)});
