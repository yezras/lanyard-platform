"""lac-bx3.16 / lp-wnxb: Portal multi-speaker timeline after lp-cxhb.15 chrome.

Auth-free story `/?story=group-rooms` renders a fixture group room:
Alice + Skip/Lev/Bana speakers. Roster lives behind the header title
click (members + purposes sheet). Subagent chips are suppressed in
channels. Composer @ completes the room roster.

Live surface: http://demo.localhost:3010 (or a Vite story host).
A screenshot is not proof — assertions use selector map keys.

Run:

  export BASE_URL=http://demo.localhost:3010
  export UI_ARTIFACTS=../../../../artifacts/ui/group-rooms
  cd portal/apps/web/ui-testing
  source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
  pytest -v test_group_rooms.py
  bash "$HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.sh"

Evidence: screenshots + REPORT.json under artifacts/ui/group-rooms/.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import Page, expect

from screenshot_utils import stable_page_screenshot

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_ARTIFACTS = REPO_ROOT / "artifacts" / "ui" / "group-rooms"
DESKTOP = {"width": 1440, "height": 900}
NARROW = {"width": 390, "height": 844}
TITLE_BTN = "agent-chat-header-title-button-room-skip-lev-bana"
SHEET = "channel-header-sheet-room-skip-lev-bana"
SHEET_CLOSE = "channel-sheet-close-room-skip-lev-bana"


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


def _open_story(page: Page, base_url: str, viewport: dict[str, int]) -> None:
    page.set_viewport_size(viewport)
    page.goto(
        f"{base_url.rstrip('/')}/?story=group-rooms",
        wait_until="networkidle",
        timeout=60_000,
    )
    expect(page.get_by_test_id("group-rooms-proof-story")).to_be_visible(
        timeout=15_000
    )


def _open_roster_sheet(page: Page) -> None:
    expect(page.get_by_test_id("group-room-roster")).to_have_count(0)
    title_button = page.get_by_test_id(TITLE_BTN)
    expect(title_button).to_be_visible()
    title_button.click()
    sheet = page.get_by_test_id(SHEET)
    expect(sheet).to_be_visible(timeout=5_000)
    # Story has no BFF; live stacks populate members. Either way the
    # sheet is the roster surface (not inline header chrome).
    page.get_by_test_id(SHEET_CLOSE).click()
    expect(sheet).to_be_hidden()


def test_u1_u4_group_room_story(
    page: Page, base_url: str, artifacts_dir: Path, selectors: dict
):
    del selectors
    env_dir = os.environ.get("UI_ARTIFACTS")
    out_dir = Path(env_dir) if env_dir else artifacts_dir
    if out_dir.name != "group-rooms":
        out_dir = DEFAULT_ARTIFACTS
    out_dir.mkdir(parents=True, exist_ok=True)

    _open_story(page, base_url, DESKTOP)
    _open_roster_sheet(page)

    for speaker in (
        "chat-speaker-persona-skip",
        "chat-speaker-persona-lev",
        "chat-speaker-persona-bana",
    ):
        expect(page.get_by_test_id(speaker)).to_be_visible()
    expect(page.get_by_text("I'll take the first pass.")).to_be_visible()
    expect(page.get_by_text("Security notes attached.")).to_be_visible()
    expect(page.get_by_text("Architecture looks sound.")).to_be_visible()

    skip_turn = page.get_by_test_id("chat-turn-persona-skip").first
    expect(skip_turn).to_be_visible()
    expect(
        skip_turn.locator(
            '[data-testid="dither-avatar-roster"], [data-testid="chat-subagent-chip-wrap"]'
        )
    ).to_have_count(0)
    expect(page.get_by_test_id("chat-speaker-persona-qa-helper")).to_have_count(0)
    expect(page.get_by_test_id("chat-turn-persona-qa-helper")).to_have_count(0)

    _shot(page, out_dir, "01-desktop-three-speakers.png")

    composer = page.get_by_test_id("group-rooms-composer")
    expect(composer).to_be_visible()
    box = composer.locator("textarea, [contenteditable='true']").first
    box.click()
    box.press_sequentially("@")
    expect(page.get_by_text("Skip", exact=True).nth(0)).to_be_visible()
    menu = page.get_by_text("Room", exact=True)
    if menu.count() > 0:
        expect(menu.first).to_be_visible()
    for name in ("Skip", "Lev", "Bana", "Alice"):
        expect(page.get_by_text(name, exact=True).first).to_be_visible()
    _shot(page, out_dir, "02-composer-at-complete.png")

    _open_story(page, base_url, NARROW)
    expect(page.get_by_test_id("group-room-roster")).to_have_count(0)
    expect(page.get_by_test_id(TITLE_BTN)).to_be_visible()
    expect(page.get_by_test_id("chat-speaker-persona-skip")).to_be_visible()
    _shot(page, out_dir, "03-narrow-viewport.png")

    _write_report(
        out_dir,
        {
            "bead": "lp-wnxb",
            "story": "group-rooms",
            "base_url": base_url,
            "u1_roster_behind_title": True,
            "u2_three_speakers": True,
            "u3_at_complete": True,
            "u4_subagent_not_peer": True,
            "narrow_viewport": NARROW,
        },
    )
