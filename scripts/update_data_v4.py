from __future__ import annotations

import json
from pathlib import Path

import update_data_v3 as phase3

base = phase3.base
DATA_FILE = base.DATA_FILE
NPORT_CACHE = base.ROOT / "data" / "nport_latest.json"

NPORT_DATASET_PAGE = "https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets"
NPORT_LATEST_QUARTER = "2026 Q2"
NPORT_LATEST_ARCHIVE = "https://www.sec.gov/files/dera/data/form-n-port-data-sets/2026q2_nport.zip"

EXTENDED_SERIES = [
    ("Insurance companies", "BOGZ1LM523061105Q", "Quarterly"),
    ("Pension funds", "BOGZ1FL593061105Q", "Quarterly"),
    ("Private pension funds", "BOGZ1FL573061105Q", "Quarterly"),
    ("Exchange-traded funds", "BOGZ1LM563061103Q", "Quarterly"),
    ("Hedge funds", "BOGZ1FL623061103Q", "Quarterly"),
]


def _change_metrics(history: list[dict]) -> dict:
    if not history:
        return {
            "qoq_change_billions": None,
            "qoq_change_pct": None,
            "yoy_change_billions": None,
            "yoy_change_pct": None,
        }

    latest = history[-1]["value_billions"]
    prev = history[-2]["value_billions"] if len(history) >= 2 else None
    year_ago = history[-5]["value_billions"] if len(history) >= 5 else None

    def pct_change(current, old):
        if current is None or old in (None, 0):
            return None
        return (current - old) / abs(old) * 100.0

    return {
        "qoq_change_billions": latest - prev if prev is not None else None,
        "qoq_change_pct": pct_change(latest, prev),
        "yoy_change_billions": latest - year_ago if year_ago is not None else None,
        "yoy_change_pct": pct_change(latest, year_ago),
    }


def fetch_extended_holders() -> dict:
    holders = []
    latest_date = None
    for name, series_id, frequency in EXTENDED_SERIES:
        history = phase3.fred_history(series_id, limit=44)
        if not history:
            continue
        latest = history[-1]
        latest_date = max(latest_date or latest["date"], latest["date"])
        holders.append(
            {
                "name": name,
                "series": series_id,
                "as_of": latest["date"],
                "holdings_billions": latest["value_billions"],
                "frequency": frequency,
                "history": history,
                **_change_metrics(history),
            }
        )

    if len(holders) < 4:
        raise RuntimeError("Could not retrieve enough extended holder series")

    return {
        "as_of": latest_date,
        "holders": holders,
        "frequency": "Quarterly",
        "source_url": "https://fred.stlouisfed.org/",
        "note": "These are Federal Reserve Financial Accounts sector aggregates, not named-firm holdings.",
    }


def load_nport_cache() -> dict:
    if NPORT_CACHE.exists():
        payload = json.loads(NPORT_CACHE.read_text(encoding="utf-8"))
        payload.setdefault("dataset_page", NPORT_DATASET_PAGE)
        payload.setdefault("latest_available_quarter", NPORT_LATEST_QUARTER)
        payload.setdefault("latest_archive_url", NPORT_LATEST_ARCHIVE)
        payload["cache_status"] = "available"
        return payload

    return {
        "cache_status": "not_ingested",
        "latest_available_quarter": NPORT_LATEST_QUARTER,
        "latest_archive_url": NPORT_LATEST_ARCHIVE,
        "dataset_page": NPORT_DATASET_PAGE,
        "fund_count": 0,
        "direct_treasury_total_billions": None,
        "funds": [],
        "by_cusip": [],
        "note": "SEC Form N-PORT bulk files are hundreds of MB and are ingested by a separate quarterly workflow rather than the daily updater.",
    }


def build_security_intelligence(data: dict) -> dict:
    soma = data.get("soma", {})
    auctions = data.get("auctions", {})
    nport = data.get("nport", {})

    auction_by_cusip = {}
    for row in auctions.get("recent_auctions", []):
        cusip = str(row.get("cusip") or "").strip().upper()
        if cusip and cusip not in auction_by_cusip:
            auction_by_cusip[cusip] = row

    nport_by_cusip = {}
    for row in nport.get("by_cusip", []):
        cusip = str(row.get("cusip") or "").strip().upper()
        if cusip:
            nport_by_cusip[cusip] = row

    rows = []
    for holding in soma.get("top_holdings", []):
        cusip = str(holding.get("cusip") or "").strip().upper()
        if not cusip:
            continue
        auction = auction_by_cusip.get(cusip, {})
        fund = nport_by_cusip.get(cusip, {})
        pct = holding.get("percent_outstanding")
        rows.append(
            {
                "cusip": cusip,
                "security_type": holding.get("security_type"),
                "maturity_date": holding.get("maturity_date"),
                "soma_par_billions": holding.get("par_value_billions"),
                "soma_pct_outstanding": pct * 100.0 if pct is not None and pct <= 1.5 else pct,
                "latest_auction_date": auction.get("auction_date"),
                "auction_security_term": auction.get("security_term"),
                "auction_offering_billions": auction.get("offering_billions"),
                "nport_fund_value_billions": fund.get("market_value_billions"),
                "nport_fund_count": fund.get("fund_count"),
            }
        )

    rows.sort(key=lambda x: x.get("soma_par_billions") or 0, reverse=True)
    matched_auctions = sum(1 for r in rows if r.get("latest_auction_date"))
    matched_nport = sum(1 for r in rows if r.get("nport_fund_count"))
    return {
        "as_of": soma.get("as_of"),
        "rows": rows[:100],
        "row_count": len(rows),
        "auction_matches": matched_auctions,
        "nport_matches": matched_nport,
        "note": "CUSIP matching combines SOMA positions with recent Treasury auctions and, when the quarterly N-PORT cache is available, fund holdings. A missing match does not mean no other holder owns the security.",
    }


def build_change_leaderboard(data: dict) -> dict:
    movers = []

    for row in data.get("foreign_holders", {}).get("countries", []):
        change = row.get("change_billions")
        if change is not None:
            movers.append(
                {
                    "scope": "Foreign country",
                    "name": row.get("name"),
                    "period": "MoM",
                    "current_billions": row.get("holdings_billions"),
                    "change_billions": change,
                }
            )

    for block_name in ("institutional_aggregates", "extended_holders"):
        block = data.get(block_name, {})
        rows = block.get("institutions", []) if block_name == "institutional_aggregates" else block.get("holders", [])
        for row in rows:
            if block_name == "institutional_aggregates":
                metrics = _change_metrics(row.get("history", []))
                change = metrics.get("qoq_change_billions")
            else:
                change = row.get("qoq_change_billions")
            if change is not None:
                movers.append(
                    {
                        "scope": "U.S. sector",
                        "name": row.get("name"),
                        "period": "QoQ",
                        "current_billions": row.get("holdings_billions"),
                        "change_billions": change,
                    }
                )

    for row in data.get("primary_dealers", {}).get("series", []):
        change = row.get("weekly_change_billions")
        if change is not None:
            movers.append(
                {
                    "scope": "Primary dealer",
                    "name": row.get("name"),
                    "period": "WoW",
                    "current_billions": row.get("value_billions"),
                    "change_billions": change,
                }
            )

    ranked = sorted(movers, key=lambda x: abs(x.get("change_billions") or 0), reverse=True)
    return {
        "largest_absolute_moves": ranked[:20],
        "largest_increases": sorted(movers, key=lambda x: x.get("change_billions") or 0, reverse=True)[:10],
        "largest_decreases": sorted(movers, key=lambda x: x.get("change_billions") or 0)[:10],
        "note": "Periods differ by source: countries are monthly, sectors quarterly, and primary-dealer series weekly.",
    }


def enrich_daily_history(data: dict) -> None:
    if not data.get("history"):
        return
    latest = data["history"][-1]
    mapping = {
        "Insurance companies": "insurance_treasuries_billions",
        "Pension funds": "pension_treasuries_billions",
        "Exchange-traded funds": "etf_treasuries_billions",
        "Hedge funds": "hedge_fund_treasuries_billions",
    }
    for holder in data.get("extended_holders", {}).get("holders", []):
        key = mapping.get(holder.get("name"))
        if key:
            latest[key] = holder.get("holdings_billions")


def main() -> None:
    phase3.main()

    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    data.setdefault("sources", {})
    data.setdefault("errors", [])

    base.update_section(data, "extended_holders", fetch_extended_holders)

    data["nport"] = load_nport_cache()
    data["sources"]["nport"] = {
        "status": "ok" if data["nport"].get("cache_status") == "available" else "pending",
        "checked_at": base.now_iso(),
        "message": (
            None
            if data["nport"].get("cache_status") == "available"
            else "Quarterly N-PORT cache has not been ingested yet; aggregate ETF holdings remain available from Federal Reserve data."
        ),
    }

    data["security_intelligence"] = build_security_intelligence(data)
    data["change_leaderboard"] = build_change_leaderboard(data)
    enrich_daily_history(data)
    data["generated_at"] = base.now_iso()

    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Phase 4 updated {DATA_FILE}")


if __name__ == "__main__":
    main()
