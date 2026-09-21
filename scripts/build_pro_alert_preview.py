from __future__ import annotations

import json
from pathlib import Path

from pro_alert_engine import build_preview

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "data" / "dashboard.json"
OUTPUT = ROOT / "data" / "pro-alert-preview.json"


def main() -> None:
    data = json.loads(DASHBOARD.read_text(encoding="utf-8"))
    preview = build_preview(data)
    OUTPUT.write_text(
        json.dumps(preview, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(
        "Treasury Pro alert preview built: "
        f"{preview['metric_count']} metrics, {preview['rule_count']} sample rules, "
        f"source {preview.get('source_generated_at') or 'unknown'}."
    )


if __name__ == "__main__":
    main()
