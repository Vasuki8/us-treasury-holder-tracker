from __future__ import annotations

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"


def parse_day(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    auction = data.get("auction_demand_monitor") or {}
    history = auction.get("history") or []
    assert auction.get("history_count") == len(history), "auction-demand history count mismatch"
    assert len(history) > 30, "auction-demand history must exceed the 30-row recent sample"
    assert int(auction.get("history_window_days") or 0) >= 90, "auction-demand history window must cover 90 days"

    dates = [parse_day(row.get("auction_date")) for row in history]
    dates = [day for day in dates if day is not None]
    assert len(dates) == len(history), "auction-demand history contains invalid dates"
    assert dates == sorted(dates, reverse=True), "auction-demand history must be newest first"
    assert (max(dates) - min(dates)).days >= 60, "auction-demand history does not span enough time for dynamic ranges"

    for row in history:
        score = row.get("demand_score")
        if score is not None:
            assert 0 <= float(score) <= 100, f"invalid auction demand score: {score}"

    funding = data.get("treasury_funding_pressure") or {}
    assert all(key in (funding.get("horizons") or {}) for key in ("30D", "90D", "1Y")), "funding dynamic horizons missing"
    tga_history = (funding.get("tga") or {}).get("history") or []
    assert len(tga_history) >= 200, "TGA history too short for 1Y dynamic lookback"

    print(
        "Dynamic chart-range validation passed:",
        len(history),
        "auction observations spanning",
        (max(dates) - min(dates)).days,
        "days;",
        len(tga_history),
        "TGA observations; funding 30D/90D/1Y horizons present.",
    )


if __name__ == "__main__":
    main()
