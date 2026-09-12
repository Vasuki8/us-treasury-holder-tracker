from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    demand = data.get("auction_demand_monitor") or {}
    recent = demand.get("recent") or []
    require(len(recent) >= 20, f"Auction demand needs >=20 recent observations, got {len(recent)}")
    scored = [row for row in recent if row.get("demand_score") is not None]
    require(len(scored) >= 15, f"Auction demand scoring coverage too low: {len(scored)}")
    for row in scored:
        score = float(row["demand_score"])
        require(0 <= score <= 100, f"Auction demand score outside 0-100: {score}")
        require(row.get("auction_date"), "Auction demand row missing auction_date")

    shares = data.get("ownership_share_history") or {}
    series = shares.get("series") or []
    require(len(series) >= 8, f"Ownership share history needs >=8 series, got {len(series)}")
    keys = {row.get("key") for row in series}
    require("foreign_total" in keys, "Ownership shares missing foreign total")
    require("federal_reserve" in keys, "Ownership shares missing Federal Reserve")
    require("hedge_funds" in keys, "Ownership shares missing hedge funds")
    for row in series:
        observations = row.get("observations") or []
        require(len(observations) >= 4, f"Ownership share series too short: {row.get('key')}")
        require(observations == sorted(observations, key=lambda item: item.get("date") or ""), f"Ownership share series unsorted: {row.get('key')}")
        for obs in observations:
            require(obs.get("date"), f"Ownership share observation missing date: {row.get('key')}")
            require(obs.get("denominator_date"), f"Ownership share observation missing denominator date: {row.get('key')}")
            require(float(obs.get("debt_held_by_public_billions") or 0) > 0, f"Invalid ownership denominator: {row.get('key')}")
            share = float(obs.get("share_pct"))
            require(-25 <= share <= 150, f"Implausible ownership share {share} for {row.get('key')}")

    cost = data.get("treasury_debt_cost") or {}
    rates = (cost.get("average_rates") or {}).get("series") or []
    require(len(rates) >= 5, f"Debt cost average-rate series too sparse: {len(rates)}")
    rate_map = {row.get("key"): row for row in rates}
    require("total_marketable" in rate_map, "Debt cost missing total marketable rate")
    for row in rates:
        observations = row.get("observations") or []
        require(len(observations) >= 60, f"Average rate history too short: {row.get('key')} ({len(observations)})")
        latest = float(row.get("latest_rate_pct"))
        require(-5 <= latest <= 25, f"Implausible latest average rate {latest} for {row.get('key')}")

    expense = cost.get("interest_expense") or {}
    expense_rows = expense.get("observations") or []
    require(len(expense_rows) >= 60, f"Interest expense history too short: {len(expense_rows)}")
    require(float(cost.get("trailing_12m_interest_expense_billions") or 0) > 100, "TTM interest expense unexpectedly low")
    warm = float(cost.get("weighted_average_remaining_maturity_years") or 0)
    require(1 <= warm <= 20, f"Weighted average remaining maturity implausible: {warm}")
    next12 = float(cost.get("next_12m_modeled_marketable_interest_billions") or 0)
    require(next12 > 100, f"Forward 12m marketable interest unexpectedly low: {next12}")

    source = (data.get("sources") or {}).get("treasury_debt_cost") or {}
    require(source.get("status") == "ok", f"Treasury debt cost source not ok: {source}")

    print(
        "Market insights validation passed:",
        len(recent),
        "auction observations;",
        len(series),
        "ownership-share series;",
        len(rates),
        "rate series; TTM interest",
        round(float(cost.get("trailing_12m_interest_expense_billions") or 0), 1),
        "B; WARM",
        round(warm, 2),
        "years",
    )


if __name__ == "__main__":
    main()
