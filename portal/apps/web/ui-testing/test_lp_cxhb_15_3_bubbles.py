"""lp-cxhb.15.3: Channel transcript Astryx ChatMessageBubble grouping.

Auth-free story `/?story=group-rooms` (fixture group room, kind="group") now
renders the transcript as WhatsApp/iMessage-style grouped bubbles:

- persona bubbles sit left under a dither avatar gutter with sender name
- consecutive same-speaker rows share first/last bubble corner grouping
- time + delivered receipts render in the message metadata
- NO model names and NO regenerate/copy affordances in channels

Run:

  pnpm -C portal/apps/web exec vite --port 3013 &
  export BASE_URL=http://127.0.0.1:3013
  export UI_ARTIFACTS=<repo>/artifacts/ui/lp-cxhb.15.3
  pytest -v test_lp_cxhb_15_3_bubbles.py
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

from playwright.sync_api import Page, expect

from screenshot_utils import stable_page_screenshot

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_ARTIFACTS = REPO_ROOT / "artifacts" / "ui" / "lp-cxhb.15.3"
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


def test_channel_bubbles_grouping(
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

    # Speaker run chrome: dither avatar gutter + sender name on Skip's run.
    avatar = page.get_by_test_id("chat-channel-avatar-persona-skip")
    expect(avatar).to_be_visible()
    findings["skip_avatar_visible"] = True

    names = page.get_by_test_id("chat-speaker-persona-skip")
    expect(names).to_have_count(1)
    assert "Skip" in (names.first.text_content() or "")
    findings["sender_name_visible"] = True
    expect(page.get_by_test_id("chat-speaker-persona-lev")).to_be_visible()

    # Bubble grouping positions across the consecutive Skip rows.
    row1 = page.locator('[data-channel-item="skip-1"]')
    row2 = page.locator('[data-channel-item="skip-2"]')
    row3 = page.locator('[data-channel-item="bana-1"]')
    expect(row1).to_be_visible()
    expect(row2).to_be_visible()
    expect(row3).to_be_visible()
    assert row1.get_attribute("data-channel-group") == "first"
    assert row2.get_attribute("data-channel-group") == "last"
    assert row3.get_attribute("data-channel-group") == "single"
    findings["bubble_group_positions"] = ["first", "last", "single"]

    # Time + delivered receipt visible in message metadata.
    metas = page.locator('[class*="astryx-chat-message-metadata"]')
    assert metas.count() >= 2, "expected timestamp metadata on bubbles"
    meta_text = " ".join(metas.all_text_contents())
    assert re.search(r"\d{1,2}:\d{2}", meta_text), f"no time in {meta_text!r}"
    findings["timestamp_visible"] = True
    delivered = page.get_by_text("Delivered", exact=True)
    expect(delivered.first).to_be_visible()
    findings["delivered_receipt_visible"] = True

    # Channels never show model names or regenerate/copy affordances.
    assert page.get_by_test_id("chat-assistant-model").count() == 0
    assert page.get_by_test_id("chat-assistant-footer").count() == 0
    assert (
        page.get_by_role("button", name=re.compile("regenerate", re.I)).count()
        == 0
    )
    assert (
        page.get_by_role("button", name=re.compile("^copy$", re.I)).count() == 0
    )
    findings["no_model_or_affordances"] = True

    # Composer stays untouched (story placeholder).
    composer = page.get_by_test_id("group-rooms-composer")
    expect(composer).to_be_visible()
    findings["composer_present"] = True

    shot = _shot(page, out_dir, "channel-bubbles.png")
    findings["screenshot"] = str(shot)

    _write_report(out_dir, {
        "bead": "lp-cxhb.15.3",
        "base_url": base_url,
        "findings": findings,
    })
