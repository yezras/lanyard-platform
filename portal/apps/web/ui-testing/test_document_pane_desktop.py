"""lp-5q6.13: headless proof of desktop chat document pane layout.

Requires a live Vite dev server (auth-free story route).

  BFF_URL=http://127.0.0.1:4000 pnpm exec vite --port 3016 --host 127.0.0.1
  export BASE_URL=http://127.0.0.1:3016
  export UI_ARTIFACTS=../../../artifacts/ui/document-pane-desktop
  pytest -v test_document_pane_desktop.py
"""

from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Page, expect

from screenshot_utils import stable_page_screenshot


def test_document_pane_desktop_layout(
    page: Page, base_url: str, artifacts_dir: Path, shot
):
    page.set_viewport_size({"width": 1280, "height": 720})
    page.goto(
        f"{base_url}/?story=document-pane",
        wait_until="networkidle",
        timeout=60_000,
    )

    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)
    expect(page.get_by_test_id("document-pane-story")).to_be_visible()
    expect(page.get_by_test_id("document-pane-story-composer")).to_be_visible()

    # Toolbar controls
    expect(page.get_by_role("button", name="Close document pane")).to_be_visible()
    expect(page.get_by_role("button", name="Reload document")).to_be_visible()
    expect(page.get_by_role("button", name="Open in Vault")).to_be_visible()
    expect(page.get_by_role("button", name="Download document")).to_be_visible()

    # Preview body
    expect(page.get_by_text("Document pane preview")).to_be_visible()

    # lp-c76.1: full_page Page.screenshot can raise Protocol error
    # (Page.captureScreenshot) on this story even when all layout asserts pass.
    # Prefer viewport capture; fall back to clip-to-pane with retries.
    out = artifacts_dir / "document-pane-desktop.png"
    box = pane.bounding_box()
    clip = (
        {
            "x": max(0.0, box["x"]),
            "y": max(0.0, box["y"]),
            "width": max(1.0, box["width"]),
            "height": max(1.0, box["height"]),
        }
        if box is not None
        else None
    )
    # Viewport first (stable); clip-to-pane is the retry fallback.
    # Intentionally avoid full_page — known Protocol error path for this story.
    stable_page_screenshot(page, out, full_page=False, clip=clip)
    assert out.is_file() and out.stat().st_size > 0
    shot("document_pane_desktop_via_shot", full_page=False)
