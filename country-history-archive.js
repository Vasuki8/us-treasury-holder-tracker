(() => {
  const RANGE_COUNTS = {'1Y':13,'3Y':37,'5Y':61,'10Y':121};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtB = value => value == null || !Number.isFinite(Number(value)) ? '—' : `$${Number(value).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
  const signedB = value => value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value)>=0?'+':''}${Number(value).toFixed(1)}B`;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function periodX(period){
    const match = String(period || '').match(/^(\d{4})(?:-(\d{2}))?/);
    if(!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2] || 1);
    return year + (Math.max(1, Math.min(12, month)) - 1) / 12;
  }

  function monthlyHistory(row){
    return (row?.history || [])
      .filter(item => item?.period && item?.holdings_billions != null)
      .map(item => ({period:String(item.period), value:Number(item.holdings_billions), source:'monthly'}))
      .filter(item => Number.isFinite(item.value))
      .sort((a,b) => a.period.localeCompare(b.period));
  }

  function preMonthlySurveyHistory(row){
    const monthly = monthlyHistory(row);
    const monthlyStart = monthly[0]?.period || '9999-99';
    return (row?.annual_survey_history || [])
      .filter(item => item?.period && item?.treasury_billions != null && String(item.period) < monthlyStart)
      .map(item => ({
        period:String(item.period),
        value:Number(item.treasury_billions),
        source:'annual_survey',
        coverage:item.coverage || null,
      }))
      .filter(item => Number.isFinite(item.value))
      .sort((a,b) => a.period.localeCompare(b.period));
  }

  function historyForRange(row, range){
    const monthly = monthlyHistory(row);
    if(range !== 'ALL') return monthly.slice(-(RANGE_COUNTS[range] || 121));
    return [...preMonthlySurveyHistory(row), ...monthly].sort((a,b) => a.period.localeCompare(b.period));
  }

  function renderRanges(host, active, onSelect){
    host.innerHTML = ['1Y','3Y','5Y','10Y','ALL']
      .map(range => `<button type="button" data-country-archive-range="${range}" class="${range===active?'active':''}">${range==='ALL'?'All':range}</button>`)
      .join('');
    host.querySelectorAll('[data-country-archive-range]').forEach(button => {
      button.addEventListener('click', () => onSelect(button.dataset.countryArchiveRange));
    });
  }

  async function load(){
    try{
      const response = await fetch(`data/dashboard.json?v=${Date.now()}`);
      if(!response.ok) return;
      const data = await response.json();
      const foreign = data?.foreign_holders || {};
      const countries = foreign.countries || [];
      if(!countries.length || !window.Chart) return;

      const select = document.getElementById('trendCountry');
      const canvas = document.getElementById('foreignTrendChart');
      const meta = document.getElementById('foreignTrendMeta');
      const panel = canvas?.closest('.panel');
      if(!select || !canvas || !panel) return;

      for(let i=0; i<60 && !select.options.length; i += 1) await sleep(100);
      if(!select.options.length){
        select.innerHTML = countries.map(row => `<option value="${esc(row.name)}">${esc(row.name)}</option>`).join('');
      }

      let controls = panel.querySelector('.country-trend-range');
      if(!controls){
        controls = document.createElement('div');
        controls.className = 'country-trend-range';
        meta?.insertAdjacentElement('afterend', controls);
      }

      let range = '10Y';
      const byName = name => countries.find(row => row.name === name) || countries[0];

      const draw = () => {
        const row = byName(select.value);
        if(!row) return;
        const history = historyForRange(row, range);
        const annualCount = history.filter(item => item.source === 'annual_survey').length;
        const monthlyCount = history.filter(item => item.source === 'monthly').length;
        const first = history[0]?.period || '—';
        const last = history[history.length - 1]?.period || '—';

        if(meta){
          meta.textContent = range === 'ALL'
            ? `${row.name} · ${fmtB(row.holdings_billions)} · ${annualCount} annual survey + ${monthlyCount} monthly observations · ${first} → ${last}`
            : `${row.name} · ${fmtB(row.holdings_billions)} · 1Y ${signedB(row.change_12m_billions)} · 5Y ${signedB(row.change_60m_billions)} · 10Y ${signedB(row.change_120m_billions)} · ${monthlyCount} monthly observations shown`;
        }

        const existing = Chart.getChart(canvas);
        if(existing) existing.destroy();

        const plotted = history
          .map(item => ({x:periodX(item.period), y:item.value}))
          .filter(item => Number.isFinite(item.x) && Number.isFinite(item.y));

        window.countryArchiveTrendChart = new Chart(canvas, {
          type:'line',
          data:{datasets:[{
            label:`${row.name} Treasury holdings ($B)`,
            data:plotted,
            borderWidth:2,
            tension:.16,
            fill:false,
            pointRadius:ctx => history[ctx.dataIndex]?.source === 'annual_survey' ? 2.8 : 0,
            pointHoverRadius:5,
            segment:{borderDash:ctx => history[ctx.p0DataIndex]?.source === 'annual_survey' ? [6,4] : []},
          }]},
          options:{
            responsive:true,
            maintainAspectRatio:false,
            parsing:false,
            interaction:{mode:'nearest',intersect:false},
            plugins:{
              legend:{labels:{color:'#dbe6f4'}},
              tooltip:{callbacks:{
                title:items => history[items?.[0]?.dataIndex]?.period || '',
                label:ctx => ` ${fmtB(ctx.parsed.y)}`,
                afterLabel:ctx => {
                  const item = history[ctx.dataIndex];
                  if(item?.source !== 'annual_survey') return ' Monthly TIC observation';
                  return item.coverage === 'long_term_only'
                    ? ' Annual Treasury survey · long-term Treasury debt only'
                    : ' Annual Treasury survey · long + short-term Treasury debt';
                },
              }},
            },
            scales:{
              x:{type:'linear',grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',maxTicksLimit:12,callback:value=>String(Math.round(Number(value)))}},
              y:{grid:{color:'rgba(148,184,221,.08)'},ticks:{color:'#96a6ba',callback:value=>`$${value}B`}},
            },
          },
        });
      };

      const bindRange = next => {
        range = next;
        renderRanges(controls, range, bindRange);
        draw();
      };

      renderRanges(controls, range, bindRange);
      select.onchange = draw;
      draw();
    }catch(error){
      console.error('Country archive history UI error', error);
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();
