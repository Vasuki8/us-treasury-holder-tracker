from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"


def fail(message: str) -> None:
    raise SystemExit(f"Treasury maturity validation failed: {message}")


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    block = data.get("treasury_maturities") or {}
    securities = block.get("securities") or []
    monthly = block.get("monthly") or []
    dates = block.get("maturity_dates") or []
    summary = block.get("summary") or {}

    if not block.get("as_of"):
        fail("missing MSPD as_of")
    if not block.get("calculated_from"):
        fail("missing calculated_from")
    if len(securities) < 50:
        fail(f"too few future marketable securities: {len(securities)}")
    if not monthly or not dates:
        fail("missing monthly/date maturity buckets")

    calculated = datetime.strptime(block["calculated_from"], "%Y-%m-%d").date()
    previous = None
    security_total = 0.0
    allowed = {"Bills", "Notes", "Bonds", "TIPS", "FRNs"}
    for row in securities:
        maturity = datetime.strptime(row["maturity_date"], "%Y-%m-%d").date()
        if maturity < calculated:
            fail(f"past maturity included: {row['maturity_date']}")
        if previous and row["maturity_date"] < previous:
            fail("securities are not sorted by maturity date")
        previous = row["maturity_date"]
        if row.get("security_type") not in allowed:
            fail(f"unexpected security type: {row.get('security_type')}")
        value = row.get("outstanding_billions")
        if value is None or float(value) <= 0:
            fail("non-positive outstanding amount")
        security_total += float(value)

    reported_total = float(block.get("total_future_billions") or 0.0)
    if reported_total < 10000:
        fail(f"future marketable total unexpectedly small: {reported_total:.1f}B")
    if abs(security_total - reported_total) > 0.01:
        fail(f"security total mismatch: {security_total} vs {reported_total}")

    monthly_total = sum(float(row.get("total_billions") or 0.0) for row in monthly)
    date_total = sum(float(row.get("total_billions") or 0.0) for row in dates)
    if abs(monthly_total - reported_total) > 0.01:
        fail("monthly buckets do not reconcile to securities")
    if abs(date_total - reported_total) > 0.01:
        fail("date buckets do not reconcile to securities")

    for key in ("next_30d_billions", "next_90d_billions", "next_12m_billions"):
        if summary.get(key) is None or float(summary[key]) < 0:
            fail(f"invalid summary value {key}")
    if float(summary["next_30d_billions"]) > float(summary["next_90d_billions"]):
        fail("30-day amount exceeds 90-day amount")
    if float(summary["next_90d_billions"]) > float(summary["next_12m_billions"]):
        fail("90-day amount exceeds 12-month amount")
    if not summary.get("largest_month"):
        fail("largest month missing")

    source = (data.get("sources") or {}).get("treasury_maturities") or {}
    if source.get("status") not in {"ok", "error"}:
        fail(f"unexpected source status: {source.get('status')}")

    print(
        "Treasury maturity validation passed:",
        len(securities),
        "securities,",
        len(monthly),
        "monthly buckets,",
        f"${reported_total:,.1f}B future marketable principal, MSPD {block.get('as_of')}",
    )


if __name__ == "__main__":
    main()
