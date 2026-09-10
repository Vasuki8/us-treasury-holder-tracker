from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    profiles = data.get("holder_profiles", {})
    rows = profiles.get("profiles", [])
    assert profiles.get("profile_count") == len(rows), "holder profile count mismatch"
    assert len(rows) >= 20, "too few holder profiles"
    scopes = {row.get("scope") for row in rows}
    assert {"Foreign country", "U.S. sector", "Primary dealer"}.issubset(scopes), "missing holder profile scope"

    ids = [row.get("profile_id") for row in rows]
    assert all(ids), "profile without stable ID"
    assert len(ids) == len(set(ids)), "duplicate holder profile ID"

    foreign = [row for row in rows if row.get("scope") == "Foreign country"]
    assert len(foreign) >= 10, "too few foreign holder profiles"
    assert all(row.get("frequency") == "Monthly" for row in foreign), "foreign cadence mismatch"

    sectors = [row for row in rows if row.get("scope") == "U.S. sector"]
    assert len(sectors) >= 5, "too few U.S. sector profiles"

    dealers = [row for row in rows if row.get("scope") == "Primary dealer"]
    assert dealers, "missing primary dealer profiles"
    assert all(row.get("concept") == "market_positioning" for row in dealers), "dealer series mislabeled as holdings"

    flow = data.get("flow_intelligence", {})
    summaries = flow.get("scope_summaries", [])
    assert len(summaries) == 3, "flow scope summary count mismatch"
    for summary in summaries:
        breadth = summary.get("accumulation_breadth_pct")
        if breadth is not None:
            assert 0 <= breadth <= 100, f"invalid accumulation breadth: {breadth}"
        counts = (
            int(summary.get("accumulating_count") or 0)
            + int(summary.get("reducing_count") or 0)
            + int(summary.get("flat_count") or 0)
        )
        assert counts == int(summary.get("change_count") or 0), "direction counts do not reconcile"
        if summary.get("scope") != "Foreign country":
            assert summary.get("reported_total_change_billions") is None, "non-foreign cadence was incorrectly aggregated into a total flow"

    foreign_concentration = flow.get("foreign_concentration", {})
    for key in ("top5_share_pct", "top10_share_pct"):
        value = foreign_concentration.get(key)
        if value is not None:
            assert 0 <= value <= 100.5, f"invalid foreign concentration metric: {key}={value}"
    if foreign_concentration.get("top5_share_pct") is not None and foreign_concentration.get("top10_share_pct") is not None:
        assert foreign_concentration["top5_share_pct"] <= foreign_concentration["top10_share_pct"], "Top-5 share exceeds Top-10 share"

    print(
        "Phase 9 validation passed:",
        f"{len(rows)} holder profiles,",
        f"{len(foreign)} foreign holders,",
        f"{len(sectors)} U.S. sectors,",
        f"{len(dealers)} primary-dealer series,",
        f"{flow.get('signal_count', 0)} cross-scope signals.",
    )


if __name__ == "__main__":
    main()
