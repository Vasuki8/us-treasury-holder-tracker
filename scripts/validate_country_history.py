from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"country-history validation failed: {message}")


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    foreign = data.get("foreign_holders", {})
    countries = foreign.get("countries", []) or []
    periods = foreign.get("periods", []) or []

    require(foreign.get("country_count", len(countries)) >= 60, "too few individual countries")
    require(len(countries) >= 60, "country rows missing")
    require(foreign.get("history_month_count", len(periods)) >= 72, "expected at least six years of monthly TIC history")
    require(bool(foreign.get("history_start")), "history_start missing")
    require(str(foreign.get("history_start")) <= "2020-01", "history does not reach January 2020")
    require(bool(foreign.get("as_of")), "latest TIC observation date missing")
    require((foreign.get("grand_total_billions") or 0) > 1000, "foreign grand total looks invalid")

    by_name = {row.get("name"): row for row in countries}
    for name in ("Japan", "China, Mainland", "United Kingdom"):
        row = by_name.get(name)
        require(row is not None, f"required country missing: {name}")
        require(len(row.get("history", []) or []) >= 72, f"insufficient history for {name}")
        require((row.get("holdings_billions") or 0) > 0, f"invalid holdings for {name}")
        require(row.get("long_term_holdings_billions") is not None, f"long-term holdings missing for {name}")
        require(row.get("short_term_holdings_billions") is not None, f"short-term holdings missing for {name}")

    profiles = data.get("holder_profiles", {})
    foreign_profile_count = (profiles.get("scope_counts", {}) or {}).get("Foreign country", 0)
    require(foreign_profile_count >= 60, "expanded countries did not flow into holder profiles")

    print(
        "Expanded TIC validation passed:",
        len(countries),
        "countries;",
        foreign.get("history_month_count"),
        "months;",
        foreign.get("history_start"),
        "to",
        foreign.get("as_of"),
    )


if __name__ == "__main__":
    main()
