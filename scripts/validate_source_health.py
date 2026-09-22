from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "data" / "source-health.json"

REQUIRED_IDS = {"debt_to_penny","fed_h41","tic_foreign","treasury_yield_curve","mspd_maturities","tga","auction_results","primary_dealers","financial_accounts","sec_nport"}
VALID_STATUSES = {"current","expected_lag","stale","unavailable","runner_limited"}
VALID_CADENCES = {"business_daily","daily","weekly","monthly","quarterly","auction"}

def parse_date(value: object) -> date | None:
    if value in (None, ""):
        return None
    text = str(value)
    try:
        if "T" in text:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
        return date.fromisoformat(text[:10])
    except ValueError:
        return None

def main() -> None:
    if not PATH.exists():
        raise SystemExit("data/source-health.json is missing")
    data = json.loads(PATH.read_text(encoding="utf-8"))
    if data.get("schema_version") != "1.0":
        raise SystemExit("source-health schema_version must be 1.0")
    evaluation_date = parse_date(data.get("evaluation_date"))
    if evaluation_date is None:
        raise SystemExit("source-health evaluation_date is invalid")
    rows = data.get("sources")
    if not isinstance(rows, list):
        raise SystemExit("source-health sources must be a list")
    ids = [row.get("id") for row in rows if isinstance(row, dict)]
    missing = sorted(REQUIRED_IDS - set(ids))
    if missing:
        raise SystemExit(f"source-health missing required sources: {', '.join(missing)}")
    if len(ids) != len(set(ids)):
        raise SystemExit("source-health contains duplicate source ids")
    for row in rows:
        if not isinstance(row, dict):
            raise SystemExit("source-health source rows must be objects")
        source_id = row.get("id") or "unknown"
        if row.get("status") not in VALID_STATUSES:
            raise SystemExit(f"{source_id}: invalid status {row.get('status')!r}")
        if row.get("cadence") not in VALID_CADENCES:
            raise SystemExit(f"{source_id}: invalid cadence {row.get('cadence')!r}")
        if not str(row.get("source_url") or "").startswith("https://"):
            raise SystemExit(f"{source_id}: official source_url must be https")
        observation = parse_date(row.get("observation_date"))
        if observation and observation > evaluation_date:
            raise SystemExit(f"{source_id}: observation date is after evaluation date")
        if row.get("status") in {"current","expected_lag","stale"} and observation is None:
            raise SystemExit(f"{source_id}: dated status requires observation_date")
    sec = next(row for row in rows if row.get("id") == "sec_nport")
    if sec.get("status") == "runner_limited":
        note = f"{sec.get('note','')} {data.get('sec_runner_note','')}".lower()
        if "github-hosted" not in note or "last-good" not in note:
            raise SystemExit("SEC runner-limited status must document hosted-runner and last-good-data behavior")
    counts = data.get("counts") or {}
    for status in VALID_STATUSES:
        actual = sum(row.get("status") == status for row in rows)
        if counts.get(status) != actual:
            raise SystemExit(f"source-health count mismatch for {status}: {counts.get(status)} != {actual}")
    methodology = str(data.get("methodology") or "").lower()
    if "cadence-aware" not in methodology or "observation" not in methodology or "collection" not in methodology:
        raise SystemExit("source-health methodology must distinguish cadence, observation time and collection time")
    print(f"Source health validated: {len(rows)} source families, overall={data.get('overall_status')}.")

if __name__ == "__main__":
    main()
