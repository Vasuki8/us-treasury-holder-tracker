from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

import update_data_v2 as phase2

base = phase2.base
DATA_FILE = base.DATA_FILE

PD_SOURCE = "https://www.newyorkfed.org/markets/primarydealers"
PD_API = "https://markets.newyorkfed.org/api/pd/get/PDPOSGST-TOT_PDFTD-USTET_PDFTR-USTET.json"

INSTITUTIONAL_SERIES = [
    (
        "U.S.-chartered depository institutions",
        "BOGZ1FL763061100Q",
        "Quarterly",
    ),
    (
        "Private depository institutions",
        "BOGZ1LM703061105Q",
        "Quarterly",
    ),
    (
        "Security brokers and dealers",
        "BOGZ1FL663061105Q",
        "Quarterly",
    ),
]


def fred_history(series_id: str, limit: int = 40) -> list[dict]:
    text = base.get_text(base.FRED_CSV, params={"id": series_id})
    df = pd.read_csv(base.StringIO(text))
    if df.empty:
        return []

    date_col = None
    for col in df.columns:
        normalized = str(col).strip().lower()
        if normalized in {"date", "observation_date", "observation date"}:
            date_col = col
            break
    if date_col is None:
        date_col = df.columns[0]

    value_col = series_id if series_id in df.columns else [c for c in df.columns if c != date_col][-1]
    df["_value"] = pd.to_numeric(df[value_col], errors="coerce")
    df = df[df["_value"].notna()].tail(limit)
    return [
        {"date": str(row[date_col]), "value_billions": float(row["_value"]) / 1000.0}
        for _, row in df.iterrows()
    ]


def fetch_institutional_aggregates() -> dict:
    institutions = []
    latest_date = None
    for name, series_id, frequency in INSTITUTIONAL_SERIES:
        history = fred_history(series_id, limit=40)
        if not history:
            continue
        latest = history[-1]
        latest_date = max(latest_date or latest["date"], latest["date"])
        institutions.append(
            {
                "name": name,
                "series": series_id,
                "as_of": latest["date"],
                "holdings_billions": latest["value_billions"],
                "frequency": frequency,
                "history": history,
            }
        )

    if len(institutions) < 2:
        raise RuntimeError("Could not retrieve institutional Treasury series")

    return {
        "as_of": latest_date,
        "institutions": institutions,
        "frequency": "Quarterly",
        "source_url": "https://fred.stlouisfed.org/",
        "note": "These are sector aggregates, not named institution-by-institution holdings.",
    }


def fetch_primary_dealers() -> dict:
    payload = base.get_json(PD_API)
    rows = payload.get("pd", {}).get("timeseries", [])
    if not rows:
        raise RuntimeError("NY Fed primary-dealer API returned no observations")

    labels = {
        "PDPOSGST-TOT": "Treasury dealer net position ex-TIPS",
        "PDFTD-USTET": "Treasury fails to deliver ex-TIPS",
        "PDFTR-USTET": "Treasury fails to receive ex-TIPS",
    }
    grouped: dict[str, list[dict]] = {k: [] for k in labels}

    for row in rows:
        key = str(row.get("keyid") or "")
        if key not in grouped:
            continue
        value = base.to_float(row.get("value"))
        date = row.get("asofdate") or row.get("asOfDate")
        if value is None or not date:
            continue
        grouped[key].append(
            {
                "date": str(date),
                "value_billions": value / 1000.0,
            }
        )

    series = []
    latest_date = None
    for key, label in labels.items():
        history = sorted(grouped[key], key=lambda x: x["date"])[-104:]
        if not history:
            continue
        latest = history[-1]
        latest_date = max(latest_date or latest["date"], latest["date"])
        previous = history[-2]["value_billions"] if len(history) > 1 else None
        series.append(
            {
                "keyid": key,
                "name": label,
                "as_of": latest["date"],
                "value_billions": latest["value_billions"],
                "weekly_change_billions": (
                    latest["value_billions"] - previous if previous is not None else None
                ),
                "history": history,
            }
        )

    if not series:
        raise RuntimeError("No selected NY Fed primary-dealer Treasury series were found")

    return {
        "as_of": latest_date,
        "series": series,
        "frequency": "Weekly; updated Thursdays with the previous week's data",
        "source_url": PD_SOURCE,
        "api_url": PD_API,
        "note": "Dealer positions are aggregate net positions reported by primary dealers, not a list of each dealer's holdings.",
    }


def append_daily_history(data: dict, max_points: int = 1500) -> None:
    o = data.get("overview", {})
    fed = data.get("fed", {})
    foreign = data.get("foreign_holders", {})
    soma = data.get("soma", {})
    inst = data.get("institutional_aggregates", {})
    pddata = data.get("primary_dealers", {})

    bank = next(
        (
            x for x in inst.get("institutions", [])
            if x.get("name") == "U.S.-chartered depository institutions"
        ),
        {},
    )
    dealer = next(
        (
            x for x in pddata.get("series", [])
            if x.get("keyid") == "PDPOSGST-TOT"
        ),
        {},
    )

    point = {
        "snapshot_date": (data.get("generated_at") or base.now_iso())[:10],
        "generated_at": data.get("generated_at"),
        "total_public_debt_trillions": (
            o.get("total_public_debt") / 1e12 if o.get("total_public_debt") is not None else None
        ),
        "debt_held_by_public_trillions": (
            o.get("debt_held_by_public") / 1e12 if o.get("debt_held_by_public") is not None else None
        ),
        "fed_treasuries_billions": fed.get("treasury_holdings_billions"),
        "foreign_holdings_billions": foreign.get("grand_total_billions"),
        "soma_treasuries_billions": soma.get("treasury_total_billions"),
        "us_banks_treasuries_billions": bank.get("holdings_billions"),
        "primary_dealer_net_billions": dealer.get("value_billions"),
    }

    history = data.setdefault("history", [])
    history = [h for h in history if h.get("snapshot_date") != point["snapshot_date"]]
    history.append(point)
    history.sort(key=lambda x: x.get("snapshot_date") or "")
    data["history"] = history[-max_points:]


def main() -> None:
    # Run the Phase-2 collector first. It preserves last-good observations on
    # individual source failures.
    base.main()

    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    data.setdefault("sources", {})
    data.setdefault("errors", [])

    base.update_section(data, "institutional_aggregates", fetch_institutional_aggregates)
    base.update_section(data, "primary_dealers", fetch_primary_dealers)

    # Update generation time after Phase-3 sources have been checked, then keep
    # one compact daily snapshot for long-run trend charts.
    data["generated_at"] = base.now_iso()
    append_daily_history(data)

    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Phase 3 updated {DATA_FILE}")


if __name__ == "__main__":
    main()
