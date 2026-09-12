from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, timedelta

import update_data_v18 as phase18

base = phase18.base
DATA_FILE = phase18.DATA_FILE

TGA_API = (
    "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
    "v1/accounting/dts/operating_cash_balance"
)
TGA_SOURCE = "https://fiscaldata.treasury.gov/datasets/daily-treasury-statement/operating-cash-balance"

UPCOMING_AUCTIONS_API = (
    "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
    "v1/accounting/od/upcoming_auctions"
)
AUCTIONS_SOURCE = "https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/"

HORIZONS = {
    "30D": 30,
    "90D": 90,
    "1Y": 365,
}


def _date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _billions_from_millions(value) -> float | None:
    parsed = base.to_float(value)
    return parsed / 1000.0 if parsed is not None else None


def _billions_from_dollars(value) -> float | None:
    parsed = base.to_float(value)
    return parsed / 1_000_000_000.0 if parsed is not None else None


def fetch_tga_history(anchor: date) -> dict:
    start = anchor - timedelta(days=400)
    payload = base.get_json(
        TGA_API,
        params={
            "fields": "record_date,account_type,close_today_bal,open_today_bal",
            "filter": f"record_date:gte:{start.isoformat()}",
            "sort": "record_date",
            "page[number]": 1,
            "page[size]": 5000,
            "format": "json",
        },
    )
    rows = payload.get("data", [])
    if not rows:
        raise RuntimeError("Daily Treasury Statement TGA endpoint returned no rows")

    by_date: dict[str, float] = {}
    for row in rows:
        record_date = str(row.get("record_date") or "")[:10]
        account_type = str(row.get("account_type") or "").strip().lower()
        if not record_date or "treasury general account" not in account_type:
            continue

        is_closing = "closing balance" in account_type or account_type in {"treasury general account", "tga"}
        if not is_closing:
            continue

        raw = row.get("close_today_bal")
        value = _billions_from_millions(raw)
        if value is None:
            value = _billions_from_millions(row.get("open_today_bal"))
        if value is None or value < 0:
            continue
        by_date[record_date] = value

    history = [{"date": day, "balance_billions": value} for day, value in sorted(by_date.items())]
    if len(history) < 20:
        raise RuntimeError(f"TGA history unexpectedly short: {len(history)} observations")

    latest = history[-1]
    cutoff = _date(latest["date"]) - timedelta(days=30)
    prior = min(
        history,
        key=lambda row: abs((_date(row["date"]) - cutoff).days),
    )
    change_30d = float(latest["balance_billions"]) - float(prior["balance_billions"])

    return {
        "as_of": latest["date"],
        "current_billions": float(latest["balance_billions"]),
        "change_30d_billions": change_30d,
        "history_start": history[0]["date"],
        "observation_count": len(history),
        "history": history,
        "source_url": TGA_SOURCE,
        "api_url": TGA_API,
        "frequency": "Business daily",
        "unit": "$B",
        "note": "Treasury General Account closing balance from the Daily Treasury Statement. Figures are reported in millions and converted to billions.",
    }


def fetch_upcoming_auctions(anchor: date) -> dict:
    payload = base.get_json(
        UPCOMING_AUCTIONS_API,
        params={
            "fields": (
                "record_date,cusip,announcemt_date,auction_date,issue_date,maturity_date,"
                "security_type,security_term,offering_amt,reopening"
            ),
            "sort": "auction_date",
            "page[number]": 1,
            "page[size]": 5000,
            "format": "json",
        },
    )
    rows = payload.get("data", [])

    auctions: list[dict] = []
    seen = set()
    for row in rows:
        issue_date = _date(row.get("issue_date"))
        auction_date = _date(row.get("auction_date"))
        if issue_date is None or auction_date is None or issue_date < anchor:
            continue
        offering = _billions_from_dollars(row.get("offering_amt"))
        if offering is None or offering <= 0:
            continue
        key = (str(row.get("cusip") or ""), auction_date.isoformat(), issue_date.isoformat())
        if key in seen:
            continue
        seen.add(key)
        auctions.append(
            {
                "cusip": str(row.get("cusip") or "").strip() or None,
                "record_date": str(row.get("record_date") or "")[:10] or None,
                "announcement_date": str(row.get("announcemt_date") or "")[:10] or None,
                "auction_date": auction_date.isoformat(),
                "issue_date": issue_date.isoformat(),
                "maturity_date": str(row.get("maturity_date") or "")[:10] or None,
                "security_type": str(row.get("security_type") or "").strip() or None,
                "security_term": str(row.get("security_term") or "").strip() or None,
                "reopening": str(row.get("reopening") or "").strip() or None,
                "offering_billions": offering,
            }
        )

    auctions.sort(key=lambda row: (row["issue_date"], row["auction_date"], row.get("security_term") or ""))
    announced_through = max((row["issue_date"] for row in auctions), default=None)
    total = sum(float(row["offering_billions"]) for row in auctions)
    return {
        "as_of": max((row.get("record_date") for row in auctions if row.get("record_date")), default=None),
        "announced_through": announced_through,
        "auction_count": len(auctions),
        "total_announced_billions": total,
        "rows": auctions,
        "source_url": AUCTIONS_SOURCE,
        "api_url": UPCOMING_AUCTIONS_API,
        "frequency": "As announced",
        "unit": "$B",
        "note": "Announced Treasury auction offering amounts. Funding-pressure comparisons use issue/settlement dates because that is when auction cash is raised.",
    }


def _sum_until(rows: list[dict], date_field: str, amount_field: str, end_date: date) -> float:
    total = 0.0
    for row in rows:
        value_date = _date(row.get(date_field))
        if value_date is not None and value_date <= end_date:
            total += float(row.get(amount_field) or 0.0)
    return total


def build_funding_pressure(maturity: dict, tga: dict, auctions: dict) -> dict:
    anchor = _date(maturity.get("calculated_from"))
    if anchor is None:
        raise RuntimeError("Treasury maturity block is missing calculated_from")

    maturity_dates = maturity.get("maturity_dates") or []
    interest = maturity.get("interest_schedule") or {}
    interest_payments = interest.get("payments") or []
    auction_rows = auctions.get("rows") or []

    horizons = {}
    for key, days in HORIZONS.items():
        end_date = anchor + timedelta(days=days)
        principal = _sum_until(maturity_dates, "date", "total_billions", end_date)
        interest_due = _sum_until(interest_payments, "date", "total_billions", end_date)
        issuance = _sum_until(auction_rows, "issue_date", "offering_billions", end_date)
        gross = principal + interest_due
        horizons[key] = {
            "end_date": end_date.isoformat(),
            "principal_billions": principal,
            "interest_billions": interest_due,
            "gross_scheduled_cash_billions": gross,
            "announced_issuance_billions": issuance,
            "announced_coverage_pct": (100.0 * issuance / gross) if gross > 0 else None,
            "unmatched_scheduled_cash_billions": max(gross - issuance, 0.0),
        }

    final_date = anchor + timedelta(days=HORIZONS["1Y"])
    by_date: dict[str, dict] = {}

    for row in maturity_dates:
        day = _date(row.get("date"))
        if day is None or day < anchor or day > final_date:
            continue
        target = by_date.setdefault(
            day.isoformat(),
            {"date": day.isoformat(), "principal_billions": 0.0, "interest_billions": 0.0, "announced_issuance_billions": 0.0},
        )
        target["principal_billions"] += float(row.get("total_billions") or 0.0)

    for row in interest_payments:
        day = _date(row.get("date"))
        if day is None or day < anchor or day > final_date:
            continue
        target = by_date.setdefault(
            day.isoformat(),
            {"date": day.isoformat(), "principal_billions": 0.0, "interest_billions": 0.0, "announced_issuance_billions": 0.0},
        )
        target["interest_billions"] += float(row.get("total_billions") or 0.0)

    for row in auction_rows:
        day = _date(row.get("issue_date"))
        if day is None or day < anchor or day > final_date:
            continue
        target = by_date.setdefault(
            day.isoformat(),
            {"date": day.isoformat(), "principal_billions": 0.0, "interest_billions": 0.0, "announced_issuance_billions": 0.0},
        )
        target["announced_issuance_billions"] += float(row.get("offering_billions") or 0.0)

    timeline = []
    for _, row in sorted(by_date.items()):
        timeline.append(
            {
                **row,
                "gross_scheduled_cash_billions": float(row["principal_billions"]) + float(row["interest_billions"]),
            }
        )

    return {
        "as_of": anchor.isoformat(),
        "unit": "$B",
        "maturity_as_of": maturity.get("as_of"),
        "interest_as_of": interest.get("as_of"),
        "tga": tga,
        "auctions": auctions,
        "horizons": horizons,
        "timeline": timeline,
        "note": (
            "Treasury Funding Pressure compares scheduled marketable principal maturities and modeled coupon interest with announced auction offering amounts and the latest Treasury General Account balance. "
            "Auction supply is shown on issue/settlement dates. Announced issuance is not the same as net borrowing and should not be subtracted from maturities to infer an exact financing need: tax receipts, other federal cash flows, SOMA add-ons/redemptions, buybacks, and future auction announcements also matter."
        ),
    }


def main() -> None:
    prior_data = json.loads(DATA_FILE.read_text(encoding="utf-8")) if DATA_FILE.exists() else {}
    previous = prior_data.get("treasury_funding_pressure") or {}

    phase18.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    maturity = data.get("treasury_maturities") or {}
    anchor = _date(maturity.get("calculated_from"))
    if anchor is None:
        raise RuntimeError("Cannot build funding pressure without Treasury maturity calculated_from")

    try:
        tga = fetch_tga_history(anchor)
        data.setdefault("sources", {})["treasury_funding_tga"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        tga = previous.get("tga")
        if not tga or not tga.get("history"):
            raise
        data.setdefault("sources", {})["treasury_funding_tga"] = {
            "status": "error",
            "checked_at": base.now_iso(),
            "message": f"{type(exc).__name__}: {exc}; previous verified TGA history retained",
        }

    try:
        auctions = fetch_upcoming_auctions(anchor)
        data.setdefault("sources", {})["treasury_funding_auctions"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        auctions = previous.get("auctions")
        if not auctions:
            raise
        data.setdefault("sources", {})["treasury_funding_auctions"] = {
            "status": "error",
            "checked_at": base.now_iso(),
            "message": f"{type(exc).__name__}: {exc}; previous verified upcoming-auction data retained",
        }

    data["treasury_funding_pressure"] = build_funding_pressure(maturity, tga, auctions)
    data["generated_at"] = base.now_iso()
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    block = data["treasury_funding_pressure"]
    h90 = block["horizons"]["90D"]
    print(
        "Treasury funding pressure:",
        "TGA", block["tga"].get("current_billions"), "B as of", block["tga"].get("as_of"),
        ";", block["auctions"].get("auction_count"), "announced auctions through", block["auctions"].get("announced_through"),
        "; 90D scheduled", h90.get("gross_scheduled_cash_billions"), "B",
        "; 90D announced issuance", h90.get("announced_issuance_billions"), "B",
    )


if __name__ == "__main__":
    main()
