"""lp-uxy.15.6: Live UI QA — project delete soft-archive honesty (shipped lp-uxy.5).

Shipped feature: lp-uxy.5

Live demo.localhost proof (requires BFF + Lanyard Agent with Brain RPC):

  Directory → Project actions → Delete shows honest soft-archive confirm
  (registry unlist only; workspace/vault files stay on agent disk).
  DELETE /api/agent/projects/:id returns {id, archived:true}; marker file
  remains on disk after archive.

Run:

  export BASE_URL=http://demo.localhost:3010
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-uxy-ship-qa/soft-archive
  pytest -v test_lp_uxy_15_6_soft_archive.py

Evidence: screenshots + REPORT.json + RESULT.md under UI_ARTIFACTS.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect

from secure_paths import secure_secret_path

EMAIL = "dev@demo.local"
PASSWORD = "local-dev-password"
DESKTOP = {"width": 1440, "height": 900}

# Disposable project under LA vault_root (/home/operator/Lanyard)
QA_PROJECT_NAME = "SoftArchiveQA"
QA_FOLDER = "/home/operator/Lanyard/lp-uxy-15-6-soft-archive-qa"
MARKER_NAME = "STAYS_ON_DISK.txt"
MARKER_PATH = Path(QA_FOLDER) / MARKER_NAME
MARKER_CONTENT = (
    "soft-archive-qa marker — must remain after projects.delete\n"
)

EXPECTED_CONFIRM_SNIPPETS = (
    "Directory",
    "archiv",  # archives / archive
    "stay on the agent disk",
    "not deleted",
)
FORBIDDEN_CONFIRM = re.compile(
    r"permanently delete files|purge workspace|rmtree|delete all files",
    re.I,
)


def project_soft_archive_confirm_message(project_name: str) -> str:
    """Mirror portal ChatHistorySideNav.projectSoftArchiveConfirmMessage."""
    return (
        f'Remove project “{project_name}” from Directory? '
        f"This only archives the project registry entry — it leaves the list. "
        f"Workspace and vault files stay on the agent disk (not deleted)."
    )


def _shot(page: Page, artifacts_dir: Path, name: str) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / name
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0, f"empty screenshot {out}"
    return out


def _goto_home(page: Page, base_url: str) -> None:
    """Prefer load over networkidle — chat SSE/long-poll can keep network busy."""
    page.goto(
        base_url.rstrip("/") + "/",
        wait_until="load",
        timeout=60_000,
    )
    page.wait_for_timeout(1200)


def _login_demo(page: Page, base_url: str) -> None:
    _goto_home(page, base_url)

    nav_settings = page.get_by_role("button", name=re.compile(r"^Settings$", re.I))
    account = page.get_by_role(
        "button", name=re.compile(r"Account menu|dev@demo|dev-google", re.I)
    )
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


def _api_mutate(page: Page, method: str, path: str, body: dict | None = None) -> dict:
    return page.evaluate(
        """async ({method, path, body}) => {
      const csrfRes = await fetch('/api/auth/csrf', {credentials:'include'});
      const {csrf_token} = await csrfRes.json();
      const res = await fetch(path, {
        method,
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'X-CSRF-Token': csrf_token || '',
        },
        body: body == null ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
      return {status: res.status, body: parsed};
    }""",
        {"method": method, "path": path, "body": body},
    )


def _list_projects(page: Page) -> list[dict]:
    res = page.evaluate(
        """async () => {
      const res = await fetch('/api/agent/projects', {credentials:'include'});
      const body = await res.json().catch(async () => ({raw: await res.text()}));
      return {status: res.status, body};
    }"""
    )
    if res.get("status") != 200:
        return []
    body = res.get("body") or {}
    return list(body.get("projects") or [])


def _ensure_marker() -> Path:
    folder = Path(QA_FOLDER)
    folder.mkdir(parents=True, exist_ok=True)
    MARKER_PATH.write_text(MARKER_CONTENT)
    assert MARKER_PATH.is_file() and MARKER_PATH.stat().st_size > 0
    return MARKER_PATH


def _write_report(artifacts_dir: Path, report: dict) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    path = artifacts_dir / "REPORT.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    return path


def _write_result_md(artifacts_dir: Path, report: dict) -> Path:
    checks = report.get("checks", [])
    lines = [
        "# lp-uxy.15.6 — project delete soft-archive honesty",
        "",
        f"**Shipped feature:** {report.get('shipped_feature', 'lp-uxy.5')}",
        f"**Base URL:** `{report.get('base_url')}`",
        f"**Login:** `{EMAIL}`",
        f"**When:** {report.get('when')}",
        f"**Verdict:** **{report.get('verdict')}**",
        "",
        "## Acceptance",
        "",
    ]
    for c in checks:
        mark = "x" if c.get("ok") else " "
        lines.append(f"- [{mark}] {c.get('feature')}: {c.get('detail')}")
    lines += [
        "",
        "## Soft-archive honesty",
        "",
        f"- confirm message: `{report.get('confirm_message')}`",
        f"- expected exact: `{report.get('expected_confirm')}`",
        f"- DELETE body: `{report.get('delete_api')}`",
        f"- marker path: `{report.get('marker_path')}`",
        f"- marker after archive exists: `{report.get('marker_after_exists')}`",
        f"- project left list after archive: `{report.get('project_left_list')}`",
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
                "# lp-uxy.15.6 — pass/fail",
                "",
                f"**Result: {report.get('verdict')}**",
                "",
                f"- Base: `{report.get('base_url')}`",
                f"- Shipped: lp-uxy.5",
                f"- Login: `{EMAIL}`",
                f"- brain_rpc_enabled: {report.get('brain_rpc_enabled')}",
                f"- confirm_honest: {report.get('confirm_honest')}",
                f"- delete_archived: {report.get('delete_archived')}",
                f"- marker_stayed: {report.get('marker_after_exists')}",
                f"- project_left_list: {report.get('project_left_list')}",
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
    (artifacts_dir / "README.md").write_text(
        "\n".join(
            [
                "# lp-uxy.15.6 soft-archive ship-QA",
                "",
                "Live UI proof that project Delete is soft-archive only",
                "(shipped lp-uxy.5).",
                "",
                f"- Base: `{report.get('base_url')}`",
                f"- Login: `{EMAIL}`",
                f"- Artifacts: this directory",
                "",
                "Re-run:",
                "",
                "```bash",
                "export BASE_URL=http://demo.localhost:3010",
                "export UI_ARTIFACTS=$(pwd)/artifacts/ui/lp-uxy-ship-qa/soft-archive",
                "cd portal/packages/web/ui-testing",
                "pytest -v test_lp_uxy_15_6_soft_archive.py",
                "```",
                "",
            ]
        )
    )
    return path


def test_lp_uxy_15_6_project_delete_soft_archive_honesty(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Live Directory project Delete confirm is honest soft-archive; files stay."""
    pytest.skip(
        "lp-cxhb.3 removed project folders and Project actions from the Agents sidenav"
    )
    page.set_viewport_size(DESKTOP)
    results: list[dict] = []
    shots: list[str] = []
    fix_bead: str | None = None

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
    record("login", True, f"logged in as {EMAIL} (or existing session)", shot_home)

    try:
        auth_path = Path(os.environ.get("UI_STORAGE_STATE") or "")
        if not auth_path or not str(auth_path):
            auth_path = (
                Path(__file__).resolve().parents[4]
                / "artifacts"
                / "ui"
                / ".auth"
                / "demo-localhost-lp-uxy.15.6.json"
            )
        page.context.storage_state(path=str(auth_path))
        secure_secret_path(auth_path)
    except Exception:
        pass

    # --- API: context + capabilities ---
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
    methods = caps.get("brain_rpc_methods") or []

    record(
        "brain-rpc-enabled",
        brain_rpc,
        f"brain_rpc_enabled={brain_rpc} kind={kind} "
        f"profile={ctx_body.get('hermes_profile')}",
    )
    record(
        "backend-kind-lanyard-agent",
        kind == "lanyard_agent",
        f"kind={kind}",
    )
    has_delete_method = "projects.delete" in methods
    record(
        "capabilities-projects-delete",
        has_delete_method or bool(features.get("projects_list")),
        f"projects.delete in methods={has_delete_method} "
        f"features.projects_list={features.get('projects_list')} "
        f"projects_create={features.get('projects_create')}",
    )

    ping = page.evaluate(
        """async () => {
      const res = await fetch('/api/brain/ping', {credentials:'include'});
      const t = await res.text();
      let body = null;
      try { body = JSON.parse(t); } catch (e) { body = t; }
      return {status: res.status, body};
    }"""
    )
    pong = (
        bool((ping.get("body") or {}).get("result", {}).get("pong"))
        if isinstance(ping.get("body"), dict)
        else False
    )
    record(
        "brain-ping",
        ping.get("status") == 200 and pong,
        f"status={ping.get('status')} pong={pong} "
        f"instance={(ping.get('body') or {}).get('instance_id') if isinstance(ping.get('body'), dict) else None}",
    )

    # --- Ensure disposable project + marker on disk ---
    marker = _ensure_marker()
    record("marker-seeded", marker.is_file(), f"path={marker}")

    projects_before = _list_projects(page)
    existing = next(
        (p for p in projects_before if p.get("name") == QA_PROJECT_NAME), None
    )
    if existing is None:
        create = _api_mutate(
            page,
            "POST",
            "/api/agent/projects",
            {"name": QA_PROJECT_NAME, "folders": [QA_FOLDER]},
        )
        create_ok = create.get("status") in (200, 201)
        create_body = create.get("body") or {}
        project_id = (
            create_body.get("id")
            if isinstance(create_body, dict)
            else None
        )
        record(
            "create-disposable-project",
            create_ok and bool(project_id),
            f"status={create.get('status')} body={create_body}",
        )
        if not create_ok:
            # Fall back to first non-system project for confirm-only proof
            project_id = None
    else:
        project_id = existing.get("id")
        record(
            "create-disposable-project",
            True,
            f"reused existing id={project_id} primary={existing.get('primary_path')}",
        )

    # Reload Directory so UI shows the project
    _goto_home(page, base_url)
    page.wait_for_timeout(800)
    shot_dir = _shot(page, artifacts_dir, "02-directory-with-project.png")
    body_text = page.locator("body").inner_text()
    project_visible = QA_PROJECT_NAME in body_text
    # If create failed, pick any project that has Project actions
    target_name = QA_PROJECT_NAME if project_visible else None
    if not target_name:
        # Prefer disposable-looking names; else any non-Workspace
        for candidate in (
            "dmeo",
            "k",
            "FixWd25140",
            "QaBugWd24645",
            "legal_work",
            "demo",
            "Clients",
        ):
            if candidate in body_text:
                target_name = candidate
                projects_now = _list_projects(page)
                hit = next(
                    (p for p in projects_now if p.get("name") == candidate), None
                )
                if hit:
                    project_id = hit.get("id")
                    # For non-disposable projects we only check confirm + cancel
                break
    record(
        "directory-shows-target-project",
        bool(target_name),
        f"target={target_name} project_id={project_id} "
        f"qa_visible={project_visible}",
        shot_dir,
    )
    assert target_name, "No project available in Directory to exercise Delete"

    expected_msg = project_soft_archive_confirm_message(target_name)

    # --- UI: open Project actions → Delete; capture confirm (cancel first) ---
    dialogs: list[str] = []

    def on_dialog(dialog) -> None:  # type: ignore[no-untyped-def]
        dialogs.append(dialog.message)
        # First dialog: dismiss so we can screenshot menu state if needed
        dialog.dismiss()

    page.once("dialog", on_dialog)

    actions = page.get_by_role(
        "button", name=f"Project actions for {target_name}"
    )
    expect(actions.first).to_be_visible(timeout=15_000)
    actions.first.click()
    page.wait_for_timeout(400)
    shot_menu = _shot(page, artifacts_dir, "03-project-actions-menu.png")
    delete_item = page.get_by_role("menuitem", name=re.compile(r"^Delete$", re.I))
    if delete_item.count() == 0:
        delete_item = page.get_by_role("button", name=re.compile(r"^Delete$", re.I))
    expect(delete_item.first).to_be_visible(timeout=5_000)
    record(
        "project-actions-delete-visible",
        True,
        f"Delete control visible for {target_name}",
        shot_menu,
    )
    delete_item.first.click()
    page.wait_for_timeout(600)

    confirm1 = dialogs[0] if dialogs else ""
    honest_snippets = all(s.lower() in confirm1.lower() for s in EXPECTED_CONFIRM_SNIPPETS)
    no_purge = FORBIDDEN_CONFIRM.search(confirm1) is None
    exact_or_close = confirm1 == expected_msg or (
        "stay on the agent disk" in confirm1.lower()
        and "archiv" in confirm1.lower()
        and "not deleted" in confirm1.lower()
    )
    confirm_honest = honest_snippets and no_purge and exact_or_close
    record(
        "soft-archive-confirm-copy",
        confirm_honest,
        f"msg={confirm1!r} expected={expected_msg!r} "
        f"snippets_ok={honest_snippets} no_purge={no_purge}",
    )
    # Persist confirm text for evidence
    (artifacts_dir / "confirm-message.txt").write_text(confirm1 + "\n")

    # Re-open and accept delete only for disposable SoftArchiveQA project
    will_delete = target_name == QA_PROJECT_NAME and bool(project_id)
    delete_api: dict | None = None
    project_left = None
    marker_after = None

    if will_delete:
        dialogs.clear()

        def on_dialog_accept(dialog) -> None:  # type: ignore[no-untyped-def]
            dialogs.append(dialog.message)
            dialog.accept()

        page.once("dialog", on_dialog_accept)
        actions = page.get_by_role(
            "button", name=f"Project actions for {target_name}"
        )
        # Menu may have closed after dismiss
        if actions.count() > 0:
            actions.first.click()
            page.wait_for_timeout(300)
        delete_item = page.get_by_role(
            "menuitem", name=re.compile(r"^Delete$", re.I)
        )
        if delete_item.count() == 0:
            delete_item = page.get_by_role(
                "button", name=re.compile(r"^Delete$", re.I)
            )
        if delete_item.count() > 0:
            delete_item.first.click()
            page.wait_for_timeout(1500)
        else:
            # API path if menu flaky after cancel
            delete_api = _api_mutate(
                page,
                "DELETE",
                f"/api/agent/projects/{project_id}",
            )

        shot_after = _shot(page, artifacts_dir, "04-after-soft-archive.png")
        page.wait_for_timeout(500)

        # Verify via list + disk
        projects_after = _list_projects(page)
        still_listed = any(
            p.get("id") == project_id or p.get("name") == QA_PROJECT_NAME
            for p in projects_after
        )
        project_left = not still_listed
        marker_after = MARKER_PATH.is_file()
        marker_content_ok = (
            MARKER_PATH.read_text() == MARKER_CONTENT if marker_after else False
        )

        # Also capture DELETE response if not already
        if delete_api is None:
            # Project already deleted via UI; re-create? Or note UI-only.
            # Probe delete shape by re-creating then API-delete is too heavy;
            # instead document UI dialog + list + disk.
            delete_api = {
                "via": "ui-confirm-accept",
                "confirm": dialogs[-1] if dialogs else confirm1,
            }
        else:
            body = delete_api.get("body") if isinstance(delete_api, dict) else None
            archived = (
                isinstance(body, dict)
                and body.get("archived") is True
                and body.get("id") == project_id
            )
            record(
                "delete-api-archived-true",
                bool(archived) or delete_api.get("status") in (200, 204),
                f"status={delete_api.get('status')} body={body}",
            )

        body_after = page.locator("body").inner_text()
        ui_left = QA_PROJECT_NAME not in body_after
        record(
            "project-left-directory-list",
            project_left or ui_left,
            f"api_left={project_left} ui_left={ui_left} "
            f"after_count={len(projects_after)}",
            shot_after,
        )
        record(
            "vault-marker-stayed-on-disk",
            bool(marker_after and marker_content_ok),
            f"exists={marker_after} content_ok={marker_content_ok} "
            f"path={MARKER_PATH}",
        )
        # Explicit API proof of {archived:true} if we only used UI:
        # re-create + delete via API for contract shape
        recreate = _api_mutate(
            page,
            "POST",
            "/api/agent/projects",
            {"name": QA_PROJECT_NAME, "folders": [QA_FOLDER]},
        )
        rid = (
            (recreate.get("body") or {}).get("id")
            if isinstance(recreate.get("body"), dict)
            else None
        )
        if rid:
            # Ensure marker still there before API delete
            _ensure_marker()
            api_del = _api_mutate(
                page, "DELETE", f"/api/agent/projects/{rid}"
            )
            del_body = api_del.get("body")
            archived = (
                isinstance(del_body, dict)
                and del_body.get("archived") is True
            )
            record(
                "delete-api-archived-true",
                api_del.get("status") == 200 and archived,
                f"status={api_del.get('status')} body={del_body}",
            )
            delete_api = api_del
            marker_after = MARKER_PATH.is_file()
            record(
                "vault-marker-stayed-after-api-delete",
                marker_after,
                f"exists={marker_after} path={MARKER_PATH}",
            )
        shot_final = _shot(page, artifacts_dir, "05-final-directory.png")
        shots.append(str(shot_final))
    else:
        # Confirm-only path (did not delete non-disposable project)
        record(
            "project-left-directory-list",
            True,
            "skipped delete (non-disposable target); confirm-only proof",
        )
        record(
            "vault-marker-stayed-on-disk",
            MARKER_PATH.is_file(),
            f"marker still present (no delete executed) path={MARKER_PATH}",
        )
        record(
            "delete-api-archived-true",
            False,
            "skipped — target was not SoftArchiveQA disposable project",
        )
        # Still prove API soft-archive on disposable if we can create it
        create = _api_mutate(
            page,
            "POST",
            "/api/agent/projects",
            {"name": QA_PROJECT_NAME, "folders": [QA_FOLDER]},
        )
        rid = (
            (create.get("body") or {}).get("id")
            if isinstance(create.get("body"), dict)
            else None
        )
        if rid:
            _ensure_marker()
            api_del = _api_mutate(
                page, "DELETE", f"/api/agent/projects/{rid}"
            )
            del_body = api_del.get("body")
            archived = (
                isinstance(del_body, dict)
                and del_body.get("archived") is True
            )
            record(
                "delete-api-archived-true",
                api_del.get("status") == 200 and archived,
                f"status={api_del.get('status')} body={del_body}",
            )
            delete_api = api_del
            marker_after = MARKER_PATH.is_file()
            project_left = not any(
                p.get("id") == rid for p in _list_projects(page)
            )
            record(
                "vault-marker-stayed-after-api-delete",
                bool(marker_after),
                f"exists={marker_after}",
            )
            record(
                "project-left-directory-list-api",
                bool(project_left),
                f"left={project_left}",
            )
        shot_final = _shot(page, artifacts_dir, "04-confirm-only-directory.png")
        shots.append(str(shot_final))

    passed = all(c["ok"] for c in results)
    if not passed:
        # Do not auto-file fix bead here; implementer will file via bd if needed
        fix_bead = None

    report = {
        "bead_id": "lp-uxy.15.6",
        "shipped_feature": "lp-uxy.5",
        "base_url": base_url,
        "when": datetime.now(timezone.utc).isoformat(),
        "login": EMAIL,
        "brain_rpc_enabled": brain_rpc,
        "backend_kind": kind,
        "confirm_message": confirm1,
        "expected_confirm": expected_msg,
        "confirm_honest": confirm_honest,
        "delete_api": delete_api,
        "delete_archived": (
            isinstance(delete_api, dict)
            and isinstance(delete_api.get("body"), dict)
            and delete_api["body"].get("archived") is True
        )
        if delete_api
        else False,
        "marker_path": str(MARKER_PATH),
        "marker_after_exists": MARKER_PATH.is_file(),
        "project_left_list": project_left,
        "target_project": target_name,
        "project_id": project_id,
        "checks": results,
        "screenshot_paths": shots,
        "passed": passed,
        "verdict": "PASS" if passed else "FAIL",
        "fix_bead": fix_bead,
    }
    _write_report(artifacts_dir, report)
    _write_result_md(artifacts_dir, report)

    # Mirror under artifacts/ui/lp-uxy.15.6 when using ship-qa path
    try:
        alt = artifacts_dir.parent.parent / "lp-uxy.15.6"
        if artifacts_dir.name == "soft-archive" and "lp-uxy-ship-qa" in str(
            artifacts_dir
        ):
            alt.mkdir(parents=True, exist_ok=True)
            for p in artifacts_dir.iterdir():
                if p.is_file():
                    (alt / p.name).write_bytes(p.read_bytes())
    except Exception:
        pass

    assert passed, (
        "lp-uxy.15.6 soft-archive QA failed: "
        + json.dumps([c for c in results if not c["ok"]], indent=2)
    )
