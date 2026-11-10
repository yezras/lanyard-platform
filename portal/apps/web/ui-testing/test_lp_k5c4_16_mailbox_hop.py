"""lp-k5c4.16 — Playwright: Cipher notice + Drift 1:1 inbound.

Origin 1:1 shows Messaged @X chrome (not a fake assistant bubble).
Target 1:1 has inbound. Mention-hop does not double-wake.

Run against local product stack (UI QA):

  export BASE_URL=http://127.0.0.1:3153/mocklab
  export CIPHER_NAME=Cipher
  export DRIFT_NAME=Drift
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-k5c4.16
  cd portal/apps/web/ui-testing
  pytest -v test_lp_k5c4_16_mailbox_hop.py
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect

from screenshot_utils import stable_page_screenshot

EMAIL = "dev@demo.local"
PASSWORD = "local-dev-password"
DESKTOP = {"width": 1440, "height": 900}

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_ARTIFACTS = REPO_ROOT / "artifacts" / "ui" / "lp-k5c4.16"

CIPHER_NAME = os.environ.get("CIPHER_NAME", "Cipher")
DRIFT_NAME = os.environ.get("DRIFT_NAME", "Drift")


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


def _login(page: Page, base_url: str) -> None:
    page.goto(base_url.rstrip("/") + "/", wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_timeout(800)
    login_btn = page.get_by_role("button", name="Log in", exact=True)
    if login_btn.count() == 0:
        return
    email = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
    if email.count() == 0:
        email = page.locator('input[type="email"], input[name="email"]')
    if email.count() == 0:
        return
    email.first.fill(EMAIL)
    page.locator('input[type="password"]').first.fill(PASSWORD)
    login_btn.click()
    page.wait_for_timeout(2500)


def _open_named_row(page: Page, name: str) -> None:
    row = page.locator('[data-testid^="agent-side-nav-row-"]:visible').filter(
        has_text=re.compile(rf"^{re.escape(name)}$|^{re.escape(name)}\b", re.I)
    )
    expect(row.first).to_be_visible(timeout=20_000)
    row.first.click()
    page.wait_for_timeout(600)


def _composer(page: Page):
    box = page.get_by_role("textbox").last
    expect(box).to_be_visible(timeout=15_000)
    return box


def test_cipher_at_drift_notice_and_drift_inbound(
    page: Page, base_url: str, artifacts_dir: Path
) -> None:
    page.set_viewport_size(DESKTOP)
    _login(page, base_url)

    agents = page.get_by_role("button", name=re.compile(r"^Agents$", re.I))
    if agents.count() > 0:
        agents.first.click()
        page.wait_for_timeout(400)

    _open_named_row(page, CIPHER_NAME)
    box = _composer(page)
    box.fill(f"@{DRIFT_NAME} hi")
    box.press("Enter")
    page.wait_for_timeout(2500)

    notice = page.get_by_test_id("mailbox-hop-notice")
    expect(notice).to_be_visible(timeout=20_000)
    expect(notice).to_contain_text(f"Messaged @{DRIFT_NAME}")
    expect(page.get_by_test_id("system-notice")).to_have_attribute(
        "data-mailbox-hop", "true"
    )
    expect(page.get_by_text(re.compile(r"I tagged", re.I))).to_have_count(0)
    _shot(page, artifacts_dir, "cipher-messaged-drift.png")

    _open_named_row(page, DRIFT_NAME)
    page.wait_for_timeout(1500)
    timeline = page.locator("body")
    expect(timeline).not_to_contain_text("I tagged")
    assistant = page.locator(
        '[class*="astryx-chat-message-bubble"], [data-testid="system-notice"]'
    )
    expect(assistant.first).to_be_visible(timeout=20_000)
    _shot(page, artifacts_dir, "drift-1to1-inbound.png")
