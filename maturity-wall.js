(() => {
  const state = {data:null, horizon:'2Y', chart:null};
  const TYPES = ['Bills','Notes','Bonds','TIPS','FRNs'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => {
    const n = Number(value);
    if(!Number.isFinite(n)) return '—';
    return n >= 1000 ? `$${(n/1000).toLocaleString(undefined,{maximumFractionDigits:2})}T` : `$${n.toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  };
  const fmtMonth = value => {
    if(!value) return '—';
    const d = new Date(`${value}-01T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined,{year:'numeric',month:'short',timeZone:'UTC'});
  };
  const fmtDate = value => {
    if(!value) return '—';
    const d = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
  };

  function block(){ return state.data?.treasury_maturities || {}; }
  function interestBlock(){ return block().interest_schedule || {}; }
  function baseDate(){
    const raw = block().calculated_from;
    const d = raw ? new Date(`${raw}T00:00:00Z`) : new Date();
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  function horizonEnd(){
    if(state.horizon === 'ALL') return null;
    const d = baseDate();
    if(state.horizon === '30D') { d.setUTCDate(d.getUTCDate() + 30); return d; }
    if(state.horizon === '90D') { d.setUTCDate(d.getUTCDate() + 90); return d; }
    const years = Number(state.horizon.replace('Y',''));
    if(!Number.isFinite(years)) return null;
    d.setUTCFullYear(d.getUTCFullYear() + years);
    return d;
  }
  function horizonLabel(){
    return ({'30D':'30 days','90D':'90 days','1Y':'1 year','2Y':'2 years','5Y':'5 years','10Y':'10 years','ALL':'all future dates'})[state.horizon] || state.horizon;
  }
  function inHorizon(value, monthOnly=false){
    const end = horizonEnd();
    if(!end) return true;
    const d = new Date(monthOnly ? `${value}-01T00:00:00Z` : `${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d <= end;
  }
  function visibleMonths(){ return (block().monthly || []).filter(row => row.month && inHorizon(row.month, true)); }
  function visibleDates(){ return (block().maturity_dates || []).filter(row => row.date && inHorizon(row.date)); }
  function visibleSecurities(){ return (block().securities || []).filter(row => row.maturity_date && inHorizon(row.maturity_date)); }
  function visibleInterestPayments(){ return (interestBlock().payments || []).filter(row => row.date && inHorizon(row.date)); }
  function visibleInterestMonths(){ return (interestBlock().monthly || []).filter(row => row.month && inHorizon(row.month, true)); }

  function renderCards(){
    const host = document.getElementById('maturityCards');
    if(!host) return;
    const securities = visibleSecurities();
    const interest = visibleInterestPayments();
    const principal = securities.reduce((sum,row)=>sum+Number(row.outstanding_billions || 0),0);
    const interestTotal = interest.reduce((sum,row)=>sum+Number(row.total_billions || 0),0);
    const known = interest.reduce((sum,row)=>sum+Number(row.known_billions || 0),0);
    const estimated = interest.reduce((sum,row)=>sum+Number(row.estimated_billions || 0),0);
    const largest = visibleMonths().reduce((best,row)=>!best || Number(row.total_billions || 0)>Number(best.total_billions || 0) ? row : best, null);
    const label = horizonLabel();
    const cards = [
      [`Principal due · ${label}`, fmt(principal), `${securities.length.toLocaleString()} securities maturing in selected horizon`],
      [`Interest due · ${label}`, fmt(interestTotal), `Known ${fmt(known)} · Estimated ${fmt(estimated)}`],
      [`Principal + interest · ${label}`, fmt(principal + interestTotal), 'Gross scheduled cash obligations from current snapshot'],
      [`Largest maturity month · ${label}`, fmt(largest?.total_billions), largest?.month ? fmtMonth(largest.month) : '—'],
    ];
    host.innerHTML = cards.map(([title,value,meta]) => `<div class="maturity-card"><span>${esc(title)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`).join('');
  }

  function renderTypeStrip(){
    const host = document.getElementById('maturityTypeStrip');
    if(!host) return;
    const totals = Object.fromEntries(TYPES.map(type => [type,0]));
    visibleSecurities().forEach(row => { totals[row.security_type] = (totals[row.security_type] || 0) + Number(row.outstanding_billions || 0); });
    host.innerHTML = TYPES.map(type => `<div class="maturity-type"><span>${esc(type)} · ${esc(state.horizon==='ALL'?'All':state.horizon)}</span><strong>${esc(fmt(totals[type]))}</strong></div>`).join('');
  }

  function renderRanges(){
    const host = document.getElementById('maturityRanges');
    if(!host) return;
    const ranges = ['30D','90D','1Y','2Y','5Y','10Y','ALL'];
    host.innerHTML = ranges.map(range => `<button type="button" data-maturity-range="${range}" class="${range===state.horizon?'active':''}">${range==='ALL'?'All':range}</button>`).join('');
    host.querySelectorAll('[data-maturity-range]').forEach(button => button.addEventListener('click', () => {
      state.horizon = button.dataset.maturityRange;
      renderRanges();
      renderCards();
      renderTypeStrip();
      drawChart();
      renderTable();
    }));
  }

  function chartRows(){
    const maturityMap = new Map(visibleMonths().map(row => [row.month,row]));
    const interestMap = new Map(visibleInterestMonths().map(row => [row.month,row]));
    const months = [...new Set([...maturityMap.keys(), ...interestMap.keys()])].sort();
    return months.map(month => ({month, maturity:maturityMap.get(month) || {}, interest:interestMap.get(month) || {}}));
  }

  function drawChart(){
    const canvas = document.getElementById('maturityChart');
    if(!canvas || !window.Chart) return;
    const rows = chartRows();
    if(state.chart) state.chart.destroy();
    const existing = Chart.getChart(canvas);
    if(existing) existing.destroy();

    const principalSets = TYPES.map(type=>({
      type:'bar',
      label:type,
      data:rows.map(row=>Number(row.maturity.by_type?.[type] || 0)),
      borderWidth:0,
      borderRadius:1,
      yAxisID:'y',
      order:2,
    }));
    const interestSet = {
      type:'line',
      label:'Interest due (known + estimated)',
      data:rows.map(row=>Number(row.interest.total_billions || 0)),
      borderWidth:2,
      pointRadius:0,
      pointHoverRadius:4,
      tension:.2,
      yAxisID:'y1',
      order:1,
    };

    state.chart = new Chart(canvas, {
      data:{labels:rows.map(row=>row.month),datasets:[...principalSets,interestSet]},
      options:{
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{labels:{color:'#dbe6f4',boxWidth:12}},
          tooltip:{
            callbacks:{
              title:items=>items?.[0]?.label ? fmtMonth(items[0].label) : '',
              label:ctx=>` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
              footer:items=>{
                const row = rows[items?.[0]?.dataIndex];
                if(!row) return '';
                const principal = TYPES.reduce((sum,type)=>sum+Number(row.maturity.by_type?.[type] || 0),0);
                return [`Principal: ${fmt(principal)}`,`Interest: ${fmt(row.interest.total_billions || 0)}`];
              },
            },
          },
        },
        scales:{
          x:{stacked:true,grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:18,callback:function(value){return fmtMonth(this.getLabelForValue(value));}}},
          y:{stacked:true,beginAtZero:true,position:'left',grid:{color:'rgba(148,184,221,.10)'},ticks:{color:'#96a6ba',callback:value=>Number(value)>=1000?`$${(Number(value)/1000).toFixed(1)}T`:`$${value}B`},title:{display:true,text:'Principal',color:'#96a6ba'}},
          y1:{beginAtZero:true,position:'right',grid:{drawOnChartArea:false},ticks:{color:'#96a6ba',callback:value=>`$${Number(value).toFixed(0)}B`},title:{display:true,text:'Interest',color:'#96a6ba'}},
        },
      },
    });
  }

  function renderTable(){
    const body = document.getElementById('maturityTable');
    const meta = document.getElementById('maturityTableMeta');
    if(!body) return;
    const rows = visibleDates();
    const shown = rows.slice(0,30);
    const interestByDate = new Map((interestBlock().payments || []).map(row => [row.date,row]));
    if(meta) meta.textContent = `${rows.length.toLocaleString()} maturity dates in ${horizonLabel()} · showing next ${shown.length}`;
    body.innerHTML = shown.map(row => `<tr>
      <td>${esc(fmtDate(row.date))}</td>
      <td>${esc(fmt(row.total_billions))}</td>
      <td>${esc(fmt(interestByDate.get(row.date)?.total_billions || 0))}</td>
      <td>${esc(fmt(row.by_type?.Bills || 0))}</td>
      <td>${esc(fmt(row.by_type?.Notes || 0))}</td>
      <td>${esc(fmt(row.by_type?.Bonds || 0))}</td>
      <td>${esc(fmt(row.by_type?.TIPS || 0))}</td>
      <td>${esc(fmt(row.by_type?.FRNs || 0))}</td>
      <td>${Number(row.security_count || 0).toLocaleString()}</td>
    </tr>`).join('');
  }

  function csvCell(value){
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
  }
  function download(filename, text){
    const blob = new Blob([text], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  function buildMaturityCsv(){
    const rows = [['cusip','security_type','issue_date','maturity_date','interest_rate_pct','outstanding_billions','interest_status','coupon_frequency','next_interest_date','current_snapshot_payment_billions','mspd_as_of']];
    for(const row of block().securities || []) rows.push([
      row.cusip || '',row.security_type || '',row.issue_date || '',row.maturity_date || '',row.interest_rate_pct ?? '',row.outstanding_billions ?? '',row.interest_status || '',row.coupon_frequency || '',row.next_interest_date || '',row.current_snapshot_payment_billions ?? '',block().as_of || ''
    ]);
    return rows.map(row=>row.map(csvCell).join(',')).join('\n');
  }
  function buildInterestCsv(){
    const rows = [['payment_date','total_interest_billions','known_fixed_billions','estimated_billions','notes_billions','bonds_billions','tips_billions','frns_billions','security_count','mspd_as_of']];
    for(const row of interestBlock().payments || []) rows.push([
      row.date || '',row.total_billions ?? '',row.known_billions ?? '',row.estimated_billions ?? '',row.by_type?.Notes ?? 0,row.by_type?.Bonds ?? 0,row.by_type?.TIPS ?? 0,row.by_type?.FRNs ?? 0,row.security_count ?? 0,interestBlock().as_of || ''
    ]);
    return rows.map(row=>row.map(csvCell).join(',')).join('\n');
  }

  function init(data){
    state.data = data;
    const panel = document.getElementById('maturityWallPanel');
    if(!panel) return;
    const maturity = block();
    const interest = interestBlock();
    const meta = document.getElementById('maturityMeta');
    if(!maturity.securities?.length){
      if(meta) meta.textContent = 'Treasury maturity schedule is not available yet.';
      panel.querySelector('.maturity-body')?.classList.add('maturity-empty');
      return;
    }
    panel.querySelector('.maturity-body')?.classList.remove('maturity-empty');
    const coverage = Number(interest.rate_coverage_pct);
    const interestMeta = Number.isFinite(coverage) ? ` · interest-rate coverage ${coverage.toFixed(1)}%` : '';
    if(meta) meta.textContent = `MSPD · ${maturity.as_of || '—'} · ${Number(maturity.security_count || 0).toLocaleString()} outstanding marketable securities · schedule measured from ${maturity.calculated_from || '—'}${interestMeta}`;
    renderCards();
    renderTypeStrip();
    renderRanges();
    drawChart();
    renderTable();
    document.getElementById('downloadMaturityCsv')?.addEventListener('click', () => download('treasury-maturity-schedule.csv', buildMaturityCsv()));
    document.getElementById('downloadInterestCsv')?.addEventListener('click', () => download('treasury-interest-calendar.csv', buildInterestCsv()));
  }

  if(window.treasuryData) init(window.treasuryData);
  else window.addEventListener('treasury:data-ready', event => init(event.detail), {once:true});
})();
