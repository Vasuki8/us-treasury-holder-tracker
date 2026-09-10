from __future__ import annotations

import re
import time
from urllib.parse import urljoin

import pandas as pd
import requests
from bs4 import BeautifulSoup

import update_data as base

# Phase-2 compatibility wrapper. It fixes live-source behaviors that can vary
# in hosted CI environments without duplicating the full collector.

_ORIGINAL_GET_RESPONSE = base.get_response

SEC_HEADERS = {
    "User-Agent": (
        "us-treasury-holder-tracker/2.1 Vasuki8 "
        "(contact via https://github.com/Vasuki8/us-treasury-holder-tracker/issues)"
    ),
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
}

KNOWN_NMFP_LABEL = "2026 August NMFP"
KNOWN_NMFP_ARCHIVE = (
    "https://www.sec.gov/files/dera/data/form-n-mfp-data-sets/"
    "20260810-20260908_nmfp.zip"
)

TRANSIENT_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}


def get_response(url: str, params: dict | None = None) -> requests.Response:
    headers = SEC_HEADERS if "sec.gov" in url.lower() else base.HEADERS
    # Treasury Fiscal Data occasionally times out from hosted GitHub runners.
    # Retry only transient network/server failures; deterministic 4xx responses
    # such as the known SEC 403 are returned immediately to the source-level
    # error handler instead of wasting several minutes.
    attempts = 3 if "api.fiscaldata.treasury.gov" in url.lower() else 2
    last_error: Exception | None = None

    for attempt in range(attempts):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=base.TIMEOUT)
            if r.status_code in TRANSIENT_STATUS_CODES and attempt + 1 < attempts:
                time.sleep(1.5 * (2 ** attempt))
                continue
            r.raise_for_status()
            return r
        except (requests.Timeout, requests.ConnectionError) as exc:
            last_error = exc
            if attempt + 1 >= attempts:
                raise
            time.sleep(1.5 * (2 ** attempt))
        except requests.HTTPError as exc:
            last_error = exc
            response = exc.response
            if response is None or response.status_code not in TRANSIENT_STATUS_CODES or attempt + 1 >= attempts:
                raise
            time.sleep(1.5 * (2 ** attempt))

    if last_error is not None:
        raise last_error
    raise RuntimeError(f"No HTTP response returned for {url}")


def fetch_fred_series(series_id: str) -> tuple[str, float]:
    text = base.get_text(base.FRED_CSV, params={"id": series_id})
    df = pd.read_csv(base.StringIO(text))
    if df.empty:
        raise RuntimeError(f"No observations returned for FRED series {series_id}")

    # FRED has used both DATE and observation_date as the first column name.
    # Treat the first date-like column as the observation date instead of
    # depending on one exact header.
    date_col = None
    for col in df.columns:
        normalized = str(col).strip().lower()
        if normalized in {"date", "observation_date", "observation date"}:
            date_col = col
            break
    if date_col is None:
        date_col = df.columns[0]

    value_col = series_id if series_id in df.columns else None
    if value_col is None:
        value_cols = [c for c in df.columns if c != date_col]
        if not value_cols:
            raise RuntimeError(f"No value column returned for FRED series {series_id}")
        value_col = value_cols[-1]

    values = pd.to_numeric(df[value_col], errors="coerce")
    valid = df.loc[values.notna()].copy()
    if valid.empty:
        raise RuntimeError(f"No numeric observations returned for FRED series {series_id}")

    row = valid.iloc[-1]
    return str(row[date_col]), float(row[value_col])


def find_latest_nmfp_archive() -> tuple[str, str]:
    try:
        html = base.get_text(base.SEC_NMFP_PAGE)
        soup = BeautifulSoup(html, "html.parser")
        candidates = []
        for a in soup.find_all("a", href=True):
            href = str(a["href"])
            if "_nmfp.zip" not in href.lower():
                continue
            url = urljoin(base.SEC_NMFP_PAGE, href)
            label = a.get_text(" ", strip=True)
            m = re.search(r"(\d{8})-(\d{8})_nmfp\.zip", href, re.I)
            sort_key = m.group(2) if m else ""
            candidates.append((sort_key, label, url))
        if candidates:
            _, label, url = max(candidates, key=lambda x: x[0])
            return label, url
    except Exception:
        pass

    # SEC sometimes blocks the index page from cloud CI while the actual public
    # dataset remains downloadable. Keep a known-current archive fallback so a
    # transient index-page block does not take the whole dataset offline.
    return KNOWN_NMFP_LABEL, KNOWN_NMFP_ARCHIVE


base.get_response = get_response
base.fetch_fred_series = fetch_fred_series
base._find_latest_nmfp_archive = find_latest_nmfp_archive


if __name__ == "__main__":
    base.main()
