(() => {
  const state = { data: null, horizon: '90D', fundingChart: null, tgaChart: null };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n = value => Number(value || 0);
  const fmtB = value => {
    const v = Number(value);
    if(!Number.isFinite(v)) return '—';
    return Math.abs(v) >= 1000
      ? `$${(v / 1000).toFixed(2)}T`
      : `$${v.toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  };
  const signedB = value => {
    const v = Number(value);
    if(!Number.isFinite(v)) return '—';
    const sign = v > 0 ? '+' : '';
    return `${sign}${fmtB(v)}`;
  };
  const prettyDate = value => {
    if(!value) return '—';
    const d = new Date(`${String(value).slice(0,10)}T00:00:00`);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  };
  const addDays = (iso, days) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0,10);
  };

  function block(){ return state.data?.treasury_funding_pressure || {}; }
  function horizonRow(){ return block().horizons?.[state.horizon] || {}; }
  function horizonDays(){ return ({'30D':30,'90D':90,'1Y':365})[state.horizon] || 90; }

  function ranges(){
    const host = document.getElementById('fundingRanges');
    if(!host) return;
    host.innerHTML = ['30D','90D','1Y'].map(key =>
      `<button type="button" data-funding-range="${key}" class="${key===state.horizon?'active':''}">${key}</button>`
    ).join('');
    host.querySelectorAll('[data-funding-range]').forEach(button => button.addEventListener('click', () => {
      state.horizon = button.dataset.fundingRange;
      render();
    }));
  }

  function renderMeta(){
    const meta = document.getElementById('fundingMeta');
    const f = block();
    if(!meta) return;
    const through = f.auctions?.announced_through ? prettyDate(f.auctions.announced_through) : 'none currently';
    const buybackCount = Number(f.buybacks?.upcoming_operation_count || 0);
    meta.textContent = `MSPD ${f.maturity_as_of || '—'} · TGA ${f.tga?.as_of || '—'} · auction settlements through ${through} · ${buybackCount} tentative buybacks ahead`;
  }

  function renderCards(){
    const host = document.getElementById('fundingCards');
    if(!host) return;
    const h = horizonRow();
    const tga = block().tga || {};
    const coverage = Number.isFinite(Number(h.announced_coverage_pct))
      ? `${Number(h.announced_coverage_pct).toFixed(0)}% of scheduled cash`
      : 'No scheduled cash in range';
    const cards = [
      ['Principal due', fmtB(h.principal_billions), `${state.horizon} scheduled maturities`],
      ['Interest due', fmtB(h.interest_billions), `${state.horizon} modeled coupon cash`],
      ['Gross scheduled cash', fmtB(h.gross_scheduled_cash_billions), 'Principal + interest'],
      ['Announced issuance', fmtB(h.announced_issuance_billions), `${coverage} · settlement based`],
      ['Planned buyback max', fmtB(h.planned_buyback_max_billions), 'Tentative maximum · actual accepted can be lower'],
      ['Current TGA', fmtB(tga.current_billions), `${signedB(tga.change_30d_billions)} vs ~30D ago`],
    ];
    host.innerHTML = cards.map(([label,value,meta]) => `
      <div class="funding-card">
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
        <small>${esc(meta)}</small>
      </div>`).join('');
  }

  function weekStart(iso){
    const d = new Date(`${iso}T00:00:00Z`);
    const day = d.getUTCDay();
    const shift = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + shift);
    return d.toISOString().slice(0,10);
  }

  function bucketTimeline(){
    const f = block();
    const start = f.as_of;
    const end = addDays(start, horizonDays());
    const map = new Map();
    (f.timeline || []).forEach(row => {
      if(row.date < start || row.date > end) return;
      const key = state.horizon === '1Y' ? row.date.slice(0,7) : state.horizon === '90D' ? weekStart(row.date) : row.date;
      const target = map.get(key) || {key, principal:0, interest:0, issuance:0, buybacks:0};
      target.principal += n(row.principal_billions);
      target.interest += n(row.interest_billions);
      target.issuance += n(row.announced_issuance_billions);
      target.buybacks += n(row.planned_buyback_max_billions);
      map.set(key, target);
    });
    return [...map.values()].sort((a,b) => a.key.localeCompare(b.key));
  }

  function bucketLabel(key){
    if(state.horizon === '1Y'){
      const d = new Date(`${key}-01T00:00:00`);
      return d.toLocaleDateString(undefined,{month:'short',year:'numeric'});
    }
    const d = new Date(`${key}T00:00:00`);
    return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  }

  function drawFundingChart(){
    const canvas = document.getElementById('fundingPressureChart');
    if(!canvas || !window.Chart) return;
    const buckets = bucketTimeline();
    const existing = Chart.getChart(canvas);
    if(existing) existing.destroy();

    state.fundingChart = new Chart(canvas,{
      type:'bar',
      data:{
        labels:buckets.map(row=>bucketLabel(row.key)),
        datasets:[
          {label:'Principal due',data:buckets.map(row=>row.principal),stack:'obligations',borderWidth:0},
          {label:'Interest due',data:buckets.map(row=>row.interest),stack:'obligations',borderWidth:0},
          {label:'Announced issuance',data:buckets.map(row=>row.issuance),stack:'issuance',borderWidth:0},
          {label:'Planned buyback max',data:buckets.map(row=>row.buybacks),stack:'buybacks',borderWidth:0},
        ],
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{labels:{color:'#dbe6f4'}},
          tooltip:{callbacks:{
            label:ctx=>` ${ctx.dataset.label}: ${fmtB(ctx.parsed.y)}`,
            footer:items=>{
              const i=items?.[0]?.dataIndex;
              const row=buckets[i];
              return row ? `Scheduled cash: ${fmtB(row.principal + row.interest)}` : '';
            },
          }},
        },
        scales:{
          x:{stacked:true,grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:14}},
          y:{stacked:true,beginAtZero:true,grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:value=>fmtB(value)}},
        },
      },
    });
  }

  function drawTgaChart(){
    const canvas = document.getElementById('fundingTgaChart');
    if(!canvas || !window.Chart) return;
    const history = (block().tga?.history || []).slice(-130);
    const existing = Chart.getChart(canvas);
    if(existing) existing.destroy();
    state.tgaChart = new Chart(canvas,{
      type:'line',
      data:{
        labels:history.map(row=>row.date),
        datasets:[{
          label:'TGA closing balance',
          data:history.map(row=>row.balance_billions),
          borderWidth:2,
          pointRadius:0,
          pointHoverRadius:4,
          tension:.15,
          fill:false,
        }],
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{title:items=>prettyDate(items?.[0]?.label),label:ctx=>` ${fmtB(ctx.parsed.y)}`}},
        },
        scales:{
          x:{grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:9,callback:(value,index)=> {
            const raw=history[index]?.date;
            return raw ? new Date(`${raw}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : '';
          }}},
          y:{beginAtZero:false,grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:value=>fmtB(value)}},
        },
      },
    });
  }

  function renderAuctionTable(){
    const body = document.getElementById('fundingAuctionTable');
    const meta = document.getElementById('fundingAuctionMeta');
    if(!body) return;
    const rows = (block().auctions?.rows || []).slice().sort((a,b)=>String(a.issue_date).localeCompare(String(b.issue_date)));
    if(meta) meta.textContent = rows.length
      ? `${rows.length} currently announced securities · cash shown on issue/settlement date`
      : 'No currently announced future auction settlements in the official feed.';
    if(!rows.length){
      body.innerHTML = `<tr><td colspan="5">No currently announced future auctions.</td></tr>`;
      return;
    }
    body.innerHTML = rows.slice(0,24).map(row=>`
      <tr>
        <td>${esc(prettyDate(row.issue_date))}</td>
        <td>${esc(prettyDate(row.auction_date))}</td>
        <td>${esc(row.security_type || '—')}</td>
        <td>${esc(row.security_term || '—')}</td>
        <td>${esc(fmtB(row.offering_billions))}</td>
      </tr>`).join('');
  }

  function renderBuybackTable(){
    const body=document.getElementById('fundingBuybackTable');
    const meta=document.getElementById('fundingBuybackMeta');
    if(!body) return;
    const rows=(block().buybacks?.upcoming || []).slice().sort((a,b)=>String(a.operation_date).localeCompare(String(b.operation_date)));
    if(meta) meta.textContent=rows.length
      ? `${rows.length} tentative operations · maximum purchase caps, not guaranteed accepted amounts`
      : 'No future tentative buyback operations in the current schedule.';
    if(!rows.length){
      body.innerHTML='<tr><td colspan="5">No upcoming tentative buybacks.</td></tr>';
      return;
    }
    body.innerHTML=rows.map(row=>`
      <tr>
        <td>${esc(prettyDate(row.operation_date))}</td>
        <td>${esc(prettyDate(row.settlement_date))}</td>
        <td>${esc(row.operation_type || '—')}</td>
        <td>${esc(row.maturity_bucket || row.security_type || '—')}</td>
        <td>${esc(fmtB(row.max_purchase_billions))}</td>
      </tr>`).join('');
  }

  function downloadCsv(){
    const f = block();
    const rows = [['date','principal_due_billions','interest_due_billions','gross_scheduled_cash_billions','announced_issuance_billions','planned_buyback_max_billions']];
    (f.timeline || []).forEach(row=>rows.push([
      row.date,
      n(row.principal_billions).toFixed(6),
      n(row.interest_billions).toFixed(6),
      n(row.gross_scheduled_cash_billions).toFixed(6),
      n(row.announced_issuance_billions).toFixed(6),
      n(row.planned_buyback_max_billions).toFixed(6),
    ]));
    const csv = rows.map(row=>row.map(value=>`"${String(value).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url;
    a.download=`treasury-funding-pressure-${f.as_of || 'latest'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function render(){
    ranges();
    renderMeta();
    renderCards();
    drawFundingChart();
    drawTgaChart();
    renderAuctionTable();
    renderBuybackTable();
  }

  async function load(){
    try{
      const response = await fetch(`data/dashboard.json?v=${Date.now()}`);
      if(!response.ok) throw new Error(`dashboard.json ${response.status}`);
      state.data = await response.json();
      if(!block().horizons) return;
      document.getElementById('downloadFundingCsv')?.addEventListener('click',downloadCsv);
      render();
    }catch(error){
      console.error('Treasury funding pressure UI error',error);
      const meta = document.getElementById('fundingMeta');
      if(meta) meta.textContent='Treasury funding pressure unavailable.';
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',load); else load();
})();
