from __future__ import annotations

import json
from datetime import datetime, timezone
from io import StringIO

import pandas as pd

import update_data_v4 as phase4

base = phase4.base
DATA_FILE = base.DATA_FILE

MTS_GOV_ACCOUNTS_URL = (
    "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
    "v1/accounting/mts/mts_table_6d"
)
MTS_GOV_ACCOUNTS_SOURCE = (
    "https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/"
)


def _find_key(row: dict, exact: list[str], contains: tuple[str, ...] = ()) -> str | None:
    lowered = {str(k).lower(): k for k in row.keys()}
    for name in exact:
        if name.lower() in lowered:
            return lowered[name.lower()]
    if contains:
        for key in row.keys():
            low = str(key).lower()
            if all(token in low for token in contains):
                return key
    return None


def fetch_government_accounts() -> dict:
    first = base.get_json(
        MTS_GOV_ACCOUNTS_URL,
        params={"sort": "-record_date", "page[number]": 1, "page[size]": 1, "format": "json"},
    ).get("data", [])
    if not first:
        raise RuntimeError("MTS Table 6d returned no rows")
    latest_date = first[0].get("record_date")
    if not latest_date:
        raise RuntimeError("MTS Table 6d row has no record_date")

    payload = base.get_json(
        MTS_GOV_ACCOUNTS_URL,
        params={
            "filter": f"record_date:eq:{latest_date}",
            "sort": "record_date",
            "page[number]": 1,
            "page[size]": 2000,
            "format": "json",
        },
    )
    rows = payload.get("data", [])
    if not rows:
        raise RuntimeError("MTS Table 6d returned no rows for latest date")

    sample = rows[0]
    desc_key = _find_key(
        sample,
        ["classification_desc", "account_desc", "classification_name", "line_item_desc"],
        ("classification", "desc"),
    )
    close_key = _find_key(
        sample,
        [
            "close_month_bal",
            "close_this_month_bal",
            "close_of_month_amt",
            "close_month_amt",
            "current_month_close_bal",
            "current_month_close_amt",
        ],
    )
    if close_key is None:
        for key in sample.keys():
            low = str(key).lower()
            if "close" in low and ("amt" in low or "bal" in low):
                close_key = key
                break
    if desc_key is None or close_key is None:
        raise RuntimeError(
            f"Could not identify MTS Table 6d description/close-balance fields. Keys={list(sample.keys())}"
        )

    id_key = _find_key(sample, ["classification_id"])
    parent_key = _find_key(sample, ["parent_id"])
    account_type_key = _find_key(sample, ["account_type", "account_type_desc"])

    parent_ids = {
        str(r.get(parent_key)).strip()
        for r in rows
        if parent_key and r.get(parent_key) not in (None, "")
    }

    holders = []
    for row in rows:
        name = str(row.get(desc_key) or "").strip()
        if not name:
            continue
        classification_id = str(row.get(id_key) or "").strip() if id_key else ""
        # Keep leaf lines rather than category headers/subtotals when hierarchy is available.
        if classification_id and classification_id in parent_ids:
            continue
        if name.lower().startswith("total "):
            continue
        value_millions = base.to_float(row.get(close_key))
        if value_millions is None or value_millions <= 0:
            continue
        holders.append(
            {
                "name": name,
                "account_type": str(row.get(account_type_key) or "").strip() if account_type_key else None,
                "holdings_billions": value_millions / 1000.0,
                "classification_id": classification_id or None,
            }
        )

    # Deduplicate identical leaf lines that occasionally appear with display-only metadata variants.
    dedup = {}
    for row in holders:
        key = (row["name"], row.get("account_type"), row.get("classification_id"))
        if key not in dedup or row["holdings_billions"] > dedup[key]["holdings_billions"]:
            dedup[key] = row
    holders = sorted(dedup.values(), key=lambda x: x["holdings_billions"], reverse=True)

    if len(holders) < 10:
        raise RuntimeError(
            f"MTS Table 6d parsed only {len(holders)} holder rows; fields were {desc_key}/{close_key}"
        )

    social_security = sum(
        r["holdings_billions"]
        for r in holders
        if any(token in r["name"].lower() for token in ("old-age", "old age", "survivors insurance", "disability insurance"))
    )
    medicare = sum(
        r["holdings_billions"]
        for r in holders
        if any(token in r["name"].lower() for token in ("medical insurance", "hospital insurance", "medicare"))
    )
    federal_retirement = sum(
        r["holdings_billions"]
        for r in holders
        if any(token in r["name"].lower() for token in ("civil service retirement", "military retirement", "retiree health care"))
    )

    return {
        "as_of": latest_date,
        "holders": holders[:150],
        "holder_count": len(holders),
        "leaf_total_billions": sum(r["holdings_billions"] for r in holders),
        "social_security_billions": social_security or None,
        "medicare_billions": medicare or None,
        "federal_retirement_billions": federal_retirement or None,
        "frequency": "Monthly",
        "source_url": MTS_GOV_ACCOUNTS_SOURCE,
        "api_url": MTS_GOV_ACCOUNTS_URL,
        "note": "Detailed federal and trust-fund investments in Government Account Series and other federal securities. Leaf rows are used to reduce subtotal double-counting.",
        "parsed_fields": {"description": desc_key, "close_balance": close_key},
    }


def fetch_tic_13_month_history() -> dict:
    text = base.get_text(base.TIC_MAJOR_URL)
    lines = [ln for ln in text.splitlines() if ln.strip()]
    header_idx = next(i for i, ln in enumerate(lines) if ln.startswith("Country\t"))
    headers = lines[header_idx].split("\t")
    periods = headers[1:]
    countries = []
    grand_total_history = []
    official_history = []

    for line in lines[header_idx + 1 :]:
        cols = line.split("\t")
        if len(cols) < 2:
            continue
        name = cols[0].strip()
        values = [base.to_float(v) for v in cols[1 : 1 + len(periods)]]
        history = [
            {"period": period, "holdings_billions": value}
            for period, value in zip(periods, values)
            if value is not None
        ]
        if not history:
            continue
        if name == "Grand Total":
            grand_total_history = history
            continue
        if name == "Of Which: Foreign Official":
            official_history = history
            continue
        if name.startswith("Of Which:") or name == "All Other":
            continue

        current = values[0]
        def change_at(index: int):
            old = values[index] if len(values) > index else None
            return current - old if current is not None and old is not None else None
        def pct_at(index: int):
            old = values[index] if len(values) > index else None
            if current is None or old in (None, 0):
                return None
            return (current - old) / abs(old) * 100.0

        countries.append(
            {
                "name": name,
                "holdings_billions": current,
                "previous_billions": values[1] if len(values) > 1 else None,
                "change_billions": change_at(1),
                "change_3m_billions": change_at(3),
                "change_6m_billions": change_at(6),
                "change_12m_billions": change_at(12),
                "change_3m_pct": pct_at(3),
                "change_12m_pct": pct_at(12),
                "history": history,
            }
        )

    countries.sort(key=lambda x: x["holdings_billions"] or 0, reverse=True)
    return {
        "as_of": periods[0] if periods else None,
        "previous_period": periods[1] if len(periods) > 1 else None,
        "periods": periods,
        "grand_total_billions": grand_total_history[0]["holdings_billions"] if grand_total_history else None,
        "foreign_official_billions": official_history[0]["holdings_billions"] if official_history else None,
        "grand_total_history": grand_total_history,
        "foreign_official_history": official_history,
        "countries": countries,
        "frequency": "Monthly",
        "source_url": base.TIC_MAJOR_URL,
        "all_country_source_url": base.TIC_ALL_URL,
        "note": "TIC country attribution can reflect custodial location rather than the ultimate beneficial owner.",
    }


def build_ownership_shares(data: dict) -> dict:
    public_debt = (data.get("overview", {}).get("debt_held_by_public") or 0) / 1e9
    intragov = (data.get("overview", {}).get("intragovernmental_holdings") or 0) / 1e9
    foreign = data.get("foreign_holders", {}).get("grand_total_billions")
    fed = data.get("fed", {}).get("treasury_holdings_billions")
    soma = data.get("soma", {}).get("treasury_total_billions")
    government_leaf = data.get("government_accounts", {}).get("leaf_total_billions")

    def share(value, denominator):
        if value is None or not denominator:
            return None
        return value / denominator * 100.0

    rows = [
        {
            "name": "Foreign holders (TIC)",
            "holdings_billions": foreign,
            "denominator": "Debt held by public",
            "share_pct": share(foreign, public_debt),
        },
        {
            "name": "Federal Reserve H.4.1",
            "holdings_billions": fed,
            "denominator": "Debt held by public",
            "share_pct": share(fed, public_debt),
        },
        {
            "name": "Federal Reserve SOMA par",
            "holdings_billions": soma,
            "denominator": "Debt held by public",
            "share_pct": share(soma, public_debt),
        },
        {
            "name": "Detailed government-account leaf lines",
            "holdings_billions": government_leaf,
            "denominator": "Intragovernmental holdings",
            "share_pct": share(government_leaf, intragov),
        },
    ]
    return {
        "debt_held_by_public_billions": public_debt or None,
        "intragovernmental_billions": intragov or None,
        "rows": rows,
        "note": "Shares are shown only against the relevant high-level Treasury denominator. These categories should not be summed because source definitions and valuation bases differ.",
    }


def build_soma_concentration(data: dict) -> dict:
    soma = data.get("soma", {})
    rows = soma.get("top_holdings", [])
    total = soma.get("treasury_total_billions") or 0
    top10 = sum((r.get("par_value_billions") or 0) for r in rows[:10])

    as_of_text = soma.get("as_of")
    try:
        as_of = pd.Timestamp(as_of_text).date()
    except Exception:
        as_of = datetime.now(timezone.utc).date()

    buckets = {
        "≤1 year": 0.0,
        "1–3 years": 0.0,
        "3–7 years": 0.0,
        "7–10 years": 0.0,
        ">10 years": 0.0,
    }
    for row in rows:
        maturity = row.get("maturity_date")
        if not maturity:
            continue
        try:
            days = (pd.Timestamp(maturity).date() - as_of).days
        except Exception:
            continue
        years = days / 365.25
        value = row.get("par_value_billions") or 0
        if years <= 1:
            buckets["≤1 year"] += value
        elif years <= 3:
            buckets["1–3 years"] += value
        elif years <= 7:
            buckets["3–7 years"] += value
        elif years <= 10:
            buckets["7–10 years"] += value
        else:
            buckets[">10 years"] += value

    return {
        "as_of": soma.get("as_of"),
        "top10_par_billions": top10,
        "top10_share_pct": (top10 / total * 100.0) if total else None,
        "maturity_buckets": [
            {"name": name, "par_billions": value}
            for name, value in buckets.items()
        ],
        "note": "Maturity buckets are calculated from the CUSIP-level SOMA sample stored in the dashboard (top positions), so they are a concentration view rather than a full maturity distribution.",
    }


def main() -> None:
    phase4.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    data.setdefault("sources", {})
    data.setdefault("errors", [])

    base.update_section(data, "government_accounts", fetch_government_accounts)
    base.update_section(data, "foreign_holders", fetch_tic_13_month_history)
    data["ownership_shares"] = build_ownership_shares(data)
    data["soma_concentration"] = build_soma_concentration(data)
    data["generated_at"] = base.now_iso()

    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Phase 5 updated {DATA_FILE}")


if __name__ == "__main__":
    main()
