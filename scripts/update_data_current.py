from __future__ import annotations

import calendar
import json
import statistics
from datetime import datetime, timezone

import update_data_v5 as phase5

_original_fetch_government_accounts = phase5.fetch_government_accounts


def fetch_government_accounts_normalized() -> dict:
    data = _original_fetch_government_accounts()

    # Fiscal Data's MTS API returns close_month_acct_bal_amt as dollar amounts,
    # while the published Schedule D report is displayed in $ millions. The
    # Phase-5 collector initially treated the API values as millions. Convert
    # its temporary /1000 representation to dollars->billions (/1e9).
    scale = 1e-6
    rows = []
    grand_total_billions = 0.0

    for row in data.get("holders", []):
        normalized = dict(row)
        normalized["holdings_billions"] = (row.get("holdings_billions") or 0.0) * scale
        if str(row.get("name") or "").strip().lower() == "grand total":
            grand_total_billions += normalized["holdings_billions"]
            continue
        rows.append(normalized)

    data["holders"] = rows
    data["holder_count"] = max(
        0,
        int(data.get("holder_count") or len(rows)) - (1 if grand_total_billions else 0),
    )
    data["leaf_total_billions"] = max(
        0.0,
        (data.get("leaf_total_billions") or 0.0) * scale - grand_total_billions,
    )

    for key in (
        "social_security_billions",
        "medicare_billions",
        "federal_retirement_billions",
    ):
        if data.get(key) is not None:
            data[key] = data[key] * scale

    data["note"] = (
        "Detailed federal and trust-fund investments in Government Account Series and other federal securities. "
        "API dollar balances are normalized to billions; category totals and Grand Total are excluded from the leaf-line sum to reduce double-counting."
    )
    return data


def _target_date(as_of: str | None) -> str | None:
    if not as_of:
        return None
    text = str(as_of)
    if len(text) == 7 and text[4] == "-":
        year, month = map(int, text.split("-"))
        day = calendar.monthrange(year, month)[1]
        return f"{year:04d}-{month:02d}-{day:02d}"
    return text[:10]


def _debt_snapshot_on_or_before(as_of: str | None) -> dict:
    target = _target_date(as_of)
    if not target:
        return {}
    payload = phase5.base.get_json(
        phase5.base.DEBT_URL,
        params={
            "filter": f"record_date:lte:{target}",
            "sort": "-record_date",
            "page[number]": 1,
            "page[size]": 1,
            "format": "json",
        },
    )
    rows = payload.get("data", [])
    if not rows:
        return {}
    row = rows[0]
    return {
        "as_of": row.get("record_date"),
        "public_billions": (phase5.base.to_float(row.get("debt_held_public_amt")) or 0.0) / 1e9,
        "intragov_billions": (phase5.base.to_float(row.get("intragov_hold_amt")) or 0.0) / 1e9,
    }


def build_ownership_shares_aligned(data: dict) -> dict:
    foreign = data.get("foreign_holders", {})
    fed = data.get("fed", {})
    soma = data.get("soma", {})
    government = data.get("government_accounts", {})

    foreign_debt = _debt_snapshot_on_or_before(foreign.get("as_of"))
    fed_debt = _debt_snapshot_on_or_before(fed.get("as_of"))
    soma_debt = _debt_snapshot_on_or_before(soma.get("as_of"))
    gov_debt = _debt_snapshot_on_or_before(government.get("as_of"))

    def share(value, denominator):
        if value is None or denominator in (None, 0):
            return None
        return value / denominator * 100.0

    specifications = [
        (
            "Foreign holders (TIC)",
            foreign.get("grand_total_billions"),
            "Debt held by public",
            foreign_debt.get("public_billions"),
            foreign_debt.get("as_of"),
        ),
        (
            "Federal Reserve H.4.1",
            fed.get("treasury_holdings_billions"),
            "Debt held by public",
            fed_debt.get("public_billions"),
            fed_debt.get("as_of"),
        ),
        (
            "Federal Reserve SOMA par",
            soma.get("treasury_total_billions"),
            "Debt held by public",
            soma_debt.get("public_billions"),
            soma_debt.get("as_of"),
        ),
        (
            "Detailed government-account leaf lines",
            government.get("leaf_total_billions"),
            "Intragovernmental holdings",
            gov_debt.get("intragov_billions"),
            gov_debt.get("as_of"),
        ),
    ]

    rows = []
    for name, value, denominator_name, denominator_value, denominator_date in specifications:
        rows.append(
            {
                "name": name,
                "holdings_billions": value,
                "denominator": denominator_name,
                "denominator_billions": denominator_value,
                "denominator_as_of": denominator_date,
                "share_pct": share(value, denominator_value),
            }
        )

    return {
        "rows": rows,
        "note": (
            "Each share uses a Debt to the Penny denominator from the same observation date, or the latest business day on or before it. "
            "Categories still should not be summed because source definitions and valuation bases differ."
        ),
    }


def _sorted_history(history: list[dict], date_keys=("date", "period"), value_keys=("value_billions", "holdings_billions")) -> list[tuple[str, float]]:
    rows = []
    for item in history or []:
        date_value = next((item.get(k) for k in date_keys if item.get(k)), None)
        value = next((item.get(k) for k in value_keys if item.get(k) is not None), None)
        if date_value is None or value is None:
            continue
        try:
            rows.append((str(date_value), float(value)))
        except (TypeError, ValueError):
            continue
    return sorted(rows, key=lambda x: x[0])


def _change_profile(history: list[dict]) -> dict:
    rows = _sorted_history(history)
    if len(rows) < 2:
        return {}
    changes = [rows[i][1] - rows[i - 1][1] for i in range(1, len(rows))]
    current_change = changes[-1]
    historical_abs = [abs(x) for x in changes[:-1] if x is not None]
    baseline = statistics.median(historical_abs) if historical_abs else None
    previous = rows[-2][1]
    pct = (current_change / abs(previous) * 100.0) if previous else None
    return {
        "current": rows[-1][1],
        "change": current_change,
        "change_pct": pct,
        "baseline_abs_change": baseline,
        "multiple_of_baseline": (abs(current_change) / baseline) if baseline not in (None, 0) else None,
        "as_of": rows[-1][0],
        "previous_as_of": rows[-2][0],
    }


def _maybe_alert(alerts: list[dict], *, scope: str, name: str, period: str, history: list[dict], absolute_floor: float) -> None:
    profile = _change_profile(history)
    if not profile:
        return
    change = profile.get("change")
    multiple = profile.get("multiple_of_baseline")
    pct = profile.get("change_pct")
    if change is None or abs(change) < absolute_floor:
        return

    unusual = (multiple is not None and multiple >= 2.5) or (pct is not None and abs(pct) >= 10.0)
    if not unusual:
        return

    severity = "high" if ((multiple is not None and multiple >= 4.0) or (pct is not None and abs(pct) >= 20.0)) else "medium"
    reason_parts = []
    if multiple is not None:
        reason_parts.append(f"{multiple:.1f}× the median absolute change in the available history")
    if pct is not None:
        reason_parts.append(f"{pct:+.1f}% versus the previous observation")

    alerts.append(
        {
            "severity": severity,
            "scope": scope,
            "name": name,
            "period": period,
            "as_of": profile.get("as_of"),
            "previous_as_of": profile.get("previous_as_of"),
            "current_billions": profile.get("current"),
            "change_billions": change,
            "change_pct": pct,
            "baseline_abs_change_billions": profile.get("baseline_abs_change"),
            "multiple_of_baseline": multiple,
            "reason": "; ".join(reason_parts),
        }
    )


def build_unusual_change_alerts(data: dict) -> dict:
    alerts = []

    for row in data.get("foreign_holders", {}).get("countries", []):
        _maybe_alert(
            alerts,
            scope="Foreign country",
            name=row.get("name") or "Unknown country",
            period="MoM",
            history=row.get("history", []),
            absolute_floor=15.0,
        )

    for row in data.get("institutional_aggregates", {}).get("institutions", []):
        _maybe_alert(
            alerts,
            scope="U.S. sector",
            name=row.get("name") or "Unknown sector",
            period="QoQ",
            history=row.get("history", []),
            absolute_floor=20.0,
        )

    for row in data.get("extended_holders", {}).get("holders", []):
        _maybe_alert(
            alerts,
            scope="U.S. sector",
            name=row.get("name") or "Unknown sector",
            period="QoQ",
            history=row.get("history", []),
            absolute_floor=20.0,
        )

    for row in data.get("primary_dealers", {}).get("series", []):
        _maybe_alert(
            alerts,
            scope="Primary dealer",
            name=row.get("name") or "Unknown dealer series",
            period="WoW",
            history=row.get("history", []),
            absolute_floor=10.0,
        )

    alerts.sort(
        key=lambda x: (
            0 if x.get("severity") == "high" else 1,
            -(x.get("multiple_of_baseline") or 0),
            -abs(x.get("change_billions") or 0),
        )
    )
    return {
        "alerts": alerts[:30],
        "alert_count": len(alerts),
        "high_count": sum(1 for x in alerts if x.get("severity") == "high"),
        "method": (
            "A change is flagged when it clears a source-specific absolute dollar floor and is either at least 2.5× the median absolute change in the available history or at least 10% versus the previous observation. "
            "High severity begins at 4× the historical median or 20%. This is a statistical screening rule, not a prediction."
        ),
    }


def build_provenance(data: dict) -> dict:
    names = {
        "overview": "Treasury Fiscal Data — Debt to the Penny",
        "fed": "Federal Reserve H.4.1",
        "foreign_holders": "Treasury International Capital",
        "domestic_sectors": "Federal Reserve Financial Accounts",
        "soma": "New York Fed SOMA",
        "money_market_funds": "SEC Form N-MFP",
        "auctions": "Treasury Securities Auctions",
        "institutional_aggregates": "Federal Reserve Banks & Dealers",
        "primary_dealers": "New York Fed Primary Dealer Statistics",
        "extended_holders": "Federal Reserve Insurance / Pensions / ETFs / Hedge Funds",
        "nport": "SEC Form N-PORT quarterly cache",
        "government_accounts": "Treasury Monthly Treasury Statement — Government Accounts",
    }

    sources = []
    for key, display_name in names.items():
        section = data.get(key, {}) or {}
        status = data.get("sources", {}).get(key, {}) or {}
        urls = []
        for label, field in (
            ("Official source", "source_url"),
            ("Retrieval source", "retrieval_url"),
            ("API", "api_url"),
            ("Archive", "source_archive"),
            ("Dataset page", "dataset_page"),
            ("Latest archive", "latest_archive_url"),
        ):
            value = section.get(field)
            if value and value not in {u["url"] for u in urls}:
                urls.append({"label": label, "url": value})
        sources.append(
            {
                "key": key,
                "name": display_name,
                "as_of": section.get("as_of") or section.get("observation_date") or section.get("quarter"),
                "frequency": section.get("frequency"),
                "status": status.get("status", "unknown"),
                "checked_at": status.get("checked_at"),
                "message": status.get("message"),
                "urls": urls,
            }
        )

    series = []
    for section_key, row_key, rows in (
        ("domestic_sectors", "holders", data.get("domestic_sectors", {}).get("holders", [])),
        ("institutional_aggregates", "institutions", data.get("institutional_aggregates", {}).get("institutions", [])),
        ("extended_holders", "holders", data.get("extended_holders", {}).get("holders", [])),
        ("primary_dealers", "series", data.get("primary_dealers", {}).get("series", [])),
    ):
        _ = row_key
        for row in rows:
            series_id = row.get("fred_series") or row.get("series") or row.get("keyid")
            if not series_id:
                continue
            source_url = None
            if str(series_id).startswith("BOGZ1"):
                source_url = f"https://fred.stlouisfed.org/series/{series_id}"
            else:
                source_url = (data.get(section_key, {}) or {}).get("source_url") or (data.get(section_key, {}) or {}).get("retrieval_url")
            series.append(
                {
                    "section": section_key,
                    "name": row.get("name"),
                    "series": series_id,
                    "as_of": row.get("as_of") or (data.get(section_key, {}) or {}).get("as_of"),
                    "source_url": source_url,
                }
            )

    return {
        "generated_at": phase5.base.now_iso(),
        "source_count": len(sources),
        "series_count": len(series),
        "sources": sources,
        "series": series,
        "note": "Provenance records the official source, observation date, retrieval path and latest health check separately so stale-but-valid observations are distinguishable from failed fetches.",
    }


def enrich_security_audit(data: dict) -> None:
    block = data.get("security_intelligence")
    if not isinstance(block, dict):
        return
    as_of = block.get("as_of")
    try:
        as_of_date = datetime.fromisoformat(str(as_of)[:10]).date()
    except Exception:
        as_of_date = datetime.now(timezone.utc).date()

    for row in block.get("rows", []):
        maturity = row.get("maturity_date")
        if maturity:
            try:
                maturity_date = datetime.fromisoformat(str(maturity)[:10]).date()
                days = (maturity_date - as_of_date).days
                row["days_to_maturity"] = days
                row["years_to_maturity"] = days / 365.25
            except Exception:
                row["days_to_maturity"] = None
                row["years_to_maturity"] = None
        auction_date = row.get("latest_auction_date")
        if auction_date:
            try:
                row["auction_recency_days"] = (as_of_date - datetime.fromisoformat(str(auction_date)[:10]).date()).days
            except Exception:
                row["auction_recency_days"] = None
        row["source_keys"] = [
            "soma",
            *( ["auctions"] if row.get("latest_auction_date") else [] ),
            *( ["nport"] if row.get("nport_fund_count") else [] ),
        ]

    block["audit_note"] = (
        "Security rows identify which source blocks contributed each match and add time-to-maturity / auction-recency fields derived from source dates. "
        "A recent-auction match is issuance context, not proof that the auction award is still held by any current owner."
    )


phase5.fetch_government_accounts = fetch_government_accounts_normalized
phase5.build_ownership_shares = build_ownership_shares_aligned


def main() -> None:
    phase5.main()
    data = json.loads(phase5.DATA_FILE.read_text(encoding="utf-8"))
    data["unusual_change_alerts"] = build_unusual_change_alerts(data)
    data["provenance"] = build_provenance(data)
    enrich_security_audit(data)
    data["generated_at"] = phase5.base.now_iso()
    phase5.DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Phase 6 updated {phase5.DATA_FILE}")


if __name__ == "__main__":
    main()
