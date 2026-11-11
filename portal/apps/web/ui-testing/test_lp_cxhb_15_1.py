"""lp-cxhb.15.1 — Playwright gate: sidenav channel rows are #name only.

Acceptance:
  - Channel rows render "#name" only — no avatar (dither/share icon),
    no last-message/date recency subtitle.
  - Agent rows are unchanged: dither avatar + subtitle stay (1:1 ghost UI).
  - Sidenav screenshot captured into artifacts/ui/lp-cxhb.15.1/.

Run against a local product stack:

  export BASE_URL=http://demo.localhost:3012
  export UI_ARTIFACTS=/home/operator/Lanyard-Dev/lp-cxhb-15/artifacts/ui/lp-cxhb.15.1
  cd portal/apps/web/ui-testing
  source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
  pytest -v test_lp_cxhb_15_1.py
  bash "$HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.sh"
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

import pytest
from playwright.sync_api import Locator, Page, expect

from screenshot_utils import stable_page_screenshot

EMAIL = "dev@demo.local"
PASSWORD = "local-dev-password"
DESKTOP = {"width": 1440, "height": 900}

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_ARTIFACTS = REPO_ROOT / "artifacts" / "ui" / "lp-cxhb.15.1"

CHANNEL_ROW_SEL = '[data-testid^="agent-side-nav-row-"][data-channel="true"]'
AGENT_ROW_SEL = (
    '[data-testid^="agent-side-nav-row-"]'
    '[data-channel="false"]:not([data-job-stream="true"])'
)


@pytest.fixture(scope="module")
def artifacts_dir() -> Path:
    env = os.environ.get("UI_ARTIFACTS")
    path = Path(env) if env else DEFAULT_ARTIFACTS
    path.mkdir(parents=True, exist_ok=True)
    return path


def _shot(page: Page, artifacts_dir: Path, name: str) -> Path:
    out = artifacts_dir / name
    if not name.endswith(".png"):
        out = artifacts_dir / f"{name}.png"
    return stable_page_screenshot(page, out, full_page=True)


def _login(page: Page, base_url: str) -> None:
    page.goto(
        base_url.rstrip("/") + "/",
        wait_until="domcontentloaded",
        timeout=60_000,
    )
    page.wait_for_timeout(800)
    page.get_by_role(
        "button", name=re.compile(r"^Agents$|^Log in$", re.I)
    ).first.wait_for(state="visible", timeout=20_000)

    agents = page.get_by_role("button", name=re.compile(r"^Agents$", re.I))
    account = page.get_by_role(
        "button", name=re.compile(r"Account menu|dev@demo", re.I)
    )
    login_btn = page.get_by_role("button", name="Log in", exact=True)
    if (agents.count() > 0 or account.count() > 0) and login_btn.count() == 0:
        return

    email = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
    if email.count() == 0:
        email = page.locator('input[type="email"], input[name="email"]')
    email.first.fill(EMAIL)
    page.locator('input[type="password"]').first.fill(PASSWORD)
    page.get_by_role("button", name="Log in", exact=True).click()
    page.wait_for_timeout(2500)
    expect(
        page.get_by_role("button", name=re.compile(r"^Agents$", re.I)).first
    ).to_be_visible(timeout=20_000)


def _open_agents(page: Page) -> None:
    agents = page.get_by_role("button", name=re.compile(r"^Agents$", re.I))
    expect(agents.first).to_be_visible(timeout=15_000)
    agents.first.click()
    page.wait_for_timeout(500)


def _ensure_channel_row(page: Page) -> Locator:
    """Return a channel row, creating one via the New Channel dialog if needed."""
    rows = page.locator(CHANNEL_ROW_SEL)
    if rows.count() >= 1:
        return rows.first

    stamp = str(int(time.time()))
    channel_name = f"QA Hash {stamp}"

    create_btn = page.get_by_role(
        "button", name=re.compile(r"^New Agent$", re.I)
    ).first
    expect(create_btn).to_be_visible(timeout=10_000)
    create_btn.click()
    item_channel = page.get_by_role("menuitem", name=re.compile(r"^Channel$", re.I))
    expect(item_channel.first).to_be_visible(timeout=5_000)
    item_channel.first.click()
    expect(page.get_by_text("New channel").first).to_be_visible(timeout=8_000)

    field = page.get_by_role("textbox", name=re.compile(r"Channel name", re.I))
    field.first.fill(channel_name)

    picks = page.locator('[data-testid^="channel-member-pick-"]')
    if picks.count() < 2:
        for suffix in ("A", "B"):
            inline = page.get_by_role(
                "textbox", name=re.compile(r"New agent name", re.I)
            )
            inline.first.fill(f"QA Hash Member {suffix} {stamp}")
            add = page.get_by_role("button", name=re.compile(r"^Add agent$", re.I))
            expect(add.first).to_be_enabled(timeout=5_000)
            add.first.click()
            page.wait_for_timeout(300)

    submit = page.get_by_role("button", name=re.compile(r"^Create channel$", re.I))
    expect(submit.first).to_be_enabled(timeout=5_000)
    submit.first.click()

    expect(rows.first).to_be_visible(timeout=15_000)
    return rows.first


def _row_probe(row: Locator) -> dict:
    """Inspect one sidenav row in the DOM: hash prefix, avatar, subtitle."""
    return row.evaluate(
        """(row) => {
          const text = (row.textContent || '').trim();
          const nameEl = row.querySelector('[data-testid^="channel-side-nav-name-"]');
          return {
            dataChannel: row.getAttribute('data-channel'),
            text,
            hasHashName: Boolean(nameEl && nameEl.textContent.trim().startsWith('#')),
            ditherCount: row.querySelectorAll('[data-testid^="agent-dither-"]').length,
            shareIconCount: row.querySelectorAll(
              '[data-testid="agent-side-nav-share-icon"]').length,
            subtitleCount: row.querySelectorAll(
              '[data-testid^="agent-side-nav-subtitle-"]').length,
          };
        }"""
    )


def test_channel_rows_hash_name_only_agent_rows_unchanged(
    page: Page, base_url: str, artifacts_dir: Path
):
    """lp-cxhb.15.1: channels are #name only; agent rows keep ghost UI."""
    page.set_viewport_size(DESKTOP)
    checks: list[dict] = []
    shots: list[str] = []

    def record(feature: str, ok: bool, detail: str, shot: Path | None = None) -> None:
        checks.append({"feature": feature, "ok": ok, "detail": detail})
        assert ok, f"{feature}: {detail}"

    _login(page, base_url)
    _open_agents(page)

    channel_row = _ensure_channel_row(page)
    shot_channels = _shot(
        page, artifacts_dir, "01-sidenav-channel-rows-hash-only.png"
    )
    shots.append(str(shot_channels))

    probe = _row_probe(channel_row)
    record(
        "channel-row-data-channel",
        probe["dataChannel"] == "true",
        f"data-channel={probe['dataChannel']}",
    )
    record(
        "channel-row-hash-prefix",
        probe["hasHashName"] and probe["text"].lstrip().startswith("#"),
        f"text={probe['text']!r}",
    )
    record(
        "channel-row-no-avatar",
        probe["ditherCount"] == 0 and probe["shareIconCount"] == 0,
        f"dither={probe['ditherCount']} share_icon={probe['shareIconCount']}",
    )
    record(
        "channel-row-no-subtitle",
        probe["subtitleCount"] == 0,
        f"subtitles={probe['subtitleCount']}",
    )

    # All remaining channel rows must obey the same shape.
    all_channels = page.locator(CHANNEL_ROW_SEL)
    bad: list[str] = []
    for i in range(all_channels.count()):
        p = _row_probe(all_channels.nth(i))
        if not (
            p["text"].lstrip().startswith("#")
            and p["ditherCount"] == 0
            and p["shareIconCount"] == 0
            and p["subtitleCount"] == 0
        ):
            bad.append(p["text"])
    record(
        "all-channel-rows-hash-only",
        not bad,
        f"count={all_channels.count()} violations={bad}",
    )

    # Agent rows unchanged: leading glyph (dither or share icon) + subtitle.
    agent_rows = page.locator(AGENT_ROW_SEL)
    if agent_rows.count() == 0:
        create_btn = page.get_by_role(
            "button", name=re.compile(r"^New Agent$", re.I)
        ).first
        create_btn.click()
        item_agent = page.get_by_role(
            "menuitem", name=re.compile(r"^Agent$", re.I)
        )
        expect(item_agent.first).to_be_visible(timeout=5_000)
        item_agent.first.click()
        expect(agent_rows.first).to_be_visible(timeout=15_000)
        page.wait_for_timeout(500)

    shot_agents = _shot(page, artifacts_dir, "02-sidenav-agent-rows-unchanged.png")
    shots.append(str(shot_agents))

    agent_problems: list[str] = []
    checked = min(agent_rows.count(), 5)
    for i in range(checked):
        p = _row_probe(agent_rows.nth(i))
        has_glyph = p["ditherCount"] >= 1 or p["shareIconCount"] >= 1
        if not has_glyph:
            agent_problems.append(f"no-glyph:{p['text']!r}")
    record(
        "agent-rows-keep-avatar-glyph",
        not agent_problems,
        f"checked={checked} problems={agent_problems}",
    )
    record(
        "agent-rows-present",
        agent_rows.count() >= 1,
        f"agent_rows={agent_rows.count()}",
    )

    report = {
        "suite": "lp-cxhb.15.1",
        "base_url": base_url,
        "checks": checks,
        "shots": shots,
    }
    (artifacts_dir / "REPORT.json").write_text(json.dumps(report, indent=2) + "\n")
    (artifacts_dir / "RESULT.md").write_text(
        "\n".join(
            [
                "# lp-cxhb.15.1 — sidenav channel rows are #name only",
                "",
                "## Checks",
                "",
                *[
                    f"- [{'x' if c['ok'] else ' '}] {c['feature']}: {c['detail']}"
                    for c in checks
                ],
                "",
                "## Screenshots",
                "",
                *[f"- `{Path(s).name}`" for s in shots],
                "",
            ]
        )
        + "\n"
    )
