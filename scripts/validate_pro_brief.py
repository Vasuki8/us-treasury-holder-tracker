from __future__ import annotations

import json
import math
from pathlib import Path

from pro_brief_engine import SECTION_IDS, build_brief

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "data" / "dashboard.json"
BRIEF = ROOT / "data" / "pro-brief-preview.json"


def finite_or_none(value: object) -> bool:
    return value is None or (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def main() -> None:
    dashboard = json.loads(DASHBOARD.read_text(encoding="utf-8"))
    brief = json.loads(
        BRIEF.read_text(encoding="utf-8"),
        parse_constant=lambda token: (_ for _ in ()).throw(
            ValueError(f"non-standard JSON numeric constant: {token}")
        ),
    )

    assert brief.get("brief_version"), "brief version missing"
    assert brief.get("source_generated_at") == dashboard.get("generated_at"), (
        "brief preview is not aligned with dashboard generated_at"
    )
    assert brief.get("generated_at") == dashboard.get("generated_at"), (
        "brief generated_at must follow the source payload"
    )
    assert brief.get("title") == "Daily Treasury Brief"
    assert brief.get("delivery_required") is True

    summary = brief.get("summary") or []
    assert 2 <= len(summary) <= 6, f"unexpected summary length: {len(summary)}"
    for line in summary:
        assert isinstance(line, str) and line.strip(), "empty summary line"
        assert len(line) <= 320, f"summary line too long: {line}"

    sections = brief.get("sections") or []
    section_ids = tuple(section.get("id") for section in sections)
    assert section_ids == SECTION_IDS, f"unexpected brief sections: {section_ids}"

    allowed_units = {"pct", "bps", "score", "usd_billions", "date"}
    seen_metric_ids: set[str] = set()
    for section in sections:
        assert section.get("title"), f"section title missing: {section}"
        assert section.get("description"), f"section description missing: {section}"
        items = section.get("items") or []
        assert items, f"brief section has no items: {section.get('id')}"
        for item in items:
            metric_id = str(item.get("metric_id") or "")
            assert metric_id, f"brief item metric id missing: {item}"
            if section.get("id") != "freshness":
                assert metric_id not in seen_metric_ids, f"duplicate brief metric: {metric_id}"
                seen_metric_ids.add(metric_id)
            assert item.get("label"), f"brief item label missing: {item}"
            assert item.get("unit") in allowed_units, f"invalid brief item unit: {item}"
            if item.get("unit") != "date":
                assert finite_or_none(item.get("value")), f"invalid brief numeric value: {item}"
            assert item.get("source_path"), f"brief item source missing: {item}"
            assert item.get("context"), f"brief item context missing: {item}"

    monitoring = brief.get("monitoring_summary") or {}
    total = sum(int(monitoring.get(key) or 0) for key in ("triggered", "quiet", "unavailable"))
    assert total == int(monitoring.get("sample_rule_count") or 0), (
        "monitoring status counts do not reconcile"
    )

    rebuilt = build_brief(dashboard)
    assert rebuilt == brief, "brief preview is not deterministic from dashboard.json"

    note = str(brief.get("note") or "")
    assert "not personalized investment advice" in note.lower()
    assert "authenticated" in note.lower()

    print(
        "Daily Treasury Brief validation passed: "
        f"{len(summary)} summary lines, {len(sections)} sections, "
        f"{monitoring.get('sample_rule_count')} sample monitoring rules."
    )


if __name__ == "__main__":
    main()
