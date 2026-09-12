from __future__ import annotations

import bisect
import json
from collections import defaultdict
from datetime import date

import pandas as pd

import update_data_v23 as phase23

base = phase23.base
DATA_FILE = phase23.DATA_FILE
AUCTIONS_URL = (
    "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
    "v1/accounting/od/auctions_query"
)
AUCTIONS_SOURCE = "https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/"

TERM_MAP = {
    "13-Week": ("bill_13w", "13-Week Bill", "3m"),
    "26-Week": ("bill_26w", "26-Week Bill", "6m"),
    "52-Week": ("bill_52w", "52-Week Bill", "1y"),
    "2-Year": ("note_2y", "2-Year Note", "2y"),
    "3-Year": ("note_3y", "3-Year Note", "3y"),
    "5-Year": ("note_5y", "5-Year Note", "5y"),
    "7-Year": ("note_7y", "7-Year Note", "7y"),
    "10-Year": ("note_10y", "10-Year Note", "10y"),
    "20-Year": ("bond_20y", "20-Year Bond", "20y"),
    "30-Year": ("bond_30y", "30-Year Bond", "30y"),
}
TIPS_TERMS = {
    "5-Year": ("tips_5y", "5-Year TIPS", "5y"),
    "10-Year": ("tips_10y", "10-Year TIPS", "10y"),
    "30-Year": ("tips_30y", "30-Year TIPS", "30y"),
}


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


def build_refinancing_overlay(data: dict) -> dict:
    curve = data.get("treasury_yield_curve") or {}
    maturity = data.get("treasury_maturities") or {}
    anchor = _date(maturity.get("calculated_from") or maturity.get("as_of"))
    if anchor is None:
        raise RuntimeError("Treasury maturity anchor is unavailable for refinancing overlay")

    tenors = [row for row in curve.get("tenors") or [] if base.to_float(row.get("years")) is not None]
    if len(tenors) < 8:
        raise RuntimeError("Treasury curve tenors unavailable for refinancing overlay")

    buckets = [
        {
            "key": row["key"],
            "label": row["label"],
            "years": float(row["years"]),
            "principal_billions": 0.0,
            "security_count": 0,
            "by_type": {},
        }
        for row in tenors
    ]

    for security in maturity.get("securities") or []:
        mat = _date(security.get("maturity_date"))
        amount = base.to_float(security.get("outstanding_billions"))
        if mat is None or mat <= anchor or amount is None or amount <= 0:
            continue
        years = (mat - anchor).days / 365.25
        bucket = min(buckets, key=lambda row: abs(row["years"] - years))
        bucket["principal_billions"] += amount
        bucket["security_count"] += 1
        security_type = str(security.get("security_type") or "Other")
        bucket["by_type"][security_type] = bucket["by_type"].get(security_type, 0.0) + amount

    total = sum(row["principal_billions"] for row in buckets)
    expected = sum(
        base.to_float(row.get("outstanding_billions")) or 0.0
        for row in maturity.get("securities") or []
        if (_date(row.get("maturity_date")) or date.min) > anchor
    )
    return {
        "as_of": maturity.get("as_of"),
        "calculated_from": anchor.isoformat(),
        "method": "Each currently outstanding marketable security is assigned to the nearest official par-curve tenor by remaining maturity.",
        "total_principal_billions": total,
        "expected_future_principal_billions": expected,
        "buckets": buckets,
        "note": (
            "Refinancing bars are a current-snapshot maturity exposure view, not a forecast of future auction sizes. "
            "The yield lines are Treasury par-reference curves and should not be interpreted as the rate Treasury will necessarily pay when each security is refinanced."
        ),
    }


def _curve_lookup(history: list[dict], tenor_key: str, target_date: str) -> tuple[str, float] | None:
    rows = [row for row in history if row.get("date") and base.to_float(row.get(tenor_key)) is not None]
    if not rows:
        return None
    dates = [str(row["date"])[:10] for row in rows]
    idx = bisect.bisect_right(dates, target_date) - 1
    if idx < 0:
        return None
    ref_date = dates[idx]
    target = _date(target_date)
    ref = _date(ref_date)
    if target is None or ref is None or (target - ref).days > 7:
        return None
    return ref_date, float(rows[idx][tenor_key])


def fetch_auction_yield_history(data: dict) -> dict:
    curve = data.get("treasury_yield_curve") or {}
    nominal_history = (curve.get("nominal") or {}).get("history") or []
    real_history = (curve.get("real") or {}).get("history") or []
    if len(nominal_history) < 1000:
        raise RuntimeError("Nominal Treasury curve history unavailable for auction comparison")

    fields = [
        "cusip",
        "security_type",
        "security_term",
        "auction_date",
        "issue_date",
        "maturity_date",
        "reopening",
        "int_rate",
        "high_yield",
        "high_investment_rate",
        "bid_to_cover_ratio",
        "total_accepted",
        "offering_amt",
        "inflation_index_security",
    ]
    payload = base.get_json(
        AUCTIONS_URL,
        params={
            "fields": ",".join(fields),
            "filter": "auction_date:gte:1990-01-01",
            "sort": "auction_date",
            "page[number]": 1,
            "page[size]": 10000,
            "format": "json",
        },
    )
    raw = payload.get("data") or []
    if len(raw) < 1000:
        raise RuntimeError(f"Treasury auction history unexpectedly short: {len(raw)} rows")

    grouped: dict[str, list[dict]] = defaultdict(list)
    labels: dict[str, str] = {}
    tenor_keys: dict[str, str] = {}
    curve_types: dict[str, str] = {}

    for row in raw:
        auction_date = str(row.get("auction_date") or "")[:10]
        security_type = str(row.get("security_type") or "").strip()
        security_term = str(row.get("security_term") or "").strip()
        inflation = str(row.get("inflation_index_security") or "").strip().lower() == "yes"
        if not auction_date:
            continue

        if inflation:
            mapped = TIPS_TERMS.get(security_term)
            if not mapped:
                continue
            key, label, tenor_key = mapped
            result_rate = base.to_float(row.get("high_yield"))
            curve_history = real_history
            curve_type = "real"
            rate_kind = "High yield"
        else:
            mapped = TERM_MAP.get(security_term)
            if not mapped:
                continue
            key, label, tenor_key = mapped
            if security_type.lower() == "bill":
                result_rate = base.to_float(row.get("high_investment_rate"))
                rate_kind = "Investment rate"
            else:
                result_rate = base.to_float(row.get("high_yield"))
                rate_kind = "High yield"
            curve_history = nominal_history
            curve_type = "nominal"

        if result_rate is None:
            continue
        reference = _curve_lookup(curve_history, tenor_key, auction_date)
        reference_date = reference[0] if reference else None
        reference_rate = reference[1] if reference else None
        spread_bps = (result_rate - reference_rate) * 100.0 if reference_rate is not None else None

        item = {
            "auction_date": auction_date,
            "issue_date": str(row.get("issue_date") or "")[:10] or None,
            "maturity_date": str(row.get("maturity_date") or "")[:10] or None,
            "cusip": row.get("cusip"),
            "security_type": "TIPS" if inflation else security_type,
            "security_term": security_term,
            "reopening": row.get("reopening"),
            "coupon_rate_pct": base.to_float(row.get("int_rate")),
            "auction_result_rate_pct": result_rate,
            "rate_kind": rate_kind,
            "reference_curve_type": curve_type,
            "reference_tenor": tenor_key,
            "reference_date": reference_date,
            "reference_rate_pct": reference_rate,
            "result_minus_reference_bps": spread_bps,
            "bid_to_cover": base.to_float(row.get("bid_to_cover_ratio")),
            "offering_billions": (base.to_float(row.get("offering_amt")) or 0.0) / 1e9,
            "accepted_billions": (base.to_float(row.get("total_accepted")) or 0.0) / 1e9,
        }
        grouped[key].append(item)
        labels[key] = label
        tenor_keys[key] = tenor_key
        curve_types[key] = curve_type

    series = []
    preferred_order = [
        "bill_13w", "bill_26w", "bill_52w", "note_2y", "note_3y", "note_5y", "note_7y",
        "note_10y", "bond_20y", "bond_30y", "tips_5y", "tips_10y", "tips_30y",
    ]
    for key in preferred_order:
        observations = sorted(grouped.get(key) or [], key=lambda row: row["auction_date"])
        if len(observations) < 5:
            continue
        matched = [row for row in observations if row.get("reference_rate_pct") is not None]
        series.append(
            {
                "key": key,
                "label": labels[key],
                "reference_curve_type": curve_types[key],
                "reference_tenor": tenor_keys[key],
                "history_start": observations[0]["auction_date"],
                "as_of": observations[-1]["auction_date"],
                "observation_count": len(observations),
                "reference_match_count": len(matched),
                "reference_match_pct": len(matched) / len(observations) * 100.0,
                "latest": observations[-1],
                "observations": observations,
            }
        )

    if len(series) < 10:
        raise RuntimeError(f"Auction-yield history unexpectedly sparse: {len(series)} comparable term series")
    default_key = "note_10y" if any(row["key"] == "note_10y" for row in series) else series[0]["key"]
    return {
        "as_of": max(row["as_of"] for row in series),
        "history_start": min(row["history_start"] for row in series),
        "series_count": len(series),
        "default_series_key": default_key,
        "source_url": AUCTIONS_SOURCE,
        "api_url": AUCTIONS_URL,
        "series": series,
        "note": (
            "Bills use Treasury's auction high investment rate; Notes, Bonds and TIPS use the auction high yield. "
            "The reference line is the closest official Treasury par yield on or before the auction date at the matched maturity; TIPS use the real par curve. "
            "Auction-result minus par-reference is a context spread, not an exact auction tail versus the when-issued market."
        ),
    }


def main() -> None:
    prior = json.loads(DATA_FILE.read_text(encoding="utf-8")) if DATA_FILE.exists() else {}
    previous_auction_yields = prior.get("treasury_auction_yield_history")
    previous_overlay = ((prior.get("treasury_yield_curve") or {}).get("refinancing_overlay"))

    phase23.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    data.setdefault("sources", {})

    try:
        overlay = build_refinancing_overlay(data)
        data.setdefault("treasury_yield_curve", {})["refinancing_overlay"] = overlay
        data["sources"]["treasury_refinancing_overlay"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        if not previous_overlay:
            raise
        data.setdefault("treasury_yield_curve", {})["refinancing_overlay"] = previous_overlay
        data["sources"]["treasury_refinancing_overlay"] = {
            "status": "error",
            "checked_at": base.now_iso(),
            "message": f"{type(exc).__name__}: {exc}; previous verified refinancing overlay retained",
        }

    try:
        data["treasury_auction_yield_history"] = fetch_auction_yield_history(data)
        data["sources"]["treasury_auction_yield_history"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        if not previous_auction_yields:
            raise
        data["treasury_auction_yield_history"] = previous_auction_yields
        data["sources"]["treasury_auction_yield_history"] = {
            "status": "error",
            "checked_at": base.now_iso(),
            "message": f"{type(exc).__name__}: {exc}; previous verified auction-yield history retained",
        }

    data["generated_at"] = base.now_iso()
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    overlay = ((data.get("treasury_yield_curve") or {}).get("refinancing_overlay") or {})
    auction = data.get("treasury_auction_yield_history") or {}
    print(
        "Yield/refinancing extension:",
        len(overlay.get("buckets") or []),
        "maturity buckets;",
        round(base.to_float(overlay.get("total_principal_billions")) or 0.0, 1),
        "B principal;",
        auction.get("series_count"),
        "auction-yield series",
        auction.get("history_start"),
        "to",
        auction.get("as_of"),
    )


if __name__ == "__main__":
    main()
