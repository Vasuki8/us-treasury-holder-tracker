from __future__ import annotations

import math
from typing import Any

from pro_alert_engine import build_preview, metric_snapshots

BRIEF_VERSION = "1.0"
SECTION_IDS = (
    "curve",
    "funding",
    "auctions",
    "ownership_positioning",
    "freshness",
)


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _format(value: float | None, unit: str, digits: int = 0) -> str:
    if value is None:
        return "—"
    if unit == "pct":
        return f"{value:.{digits}f}%"
    if unit == "bps":
        sign = "+" if value > 0 else "−" if value < 0 else ""
        return f"{sign}{abs(value):.{digits}f} bps"
    if unit == "usd_billions":
        sign = "−" if value < 0 else ""
        absolute = abs(value)
        if absolute >= 1000:
            return f"{sign}${absolute / 1000:.2f}T"
        return f"{sign}${absolute:,.{digits}f}B"
    if unit == "score":
        return f"{value:.{digits}f}/100"
    return f"{value:.{digits}f}"


def _metric_map(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {row["id"]: row for row in metric_snapshots(data)}


def _item(
    metrics: dict[str, dict[str, Any]],
    metric_id: str,
    context: str,
) -> dict[str, Any]:
    metric = metrics[metric_id]
    value = _number(metric.get("value"))
    return {
        "metric_id": metric_id,
        "label": metric["label"],
        "value": value,
        "display": _format(value, metric["unit"], int(metric.get("digits") or 0)),
        "unit": metric["unit"],
        "observation_date": metric.get("observation_date"),
        "source_path": metric.get("source_path"),
        "context": context,
    }


def _section(
    section_id: str,
    title: str,
    description: str,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    dates = sorted(
        {
            str(item["observation_date"])
            for item in items
            if item.get("observation_date")
        }
    )
    return {
        "id": section_id,
        "title": title,
        "description": description,
        "latest_observation": dates[-1] if dates else None,
        "items": items,
    }


def _summary(metrics: dict[str, dict[str, Any]]) -> list[str]:
    rows: list[str] = []

    y10 = _number(metrics["yield_10y_pct"].get("value"))
    s2 = _number(metrics["spread_10y2y_bps"].get("value"))
    s3 = _number(metrics["spread_10y3m_bps"].get("value"))
    if y10 is not None:
        sentence = f"10Y Treasury par yield is {_format(y10, 'pct', 2)}"
        parts = []
        if s2 is not None:
            parts.append(f"10Y−2Y is {_format(s2, 'bps', 0)}")
        if s3 is not None:
            parts.append(f"10Y−3M is {_format(s3, 'bps', 0)}")
        if parts:
            sentence += "; " + " and ".join(parts)
        rows.append(sentence + ".")

    p30 = _number(metrics["principal_30d_billions"].get("value"))
    p90 = _number(metrics["principal_90d_billions"].get("value"))
    if p30 is not None or p90 is not None:
        parts = []
        if p30 is not None:
            parts.append(f"{_format(p30, 'usd_billions', 0)} over 30 days")
        if p90 is not None:
            parts.append(f"{_format(p90, 'usd_billions', 0)} over 90 days")
        rows.append("Scheduled marketable principal due is " + " and ".join(parts) + ".")

    demand = _number(metrics["auction_demand_score"].get("value"))
    if demand is not None:
        rows.append(
            "Latest Treasury auction-demand diagnostic is "
            f"{_format(demand, 'score', 0)}; this score is a tracker diagnostic, not an official Treasury metric."
        )

    foreign = _number(metrics["foreign_total_1m_change_billions"].get("value"))
    dealer = _number(metrics["dealer_total_1w_change_billions"].get("value"))
    if foreign is not None or dealer is not None:
        parts = []
        if foreign is not None:
            parts.append(
                f"latest monthly foreign Treasury holdings change is {_format(foreign, 'usd_billions', 1)}"
            )
        if dealer is not None:
            parts.append(
                f"latest weekly primary-dealer Treasury position change is {_format(dealer, 'usd_billions', 1)}"
            )
        sentence = "; ".join(parts)\n        rows.append(sentence[:1].upper() + sentence[1:] + ".")

    return rows


def build_brief(data: dict[str, Any]) -> dict[str, Any]:
    metrics = _metric_map(data)
    alert_preview = build_preview(data)

    curve_items = [
        _item(metrics, "yield_10y_pct", "Latest official 10Y Treasury par yield."),
        _item(metrics, "spread_10y2y_bps", "10Y par yield minus 2Y par yield."),
        _item(metrics, "spread_10y3m_bps", "10Y par yield minus 3M par yield."),
        _item(
            metrics,
            "yield_10y_5session_change_bps",
            "Change in the 10Y par yield versus five Treasury business-session observations earlier.",
        ),
    ]
    funding_items = [
        _item(metrics, "principal_30d_billions", "Gross scheduled marketable principal due over 30 days."),
        _item(metrics, "principal_90d_billions", "Gross scheduled marketable principal due over 90 days."),
        _item(metrics, "tga_30d_change_billions", "Approximate 30-day change in the Treasury General Account balance."),
    ]
    auction_items = [
        _item(
            metrics,
            "auction_demand_score",
            "Tracker diagnostic combining bid-to-cover, indirect participation and inverse dealer takedown.",
        ),
    ]
    ownership_items = [
        _item(
            metrics,
            "foreign_total_1m_change_billions",
            "Change in total reported foreign Treasury holdings from the prior monthly TIC observation.",
        ),
        _item(
            metrics,
            "dealer_total_1w_change_billions",
            "Weekly change in aggregate primary-dealer net outright Treasury positioning.",
        ),
    ]

    available_metrics = [
        row for row in metrics.values() if _number(row.get("value")) is not None
    ]
    freshness_items = [
        {
            "metric_id": row["id"],
            "label": row["label"],
            "value": row.get("observation_date"),
            "display": row.get("observation_date") or "—",
            "unit": "date",
            "observation_date": row.get("observation_date"),
            "source_path": row.get("source_path"),
            "context": "Most recent official/source observation used by this brief metric.",
        }
        for row in available_metrics
    ]

    sections = [
        _section(
            "curve",
            "Curve & rates",
            "Latest Treasury par yields and selected curve relationships.",
            curve_items,
        ),
        _section(
            "funding",
            "Maturities & cash",
            "Gross scheduled principal windows and TGA movement; not a forecast of net borrowing need.",
            funding_items,
        ),
        _section(
            "auctions",
            "Auction demand",
            "Latest auction-demand diagnostic from the tracker’s term-relative scoring model.",
            auction_items,
        ),
        _section(
            "ownership_positioning",
            "Ownership & positioning",
            "Latest reported changes in foreign Treasury holdings and primary-dealer positioning.",
            ownership_items,
        ),
        _section(
            "freshness",
            "Data freshness",
            "Observation dates remain source-specific because Treasury and Fed datasets publish on different cadences.",
            freshness_items,
        ),
    ]
    assert tuple(section["id"] for section in sections) == SECTION_IDS

    rules = alert_preview.get("sample_rules") or []
    status_counts = {
        "triggered": sum(row.get("status") == "triggered" for row in rules),
        "quiet": sum(row.get("status") == "quiet" for row in rules),
        "unavailable": sum(row.get("status") == "unavailable" for row in rules),
    }

    return {
        "brief_version": BRIEF_VERSION,
        "generated_at": data.get("generated_at"),
        "source_generated_at": data.get("generated_at"),
        "title": "Daily Treasury Brief",
        "cadence": "daily-preview",
        "summary": _summary(metrics),
        "sections": sections,
        "monitoring_summary": {
            "sample_rule_count": len(rules),
            **status_counts,
        },
        "delivery_required": True,
        "note": (
            "Public preview of a Treasury Pro scheduled brief. It summarizes source-dated data and "
            "illustrative monitoring conditions; it is not personalized investment advice. Paid delivery "
            "requires authenticated scheduling and a private delivery service."
        ),
    }
