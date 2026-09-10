from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"


ALLOWED_CALENDAR = {
    "new_release",
    "source_error",
    "access_limited",
    "event_driven",
    "unscheduled",
    "overdue",
    "grace_window",
    "due_now",
    "due_soon",
    "scheduled",
}

ALLOWED_REGIMES = {
    "broad accumulation",
    "accumulation tilt",
    "mixed",
    "reduction tilt",
    "broad reduction",
    "insufficient data",
}


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    release = data.get("release_calendar", {})
    rows = release.get("rows", [])
    assert release.get("source_count") == len(rows), "release-calendar source count mismatch"
    assert len(rows) >= 8, "too few release-calendar rows"
    assert len({row.get("key") for row in rows}) == len(rows), "duplicate release-calendar source key"
    assert all(row.get("calendar_status") in ALLOWED_CALENDAR for row in rows), "invalid release-calendar status"
    for row in rows:
        days = row.get("days_to_expected")
        if days is not None:
            assert isinstance(days, int), f"days_to_expected is not int: {row.get('key')}"
        overdue = row.get("overdue_days")
        if overdue is not None:
            assert overdue >= 0, f"negative overdue days: {row.get('key')}"

    regime = data.get("flow_regime_history", {})
    events = regime.get("events", [])
    current = regime.get("current", [])
    assert regime.get("initialized") is True, "flow-regime history not initialized"
    assert len(current) >= 3, "expected at least three current flow scopes"
    assert len(events) >= len(current), "flow-regime history smaller than current state"
    assert len({row.get("event_id") for row in events}) == len(events), "duplicate flow-regime event id"
    assert len({row.get("signature") for row in events}) == len(events), "duplicate flow-regime observation signature"
    for row in events:
        assert row.get("regime") in ALLOWED_REGIMES, f"invalid regime: {row.get('regime')}"
        breadth = row.get("accumulation_breadth_pct")
        if breadth is not None:
            assert 0 <= breadth <= 100, f"invalid breadth: {breadth}"
        score = row.get("momentum_score")
        if score is not None:
            assert -50 <= score <= 50, f"invalid momentum score: {score}"

    cross_events = regime.get("cross_scope_events", [])
    assert len({row.get("event_id") for row in cross_events}) == len(cross_events), "duplicate cross-scope event id"
    for row in cross_events:
        gap = row.get("divergence_pct_points")
        if gap is not None:
            assert -100 <= gap <= 100, f"invalid cross-scope divergence: {gap}"

    brief = data.get("research_brief", {})
    brief_rows = brief.get("items", [])
    assert brief.get("item_count") == len(brief_rows), "research brief count mismatch"
    assert len(brief_rows) >= 2, "research brief unexpectedly sparse"
    for row in brief_rows:
        assert row.get("title") and row.get("text"), "research brief item missing title/text"

    print(
        "Phase 10 validation passed:",
        f"{len(rows)} release-calendar sources,",
        f"{len(events)} regime events,",
        f"{len(cross_events)} cross-scope events,",
        f"{len(brief_rows)} research-brief items.",
    )


if __name__ == "__main__":
    main()
