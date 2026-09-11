from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"


def fail(message: str) -> None:
    raise SystemExit(f"Treasury interest validation failed: {message}")


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    maturity = data.get("treasury_maturities") or {}
    interest = maturity.get("interest_schedule") or {}
    payments = interest.get("payments") or []
    monthly = interest.get("monthly") or []
    summary = interest.get("summary") or {}

    if not interest.get("as_of") or not interest.get("calculated_from"):
        fail("missing interest schedule dates")
    coupon_count = int(interest.get("coupon_security_count") or 0)
    with_rate = int(interest.get("securities_with_rate") or 0)
    if coupon_count < 100:
        fail(f"too few coupon-bearing securities: {coupon_count}")
    if with_rate < 100:
        fail(f"too few securities with usable rates: {with_rate}")
    coverage = float(interest.get("rate_coverage_pct") or 0.0)
    if coverage < 70.0:
        fail(f"interest-rate coverage unexpectedly low: {coverage:.1f}%")
    if len(payments) < 20 or len(monthly) < 12:
        fail("interest payment history is unexpectedly short")

    calculated = datetime.strptime(interest["calculated_from"], "%Y-%m-%d").date()
    payment_total = 0.0
    known_total = 0.0
    estimated_total = 0.0
    previous = None
    allowed_types = {"Notes", "Bonds", "TIPS", "FRNs"}

    for row in payments:
        payment_date = datetime.strptime(row["date"], "%Y-%m-%d").date()
        if payment_date < calculated:
            fail(f"past interest payment included: {row['date']}")
        if previous and row["date"] < previous:
            fail("interest payments are not sorted")
        previous = row["date"]

        total = float(row.get("total_billions") or 0.0)
        known = float(row.get("known_billions") or 0.0)
        estimated = float(row.get("estimated_billions") or 0.0)
        if total <= 0:
            fail(f"non-positive interest amount on {row['date']}")
        if abs(total - known - estimated) > 0.001:
            fail(f"known/estimated split does not reconcile on {row['date']}")
        type_total = sum(float(value or 0.0) for value in (row.get("by_type") or {}).values())
        if abs(total - type_total) > 0.001:
            fail(f"type split does not reconcile on {row['date']}")
        unexpected = set((row.get("by_type") or {}).keys()) - allowed_types
        if unexpected:
            fail(f"unexpected interest security types: {sorted(unexpected)}")

        payment_total += total
        known_total += known
        estimated_total += estimated

    reported_total = float(interest.get("total_future_interest_billions") or 0.0)
    reported_known = float(interest.get("known_future_interest_billions") or 0.0)
    reported_estimated = float(interest.get("estimated_future_interest_billions") or 0.0)
    if reported_total <= 100:
        fail(f"future interest total unexpectedly small: {reported_total:.1f}B")
    if reported_known <= 0:
        fail("known fixed-coupon interest total is empty")
    if reported_estimated <= 0:
        fail("estimated TIPS/FRN interest total is empty")
    if abs(payment_total - reported_total) > 0.01:
        fail("interest payment total does not reconcile")
    if abs(known_total - reported_known) > 0.01:
        fail("known interest total does not reconcile")
    if abs(estimated_total - reported_estimated) > 0.01:
        fail("estimated interest total does not reconcile")

    monthly_total = sum(float(row.get("total_billions") or 0.0) for row in monthly)
    if abs(monthly_total - reported_total) > 0.01:
        fail("monthly interest buckets do not reconcile")

    for key in ("next_30d_billions", "next_90d_billions", "next_12m_billions"):
        if summary.get(key) is None or float(summary[key]) < 0:
            fail(f"invalid interest summary value: {key}")
    if float(summary["next_30d_billions"]) > float(summary["next_90d_billions"]):
        fail("30-day interest exceeds 90-day interest")
    if float(summary["next_90d_billions"]) > float(summary["next_12m_billions"]):
        fail("90-day interest exceeds 12-month interest")

    source = (data.get("sources") or {}).get("treasury_interest") or {}
    if source.get("status") not in {"ok", "error"}:
        fail(f"unexpected Treasury interest source status: {source.get('status')}")

    print(
        "Treasury interest validation passed:",
        with_rate,
        "/",
        coupon_count,
        "coupon securities with rates;",
        f"coverage={coverage:.1f}%;",
        len(payments),
        "payment dates;",
        f"future interest=${reported_total:,.1f}B",
    )


if __name__ == "__main__":
    main()
