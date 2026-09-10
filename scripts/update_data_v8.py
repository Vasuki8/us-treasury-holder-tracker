from __future__ import annotations

import hashlib
import json
import math
import statistics
from datetime import datetime, timezone

import update_data_v7 as phase7

base = phase7.base
DATA_FILE = phase7.DATA_FILE


def _now_iso() -> str:
    return base.now_iso()


def _safe_float(value) -> float | None:
    return base.to_float(value)


def _series_key(scope: str | None, name: str | None, period: str | None) -> str:
    return "|".join(str(x or "").strip() for x in (scope, name, period))


def _ordered_values(history: list[dict], date_key: str, value_key: str) -> list[float]:
    rows = []
    for row in history or []:
        date = row.get(date_key)
        value = _safe_float(row.get(value_key))
        if date and value is not None:
            rows.append((str(date), value))
    rows.sort(key=lambda item: item[0])
    return [value for _, value in rows]


def _history_for_alert(data: dict, alert: dict) -> list[float]:
    scope = alert.get("scope")
    name = alert.get("name")
    if scope == "Foreign country":
        for row in data.get("foreign_holders", {}).get("countries", []):
            if row.get("name") == name:
                return _ordered_values(row.get("history", []), "period", "holdings_billions")

    if scope == "U.S. sector":
        for block_key, row_key in (
            ("institutional_aggregates", "institutions"),
            ("extended_holders", "holders"),
            ("domestic_sectors", "holders"),
        ):
            for row in data.get(block_key, {}).get(row_key, []):
                if row.get("name") == name:
                    return _ordered_values(row.get("history", []), "date", "value_billions")

    if scope == "Primary dealer":
        for row in data.get("primary_dealers", {}).get("series", []):
            if row.get("name") == name:
                return _ordered_values(row.get("history", []), "date", "value_billions")
    return []


def _robust_diagnostics(values: list[float], current_change: float | None) -> dict:
    deltas = [b - a for a, b in zip(values, values[1:])]
    # The latest source-to-source move is the event being scored, so keep it
    # out of the baseline distribution to avoid grading an observation against itself.
    baseline = deltas[:-1] if len(deltas) >= 2 else []
    if current_change is None or not baseline:
        return {
            "history_change_count": len(baseline),
            "abs_change_percentile": None,
            "robust_z": None,
            "median_change_billions": None,
            "mad_change_billions": None,
        }

    median_change = statistics.median(baseline)
    abs_deviations = [abs(x - median_change) for x in baseline]
    mad = statistics.median(abs_deviations) if abs_deviations else 0.0
    robust_z = None
    if mad and math.isfinite(mad):
        robust_z = 0.67448975 * (current_change - median_change) / mad

    current_abs = abs(current_change)
    abs_deltas = [abs(x) for x in baseline]
    percentile = 100.0 * sum(x <= current_abs for x in abs_deltas) / len(abs_deltas)

    return {
        "history_change_count": len(baseline),
        "abs_change_percentile": percentile,
        "robust_z": robust_z,
        "median_change_billions": median_change,
        "mad_change_billions": mad,
    }


def build_alert_intelligence(data: dict) -> dict:
    alerts = data.get("unusual_change_alerts", {}).get("alerts", [])
    rows = []
    for alert in alerts:
        row = dict(alert)
        diagnostics = _robust_diagnostics(
            _history_for_alert(data, alert),
            _safe_float(alert.get("change_billions")),
        )
        row.update(diagnostics)

        percentile = diagnostics.get("abs_change_percentile")
        robust_z = diagnostics.get("robust_z")
        score_parts = []
        if percentile is not None:
            score_parts.append(min(100.0, percentile))
        if robust_z is not None:
            score_parts.append(min(100.0, abs(robust_z) * 20.0))
        row["diagnostic_score"] = sum(score_parts) / len(score_parts) if score_parts else None

        if (percentile or 0) >= 95 or abs(robust_z or 0) >= 4:
            row["diagnostic_label"] = "extreme"
        elif (percentile or 0) >= 85 or abs(robust_z or 0) >= 2.5:
            row["diagnostic_label"] = "elevated"
        else:
            row["diagnostic_label"] = "notable"

        rows.append(row)

    rows.sort(
        key=lambda row: (
            0 if row.get("severity") == "high" else 1,
            -(row.get("diagnostic_score") or 0),
            -abs(row.get("change_billions") or 0),
        )
    )
    return {
        "generated_at": _now_iso(),
        "row_count": len(rows),
        "extreme_count": sum(1 for r in rows if r.get("diagnostic_label") == "extreme"),
        "elevated_count": sum(1 for r in rows if r.get("diagnostic_label") == "elevated"),
        "rows": rows,
        "method": (
            "Phase 8 keeps the transparent Phase 6 threshold rule and adds two diagnostics: "
            "the percentile rank of the latest absolute change versus prior historical absolute changes, "
            "and a robust z-score based on the median and median absolute deviation (MAD). "
            "These diagnostics rank unusual moves; they do not forecast prices or infer causes."
        ),
    }


def _source_key_for_transition(data: dict, transition: dict) -> str | None:
    scope = transition.get("scope")
    name = transition.get("name")
    if scope == "Foreign country":
        return "foreign_holders"
    if scope == "Primary dealer":
        return "primary_dealers"
    if scope == "U.S. sector":
        for block_key, row_key in (
            ("institutional_aggregates", "institutions"),
            ("extended_holders", "holders"),
            ("domestic_sectors", "holders"),
        ):
            if any(row.get("name") == name for row in data.get(block_key, {}).get(row_key, [])):
                return block_key
    return None


def build_notification_readiness(data: dict) -> dict:
    now = _now_iso()
    previous = data.get("phase8_notifications", {})
    previous_watermark = previous.get("last_processed_transition_at")
    transitions = data.get("alert_history", {}).get("transitions", [])
    ordered = sorted(
        (t for t in transitions if isinstance(t, dict) and t.get("at")),
        key=lambda t: str(t.get("at")),
    )

    latest_transition_at = str(ordered[-1].get("at")) if ordered else previous_watermark
    initialized = bool(previous_watermark)
    new_transitions = (
        [t for t in ordered if str(t.get("at")) > str(previous_watermark)]
        if initialized
        else []
    )

    candidates = []
    for transition in new_transitions:
        event = transition.get("event")
        severity = transition.get("severity")
        if severity != "high" or event not in {"opened", "reopened", "severity_changed"}:
            continue
        if event == "severity_changed" and transition.get("previous_severity") == "high":
            continue

        source_key = _source_key_for_transition(data, transition)
        sources = data.get("provenance", {}).get("sources") or []
        provenance = next((row for row in sources if row.get("key") == source_key), {})
        source_health = (data.get("sources", {}).get(source_key, {}) or {})
        raw = "|".join(
            str(transition.get(k) or "")
            for k in ("alert_id", "event", "at", "severity")
        )
        candidates.append(
            {
                "notification_id": hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20],
                "event": event,
                "alert_id": transition.get("alert_id"),
                "scope": transition.get("scope"),
                "name": transition.get("name"),
                "period": transition.get("period"),
                "observation_date": transition.get("as_of"),
                "severity": severity,
                "triggered_at": transition.get("at"),
                "source_key": source_key,
                "source_name": provenance.get("name"),
                "source_frequency": provenance.get("frequency"),
                "source_status": source_health.get("status") or provenance.get("status"),
                "source_checked_at": source_health.get("checked_at") or provenance.get("checked_at"),
            }
        )

    high_active = [
        row for row in data.get("alert_history", {}).get("episodes", [])
        if row.get("state") == "active" and row.get("severity") == "high"
    ]
    return {
        "generated_at": now,
        "initialized": True,
        "baseline_initialized_at": previous.get("baseline_initialized_at") or now,
        "last_processed_transition_at": latest_transition_at,
        "new_high_count": len(candidates),
        "active_high_count": len(high_active),
        "queue": candidates[:100],
        "watching": [
            {
                "alert_id": row.get("alert_id"),
                "scope": row.get("scope"),
                "name": row.get("name"),
                "period": row.get("period"),
                "observation_date": row.get("as_of"),
                "first_seen_at": row.get("first_seen_at"),
            }
            for row in high_active[:50]
        ],
        "note": (
            "The queue contains only high-severity lifecycle transitions that occurred after Phase 8 established its watermark. "
            "Existing high alerts are watched but are not retroactively labeled new. This block is notification-ready output; "
            "delivery is intentionally separate from the data updater."
        ),
    }


def build_publication_history(data: dict) -> dict:
    now = _now_iso()
    previous = data.get("publication_history", {})
    latest_by_source = {
        row.get("key"): row.get("as_of")
        for row in previous.get("latest", [])
        if isinstance(row, dict) and row.get("key")
    }
    events = [
        dict(row)
        for row in previous.get("events", [])
        if isinstance(row, dict)
    ]

    current_sources = data.get("provenance", {}).get("sources", [])
    latest = []
    initialized = bool(previous.get("initialized"))

    for source in current_sources:
        key = source.get("key")
        if not key:
            continue
        as_of = source.get("as_of")
        prior_as_of = latest_by_source.get(key)

        if initialized and as_of and prior_as_of and str(as_of) != str(prior_as_of):
            events.append(
                {
                    "event": "new_observation",
                    "at": now,
                    "key": key,
                    "name": source.get("name"),
                    "previous_as_of": prior_as_of,
                    "as_of": as_of,
                    "frequency": source.get("frequency"),
                    "status": source.get("status"),
                }
            )
        elif initialized and as_of and not prior_as_of:
            events.append(
                {
                    "event": "source_became_observable",
                    "at": now,
                    "key": key,
                    "name": source.get("name"),
                    "previous_as_of": None,
                    "as_of": as_of,
                    "frequency": source.get("frequency"),
                    "status": source.get("status"),
                }
            )

        latest.append(
            {
                "key": key,
                "name": source.get("name"),
                "as_of": as_of,
                "frequency": source.get("frequency"),
                "status": source.get("status"),
                "checked_at": source.get("checked_at"),
            }
        )

    events = sorted(events, key=lambda row: str(row.get("at") or ""), reverse=True)[:1000]
    return {
        "generated_at": now,
        "initialized": True,
        "baseline_initialized_at": previous.get("baseline_initialized_at") or now,
        "source_count": len(latest),
        "event_count": len(events),
        "new_event_count": sum(1 for row in events if row.get("at") == now),
        "latest": latest,
        "events": events,
        "note": (
            "This ledger records source observation-date changes detected by the daily updater. "
            "The detection timestamp is not the publisher's exact release timestamp; it is when this tracker first observed the new official reporting period."
        ),
    }


def _concentration_band(pct: float | None) -> str:
    if pct is None:
        return "unknown"
    if pct >= 70:
        return "very high"
    if pct >= 50:
        return "high"
    if pct >= 30:
        return "elevated"
    return "normal"


def build_security_concentration(data: dict) -> dict:
    block = data.get("security_intelligence", {})
    rows = []
    valid_pct = [
        _safe_float(row.get("soma_pct_outstanding"))
        for row in block.get("rows", [])
    ]
    valid_pct = sorted(v for v in valid_pct if v is not None)

    for row in block.get("rows", []):
        pct = _safe_float(row.get("soma_pct_outstanding"))
        par = _safe_float(row.get("soma_par_billions"))
        implied_outstanding = None
        if pct and pct > 0 and par is not None:
            implied_outstanding = par / (pct / 100.0)

        percentile = None
        if pct is not None and valid_pct:
            percentile = 100.0 * sum(v <= pct for v in valid_pct) / len(valid_pct)

        row["implied_outstanding_billions"] = implied_outstanding
        row["soma_concentration_percentile"] = percentile
        row["soma_concentration_band"] = _concentration_band(pct)
        rows.append(
            {
                "cusip": row.get("cusip"),
                "security_type": row.get("security_type"),
                "maturity_date": row.get("maturity_date"),
                "soma_par_billions": par,
                "soma_pct_outstanding": pct,
                "implied_outstanding_billions": implied_outstanding,
                "concentration_percentile": percentile,
                "concentration_band": row.get("soma_concentration_band"),
                "original_issue_date": row.get("original_issue_date"),
                "original_security_term": row.get("original_security_term"),
                "latest_auction_date": row.get("latest_auction_date"),
            }
        )

    ranked = sorted(rows, key=lambda row: row.get("soma_pct_outstanding") or -1, reverse=True)
    weighted_numerator = sum(
        (row.get("soma_par_billions") or 0) * (row.get("soma_pct_outstanding") or 0)
        for row in rows
        if row.get("soma_par_billions") is not None and row.get("soma_pct_outstanding") is not None
    )
    weighted_denominator = sum(
        row.get("soma_par_billions") or 0
        for row in rows
        if row.get("soma_pct_outstanding") is not None
    )
    return {
        "as_of": block.get("as_of"),
        "security_count": len(rows),
        "coverage_count": len(valid_pct),
        "weighted_average_soma_pct_outstanding": (
            weighted_numerator / weighted_denominator if weighted_denominator else None
        ),
        "at_or_above_30pct": sum(1 for row in rows if (row.get("soma_pct_outstanding") or 0) >= 30),
        "at_or_above_50pct": sum(1 for row in rows if (row.get("soma_pct_outstanding") or 0) >= 50),
        "at_or_above_70pct": sum(1 for row in rows if (row.get("soma_pct_outstanding") or 0) >= 70),
        "top_concentrations": ranked[:50],
        "source_url": (data.get("soma", {}) or {}).get("source_url"),
        "note": (
            "SOMA percent-outstanding comes from the New York Fed holding data already used by the tracker. "
            "Implied outstanding amount is derived as SOMA par divided by SOMA percent outstanding and is shown only where both inputs are available. "
            "Percentile ranks compare the stored SOMA CUSIP universe, not every outstanding Treasury security."
        ),
    }


def main() -> None:
    phase7.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    data["alert_intelligence"] = build_alert_intelligence(data)
    data["phase8_notifications"] = build_notification_readiness(data)
    data["publication_history"] = build_publication_history(data)
    data["security_concentration"] = build_security_concentration(data)
    data["generated_at"] = _now_iso()

    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Phase 8 updated {DATA_FILE}")
    print(
        "Alert intelligence:",
        data["alert_intelligence"].get("extreme_count"),
        "extreme /",
        data["alert_intelligence"].get("elevated_count"),
        "elevated",
    )
    print("New high-severity notification candidates:", data["phase8_notifications"].get("new_high_count"))
    print("New source-observation events:", data["publication_history"].get("new_event_count"))
    print(
        "SOMA concentration coverage:",
        data["security_concentration"].get("coverage_count"),
        "/",
        data["security_concentration"].get("security_count"),
    )


if __name__ == "__main__":
    main()
