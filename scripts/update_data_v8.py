from __future__ import annotations

import json
import math
from statistics import median

import update_data_v7 as phase7

base = phase7.base
DATA_FILE = phase7.DATA_FILE


def _now_iso() -> str:
    return base.now_iso()


def _series_key(scope: str | None, name: str | None, period: str | None) -> str:
    return "|".join(str(x or "").strip() for x in (scope, name, period))


def _history_changes(history: list[dict], date_key: str, value_key: str) -> list[float]:
    clean = []
    for row in history:
        try:
            value = float(row.get(value_key))
        except (TypeError, ValueError):
            continue
        clean.append((str(row.get(date_key) or ""), value))
    clean.sort(key=lambda x: x[0])
    return [clean[i][1] - clean[i - 1][1] for i in range(1, len(clean))]


def _change_history_by_series(data: dict) -> dict[str, list[float]]:
    result: dict[str, list[float]] = {}

    for row in data.get("foreign_holders", {}).get("countries", []):
        result[_series_key("Foreign country", row.get("name"), "MoM")] = _history_changes(
            row.get("history", []), "period", "holdings_billions"
        )

    for block_key, row_key in (
        ("institutional_aggregates", "institutions"),
        ("extended_holders", "holders"),
    ):
        for row in data.get(block_key, {}).get(row_key, []):
            result[_series_key("U.S. sector", row.get("name"), "QoQ")] = _history_changes(
                row.get("history", []), "date", "value_billions"
            )

    for row in data.get("primary_dealers", {}).get("series", []):
        result[_series_key("Primary dealer", row.get("name"), "WoW")] = _history_changes(
            row.get("history", []), "date", "value_billions"
        )

    return result


def _percentile_abs(value: float | None, history: list[float]) -> float | None:
    if value is None or not history:
        return None
    target = abs(float(value))
    population = [abs(x) for x in history if x is not None and math.isfinite(x)]
    if not population:
        return None
    return 100.0 * sum(1 for x in population if x <= target) / len(population)


def _robust_z(value: float | None, history: list[float]) -> float | None:
    if value is None or len(history) < 3:
        return None
    population = [float(x) for x in history if x is not None and math.isfinite(x)]
    if len(population) < 3:
        return None
    med = median(population)
    mad = median([abs(x - med) for x in population])
    if not mad:
        return None
    return 0.6744897501960817 * (float(value) - med) / mad


def build_alert_intelligence(data: dict) -> dict:
    history_by_series = _change_history_by_series(data)
    lifecycle = data.get("alert_history", {}) or {}
    lifecycle_at = lifecycle.get("generated_at")
    current_transitions = [
        row for row in lifecycle.get("transitions", [])
        if row.get("at") == lifecycle_at
    ]
    transition_by_alert: dict[str, list[dict]] = {}
    for row in current_transitions:
        transition_by_alert.setdefault(str(row.get("alert_id") or ""), []).append(row)

    rows = []
    for alert in data.get("unusual_change_alerts", {}).get("alerts", []):
        series_key = _series_key(alert.get("scope"), alert.get("name"), alert.get("period"))
        changes = history_by_series.get(series_key, [])
        alert_id = str(alert.get("alert_id") or "")
        transitions = transition_by_alert.get(alert_id, [])
        row = dict(alert)
        row["abs_change_percentile"] = _percentile_abs(alert.get("change_billions"), changes)
        row["robust_z_score"] = _robust_z(alert.get("change_billions"), changes[:-1] if len(changes) > 1 else changes)
        row["history_change_count"] = len(changes)
        row["new_this_run"] = any(t.get("event") in {"opened", "reopened"} for t in transitions)
        row["severity_changed_this_run"] = any(t.get("event") == "severity_changed" for t in transitions)
        rows.append(row)

    rows.sort(
        key=lambda r: (
            0 if r.get("severity") == "high" else 1,
            -(abs(r.get("robust_z_score") or 0)),
            -(r.get("abs_change_percentile") or 0),
        )
    )

    notification_queue = []
    for transition in current_transitions:
        event = transition.get("event")
        severity = transition.get("severity")
        if event in {"opened", "reopened"} and severity == "high":
            notification_queue.append({**transition, "notification_reason": "new_high_severity_episode"})
        elif event == "severity_changed" and severity == "high":
            notification_queue.append({**transition, "notification_reason": "escalated_to_high_severity"})

    return {
        "generated_at": _now_iso(),
        "rows": rows,
        "alert_count": len(rows),
        "high_count": sum(1 for row in rows if row.get("severity") == "high"),
        "new_alert_count": sum(1 for row in rows if row.get("new_this_run")),
        "notification_ready_count": len(notification_queue),
        "notification_queue": notification_queue,
        "method": (
            "Phase 8 supplements the Phase 6 threshold screen with two diagnostics: the percentile rank of the latest absolute move within available historical changes, and a robust z-score based on the median and median absolute deviation. "
            "Notification readiness is restricted to newly opened/reopened high-severity episodes or alerts that escalate to high severity."
        ),
    }


def build_source_publication_history(data: dict) -> dict:
    now = _now_iso()
    previous = data.get("source_publications", {}) if isinstance(data.get("source_publications"), dict) else {}
    history = [dict(row) for row in previous.get("history", []) if isinstance(row, dict)]
    initialized = bool(history)
    known = {(str(row.get("source_key")), str(row.get("observation_date"))) for row in history}
    current_events = []

    for source in data.get("provenance", {}).get("sources", []):
        key = str(source.get("key") or "")
        obs = source.get("as_of")
        if not key or not obs:
            continue
        pair = (key, str(obs))
        if pair in known:
            continue
        event = {
            "source_key": key,
            "source_name": source.get("name"),
            "observation_date": str(obs),
            "frequency": source.get("frequency"),
            "detected_at": now,
            "status": source.get("status"),
            "event": "new_observation" if initialized else "baseline",
        }
        history.append(event)
        known.add(pair)
        if initialized:
            current_events.append(event)

    history.sort(key=lambda row: str(row.get("detected_at") or ""), reverse=True)
    history = history[:500]
    current_events.sort(key=lambda row: (str(row.get("source_name") or ""), str(row.get("observation_date") or "")))

    return {
        "generated_at": now,
        "current_release_count": len(current_events),
        "current_releases": current_events,
        "history": history,
        "history_count": len(history),
        "note": (
            "A release event is recorded when a tracked source exposes an observation date the tracker has not seen before. "
            "The first Phase 8 run establishes a baseline and does not treat existing observations as fresh releases."
        ),
    }


def enrich_cusip_concentration(data: dict) -> dict:
    block = data.get("security_intelligence", {}) or {}
    rows = block.get("rows", [])
    enriched = []

    for row in rows:
        pct = row.get("soma_pct_outstanding")
        par = row.get("soma_par_billions")
        implied_outstanding = None
        if pct not in (None, 0) and par is not None:
            try:
                implied_outstanding = float(par) / (float(pct) / 100.0)
            except (TypeError, ValueError, ZeroDivisionError):
                implied_outstanding = None

        try:
            p = float(pct) if pct is not None else None
        except (TypeError, ValueError):
            p = None
        if p is None:
            tier = "Unknown"
        elif p >= 50:
            tier = "Very high"
        elif p >= 25:
            tier = "High"
        elif p >= 10:
            tier = "Material"
        else:
            tier = "Lower"

        row["implied_outstanding_billions"] = implied_outstanding
        row["soma_concentration_tier"] = tier
        enriched.append(row)

    ranked = sorted(enriched, key=lambda r: r.get("soma_pct_outstanding") or -1, reverse=True)
    for index, row in enumerate(ranked, 1):
        row["soma_concentration_rank"] = index

    valid_pct = [float(r.get("soma_pct_outstanding")) for r in ranked if r.get("soma_pct_outstanding") is not None]
    return {
        "as_of": block.get("as_of"),
        "security_count": len(ranked),
        "very_high_count": sum(1 for r in ranked if r.get("soma_concentration_tier") == "Very high"),
        "high_or_above_count": sum(1 for r in ranked if r.get("soma_concentration_tier") in {"Very high", "High"}),
        "median_soma_pct_outstanding": median(valid_pct) if valid_pct else None,
        "top_securities": [
            {
                "cusip": r.get("cusip"),
                "security_type": r.get("security_type"),
                "maturity_date": r.get("maturity_date"),
                "soma_par_billions": r.get("soma_par_billions"),
                "soma_pct_outstanding": r.get("soma_pct_outstanding"),
                "implied_outstanding_billions": r.get("implied_outstanding_billions"),
                "soma_concentration_tier": r.get("soma_concentration_tier"),
                "soma_concentration_rank": r.get("soma_concentration_rank"),
                "years_to_maturity": r.get("years_to_maturity"),
            }
            for r in ranked[:30]
        ],
        "note": (
            "Implied outstanding amount is derived from SOMA par value divided by SOMA's reported percent outstanding for the same CUSIP. "
            "This is a concentration diagnostic, not a separate Treasury outstanding-security source."
        ),
    }


def main() -> None:
    phase7.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    data["alert_intelligence"] = build_alert_intelligence(data)
    data["source_publications"] = build_source_publication_history(data)
    data["cusip_concentration"] = enrich_cusip_concentration(data)
    data["generated_at"] = _now_iso()

    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Phase 8 updated {DATA_FILE}")
    print("Notification-ready alerts:", data["alert_intelligence"]["notification_ready_count"])
    print("New source observations:", data["source_publications"]["current_release_count"])
    print("CUSIP concentration rows:", data["cusip_concentration"]["security_count"])


if __name__ == "__main__":
    main()
