from __future__ import annotations

import argparse
import io
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "nport_latest.json"

DEFAULT_QUARTER = "2026 Q2"
DEFAULT_URL = "https://www.sec.gov/files/dera/data/form-n-port-data-sets/2026q2_nport.zip"
HEADERS = {
    "User-Agent": "us-treasury-holder-tracker/4.0 Vasuki8 (contact via GitHub issues)",
    "Accept": "application/zip,application/octet-stream,*/*",
    "Accept-Encoding": "gzip, deflate",
}


def download(url: str) -> bytes:
    r = requests.get(url, headers=HEADERS, timeout=180, stream=True)
    r.raise_for_status()
    return r.content


def find_member(zf: zipfile.ZipFile, logical_name: str) -> str:
    target = logical_name.upper()
    for name in zf.namelist():
        stem = Path(name).stem.upper()
        if stem == target:
            return name
    for name in zf.namelist():
        stem = Path(name).stem.upper()
        if target in stem:
            return name
    raise RuntimeError(f"{logical_name} table not found in N-PORT archive")


def pick(columns, *candidates: str) -> str | None:
    mapping = {str(c).strip().upper(): c for c in columns}
    for candidate in candidates:
        if candidate.upper() in mapping:
            return mapping[candidate.upper()]
    for candidate in candidates:
        cu = candidate.upper()
        for key, original in mapping.items():
            if key.startswith(cu):
                return original
    return None


def read_table(zf: zipfile.ZipFile, logical_name: str) -> pd.DataFrame:
    member = find_member(zf, logical_name)
    with zf.open(member) as fh:
        return pd.read_csv(fh, sep="\t", dtype=str, keep_default_na=False, low_memory=False)


def normalize_cusip(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())[:9]


def is_treasury(issuer: str, title: str, cusip: str) -> bool:
    text = f"{issuer} {title}".upper().replace(".", "")
    treasury_name = any(
        token in text
        for token in (
            "UNITED STATES TREASURY",
            "US TREASURY",
            "UNITED STATES OF AMERICA TREASURY",
            "TREASURY BILL",
            "TREASURY NOTE",
            "TREASURY BOND",
            "TREASURY INFLATION",
        )
    )
    # Marketable U.S. Treasury CUSIPs are overwhelmingly in the 9127/9128
    # families. Use this only as a fallback when issuer text is sparse.
    cusip_hint = cusip.startswith(("9127", "9128"))
    return treasury_name or cusip_hint


def build_summary(raw: bytes, quarter: str, source_url: str) -> dict:
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        submission = read_table(zf, "SUBMISSION")
        fund_info = read_table(zf, "FUND_REPORTED_INFO")
        holding_member = find_member(zf, "FUND_REPORTED_HOLDING")

        sub_acc = pick(submission.columns, "ACCESSION_NUMBER")
        sub_report = pick(submission.columns, "REPORT_DATE")
        sub_filing = pick(submission.columns, "FILING_DATE")
        if not sub_acc or not sub_report:
            raise RuntimeError("Required SUBMISSION columns missing")

        submission["_report"] = pd.to_datetime(submission[sub_report], errors="coerce")
        if sub_filing:
            submission["_filing"] = pd.to_datetime(submission[sub_filing], errors="coerce")
        else:
            submission["_filing"] = pd.NaT
        submission = submission.sort_values(["_report", "_filing", sub_acc])

        info_acc = pick(fund_info.columns, "ACCESSION_NUMBER")
        info_name = pick(fund_info.columns, "SERIES_NAME")
        info_id = pick(fund_info.columns, "SERIES_ID")
        info_net = pick(fund_info.columns, "NET_ASSETS")
        if not info_acc or not info_name:
            raise RuntimeError("Required FUND_REPORTED_INFO columns missing")

        info = fund_info.copy()
        info = info.merge(
            submission[[sub_acc, "_report", "_filing"]],
            left_on=info_acc,
            right_on=sub_acc,
            how="left",
        )
        series_key = info_id if info_id else info_name
        info = info.sort_values([series_key, "_report", "_filing"])
        latest = info.drop_duplicates(series_key, keep="last")
        latest_accessions = set(latest[info_acc].astype(str))

        fund_meta = {}
        for _, row in latest.iterrows():
            acc = str(row[info_acc])
            fund_meta[acc] = {
                "name": str(row[info_name]).strip(),
                "series_id": str(row[info_id]).strip() if info_id else None,
                "report_date": row["_report"].date().isoformat() if pd.notna(row["_report"]) else None,
                "net_assets_billions": (
                    float(pd.to_numeric(row[info_net], errors="coerce")) / 1e9
                    if info_net and pd.notna(pd.to_numeric(row[info_net], errors="coerce"))
                    else None
                ),
            }

        totals = defaultdict(float)
        by_cusip = defaultdict(lambda: {"market_value": 0.0, "funds": set(), "issuer": None, "title": None})

        with zf.open(holding_member) as fh:
            for chunk in pd.read_csv(
                fh,
                sep="\t",
                dtype=str,
                keep_default_na=False,
                low_memory=False,
                chunksize=125_000,
            ):
                h_acc = pick(chunk.columns, "ACCESSION_NUMBER")
                h_issuer = pick(chunk.columns, "ISSUER_NAME")
                h_title = pick(chunk.columns, "TITLE", "ISSUE_TITLE", "INVESTMENT_TITLE")
                h_cusip = pick(chunk.columns, "CUSIP")
                h_value = pick(chunk.columns, "VALUE_USD", "VAL_USD", "VALUE")
                if not h_acc or not h_value:
                    raise RuntimeError("Required FUND_REPORTED_HOLDING columns missing")

                chunk = chunk[chunk[h_acc].astype(str).isin(latest_accessions)]
                if chunk.empty:
                    continue

                for _, row in chunk.iterrows():
                    acc = str(row[h_acc])
                    issuer = str(row[h_issuer]).strip() if h_issuer else ""
                    title = str(row[h_title]).strip() if h_title else ""
                    cusip = normalize_cusip(row[h_cusip]) if h_cusip else ""
                    if not is_treasury(issuer, title, cusip):
                        continue
                    value = pd.to_numeric(row[h_value], errors="coerce")
                    if pd.isna(value):
                        continue
                    value = float(value)
                    totals[acc] += value
                    if cusip and cusip not in {"000000000", "999999999"}:
                        slot = by_cusip[cusip]
                        slot["market_value"] += value
                        slot["funds"].add(acc)
                        slot["issuer"] = slot["issuer"] or issuer
                        slot["title"] = slot["title"] or title

    funds = []
    for acc, value in totals.items():
        meta = fund_meta.get(acc, {})
        funds.append(
            {
                "name": meta.get("name") or acc,
                "series_id": meta.get("series_id"),
                "report_date": meta.get("report_date"),
                "direct_treasury_billions": value / 1e9,
                "net_assets_billions": meta.get("net_assets_billions"),
            }
        )
    funds.sort(key=lambda x: x["direct_treasury_billions"], reverse=True)

    cusips = []
    for cusip, item in by_cusip.items():
        cusips.append(
            {
                "cusip": cusip,
                "issuer": item["issuer"],
                "title": item["title"],
                "market_value_billions": item["market_value"] / 1e9,
                "fund_count": len(item["funds"]),
            }
        )
    cusips.sort(key=lambda x: x["market_value_billions"], reverse=True)

    report_dates = [f["report_date"] for f in funds if f.get("report_date")]
    return {
        "cache_status": "available",
        "quarter": quarter,
        "as_of": max(report_dates) if report_dates else None,
        "source_archive": source_url,
        "dataset_page": "https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets",
        "fund_count": len(funds),
        "direct_treasury_total_billions": sum(f["direct_treasury_billions"] for f in funds),
        "funds": funds[:500],
        "by_cusip": cusips[:1000],
        "note": "Quarterly SEC Form N-PORT public-data cache. Values are reported market values, not par values. Only the latest public report for each fund series in the archive is retained.",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--quarter", default=DEFAULT_QUARTER)
    args = parser.parse_args()

    raw = download(args.url)
    summary = build_summary(raw, args.quarter, args.url)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT} with {summary['fund_count']} funds and {len(summary['by_cusip'])} Treasury CUSIPs")


if __name__ == "__main__":
    main()
