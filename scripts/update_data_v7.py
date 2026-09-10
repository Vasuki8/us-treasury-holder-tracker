from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import update_data_current as phase6

base = phase6.phase5.base
DATA_FILE = phase6.phase5.DATA_FILE
AUCTIONS_URL = base.AUCTIONS_URL
AUCTIONS_SOURCE = base.AUCTIONS_SOURCE


def _now_iso() -> str:
    return base.now_iso()


def _safe_float(value) -> float | None:
    return base.to_float(value)


def _parse_date(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except Exception:
        return None


def _series_key(scope: str | None, name: str | None, period: str | None) -> str:
    return "|".join(str(x or "").strip() for x in (scope, name, period))


def _alert_id(alert: dict) -> str:
    raw = "|".join(
        str(alert.get(k) or "").strip()
        for k in ("scope", "name", "period", "as_of")
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


def _current_observations(data: dict) -> dict[str, dict]:
    observations: dict[str, dict] = {}

    for row in data.get("foreign_holders", {}).get("countries", []):
        history = row.get("history", [])
        dates = sorted(str(h.get("period")) for h in history if h.get("period"))
        if dates:
            observations[_series_key("Foreign country", row.get("name"), "MoM")] = {
                "as_of": dates[-1],
                "source_key": "foreign_holders",
            }

    for block_key, row_key in (
        ("institutional_aggregates", "institutions"),
        ("extended_holders", "holders"),
    ):
        for row in data.get(block_key, {}).get(row_key, []):
            history = row.get("history", [])
            dates = sorted(str(h.get("date")) for h in history if h.get("date"))
            as_of = row.get("as_of") or (dates[-1] if dates else None)
            if as_of:
                observations[_series_key("U.S. sector", row.get("name"), "QoQ")] = {
                    "as_of": str(as_of),
                    "source_key": block_key,
                }

    for row in data.get("primary_dealers", {}).get("series", []):
        history = row.get("history", [])
        dates = sorted(str(h.get("date")) for h in history if h.get("date"))
        as_of = row.get("as_of") or (dates[-1] if dates else None)
        if as_of:
            observations[_series_key("Primary dealer", row.get("name"), "WoW")] = {
                "as_of": str(as_of),
                "source_key": "primary_dealers",
            }

    return observations


def build_alert_history(data: dict) -> dict:
    now = _now_iso()
    current_alerts = data.get("unusual_change_alerts", {}).get("alerts", [])
    previous = data.get("alert_history", {}) if isinstance(data.get("alert_history"), dict) else {}
    episodes = {
        row.get("alert_id"): dict(row)
        for row in previous.get("episodes", [])
        if isinstance(row, dict) and row.get("alert_id")
    }
    transitions = [
        dict(row)
        for row in previous.get("transitions", [])
        if isinstance(row, dict)
    ]
    observations = _current_observations(data)
    current_ids: set[str] = set()

    for alert in current_alerts:
        alert_id = _alert_id(alert)
        current_ids.add(alert_id)
        existing = episodes.get(alert_id)
        lifecycle_event = None

        if existing is None:
            existing = {
                "alert_id": alert_id,
                "first_seen_at": now,
                "seen_count": 0,
                "cleared_at": None,
                "state": "active",
            }
            episodes[alert_id] = existing
            lifecycle_event = "opened"
        elif existing.get("state") == "cleared":
            lifecycle_event = "reopened"

        old_severity = existing.get("severity")
        for key in (
            "severity",
            "scope",
            "name",
            "period",
            "as_of",
            "previous_as_of",
            "current_billions",
            "change_billions",
            "change_pct",
            "baseline_abs_change_billions",
            "multiple_of_baseline",
            "reason",
        ):
            existing[key] = alert.get(key)

        existing["series_key"] = _series_key(alert.get("scope"), alert.get("name"), alert.get("period"))
        existing["state"] = "active"
        existing["cleared_at"] = None
        existing["last_seen_at"] = now
        existing["seen_count"] = int(existing.get("seen_count") or 0) + 1

        if lifecycle_event:
            transitions.append(
                {
                    "event": lifecycle_event,
                    "alert_id": alert_id,
                    "at": now,
                    "scope": alert.get("scope"),
                    "name": alert.get("name"),
                    "period": alert.get("period"),
                    "as_of": alert.get("as_of"),
                    "severity": alert.get("severity"),
                }
            )
        elif old_severity and old_severity != alert.get("severity"):
            transitions.append(
                {
                    "event": "severity_changed",
                    "alert_id": alert_id,
                    "at": now,
                    "scope": alert.get("scope"),
                    "name": alert.get("name"),
                    "period": alert.get("period"),
                    "as_of": alert.get("as_of"),
                    "severity": alert.get("severity"),
                    "previous_severity": old_severity,
                }
            )

        alert["alert_id"] = alert_id
        alert["first_seen_at"] = existing.get("first_seen_at")
        alert["last_seen_at"] = existing.get("last_seen_at")
        alert["seen_count"] = existing.get("seen_count")

    source_health = data.get("sources", {})
    for alert_id, episode in episodes.items():
        if alert_id in current_ids or episode.get("state") != "active":
            continue

        series_key = episode.get("series_key") or _series_key(
            episode.get("scope"), episode.get("name"), episode.get("period")
        )
        observation = observations.get(series_key)
        if not observation:
            # Do not close a signal just because a row disappeared from a failed or partial source refresh.
            continue
        source_key = observation.get("source_key")
        if (source_health.get(source_key, {}) or {}).get("status") != "ok":
            continue

        episode["state"] = "cleared"
        episode["cleared_at"] = now
        episode["last_observation_checked"] = observation.get("as_of")
        transitions.append(
            {
                "event": "cleared",
                "alert_id": alert_id,
                "at": now,
                "scope": episode.get("scope"),
                "name": episode.get("name"),
                "period": episode.get("period"),
                "as_of": episode.get("as_of"),
                "severity": episode.get("severity"),
                "replacement_observation": observation.get("as_of"),
            }
        )

    episode_rows = sorted(
        episodes.values(),
        key=lambda row: (
            0 if row.get("state") == "active" else 1,
            str(row.get("last_seen_at") or row.get("cleared_at") or row.get("first_seen_at") or ""),
        ),
        reverse=False,
    )
    # Within each state, newest first.
    active_rows = sorted(
        (r for r in episode_rows if r.get("state") == "active"),
        key=lambda r: str(r.get("last_seen_at") or ""),
        reverse=True,
    )
    cleared_rows = sorted(
        (r for r in episode_rows if r.get("state") == "cleared"),
        key=lambda r: str(r.get("cleared_at") or ""),
        reverse=True,
    )
    episode_rows = (active_rows + cleared_rows)[:500]
    transitions = sorted(transitions, key=lambda r: str(r.get("at") or ""), reverse=True)[:1000]

    return {
        "generated_at": now,
        "active_count": sum(1 for r in episode_rows if r.get("state") == "active"),
        "cleared_count": sum(1 for r in episode_rows if r.get("state") == "cleared"),
        "episode_count": len(episode_rows),
        "transition_count": len(transitions),
        "episodes": episode_rows,
        "transitions": transitions,
        "note": (
            "An alert episode is keyed by scope, series name, cadence and source observation date. "
            "The first-seen timestamp records when the tracker first detected it; it is cleared only after a healthy source refresh confirms that the episode is no longer current."
        ),
    }


def _chunks(values: list[str], size: int = 30):
    for start in range(0, len(values), size):
        yield values[start : start + size]


def _yes(value) -> bool:
    return str(value or "").strip().lower() in {"y", "yes", "true", "1"}


def _auction_history_row(row: dict) -> dict:
    return {
        "auction_date": row.get("auction_date"),
        "announcement_date": row.get("announcement_date"),
        "issue_date": row.get("issue_date"),
        "maturity_date": row.get("maturity_date"),
        "offering_billions": (_safe_float(row.get("offering_amt")) or 0.0) / 1e9,
        "bid_to_cover": _safe_float(row.get("bid_to_cover_ratio")),
        "high_yield_pct": _safe_float(row.get("high_yield")),
        "high_investment_rate_pct": _safe_float(row.get("high_investment_rate")),
        "interest_rate_pct": _safe_float(row.get("interest_rate")),
        "price": _safe_float(row.get("price")),
        "reopening": _yes(row.get("reopening")),
    }


def fetch_deep_auction_metadata(cusips: list[str]) -> dict[str, dict]:
    grouped: dict[str, list[dict]] = {}
    for chunk in _chunks(cusips, 30):
        if not chunk:
            continue
        payload = base.get_json(
            AUCTIONS_URL,
            params={
                "filter": f"cusip:in:({','.join(chunk)})",
                "sort": "-auction_date",
                "page[number]": 1,
                "page[size]": 500,
                "format": "json",
            },
        )
        for row in payload.get("data", []):
            cusip = str(row.get("cusip") or "").strip().upper()
            if cusip:
                grouped.setdefault(cusip, []).append(row)

    result: dict[str, dict] = {}
    for cusip, rows in grouped.items():
        rows = sorted(rows, key=lambda r: str(r.get("auction_date") or ""), reverse=True)
        latest = rows[0]
        issue_dates = sorted(str(r.get("issue_date")) for r in rows if r.get("issue_date"))
        original_issue = latest.get("original_issue_date") or (issue_dates[0] if issue_dates else None)
        auction_history = [_auction_history_row(row) for row in rows[:8]]
        result[cusip] = {
            "auction_count": len(rows),
            "reopening_count": sum(1 for row in rows if _yes(row.get("reopening"))),
            "latest_auction_date": latest.get("auction_date"),
            "announcement_date": latest.get("announcement_date"),
            "issue_date": latest.get("issue_date"),
            "original_issue_date": original_issue,
            "maturity_date": latest.get("maturity_date"),
            "security_type": latest.get("security_type"),
            "security_term": latest.get("security_term"),
            "original_security_term": latest.get("original_security_term"),
            "interest_rate_pct": _safe_float(latest.get("interest_rate")),
            "high_yield_pct": _safe_float(latest.get("high_yield")),
            "high_investment_rate_pct": _safe_float(latest.get("high_investment_rate")),
            "price": _safe_float(latest.get("price")),
            "bid_to_cover": _safe_float(latest.get("bid_to_cover_ratio")),
            "offering_billions": (_safe_float(latest.get("offering_amt")) or 0.0) / 1e9,
            "reopening": _yes(latest.get("reopening")),
            "auction_history": auction_history,
        }
    return result


def enrich_security_metadata(data: dict) -> dict:
    block = data.get("security_intelligence")
    if not isinstance(block, dict):
        return {"status": "skipped", "message": "security_intelligence block is unavailable"}

    rows = block.get("rows", [])
    cusips = sorted({str(row.get("cusip") or "").strip().upper() for row in rows if row.get("cusip")})
    checked_at = _now_iso()
    if not cusips:
        block["metadata_status"] = {"status": "skipped", "checked_at": checked_at, "message": "No CUSIPs available"}
        return block["metadata_status"]

    soma_by_cusip = {
        str(row.get("cusip") or "").strip().upper(): row
        for row in data.get("soma", {}).get("top_holdings", [])
        if row.get("cusip")
    }

    try:
        metadata = fetch_deep_auction_metadata(cusips)
    except Exception as exc:
        block["metadata_status"] = {
            "status": "error",
            "checked_at": checked_at,
            "message": f"{type(exc).__name__}: {exc}",
            "source_url": AUCTIONS_SOURCE,
            "api_url": AUCTIONS_URL,
        }
        return block["metadata_status"]

    as_of = _parse_date(block.get("as_of")) or datetime.now(timezone.utc).date()
    matched = 0
    maturity_mismatches = 0

    for row in rows:
        cusip = str(row.get("cusip") or "").strip().upper()
        meta = metadata.get(cusip)
        soma = soma_by_cusip.get(cusip, {})
        row["soma_coupon_rate_pct"] = _safe_float(soma.get("coupon_rate"))

        if not meta:
            row["auction_metadata_match"] = False
            continue

        matched += 1
        row["auction_metadata_match"] = True
        row["auction_count"] = meta.get("auction_count")
        row["reopening_count"] = meta.get("reopening_count")
        row["announcement_date"] = meta.get("announcement_date")
        row["issue_date"] = meta.get("issue_date")
        row["original_issue_date"] = meta.get("original_issue_date")
        row["auction_maturity_date"] = meta.get("maturity_date")
        row["auction_security_type"] = meta.get("security_type")
        row["auction_security_term"] = meta.get("security_term") or row.get("auction_security_term")
        row["original_security_term"] = meta.get("original_security_term")
        row["auction_interest_rate_pct"] = meta.get("interest_rate_pct")
        row["latest_high_yield_pct"] = meta.get("high_yield_pct")
        row["latest_high_investment_rate_pct"] = meta.get("high_investment_rate_pct")
        row["latest_auction_price"] = meta.get("price")
        row["latest_bid_to_cover"] = meta.get("bid_to_cover")
        row["auction_offering_billions"] = meta.get("offering_billions") or row.get("auction_offering_billions")
        row["latest_auction_date"] = meta.get("latest_auction_date") or row.get("latest_auction_date")
        row["latest_is_reopening"] = meta.get("reopening")
        row["auction_history"] = meta.get("auction_history", [])

        original_issue = _parse_date(meta.get("original_issue_date") or meta.get("issue_date"))
        maturity = _parse_date(row.get("maturity_date") or meta.get("maturity_date"))
        auction_maturity = _parse_date(meta.get("maturity_date"))
        soma_maturity = _parse_date(row.get("maturity_date"))

        if original_issue:
            row["security_age_years"] = max(0, (as_of - original_issue).days) / 365.25
        if original_issue and maturity and maturity > original_issue:
            total_days = (maturity - original_issue).days
            remaining_days = max(0, (maturity - as_of).days)
            row["original_term_years"] = total_days / 365.25
            row["remaining_term_pct"] = remaining_days / total_days * 100.0

        if auction_maturity and soma_maturity:
            same = auction_maturity == soma_maturity
            row["maturity_consistency"] = "match" if same else "mismatch"
            if not same:
                maturity_mismatches += 1
        else:
            row["maturity_consistency"] = "unknown"

        keys = list(row.get("source_keys", []))
        if "auctions" not in keys:
            keys.append("auctions")
        row["source_keys"] = keys

    coverage = matched / len(rows) * 100.0 if rows else None
    block["auction_metadata_matches"] = matched
    block["auction_metadata_coverage_pct"] = coverage
    block["maturity_mismatch_count"] = maturity_mismatches
    block["metadata_source_url"] = AUCTIONS_SOURCE
    block["metadata_api_url"] = AUCTIONS_URL
    block["metadata_status"] = {
        "status": "ok",
        "checked_at": checked_at,
        "matched_cusips": matched,
        "requested_cusips": len(cusips),
        "coverage_pct": coverage,
        "maturity_mismatch_count": maturity_mismatches,
        "source_url": AUCTIONS_SOURCE,
        "api_url": AUCTIONS_URL,
        "message": (
            "Treasury auction history is queried in CUSIP batches. Security drill-down fields include issue/original issue dates, term, coupon/rate context, auction history, reopenings and maturity cross-checks."
        ),
    }
    return block["metadata_status"]


def main() -> None:
    phase6.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    data["alert_history"] = build_alert_history(data)
    enrich_security_metadata(data)
    data["generated_at"] = _now_iso()

    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Phase 7 updated {DATA_FILE}")
    print(
        "Alert lifecycle:",
        data.get("alert_history", {}).get("active_count"),
        "active /",
        data.get("alert_history", {}).get("cleared_count"),
        "cleared",
    )
    print("Security metadata:", data.get("security_intelligence", {}).get("metadata_status", {}))


if __name__ == "__main__":
    main()
