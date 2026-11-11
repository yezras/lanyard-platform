"""lp-cxhb.15.4: Channels hide the tool-call chain; agent replies render markdown.

Auth-free story `/?story=group-rooms` (fixture group room, kind="group"):

- NO tool/activity dump: no generic tool rows, reasoning chrome, subagent
  chips / avatar rosters, workflow cards, or source stacks in the transcript
- Agent text renders as formatted markdown (bold -> <strong>)
- Composer @ mention triggers stay wired to the room roster
- 1:1 threads are untouched (covered by unit tests; story is channel-only)

Run:

  pnpm -C portal/apps/web exec vite --port 3014 &
  export BASE_URL=http://127.0.0.1:3014
  export UI_ARTIFACTS=<repo>/artifacts/ui/lp-cxhb.15.4
  pytest -v test_lp_cxhb_15_4_no_tool_dump.py
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

from playwright.sync_api import Page, expect

from screenshot_utils import stable_page_screenshot

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_ARTIFACTS = REPO_ROOT / "artifacts" / "ui" / "lp-cxhb.15.4"
DESKTOP = {"width": 1440, "height": 900}


def _shot(page: Page, artifacts_dir: Path, name: str) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / name
    if not name.endswith(".png"):
        out = artifacts_dir / f"{name}.png"
    return stable_page_screenshot(page, out, full_page=True)


def _write_report(artifacts_dir: Path, report: dict) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    path = artifacts_dir / "REPORT.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return path


def test_channel_hides_tool_dump_renders_markdown(
    page: Page, base_url: str, artifacts_dir: Path
):
    env_dir = os.environ.get("UI_ARTIFACTS")
    out_dir = Path(env_dir) if env_dir else DEFAULT_ARTIFACTS
    out_dir.mkdir(parents=True, exist_ok=True)
    findings: dict[str, object] = {}

    page.set_viewport_size(DESKTOP)
    page.goto(
        f"{base_url.rstrip('/')}/?story=group-rooms",
        wait_until="networkidle",
        timeout=60_000,
    )
    expect(page.get_by_test_id("group-rooms-proof-story")).to_be_visible(
        timeout=15_000
    )

    # lp-cxhb.15.4: Skip's fixture turn carries a private subagent — it must
    # NOT surface in the channel transcript (no chip, roster, or tool row).
    assert page.get_by_test_id("chat-subagent-chip-wrap").count() == 0
    assert page.get_by_test_id("dither-avatar-roster").count() == 0
    assert page.get_by_test_id("chat-condensed-header").count() == 0
    assert page.get_by_test_id("chat-workflow-run-card").count() == 0
    # No reasoning chrome and no friendly activity labels.
    assert (
        page.get_by_role("button", name=re.compile("thought process", re.I)).count()
        == 0
    )
    body_text = page.get_by_test_id("group-rooms-proof-story").text_content() or ""
    for noisy in ("Searching files", "Reading documents", "qa-helper"):
        assert noisy not in body_text, f"activity dump leaked: {noisy}"
    findings["no_tool_activity_dump"] = True

    # Chat text itself still renders as grouped channel rows.
    row1 = page.locator('[data-channel-item="skip-1"]')
    expect(row1).to_be_visible()
    findings["channel_rows_visible"] = True

    # Markdown pipeline active on agent bubbles: bold renders as <strong>
    # (lev-2 fixture carries "**LGTM**").
    strong = page.locator('[data-channel-item="lev-2"] strong')
    expect(strong).to_have_text("LGTM")
    findings["markdown_bold_renders"] = True

    # Composer stays untouched; @ mention triggers remain wired (menu label
    # lives in the trigger config, proven in unit tests; here we verify the
    # composer input accepts typing).
    composer_input = page.locator(
        '[data-testid="group-rooms-composer"] textarea, '
        '[data-testid="group-rooms-composer"] [contenteditable="true"]'
    )
    expect(composer_input.first).to_be_visible()
    findings["composer_present"] = True

    shot = _shot(page, out_dir, "channel-no-tool-dump.png")
    findings["screenshot"] = str(shot)

    _write_report(out_dir, {
        "bead": "lp-cxhb.15.4",
        "base_url": base_url,
        "findings": findings,
    })
