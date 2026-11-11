"""lp-k5c4.15: @mention of a non-lead still must not wake the channel lead.

Live: Human @Drift in a two-member channel paints one persona bubble
(Drift). Lead Alpha stays silent. Unmentioned send is proven in BFF
wake-policy / group-inbound-stamp vitest.

Run against the product stack (UI QA; needs_ui_qa):

  export BASE_URL=http://127.0.0.1:3153/mocklab
  export UI_ARTIFACTS=<repo>/artifacts/ui/lp-k5c4.15
  cd portal/apps/web/ui-testing
  source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
  pytest -v test_lp_k5c4_15_mention_wake.py
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

from playwright.sync_api import Locator, Page, expect

from screenshot_utils import stable_page_screenshot

EMAIL = "dev@demo.local"
PASSWORD = "local-dev-password"
DESKTOP = {"width": 1440, "height": 900}
BEAD_ID = "lp-k5c4.15"

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_ARTIFACTS = REPO_ROOT / "artifacts" / "ui" / "lp-k5c4.15"


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
    if email.count() == 0:
        if agents.count() > 0 or page.get_by_test_id("create-menu").count() > 0:
            return
        raise AssertionError(
            f"login form not found and not authenticated; url={page.url}"
        )
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


def _visible_first(locator: Locator) -> Locator:
    count = locator.count()
    if count == 0:
        return locator
    for i in range(count):
        item = locator.nth(i)
        try:
            if item.is_visible():
                return item
        except Exception:
            continue
    return locator.first


def _nav_row(page: Page, name: str) -> Locator:
    return page.locator(
        '[data-testid^="agent-side-nav-row-"]:visible'
    ).filter(has_text=name)


def _open_new_channel_dialog(page: Page) -> None:
    create_btn = _visible_first(
        page.get_by_role("button", name=re.compile(r"^New Agent$", re.I))
    )
    expect(create_btn).to_be_visible(timeout=10_000)
    create_btn.click()
    item_channel = page.get_by_role("menuitem", name=re.compile(r"^Channel$", re.I))
    expect(item_channel.first).to_be_visible(timeout=5_000)
    item_channel.first.click()
    expect(page.get_by_text("New channel").first).to_be_visible(timeout=8_000)


def _channel_submit(page: Page) -> Locator:
    return page.get_by_role("button", name=re.compile(r"^Create channel$", re.I))


def _fill_channel_name(page: Page, name: str) -> None:
    field = page.get_by_role("textbox", name=re.compile(r"Channel name", re.I))
    expect(field.first).to_be_visible(timeout=5_000)
    field.first.fill(name)


def _add_inline_agent(page: Page, name: str) -> None:
    field = page.get_by_role("textbox", name=re.compile(r"New agent name", re.I))
    expect(field.first).to_be_visible(timeout=5_000)
    field.first.fill(name)
    add = page.get_by_role("button", name=re.compile(r"^Add agent$", re.I))
    expect(add.first).to_be_enabled(timeout=5_000)
    add.first.click()
    expect(page.get_by_text(name, exact=True).first).to_be_visible(timeout=10_000)


def _csrf(page: Page, base_url: str) -> str:
    res = page.request.get(base_url.rstrip("/") + "/api/auth/csrf")
    assert res.ok, f"csrf fetch failed: {res.status}"
    return str(res.json().get("csrf_token") or "")


def _persona_sends(events: list[object]) -> list[dict]:
    out: list[dict] = []
    for row in events:
        if not isinstance(row, dict):
            continue
        if row.get("type") != "message_send":
            continue
        speaker = row.get("speaker")
        if isinstance(speaker, dict) and speaker.get("kind") == "persona":
            out.append(row)
    return out


def test_at_drift_one_persona_bubble(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Human @Drift wakes Drift only; Alpha (lead) does not get a turn."""
    env_dir = os.environ.get("UI_ARTIFACTS")
    out_dir = Path(env_dir) if env_dir else DEFAULT_ARTIFACTS
    out_dir.mkdir(parents=True, exist_ok=True)

    page.set_viewport_size(DESKTOP)
    stamp = str(int(time.time()))
    channel_name = f"testchat{stamp}"
    lead_name = f"Alpha{stamp}"
    drift_name = f"Drift{stamp}"

    _login_demo(page, base_url)
    _open_agents(page)
    _open_new_channel_dialog(page)
    _fill_channel_name(page, channel_name)
    _add_inline_agent(page, lead_name)
    _add_inline_agent(page, drift_name)
    submit = _channel_submit(page)
    expect(submit.first).to_be_enabled(timeout=5_000)
    submit.first.click()
    expect(_nav_row(page, channel_name).first).to_be_visible(timeout=15_000)

    listed = page.request.get(base_url.rstrip("/") + "/api/channels")
    assert listed.ok, f"GET /api/channels status={listed.status}"
    body = listed.json() if listed.ok else {}
    channels = body.get("channels") if isinstance(body, dict) else None
    if not isinstance(channels, list):
        channels = []
    match = next(
        (
            row
            for row in channels
            if isinstance(row, dict) and row.get("name") == channel_name
        ),
        None,
    )
    assert match is not None, f"created channel not listed: {channels!r}"
    thread_id = match.get("thread_id")
    lead_id = match.get("lead_agent_id")
    members = match.get("members") if isinstance(match.get("members"), list) else []
    member_ids = [
        row.get("agent_id")
        for row in members
        if isinstance(row, dict) and row.get("agent_id")
    ]
    drift_id = next((mid for mid in member_ids if mid != lead_id), None)
    assert isinstance(thread_id, str) and thread_id
    assert isinstance(lead_id, str) and lead_id
    assert isinstance(drift_id, str) and drift_id
    assert lead_id != drift_id

    csrf_token = _csrf(page, base_url)
    posted = page.request.post(
        base_url.rstrip("/") + f"/api/chat/threads/{thread_id}/messages",
        data=json.dumps({"text": f"@{drift_name} whats up"}),
        headers={
            "content-type": "application/json",
            "x-csrf-token": csrf_token,
        },
    )
    assert posted.ok, f"POST messages failed: {posted.status} {posted.text()[:400]}"

    _nav_row(page, channel_name).first.click()
    page.wait_for_timeout(600)

    deadline = time.time() + 120
    persona_sends: list[dict] = []
    speaker_ids: list[str] = []
    while time.time() < deadline:
        hist = page.request.get(
            base_url.rstrip("/") + f"/api/chat/threads/{thread_id}/history"
        )
        events = hist.json().get("events") if hist.ok else None
        if not isinstance(events, list):
            events = []
        persona_sends = _persona_sends(events)
        speaker_ids = [
            str(row["speaker"].get("id"))
            for row in persona_sends
            if isinstance(row.get("speaker"), dict) and row["speaker"].get("id")
        ]
        if speaker_ids:
            break
        page.wait_for_timeout(2000)

    shot = _shot(page, out_dir, "61-channel-at-drift.png")
    drift_bubble = page.get_by_test_id(f"chat-speaker-persona-{drift_id}")
    lead_bubble = page.get_by_test_id(f"chat-speaker-persona-{lead_id}")
    if speaker_ids:
        expect(drift_bubble).to_be_visible(timeout=15_000)

    report = {
        "bead": BEAD_ID,
        "base_url": base_url,
        "channel_name": channel_name,
        "thread_id": thread_id,
        "lead_agent_id": lead_id,
        "drift_agent_id": drift_id,
        "persona_speaker_ids": speaker_ids,
        "screenshot": str(shot),
    }
    _write_report(out_dir, report)

    assert speaker_ids, (
        "no persona bubble after @Drift; stack did not complete a turn "
        f"within 120s (thread={thread_id})"
    )
    assert speaker_ids == [drift_id], (
        f"@Drift must wake Drift only; got speakers={speaker_ids} "
        f"lead={lead_id} drift={drift_id}"
    )
    expect(lead_bubble).to_have_count(0)
    expect(drift_bubble).to_have_count(1)
