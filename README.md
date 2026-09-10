# US Treasury Ownership Tracker

A static, GitHub-Pages-friendly dashboard that checks official U.S. Treasury and Federal Reserve sources every day.

## What it tracks

- **Total U.S. public debt** — Treasury Fiscal Data, business daily.
- **Debt held by the public / intragovernmental holdings** — Treasury Fiscal Data, business daily.
- **Federal Reserve Treasury holdings** — H.4.1, weekly.
- **Foreign country holdings** — Treasury International Capital (TIC), monthly.
- **Domestic and sector ownership** — Federal Reserve Financial Accounts F3.2.s, quarterly.

The site refreshes daily, but it never fabricates a daily ownership number. Every dataset keeps its real observation date.

## Local setup with uv

```powershell
uv venv --python 3.13
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
.venv\Scripts\python.exe scripts\update_data.py
python -m http.server 8000
```

Open `http://localhost:8000`.

## GitHub Pages

1. Create a public GitHub repository.
2. Upload/push this project.
3. Repository **Settings → Pages**.
4. Set **Source** to **Deploy from a branch**.
5. Select `main` and `/ (root)`.
6. The scheduled workflow `.github/workflows/update.yml` checks sources every day.

You can also run it manually from **Actions → Update Treasury holder data → Run workflow**.

## Next expansion

Phase 2 can add more granular institutional holders:

- SEC **N-MFP** money-market funds.
- SEC **N-PORT** mutual funds / ETFs.
- Bank and broker-dealer aggregates from Federal Reserve releases.
- NY Fed SOMA CUSIP-level Treasury holdings.
- Treasury auction allotments and investor-class data.
- Historical charts and holder-share calculations.

## Data caveat

There is no public official dataset naming every individual Treasury owner every day. The tracker is designed as the broadest official-data ownership view possible, and each section states its publication frequency and observation date.
