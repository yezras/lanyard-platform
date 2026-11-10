"""lp-swt epoch: visual QA for vault project create, Office-only open, skill modal.

Run against live portal (demo tenant):

  BASE_URL=http://demo.localhost:3010 \\
  UI_ARTIFACTS=../../../../artifacts/ui/lp-swt \\
  pytest -v test_lp_swt_ux_wave.py
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect

DESKTOP = {"width": 1440, "height": 900}
EMAIL = "dev@demo.local"
PASSWORD = "local-dev-password"


def _shot(page: Page, artifacts_dir: Path, name: str) -> Path:
    out = artifacts_dir / name
    out.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0
    return out


def _login_demo(page: Page, base_url: str) -> None:
    page.goto(base_url.rstrip("/") + "/", wait_until="networkidle", timeout=60_000)
    if page.get_by_text(re.compile(r"Settings|Clients|Chat", re.I)).count() > 0:
        if page.get_by_role("button", name=re.compile(r"Log in|Sign in", re.I)).count() == 0:
            return
    email = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
    if email.count() == 0:
        email = page.locator('input[type="email"], input[name="email"]').first
    email.fill(EMAIL)
    page.locator('input[type="password"]').first.fill(PASSWORD)
    # Exact "Log in" — avoid matching "Sign in with Google"
    page.get_by_role("button", name="Log in", exact=True).click()
    page.wait_for_timeout(2500)


def test_swt1_new_project_cwd_under_vault_root(
    page: Page, base_url: str, artifacts_dir: Path
):
    """lp-swt.1 / lp-75r.5: New project cwd is vault-root-relative (not ~/…, not forced /Projects)."""
    pytest.skip(
        "lp-cxhb.3 removed Projects from the Agents + menu; Directory create is out of this bead"
    )
    page.set_viewport_size(DESKTOP)
    _login_demo(page, base_url)

    for label in ("Clients", "Chat", "Directory"):
        btn = page.get_by_role("button", name=re.compile(label, re.I))
        if btn.count():
            try:
                btn.first.click(timeout=2000)
                page.wait_for_timeout(400)
            except Exception:
                pass

    # lp-fn5.2.1 / lp-7st.2: open Project from unified + create menu
    create_btn = page.get_by_role("button", name=re.compile(r"^New Agent$", re.I))
    if create_btn.count() > 0:
        expect(create_btn.first).to_be_visible(timeout=15_000)
        create_btn.first.click()
        page.get_by_role("menuitem", name=re.compile(r"^Project$", re.I)).first.click()
    else:
        new_proj = page.get_by_role("button", name=re.compile(r"New project", re.I))
        if new_proj.count() == 0:
            new_proj = page.get_by_text(re.compile(r"New project", re.I))
        expect(new_proj.first).to_be_visible(timeout=15_000)
        new_proj.first.click()
    page.wait_for_timeout(500)

    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible(timeout=10_000)

    name = dialog.get_by_label(re.compile(r"Name", re.I))
    expect(name).to_be_visible()
    name.fill("SwtQaVault")
    page.wait_for_timeout(300)

    path = dialog.get_by_label(re.compile(r"Working directory", re.I))
    expect(path).to_be_visible()
    val = path.input_value()
    # Vault-root-relative under agent WD (e.g. /SwtQaVault), not home-relative.
    assert val.startswith("/"), f"expected vault-relative path got {val!r}"
    assert not val.startswith("~/"), f"home-relative path not allowed: {val!r}"
    # Product rejects a forced generic /Projects namespace as the default create location.
    assert not val.startswith("/Projects/"), (
        f"must not force /Projects/… as default create path, got {val!r}"
    )
    assert "SwtQaVault" in val or "swt-qa-vault" in val.lower()
    # With no parent selected, default is /<Name> under the vault root.
    assert val == "/SwtQaVault" or val.endswith("/SwtQaVault") or val.endswith(
        "/swt-qa-vault"
    )

    _shot(page, artifacts_dir, "swt1-new-project-dialog.png")
    cancel = dialog.get_by_role("button", name=re.compile(r"Cancel", re.I))
    if cancel.count():
        cancel.click()


def test_swt3_skill_detail_centered_markdown_only(
    page: Page, base_url: str, artifacts_dir: Path
):
    """lp-swt.3: skill detail is centered; no path/enabled/Instructions chrome."""
    page.set_viewport_size(DESKTOP)
    _login_demo(page, base_url)

    settings = page.get_by_role("button", name=re.compile(r"Settings", re.I))
    if settings.count() == 0:
        settings = page.get_by_text(re.compile(r"^Settings$", re.I))
    expect(settings.first).to_be_visible(timeout=15_000)
    settings.first.click()
    page.wait_for_timeout(1500)

    skills_tab = page.get_by_role("button", name=re.compile(r"^Skills$", re.I))
    if skills_tab.count() == 0:
        skills_tab = page.get_by_text(re.compile(r"^Skills$", re.I))
    if skills_tab.count():
        skills_tab.first.click()
        page.wait_for_timeout(600)

    open_btn = page.locator("[data-testid^='settings-skill-open-']").first
    if open_btn.count() == 0:
        # fallback: click first skills table row
        table = page.get_by_test_id("skills-table")
        expect(table).to_be_visible(timeout=10_000)
        row = table.locator("button, [role='button'], tr").first
        row.click()
    else:
        open_btn.click()
    page.wait_for_timeout(1000)

    drawer = page.get_by_test_id("settings-detail-drawer")
    expect(drawer).to_be_visible(timeout=10_000)

    skill = page.get_by_test_id("settings-detail-skill")
    expect(skill).to_be_visible(timeout=10_000)
    skill_text = skill.inner_text()
    assert "Instructions" not in skill_text
    # Enabled badge / path chrome should not appear inside skill body
    assert not re.search(r"^Enabled$", skill_text, re.M)
    assert not re.search(r"^Path$", skill_text, re.M)
    # path-looking chrome like "/skills/" as a labeled field is gone
    assert "Enabled" not in skill.locator("..").inner_text() or "Enabled" not in skill_text

    box = drawer.bounding_box()
    assert box is not None
    # Centered: dialog left edge should not be docked to far-right (top-right drawer)
    # At 1440 viewport, centered 480-wide dialog left ~ (1440-480)/2 ≈ 480; docked was right-16
    assert box["x"] < 900, f"dialog looks top-right docked: x={box['x']}"

    _shot(page, artifacts_dir, "swt3-skill-detail-centered.png")


def test_swt2_office_no_edit_chrome_when_open(
    page: Page, base_url: str, artifacts_dir: Path
):
    """lp-swt.2: when an Office doc is open, no Edit / Back to preview / Editing in Office.

    Best-effort: opens Vault if present and tries first office-looking entry.
    Environment may lack sample Office files — records residual honestly.
    """
    page.set_viewport_size(DESKTOP)
    _login_demo(page, base_url)

    # Prefer Vault nav
    vault = page.get_by_role("button", name=re.compile(r"^Vault$", re.I))
    if vault.count() == 0:
        vault = page.get_by_text(re.compile(r"^Vault$", re.I))
    if vault.count():
        vault.first.click()
        page.wait_for_timeout(1500)

    # Click any tree/list item that looks like Office
    office_re = re.compile(r"\.(docx|xlsx|pptx|doc|xls|ppt)$", re.I)
    candidates = page.locator("button, [role='treeitem'], a, [data-path]")
    opened = False
    for i in range(min(candidates.count(), 80)):
        el = candidates.nth(i)
        try:
            label = el.inner_text(timeout=500)
        except Exception:
            continue
        if office_re.search(label or ""):
            try:
                el.click(timeout=2000)
                page.wait_for_timeout(2000)
                opened = True
                break
            except Exception:
                continue

    host = page.get_by_test_id("vault-document-host")
    pane = page.get_by_test_id("chat-document-pane")
    if host.count() == 0 and pane.count() == 0 and not opened:
        # Residual: no Office file in demo vault for live open
        _shot(page, artifacts_dir, "swt2-office-skip-no-sample.png")
        pytest_skip = True
    else:
        pytest_skip = False

    if pytest_skip:
        import pytest

        pytest.skip("No Office sample file available in live demo vault")

    page.wait_for_timeout(1500)
    body = page.inner_text("body")
    assert "Editing in Office" not in body
    # Edit affordance chrome for dual-mode
    edit_btn = page.get_by_test_id("vault-edit-button")
    exit_btn = page.get_by_test_id("vault-exit-edit")
    chat_edit = page.get_by_test_id("chat-document-pane-edit")
    chat_exit = page.get_by_test_id("chat-document-pane-exit-edit")
    assert edit_btn.count() == 0, "vault Edit button should be gone"
    assert exit_btn.count() == 0, "vault Back to preview should be gone"
    assert chat_edit.count() == 0
    assert chat_exit.count() == 0

    _shot(page, artifacts_dir, "swt2-office-open.png")
