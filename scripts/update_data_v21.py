from __future__ import annotations

import bisect
import json
from collections import defaultdict
from datetime import date

import pandas as pd

import update_data_v20 as phase20

base = phase20.base
DATA_FILE = phase20.DATA_FILE

AVG_INTEREST_URL = (
    "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
    "v2/accounting/od/avg_interest_rates"
)
INTEREST_EXPENSE_URL = (
    "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
    "v2/accounting/od/interest_expense"
)
AVG_INTEREST_SOURCE = (
    "https://fiscaldata.treasury.gov/datasets/average-interest-rates-treasury-securities/"
)
INTEREST_EXPENSE_SOURCE = (
    "https://fiscaldata.treasury.gov/datasets/interest-expense-debt-outstanding/"
)

RATE_SERIES = [
    ("total_marketable", "Total marketable", ("total marketable",)),
    ("total_interest_bearing", "Total interest-bearing debt", ("total interest-bearing debt",)),
    ("treasury_bills", "Treasury bills", ("treasury bills",)),
    ("treasury_notes", "Treasury notes", ("treasury notes",)),
    ("treasury_bonds", "Treasury bonds", ("treasury bonds",)),
    ("tips", "TIPS", ("treasury inflation-protected securities", "tips")),
    ("frns", "Floating-rate notes", ("treasury floating rate notes", "frn")),
]


def _norm(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().replace("(", " ").replace(")", " ").split())


def _date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        parsed = pd.Timestamp(str(value))
        if pd.isna(parsed):
            return None
        return parsed.date()
    except Exception:
        return None


def _all_time_series(data: dict, key: str) -> dict:
    return next(
        (row for row in (data.get("all_time_history") or {}).get("series", []) if row.get("key") == key),
        {},
    )


def _ownership_input_series(data: dict) -> list[dict]:
    rows = []
    foreign = _all_time_series(data, "foreign_total")
    fed = _all_time_series(data, "federal_reserve_treasuries")
    if foreign.get("observations"):
        rows.append(
            {
                "key": "foreign_total",
                "label": "Foreign holders — total",
                "frequency": foreign.get("frequency"),
                "source_url": foreign.get("source_url"),
                "observations": foreign.get("observations") or [],
                "note": "TIC foreign Treasury holdings. Country attribution can reflect custodial location rather than the ultimate beneficial owner.",
            }
        )
    if fed.get("observations"):
        rows.append(
            {
                "key": "federal_reserve",
                "label": "Federal Reserve",
                "frequency": fed.get("frequency"),
                "source_url": fed.get("source_url"),
                "observations": fed.get("observations") or [],
                "note": "Federal Reserve Treasury holdings from H.4.1/FRED.",
            }
        )

    for row in (data.get("institution_holder_history") or {}).get("series", []):
        rows.append(
            {
                "key": row.get("key"),
                "label": row.get("label"),
                "frequency": row.get("frequency"),
                "source_url": row.get("source_url"),
                "observations": row.get("observations") or [],
                "note": row.get("note"),
            }
        )
    return rows


def build_ownership_share_history(data: dict) -> dict:
    public = _all_time_series(data, "debt_held_by_public")
    debt_rows = [
        row
        for row in public.get("observations") or []
        if row.get("date") and row.get("value_billions") not in (None, 0)
    ]
    if len(debt_rows) < 500:
        raise RuntimeError("Debt-held-by-public history unavailable for ownership-share denominator")

    debt_dates = [str(row["date"])[:10] for row in debt_rows]
    debt_values = [float(row["value_billions"]) for row in debt_rows]

    def denominator(obs_date: str) -> tuple[str, float] | None:
        key = str(obs_date)[:10]
        idx = bisect.bisect_right(debt_dates, key) - 1
        if idx < 0:
            return None
        return debt_dates[idx], debt_values[idx]

    series = []
    for source in _ownership_input_series(data):
        observations = []
        for row in source.get("observations") or []:
            obs_date = str(row.get("date") or "")[:10]
            holdings = base.to_float(row.get("value_billions"))
            denom = denominator(obs_date)
            if not obs_date or holdings is None or denom is None or not denom[1]:
                continue
            observations.append(
                {
                    "date": obs_date,
                    "holdings_billions": holdings,
                    "debt_held_by_public_billions": denom[1],
                    "denominator_date": denom[0],
                    "share_pct": holdings / denom[1] * 100.0,
                }
            )
        observations.sort(key=lambda row: row["date"])
        if len(observations) < 4:
            continue
        series.append(
            {
                "key": source.get("key"),
                "label": source.get("label"),
                "frequency": source.get("frequency"),
                "unit": "% of debt held by public",
                "source_url": source.get("source_url"),
                "history_start": observations[0]["date"],
                "as_of": observations[-1]["date"],
                "observation_count": len(observations),
                "holdings_billions": observations[-1]["holdings_billions"],
                "share_pct": observations[-1]["share_pct"],
                "note": source.get("note"),
                "observations": observations,
            }
        )

    if len(series) < 8:
        raise RuntimeError(f"Ownership-share history unexpectedly sparse: {len(series)} series")

    return {
        "denominator": "Debt held by the public",
        "denominator_source_url": public.get("source_url"),
        "denominator_history_start": public.get("history_start"),
        "series_count": len(series),
        "series": series,
        "note": (
            "Each holder observation is divided by the latest official Debt Held by the Public observation on or before the holder's reporting date. "
            "This is a directional ownership-share view, not an additive ownership register: TIC, Federal Reserve and Financial Accounts series can use different valuation and classification bases, so shares should not be summed across sources."
        ),
    }


def fetch_average_interest_rates() -> dict:
    payload = base.get_json(
        AVG_INTEREST_URL,
        params={
            "fields": "record_date,security_type_desc,security_desc,avg_interest_rate_amt",
            "sort": "record_date",
            "page[number]": 1,
            "page[size]": 10000,
            "format": "json",
        },
    )
    rows = payload.get("data", [])
    if len(rows) < 100:
        raise RuntimeError(f"Average-interest-rate history unexpectedly short: {len(rows)} rows")

    by_desc: dict[str, list[dict]] = defaultdict(list)
    original_names: dict[str, str] = {}
    for row in rows:
        desc = str(row.get("security_desc") or "").strip()
        obs_date = str(row.get("record_date") or "")[:10]
        rate = base.to_float(row.get("avg_interest_rate_amt"))
        if not desc or not obs_date or rate is None:
            continue
        norm = _norm(desc)
        original_names[norm] = desc
        by_desc[norm].append({"date": obs_date, "rate_pct": rate})

    series = []
    used = set()
    for key, label, aliases in RATE_SERIES:
        match = None
        for candidate in by_desc:
            if candidate in used:
                continue
            if any(alias in candidate for alias in aliases):
                match = candidate
                break
        if match is None:
            continue
        observations = sorted(by_desc[match], key=lambda row: row["date"])
        used.add(match)
        series.append(
            {
                "key": key,
                "label": label,
                "security_desc": original_names.get(match, label),
                "frequency": "Monthly",
                "unit": "%",
                "history_start": observations[0]["date"],
                "as_of": observations[-1]["date"],
                "observation_count": len(observations),
                "latest_rate_pct": observations[-1]["rate_pct"],
                "observations": observations,
            }
        )

    if not any(row["key"] == "total_marketable" for row in series):
        available = sorted(original_names.values())
        raise RuntimeError(f"Total Marketable average-rate series missing; descriptions={available[:40]}")

    return {
        "as_of": max(row["as_of"] for row in series),
        "frequency": "Monthly",
        "source_url": AVG_INTEREST_SOURCE,
        "api_url": AVG_INTEREST_URL,
        "series_count": len(series),
        "series": series,
        "note": (
            "Official Treasury average interest rates on outstanding securities. Treasury's published aggregate average-rate measures have their own methodology and should not be read as current market yields."
        ),
    }


def fetch_interest_expense() -> dict:
    # Request only date + Treasury's current-month expense field so Fiscal Data
    # aggregates the component rows to one total for each reporting month.
    payload = base.get_json(
        INTEREST_EXPENSE_URL,
        params={
            "fields": "record_date,month_expense_amt",
            "sort": "record_date",
            "page[number]": 1,
            "page[size]": 10000,
            "format": "json",
        },
    )
    rows = []
    for row in payload.get("data", []):
        obs_date = str(row.get("record_date") or "")[:10]
        amount = base.to_float(row.get("month_expense_amt"))
        if obs_date and amount is not None:
            rows.append({"date": obs_date, "expense_billions": amount / 1e9})
    rows.sort(key=lambda row: row["date"])
    if len(rows) < 60:
        raise RuntimeError(f"Interest-expense history unexpectedly short: {len(rows)} monthly rows")

    latest = rows[-1]
    ttm_rows = rows[-12:]
    ttm = sum(row["expense_billions"] for row in ttm_rows)
    latest_date = _date(latest["date"])
    if latest_date is None:
        raise RuntimeError("Latest interest-expense date invalid")
    fiscal_year = latest_date.year + 1 if latest_date.month >= 10 else latest_date.year
    fy_start = date(fiscal_year - 1, 10, 1)
    fytd = sum(
        row["expense_billions"]
        for row in rows
        if (_date(row["date"]) or date.min) >= fy_start and (_date(row["date"]) or date.max) <= latest_date
    )

    annual = defaultdict(float)
    counts = defaultdict(int)
    for row in rows:
        d = _date(row["date"])
        if d is None:
            continue
        fy = d.year + 1 if d.month >= 10 else d.year
        annual[fy] += row["expense_billions"]
        counts[fy] += 1

    return {
        "as_of": latest["date"],
        "frequency": "Monthly",
        "unit": "$B",
        "source_url": INTEREST_EXPENSE_SOURCE,
        "api_url": INTEREST_EXPENSE_URL,
        "latest_month_billions": latest["expense_billions"],
        "trailing_12m_billions": ttm,
        "fiscal_year": fiscal_year,
        "fiscal_year_to_date_billions": fytd,
        "observations": rows,
        "fiscal_years": [
            {"fiscal_year": fy, "expense_billions": annual[fy], "month_count": counts[fy]}
            for fy in sorted(annual)
        ],
        "note": "Official Treasury current-month interest expense on debt outstanding, aggregated to one monthly total from the Fiscal Data component rows.",
    }


def weighted_average_remaining_maturity(data: dict) -> float | None:
    maturity = data.get("treasury_maturities") or {}
    anchor = _date(maturity.get("calculated_from") or maturity.get("as_of"))
    if anchor is None:
        return None
    numerator = 0.0
    denominator = 0.0
    for row in maturity.get("securities") or []:
        mat = _date(row.get("maturity_date"))
        amount = base.to_float(row.get("outstanding_billions"))
        if mat is None or amount is None or amount <= 0 or mat <= anchor:
            continue
        years = (mat - anchor).days / 365.25
        numerator += years * amount
        denominator += amount
    return numerator / denominator if denominator else None


def latest_gdp_billions(data: dict) -> float | None:
    gdp = _all_time_series(data, "nominal_gdp")
    rows = gdp.get("observations") or []
    if not rows:
        return None
    return base.to_float(rows[-1].get("value_billions"))


def build_debt_cost(data: dict, rates: dict, expense: dict) -> dict:
    rate_map = {row.get("key"): row for row in rates.get("series") or []}
    total_marketable = rate_map.get("total_marketable") or {}
    total_interest_bearing = rate_map.get("total_interest_bearing") or {}
    gdp = latest_gdp_billions(data)
    ttm = base.to_float(expense.get("trailing_12m_billions"))
    interest_gdp = (ttm / gdp * 100.0) if ttm is not None and gdp else None
    interest_schedule = ((data.get("treasury_maturities") or {}).get("interest_schedule") or {})
    next_12m = base.to_float((interest_schedule.get("summary") or {}).get("next_12m_billions"))

    return {
        "as_of": max(str(rates.get("as_of") or ""), str(expense.get("as_of") or "")),
        "average_rates": rates,
        "interest_expense": expense,
        "average_marketable_rate_pct": total_marketable.get("latest_rate_pct"),
        "average_total_interest_bearing_rate_pct": total_interest_bearing.get("latest_rate_pct"),
        "trailing_12m_interest_expense_billions": ttm,
        "interest_expense_to_gdp_pct": interest_gdp,
        "weighted_average_remaining_maturity_years": weighted_average_remaining_maturity(data),
        "next_12m_modeled_marketable_interest_billions": next_12m,
        "note": (
            "Average-rate and historical interest-expense data are official Treasury Fiscal Data series. Weighted average remaining maturity is calculated from the current MSPD marketable-security snapshot. "
            "The forward 12-month interest figure is the tracker's security-level marketable coupon schedule and is not the same accounting measure as historical Treasury interest expense."
        ),
    }


def main() -> None:
    prior_data = json.loads(DATA_FILE.read_text(encoding="utf-8")) if DATA_FILE.exists() else {}
    previous_shares = prior_data.get("ownership_share_history")
    previous_cost = prior_data.get("treasury_debt_cost")

    phase20.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    data.setdefault("sources", {})

    try:
        data["ownership_share_history"] = build_ownership_share_history(data)
        data["sources"]["ownership_share_history"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        if previous_shares and previous_shares.get("series"):
            data["ownership_share_history"] = previous_shares
            data["sources"]["ownership_share_history"] = {
                "status": "error",
                "checked_at": base.now_iso(),
                "message": f"{type(exc).__name__}: {exc}; previous verified ownership-share history retained",
            }
        else:
            raise

    try:
        rates = fetch_average_interest_rates()
        expense = fetch_interest_expense()
        data["treasury_debt_cost"] = build_debt_cost(data, rates, expense)
        data["sources"]["treasury_debt_cost"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        if previous_cost and previous_cost.get("average_rates"):
            data["treasury_debt_cost"] = previous_cost
            data["sources"]["treasury_debt_cost"] = {
                "status": "error",
                "checked_at": base.now_iso(),
                "message": f"{type(exc).__name__}: {exc}; previous verified debt-cost data retained",
            }
        else:
            raise

    data["generated_at"] = base.now_iso()
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    shares = data.get("ownership_share_history") or {}
    cost = data.get("treasury_debt_cost") or {}
    demand = data.get("auction_demand_monitor") or {}
    print("Ownership-share history:", shares.get("series_count"), "series")
    print(
        "Treasury debt cost: avg marketable",
        cost.get("average_marketable_rate_pct"),
        "% ; TTM interest",
        cost.get("trailing_12m_interest_expense_billions"),
        "B ; WARM",
        cost.get("weighted_average_remaining_maturity_years"),
        "years",
    )
    print("Auction demand UI source:", demand.get("auction_count"), "recent auctions")


if __name__ == "__main__":
    main()
