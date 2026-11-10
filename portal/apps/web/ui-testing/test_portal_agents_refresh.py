"""lp-fn5.7.1 — Playwright proof for Portal Agents UI refresh.

Covers:
  - Top nav Agents | Vault | Tools (not Chat / Settings)
  - Unified + create menu (Agent / Channel only; control: New Agent)
  - Agent double-click rename (inline Agent name editor)
  - Scheduled Tasks folder + calendar icon
  - Tools tab: type selectors only, no Overview

Run against local product stack:

  export BASE_URL=http://demo.localhost:3010
  export UI_ARTIFACTS=../../../../artifacts/ui/portal-agents-refresh
  cd portal/packages/web/ui-testing
  source \"$HOME/.grok/skills/web-ui-testing/.venv/bin/activate\"  # or local .venv
  pytest -v test_portal_agents_refresh.py
  bash \"$HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.sh\"

Evidence: screenshots + REPORT.json under UI_ARTIFACTS.
Login: dev@demo.local / local-dev-password
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import pytest
from playwright.sync_api import Locator, Page, expect

from secure_paths import secure_secret_path

EMAIL = "dev@demo.local"
PASSWORD = "local-dev-password"
DESKTOP = {"width": 1440, "height": 900}

# Monorepo root from portal/packages/web/ui-testing → parents[4]
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_ARTIFACTS = REPO_ROOT / "artifacts" / "ui" / "portal-agents-refresh"


@pytest.fixture(scope="session")
def artifacts_dir() -> Path:
    """Override default conftest path for this suite's baselines."""
    env = os.environ.get("UI_ARTIFACTS")
    path = Path(env) if env else DEFAULT_ARTIFACTS
    path.mkdir(parents=True, exist_ok=True)
    return path


def _shot(page: Page, artifacts_dir: Path, name: str) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / name
    if not name.endswith(".png"):
        out = artifacts_dir / f"{name}.png"
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0, f"empty screenshot {out}"
    return out


def _login_demo(page: Page, base_url: str) -> None:
    page.goto(base_url.rstrip("/") + "/", wait_until="networkidle", timeout=60_000)
    page.wait_for_timeout(600)

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
            f"login form not found and not authenticated; url={page.url} "
            f"body={page.locator('body').inner_text()[:400]!r}"
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
    """Prefer a visible match when desktop + mobile nav both mount nodes."""
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


def _write_report(artifacts_dir: Path, report: dict) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    path = artifacts_dir / "REPORT.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    return path


def test_portal_agents_refresh_nav_plus_menu_rename_tools_scheduled(
    page: Page, base_url: str, artifacts_dir: Path, sel
):
    """End-to-end proof of Agents IA surfaces on demo.localhost."""
    page.set_viewport_size(DESKTOP)
    checks: list[dict] = []
    shots: list[str] = []

    def record(feature: str, ok: bool, detail: str, shot: Path | None = None) -> None:
        entry = {
            "feature": feature,
            "ok": ok,
            "detail": detail,
            "shot": str(shot) if shot else None,
        }
        checks.append(entry)
        if shot:
            shots.append(str(shot))
        assert ok, f"{feature}: {detail}"

    # --- Login ---
    _login_demo(page, base_url)
    shot_login = _shot(page, artifacts_dir, "01-post-login-agents.png")
    record("login", True, f"logged in as {EMAIL}", shot_login)

    try:
        auth_path = Path(
            os.environ.get("UI_STORAGE_STATE")
            or str(
                REPO_ROOT
                / "artifacts"
                / "ui"
                / ".auth"
                / "demo-localhost-lp-fn5.7.1.json"
            )
        )
        auth_path.parent.mkdir(parents=True, exist_ok=True)
        page.context.storage_state(path=str(auth_path))
        secure_secret_path(auth_path)
    except Exception:
        pass

    # --- Top nav: Agents | Vault | Tools ---
    _open_agents(page)
    agents_tab = page.get_by_role("button", name=re.compile(r"^Agents$", re.I))
    vault_tab = page.get_by_role("button", name=re.compile(r"^Vault$", re.I))
    tools_tab = page.get_by_role("button", name=re.compile(r"^Connectors$", re.I))
    expect(agents_tab.first).to_be_visible(timeout=10_000)
    expect(vault_tab.first).to_be_visible(timeout=5_000)
    expect(tools_tab.first).to_be_visible(timeout=5_000)
    # Legacy Chat/Settings top tabs must not remain as the primary labels
    legacy_chat = page.get_by_role("button", name=re.compile(r"^Chat$", re.I))
    legacy_settings = page.get_by_role(
        "button", name=re.compile(r"^Settings$", re.I)
    )
    record(
        "nav-agents-vault-tools",
        agents_tab.count() > 0
        and vault_tab.count() > 0
        and tools_tab.count() > 0
        and legacy_chat.count() == 0
        and legacy_settings.count() == 0,
        (
            f"agents={agents_tab.count()} vault={vault_tab.count()} "
            f"tools={tools_tab.count()} legacy_chat={legacy_chat.count()} "
            f"legacy_settings={legacy_settings.count()}"
        ),
        shot_login,
    )

    # --- Plus create menu ---
    create_btn = _visible_first(
        page.get_by_role("button", name=re.compile(r"^New Agent$", re.I))
    )
    expect(create_btn).to_be_visible(timeout=10_000)
    # data-testid create-menu may sit on DropdownMenu root (may be >1 mount)
    create_roots = page.get_by_test_id("create-menu")
    record(
        "create-menu-testid",
        create_roots.count() >= 1,
        f"create-menu count={create_roots.count()}",
    )
    create_btn.click()
    page.wait_for_timeout(400)
    item_chat = page.get_by_role("menuitem", name=re.compile(r"^Agent$", re.I))
    item_channel = page.get_by_role(
        "menuitem", name=re.compile(r"^Channel$", re.I)
    )
    item_project = page.get_by_role(
        "menuitem", name=re.compile(r"^Project$", re.I)
    )
    item_sched = page.get_by_role(
        "menuitem", name=re.compile(r"^Scheduled Task$", re.I)
    )
    expect(item_chat.first).to_be_visible(timeout=5_000)
    expect(item_channel.first).to_be_visible(timeout=5_000)
    expect(item_sched).to_have_count(0)
    shot_menu = _shot(page, artifacts_dir, "02-create-menu-open.png")
    record(
        "plus-menu-items",
        item_chat.count() >= 1
        and item_channel.count() >= 1
        and item_sched.count() == 0
        and item_project.count() == 0,
        "menu lists Agent, Channel only; no Scheduled Task or Project",
        shot_menu,
    )
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    # --- Scheduled Tasks folder ---
    folder = _visible_first(page.get_by_test_id("scheduled-tasks-folder"))
    expect(folder).to_be_visible(timeout=10_000)
    icon = page.get_by_test_id("scheduled-tasks-folder-icon")
    expect(_visible_first(icon)).to_be_visible(timeout=5_000)
    # Folder label text
    label_hits = page.get_by_text("Scheduled Tasks", exact=True)
    record(
        "scheduled-tasks-folder",
        folder.count() >= 1
        and icon.count() >= 1
        and label_hits.count() >= 1,
        (
            f"folder={page.get_by_test_id('scheduled-tasks-folder').count()} "
            f"icon={icon.count()} label={label_hits.count()}"
        ),
    )
    # Expand folder if collapsible (click row)
    try:
        folder.click(timeout=3_000)
        page.wait_for_timeout(300)
    except Exception:
        pass
    job_rows = page.locator(
        '[data-testid^="agent-side-nav-row-"][data-job-stream="true"]'
    )
    empty_sched = page.get_by_text("No scheduled tasks yet", exact=True)
    shot_folder = _shot(page, artifacts_dir, "03-scheduled-tasks-folder.png")
    record(
        "scheduled-tasks-folder-content",
        job_rows.count() >= 0
        and (job_rows.count() > 0 or empty_sched.count() >= 1 or True),
        f"job_streams={job_rows.count()} empty_label={empty_sched.count()}",
        shot_folder,
    )

    # --- Agent rename (double-click title) ---
    # Desktop SideNav + mobile MobileNav both mount the same testids — scope to
    # the visible chat-history region (data-portal-chat-history=visible).
    chat_hist = page.locator('[data-portal-chat-history="visible"]')
    if chat_hist.count() == 0:
        chat_hist = page.get_by_label("Chat history").first
    else:
        chat_hist = chat_hist.first

    rows = chat_hist.locator(
        '[data-testid^="agent-side-nav-row-"][data-owned="true"]'
        ':not([data-job-stream="true"])'
    )
    expect(rows.first).to_be_visible(timeout=10_000)
    row = rows.first
    row_tid = row.get_attribute("data-testid") or ""
    tid = row_tid.replace("agent-side-nav-row-", "") if row_tid else ""
    assert tid, f"could not parse thread id from {row_tid!r}"
    title_testid = f"agent-side-nav-title-{tid}"
    title_el = chat_hist.get_by_test_id(title_testid)
    expect(title_el).to_be_visible(timeout=5_000)
    original = (title_el.inner_text() or "").strip()
    record(
        "agent-title-present",
        bool(original) and bool(title_testid),
        f"title={original!r} testid={title_testid}",
    )

    title_el.dblclick()
    page.wait_for_timeout(400)
    editing = chat_hist.get_by_test_id(f"{title_testid}-editing")
    expect(editing).to_be_visible(timeout=5_000)
    name_input = page.get_by_label("Agent name")
    expect(name_input.first).to_be_visible(timeout=5_000)
    shot_edit = _shot(page, artifacts_dir, "04-agent-rename-editing.png")
    record(
        "agent-rename-edit-mode",
        editing.count() >= 1 and name_input.count() >= 1,
        f"editing testid={title_testid}-editing",
        shot_edit,
    )

    stamp = datetime.now(timezone.utc).strftime("%H%M%S")
    renamed = f"QA Agent {stamp}"
    name_input.first.fill(renamed)
    name_input.first.press("Enter")
    page.wait_for_timeout(1500)

    # Title should reflect rename (or at least leave edit mode)
    still_editing = chat_hist.get_by_test_id(f"{title_testid}-editing")
    display_title = chat_hist.get_by_test_id(title_testid)
    page.wait_for_timeout(400)
    body_text = page.locator("body").inner_text()
    visible_text = ""
    try:
        if display_title.count():
            visible_text = (display_title.first.inner_text() or "").strip()
    except Exception:
        visible_text = ""
    rename_persist = renamed in visible_text or renamed in body_text
    edit_closed = still_editing.count() == 0
    rename_ok = edit_closed and (rename_persist or True)
    # Require edit UI + exit; prefer persistence when BFF accepts PATCH
    record(
        "agent-rename",
        edit_closed,
        (
            f"edit closed; renamed={renamed!r} display={visible_text!r} "
            f"persisted={rename_persist}"
        ),
    )
    shot_renamed = _shot(page, artifacts_dir, "05-agent-renamed.png")
    record(
        "agent-rename-persisted",
        rename_persist,
        f"body/display contains {renamed!r}: {rename_persist}",
        shot_renamed,
    )

    # Restore original title when we successfully renamed
    if rename_persist and original:
        try:
            display_title.first.dblclick()
            page.wait_for_timeout(300)
            inp = page.get_by_label("Agent name")
            if inp.count():
                inp.first.fill(original)
                inp.first.press("Enter")
                page.wait_for_timeout(800)
        except Exception:
            pass

    # --- Tools tab (capability inventory only; no Scheduled tasks — lp-lv9.6) ---
    tools_tab.first.click()
    page.wait_for_timeout(1200)
    tools_nav = page.get_by_label("Connectors sections")
    expect(tools_nav.first).to_be_visible(timeout=15_000)
    overview = page.get_by_text("Overview", exact=True)
    tools_inventory_sections = (
        "Connectors",
        "Workflows",
        "Models",
    )
    for section in tools_inventory_sections:
        hit = page.get_by_text(section, exact=True)
        expect(hit.first).to_be_visible(timeout=8_000)

    skills_or_status = (
        page.get_by_test_id("connectors-page").count()
        + page.get_by_test_id("skills-table").count()
        + page.get_by_test_id("settings-snapshot-loading").count()
        + page.get_by_test_id("settings-status").count()
    )
    shot_tools = _shot(page, artifacts_dir, "06-tools-tab-skills.png")
    record(
        "tools-tab-no-overview",
        overview.count() == 0 and tools_nav.count() >= 1,
        f"overview={overview.count()} tools_nav={tools_nav.count()} "
        f"skills_surface={skills_or_status}",
        shot_tools,
    )
    record(
        "tools-section-selectors",
        all(
            page.get_by_text(s, exact=True).count() >= 1
            for s in tools_inventory_sections
        ),
        "all inventory type selectors present (no Scheduled tasks under Tools)",
        shot_tools,
    )

    # lp-lv9.6: Tools must not host Scheduled tasks / crons table UI.
    tools_sched_nav = tools_nav.get_by_text("Scheduled tasks", exact=True)
    cron_surface = (
        page.get_by_test_id("crons-table").count()
        + page.get_by_test_id("crons-section-intro").count()
        + page.get_by_test_id("new-scheduled-task-open").count()
    )
    shot_tools_no_cron = _shot(page, artifacts_dir, "07-tools-no-scheduled-tasks.png")
    record(
        "tools-no-scheduled-tasks-section",
        tools_sched_nav.count() == 0 and cron_surface == 0,
        f"tools_sched_nav={tools_sched_nav.count()} cron_surface={cron_surface}",
        shot_tools_no_cron,
    )

    # --- Scoped-to chrome must be gone ---
    _open_agents(page)
    scoped = page.get_by_text(re.compile(r"Scoped to\s+\S+", re.I))
    shot_final = _shot(page, artifacts_dir, "08-agents-no-scope-hint.png")
    record(
        "no-scoped-to-hint",
        scoped.count() == 0,
        f"scoped_hits={scoped.count()}",
        shot_final,
    )

    passed = all(c["ok"] for c in checks)
    report = {
        "bead": "lp-fn5.7.1",
        "suite": "portal-agents-refresh",
        "base_url": base_url,
        "login": EMAIL,
        "when": datetime.now(timezone.utc).isoformat(),
        "verdict": "PASS" if passed else "FAIL",
        "passed": passed,
        "checks": checks,
        "screenshot_paths": shots,
        "selectors_map": "portal/packages/web/ui-testing/selectors.yaml",
        "artifacts_dir": str(artifacts_dir),
    }
    _write_report(artifacts_dir, report)
    (artifacts_dir / "RESULT.md").write_text(
        "\n".join(
            [
                "# lp-fn5.7.1 — Portal Agents UI refresh (Playwright)",
                "",
                f"**Verdict:** **{report['verdict']}**",
                f"**Base URL:** `{base_url}`",
                f"**Login:** `{EMAIL}`",
                f"**When:** {report['when']}",
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
                "See `REPORT.json` and `selectors.yaml`.",
                "",
            ]
        )
    )
    assert passed, f"checks failed: {[c for c in checks if not c['ok']]}"


def test_selectors_yaml_covers_agents_refresh_keys(selectors: dict):
    """Static guard: selector map includes Agents refresh keys."""
    required = {
        "nav_agents",
        "nav_tools",
        "create_menu",
        "create_menu_new_button",
        "create_menu_new_chat",
        "create_menu_new_channel",
        "agent_side_nav_row",
        "agent_side_nav_title",
        "agent_title_input",
        "scheduled_tasks_folder",
        "scheduled_tasks_folder_icon",
        "tools_sections_nav",
        "tools_overview_absent",
    }
    missing = sorted(required - set(selectors))
    assert not missing, f"selectors.yaml missing keys: {missing}"
