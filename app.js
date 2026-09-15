const TREASURY_THEME = Object.freeze({
  bg:'#f4f1e8',
  panel:'#fffdf8',
  text:'#1b2938',
  muted:'#657283',
  line:'#d8d2c5',
  grid:'rgba(55,74,89,.11)',
  gridStrong:'rgba(55,74,89,.24)',
  accent:'#176b7e',
  teal:'#3c887e',
  amber:'#a9792d',
  plum:'#77638d',
  blue:'#456f9a',
  green:'#3f7959',
  red:'#aa4652',
  slate:'#697b86',
  tooltip:'#203342',
  tooltipBorder:'#456171',
});
window.treasuryTheme = TREASURY_THEME;

(() => {
  const styleId = 'treasuryPaperThemeStyles';
  if(!document.getElementById(styleId)){
    const link = document.createElement('link');
    link.id = styleId;
    link.rel = 'stylesheet';
    link.href = 'theme.css?v=20260915-treasury-paper';
    document.head.appendChild(link);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', TREASURY_THEME.bg);

  if(!window.Chart) return;
  const p = TREASURY_THEME;
  const seriesPalette = [p.accent,p.amber,p.teal,p.plum,p.blue,p.green,p.red,p.slate];
  const rgba = (hex, alpha) => {
    const value = String(hex || '').replace('#','');
    if(!/^[0-9a-f]{6}$/i.test(value)) return hex;
    const number = Number.parseInt(value,16);
    return `rgba(${(number>>16)&255},${(number>>8)&255},${number&255},${alpha})`;
  };
  const datasetColor = (dataset,index) => {
    const label = String(dataset?.label || '').toLowerCase();
    if(label.includes('principal')) return p.accent;
    if(label.includes('interest')) return p.amber;
    if(label.includes('issuance')) return p.teal;
    if(label.includes('buyback')) return p.plum;
    if(label.includes('gdp')) return p.green;
    if(label.includes('tga')) return p.teal;
    if(label.includes('real') || label.includes('tips')) return p.green;
    return seriesPalette[index % seriesPalette.length];
  };
  const applyTheme = chart => {
    const options = chart.config.options || (chart.config.options = {});
    options.color = p.text;
    options.borderColor = p.grid;

    const plugins = options.plugins || (options.plugins = {});
    if(plugins.legend !== false){
      const legend = plugins.legend || (plugins.legend = {});
      const labels = legend.labels || (legend.labels = {});
      labels.color = p.text;
    }
    if(plugins.title) plugins.title.color = p.text;
    if(plugins.subtitle) plugins.subtitle.color = p.muted;
    if(plugins.tooltip !== false){
      const tooltip = plugins.tooltip || (plugins.tooltip = {});
      tooltip.backgroundColor = p.tooltip;
      tooltip.titleColor = '#fffdf8';
      tooltip.bodyColor = '#f2f5f5';
      tooltip.footerColor = '#d7e2e4';
      tooltip.borderColor = p.tooltipBorder;
      tooltip.borderWidth = 1;
      tooltip.cornerRadius = 8;
      tooltip.padding = 10;
    }

    Object.values(options.scales || {}).forEach(scale => {
      const ticks = scale.ticks || (scale.ticks = {});
      ticks.color = p.muted;
      const title = scale.title;
      if(title) title.color = p.muted;
      const border = scale.border || (scale.border = {});
      border.color = p.line;
      const grid = scale.grid || (scale.grid = {});
      if(grid.display !== false){
        const hadDynamicGrid = typeof grid.color === 'function';
        grid.color = ctx => Number(ctx?.tick?.value) === 0 && hadDynamicGrid ? p.gridStrong : p.grid;
        grid.tickColor = p.line;
      }
    });

    (chart.config.data?.datasets || []).forEach((dataset,index) => {
      const color = datasetColor(dataset,index);
      const hasColorArray = Array.isArray(dataset.backgroundColor) || Array.isArray(dataset.borderColor);
      if(!hasColorArray && dataset.borderColor == null) dataset.borderColor = color;
      if(!hasColorArray && dataset.backgroundColor == null){
        const type = dataset.type || chart.config.type;
        dataset.backgroundColor = rgba(color, type === 'line' ? .13 : .68);
      }
      if(dataset.pointBackgroundColor == null) dataset.pointBackgroundColor = color;
      if(dataset.pointBorderColor == null) dataset.pointBorderColor = p.panel;
    });
  };

  Chart.defaults.color = p.text;
  Chart.defaults.borderColor = p.grid;
  Chart.defaults.font.family = 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
  Chart.register({
    id:'treasury-paper-theme',
    beforeInit:applyTheme,
    beforeUpdate:applyTheme,
  });
})();

const fmtB = v => v == null || !Number.isFinite(Number(v)) ? '—' : `$${Number(v).toLocaleString(undefined,{maximumFractionDigits:1})}B`;
const fmtUSD = v => v == null || !Number.isFinite(Number(v)) ? '—' : (Number(v) >= 1e12 ? `$${(Number(v)/1e12).toLocaleString(undefined,{maximumFractionDigits:3})}T` : `$${(Number(v)/1e9).toLocaleString(undefined,{maximumFractionDigits:1})}B`);
const fmtPct = v => v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(1)}%`;
const signedB = v => v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}B`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug = s => String(s || 'neutral').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

let data;
const charts = {};

function destroyChart(key){
  if(charts[key]){
    charts[key].destroy();
    charts[key] = null;
  }
}

function renderOverview(){
  const o = data.overview || {};
  const f = data.fed || {};
  const x = data.foreign_holders || {};
  const cards = [
    ['Total public debt', fmtUSD(o.total_public_debt), o.as_of ? `Fiscal Data · ${o.as_of}` : 'Awaiting fetch'],
    ['Debt held by public', fmtUSD(o.debt_held_by_public), o.as_of ? `Fiscal Data · ${o.as_of}` : 'Business daily'],
    ['Federal Reserve', fmtB(f.treasury_holdings_billions), `H.4.1 · ${f.as_of || 'latest weekly'}`],
    ['Foreign holders', fmtB(x.grand_total_billions), `TIC · ${x.as_of || 'latest monthly'}`]
  ];
  const host = document.getElementById('overviewCards');
  if(host) host.innerHTML = cards.map(([label,value,meta]) => `<div class="card"><div class="kicker">${esc(label)}</div><div class="value">${esc(value)}</div><div class="meta">${esc(meta)}</div></div>`).join('');
}

function renderOwnershipBrief(){
  const block = data.research_brief || {};
  const meta = document.getElementById('ownershipBriefMeta');
  if(meta) meta.textContent = block.note || 'Rule-based summary of the latest official ownership observations.';
  const host = document.getElementById('ownershipBriefCards');
  const items = block.items || [];
  if(!host) return;
  host.innerHTML = items.length ? items.map(item => `
    <article class="insight-card ${esc(slug(item.severity || 'neutral'))}">
      <div class="insight-top"><span>${esc(item.category || 'Ownership')}</span><span class="insight-state">${esc(item.severity || 'neutral')}</span></div>
      <strong>${esc(item.title || 'Current signal')}</strong>
      <p>${esc(item.text || '')}</p>
      <small>${esc(item.caveat || '')}</small>
    </article>`).join('') : '<div class="empty-state">No ownership brief is available yet.</div>';
}

function renderMarketStructure(){
  const block = data.market_structure_map || {};
  const dims = block.dimensions || [];
  const meta = document.getElementById('marketStructureMeta');
  if(meta) meta.textContent = block.note || '';
  const state = document.getElementById('marketStructureState');
  if(state){
    state.textContent = block.overall_state || '—';
    state.className = `structure-state ${slug(block.overall_state || 'mixed')}`;
  }
  const grid = document.getElementById('marketStructureGrid');
  if(!grid) return;
  grid.innerHTML = dims.length ? dims.map(row => `
    <article class="structure-card ${esc(slug(row.state || 'neutral'))}">
      <div class="structure-card-top"><span>${esc(row.label || row.key || 'Dimension')}</span><span class="structure-dot"></span></div>
      <strong>${esc(row.display || '—')}</strong>
      <em>${esc(row.reading || '')}</em>
      <p>${esc(row.detail || '')}</p>
      <small>${row.observation ? `Observation ${esc(row.observation)}` : 'Observation —'}</small>
    </article>`).join('') : '<div class="empty-state">Market-structure summary is not available yet.</div>';
}

function renderForeign(){
  const block = data.foreign_holders || {};
  const countries = block.countries || [];
  const meta = document.getElementById('foreignMeta');
  if(meta) meta.textContent = `Treasury TIC · ${block.as_of || '—'} · ${block.country_count || countries.length} countries · monthly history since ${block.history_start || '—'}`;
  const table = document.getElementById('foreignTable');
  const search = document.getElementById('countrySearch');
  const draw = rows => {
    if(!table) return;
    table.innerHTML = rows.map(row => `
      <tr>
        <td>${esc(row.name)}</td>
        <td>${fmtB(row.holdings_billions)}</td>
        <td class="${(row.change_billions || 0) >= 0 ? 'up' : 'down'}">${signedB(row.change_billions)}</td>
        <td class="${(row.change_3m_billions || 0) >= 0 ? 'up' : 'down'}">${signedB(row.change_3m_billions)}</td>
        <td class="${(row.change_12m_billions || 0) >= 0 ? 'up' : 'down'}">${signedB(row.change_12m_billions)}</td>
      </tr>`).join('');
  };
  draw(countries);
  if(search) search.oninput = event => {
    const q = event.target.value.trim().toLowerCase();
    draw(!q ? countries : countries.filter(row => String(row.name || '').toLowerCase().includes(q)));
  };

  destroyChart('foreign');
  const canvas = document.getElementById('foreignChart');
  const top = countries.slice(0, 12);
  if(canvas && top.length && window.Chart){
    charts.foreign = new Chart(canvas, {
      type: 'bar',
      data: {labels: top.map(row => row.name), datasets: [{label:'Holdings ($B)', data:top.map(row => row.holdings_billions)}]},
      options: {indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{color:TREASURY_THEME.grid},ticks:{color:TREASURY_THEME.muted}},y:{grid:{display:false},ticks:{color:TREASURY_THEME.text}}}}
    });
  }
}

function renderOwnershipShares(){
  const block = data.ownership_shares || {};
  const rows = block.rows || [];
  const meta = document.getElementById('shareMeta');
  if(meta) meta.textContent = block.note || '';
  const table = document.getElementById('shareTable');
  if(table) table.innerHTML = rows.map(row => `<tr><td>${esc(row.name)}</td><td>${fmtB(row.holdings_billions)}</td><td>${esc(row.denominator || '—')}</td><td>${fmtPct(row.share_pct)}</td></tr>`).join('');

  destroyChart('shares');
  const canvas = document.getElementById('shareChart');
  if(canvas && rows.length && window.Chart){
    charts.shares = new Chart(canvas, {
      type:'bar',
      data:{labels:rows.map(row => row.name), datasets:[{label:'Share of relevant denominator (%)', data:rows.map(row => row.share_pct)}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:TREASURY_THEME.grid},ticks:{color:TREASURY_THEME.muted,callback:value=>`${value}%`}},x:{grid:{display:false},ticks:{color:TREASURY_THEME.text}}}}
    });
  }
}

function csvCell(value){
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
}

function buildSnapshotCsv(){
  const rows = [['section','name','holdings_billions','change_1m_billions','change_3m_billions','change_1y_billions','share_pct','as_of']];
  const o = data.overview || {};
  if(o.total_public_debt != null) rows.push(['overview','Total public debt',Number(o.total_public_debt)/1e9,'','','','',o.as_of || '']);
  if(o.debt_held_by_public != null) rows.push(['overview','Debt held by public',Number(o.debt_held_by_public)/1e9,'','','','',o.as_of || '']);
  const fed = data.fed || {};
  rows.push(['overview','Federal Reserve',fed.treasury_holdings_billions ?? '','','','','',fed.as_of || '']);
  const foreign = data.foreign_holders || {};
  for(const row of foreign.countries || []) rows.push(['foreign_holder',row.name,row.holdings_billions ?? '',row.change_billions ?? '',row.change_3m_billions ?? '',row.change_12m_billions ?? '','',foreign.as_of || '']);
  for(const row of data.ownership_shares?.rows || []) rows.push(['ownership_share',row.name,row.holdings_billions ?? '','','','',row.share_pct ?? '',data.ownership_shares?.as_of || '']);
  return rows.map(row => row.map(csvCell).join(',')).join('\n');
}

function downloadBlob(name, text, type){
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function wireDownloads(){
  document.getElementById('downloadJson')?.addEventListener('click', () => downloadBlob('treasury-holder-data.json', JSON.stringify(data, null, 2), 'application/json'));
  document.getElementById('downloadCsv')?.addEventListener('click', () => downloadBlob('treasury-core-snapshot.csv', buildSnapshotCsv(), 'text/csv;charset=utf-8'));
}

async function load(){
  try{
    const response = await fetch(`data/dashboard.json?v=${Date.now()}`);
    if(!response.ok) throw new Error(`dashboard.json ${response.status}`);
    data = await response.json();
    window.treasuryData = data;
    const status = document.getElementById('updateStatus');
    if(status) status.textContent = data.generated_at ? `Checked ${new Date(data.generated_at).toLocaleString()}` : 'Awaiting first refresh';
    renderOverview();
    renderOwnershipBrief();
    renderMarketStructure();
    renderForeign();
    renderOwnershipShares();
    wireDownloads();
    window.dispatchEvent(new CustomEvent('treasury:data-ready', {detail:data}));
  }catch(error){
    console.error('Dashboard load error', error);
    const status = document.getElementById('updateStatus');
    if(status) status.textContent = 'Data load failed';
  }
}

load();
