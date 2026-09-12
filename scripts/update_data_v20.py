from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date, datetime, timedelta

import pandas as pd

import update_data_v19 as phase19

base = phase19.base
DATA_FILE = phase19.DATA_FILE

BUYBACK_SOURCE = "https://treasurydirect.gov/auctions/announcements-data-results/buy-backs/"
BUYBACK_SCHEDULE_XML = "https://home.treasury.gov/system/files/221/Tentative-Buyback-Schedule.xml"

PD_SOURCE = "https://www.newyorkfed.org/markets/primarydealers"
PD_DEFINITIONS = "https://markets.newyorkfed.org/api/pd/list/timeseries.json"
PD_SERIES = [
    ("PDPOSGST-TOT", "Treasury net position ex-TIPS"),
    ("PDPOSGS-B", "Treasury bills"),
    ("PDPOSGSC-L2", "Coupons ≤2Y"),
    ("PDPOSGSC-G2L3", "Coupons 2–3Y"),
    ("PDPOSGSC-G3L6", "Coupons 3–6Y"),
    ("PDPOSGSC-G6L7", "Coupons 6–7Y"),
    ("PDPOSGSC-G7L11", "Coupons 7–11Y"),
    ("PDPOSGSC-G11L21", "Coupons 11–21Y"),
    ("PDPOSGSC-G21", "Coupons >21Y"),
    ("PDPOSGS-BFRN", "Floating-rate notes"),
    ("PDPOSTIPS-L2", "TIPS ≤2Y"),
    ("PDPOSTIPS-G2", "TIPS 2–6Y"),
    ("PDPOSTIPS-G6L11", "TIPS 6–11Y"),
    ("PDPOSTIPS-G11", "TIPS >11Y"),
]
PD_API = "https://markets.newyorkfed.org/api/pd/get/" + "_".join(key for key, _ in PD_SERIES) + ".json"


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


def _norm_tag(tag: str) -> str:
    local = str(tag).split("}")[-1]
    return re.sub(r"[^a-z0-9]", "", local.lower())


def _flatten_element(element: ET.Element) -> dict[str, str]:
    fields: dict[str, str] = {}
    for child in element.iter():
        if child is element:
            continue
        text = " ".join(part.strip() for part in child.itertext() if part and part.strip()).strip()
        if not text:
            continue
        key = _norm_tag(child.tag)
        if key and key not in fields:
            fields[key] = text
    return fields


def _pick(fields: dict[str, str], aliases: tuple[str, ...], token_groups: tuple[tuple[str, ...], ...] = ()) -> str | None:
    for alias in aliases:
        if alias in fields:
            return fields[alias]
    for tokens in token_groups:
        for key, value in fields.items():
            if all(token in key for token in tokens):
                return value
    return None


def _billions(value: str | None) -> float | None:
    if value is None:
        return None
    text = str(value).strip().lower().replace("$", "").replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    number = float(match.group(0))
    if "billion" in text or re.search(r"\bbn\b", text):
        return number
    if "million" in text or re.search(r"\bmm\b", text):
        return number / 1000.0
    if abs(number) >= 1_000_000:
        return number / 1_000_000_000.0
    if abs(number) >= 1_000:
        return number / 1000.0
    return number


def fetch_buyback_schedule(anchor: date) -> dict:
    text = base.get_text(BUYBACK_SCHEDULE_XML)
    root = ET.fromstring(text)
    parsed: list[dict] = []

    for element in root.iter():
        fields = _flatten_element(element)
        if not fields:
            continue

        operation_raw = _pick(
            fields,
            ("operationdate", "buybackoperationdate"),
            (("operation", "date"),),
        )
        max_raw = _pick(
            fields,
            ("maxparamounttoberedeemed", "maximumpurchaseamount", "maxpurchaseamount", "maximumparamount"),
            (("max", "par", "amount"), ("max", "purchase", "amount"), ("maximum", "amount")),
        )
        operation_date = _date(operation_raw)
        max_billions = _billions(max_raw)
        if operation_date is None or max_billions is None or max_billions <= 0:
            continue

        settlement_raw = _pick(fields, ("settlementdate",), (("settlement", "date"),))
        announcement_raw = _pick(fields, ("announcementdate",), (("announcement", "date"),))
        operation_type = _pick(fields, ("operationtype", "buybacktype"), (("operation", "type"),))
        security_type = _pick(fields, ("securitytype",), (("security", "type"),))
        maturity_bucket = _pick(
            fields,
            ("maturitybucket", "securitytypeandmaturityrange", "maturityrange"),
            (("maturity", "bucket"), ("maturity", "range")),
        )
        settlement_date = _date(settlement_raw)
        announcement_date = _date(announcement_raw)

        parsed.append(
            {
                "operation_date": operation_date.isoformat(),
                "settlement_date": settlement_date.isoformat() if settlement_date else None,
                "announcement_date": announcement_date.isoformat() if announcement_date else None,
                "operation_type": str(operation_type or "").strip() or None,
                "security_type": str(security_type or "").strip() or None,
                "maturity_bucket": str(maturity_bucket or "").strip() or None,
                "max_purchase_billions": max_billions,
            }
        )

    dedup: dict[tuple, dict] = {}
    for row in parsed:
        key = (
            row["operation_date"],
            row.get("settlement_date"),
            row.get("operation_type"),
            row.get("security_type"),
            row.get("maturity_bucket"),
            round(float(row["max_purchase_billions"]), 6),
        )
        dedup[key] = row
    rows = sorted(dedup.values(), key=lambda row: (row["operation_date"], row.get("maturity_bucket") or ""))

    if not rows:
        tags = sorted({_norm_tag(element.tag) for element in root.iter() if _norm_tag(element.tag)})
        raise RuntimeError(f"Tentative buyback schedule parsed no operations; XML tags={tags[:80]}")

    upcoming = [row for row in rows if _date(row["operation_date"]) and _date(row["operation_date"]) >= anchor]
    by_type = defaultdict(float)
    for row in upcoming:
        label = row.get("operation_type") or "Unspecified"
        by_type[label] += float(row["max_purchase_billions"])

    return {
        "as_of": anchor.isoformat(),
        "schedule_url": BUYBACK_SCHEDULE_XML,
        "source_url": BUYBACK_SOURCE,
        "unit": "$B",
        "operation_count": len(rows),
        "upcoming_operation_count": len(upcoming),
        "upcoming_max_billions": sum(float(row["max_purchase_billions"]) for row in upcoming),
        "upcoming_by_type": [
            {"name": name, "max_purchase_billions": value}
            for name, value in sorted(by_type.items(), key=lambda item: item[0])
        ],
        "operations": rows,
        "upcoming": upcoming,
        "note": (
            "Tentative Treasury buyback schedule. Amounts are maximum purchase caps, not guaranteed accepted amounts. "
            "Treasury may revise the schedule or conduct operations not shown on the tentative calendar."
        ),
    }


def fetch_primary_dealer_positioning() -> dict:
    payload = base.get_json(PD_API)
    rows = payload.get("pd", {}).get("timeseries", [])
    if not rows:
        raise RuntimeError("NY Fed primary-dealer positioning endpoint returned no observations")

    labels = dict(PD_SERIES)
    grouped: dict[str, list[dict]] = {key: [] for key in labels}
    for row in rows:
        key = str(row.get("keyid") or "")
        if key not in grouped:
            continue
        value = base.to_float(row.get("value"))
        obs_date = row.get("asofdate") or row.get("asOfDate")
        parsed_date = _date(obs_date)
        if value is None or parsed_date is None:
            continue
        grouped[key].append({"date": parsed_date.isoformat(), "value_billions": value / 1000.0})

    series = []
    for key, label in PD_SERIES:
        history_map = {row["date"]: row for row in grouped[key]}
        history = [history_map[day] for day in sorted(history_map)]
        if not history:
            continue
        latest = history[-1]
        previous = history[-2]["value_billions"] if len(history) >= 2 else None
        series.append(
            {
                "keyid": key,
                "name": label,
                "as_of": latest["date"],
                "value_billions": latest["value_billions"],
                "weekly_change_billions": latest["value_billions"] - previous if previous is not None else None,
                "history_start": history[0]["date"],
                "observation_count": len(history),
                "history": history,
            }
        )

    if not any(row["keyid"] == "PDPOSGST-TOT" for row in series):
        raise RuntimeError("Primary dealer total Treasury net-position series missing")

    latest_date = max(row["as_of"] for row in series)
    return {
        "as_of": latest_date,
        "frequency": "Weekly; updated Thursdays with the previous week's data",
        "unit": "$B",
        "series_count": len(series),
        "series": series,
        "source_url": PD_SOURCE,
        "api_url": PD_API,
        "definitions_url": PD_DEFINITIONS,
        "note": (
            "Aggregate primary-dealer net outright positions from the New York Fed FR 2004 release. "
            "Positive values indicate aggregate net-long positions and negative values indicate aggregate net-short positions. "
            "Series histories can begin on different dates because reporting buckets have changed over time."
        ),
    }


def enrich_funding_pressure(block: dict, buybacks: dict) -> dict:
    anchor = _date(block.get("as_of"))
    if anchor is None:
        raise RuntimeError("Funding pressure block is missing as_of")

    horizons = block.get("horizons") or {}
    for key, horizon in horizons.items():
        end = _date(horizon.get("end_date"))
        if end is None:
            continue
        planned = sum(
            float(row.get("max_purchase_billions") or 0.0)
            for row in buybacks.get("upcoming") or []
            if _date(row.get("operation_date")) and anchor <= _date(row.get("operation_date")) <= end
        )
        horizon["planned_buyback_max_billions"] = planned

    timeline_map = {row["date"]: row for row in block.get("timeline") or [] if row.get("date")}
    for row in buybacks.get("upcoming") or []:
        day = _date(row.get("settlement_date")) or _date(row.get("operation_date"))
        if day is None or day < anchor or day > anchor + timedelta(days=365):
            continue
        key = day.isoformat()
        target = timeline_map.setdefault(
            key,
            {
                "date": key,
                "principal_billions": 0.0,
                "interest_billions": 0.0,
                "announced_issuance_billions": 0.0,
                "gross_scheduled_cash_billions": 0.0,
            },
        )
        target["planned_buyback_max_billions"] = float(target.get("planned_buyback_max_billions") or 0.0) + float(row.get("max_purchase_billions") or 0.0)

    for row in timeline_map.values():
        row.setdefault("planned_buyback_max_billions", 0.0)
    block["timeline"] = [timeline_map[day] for day in sorted(timeline_map)]
    block["buybacks"] = buybacks
    return block


def main() -> None:
    prior_data = json.loads(DATA_FILE.read_text(encoding="utf-8")) if DATA_FILE.exists() else {}
    previous_buybacks = ((prior_data.get("treasury_funding_pressure") or {}).get("buybacks"))
    previous_dealers = prior_data.get("primary_dealer_positioning")

    phase19.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    funding = data.get("treasury_funding_pressure") or {}
    anchor = _date(funding.get("as_of"))
    if anchor is None:
        raise RuntimeError("Cannot add buybacks without Treasury funding-pressure as_of")

    try:
        buybacks = fetch_buyback_schedule(anchor)
        data.setdefault("sources", {})["treasury_buybacks"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        if not previous_buybacks or not previous_buybacks.get("operations"):
            raise
        buybacks = previous_buybacks
        data.setdefault("sources", {})["treasury_buybacks"] = {
            "status": "error",
            "checked_at": base.now_iso(),
            "message": f"{type(exc).__name__}: {exc}; previous verified buyback schedule retained",
        }

    try:
        dealers = fetch_primary_dealer_positioning()
        data.setdefault("sources", {})["primary_dealer_positioning"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        if not previous_dealers or not previous_dealers.get("series"):
            raise
        dealers = previous_dealers
        data.setdefault("sources", {})["primary_dealer_positioning"] = {
            "status": "error",
            "checked_at": base.now_iso(),
            "message": f"{type(exc).__name__}: {exc}; previous verified dealer history retained",
        }

    data["treasury_funding_pressure"] = enrich_funding_pressure(funding, buybacks)
    data["primary_dealer_positioning"] = dealers
    data["generated_at"] = base.now_iso()
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    print(
        "Treasury buybacks:",
        buybacks.get("upcoming_operation_count"),
        "upcoming operations; max",
        buybacks.get("upcoming_max_billions"),
        "B",
    )
    total = next((row for row in dealers.get("series") or [] if row.get("keyid") == "PDPOSGST-TOT"), {})
    print(
        "Primary dealer positioning:",
        dealers.get("series_count"),
        "series; total Treasury",
        total.get("value_billions"),
        "B as of",
        total.get("as_of"),
        "; history",
        total.get("history_start"),
        "to",
        total.get("as_of"),
        "(", total.get("observation_count"), "obs)",
    )


if __name__ == "__main__":
    main()
