from __future__ import annotations

import calendar
import json
from collections import defaultdict
from datetime import date, datetime, timedelta

import update_data_v16 as phase16

base = phase16.base
DATA_FILE = phase16.DATA_FILE

INTEREST_TYPES = {"Notes", "Bonds", "TIPS", "FRNs"}
KNOWN_TYPES = {"Notes", "Bonds"}
ESTIMATED_TYPES = {"TIPS", "FRNs"}


def _date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _add_months(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _sum_interest_until(payments: list[dict], end_date: date, field: str = "total_billions") -> float:
    total = 0.0
    for row in payments:
        payment_date = _date(row.get("date"))
        if payment_date is not None and payment_date <= end_date:
            total += float(row.get(field) or 0.0)
    return total


def build_interest_schedule(maturity: dict) -> dict:
    calculated_from = _date(maturity.get("calculated_from"))
    if calculated_from is None:
        raise RuntimeError("Treasury maturity block is missing a valid calculated_from date")

    securities = maturity.get("securities") or []
    coupon_security_count = 0
    securities_with_rate = 0
    missing_rate_count = 0
    by_date: dict[str, dict] = {}

    for security in securities:
        security_type = security.get("security_type")
        if security_type == "Bills":
            security["interest_status"] = "no_periodic_coupon"
            security["coupon_frequency"] = None
            security["next_interest_date"] = None
            security["current_snapshot_payment_billions"] = None
            continue
        if security_type not in INTEREST_TYPES:
            continue

        coupon_security_count += 1
        maturity_date = _date(security.get("maturity_date"))
        rate = base.to_float(security.get("interest_rate_pct"))
        if maturity_date is None or rate is None or rate <= 0:
            missing_rate_count += 1
            security["interest_status"] = "unavailable"
            security["coupon_frequency"] = "Quarterly" if security_type == "FRNs" else "Semiannual"
            security["next_interest_date"] = None
            security["current_snapshot_payment_billions"] = None
            continue

        securities_with_rate += 1
        months_between = 3 if security_type == "FRNs" else 6
        periods_per_year = 4 if security_type == "FRNs" else 2
        status = "known" if security_type in KNOWN_TYPES else "estimated"
        amount = float(security.get("outstanding_billions") or 0.0) * (float(rate) / 100.0) / periods_per_year
        if amount <= 0:
            continue

        payment_dates: list[date] = []
        payment_date = maturity_date
        while payment_date >= calculated_from:
            payment_dates.append(payment_date)
            payment_date = _add_months(payment_date, -months_between)
        payment_dates.sort()

        security["interest_status"] = status
        security["coupon_frequency"] = "Quarterly" if security_type == "FRNs" else "Semiannual"
        security["next_interest_date"] = payment_dates[0].isoformat() if payment_dates else None
        security["current_snapshot_payment_billions"] = amount if payment_dates else None

        for payment_date in payment_dates:
            key = payment_date.isoformat()
            row = by_date.setdefault(
                key,
                {
                    "date": key,
                    "total_billions": 0.0,
                    "known_billions": 0.0,
                    "estimated_billions": 0.0,
                    "security_count": 0,
                    "by_type": defaultdict(float),
                },
            )
            row["total_billions"] += amount
            row[f"{status}_billions"] += amount
            row["security_count"] += 1
            row["by_type"][security_type] += amount

    payments: list[dict] = []
    for _, row in sorted(by_date.items()):
        payments.append(
            {
                "date": row["date"],
                "total_billions": row["total_billions"],
                "known_billions": row["known_billions"],
                "estimated_billions": row["estimated_billions"],
                "security_count": row["security_count"],
                "by_type": dict(row["by_type"]),
            }
        )

    by_month: dict[str, dict] = {}
    for row in payments:
        month = row["date"][:7]
        target = by_month.setdefault(
            month,
            {
                "month": month,
                "total_billions": 0.0,
                "known_billions": 0.0,
                "estimated_billions": 0.0,
                "payment_count": 0,
                "by_type": defaultdict(float),
            },
        )
        target["total_billions"] += float(row["total_billions"])
        target["known_billions"] += float(row["known_billions"])
        target["estimated_billions"] += float(row["estimated_billions"])
        target["payment_count"] += int(row["security_count"])
        for name, value in (row.get("by_type") or {}).items():
            target["by_type"][name] += float(value)

    monthly: list[dict] = []
    for _, row in sorted(by_month.items()):
        monthly.append(
            {
                "month": row["month"],
                "total_billions": row["total_billions"],
                "known_billions": row["known_billions"],
                "estimated_billions": row["estimated_billions"],
                "payment_count": row["payment_count"],
                "by_type": dict(row["by_type"]),
            }
        )

    known_total = sum(float(row["known_billions"]) for row in payments)
    estimated_total = sum(float(row["estimated_billions"]) for row in payments)
    total = known_total + estimated_total
    coverage_pct = 100.0 * securities_with_rate / coupon_security_count if coupon_security_count else 0.0

    return {
        "as_of": maturity.get("as_of"),
        "calculated_from": maturity.get("calculated_from"),
        "unit": "$B",
        "coupon_security_count": coupon_security_count,
        "securities_with_rate": securities_with_rate,
        "missing_rate_count": missing_rate_count,
        "rate_coverage_pct": coverage_pct,
        "known_future_interest_billions": known_total,
        "estimated_future_interest_billions": estimated_total,
        "total_future_interest_billions": total,
        "summary": {
            "next_30d_billions": _sum_interest_until(payments, calculated_from + timedelta(days=30)),
            "next_90d_billions": _sum_interest_until(payments, calculated_from + timedelta(days=90)),
            "next_12m_billions": _sum_interest_until(payments, calculated_from + timedelta(days=365)),
            "next_12m_known_billions": _sum_interest_until(payments, calculated_from + timedelta(days=365), "known_billions"),
            "next_12m_estimated_billions": _sum_interest_until(payments, calculated_from + timedelta(days=365), "estimated_billions"),
        },
        "payments": payments,
        "monthly": monthly,
        "methodology": {
            "notes_bonds": "Scheduled fixed coupons using the latest MSPD outstanding principal and reported annual coupon rate; payments are placed on the semiannual cycle ending on maturity date.",
            "tips": "Estimated coupons using the latest MSPD outstanding principal and reported coupon rate. Future dollar payments can change as inflation-adjusted principal changes.",
            "frns": "Estimated quarterly interest using the latest MSPD reported rate and outstanding principal. Future payments can change when the FRN rate resets.",
            "bills": "Treasury bills have no periodic coupon and are excluded from the interest calendar; discount income is realized through issuance/redemption pricing rather than a scheduled coupon.",
        },
        "note": (
            "Interest cash flows are derived from the latest MSPD security snapshot. Notes and Bonds are scheduled fixed-coupon amounts from current outstanding principal. "
            "TIPS and FRN dollar payments are estimates because future inflation-adjusted principal and floating rates can change. Treasury bills are excluded from periodic coupon interest."
        ),
    }


def main() -> None:
    prior_data = json.loads(DATA_FILE.read_text(encoding="utf-8")) if DATA_FILE.exists() else {}
    previous_interest = (prior_data.get("treasury_maturities") or {}).get("interest_schedule")

    phase16.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    maturity = data.get("treasury_maturities") or {}

    try:
        maturity["interest_schedule"] = build_interest_schedule(maturity)
        data.setdefault("sources", {})["treasury_interest"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        if previous_interest and previous_interest.get("payments"):
            maturity["interest_schedule"] = previous_interest
            data.setdefault("sources", {})["treasury_interest"] = {
                "status": "error",
                "checked_at": base.now_iso(),
                "message": f"{type(exc).__name__}: {exc}; previous verified Treasury interest schedule retained",
            }
        else:
            raise

    data["treasury_maturities"] = maturity
    data["generated_at"] = base.now_iso()
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    interest = maturity.get("interest_schedule") or {}
    summary = interest.get("summary") or {}
    print(
        "Treasury interest calendar:",
        interest.get("securities_with_rate"),
        "/",
        interest.get("coupon_security_count"),
        "coupon securities with rates; coverage",
        interest.get("rate_coverage_pct"),
        "%;",
        len(interest.get("payments") or []),
        "payment dates; next 12m",
        summary.get("next_12m_billions"),
        "B",
    )


if __name__ == "__main__":
    main()
