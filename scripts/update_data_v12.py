from __future__ import annotations

import json
import statistics

import update_data_v11 as phase11

base = phase11.base
DATA_FILE = phase11.DATA_FILE


def _now_iso() -> str:
    return base.now_iso()


def _num(value) -> float | None:
    return base.to_float(value)


def _percentile(values: list[float], value: float | None) -> float | None:
    clean = sorted(v for v in values if v is not None)
    if value is None or not clean:
        return None
    below = sum(1 for v in clean if v < value)
    equal = sum(1 for v in clean if v == value)
    return (below + 0.5 * equal) / len(clean) * 100.0


def _median(values: list[float | None]) -> float | None:
    clean = [float(v) for v in values if v is not None]
    return statistics.median(clean) if clean else None


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


def build_auction_demand_monitor(data: dict) -> dict:
    auctions = data.get("auctions", {})
    rows = [dict(row) for row in auctions.get("recent_auctions", []) if row.get("auction_date")]
    rows.sort(key=lambda r: str(r.get("auction_date") or ""), reverse=True)

    all_btc = [_num(r.get("bid_to_cover")) for r in rows]
    all_indirect = [_num(r.get("indirect_share_pct")) for r in rows]
    all_dealer = [_num(r.get("dealer_share_pct")) for r in rows]
    all_btc = [v for v in all_btc if v is not None]
    all_indirect = [v for v in all_indirect if v is not None]
    all_dealer = [v for v in all_dealer if v is not None]

    enriched = []
    for row in rows:
        term = str(row.get("security_term") or "Unknown")
        same_term = [r for r in rows if str(r.get("security_term") or "Unknown") == term]
        comparator = same_term if len(same_term) >= 3 else rows

        btc = _num(row.get("bid_to_cover"))
        indirect = _num(row.get("indirect_share_pct"))
        dealer = _num(row.get("dealer_share_pct"))

        btc_pct = _percentile([_num(r.get("bid_to_cover")) for r in comparator if _num(r.get("bid_to_cover")) is not None], btc)
        indirect_pct = _percentile([_num(r.get("indirect_share_pct")) for r in comparator if _num(r.get("indirect_share_pct")) is not None], indirect)
        dealer_pct = _percentile([_num(r.get("dealer_share_pct")) for r in comparator if _num(r.get("dealer_share_pct")) is not None], dealer)

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
            score = sum(v * w for v, w in zip(components, weights)) / total_weight

        enriched.append(
            {
                **row,
                "comparison_group": term if len(same_term) >= 3 else "all recent auctions",
                "comparison_count": len(comparator),
                "bid_to_cover_percentile": btc_pct,
                "indirect_share_percentile": indirect_pct,
                "dealer_share_percentile": dealer_pct,
                "demand_score": score,
                "demand_label": _demand_label(score),
            }
        )

    term_stats = []
    for term in sorted({str(r.get("security_term") or "Unknown") for r in rows}):
        group = [r for r in rows if str(r.get("security_term") or "Unknown") == term]
        term_stats.append(
            {
                "security_term": term,
                "auction_count": len(group),
                "median_bid_to_cover": _median([_num(r.get("bid_to_cover")) for r in group]),
                "median_indirect_share_pct": _median([_num(r.get("indirect_share_pct")) for r in group]),
                "median_dealer_share_pct": _median([_num(r.get("dealer_share_pct")) for r in group]),
                "median_direct_share_pct": _median([_num(r.get("direct_share_pct")) for r in group]),
            }
        )
    term_stats.sort(key=lambda r: (-r["auction_count"], r["security_term"]))

    scores = [_num(r.get("demand_score")) for r in enriched if _num(r.get("demand_score")) is not None]
    latest = enriched[0] if enriched else None
    return {
        "as_of": auctions.get("as_of"),
        "auction_count": len(enriched),
        "latest": latest,
        "recent": enriched[:30],
        "term_stats": term_stats,
        "median_demand_score": _median(scores),
        "strong_count": sum(1 for r in enriched if r.get("demand_label") == "strong"),
        "soft_or_weak_count": sum(1 for r in enriched if r.get("demand_label") in {"soft", "weak"}),
        "method": (
            "Heuristic demand score: 45% bid-to-cover percentile, 35% indirect-bidder-share percentile and 20% inverse primary-dealer-share percentile. "
            "A security term is used as the comparison group when at least three recent observations exist; otherwise the 30-auction sample is used."
        ),
        "note": "This score is a research diagnostic, not an official Treasury metric. Auction takedown describes awards at issuance and does not measure secondary-market ownership.",
    }


def _scope_map(data: dict) -> dict[str, dict]:
    return {
        str(row.get("scope")): row
        for row in data.get("flow_regime_history", {}).get("current", [])
        if row.get("scope")
    }


def _state_from_breadth(value: float | None) -> tuple[str, str]:
    if value is None:
        return "unknown", "Insufficient history"
    if value >= 70:
        return "supportive", "Broad accumulation"
    if value >= 55:
        return "supportive", "Accumulation tilt"
    if value <= 30:
        return "cautious", "Broad reduction"
    if value <= 45:
        return "cautious", "Reduction tilt"
    return "neutral", "Mixed"


def build_market_structure_map(data: dict) -> dict:
    scopes = _scope_map(data)
    auction = data.get("auction_demand_monitor", {})
    concentration = data.get("security_concentration", {})
    alerts = data.get("phase8_notifications", {})
    release = data.get("release_calendar", {})
    primary = data.get("primary_dealers", {})

    dimensions = []
    foreign = scopes.get("Foreign country", {})
    domestic = scopes.get("U.S. sector", {})
    dealer_scope = scopes.get("Primary dealer", {})

    for key, label, row in [
        ("foreign", "Foreign holder breadth", foreign),
        ("domestic", "U.S. sector breadth", domestic),
        ("dealer_breadth", "Primary-dealer series breadth", dealer_scope),
    ]:
        breadth = _num(row.get("accumulation_breadth_pct"))
        state, reading = _state_from_breadth(breadth)
        dimensions.append(
            {
                "key": key,
                "label": label,
                "value": breadth,
                "display": f"{breadth:.1f}%" if breadth is not None else "—",
                "state": state,
                "reading": reading,
                "observation": ", ".join(row.get("observation_dates", []) or []) or None,
                "detail": f"{row.get('accumulating_count', 0)} accumulating / {row.get('reducing_count', 0)} reducing / {row.get('flat_count', 0)} flat.",
            }
        )

    latest_auction = auction.get("latest") or {}
    demand_score = _num(latest_auction.get("demand_score"))
    demand_label = latest_auction.get("demand_label") or "insufficient data"
    if demand_score is None:
        demand_state = "unknown"
    elif demand_score >= 55:
        demand_state = "supportive"
    elif demand_score < 40:
        demand_state = "cautious"
    else:
        demand_state = "neutral"
    dimensions.append(
        {
            "key": "auction_demand",
            "label": "Latest auction demand",
            "value": demand_score,
            "display": f"{demand_score:.0f}/100" if demand_score is not None else "—",
            "state": demand_state,
            "reading": str(demand_label).title(),
            "observation": latest_auction.get("auction_date"),
            "detail": f"{latest_auction.get('security_term') or 'Treasury'} · bid/cover {latest_auction.get('bid_to_cover') if latest_auction.get('bid_to_cover') is not None else '—'}.",
        }
    )

    top_conc = (concentration.get("top_concentrations") or [{}])[0]
    soma_pct = _num(top_conc.get("soma_pct_outstanding"))
    conc_state = "cautious" if soma_pct is not None and soma_pct >= 70 else "neutral" if soma_pct is not None else "unknown"
    dimensions.append(
        {
            "key": "soma_concentration",
            "label": "Top stored SOMA concentration",
            "value": soma_pct,
            "display": f"{soma_pct:.1f}%" if soma_pct is not None else "—",
            "state": conc_state,
            "reading": "Very concentrated" if soma_pct is not None and soma_pct >= 70 else "Monitor" if soma_pct is not None else "Unknown",
            "observation": concentration.get("as_of"),
            "detail": f"CUSIP {top_conc.get('cusip') or '—'} within the stored SOMA security universe.",
        }
    )

    active_high = int(alerts.get("active_high_count") or 0)
    dimensions.append(
        {
            "key": "alerts",
            "label": "Active high-severity holder alerts",
            "value": active_high,
            "display": str(active_high),
            "state": "cautious" if active_high else "supportive",
            "reading": "Unusual moves active" if active_high else "No active high alerts",
            "observation": data.get("generated_at"),
            "detail": "Persistent alert lifecycle with robust anomaly diagnostics.",
        }
    )

    attention = int(release.get("attention_count") or 0)
    overdue = int((release.get("status_counts") or {}).get("overdue") or 0)
    source_errors = int((release.get("status_counts") or {}).get("source_error") or 0)
    dimensions.append(
        {
            "key": "freshness",
            "label": "Data freshness",
            "value": attention,
            "display": f"{attention} attention",
            "state": "cautious" if overdue or source_errors else "neutral" if attention else "supportive",
            "reading": f"{overdue} overdue estimate · {source_errors} source error",
            "observation": release.get("today"),
            "detail": "Calendar states use source cadence and tracker-estimated publication windows.",
        }
    )

    dealer_position = next((r for r in primary.get("series", []) if r.get("keyid") == "PDPOSGST-TOT"), None)
    if dealer_position:
        value = _num(dealer_position.get("value_billions"))
        weekly = _num(dealer_position.get("weekly_change_billions"))
        dimensions.append(
            {
                "key": "dealer_position",
                "label": "Primary-dealer net Treasury position",
                "value": value,
                "display": f"${value:,.1f}B" if value is not None else "—",
                "state": "neutral",
                "reading": f"Weekly change {weekly:+.1f}B" if weekly is not None else "Weekly change —",
                "observation": dealer_position.get("as_of"),
                "detail": "Aggregate New York Fed primary-dealer positioning; not a beneficial-ownership register.",
            }
        )

    counts = {"supportive": 0, "neutral": 0, "cautious": 0, "unknown": 0}
    for row in dimensions:
        counts[row.get("state") if row.get("state") in counts else "unknown"] += 1

    if counts["supportive"] >= counts["cautious"] + 2:
        overall = "supportive mix"
    elif counts["cautious"] >= counts["supportive"] + 2:
        overall = "cautious mix"
    else:
        overall = "mixed structure"

    return {
        "generated_at": _now_iso(),
        "overall_state": overall,
        "state_counts": counts,
        "dimension_count": len(dimensions),
        "dimensions": dimensions,
        "note": (
            "The market-structure map is a descriptive dashboard of separate official datasets. It does not combine incompatible reporting periods into one synthetic market score. "
            "Supportive/cautious labels are directional research aids, not trading recommendations."
        ),
    }


def main() -> None:
    phase11.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    data["auction_demand_monitor"] = build_auction_demand_monitor(data)
    data["market_structure_map"] = build_market_structure_map(data)
    data["generated_at"] = _now_iso()

    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Phase 12 updated {DATA_FILE}")
    print("Auction demand observations:", data["auction_demand_monitor"].get("auction_count"))
    print("Latest auction demand:", (data["auction_demand_monitor"].get("latest") or {}).get("demand_label"), (data["auction_demand_monitor"].get("latest") or {}).get("demand_score"))
    print("Market structure state:", data["market_structure_map"].get("overall_state"))


if __name__ == "__main__":
    main()
