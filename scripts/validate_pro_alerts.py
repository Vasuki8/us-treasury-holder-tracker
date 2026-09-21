from __future__ import annotations

import json
import math
from pathlib import Path

from pro_alert_engine import EXPECTED_METRIC_IDS, build_preview

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "data" / "dashboard.json"
PREVIEW = ROOT / "data" / "pro-alert-preview.json"


def finite_or_none(value: object) -> bool:
    return value is None or (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def main() -> None:
    dashboard = json.loads(DASHBOARD.read_text(encoding="utf-8"))
    preview = json.loads(
        PREVIEW.read_text(encoding="utf-8"),
        parse_constant=lambda token: (_ for _ in ()).throw(
            ValueError(f"non-standard JSON numeric constant: {token}")
        ),
    )

    assert preview.get("engine_version"), "alert engine version missing"
    assert preview.get("source_generated_at") == dashboard.get("generated_at"), (
        "alert preview is not aligned with dashboard generated_at"
    )
    assert preview.get("generated_at") == dashboard.get("generated_at"), (
        "alert preview generated_at must follow the source payload"
    )
    assert preview.get("stateful_delivery_required") is True, (
        "preview must state that paid delivery requires server-side state"
    )

    metrics = preview.get("metrics") or []
    metric_ids = [row.get("id") for row in metrics]
    assert tuple(metric_ids) == EXPECTED_METRIC_IDS, (
        f"unexpected metric catalog: {metric_ids}"
    )
    assert len(metric_ids) == len(set(metric_ids)), "duplicate alert metric ids"

    allowed_units = {"pct", "bps", "score", "usd_billions"}
    for row in metrics:
        assert row.get("label"), f"metric label missing: {row.get('id')}"
        assert row.get("unit") in allowed_units, f"invalid unit: {row}"
        assert row.get("default_condition") in {"above", "below"}, (
            f"invalid default condition: {row}"
        )
        assert finite_or_none(row.get("value")), f"non-finite metric value: {row}"
        assert finite_or_none(row.get("default_threshold")), (
            f"non-finite default threshold: {row}"
        )
        assert row.get("source_path"), f"source path missing: {row}"

    rules = preview.get("sample_rules") or []
    assert len(rules) >= 5, "expected at least five sample alert rules"
    rule_ids = [row.get("id") for row in rules]
    assert len(rule_ids) == len(set(rule_ids)), "duplicate sample rule ids"
    for row in rules:
        assert row.get("metric_id") in set(metric_ids), f"unknown rule metric: {row}"
        assert row.get("condition") in {"above", "below"}, f"invalid rule condition: {row}"
        assert row.get("status") in {"triggered", "quiet", "unavailable"}, (
            f"invalid rule status: {row}"
        )
        assert finite_or_none(row.get("threshold")), f"invalid rule threshold: {row}"
        assert finite_or_none(row.get("current_value")), f"invalid rule value: {row}"

    rebuilt = build_preview(dashboard)
    assert rebuilt == preview, "pro alert preview is not deterministic from dashboard.json"

    print(
        "Treasury Pro alert validation passed: "
        f"{len(metrics)} metrics and {len(rules)} sample rules aligned to "
        f"{preview.get('source_generated_at')}."
    )


if __name__ == "__main__":
    main()
