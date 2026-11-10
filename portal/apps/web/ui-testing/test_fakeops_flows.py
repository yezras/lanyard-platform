"""lp-hdzm.30 — FakeOps Playwright flows 1–8 (0018 testing.md).

Clicks the real OpsConsole against an in-browser FakeOps store
(`?story=fakeops-admin`). Screenshots are evidence, not the pass.

Run (starts Vite unless FAKEOPS_BASE_URL is set):

  cd portal/apps/web/ui-testing
  source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
  pytest -v test_fakeops_flows.py
  bash "$HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.sh"
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from datetime import datetime, timezone
from pathlib import Path

import pytest
from playwright.sync_api import Locator, Page, expect

from conftest import resolve_locator
from screenshot_utils import stable_page_screenshot

REPO_ROOT = Path(__file__).resolve().parents[4]
WEB_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACTS = REPO_ROOT / "artifacts" / "ui" / "lp-0018"
KILL_BROWSERS = Path.home() / ".grok" / "skills" / "web-ui-testing" / "scripts" / "kill_browsers.sh"
DESKTOP = {"width": 1440, "height": 900}

INSTRUCTIONAL = (
    "Tenant admins never",
    "selecting a row opens",
    "Ops never finishes",
    "select a row to",
    "select a tenant to",
)

Sel = Callable[[str], Locator]


@pytest.fixture(scope="session")
def artifacts_dir() -> Path:
    env = os.environ.get("UI_ARTIFACTS")
    path = Path(env) if env else DEFAULT_ARTIFACTS
    path.mkdir(parents=True, exist_ok=True)
    return path


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_http(url: str, timeout_s: float = 90.0) -> None:
    deadline = time.time() + timeout_s
    last = "not started"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if 200 <= response.status < 500:
                    return
                last = f"status {response.status}"
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last = str(exc)
        time.sleep(0.25)
    raise RuntimeError(f"timed out waiting for {url}: {last}")


def _kill_browsers() -> None:
    if KILL_BROWSERS.is_file():
        subprocess.run(["bash", str(KILL_BROWSERS)], check=False)


@pytest.fixture(scope="session")
def fakeops_base_url(artifacts_dir: Path) -> Iterator[str]:
    preset = os.environ.get("FAKEOPS_BASE_URL")
    if preset:
        yield preset.rstrip("/")
        _kill_browsers()
        return

    port = _free_port()
    origin = f"http://127.0.0.1:{port}"
    log_path = artifacts_dir / "vite.log"
    log_file = log_path.open("w", encoding="utf-8")
    proc = subprocess.Popen(
        ["pnpm", "exec", "vite", "--port", str(port), "--host", "127.0.0.1"],
        cwd=str(WEB_ROOT),
        stdout=log_file,
        stderr=subprocess.STDOUT,
        env={**os.environ, "BFF_URL": "http://127.0.0.1:9"},
    )
    try:
        _wait_http(origin + "/")
        yield origin
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        log_file.close()
        _kill_browsers()


@pytest.fixture(scope="session")
def base_url(fakeops_base_url: str) -> str:
    return fakeops_base_url


def _shot(page: Page, artifacts_dir: Path, name: str) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / name
    if not name.endswith(".png"):
        out = artifacts_dir / f"{name}.png"
    return stable_page_screenshot(page, out, full_page=True)


def _sel(page: Page, selectors: dict) -> Sel:
    def lookup(key: str) -> Locator:
        if key not in selectors:
            raise KeyError(f"Unknown selector key {key!r}")
        return resolve_locator(page, selectors[key])

    return lookup


def _open_story(page: Page, base_url: str, story: str) -> None:
    page.set_viewport_size(DESKTOP)
    page.goto(
        f"{base_url.rstrip('/')}/?story={story}",
        wait_until="domcontentloaded",
        timeout=90_000,
    )
    expect(page.get_by_test_id("fakeops-proof-story")).to_be_visible(timeout=30_000)


def _assert_no_instructional(page: Page) -> None:
    body = page.locator("body").inner_text()
    lowered = body.lower()
    hits = [phrase for phrase in INSTRUCTIONAL if phrase.lower() in lowered]
    assert not hits, f"instructional copy visible: {hits}"


def _write_report(artifacts_dir: Path, report: dict) -> Path:
    path = artifacts_dir / "REPORT.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return path


def test_flows_1_to_7_superadmin(
    page: Page, base_url: str, artifacts_dir: Path, selectors: dict
) -> None:
    sel = _sel(page, selectors)
    _open_story(page, base_url, "fakeops-admin")
    expect(sel("admin_nav_tenants")).to_be_visible(timeout=20_000)
    expect(sel("admin_nav_registry")).to_be_visible()
    expect(sel("admin_nav_instances")).to_have_count(0)
    expect(sel("admin_nav_connectors")).to_have_count(0)
    expect(sel("admin_tenant_row_mocklab")).to_be_visible()
    expect(sel("admin_tenant_chip")).to_have_count(0)
    _assert_no_instructional(page)
    shot1 = _shot(page, artifacts_dir, "01-superadmin-tenants.png")

    sel("admin_tenant_row_mocklab").click()
    expect(sel("admin_nav_connectors")).to_be_visible(timeout=10_000)
    expect(sel("admin_tenant_chip")).to_be_visible()
    expect(sel("admin_tenant_chip")).to_contain_text("Mock Lab")
    expect(sel("ops_connector_onboard")).to_be_visible()
    sel("admin_nav_tenants").click()
    expect(sel("admin_tenant_row_mocklab")).to_be_visible(timeout=10_000)
    expect(sel("admin_tenant_chip")).to_have_count(0)
    expect(sel("admin_nav_instances")).to_have_count(0)

    sel("admin_tenant_row_mocklab").click()
    expect(sel("admin_nav_secrets")).to_be_visible(timeout=10_000)
    sel("admin_nav_secrets").click()
    expect(page.get_by_test_id("ops-secrets-page")).to_be_visible(timeout=10_000)
    expect(page.get_by_test_id("ops-secrets-tenant-select")).to_have_count(0)
    expect(page.get_by_label("Tenant", exact=True)).to_have_count(0)
    expect(sel("admin_tenant_chip")).to_contain_text("Mock Lab")
    expect(page.get_by_test_id("ops-secret-slot-XAI_API_KEY")).to_be_visible()

    sel("admin_nav_registry").click()
    expect(page.get_by_test_id("ops-registry-page")).to_be_visible(timeout=10_000)
    sel("ops_registry_search").get_by_role("textbox").fill("stripe.com")
    promote = page.get_by_test_id("ops-registry-promote-stripe.com")
    expect(promote).to_be_visible(timeout=10_000)
    promote.click()
    expect(page.get_by_test_id("ops-registry-row-stripe")).to_be_visible(timeout=10_000)
    expect(page.get_by_test_id("ops-registry-on-registry-stripe.com")).to_be_visible()

    sel("admin_nav_connectors").click()
    expect(sel("ops_connector_onboard")).to_be_visible(timeout=10_000)
    sel("ops_connector_onboard").click()
    picker = page.get_by_test_id("ops-connector-onboard-picker")
    expect(picker).to_be_visible()
    picker.get_by_placeholder("Search…").fill("stripe")
    picker.get_by_role("button", name="Onboard").click()
    stripe_row = page.get_by_test_id("ops-connector-row-stripe")
    expect(stripe_row).to_be_visible(timeout=10_000)
    expect(page.get_by_test_id("ops-connector-switch-stripe")).to_be_visible()
    sel("ops_connector_onboard").click()
    expect(page.get_by_test_id("ops-connector-onboard-picker")).to_have_count(0)
    shot2 = _shot(page, artifacts_dir, "02-mocklab-connectors.png")
    stripe_row.click()
    expect(page.get_by_test_id("ops-connector-detail-name")).to_contain_text("Stripe")
    expect(page.get_by_test_id("ops-surface-single")).to_be_visible()
    expect(page.get_by_test_id("ops-surface-group")).to_have_count(0)
    expect(page.get_by_test_id("ops-connector-grant-user-ada")).to_be_visible()
    shot3 = _shot(page, artifacts_dir, "03-connector-detail.png")

    sel("admin_nav_users").click()
    expect(sel("ops_add_user")).to_be_visible(timeout=10_000)
    sel("ops_add_user").click()
    dialog = page.get_by_test_id("ops-add-user-dialog")
    expect(dialog).to_be_visible()
    dialog.get_by_label("Name").fill("Mia Member")
    dialog.get_by_label("Email").fill("mia@mocklab.test")
    page.get_by_test_id("ops-add-user-submit").click()
    mia_row = page.get_by_test_id("ops-user-row-user-mia-mocklab-test")
    expect(mia_row).to_be_visible(timeout=10_000)
    mia_row.click()
    user_grant = page.get_by_test_id("ops-user-grant-stripe")
    expect(user_grant).to_be_visible(timeout=10_000)
    user_grant.get_by_role("switch").click()
    expect(user_grant.get_by_role("switch")).to_be_checked(timeout=10_000)

    sel("admin_nav_connectors").click()
    expect(page.get_by_test_id("ops-connector-row-stripe")).to_be_visible(timeout=10_000)
    page.get_by_test_id("ops-connector-row-stripe").click()
    connector_grant = page.get_by_test_id("ops-connector-grant-user-mia-mocklab-test")
    expect(connector_grant).to_be_visible(timeout=10_000)
    expect(connector_grant.get_by_role("switch")).to_be_checked()
    _assert_no_instructional(page)

    _write_report(
        artifacts_dir,
        {
            "bead": "lp-hdzm.30",
            "story": "fakeops-admin",
            "flows": ["1", "2", "3", "4", "5", "6", "7"],
            "shots": [shot1.name, shot2.name, shot3.name],
            "at": datetime.now(timezone.utc).isoformat(),
        },
    )


def test_flow_8_tenant_admin_no_registry_or_surface_editor(
    page: Page, base_url: str, selectors: dict
) -> None:
    sel = _sel(page, selectors)
    _open_story(page, base_url, "fakeops-admin-tenant")
    expect(sel("admin_nav_connectors")).to_be_visible(timeout=20_000)
    expect(sel("admin_nav_users")).to_be_visible()
    expect(sel("admin_nav_registry")).to_have_count(0)
    expect(sel("admin_nav_secrets")).to_have_count(0)
    expect(sel("admin_tenant_chip")).to_contain_text("Mock Lab")
    expect(page.get_by_test_id("ops-connector-row-stripe")).to_be_visible()
    page.get_by_test_id("ops-connector-row-stripe").click()
    expect(page.get_by_test_id("ops-connector-detail-name")).to_contain_text("Stripe")
    expect(page.get_by_test_id("ops-surface-group")).to_have_count(0)
    expect(page.get_by_test_id("ops-surface-mcp")).to_have_count(0)
    expect(page.get_by_test_id("ops-surface-single")).to_be_visible()
    _assert_no_instructional(page)

    _open_story(page, base_url, "fakeops-admin-unauth")
    expect(page.get_by_role("heading", name="Platform admin")).to_be_visible(
        timeout=15_000
    )
    expect(sel("admin_nav_registry")).to_have_count(0)
    expect(page.get_by_test_id("ops-surface-group")).to_have_count(0)
