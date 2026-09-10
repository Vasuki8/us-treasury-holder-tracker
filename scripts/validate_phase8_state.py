from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    alerts = data.get("unusual_change_alerts", {}).get("alerts", [])
    intelligence = data.get("alert_intelligence", {})
    rows = intelligence.get("rows", [])
    assert intelligence.get("row_count") == len(rows) == len(alerts), "alert intelligence row count mismatch"
    for row in rows:
        percentile = row.get("abs_change_percentile")
        if percentile is not None:
            assert 0 <= percentile <= 100, f"invalid alert percentile: {percentile}"
        assert row.get("diagnostic_label") in {"notable", "elevated", "extreme"}

    notifications = data.get("phase8_notifications", {})
    queue = notifications.get("queue", [])
    assert notifications.get("initialized") is True, "notification watermark not initialized"
    assert notifications.get("new_high_count") == len(queue), "notification queue count mismatch"
    assert all(row.get("severity") == "high" for row in queue), "non-high alert entered notification queue"
    assert all(row.get("event") in {"opened", "reopened", "severity_changed"} for row in queue)

    publication = data.get("publication_history", {})
    latest = publication.get("latest", [])
    assert publication.get("initialized") is True, "publication ledger not initialized"
    assert publication.get("source_count") == len(latest), "publication source count mismatch"
    assert len(latest) >= 8, "too few source observations in publication ledger"

    concentration = data.get("security_concentration", {})
    security_count = int(concentration.get("security_count") or 0)
    coverage_count = int(concentration.get("coverage_count") or 0)
    assert security_count > 0, "security concentration has no rows"
    assert 0 < coverage_count <= security_count, "invalid SOMA concentration coverage"
    assert coverage_count / security_count >= 0.80, "SOMA percent-outstanding coverage below 80%"
    for row in concentration.get("top_concentrations", []):
        pct = row.get("soma_pct_outstanding")
        if pct is not None:
            assert 0 <= pct <= 100.5, f"invalid SOMA percent outstanding: {pct}"
        implied = row.get("implied_outstanding_billions")
        if implied is not None:
            assert implied >= (row.get("soma_par_billions") or 0), "implied outstanding below SOMA par"

    print(
        "Phase 8 validation passed:",
        f"{len(rows)} alert diagnostics,",
        f"{len(queue)} new-high notification candidates,",
        f"{len(latest)} tracked source observations,",
        f"{coverage_count}/{security_count} concentration coverage.",
    )


if __name__ == "__main__":
    main()
