from __future__ import annotations

import json
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "dashboard.json"


def reject_constant(value: str):
    raise ValueError(f"Non-standard JSON constant {value}")


def main() -> None:
    text = DATA_FILE.read_text(encoding="utf-8")
    data = json.loads(text, parse_constant=reject_constant)

    if not isinstance(data, dict) or not data.get("generated_at"):
        raise RuntimeError("dashboard.json is missing its expected root metadata")

    curve = data.get("treasury_yield_curve") or {}
    nominal = (curve.get("nominal") or {}).get("history") or []
    if len(nominal) < 1000:
        raise RuntimeError("Nominal yield history unexpectedly sparse after JSON sanitation")

    auction = data.get("treasury_auction_yield_history") or {}
    observations = sum(len(row.get("observations") or []) for row in auction.get("series") or [])
    if observations < 1000:
        raise RuntimeError("Auction-yield history unexpectedly sparse after JSON sanitation")

    print(
        "Browser JSON validation passed:",
        len(text),
        "bytes;",
        len(nominal),
        "nominal yield observations;",
        observations,
        "auction observations",
    )


if __name__ == "__main__":
    main()
