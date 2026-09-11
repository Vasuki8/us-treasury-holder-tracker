from __future__ import annotations

import json

import pandas as pd

import update_data_v14 as phase14

base = phase14.base
DATA_FILE = phase14.DATA_FILE


def _series(key: str, label: str, frequency: str, source_url: str, observations: list[dict]) -> dict:
    clean = [row for row in observations if row.get("date") and row.get("value_billions") is not None]
    clean.sort(key=lambda row: row["date"])
    return {
        "key": key,
        "label": label,
        "unit": "$B",
        "frequency": frequency,
        "source_url": source_url,
        "history_start": clean[0]["date"] if clean else None,
        "as_of": clean[-1]["date"] if clean else None,
        "observation_count": len(clean),
        "observations": clean,
    }


def fetch_debt_all_time() -> dict[str, list[dict]]:
    rows: list[dict] = []
    page = 1
    page_size = 10000
    while True:
        payload = base.get_json(
            base.DEBT_URL,
            params={
                "fields": "record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt",
                "sort": "record_date",
                "page[number]": page,
                "page[size]": page_size,
                "format": "json",
            },
        )
        batch = payload.get("data", [])
        rows.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
        if page > 10:
            raise RuntimeError("Debt to the Penny pagination exceeded safety limit")

    if len(rows) < 500:
        raise RuntimeError(f"Debt to the Penny all-time history unexpectedly short: {len(rows)} rows")

    total = []
    public = []
    intragov = []
    for row in rows:
        date = row.get("record_date")
        if not date:
            continue
        total_value = base.to_float(row.get("tot_pub_debt_out_amt"))
        public_value = base.to_float(row.get("debt_held_public_amt"))
        intragov_value = base.to_float(row.get("intragov_hold_amt"))
        if total_value is not None:
            total.append({"date": date, "value_billions": total_value / 1e9})
        if public_value is not None:
            public.append({"date": date, "value_billions": public_value / 1e9})
        if intragov_value is not None:
            intragov.append({"date": date, "value_billions": intragov_value / 1e9})

    return {"total": total, "public": public, "intragov": intragov}


def fetch_fred_all_time(series_id: str, source_units: str = "millions") -> list[dict]:
    text = base.get_text(base.FRED_CSV, params={"id": series_id})
    df = pd.read_csv(base.StringIO(text))
    if df.empty:
        raise RuntimeError(f"No observations returned for FRED series {series_id}")

    date_col = next(
        (col for col in df.columns if str(col).strip().lower() in {"date", "observation_date", "observation date"}),
        df.columns[0],
    )
    value_col = series_id if series_id in df.columns else next((col for col in reversed(df.columns) if col != date_col), None)
    if value_col is None:
        raise RuntimeError(f"No value column returned for FRED series {series_id}")

    if source_units == "millions":
        divisor_to_billions = 1000.0
    elif source_units == "billions":
        divisor_to_billions = 1.0
    else:
        raise ValueError(f"Unsupported FRED source units for {series_id}: {source_units}")

    values = pd.to_numeric(df[value_col], errors="coerce")
    valid = df.loc[values.notna()].copy()
    valid["_value"] = pd.to_numeric(valid[value_col], errors="coerce")
    return [
        {"date": str(row[date_col]), "value_billions": float(row["_value"]) / divisor_to_billions}
        for _, row in valid.iterrows()
    ]


def _foreign_history(rows: list[dict]) -> list[dict]:
    return [
        {"date": str(row.get("period")), "value_billions": row.get("holdings_billions")}
        for row in rows or []
        if row.get("period") and row.get("holdings_billions") is not None
    ]


def build_all_time_history(data: dict) -> dict:
    debt = fetch_debt_all_time()
    fed = fetch_fred_all_time("TREAST", source_units="millions")
    nominal_gdp = fetch_fred_all_time("GDP", source_units="billions")
    foreign = data.get("foreign_holders", {})

    series = [
        _series(
            "total_public_debt",
            "Total public debt",
            "Business daily",
            base.DEBT_URL,
            debt["total"],
        ),
        _series(
            "debt_held_by_public",
            "Debt held by the public",
            "Business daily",
            base.DEBT_URL,
            debt["public"],
        ),
        _series(
            "intragovernmental_holdings",
            "Intragovernmental holdings",
            "Business daily",
            base.DEBT_URL,
            debt["intragov"],
        ),
        _series(
            "nominal_gdp",
            "Nominal GDP (SAAR)",
            "Quarterly",
            "https://fred.stlouisfed.org/series/GDP",
            nominal_gdp,
        ),
        _series(
            "federal_reserve_treasuries",
            "Federal Reserve Treasury holdings",
            "Weekly",
            "https://fred.stlouisfed.org/series/TREAST",
            fed,
        ),
        _series(
            "foreign_total",
            "Foreign Treasury holdings — total",
            "Monthly",
            foreign.get("source_url") or base.TIC_ALL_URL,
            _foreign_history(foreign.get("grand_total_history", [])),
        ),
        _series(
            "foreign_official",
            "Foreign Treasury holdings — official",
            "Monthly",
            foreign.get("source_url") or base.TIC_ALL_URL,
            _foreign_history(foreign.get("foreign_official_history", [])),
        ),
        _series(
            "foreign_nonofficial",
            "Foreign Treasury holdings — non-official",
            "Monthly",
            foreign.get("source_url") or base.TIC_ALL_URL,
            _foreign_history(foreign.get("foreign_nonofficial_history", [])),
        ),
    ]

    return {
        "series": series,
        "series_count": len(series),
        "note": (
            "All-time means the full history available from each selected official source, not a common synthetic start date. "
            "Business-daily, weekly, monthly and quarterly observations remain on their original reporting schedules and are never forward-filled to look daily. "
            "Nominal GDP is the BEA current-dollar GDP series distributed by FRED and is reported quarterly at a seasonally adjusted annual rate (SAAR)."
        ),
    }


def main() -> None:
    phase14.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    previous = data.get("all_time_history")
    try:
        data["all_time_history"] = build_all_time_history(data)
        data.setdefault("sources", {})["all_time_history"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        if previous and previous.get("series"):
            data["all_time_history"] = previous
            data.setdefault("sources", {})["all_time_history"] = {
                "status": "error",
                "checked_at": base.now_iso(),
                "message": f"{type(exc).__name__}: {exc}; previous verified all-time history retained",
            }
        else:
            raise

    data["generated_at"] = base.now_iso()
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    block = data.get("all_time_history", {})
    print("All-time headline history:", block.get("series_count"), "series")
    for row in block.get("series", []):
        print(" -", row.get("label"), row.get("observation_count"), "observations", row.get("history_start"), "to", row.get("as_of"))


if __name__ == "__main__":
    main()
