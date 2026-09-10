from __future__ import annotations

import calendar
import hashlib
import json
import math
import re
from datetime import date, datetime, timedelta

import update_data_v9 as phase9

base = phase9.base
DATA_FILE = phase9.DATA_FILE


RELEASE_SPECS = {
    "overview": {
        "kind": "business_daily",
        "label": "Debt to the Penny",
        "grace_days": 1,
        "method": "Next weekday after the latest debt observation; publication expectation allows one extra calendar day.",
    },
    "fed": {
        "kind": "weekly_thursday",
        "label": "Federal Reserve H.4.1 Treasury holdings",
        "grace_days": 1,
        "method": "Next Wednesday observation, normally published Thursday.",
    },
    "foreign_holders": {
        "kind": "tic_monthly",
        "label": "Treasury International Capital foreign holdings",
        "grace_days": 3,
        "method": "Next monthly observation; expected-publication date is a tracker estimate centered on the middle of the second following month.",
    },
    "domestic_sectors": {
        "kind": "financial_accounts_quarterly",
        "label": "Federal Reserve Financial Accounts holder sectors",
        "grace_days": 7,
        "method": "Next quarter-end observation with an estimated publication lag of about 72 days.",
    },
    "soma": {
        "kind": "weekly_thursday",
        "label": "New York Fed SOMA holdings",
        "grace_days": 1,
        "method": "Next Wednesday SOMA observation, normally published Thursday.",
    },
    "money_market_funds": {
        "kind": "nmfp_monthly",
        "label": "SEC Form N-MFP",
        "grace_days": 4,
        "method": "Next month-end report with an estimated public-data availability window roughly one week into the following month.",
    },
    "auctions": {
        "kind": "event_driven",
        "label": "Treasury auction results",
        "grace_days": 0,
        "method": "Event-driven auction data; no fixed next-observation date is inferred.",
    },
    "institutional_aggregates": {
        "kind": "financial_accounts_quarterly",
        "label": "Bank and broker-dealer Treasury holdings",
        "grace_days": 7,
        "method": "Quarterly Financial Accounts series; estimated publication lag is about 72 days after quarter end.",
    },
    "primary_dealers": {
        "kind": "weekly_thursday",
        "label": "New York Fed primary-dealer statistics",
        "grace_days": 1,
        "method": "Weekly series; next observation is estimated one week after the current observation with a one-day publication lag.",
    },
    "extended_holders": {
        "kind": "financial_accounts_quarterly",
        "label": "Insurance, pension, ETF and hedge-fund holdings",
        "grace_days": 7,
        "method": "Quarterly Financial Accounts series; estimated publication lag is about 72 days after quarter end.",
    },
    "nport": {
        "kind": "access_limited",
        "label": "SEC Form N-PORT bulk cache",
        "grace_days": 0,
        "method": "Separate bulk-data workflow; hosted-runner SEC access can prevent automated ingestion, so lateness is not inferred from the cache alone.",
    },
    "government_accounts": {
        "kind": "mts_monthly",
        "label": "Monthly Treasury Statement government accounts",
        "grace_days": 4,
        "method": "Next month-end observation with an estimated release window around the 12th calendar day of the following month.",
    },
}


def _now_iso() -> str:
    return base.now_iso()


def _utc_today(data: dict) -> date:
    raw = str(data.get("generated_at") or _now_iso())[:10]
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return datetime.utcnow().date()


def _month_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def _add_months(d: date, months: int) -> date:
    index = d.year * 12 + (d.month - 1) + months
    year, month0 = divmod(index, 12)
    return date(year, month0 + 1, min(d.day, calendar.monthrange(year, month0 + 1)[1]))


def _next_weekday(d: date) -> date:
    out = d + timedelta(days=1)
    while out.weekday() >= 5:
        out += timedelta(days=1)
    return out


def _business_adjust_forward(d: date) -> date:
    out = d
    while out.weekday() >= 5:
        out += timedelta(days=1)
    return out


def _parse_observation(value) -> date | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    m = re.fullmatch(r"(\d{4})[-: ]?Q([1-4])", text, flags=re.I)
    if m:
        year = int(m.group(1))
        quarter = int(m.group(2))
        month = quarter * 3
        return _month_end(year, month)

    m = re.fullmatch(r"(\d{4})-(\d{2})", text)
    if m:
        return _month_end(int(m.group(1)), int(m.group(2)))

    for fmt in ("%Y-%m-%d", "%b %d, %Y", "%B %d, %Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def _calendar_dates(kind: str, observed: date | None) -> tuple[date | None, date | None]:
    if observed is None:
        return None, None

    if kind == "business_daily":
        next_obs = _next_weekday(observed)
        return next_obs, _business_adjust_forward(next_obs + timedelta(days=1))

    if kind == "weekly_thursday":
        next_obs = observed + timedelta(days=7)
        return next_obs, _business_adjust_forward(next_obs + timedelta(days=1))

    if kind == "tic_monthly":
        next_obs = _month_end(_add_months(observed.replace(day=1), 1).year, _add_months(observed.replace(day=1), 1).month)
        release_month = _add_months(next_obs.replace(day=1), 2)
        expected = _business_adjust_forward(date(release_month.year, release_month.month, 16))
        return next_obs, expected

    if kind == "financial_accounts_quarterly":
        next_obs = _month_end(_add_months(observed.replace(day=1), 3).year, _add_months(observed.replace(day=1), 3).month)
        expected = _business_adjust_forward(next_obs + timedelta(days=72))
        return next_obs, expected

    if kind == "mts_monthly":
        month1 = _add_months(observed.replace(day=1), 1)
        next_obs = _month_end(month1.year, month1.month)
        release_month = _add_months(next_obs.replace(day=1), 1)
        expected = _business_adjust_forward(date(release_month.year, release_month.month, 12))
        return next_obs, expected

    if kind == "nmfp_monthly":
        month1 = _add_months(observed.replace(day=1), 1)
        next_obs = _month_end(month1.year, month1.month)
        expected = _business_adjust_forward(next_obs + timedelta(days=8))
        return next_obs, expected

    return None, None


def _fresh_release_keys(data: dict, today: date) -> set[str]:
    keys = set()
    for row in data.get("publication_history", {}).get("events", []) or []:
        at = str(row.get("at") or "")
        if at[:10] == today.isoformat() and row.get("key"):
            keys.add(str(row["key"]))
    return keys


def build_release_calendar(data: dict) -> dict:
    today = _utc_today(data)
    fresh_keys = _fresh_release_keys(data, today)
    latest = data.get("publication_history", {}).get("latest", []) or []
    rows = []

    for source in latest:
        key = str(source.get("key") or "")
        if not key:
            continue
        spec = RELEASE_SPECS.get(key, {"kind": "unscheduled", "label": source.get("name") or key, "grace_days": 0, "method": "No release heuristic configured."})
        kind = spec["kind"]
        observed = _parse_observation(source.get("as_of"))
        next_obs, expected = _calendar_dates(kind, observed)
        source_status = str(source.get("status") or "unknown")
        grace_days = int(spec.get("grace_days") or 0)
        days_to_expected = (expected - today).days if expected else None
        overdue_days = max(0, (today - (expected + timedelta(days=grace_days))).days) if expected else None

        if key in fresh_keys and source_status == "ok":
            status = "new_release"
        elif source_status == "error":
            status = "source_error"
        elif source_status == "pending" or kind == "access_limited":
            status = "access_limited"
        elif kind == "event_driven":
            status = "event_driven"
        elif expected is None:
            status = "unscheduled"
        elif today > expected + timedelta(days=grace_days):
            status = "overdue"
        elif today > expected:
            status = "grace_window"
        elif days_to_expected is not None and days_to_expected <= 1:
            status = "due_now"
        elif days_to_expected is not None and days_to_expected <= 7:
            status = "due_soon"
        else:
            status = "scheduled"

        rows.append(
            {
                "key": key,
                "name": source.get("name") or spec.get("label") or key,
                "schedule_kind": kind,
                "frequency": source.get("frequency"),
                "source_status": source_status,
                "last_observation": source.get("as_of"),
                "last_checked_at": source.get("checked_at"),
                "expected_next_observation": next_obs.isoformat() if next_obs else None,
                "expected_publication_date": expected.isoformat() if expected else None,
                "days_to_expected": days_to_expected,
                "grace_days": grace_days,
                "overdue_days": overdue_days,
                "calendar_status": status,
                "method": spec.get("method"),
                "is_estimate": kind not in {"event_driven", "access_limited", "unscheduled"},
            }
        )

    order = {
        "overdue": 0,
        "source_error": 1,
        "due_now": 2,
        "grace_window": 3,
        "due_soon": 4,
        "new_release": 5,
        "scheduled": 6,
        "access_limited": 7,
        "event_driven": 8,
        "unscheduled": 9,
    }
    rows.sort(key=lambda r: (order.get(r["calendar_status"], 99), r.get("expected_publication_date") or "9999-12-31", r["name"]))

    counts = {}
    for row in rows:
        counts[row["calendar_status"]] = counts.get(row["calendar_status"], 0) + 1

    actionable = [r for r in rows if r["calendar_status"] in {"overdue", "source_error", "due_now", "grace_window", "due_soon"}]
    return {
        "generated_at": _now_iso(),
        "today": today.isoformat(),
        "source_count": len(rows),
        "status_counts": counts,
        "attention_count": len(actionable),
        "rows": rows,
        "attention": actionable,
        "note": (
            "Release dates in this panel are tracker estimates derived from each source's normal cadence and latest observation. "
            "They are operational freshness diagnostics, not publisher commitments. Weekday adjustment does not model U.S. federal holidays. "
            "Event-driven auction data and SEC bulk feeds with access limitations are not labeled overdue from cadence alone."
        ),
    }


def _regime_label(breadth: float | None) -> str:
    if breadth is None:
        return "insufficient data"
    if breadth >= 70:
        return "broad accumulation"
    if breadth >= 55:
        return "accumulation tilt"
    if breadth <= 30:
        return "broad reduction"
    if breadth <= 45:
        return "reduction tilt"
    return "mixed"


def _regime_signature(scope: str, summary: dict) -> str:
    payload = "|".join(
        [
            scope,
            ",".join(sorted(str(x) for x in summary.get("observation_dates", []) if x)),
            str(summary.get("accumulating_count")),
            str(summary.get("reducing_count")),
            str(summary.get("flat_count")),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


def _cross_regime(foreign: float | None, domestic: float | None) -> tuple[str, float | None]:
    if foreign is None or domestic is None:
        return "insufficient data", None
    gap = domestic - foreign
    if abs(gap) >= 30:
        return ("domestic accumulation stronger" if gap > 0 else "foreign accumulation stronger"), abs(gap)
    if foreign >= 60 and domestic >= 60:
        return "broad cross-scope accumulation", min(foreign, domestic)
    if foreign <= 40 and domestic <= 40:
        return "broad cross-scope reduction", 100.0 - max(foreign, domestic)
    return "mixed cross-scope", abs(gap)


def build_flow_regime_history(data: dict) -> dict:
    now = _now_iso()
    previous = data.get("flow_regime_history", {})
    events = [dict(row) for row in previous.get("events", []) if isinstance(row, dict)]
    cross_events = [dict(row) for row in previous.get("cross_scope_events", []) if isinstance(row, dict)]
    seen = {str(row.get("signature")) for row in events if row.get("signature")}
    cross_seen = {str(row.get("signature")) for row in cross_events if row.get("signature")}

    summaries = data.get("flow_intelligence", {}).get("scope_summaries", []) or []
    new_events = 0
    current = []

    for summary in summaries:
        scope = str(summary.get("scope") or "Unknown")
        signature = _regime_signature(scope, summary)
        breadth = phase9._safe_float(summary.get("accumulation_breadth_pct"))
        regime = _regime_label(breadth)
        previous_scope_events = [row for row in events if row.get("scope") == scope]
        previous_event = previous_scope_events[-1] if previous_scope_events else None
        event = {
            "event_id": hashlib.sha256(f"{scope}|{signature}".encode("utf-8")).hexdigest()[:18],
            "signature": signature,
            "scope": scope,
            "concept": summary.get("concept"),
            "observation_dates": summary.get("observation_dates", []),
            "frequencies": summary.get("frequencies", []),
            "detected_at": now,
            "regime": regime,
            "accumulation_breadth_pct": breadth,
            "momentum_score": breadth - 50.0 if breadth is not None else None,
            "accumulating_count": summary.get("accumulating_count"),
            "reducing_count": summary.get("reducing_count"),
            "flat_count": summary.get("flat_count"),
            "median_change_pct": summary.get("median_change_pct"),
            "reported_total_change_billions": summary.get("reported_total_change_billions"),
            "previous_regime": previous_event.get("regime") if previous_event else None,
            "breadth_change_pp": (
                breadth - phase9._safe_float(previous_event.get("accumulation_breadth_pct"))
                if previous_event and breadth is not None and phase9._safe_float(previous_event.get("accumulation_breadth_pct")) is not None
                else None
            ),
        }
        event["regime_changed"] = bool(previous_event and previous_event.get("regime") != regime)
        if signature not in seen:
            events.append(event)
            seen.add(signature)
            new_events += 1
        else:
            # Use the stored timestamp for the matching observation-regime point.
            stored = next((row for row in reversed(events) if row.get("signature") == signature), event)
            event["detected_at"] = stored.get("detected_at")
            event["previous_regime"] = stored.get("previous_regime")
            event["breadth_change_pp"] = stored.get("breadth_change_pp")
            event["regime_changed"] = stored.get("regime_changed", False)
        current.append(event)

    events = events[-1500:]

    # Count consecutive source observations in the current regime for each scope.
    for row in current:
        same_scope = [e for e in events if e.get("scope") == row["scope"]]
        duration = 0
        for event in reversed(same_scope):
            if event.get("regime") != row.get("regime"):
                break
            duration += 1
        row["regime_duration_observations"] = duration

    by_scope = {row["scope"]: row for row in current}
    foreign = phase9._safe_float((by_scope.get("Foreign country") or {}).get("accumulation_breadth_pct"))
    domestic = phase9._safe_float((by_scope.get("U.S. sector") or {}).get("accumulation_breadth_pct"))
    foreign_sig = (by_scope.get("Foreign country") or {}).get("signature")
    domestic_sig = (by_scope.get("U.S. sector") or {}).get("signature")
    if foreign_sig or domestic_sig:
        cross_signature = hashlib.sha256(f"{foreign_sig}|{domestic_sig}".encode("utf-8")).hexdigest()[:20]
        regime, strength = _cross_regime(foreign, domestic)
        previous_cross = cross_events[-1] if cross_events else None
        cross_event = {
            "event_id": hashlib.sha256(f"cross|{cross_signature}".encode("utf-8")).hexdigest()[:18],
            "signature": cross_signature,
            "detected_at": now,
            "regime": regime,
            "strength_pct_points": strength,
            "foreign_breadth_pct": foreign,
            "us_sector_breadth_pct": domestic,
            "divergence_pct_points": (domestic - foreign) if foreign is not None and domestic is not None else None,
            "foreign_observation_dates": (by_scope.get("Foreign country") or {}).get("observation_dates", []),
            "us_sector_observation_dates": (by_scope.get("U.S. sector") or {}).get("observation_dates", []),
            "previous_regime": previous_cross.get("regime") if previous_cross else None,
        }
        cross_event["regime_changed"] = bool(previous_cross and previous_cross.get("regime") != regime)
        if cross_signature not in cross_seen:
            cross_events.append(cross_event)
        else:
            stored = next((row for row in reversed(cross_events) if row.get("signature") == cross_signature), cross_event)
            cross_event["detected_at"] = stored.get("detected_at")
            cross_event["previous_regime"] = stored.get("previous_regime")
            cross_event["regime_changed"] = stored.get("regime_changed", False)
    else:
        cross_event = None

    return {
        "generated_at": now,
        "initialized": True,
        "baseline_initialized_at": previous.get("baseline_initialized_at") or now,
        "event_count": len(events),
        "new_event_count": new_events,
        "events": events,
        "current": current,
        "cross_scope_event_count": len(cross_events),
        "cross_scope_events": cross_events[-500:],
        "current_cross_scope": cross_event,
        "note": (
            "A regime point is added only when a scope advances to a new source observation signature. Daily updater runs do not create duplicate regime history. "
            "Breadth is calculated within each source cadence; the cross-scope regime compares direction only and never adds monthly TIC flows to quarterly Financial Accounts changes."
        ),
    }


def _fmt_signed_billions(value) -> str:
    number = phase9._safe_float(value)
    if number is None:
        return "—"
    sign = "+" if number >= 0 else ""
    return f"{sign}${number:,.1f}B"


def build_research_brief(data: dict) -> dict:
    items = []
    flow = data.get("flow_intelligence", {})
    for signal in flow.get("signals", [])[:2]:
        items.append(
            {
                "category": "Cross-holder flow",
                "severity": "attention",
                "title": signal.get("label") or "Cross-scope flow signal",
                "text": signal.get("description"),
                "caveat": signal.get("caveat"),
            }
        )

    total_history = data.get("foreign_holders", {}).get("grand_total_history", []) or []
    if len(total_history) >= 2:
        current = phase9._safe_float(total_history[0].get("holdings_billions"))
        previous = phase9._safe_float(total_history[1].get("holdings_billions"))
        if current is not None and previous is not None:
            change = current - previous
            items.append(
                {
                    "category": "Foreign demand",
                    "severity": "positive" if change > 0 else "negative" if change < 0 else "neutral",
                    "title": "Reported foreign Treasury holdings changed in the latest TIC month",
                    "text": f"Total reported foreign Treasury holdings moved {_fmt_signed_billions(change)} to ${current:,.1f}B in {total_history[0].get('period') or 'the latest month'}.",
                    "caveat": "TIC country attribution can reflect custodial location and is monthly, not a real-time flow measure.",
                }
            )

    alerts = sorted(
        data.get("alert_intelligence", {}).get("rows", []) or [],
        key=lambda row: abs(phase9._safe_float(row.get("diagnostic_score")) or 0),
        reverse=True,
    )
    if alerts:
        row = alerts[0]
        pct = phase9._safe_float(row.get("abs_change_percentile"))
        z = phase9._safe_float(row.get("robust_z"))
        detail = f"{row.get('name')} changed {_fmt_signed_billions(row.get('change_billions'))} in its latest {row.get('period') or 'reported'} move"
        if pct is not None:
            detail += f", ranking at the {pct:.0f}th percentile of stored absolute changes"
        if z is not None and math.isfinite(z):
            detail += f" with robust z {z:.2f}"
        detail += "."
        items.append(
            {
                "category": "Anomaly monitor",
                "severity": "negative" if row.get("severity") == "high" else "attention",
                "title": f"{row.get('severity', 'Current').title()} unusual-change signal: {row.get('name')}",
                "text": detail,
                "caveat": "The anomaly screen identifies unusual reported changes; it does not identify causation or predict market direction.",
            }
        )

    concentration = data.get("security_concentration", {}).get("top_concentrations", []) or []
    if concentration:
        row = concentration[0]
        pct = phase9._safe_float(row.get("soma_pct_outstanding"))
        if pct is not None:
            items.append(
                {
                    "category": "SOMA concentration",
                    "severity": "attention" if pct >= 50 else "neutral",
                    "title": f"Largest stored SOMA share: {row.get('cusip')}",
                    "text": f"SOMA holds about {pct:.1f}% of the reported outstanding amount for this stored Treasury CUSIP, with ${phase9._safe_float(row.get('soma_par_billions')) or 0:,.1f}B par in the tracker.",
                    "caveat": "The concentration ranking covers the stored SOMA CUSIP universe, not every outstanding Treasury security.",
                }
            )

    release = data.get("release_calendar", {})
    attention = release.get("attention", []) or []
    if attention:
        overdue = [r for r in attention if r.get("calendar_status") == "overdue"]
        errors = [r for r in attention if r.get("calendar_status") == "source_error"]
        due = [r for r in attention if r.get("calendar_status") in {"due_now", "grace_window", "due_soon"}]
        title = "Source calendar needs attention"
        text = f"{len(overdue)} estimated overdue, {len(errors)} source-error and {len(due)} due/due-soon dataset checks are currently flagged."
        items.append(
            {
                "category": "Data freshness",
                "severity": "negative" if overdue or errors else "attention",
                "title": title,
                "text": text,
                "caveat": "Expected release dates are cadence-based tracker estimates and are not official publisher commitments.",
            }
        )

    return {
        "generated_at": _now_iso(),
        "item_count": len(items[:6]),
        "items": items[:6],
        "note": "Rule-based research brief generated only from the official-data blocks already present in the tracker. It is descriptive, not investment advice or a forecast.",
    }


def main() -> None:
    phase9.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    data["release_calendar"] = build_release_calendar(data)
    data["flow_regime_history"] = build_flow_regime_history(data)
    data["research_brief"] = build_research_brief(data)
    data["generated_at"] = _now_iso()

    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Phase 10 updated {DATA_FILE}")
    print("Release-calendar attention:", data["release_calendar"].get("attention_count"))
    print("Flow-regime events:", data["flow_regime_history"].get("event_count"), "new:", data["flow_regime_history"].get("new_event_count"))
    print("Research-brief items:", data["research_brief"].get("item_count"))


if __name__ == "__main__":
    main()
