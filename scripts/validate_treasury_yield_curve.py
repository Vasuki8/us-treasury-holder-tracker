from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "dashboard.json"


def finite(value) -> bool:
    try:
        return value is not None and float(value) == float(value)
    except (TypeError, ValueError):
        return False


def main() -> None:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    curve = data.get("treasury_yield_curve") or {}
    nominal = curve.get("nominal") or {}
    real = curve.get("real") or {}
    spreads = curve.get("spreads") or {}
    breakeven = curve.get("breakeven") or {}

    nrows = nominal.get("history") or []
    rrows = real.get("history") or []
    brows = breakeven.get("history") or []
    assert len(nrows) >= 8000, f"nominal curve history unexpectedly short: {len(nrows)}"
    assert len(rrows) >= 5000, f"real curve history unexpectedly short: {len(rrows)}"
    assert len(brows) >= 4500, f"breakeven history unexpectedly short: {len(brows)}"
    assert nrows == sorted(nrows, key=lambda row: row["date"]), "nominal curve history not sorted"
    assert rrows == sorted(rrows, key=lambda row: row["date"]), "real curve history not sorted"

    latest = nominal.get("latest") or {}
    required = ["3m", "6m", "1y", "2y", "5y", "10y", "20y", "30y"]
    assert all(finite(latest.get(key)) for key in required), f"latest nominal curve incomplete: {latest}"
    latest_real = real.get("latest") or {}
    assert all(finite(latest_real.get(key)) for key in ["5y", "7y", "10y", "20y", "30y"]), "latest real curve incomplete"

    spread = spreads.get("latest") or {}
    assert finite(spread.get("10y_2y_bps")), "10Y-2Y spread missing"
    assert finite(spread.get("10y_3m_bps")), "10Y-3M spread missing"
    assert finite(spread.get("30y_10y_bps")), "30Y-10Y spread missing"

    latest_date = datetime.strptime(curve["as_of"], "%Y-%m-%d").date()
    assert (date.today() - latest_date).days <= 10, f"yield curve stale: {latest_date}"
    assert curve.get("as_of") == latest.get("date"), "yield curve as-of mismatch"
    assert nominal.get("history_start") <= "1990-01-31", "nominal history should reach 1990"
    assert real.get("history_start") <= "2003-02-15", "real history should reach early 2003"

    refi = curve.get("refinancing_context") or {}
    assert finite(refi.get("next_12m_principal_billions")), "12M refinancing context missing"

    print(
        "Treasury yield curve validation passed:",
        len(nrows),
        "nominal observations",
        nominal.get("history_start"),
        "to",
        curve.get("as_of"),
        ";",
        len(rrows),
        "real observations; 10Y-2Y",
        round(float(spread["10y_2y_bps"]), 1),
        "bps.",
    )


if __name__ == "__main__":
    main()
