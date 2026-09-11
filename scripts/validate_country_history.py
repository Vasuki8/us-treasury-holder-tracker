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
    survey = foreign.get("annual_survey", {}) or {}

    require(foreign.get("country_count", len(countries)) >= 60, "too few individual countries")
    require(len(countries) >= 60, "country rows missing")
    require(foreign.get("history_month_count", len(periods)) >= 170, "expected TIC history back to 2011")
    require(bool(foreign.get("history_start")), "history_start missing")
    require(str(foreign.get("history_start")) <= "2011-09", "monthly history does not reach September 2011")
    require(bool(foreign.get("as_of")), "latest TIC observation date missing")
    require((foreign.get("grand_total_billions") or 0) > 1000, "foreign grand total looks invalid")
    require(bool(foreign.get("monthly_archive_url")), "monthly historical source URL missing")

    require(bool(survey), "annual survey metadata missing")
    require(str(survey.get("history_start")) <= "1974-12", "annual survey history does not reach 1974")
    require(str(survey.get("as_of")) >= "2025-06", "annual survey latest observation looks stale")
    require((survey.get("observation_count") or 0) >= 25, "too few annual/benchmark survey observations")
    require((survey.get("country_count") or 0) >= 100, "too few annual survey country rows")
    require(bool(survey.get("source_url")), "annual survey source URL missing")

    by_name = {row.get("name"): row for row in countries}
    for name in ("Japan", "China, Mainland", "United Kingdom"):
        row = by_name.get(name)
        require(row is not None, f"required country missing: {name}")
        require(len(row.get("history", []) or []) >= 170, f"insufficient monthly history for {name}")
        require(str(row.get("history_start")) <= "2011-09", f"monthly history does not reach 2011 for {name}")
        require((row.get("holdings_billions") or 0) > 0, f"invalid holdings for {name}")
        require(row.get("long_term_holdings_billions") is not None, f"long-term holdings missing for {name}")
        require(row.get("short_term_holdings_billions") is not None, f"short-term holdings missing for {name}")
        require(row.get("change_120m_billions") is not None, f"10-year change missing for {name}")
        annual_history = row.get("annual_survey_history", []) or []
        require(len(annual_history) >= 20, f"insufficient annual survey history for {name}")
        require(any(item.get("coverage") == "long_term_only" for item in annual_history), f"older survey coverage flag missing for {name}")
        require(any(item.get("coverage") == "long_and_short_term" for item in annual_history), f"modern survey coverage flag missing for {name}")

    profiles = data.get("holder_profiles", {})
    foreign_profile_count = (profiles.get("scope_counts", {}) or {}).get("Foreign country", 0)
    require(foreign_profile_count >= 60, "expanded countries did not flow into holder profiles")

    print(
        "Expanded TIC validation passed:",
        len(countries),
        "countries;",
        foreign.get("history_month_count"),
        "reported monthly observations;",
        foreign.get("history_start"),
        "to",
        foreign.get("as_of"),
        "; annual surveys",
        survey.get("history_start"),
        "to",
        survey.get("as_of"),
    )


if __name__ == "__main__":
    main()
