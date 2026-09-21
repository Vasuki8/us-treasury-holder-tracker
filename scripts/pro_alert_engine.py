from __future__ import annotations

import math
from typing import Any

ENGINE_VERSION = "1.0"

EXPECTED_METRIC_IDS = (
    "yield_10y_pct",
    "spread_10y2y_bps",
    "spread_10y3m_bps",
    "yield_10y_5session_change_bps",
    "auction_demand_score",
    "principal_30d_billions",
    "principal_90d_billions",
    "foreign_total_1m_change_billions",
    "dealer_total_1w_change_billions",
    "tga_30d_change_billions",
)


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _date_value(row: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = row.get(key)
        if value:
            return str(value)
    return None


def _sorted_rows(rows: Any, *date_keys: str) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    valid = [row for row in rows if isinstance(row, dict)]
    return sorted(valid, key=lambda row: _date_value(row, *date_keys) or "")


def _latest_with_number(
    rows: Any,
    value_key: str,
    *date_keys: str,
) -> tuple[dict[str, Any] | None, float | None]:
    for row in reversed(_sorted_rows(rows, *date_keys)):
        value = _number(row.get(value_key))
        if value is not None:
            return row, value
    return None, None


def _metric(
    metric_id: str,
    label: str,
    value: float | None,
    unit: str,
    digits: int,
    observation_date: str | None,
    source_path: str,
    default_condition: str,
    default_threshold: float,
) -> dict[str, Any]:
    return {
        "id": metric_id,
        "label": label,
        "value": value,
        "unit": unit,
        "digits": digits,
        "observation_date": observation_date,
        "source_path": source_path,
        "default_condition": default_condition,
        "default_threshold": default_threshold,
    }


def metric_snapshots(data: dict[str, Any]) -> list[dict[str, Any]]:
    yield_block = data.get("treasury_yield_curve") or {}
    nominal_rows = _sorted_rows((yield_block.get("nominal") or {}).get("history"), "date")
    spread_rows = _sorted_rows((yield_block.get("spreads") or {}).get("history"), "date")

    nominal_row, yield_10y = _latest_with_number(nominal_rows, "10y", "date")
    spread_2y_row, spread_10y2y = _latest_with_number(spread_rows, "10y_2y_bps", "date")
    spread_3m_row, spread_10y3m = _latest_with_number(spread_rows, "10y_3m_bps", "date")

    valid_10y_rows = [
        (row, _number(row.get("10y")))
        for row in nominal_rows
        if _number(row.get("10y")) is not None
    ]
    yield_10y_5session_change = None
    yield_10y_5session_date = None
    if len(valid_10y_rows) >= 6:
        latest_row, latest_value = valid_10y_rows[-1]
        _, prior_value = valid_10y_rows[-6]
        if latest_value is not None and prior_value is not None:
            yield_10y_5session_change = (latest_value - prior_value) * 100
            yield_10y_5session_date = _date_value(latest_row, "date")

    demand_block = data.get("auction_demand_monitor") or {}
    demand_rows = (
        (demand_block.get("dynamic_history") or {}).get("observations")
        or demand_block.get("history")
        or demand_block.get("recent")
        or []
    )
    demand_row, demand_score = _latest_with_number(
        demand_rows,
        "demand_score",
        "date",
        "auction_date",
    )

    funding = data.get("treasury_funding_pressure") or {}
    horizons = funding.get("horizons") or {}
    principal_30d = _number((horizons.get("30D") or {}).get("principal_billions"))
    principal_90d = _number((horizons.get("90D") or {}).get("principal_billions"))
    maturity_as_of = str(funding.get("maturity_as_of") or funding.get("as_of") or "") or None

    foreign = data.get("foreign_holders") or {}
    foreign_history = [
        row
        for row in _sorted_rows(foreign.get("grand_total_history"), "period")
        if _number(row.get("holdings_billions")) is not None
    ]
    foreign_change = None
    foreign_date = None
    if len(foreign_history) >= 2:
        latest_foreign = foreign_history[-1]
        previous_foreign = foreign_history[-2]
        latest_value = _number(latest_foreign.get("holdings_billions"))
        previous_value = _number(previous_foreign.get("holdings_billions"))
        if latest_value is not None and previous_value is not None:
            foreign_change = latest_value - previous_value
            foreign_date = _date_value(latest_foreign, "period")

    dealer = data.get("primary_dealer_positioning") or {}
    dealer_series = dealer.get("series") or []
    dealer_total = next(
        (
            row
            for row in dealer_series
            if isinstance(row, dict) and row.get("keyid") == "PDPOSGST-TOT"
        ),
        {},
    )
    dealer_change = _number(dealer_total.get("weekly_change_billions"))
    dealer_date = str(dealer_total.get("as_of") or dealer.get("as_of") or "") or None
    if dealer_change is None:
        dealer_history = [
            row
            for row in _sorted_rows(dealer_total.get("history"), "date")
            if _number(row.get("value_billions")) is not None
        ]
        if len(dealer_history) >= 2:
            latest_value = _number(dealer_history[-1].get("value_billions"))
            previous_value = _number(dealer_history[-2].get("value_billions"))
            if latest_value is not None and previous_value is not None:
                dealer_change = latest_value - previous_value
                dealer_date = _date_value(dealer_history[-1], "date")

    tga = funding.get("tga") or {}
    tga_change = _number(tga.get("change_30d_billions"))
    tga_date = str(tga.get("as_of") or "") or None

    metrics = [
        _metric(
            "yield_10y_pct",
            "10Y Treasury yield",
            yield_10y,
            "pct",
            2,
            _date_value(nominal_row or {}, "date"),
            "treasury_yield_curve.nominal.history",
            "above",
            5.0,
        ),
        _metric(
            "spread_10y2y_bps",
            "10Y - 2Y spread",
            spread_10y2y,
            "bps",
            0,
            _date_value(spread_2y_row or {}, "date"),
            "treasury_yield_curve.spreads.history",
            "below",
            0.0,
        ),
        _metric(
            "spread_10y3m_bps",
            "10Y - 3M spread",
            spread_10y3m,
            "bps",
            0,
            _date_value(spread_3m_row or {}, "date"),
            "treasury_yield_curve.spreads.history",
            "below",
            0.0,
        ),
        _metric(
            "yield_10y_5session_change_bps",
            "10Y yield 5-session move",
            yield_10y_5session_change,
            "bps",
            0,
            yield_10y_5session_date,
            "treasury_yield_curve.nominal.history",
            "above",
            25.0,
        ),
        _metric(
            "auction_demand_score",
            "Latest auction demand score",
            demand_score,
            "score",
            0,
            _date_value(demand_row or {}, "date", "auction_date"),
            "auction_demand_monitor.dynamic_history",
            "below",
            35.0,
        ),
        _metric(
            "principal_30d_billions",
            "30D principal due",
            principal_30d,
            "usd_billions",
            0,
            maturity_as_of,
            "treasury_funding_pressure.horizons.30D",
            "above",
            2000.0,
        ),
        _metric(
            "principal_90d_billions",
            "90D principal due",
            principal_90d,
            "usd_billions",
            0,
            maturity_as_of,
            "treasury_funding_pressure.horizons.90D",
            "above",
            4500.0,
        ),
        _metric(
            "foreign_total_1m_change_billions",
            "Foreign Treasury holdings 1M change",
            foreign_change,
            "usd_billions",
            1,
            foreign_date,
            "foreign_holders.grand_total_history",
            "below",
            -100.0,
        ),
        _metric(
            "dealer_total_1w_change_billions",
            "Primary dealer Treasury position 1W change",
            dealer_change,
            "usd_billions",
            1,
            dealer_date,
            "primary_dealer_positioning.PDPOSGST-TOT",
            "below",
            -50.0,
        ),
        _metric(
            "tga_30d_change_billions",
            "Treasury General Account 30D change",
            tga_change,
            "usd_billions",
            1,
            tga_date,
            "treasury_funding_pressure.tga",
            "below",
            -100.0,
        ),
    ]

    assert tuple(metric["id"] for metric in metrics) == EXPECTED_METRIC_IDS
    return metrics


def evaluate_rule(rule: dict[str, Any], metric_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    metric_id = str(rule.get("metric_id") or "")
    metric = metric_map.get(metric_id)
    condition = str(rule.get("condition") or "")
    threshold = _number(rule.get("threshold"))

    base = {
        "id": str(rule.get("id") or ""),
        "label": str(rule.get("label") or ""),
        "metric_id": metric_id,
        "condition": condition,
        "threshold": threshold,
    }

    if metric is None or threshold is None or condition not in {"above", "below"}:
        return {
            **base,
            "status": "unavailable",
            "triggered": None,
            "current_value": None,
            "unit": metric.get("unit") if metric else None,
            "observation_date": metric.get("observation_date") if metric else None,
            "reason": "Rule or metric is unavailable.",
        }

    current_value = _number(metric.get("value"))
    if current_value is None:
        return {
            **base,
            "status": "unavailable",
            "triggered": None,
            "current_value": None,
            "unit": metric.get("unit"),
            "observation_date": metric.get("observation_date"),
            "reason": "The latest official observation is unavailable.",
        }

    triggered = current_value > threshold if condition == "above" else current_value < threshold
    operator_text = ">" if condition == "above" else "<"
    return {
        **base,
        "status": "triggered" if triggered else "quiet",
        "triggered": triggered,
        "current_value": current_value,
        "unit": metric.get("unit"),
        "observation_date": metric.get("observation_date"),
        "reason": f"{current_value:g} {operator_text} {threshold:g} is {'true' if triggered else 'false'}.",
    }


def default_rules() -> list[dict[str, Any]]:
    return [
        {
            "id": "curve-inversion-10y2y",
            "label": "10Y - 2Y below zero",
            "metric_id": "spread_10y2y_bps",
            "condition": "below",
            "threshold": 0.0,
        },
        {
            "id": "long-end-five-session-jump",
            "label": "10Y yield rises more than 25 bps in 5 sessions",
            "metric_id": "yield_10y_5session_change_bps",
            "condition": "above",
            "threshold": 25.0,
        },
        {
            "id": "soft-auction-demand",
            "label": "Auction demand score below 35",
            "metric_id": "auction_demand_score",
            "condition": "below",
            "threshold": 35.0,
        },
        {
            "id": "large-90d-principal-wall",
            "label": "90D principal due above $4.5T",
            "metric_id": "principal_90d_billions",
            "condition": "above",
            "threshold": 4500.0,
        },
        {
            "id": "foreign-monthly-decline",
            "label": "Foreign holdings fall more than $100B in a month",
            "metric_id": "foreign_total_1m_change_billions",
            "condition": "below",
            "threshold": -100.0,
        },
        {
            "id": "dealer-weekly-reduction",
            "label": "Dealer Treasury position falls more than $50B in a week",
            "metric_id": "dealer_total_1w_change_billions",
            "condition": "below",
            "threshold": -50.0,
        },
    ]


def build_preview(data: dict[str, Any]) -> dict[str, Any]:
    metrics = metric_snapshots(data)
    metric_map = {metric["id"]: metric for metric in metrics}
    rules = [evaluate_rule(rule, metric_map) for rule in default_rules()]
    return {
        "engine_version": ENGINE_VERSION,
        "generated_at": data.get("generated_at"),
        "source_generated_at": data.get("generated_at"),
        "metric_count": len(metrics),
        "rule_count": len(rules),
        "metrics": metrics,
        "sample_rules": rules,
        "stateful_delivery_required": True,
        "note": (
            "Public preview of the Treasury Pro alert engine. Sample thresholds are illustrative "
            "workflow examples, not investment recommendations. Real paid alerts require authenticated "
            "rule storage, prior-state tracking, cooldowns and notification delivery."
        ),
    }
