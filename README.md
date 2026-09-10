# US Treasury Ownership Tracker

A GitHub Pages dashboard that checks official U.S. Treasury, Federal Reserve, New York Fed, and SEC sources every day.

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
- **Historical series** — bank/dealer history is loaded from official historical feeds, while the tracker also retains one compact dashboard snapshot per day for long-run comparisons.
- **Exports** — the website can download the full JSON dataset and a flattened current-snapshot CSV.

The site refreshes daily, but it never fabricates a daily ownership number. Every dataset keeps its real observation date.

## Current SEC limitation

SEC Form N-MFP is wired into the tracker, but SEC currently returns HTTP 403 to the GitHub-hosted updater for the public bulk archive. The dashboard exposes this in **Source Health** and retains any last valid N-MFP observation rather than presenting an error as current data. N-PORT bulk files are also very large (hundreds of MB per quarter), so that source needs a separate ingestion strategy rather than being silently added to the daily job.

## Data-model caveat

There is no single public official database naming every owner of every Treasury security each day. This tracker combines official datasets with different reporting scopes and lags. Auction awards are not current holdings, TIC country attribution can reflect custodial location, primary-dealer net positions are not an ownership register, and repo exposure is not the same as direct Treasury ownership.

## Local setup with uv

```powershell
uv venv --python 3.13
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
.venv\Scripts\python.exe scripts\update_data_v3.py
python -m http.server 8000
```

Open `http://localhost:8000`.

## GitHub Pages

1. Repository **Settings → Pages**.
2. Set **Source** to **Deploy from a branch**.
3. Select `main` and `/ (root)`.
4. The scheduled workflow `.github/workflows/update.yml` checks sources daily.
5. You can run it manually from **Actions → Update Treasury holder data → Run workflow**.

The updater retains the last successful observation for a source if that source temporarily fails, and the dashboard exposes that failure in **Source Health**.

## Next expansion

- SEC **Form N-PORT** mutual funds and ETFs using a separate quarterly ingestion job/cached dataset rather than a 400+ MB daily download.
- **CUSIP cross-source matching** across SOMA, Treasury issuance, and fund filings.
- More detailed **insurance and pension** ownership where public official sector data are available.
- **Holder-share and change analytics** such as 1-month, 3-month, 1-year and cycle comparisons.
- More granular Treasury issuance metadata and security-level drill-down pages.
