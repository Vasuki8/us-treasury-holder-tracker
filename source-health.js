(() => {
  const sourceDefs = [
    ['overview', 'Treasury Fiscal Data — Debt to Penny'],
    ['fed', 'Federal Reserve H.4.1 — via FRED'],
    ['foreign_holders', 'Treasury — TIC'],
    ['domestic_sectors', 'Federal Reserve Financial Accounts — via FRED'],
    ['soma', 'New York Fed — SOMA'],
    ['primary_dealers', 'New York Fed — Primary Dealer Statistics'],
    ['institutional_aggregates', 'Federal Reserve — Banks & Dealers via FRED'],
    ['extended_holders', 'Federal Reserve — Extended holder sectors'],
    ['money_market_funds', 'SEC — Form N-MFP'],
    ['nport', 'SEC — Form N-PORT cache'],
    ['government_accounts', 'Treasury — Government accounts'],
    ['auctions', 'Treasury — Auctions']
  ];

  const injectStyles = () => {
    if (document.getElementById('sourceHealthEnhancementStyles')) return;
    const style = document.createElement('style');
    style.id = 'sourceHealthEnhancementStyles';
    style.textContent = `
      .source-health-summary{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:2px}
      .source-health-summary .mini strong{font-size:24px}
      .source-health-summary .mini small{display:block;color:var(--muted);margin-top:4px;line-height:1.4}
      .pill.access-limited{color:var(--warn)}
      .pill.attention{color:var(--bad)}
      .source-detail{margin-top:9px;color:var(--muted);font-size:11px;line-height:1.45}
      .source-detail b{color:var(--text);font-weight:650}
      .source-retained{margin-top:8px;padding:8px 9px;border:1px solid color-mix(in srgb,var(--warn) 35%,var(--line));border-radius:9px;color:var(--warn);font-size:11px;line-height:1.45;background:color-mix(in srgb,var(--warn) 5%,transparent)}
      .source-message{margin-top:7px;color:var(--muted);font-size:10px;line-height:1.4;overflow-wrap:anywhere}
      .source-link{display:inline-block;margin-top:8px;color:var(--accent);font-size:11px;text-decoration:none}
      .source-link:hover{text-decoration:underline}
      @media(max-width:700px){.source-health-summary{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  };

  const safeUrl = value => {
    try {
      const u = new URL(String(value || ''), window.location.href);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
    } catch {
      return '';
    }
  };

  const classify = (key, source) => {
    const status = String(source.status || 'unknown').toLowerCase();
    const message = String(source.message || '').toLowerCase();
    const secHostedBlock = ['money_market_funds', 'nport'].includes(key)
      && message.includes('403')
      && (message.includes('sec.gov') || message.includes('forbidden'));
    if (secHostedBlock) return {key: 'access-limited', label: 'access limited'};
    if (status === 'ok') return {key: 'ok', label: 'ok'};
    if (status === 'pending' || status === 'seed') return {key: status, label: status};
    if (status === 'error') return {key: 'attention', label: 'needs attention'};
    return {key: 'seed', label: status || 'unknown'};
  };

  const blockFor = key => (typeof data !== 'undefined' && data ? data[key] : null) || {};

  const observationDate = (key, block) => {
    if (block.as_of) return block.as_of;
    if (key === 'nport' && block.quarter) return block.quarter;
    if (key === 'auctions' && block.recent_auctions?.[0]?.auction_date) return block.recent_auctions[0].auction_date;
    return null;
  };

  const frequencyFor = (key, block) => {
    if (block.frequency) return block.frequency;
    const fallback = {
      overview: 'Business daily', fed: 'Weekly', foreign_holders: 'Monthly', domestic_sectors: 'Quarterly',
      soma: 'Weekly', primary_dealers: 'Weekly', institutional_aggregates: 'Quarterly', extended_holders: 'Quarterly',
      money_market_funds: 'Monthly', nport: 'Quarterly / cache refresh', government_accounts: 'Monthly', auctions: 'As auctions occur'
    };
    return fallback[key] || 'Source cadence';
  };

  const hasRetainedObservation = (block, observation) => Boolean(observation) && Object.keys(block || {}).length > 1;

  const enhancedRenderSources = () => {
    if (typeof data === 'undefined' || !data) return;
    const host = document.getElementById('sourceHealth');
    if (!host) return;
    injectStyles();

    const entries = sourceDefs.map(([key, name]) => {
      const source = (data.sources || {})[key] || {};
      const block = blockFor(key);
      const state = classify(key, source);
      const observation = observationDate(key, block);
      const frequency = frequencyFor(key, block);
      const checked = source.checked_at ? new Date(source.checked_at).toLocaleString() : 'Not checked yet';
      const sourceUrl = safeUrl(block.source_url || source.source_url);
      const retained = state.key !== 'ok' && hasRetainedObservation(block, observation);
      return {key, name, source, block, state, observation, frequency, checked, sourceUrl, retained};
    });

    const healthy = entries.filter(x => x.state.key === 'ok').length;
    const limited = entries.filter(x => x.state.key === 'access-limited').length;
    const attention = entries.filter(x => x.state.key === 'attention').length;

    const summary = `
      <div class="source-health-summary">
        <div class="mini"><span>Healthy checks</span><strong>${healthy}</strong><small>Official sources reached successfully on the latest run.</small></div>
        <div class="mini"><span>Access-limited</span><strong>${limited}</strong><small>Known publisher/hosted-runner restriction; retained observations are not advanced.</small></div>
        <div class="mini"><span>Needs attention</span><strong>${attention}</strong><small>Unexpected retrieval failures distinct from known access restrictions.</small></div>
      </div>`;

    const cards = entries.map(x => {
      const message = x.source.message ? `<div class="source-message">${esc(x.source.message)}</div>` : '';
      const retained = x.retained
        ? `<div class="source-retained">Latest verified observation retained: <b>${esc(x.observation)}</b>. The tracker does not promote this value to the current check date.</div>`
        : '';
      const link = x.sourceUrl ? `<a class="source-link" href="${esc(x.sourceUrl)}" target="_blank" rel="noopener noreferrer">Official source ↗</a>` : '';
      const limitation = x.state.key === 'access-limited'
        ? `<div class="source-message">GitHub-hosted runners can receive SEC HTTP 403 responses for public bulk files. This is tracked separately from an unexpected source failure.</div>`
        : '';
      return `<div class="source">
        <strong>${esc(x.name)}</strong>
        <small>Checked ${esc(x.checked)}</small><br>
        <span class="pill ${esc(x.state.key)}">${esc(x.state.label)}</span>
        <div class="source-detail"><b>Observation:</b> ${esc(x.observation || '—')}<br><b>Cadence:</b> ${esc(x.frequency)}</div>
        ${retained}${limitation}${message}${link}
      </div>`;
    }).join('');

    host.innerHTML = summary + cards;
  };

  window.renderSources = enhancedRenderSources;
  try { renderSources = enhancedRenderSources; } catch {}
  if (typeof data !== 'undefined' && data) enhancedRenderSources();
})();
