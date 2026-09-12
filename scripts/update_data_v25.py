from __future__ import annotations

import json
import math

import update_data_v24 as phase24

base = phase24.base
DATA_FILE = phase24.DATA_FILE


def _json_safe(value):
    """Recursively replace non-finite floats with JSON-safe null values."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    return value


def _reconcile_auction_reference_coverage(data: dict) -> None:
    block = data.get("treasury_auction_yield_history") or {}
    for series in block.get("series") or []:
        observations = series.get("observations") or []
        matched = [row for row in observations if row.get("reference_rate_pct") is not None]
        series["reference_match_count"] = len(matched)
        series["reference_match_pct"] = (len(matched) / len(observations) * 100.0) if observations else 0.0
        if observations:
            series["latest"] = observations[-1]


def main() -> None:
    phase24.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    data = _json_safe(data)
    _reconcile_auction_reference_coverage(data)
    data["generated_at"] = base.now_iso()

    # allow_nan=False is intentional: fail the updater rather than publish JSON
    # that Python accepts but browser JSON.parse() rejects.
    DATA_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False),
        encoding="utf-8",
    )

    auction = data.get("treasury_auction_yield_history") or {}
    observations = sum(len(row.get("observations") or []) for row in auction.get("series") or [])
    matched = sum(int(row.get("reference_match_count") or 0) for row in auction.get("series") or [])
    coverage = matched / observations * 100.0 if observations else 0.0
    print(
        "Strict browser JSON:",
        "valid;",
        observations,
        "auction observations;",
        f"{coverage:.1f}% finite par-reference coverage",
    )


if __name__ == "__main__":
    main()
