from __future__ import annotations

import json
from datetime import date

import update_data_v20 as phase20

DATA_FILE = phase20.DATA_FILE


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    funding = data.get("treasury_funding_pressure") or {}
    buybacks = funding.get("buybacks") or {}
    operations = buybacks.get("operations") or []
    upcoming = buybacks.get("upcoming") or []
    if not operations:
        fail("Treasury buyback schedule has no operations")
    if not upcoming:
        fail("Treasury buyback schedule has no upcoming operations")
    if len(upcoming) > 100:
        fail(f"Treasury buyback upcoming operation count implausibly large: {len(upcoming)}")

    max_total = sum(float(row.get("max_purchase_billions") or 0.0) for row in upcoming)
    if max_total <= 0 or max_total > 500:
        fail(f"Treasury buyback upcoming maximum is implausible: {max_total}B")
    for row in operations:
        op_date = row.get("operation_date")
        amount = float(row.get("max_purchase_billions") or 0.0)
        if not op_date or amount <= 0:
            fail(f"Invalid buyback row: {row}")

    dealers = data.get("primary_dealer_positioning") or {}
    series = dealers.get("series") or []
    if len(series) < 8:
        fail(f"Primary dealer positioning has only {len(series)} series")

    total = next((row for row in series if row.get("keyid") == "PDPOSGST-TOT"), None)
    if not total:
        fail("Primary dealer total Treasury net-position series missing")
    history = total.get("history") or []
    if len(history) < 100:
        fail(f"Primary dealer total Treasury history unexpectedly short: {len(history)}")
    dates = [row.get("date") for row in history]
    if dates != sorted(dates) or len(dates) != len(set(dates)):
        fail("Primary dealer total Treasury history is not unique chronological data")

    for row in series:
        hist = row.get("history") or []
        if not hist:
            fail(f"Primary dealer series has no history: {row.get('keyid')}")
        if row.get("as_of") != hist[-1].get("date"):
            fail(f"Primary dealer as_of mismatch: {row.get('keyid')}")

    sources = data.get("sources") or {}
    for key in ("treasury_buybacks", "primary_dealer_positioning"):
        status = (sources.get(key) or {}).get("status")
        if status not in {"ok", "error"}:
            fail(f"Unexpected source status for {key}: {status}")

    print(
        "Buyback/dealer validation passed:",
        len(upcoming),
        "upcoming buybacks; max",
        f"${max_total:,.1f}B;",
        len(series),
        "dealer series; total history",
        len(history),
        "observations",
        history[0].get("date"),
        "to",
        history[-1].get("date"),
    )


if __name__ == "__main__":
    main()
