# US Treasury Ownership Tracker

A GitHub Pages dashboard that checks official U.S. Treasury, Federal Reserve, New York Fed, and SEC sources on their real publication schedules.

The site refreshes daily, but it never fabricates a daily ownership number. Every dataset keeps its real observation date and source cadence.

## Coverage

### Core ownership
- **Total U.S. public debt** — Treasury Fiscal Data, business daily.
- **Debt held by the public / intragovernmental holdings** — Treasury Fiscal Data, business daily.
- **Federal Reserve Treasury holdings** — H.4.1 weekly series, retrieved through FRED to avoid Federal Reserve website bot-blocking on GitHub Actions.
- **Foreign country holdings** — Treasury International Capital (TIC), monthly.
- **Domestic and sector ownership** — Federal Reserve Financial Accounts, quarterly series retrieved through FRED.

### Phase 2
- **NY Fed SOMA Treasury holdings** — weekly, including CUSIP-level positions, maturity dates, type, par value and percent outstanding where published.
- **SEC Form N-MFP** — monthly individual money-market-fund Treasury exposure, with direct Treasuries separated from Treasury-collateralized repo.
- **Treasury auction takedown** — competitive awards split among primary dealers, indirect bidders and direct bidders.

### Phase 3
- **Bank Treasury holdings** — U.S.-chartered and private depository-institution Treasury aggregates from Federal Reserve Financial Accounts.
- **Broker-dealer holdings** — quarterly broker/dealer Treasury assets.
- **Primary-dealer positioning** — weekly NY Fed Treasury net positions and settlement fails.
- **Historical snapshots and exports** — one compact tracker snapshot per day plus JSON/CSV exports.

### Phase 4
- **Insurance, pensions, ETFs and hedge funds** — quarterly Federal Reserve sector aggregates.
- **Holder-change monitor** — ranks large changes while preserving each source's true cadence.
- **CUSIP security intelligence** — matches SOMA positions to Treasury auctions and cached SEC N-PORT data where available.
- **Quarterly N-PORT ingestion** — separate large-file workflow and compact cache.

### Phase 5
- **Federal government and trust-fund holders** — Treasury Monthly Treasury Statement government-account detail.
- **Intragovernmental reconciliation** — compares detailed government-account leaf lines with the Treasury intragovernmental total.
- **13-month TIC history** — country-level monthly history and 1M/3M/6M/12M changes.
- **Ownership-share and SOMA concentration views** — source-aligned denominator comparisons and maturity concentration.

### Phase 6
- **Audit trail and source provenance** — observation date, publication cadence, latest health check and official source links.
- **Historical/source exports** — analysis-ready history, source registry and alert CSVs.
- **Unusual-change monitor** — transparent history-relative rule using source-specific dollar floors.
- **CUSIP audit metadata** — time-to-maturity and contributing source blocks.

### Phase 7
- **Persistent alert lifecycle** — stable alert IDs, first/last seen timestamps, run counts and cleared timestamps.
- **Failure-aware clearing** — source failures do not falsely clear an active signal.
- **Lifecycle transitions** — opened, cleared, reopened and severity-changed events.
- **Deep Treasury auction metadata** — full CUSIP auction/reopening history rather than only a recent auction window.
- **Security drill-down** — issue/original-issue dates, term, maturity cross-check, auction history, bid-to-cover and rate/yield context.

### Phase 8
- **Robust alert diagnostics** — every current unusual-change alert receives an absolute-change percentile and a robust z-score based on the median and median absolute deviation (MAD). The current event is excluded from its own historical baseline.
- **Diagnostic labels** — moves are classified as notable, elevated or extreme while preserving the original transparent Phase 6 rule.
- **Notification-ready high-severity queue** — only future high-severity open, reopen or escalation transitions occurring after the Phase 8 watermark are emitted as new notification candidates.
- **Official source publication-change ledger** — records when the updater first detects that an official source advanced to a new reporting period.
- **SOMA CUSIP concentration monitor** — ranks stored SOMA securities by percent outstanding and derives an implied outstanding amount where the required official inputs exist.

### Phase 9
- **Holder Profile Explorer** — creates stable drill-down profiles for foreign countries, U.S. holder sectors and primary-dealer series, with source cadence, current value, previous value, latest change, rank, historical chart data and current alert diagnostics.
- **Clickable holder drill-downs** — foreign-holder, bank/dealer-sector, extended-sector and primary-dealer tables can jump into the corresponding holder profile.
- **Cross-holder flow breadth** — counts which tracked holders are accumulating, reducing or approximately flat within each source cadence.
- **Cadence-safe flow comparison** — monthly TIC, quarterly Financial Accounts and weekly dealer series are never added together into a fabricated synchronized dollar flow. Cross-scope comparisons use directional breadth instead.
- **Directional divergence signals** — highlights strong divergence between foreign-country breadth and U.S.-sector breadth, or broad accumulation/reduction when both scopes point the same way.
- **Foreign-holder concentration** — calculates Top-5 and Top-10 shares of reported foreign Treasury holdings.
- **Phase 9 exports** — downloadable holder-profile and flow-intelligence CSVs.

### Phase 10
- **Release Calendar & Freshness Monitor** — converts each source's real cadence and latest observation into an estimated next-observation / next-publication window, with scheduled, due-soon, due-now, grace-window, overdue, source-error, access-limited and event-driven states.
- **Fresh-release recognition** — sources that advance to a newly observed reporting period are highlighted separately from routine successful daily checks.
- **Persistent flow-regime history** — accumulation breadth is stored only when the underlying source observation signature advances. Daily updater runs with unchanged data do not create duplicate history points.
- **Flow-regime classification** — each scope is classified as broad accumulation, accumulation tilt, mixed, reduction tilt or broad reduction from directional breadth.
- **Cross-scope regime history** — foreign-country breadth and U.S.-sector breadth are compared directionally, preserving monthly-vs-quarterly cadence separation and tracking regime transitions over time.
- **Research Brief** — a rule-based summary surfaces the strongest currently available signals from flow divergence, TIC foreign-demand changes, anomaly diagnostics, SOMA concentration and source freshness. It uses only tracker data and is explicitly descriptive rather than predictive.
- **Phase 10 exports** — release-calendar CSV and persistent flow-regime-history CSV.
- **Operational validation** — CI validates release-calendar uniqueness/statuses, regime-history integrity, breadth bounds and research-brief structure before committing refreshed dashboard data.

## Important interpretation limits

There is no single public official database naming every owner of every Treasury security each day. This tracker combines official datasets with different reporting scopes and lags. Auction awards are not current holdings, TIC country attribution can reflect custodial location, primary-dealer net positions are not an ownership register, repo exposure is not direct Treasury ownership, and N-PORT reports market value rather than Treasury par value.

Government-account detail is a detailed view of intragovernmental investments and must not be added again on top of the intragovernmental total.

Alert diagnostics and the Research Brief are research screens, not forecasts. A high percentile, robust z-score or unusual-change flag means a move is unusual relative to the stored history; it does not identify a cause or imply a future market move.

Phase 9/10 flow breadth and regimes are not synchronized capital-flow estimates. Foreign-country data are monthly, U.S. sector data are quarterly, and primary-dealer data are weekly positioning series. The tracker keeps those concepts and dates separate.

Phase 10 release dates are tracker estimates built from normal source cadence and the latest observed reporting period. They are operational freshness diagnostics, not official publisher commitments, and the simple weekday adjustment does not model every U.S. federal holiday.

The Phase 8 source-change timestamp means “first observed by this tracker,” not necessarily the exact public release timestamp.

The Phase 8 implied outstanding figure is a derived metric from official New York Fed SOMA par and percent-outstanding inputs. It is not a separately reported Treasury balance.

## SEC bulk-data limitation

SEC Form N-MFP is wired into the tracker, but SEC can return HTTP 403 to GitHub-hosted runners for public bulk files. The dashboard exposes source failures rather than substituting stale data as current.

Form N-PORT is handled separately by `.github/workflows/nport.yml`. The cache can still be generated from a network environment that SEC permits.

## Local setup with uv

```powershell
uv venv --python 3.13
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
.venv\Scripts\python.exe scripts\update_data_v10.py
python -m http.server 8000
```

Open `http://localhost:8000`.

## GitHub Pages

1. Repository **Settings → Pages**.
2. Set **Source** to **Deploy from a branch**.
3. Select `main` and `/ (root)`.
4. `.github/workflows/update.yml` checks the normal live sources daily and runs the current Phase 10 updater.
5. `.github/workflows/nport.yml` remains the separate quarterly/on-demand N-PORT ingestion path.

You can also run either workflow manually from the repository **Actions** tab.

## N-PORT manual ingestion

```powershell
.venv\Scripts\python.exe scripts\ingest_nport.py \
  --quarter "2026 Q2" \
  --url "https://www.sec.gov/files/dera/data/form-n-port-data-sets/2026q2_nport.zip"
```

## Next expansion

- Add a dashboard-wide search/command palette so countries, sectors, CUSIPs, alerts and sources can be reached from one place.
- Add side-by-side holder comparison with normalized history and difference/breadth views.
- Add regime-duration and transition statistics after more official observation changes accumulate.
- Improve the release calendar with publisher-specific release dates where durable official machine-readable schedules are available.
- Add named-fund drill-downs when SEC N-PORT/N-MFP automated access becomes reliable.
