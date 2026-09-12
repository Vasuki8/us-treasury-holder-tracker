from __future__ import annotations

import json
from datetime import datetime, timezone
from io import StringIO

import pandas as pd

import update_data_v22 as phase22

base = phase22.base
DATA_FILE = phase22.DATA_FILE

TREASURY_RATES_PAGE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView"
NOMINAL_ARCHIVE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rate-archives/par-yield-curve-rates-1990-2023.csv"
REAL_ARCHIVE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rate-archives/par-real-yield-curve-rates-2003-2023.csv"

NOMINAL_COLUMNS = {
    "3m": "3 mo",
    "6m": "6 mo",
    "1y": "1 yr",
    "2y": "2 yr",
    "3y": "3 yr",
    "5y": "5 yr",
    "7y": "7 yr",
    "10y": "10 yr",
    "20y": "20 yr",
    "30y": "30 yr",
}
REAL_COLUMNS = {
    "5y": "5 yr",
    "7y": "7 yr",
    "10y": "10 yr",
    "20y": "20 yr",
    "30y": "30 yr",
}
TENORS = [
    {"key": "3m", "label": "3M", "years": 0.25},
    {"key": "6m", "label": "6M", "years": 0.5},
    {"key": "1y", "label": "1Y", "years": 1.0},
    {"key": "2y", "label": "2Y", "years": 2.0},
    {"key": "3y", "label": "3Y", "years": 3.0},
    {"key": "5y", "label": "5Y", "years": 5.0},
    {"key": "7y", "label": "7Y", "years": 7.0},
    {"key": "10y", "label": "10Y", "years": 10.0},
    {"key": "20y", "label": "20Y", "years": 20.0},
    {"key": "30y", "label": "30Y", "years": 30.0},
]


def annual_csv_url(year: int, curve_type: str) -> str:
    return (
        f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
        f"daily-treasury-rates.csv/{year}/all?_format=csv&field_tdr_date_value={year}"
        f"&page=&type={curve_type}"
    )


def _normalized_frame(text: str) -> pd.DataFrame:
    frame = pd.read_csv(StringIO(text), dtype=str)
    frame.columns = [str(col).strip().lower() for col in frame.columns]
    date_col = next((col for col in frame.columns if col == "date"), None)
    if not date_col:
        raise RuntimeError(f"Treasury curve CSV missing date column: {list(frame.columns)[:8]}")
    frame["date"] = pd.to_datetime(frame[date_col], errors="coerce")
    frame = frame.loc[frame["date"].notna()].copy()
    return frame


def _rows_from_frame(frame: pd.DataFrame, columns: dict[str, str]) -> list[dict]:
    lookup = {str(col).strip().lower(): col for col in frame.columns}
    resolved = {}
    for key, wanted in columns.items():
        col = lookup.get(wanted.lower())
        if col is not None:
            resolved[key] = col
    if len(resolved) < max(3, len(columns) - 2):
        raise RuntimeError(f"Treasury curve CSV missing too many tenor columns: {sorted(resolved)}")

    rows = []
    for _, record in frame.iterrows():
        item = {"date": record["date"].date().isoformat()}
        populated = 0
        for key in columns:
            value = base.to_float(record.get(resolved.get(key))) if key in resolved else None
            item[key] = value
            populated += value is not None
        if populated >= 3:
            rows.append(item)
    return rows


def fetch_curve_history(curve_type: str, archive_url: str, columns: dict[str, str]) -> list[dict]:
    rows = _rows_from_frame(_normalized_frame(base.get_text(archive_url)), columns)
    current_year = datetime.now(timezone.utc).year
    for year in range(2024, current_year + 1):
        url = annual_csv_url(year, curve_type)
        frame = _normalized_frame(base.get_text(url))
        rows.extend(_rows_from_frame(frame, columns))

    by_date = {row["date"]: row for row in rows}
    merged = [by_date[date] for date in sorted(by_date)]
    if not merged:
        raise RuntimeError(f"Treasury returned no {curve_type} curve history")
    return merged


def _spread_row(row: dict) -> dict:
    def bps(long_key: str, short_key: str) -> float | None:
        long = base.to_float(row.get(long_key))
        short = base.to_float(row.get(short_key))
        return (long - short) * 100.0 if long is not None and short is not None else None

    return {
        "date": row["date"],
        "10y_2y_bps": bps("10y", "2y"),
        "10y_3m_bps": bps("10y", "3m"),
        "30y_10y_bps": bps("30y", "10y"),
    }


def build_yield_curve(data: dict) -> dict:
    nominal = fetch_curve_history("daily_treasury_yield_curve", NOMINAL_ARCHIVE, NOMINAL_COLUMNS)
    real = fetch_curve_history("daily_treasury_real_yield_curve", REAL_ARCHIVE, REAL_COLUMNS)

    nominal_by_date = {row["date"]: row for row in nominal}
    real_by_date = {row["date"]: row for row in real}
    common_dates = sorted(set(nominal_by_date) & set(real_by_date))

    breakevens = []
    for date in common_dates:
        nrow = nominal_by_date[date]
        rrow = real_by_date[date]
        item = {"date": date}
        populated = 0
        for key in REAL_COLUMNS:
            nominal_value = base.to_float(nrow.get(key))
            real_value = base.to_float(rrow.get(key))
            value = nominal_value - real_value if nominal_value is not None and real_value is not None else None
            item[key] = value
            populated += value is not None
        if populated >= 2:
            breakevens.append(item)

    spreads = [_spread_row(row) for row in nominal]
    latest_nominal = nominal[-1]
    latest_real = real_by_date.get(latest_nominal["date"]) or real[-1]
    latest_breakeven = next((row for row in reversed(breakevens) if row["date"] <= latest_nominal["date"]), {})
    latest_spreads = spreads[-1]

    funding = data.get("treasury_funding_pressure") or {}
    debt_cost = data.get("treasury_debt_cost") or {}
    refinancing = {
        "next_12m_principal_billions": ((funding.get("horizons") or {}).get("1Y") or {}).get("principal_billions"),
        "weighted_average_remaining_maturity_years": debt_cost.get("weighted_average_remaining_maturity_years"),
    }

    return {
        "as_of": latest_nominal["date"],
        "real_as_of": latest_real.get("date"),
        "frequency": "Business daily",
        "tenors": TENORS,
        "nominal": {
            "history_start": nominal[0]["date"],
            "history_count": len(nominal),
            "history": nominal,
            "latest": latest_nominal,
        },
        "real": {
            "history_start": real[0]["date"],
            "history_count": len(real),
            "history": real,
            "latest": latest_real,
        },
        "spreads": {
            "history": spreads,
            "latest": latest_spreads,
        },
        "breakeven": {
            "history_start": breakevens[0]["date"] if breakevens else None,
            "history_count": len(breakevens),
            "history": breakevens,
            "latest": latest_breakeven,
        },
        "refinancing_context": refinancing,
        "source_url": f"{TREASURY_RATES_PAGE}?type=daily_treasury_yield_curve",
        "real_source_url": f"{TREASURY_RATES_PAGE}?type=daily_treasury_real_yield_curve",
        "archive_url": NOMINAL_ARCHIVE,
        "real_archive_url": REAL_ARCHIVE,
        "note": (
            "Nominal and real par yield curves are official U.S. Treasury constant-maturity estimates derived from market prices; "
            "they are reference market yields, not auction stop-out yields or security coupon rates. Breakeven inflation is nominal "
            "par yield minus real par yield at the same maturity and includes inflation risk/liquidity premia, so it is not a pure inflation forecast."
        ),
    }


def main() -> None:
    prior = json.loads(DATA_FILE.read_text(encoding="utf-8")) if DATA_FILE.exists() else {}
    previous = prior.get("treasury_yield_curve")

    phase22.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    try:
        data["treasury_yield_curve"] = build_yield_curve(data)
        data.setdefault("sources", {})["treasury_yield_curve"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        if not previous:
            raise
        data["treasury_yield_curve"] = previous
        data.setdefault("sources", {})["treasury_yield_curve"] = {
            "status": "error",
            "checked_at": base.now_iso(),
            "message": f"{type(exc).__name__}: {exc}; previous verified Treasury yield-curve history retained",
        }

    data["generated_at"] = base.now_iso()
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    curve = data.get("treasury_yield_curve") or {}
    nominal = curve.get("nominal") or {}
    real = curve.get("real") or {}
    latest = nominal.get("latest") or {}
    spreads = (curve.get("spreads") or {}).get("latest") or {}
    print(
        "Treasury yield curve:",
        nominal.get("history_count"),
        "nominal observations",
        nominal.get("history_start"),
        "to",
        curve.get("as_of"),
        "; real",
        real.get("history_count"),
        "observations; 10Y",
        latest.get("10y"),
        "%; 10Y-2Y",
        spreads.get("10y_2y_bps"),
        "bps",
    )


if __name__ == "__main__":
    main()
