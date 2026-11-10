"""lp-dpr.8: Playwright / UI proof for chat activity plane (phases 0–6).

Auth-free story route (no BFF / login required):

  ?story=activity-plane
  ?story=activity-plane&phase=soft|tools|subagent|workflow|all
  ?story=activity-plane&pane=document|activity|closed
  ?story=activity-plane&layout=split|drawer

Happy paths covered:
  - Phase 0–1: soft open loads document pane content (not chrome-only)
  - Phase 2: tool rows via ChatToolCalls lifecycle
  - Phase 3–4: activity side pane shell
  - Phase 5: subagent chip opens activity pane (detail/roster)
  - Phase 6: workflow stages render (expand/collapse + nested subagents)

Requires a live Vite dev server:

  cd portal/packages/web
  pnpm exec vite --port 3021 --host 127.0.0.1

  cd ui-testing
  export BASE_URL=http://127.0.0.1:3021
  export UI_ARTIFACTS=../../../artifacts/ui/lp-dpr.8-activity-plane
  pytest -v test_activity_plane.py
"""

from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Page, expect

VIEWPORTS = {
    "desktop": {"width": 1440, "height": 900},
}


def _goto(page: Page, base_url: str, query: str = "") -> None:
    qs = f"?story=activity-plane{('&' + query) if query else ''}"
    page.goto(
        f"{base_url}/{qs}",
        wait_until="networkidle",
        timeout=60_000,
    )
    expect(page.get_by_test_id("activity-plane-story")).to_be_visible(
        timeout=15_000
    )


def test_phase0_1_soft_open_loads_document_content(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Soft open: document pane shows non-empty preview body (phases 0–1)."""
    page.set_viewport_size(VIEWPORTS["desktop"])
    _goto(page, base_url, "phase=soft&pane=document&layout=split")

    story = page.get_by_test_id("activity-plane-story")
    expect(story).to_have_attribute("data-phase", "soft")
    expect(story).to_have_attribute("data-doc-open", "1")
    expect(story).to_have_attribute("data-side-mode", "document")

    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=10_000)
    expect(pane).to_have_attribute("data-renderer", "preview")

    # Non-empty body (phase 0 fix): fixture markdown content is visible.
    body = page.get_by_test_id("chat-document-pane-body")
    expect(body).to_be_visible()
    expect(page.get_by_text("MSA.docx — soft-open preview")).to_be_visible()
    expect(page.get_by_text("Soft open loads content")).to_be_visible()

    # Soft-mode user message references the office path (also on tools/pane).
    expect(
        page.get_by_text("What does /Business/Contracts/MSA.docx")
    ).to_be_visible()

    out = artifacts_dir / "phase0-1-soft-open-content.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0


def test_phase2_tool_rows_render(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Tool rows appear via Astryx ChatToolCalls (phase 2)."""
    page.set_viewport_size(VIEWPORTS["desktop"])
    _goto(page, base_url, "phase=tools&pane=closed&layout=split")

    story = page.get_by_test_id("activity-plane-story")
    expect(story).to_have_attribute("data-phase", "tools")
    expect(story).to_have_attribute("data-side-mode", "closed")

    # ChatToolCalls surface humanized activity labels + targets (lp-vnz.9).
    # Default UI must not show raw tool ids (read_file / vault_search / bash).
    expect(page.get_by_text("Reading documents")).to_be_visible(timeout=10_000)
    expect(page.get_by_text("/Business/Contracts/MSA.docx").first).to_be_visible()
    expect(page.get_by_text("Searching files")).to_be_visible()
    expect(page.get_by_text("indemnification clause")).to_be_visible()
    # Shell tools show a friendly verb; argv stays in advanced detail only.
    expect(page.get_by_text("Running a command")).to_be_visible()
    expect(page.get_by_text("read_file", exact=True)).to_have_count(0)
    expect(page.get_by_text("vault_search", exact=True)).to_have_count(0)
    expect(page.get_by_text("bash", exact=True)).to_have_count(0)

    # Side panes stay closed so tools are the focus of the screenshot.
    expect(page.get_by_test_id("chat-document-pane")).to_have_count(0)
    expect(page.get_by_test_id("chat-activity-pane")).to_have_count(0)

    out = artifacts_dir / "phase2-tool-rows.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0


def test_phase3_4_activity_pane_shell(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Activity side pane shell opens with roster (phases 3–4 / 5 shell)."""
    page.set_viewport_size(VIEWPORTS["desktop"])
    _goto(page, base_url, "phase=subagent&pane=activity&layout=split")

    # phase=subagent + pane=activity defaults focus to subagent detail.
    # Open roster explicitly for shell chrome proof.
    page.get_by_role("button", name="Open activity roster").click()

    pane = page.get_by_test_id("chat-activity-pane")
    expect(pane).to_be_visible(timeout=10_000)
    expect(pane).to_have_attribute("data-mode", "activity")
    expect(pane).to_have_attribute("data-layout", "split")
    expect(pane).to_have_attribute("data-focus-kind", "roster")
    expect(page.get_by_test_id("chat-activity-pane-body")).to_be_visible()
    expect(page.get_by_test_id("chat-activity-pane-resize-handle")).to_be_visible()
    expect(
        page.get_by_role("button", name="Close activity pane")
    ).to_be_visible()

    # Roster lists subagents.
    expect(page.get_by_test_id("chat-subagent-roster")).to_be_visible()
    expect(page.get_by_test_id("chat-subagent-roster-row").first).to_be_visible()

    out = artifacts_dir / "phase3-4-activity-pane-shell.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0


def test_phase5_subagent_chip_opens_activity_pane(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Subagent chip click opens activity pane focused on that run (phase 5)."""
    page.set_viewport_size(VIEWPORTS["desktop"])
    _goto(page, base_url, "phase=subagent&pane=closed&layout=split")

    story = page.get_by_test_id("activity-plane-story")
    expect(story).to_have_attribute("data-side-mode", "closed")

    chip = page.locator(
        '[data-testid="chat-subagent-run-chip"][data-run-id="sa-explore-1"]'
    )
    expect(chip).to_be_visible(timeout=10_000)
    expect(chip).to_have_attribute("data-status", "running")
    chip.click()

    expect(story).to_have_attribute("data-side-mode", "activity")
    expect(story).to_have_attribute("data-side-focus", "subagent")

    pane = page.get_by_test_id("chat-activity-pane")
    expect(pane).to_be_visible(timeout=10_000)
    expect(pane).to_have_attribute("data-focus-kind", "subagent")

    detail = page.get_by_test_id("chat-subagent-detail")
    expect(detail).to_be_visible()
    expect(detail).to_have_attribute("data-run-id", "sa-explore-1")
    expect(page.get_by_test_id("chat-subagent-detail-status")).to_contain_text(
        "running"
    )
    expect(page.get_by_test_id("chat-subagent-detail-summary")).to_contain_text(
        "indemnity"
    )

    out = artifacts_dir / "phase5-subagent-chip-activity.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0


def test_phase6_workflow_stages_render(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Workflow card stages expand/collapse with nested subagents (phase 6)."""
    page.set_viewport_size(VIEWPORTS["desktop"])
    _goto(page, base_url, "phase=workflow&pane=closed&layout=split")

    card = page.get_by_test_id("chat-workflow-run-card")
    expect(card).to_be_visible(timeout=10_000)
    expect(card).to_have_attribute("data-workflow-id", "wf-onboard-1")
    expect(card).to_have_attribute("data-status", "running")

    stage_list = page.get_by_test_id("chat-workflow-stage-list")
    expect(stage_list).to_be_visible()
    stages = page.get_by_test_id("chat-workflow-stage")
    expect(stages).to_have_count(3)

    # Running stage is expanded by default and shows nested subagent.
    expect(page.get_by_text("Analyze").first).to_be_visible()
    # Expand Discover if collapsed to prove toggle + nested chip.
    discover = page.locator(
        '[data-testid="chat-workflow-stage"][data-stage-id="discover"]'
    )
    toggle = discover.get_by_test_id("chat-workflow-stage-toggle")
    if toggle.get_attribute("aria-expanded") == "false":
        toggle.click()
    expect(discover.get_by_test_id("chat-workflow-stage-body")).to_be_visible()

    # Nested subagents under stages (when expanded).
    nested = page.get_by_test_id("chat-workflow-nested-subagent")
    expect(nested.first).to_be_visible()

    # Open activity pane via workflow header.
    page.get_by_test_id("chat-workflow-run-header").click()
    story = page.get_by_test_id("activity-plane-story")
    expect(story).to_have_attribute("data-side-mode", "activity")
    expect(story).to_have_attribute("data-side-focus", "workflow")

    detail = page.get_by_test_id("chat-workflow-detail")
    expect(detail).to_be_visible()
    expect(detail).to_have_attribute("data-workflow-id", "wf-onboard-1")
    expect(page.get_by_test_id("chat-workflow-run-tree")).to_be_visible()

    out = artifacts_dir / "phase6-workflow-stages.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0


def test_phase_all_happy_path_composite(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Composite fixture: tools + subagents + workflow with document open."""
    page.set_viewport_size(VIEWPORTS["desktop"])
    _goto(page, base_url, "phase=all&pane=document&layout=split")

    story = page.get_by_test_id("activity-plane-story")
    expect(story).to_have_attribute("data-phase", "all")
    expect(story).to_have_attribute("data-doc-open", "1")
    expect(story).to_have_attribute("data-side-mode", "document")

    # Document content loaded.
    expect(page.get_by_test_id("chat-document-pane")).to_be_visible()
    expect(page.get_by_text("MSA.docx — soft-open preview")).to_be_visible()

    # Tools present (humanized ChatToolCalls labels; lp-vnz.9 / lp-4h6.2).
    expect(page.get_by_text("Reading documents")).to_be_visible()
    expect(page.get_by_text("Searching files")).to_be_visible()
    expect(page.get_by_text("read_file", exact=True)).to_have_count(0)
    expect(page.get_by_text("vault_search", exact=True)).to_have_count(0)

    # Subagent chips.
    chips = page.get_by_test_id("chat-subagent-run-chip")
    expect(chips.first).to_be_visible()

    # Workflow card.
    expect(page.get_by_test_id("chat-workflow-run-card")).to_be_visible()

    out = artifacts_dir / "phase-all-composite.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0

    # Switch to activity via subagent chip (exclusive side chrome).
    page.locator(
        '[data-testid="chat-subagent-run-chip"][data-run-id="sa-explore-1"]'
    ).click()
    expect(story).to_have_attribute("data-side-mode", "activity")
    expect(page.get_by_test_id("chat-activity-pane")).to_be_visible()
    # Document chrome exclusive — hidden while activity open.
    expect(page.get_by_test_id("chat-document-pane")).to_have_count(0)

    out2 = artifacts_dir / "phase-all-activity-exclusive.png"
    page.screenshot(path=str(out2), full_page=True)
    assert out2.is_file() and out2.stat().st_size > 0
