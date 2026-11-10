"""lp-uxy.15.8: Live UI QA — web search Firecrawl / richer results UI (shipped lp-uxy.7).

Story path (auth-free, cost-gated fixture):

  ?story=web-search-results

  Structured cards + Firecrawl badges + rich citation chips.

Run:

  export BASE_URL=http://demo.localhost:3010
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-uxy-ship-qa/web-search
  pytest -v test_lp_uxy_15_8_web_search_results.py

Evidence: screenshots + REPORT.json + RESULT.md under UI_ARTIFACTS (full ship-qa
also exercises live LA search; Firecrawl gated when key absent).
"""

from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import Page, expect

FIXTURE_URL = "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup"
DESKTOP = {"width": 1440, "height": 900}


def test_lp_uxy_15_8_web_search_story_richer_results(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Auth-free story proves structured results + rich citations (fixture path)."""
    page.set_viewport_size(DESKTOP)
    page.goto(
        f"{base_url.rstrip('/')}/?story=web-search-results",
        wait_until="domcontentloaded",
        timeout=60_000,
    )

    story = page.get_by_test_id("web-search-results-proof-story")
    expect(story).to_be_visible(timeout=20_000)
    expect(story).to_have_attribute("data-firecrawl-live", "false")
    expect(story).to_have_attribute("data-cost-gated", "true")

    expect(page.get_by_test_id("web-search-tool-panel")).to_be_visible()
    expect(page.get_by_test_id("web-search-results-panel")).to_be_visible()
    expect(page.get_by_test_id("web-search-answer-panel")).to_be_visible()

    # Expand tool rows for screenshot completeness
    for name in ("Searching the web", "Browsing the web"):
        rows = page.get_by_role("button", name=name)
        for i in range(min(rows.count(), 4)):
            try:
                rows.nth(i).click(timeout=2000)
            except Exception:
                pass

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(
        path=str(artifacts_dir / "pytest-story-structured-results.png"),
        full_page=True,
    )

    cards = page.locator('[data-testid^="web-search-results-item-"]')
    assert cards.count() >= 3, cards.count()
    expect(page.get_by_text("2026 FIFA World Cup").first).to_be_visible()
    body = page.locator("body").inner_text()
    assert "Firecrawl" in body
    assert "jointly hosted by Canada, Mexico, and the United States" in body

    cite1 = page.get_by_test_id("web-citation-1")
    expect(cite1).to_be_visible()
    expect(cite1).to_have_attribute("data-citation-rich", "true")
    expect(cite1).to_have_attribute("data-citation-url", FIXTURE_URL)

    page.evaluate(
        """() => {
      window.__opened = [];
      window.open = (url, target, features) => {
        window.__opened.push({url, target, features});
        return null;
      };
    }"""
    )
    btn = cite1.locator("button").first
    (btn if btn.count() else cite1).click()
    opened = page.evaluate("() => window.__opened || []")
    assert opened and opened[0]["url"] == FIXTURE_URL, opened

    evidence = {
        "bead_id": "lp-uxy.15.8",
        "story": "web-search-results",
        "cost_gated": True,
        "firecrawl_live": False,
        "result_card_count": cards.count(),
        "citation_rich": True,
        "citation_opens_external": True,
    }
    (artifacts_dir / "pytest-story-evidence.json").write_text(
        json.dumps(evidence, indent=2) + "\n"
    )
