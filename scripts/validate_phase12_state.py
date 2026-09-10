from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    auction = data.get("auction_demand_monitor", {})
    rows = auction.get("recent", [])
    assert auction.get("auction_count") == len(rows), "auction-demand row count mismatch"
    assert len(rows) >= 10, "auction-demand monitor unexpectedly sparse"
    for row in rows:
        score = row.get("demand_score")
        if score is not None:
            assert 0 <= score <= 100, f"invalid auction demand score: {score}"
        for key in ("bid_to_cover_percentile", "indirect_share_percentile", "dealer_share_percentile"):
            value = row.get(key)
            if value is not None:
                assert 0 <= value <= 100, f"invalid percentile {key}: {value}"
        assert row.get("demand_label") in {"strong", "solid", "balanced", "soft", "weak", "insufficient data"}

    market = data.get("market_structure_map", {})
    dims = market.get("dimensions", [])
    assert market.get("dimension_count") == len(dims), "market-structure dimension count mismatch"
    assert len(dims) >= 7, "market-structure map unexpectedly sparse"
    keys = [row.get("key") for row in dims]
    assert len(keys) == len(set(keys)), "duplicate market-structure dimension key"
    assert all(row.get("state") in {"supportive", "neutral", "cautious", "unknown"} for row in dims), "invalid structure state"
    assert market.get("overall_state") in {"supportive mix", "cautious mix", "mixed structure"}, "invalid overall state"
    counts = market.get("state_counts", {})
    assert sum(int(counts.get(k) or 0) for k in ("supportive", "neutral", "cautious", "unknown")) == len(dims), "state-count mismatch"

    print(
        "Phase 12 validation passed:",
        f"{len(rows)} auction-demand observations,",
        f"{len(auction.get('term_stats', []))} term groups,",
        f"{len(dims)} market-structure dimensions,",
        f"overall={market.get('overall_state')}.",
    )


if __name__ == "__main__":
    main()
