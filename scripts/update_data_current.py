from __future__ import annotations

import update_data_v5 as phase5

_original_fetch_government_accounts = phase5.fetch_government_accounts


def fetch_government_accounts_normalized() -> dict:
    data = _original_fetch_government_accounts()

    # Fiscal Data's MTS API returns the close_month_acct_bal_amt values as
    # dollar amounts even though the published MTS report displays Schedule D
    # in $ millions. Phase 5's first parser treated the API values as millions.
    # Convert its temporary /1000 representation to dollars->billions (/1e9).
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
    data["holder_count"] = max(0, int(data.get("holder_count") or len(rows)) - (1 if grand_total_billions else 0))
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


phase5.fetch_government_accounts = fetch_government_accounts_normalized


if __name__ == "__main__":
    phase5.main()
