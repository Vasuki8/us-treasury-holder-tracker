from __future__ import annotations

import json
from pathlib import Path

from pro_brief_engine import build_brief

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "data" / "dashboard.json"
OUTPUT = ROOT / "data" / "pro-brief-preview.json"


def main() -> None:
    data = json.loads(DASHBOARD.read_text(encoding="utf-8"))
    brief = build_brief(data)
    OUTPUT.write_text(
        json.dumps(brief, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(
        "Daily Treasury Brief preview built: "
        f"{len(brief['summary'])} summary lines, {len(brief['sections'])} sections, "
        f"source {brief.get('source_generated_at') or 'unknown'}."
    )


if __name__ == "__main__":
    main()
