# US Treasury Ownership Tracker

A GitHub Pages dashboard that checks official U.S. Treasury, Federal Reserve, New York Fed, and SEC sources on their real publication schedules.

## Coverage

### Core ownership
- **Total U.S. public debt** — Treasury Fiscal Data, business daily.
- **Debt held by the public / intragovernmental holdings** — Treasury Fiscal Data, business daily.
- **Federal Reserve Treasury holdings** — H.4.1 weekly series, retrieved through FRED to avoid Federal Reserve website bot-blocking on GitHub Actions.
- **Foreign country holdings** — Treasury International Capital (TIC), monthly.
- **Domestic and sector ownership** — Federal Reserve Financial Accounts, quarterly series retrieved through FRED.

### Phase 2
- **NY Fed SOMA Treasury holdings** — weekly, including CUSIP-level Treasury positions, maturity dates, type, and par value.
- **SEC Form N-MFP** — monthly individual money-market-fund Treasury exposure.
  - Direct U.S. Treasury debt is aggregated separately.
  - U.S. Treasury repurchase agreements are kept separate so repo collateral is not mislabeled as direct Treasury ownership.
- **Treasury auction takedown** — recent competitive awards split among primary dealers, indirect bidders, and direct bidders, plus recent auction statistics.

### Phase 3
- **Bank Treasury holdings** — U.S.-chartered and private depository-institution Treasury aggregates from the Federal Reserve Financial Accounts via FRED.
- **Broker-dealer Treasury holdings** — quarterly security-broker/dealer Treasury assets from the Financial Accounts.
- **Primary dealer positioning** — weekly New York Fed primary-dealer Treasury net positions and Treasury settlement fails.
- **Historical series** — bank/dealer history is loaded from official historical feeds, while the tracker also retains one compact dashboard snapshot per day.
- **Exports** — the website can download the full JSON dataset and a flattened current-snapshot CSV.

### Phase 4
- **Insurance-company Treasury holdings** — quarterly Federal Reserve Financial Accounts data.
- **Pension-fund Treasury holdings** — total and private pension sectors, quarterly.
- **ETF Treasury holdings** — aggregate exchange-traded-fund Treasury assets, quarterly.
- **Hedge-fund Treasury holdings** — aggregate hedge-fund Treasury assets, quarterly.
- **Holder-change monitor** — ranks large changes while preserving the correct source cadence: monthly for TIC countries, quarterly for sectors, weekly for primary-dealer series.
- **CUSIP security intelligence** — matches SOMA Treasury positions to recent Treasury auction records and, when available, cached SEC N-PORT fund holdings.
- **Quarterly N-PORT ingestion** — a separate workflow processes the SEC bulk Form N-PORT archive into a compact `data/nport_latest.json` cache so the daily updater never needs to download a 400+ MB ZIP.

### Phase 5
- **Federal government and trust-fund holders** — Treasury Monthly Treasury Statement Schedule D / Table 6d, including detailed account-level investments such as Social Security-related, Medicare-related, retirement and other federal accounts.
- **Intragovernmental reconciliation** — the detailed government-account leaf lines are compared with Debt to the Penny intragovernmental holdings using a matching observation date.
- **13-month TIC history by country** — every country keeps its monthly history plus 1-month, 3-month, 6-month and 12-month changes.
- **Interactive foreign-holder trend explorer** — select a major foreign holder and view its 13-month Treasury holdings trend.
- **Ownership-share snapshot** — foreign holders, Fed H.4.1, SOMA and government-account detail are compared with the appropriate Debt to the Penny denominator from the same date or latest business day before it.
- **SOMA concentration view** — top-CUSIP concentration and a maturity-bucket view of the large SOMA positions stored by the tracker.

### Phase 6
- **Audit trail and source provenance** — each major dataset records its observation date, publication cadence, latest health check, retrieval path and official source/API links.
- **Inline source links** — major dashboard sections and overview cards link directly to the official source represented by that figure.
- **Historical CSV exports** — export country histories, Federal Reserve sector histories, primary-dealer histories and the tracker's accumulated daily snapshots in one analysis-ready CSV.
- **Source-provenance export** — download the source registry and series IDs, including observation dates and retrieval links.
- **Unusual holder-change monitor** — source-cadence-aware screening for unusually large changes. A move must clear a source-specific dollar floor and be at least 2.5× its available-history median absolute change or at least 10% versus the prior observation; higher thresholds are marked high severity.
- **Alert export** — download the current unusual-change screen with magnitude, percentage move, historical baseline and reason for each flag.
- **CUSIP audit metadata** — security rows now expose derived time to maturity and identify which source blocks contributed each SOMA/auction/N-PORT match.

The site refreshes daily, but it never fabricates a daily ownership number. Every dataset keeps its real observation date.

## SEC bulk-data limitation

SEC Form N-MFP is wired into the tracker, but SEC currently returns HTTP 403 to the GitHub-hosted updater for the public bulk archive. The dashboard exposes this in **Source Health** and retains any last valid observation rather than presenting an error as current data.

Form N-PORT is handled separately by `.github/workflows/nport.yml`. The SEC publishes the public bulk dataset quarterly. GitHub-hosted-runner tests also receive HTTP 403 from the SEC dataset page, bulk archive, and tested SEC Archives filing URLs. Until SEC access from hosted runners changes, the N-PORT panel remains `pending` and aggregate ETF holdings continue to update from Federal Reserve data. The N-PORT cache can still be generated from a network environment that SEC permits.

## Data-model caveat

There is no single public official database naming every owner of every Treasury security each day. This tracker combines official datasets with different reporting scopes and lags. Auction awards are not current holdings, TIC country attribution can reflect custodial location, primary-dealer net positions are not an ownership register, repo exposure is not the same as direct Treasury ownership, and N-PORT reports market value rather than Treasury par value.

Government-account detail is also not a separate additive category on top of intragovernmental debt; it is a detailed view of federal-account investments. The dashboard therefore compares those account lines with the intragovernmental total instead of adding the two together.

The unusual-change monitor is a statistical research screen, not a forecast. A flag means the latest reported move is large under the stated history-relative rule; it does not identify a cause or imply a future price move.

## Local setup with uv

```powershell
uv venv --python 3.13
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
.venv\Scripts\python.exe scripts\update_data_current.py
python -m http.server 8000
```

Open `http://localhost:8000`.

## GitHub Pages

1. Repository **Settings → Pages**.
2. Set **Source** to **Deploy from a branch**.
3. Select `main` and `/ (root)`.
4. `.github/workflows/update.yml` checks the normal live sources daily.
5. `.github/workflows/nport.yml` is reserved for the large SEC N-PORT archive quarterly or on demand.

You can also run either workflow manually from the repository **Actions** tab.

## N-PORT manual ingestion

The ingestion script can auto-discover the latest SEC quarter when SEC permits access, or you can provide an archive explicitly:

```powershell
.venv\Scripts\python.exe scripts\ingest_nport.py \
  --quarter "2026 Q2" \
  --url "https://www.sec.gov/files/dera/data/form-n-port-data-sets/2026q2_nport.zip"
```

The ingestion job keeps only the latest public report for each fund series, identifies U.S. Treasury holdings, aggregates fund-level market value, and builds a CUSIP index used by the security-intelligence panel.

## Next expansion

- Expand Treasury-security issuance metadata beyond the recent 90-day auction window, including issue/original-issue dates and richer term/coupon context where official data support it.
- Add persistent alert history so a researcher can see when a holder first crossed the unusual-change threshold and when the flag cleared.
- Add named-fund drill-down pages whenever SEC N-PORT/N-MFP automated access becomes reliable.
- Add optional scheduled notifications for newly triggered high-severity holder changes after the underlying reporting source publishes a new observation.
