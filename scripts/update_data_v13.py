from __future__ import annotations

import json
import re
from collections import defaultdict

import update_data_v12 as phase12
import update_data_v5 as phase5

base = phase12.base
DATA_FILE = phase12.DATA_FILE


def _billions(value) -> float | None:
    parsed = base.to_float(value)
    return parsed / 1000.0 if parsed is not None else None


def _pct_change(current: float | None, previous: float | None) -> float | None:
    if current is None or previous in (None, 0):
        return None
    return (current - previous) / abs(previous) * 100.0


def _delta(rows: list[dict], index: int, key: str = "holdings_billions") -> float | None:
    if not rows or len(rows) <= index:
        return None
    current = rows[0].get(key)
    previous = rows[index].get(key)
    if current is None or previous is None:
        return None
    return current - previous


def fetch_tic_full_country_history() -> dict:
    """Load Treasury TIC Table 3: all countries with monthly history since 2020."""
    text = base.get_text(base.TIC_ALL_URL)
    lines = [line.rstrip("\r") for line in text.splitlines() if line.strip()]
    header_idx = next(
        i for i, line in enumerate(lines)
        if line.lower().startswith("country\tcountry_code\tdate\tfor_treas_pos")
    )

    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for line in lines[header_idx + 1 :]:
        cols = line.split("\t")
        if len(cols) < 10:
            continue
        name = cols[0].strip()
        code = cols[1].strip()
        period = cols[2].strip()
        if not name or not re.fullmatch(r"\d{4}-\d{2}", period):
            continue

        grouped[(name, code)].append(
            {
                "period": period,
                "holdings_billions": _billions(cols[3]),
                "net_sales_billions": _billions(cols[4]),
                "long_term_holdings_billions": _billions(cols[5]),
                "long_term_net_sales_billions": _billions(cols[6]),
                "long_term_valuation_change_billions": _billions(cols[7]),
                "short_term_holdings_billions": _billions(cols[8]),
                "short_term_net_sales_billions": _billions(cols[9]),
            }
        )

    for rows in grouped.values():
        rows.sort(key=lambda row: row["period"], reverse=True)

    def special(name: str) -> list[dict]:
        for (row_name, _), rows in grouped.items():
            if row_name == name:
                return rows
        return []

    grand_total_history = special("Grand Total")
    official_history = special("Of Which: Foreign Official")
    nonofficial_history = special("Of Which: Foreign Non-Official")

    countries = []
    for (name, code), history in grouped.items():
        if not history:
            continue
        # Treasury Table 3 also contains regional totals, memo groups and an
        # "All Countries" aggregate. Keep only individual geographic reporters.
        try:
            code_num = int(code)
        except ValueError:
            continue
        if code_num >= 70000:
            continue
        if name.startswith(("Total ", "Memo:", "Of Which:")) or name in {"Grand Total", "All Countries"}:
            continue

        current = history[0]
        holdings = current.get("holdings_billions")
        if holdings is None:
            continue
        previous = history[1].get("holdings_billions") if len(history) > 1 else None
        long_term = current.get("long_term_holdings_billions")
        short_term = current.get("short_term_holdings_billions")

        countries.append(
            {
                "name": name,
                "country_code": code,
                "holdings_billions": holdings,
                "previous_billions": previous,
                "change_billions": _delta(history, 1),
                "change_3m_billions": _delta(history, 3),
                "change_6m_billions": _delta(history, 6),
                "change_12m_billions": _delta(history, 12),
                "change_24m_billions": _delta(history, 24),
                "change_36m_billions": _delta(history, 36),
                "change_60m_billions": _delta(history, 60),
                "change_3m_pct": _pct_change(holdings, history[3].get("holdings_billions") if len(history) > 3 else None),
                "change_12m_pct": _pct_change(holdings, history[12].get("holdings_billions") if len(history) > 12 else None),
                "change_60m_pct": _pct_change(holdings, history[60].get("holdings_billions") if len(history) > 60 else None),
                "long_term_holdings_billions": long_term,
                "short_term_holdings_billions": short_term,
                "long_term_share_pct": (long_term / holdings * 100.0) if long_term is not None and holdings else None,
                "short_term_share_pct": (short_term / holdings * 100.0) if short_term is not None and holdings else None,
                "net_sales_billions": current.get("net_sales_billions"),
                "long_term_net_sales_billions": current.get("long_term_net_sales_billions"),
                "short_term_net_sales_billions": current.get("short_term_net_sales_billions"),
                "long_term_valuation_change_billions": current.get("long_term_valuation_change_billions"),
                "history": history,
            }
        )

    countries.sort(key=lambda row: row.get("holdings_billions") or 0, reverse=True)
    periods = sorted(
        {item["period"] for rows in grouped.values() for item in rows if item.get("period")},
        reverse=True,
    )

    latest_total = grand_total_history[0] if grand_total_history else {}
    latest_official = official_history[0] if official_history else {}
    latest_nonofficial = nonofficial_history[0] if nonofficial_history else {}

    return {
        "as_of": periods[0] if periods else None,
        "previous_period": periods[1] if len(periods) > 1 else None,
        "periods": periods,
        "history_start": periods[-1] if periods else None,
        "history_month_count": len(periods),
        "country_count": len(countries),
        "grand_total_billions": latest_total.get("holdings_billions"),
        "foreign_official_billions": latest_official.get("holdings_billions"),
        "foreign_nonofficial_billions": latest_nonofficial.get("holdings_billions"),
        "grand_total_history": grand_total_history,
        "foreign_official_history": official_history,
        "foreign_nonofficial_history": nonofficial_history,
        "countries": countries,
        "frequency": "Monthly",
        "source_url": base.TIC_ALL_URL,
        "major_source_url": base.TIC_MAJOR_URL,
        "all_country_source_url": base.TIC_ALL_URL,
        "history_note": "Treasury TIC Table 3 supplies monthly country-level Treasury holdings history beginning in January 2020, with long-term/short-term holdings and transaction components where published.",
        "note": "TIC country attribution can reflect custodial location rather than the ultimate beneficial owner.",
    }


def main() -> None:
    # Patch the Phase 5 TIC loader before the Phase 12 chain runs so every later
    # holder-profile, alert, flow and comparison layer is built from the expanded history.
    phase5.fetch_tic_13_month_history = fetch_tic_full_country_history
    phase12.main()

    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    foreign = data.get("foreign_holders", {})
    print(
        "Expanded TIC coverage:",
        foreign.get("country_count"),
        "countries,",
        foreign.get("history_month_count"),
        "months from",
        foreign.get("history_start"),
        "to",
        foreign.get("as_of"),
    )


if __name__ == "__main__":
    main()
