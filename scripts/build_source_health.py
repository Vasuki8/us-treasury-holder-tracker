from __future__ import annotations

import calendar
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "data" / "dashboard.json"
NPORT = ROOT / "data" / "nport_latest.json"
OUTPUT = ROOT / "data" / "source-health.json"

STATUS_ORDER = ("current", "expected_lag", "stale", "unavailable", "runner_limited")

CADENCE_RULES = {
    "business_daily": {"label": "Business daily", "expected_days": 4, "stale_days": 8},
    "daily": {"label": "Daily", "expected_days": 4, "stale_days": 8},
    "weekly": {"label": "Weekly", "expected_days": 10, "stale_days": 20},
    "monthly": {"label": "Monthly", "expected_days": 60, "stale_days": 90},
    "quarterly": {"label": "Quarterly", "expected_days": 120, "stale_days": 190},
    "auction": {"label": "Auction-by-auction", "expected_days": 10, "stale_days": 30},
}


def _parse_date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        if "T" in text:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
        if re.fullmatch(r"\d{4}-\d{2}", text):
            year, month = (int(part) for part in text.split("-"))
            return date(year, month, calendar.monthrange(year, month)[1])
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _generated_date(data: dict[str, Any]) -> date:
    parsed = _parse_date(data.get("generated_at"))
    return parsed or datetime.now(timezone.utc).date()


def _latest_date(rows: Any, *keys: str, not_after: date | None = None) -> str | None:
    values: list[date] = []
    if not isinstance(rows, list):
        return None
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in keys:
            parsed = _parse_date(row.get(key))
            if parsed and (not_after is None or parsed <= not_after):
                values.append(parsed)
                break
    return max(values).isoformat() if values else None


def _nested(data: dict[str, Any], *keys: str) -> Any:
    value: Any = data
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _first(*values: Any) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


def _classify(observation: Any, cadence: str, evaluated: date) -> tuple[str, int | None]:
    observed = _parse_date(observation)
    if observed is None:
        return "unavailable", None
    age = (evaluated - observed).days
    if age < 0:
        return "unavailable", age
    rule = CADENCE_RULES[cadence]
    if age <= rule["expected_days"]:
        return "current", age
    if age <= rule["stale_days"]:
        return "expected_lag", age
    return "stale", age


def _row(
    *,
    source_id: str,
    label: str,
    source_family: str,
    cadence: str,
    observation: Any,
    source_url: str,
    data_path: str,
    evaluated: date,
    note: str,
) -> dict[str, Any]:
    status, age_days = _classify(observation, cadence, evaluated)
    return {
        "id": source_id,
        "label": label,
        "source_family": source_family,
        "cadence": cadence,
        "cadence_label": CADENCE_RULES[cadence]["label"],
        "observation_date": str(observation).strip() if _parse_date(observation) else None,
        "age_days": age_days,
        "status": status,
        "source_url": source_url,
        "data_path": data_path,
        "note": note,
    }


def build_source_health(data: dict[str, Any]) -> dict[str, Any]:
    evaluated = _generated_date(data)
    funding = data.get("treasury_funding_pressure") or {}
    yield_block = data.get("treasury_yield_curve") or {}
    demand = data.get("auction_demand_monitor") or {}
    dealer = data.get("primary_dealer_positioning") or {}
    institutions = data.get("institution_holder_history") or {}

    demand_rows = _first(
        _nested(demand, "dynamic_history", "observations"),
        demand.get("history"),
        demand.get("recent"),
    ) or []
    institution_dates = [
        row.get("as_of")
        for row in (institutions.get("series") or [])
        if isinstance(row, dict) and row.get("as_of")
    ]
    institution_as_of = max((_parse_date(value) for value in institution_dates if _parse_date(value)), default=None)
    dealer_dates = [
        row.get("as_of")
        for row in (dealer.get("series") or [])
        if isinstance(row, dict) and row.get("as_of")
    ]
    dealer_as_of = max((_parse_date(value) for value in dealer_dates if _parse_date(value)), default=None)

    rows = [
        _row(
            source_id="debt_to_penny",
            label="Debt to the Penny",
            source_family="U.S. Treasury Fiscal Data",
            cadence="business_daily",
            observation=_nested(data, "overview", "as_of"),
            source_url="https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/debt-to-the-penny",
            data_path="overview.as_of",
            evaluated=evaluated,
            note="Headline public debt and debt-held-by-public observation date.",
        ),
        _row(
            source_id="fed_h41",
            label="Federal Reserve Treasury holdings",
            source_family="Federal Reserve H.4.1",
            cadence="weekly",
            observation=_nested(data, "fed", "as_of"),
            source_url="https://www.federalreserve.gov/releases/h41/",
            data_path="fed.as_of",
            evaluated=evaluated,
            note="Weekly Federal Reserve balance-sheet observation; a several-day publication gap is normal.",
        ),
        _row(
            source_id="tic_foreign",
            label="Foreign Treasury holders",
            source_family="Treasury International Capital",
            cadence="monthly",
            observation=_nested(data, "foreign_holders", "as_of"),
            source_url="https://home.treasury.gov/data/treasury-international-capital-tic-system",
            data_path="foreign_holders.as_of",
            evaluated=evaluated,
            note="Monthly TIC data publishes with an expected reporting lag; freshness is judged against monthly cadence.",
        ),
        _row(
            source_id="treasury_yield_curve",
            label="Treasury yield curve",
            source_family="U.S. Treasury",
            cadence="business_daily",
            observation=_latest_date(_nested(yield_block, "nominal", "history"), "date"),
            source_url="https://home.treasury.gov/resource-center/data-chart-center/interest-rates",
            data_path="treasury_yield_curve.nominal.history",
            evaluated=evaluated,
            note="Latest official nominal par-yield observation retained at its actual market date.",
        ),
        _row(
            source_id="mspd_maturities",
            label="Treasury maturity schedule",
            source_family="Monthly Statement of the Public Debt",
            cadence="monthly",
            observation=_first(
                funding.get("maturity_as_of"),
                funding.get("as_of"),
                _nested(data, "treasury_maturities", "as_of"),
            ),
            source_url="https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/",
            data_path="treasury_funding_pressure.maturity_as_of",
            evaluated=evaluated,
            note="Monthly MSPD snapshot used for outstanding principal, maturity wall and modeled interest cash flows.",
        ),
        _row(
            source_id="tga",
            label="Treasury General Account",
            source_family="Daily Treasury Statement",
            cadence="business_daily",
            observation=_nested(funding, "tga", "as_of"),
            source_url="https://fiscaldata.treasury.gov/datasets/daily-treasury-statement/operating-cash-balance",
            data_path="treasury_funding_pressure.tga.as_of",
            evaluated=evaluated,
            note="Business-daily cash-balance observation. Weekends and federal holidays can create short gaps.",
        ),
        _row(
            source_id="auction_results",
            label="Treasury auction results",
            source_family="U.S. Treasury Fiscal Data",
            cadence="auction",
            observation=_latest_date(demand_rows, "date", "auction_date", not_after=evaluated),
            source_url="https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/treasury-securities-auctions-data",
            data_path="auction_demand_monitor.dynamic_history.observations",
            evaluated=evaluated,
            note="Updates as auctions settle; there is no requirement for a new observation every calendar day.",
        ),
        _row(
            source_id="primary_dealers",
            label="Primary dealer Treasury positioning",
            source_family="Federal Reserve Bank of New York",
            cadence="weekly",
            observation=_first(
                dealer.get("as_of"),
                dealer_as_of.isoformat() if dealer_as_of else None,
            ),
            source_url="https://www.newyorkfed.org/markets/primarydealers",
            data_path="primary_dealer_positioning.as_of",
            evaluated=evaluated,
            note="Weekly aggregate primary-dealer net outright Treasury positions.",
        ),
        _row(
            source_id="financial_accounts",
            label="Institution holder history",
            source_family="Federal Reserve Financial Accounts",
            cadence="quarterly",
            observation=institution_as_of.isoformat() if institution_as_of else None,
            source_url="https://www.federalreserve.gov/releases/z1/",
            data_path="institution_holder_history.series[].as_of",
            evaluated=evaluated,
            note="Quarterly Financial Accounts series; older-looking dates can still be current for the official release cadence.",
        ),
    ]

    if NPORT.exists():
        try:
            nport = json.loads(NPORT.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            nport = {}
        nport_row = _row(
            source_id="sec_nport",
            label="Fund Treasury holdings (N-PORT)",
            source_family="U.S. Securities and Exchange Commission",
            cadence="quarterly",
            observation=nport.get("as_of"),
            source_url=str(nport.get("dataset_page") or "https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets"),
            data_path="data/nport_latest.json",
            evaluated=evaluated,
            note="Quarterly public N-PORT cache. Values are reported market values, not par values.",
        )
    else:
        nport_row = {
            "id": "sec_nport",
            "label": "Fund Treasury holdings (N-PORT)",
            "source_family": "U.S. Securities and Exchange Commission",
            "cadence": "quarterly",
            "cadence_label": "Quarterly",
            "observation_date": None,
            "age_days": None,
            "status": "runner_limited",
            "source_url": "https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets",
            "data_path": "data/nport_latest.json",
            "note": (
                "No cache is committed. SEC downloads can reject GitHub-hosted runner traffic; "
                "the tracker preserves last-good data and never substitutes or fabricates an observation."
            ),
        }
    rows.append(nport_row)

    counts = {status: sum(row["status"] == status for row in rows) for status in STATUS_ORDER}
    if counts["stale"] or counts["unavailable"]:
        overall = "attention"
    elif counts["runner_limited"] or counts["expected_lag"]:
        overall = "healthy_with_expected_lag"
    else:
        overall = "healthy"

    return {
        "schema_version": "1.0",
        "evaluated_at": data.get("generated_at") or datetime.now(timezone.utc).isoformat(),
        "evaluation_date": evaluated.isoformat(),
        "dashboard_generated_at": data.get("generated_at"),
        "overall_status": overall,
        "counts": counts,
        "sources": rows,
        "methodology": (
            "Freshness is cadence-aware. Observation dates are compared with source-specific release windows, "
            "not with a blanket today-minus-date rule. Collection time and observation time remain separate."
        ),
        "sec_runner_note": (
            "SEC N-PORT is intentionally marked runner-limited when no cache exists because SEC endpoints can block "
            "GitHub-hosted runner traffic. A failed collection must not erase last-good data or create a synthetic date."
        ),
    }


def main() -> None:
    data = json.loads(DASHBOARD.read_text(encoding="utf-8"))
    health = build_source_health(data)
    OUTPUT.write_text(json.dumps(health, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    counts = health["counts"]
    print(
        "Source health built: "
        f"{counts['current']} current, {counts['expected_lag']} expected lag, "
        f"{counts['stale']} stale, {counts['unavailable']} unavailable, "
        f"{counts['runner_limited']} runner-limited."
    )
    attention = [row["id"] for row in health["sources"] if row["status"] in {"stale", "unavailable", "runner_limited"}]
    if attention:
        print("Source health attention:", ", ".join(attention))


if __name__ == "__main__":
    main()
