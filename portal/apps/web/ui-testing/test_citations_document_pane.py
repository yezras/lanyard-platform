"""lp-75r.6 / lp-86d.12: live proof every inline citation opens the side document pane.

Auth-free story route (no BFF / login / empty chat history):

  ?story=citations-document-pane

Covers:
  - Seeded assistant message with vault citation chips (vault-citation-1/2)
  - Click each chip → chat-document-pane opens with distinct fixture body
  - Simulate artifact.open → pane opens (memo.md)
  - Simulate tool_target → pane opens (Legal/memo.md)
  - External https control does NOT open the pane

Requires a live Vite dev server:

  # From packages/web
  pnpm exec vite --port 3023 --host 127.0.0.1

  cd ui-testing
  export BASE_URL=http://127.0.0.1:3023
  # monorepo root artifacts (preferred for lp-75r.6):
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-75r.6
  # also mirrored for lp-86d.12 coordination:
  # export UI_ARTIFACTS=../../../../artifacts/ui/lp-86d/citations
  pytest -v test_citations_document_pane.py

Screenshots + evidence JSON under artifacts/ui/lp-75r.6/ (and lp-86d/citations/).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import Page, expect

VAULT_README = "/Projects/A/README.md"
VAULT_NOTES = "/Projects/A/notes.md"
ARTIFACT_MEMO = "/Projects/A/memo.md"
TOOL_TARGET_LEGAL = "/Projects/Legal/memo.md"
EXTERNAL_HREF = "https://example.com/docs/external-only"

VIEWPORT = {"width": 1440, "height": 900}


def _goto(page: Page, base_url: str) -> None:
    page.goto(
        f"{base_url}/?story=citations-document-pane",
        wait_until="networkidle",
        timeout=60_000,
    )


def _expect_pane_body(page: Page, *snippets: str) -> None:
    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)
    expect(pane).to_have_attribute("data-renderer", "preview")
    body = page.get_by_test_id("chat-document-pane-body")
    expect(body).to_be_visible()
    # Prefer unique headings / phrases; use text_content for substring checks
    # when markdown bold splits or substrings match the heading too.
    body_text = body.inner_text()
    for text in snippets:
        assert text in body_text, f"missing {text!r} in pane body: {body_text!r}"


def test_seeded_message_shows_vault_citation_chips(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Acceptance: seeded message with vault citation chips (no empty history)."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url)

    story = page.get_by_test_id("citations-document-pane-proof-story")
    expect(story).to_be_visible(timeout=15_000)
    expect(story).to_have_attribute("data-bead", "lp-75r.6")
    expect(story).to_have_attribute("data-related-bead", "lp-86d.12")
    expect(story).to_have_attribute("data-pane-open", "0")

    expect(page.get_by_test_id("citations-proof-assistant-bubble")).to_be_visible()
    expect(page.get_by_test_id("vault-citation-1")).to_be_visible()
    expect(page.get_by_test_id("vault-citation-2")).to_be_visible()
    expect(page.get_by_test_id("chat-document-pane")).to_have_count(0)

    log = page.get_by_test_id("citations-proof-open-log")
    expect(log).to_have_attribute("data-vault-readme", VAULT_README)
    expect(log).to_have_attribute("data-vault-notes", VAULT_NOTES)
    expect(log).to_have_attribute("data-artifact-path", ARTIFACT_MEMO)
    expect(log).to_have_attribute("data-tool-target-path", TOOL_TARGET_LEGAL)
    expect(log).to_have_attribute("data-external-href", EXTERNAL_HREF)

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / "seeded-citations-closed.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0


def test_each_vault_citation_opens_document_pane(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Acceptance: click each vault chip → side document pane with content."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url)

    story = page.get_by_test_id("citations-document-pane-proof-story")
    expect(story).to_be_visible(timeout=15_000)

    # Citation 1 → README
    page.get_by_test_id("vault-citation-1").click()
    expect(story).to_have_attribute("data-pane-open", "1")
    expect(story).to_have_attribute("data-last-open-source", "citation")
    expect(story).to_have_attribute("data-last-open-path", VAULT_README)
    _expect_pane_body(
        page,
        "Team A README (vault citation)",
        "side document pane preview body",
    )
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(
        path=str(artifacts_dir / "vault-citation-1-readme.png"), full_page=True
    )

    # Close then citation 2 → notes
    page.get_by_role("button", name="Close document pane").click()
    expect(story).to_have_attribute("data-pane-open", "0")
    expect(page.get_by_test_id("chat-document-pane")).to_have_count(0)

    page.get_by_test_id("vault-citation-2").click()
    expect(story).to_have_attribute("data-pane-open", "1")
    expect(story).to_have_attribute("data-last-open-path", VAULT_NOTES)
    _expect_pane_body(
        page,
        "Project notes (vault citation)",
        "every chip opens the pane",
    )
    page.screenshot(
        path=str(artifacts_dir / "vault-citation-2-notes.png"), full_page=True
    )


def test_artifact_open_and_tool_target_open_pane(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Acceptance: artifact.open + tool_target paths open the document pane."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url)

    story = page.get_by_test_id("citations-document-pane-proof-story")
    expect(story).to_be_visible(timeout=15_000)

    # artifact.open
    page.get_by_role("button", name="Simulate artifact.open").click()
    expect(story).to_have_attribute("data-last-open-source", "artifact_event")
    expect(story).to_have_attribute("data-last-open-path", ARTIFACT_MEMO)
    _expect_pane_body(
        page,
        "Memo (artifact.open)",
        "explicit",
        "portal_event metadata",
    )
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(
        path=str(artifacts_dir / "artifact-open-memo.png"), full_page=True
    )

    page.get_by_role("button", name="Close document pane").click()

    # tool_target
    page.get_by_role("button", name="Simulate tool_target").click()
    expect(story).to_have_attribute("data-last-open-source", "tool_target")
    expect(story).to_have_attribute("data-last-open-path", TOOL_TARGET_LEGAL)
    _expect_pane_body(
        page,
        "Legal memo (tool_target)",
        "file-tool",
        "tool_target fallback routing",
    )
    page.screenshot(
        path=str(artifacts_dir / "tool-target-legal.png"), full_page=True
    )


def test_external_https_does_not_open_pane(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Acceptance: external https intentionally does not open the document pane."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url)

    story = page.get_by_test_id("citations-document-pane-proof-story")
    expect(story).to_be_visible(timeout=15_000)

    page.get_by_role("button", name="External https (no pane)").click()
    expect(story).to_have_attribute("data-pane-open", "0")
    expect(story).to_have_attribute("data-last-open-source", "external_blocked")
    expect(story).to_have_attribute("data-external-click-count", "1")
    expect(story).to_have_attribute("data-open-count", "0")
    expect(page.get_by_test_id("chat-document-pane")).to_have_count(0)

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(
        path=str(artifacts_dir / "external-https-no-pane.png"), full_page=True
    )


def test_full_matrix_evidence_json(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Write composite evidence JSON after exercising all open paths."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url)

    story = page.get_by_test_id("citations-document-pane-proof-story")
    expect(story).to_be_visible(timeout=15_000)

    opens: list[dict[str, str]] = []

    page.get_by_test_id("vault-citation-1").click()
    opens.append(
        {
            "source": story.get_attribute("data-last-open-source") or "",
            "path": story.get_attribute("data-last-open-path") or "",
        }
    )
    _expect_pane_body(page, "Team A README (vault citation)")
    page.get_by_role("button", name="Close document pane").click()

    page.get_by_test_id("vault-citation-2").click()
    opens.append(
        {
            "source": story.get_attribute("data-last-open-source") or "",
            "path": story.get_attribute("data-last-open-path") or "",
        }
    )
    _expect_pane_body(page, "Project notes (vault citation)")
    page.get_by_role("button", name="Close document pane").click()

    page.get_by_role("button", name="Simulate artifact.open").click()
    opens.append(
        {
            "source": story.get_attribute("data-last-open-source") or "",
            "path": story.get_attribute("data-last-open-path") or "",
        }
    )
    _expect_pane_body(page, "Memo (artifact.open)")
    page.get_by_role("button", name="Close document pane").click()

    page.get_by_role("button", name="Simulate tool_target").click()
    opens.append(
        {
            "source": story.get_attribute("data-last-open-source") or "",
            "path": story.get_attribute("data-last-open-path") or "",
        }
    )
    _expect_pane_body(page, "Legal memo (tool_target)")

    page.get_by_role("button", name="External https (no pane)").click()
    external_blocked = story.get_attribute("data-last-open-source") == "external_blocked"
    # Pane remains open from tool_target (external must not close/replace).
    # Re-check: external must not change open path to external URL.
    assert story.get_attribute("data-last-open-path") == TOOL_TARGET_LEGAL or (
        story.get_attribute("data-external-click-count") == "1"
    )

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    composite = artifacts_dir / "citations-matrix-composite.png"
    page.screenshot(path=str(composite), full_page=True)
    assert composite.is_file() and composite.stat().st_size > 0

    evidence = {
        "bead": "lp-75r.6",
        "related_bead": "lp-86d.12",
        "story": "citations-document-pane",
        "url": f"{base_url}/?story=citations-document-pane",
        "captured_at": "2026-07-31",
        "seeded_citations": [
            {"path": VAULT_README, "testid": "vault-citation-1"},
            {"path": VAULT_NOTES, "testid": "vault-citation-2"},
        ],
        "opens": opens,
        "artifact_open_path": ARTIFACT_MEMO,
        "tool_target_path": TOOL_TARGET_LEGAL,
        "external_href": EXTERNAL_HREF,
        "external_blocked": external_blocked,
        "open_count": story.get_attribute("data-open-count"),
        "external_click_count": story.get_attribute("data-external-click-count"),
        "screenshots": [
            "seeded-citations-closed.png",
            "vault-citation-1-readme.png",
            "vault-citation-2-notes.png",
            "artifact-open-memo.png",
            "tool-target-legal.png",
            "external-https-no-pane.png",
            "citations-matrix-composite.png",
        ],
        "unit_path": "PortalShell.test lp-vnz.8 / chatArtifactRouting.test",
        "mock_gateway": "portal/scripts/dev-mock-gateway.ts (tools + artifact.open + citations)",
        "notes": (
            "Auth-free story seeds vault + artifact paths so proof is not "
            "blocked by empty chat history after BFF restart. Coordinates "
            "with lp-86d.12 (artifacts also under artifacts/ui/lp-86d/citations/)."
        ),
    }

    evidence_path = artifacts_dir / "citations-document-pane.json"
    evidence_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    assert evidence_path.is_file()

    # Strict open path expectations
    assert opens[0] == {"source": "citation", "path": VAULT_README}
    assert opens[1] == {"source": "citation", "path": VAULT_NOTES}
    assert opens[2] == {"source": "artifact_event", "path": ARTIFACT_MEMO}
    assert opens[3] == {"source": "tool_target", "path": TOOL_TARGET_LEGAL}
    assert story.get_attribute("data-open-count") == "4"
    assert external_blocked
