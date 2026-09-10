from __future__ import annotations

import calendar

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


phase5.fetch_government_accounts = fetch_government_accounts_normalized
phase5.build_ownership_shares = build_ownership_shares_aligned


if __name__ == "__main__":
    phase5.main()
