"""lp-86d.11: live proof file references soft-open the side document pane (mode A).

Auth-free story route (no BFF / login / empty chat history):

  ?story=file-ref-soft-open

Covers:
  - Seeded user message with vault office path (path_reference)
  - Simulate user soft mode A → chat-document-pane opens with fixture body
  - Simulate assistant free-text path → pane opens with body
  - Path pill (reopen chip) after close → reopens pane with body

Requires a live Vite dev server:

  # From packages/web
  pnpm exec vite --port 3024 --host 127.0.0.1

  cd ui-testing
  export BASE_URL=http://127.0.0.1:3024
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-86d/file-ref
  pytest -v test_file_ref_soft_open_document_pane.py

Screenshots + evidence JSON under artifacts/ui/lp-86d/file-ref/.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import Page, expect

OFFICE_PATH = "/Business/Contracts/MSA.docx"
USER_MSG_SNIPPET = "What does /Business/Contracts/MSA.docx"
ASSISTANT_MSG_SNIPPET = "I reviewed /Business/Contracts/MSA.docx"

VIEWPORT = {"width": 1440, "height": 900}


def _goto(page: Page, base_url: str) -> None:
    page.goto(
        f"{base_url}/?story=file-ref-soft-open",
        wait_until="networkidle",
        timeout=60_000,
    )


def _expect_pane_body(page: Page, *snippets: str) -> None:
    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)
    expect(pane).to_have_attribute("data-renderer", "preview")
    body = page.get_by_test_id("chat-document-pane-body")
    expect(body).to_be_visible()
    body_text = body.inner_text()
    for text in snippets:
        assert text in body_text, f"missing {text!r} in pane body: {body_text!r}"


def test_seeded_path_references_pane_closed(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Acceptance: seeded user/assistant path refs; pane closed until soft-open."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url)

    story = page.get_by_test_id("file-ref-soft-open-proof-story")
    expect(story).to_be_visible(timeout=15_000)
    expect(story).to_have_attribute("data-bead", "lp-86d.11")
    expect(story).to_have_attribute("data-pane-open", "0")
    expect(story).to_have_attribute("data-office-path", OFFICE_PATH)

    expect(page.get_by_test_id("file-ref-proof-user-bubble")).to_be_visible()
    expect(page.get_by_test_id("file-ref-proof-assistant-bubble")).to_be_visible()
    expect(page.get_by_text(USER_MSG_SNIPPET)).to_be_visible()
    expect(page.get_by_text(ASSISTANT_MSG_SNIPPET)).to_be_visible()
    expect(page.get_by_test_id("chat-document-pane")).to_have_count(0)

    log = page.get_by_test_id("file-ref-proof-open-log")
    expect(log).to_have_attribute("data-office-path", OFFICE_PATH)

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / "seeded-file-ref-closed.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0


def test_user_soft_mode_a_opens_document_pane_with_body(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Acceptance: user path_reference soft-opens pane with non-empty body."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url)

    story = page.get_by_test_id("file-ref-soft-open-proof-story")
    expect(story).to_be_visible(timeout=15_000)

    page.get_by_role("button", name="Simulate user soft mode A").click()

    expect(story).to_have_attribute("data-pane-open", "1")
    expect(story).to_have_attribute("data-last-open-source", "user_path_reference")
    expect(story).to_have_attribute("data-last-open-path", OFFICE_PATH)
    expect(story).to_have_attribute("data-last-intent-kind", "path_reference")

    _expect_pane_body(
        page,
        "MSA.docx — file-ref soft-open preview",
        "User path_reference soft-opens the pane",
        "Soft open loads content",
    )

    # Soft-open mints a path pill (reopen chip).
    expect(page.get_by_test_id("document-reopen-chip-1")).to_be_visible()

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(
        path=str(artifacts_dir / "user-soft-mode-a-pane-body.png"), full_page=True
    )


def test_assistant_free_text_path_soft_opens_pane(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Acceptance: assistant free-text office path soft-opens pane with body."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url)

    story = page.get_by_test_id("file-ref-soft-open-proof-story")
    expect(story).to_be_visible(timeout=15_000)

    page.get_by_role("button", name="Simulate assistant free-text path").click()

    expect(story).to_have_attribute("data-pane-open", "1")
    expect(story).to_have_attribute("data-last-open-source", "assistant_free_text")
    expect(story).to_have_attribute("data-last-open-path", OFFICE_PATH)

    _expect_pane_body(
        page,
        "MSA.docx — file-ref soft-open preview",
        "Assistant free-text office path soft-opens the pane",
    )

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(
        path=str(artifacts_dir / "assistant-free-text-soft-open.png"),
        full_page=True,
    )


def test_path_pill_click_reopens_pane_with_body(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Acceptance: path pill (reopen chip) click reopens pane with body after close."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url)

    story = page.get_by_test_id("file-ref-soft-open-proof-story")
    expect(story).to_be_visible(timeout=15_000)

    page.get_by_role("button", name="Simulate user soft mode A").click()
    expect(story).to_have_attribute("data-pane-open", "1")
    expect(page.get_by_test_id("document-reopen-chip-1")).to_be_visible()

    page.get_by_role("button", name="Close document pane").click()
    expect(story).to_have_attribute("data-pane-open", "0")
    expect(page.get_by_test_id("chat-document-pane")).to_have_count(0)
    # Pill survives close (the gap reported in bead notes).
    expect(page.get_by_test_id("document-reopen-chip-1")).to_be_visible()

    page.get_by_test_id("document-reopen-chip-1").click()
    expect(story).to_have_attribute("data-pane-open", "1")
    expect(story).to_have_attribute("data-last-open-source", "path_pill")
    expect(story).to_have_attribute("data-last-open-path", OFFICE_PATH)
    expect(story).to_have_attribute("data-open-count", "2")

    _expect_pane_body(
        page,
        "MSA.docx — file-ref soft-open preview",
        "Path pill (reopen chip) click reloads body",
    )

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(
        path=str(artifacts_dir / "path-pill-reopen-body.png"), full_page=True
    )


def test_write_evidence_json(page: Page, base_url: str, artifacts_dir: Path):
    """Write machine-readable acceptance evidence for the bead closeout."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url)

    story = page.get_by_test_id("file-ref-soft-open-proof-story")
    expect(story).to_be_visible(timeout=15_000)

    # Drive full happy path once for composite evidence.
    page.get_by_role("button", name="Simulate user soft mode A").click()
    expect(story).to_have_attribute("data-pane-open", "1")
    _expect_pane_body(page, "Soft open loads content")
    page.get_by_role("button", name="Close document pane").click()
    page.get_by_test_id("document-reopen-chip-1").click()
    expect(story).to_have_attribute("data-last-open-source", "path_pill")
    _expect_pane_body(page, "file-ref soft-open preview")

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    composite = artifacts_dir / "file-ref-soft-open-composite.png"
    page.screenshot(path=str(composite), full_page=True)

    evidence = {
        "bead": "lp-86d.11",
        "title": "qa: file references soft-open document pane",
        "story": "?story=file-ref-soft-open",
        "mode": "soft mode A (lp-dpr.2)",
        "office_path": OFFICE_PATH,
        "acceptance": {
            "user_path_reference_soft_opens_pane_with_body": True,
            "assistant_free_text_soft_opens_pane_with_body": True,
            "path_pill_click_reopens_pane_with_body": True,
            "pane_not_chrome_only": True,
        },
        "screenshots": [
            "seeded-file-ref-closed.png",
            "user-soft-mode-a-pane-body.png",
            "assistant-free-text-soft-open.png",
            "path-pill-reopen-body.png",
            "file-ref-soft-open-composite.png",
        ],
        "base_url": base_url,
        "playwright": "portal/packages/web/ui-testing/test_file_ref_soft_open_document_pane.py",
    }
    out = artifacts_dir / "file-ref-soft-open.json"
    out.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    assert out.is_file()
    assert composite.is_file() and composite.stat().st_size > 0
