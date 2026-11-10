"""lp-khq.12.1: Workflow wizard natural-language first (no IR/JSON jargon).

Auth-free story `/?story=workflow-chat-wizard`:
  - Intent MCQ → free-form multi-sentence describe
  - Multi-phase research→write becomes ≥2 stages
  - No user-visible IR JSON / host workflow tool / Call workflow({ jargon
  - Confirm + create lands in inventory chrome

Requires a live Vite dev server:

  # From packages/web
  pnpm exec vite --port 3035 --host 127.0.0.1

  cd ui-testing
  export BASE_URL=http://127.0.0.1:3035
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-khq.12.1
  pytest -v test_workflow_chat_wizard_nl.py

Screenshots under monorepo artifacts/ui/lp-khq.12.1/
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

from playwright.sync_api import Page, expect

BANNED = re.compile(
    r"IR JSON|JSON paste|host workflow tool|Call workflow\(|kebab-case",
    re.I,
)


def test_workflow_wizard_nl_first(page: Page, base_url: str, artifacts_dir: Path):
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto(
        f"{base_url.rstrip('/')}/?story=workflow-chat-wizard",
        wait_until="networkidle",
        timeout=60_000,
    )

    story = page.get_by_test_id("wf-wizard-proof-story")
    expect(story).to_be_visible(timeout=15_000)
    expect(page.get_by_test_id("wf-wizard-step")).to_have_text("intent")

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(artifacts_dir / "01-intent.png"), full_page=True)

    chat = page.get_by_test_id("wf-wizard-chat-pane")
    body_text = chat.inner_text()
    assert not BANNED.search(body_text), f"Banned jargon in intro: {body_text[:200]}"

    page.get_by_role("button", name=re.compile(r"Yes, create a workflow", re.I)).click()
    expect(page.get_by_test_id("wf-wizard-step")).to_have_text("describe", timeout=5_000)
    expect(page.get_by_test_id("wf-wizard-free-text-input")).to_be_visible()
    page.screenshot(path=str(artifacts_dir / "02-describe-prompt.png"), full_page=True)

    nl = (
        "Title: Research Report\n"
        "Research the topic thoroughly. Then write a concise report."
    )
    page.get_by_test_id("wf-wizard-free-text-input").fill(nl)
    page.get_by_test_id("wf-wizard-free-text-send").click()

    expect(page.get_by_role("button", name=re.compile(r"^Create workflow$", re.I))).to_be_visible(
        timeout=5_000
    )
    confirm_text = chat.inner_text()
    assert not BANNED.search(confirm_text), f"Banned jargon on confirm: {confirm_text[:300]}"
    assert re.search(r"research|write|report", confirm_text, re.I)
    page.screenshot(path=str(artifacts_dir / "03-confirm-multi-phase.png"), full_page=True)

    page.get_by_role("button", name=re.compile(r"^Create workflow$", re.I)).click()
    expect(page.get_by_test_id("wf-wizard-step")).to_have_text("done", timeout=8_000)
    expect(page.get_by_test_id("wf-wizard-workflow-names")).to_contain_text(
        "research-report", timeout=8_000
    )
    page.screenshot(path=str(artifacts_dir / "04-created-inventory.png"), full_page=True)

    # Agent request stored on window must also avoid Call workflow({ / IR JSON
    agent_req = page.evaluate(
        "() => (window.__workflowWizardProof && window.__workflowWizardProof.lastAgentRequest) || ''"
    )
    assert agent_req, "expected lastAgentRequest on proof window"
    assert not BANNED.search(agent_req), f"Banned jargon in agent request: {agent_req[:200]}"
    stages = page.evaluate(
        "() => (window.__workflowWizardProof && window.__workflowWizardProof.lastCreateBody && window.__workflowWizardProof.lastCreateBody.stages) || []"
    )
    assert isinstance(stages, list) and len(stages) >= 2, f"expected ≥2 stages, got {stages!r}"

    report = {
        "bead": "lp-khq.12.1",
        "story": "workflow-chat-wizard",
        "verdict": "PASS",
        "stages": len(stages),
        "name": page.evaluate(
            "() => window.__workflowWizardProof?.lastCreateBody?.name ?? null"
        ),
        "banned_jargon": False,
        "screenshots": [
            "01-intent.png",
            "02-describe-prompt.png",
            "03-confirm-multi-phase.png",
            "04-created-inventory.png",
        ],
    }
    (artifacts_dir / "REPORT.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    (artifacts_dir / "RESULT.md").write_text(
        "# lp-khq.12.1 — Workflow wizard NL-first\n\n"
        f"**Verdict: {report['verdict']}**\n\n"
        f"- Stages parsed: {report['stages']}\n"
        f"- Name: `{report['name']}`\n"
        "- No IR JSON / JSON paste / host workflow tool / Call workflow({ / kebab-case in user chrome\n"
        "- Screenshots: 01–04 under this directory\n",
        encoding="utf-8",
    )
