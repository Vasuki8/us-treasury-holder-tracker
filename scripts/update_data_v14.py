from __future__ import annotations

import csv
import io
import json
from collections import defaultdict
from datetime import datetime

import update_data_v13 as phase13

base = phase13.base
DATA_FILE = phase13.DATA_FILE

MONTHLY_HISTORY_URL = "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt3d_globl.csv"
ANNUAL_SURVEY_URL = "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/shlhistdat.txt"
ANNUAL_SURVEY_PAGE = "https://home.treasury.gov/data/treasury-international-capital-tic-system/us-liabilities-to-foreigners-from-holdings-of-us-securities"

# Keep the Phase 13 loader before monkey-patching it in main().
_fetch_2020_history = phase13.fetch_tic_full_country_history


def _billions(value) -> float | None:
    parsed = base.to_float(value)
    return parsed / 1000.0 if parsed is not None else None


def _period(value: str) -> str | None:
    value = (value or "").strip()
    try:
        return datetime.strptime(value, "%b-%y").strftime("%Y-%m")
    except ValueError:
        return None


def _parse_monthly_archive() -> dict[tuple[str, str], list[dict]]:
    """Parse Treasury's legacy SLT country Treasury holdings file.

    The archive includes total, long-term and short-term Treasury positions and
    reaches back to the first SLT observations in September 2011. We use it only
    before 2020 so the current Table 3 remains authoritative for overlapping dates.
    """
    text = base.get_text(MONTHLY_HISTORY_URL)
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for cols in csv.reader(io.StringIO(text)):
        if len(cols) < 6:
            continue
        name = (cols[0] or "").strip()
        code = (cols[1] or "").strip()
        period = (cols[2] or "").strip()
        if not name or not code.isdigit() or len(period) != 7 or period >= "2020-01":
            continue
        total = _billions(cols[3])
        long_term = _billions(cols[4])
        short_term = _billions(cols[5])
        if total is None:
            continue
        grouped[(name, code)].append(
            {
                "period": period,
                "holdings_billions": total,
                "net_sales_billions": None,
                "long_term_holdings_billions": long_term,
                "long_term_net_sales_billions": None,
                "long_term_valuation_change_billions": None,
                "short_term_holdings_billions": short_term,
                "short_term_net_sales_billions": None,
                "history_source": "TIC legacy SLT archive",
            }
        )
    for rows in grouped.values():
        rows.sort(key=lambda row: row["period"], reverse=True)
    return grouped


def _parse_annual_surveys() -> dict:
    """Parse Treasury/Federal Reserve historical SHL/SHLA survey history.

    Modern surveys contain both long- and short-term Treasury debt. Earlier
    benchmark surveys predate collection of short-term securities, so those
    observations are explicitly marked long-term-only rather than blended as if
    coverage were identical.
    """
    text = base.get_text(ANNUAL_SURVEY_URL)
    lines = text.splitlines()
    if len(lines) < 8:
        raise RuntimeError("Annual Treasury survey history file is unexpectedly short")

    date_row = lines[5].split("\t")
    category_row = lines[6].split("\t")
    field_row = lines[7].split("\t")
    width = max(len(date_row), len(category_row), len(field_row))
    date_row += [""] * (width - len(date_row))
    category_row += [""] * (width - len(category_row))
    field_row += [""] * (width - len(field_row))

    by_code: dict[str, dict] = {}
    periods: set[str] = set()
    for line in lines[8:]:
        cols = line.split("\t")
        if len(cols) < 3:
            continue
        code = (cols[0] or "").strip()
        name = (cols[1] or "").strip()
        if not code.isdigit() or not name:
            continue
        cols += [""] * (width - len(cols))
        date_values: dict[str, dict[str, float | None]] = defaultdict(
            lambda: {"long": None, "short": None}
        )
        for i in range(2, width):
            period = _period(date_row[i])
            if not period:
                continue
            category = category_row[i].strip().lower()
            field = field_row[i].strip().lower()
            if "treasury debt" not in field:
                continue
            value = _billions(cols[i])
            if value is None:
                continue
            if "short-term" in category:
                date_values[period]["short"] = value
            else:
                # The historical benchmark columns are long-term securities.
                date_values[period]["long"] = value

        history = []
        for period, values in date_values.items():
            long_term = values.get("long")
            short_term = values.get("short")
            if long_term is None and short_term is None:
                continue
            total = (long_term or 0.0) + (short_term or 0.0)
            scope = "long_and_short_term" if short_term is not None else "long_term_only"
            history.append(
                {
                    "period": period,
                    "treasury_billions": total,
                    "long_term_treasury_billions": long_term,
                    "short_term_treasury_billions": short_term,
                    "coverage": scope,
                }
            )
            periods.add(period)
        history.sort(key=lambda row: row["period"], reverse=True)
        if history:
            by_code[code] = {"name": name, "country_code": code, "history": history}

    ordered_periods = sorted(periods, reverse=True)
    return {
        "by_code": by_code,
        "periods": ordered_periods,
        "as_of": ordered_periods[0] if ordered_periods else None,
        "history_start": ordered_periods[-1] if ordered_periods else None,
        "observation_count": len(ordered_periods),
        "country_count": len(by_code),
    }


def _delta(history: list[dict], months: int) -> float | None:
    if len(history) <= months:
        return None
    current = history[0].get("holdings_billions")
    previous = history[months].get("holdings_billions")
    if current is None or previous is None:
        return None
    return current - previous


def _pct_change(history: list[dict], months: int) -> float | None:
    if len(history) <= months:
        return None
    current = history[0].get("holdings_billions")
    previous = history[months].get("holdings_billions")
    if current is None or previous in (None, 0):
        return None
    return (current - previous) / abs(previous) * 100.0


def fetch_tic_history_2011() -> dict:
    current = _fetch_2020_history()
    archive = _parse_monthly_archive()
    annual = _parse_annual_surveys()

    archive_by_code: dict[str, list[dict]] = defaultdict(list)
    archive_special: dict[str, list[dict]] = defaultdict(list)
    for (name, code), rows in archive.items():
        archive_by_code[code].extend(rows)
        archive_special[name].extend(rows)

    for country in current.get("countries", []):
        code = str(country.get("country_code") or "")
        merged = list(country.get("history", []) or []) + list(archive_by_code.get(code, []))
        dedup = {row.get("period"): row for row in merged if row.get("period")}
        history = sorted(dedup.values(), key=lambda row: row["period"], reverse=True)
        country["history"] = history
        country["history_start"] = history[-1]["period"] if history else None
        country["history_observation_count"] = len(history)
        country["change_24m_billions"] = _delta(history, 24)
        country["change_36m_billions"] = _delta(history, 36)
        country["change_60m_billions"] = _delta(history, 60)
        country["change_120m_billions"] = _delta(history, 120)
        country["change_60m_pct"] = _pct_change(history, 60)
        country["change_120m_pct"] = _pct_change(history, 120)
        country["change_since_start_billions"] = (
            history[0].get("holdings_billions") - history[-1].get("holdings_billions")
            if history and history[0].get("holdings_billions") is not None and history[-1].get("holdings_billions") is not None
            else None
        )

        survey = annual.get("by_code", {}).get(code, {})
        survey_history = list(survey.get("history", []) or [])
        country["annual_survey_history"] = survey_history
        country["annual_survey_history_start"] = survey_history[-1]["period"] if survey_history else None
        country["annual_survey_observation_count"] = len(survey_history)

    def merge_special(key: str, historical_name: str) -> None:
        existing = list(current.get(key, []) or [])
        older = list(archive_special.get(historical_name, []))
        dedup = {row.get("period"): row for row in older + existing if row.get("period")}
        current[key] = sorted(dedup.values(), key=lambda row: row["period"], reverse=True)

    merge_special("grand_total_history", "Grand Total")
    merge_special("foreign_official_history", "Of Which: Foreign Official")
    merge_special("foreign_nonofficial_history", "Of Which: Foreign Non-Official")

    all_periods = sorted(
        {row.get("period") for country in current.get("countries", []) for row in country.get("history", []) if row.get("period")},
        reverse=True,
    )
    current["periods"] = all_periods
    current["history_start"] = all_periods[-1] if all_periods else current.get("history_start")
    current["history_month_count"] = len(all_periods)
    current["monthly_archive_url"] = MONTHLY_HISTORY_URL
    current["history_note"] = (
        "Country-level Treasury holdings use current TIC Table 3 from 2020 onward and Treasury's legacy SLT archive before 2020. "
        "The first SLT observations are September and December 2011; the monthly sequence becomes regular from 2012."
    )
    current["annual_survey"] = {
        "as_of": annual.get("as_of"),
        "history_start": annual.get("history_start"),
        "observation_count": annual.get("observation_count"),
        "country_count": annual.get("country_count"),
        "source_url": ANNUAL_SURVEY_URL,
        "source_page": ANNUAL_SURVEY_PAGE,
        "frequency": "Annual / historical benchmark surveys",
        "note": (
            "Treasury/Federal Reserve SHL and predecessor surveys provide a long-run historical view back to 1974. "
            "Annual surveys are available from 2002 onward; earlier points are benchmark surveys. Short-term Treasury securities were not collected in the earliest surveys, so older observations are marked long-term-only."
        ),
    }
    return current


def main() -> None:
    # Phase 13 patches the Phase 5 loader before running the full chain. Replacing
    # its loader here lets every downstream holder, comparison and flow layer use
    # the stitched 2011-present monthly series without changing their semantics.
    phase13.fetch_tic_full_country_history = fetch_tic_history_2011
    phase13.main()

    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    foreign = data.get("foreign_holders", {})
    survey = foreign.get("annual_survey", {})
    print(
        "Long country history:",
        foreign.get("country_count"),
        "current countries,",
        foreign.get("history_month_count"),
        "reported monthly observations from",
        foreign.get("history_start"),
        "to",
        foreign.get("as_of"),
    )
    print(
        "Annual survey history:",
        survey.get("observation_count"),
        "survey dates from",
        survey.get("history_start"),
        "to",
        survey.get("as_of"),
    )


if __name__ == "__main__":
    main()
