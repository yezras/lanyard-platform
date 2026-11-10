"""lp-uxy.15.7: Live UI QA — sandbox cwd ACL honesty + Omnibox Mode A wrap.

Shipped feature: lp-uxy.6

Live demo.localhost proof (requires BFF + Lanyard Agent with Brain RPC):

  - Project scope hint chrome removed (lp-fn5.1.1); project chip remains
  - New project dialog uses working-directory language under vault root
  - UI does not claim hard jail / full OS isolation / Omnibox enabled
  - Omnibox Mode A product wrap contract residual is honest (HL wrap
    default-off; LA residual; monorepo negative path-escape + argv smokes)

Run:

  export BASE_URL=http://demo.localhost:3010
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-uxy-ship-qa/sandbox
  pytest -v test_lp_uxy_15_7_sandbox_cwd_acl_honesty.py

Evidence: screenshots + REPORT.json + RESULT.md + PASS_FAIL.md under UI_ARTIFACTS.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import Page, expect

from secure_paths import secure_secret_path

EMAIL = "dev@demo.local"
PASSWORD = "local-dev-password"
DESKTOP = {"width": 1440, "height": 900}

# Hard-jail / overclaim phrases that must NOT appear in Portal UX
FORBIDDEN_UX = (
    "hard jail",
    "fully isolated",
    "cannot escape",
    "secure sandbox",
    "os isolation",
    "omnibox enabled",
    "omnibox is on",
    "sandbox enforced",
    "completely sandboxed",
    "path jail",
)

WORKING_DIR_SUBTITLE = re.compile(
    r"Working directory under the agent vault root", re.I
)

REPO_ROOT = Path(__file__).resolve().parents[4]


def _shot(page: Page, artifacts_dir: Path, name: str) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / name
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0, f"empty screenshot {out}"
    return out


def _login_demo(page: Page, base_url: str) -> None:
    page.goto(base_url.rstrip("/") + "/", wait_until="networkidle", timeout=60_000)
    page.wait_for_timeout(800)

    nav_settings = page.get_by_role("button", name=re.compile(r"^Settings$", re.I))
    account = page.get_by_role("button", name=re.compile(r"Account menu|dev@demo", re.I))
    login_btn = page.get_by_role("button", name="Log in", exact=True)
    if (nav_settings.count() > 0 or account.count() > 0) and login_btn.count() == 0:
        return

    email = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
    if email.count() == 0:
        email = page.locator('input[type="email"], input[name="email"]')
    if email.count() == 0:
        if nav_settings.count() > 0 or page.get_by_text(
            re.compile(r"New chat|New project|^New Agent$|^New$|Account menu", re.I)
        ).count() > 0:
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
        page.get_by_role("button", name=re.compile(r"^Settings$", re.I)).first
    ).to_be_visible(timeout=20_000)


def _open_settings(page: Page) -> None:
    settings = page.get_by_role("button", name=re.compile(r"Settings", re.I))
    if settings.count() == 0:
        settings = page.get_by_text(re.compile(r"^Settings$", re.I))
    expect(settings.first).to_be_visible(timeout=15_000)
    settings.first.click()
    page.wait_for_timeout(1500)


def _forbidden_hits(text: str) -> list[str]:
    lower = text.lower()
    return [p for p in FORBIDDEN_UX if p in lower]


def _run_omnibox_smokes() -> dict:
    """Monorepo Mode A wrap contract + path-escape negative suite."""
    results: dict = {"path_escape": {}, "argv_self_test": {}, "hook_doc": {}}
    pe = REPO_ROOT / "deploy" / "scripts" / "omnibox" / "test-project-path-escape.py"
    argv = REPO_ROOT / "deploy" / "scripts" / "omnibox" / "build-shell-exec-argv.py"
    hook = REPO_ROOT / "deploy" / "references" / "omnibox-mode-a-hermes-hook.md"
    sec = REPO_ROOT / "docs" / "security" / "lp-uxy.6-agent-sandbox-path-acl-omnibox.md"

    if pe.is_file():
        proc = subprocess.run(
            ["python3", str(pe)],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=str(REPO_ROOT),
        )
        results["path_escape"] = {
            "ok": proc.returncode == 0,
            "returncode": proc.returncode,
            "stdout_tail": (proc.stdout or "")[-800:],
            "stderr_tail": (proc.stderr or "")[-400:],
        }
    else:
        results["path_escape"] = {"ok": False, "detail": f"missing {pe}"}

    if argv.is_file():
        proc = subprocess.run(
            ["python3", str(argv), "--self-test"],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=str(REPO_ROOT),
        )
        results["argv_self_test"] = {
            "ok": proc.returncode == 0,
            "returncode": proc.returncode,
            "stdout_tail": (proc.stdout or "")[-800:],
            "stderr_tail": (proc.stderr or "")[-400:],
        }
    else:
        results["argv_self_test"] = {"ok": False, "detail": f"missing {argv}"}

    hook_text = hook.read_text() if hook.is_file() else ""
    sec_text = sec.read_text() if sec.is_file() else ""
    residual_ok = (
        hook.is_file()
        and "default OFF" in hook_text
        and ("Lanyard Agent" in hook_text or "does **not** implement" in hook_text)
        and ("residual" in hook_text.lower() or "Residuals" in hook_text)
    )
    honesty_doc_ok = (
        sec.is_file()
        and "Not a hard jail" in sec_text
        and "Omnibox Mode A" in sec_text
        and "escapable" in sec_text.lower()
    )
    results["hook_doc"] = {
        "ok": residual_ok and honesty_doc_ok,
        "hook_path": str(hook),
        "security_doc": str(sec),
        "residual_ok": residual_ok,
        "honesty_doc_ok": honesty_doc_ok,
        "default_off_mentioned": "default OFF" in hook_text or "OMNIBOX_ENABLED=0" in hook_text,
        "la_residual_mentioned": "Lanyard Agent" in hook_text and (
            "not" in hook_text.lower() or "residual" in hook_text.lower()
        ),
        "hard_jail_denied_in_sec_doc": "Not a hard jail" in sec_text,
    }
    return results


def _write_report(artifacts_dir: Path, report: dict) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    path = artifacts_dir / "REPORT.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    return path


def _write_result_md(artifacts_dir: Path, report: dict) -> Path:
    checks = report.get("checks", [])
    lines = [
        "# lp-uxy.15.7 — sandbox cwd ACL honesty + Omnibox Mode A wrap",
        "",
        f"**Shipped feature:** {report.get('shipped_feature', 'lp-uxy.6')}",
        f"**Base URL:** `{report.get('base_url')}`",
        f"**Login:** `{EMAIL}`",
        f"**When:** {report.get('when')}",
        f"**Verdict:** **{report.get('verdict')}**",
        "",
        "## Acceptance",
        "",
        "Sandbox/cwd UX does not claim hard jail; Mode A product wrap visible/correct.",
        "",
    ]
    for c in checks:
        mark = "x" if c.get("ok") else " "
        lines.append(f"- [{mark}] {c.get('feature')}: {c.get('detail')}")

    omnibox = report.get("omnibox_smokes") or {}
    lines += [
        "",
        "## Omnibox Mode A (contract + residual)",
        "",
        f"- path-escape negative: ok={omnibox.get('path_escape', {}).get('ok')}",
        f"- argv self-test (wrap shape): ok={omnibox.get('argv_self_test', {}).get('ok')}",
        f"- hook residual doc: ok={omnibox.get('hook_doc', {}).get('ok')} "
        f"(default_off={omnibox.get('hook_doc', {}).get('default_off_mentioned')}, "
        f"la_residual={omnibox.get('hook_doc', {}).get('la_residual_mentioned')})",
        f"- security honesty doc (Not a hard jail): "
        f"{omnibox.get('hook_doc', {}).get('hard_jail_denied_in_sec_doc')}",
        "",
        "Live backend is **lanyard_agent** — Omnibox product wrap is HL-only; "
        "LA residual owner is LA product (documented). Deploy default is OFF.",
        "",
        "## Scope hint (UI)",
        "",
        f"- text: `{report.get('scope_hint')}`",
        f"- project: `{report.get('selected_project')}`",
        "",
        "## Screenshots",
        "",
    ]
    for s in report.get("screenshot_paths", []):
        lines.append(f"- `{Path(s).name}`")
    lines += [
        "",
        "## Fix bead",
        "",
        (
            f"Filed: **{report['fix_bead']}**"
            if report.get("fix_bead")
            else "None (all checks green)."
        ),
        "",
        "See `REPORT.json` for machine-readable results.",
        "",
    ]
    path = artifacts_dir / "RESULT.md"
    path.write_text("\n".join(lines))
    (artifacts_dir / "PASS_FAIL.md").write_text(
        "\n".join(
            [
                "# lp-uxy.15.7 — pass/fail",
                "",
                f"**Result: {report.get('verdict')}**",
                "",
                f"- Base: `{report.get('base_url')}`",
                f"- Shipped: lp-uxy.6",
                f"- Login: `{EMAIL}`",
                f"- brain_rpc_enabled: {report.get('brain_rpc_enabled')}",
                f"- backend kind: {report.get('backend_kind')}",
                f"- scope_hint: {report.get('scope_hint')}",
                f"- no_hard_jail_claims: {report.get('no_hard_jail_claims')}",
                f"- omnibox_path_escape: {omnibox.get('path_escape', {}).get('ok')}",
                f"- omnibox_argv_self_test: {omnibox.get('argv_self_test', {}).get('ok')}",
                f"- omnibox_residual_doc: {omnibox.get('hook_doc', {}).get('ok')}",
                "",
                (
                    "No fix bead."
                    if report.get("passed")
                    else f"Fix bead required: {report.get('fix_bead') or 'TBD'}"
                ),
                "",
            ]
        )
    )
    return path


def test_lp_uxy_15_7_sandbox_cwd_acl_honesty_and_omnibox_mode_a(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Live UI: soft cwd scope + no hard-jail claims; Mode A wrap residual honest."""
    page.set_viewport_size(DESKTOP)
    results: list[dict] = []
    shots: list[str] = []

    def record(feature: str, ok: bool, detail: str, shot: Path | None = None) -> None:
        entry = {
            "feature": feature,
            "ok": ok,
            "detail": detail,
            "shot": str(shot) if shot else None,
        }
        results.append(entry)
        if shot:
            shots.append(str(shot))

    _login_demo(page, base_url)
    shot_home = _shot(page, artifacts_dir, "01-post-login.png")
    record("login", True, f"logged in as {EMAIL}", shot_home)

    # Persist session for re-runs (gitignored under artifacts/ui/.auth/)
    try:
        auth_path = Path(os.environ.get("UI_STORAGE_STATE") or "")
        if not auth_path or not str(auth_path):
            auth_path = (
                Path(__file__).resolve().parents[4]
                / "artifacts"
                / "ui"
                / ".auth"
                / "demo-localhost-lp-uxy.15.7.json"
            )
        page.context.storage_state(path=str(auth_path))
        secure_secret_path(auth_path)
    except Exception:
        pass

    # --- API: context + projects ---
    ctx = page.evaluate(
        """async () => {
      const res = await fetch('/api/context', {credentials:'include'});
      return {status: res.status, body: await res.json()};
    }"""
    )
    ctx_body = ctx.get("body") or {}
    brain_rpc = bool(ctx_body.get("brain_rpc_enabled"))
    caps = ctx_body.get("backend_capabilities") or {}
    kind = caps.get("kind")
    features = caps.get("features") or {}
    ui_aff = caps.get("ui_affordances") or {}

    record(
        "brain-rpc-enabled",
        brain_rpc,
        f"brain_rpc_enabled={brain_rpc} kind={kind} profile={ctx_body.get('hermes_profile')}",
    )
    record(
        "backend-kind-lanyard-agent",
        kind == "lanyard_agent",
        f"kind={kind}",
    )

    projects_resp = page.evaluate(
        """async () => {
      const res = await fetch('/api/agent/projects', {credentials:'include'});
      const t = await res.text();
      let body = null;
      try { body = JSON.parse(t); } catch (e) { body = t; }
      return {status: res.status, body};
    }"""
    )
    pbody = projects_resp.get("body") or {}
    project_list = []
    if isinstance(pbody, dict):
        project_list = pbody.get("projects") or pbody.get("items") or []
    elif isinstance(pbody, list):
        project_list = pbody
    project_names = [
        (p.get("name") or p.get("project_name") or "")
        for p in project_list
        if isinstance(p, dict)
    ]
    record(
        "projects-list",
        projects_resp.get("status") == 200 and len(project_list) > 0,
        f"status={projects_resp.get('status')} count={len(project_list)} names={project_names[:8]}",
    )

    # Prefer a non-Workspace project if present
    pick = None
    for p in project_list:
        if not isinstance(p, dict):
            continue
        name = (p.get("name") or p.get("project_name") or "").strip()
        if name and name.lower() not in ("workspace", "no project"):
            pick = p
            break
    if pick is None and project_list:
        pick = project_list[0] if isinstance(project_list[0], dict) else None
    pick_name = (pick.get("name") or pick.get("project_name") or "").strip() if pick else ""
    pick_path = (
        pick.get("primary_path")
        or pick.get("vault_path")
        or pick.get("path")
        or ""
    ) if pick else ""

    # Select project via chip menu so project chip remains as the scope control
    if pick_name:
        # Click current project chip (or No project) then choose pick_name
        chip = page.get_by_role(
            "button",
            name=re.compile(rf"^(No project|{re.escape(pick_name)}|Clients|Workspace|demo)$", re.I),
        )
        # Prefer any button that looks like the project chip near model selector
        if chip.count() == 0:
            chip = page.get_by_role("button", name=re.compile(r"No project", re.I))
        # Try open menu from known chip label
        for label in [pick_name, "No project", "Clients", "Workspace", "demo"]:
            b = page.get_by_role("button", name=re.compile(rf"^{re.escape(label)}$", re.I))
            if b.count() > 0:
                b.first.click()
                page.wait_for_timeout(400)
                break
        menu_item = page.get_by_role("menuitem", name=re.compile(rf"^{re.escape(pick_name)}$", re.I))
        if menu_item.count() > 0:
            menu_item.first.click()
            page.wait_for_timeout(800)
        else:
            # Close menu if open
            page.keyboard.press("Escape")

    shot_scoped = _shot(page, artifacts_dir, "02-project-chip.png")
    # lp-cxhb.3: "Scoped to" hint and composer project chip are both gone.
    hint = page.get_by_test_id("project-scope-hint")
    hint_gone = hint.count() == 0
    chip = page.get_by_role("button", name=re.compile(r"^No project$", re.I))
    record(
        "project-scope-hint-and-chip-removed",
        hint_gone and chip.count() == 0,
        f"hint_count={hint.count()} no_project_chip={chip.count()} pick={pick_name!r} path={pick_path!r}",
        shot_scoped,
    )

    body_text = page.locator("body").inner_text()
    hits = _forbidden_hits(body_text)
    record(
        "no-hard-jail-claims-chat",
        len(hits) == 0,
        f"forbidden_hits={hits}",
        shot_scoped,
    )

    # lp-cxhb.3: Agents + menu has no Projects create path.
    create_btn = page.get_by_role("button", name=re.compile(r"^New Agent$", re.I))
    expect(create_btn.first).to_be_visible(timeout=10_000)
    create_btn.first.click()
    page.wait_for_timeout(400)
    item_project = page.get_by_role("menuitem", name=re.compile(r"^Project$", re.I))
    item_channel = page.get_by_role("menuitem", name=re.compile(r"^Channel$", re.I))
    shot_dialog = _shot(page, artifacts_dir, "03-create-menu-no-project.png")
    record(
        "no-projects-create-path",
        item_project.count() == 0 and item_channel.count() >= 1,
        f"project={item_project.count()} channel={item_channel.count()}",
        shot_dialog,
    )
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)

    # --- Settings: no hard-jail / no false Omnibox ON ---
    _open_settings(page)
    shot_settings = _shot(page, artifacts_dir, "04-settings-overview.png")
    settings_text = page.locator("body").inner_text()
    settings_hits = _forbidden_hits(settings_text)
    record(
        "no-hard-jail-claims-settings",
        len(settings_hits) == 0,
        f"forbidden_hits={settings_hits}",
        shot_settings,
    )

    # Capability honesty: project_picker supported; no false jail claims in caps
    project_picker = ui_aff.get("project_picker")
    caps_json = json.dumps(caps).lower()
    caps_no_false_jail = (
        "hard jail" not in caps_json
        and "fully isolated" not in caps_json
    )
    picker_ok = project_picker in ("supported", None)
    record(
        "capabilities-no-false-sandbox-jail",
        caps_no_false_jail and picker_ok,
        f"project_picker={project_picker} features.projects_list={features.get('projects_list')} "
        f"features.projects_create={features.get('projects_create')}",
    )

    # --- Omnibox Mode A wrap (monorepo contract + residual honesty) ---
    smokes = _run_omnibox_smokes()
    record(
        "omnibox-path-escape-negative",
        bool(smokes.get("path_escape", {}).get("ok")),
        f"returncode={smokes.get('path_escape', {}).get('returncode')} "
        f"tail={(smokes.get('path_escape', {}).get('stdout_tail') or '')[-200:]!r}",
    )
    record(
        "omnibox-argv-self-test-mode-a-wrap",
        bool(smokes.get("argv_self_test", {}).get("ok")),
        f"returncode={smokes.get('argv_self_test', {}).get('returncode')} "
        f"(shell_exec wrap shape when OMNIBOX_ENABLED=1; disabled=passthrough)",
    )
    record(
        "omnibox-mode-a-residual-honesty-docs",
        bool(smokes.get("hook_doc", {}).get("ok")),
        f"default_off={smokes.get('hook_doc', {}).get('default_off_mentioned')} "
        f"la_residual={smokes.get('hook_doc', {}).get('la_residual_mentioned')} "
        f"not_hard_jail={smokes.get('hook_doc', {}).get('hard_jail_denied_in_sec_doc')}",
    )
    # Live stack is LA: wrap not applicable; residual must be documented (checked above)
    record(
        "live-backend-la-omnibox-residual-acknowledged",
        kind == "lanyard_agent" and bool(smokes.get("hook_doc", {}).get("la_residual_mentioned")),
        f"kind={kind}; LA has no Omnibox argv rewrite (lp-uxy.6 residual)",
    )

    # Back to chat for final scoped screenshot
    chat_tab = page.get_by_role("button", name=re.compile(r"^Chat$", re.I))
    if chat_tab.count() > 0:
        chat_tab.first.click()
        page.wait_for_timeout(600)
    shot_final = _shot(page, artifacts_dir, "05-chat-scoped-final.png")
    final_hint_count = page.get_by_test_id("project-scope-hint").count()
    final_chip_ok = True
    if pick_name:
        final_chip_ok = (
            page.get_by_role(
                "button", name=re.compile(rf"^{re.escape(pick_name)}$", re.I)
            ).count()
            > 0
        )
    record(
        "final-project-chip-stable-no-scope-hint",
        final_hint_count == 0 and final_chip_ok,
        f"hint_count={final_hint_count} pick={pick_name!r} chip_ok={final_chip_ok}",
        shot_final,
    )

    all_ok = all(r["ok"] for r in results)
    fix_bead = None
    if not all_ok:
        failed = [r["feature"] for r in results if not r["ok"]]
        # File fix bead only on fail — done after report write by implementer step
        fix_bead = None
        _ = failed

    report = {
        "bead_id": "lp-uxy.15.7",
        "shipped_feature": "lp-uxy.6",
        "base_url": base_url,
        "when": datetime.now(timezone.utc).isoformat(),
        "passed": all_ok,
        "verdict": "PASS" if all_ok else "FAIL",
        "brain_rpc_enabled": brain_rpc,
        "backend_kind": kind,
        "hermes_profile": ctx_body.get("hermes_profile"),
        "selected_project": {
            "name": pick_name,
            "path": pick_path,
        },
        "scope_hint": None,  # removed lp-fn5.1.1; project chip is scope control
        "project_scope_hint_removed": True,
        "no_hard_jail_claims": all(

            r["ok"]
            for r in results
            if r["feature"].startswith("no-hard-jail")
        ),
        "omnibox_smokes": smokes,
        "checks": results,
        "screenshot_paths": shots,
        "fix_bead": fix_bead,
        "ui_affordances": ui_aff,
        "features": features,
    }
    _write_report(artifacts_dir, report)
    _write_result_md(artifacts_dir, report)

    failed = [r for r in results if not r["ok"]]
    assert all_ok, (
        "lp-uxy.15.7 FAIL: "
        + ", ".join(f"{r['feature']} ({r['detail']})" for r in failed)
    )
