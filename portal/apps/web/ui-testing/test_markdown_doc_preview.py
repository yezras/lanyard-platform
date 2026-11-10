"""lp-86d.9: markdown/doc preview pane body (not chrome-only).

Auth-free stories (no BFF / login / live gateway required):

  ?story=citations-document-pane
  ?story=document-pane
  ?story=document-pane&open=citation

Acceptance:
  - Open a vault markdown/doc via citation (or soft citation-open).
  - chat-document-pane shows non-empty body content (not chrome-only).
  - data-renderer stays "preview" for markdown (VaultReader path).
  - Empty "Select a file" chrome-only body is rejected.

Requires a live Vite dev server:

  # From packages/web
  pnpm exec vite --port 3024 --host 127.0.0.1

  cd ui-testing
  export BASE_URL=http://127.0.0.1:3024
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-86d/doc-preview
  pytest -v test_markdown_doc_preview.py

Artifacts under monorepo artifacts/ui/lp-86d/doc-preview/.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from playwright.sync_api import Page, expect

VAULT_README = "/Projects/A/README.md"
VAULT_NOTES = "/Projects/A/notes.md"
ARTIFACT_MEMO = "/Projects/A/memo.md"

VIEWPORT = {"width": 1440, "height": 900}

# Chrome-only empty body indicator (VaultReader EmptyState).
EMPTY_CHROME = "Select a file"

# Distinct fixture body snippets that prove markdown rendered into the pane body.
README_SNIPPETS = (
    "Team A README (vault citation)",
    "side document pane preview body",
)
NOTES_SNIPPETS = (
    "Project notes (vault citation)",
    "every chip opens the pane",
)
MEMO_SNIPPETS = (
    "Memo (artifact.open)",
    "portal_event metadata",
)
DOCUMENT_PANE_SNIPPETS = (
    "Document pane preview",
    "chat document pane",
)


def _goto(page: Page, base_url: str, query: str) -> None:
    qs = query if query.startswith("?") else f"?{query}"
    page.goto(
        f"{base_url}/{qs}",
        wait_until="networkidle",
        timeout=60_000,
    )


def _assert_markdown_preview_body(page: Page, *snippets: str) -> dict[str, object]:
    """Assert document pane is open with non-empty markdown preview body."""
    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=15_000)
    expect(pane).to_have_attribute("data-renderer", "preview")

    body = page.get_by_test_id("chat-document-pane-body")
    expect(body).to_be_visible()
    expect(body).to_have_attribute("data-renderer", "preview")

    body_text = (body.inner_text() or "").strip()
    assert body_text, "document pane body is empty (chrome-only failure)"
    assert len(body_text) >= 24, f"body too short for markdown preview: {body_text!r}"
    assert EMPTY_CHROME not in body_text or any(
        s in body_text for s in snippets
    ), f"chrome-only empty state in body: {body_text!r}"

    for text in snippets:
        assert text in body_text, f"missing {text!r} in pane body: {body_text!r}"

    # Body must not be only toolbar chrome — require multi-line / multi-word content.
    words = re.findall(r"\w+", body_text)
    assert len(words) >= 6, f"body looks chrome-only (few words): {body_text!r}"

    return {
        "body_len": len(body_text),
        "word_count": len(words),
        "renderer": "preview",
        "snippets_ok": list(snippets),
    }


def test_citation_opens_markdown_readme_body(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Acceptance: vault citation chip → markdown body (not chrome-only)."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url, "story=citations-document-pane")

    story = page.get_by_test_id("citations-document-pane-proof-story")
    expect(story).to_be_visible(timeout=15_000)
    expect(page.get_by_test_id("chat-document-pane")).to_have_count(0)

    page.get_by_test_id("vault-citation-1").click()
    expect(story).to_have_attribute("data-pane-open", "1")
    expect(story).to_have_attribute("data-last-open-path", VAULT_README)
    expect(story).to_have_attribute("data-last-open-source", "citation")

    metrics = _assert_markdown_preview_body(page, *README_SNIPPETS)

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    shot = artifacts_dir / "citation-readme-body.png"
    page.screenshot(path=str(shot), full_page=True)
    assert shot.is_file() and shot.stat().st_size > 0

    # Persist per-step metrics for RESULT.json merge later.
    (artifacts_dir / "citation-readme-body.partial.json").write_text(
        json.dumps({"path": VAULT_README, "source": "citation", **metrics}, indent=2)
        + "\n",
        encoding="utf-8",
    )


def test_citation_opens_markdown_notes_body(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Second vault citation also yields a distinct non-empty markdown body."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url, "story=citations-document-pane")

    story = page.get_by_test_id("citations-document-pane-proof-story")
    expect(story).to_be_visible(timeout=15_000)

    page.get_by_test_id("vault-citation-2").click()
    expect(story).to_have_attribute("data-last-open-path", VAULT_NOTES)

    metrics = _assert_markdown_preview_body(page, *NOTES_SNIPPETS)

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    shot = artifacts_dir / "citation-notes-body.png"
    page.screenshot(path=str(shot), full_page=True)
    assert shot.is_file() and shot.stat().st_size > 0

    (artifacts_dir / "citation-notes-body.partial.json").write_text(
        json.dumps({"path": VAULT_NOTES, "source": "citation", **metrics}, indent=2)
        + "\n",
        encoding="utf-8",
    )


def test_artifact_open_markdown_memo_body(
    page: Page, base_url: str, artifacts_dir: Path
):
    """artifact.open markdown path also mounts non-empty preview body."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url, "story=citations-document-pane")

    story = page.get_by_test_id("citations-document-pane-proof-story")
    expect(story).to_be_visible(timeout=15_000)

    page.get_by_role("button", name="Simulate artifact.open").click()
    expect(story).to_have_attribute("data-last-open-path", ARTIFACT_MEMO)
    expect(story).to_have_attribute("data-last-open-source", "artifact_event")

    metrics = _assert_markdown_preview_body(page, *MEMO_SNIPPETS)

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    shot = artifacts_dir / "artifact-open-memo-body.png"
    page.screenshot(path=str(shot), full_page=True)
    assert shot.is_file() and shot.stat().st_size > 0

    (artifacts_dir / "artifact-open-memo-body.partial.json").write_text(
        json.dumps(
            {"path": ARTIFACT_MEMO, "source": "artifact_event", **metrics}, indent=2
        )
        + "\n",
        encoding="utf-8",
    )


def test_document_pane_story_markdown_body_open(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Default document-pane story opens markdown with non-empty body."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url, "story=document-pane&layout=split")

    story = page.get_by_test_id("document-pane-story")
    expect(story).to_be_visible(timeout=15_000)
    expect(story).to_have_attribute("data-pane-open", "1")

    metrics = _assert_markdown_preview_body(page, *DOCUMENT_PANE_SNIPPETS)

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    shot = artifacts_dir / "document-pane-default-body.png"
    page.screenshot(path=str(shot), full_page=True)
    assert shot.is_file() and shot.stat().st_size > 0

    (artifacts_dir / "document-pane-default-body.partial.json").write_text(
        json.dumps(
            {
                "path": VAULT_README,
                "source": "deep_link",
                "story": "document-pane",
                **metrics,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def test_document_pane_soft_citation_open_markdown_body(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Soft citation open (open=citation): start closed, click chip → body."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url, "story=document-pane&open=citation&layout=split")

    story = page.get_by_test_id("document-pane-story")
    expect(story).to_be_visible(timeout=15_000)
    expect(story).to_have_attribute("data-open-from-citation", "1")
    expect(story).to_have_attribute("data-pane-open", "0")
    expect(page.get_by_test_id("chat-document-pane")).to_have_count(0)

    page.get_by_test_id("vault-citation-1").click()
    expect(story).to_have_attribute("data-pane-open", "1")

    metrics = _assert_markdown_preview_body(page, *DOCUMENT_PANE_SNIPPETS)

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    shot = artifacts_dir / "soft-citation-open-body.png"
    page.screenshot(path=str(shot), full_page=True)
    assert shot.is_file() and shot.stat().st_size > 0

    (artifacts_dir / "soft-citation-open-body.partial.json").write_text(
        json.dumps(
            {
                "path": VAULT_README,
                "source": "citation",
                "story": "document-pane&open=citation",
                **metrics,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def test_markdown_doc_preview_evidence_json(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Composite evidence JSON + matrix screenshot for lp-86d.9 close-out."""
    page.set_viewport_size(VIEWPORT)
    _goto(page, base_url, "story=citations-document-pane")

    story = page.get_by_test_id("citations-document-pane-proof-story")
    expect(story).to_be_visible(timeout=15_000)

    opens: list[dict[str, object]] = []

    page.get_by_test_id("vault-citation-1").click()
    opens.append(
        {
            "source": "citation",
            "path": VAULT_README,
            **_assert_markdown_preview_body(page, *README_SNIPPETS),
        }
    )
    page.get_by_role("button", name="Close document pane").click()

    page.get_by_test_id("vault-citation-2").click()
    opens.append(
        {
            "source": "citation",
            "path": VAULT_NOTES,
            **_assert_markdown_preview_body(page, *NOTES_SNIPPETS),
        }
    )
    page.get_by_role("button", name="Close document pane").click()

    page.get_by_role("button", name="Simulate artifact.open").click()
    opens.append(
        {
            "source": "artifact_event",
            "path": ARTIFACT_MEMO,
            **_assert_markdown_preview_body(page, *MEMO_SNIPPETS),
        }
    )

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    composite = artifacts_dir / "doc-preview-matrix.png"
    page.screenshot(path=str(composite), full_page=True)
    assert composite.is_file() and composite.stat().st_size > 0

    screenshots = [
        "citation-readme-body.png",
        "citation-notes-body.png",
        "artifact-open-memo-body.png",
        "document-pane-default-body.png",
        "soft-citation-open-body.png",
        "doc-preview-matrix.png",
    ]

    evidence = {
        "bead": "lp-86d.9",
        "related_beads": ["lp-86d.12", "lp-75r.6", "lp-dpr.1"],
        "title": "document viewer — markdown/doc preview pane body",
        "status": "PASS",
        "stories": [
            "citations-document-pane",
            "document-pane",
            "document-pane&open=citation",
        ],
        "url_base": base_url,
        "acceptance": {
            "open_via_citation_or_soft_ref": True,
            "chat_document_pane_non_empty_body": True,
            "not_chrome_only": True,
            "renderer": "preview",
        },
        "opens": opens,
        "screenshots": screenshots,
        "empty_chrome_rejected": EMPTY_CHROME,
        "unit_coverage": [
            "useDocumentPanePreview.test.tsx (lp-dpr.1 chrome-without-body)",
            "CitationsDocumentPaneProofStory.test.tsx",
            "DocumentPaneShell.test.tsx (VaultReader markdown body)",
        ],
        "notes": (
            "Auth-free stories prove markdown/doc preview body is non-empty "
            "when opened via citation chip, soft open=citation, default deep "
            "link, or artifact.open. Live LA agent citation metadata is covered "
            "by lp-86d.12 / lp-75r.6; this bead focuses on pane body content "
            "(not chrome-only toolbar). Artifacts: artifacts/ui/lp-86d/doc-preview/."
        ),
    }

    evidence_path = artifacts_dir / "doc-preview.json"
    evidence_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    assert evidence_path.is_file()

    result_md = artifacts_dir / "RESULT.md"
    result_md.write_text(
        "\n".join(
            [
                "# lp-86d.9 — markdown/doc preview pane body",
                "",
                f"**Status:** {evidence['status']}",
                "",
                "## Acceptance",
                "",
                "- [x] Open vault markdown/doc via citation or soft file reference",
                "- [x] `chat-document-pane` shows non-empty body (not chrome-only)",
                "- [x] `data-renderer=preview` for markdown (VaultReader path)",
                "- [x] Reject empty `Select a file` chrome-only body",
                "",
                "## Paths proven",
                "",
                f"- citation → `{VAULT_README}` (README body)",
                f"- citation → `{VAULT_NOTES}` (notes body)",
                f"- artifact.open → `{ARTIFACT_MEMO}` (memo body)",
                f"- document-pane default deep-link → `{VAULT_README}`",
                f"- document-pane soft `open=citation` → `{VAULT_README}`",
                "",
                "## Screenshots",
                "",
                *[f"- `{name}`" for name in screenshots],
                "",
                "## Evidence",
                "",
                "- `doc-preview.json`",
                "",
                "## Notes",
                "",
                evidence["notes"],
                "",
            ]
        ),
        encoding="utf-8",
    )
    assert result_md.is_file()

    # Strict path expectations
    assert opens[0]["path"] == VAULT_README
    assert opens[1]["path"] == VAULT_NOTES
    assert opens[2]["path"] == ARTIFACT_MEMO
    assert all(int(o["body_len"]) >= 24 for o in opens)
    assert story.get_attribute("data-open-count") == "3"
