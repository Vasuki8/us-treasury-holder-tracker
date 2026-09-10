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

The site refreshes daily, but it never fabricates a daily ownership number. Every dataset keeps its real observation date.

## SEC bulk-data limitation

SEC Form N-MFP is wired into the tracker, but SEC currently returns HTTP 403 to the GitHub-hosted updater for the public bulk archive. The dashboard exposes this in **Source Health** and retains any last valid observation rather than presenting an error as current data.

Form N-PORT is handled separately by `.github/workflows/nport.yml`. The SEC publishes the public bulk dataset quarterly and the latest known archive configured in Phase 4 is **2026 Q2**. If SEC blocks the scheduled GitHub runner, the N-PORT panel remains marked `pending` while aggregate ETF holdings continue to update from Federal Reserve data.

## Data-model caveat

There is no single public official database naming every owner of every Treasury security each day. This tracker combines official datasets with different reporting scopes and lags. Auction awards are not current holdings, TIC country attribution can reflect custodial location, primary-dealer net positions are not an ownership register, repo exposure is not the same as direct Treasury ownership, and N-PORT reports market value rather than Treasury par value.

## Local setup with uv

```powershell
uv venv --python 3.13
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
.venv\Scripts\python.exe scripts\update_data_v4.py
python -m http.server 8000
```

Open `http://localhost:8000`.

## GitHub Pages

1. Repository **Settings → Pages**.
2. Set **Source** to **Deploy from a branch**.
3. Select `main` and `/ (root)`.
4. `.github/workflows/update.yml` checks the normal live sources daily.
5. `.github/workflows/nport.yml` handles the large SEC N-PORT archive quarterly or on demand.

You can also run either workflow manually from the repository **Actions** tab.

## N-PORT manual ingestion

For the currently configured SEC archive:

```powershell
.venv\Scripts\python.exe scripts\ingest_nport.py \
  --quarter "2026 Q2" \
  --url "https://www.sec.gov/files/dera/data/form-n-port-data-sets/2026q2_nport.zip"
```

The ingestion job keeps only the latest public report for each fund series, identifies U.S. Treasury holdings, aggregates fund-level market value, and builds a CUSIP index used by the security-intelligence panel.

## Next expansion

- Automatically discover each newly posted N-PORT quarter and update the quarterly archive manifest.
- Build named-fund drill-down pages from the N-PORT cache.
- Add more CUSIP-level Treasury issuance metadata beyond recent auctions.
- Add source-date-aware 1M/3M/1Y comparisons and alerts for unusually large holder changes.
- Add provenance links beside every dashboard table row and downloadable historical CSVs.
