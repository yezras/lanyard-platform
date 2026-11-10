"""lp-uxy.15.3: Live UI QA — subagent artifacts clickable index + harvest.

Shipped feature: lp-uxy.2

Auth-free story route (deterministic fixture; same path as original PR UI QA):

  ?story=activity-plane&phase=artifacts&pane=activity&layout=split

Proof points (lp-uxy.2 acceptance):
  - Vault artifact openable from subagent activity detail after complete
  - Nested-tool harvest fills chips when host omits artifacts[]
  - Final orchestrator message includes clickable citations for those paths
  - Web-only URLs use web citation chips (not vault pane)

Run against live Portal (demo.localhost or Vite):

  export BASE_URL=http://demo.localhost:3010
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-uxy-ship-qa/artifacts
  pytest -v test_lp_uxy_15_3_subagent_artifacts.py

Evidence: screenshots + REPORT.json under UI_ARTIFACTS.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import Page, expect

VIEWPORTS = {
    "desktop": {"width": 1440, "height": 900},
}

ARTIFACT_PATH_A = "/Notes/explore-findings.md"
ARTIFACT_PATH_B = "/Notes/coder-report.md"
ARTIFACT_WEB = "https://example.com/msa-reference"


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


def _shot(page: Page, artifacts_dir: Path, name: str) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / name
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0, f"empty screenshot {out}"
    return out


def test_lp_uxy_15_3_subagent_artifacts_clickable_index_and_harvest(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Full ship-QA for lp-uxy.2 artifacts chips + final-report harvest."""
    page.set_viewport_size(VIEWPORTS["desktop"])
    results: list[dict] = []
    shots: dict[str, str] = {}

    def record(feature: str, ok: bool, detail: str, shot: Path | None = None):
        entry = {
            "feature": feature,
            "ok": ok,
            "detail": detail,
            "shot": str(shot) if shot else None,
        }
        results.append(entry)
        assert ok, f"{feature}: {detail}"

    # ------------------------------------------------------------------
    # 1) Writer-A detail: host artifacts[] → vault + web chips
    # ------------------------------------------------------------------
    _goto(page, base_url, "phase=artifacts&pane=activity&layout=split")
    story = page.get_by_test_id("activity-plane-story")
    expect(story).to_have_attribute("data-phase", "artifacts")
    expect(story).to_have_attribute("data-side-mode", "activity")
    expect(story).to_have_attribute("data-side-focus", "subagent")

    detail = page.get_by_test_id("chat-subagent-detail")
    expect(detail).to_be_visible(timeout=10_000)
    expect(detail).to_have_attribute("data-run-id", "sa-writer-a")
    expect(page.get_by_test_id("chat-subagent-detail-status")).to_contain_text(
        "done"
    )

    arts = page.get_by_test_id("chat-subagent-artifacts")
    expect(arts).to_be_visible()
    expect(arts).to_contain_text("Artifacts from this run")

    vault_chip = page.get_by_test_id("chat-subagent-artifact-vault-1")
    expect(vault_chip).to_be_visible()
    expect(vault_chip).to_have_attribute("data-artifact-path", ARTIFACT_PATH_A)
    expect(vault_chip).to_have_attribute("data-artifact-kind", "vault")

    web_chip = page.get_by_test_id("chat-subagent-artifact-web-2")
    expect(web_chip).to_be_visible()
    expect(web_chip).to_have_attribute("data-artifact-path", ARTIFACT_WEB)
    expect(web_chip).to_have_attribute("data-artifact-kind", "web")

    shot = _shot(page, artifacts_dir, "01-writer-a-detail-artifacts.png")
    shots["writer_a_detail"] = str(shot)
    record(
        "writer-a-host-artifacts-index",
        True,
        "sa-writer-a detail shows vault + web chips (host artifacts[])",
        shot,
    )

    # ------------------------------------------------------------------
    # 2) Vault chip soft-opens document pane with fixture body
    # ------------------------------------------------------------------
    vault_chip.click()
    expect(story).to_have_attribute("data-side-mode", "document", timeout=5_000)
    expect(story).to_have_attribute("data-doc-open", "1")
    pane = page.get_by_test_id("chat-document-pane")
    expect(pane).to_be_visible(timeout=10_000)
    body = page.get_by_test_id("chat-document-pane-body")
    expect(body).to_be_visible()
    expect(page.get_by_text("Explore findings").first).to_be_visible()
    expect(
        page.get_by_text("Fixture body for lp-uxy.2 subagent artifact soft-open")
    ).to_be_visible()

    shot = _shot(page, artifacts_dir, "02-vault-chip-soft-open-findings.png")
    shots["vault_soft_open"] = str(shot)
    record(
        "vault-artifact-openable-from-detail",
        True,
        f"clicked vault chip → document pane soft-open {ARTIFACT_PATH_A}",
        shot,
    )

    # ------------------------------------------------------------------
    # 3) Web chip does NOT open vault document pane
    # ------------------------------------------------------------------
    # Re-open activity detail for writer-a
    page.locator(
        '[data-testid="chat-subagent-run-chip"][data-run-id="sa-writer-a"]'
    ).click()
    expect(story).to_have_attribute("data-side-mode", "activity", timeout=5_000)
    expect(page.get_by_test_id("chat-subagent-detail")).to_have_attribute(
        "data-run-id", "sa-writer-a"
    )

    # Capture popup attempt; pane must stay activity (no vault soft-open).
    page.get_by_test_id("chat-subagent-artifact-web-2").click()
    page.wait_for_timeout(400)
    expect(story).to_have_attribute("data-side-mode", "activity")
    expect(page.get_by_test_id("chat-document-pane")).to_have_count(0)

    shot = _shot(page, artifacts_dir, "03-web-chip-no-vault-pane.png")
    shots["web_no_vault"] = str(shot)
    record(
        "web-artifact-not-vault-pane",
        True,
        "web chip leaves side mode=activity; no chat-document-pane",
        shot,
    )

    # ------------------------------------------------------------------
    # 4) Writer-B: nested-tool harvest (host omitted artifacts[])
    # ------------------------------------------------------------------
    page.locator(
        '[data-testid="chat-subagent-run-chip"][data-run-id="sa-writer-b"]'
    ).click()
    expect(page.get_by_test_id("chat-subagent-detail")).to_have_attribute(
        "data-run-id", "sa-writer-b", timeout=5_000
    )
    expect(page.get_by_test_id("chat-subagent-artifacts")).to_be_visible()
    harvest_chip = page.get_by_test_id("chat-subagent-artifact-vault-1")
    expect(harvest_chip).to_be_visible()
    expect(harvest_chip).to_have_attribute("data-artifact-path", ARTIFACT_PATH_B)
    expect(harvest_chip).to_have_attribute("data-artifact-kind", "vault")

    shot = _shot(page, artifacts_dir, "04-writer-b-harvested-artifacts.png")
    shots["writer_b_harvest"] = str(shot)
    record(
        "nested-tool-harvest-when-host-omits-artifacts",
        True,
        f"sa-writer-b harvests nested write → vault chip {ARTIFACT_PATH_B}",
        shot,
    )

    harvest_chip.click()
    expect(story).to_have_attribute("data-side-mode", "document", timeout=5_000)
    expect(page.get_by_test_id("chat-document-pane")).to_be_visible()
    expect(page.get_by_text("Executive report").first).to_be_visible()
    expect(
        page.get_by_text("Fixture body for second subagent write (lp-uxy.2)")
    ).to_be_visible()

    shot = _shot(page, artifacts_dir, "05-harvest-chip-soft-open-report.png")
    shots["harvest_soft_open"] = str(shot)
    record(
        "harvested-vault-openable-from-detail",
        True,
        f"harvested vault chip soft-opens {ARTIFACT_PATH_B}",
        shot,
    )

    # ------------------------------------------------------------------
    # 5) Final-report citations (host harvest path / history-reload seed)
    # ------------------------------------------------------------------
    # Close document to make timeline citations easy to see; citations live
    # on the assistant turn regardless of side pane mode.
    _goto(page, base_url, "phase=artifacts&pane=closed&layout=split")
    story = page.get_by_test_id("activity-plane-story")
    expect(story).to_have_attribute("data-phase", "artifacts")

    c1 = page.get_by_test_id("vault-citation-1")
    c2 = page.get_by_test_id("vault-citation-2")
    c3 = page.get_by_test_id("web-citation-3")
    expect(c1).to_be_visible(timeout=10_000)
    expect(c2).to_be_visible()
    expect(c3).to_be_visible()
    expect(c1).to_contain_text("explore-findings")
    expect(c2).to_contain_text("coder-report")
    expect(c3).to_contain_text("MSA reference")

    shot = _shot(page, artifacts_dir, "06-final-report-citations.png")
    shots["final_citations"] = str(shot)
    record(
        "final-report-clickable-citations",
        True,
        "assistant turn has vault-citation-1/2 + web-citation-3",
        shot,
    )

    # Click vault citation → soft-open
    c1.click()
    expect(story).to_have_attribute("data-side-mode", "document", timeout=5_000)
    expect(story).to_have_attribute("data-doc-open", "1")
    expect(page.get_by_test_id("chat-document-pane")).to_be_visible()
    expect(page.get_by_text("Explore findings").first).to_be_visible()

    shot = _shot(page, artifacts_dir, "07-final-citation-soft-open.png")
    shots["citation_soft_open"] = str(shot)
    record(
        "final-citation-openable",
        True,
        "vault-citation-1 soft-opens explore-findings body",
        shot,
    )

    # Web citation must not open vault pane
    # Re-seed closed so we can observe mode change cleanly
    _goto(page, base_url, "phase=artifacts&pane=closed&layout=split")
    story = page.get_by_test_id("activity-plane-story")
    page.get_by_test_id("web-citation-3").click()
    page.wait_for_timeout(400)
    # Web citations call openVaultPath which no-ops on http(s)
    expect(story).to_have_attribute("data-doc-open", "0")
    expect(page.get_by_test_id("chat-document-pane")).to_have_count(0)

    shot = _shot(page, artifacts_dir, "08-web-citation-no-vault-pane.png")
    shots["web_citation_no_vault"] = str(shot)
    record(
        "web-citation-not-vault-pane",
        True,
        "web-citation-3 does not open document pane",
        shot,
    )

    # ------------------------------------------------------------------
    # 6) History-reload path: reload story URL keeps chips + citations
    # ------------------------------------------------------------------
    page.reload(wait_until="networkidle")
    expect(page.get_by_test_id("activity-plane-story")).to_be_visible(
        timeout=15_000
    )
    # Default phase=artifacts opens activity focus on writer-a
    expect(page.get_by_test_id("vault-citation-1")).to_be_visible(timeout=10_000)
    expect(page.get_by_test_id("vault-citation-2")).to_be_visible()
    # Open writer-a detail if not already (reload keeps query string)
    if page.get_by_test_id("chat-subagent-detail").count() == 0:
        page.locator(
            '[data-testid="chat-subagent-run-chip"][data-run-id="sa-writer-a"]'
        ).click()
    # Ensure activity detail for writer-a
    if (
        page.get_by_test_id("chat-subagent-detail").count() == 0
        or page.get_by_test_id("chat-subagent-detail").get_attribute(
            "data-run-id"
        )
        != "sa-writer-a"
    ):
        # pane may have been closed; open via chip
        page.locator(
            '[data-testid="chat-subagent-run-chip"][data-run-id="sa-writer-a"]'
        ).click()
    expect(page.get_by_test_id("chat-subagent-artifacts")).to_be_visible(
        timeout=10_000
    )
    expect(
        page.get_by_test_id("chat-subagent-artifact-vault-1")
    ).to_have_attribute("data-artifact-path", ARTIFACT_PATH_A)

    shot = _shot(page, artifacts_dir, "09-after-reload-chips-and-citations.png")
    shots["after_reload"] = str(shot)
    record(
        "history-reload-paths-openable",
        True,
        "after reload: vault chips + final citations still present",
        shot,
    )

    # Composite proof
    _goto(page, base_url, "phase=artifacts&pane=activity&layout=split")
    shot = _shot(page, artifacts_dir, "10-composite-artifacts-phase.png")
    shots["composite"] = str(shot)

    # ------------------------------------------------------------------
    # Write report
    # ------------------------------------------------------------------
    all_ok = all(r["ok"] for r in results)
    report = {
        "bead_id": "lp-uxy.15.3",
        "shipped_bead": "lp-uxy.2",
        "base_url": base_url,
        "method": "web-ui-testing / Playwright headless",
        "route": "?story=activity-plane&phase=artifacts",
        "login": "auth-free story (demo credentials N/A for story mount)",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "verdict": "PASS" if all_ok else "FAIL",
        "results": results,
        "shots": shots,
        "acceptance": {
            "vault_artifact_openable_from_subagent_detail": True,
            "final_report_clickable_citations": True,
            "history_reload_keeps_paths": True,
            "web_urls_use_web_chips_not_vault_pane": True,
            "nested_tool_harvest_when_host_omits_artifacts": True,
        },
        "notes": (
            "Story fixture exercises host artifacts[] (writer-a), nested-tool "
            "harvest (writer-b), final-report citation chips, and web vs vault "
            "open paths. Live host multi-subagent write was not required for "
            "Portal UI contract proof; Brain RPC remains linked per lp-uxy.15.1."
        ),
    }
    report_path = artifacts_dir / "REPORT.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    readme = artifacts_dir / "README.md"
    readme.write_text(
        "\n".join(
            [
                "# lp-uxy.15.3 — Subagent artifacts clickable index + harvest",
                "",
                f"**Verdict:** {report['verdict']}",
                f"**Shipped:** lp-uxy.2",
                f"**Base:** `{base_url}`",
                f"**Route:** `{report['route']}`",
                f"**When:** {report['timestamp']}",
                "",
                "## Acceptance",
                "",
                "- [x] Vault artifact openable from subagent activity detail",
                "- [x] Nested-tool harvest when host omits `artifacts[]`",
                "- [x] Final report has clickable citations for harvested paths",
                "- [x] History reload keeps chips/citations openable",
                "- [x] Web-only URLs use web chips (not vault pane)",
                "",
                "## Screenshots",
                "",
                *[f"- `{Path(p).name}`" for p in shots.values()],
                "",
                "See `REPORT.json` for machine-readable pass/fail.",
                "",
            ]
        ),
        encoding="utf-8",
    )
    assert all_ok
    assert report_path.is_file()
