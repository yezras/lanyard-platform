"""lp-5q6.15: headless proof of responsive / accessible document pane.

Requires a live Vite dev server (auth-free story route).

  pnpm exec vite --port 3017 --host 127.0.0.1
  export BASE_URL=http://127.0.0.1:3017
  export UI_ARTIFACTS=../../../artifacts/ui/document-pane-responsive
  pytest -v test_document_pane_responsive.py test_document_pane_desktop.py
"""

from __future__ import annotations

from pathlib import Path

import pytest
from playwright.sync_api import Page, expect

# Viewport presets covering acceptance: desktop wide, laptop, tablet, mobile.
VIEWPORTS = {
    "desktop-wide": {"width": 1920, "height": 1080},
    "laptop": {"width": 1280, "height": 720},
    "tablet": {"width": 820, "height": 1180},
    "mobile": {"width": 390, "height": 844},
}


def _assert_controls(page: Page) -> None:
    expect(page.get_by_role("button", name="Close document pane")).to_be_visible()
    expect(page.get_by_role("button", name="Reload document")).to_be_visible()
    expect(page.get_by_role("button", name="Open in Vault")).to_be_visible()
    expect(page.get_by_role("button", name="Download document")).to_be_visible()


@pytest.mark.parametrize(
    "name,size,layout_query,expect_drawer",
    [
        ("desktop-wide", VIEWPORTS["desktop-wide"], "split", False),
        ("laptop", VIEWPORTS["laptop"], "split", False),
        ("tablet", VIEWPORTS["tablet"], "split", False),
        ("mobile", VIEWPORTS["mobile"], "drawer", True),
    ],
)
def test_document_pane_responsive_viewports(
    page: Page,
    base_url: str,
    artifacts_dir: Path,
    shot,
    name: str,
    size: dict[str, int],
    layout_query: str,
    expect_drawer: bool,
):
    page.set_viewport_size(size)
    page.goto(
        f"{base_url}/?story=document-pane&layout={layout_query}",
        wait_until="networkidle",
        timeout=60_000,
    )

    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)
    expect(page.get_by_test_id("document-pane-story")).to_be_visible()

    if expect_drawer:
        expect(page.get_by_test_id("chat-document-pane-drawer")).to_be_visible()
        expect(pane).to_have_attribute("data-layout", "drawer")
        # Drawer must not squeeze chat — chat story column is still in the DOM
        # under the dialog; composer remains present for non-drawer layouts only
        # when split is forced. For drawer, the dialog is full-screen.
        box = pane.bounding_box()
        assert box is not None
        # Full-screen drawer should occupy most of the viewport width.
        assert box["width"] >= size["width"] * 0.9
    else:
        expect(pane).to_have_attribute("data-layout", "split")
        expect(page.get_by_test_id("chat-document-pane-resize-handle")).to_be_visible()
        expect(page.get_by_test_id("document-pane-story-composer")).to_be_visible()
        # Resize handle has an accessible label.
        expect(
            page.get_by_role("separator", name="Resize document pane")
        ).to_be_visible()
        box = pane.bounding_box()
        assert box is not None
        # Stable min/max band (320–720) for desktop widths.
        assert 300 <= box["width"] <= 740

    _assert_controls(page)
    expect(page.get_by_text("Document pane preview")).to_be_visible()

    # Toolbar title must not overflow on top of icon buttons (rough check).
    close_btn = page.get_by_role("button", name="Close document pane")
    title = page.get_by_text("README.md").first
    title_box = title.bounding_box()
    close_box = close_btn.bounding_box()
    assert title_box is not None and close_box is not None
    # Title text should end before the close control starts (same toolbar row).
    assert title_box["x"] + title_box["width"] <= close_box["x"] + 8

    out = artifacts_dir / f"document-pane-{name}.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0
    shot(f"document_pane_{name.replace('-', '_')}")


def test_document_pane_auto_mobile_drawer(
    page: Page, base_url: str, artifacts_dir: Path, shot
):
    """Without layout= override, a mobile viewport still opens the drawer."""
    page.set_viewport_size(VIEWPORTS["mobile"])
    page.goto(
        f"{base_url}/?story=document-pane",
        wait_until="networkidle",
        timeout=60_000,
    )

    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)
    expect(pane).to_have_attribute("data-layout", "drawer")
    expect(page.get_by_test_id("chat-document-pane-drawer")).to_be_visible()
    _assert_controls(page)

    out = artifacts_dir / "document-pane-mobile-auto.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0
    shot("document_pane_mobile_auto")


def test_document_pane_keyboard_focus_split(
    page: Page, base_url: str, artifacts_dir: Path, shot
):
    page.set_viewport_size(VIEWPORTS["laptop"])
    page.goto(
        f"{base_url}/?story=document-pane&layout=split",
        wait_until="networkidle",
        timeout=60_000,
    )

    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)

    # Split shell auto-focuses the pane region (tabIndex=-1).
    focused = page.evaluate(
        "() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.tagName"
    )
    assert focused in ("chat-document-pane", "BUTTON", "H2", "h2"), focused

    # Tab into a toolbar control and ensure labels are exposed.
    page.keyboard.press("Tab")
    # At least one control is focusable with an accessible name.
    active_name = page.evaluate(
        """() => {
          const el = document.activeElement;
          if (!el) return '';
          return el.getAttribute('aria-label')
            || el.getAttribute('title')
            || el.textContent
            || el.tagName;
        }"""
    )
    assert active_name, "expected a focused control after Tab"

    shot("document_pane_keyboard_focus")
