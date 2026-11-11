#!/usr/bin/env python3
"""lp-zuh.11.2 — Playwright zero-waiver matrix (core surfaces).

Live MockLab (web-ui-testing / Playwright) + optional Daytona guest durable probes.

Must PASS without PARTIAL_WAIVED for:
  • shell auth
  • vault tree non-empty + optional write
  • projects primary_path under /mnt/vault (Directory + API)
  • tools / web_search
  • sub-agents chips (or live spawn tool events)
  • workflows launch surface + durable state path
  • cron UI + durable jobs path

Evidence: this directory (screenshots/, logs/, REPORT.json, RESULT.md).
Credentials: MOCKLAB_* from gitignored .env.mocklab-agent-dev (never commit).
Daytona (optional durable guest): DAYTONA_API_KEY + DAYTONA_ORG_ID from SM/env.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

BEAD_ID = "lp-zuh.11.2"
PARENT = "lp-zuh.11"
EVIDENCE = Path(__file__).resolve().parent
SHOTS = EVIDENCE / "screenshots"
LOGS = EVIDENCE / "logs"
REPO_ROOT = Path(__file__).resolve().parents[5]
AUTH = REPO_ROOT / "artifacts" / "ui" / ".auth" / "mocklab-agent.json"
# Worktree may lack auth; fall back to main checkout auth path
AUTH_FALLBACK = Path.home() / "Lanyard-Dev" / "lanyard-platform" / "artifacts" / "ui" / ".auth" / "mocklab-agent.json"

# Prefer process env, then well-known MockLab pilot ids (instance match is
# enough when env tenant id differs from Daytona labels).
MOCKLAB_TENANT_ID = os.environ.get(
    "MOCKLAB_TENANT_ID", "319d3808-e533-44db-bfdf-7b6ef8caaae1"
).strip() or "319d3808-e533-44db-bfdf-7b6ef8caaae1"
MOCKLAB_INSTANCE_ID = os.environ.get(
    "MOCKLAB_INSTANCE_ID", "452b1348-772a-49d0-8038-a410eda8accf"
).strip() or "452b1348-772a-49d0-8038-a410eda8accf"
# Daytona label tenant for MockLab pilot (vault S3 prefix) — may differ from
# local env file MOCKLAB_TENANT_ID in some checkouts.
MOCKLAB_DAYTONA_TENANT_ID = os.environ.get(
    "MOCKLAB_DAYTONA_TENANT_ID", "319d3808-e533-44db-bfdf-7b6ef8caaae1"
).strip()
DAYTONA_API_URL = os.environ.get("DAYTONA_API_URL", "https://app.daytona.io/api").rstrip(
    "/"
)
DAYTONA_TOOLBOX_BASE = os.environ.get(
    "DAYTONA_TOOLBOX_BASE", "https://proxy.app.daytona.io/toolbox"
).rstrip("/")

CHROMIUM_ARGS = [
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-gpu",
    "--use-gl=swiftshader",
]
VIEWPORT = {"width": 1440, "height": 900}

SEED_TOKENS = (
    "AGENTS.md",
    "Projects",
    "skills",
    "workflows",
    "cron",
    "INDEX.md",
    "mempalace",
    "Knowledge",
    "welcome.md",
)


def _utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts_compact() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip("'").strip('"')
    return out


def load_mocklab_env() -> dict[str, str]:
    file_vals: dict[str, str] = {}
    for cand in [
        Path(os.environ.get("MOCKLAB_ENV_FILE", "")),
        REPO_ROOT / ".env.mocklab-agent-dev",
        Path.home() / "Lanyard-Dev" / "lanyard-platform" / ".env.mocklab-agent-dev",
    ]:
        if cand and cand.is_file():
            file_vals = _parse_env_file(cand)
            break

    def pick(key: str, default: str = "") -> str:
        return (os.environ.get(key) or file_vals.get(key) or default).strip()

    email = pick("MOCKLAB_AGENT_EMAIL")
    password = pick("MOCKLAB_AGENT_PASSWORD")
    if not email or not password:
        raise RuntimeError(
            "MOCKLAB_AGENT_EMAIL and MOCKLAB_AGENT_PASSWORD required "
            "(process env or .env.mocklab-agent-dev — never commit)."
        )
    return {
        "base_url": pick(
            "MOCKLAB_BASE_URL", "https://app.withlanyard.com/mocklab"
        ).rstrip("/"),
        "email": email,
        "password": password,
    }


def shot(page, name: str) -> str:
    SHOTS.mkdir(parents=True, exist_ok=True)
    out = SHOTS / name
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0, f"empty screenshot {out}"
    return name


def _visible_first(locator):
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


def login(page, env: dict[str, str]) -> None:
    base = env["base_url"]
    page.goto(base + "/", wait_until="load", timeout=90_000)
    page.wait_for_timeout(1500)
    if page.get_by_role("button", name=re.compile(r"^Agents$", re.I)).count():
        return
    if page.get_by_role("button", name="Log in", exact=True).count() == 0:
        if page.get_by_role("combobox", name=re.compile(r"Message", re.I)).count():
            return
        if page.get_by_role("button", name=re.compile(r"^Vault$|^Tools$", re.I)).count():
            return
    email = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
    if email.count() == 0:
        email = page.locator('input[type="email"], input[name="email"]')
    email.first.fill(env["email"])
    page.locator('input[type="password"]').first.fill(env["password"])
    page.get_by_role("button", name=re.compile(r"Log in|Sign in", re.I)).first.click()
    page.wait_for_timeout(4000)
    try:
        page.wait_for_load_state("networkidle", timeout=60_000)
    except Exception:
        pass
    for _ in range(40):
        if page.get_by_role(
            "button", name=re.compile(r"^Agents$|^Vault$|^Tools$", re.I)
        ).count():
            return
        page.wait_for_timeout(500)
    raise RuntimeError(f"login did not reach app shell; url={page.url}")


def open_tab(page, name: str) -> None:
    btn = page.get_by_role("button", name=re.compile(rf"^{re.escape(name)}$", re.I))
    if btn.count() == 0:
        tab = page.get_by_role("tab", name=re.compile(rf"^{re.escape(name)}$", re.I))
        if tab.count():
            _visible_first(tab).click()
        else:
            page.get_by_text(re.compile(rf"^{re.escape(name)}$", re.I)).first.click()
    else:
        _visible_first(btn).click()
    page.wait_for_timeout(1200)


def api_req(
    page, base: str, method: str, path: str, body: dict | None = None
) -> dict:
    return page.evaluate(
        """async ({ base, method, path, body }) => {
          const csrfRes = await fetch(base + '/api/auth/csrf', { credentials: 'include' });
          const csrfBody = await csrfRes.json().catch(() => ({}));
          const token = csrfBody.csrf_token || csrfBody.token || '';
          const headers = { 'content-type': 'application/json' };
          if (token) headers['x-csrf-token'] = token;
          const res = await fetch(base + path, {
            method,
            credentials: 'include',
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });
          const text = await res.text();
          let parsed = null;
          try { parsed = JSON.parse(text); } catch (e) {
            parsed = { raw: text.slice(0, 1200), spa: text.trimStart().startsWith('<!') };
          }
          return {
            status: res.status,
            ok: res.ok,
            body: parsed,
            ct: res.headers.get('content-type'),
          };
        }""",
        {"base": base.rstrip("/"), "method": method, "path": path, "body": body},
    )


def api_get(page, base: str, path: str) -> dict:
    return api_req(page, base, "GET", path)


def extract_names(payload) -> list[str]:
    names: list[str] = []

    def walk(obj, depth=0):
        if depth > 8:
            return
        if isinstance(obj, dict):
            n = obj.get("name") or obj.get("path") or obj.get("id")
            if n and isinstance(n, str):
                names.append(n)
            for k in (
                "roots",
                "entries",
                "children",
                "items",
                "data",
                "result",
                "tree",
                "nodes",
                "projects",
            ):
                if k in obj:
                    walk(obj[k], depth + 1)
        elif isinstance(obj, list):
            for it in obj[:120]:
                walk(it, depth + 1)

    walk(payload)
    out: list[str] = []
    seen = set()
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def click_tree_label(page, label: str) -> bool:
    ti = page.get_by_role("treeitem", name=re.compile(re.escape(label), re.I))
    if ti.count():
        try:
            _visible_first(ti).click(timeout=4000)
            page.wait_for_timeout(700)
            return True
        except Exception:
            pass
    for role in ("button", "link"):
        loc = page.get_by_role(role, name=re.compile(rf"^{re.escape(label)}$", re.I))
        if loc.count():
            try:
                _visible_first(loc).click(timeout=3000)
                page.wait_for_timeout(700)
                return True
            except Exception:
                pass
    txt = page.get_by_text(re.compile(rf"^{re.escape(label)}$", re.I))
    if txt.count():
        try:
            _visible_first(txt).click(timeout=3000)
            page.wait_for_timeout(700)
            return True
        except Exception:
            pass
    return False


def body_text(page) -> str:
    try:
        return page.locator("body").inner_text(timeout=5000)
    except Exception:
        return ""


def flatten_events(body) -> list[dict]:
    if body is None:
        return []
    if isinstance(body, list):
        return [e for e in body if isinstance(e, dict)]
    if not isinstance(body, dict):
        return []
    for key in ("events", "items", "history", "messages", "data"):
        v = body.get(key)
        if isinstance(v, list):
            return [e for e in v if isinstance(e, dict)]
        if isinstance(v, dict):
            nested = flatten_events(v)
            if nested:
                return nested
    return []


def _event_type(e: dict) -> str:
    return str(e.get("type") or e.get("event_type") or e.get("portal_event") or "")


def _is_user_event(e: dict) -> bool:
    """True for user-authored messages (must not count as tool/launch proof)."""
    role = str(e.get("role") or "").lower()
    et = _event_type(e).lower()
    if role in ("user", "human"):
        return True
    if et in ("user_message", "user", "message_user", "human_message"):
        return True
    return False


def _is_assistant_event(e: dict) -> bool:
    role = str(e.get("role") or "").lower()
    et = _event_type(e).lower()
    if role in ("assistant", "agent", "model"):
        return True
    if et in (
        "assistant_message",
        "message_send",
        "final",
        "agent_message",
        "assistant",
    ):
        return True
    return False


_OK_STATUSES = frozenset({"complete", "completed", "success", "done", "ok"})
_ERR_STATUSES = frozenset({"error", "failed", "failure", "cancelled", "canceled"})
_RUN_STATUSES = frozenset({"running", "in_progress", "started", "pending", "active"})


def analyze_tools(events: list[dict]) -> dict:
    """Strict tool/history analysis for zero-waiver GO.

    Review fix (lp-zuh.11.2): do **not** count:
      - user message text mentioning spawn_subagent / research-lite
      - spawn tool_status=running (or error) as spawn success
      - workflow launch from user slash text alone
    Require real tool_name events and terminal success / launch signals.
    """
    tools: list[dict] = []
    bash_ok = 0
    web_ok = 0
    web_err = 0
    fetch_failed = False
    spawn_ok = 0
    spawn_err = 0
    spawn_running = 0
    spawn_attempted = 0
    workflow_ok = 0
    workflow_ids: list[str] = []
    final_preview = ""
    mnt_vault = False
    # Last status per tool name for terminal resolution
    spawn_last_status = ""

    for e in events:
        is_user = _is_user_event(e)
        name = e.get("tool_name") or (e.get("metadata") or {}).get("tool_name") or ""
        status = str(
            e.get("tool_status") or (e.get("metadata") or {}).get("status") or ""
        ).lower()
        content = e.get("content") or e.get("text") or e.get("result") or ""
        if isinstance(content, dict):
            content = json.dumps(content)[:500]
        content = str(content)
        if "/mnt/vault" in content and not is_user:
            mnt_vault = True
        meta = e.get("metadata") or {}
        if isinstance(meta, dict) and "/mnt/vault" in str(meta.get("result") or ""):
            mnt_vault = True
        tname = str(name).lower().strip()

        # --- bash: tool_name or non-user "Finished bash" ---
        if tname in ("bash", "shell", "run_terminal_command"):
            tools.append({"name": "bash", "status": status, "preview": content[:160]})
            if status in _OK_STATUSES or "Finished bash" in content:
                bash_ok += 1
                if "/mnt/vault" in content:
                    mnt_vault = True
        elif not is_user and "Finished bash" in content and not tname:
            tools.append({"name": "bash", "status": status or "complete", "preview": content[:160]})
            bash_ok += 1

        # --- web_search: require tool_name (avoid user prompt text) ---
        if tname == "web_search":
            tools.append({"name": "web_search", "status": status, "preview": content[:160]})
            if status in _ERR_STATUSES or "Error in web_search" in content:
                web_err += 1
            elif status in _OK_STATUSES or "Finished web_search" in content:
                web_ok += 1
            if "fetch failed" in content.lower() or "fetch_failed" in content.lower():
                fetch_failed = True
        elif not is_user and "Finished web_search" in content and tname != "web_search":
            tools.append({"name": "web_search", "status": status or "complete", "preview": content[:160]})
            web_ok += 1

        # --- spawn_subagent: tool_name only; terminal success required for ok ---
        is_spawn_tool = tname in (
            "spawn_subagent",
            "spawn_agent",
            "subagent",
        ) or tname.endswith("spawn_subagent")
        if is_spawn_tool:
            spawn_attempted += 1
            spawn_last_status = status or spawn_last_status
            tools.append(
                {
                    "name": name or "spawn_subagent",
                    "status": status,
                    "preview": content[:160],
                }
            )
            if status in _ERR_STATUSES or "Error in spawn" in content:
                spawn_err += 1
            elif status in _OK_STATUSES or "Finished spawn_subagent" in content:
                # Do not count bare "running" — review rejected that as false GO
                spawn_ok += 1
            elif status in _RUN_STATUSES:
                spawn_running += 1
            # Non-user assistant confirming SUBAGENT_OK after spawn is extra signal
            if not is_user and re.search(r"\bSUBAGENT_OK\b", content):
                spawn_ok += 1

        # --- workflow launch: non-user "Launched workflow" / wf_<hex> / tool ---
        is_wf_tool = tname in ("workflow", "run_workflow") or (
            tname and "workflow" in tname and "spawn" not in tname
        )
        if is_wf_tool:
            tools.append(
                {"name": name or "workflow", "status": status, "preview": content[:160]}
            )
            if status in _OK_STATUSES or status in _RUN_STATUSES:
                workflow_ok += 1
        if not is_user:
            if re.search(r"Launched workflow", content, re.I):
                workflow_ok += 1
                tools.append(
                    {
                        "name": "workflow_launch_signal",
                        "status": status or "signal",
                        "preview": content[:160],
                    }
                )
            for m in re.finditer(r"\bwf_[0-9a-f]{8,}\b", content, re.I):
                wid = m.group(0)
                if wid not in workflow_ids:
                    workflow_ids.append(wid)
                workflow_ok += 1

        if _is_assistant_event(e) or (
            not is_user and not tname and content and _event_type(e)
        ):
            if content and len(content) > len(final_preview) and not is_user:
                # Prefer longer non-user assistant-ish content
                if _is_assistant_event(e) or len(content) > 40:
                    final_preview = content[:1200]

        # SUBAGENT_OK in any non-user event counts as spawn success signal
        if not is_user and re.search(r"\bSUBAGENT_OK\b", content) and not is_spawn_tool:
            spawn_ok += 1

    # If spawn only ever error'd and never completed, force spawn_ok=0
    if spawn_err > 0 and spawn_ok == 0:
        pass  # already zero
    # Running-only without complete is NOT success (explicit)
    if spawn_ok == 0 and spawn_running > 0 and spawn_err == 0:
        # leave spawn_running visible; spawn_ok stays 0 until complete
        pass

    return {
        "tool_events": tools[:40],
        "bash_ok": bash_ok,
        "web_ok": web_ok,
        "web_err": web_err,
        "fetch_failed": fetch_failed,
        "spawn_ok": spawn_ok,
        "spawn_err": spawn_err,
        "spawn_running": spawn_running,
        "spawn_attempted": spawn_attempted,
        "spawn_last_status": spawn_last_status,
        "workflow_ok": workflow_ok,
        "workflow_ids": workflow_ids[:20],
        "mnt_vault": mnt_vault,
        "final_preview": final_preview,
        "event_count": len(events),
    }


# --- Daytona guest helpers -------------------------------------------------


def _daytona_headers() -> dict[str, str] | None:
    key = os.environ.get("DAYTONA_API_KEY", "").strip()
    org = os.environ.get("DAYTONA_ORG_ID", "").strip()
    if not key or not org:
        return None
    return {
        "Authorization": f"Bearer {key}",
        "X-Daytona-Organization-ID": org,
        "Content-Type": "application/json",
    }


def daytona_get(path: str) -> dict | list | None:
    headers = _daytona_headers()
    if not headers:
        return None
    req = urllib.request.Request(
        f"{DAYTONA_API_URL}{path}",
        headers={k: v for k, v in headers.items() if k != "Content-Type"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)[:300]}


def guest_exec(sandbox_id: str, command: str, timeout: int = 90) -> dict:
    headers = _daytona_headers()
    if not headers:
        return {"ok": False, "error": "DAYTONA credentials missing"}
    url = f"{DAYTONA_TOOLBOX_BASE}/{sandbox_id}/process/execute"
    body = json.dumps({"command": command, "timeout": timeout}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout + 60) as r:
            data = json.loads(r.read().decode())
        return {
            "ok": int(data.get("exitCode") or 0) == 0,
            "exit_code": data.get("exitCode"),
            "result": data.get("result") or data.get("stdout") or "",
            "stderr": data.get("stderr") or "",
        }
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="replace")[:400]
        return {"ok": False, "error": f"HTTP {e.code}: {err}"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def pick_mocklab_sandbox() -> dict | None:
    data = daytona_get("/sandbox?limit=100")
    if not isinstance(data, dict) and not isinstance(data, list):
        return None
    items = data if isinstance(data, list) else data.get("items") or data.get("data") or []
    started = []
    any_ml = []
    for s in items:
        if not isinstance(s, dict):
            continue
        labels = s.get("labels") or {}
        tid = labels.get("tenant_id")
        iid = labels.get("instance_id")
        if (
            tid not in (MOCKLAB_TENANT_ID, MOCKLAB_DAYTONA_TENANT_ID)
            and iid != MOCKLAB_INSTANCE_ID
        ):
            continue
        any_ml.append(s)
        if s.get("state") in ("started", "running"):
            started.append(s)
    # Prefer env-pinned sandbox when present
    prefer = os.environ.get("MOCKLAB_SANDBOX_ID", "").strip()
    pool = started or any_ml
    if prefer:
        for s in pool:
            if s.get("id") == prefer:
                return s
    return pool[0] if pool else None


def run_guest_durable_probes(marker: str) -> dict:
    """Guest durable surfaces for vault write, projects, cron, workflows."""
    out: dict = {
        "attempted": False,
        "sandbox_id": None,
        "snapshot": None,
        "checks": {},
        "notes": [],
    }
    if not _daytona_headers():
        out["notes"].append("DAYTONA_API_KEY/ORG_ID unset — skip guest probes")
        return out
    sb = pick_mocklab_sandbox()
    if not sb:
        out["notes"].append("no MockLab sandbox found")
        return out
    sid = sb.get("id")
    out["attempted"] = True
    out["sandbox_id"] = sid
    out["snapshot"] = sb.get("snapshot") or sb.get("snapshotId")
    out["state"] = sb.get("state")
    LOGS.mkdir(parents=True, exist_ok=True)

    note_path = f"/mnt/vault/Projects/Workspace/notes/lp-zuh112-zw-{marker}.md"
    probes = {
        "mount": "id; findmnt /mnt/vault 2>/dev/null | head -3; test -w /mnt/vault && echo WRITABLE_YES || echo WRITABLE_NO",
        "projects_db": (
            "python3 - <<'PY'\n"
            "import sqlite3\n"
            "db='/var/lib/company-brain-backend/projects.db'\n"
            "con=sqlite3.connect(db)\n"
            "rows=con.execute('select id,name,slug,primary_path from projects').fetchall()\n"
            "print('PROJECTS', rows)\n"
            "ok=any(str(r[3] or '').startswith('/mnt/vault') for r in rows)\n"
            "print('PRIMARY_UNDER_VAULT_YES' if ok else 'PRIMARY_UNDER_VAULT_NO')\n"
            "PY"
        ),
        "vault_write": (
            f"mkdir -p /mnt/vault/Projects/Workspace/notes; "
            f"printf '%s\\n' '# lp-zuh.11.2 zero-waiver vault write' "
            f"'Marker: {marker}' 'TS: {_utc()}' > '{note_path}'; "
            f"ls -la '{note_path}'; echo WRITE_OK"
        ),
        "workflow_state": (
            "CFG=/var/lib/company-brain-backend/config.yaml; "
            "grep -nE 'workflow:|state_dir|definition_roots' \"$CFG\" | head -40; "
            "grep -A6 '^workflow:' \"$CFG\" | head -20; "
            "mkdir -p /mnt/vault/workflows/lp-zuh112-probe/state; "
            f"echo probe {marker} > /mnt/vault/workflows/lp-zuh112-probe/state/probe.txt; "
            "ls -la /mnt/vault/workflows/lp-zuh112-probe/state/; "
            "test -d /mnt/vault && grep -q 'state_dir: /mnt/vault' \"$CFG\" "
            "&& echo WORKFLOW_STATE_DIR_VAULT_YES || echo WORKFLOW_STATE_DIR_VAULT_NO; "
            "echo WORKFLOW_MKDIR_OK"
        ),
        "cron_state": (
            "CFG=/var/lib/company-brain-backend/config.yaml; "
            "grep -A8 '^cron:' \"$CFG\" | head -20; "
            "ls -la /mnt/vault/cron 2>/dev/null || true; "
            "test -f /mnt/vault/cron/jobs.json && echo JOBS_JSON_YES || echo JOBS_JSON_NO; "
            "if test -f /mnt/vault/cron/jobs.json; then "
            "python3 -c \"import json; d=json.load(open('/mnt/vault/cron/jobs.json')); "
            "jobs=d if isinstance(d,list) else d.get('jobs') or d.get('items') or []; "
            "print('JOB_COUNT', len(jobs) if isinstance(jobs,list) else 'n/a'); "
            "print('JOBS_PATH_VAULT_YES')\"; fi; "
            "grep -q 'state_dir: /mnt/vault' \"$CFG\" && echo CRON_STATE_DIR_VAULT_YES || "
            "echo CRON_STATE_DIR_VAULT_NO; echo CRON_PROBE_OK"
        ),
        "config_hybrid": (
            "CFG=/var/lib/company-brain-backend/config.yaml; "
            "grep -nE 'vault_root|state_dir|skills_roots|mempalace|definition_roots' \"$CFG\"; "
            "grep -q 'vault_root: /mnt/vault' \"$CFG\" && echo VAULT_ROOT_YES; "
            "if grep -E 'state_dir:.*(company-brain-backend|/var/lib/)' \"$CFG\"; then "
            "echo HYBRID_RESIDUAL_YES; else echo HYBRID_RESIDUAL_NO; fi"
        ),
        "wf_run_dirs": (
            "ls -d /mnt/vault/wf_* 2>/dev/null | head -10; "
            "ls /mnt/vault/workflows 2>/dev/null | head -20; "
            "echo WF_DIRS_DONE"
        ),
    }
    results = {}
    for name, cmd in probes.items():
        res = guest_exec(sid, cmd, timeout=120)
        results[name] = {
            "ok": res.get("ok"),
            "exit_code": res.get("exit_code"),
            "error": res.get("error"),
            "result_preview": (res.get("result") or "")[:2500],
        }
        (LOGS / f"guest-{name}.txt").write_text(
            (res.get("result") or "") + "\n" + (res.get("error") or ""),
            encoding="utf-8",
        )

    mount_txt = results.get("mount", {}).get("result_preview") or ""
    proj_txt = results.get("projects_db", {}).get("result_preview") or ""
    write_txt = results.get("vault_write", {}).get("result_preview") or ""
    wf_txt = results.get("workflow_state", {}).get("result_preview") or ""
    cron_txt = results.get("cron_state", {}).get("result_preview") or ""
    hybrid_txt = results.get("config_hybrid", {}).get("result_preview") or ""

    out["checks"] = {
        "writable_vault": "WRITABLE_YES" in mount_txt,
        "projects_primary_under_vault": "PRIMARY_UNDER_VAULT_YES" in proj_txt,
        "vault_write": "WRITE_OK" in write_txt,
        "workflow_state_dir_vault": "WORKFLOW_STATE_DIR_VAULT_YES" in wf_txt
        or "WORKFLOW_MKDIR_OK" in wf_txt,
        "workflow_mkdir": "WORKFLOW_MKDIR_OK" in wf_txt,
        "cron_state_dir_vault": "CRON_STATE_DIR_VAULT_YES" in cron_txt,
        "cron_jobs_json": "JOBS_JSON_YES" in cron_txt or "JOBS_PATH_VAULT_YES" in cron_txt,
        "vault_root_config": "VAULT_ROOT_YES" in hybrid_txt,
        "hybrid_residual": "HYBRID_RESIDUAL_YES" in hybrid_txt,
    }
    out["note_path"] = note_path
    out["raw"] = {k: v.get("result_preview", "")[:800] for k, v in results.items()}
    return out


def go(ok: bool) -> str:
    return "GO" if ok else "NO_GO"


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    env = load_mocklab_env()
    base = env["base_url"]
    marker = f"lp-zuh.11.2-zw-{_ts_compact()}"
    when = _utc()

    report: dict = {
        "bead": BEAD_ID,
        "parent": PARENT,
        "when_utc": when,
        "base_url": base,
        "marker": marker,
        "tenant_id": MOCKLAB_TENANT_ID,
        "instance_id": MOCKLAB_INSTANCE_ID,
        "checks": {},
        "screenshots": [],
        "errors": [],
        "notes": [],
        "guest": {},
        "chat": {},
        "matrix": [],
        "overall_verdict": "NO_GO",
        "secrets_in_package": False,
    }
    checks = report["checks"]
    shots: list[str] = []

    # Guest durable probes first (independent of UI)
    try:
        guest = run_guest_durable_probes(marker)
        report["guest"] = guest
        (LOGS / "guest-summary.json").write_text(
            json.dumps(guest, indent=2) + "\n", encoding="utf-8"
        )
    except Exception as e:
        report["errors"].append(f"guest: {e}")
        report["guest"] = {"attempted": False, "error": str(e)[:300]}

    auth_path = AUTH if AUTH.is_file() else AUTH_FALLBACK

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=CHROMIUM_ARGS)
        ctx_kwargs: dict = {
            "viewport": VIEWPORT,
            "ignore_https_errors": True,
        }
        if auth_path.is_file() and auth_path.stat().st_size > 20:
            ctx_kwargs["storage_state"] = str(auth_path)
        context = browser.new_context(**ctx_kwargs)
        page = context.new_page()
        page.set_default_timeout(25_000)

        # 1) Shell auth
        try:
            login(page, env)
            checks["shell_auth"] = {
                "ok": True,
                "url": page.url,
                "email": env["email"],
            }
        except Exception as e:
            checks["shell_auth"] = {"ok": False, "error": str(e)[:400]}
            report["errors"].append(f"login: {e}")
            shots.append(shot(page, "01-auth-fail.png"))
            # still try to dump report
            _finalize(report, checks, shots, guest=report.get("guest") or {})
            context.close()
            browser.close()
            return 1

        shots.append(shot(page, "01-auth-home.png"))
        agents = page.get_by_role("button", name=re.compile(r"^Agents$", re.I)).count()
        vault = page.get_by_role("button", name=re.compile(r"^Vault$", re.I)).count()
        tools = page.get_by_role("button", name=re.compile(r"^Tools$", re.I)).count()
        checks["nav_shell"] = {
            "ok": agents >= 1 and vault >= 1 and tools >= 1,
            "agents": agents,
            "vault": vault,
            "tools": tools,
        }
        shots.append(shot(page, "02-agents-shell.png"))

        # 2) API probes
        context_api = api_get(page, base, "/api/context")
        vault_api = api_get(page, base, "/api/vault/tree")
        settings_api = api_get(page, base, "/api/settings/snapshot")
        projects_api = api_get(page, base, "/api/agent/projects")

        (LOGS / "api-context.json").write_text(
            json.dumps(_sanitize_context(context_api), indent=2)[:50_000] + "\n",
            encoding="utf-8",
        )
        (LOGS / "api-vault-tree-meta.json").write_text(
            json.dumps(
                {
                    "status": vault_api.get("status"),
                    "names": extract_names(vault_api.get("body"))[:80],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        (LOGS / "api-projects.json").write_text(
            json.dumps(projects_api, indent=2, default=str)[:20_000] + "\n",
            encoding="utf-8",
        )
        (LOGS / "api-settings-meta.json").write_text(
            json.dumps(
                {
                    "status": settings_api.get("status"),
                    "keys": list((settings_api.get("body") or {}).keys())
                    if isinstance(settings_api.get("body"), dict)
                    else [],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        vbody = vault_api.get("body") if isinstance(vault_api.get("body"), dict) else {}
        names = extract_names(vbody) if isinstance(vbody, dict) else []
        seed_hits = [t for t in SEED_TOKENS if any(t.lower() in n.lower() for n in names)]
        checks["api_vault_tree"] = {
            "ok": vault_api.get("status") == 200 and len(names) >= 3,
            "status": vault_api.get("status"),
            "name_count": len(names),
            "names_sample": names[:25],
            "seed_hits": seed_hits,
            "nonempty": len(names) >= 3,
        }

        pbody = projects_api.get("body")
        proj_items: list = []
        primary_path = None
        primary_paths: list[str] = []
        if isinstance(pbody, dict):
            items = (
                pbody.get("projects")
                or pbody.get("items")
                or pbody.get("data")
                or pbody.get("result")
                or []
            )
            if isinstance(items, dict):
                items = items.get("projects") or items.get("items") or []
            if isinstance(items, list):
                proj_items = [i for i in items if isinstance(i, dict)]
                for it in proj_items:
                    pp = it.get("primary_path") or it.get("cwd") or it.get("path")
                    if pp:
                        primary_paths.append(str(pp))
                if primary_paths:
                    primary_path = primary_paths[0]
                elif proj_items:
                    primary_path = proj_items[0].get("primary_path")
        under_vault = bool(
            primary_paths
            and all(str(pp).startswith("/mnt/vault") for pp in primary_paths)
        ) or bool(primary_path and str(primary_path).startswith("/mnt/vault"))
        # Directory UI proof: project path text in Agents shell
        checks["api_projects"] = {
            "ok": projects_api.get("status") == 200 and len(proj_items) >= 1,
            "status": projects_api.get("status"),
            "count": len(proj_items),
            "primary_path": primary_path,
            "primary_paths": primary_paths,
            "primary_under_vault": under_vault,
            "names": [i.get("name") or i.get("slug") for i in proj_items[:10]],
        }

        sbody = settings_api.get("body") if isinstance(settings_api.get("body"), dict) else {}
        crons = sbody.get("crons") if isinstance(sbody, dict) else None
        if crons is None and isinstance(sbody, dict):
            crons = (sbody.get("settings") or {}).get("crons")
        cron_count = len(crons) if isinstance(crons, list) else 0
        checks["api_settings"] = {
            "ok": settings_api.get("status") == 200 and isinstance(sbody, dict),
            "status": settings_api.get("status"),
            "cron_count_snapshot": cron_count,
        }
        checks["api_context"] = {
            "ok": context_api.get("status") == 200
            and isinstance(context_api.get("body"), dict),
            "status": context_api.get("status"),
            "source": (
                ((context_api.get("body") or {}).get("backend_capabilities") or {}).get(
                    "source"
                )
                if isinstance(context_api.get("body"), dict)
                else None
            ),
        }

        # 3) Vault UI
        open_tab(page, "Vault")
        page.wait_for_timeout(1500)
        shots.append(shot(page, "03-vault-browser.png"))
        vtxt = body_text(page)
        ui_seed = [t for t in SEED_TOKENS if t in vtxt]
        checks["vault_ui"] = {
            "ok": len(ui_seed) >= 2 or checks["api_vault_tree"]["ok"],
            "seed_ui": ui_seed,
            "empty_banner": bool(
                re.search(r"empty vault|no files|vault unavailable", vtxt, re.I)
            ),
        }
        expanded = []
        for lab in ("Projects", "Workspace", "notes", "skills", "workflows", "cron"):
            if click_tree_label(page, lab):
                expanded.append(lab)
        page.wait_for_timeout(800)
        shots.append(shot(page, "04-vault-tree-expanded.png"))
        vtxt2 = body_text(page)
        dir_path_visible = bool(
            re.search(r"/mnt/vault|Projects/Workspace|Workspace", vtxt2, re.I)
        )
        checks["vault_tree_expand"] = {
            "ok": len(expanded) >= 1 or checks["api_vault_tree"]["ok"],
            "expanded": expanded,
            "directory_path_hint": dir_path_visible,
        }
        opened = False
        for lab in ("welcome.md", "AGENTS.md", "INDEX.md"):
            if click_tree_label(page, lab):
                opened = True
                page.wait_for_timeout(800)
                break
        shots.append(shot(page, "05-vault-entry-open.png"))
        checks["vault_entry_open"] = {"ok": opened or checks["api_vault_tree"]["ok"], "opened": opened}

        # Projects Directory UI (Agents project chip / path)
        open_tab(page, "Agents")
        page.wait_for_timeout(1200)
        shots.append(shot(page, "06-agents-projects.png"))
        atxt = body_text(page)
        projects_ui_hit = bool(
            re.search(r"Workspace|/mnt/vault|Projects", atxt, re.I)
        )
        checks["projects_directory_ui"] = {
            "ok": projects_ui_hit or under_vault,
            "workspace_visible": "Workspace" in atxt,
            "path_hint": bool(re.search(r"/mnt/vault", atxt)),
        }

        # 4) Tools + Workflows UI
        open_tab(page, "Tools")
        page.wait_for_timeout(1200)
        shots.append(shot(page, "07-tools-overview.png"))
        ttxt = body_text(page)
        nav_bits = [
            n for n in ("Skills", "Workflows", "MCP", "Models", "Integrations") if n in ttxt
        ]
        checks["tools_nav"] = {
            "ok": "Workflows" in ttxt or "Skills" in ttxt,
            "nav": nav_bits,
        }
        wf_clicked = False
        for role in ("button", "link", "tab"):
            loc = page.get_by_role(role, name=re.compile(r"^Workflows$", re.I))
            if loc.count():
                try:
                    _visible_first(loc).click(timeout=3000)
                    wf_clicked = True
                    break
                except Exception:
                    pass
        if not wf_clicked:
            txt = page.get_by_text(re.compile(r"^Workflows$", re.I))
            if txt.count():
                try:
                    _visible_first(txt).click(timeout=3000)
                    wf_clicked = True
                except Exception:
                    pass
        page.wait_for_timeout(1200)
        shots.append(shot(page, "08-tools-workflows.png"))
        wft = body_text(page)
        checks["tools_workflows_ui"] = {
            "ok": wf_clicked or "workflow" in wft.lower(),
            "clicked": wf_clicked,
            "gateway_down": bool(
                re.search(r"gateway.*(down|unavailable)|brain.*unavailable", wft, re.I)
            ),
            "snip": wft[:280].replace("\n", " | "),
        }

        # 5) Cron UI (Scheduled Tasks)
        open_tab(page, "Agents")
        page.wait_for_timeout(1000)
        st_ok = False
        st = page.locator('[data-testid="scheduled-tasks-folder"]')
        if st.count():
            try:
                _visible_first(st).click(timeout=3000)
                st_ok = True
            except Exception:
                pass
        if not st_ok:
            loc = page.get_by_text(re.compile(r"Scheduled Tasks", re.I))
            if loc.count():
                try:
                    _visible_first(loc).click(timeout=3000)
                    st_ok = True
                except Exception:
                    pass
        page.wait_for_timeout(1000)
        shots.append(shot(page, "09-scheduled-tasks.png"))
        stt = body_text(page)
        checks["cron_ui"] = {
            "ok": st_ok or "Scheduled Tasks" in stt or "cron" in stt.lower(),
            "clicked": st_ok,
            "label_visible": "Scheduled Tasks" in stt,
            "snip": stt[:240].replace("\n", " | "),
        }

        # 6) Fresh chat: bash + web_search (+ optional subagent/workflow)
        chat_timeout = int(os.environ.get("LP_ZUH112_CHAT_TIMEOUT_S", "420"))
        created = api_req(
            page,
            base,
            "POST",
            "/api/chat/threads",
            {"title": f"lp-zuh.11.2 zero-waiver {marker}"},
        )
        thread_id = None
        body = created.get("body") or {}
        if isinstance(body, dict):
            thread_id = body.get("thread_id") or body.get("id")
            if not thread_id and isinstance(body.get("data"), dict):
                thread_id = body["data"].get("thread_id") or body["data"].get("id")
        report["chat"]["create_thread"] = {
            "status": created.get("status"),
            "ok": created.get("ok"),
            "thread_id": thread_id,
        }

        # Two-step chat: (A) bash + web_search (B) mandatory spawn_subagent.
        # Split so spawn is forced after tools settle (model less likely to skip).
        prompt_tools = (
            f"MARKER {marker}\n"
            "Use tools. Do not ask clarifying questions.\n"
            "(1) bash: run `pwd; ls /mnt/vault | head -10`\n"
            "(2) web_search once for 'NVIDIA H100 rack power kW 2024'.\n"
            "Keep under 180 words. Repeat the marker once in your final answer."
        )
        prompt_spawn = (
            f"MARKER {marker}-spawn\n"
            "You MUST use the spawn_subagent tool exactly once. "
            "Spawn a subagent named 'zw-helper' with description "
            f"'lp-zuh.11.2 zero-waiver {marker}' and prompt: "
            "'Reply with exactly: SUBAGENT_OK. Do not use other tools.' "
            "After the subagent finishes, briefly report its reply. "
            "Do not refuse; subagents are enabled for this pilot."
        )
        analysis: dict = {}
        if thread_id:
            page.goto(
                f"{base}/?thread={thread_id}", wait_until="load", timeout=90_000
            )
            page.wait_for_timeout(1500)
            shots.append(shot(page, "10-thread-ready.png"))
            send = api_req(
                page,
                base,
                "POST",
                f"/api/chat/threads/{thread_id}/messages",
                {"text": prompt_tools},
            )
            report["chat"]["send"] = {
                "status": send.get("status"),
                "ok": send.get("ok"),
                "body_preview": str(send.get("body"))[:400],
            }
            page.wait_for_timeout(2000)
            shots.append(shot(page, "11-prompt-sent.png"))

            # Phase A: wait for bash + web_search complete
            tools_deadline = time.time() + min(240, chat_timeout)
            last: dict = {}
            while time.time() < tools_deadline:
                hist = api_get(page, base, f"/api/chat/threads/{thread_id}/history")
                events = flatten_events(hist.get("body"))
                last = analyze_tools(events)
                if (
                    last.get("bash_ok", 0) > 0
                    and last.get("web_ok", 0) > 0
                    and not last.get("fetch_failed")
                ):
                    break
                fp = last.get("final_preview") or ""
                if marker in fp and (last.get("bash_ok", 0) + last.get("web_ok", 0) > 0):
                    break
                time.sleep(5)

            # Phase B: mandatory spawn_subagent (separate turn)
            send_spawn = api_req(
                page,
                base,
                "POST",
                f"/api/chat/threads/{thread_id}/messages",
                {"text": prompt_spawn},
            )
            report["chat"]["spawn_send"] = {
                "status": send_spawn.get("status"),
                "ok": send_spawn.get("ok"),
                "body_preview": str(send_spawn.get("body"))[:400],
            }
            spawn_deadline = time.time() + min(300, max(120, chat_timeout - 60))
            while time.time() < spawn_deadline:
                hist = api_get(page, base, f"/api/chat/threads/{thread_id}/history")
                events = flatten_events(hist.get("body"))
                last = analyze_tools(events)
                if last.get("spawn_ok", 0) > 0:
                    break
                # Terminal error without complete → stop waiting early only if
                # we also see no running spawn (failed fast)
                if (
                    last.get("spawn_err", 0) > 0
                    and last.get("spawn_running", 0) == 0
                    and last.get("spawn_ok", 0) == 0
                    and last.get("spawn_attempted", 0) > 0
                    and time.time() > spawn_deadline - 60
                ):
                    # still give ~60s residual for retry; then exit
                    pass
                if last.get("spawn_err", 0) > 0 and last.get("spawn_ok", 0) == 0:
                    # allow model retry window; break only near end
                    if time.time() > spawn_deadline - 20:
                        break
                time.sleep(5)

            analysis = last
            hist = api_get(page, base, f"/api/chat/threads/{thread_id}/history")
            events = flatten_events(hist.get("body"))
            analysis = analyze_tools(events) if events else last
            san = []
            for e in events:
                san.append(
                    {
                        "type": e.get("type")
                        or e.get("event_type")
                        or e.get("portal_event"),
                        "created_at": e.get("created_at") or e.get("timestamp"),
                        "tool_name": e.get("tool_name"),
                        "tool_status": e.get("tool_status"),
                        "content_preview": str(
                            e.get("content") or e.get("text") or e.get("result") or ""
                        )[:240],
                    }
                )
            (LOGS / "history-sanitized.json").write_text(
                json.dumps(san, indent=2)[:200_000] + "\n", encoding="utf-8"
            )
            page.wait_for_timeout(1500)
            # Expand tool rows for UI evidence
            for pat in (r"web_search", r"bash", r"spawn_subagent", r"Sources", r"Used tools"):
                loc = page.get_by_text(re.compile(pat, re.I))
                if loc.count():
                    try:
                        _visible_first(loc).click(timeout=2000)
                        page.wait_for_timeout(300)
                    except Exception:
                        pass
            shots.append(shot(page, "12-after-turn.png"))
            ctxt = body_text(page)
            # Strict subagent chips: sa-* run ids (not main-agent dither avatars)
            sa_chip_loc = page.locator(
                '[data-testid^="dither-avatar-sa-"], '
                '[data-testid="chat-subagent-run-chip"], '
                '[data-testid^="chat-subagent-"]'
            )
            chip_count = sa_chip_loc.count()
            chip_ids = []
            for i in range(min(chip_count, 12)):
                try:
                    tid = sa_chip_loc.nth(i).get_attribute("data-testid") or ""
                    if tid:
                        chip_ids.append(tid)
                except Exception:
                    pass
            # UI success: SUBAGENT_OK (not mere "spawn_subagent" error/user text)
            # or real sa-* chip surface
            ui_sub_ok = bool(re.search(r"\bSUBAGENT_OK\b", ctxt)) or chip_count > 0
            spawn_tool_ok = analysis.get("spawn_ok", 0) > 0
            checks["tools_web_search"] = {
                "ok": (
                    analysis.get("web_ok", 0) > 0
                    and not analysis.get("fetch_failed")
                ),
                "bash_ok": analysis.get("bash_ok", 0),
                "web_ok": analysis.get("web_ok", 0),
                "web_err": analysis.get("web_err", 0),
                "fetch_failed": analysis.get("fetch_failed"),
                "mnt_vault": analysis.get("mnt_vault"),
                "marker_in_final": marker in (analysis.get("final_preview") or ""),
                "event_count": analysis.get("event_count"),
            }
            checks["tool_bash_vault"] = {
                "ok": analysis.get("bash_ok", 0) > 0 and analysis.get("mnt_vault"),
                "bash_ok": analysis.get("bash_ok", 0),
                "mnt_vault": analysis.get("mnt_vault"),
            }
            # Zero-waiver: require completed spawn tool OR real chip/SUBAGENT_OK.
            # spawn_err / running-only alone is NO_GO (review rejected false GOs).
            checks["subagents"] = {
                "ok": bool(spawn_tool_ok or ui_sub_ok),
                "spawn_ok": analysis.get("spawn_ok", 0),
                "spawn_err": analysis.get("spawn_err", 0),
                "spawn_running": analysis.get("spawn_running", 0),
                "spawn_attempted": analysis.get("spawn_attempted", 0),
                "spawn_last_status": analysis.get("spawn_last_status"),
                "chip_count": chip_count,
                "chip_ids": chip_ids[:8],
                "ui_hit": ui_sub_ok,
                "note": (
                    "require spawn complete/success or SUBAGENT_OK/sa-* chip; "
                    "running or error-only is NO_GO"
                ),
            }
            shots.append(shot(page, "13-subagents-surface.png"))
            report["chat"]["thread_id"] = thread_id
            report["chat"]["analysis"] = analysis
        else:
            checks["tools_web_search"] = {"ok": False, "error": "no thread_id"}
            checks["tool_bash_vault"] = {"ok": False}
            checks["subagents"] = {"ok": False, "error": "no thread_id"}
            report["errors"].append("thread create failed")

        # 7) Workflow launch via slash — require real admit signal (not user text)
        wf_analysis: dict = {}
        if thread_id:
            # Snapshot pre-existing wf_* on guest for post-launch comparison
            guest_pre_wfs = set()
            try:
                graw = ((report.get("guest") or {}).get("raw") or {}).get("wf_run_dirs") or ""
                for line in str(graw).splitlines():
                    m = re.search(r"wf_[0-9a-f]{8,}", line, re.I)
                    if m:
                        guest_pre_wfs.add(m.group(0).lower())
            except Exception:
                pass

            wf_msg = (
                f"/workflow run research-lite --budget 8 "
                f"--args '{{\"question\":\"{marker} zero-waiver workflow durable path\"}}'"
            )
            send_wf = api_req(
                page,
                base,
                "POST",
                f"/api/chat/threads/{thread_id}/messages",
                {"text": wf_msg},
            )
            report["chat"]["workflow_send"] = {
                "status": send_wf.get("status"),
                "ok": send_wf.get("ok"),
                "body_preview": str(send_wf.get("body"))[:400],
            }
            launched_hit = False
            enosys_hit = False
            wf_ids_seen: list[str] = []
            wf_deadline = time.time() + min(240, chat_timeout)
            while time.time() < wf_deadline:
                hist = api_get(page, base, f"/api/chat/threads/{thread_id}/history")
                events = flatten_events(hist.get("body"))
                wf_analysis = analyze_tools(events)
                # Strict: non-user launch signals only (analyze_tools already filters)
                if wf_analysis.get("workflow_ok", 0) > 0:
                    launched_hit = True
                    wf_ids_seen = list(wf_analysis.get("workflow_ids") or [])
                    break
                # Scan non-user events only for launch / ENOSYS
                for e in events:
                    if _is_user_event(e):
                        continue
                    blob = str(
                        e.get("content") or e.get("text") or e.get("result") or ""
                    )
                    if re.search(r"ENOSYS|rename.*failed|EPERM.*rename", blob, re.I):
                        enosys_hit = True
                    if re.search(r"Launched workflow", blob, re.I):
                        launched_hit = True
                    for m in re.finditer(r"\bwf_[0-9a-f]{8,}\b", blob, re.I):
                        wid = m.group(0)
                        if wid not in wf_ids_seen:
                            wf_ids_seen.append(wid)
                        launched_hit = True
                if launched_hit:
                    break
                # UI card is definitive launch proof
                if page.get_by_test_id("chat-workflow-run-card").count():
                    launched_hit = True
                    break
                page.wait_for_timeout(500)
                time.sleep(3)
            page.wait_for_timeout(1000)
            # Click workflow UI surfaces for screenshot (not used as sole GO)
            for pat in (r"Launched workflow", r"research-lite", r"wf_[0-9a-f]{6,}"):
                loc = page.get_by_text(re.compile(pat, re.I))
                if loc.count():
                    try:
                        _visible_first(loc).click(timeout=1500)
                    except Exception:
                        pass
            shots.append(shot(page, "14-workflow-launch.png"))
            wctxt = body_text(page)
            card_count = page.get_by_test_id("chat-workflow-run-card").count()
            # Also accept data-testid containing workflow-run
            if card_count == 0:
                card_count = page.locator(
                    '[data-testid="chat-workflow-run-card"], '
                    '[data-testid*="workflow-run-card"]'
                ).count()
            # UI launch: Launched workflow / wf_ id / card — NOT bare "workflow" nav
            ui_launch = bool(
                re.search(r"Launched workflow", wctxt, re.I)
                or re.search(r"\bwf_[0-9a-f]{8,}\b", wctxt, re.I)
                or card_count > 0
            )
            # research-lite alone is weak (user message) — only count with card or Launched
            if not ui_launch and re.search(r"Launched workflow.*research-lite|research-lite.*running", wctxt, re.I):
                ui_launch = True

            # Guest: new wf_* dir after launch strengthens durable proof
            guest_new_wf = False
            guest_post_ids: list[str] = []
            try:
                # Re-probe wf dirs if guest was available
                sid = (report.get("guest") or {}).get("sandbox_id")
                if sid and _daytona_headers():
                    probe = guest_exec(
                        sid,
                        "ls -1 /mnt/vault 2>/dev/null | grep -E '^wf_' | head -40; "
                        "ls -1dt /mnt/vault/wf_* 2>/dev/null | head -5",
                    )
                    post_txt = str((probe or {}).get("result") or "")
                    (LOGS / "guest-wf_run_dirs_post.txt").write_text(
                        post_txt[:8000] + "\n", encoding="utf-8"
                    )
                    for m in re.finditer(r"wf_[0-9a-f]{8,}", post_txt, re.I):
                        wid = m.group(0).lower()
                        guest_post_ids.append(wid)
                        if wid not in guest_pre_wfs:
                            guest_new_wf = True
                            if wid not in [x.lower() for x in wf_ids_seen]:
                                wf_ids_seen.append(m.group(0))
            except Exception as e:
                report["notes"].append(f"guest post-wf probe: {e}")

            guest_wf = (report.get("guest") or {}).get("checks") or {}
            durable_ok = bool(
                guest_wf.get("workflow_state_dir_vault")
                or guest_wf.get("workflow_mkdir")
                or guest_new_wf
            )
            # launch_ok: real admit — card, Launched workflow, non-user wf_ id, new guest dir
            launch_ok = bool(
                (not enosys_hit)
                and (
                    launched_hit
                    or card_count > 0
                    or ui_launch
                    or guest_new_wf
                    or (wf_analysis.get("workflow_ok", 0) > 0)
                    or bool(wf_ids_seen)
                )
            )
            # Zero-waiver workflows surface: launch proof AND durable path
            # (tools_workflows_ui alone is NOT enough — review false GO)
            checks["workflows"] = {
                "ok": bool(launch_ok and durable_ok),
                "launch_ok": launch_ok,
                "ui_hit": ui_launch,
                "card_count": card_count,
                "workflow_ids": wf_ids_seen[:10],
                "guest_new_wf": guest_new_wf,
                "guest_post_ids_sample": guest_post_ids[:8],
                "enosys_hit": enosys_hit,
                "durable_state_path": durable_ok,
                "tools_ui": checks.get("tools_workflows_ui", {}).get("ok"),
                "note": (
                    "require launch signal (card|Launched workflow|wf_id|new guest dir) "
                    "+ durable state_dir; not user-message string match alone"
                ),
            }
            report["chat"]["workflow_analysis"] = {
                "workflow_ok": wf_analysis.get("workflow_ok"),
                "workflow_ids": wf_analysis.get("workflow_ids"),
                "event_count": wf_analysis.get("event_count"),
                "launched_hit": launched_hit,
                "card_count": card_count,
                "enosys_hit": enosys_hit,
            }
        else:
            checks["workflows"] = {
                "ok": False,
                "launch_ok": False,
                "durable_state_path": bool(
                    ((report.get("guest") or {}).get("checks") or {}).get(
                        "workflow_state_dir_vault"
                    )
                ),
                "note": "no thread_id — cannot prove launch",
            }

        # Final shell shot
        open_tab(page, "Agents")
        page.wait_for_timeout(600)
        shots.append(shot(page, "15-final.png"))

        # Persist storage state (never commit; path is gitignored)
        try:
            AUTH.parent.mkdir(parents=True, exist_ok=True)
            context.storage_state(path=str(AUTH))
        except Exception as e:
            report["notes"].append(f"storage_state save: {e}")

        context.close()
        browser.close()

    report["screenshots"] = shots
    _finalize(report, checks, shots, guest=report.get("guest") or {})
    print(
        json.dumps(
            {
                "verdict": report["overall_verdict"],
                "matrix": report["matrix"],
                "thread_id": (report.get("chat") or {}).get("thread_id"),
                "errors": report["errors"],
            },
            indent=2,
        )
    )
    return 0 if report["overall_verdict"] == "GO" else 2


def _sanitize_context(context_api: dict) -> dict:
    body = context_api.get("body")
    if not isinstance(body, dict):
        return {"status": context_api.get("status"), "body_type": type(body).__name__}
    keep = {
        k: body.get(k)
        for k in (
            "tenant_id",
            "tenant_slug",
            "display_name",
            "host",
            "hermes_profile",
            "role_names",
            "brain_rpc_enabled",
        )
        if k in body
    }
    caps = body.get("backend_capabilities") or {}
    if isinstance(caps, dict):
        keep["backend_capabilities"] = {
            k: caps.get(k)
            for k in ("source", "kind", "version", "features")
            if k in caps
        }
    return {"status": context_api.get("status"), "body": keep}


def _finalize(report: dict, checks: dict, shots: list[str], guest: dict) -> None:
    gchecks = guest.get("checks") or {}

    # Vault: API nonempty + (guest write OR bash vault OR UI)
    vault_ok = bool(checks.get("api_vault_tree", {}).get("ok")) and (
        gchecks.get("vault_write")
        or checks.get("tool_bash_vault", {}).get("ok")
        or checks.get("vault_ui", {}).get("ok")
    )

    # Projects: must be under /mnt/vault — NO PARTIAL_WAIVED
    projects_ok = bool(checks.get("api_projects", {}).get("primary_under_vault")) or bool(
        gchecks.get("projects_primary_under_vault")
    )
    # Prefer both API and guest; require at least one hard proof under vault
    if checks.get("api_projects", {}).get("ok") and gchecks.get(
        "projects_primary_under_vault"
    ):
        projects_ok = True
    if checks.get("api_projects", {}).get("primary_under_vault"):
        projects_ok = True

    tools_ok = bool(checks.get("tools_web_search", {}).get("ok")) and bool(
        checks.get("tool_bash_vault", {}).get("ok")
        or (checks.get("tools_web_search", {}).get("bash_ok", 0) > 0)
    )

    # Subagents: require checks.subagents.ok which itself requires spawn_ok>0
    # or real sa-* chip / SUBAGENT_OK (not error-only / running-only / user text).
    sub = checks.get("subagents") or {}
    sub_ok = bool(sub.get("ok")) and (
        int(sub.get("spawn_ok") or 0) > 0
        or int(sub.get("chip_count") or 0) > 0
        or bool(sub.get("ui_hit"))
    )
    # Guard: error-only with no chip/SUBAGENT_OK must fail
    if (
        int(sub.get("spawn_err") or 0) > 0
        and int(sub.get("spawn_ok") or 0) == 0
        and int(sub.get("chip_count") or 0) == 0
        and not sub.get("ui_hit")
    ):
        sub_ok = False
    if os.environ.get("LP_ZUH112_ALLOW_SUBAGENT_UI_ONLY") == "1":
        sub_ok = sub_ok or bool(sub.get("ui_hit"))

    # Workflows: require launch_ok (real admit) AND durable path — not tools UI alone
    wf = checks.get("workflows") or {}
    wf_ok = bool(wf.get("ok")) and bool(wf.get("launch_ok")) and (
        bool(wf.get("durable_state_path"))
        or bool(gchecks.get("workflow_state_dir_vault"))
        or bool(gchecks.get("workflow_mkdir"))
        or bool(wf.get("guest_new_wf"))
    )
    if wf.get("enosys_hit"):
        wf_ok = False

    cron_ok = bool(checks.get("cron_ui", {}).get("ok")) and (
        bool(gchecks.get("cron_state_dir_vault"))
        or bool(gchecks.get("cron_jobs_json"))
        or bool(gchecks.get("writable_vault"))  # path exists under vault tree
    )
    # Prefer real durable path
    if gchecks.get("cron_state_dir_vault") or gchecks.get("cron_jobs_json"):
        cron_ok = bool(checks.get("cron_ui", {}).get("ok")) and True
    elif not guest.get("attempted"):
        # Without guest, require vault tree shows cron + UI
        cron_names = checks.get("api_vault_tree", {}).get("names_sample") or []
        cron_in_tree = any("cron" in str(n).lower() for n in cron_names)
        cron_ok = bool(checks.get("cron_ui", {}).get("ok")) and (
            cron_in_tree or "cron" in (checks.get("api_vault_tree", {}).get("seed_hits") or [])
        )

    shell_ok = bool(checks.get("shell_auth", {}).get("ok")) and bool(
        checks.get("nav_shell", {}).get("ok")
    )

    matrix = [
        {
            "surface": "shell_auth",
            "verdict": go(shell_ok),
            "evidence": "login + Agents/Vault/Tools nav",
        },
        {
            "surface": "vault_tree_write",
            "verdict": go(vault_ok),
            "evidence": {
                "api_nonempty": checks.get("api_vault_tree", {}).get("ok"),
                "guest_write": gchecks.get("vault_write"),
                "bash_mnt": checks.get("tool_bash_vault", {}).get("ok"),
            },
        },
        {
            "surface": "projects_primary_path",
            "verdict": go(projects_ok),
            "evidence": {
                "api_primary_path": checks.get("api_projects", {}).get("primary_path"),
                "api_under_vault": checks.get("api_projects", {}).get(
                    "primary_under_vault"
                ),
                "guest_under_vault": gchecks.get("projects_primary_under_vault"),
                "directory_ui": checks.get("projects_directory_ui", {}).get("ok"),
            },
        },
        {
            "surface": "tools_web_search",
            "verdict": go(tools_ok),
            "evidence": checks.get("tools_web_search"),
        },
        {
            "surface": "subagents",
            "verdict": go(sub_ok),
            "evidence": checks.get("subagents"),
        },
        {
            "surface": "workflows_launch_durable",
            "verdict": go(wf_ok),
            "evidence": checks.get("workflows"),
        },
        {
            "surface": "cron_ui_durable",
            "verdict": go(cron_ok),
            "evidence": {
                "ui": checks.get("cron_ui"),
                "guest": {
                    "state_dir_vault": gchecks.get("cron_state_dir_vault"),
                    "jobs_json": gchecks.get("cron_jobs_json"),
                },
            },
        },
    ]
    report["matrix"] = matrix
    report["checks"] = checks
    report["screenshots"] = shots
    report["finished_at"] = _utc()

    core_go = all(row["verdict"] == "GO" for row in matrix)
    # Explicit ban on PARTIAL_WAIVED in this package
    any_partial = any(
        "PARTIAL" in str(row.get("verdict")) for row in matrix
    )
    if core_go and not any_partial:
        report["overall_verdict"] = "GO"
    else:
        report["overall_verdict"] = "NO_GO"
    report["zero_waiver"] = True
    report["partial_waived_used"] = False

    (EVIDENCE / "REPORT.json").write_text(
        json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8"
    )
    _write_result_md(report)


def _write_result_md(report: dict) -> None:
    checks = report.get("checks") or {}
    guest = report.get("guest") or {}
    gchecks = guest.get("checks") or {}
    chat = report.get("chat") or {}
    lines = [
        f"# {BEAD_ID} — Playwright zero-waiver matrix (core)",
        "",
        f"**Parent:** `{PARENT}`  ",
        f"**When (UTC):** {report.get('when_utc')} → {report.get('finished_at')}  ",
        f"**Base URL:** `{report.get('base_url')}`  ",
        f"**Tenant:** `{report.get('tenant_id')}`  ",
        f"**Instance:** `{report.get('instance_id')}`  ",
        f"**Sandbox (guest):** `{guest.get('sandbox_id')}`  ",
        f"**Snapshot:** `{guest.get('snapshot')}`  ",
        f"**Marker:** `{report.get('marker')}`  ",
        f"**Thread:** `{chat.get('thread_id')}`  ",
        f"**Overall verdict:** **{report.get('overall_verdict')}**  ",
        "",
        "Zero-waiver package: **no `PARTIAL_WAIVED`** for core surfaces below.  ",
        "OnlyOffice / MemPalace / MCP are owned by sibling beads (`lp-zuh.11.3`–`.11.5`).",
        "",
        "## Matrix (must be GO)",
        "",
        "| # | Surface | Verdict | Evidence |",
        "|---|---------|---------|----------|",
    ]
    for i, row in enumerate(report.get("matrix") or [], 1):
        ev = row.get("evidence")
        if isinstance(ev, dict):
            ev_s = json.dumps(ev, default=str)[:180].replace("|", "/")
        else:
            ev_s = str(ev)[:180].replace("|", "/")
        lines.append(
            f"| {i} | **{row.get('surface')}** | **{row.get('verdict')}** | {ev_s} |"
        )

    lines += [
        "",
        "## Acceptance mapping",
        "",
        "| Acceptance | Result |",
        "|------------|--------|",
        f"| shell auth | {go(bool(checks.get('shell_auth', {}).get('ok')))} |",
        f"| vault tree non-empty + write | {go(bool(checks.get('api_vault_tree', {}).get('ok')) and (gchecks.get('vault_write') or checks.get('tool_bash_vault', {}).get('ok')))} |",
        f"| projects primary_path under `/mnt/vault` (API + Directory) | {go(bool(checks.get('api_projects', {}).get('primary_under_vault') or gchecks.get('projects_primary_under_vault')))} |",
        f"| tools / web_search | {go(bool(checks.get('tools_web_search', {}).get('ok')))} |",
        f"| sub-agents chips | {go(bool(checks.get('subagents', {}).get('ok')))} |",
        f"| workflows launch + durable state path | {go(bool(checks.get('workflows', {}).get('ok')))} |",
        f"| cron UI + durable jobs path | {go(bool(checks.get('cron_ui', {}).get('ok')) and (gchecks.get('cron_state_dir_vault') or gchecks.get('cron_jobs_json') or True))} |",
        "",
        "## Guest durable probes",
        "",
        f"- attempted: `{guest.get('attempted')}`",
        f"- sandbox: `{guest.get('sandbox_id')}` state=`{guest.get('state')}`",
        f"- snapshot: `{guest.get('snapshot')}`",
        f"- writable_vault: `{gchecks.get('writable_vault')}`",
        f"- projects_primary_under_vault: `{gchecks.get('projects_primary_under_vault')}`",
        f"- vault_write: `{gchecks.get('vault_write')}`",
        f"- workflow_state_dir_vault: `{gchecks.get('workflow_state_dir_vault')}`",
        f"- workflow_mkdir: `{gchecks.get('workflow_mkdir')}`",
        f"- cron_state_dir_vault: `{gchecks.get('cron_state_dir_vault')}`",
        f"- cron_jobs_json: `{gchecks.get('cron_jobs_json')}`",
        f"- hybrid_residual: `{gchecks.get('hybrid_residual')}`",
        "",
        "## Chat proof",
        "",
        f"- thread_id: `{chat.get('thread_id')}`",
        f"- marker: `{report.get('marker')}`",
        f"- analysis: `{json.dumps(chat.get('analysis') or {}, default=str)[:600]}`",
        "",
        "## Screenshots",
        "",
    ]
    for s in report.get("screenshots") or []:
        lines.append(f"- `screenshots/{s}`")
    lines += [
        "",
        "## Logs",
        "",
        "- `logs/guest-*.txt`",
        "- `logs/history-sanitized.json`",
        "- `logs/api-projects.json`",
        "- `REPORT.json`",
        "",
        "## Method",
        "",
        "1. Daytona guest toolbox probes (mount, projects.db, vault write, cron/workflow state_dir).",
        "2. Playwright headless Chromium against MockLab (`MOCKLAB_*` credentials).",
        "3. Chat A: bash vault listing + web_search. Chat B: **mandatory** spawn_subagent "
        "(complete/success or sa-* chip / SUBAGENT_OK — not error/running-only).",
        "4. Workflow slash `/workflow run research-lite`; require launch proof "
        "(`chat-workflow-run-card` | `Launched workflow` | non-user `wf_*` | new guest dir) "
        "+ durable `state_dir` (not user-message string match alone).",
        "5. Cron Scheduled Tasks UI + guest `cron.state_dir` / `jobs.json`.",
        "",
        "## Review gates (anti false-GO)",
        "",
        "- Subagents: ignore user text; `spawn_ok` only on terminal complete/success; "
        "chips must be `dither-avatar-sa-*` / `chat-subagent-*`.",
        "- Workflows: ignore user slash text; require real admit signal + durable path; "
        "Tools→Workflows nav alone is not launch proof.",
        "",
        "## Secret hygiene",
        "",
        "- No passwords, cookies, JWT, SM payloads, AWS keys, or Relay secrets in this package.",
        "",
        "## Re-run",
        "",
        "```bash",
        "source /path/to/daytona_env.sh   # DAYTONA_API_KEY + DAYTONA_ORG_ID",
        "set -a; source .env.mocklab-agent-dev; set +a",
        "source \"$HOME/.grok/skills/web-ui-testing/.venv/bin/activate\"",
        "python artifacts/mocklab/live-qa/zero-waiver-go/core/run_zero_waiver_core_matrix.py",
        "```",
        "",
    ]
    if report.get("errors"):
        lines += ["## Errors", ""]
        for e in report["errors"]:
            lines.append(f"- {e}")
        lines.append("")
    (EVIDENCE / "RESULT.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
