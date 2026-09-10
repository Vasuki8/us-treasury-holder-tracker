from __future__ import annotations

import hashlib
import json
import math
import statistics

import update_data_v10 as phase10

base = phase10.base
DATA_FILE = phase10.DATA_FILE


STATIC_SECTIONS = [
    ("overview", "Overview", "Headline debt and ownership snapshot", "overviewCards"),
    ("research-brief", "Research Brief", "Rule-based summary of the strongest current tracker signals", "researchBriefPanel"),
    ("government-accounts", "Federal Government & Trust-Fund Holders", "Detailed intragovernmental Treasury investments", "govTable"),
    ("foreign-holders", "Foreign Treasury Holders", "Monthly TIC country holdings and changes", "foreignTable"),
    ("foreign-trend", "Foreign Holder 13-Month Trend", "Interactive country history chart", "foreignTrendChart"),
    ("holder-profile", "Holder Profile Explorer", "Drill down into a foreign holder, U.S. sector or primary-dealer series", "holderProfilePanel"),
    ("ownership-share", "Ownership Share Snapshot", "Source-aligned ownership-share comparisons", "shareTable"),
    ("soma", "Federal Reserve SOMA Treasury Portfolio", "Weekly SOMA Treasury holdings and CUSIPs", "somaTable"),
    ("soma-maturity", "SOMA Concentration & Maturity View", "Stored SOMA maturity-bucket concentration", "somaConcentrationChart"),
    ("institutions", "Banks & Broker-Dealer Treasury Holdings", "Quarterly Federal Reserve sector aggregates", "institutionTable"),
    ("extended-holders", "Insurance, Pensions, ETFs & Hedge Funds", "Quarterly Financial Accounts holder sectors", "extendedTable"),
    ("primary-dealers", "Primary Dealer Treasury Market Positioning", "Weekly New York Fed dealer positions and fails", "dealerTable"),
    ("movers", "Largest Holder Changes", "Latest source-cadence-aware holder changes", "moverTable"),
    ("flow-intelligence", "Cross-Holder Flow Intelligence", "Accumulation/reduction breadth and directional divergence", "flowIntelligencePanel"),
    ("flow-regimes", "Flow Regime History", "Persistent breadth regimes across official source observations", "flowRegimePanel"),
    ("security-intelligence", "CUSIP Security Intelligence", "Cross-source SOMA, auction and fund security context", "securityTable"),
    ("security-drill", "Treasury Security Drill-down", "Auction and reopening history for a selected Treasury CUSIP", "securityDrillPanel"),
    ("soma-concentration", "SOMA CUSIP Concentration Monitor", "Percent-outstanding and implied-outstanding diagnostics", "concentrationPanel"),
    ("money-market-funds", "Money-Market Funds Holding Treasuries", "SEC N-MFP direct Treasury and Treasury-repo exposure", "mmfTable"),
    ("auctions", "Treasury Auction Takedown", "Recent bidder allocation and auction statistics", "auctionTable"),
    ("domestic-sectors", "Domestic & Sector Holders", "Federal Reserve Financial Accounts Treasury holder sectors", "sectorTable"),
    ("alerts", "Unusual Change Alerts", "History-relative holder-change alert screen", "alertTable"),
    ("alert-history", "Alert Lifecycle History", "Persistent open, clear, reopen and severity-change history", "alertHistoryPanel"),
    ("alert-intelligence", "Alert Intelligence & Notification Readiness", "Percentile, robust-z and notification-ready diagnostics", "alertIntelPanel"),
    ("release-calendar", "Release Calendar & Freshness Monitor", "Expected source observations and freshness status", "releaseCalendarPanel"),
    ("publication-history", "Official Source Publication Change Log", "Detected source observation-period changes", "publicationPanel"),
    ("provenance", "Source Provenance", "Official source links, reporting periods and retrieval paths", "provenanceTable"),
    ("tracker-history", "Tracker History", "Daily compact dashboard snapshot history", "historyChart"),
    ("source-health", "Source Health", "Latest updater status for every tracked source", "sourceHealth"),
]


def _now_iso() -> str:
    return base.now_iso()


def _safe_float(value) -> float | None:
    return base.to_float(value)


def _slug(value: str) -> str:
    clean = "-".join("".join(ch.lower() if ch.isalnum() else " " for ch in value).split())
    return clean[:80] or hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def build_navigation_index(data: dict) -> dict:
    entries = []

    for key, title, subtitle, target in STATIC_SECTIONS:
        entries.append(
            {
                "id": f"section:{key}",
                "type": "section",
                "title": title,
                "subtitle": subtitle,
                "target_panel": target,
                "target_key": key,
                "keywords": f"{title} {subtitle} {key}".lower(),
            }
        )

    for profile in data.get("holder_profiles", {}).get("profiles", []) or []:
        name = str(profile.get("name") or "").strip()
        profile_id = profile.get("profile_id")
        if not name or not profile_id:
            continue
        scope = str(profile.get("scope") or "Holder")
        frequency = str(profile.get("frequency") or "")
        source_name = str(profile.get("source_name") or profile.get("source_key") or "")
        subtitle = " · ".join(part for part in (scope, frequency, source_name) if part)
        entries.append(
            {
                "id": f"holder:{profile_id}",
                "type": "holder",
                "title": name,
                "subtitle": subtitle,
                "target_panel": "holderProfilePanel",
                "target_key": profile_id,
                "scope": scope,
                "keywords": f"{name} {scope} {frequency} {source_name} {profile.get('series') or ''}".lower(),
            }
        )

    security_rows = data.get("security_intelligence", {}).get("rows", []) or []
    for row in security_rows:
        cusip = str(row.get("cusip") or "").strip().upper()
        if not cusip:
            continue
        security_type = str(row.get("security_type") or row.get("auction_security_type") or "Treasury")
        maturity = str(row.get("maturity_date") or "")
        term = str(row.get("original_security_term") or row.get("auction_security_term") or "")
        par = _safe_float(row.get("soma_par_billions"))
        subtitle = " · ".join(part for part in (security_type, term, f"matures {maturity}" if maturity else "") if part)
        entries.append(
            {
                "id": f"security:{cusip}",
                "type": "security",
                "title": cusip,
                "subtitle": subtitle,
                "target_panel": "securityDrillPanel",
                "target_key": cusip,
                "keywords": f"{cusip} {security_type} {maturity} {term} treasury soma cusip".lower(),
                "soma_par_billions": par,
            }
        )

    release_by_key = {row.get("key"): row for row in data.get("release_calendar", {}).get("rows", []) if row.get("key")}
    for source in data.get("provenance", {}).get("sources", []) or []:
        key = str(source.get("key") or "").strip()
        if not key:
            continue
        release = release_by_key.get(key, {})
        name = str(source.get("name") or release.get("name") or key)
        frequency = str(source.get("frequency") or release.get("frequency") or "")
        status = str(release.get("calendar_status") or source.get("status") or "")
        as_of = str(source.get("as_of") or release.get("last_observation") or "")
        entries.append(
            {
                "id": f"source:{key}",
                "type": "source",
                "title": name,
                "subtitle": " · ".join(part for part in (frequency, f"as of {as_of}" if as_of else "", status.replace("_", " ")) if part),
                "target_panel": "releaseCalendarPanel",
                "target_key": key,
                "keywords": f"{name} {key} {frequency} {status} {as_of} source provenance release calendar".lower(),
            }
        )

    profile_lookup = {
        (row.get("scope"), row.get("name")): row.get("profile_id")
        for row in data.get("holder_profiles", {}).get("profiles", [])
        if row.get("scope") and row.get("name")
    }
    for alert in data.get("alert_intelligence", {}).get("rows", []) or []:
        name = str(alert.get("name") or "").strip()
        if not name:
            continue
        severity = str(alert.get("severity") or "")
        diagnostic = str(alert.get("diagnostic_label") or "")
        scope = str(alert.get("scope") or "")
        alert_id = str(alert.get("alert_id") or _slug(f"{scope}-{name}-{alert.get('as_of') or ''}"))
        entries.append(
            {
                "id": f"alert:{alert_id}",
                "type": "alert",
                "title": name,
                "subtitle": " · ".join(part for part in (scope, severity, diagnostic, str(alert.get("as_of") or "")) if part),
                "target_panel": "alertIntelPanel",
                "target_key": alert_id,
                "profile_id": profile_lookup.get((alert.get("scope"), alert.get("name"))),
                "scope": scope,
                "keywords": f"{name} {scope} {severity} {diagnostic} alert anomaly unusual change".lower(),
            }
        )

    # Deterministic order keeps the static search index stable across updater runs.
    type_order = {"section": 0, "holder": 1, "security": 2, "source": 3, "alert": 4}
    entries.sort(key=lambda row: (type_order.get(row["type"], 9), row["title"].lower(), row["id"]))
    counts = {}
    for row in entries:
        counts[row["type"]] = counts.get(row["type"], 0) + 1

    return {
        "generated_at": _now_iso(),
        "entry_count": len(entries),
        "type_counts": counts,
        "entries": entries,
        "note": "Client-side command-palette index built from dashboard sections, holder profiles, Treasury CUSIPs, official sources and active alert diagnostics.",
    }


def _change_series(profile: dict) -> dict[str, float]:
    history = [
        (str(row.get("date")), _safe_float(row.get("value_billions")))
        for row in profile.get("history", []) or []
        if row.get("date") and _safe_float(row.get("value_billions")) is not None
    ]
    history.sort(key=lambda x: x[0])
    changes = {}
    for idx in range(1, len(history)):
        date_key, current = history[idx]
        _, previous = history[idx - 1]
        if previous in (None, 0) or current is None:
            continue
        changes[date_key] = (current - previous) / abs(previous) * 100.0
    return changes


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) != len(ys) or len(xs) < 2:
        return None
    mean_x = statistics.fmean(xs)
    mean_y = statistics.fmean(ys)
    dx = [x - mean_x for x in xs]
    dy = [y - mean_y for y in ys]
    denom_x = sum(v * v for v in dx)
    denom_y = sum(v * v for v in dy)
    if denom_x <= 0 or denom_y <= 0:
        return None
    value = sum(a * b for a, b in zip(dx, dy)) / math.sqrt(denom_x * denom_y)
    return max(-1.0, min(1.0, value))


def _pair_metrics(a: dict, b: dict) -> dict | None:
    a_changes = _change_series(a)
    b_changes = _change_series(b)
    dates = sorted(set(a_changes) & set(b_changes))
    if len(dates) < 6:
        return None
    xs = [a_changes[d] for d in dates]
    ys = [b_changes[d] for d in dates]
    corr = _pearson(xs, ys)
    if corr is None:
        return None

    same_direction = sum(1 for x, y in zip(xs, ys) if (x > 0 and y > 0) or (x < 0 and y < 0) or (x == 0 and y == 0))
    spread = [x - y for x, y in zip(xs, ys)]
    return {
        "pair_id": hashlib.sha256(f"{a.get('profile_id')}|{b.get('profile_id')}".encode("utf-8")).hexdigest()[:18],
        "scope": a.get("scope"),
        "profile_a_id": a.get("profile_id"),
        "profile_a_name": a.get("name"),
        "profile_b_id": b.get("profile_id"),
        "profile_b_name": b.get("name"),
        "correlation": corr,
        "overlapping_change_points": len(dates),
        "same_direction_pct": same_direction / len(dates) * 100.0,
        "median_abs_change_spread_pct_points": statistics.median(abs(v) for v in spread),
        "first_overlap": dates[0],
        "last_overlap": dates[-1],
    }


def build_holder_comovement(data: dict) -> dict:
    profiles = data.get("holder_profiles", {}).get("profiles", []) or []
    by_scope = {}
    for profile in profiles:
        if len(profile.get("history", []) or []) >= 7:
            by_scope.setdefault(profile.get("scope") or "Unknown", []).append(profile)

    scope_rows = []
    all_pairs = []
    for scope, rows in sorted(by_scope.items()):
        # Cap very large scopes by current rank. Current tracker scopes are much smaller,
        # but this keeps pairwise computation bounded as coverage expands.
        rows = sorted(rows, key=lambda p: p.get("rank_within_scope") or 9999)[:40]
        pairs = []
        for i, left in enumerate(rows):
            for right in rows[i + 1 :]:
                metric = _pair_metrics(left, right)
                if metric:
                    pairs.append(metric)
        pairs.sort(key=lambda row: row["correlation"], reverse=True)
        all_pairs.extend(pairs)
        scope_rows.append(
            {
                "scope": scope,
                "eligible_profiles": len(rows),
                "pair_count": len(pairs),
                "strongest_positive": pairs[:8],
                "lowest_correlation": list(reversed(pairs[-8:])),
                "median_correlation": statistics.median(p["correlation"] for p in pairs) if pairs else None,
            }
        )

    all_pairs.sort(key=lambda row: (row.get("scope") or "", -row.get("correlation", 0)))
    return {
        "generated_at": _now_iso(),
        "pair_count": len(all_pairs),
        "scope_count": len(scope_rows),
        "scopes": scope_rows,
        "pairs": all_pairs[:1200],
        "method": "Pearson correlation of period-to-period percentage changes, matched only on common observation dates within the same source-semantic scope. At least six overlapping change observations are required.",
        "note": "Co-movement is descriptive association, not evidence that one holder causes another holder's Treasury activity. Comparisons stay within the same holder scope so monthly, quarterly and weekly series are not mixed.",
    }


def build_discovery_summary(data: dict) -> dict:
    nav = data.get("navigation_index", {})
    comovement = data.get("holder_comovement", {})
    scope_summaries = []
    for scope in comovement.get("scopes", []):
        positive = (scope.get("strongest_positive") or [None])[0]
        low = (scope.get("lowest_correlation") or [None])[0]
        scope_summaries.append(
            {
                "scope": scope.get("scope"),
                "eligible_profiles": scope.get("eligible_profiles"),
                "pair_count": scope.get("pair_count"),
                "median_correlation": scope.get("median_correlation"),
                "strongest_pair": positive,
                "lowest_pair": low,
            }
        )
    return {
        "generated_at": _now_iso(),
        "searchable_items": nav.get("entry_count", 0),
        "comparable_pairs": comovement.get("pair_count", 0),
        "scope_summaries": scope_summaries,
        "note": "Phase 11 discovery metadata supports fast navigation and side-by-side research without changing the underlying official source data.",
    }


def main() -> None:
    phase10.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    data["navigation_index"] = build_navigation_index(data)
    data["holder_comovement"] = build_holder_comovement(data)
    data["discovery_summary"] = build_discovery_summary(data)
    data["generated_at"] = _now_iso()

    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Phase 11 updated {DATA_FILE}")
    print("Searchable navigation items:", data["navigation_index"].get("entry_count"))
    print("Comparable holder pairs:", data["holder_comovement"].get("pair_count"))
    for scope in data["holder_comovement"].get("scopes", []):
        print(scope.get("scope"), "eligible=", scope.get("eligible_profiles"), "pairs=", scope.get("pair_count"))


if __name__ == "__main__":
    main()
