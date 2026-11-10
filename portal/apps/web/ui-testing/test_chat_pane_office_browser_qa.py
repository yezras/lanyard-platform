"""lp-5q6.37: browser verification for chat document pane and ONLYOFFICE editor.

Auth-free story route (no BFF / login required):

  ?story=document-pane
  ?story=document-pane&open=citation&layout=split|drawer
  ?story=document-pane&mode=onlyoffice
  ?story=document-pane&mode=flag_off
  ?story=document-pane&mode=ds_unavailable

Requires a live Vite dev server:

  pnpm exec vite --port 3019 --host 127.0.0.1
  export BASE_URL=http://127.0.0.1:3019
  export UI_ARTIFACTS=../../../artifacts/ui/lp-5q6.37-chat-pane-office-browser-qa
  pytest -v test_chat_pane_office_browser_qa.py
"""

from __future__ import annotations

from pathlib import Path

import pytest
from playwright.sync_api import Page, expect

VIEWPORTS = {
    "desktop": {"width": 1440, "height": 900},
    "mobile": {"width": 390, "height": 844},
}


def _assert_no_title_control_overlap(page: Page) -> None:
    close_btn = page.get_by_role("button", name="Close document pane")
    # Title is the basename shown in the toolbar.
    title = page.locator("[data-testid='chat-document-pane']").get_by_text(
        "README.md"
    ).or_(
        page.locator("[data-testid='chat-document-pane']").get_by_text(
            "Proposal.docx"
        )
    ).first
    title_box = title.bounding_box()
    close_box = close_btn.bounding_box()
    assert title_box is not None and close_box is not None
    assert title_box["x"] + title_box["width"] <= close_box["x"] + 8


def _assert_stable_controls(page: Page) -> None:
    expect(page.get_by_role("button", name="Close document pane")).to_be_visible()
    expect(page.get_by_role("button", name="Reload document")).to_be_visible()
    expect(page.get_by_role("button", name="Open in Vault")).to_be_visible()
    expect(page.get_by_role("button", name="Download document")).to_be_visible()


def _assert_readable_chat_and_composer(page: Page, *, drawer: bool) -> None:
    chat = page.get_by_test_id("document-pane-story-chat-column")
    composer = page.get_by_test_id("document-pane-story-composer")
    expect(chat).to_be_visible()
    expect(composer).to_be_visible()
    chat_box = chat.bounding_box()
    composer_box = composer.bounding_box()
    assert chat_box is not None and composer_box is not None
    # Composer is inside the chat column and has usable height.
    assert composer_box["height"] >= 24
    assert composer_box["width"] >= 120
    if not drawer:
        # Split: chat column still has non-trivial width (not crushed by pane).
        assert chat_box["width"] >= 280


@pytest.mark.parametrize(
    "name,size,layout,expect_drawer",
    [
        ("desktop", VIEWPORTS["desktop"], "split", False),
        ("mobile", VIEWPORTS["mobile"], "drawer", True),
    ],
)
def test_open_chat_pane_from_citation(
    page: Page,
    base_url: str,
    artifacts_dir: Path,
    shot,
    name: str,
    size: dict[str, int],
    layout: str,
    expect_drawer: bool,
):
    """Acceptance: open chat pane from citation on desktop and mobile."""
    page.set_viewport_size(size)
    page.goto(
        f"{base_url}/?story=document-pane&open=citation&layout={layout}",
        wait_until="networkidle",
        timeout=60_000,
    )

    story = page.get_by_test_id("document-pane-story")
    expect(story).to_be_visible(timeout=15_000)
    expect(story).to_have_attribute("data-open-from-citation", "1")
    expect(story).to_have_attribute("data-pane-open", "0")

    # Pane closed until citation is activated.
    expect(page.get_by_test_id("chat-document-pane")).to_have_count(0)

    citation = page.get_by_test_id("vault-citation-1")
    expect(citation).to_be_visible()
    citation.click()

    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)
    expect(story).to_have_attribute("data-pane-open", "1")
    expect(pane).to_have_attribute("data-renderer", "preview")

    if expect_drawer:
        expect(page.get_by_test_id("chat-document-pane-drawer")).to_be_visible()
        expect(pane).to_have_attribute("data-layout", "drawer")
    else:
        expect(pane).to_have_attribute("data-layout", "split")
        expect(page.get_by_test_id("chat-document-pane-resize-handle")).to_be_visible()

    _assert_stable_controls(page)
    _assert_readable_chat_and_composer(page, drawer=expect_drawer)
    expect(page.get_by_text("Document pane preview")).to_be_visible()
    _assert_no_title_control_overlap(page)

    out = artifacts_dir / f"citation-open-{name}.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 5_000
    shot(f"citation_open_{name}")


def test_layout_no_overlap_desktop_composer_and_pane(
    page: Page, base_url: str, artifacts_dir: Path, shot
):
    """Acceptance: screenshots prove no overlap, readable chat, usable composer."""
    page.set_viewport_size(VIEWPORTS["desktop"])
    page.goto(
        f"{base_url}/?story=document-pane&layout=split",
        wait_until="networkidle",
        timeout=60_000,
    )

    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)
    composer = page.get_by_test_id("document-pane-story-composer")
    chat = page.get_by_test_id("document-pane-story-chat-column")
    expect(composer).to_be_visible()
    expect(chat).to_be_visible()

    pane_box = pane.bounding_box()
    chat_box = chat.bounding_box()
    composer_box = composer.bounding_box()
    assert pane_box and chat_box and composer_box

    # Pane sits to the right of the chat column (split).
    assert pane_box["x"] >= chat_box["x"] + chat_box["width"] - 2
    # Composer remains in the chat column (not under the pane).
    assert composer_box["x"] + composer_box["width"] <= pane_box["x"] + 4
    # Stable pane width band.
    assert 300 <= pane_box["width"] <= 740

    _assert_stable_controls(page)
    _assert_no_title_control_overlap(page)

    out = artifacts_dir / "layout-no-overlap-desktop.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 5_000
    shot("layout_no_overlap_desktop")


def test_onlyoffice_lab_editor_nonblank(
    page: Page, base_url: str, artifacts_dir: Path, shot
):
    """Acceptance: canvas/iframe area is nonblank for ONLYOFFICE lab editor."""
    page.set_viewport_size(VIEWPORTS["desktop"])
    page.goto(
        f"{base_url}/?story=document-pane&mode=onlyoffice&layout=split",
        wait_until="networkidle",
        timeout=60_000,
    )

    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)
    expect(page.get_by_test_id("document-pane-story")).to_have_attribute(
        "data-story-mode", "onlyoffice"
    )
    expect(pane).to_have_attribute("data-renderer", "onlyoffice")

    host = page.get_by_test_id("onlyoffice-editor-host")
    expect(host).to_be_visible(timeout=15_000)

    surface = page.get_by_test_id("onlyoffice-editor-mock-surface")
    expect(surface).to_be_visible(timeout=15_000)
    expect(surface).to_contain_text("ONLYOFFICE editor")
    expect(surface).to_contain_text("nonblank mount")

    surface_box = surface.bounding_box()
    assert surface_box is not None
    assert surface_box["height"] >= 200
    assert surface_box["width"] >= 200

    # Preview markdown body is not used for this story mode.
    expect(page.get_by_text("Document pane preview")).to_have_count(0)

    out = artifacts_dir / "onlyoffice-lab-editor-nonblank.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 5_000
    shot("onlyoffice_lab_editor_nonblank")


def test_preview_fallback_feature_flag_off(
    page: Page, base_url: str, artifacts_dir: Path, shot
):
    """Acceptance: preview fallback when feature flag is off."""
    page.set_viewport_size(VIEWPORTS["desktop"])
    page.goto(
        f"{base_url}/?story=document-pane&mode=flag_off&layout=split",
        wait_until="networkidle",
        timeout=60_000,
    )

    story = page.get_by_test_id("document-pane-story")
    expect(story).to_be_visible(timeout=15_000)
    expect(story).to_have_attribute("data-story-mode", "flag_off")
    expect(story).to_have_attribute("data-preview-fallback", "1")

    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)
    expect(pane).to_have_attribute("data-renderer", "preview")

    # No ONLYOFFICE host when flag is off.
    expect(page.get_by_test_id("onlyoffice-editor-host")).to_have_count(0)
    expect(
        page.get_by_role("heading", name="Proposal.docx — preview fallback")
    ).to_be_visible()
    expect(page.get_by_text("ONLYOFFICE feature flag is")).to_be_visible()

    _assert_stable_controls(page)

    out = artifacts_dir / "preview-fallback-flag-off.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 5_000
    shot("preview_fallback_flag_off")


def test_preview_fallback_document_server_unavailable(
    page: Page, base_url: str, artifacts_dir: Path, shot
):
    """Acceptance: preview fallback when Document Server is unavailable."""
    page.set_viewport_size(VIEWPORTS["desktop"])
    page.goto(
        f"{base_url}/?story=document-pane&mode=ds_unavailable&layout=split",
        wait_until="networkidle",
        timeout=60_000,
    )

    story = page.get_by_test_id("document-pane-story")
    expect(story).to_be_visible(timeout=15_000)
    expect(story).to_have_attribute("data-story-mode", "ds_unavailable")

    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)
    # Office slot active → renderer onlyoffice, but host shows load error.
    expect(pane).to_have_attribute("data-renderer", "onlyoffice")

    error = page.get_by_test_id("onlyoffice-editor-error")
    expect(error).to_be_visible(timeout=15_000)
    expect(error).to_have_attribute("data-error-code", "load_failure")
    expect(page.get_by_text("Editor failed to load")).to_be_visible()

    # User returns to preview fallback.
    page.get_by_role("button", name="Back to preview").first.click()
    expect(story).to_have_attribute("data-preview-fallback", "1")
    expect(pane).to_have_attribute("data-renderer", "preview")
    expect(page.get_by_test_id("onlyoffice-editor-host")).to_have_count(0)
    expect(page.get_by_text("preview after Document Server unavailable")).to_be_visible()

    out = artifacts_dir / "preview-fallback-ds-unavailable.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 5_000
    shot("preview_fallback_ds_unavailable")


def test_accessibility_focus_close_reload_open_in_vault(
    page: Page, base_url: str, artifacts_dir: Path, shot
):
    """Acceptance: a11y checks cover focus, close, reload, open-in-vault."""
    page.set_viewport_size(VIEWPORTS["desktop"])
    page.goto(
        f"{base_url}/?story=document-pane&open=citation&layout=split",
        wait_until="networkidle",
        timeout=60_000,
    )

    story = page.get_by_test_id("document-pane-story")
    expect(story).to_be_visible(timeout=15_000)

    citation = page.get_by_test_id("vault-citation-1")
    expect(citation).to_be_visible()
    citation.focus()
    focused_before = page.evaluate(
        "() => document.activeElement?.getAttribute('data-testid') || ''"
    )
    assert focused_before == "vault-citation-1"

    citation.click()
    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)

    # Focus moves into the pane region on open (split shell).
    page.wait_for_timeout(100)
    focused = page.evaluate(
        """() => {
          const el = document.activeElement;
          if (!el) return '';
          return el.getAttribute('data-testid')
            || el.getAttribute('aria-label')
            || el.tagName;
        }"""
    )
    assert focused in (
        "chat-document-pane",
        "Document pane",
        "BUTTON",
        "button",
    ) or "document" in focused.lower() or focused in ("H2", "h2"), focused

    # Controls are labeled and fire story action counters.
    reload_btn = page.get_by_role("button", name="Reload document")
    expect(reload_btn).to_be_visible()
    reload_btn.click()
    expect(story).to_have_attribute("data-action-reload", "1")

    open_vault = page.get_by_role("button", name="Open in Vault")
    expect(open_vault).to_be_visible()
    open_vault.click()
    expect(story).to_have_attribute("data-action-open-in-vault", "1")

    close_btn = page.get_by_role("button", name="Close document pane")
    expect(close_btn).to_be_visible()
    close_btn.click()
    expect(story).to_have_attribute("data-action-close", "1")
    expect(page.get_by_test_id("chat-document-pane")).to_have_count(0)
    expect(story).to_have_attribute("data-pane-open", "0")

    out = artifacts_dir / "a11y-focus-close-reload-open-in-vault.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0
    shot("a11y_focus_close_reload_open_in_vault")
