from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"

HEADERS = {
    "User-Agent": "us-treasury-holder-tracker/1.0 contact: replace-with-your-email@example.com",
    "Accept": "*/*",
}
TIMEOUT = 45

DEBT_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny"
TIC_MAJOR_URL = "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt"
TIC_ALL_URL = "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.txt"
FED_H41_URL = "https://www.federalreserve.gov/releases/h41/current/"
FED_Z1_URL = "https://www.federalreserve.gov/releases/z1/current/html/F3_2_s.htm"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def get_json(url: str, params: dict | None = None) -> dict:
    r = requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def get_text(url: str) -> str:
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r.text


def load_existing() -> dict:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    return {
        "generated_at": None,
        "overview": {},
        "fed": {},
        "foreign_holders": {},
        "domestic_sectors": {},
        "sources": {},
        "errors": [],
    }


def fetch_debt_to_penny() -> dict:
    payload = get_json(
        DEBT_URL,
        params={
            "sort": "-record_date",
            "page[number]": 1,
            "page[size]": 2,
            "format": "json",
        },
    )
    rows = payload["data"]
    latest = rows[0]
    prev = rows[1] if len(rows) > 1 else None

    def num(key: str, row: dict | None = None) -> float | None:
        src = row or latest
        val = src.get(key)
        return float(val) if val not in (None, "") else None

    latest_total = num("tot_pub_debt_out_amt")
    prev_total = num("tot_pub_debt_out_amt", prev) if prev else None
    daily_change = latest_total - prev_total if latest_total is not None and prev_total is not None else None

    return {
        "as_of": latest["record_date"],
        "total_public_debt": latest_total,
        "debt_held_by_public": num("debt_held_public_amt"),
        "intragovernmental_holdings": num("intragov_hold_amt"),
        "daily_change": daily_change,
        "frequency": "Business daily",
        "source_url": DEBT_URL,
    }


def fetch_tic_major_foreign() -> dict:
    text = get_text(TIC_MAJOR_URL)
    lines = [ln for ln in text.splitlines() if ln.strip()]
    header_idx = next(i for i, ln in enumerate(lines) if ln.startswith("Country\t"))
    headers = lines[header_idx].split("\t")
    latest_period = headers[1]
    previous_period = headers[2] if len(headers) > 2 else None

    countries = []
    grand_total = None
    foreign_official = None
    for ln in lines[header_idx + 1 :]:
        cols = ln.split("\t")
        if len(cols) < 2:
            continue
        name = cols[0].strip()
        try:
            latest = float(cols[1])
        except ValueError:
            continue
        previous = None
        if len(cols) > 2:
            try:
                previous = float(cols[2])
            except ValueError:
                pass
        record = {
            "name": name,
            "holdings_billions": latest,
            "previous_billions": previous,
            "change_billions": latest - previous if previous is not None else None,
        }
        if name == "Grand Total":
            grand_total = record
        elif name == "Of Which: Foreign Official":
            foreign_official = record
        elif not name.startswith("Of Which:"):
            countries.append(record)

    countries.sort(key=lambda x: x["holdings_billions"], reverse=True)
    return {
        "as_of": latest_period,
        "previous_period": previous_period,
        "grand_total_billions": grand_total["holdings_billions"] if grand_total else None,
        "foreign_official_billions": foreign_official["holdings_billions"] if foreign_official else None,
        "countries": countries,
        "frequency": "Monthly",
        "source_url": TIC_MAJOR_URL,
        "all_country_source_url": TIC_ALL_URL,
    }


def _flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if isinstance(out.columns, pd.MultiIndex):
        out.columns = [" | ".join(str(x) for x in c if str(x) != "nan").strip() for c in out.columns]
    else:
        out.columns = [str(c) for c in out.columns]
    return out


def fetch_fed_h41() -> dict:
    tables = pd.read_html(FED_H41_URL)
    candidates = []
    for df in tables:
        flat = _flatten_columns(df)
        for _, row in flat.iterrows():
            vals = [str(v).strip() for v in row.tolist()]
            if vals and any(v == "U.S. Treasury securities" for v in vals):
                nums = []
                for v in vals:
                    cleaned = re.sub(r"[^0-9.\-]", "", v)
                    if cleaned and cleaned not in {"-", "."}:
                        try:
                            nums.append(float(cleaned))
                        except ValueError:
                            pass
                if nums:
                    candidates.append((flat, row, vals, nums))

    if not candidates:
        raise RuntimeError("Could not locate U.S. Treasury securities in H.4.1")

    # H.4.1 contains the Treasury total in multiple tables. For current release,
    # the largest plausible figure in millions is the Wednesday level.
    all_nums = [n for _, _, _, nums in candidates for n in nums if 1_000_000 <= n <= 10_000_000]
    if not all_nums:
        raise RuntimeError("Could not parse H.4.1 Treasury holdings value")
    treasury_millions = max(all_nums)

    page = get_text(FED_H41_URL)
    from bs4 import BeautifulSoup
    page_text = BeautifulSoup(page, "html.parser").get_text(" ", strip=True)
    date_match = re.search(r"Wednesday\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})", page_text)
    as_of = date_match.group(1) if date_match else None

    return {
        "as_of": as_of,
        "treasury_holdings_millions": treasury_millions,
        "treasury_holdings_billions": treasury_millions / 1000.0,
        "frequency": "Weekly (Wednesday level; published Thursday)",
        "source_url": FED_H41_URL,
    }


def fetch_z1_sectors() -> dict:
    tables = pd.read_html(FED_Z1_URL)
    df = _flatten_columns(tables[0])

    # Locate the columns by semantic labels rather than fixed positions.
    desc_col = next(c for c in df.columns if "Description" in c)
    series_col = next(c for c in df.columns if "Series" in c)
    period_cols = [c for c in df.columns if re.search(r"20\d{2}:Q[1-4]$", c)]
    if not period_cols:
        raise RuntimeError("No quarterly period columns found in Z.1 F3.2.s")
    latest_period = period_cols[-1]

    rows = []
    for _, row in df.iterrows():
        desc = str(row.get(desc_col, "")).strip()
        series = str(row.get(series_col, "")).strip()
        if not desc or desc == "nan" or not re.match(r"[A-Z]{2}\d+", series):
            continue
        raw = row.get(latest_period)
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        rows.append({
            "name": desc,
            "series": series,
            "holdings_billions": value,
        })

    # Keep holder categories; exclude totals, sub-type duplicates, discrepancy, and memo.
    exclude = {
        "Total liabilities",
        "Treasury bills",
        "Other Treasury notes, bonds, and TIPS(2)",
        "Other Treasury securities",
        "Total assets",
        "Discrepancy(3)",
        "Nonmarketable Treasury securities(4)",
    }
    holder_rows = [r for r in rows if r["name"] not in exclude]

    return {
        "as_of": latest_period,
        "holders": holder_rows,
        "frequency": "Quarterly",
        "source_url": FED_Z1_URL,
    }


def update_section(data: dict, key: str, fn) -> None:
    try:
        data[key] = fn()
        data["sources"].setdefault(key, {})
        data["sources"][key]["status"] = "ok"
        data["sources"][key]["checked_at"] = now_iso()
    except Exception as exc:  # retain last successful data if one source breaks
        data.setdefault("errors", []).append({
            "source": key,
            "checked_at": now_iso(),
            "message": f"{type(exc).__name__}: {exc}",
        })
        data["sources"].setdefault(key, {})
        data["sources"][key]["status"] = "error"
        data["sources"][key]["checked_at"] = now_iso()


def main() -> None:
    data = load_existing()
    data["errors"] = []
    update_section(data, "overview", fetch_debt_to_penny)
    update_section(data, "fed", fetch_fed_h41)
    update_section(data, "foreign_holders", fetch_tic_major_foreign)
    update_section(data, "domestic_sectors", fetch_z1_sectors)
    data["generated_at"] = now_iso()

    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Updated {DATA_FILE}")
    if data["errors"]:
        print(json.dumps(data["errors"], indent=2))


if __name__ == "__main__":
    main()
