from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
JS = ROOT / "monetization.js"
CSS = ROOT / "monetization.css"
BILLING = ROOT / "billing-config.js"
LEGAL_PAGES = [ROOT / "terms.html", ROOT / "privacy.html", ROOT / "refunds.html"]
CHECKOUT_PAGES = [ROOT / "checkout-success.html", ROOT / "checkout-cancelled.html"]
ROBOTS = ROOT / "robots.txt"
SITEMAP = ROOT / "sitemap.xml"
PRO_ALERT_PREVIEW = ROOT / "data" / "pro-alert-preview.json"


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


def parse_html(path: Path) -> IdParser:
    parser = IdParser()
    parser.feed(path.read_text(encoding="utf-8"))
    duplicates = sorted({value for value in parser.ids if parser.ids.count(value) > 1})
    assert not duplicates, f"duplicate HTML ids in {path.name}: {duplicates}"
    return parser


def main() -> None:
    required_files = [INDEX, JS, CSS, BILLING, *LEGAL_PAGES, *CHECKOUT_PAGES, ROBOTS, SITEMAP, PRO_ALERT_PREVIEW]
    missing_files = [path.name for path in required_files if not path.exists()]
    assert not missing_files, f"monetization files missing: {missing_files}"

    html = INDEX.read_text(encoding="utf-8")
    parser = parse_html(INDEX)
    for page in [*LEGAL_PAGES, *CHECKOUT_PAGES]:
        parse_html(page)

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
    for token in [
        "billing-config.js",
        "alertBuilder",
        "alertMetric",
        "alertPreviewState",
        "data-pro-checkout",
        "treasury:product-event",
        "pro-alert-preview.json",
        "alertEnginePreview",
        "alert_engine_preview_loaded",
    ]:
        assert token in js, f"missing monetization JS contract: {token}"

    css = CSS.read_text(encoding="utf-8")
    for token in [".alert-builder", ".alert-engine-preview", ".alert-engine-rule", ".legal-shell", ".checkout-state-card"]:
        assert token in css, f"missing monetization CSS contract: {token}"

    billing = BILLING.read_text(encoding="utf-8")
    for token in [
        "treasury-pro-monthly",
        "treasury-pro-annual",
        "treasury-api-monthly",
        "price:15",
        "price:150",
        "price:99",
        "checkout-success.html",
        "checkout-cancelled.html",
    ]:
        assert token in billing, f"missing billing config contract: {token}"

    forbidden_secret_patterns = [r"sk_(?:live|test)_", r"rk_(?:live|test)_", r"whsec_", r"STRIPE_SECRET"]
    for pattern in forbidden_secret_patterns:
        assert not re.search(pattern, billing, flags=re.I), f"secret-like token found in public billing config: {pattern}"

    legal_requirements = {
        "terms.html": ["informational and research purposes only", "Paid plans and renewals"],
        "privacy.html": ["do not sell user data", "Payments"],
        "refunds.html": ["Cancel anytime", "generally non-refundable"],
    }
    for filename, phrases in legal_requirements.items():
        text = (ROOT / filename).read_text(encoding="utf-8")
        for phrase in phrases:
            assert phrase.lower() in text.lower(), f"{filename} missing policy copy: {phrase}"

    robots = ROBOTS.read_text(encoding="utf-8")
    sitemap = SITEMAP.read_text(encoding="utf-8")
    assert "sitemap.xml" in robots.lower(), "robots.txt missing sitemap reference"
    assert "checkout-success.html" not in sitemap, "checkout success page must not be indexed"
    assert "us-treasury-holder-tracker/" in sitemap, "sitemap missing canonical dashboard URL"

    print(
        "Monetization surface validation passed: "
        f"{len(parser.ids)} unique dashboard ids; Free/Pro/API pricing, alert preview, "
        "billing config, alert-engine preview, legal pages and checkout return pages are present."
    )


if __name__ == "__main__":
    main()
