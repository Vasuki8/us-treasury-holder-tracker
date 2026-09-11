from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import update_data_v15 as phase15

base = phase15.base
DATA_FILE = phase15.DATA_FILE

MSPD_MARKET_URL = (
    "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
    "v1/debt/mspd/mspd_table_3_market"
)
MSPD_SOURCE = "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/"


def _date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _billions(value) -> float | None:
    parsed = base.to_float(value)
    return parsed / 1000.0 if parsed is not None else None


def _security_type(raw: str | None) -> str | None:
    text = str(raw or "").strip().lower()
    if not text:
        return None
    if "bill" in text:
        return "Bills"
    if "floating" in text or "frn" in text:
        return "FRNs"
    if "inflation" in text or "tips" in text:
        return "TIPS"
    if "note" in text:
        return "Notes"
    if "bond" in text:
        return "Bonds"
    return None


def _sum_until(securities: list[dict], end_date: date) -> float:
    return sum(
        float(row.get("outstanding_billions") or 0.0)
        for row in securities
        if _date(row.get("maturity_date")) and _date(row.get("maturity_date")) <= end_date
    )


def fetch_treasury_maturities() -> dict:
    latest_payload = base.get_json(
        MSPD_MARKET_URL,
        params={
            "sort": "-record_date",
            "page[number]": 1,
            "page[size]": 1,
            "format": "json",
        },
    )
    latest_rows = latest_payload.get("data", [])
    if not latest_rows:
        raise RuntimeError("MSPD marketable-security endpoint returned no rows")
    as_of = latest_rows[0].get("record_date")
    if not as_of:
        raise RuntimeError("MSPD marketable-security endpoint returned no record_date")

    rows: list[dict] = []
    page = 1
    page_size = 5000
    while True:
        payload = base.get_json(
            MSPD_MARKET_URL,
            params={
                "filter": f"record_date:eq:{as_of}",
                "sort": "maturity_date",
                "page[number]": page,
                "page[size]": page_size,
                "format": "json",
            },
        )
        batch = payload.get("data", [])
        rows.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
        if page > 5:
            raise RuntimeError("MSPD maturity pagination exceeded safety limit")

    today = datetime.now(timezone.utc).date()
    securities = []
    for row in rows:
        maturity = _date(row.get("maturity_date"))
        if maturity is None or maturity < today:
            continue
        outstanding = _billions(row.get("outstanding_amt"))
        if outstanding is None or outstanding <= 0:
            continue
        security_type = _security_type(row.get("security_class1_desc") or row.get("security_class_desc"))
        if security_type is None:
            continue
        cusip = str(row.get("cusip") or row.get("security_desc") or "").strip()
        securities.append(
            {
                "cusip": cusip or None,
                "security_type": security_type,
                "security_class": row.get("security_class1_desc") or row.get("security_class_desc"),
                "issue_date": row.get("issue_date"),
                "maturity_date": maturity.isoformat(),
                "interest_rate_pct": base.to_float(
                    row.get("interest_rate_pct")
                    or row.get("interest_rate_amt")
                    or row.get("interest_rate")
                ),
                "outstanding_billions": outstanding,
            }
        )

    if len(securities) < 50:
        raise RuntimeError(f"MSPD maturity schedule unexpectedly short: {len(securities)} securities")

    securities.sort(key=lambda row: (row["maturity_date"], -(row["outstanding_billions"] or 0.0)))

    by_date: dict[str, dict] = {}
    by_month: dict[str, dict] = {}
    by_type = defaultdict(float)
    for row in securities:
        maturity = row["maturity_date"]
        month = maturity[:7]
        security_type = row["security_type"]
        value = float(row["outstanding_billions"])
        by_type[security_type] += value

        date_row = by_date.setdefault(
            maturity,
            {
                "date": maturity,
                "total_billions": 0.0,
                "security_count": 0,
                "by_type": defaultdict(float),
            },
        )
        date_row["total_billions"] += value
        date_row["security_count"] += 1
        date_row["by_type"][security_type] += value

        month_row = by_month.setdefault(
            month,
            {
                "month": month,
                "total_billions": 0.0,
                "security_count": 0,
                "by_type": defaultdict(float),
            },
        )
        month_row["total_billions"] += value
        month_row["security_count"] += 1
        month_row["by_type"][security_type] += value

    def normalize(rows_dict: dict[str, dict], key: str) -> list[dict]:
        normalized = []
        for _, item in sorted(rows_dict.items()):
            normalized.append(
                {
                    key: item[key],
                    "total_billions": item["total_billions"],
                    "security_count": item["security_count"],
                    "by_type": dict(item["by_type"]),
                }
            )
        return normalized

    dates = normalize(by_date, "date")
    months = normalize(by_month, "month")
    largest_month = max(months, key=lambda item: item["total_billions"]) if months else None
    largest_dates = sorted(dates, key=lambda item: item["total_billions"], reverse=True)[:20]
    largest_securities = sorted(securities, key=lambda item: item["outstanding_billions"], reverse=True)[:25]

    total = sum(float(row["outstanding_billions"]) for row in securities)
    summary = {
        "next_30d_billions": _sum_until(securities, today + timedelta(days=30)),
        "next_90d_billions": _sum_until(securities, today + timedelta(days=90)),
        "next_12m_billions": _sum_until(securities, today + timedelta(days=365)),
        "total_future_billions": total,
        "largest_month": largest_month,
    }

    return {
        "as_of": as_of,
        "calculated_from": today.isoformat(),
        "frequency": "Monthly; MSPD is published for the prior month-end",
        "source_url": MSPD_SOURCE,
        "api_url": MSPD_MARKET_URL,
        "unit": "$B",
        "security_count": len(securities),
        "total_future_billions": total,
        "summary": summary,
        "by_type": [
            {"name": name, "total_billions": value}
            for name, value in sorted(by_type.items(), key=lambda item: item[1], reverse=True)
        ],
        "monthly": months,
        "maturity_dates": dates,
        "largest_maturity_dates": largest_dates,
        "largest_securities": largest_securities,
        "securities": securities,
        "note": (
            "Gross scheduled principal maturities of marketable Treasury securities outstanding in the latest Monthly Statement of the Public Debt. "
            "This is not a forecast of net borrowing: maturing securities can be rolled into new issuance, and future auction sizes can change."
        ),
    }


def main() -> None:
    phase15.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    previous = data.get("treasury_maturities")
    try:
        data["treasury_maturities"] = fetch_treasury_maturities()
        data.setdefault("sources", {})["treasury_maturities"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        if previous and previous.get("securities"):
            data["treasury_maturities"] = previous
            data.setdefault("sources", {})["treasury_maturities"] = {
                "status": "error",
                "checked_at": base.now_iso(),
                "message": f"{type(exc).__name__}: {exc}; previous verified maturity schedule retained",
            }
        else:
            raise

    data["generated_at"] = base.now_iso()
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    maturity = data.get("treasury_maturities", {})
    summary = maturity.get("summary", {})
    print(
        "Treasury maturity wall:",
        maturity.get("security_count"),
        "securities; MSPD",
        maturity.get("as_of"),
        "; next 30d",
        summary.get("next_30d_billions"),
        "B; next 12m",
        summary.get("next_12m_billions"),
        "B",
    )


if __name__ == "__main__":
    main()
