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

The site refreshes daily, but it never fabricates a daily ownership number. Every dataset keeps its real observation date.

## Data-model caveat

There is no single public official database naming every owner of every Treasury security each day. This tracker combines official datasets with different reporting scopes and lags. Auction awards are not current holdings, TIC country attribution can reflect custodial location, and repo exposure is not the same as direct Treasury ownership.

## Local setup with uv

```powershell
uv venv --python 3.13
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
.venv\Scripts\python.exe scripts\update_data.py
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

## Phase 3 candidates

- SEC **Form N-PORT** mutual funds and ETFs with direct Treasury holdings.
- Bank and broker-dealer Treasury aggregates and primary-dealer position data.
- Historical time series for holder shares and changes.
- CUSIP cross-source matching across SOMA, SEC funds, and Treasury issuance.
- Downloadable CSV/JSON snapshots and source-level provenance.
