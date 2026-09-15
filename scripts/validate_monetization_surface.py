from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
JS = ROOT / "monetization.js"
CSS = ROOT / "monetization.css"


class IdParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.refs: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            self.ids.append(str(values["id"]))
        if tag == "script" and values.get("src"):
            self.refs.append(("script", str(values["src"])))
        if tag == "link" and values.get("href"):
            self.refs.append(("link", str(values["href"])))


def main() -> None:
    assert INDEX.exists(), "index.html missing"
    assert JS.exists(), "monetization.js missing"
    assert CSS.exists(), "monetization.css missing"

    html = INDEX.read_text(encoding="utf-8")
    parser = IdParser()
    parser.feed(html)

    duplicates = sorted({value for value in parser.ids if parser.ids.count(value) > 1})
    assert not duplicates, f"duplicate HTML ids: {duplicates}"

    required_ids = {
        "dashboard",
        "treasuryPro",
        "proSignalGrid",
        "proSignalMeta",
        "pricing",
        "proPrice",
        "proCadence",
        "proPriceSub",
        "productModalBackdrop",
        "productModalTitle",
        "productModalCopy",
    }
    missing = sorted(required_ids.difference(parser.ids))
    assert not missing, f"monetization surface missing ids: {missing}"

    refs = [value for _, value in parser.refs]
    assert any(value.startswith("monetization.js") for value in refs), "index.html does not load monetization.js"
    assert any(value.startswith("monetization.css") for value in refs), "index.html does not load monetization.css"

    required_copy = [
        "Treasury Pro",
        "Data API",
        "$15",
        "$150",
        "$99",
        "public dashboard stays free",
    ]
    for phrase in required_copy:
        assert phrase.lower() in html.lower(), f"missing monetization copy: {phrase}"

    js = JS.read_text(encoding="utf-8")
    for token in ["proMonthly:15", "proAnnual:150", "apiMonthly:99", "data-pro-checkout"]:
        assert token in js, f"missing monetization JS contract: {token}"

    print(
        "Monetization surface validation passed: "
        f"{len(parser.ids)} unique ids; Free/Pro/API pricing and checkout hooks present."
    )


if __name__ == "__main__":
    main()
