from __future__ import annotations

import hashlib
import json
import statistics

import update_data_v8 as phase8

base = phase8.base
DATA_FILE = phase8.DATA_FILE


def _now_iso() -> str:
    return base.now_iso()


def _safe_float(value) -> float | None:
    return base.to_float(value)


def _pct_change(current: float | None, previous: float | None) -> float | None:
    if current is None or previous in (None, 0):
        return None
    return (current - previous) / abs(previous) * 100.0


def _profile_id(scope: str, name: str) -> str:
    raw = f"{scope}|{name}".strip().lower()
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:18]


def _history(row: dict) -> list[dict]:
    points = []
    for item in row.get("history", []) or []:
        date = item.get("period") or item.get("date") or item.get("as_of")
        value = _safe_float(
            item.get("holdings_billions")
            if item.get("holdings_billions") is not None
            else item.get("value_billions")
        )
        if date and value is not None:
            points.append({"date": str(date), "value_billions": value})
    points.sort(key=lambda x: x["date"])
    return points[-120:]


def _profile_from_history(
    *,
    scope: str,
    name: str,
    concept: str,
    source_key: str,
    frequency: str,
    history: list[dict],
    current_billions: float | None = None,
    as_of: str | None = None,
    series: str | None = None,
) -> dict:
    latest = history[-1] if history else None
    previous = history[-2] if len(history) >= 2 else None
    current = current_billions if current_billions is not None else (latest or {}).get("value_billions")
    observation = as_of or (latest or {}).get("date")
    previous_value = (previous or {}).get("value_billions")
    change = current - previous_value if current is not None and previous_value is not None else None
    return {
        "profile_id": _profile_id(scope, name),
        "scope": scope,
        "name": name,
        "concept": concept,
        "source_key": source_key,
        "frequency": frequency,
        "series": series,
        "as_of": observation,
        "current_billions": current,
        "previous_billions": previous_value,
        "change_billions": change,
        "change_pct": _pct_change(current, previous_value),
        "history": history,
    }


def build_holder_profiles(data: dict) -> dict:
    profiles: dict[tuple[str, str], dict] = {}

    foreign = data.get("foreign_holders", {})
    for row in foreign.get("countries", []):
        name = row.get("name")
        if not name:
            continue
        history = _history(row)
        profile = _profile_from_history(
            scope="Foreign country",
            name=str(name),
            concept="current_holdings",
            source_key="foreign_holders",
            frequency="Monthly",
            history=history,
            current_billions=_safe_float(row.get("holdings_billions")),
            as_of=foreign.get("as_of"),
        )
        profile["change_3m_billions"] = _safe_float(row.get("change_3m_billions"))
        profile["change_6m_billions"] = _safe_float(row.get("change_6m_billions"))
        profile["change_12m_billions"] = _safe_float(row.get("change_12m_billions"))
        profiles[(profile["scope"], profile["name"])] = profile

    sector_blocks = [
        ("institutional_aggregates", "institutions"),
        ("extended_holders", "holders"),
        ("domestic_sectors", "holders"),
    ]
    for block_key, row_key in sector_blocks:
        block = data.get(block_key, {})
        for row in block.get(row_key, []) or []:
            name = row.get("name")
            if not name:
                continue
            history = _history(row)
            profile = _profile_from_history(
                scope="U.S. sector",
                name=str(name),
                concept="current_holdings",
                source_key=block_key,
                frequency=str(row.get("frequency") or block.get("frequency") or "Quarterly"),
                history=history,
                current_billions=_safe_float(row.get("holdings_billions")),
                as_of=row.get("as_of") or block.get("as_of"),
                series=row.get("series"),
            )
            key = (profile["scope"], profile["name"])
            existing = profiles.get(key)
            if existing is None or len(profile["history"]) > len(existing.get("history", [])):
                profiles[key] = profile

    dealers = data.get("primary_dealers", {})
    for row in dealers.get("series", []) or []:
        name = row.get("name")
        if not name:
            continue
        history = _history(row)
        profile = _profile_from_history(
            scope="Primary dealer",
            name=str(name),
            concept="market_positioning",
            source_key="primary_dealers",
            frequency=str(dealers.get("frequency") or "Weekly"),
            history=history,
            current_billions=_safe_float(row.get("value_billions")),
            as_of=row.get("as_of") or dealers.get("as_of"),
            series=row.get("keyid"),
        )
        profiles[(profile["scope"], profile["name"])] = profile

    # Attach current alert/diagnostic state where Phase 8 has one.
    alerts = {
        (row.get("scope"), row.get("name")): row
        for row in data.get("alert_intelligence", {}).get("rows", [])
        if row.get("scope") and row.get("name")
    }
    lifecycle = {
        (row.get("scope"), row.get("name")): row
        for row in data.get("alert_history", {}).get("episodes", [])
        if row.get("scope") and row.get("name") and row.get("state") == "active"
    }
    provenance = {
        row.get("key"): row
        for row in data.get("provenance", {}).get("sources", [])
        if row.get("key")
    }

    grouped: dict[str, list[dict]] = {}
    for profile in profiles.values():
        grouped.setdefault(profile["scope"], []).append(profile)

    for scope, rows in grouped.items():
        rows.sort(
            key=lambda p: abs(p.get("current_billions") or 0)
            if p.get("concept") == "market_positioning"
            else (p.get("current_billions") or 0),
            reverse=True,
        )
        scope_total = sum(max(0.0, p.get("current_billions") or 0.0) for p in rows)
        for rank, profile in enumerate(rows, 1):
            profile["rank_within_scope"] = rank
            profile["share_of_tracked_scope_pct"] = (
                (max(0.0, profile.get("current_billions") or 0.0) / scope_total * 100.0)
                if scope_total > 0 and profile.get("concept") == "current_holdings"
                else None
            )
            alert = alerts.get((profile["scope"], profile["name"]), {})
            episode = lifecycle.get((profile["scope"], profile["name"]), {})
            profile["alert_severity"] = alert.get("severity")
            profile["diagnostic_label"] = alert.get("diagnostic_label")
            profile["abs_change_percentile"] = alert.get("abs_change_percentile")
            profile["robust_z"] = alert.get("robust_z")
            profile["alert_first_seen_at"] = episode.get("first_seen_at")
            source = provenance.get(profile.get("source_key"), {})
            profile["source_name"] = source.get("name") or profile.get("source_key")
            profile["source_url"] = source.get("source_url") or source.get("retrieval_url")

    ordered = sorted(
        profiles.values(),
        key=lambda p: (p.get("scope") or "", p.get("rank_within_scope") or 9999, p.get("name") or ""),
    )

    foreign_total = _safe_float(foreign.get("grand_total_billions"))
    for profile in ordered:
        if profile["scope"] == "Foreign country" and foreign_total:
            profile["share_of_foreign_total_pct"] = (
                (profile.get("current_billions") or 0.0) / foreign_total * 100.0
            )

    return {
        "generated_at": _now_iso(),
        "profile_count": len(ordered),
        "scope_counts": {scope: len(rows) for scope, rows in grouped.items()},
        "profiles": ordered,
        "note": (
            "Holder profiles preserve each source's own cadence. Foreign-country profiles are monthly current holdings, U.S. sectors are quarterly aggregate holdings, and primary-dealer profiles are weekly market-positioning series rather than ownership balances."
        ),
    }


def _direction(change: float | None, previous: float | None) -> str:
    if change is None:
        return "unknown"
    threshold = max(0.1, abs(previous or 0.0) * 0.001)
    if change > threshold:
        return "accumulating"
    if change < -threshold:
        return "reducing"
    return "flat"


def _scope_summary(scope: str, profiles: list[dict], foreign_total_change: float | None = None) -> dict:
    usable = [p for p in profiles if p.get("change_billions") is not None]
    for p in usable:
        p["latest_direction"] = _direction(p.get("change_billions"), p.get("previous_billions"))

    accumulating = [p for p in usable if p["latest_direction"] == "accumulating"]
    reducing = [p for p in usable if p["latest_direction"] == "reducing"]
    flat = [p for p in usable if p["latest_direction"] == "flat"]
    directional = len(accumulating) + len(reducing)
    breadth = len(accumulating) / directional * 100.0 if directional else None
    changes_pct = [p.get("change_pct") for p in usable if p.get("change_pct") is not None]

    top_buyers = sorted(accumulating, key=lambda p: p.get("change_billions") or 0, reverse=True)[:5]
    top_sellers = sorted(reducing, key=lambda p: p.get("change_billions") or 0)[:5]
    dates = sorted({str(p.get("as_of")) for p in usable if p.get("as_of")})
    frequencies = sorted({str(p.get("frequency")) for p in usable if p.get("frequency")})

    return {
        "scope": scope,
        "concept": profiles[0].get("concept") if profiles else None,
        "profile_count": len(profiles),
        "change_count": len(usable),
        "accumulating_count": len(accumulating),
        "reducing_count": len(reducing),
        "flat_count": len(flat),
        "accumulation_breadth_pct": breadth,
        "median_change_pct": statistics.median(changes_pct) if changes_pct else None,
        "observation_dates": dates,
        "frequencies": frequencies,
        "reported_total_change_billions": foreign_total_change if scope == "Foreign country" else None,
        "top_accumulators": [
            {
                "profile_id": p.get("profile_id"),
                "name": p.get("name"),
                "change_billions": p.get("change_billions"),
                "change_pct": p.get("change_pct"),
                "as_of": p.get("as_of"),
            }
            for p in top_buyers
        ],
        "top_reducers": [
            {
                "profile_id": p.get("profile_id"),
                "name": p.get("name"),
                "change_billions": p.get("change_billions"),
                "change_pct": p.get("change_pct"),
                "as_of": p.get("as_of"),
            }
            for p in top_sellers
        ],
    }


def _foreign_total_change(data: dict) -> float | None:
    history = data.get("foreign_holders", {}).get("grand_total_history", [])
    if len(history) < 2:
        return None
    ordered = sorted(
        (
            (str(row.get("period")), _safe_float(row.get("holdings_billions")))
            for row in history
            if row.get("period") and _safe_float(row.get("holdings_billions")) is not None
        ),
        key=lambda x: x[0],
    )
    if len(ordered) < 2:
        return None
    return ordered[-1][1] - ordered[-2][1]


def build_flow_intelligence(data: dict, holder_profiles: dict) -> dict:
    profiles = holder_profiles.get("profiles", [])
    by_scope: dict[str, list[dict]] = {}
    for profile in profiles:
        by_scope.setdefault(profile.get("scope") or "Unknown", []).append(profile)

    summaries = []
    for scope in ("Foreign country", "U.S. sector", "Primary dealer"):
        summary = _scope_summary(
            scope,
            by_scope.get(scope, []),
            foreign_total_change=_foreign_total_change(data),
        )
        summaries.append(summary)

    summary_by_scope = {s["scope"]: s for s in summaries}
    signals = []
    foreign_breadth = summary_by_scope.get("Foreign country", {}).get("accumulation_breadth_pct")
    sector_breadth = summary_by_scope.get("U.S. sector", {}).get("accumulation_breadth_pct")

    if foreign_breadth is not None and sector_breadth is not None:
        gap = sector_breadth - foreign_breadth
        if abs(gap) >= 30:
            signals.append(
                {
                    "type": "directional_divergence",
                    "label": "Domestic/foreign directional divergence",
                    "strength_pct_points": abs(gap),
                    "description": (
                        f"Tracked U.S. sector accumulation breadth is {sector_breadth:.1f}% versus {foreign_breadth:.1f}% for foreign countries."
                    ),
                    "caveat": "This compares directional breadth only. U.S. sectors are quarterly while foreign-country data are monthly, so the dollar changes are not added together.",
                }
            )
        elif foreign_breadth >= 60 and sector_breadth >= 60:
            signals.append(
                {
                    "type": "broad_accumulation",
                    "label": "Broad accumulation across holder scopes",
                    "strength_pct_points": min(foreign_breadth, sector_breadth),
                    "description": "A majority of both tracked foreign countries and U.S. holder sectors increased their latest reported Treasury positions.",
                    "caveat": "The observation windows differ by source cadence; this is a breadth signal, not a synchronized flow total.",
                }
            )
        elif foreign_breadth <= 40 and sector_breadth <= 40:
            signals.append(
                {
                    "type": "broad_reduction",
                    "label": "Broad reduction across holder scopes",
                    "strength_pct_points": 100.0 - max(foreign_breadth, sector_breadth),
                    "description": "A majority of both tracked foreign countries and U.S. holder sectors reduced their latest reported Treasury positions.",
                    "caveat": "The observation windows differ by source cadence; this is a breadth signal, not a synchronized flow total.",
                }
            )

    foreign = data.get("foreign_holders", {})
    countries = sorted(
        [p for p in profiles if p.get("scope") == "Foreign country"],
        key=lambda p: p.get("current_billions") or 0,
        reverse=True,
    )
    foreign_total = _safe_float(foreign.get("grand_total_billions")) or 0.0
    top5_share = sum(p.get("current_billions") or 0 for p in countries[:5]) / foreign_total * 100.0 if foreign_total else None
    top10_share = sum(p.get("current_billions") or 0 for p in countries[:10]) / foreign_total * 100.0 if foreign_total else None

    return {
        "generated_at": _now_iso(),
        "scope_summaries": summaries,
        "signals": signals,
        "signal_count": len(signals),
        "foreign_concentration": {
            "as_of": foreign.get("as_of"),
            "top5_share_pct": top5_share,
            "top10_share_pct": top10_share,
            "foreign_total_billions": foreign_total or None,
        },
        "note": (
            "Phase 9 compares accumulation/reduction breadth within each source cadence instead of summing monthly, quarterly and weekly changes into a false synchronized flow number. Primary-dealer series remain classified as market positioning, not ownership."
        ),
    }


def main() -> None:
    phase8.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    holder_profiles = build_holder_profiles(data)
    data["holder_profiles"] = holder_profiles
    data["flow_intelligence"] = build_flow_intelligence(data, holder_profiles)
    data["generated_at"] = _now_iso()

    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Phase 9 updated {DATA_FILE}")
    print("Holder profiles:", holder_profiles.get("profile_count"))
    for summary in data["flow_intelligence"].get("scope_summaries", []):
        print(
            summary.get("scope"),
            "breadth=",
            summary.get("accumulation_breadth_pct"),
            "accumulating=",
            summary.get("accumulating_count"),
            "reducing=",
            summary.get("reducing_count"),
        )


if __name__ == "__main__":
    main()
