from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "dashboard.json"


def _date(value):
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def _finite(value) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    block = data.get("treasury_funding_pressure")
    if not block:
        raise SystemExit("Missing treasury_funding_pressure block")

    tga = block.get("tga") or {}
    history = tga.get("history") or []
    if len(history) < 20:
        raise SystemExit(f"TGA history too short: {len(history)}")
    if any(not _finite(row.get("balance_billions")) for row in history):
        raise SystemExit("TGA history contains non-numeric balances")
    dates = [_date(row.get("date")) for row in history]
    if dates != sorted(dates):
        raise SystemExit("TGA history is not chronological")
    if tga.get("as_of") != history[-1].get("date"):
        raise SystemExit("TGA as_of does not match latest history observation")
    if abs(float(tga.get("current_billions") or 0.0) - float(history[-1].get("balance_billions") or 0.0)) > 1e-6:
        raise SystemExit("TGA current balance does not reconcile to latest history observation")
    if float(tga.get("current_billions") or 0.0) <= 0:
        raise SystemExit("TGA current balance is not positive")

    auctions = block.get("auctions") or {}
    auction_rows = auctions.get("rows") or []
    for row in auction_rows:
        if not row.get("auction_date") or not row.get("issue_date"):
            raise SystemExit("Upcoming auction missing auction or issue date")
        if not _finite(row.get("offering_billions")) or float(row.get("offering_billions") or 0.0) <= 0:
            raise SystemExit("Upcoming auction has invalid offering amount")
        if _date(row["issue_date"]) < _date(block["as_of"]):
            raise SystemExit("Upcoming auction issue date precedes funding-pressure as_of date")
    auction_total = sum(float(row.get("offering_billions") or 0.0) for row in auction_rows)
    if abs(auction_total - float(auctions.get("total_announced_billions") or 0.0)) > 1e-5:
        raise SystemExit("Upcoming auction total does not reconcile")

    horizons = block.get("horizons") or {}
    expected = ["30D", "90D", "1Y"]
    for key in expected:
        row = horizons.get(key)
        if not row:
            raise SystemExit(f"Missing funding horizon {key}")
        for field in (
            "principal_billions",
            "interest_billions",
            "gross_scheduled_cash_billions",
            "announced_issuance_billions",
            "unmatched_scheduled_cash_billions",
        ):
            if not _finite(row.get(field)) or float(row.get(field)) < 0:
                raise SystemExit(f"Invalid {key} {field}")
        gross = float(row["principal_billions"]) + float(row["interest_billions"])
        if abs(gross - float(row["gross_scheduled_cash_billions"])) > 1e-5:
            raise SystemExit(f"{key} gross scheduled cash does not reconcile")

    for field in ("principal_billions", "interest_billions", "gross_scheduled_cash_billions", "announced_issuance_billions"):
        values = [float(horizons[key][field]) for key in expected]
        if values != sorted(values):
            raise SystemExit(f"Funding horizons are not monotonic for {field}: {values}")

    timeline = block.get("timeline") or []
    timeline_dates = [_date(row.get("date")) for row in timeline]
    if timeline_dates != sorted(timeline_dates):
        raise SystemExit("Funding-pressure timeline is not chronological")
    for row in timeline:
        gross = float(row.get("principal_billions") or 0.0) + float(row.get("interest_billions") or 0.0)
        if abs(gross - float(row.get("gross_scheduled_cash_billions") or 0.0)) > 1e-5:
            raise SystemExit(f"Timeline gross cash does not reconcile on {row.get('date')}")

    source_states = data.get("sources") or {}
    for key in ("treasury_funding_tga", "treasury_funding_auctions"):
        state = (source_states.get(key) or {}).get("status")
        if state not in {"ok", "error"}:
            raise SystemExit(f"Unexpected source status for {key}: {state}")

    print(
        "Treasury funding pressure valid:",
        len(history), "TGA observations;",
        len(auction_rows), "announced auctions;",
        "TGA", round(float(tga["current_billions"]), 1), "B;",
        "90D gross", round(float(horizons["90D"]["gross_scheduled_cash_billions"]), 1), "B",
    )


if __name__ == "__main__":
    main()
