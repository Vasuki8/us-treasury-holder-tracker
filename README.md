# US Treasury Ownership Tracker

A focused GitHub Pages dashboard for understanding who owns U.S. Treasuries using official data sources and source-specific observation dates.

## Current dashboard

The public site now has a single Core experience. The former Research workspace, research-only navigation, comparison tools, drill-down panels, and legacy multi-phase UI layers have been removed from the frontend.

The retained dashboard contains:

- Four headline ownership metrics: total public debt, debt held by the public, Federal Reserve Treasury holdings, and total foreign Treasury holdings.
- Ownership Brief: a rule-based summary generated from the official-data state already produced by the updater.
- Market Structure Map: a compact summary of the existing market-structure dimensions without links into removed research panels.
- Foreign Treasury Holders: searchable TIC country holdings with 1-month, 3-month, and 1-year changes.
- Foreign Holder History: monthly country history plus the existing long-run Treasury survey history and country detail drawer.
- Ownership Share Snapshot: holder-group shares using their relevant denominators.
- JSON and CSV downloads for the retained Core data.

There is no Core/Research toggle anymore.

## Data discipline

The site checks official sources on its scheduled updater, but it never treats the website check time as the observation date. Each dataset keeps its actual reporting cadence and observation date.

Examples of source cadence include:

- Treasury Fiscal Data: business daily
- Federal Reserve H.4.1: weekly
- Treasury International Capital (TIC): monthly
- Federal Reserve Financial Accounts: quarterly
- New York Fed SOMA and Primary Dealer Statistics: weekly
- Treasury auctions: event driven
- SEC N-MFP: monthly
- SEC N-PORT: quarterly/cache workflow

The updater preserves the last verified observation when a source fails instead of fabricating a newer value. SEC public bulk files can return HTTP 403 to GitHub-hosted runners; that limitation remains handled in the data pipeline.

## Foreign-holder history

The tracker retains monthly TIC country history beginning with the earliest SLT observations in 2011 and Treasury-specific annual survey history beginning in 1994. Older consolidated survey columns are not relabeled as Treasury-specific holdings when the source does not separately identify Treasuries.

## Automation

The main workflow is `.github/workflows/update.yml`.

It:

1. validates the retained frontend JavaScript,
2. installs Python with `uv`,
3. refreshes `data/dashboard.json` through `scripts/update_data_v14.py`,
4. runs the existing Phase 8–12 and long-country-history data validators,
5. commits refreshed data only on non-PR runs and only when the generated data changed.

The separate `.github/workflows/nport.yml` workflow remains for the SEC N-PORT cache.

The Phase-named Python updater/validator files are intentionally retained because the current `update_data_v14.py` pipeline imports the preceding updater chain. They are data-pipeline dependencies even though the old Phase-named frontend files have been removed.

## Local use

Serve the repository root with any static HTTP server and open `index.html`. The frontend reads `data/dashboard.json` and uses Chart.js from the jsDelivr CDN.

To refresh data locally with the same package-manager approach as CI:

```powershell
uv python install 3.13
uv venv --python 3.13
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
.venv\Scripts\python.exe scripts\update_data_v14.py
```

On macOS/Linux, use `.venv/bin/python` instead of `.venv\Scripts\python.exe`.

## Deployment

GitHub Pages serves the repository from `main`. A merge or updater-generated data commit triggers the normal Pages deployment.
