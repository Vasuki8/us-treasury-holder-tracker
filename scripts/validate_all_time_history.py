from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    block = data.get("all_time_history") or {}
    series = block.get("series") or []
    assert len(series) >= 7, f"expected at least 7 all-time series, found {len(series)}"

    keys = [row.get("key") for row in series]
    assert len(keys) == len(set(keys)), "all-time series keys must be unique"

    by_key = {row.get("key"): row for row in series}
    required = {
        "total_public_debt",
        "debt_held_by_public",
        "intragovernmental_holdings",
        "federal_reserve_treasuries",
        "foreign_total",
        "foreign_official",
        "foreign_nonofficial",
    }
    missing = required - set(by_key)
    assert not missing, f"missing all-time series: {sorted(missing)}"

    for key, row in by_key.items():
        observations = row.get("observations") or []
        assert row.get("observation_count") == len(observations), f"{key}: observation_count mismatch"
        dates = [item.get("date") for item in observations]
        assert dates == sorted(dates), f"{key}: observations must be ascending"
        assert all(item.get("value_billions") is not None for item in observations), f"{key}: null values found"
        if observations:
            assert row.get("history_start") == dates[0], f"{key}: history_start mismatch"
            assert row.get("as_of") == dates[-1], f"{key}: as_of mismatch"

    assert by_key["total_public_debt"]["observation_count"] > 5000, "Debt to the Penny history is unexpectedly short"
    assert by_key["federal_reserve_treasuries"]["observation_count"] > 500, "Federal Reserve history is unexpectedly short"
    assert by_key["foreign_total"]["observation_count"] > 100, "Foreign aggregate history is unexpectedly short"

    latest_overview = data.get("overview") or {}
    debt_latest = by_key["total_public_debt"]["observations"][-1]["value_billions"] * 1e9
    assert abs(debt_latest - latest_overview.get("total_public_debt", debt_latest)) < 1.0, "all-time debt latest value does not match overview"

    latest_fed = data.get("fed") or {}
    fed_latest = by_key["federal_reserve_treasuries"]["observations"][-1]["value_billions"]
    assert abs(fed_latest - latest_fed.get("treasury_holdings_billions", fed_latest)) < 0.01, "all-time Fed latest value does not match overview"

    latest_foreign = data.get("foreign_holders") or {}
    foreign_latest = by_key["foreign_total"]["observations"][-1]["value_billions"]
    assert abs(foreign_latest - latest_foreign.get("grand_total_billions", foreign_latest)) < 0.01, "all-time foreign latest value does not match TIC total"

    print("All-time history validation passed")


if __name__ == "__main__":
    main()
