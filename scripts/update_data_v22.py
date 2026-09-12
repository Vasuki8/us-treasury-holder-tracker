from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import update_data_v21 as phase21

base = phase21.base
DATA_FILE = phase21.DATA_FILE
AUCTIONS_URL = base.AUCTIONS_URL


def _percentile(values: list[float], value: float | None) -> float | None:
    clean = sorted(v for v in values if v is not None)
    if value is None or not clean:
        return None
    below = sum(1 for v in clean if v < value)
    equal = sum(1 for v in clean if v == value)
    return (below + 0.5 * equal) / len(clean) * 100.0


def _demand_label(score: float | None) -> str:
    if score is None:
        return "insufficient data"
    if score >= 70:
        return "strong"
    if score >= 55:
        return "solid"
    if score >= 40:
        return "balanced"
    if score >= 25:
        return "soft"
    return "weak"


def fetch_auction_history(window_days: int = 90) -> list[dict]:
    start = (datetime.now(timezone.utc).date() - timedelta(days=window_days)).isoformat()
    fields = [
        "cusip",
        "security_type",
        "security_term",
        "auction_date",
        "offering_amt",
        "comp_accepted",
        "total_accepted",
        "bid_to_cover_ratio",
        "primary_dealer_accepted",
        "direct_bidder_accepted",
        "indirect_bidder_accepted",
    ]
    payload = base.get_json(
        AUCTIONS_URL,
        params={
            "fields": ",".join(fields),
            "filter": f"auction_date:gte:{start}",
            "sort": "-auction_date",
            "page[number]": 1,
            "page[size]": 1000,
            "format": "json",
        },
    )
    rows = payload.get("data", [])
    if len(rows) < 30:
        raise RuntimeError(f"Auction history unexpectedly short: {len(rows)} rows")

    parsed = []
    for row in rows:
        comp = base.to_float(row.get("comp_accepted"))
        accepted = base.to_float(row.get("total_accepted"))
        dealer = base.to_float(row.get("primary_dealer_accepted"))
        indirect = base.to_float(row.get("indirect_bidder_accepted"))
        direct = base.to_float(row.get("direct_bidder_accepted"))
        parsed.append(
            {
                "auction_date": str(row.get("auction_date") or "")[:10],
                "cusip": row.get("cusip"),
                "security_type": row.get("security_type"),
                "security_term": row.get("security_term"),
                "offering_billions": (base.to_float(row.get("offering_amt")) or 0.0) / 1e9,
                "accepted_billions": (accepted or 0.0) / 1e9,
                "bid_to_cover": base.to_float(row.get("bid_to_cover_ratio")),
                "dealer_share_pct": (dealer / comp * 100.0) if dealer is not None and comp else None,
                "indirect_share_pct": (indirect / comp * 100.0) if indirect is not None and comp else None,
                "direct_share_pct": (direct / comp * 100.0) if direct is not None and comp else None,
            }
        )
    parsed = [row for row in parsed if row["auction_date"]]
    parsed.sort(key=lambda row: row["auction_date"], reverse=True)
    return parsed


def enrich_history(rows: list[dict]) -> list[dict]:
    enriched = []
    for row in rows:
        term = str(row.get("security_term") or "Unknown")
        same_term = [r for r in rows if str(r.get("security_term") or "Unknown") == term]
        comparator = same_term if len(same_term) >= 3 else rows

        btc = base.to_float(row.get("bid_to_cover"))
        indirect = base.to_float(row.get("indirect_share_pct"))
        dealer = base.to_float(row.get("dealer_share_pct"))
        btc_pct = _percentile([base.to_float(r.get("bid_to_cover")) for r in comparator if base.to_float(r.get("bid_to_cover")) is not None], btc)
        indirect_pct = _percentile([base.to_float(r.get("indirect_share_pct")) for r in comparator if base.to_float(r.get("indirect_share_pct")) is not None], indirect)
        dealer_pct = _percentile([base.to_float(r.get("dealer_share_pct")) for r in comparator if base.to_float(r.get("dealer_share_pct")) is not None], dealer)

        components = []
        weights = []
        if btc_pct is not None:
            components.append(btc_pct)
            weights.append(0.45)
        if indirect_pct is not None:
            components.append(indirect_pct)
            weights.append(0.35)
        if dealer_pct is not None:
            components.append(100.0 - dealer_pct)
            weights.append(0.20)
        score = None
        if components:
            total_weight = sum(weights)
            score = sum(value * weight for value, weight in zip(components, weights)) / total_weight

        enriched.append(
            {
                **row,
                "comparison_group": term if len(same_term) >= 3 else "all 90-day auctions",
                "comparison_count": len(comparator),
                "bid_to_cover_percentile": btc_pct,
                "indirect_share_percentile": indirect_pct,
                "dealer_share_percentile": dealer_pct,
                "demand_score": score,
                "demand_label": _demand_label(score),
            }
        )
    return enriched


def main() -> None:
    prior = json.loads(DATA_FILE.read_text(encoding="utf-8")) if DATA_FILE.exists() else {}
    previous_history = (prior.get("auction_demand_monitor") or {}).get("history")

    phase21.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    monitor = dict(data.get("auction_demand_monitor") or {})

    try:
        history = enrich_history(fetch_auction_history(90))
        data.setdefault("sources", {})["auction_demand_history"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        if not previous_history:
            raise
        history = previous_history
        data.setdefault("sources", {})["auction_demand_history"] = {
            "status": "error",
            "checked_at": base.now_iso(),
            "message": f"{type(exc).__name__}: {exc}; previous verified 90-day auction-demand history retained",
        }

    history = sorted(history, key=lambda row: str(row.get("auction_date") or ""), reverse=True)
    monitor["history_window_days"] = 90
    monitor["history_count"] = len(history)
    monitor["history"] = history
    monitor["recent"] = history[:30]
    monitor["auction_count"] = len(monitor["recent"])
    monitor["latest"] = history[0] if history else monitor.get("latest")
    monitor["note"] = (
        "Demand history covers the latest 90 days so the dashboard can filter 30D, 60D and 90D views. "
        "The 0–100 score remains a research diagnostic, not an official Treasury metric."
    )
    data["auction_demand_monitor"] = monitor
    data["generated_at"] = base.now_iso()
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    print(
        "Dynamic auction-demand history:",
        monitor.get("history_count"),
        "observations over",
        monitor.get("history_window_days"),
        "days; recent table sample",
        monitor.get("auction_count"),
    )


if __name__ == "__main__":
    main()
