from __future__ import annotations

import json

import pandas as pd

import update_data_v17 as phase17

base = phase17.base
DATA_FILE = phase17.DATA_FILE

SERIES = [
    {
        "key": "hedge_funds",
        "label": "Hedge funds",
        "series_id": "BOGZ1LM623061103Q",
        "source_start": "2012-10-01",
        "note": "Federal Reserve estimate of hedge-fund physical Treasury holdings at market value, excluding derivative exposure; underlying source is SEC Form PF.",
    },
    {
        "key": "money_market_funds",
        "label": "Money market funds",
        "series_id": "BOGZ1FL633061105Q",
        "drop_leading_zeros": True,
        "note": "Treasury securities held by money market funds, quarterly end-of-period level. Leading pre-industry zero placeholders are removed.",
    },
    {
        "key": "mutual_funds",
        "label": "Mutual funds",
        "series_id": "BOGZ1LM653061105Q",
        "note": "Treasury securities held by mutual funds at market value.",
    },
    {
        "key": "etfs",
        "label": "Exchange-traded funds",
        "series_id": "BOGZ1LM563061103Q",
        "drop_leading_zeros": True,
        "note": "Treasury securities held by exchange-traded funds at market value. Leading pre-industry zero placeholders are removed.",
    },
    {
        "key": "private_pension_funds",
        "label": "Private pension funds",
        "series_id": "BOGZ1LM573061105Q",
        "note": "Treasury securities held by private pension funds at market value.",
    },
    {
        "key": "life_insurance",
        "label": "Life insurance companies",
        "series_id": "BOGZ1LM543061105Q",
        "note": "Treasury securities held by life insurance companies at market value.",
    },
    {
        "key": "property_casualty_insurance",
        "label": "Property-casualty insurance companies",
        "series_id": "BOGZ1LM513061105Q",
        "note": "Treasury securities held by property-casualty insurance companies at market value, including specified U.S. residual-market reinsurers.",
    },
    {
        "key": "us_depository_institutions",
        "label": "U.S.-chartered depository institutions",
        "series_id": "BOGZ1LM763061100Q",
        "note": "Treasury securities held by U.S.-chartered depository institutions at market value.",
    },
    {
        "key": "broker_dealers",
        "label": "Security brokers and dealers",
        "series_id": "BOGZ1LM663061105Q",
        "note": "Net Treasury securities held by security brokers and dealers at market value; historical values can be negative because this is a net position series.",
    },
]


def fetch_fred_quarterly(series_id: str) -> list[dict]:
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

    values = pd.to_numeric(df[value_col], errors="coerce")
    valid = df.loc[values.notna()].copy()
    valid["_value"] = pd.to_numeric(valid[value_col], errors="coerce")
    return [
        {"date": str(row[date_col])[:10], "value_billions": float(row["_value"]) / 1000.0}
        for _, row in valid.iterrows()
    ]


def clean_observations(config: dict, observations: list[dict]) -> list[dict]:
    rows = [
        {"date": str(row["date"])[:10], "value_billions": float(row["value_billions"])}
        for row in observations
        if row.get("date") and row.get("value_billions") is not None
    ]
    rows.sort(key=lambda row: row["date"])

    source_start = config.get("source_start")
    if source_start:
        rows = [row for row in rows if row["date"] >= source_start]

    if config.get("drop_leading_zeros"):
        first_nonzero = next((i for i, row in enumerate(rows) if abs(float(row["value_billions"])) > 1e-9), None)
        if first_nonzero is not None:
            rows = rows[first_nonzero:]

    return rows


def build_institution_history() -> dict:
    series = []
    for config in SERIES:
        observations = clean_observations(config, fetch_fred_quarterly(config["series_id"]))
        if len(observations) < 8:
            raise RuntimeError(f"Institution history unexpectedly short for {config['series_id']}: {len(observations)} observations")
        series.append(
            {
                "key": config["key"],
                "label": config["label"],
                "series_id": config["series_id"],
                "unit": "$B",
                "frequency": "Quarterly",
                "source_url": f"https://fred.stlouisfed.org/series/{config['series_id']}",
                "underlying_source": "Board of Governors of the Federal Reserve System — Financial Accounts of the United States",
                "history_start": observations[0]["date"],
                "as_of": observations[-1]["date"],
                "observation_count": len(observations),
                "note": config["note"],
                "observations": observations,
            }
        )

    latest = max((row["as_of"] for row in series if row.get("as_of")), default=None)
    return {
        "as_of": latest,
        "frequency": "Quarterly",
        "unit": "$B",
        "series_count": len(series),
        "series": series,
        "note": (
            "Institution histories use Treasury-specific quarterly holdings series from the Federal Reserve Financial Accounts, distributed through FRED. "
            "Hedge-fund holdings begin in 2012:Q4 because that is when the Form PF-based estimate begins; pre-2012 placeholder zeros are excluded. "
            "Leading zero placeholders are also removed where they predate an institution type's meaningful reported history. "
            "Broker-dealer holdings are a net position series and can be negative. Financial Accounts data can be revised in later releases."
        ),
    }


def main() -> None:
    prior_data = json.loads(DATA_FILE.read_text(encoding="utf-8")) if DATA_FILE.exists() else {}
    previous = prior_data.get("institution_holder_history")

    phase17.main()
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    try:
        data["institution_holder_history"] = build_institution_history()
        data.setdefault("sources", {})["institution_holder_history"] = {
            "status": "ok",
            "checked_at": base.now_iso(),
            "message": None,
        }
    except Exception as exc:
        if previous and previous.get("series"):
            data["institution_holder_history"] = previous
            data.setdefault("sources", {})["institution_holder_history"] = {
                "status": "error",
                "checked_at": base.now_iso(),
                "message": f"{type(exc).__name__}: {exc}; previous verified institution history retained",
            }
        else:
            raise

    data["generated_at"] = base.now_iso()
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    block = data.get("institution_holder_history") or {}
    print("Institution Treasury history:", block.get("series_count"), "series; latest", block.get("as_of"))
    for row in block.get("series") or []:
        print(" -", row.get("label"), row.get("observation_count"), "observations", row.get("history_start"), "to", row.get("as_of"))


if __name__ == "__main__":
    main()
