from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "data" / "dashboard.json"
METRIC_CATALOG = ROOT / "alerts" / "metrics.json"
RULE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
LEVEL_OPERATORS = {"above", "below"}
CROSSING_OPERATORS = {"crosses_above", "crosses_below"}
ALL_OPERATORS = LEVEL_OPERATORS | CROSSING_OPERATORS


@dataclass(frozen=True)
class Observation:
    value: float | None
    date: str | None


@dataclass(frozen=True)
class MetricSnapshot:
    key: str
    label: str
    unit: str
    current: Observation
    previous: Observation
    history: bool


class AlertRuleError(ValueError):
    pass


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _date(row: dict[str, Any] | None, *keys: str) -> str | None:
    if not row:
        return None
    for key in keys:
        value = row.get(key)
        if value:
            return str(value)[:10]
    return None


def _history_pair(rows: list[dict[str, Any]], value_key: str, date_keys: tuple[str, ...] = ("date",)) -> tuple[Observation, Observation]:
    valid: list[Observation] = []
    for row in rows or []:
        value = _finite(row.get(value_key))
        date = _date(row, *date_keys)
        if value is None or not date:
            continue
        valid.append(Observation(value=value, date=date))
    valid.sort(key=lambda item: item.date or "")
    current = valid[-1] if valid else Observation(None, None)
    previous = valid[-2] if len(valid) >= 2 else Observation(None, None)
    return current, previous


def _yield_10y(data: dict[str, Any]) -> tuple[Observation, Observation]:
    rows = data.get("treasury_yield_curve", {}).get("nominal", {}).get("history", [])
    return _history_pair(rows, "10y")


def _spread(data: dict[str, Any], key: str) -> tuple[Observation, Observation]:
    rows = data.get("treasury_yield_curve", {}).get("spreads", {}).get("history", [])
    return _history_pair(rows, key)


def _auction_demand(data: dict[str, Any]) -> tuple[Observation, Observation]:
    block = data.get("auction_demand_monitor", {})
    rows = block.get("history") or block.get("dynamic_history", {}).get("observations") or block.get("recent") or []
    return _history_pair(rows, "demand_score", ("auction_date", "date"))


def _funding_horizon(data: dict[str, Any], horizon: str, field: str) -> tuple[Observation, Observation]:
    block = data.get("treasury_funding_pressure", {})
    row = block.get("horizons", {}).get(horizon, {})
    return Observation(_finite(row.get(field)), _date(block, "as_of")), Observation(None, None)


def _tga(data: dict[str, Any]) -> tuple[Observation, Observation]:
    block = data.get("treasury_funding_pressure", {})
    tga = block.get("tga", {})
    history = tga.get("history") or []
    current, previous = _history_pair(history, "balance_billions")
    if current.value is not None:
        return current, previous
    return Observation(_finite(tga.get("current_billions")), _date(tga, "as_of")), Observation(None, None)


EXTRACTORS: dict[str, Callable[[dict[str, Any]], tuple[Observation, Observation]]] = {
    "yield.10y_pct": _yield_10y,
    "yield.spread_10y_2y_bps": lambda data: _spread(data, "10y_2y_bps"),
    "yield.spread_10y_3m_bps": lambda data: _spread(data, "10y_3m_bps"),
    "auction.demand_score": _auction_demand,
    "funding.principal_30d_billions": lambda data: _funding_horizon(data, "30D", "principal_billions"),
    "funding.gross_cash_90d_billions": lambda data: _funding_horizon(data, "90D", "gross_scheduled_cash_billions"),
    "funding.tga_billions": _tga,
}


def load_catalog(path: Path = METRIC_CATALOG) -> dict[str, dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("metrics", [])
    catalog = {str(row["key"]): row for row in rows}
    if set(catalog) != set(EXTRACTORS):
        raise AlertRuleError(f"metric catalog and extractor registry differ: catalog={sorted(catalog)}, extractors={sorted(EXTRACTORS)}")
    return catalog


def validate_rule(rule: dict[str, Any], catalog: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    catalog = catalog or load_catalog()
    if not isinstance(rule, dict):
        raise AlertRuleError("rule must be an object")

    rule_id = str(rule.get("id") or "")
    if not RULE_ID_RE.fullmatch(rule_id):
        raise AlertRuleError("rule.id must be 1-80 characters using letters, numbers, '.', '_' or '-'")

    metric = str(rule.get("metric") or "")
    if metric not in catalog:
        raise AlertRuleError(f"unsupported metric: {metric}")

    operator = str(rule.get("operator") or "")
    if operator not in ALL_OPERATORS:
        raise AlertRuleError(f"unsupported operator: {operator}")
    if operator not in set(catalog[metric].get("operators") or []):
        raise AlertRuleError(f"operator {operator} is not supported for metric {metric}")

    threshold = _finite(rule.get("threshold"))
    if threshold is None:
        raise AlertRuleError("rule.threshold must be a finite number")

    return {
        "id": rule_id,
        "name": str(rule.get("name") or rule_id)[:140],
        "metric": metric,
        "operator": operator,
        "threshold": threshold,
        "enabled": bool(rule.get("enabled", True)),
        "notify_on_initial": bool(rule.get("notify_on_initial", False)),
    }


def metric_snapshot(data: dict[str, Any], metric: str, catalog: dict[str, dict[str, Any]] | None = None) -> MetricSnapshot:
    catalog = catalog or load_catalog()
    if metric not in EXTRACTORS or metric not in catalog:
        raise AlertRuleError(f"unsupported metric: {metric}")
    current, previous = EXTRACTORS[metric](data)
    meta = catalog[metric]
    return MetricSnapshot(
        key=metric,
        label=str(meta.get("label") or metric),
        unit=str(meta.get("unit") or ""),
        current=current,
        previous=previous,
        history=bool(meta.get("history")),
    )


def _matched(operator: str, value: float, threshold: float) -> bool:
    if operator in {"above", "crosses_above"}:
        return value > threshold
    if operator in {"below", "crosses_below"}:
        return value < threshold
    raise AlertRuleError(f"unsupported operator: {operator}")


def _crossed(operator: str, previous: float | None, current: float | None, threshold: float) -> bool:
    if previous is None or current is None:
        return False
    if operator == "crosses_above":
        return previous <= threshold < current
    if operator == "crosses_below":
        return previous >= threshold > current
    raise AlertRuleError(f"unsupported crossing operator: {operator}")


def _event_key(rule: dict[str, Any], snapshot: MetricSnapshot, event_type: str) -> str:
    material = "|".join(
        [
            rule["id"],
            rule["metric"],
            rule["operator"],
            f"{rule['threshold']:.12g}",
            snapshot.current.date or "unknown-date",
            event_type,
        ]
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:24]


def evaluate_rule(
    data: dict[str, Any],
    raw_rule: dict[str, Any],
    prior_state: dict[str, Any] | None = None,
    catalog: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    catalog = catalog or load_catalog()
    rule = validate_rule(raw_rule, catalog)
    snapshot = metric_snapshot(data, rule["metric"], catalog)
    current = snapshot.current.value
    previous = snapshot.previous.value
    prior_state = prior_state or {}

    if not rule["enabled"]:
        return {
            "rule": rule,
            "metric": asdict(snapshot),
            "matched": False,
            "event_detected": False,
            "should_notify": False,
            "event_key": None,
            "reason": "rule disabled",
            "next_state": {"matched": False, "last_notified_event_key": prior_state.get("last_notified_event_key")},
        }

    if current is None:
        return {
            "rule": rule,
            "metric": asdict(snapshot),
            "matched": False,
            "event_detected": False,
            "should_notify": False,
            "event_key": None,
            "reason": "current metric value unavailable",
            "next_state": {"matched": bool(prior_state.get("matched", False)), "last_notified_event_key": prior_state.get("last_notified_event_key")},
        }

    matched = _matched(rule["operator"], current, rule["threshold"])
    event_detected = False
    event_type = ""

    if rule["operator"] in CROSSING_OPERATORS:
        event_detected = _crossed(rule["operator"], previous, current, rule["threshold"])
        event_type = "crossing"
    else:
        had_prior = "matched" in prior_state
        prior_matched = bool(prior_state.get("matched", False))
        entered = matched and had_prior and not prior_matched
        initial = matched and not had_prior and rule["notify_on_initial"]
        event_detected = entered or initial
        event_type = "entered" if entered else "initial-match" if initial else ""

    event_key = _event_key(rule, snapshot, event_type) if event_detected else None
    already_notified = bool(event_key and event_key == prior_state.get("last_notified_event_key"))
    should_notify = bool(event_detected and not already_notified)

    if rule["operator"] in CROSSING_OPERATORS and previous is None:
        reason = "crossing requires a previous historical observation"
    elif should_notify:
        reason = f"{event_type} event detected"
    elif event_detected and already_notified:
        reason = "event already notified"
    elif matched:
        reason = "rule matched; no new transition event"
    else:
        reason = "rule not matched"

    return {
        "rule": rule,
        "metric": asdict(snapshot),
        "matched": matched,
        "event_detected": event_detected,
        "should_notify": should_notify,
        "event_key": event_key,
        "reason": reason,
        "next_state": {
            "matched": matched,
            "last_value": current,
            "last_observation_date": snapshot.current.date,
            "last_notified_event_key": prior_state.get("last_notified_event_key"),
        },
    }


def evaluate_rules(
    data: dict[str, Any],
    rules: list[dict[str, Any]],
    states: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    catalog = load_catalog()
    states = states or {}
    return [evaluate_rule(data, rule, states.get(str(rule.get("id")), {}), catalog) for rule in rules]


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Treasury Pro alert rules against dashboard.json")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="dashboard JSON path")
    parser.add_argument("--rules", type=Path, required=True, help="JSON file containing {'rules': [...]} or a rule array")
    parser.add_argument("--state", type=Path, help="optional prior rule-state JSON mapping keyed by rule id")
    parser.add_argument("--only-notify", action="store_true", help="emit only rules that should notify now")
    args = parser.parse_args()

    data = _load_json(args.data)
    raw_rules = _load_json(args.rules)
    rules = raw_rules.get("rules", []) if isinstance(raw_rules, dict) else raw_rules
    if not isinstance(rules, list):
        raise AlertRuleError("rules file must contain a list or {'rules': [...]}")
    states = _load_json(args.state) if args.state else {}
    results = evaluate_rules(data, rules, states)
    if args.only_notify:
        results = [result for result in results if result["should_notify"]]
    print(json.dumps({"evaluated": len(rules), "notifications": sum(bool(r["should_notify"]) for r in results), "results": results}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
