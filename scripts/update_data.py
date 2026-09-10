from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import datetime, timedelta, timezone
from io import StringIO
from pathlib import Path
from urllib.parse import urljoin

import pandas as pd
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"

HEADERS = {
    "User-Agent": "us-treasury-holder-tracker/2.0 (https://github.com/Vasuki8/us-treasury-holder-tracker)",
    "Accept": "*/*",
}
TIMEOUT = 60

DEBT_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny"
TIC_MAJOR_URL = "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt"
TIC_ALL_URL = "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table3.txt"

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"
FED_H41_SOURCE = "https://www.federalreserve.gov/releases/h41/current/"
FED_Z1_SOURCE = "https://www.federalreserve.gov/releases/z1/current/html/F3_2_s.htm"

NYFED_SOMA_ASOF_URL = "https://markets.newyorkfed.org/api/soma/asofdates/list.json"
NYFED_SOMA_DETAIL = "https://markets.newyorkfed.org/api/soma/tsy/get/all/asof/{date}.json"
NYFED_SOMA_SOURCE = "https://www.newyorkfed.org/markets/soma-holdings"

SEC_NMFP_PAGE = "https://www.sec.gov/data-research/sec-markets-data/dera-form-n-mfp-data-sets"

AUCTIONS_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query"
AUCTIONS_SOURCE = "https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def get_response(url: str, params: dict | None = None) -> requests.Response:
    r = requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r


def get_json(url: str, params: dict | None = None) -> dict:
    return get_response(url, params=params).json()


def get_text(url: str, params: dict | None = None) -> str:
    return get_response(url, params=params).text


def get_bytes(url: str) -> bytes:
    return get_response(url).content


def load_existing() -> dict:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    return {
        "generated_at": None,
        "overview": {},
        "fed": {},
        "foreign_holders": {},
        "domestic_sectors": {},
        "soma": {},
        "money_market_funds": {},
        "auctions": {},
        "sources": {},
        "errors": [],
    }


def to_float(value) -> float | None:
    if value in (None, "", "null", "None", "."):
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


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

    latest_total = to_float(latest.get("tot_pub_debt_out_amt"))
    prev_total = to_float(prev.get("tot_pub_debt_out_amt")) if prev else None

    return {
        "as_of": latest["record_date"],
        "total_public_debt": latest_total,
        "debt_held_by_public": to_float(latest.get("debt_held_public_amt")),
        "intragovernmental_holdings": to_float(latest.get("intragov_hold_amt")),
        "daily_change": (
            latest_total - prev_total
            if latest_total is not None and prev_total is not None
            else None
        ),
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
        latest = to_float(cols[1])
        previous = to_float(cols[2]) if len(cols) > 2 else None
        if latest is None:
            continue

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
        elif not name.startswith("Of Which:") and name != "All Other":
            countries.append(record)

    countries.sort(key=lambda x: x["holdings_billions"], reverse=True)
    return {
        "as_of": latest_period,
        "previous_period": previous_period,
        "grand_total_billions": grand_total["holdings_billions"] if grand_total else None,
        "foreign_official_billions": (
            foreign_official["holdings_billions"] if foreign_official else None
        ),
        "countries": countries,
        "frequency": "Monthly",
        "source_url": TIC_MAJOR_URL,
        "all_country_source_url": TIC_ALL_URL,
    }


def fetch_fred_series(series_id: str) -> tuple[str, float]:
    text = get_text(FRED_CSV, params={"id": series_id})
    df = pd.read_csv(StringIO(text))
    if series_id not in df.columns:
        value_cols = [c for c in df.columns if c != "DATE"]
        if not value_cols:
            raise RuntimeError(f"No value column returned for FRED series {series_id}")
        value_col = value_cols[-1]
    else:
        value_col = series_id

    values = pd.to_numeric(df[value_col], errors="coerce")
    valid = df.loc[values.notna()].copy()
    if valid.empty:
        raise RuntimeError(f"No observations returned for FRED series {series_id}")
    row = valid.iloc[-1]
    return str(row["DATE"]), float(row[value_col])


def fetch_fed_h41() -> dict:
    as_of, treasury_millions = fetch_fred_series("TREAST")
    return {
        "as_of": as_of,
        "treasury_holdings_millions": treasury_millions,
        "treasury_holdings_billions": treasury_millions / 1000.0,
        "frequency": "Weekly (Wednesday level; published Thursday)",
        "source_url": FED_H41_SOURCE,
        "retrieval_url": "https://fred.stlouisfed.org/series/TREAST",
        "series": "TREAST",
    }


FED_SECTOR_SERIES = [
    ("Households and nonprofit organizations", "LM153061105", "BOGZ1LM153061105Q"),
    ("Nonfinancial corporate business", "LM103061103", "BOGZ1LM103061103Q"),
    ("Nonfinancial noncorporate business", "LM113061003", "BOGZ1LM113061003Q"),
    ("State and local governments", "LM213061103", "BOGZ1LM213061103Q"),
    ("Central bank", "LM713061103", "BOGZ1LM713061103Q"),
    ("Defined contribution plans", "LM343061113", "BOGZ1LM343061113Q"),
    ("State and local govt. pension funds", "LM223061143", "BOGZ1LM223061143Q"),
    ("Money market funds", "FL633061105", "BOGZ1FL633061105Q"),
    ("Mutual funds", "LM653061105", "BOGZ1LM653061105Q"),
    ("Other financial business", "FL503061123", "BOGZ1FL503061123Q"),
    ("Rest of the world", "LM263061105", "BOGZ1LM263061105Q"),
]


def fetch_z1_sectors() -> dict:
    rows = []
    observation_dates = []
    failures = []

    for name, source_series, fred_series in FED_SECTOR_SERIES:
        try:
            date, value_millions = fetch_fred_series(fred_series)
            observation_dates.append(date)
            rows.append(
                {
                    "name": name,
                    "series": source_series,
                    "fred_series": fred_series,
                    "holdings_billions": value_millions / 1000.0,
                }
            )
        except Exception as exc:
            failures.append(f"{source_series}: {type(exc).__name__}: {exc}")

    if len(rows) < 6:
        raise RuntimeError(
            "Too few Z.1 sector series were retrieved. " + "; ".join(failures[:3])
        )

    latest_date = max(observation_dates)
    latest_ts = pd.Timestamp(latest_date)
    latest_period = f"{latest_ts.year}:Q{latest_ts.quarter}"

    return {
        "as_of": latest_period,
        "observation_date": latest_date,
        "holders": rows,
        "frequency": "Quarterly",
        "source_url": FED_Z1_SOURCE,
        "retrieval_url": "https://fred.stlouisfed.org/",
        "partial_failures": failures,
    }


def _extract_asof_dates(payload: dict) -> list[str]:
    candidate = payload.get("soma", {}).get("asOfDates", [])
    dates = []
    for item in candidate:
        if isinstance(item, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", item):
            dates.append(item)
        elif isinstance(item, dict):
            for value in item.values():
                if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                    dates.append(value)
    return sorted(set(dates))


def _normalize_soma_type(raw: str | None) -> str:
    text = (raw or "").strip().lower()
    if "bill" in text:
        return "Bills"
    if "floating" in text or text == "frn" or "frn" in text:
        return "FRNs"
    if "inflation" in text or "tips" in text:
        return "TIPS"
    if "note" in text or "bond" in text:
        return "Notes & Bonds"
    return raw or "Treasury"


def fetch_soma() -> dict:
    dates_payload = get_json(NYFED_SOMA_ASOF_URL)
    dates = _extract_asof_dates(dates_payload)
    if not dates:
        raise RuntimeError("NY Fed SOMA API returned no as-of dates")
    as_of = dates[-1]

    detail_url = NYFED_SOMA_DETAIL.format(date=as_of)
    payload = get_json(detail_url)
    holdings = payload.get("soma", {}).get("holdings", [])
    if not holdings:
        raise RuntimeError("NY Fed SOMA Treasury detail returned no holdings")

    parsed = []
    by_type: dict[str, float] = {}
    for item in holdings:
        par = to_float(item.get("parValue"))
        if par is None:
            continue
        sec_type = _normalize_soma_type(
            item.get("securityType")
            or item.get("holdingType")
            or item.get("securityDescription")
        )
        by_type[sec_type] = by_type.get(sec_type, 0.0) + par
        parsed.append(
            {
                "cusip": item.get("cusip"),
                "security_type": sec_type,
                "maturity_date": item.get("maturityDate"),
                "coupon_rate": to_float(item.get("couponRate")),
                "par_value_billions": par / 1e9,
                "inflation_compensation_billions": (
                    (to_float(item.get("inflationCompensation")) or 0.0) / 1e9
                ),
                "percent_outstanding": to_float(item.get("percentOutstanding")),
            }
        )

    total_par = sum(x["par_value_billions"] for x in parsed)
    parsed.sort(key=lambda x: x["par_value_billions"], reverse=True)

    return {
        "as_of": as_of,
        "treasury_total_billions": total_par,
        "by_type": [
            {"name": k, "holdings_billions": v / 1e9}
            for k, v in sorted(by_type.items(), key=lambda kv: kv[1], reverse=True)
        ],
        "top_holdings": parsed[:100],
        "security_count": len(parsed),
        "frequency": "Weekly (Wednesday holdings; published Thursday)",
        "source_url": NYFED_SOMA_SOURCE,
        "api_url": detail_url,
    }


def _find_latest_nmfp_archive() -> tuple[str, str]:
    html = get_text(SEC_NMFP_PAGE)
    soup = BeautifulSoup(html, "html.parser")
    candidates = []
    for a in soup.find_all("a", href=True):
        href = str(a["href"])
        if "_nmfp.zip" not in href.lower():
            continue
        url = urljoin(SEC_NMFP_PAGE, href)
        text = a.get_text(" ", strip=True)
        date_match = re.search(r"(\d{8})-(\d{8})_nmfp\.zip", href, re.I)
        sort_key = date_match.group(2) if date_match else ""
        candidates.append((sort_key, text, url))
    if not candidates:
        raise RuntimeError("Could not discover latest SEC N-MFP data archive")
    _, label, url = max(candidates, key=lambda x: x[0])
    return label, url


def _read_zip_table(zf: zipfile.ZipFile, logical_name: str) -> pd.DataFrame:
    target = logical_name.upper()
    members = []
    for name in zf.namelist():
        base = Path(name).name
        stem = Path(base).stem.upper()
        if stem == target or target in stem:
            members.append(name)
    if not members:
        raise RuntimeError(f"{logical_name} table not found in SEC N-MFP archive")
    member = sorted(members, key=len)[0]
    with zf.open(member) as fh:
        return pd.read_csv(
            fh,
            sep="\t",
            dtype=str,
            keep_default_na=False,
            low_memory=False,
        )


def _pick_col(df: pd.DataFrame, *prefixes: str) -> str | None:
    upper_map = {str(c).upper(): c for c in df.columns}
    for p in prefixes:
        if p.upper() in upper_map:
            return upper_map[p.upper()]
    for p in prefixes:
        pu = p.upper()
        for uc, original in upper_map.items():
            if uc.startswith(pu):
                return original
    return None


def fetch_nmfp(existing: dict | None = None) -> dict:
    archive_label, archive_url = _find_latest_nmfp_archive()
    if (
        existing
        and existing.get("source_archive") == archive_url
        and existing.get("funds")
    ):
        cached = dict(existing)
        cached["archive_label"] = archive_label
        cached["source_url"] = SEC_NMFP_PAGE
        return cached

    raw = get_bytes(archive_url)
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        sub = _read_zip_table(zf, "SUBMISSION")
        series = _read_zip_table(zf, "SERIESLEVELINFO")
        sec = _read_zip_table(zf, "SCHPORTFOLIOSECURITIES")

    acc_col = _pick_col(sub, "ACCESSION_NUMBER")
    report_col = _pick_col(sub, "REPORTDATE")
    filing_col = _pick_col(sub, "FILING_DATE")
    series_id_col = _pick_col(sub, "SERIESID")
    series_name_col = _pick_col(sub, "NAMEOFSERIES", "SERIES_NAME", "REGISTRANTFULLNAME")
    if not all([acc_col, report_col, filing_col, series_id_col, series_name_col]):
        raise RuntimeError("Required submission columns missing from SEC N-MFP data")

    work = sub.copy()
    work[filing_col] = pd.to_datetime(work[filing_col], errors="coerce")
    work[report_col] = pd.to_datetime(work[report_col], errors="coerce")
    work = work.sort_values([series_id_col, report_col, filing_col, acc_col])
    latest_sub = work.drop_duplicates([series_id_col, report_col], keep="last")
    latest_report = latest_sub[report_col].max()
    latest_sub = latest_sub[latest_sub[report_col] == latest_report].copy()
    valid_accessions = set(latest_sub[acc_col].astype(str))

    sec_acc = _pick_col(sec, "ACCESSION_NUMBER")
    category_col = _pick_col(sec, "INVESTMENTCATEGORY")
    value_col = _pick_col(
        sec,
        "EXCLUDINGVALUEOFANYSPONSORSUPP",
        "INCLUDINGVALUEOFANYSPONSORSUPP",
    )
    if not all([sec_acc, category_col, value_col]):
        raise RuntimeError("Required portfolio-security columns missing from SEC N-MFP data")

    sec2 = sec[sec[sec_acc].astype(str).isin(valid_accessions)].copy()
    sec2["_value"] = pd.to_numeric(sec2[value_col], errors="coerce").fillna(0.0)
    sec2["_category"] = sec2[category_col].astype(str).str.upper()

    direct = sec2[
        sec2["_category"].str.contains("U.S. TREASURY DEBT", regex=False)
        & ~sec2["_category"].str.contains("REPURCHASE", regex=False)
    ]
    repos = sec2[
        sec2["_category"].str.contains("TREASURY", regex=False)
        & sec2["_category"].str.contains("REPURCHASE", regex=False)
    ]

    direct_by_acc = direct.groupby(sec_acc)["_value"].sum()
    repo_by_acc = repos.groupby(sec_acc)["_value"].sum()

    net_assets_col = _pick_col(series, "NETASSETOFSERIES")
    series_acc = _pick_col(series, "ACCESSION_NUMBER")
    net_by_acc = {}
    if net_assets_col and series_acc:
        s = series[[series_acc, net_assets_col]].copy()
        s["_net"] = pd.to_numeric(s[net_assets_col], errors="coerce")
        net_by_acc = s.groupby(series_acc)["_net"].max().to_dict()

    funds = []
    for _, row in latest_sub.iterrows():
        acc = str(row[acc_col])
        direct_value = float(direct_by_acc.get(acc, 0.0))
        repo_value = float(repo_by_acc.get(acc, 0.0))
        if direct_value <= 0 and repo_value <= 0:
            continue
        name = str(row[series_name_col]).strip()
        funds.append(
            {
                "series_id": str(row[series_id_col]).strip(),
                "name": name,
                "report_date": row[report_col].date().isoformat()
                if pd.notna(row[report_col])
                else None,
                "direct_treasury_billions": direct_value / 1e9,
                "treasury_repo_billions": repo_value / 1e9,
                "net_assets_billions": (
                    float(net_by_acc.get(acc)) / 1e9
                    if net_by_acc.get(acc) is not None
                    and pd.notna(net_by_acc.get(acc))
                    else None
                ),
            }
        )

    funds.sort(key=lambda x: x["direct_treasury_billions"], reverse=True)
    return {
        "as_of": latest_report.date().isoformat() if pd.notna(latest_report) else None,
        "archive_label": archive_label,
        "direct_treasury_total_billions": sum(
            f["direct_treasury_billions"] for f in funds
        ),
        "treasury_repo_total_billions": sum(f["treasury_repo_billions"] for f in funds),
        "fund_count": len(funds),
        "funds": funds[:150],
        "frequency": "Monthly",
        "source_url": SEC_NMFP_PAGE,
        "source_archive": archive_url,
        "note": "Direct Treasury debt is kept separate from Treasury-collateralized repurchase agreements.",
    }


def fetch_auctions() -> dict:
    start = (datetime.now(timezone.utc).date() - timedelta(days=90)).isoformat()
    fields = [
        "cusip",
        "security_type",
        "security_term",
        "auction_date",
        "offering_amt",
        "comp_accepted",
        "total_accepted",
        "total_tendered",
        "bid_to_cover_ratio",
        "primary_dealer_accepted",
        "direct_bidder_accepted",
        "indirect_bidder_accepted",
        "soma_accepted",
        "treas_retail_accepted",
        "fima_noncomp_accepted",
    ]
    payload = get_json(
        AUCTIONS_URL,
        params={
            "fields": ",".join(fields),
            "filter": f"auction_date:gte:{start}",
            "sort": "-auction_date",
            "page[number]": 1,
            "page[size]": 1000,
            "format": "json",
        },
    )
    rows = payload.get("data", [])
    if not rows:
        raise RuntimeError("Treasury auction API returned no recent auctions")

    def sum_field(field: str) -> float:
        return sum(to_float(r.get(field)) or 0.0 for r in rows)

    comp = sum_field("comp_accepted")
    dealer = sum_field("primary_dealer_accepted")
    direct = sum_field("direct_bidder_accepted")
    indirect = sum_field("indirect_bidder_accepted")

    categories = []
    for name, value in [
        ("Primary dealers", dealer),
        ("Indirect bidders", indirect),
        ("Direct bidders", direct),
    ]:
        categories.append(
            {
                "name": name,
                "accepted_billions": value / 1e9,
                "share_pct": (value / comp * 100.0) if comp else None,
            }
        )

    recent = []
    for r in rows[:30]:
        accepted = to_float(r.get("total_accepted"))
        recent.append(
            {
                "auction_date": r.get("auction_date"),
                "cusip": r.get("cusip"),
                "security_type": r.get("security_type"),
                "security_term": r.get("security_term"),
                "offering_billions": (to_float(r.get("offering_amt")) or 0.0) / 1e9,
                "accepted_billions": (accepted or 0.0) / 1e9,
                "bid_to_cover": to_float(r.get("bid_to_cover_ratio")),
                "dealer_share_pct": (
                    (to_float(r.get("primary_dealer_accepted")) or 0.0)
                    / (to_float(r.get("comp_accepted")) or 1.0)
                    * 100.0
                ),
                "indirect_share_pct": (
                    (to_float(r.get("indirect_bidder_accepted")) or 0.0)
                    / (to_float(r.get("comp_accepted")) or 1.0)
                    * 100.0
                ),
                "direct_share_pct": (
                    (to_float(r.get("direct_bidder_accepted")) or 0.0)
                    / (to_float(r.get("comp_accepted")) or 1.0)
                    * 100.0
                ),
            }
        )

    latest_date = max(str(r.get("auction_date")) for r in rows if r.get("auction_date"))
    return {
        "as_of": latest_date,
        "window_days": 90,
        "auction_count": len(rows),
        "competitive_accepted_billions": comp / 1e9,
        "total_accepted_billions": sum_field("total_accepted") / 1e9,
        "categories": categories,
        "recent_auctions": recent,
        "frequency": "Released as auctions occur",
        "source_url": AUCTIONS_SOURCE,
        "api_url": AUCTIONS_URL,
        "note": "Auction takedown is an award-at-auction measure, not a current-holdings measure.",
    }


def update_section(data: dict, key: str, fn) -> None:
    try:
        data[key] = fn()
        data["sources"].setdefault(key, {})
        data["sources"][key]["status"] = "ok"
        data["sources"][key]["checked_at"] = now_iso()
        data["sources"][key].pop("message", None)
    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"
        data.setdefault("errors", []).append(
            {"source": key, "checked_at": now_iso(), "message": message}
        )
        data["sources"].setdefault(key, {})
        data["sources"][key]["status"] = "error"
        data["sources"][key]["checked_at"] = now_iso()
        data["sources"][key]["message"] = message


def main() -> None:
    data = load_existing()
    data["errors"] = []
    data.setdefault("sources", {})

    update_section(data, "overview", fetch_debt_to_penny)
    update_section(data, "fed", fetch_fed_h41)
    update_section(data, "foreign_holders", fetch_tic_major_foreign)
    update_section(data, "domestic_sectors", fetch_z1_sectors)
    update_section(data, "soma", fetch_soma)
    update_section(
        data,
        "money_market_funds",
        lambda: fetch_nmfp(data.get("money_market_funds")),
    )
    update_section(data, "auctions", fetch_auctions)

    data["generated_at"] = now_iso()
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print(f"Updated {DATA_FILE}")
    for key, source in data.get("sources", {}).items():
        print(f"{key:20s} {source.get('status', 'unknown'):7s} {source.get('checked_at', '')}")
    if data["errors"]:
        print(json.dumps(data["errors"], indent=2))


if __name__ == "__main__":
    main()
