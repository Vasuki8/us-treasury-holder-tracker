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
  function baseDate(){
    const raw = block().calculated_from;
    const d = raw ? new Date(`${raw}T00:00:00Z`) : new Date();
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  function horizonEnd(){
    if(state.horizon === 'ALL') return null;
    const years = Number(state.horizon.replace('Y',''));
    if(!Number.isFinite(years)) return null;
    const d = baseDate();
    d.setUTCFullYear(d.getUTCFullYear() + years);
    return d;
  }
  function visibleMonths(){
    const end = horizonEnd();
    return (block().monthly || []).filter(row => {
      if(!end) return true;
      const d = new Date(`${row.month}-01T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d <= end;
    });
  }
  function visibleDates(){
    const end = horizonEnd();
    return (block().maturity_dates || []).filter(row => {
      if(!end) return true;
      const d = new Date(`${row.date}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d <= end;
    });
  }

  function renderCards(){
    const host = document.getElementById('maturityCards');
    if(!host) return;
    const summary = block().summary || {};
    const largest = summary.largest_month || {};
    const cards = [
      ['Next 30 days', fmt(summary.next_30d_billions), 'Gross principal scheduled to mature'],
      ['Next 90 days', fmt(summary.next_90d_billions), 'Gross principal scheduled to mature'],
      ['Next 12 months', fmt(summary.next_12m_billions), 'Gross principal scheduled to mature'],
      ['Largest maturity month', fmt(largest.total_billions), largest.month ? fmtMonth(largest.month) : '—'],
    ];
    host.innerHTML = cards.map(([label,value,meta]) => `<div class="maturity-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></div>`).join('');
  }

  function renderTypeStrip(){
    const host = document.getElementById('maturityTypeStrip');
    if(!host) return;
    const map = Object.fromEntries((block().by_type || []).map(row => [row.name,row.total_billions]));
    host.innerHTML = TYPES.map(type => `<div class="maturity-type"><span>${esc(type)}</span><strong>${esc(fmt(map[type]))}</strong></div>`).join('');
  }

  function renderRanges(){
    const host = document.getElementById('maturityRanges');
    if(!host) return;
    const ranges = ['1Y','2Y','5Y','10Y','ALL'];
    host.innerHTML = ranges.map(range => `<button type="button" data-maturity-range="${range}" class="${range===state.horizon?'active':''}">${range==='ALL'?'All':range}</button>`).join('');
    host.querySelectorAll('[data-maturity-range]').forEach(button => button.addEventListener('click', () => {
      state.horizon = button.dataset.maturityRange;
      renderRanges();
      drawChart();
      renderTable();
    }));
  }

  function drawChart(){
    const canvas = document.getElementById('maturityChart');
    if(!canvas || !window.Chart) return;
    const rows = visibleMonths();
    if(state.chart) state.chart.destroy();
    const existing = Chart.getChart(canvas);
    if(existing) existing.destroy();

    state.chart = new Chart(canvas, {
      type:'bar',
      data:{
        labels:rows.map(row=>row.month),
        datasets:TYPES.map(type=>({
          label:type,
          data:rows.map(row=>Number(row.by_type?.[type] || 0)),
          borderWidth:0,
          borderRadius:1,
        })),
      },
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
              footer:items=>`Total: ${fmt(items.reduce((sum,item)=>sum+Number(item.parsed.y||0),0))}`,
            },
          },
        },
        scales:{
          x:{stacked:true,grid:{display:false},ticks:{color:'#96a6ba',maxTicksLimit:18,callback:function(value){return fmtMonth(this.getLabelForValue(value));}}},
          y:{stacked:true,beginAtZero:true,grid:{color:'rgba(148,184,221,.10)'},ticks:{color:'#96a6ba',callback:value=>Number(value)>=1000?`$${(Number(value)/1000).toFixed(1)}T`:`$${value}B`}},
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
    if(meta) meta.textContent = `${rows.length.toLocaleString()} maturity dates in selected horizon · showing next ${shown.length}`;
    body.innerHTML = shown.map(row => `<tr>
      <td>${esc(fmtDate(row.date))}</td>
      <td>${esc(fmt(row.total_billions))}</td>
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
  function buildCsv(){
    const rows = [['cusip','security_type','issue_date','maturity_date','interest_rate_pct','outstanding_billions','mspd_as_of']];
    for(const row of block().securities || []) rows.push([
      row.cusip || '',row.security_type || '',row.issue_date || '',row.maturity_date || '',row.interest_rate_pct ?? '',row.outstanding_billions ?? '',block().as_of || ''
    ]);
    return rows.map(row=>row.map(csvCell).join(',')).join('\n');
  }
  function downloadCsv(){
    const blob = new Blob([buildCsv()], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'treasury-maturity-schedule.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function init(data){
    state.data = data;
    const panel = document.getElementById('maturityWallPanel');
    if(!panel) return;
    const maturity = block();
    const meta = document.getElementById('maturityMeta');
    if(!maturity.securities?.length){
      if(meta) meta.textContent = 'Treasury maturity schedule is not available yet.';
      panel.querySelector('.maturity-body')?.classList.add('maturity-empty');
      return;
    }
    if(meta) meta.textContent = `MSPD · ${maturity.as_of || '—'} · ${Number(maturity.security_count || 0).toLocaleString()} outstanding marketable securities · schedule measured from ${maturity.calculated_from || '—'}`;
    renderCards();
    renderTypeStrip();
    renderRanges();
    drawChart();
    renderTable();
    document.getElementById('downloadMaturityCsv')?.addEventListener('click', downloadCsv);
  }

  if(window.treasuryData) init(window.treasuryData);
  else window.addEventListener('treasury:data-ready', event => init(event.detail), {once:true});
})();
