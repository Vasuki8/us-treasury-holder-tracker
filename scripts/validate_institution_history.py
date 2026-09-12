from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "dashboard.json"
EXPECTED_KEYS = {
    "hedge_funds",
    "money_market_funds",
    "mutual_funds",
    "etfs",
    "private_pension_funds",
    "life_insurance",
    "property_casualty_insurance",
    "us_depository_institutions",
    "broker_dealers",
}


def parse_date(value: str) -> datetime:
    return datetime.strptime(str(value)[:10], "%Y-%m-%d")


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    block = data.get("institution_holder_history") or {}
    series = block.get("series") or []

    if len(series) < len(EXPECTED_KEYS):
        raise SystemExit(f"Institution history has only {len(series)} series")

    by_key = {row.get("key"): row for row in series}
    missing = sorted(EXPECTED_KEYS - set(by_key))
    if missing:
        raise SystemExit(f"Institution history missing expected series: {missing}")

    hedge = by_key["hedge_funds"]
    if hedge.get("history_start") != "2012-10-01":
        raise SystemExit(f"Hedge-fund history must begin at Form PF start 2012-10-01, got {hedge.get('history_start')}")

    latest_dates = []
    for key in EXPECTED_KEYS:
        row = by_key[key]
        if row.get("frequency") != "Quarterly":
            raise SystemExit(f"{key} is not quarterly")
        observations = row.get("observations") or []
        if len(observations) < 8:
            raise SystemExit(f"{key} has too few observations: {len(observations)}")

        dates = [parse_date(obs.get("date")) for obs in observations]
        if dates != sorted(dates):
            raise SystemExit(f"{key} observations are not sorted")
        if len({obs.get("date") for obs in observations}) != len(observations):
            raise SystemExit(f"{key} contains duplicate dates")

        for obs in observations:
            value = obs.get("value_billions")
            if value is None:
                raise SystemExit(f"{key} contains null value")
            number = float(value)
            if key != "broker_dealers" and number < -1e-9:
                raise SystemExit(f"{key} contains negative holdings: {number}")

        if row.get("history_start") != observations[0].get("date"):
            raise SystemExit(f"{key} history_start mismatch")
        if row.get("as_of") != observations[-1].get("date"):
            raise SystemExit(f"{key} as_of mismatch")
        if int(row.get("observation_count") or 0) != len(observations):
            raise SystemExit(f"{key} observation_count mismatch")
        latest_dates.append(observations[-1].get("date"))

    if max(latest_dates) < "2025-10-01":
        raise SystemExit(f"Institution history appears stale; latest observation is {max(latest_dates)}")

    source = (data.get("sources") or {}).get("institution_holder_history") or {}
    if source.get("status") not in {"ok", "error"}:
        raise SystemExit(f"Unexpected institution history source status: {source.get('status')}")

    print(
        "Institution history validation passed:",
        len(series),
        "series; hedge",
        hedge.get("history_start"),
        "to",
        hedge.get("as_of"),
        "; latest overall",
        max(latest_dates),
    )


if __name__ == "__main__":
    main()
