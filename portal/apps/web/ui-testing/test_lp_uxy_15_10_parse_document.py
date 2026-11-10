"""lp-uxy.15.10: Live UI QA — parse_document / AnyDoc tool path (shipped lp-uxy.10).

Story path (auth-free, fixture; no BFF parse, OCR cost-gated):

  ?story=parse-document

  Attach stamp + tool lifecycle (Parsing a document) + markdown result markers
  + negatives (path_denied / unsupported_scanned).

Run:

  export BASE_URL=http://demo.localhost:3010
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-uxy-ship-qa/parse-doc
  pytest -v test_lp_uxy_15_10_parse_document.py

Full ship-qa (story + live LA attach/parse): scripts under
artifacts/ui/lp-uxy-ship-qa/parse-doc/ or /tmp/lp-uxy.15.10-parse-doc-qa.py
"""

from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import Page, expect

DOCX_MARKER = "LANYARD_F6_DOCX_Q3_REVENUE_MARKER"
PDF_MARKER = "LANYARD_F6_PDF_POLICY_MARKER"
DESKTOP = {"width": 1440, "height": 900}


def test_lp_uxy_15_10_parse_document_story(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Auth-free story proves parse_document UI labels + lifecycle + markers."""
    page.set_viewport_size(DESKTOP)
    page.goto(
        f"{base_url.rstrip('/')}/?story=parse-document",
        wait_until="domcontentloaded",
        timeout=60_000,
    )

    story = page.get_by_test_id("parse-document-proof-story")
    expect(story).to_be_visible(timeout=20_000)
    expect(story).to_have_attribute("data-parse-document-live", "false")
    expect(story).to_have_attribute("data-cost-gated", "true")
    expect(story).to_have_attribute("data-bff-parse", "false")
    expect(story).to_have_attribute("data-friendly-label", "Parsing a document")

    expect(page.get_by_test_id("parse-document-attach-panel")).to_be_visible()
    expect(page.get_by_test_id("parse-document-tool-panel")).to_be_visible()
    expect(page.get_by_test_id("parse-document-answer-panel")).to_be_visible()
    expect(page.get_by_test_id("parse-document-negatives-meta")).to_be_visible()

    attach = page.get_by_test_id("parse-document-user-attach")
    expect(attach).to_contain_text("[staging uploads]")
    expect(attach).to_contain_text("sample.docx")
    expect(attach).to_contain_text("sample.pdf")

    # Expand tool rows for screenshots / result previews
    rows = page.get_by_role("button", name="Parsing a document")
    for i in range(min(rows.count(), 8)):
        try:
            rows.nth(i).click(timeout=2000)
        except Exception:
            pass

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(
        path=str(artifacts_dir / "pytest-story-parse-document.png"),
        full_page=True,
    )

    body = page.locator("body").inner_text()
    assert "Parsing a document" in body
    assert DOCX_MARKER in body
    assert PDF_MARKER in body
    assert "path_denied" in body
    assert "unsupported_scanned" in body
    assert "anydoc" in body.lower() or "AnyDoc" in body or "parse_document" in body
    assert "no BFF" in body.lower() or story.get_attribute("data-bff-parse") == "false"

    # Markdown result previews on complete rows
    result_docx = page.get_by_test_id("parse-document-result-f6-docx")
    expect(result_docx).to_be_visible()
    assert DOCX_MARKER in (result_docx.inner_text() or "")

    evidence = {
        "bead_id": "lp-uxy.15.10",
        "story": "parse-document",
        "cost_gated": True,
        "parse_document_live": False,
        "bff_parse": False,
        "friendly_label": "Parsing a document",
        "docx_marker": DOCX_MARKER in body,
        "pdf_marker": PDF_MARKER in body,
        "negatives": {
            "path_denied": "path_denied" in body,
            "unsupported_scanned": "unsupported_scanned" in body,
        },
    }
    (artifacts_dir / "pytest-story-evidence.json").write_text(
        json.dumps(evidence, indent=2) + "\n"
    )
