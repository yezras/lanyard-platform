"""lp-a79.9: headless proof of bar + pie charts in chat timeline.

Auth-free story route `/?story=chart-bar-pie` renders ChatMessageContent with
```chart fences (bar + pie) plus one invalid fence (error card, no crash).

Requires a live Vite dev server:

  # From packages/web
  pnpm exec vite --port 3023 --host 127.0.0.1

  cd ui-testing
  export BASE_URL=http://127.0.0.1:3023
  # monorepo root artifacts (preferred):
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-a79
  pytest -v test_chart_bar_pie.py

Screenshot: artifacts/ui/lp-a79/chart-bar-pie.png
Evidence JSON: artifacts/ui/lp-a79/chart-bar-pie.json
"""

from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import Page, expect


def test_chart_bar_pie_in_chat(page: Page, base_url: str, artifacts_dir: Path):
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(
        f"{base_url}/?story=chart-bar-pie",
        wait_until="networkidle",
        timeout=60_000,
    )

    story = page.get_by_test_id("chart-bar-pie-proof-story")
    expect(story).to_be_visible(timeout=15_000)
    expect(page.get_by_test_id("chart-bar-pie-assistant-bubble")).to_be_visible()

    # Prose from fixture
    expect(page.get_by_text("Here is the quarterly breakdown:")).to_be_visible()
    expect(page.get_by_text("And the share of spend:")).to_be_visible()

    # PortalChartCard for bar + pie (not raw JSON fences)
    cards = page.get_by_test_id("portal-chart-card")
    expect(cards).to_have_count(2)

    bar = page.locator('[data-testid="portal-chart-card"][data-chart-type="bar"]')
    pie = page.locator('[data-testid="portal-chart-card"][data-chart-type="pie"]')
    expect(bar).to_be_visible()
    expect(pie).to_be_visible()
    expect(bar.get_by_test_id("portal-chart-card-title")).to_have_text(
        "Q1 revenue vs cost"
    )
    expect(pie.get_by_test_id("portal-chart-card-title")).to_have_text(
        "Spend by category"
    )
    expect(bar.get_by_test_id("portal-chart-card-plot")).to_be_visible()
    expect(pie.get_by_test_id("portal-chart-card-plot")).to_be_visible()

    # Require real SVG paint (not blank plot shells). Lazy load + Recharts need time.
    # Pie SVG shell is often visible ~1\u20131.5s before sector <path> nodes paint
    # (lp-4h6.1 / lp-dax race: assert path count only after wait).
    bar_svg = bar.locator("svg").first
    pie_svg = pie.locator("svg").first
    expect(bar_svg).to_be_visible(timeout=45_000)
    expect(pie_svg).to_be_visible(timeout=45_000)
    bar_box = bar_svg.bounding_box()
    pie_box = pie_svg.bounding_box()
    assert bar_box is not None and bar_box["width"] >= 80 and bar_box["height"] >= 80, bar_box
    assert pie_box is not None and pie_box["width"] >= 80 and pie_box["height"] >= 80, pie_box
    # Wait for Recharts geometry \u2014 SVG visible alone is not enough for pie paths.
    pie_path_loc = pie_svg.locator("path")
    bar_shape_loc = bar_svg.locator("path, rect")
    expect(pie_path_loc.first).to_be_attached(timeout=45_000)
    expect(bar_shape_loc.first).to_be_attached(timeout=45_000)
    pie_paths = pie_path_loc.count()
    assert pie_paths >= 1, f"pie SVG has no paths (blank?): {pie_paths}"
    bar_shapes = bar_shape_loc.count()
    assert bar_shapes >= 1, f"bar SVG has no shapes (blank?): {bar_shapes}"

    # Invalid fence \u2192 error card, no crash
    err = page.get_by_test_id("chart-spec-error-card")
    expect(err).to_be_visible()
    expect(err).to_have_attribute("role", "alert")
    code = err.get_attribute("data-error-code")
    assert code in {"schema", "json", "limits", "empty"}, code

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    shot_path = artifacts_dir / "chart-bar-pie.png"
    page.screenshot(path=str(shot_path), full_page=True)
    assert shot_path.is_file() and shot_path.stat().st_size > 0

    evidence = {
        "bead": "lp-a79.9",
        "story": "chart-bar-pie",
        "url": f"{base_url}/?story=chart-bar-pie",
        "screenshot": str(shot_path.name),
        "assertions": {
            "portal_chart_card_count": 2,
            "bar_title": "Q1 revenue vs cost",
            "pie_title": "Spend by category",
            "bar_svg": True,
            "pie_svg": True,
            "bar_svg_width": round(bar_box["width"]),
            "bar_svg_height": round(bar_box["height"]),
            "pie_svg_width": round(pie_box["width"]),
            "pie_svg_height": round(pie_box["height"]),
            "pie_paths": pie_paths,
            "bar_shapes": bar_shapes,
            "error_card": True,
            "error_code": code,
            "error_role": "alert",
        },
        "notes": (
            "Bar + pie charts in chat via ```chart fences "
            "(ChatMessageContent \u2192 ChatRichCodeBlock \u2192 PortalChartCard). "
            "SVG paint asserted after waiting for pie path / bar shape attach "
            "(lp-4h6.1 race fix). "
            "Invalid fence shows ChartSpecErrorCard without crashing the tree."
        ),
    }
    json_path = artifacts_dir / "chart-bar-pie.json"
    json_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    assert json_path.is_file()
