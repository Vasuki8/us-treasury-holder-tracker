from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    nav = data.get("navigation_index", {})
    entries = nav.get("entries", [])
    assert nav.get("entry_count") == len(entries), "navigation entry count mismatch"
    assert len(entries) >= 100, "navigation index unexpectedly sparse"
    ids = [row.get("id") for row in entries]
    assert all(ids), "navigation entry missing id"
    assert len(ids) == len(set(ids)), "duplicate navigation id"
    allowed_types = {"section", "holder", "security", "source", "alert"}
    assert all(row.get("type") in allowed_types for row in entries), "invalid navigation type"
    assert all(row.get("title") and row.get("target_panel") for row in entries), "navigation entry missing title/target"

    holder_count = len([row for row in entries if row.get("type") == "holder"])
    security_count = len([row for row in entries if row.get("type") == "security"])
    assert holder_count == data.get("holder_profiles", {}).get("profile_count"), "holder navigation coverage mismatch"
    assert security_count >= 80, "security navigation coverage below expected level"

    movement = data.get("holder_comovement", {})
    pairs = movement.get("pairs", [])
    scopes = movement.get("scopes", [])
    assert movement.get("scope_count") == len(scopes), "co-movement scope count mismatch"
    assert movement.get("pair_count") >= len(pairs), "co-movement pair count invalid"
    assert len(scopes) >= 3, "expected foreign, sector and dealer co-movement scopes"
    pair_ids = [row.get("pair_id") for row in pairs]
    assert all(pair_ids), "co-movement pair missing id"
    assert len(pair_ids) == len(set(pair_ids)), "duplicate co-movement pair id"
    for row in pairs:
        corr = row.get("correlation")
        assert corr is not None and -1.000001 <= corr <= 1.000001, f"invalid correlation: {corr}"
        assert int(row.get("overlapping_change_points") or 0) >= 6, "pair has insufficient overlap"
        same = row.get("same_direction_pct")
        assert same is not None and 0 <= same <= 100, f"invalid same-direction percentage: {same}"
        assert row.get("profile_a_id") != row.get("profile_b_id"), "self-pair detected"

    summary = data.get("discovery_summary", {})
    assert summary.get("searchable_items") == len(entries), "discovery searchable-item count mismatch"
    assert summary.get("comparable_pairs") == movement.get("pair_count"), "discovery pair count mismatch"

    print(
        "Phase 11 validation passed:",
        f"{len(entries)} searchable items,",
        f"{holder_count} holder entries,",
        f"{security_count} security entries,",
        f"{movement.get('pair_count')} comparable pairs across {len(scopes)} scopes.",
    )


if __name__ == "__main__":
    main()
