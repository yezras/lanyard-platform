"""lp-5q6.27: headless proof of nonblank ONLYOFFICE editor host mount.

Auth-free story route with mocked DocsAPI (no live Document Server required):

  ?story=document-pane&mode=onlyoffice

Requires a live Vite dev server:

  pnpm exec vite --port 3018 --host 127.0.0.1
  export BASE_URL=http://127.0.0.1:3018
  export UI_ARTIFACTS=../../../artifacts/ui/lp-5q6.27-onlyoffice-editor-host
  pytest -v test_onlyoffice_editor_host.py
"""

from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Page, expect


def test_onlyoffice_editor_host_nonblank_mount(
    page: Page, base_url: str, artifacts_dir: Path, shot
):
    page.set_viewport_size({"width": 1280, "height": 720})
    page.goto(
        f"{base_url}/?story=document-pane&mode=onlyoffice",
        wait_until="networkidle",
        timeout=60_000,
    )

    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)
    expect(page.get_by_test_id("document-pane-story")).to_have_attribute(
        "data-story-mode", "onlyoffice"
    )

    host = page.get_by_test_id("onlyoffice-editor-host")
    expect(host).to_be_visible(timeout=15_000)

    surface = page.get_by_test_id("onlyoffice-editor-mock-surface")
    expect(surface).to_be_visible(timeout=15_000)
    expect(surface).to_contain_text("ONLYOFFICE editor")
    expect(surface).to_contain_text("nonblank mount")

    # Ensure preview markdown body is not used for this story mode.
    expect(page.get_by_text("Document pane preview")).to_have_count(0)

    out = artifacts_dir / "onlyoffice-editor-host-nonblank.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0
    # Non-trivial screenshot (not a blank white frame).
    assert out.stat().st_size > 5_000
    shot("onlyoffice_editor_host_nonblank")
