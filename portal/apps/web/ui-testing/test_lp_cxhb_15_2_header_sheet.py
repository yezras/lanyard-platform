"""lp-cxhb.15.2 — Playwright gate for channel header members+purposes sheet.

Covers:
  - No lead selector or member roster rendered in the channel chat chrome.
  - Clicking the channel name in the header opens a sheet listing members
    and purposes (lead badged).
  - 1:1 chat header is unchanged: no title-button affordance added there.

Run against local product stack (this worktree holds port 3011):

  pnpm -C portal/apps/web exec vite --port 3011   # BFF_URL=http://127.0.0.1:4100
  export BASE_URL=http://127.0.0.1:3011
  export UI_ARTIFACTS=<repo>/artifacts/ui/lp-cxhb.15.2
  cd portal/apps/web/ui-testing
  pytest -v test_lp_cxhb_15_2_header_sheet.py
"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from urllib.parse import urlparse

import pytest
from playwright.sync_api import Locator, Page, expect

from screenshot_utils import stable_page_screenshot

EMAIL = "dev@demo.local"
PASSWORD = "local-dev-password"
DESKTOP = {"width": 1440, "height": 900}

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_ARTIFACTS = REPO_ROOT / "artifacts" / "ui" / "lp-cxhb.15.2"


@pytest.fixture(scope="session")
def artifacts_dir() -> Path:
    env = os.environ.get("UI_ARTIFACTS")
    path = Path(env) if env else DEFAULT_ARTIFACTS
    path.mkdir(parents=True, exist_ok=True)
    return path


def _shot(page: Page, artifacts_dir: Path, name: str) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / name
    if not name.endswith(".png"):
        out = artifacts_dir / f"{name}.png"
    return stable_page_screenshot(page, out, full_page=True)


def _login_demo(page: Page, base_url: str) -> None:
    page.goto(
        base_url.rstrip("/") + "/",
        wait_until="domcontentloaded",
        timeout=60_000,
    )
    page.wait_for_timeout(800)
    page.get_by_role(
        "button",
        name=re.compile(r"^Agents$|^Log in$", re.I),
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


def _add_inline_agent(page: Page, name: str) -> None:
    field = page.get_by_role("textbox", name=re.compile(r"New agent name", re.I))
    expect(field.first).to_be_visible(timeout=5_000)
    field.first.fill(name)
    add = page.get_by_role("button", name=re.compile(r"^Add agent$", re.I))
    expect(add.first).to_be_enabled(timeout=5_000)
    add.first.click()
    expect(page.get_by_text(name, exact=True).first).to_be_visible(timeout=10_000)


def _create_channel(page: Page, name: str) -> str:
    """Create a channel via the + menu; returns its thread_id."""
    created_thread_ids: list[str] = []

    def on_channel_response(response) -> None:
        try:
            path = urlparse(response.url).path.rstrip("/")
        except Exception:
            return
        if response.request.method == "POST" and path == "/api/channels":
            try:
                body = response.json()
                if isinstance(body, dict) and body.get("thread_id"):
                    created_thread_ids.append(str(body["thread_id"]))
            except Exception:
                pass

    page.on("response", on_channel_response)
    create_btn = page.get_by_role(
        "button", name=re.compile(r"^New Agent$", re.I)
    )
    expect(create_btn.first).to_be_visible(timeout=10_000)
    create_btn.first.click()
    item_channel = page.get_by_role("menuitem", name=re.compile(r"^Channel$", re.I))
    expect(item_channel.first).to_be_visible(timeout=5_000)
    item_channel.first.click()
    expect(page.get_by_text("New channel").first).to_be_visible(timeout=8_000)

    field = page.get_by_role("textbox", name=re.compile(r"Channel name", re.I))
    expect(field.first).to_be_visible(timeout=5_000)
    field.first.fill(name)

    picks = page.locator('[data-testid^="channel-member-pick-"]')
    if picks.count() < 2:
        _add_inline_agent(page, f"QA Sheet A {int(time.time())}")
        _add_inline_agent(page, f"QA Sheet B {int(time.time())}")
    picks = page.locator('[data-testid^="channel-member-pick-"]')
    picks.nth(0).click()
    picks.nth(1).click()

    submit = page.get_by_role("button", name=re.compile(r"^Create channel$", re.I))
    expect(submit.first).to_be_enabled(timeout=5_000)
    submit.first.click()
    # lp-cxhb.15.1 merged: channel sidenav rows render as "#name".
    expect(page.get_by_text(f"#{name}", exact=True).first).to_be_visible(
        timeout=15_000
    )

    deadline = time.time() + 10
    while not created_thread_ids and time.time() < deadline:
        page.wait_for_timeout(200)
    page.remove_listener("response", on_channel_response)
    assert created_thread_ids, "channel create did not return a thread_id"

    # Explicitly open the channel chat (auto-select can race).
    row = page.get_by_test_id(
        f"agent-side-nav-row-{created_thread_ids[-1]}"
    ).first
    expect(row).to_be_visible(timeout=10_000)
    row.click()
    page.wait_for_timeout(600)
    return created_thread_ids[-1]


def _header_title_button(page: Page) -> Locator:
    return page.locator('[data-testid^="agent-chat-header-title-button-"]').first


def test_channel_members_purposes_behind_title_click(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Channel chrome has no roster/lead; title click opens the sheet."""
    page.set_viewport_size(DESKTOP)
    stamp = str(int(time.time()))
    channel_name = f"QA Sheet {stamp}"

    _login_demo(page, base_url)
    _open_agents(page)
    _create_channel(page, channel_name)
    page.wait_for_timeout(500)

    # Channel chat is open after create; wait for its header.
    title_button = _header_title_button(page)
    expect(title_button).to_be_visible(timeout=10_000)

    # Acceptance A: no lead selector or roster in the chat chrome.
    roster_in_chrome = page.locator('[data-testid^="channel-sheet-member-"]')
    assert roster_in_chrome.count() == 0, (
        f"member roster leaked into chat chrome ({roster_in_chrome.count()} rows)"
    )
    shot_before = _shot(page, artifacts_dir, "01-channel-chrome-before-click.png")

    # Acceptance B: title click opens the members + purposes sheet.
    expect(title_button).to_have_attribute("aria-haspopup", "dialog")
    expect(title_button).to_have_attribute("aria-expanded", "false")
    title_button.click()
    dialog = page.locator("dialog[open]").first
    expect(dialog).to_be_visible(timeout=5_000)
    expect(page.get_by_text("Members and purposes").first).to_be_visible(
        timeout=5_000
    )

    member_rows = page.locator('[data-testid^="channel-sheet-member-"]')
    expect(member_rows.first).to_be_visible(timeout=10_000)
    assert member_rows.count() >= 2, (
        f"expected >=2 member rows in sheet, got {member_rows.count()}"
    )
    lead_badge = page.get_by_text(re.compile(r"· Lead")).first
    expect(lead_badge).to_be_visible(timeout=5_000)
    shot_after = _shot(page, artifacts_dir, "02-channel-sheet-after-click.png")

    # Close restores chrome without any visible roster.
    # Note: Astryx Dialog keeps children mounted when closed (dialog[open] off).
    close_btn = page.locator('[data-testid^="channel-sheet-close-"]').first
    close_btn.click()
    expect(dialog).not_to_be_visible(timeout=5_000)
    visible_rows = [
        row
        for row in page.locator('[data-testid^="channel-sheet-member-"]').all()
        if row.is_visible()
    ]
    assert not visible_rows, "member roster still visible after close"

    # Acceptance C: 1:1 ghost UI unchanged — mint a fresh 1:1 via the + menu
    # and open it. Channel rows share the agent-side-nav-row testid, so we
    # target the new agent's row explicitly.
    agent_thread_posts: list[str] = []

    def on_agent_response(response) -> None:
        try:
            path = urlparse(response.url).path.rstrip("/")
        except Exception:
            return
        if response.request.method == "POST" and path == "/api/agents":
            try:
                body = response.json()
                if isinstance(body, dict) and body.get("thread_id"):
                    agent_thread_posts.append(str(body["thread_id"]))
            except Exception:
                pass

    page.on("response", on_agent_response)
    create_btn = page.get_by_role(
        "button", name=re.compile(r"^New Agent$", re.I)
    )
    expect(create_btn.first).to_be_visible(timeout=10_000)
    create_btn.first.click()
    item_agent = page.get_by_role("menuitem", name=re.compile(r"^Agent$", re.I))
    expect(item_agent.first).to_be_visible(timeout=5_000)
    item_agent.first.click()

    deadline = time.time() + 15
    while not agent_thread_posts and time.time() < deadline:
        page.wait_for_timeout(200)
    assert agent_thread_posts, "minting a 1:1 agent did not return a thread_id"
    one_to_one_row = page.get_by_test_id(
        f"agent-side-nav-row-{agent_thread_posts[-1]}"
    ).first
    expect(one_to_one_row).to_be_visible(timeout=10_000)
    one_to_one_row.click()
    page.wait_for_timeout(600)
    one_to_one_header = page.locator(
        '[data-testid^="agent-chat-header-title-wrap-"]'
    ).first
    expect(one_to_one_header).to_be_visible(timeout=10_000)
    assert _header_title_button(page).count() == 0, (
        "1:1 header must not gain a title-button affordance"
    )
    _shot(page, artifacts_dir, "03-one-to-one-header-unchanged.png")

    assert shot_before.is_file() and shot_after.is_file()
