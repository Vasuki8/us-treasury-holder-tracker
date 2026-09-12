from __future__ import annotations

import json
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "dashboard.json"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    curve = data.get("treasury_yield_curve") or {}
    overlay = curve.get("refinancing_overlay") or {}
    buckets = overlay.get("buckets") or []

    require(len(buckets) >= 8, f"Refinancing overlay too short: {len(buckets)} buckets")
    total = 0.0
    for row in buckets:
        require(row.get("key") and row.get("label"), "Refinancing bucket missing key/label")
        amount = number(row.get("principal_billions"))
        require(amount is not None and amount >= 0, f"Invalid refinancing principal: {row}")
        total += amount
    declared = number(overlay.get("total_principal_billions"))
    expected = number(overlay.get("expected_future_principal_billions"))
    require(declared is not None and abs(total - declared) < 0.1, "Refinancing overlay bucket total does not reconcile")
    require(expected is not None and abs(expected - declared) < 0.1, "Refinancing overlay does not cover all future principal")

    auction = data.get("treasury_auction_yield_history") or {}
    series = auction.get("series") or []
    require(len(series) >= 10, f"Auction-yield series unexpectedly sparse: {len(series)}")
    keys = {row.get("key") for row in series}
    for key in ("bill_13w", "note_2y", "note_5y", "note_10y", "bond_30y", "tips_10y"):
        require(key in keys, f"Missing expected auction-yield series: {key}")

    total_obs = 0
    matched_obs = 0
    for item in series:
        obs = item.get("observations") or []
        require(len(obs) >= 5, f"Auction series {item.get('key')} has too few observations")
        dates = [str(row.get("auction_date") or "") for row in obs]
        require(dates == sorted(dates), f"Auction series {item.get('key')} is not chronological")
        require(item.get("as_of") == dates[-1], f"Auction series {item.get('key')} as_of mismatch")
        for row in obs:
            rate = number(row.get("auction_result_rate_pct"))
            require(rate is not None and -10 < rate < 30, f"Implausible auction result rate: {row}")
            ref = number(row.get("reference_rate_pct"))
            spread = number(row.get("result_minus_reference_bps"))
            if ref is not None:
                matched_obs += 1
                require(-10 < ref < 30, f"Implausible par reference rate: {row}")
                require(spread is not None and abs(spread - (rate - ref) * 100.0) < 0.05, f"Auction/reference spread mismatch: {row}")
            total_obs += 1
        declared_matches = number(item.get("reference_match_count"))
        require(declared_matches is not None and int(declared_matches) == sum(1 for row in obs if row.get("reference_rate_pct") is not None), f"Reference match count mismatch: {item.get('key')}")

    require(total_obs >= 1000, f"Auction-yield observation history too short: {total_obs}")
    require(matched_obs / total_obs >= 0.7, f"Auction-yield par-reference coverage too low: {matched_obs}/{total_obs}")
    require(str(auction.get("history_start") or "") <= "2000-12-31", f"Auction-yield history starts too recently: {auction.get('history_start')}")

    sources = data.get("sources") or {}
    for key in ("treasury_refinancing_overlay", "treasury_auction_yield_history"):
        require((sources.get(key) or {}).get("status") in {"ok", "error"}, f"Source status missing for {key}")

    print(
        "Yield/refinancing validation passed:",
        len(buckets),
        "maturity buckets;",
        f"${declared:,.1f}B principal;",
        len(series),
        "auction-yield series;",
        total_obs,
        "auction observations;",
        f"{matched_obs / total_obs * 100:.1f}% par-reference coverage.",
    )


if __name__ == "__main__":
    main()
