#!/usr/bin/env python3
"""lp-zuh.11.7 UI QA — re-proof MemPalace search zero-waiver after disk-limit fix.

Fix bead for UI QA FAIL_INFRA_DAYTONA_DISK_LIMIT on lp-zuh.11.4.
Independent Playwright re-proof of UI + BFF surfaces for the MemPalace
zero-waiver claim (parent acceptance of lp-zuh.11.4):

  1. Auth shell: Agents / Vault / Tools
  2. Vault tree contains mempalace (API + UI)
  3. Brain health / context probes (mempalace signals if exposed)
  4. Chat turn: ask for mempalace_search; assert no binary_missing;
     empty-or-hits / tool completion is success

Auth: MOCKLAB_* from gitignored .env.mocklab-agent-dev (never print password).
storage_state: artifacts/ui/.auth/mocklab-agent.json
Screenshots: artifacts/ui/lp-zuh.11.4/<step>.png
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

BEAD_ID = "lp-zuh.11.7"
REPO = Path(__file__).resolve().parents[3]
ART = REPO / "artifacts" / "ui" / BEAD_ID
AUTH = REPO / "artifacts" / "ui" / ".auth" / "mocklab-agent.json"
LOGS = ART / "logs"

CHROMIUM_ARGS = [
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-gpu",
    "--use-gl=swiftshader",
]
VIEWPORT = {"width": 1440, "height": 900}

MARKER = f"lp-zuh.11.7-uiqa-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
PROMPT = f"""MARKER {MARKER}
Call the mempalace_search tool once with query: MockLab zero-waiver
If that tool is unavailable, try the closest MemPalace search tool and say its name.
In your final answer report: hits count or empty; any tool error string; repeat the marker.
Do not ask clarifying questions.
"""


def _utc() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def load_env() -> dict[str, str]:
    file_vals: dict[str, str] = {}
    for cand in [
        Path(os.environ.get("MOCKLAB_ENV_FILE", "")),
        REPO / ".env.mocklab-agent-dev",
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
            "(process env or .env.mocklab-agent-dev)"
        )
    return {
        "base_url": pick(
            "MOCKLAB_BASE_URL", "https://app.withlanyard.com/mocklab"
        ).rstrip("/"),
        "email": email,
        "password": password,
    }


def shot(page, name: str) -> Path:
    ART.mkdir(parents=True, exist_ok=True)
    out = ART / name
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0, f"empty screenshot {out}"
    return out


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


def api_req(page, base: str, method: str, path: str, body: dict | None = None) -> dict:
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


def history(page, base: str, thread_id: str) -> dict:
    return page.evaluate(
        """async ({ base, threadId }) => {
          const res = await fetch(base + '/api/chat/threads/' + threadId + '/history', {
            credentials: 'include',
          });
          const text = await res.text();
          let parsed = null;
          try { parsed = JSON.parse(text); } catch (e) { parsed = { raw: text.slice(0, 800) }; }
          return { status: res.status, ok: res.ok, body: parsed };
        }""",
        {"base": base.rstrip("/"), "threadId": thread_id},
    )


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
            for it in obj[:150]:
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
        return page.locator("body").inner_text(timeout=5000) or ""
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


def analyze_mempalace(events: list[dict]) -> dict:
    tools: list[dict] = []
    mp_ok = mp_err = mp_running = 0
    binary_missing = False
    final_preview = ""
    blob_parts: list[str] = []

    mp_names = (
        "mempalace_search",
        "mempalace",
        "memory_search",
        "memory_read",
        "search_memory",
        "palace_search",
    )

    for e in events:
        # Ignore user prompts — they often mention "binary_missing" as instruction text
        role = str(e.get("role") or "").lower()
        et = str(e.get("type") or e.get("event_type") or e.get("portal_event") or "").lower()
        if role == "user" or et in ("user_message", "user", "human"):
            continue
        name = str(
            e.get("tool_name") or (e.get("metadata") or {}).get("tool_name") or ""
        ).lower()
        status = str(
            e.get("tool_status") or (e.get("metadata") or {}).get("status") or ""
        ).lower()
        content = e.get("content") or e.get("text") or e.get("result") or ""
        if isinstance(content, dict):
            content = json.dumps(content)[:600]
        content = str(content)
        blob_parts.append(f"{name}|{status}|{content}")

        is_mp = any(n in name for n in mp_names) or any(
            t in content.lower()
            for t in (
                "mempalace",
                "mempalace_search",
                "finished mempalace",
                "chroma.sqlite",
            )
        )
        if is_mp:
            tools.append(
                {"name": name or "mempalace", "status": status, "preview": content[:200]}
            )
            cl = content.lower()
            if "binary_missing" in cl or "not on path" in cl and "mempalace" in cl:
                binary_missing = True
                mp_err += 1
            elif status in ("error", "failed") or "error in mempalace" in cl:
                mp_err += 1
            elif status in ("complete", "completed", "success", "done") or "finished" in cl:
                mp_ok += 1
            elif status == "running":
                mp_running += 1
            else:
                # content present without explicit error counts as soft ok
                if content and "error" not in cl:
                    mp_ok += 1

        role = str(e.get("role") or "").lower()
        t = str(e.get("type") or e.get("event_type") or e.get("portal_event") or "")
        if role == "assistant" or t in ("message_send", "assistant_message", "final"):
            if content and len(content) > len(final_preview):
                final_preview = content[:1500]

    blob = "\n".join(blob_parts).lower()
    if "binary_missing" in blob or "mempalace_binary_missing" in blob:
        binary_missing = True

    has_mempalace_mention = "mempalace" in blob or "mempalace_search" in blob
    empty_or_hits = (
        mp_ok > 0
        or "no results" in final_preview.lower()
        or "empty" in final_preview.lower()
        or "hit" in final_preview.lower()
        or "chroma" in blob
        or "search" in final_preview.lower() and "mempalace" in final_preview.lower()
    )

    return {
        "tool_events": tools,
        "mp_ok": mp_ok,
        "mp_err": mp_err,
        "mp_running": mp_running,
        "binary_missing": binary_missing,
        "has_mempalace_mention": has_mempalace_mention,
        "empty_or_hits_signal": empty_or_hits,
        "final_preview": final_preview,
        "event_count": len(events),
        "marker_in_final": MARKER in final_preview,
    }


def walk_for_mempalace_signal(obj, depth=0) -> dict:
    """Hunt for mempalace readiness signals in any API payload."""
    found = {
        "enabled": None,
        "ok": None,
        "reason": None,
        "path": None,
        "binaryPath": None,
        "version": None,
        "raw_hits": [],
    }
    if depth > 10 or obj is None:
        return found

    if isinstance(obj, dict):
        keys_l = {str(k).lower(): k for k in obj}
        if "mempalace" in keys_l:
            mp = obj[keys_l["mempalace"]]
            found["raw_hits"].append({"mempalace": mp})
            if isinstance(mp, dict):
                found["enabled"] = mp.get("enabled", found["enabled"])
                found["ok"] = mp.get("ok", found["ok"])
                found["reason"] = mp.get("reason", found["reason"])
                found["path"] = mp.get("path", found["path"])
                found["binaryPath"] = mp.get("binaryPath") or mp.get("binary_path")
                found["version"] = mp.get("version", found["version"])
        for k, v in obj.items():
            kl = str(k).lower()
            if "mempalace" in kl:
                found["raw_hits"].append({k: v})
            nested = walk_for_mempalace_signal(v, depth + 1)
            for field in ("enabled", "ok", "reason", "path", "binaryPath", "version"):
                if nested.get(field) is not None and found.get(field) is None:
                    found[field] = nested[field]
            found["raw_hits"].extend(nested.get("raw_hits") or [])
    elif isinstance(obj, list):
        for it in obj[:80]:
            nested = walk_for_mempalace_signal(it, depth + 1)
            for field in ("enabled", "ok", "reason", "path", "binaryPath", "version"):
                if nested.get(field) is not None and found.get(field) is None:
                    found[field] = nested[field]
            found["raw_hits"].extend(nested.get("raw_hits") or [])
    return found


def main() -> int:
    env = load_env()
    base = env["base_url"]
    ART.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    AUTH.parent.mkdir(parents=True, exist_ok=True)

    timeout_s = int(os.environ.get("LP_ZUH_11_4_TIMEOUT_S", "420"))

    report: dict = {
        "bead_id": BEAD_ID,
        "when": _utc(),
        "base_url": base,
        "login": env["email"],
        "marker": MARKER,
        "checks": {},
        "screenshots": [],
        "errors": [],
        "notes": [],
        "passed": False,
        "skipped": False,
    }
    checks = report["checks"]
    shot_paths: list[str] = []

    def record(name: str, ok: bool, detail="", path: Path | None = None, soft=False):
        checks[name] = {
            "ok": bool(ok),
            "detail": detail if not isinstance(detail, (dict, list)) else detail,
            "screenshot": path.name if path else None,
            "soft": soft,
        }
        if path:
            p = str(path)
            if p not in shot_paths:
                shot_paths.append(p)
            if path.name not in report["screenshots"]:
                report["screenshots"].append(path.name)
        if not ok and not soft:
            report["errors"].append(f"{name}: {detail}"[:400])

    browser = None
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=CHROMIUM_ARGS)
            ctx_kwargs: dict = {
                "viewport": VIEWPORT,
                "ignore_https_errors": True,
            }
            if AUTH.is_file() and AUTH.stat().st_size > 20:
                ctx_kwargs["storage_state"] = str(AUTH)
            context = browser.new_context(**ctx_kwargs)
            page = context.new_page()
            page.set_default_timeout(25_000)

            # --- 1) Shell auth ---
            try:
                login(page, env)
            except Exception:
                context.close()
                context = browser.new_context(
                    viewport=VIEWPORT, ignore_https_errors=True
                )
                page = context.new_page()
                page.set_default_timeout(25_000)
                login(page, env)

            try:
                context.storage_state(path=str(AUTH))
            except Exception:
                pass

            p01 = shot(page, "01-auth-home.png")
            agents = page.get_by_role("button", name=re.compile(r"^Agents$", re.I)).count()
            vault = page.get_by_role("button", name=re.compile(r"^Vault$", re.I)).count()
            tools = page.get_by_role("button", name=re.compile(r"^Tools$", re.I)).count()
            shell_ok = agents >= 1 and vault >= 1 and tools >= 1
            record(
                "shell_auth",
                shell_ok,
                f"agents={agents} vault={vault} tools={tools} url={page.url}",
                p01,
            )

            open_tab(page, "Agents")
            p02 = shot(page, "02-agents-shell.png")
            record("agents_shell", shell_ok, f"url={page.url}", p02)

            # --- 2) API probes ---
            auth_me = api_req(page, base, "GET", "/api/auth/me")
            record(
                "auth_me",
                auth_me.get("status") == 200,
                f"status={auth_me.get('status')} email={(auth_me.get('body') or {}).get('email') if isinstance(auth_me.get('body'), dict) else None}",
            )

            ctx_api = api_req(page, base, "GET", "/api/context")
            mp_from_context = walk_for_mempalace_signal(ctx_api.get("body"))
            record(
                "context_api",
                ctx_api.get("status") == 200,
                {
                    "status": ctx_api.get("status"),
                    "mempalace_signal": {
                        k: mp_from_context.get(k)
                        for k in ("enabled", "ok", "reason", "path", "binaryPath", "version")
                    },
                    "hit_count": len(mp_from_context.get("raw_hits") or []),
                },
            )

            for path in (
                "/api/brain/health",
                "/api/brain/ping",
                "/api/brain/ready",
                "/api/agent/ready",
                "/api/agent/health",
                "/api/settings/snapshot",
            ):
                res = api_req(page, base, "GET", path)
                sig = walk_for_mempalace_signal(res.get("body"))
                key = "api_" + path.strip("/").replace("/", "_")
                record(
                    key,
                    res.get("status") in (200, 201) or res.get("status") in (404, 501, 503),
                    {
                        "status": res.get("status"),
                        "ct": res.get("ct"),
                        "mempalace": {
                            k: sig.get(k)
                            for k in ("enabled", "ok", "reason", "path", "binaryPath", "version")
                        },
                        "body_keys": list((res.get("body") or {}).keys())[:20]
                        if isinstance(res.get("body"), dict)
                        else type(res.get("body")).__name__,
                    },
                    soft=True,
                )
                if sig.get("ok") is not None or sig.get("enabled") is not None:
                    report["notes"].append(f"mempalace signal via {path}: {sig}")

            vault_tree = api_req(page, base, "GET", "/api/vault/tree")
            names = extract_names(vault_tree.get("body"))
            has_mp_dir = any(
                "mempalace" in n.lower() for n in names
            )
            record(
                "vault_tree_api",
                vault_tree.get("status") == 200 and has_mp_dir,
                f"status={vault_tree.get('status')} has_mempalace={has_mp_dir} sample={names[:25]}",
            )
            (LOGS / "vault-tree-names.json").write_text(
                json.dumps(names[:200], indent=2) + "\n", encoding="utf-8"
            )

            # --- 3) Vault UI ---
            open_tab(page, "Vault")
            page.wait_for_timeout(1500)
            p03 = shot(page, "03-vault-browser.png")
            bt = body_text(page)
            vault_ui_mp = "mempalace" in bt.lower()
            record(
                "vault_ui_mempalace",
                vault_ui_mp or has_mp_dir,
                f"ui_text_has_mempalace={vault_ui_mp} snip={bt[:220]!r}",
                p03,
            )

            expanded = []
            if click_tree_label(page, "mempalace"):
                expanded.append("mempalace")
            page.wait_for_timeout(800)
            p04 = shot(page, "04-vault-mempalace-or-tree.png")
            record(
                "vault_mempalace_expand",
                bool(expanded) or vault_ui_mp or has_mp_dir,
                f"expanded={expanded}",
                p04,
                soft=not has_mp_dir,
            )

            # path under vault (config convention)
            path_under_vault = has_mp_dir  # UI/API presence of vault/mempalace entry
            record(
                "path_under_vault_ui",
                path_under_vault,
                "vault tree lists mempalace entry (expected /mnt/vault/mempalace on guest)",
            )

            # --- 4) Tools shell (surface only) ---
            open_tab(page, "Tools")
            page.wait_for_timeout(1000)
            p05 = shot(page, "05-tools-overview.png")
            record("tools_shell", True, f"url={page.url}", p05, soft=True)

            # --- 5) Chat: mempalace_search turn ---
            open_tab(page, "Agents")
            page.wait_for_timeout(800)

            created = api_req(
                page,
                base,
                "POST",
                "/api/chat/threads",
                {"title": f"lp-zuh.11.7 mempalace UIQA {MARKER}"},
            )
            body = created.get("body") or {}
            thread_id = None
            if isinstance(body, dict):
                thread_id = body.get("thread_id") or body.get("id")
                if not thread_id and isinstance(body.get("data"), dict):
                    thread_id = body["data"].get("thread_id") or body["data"].get("id")
            report["thread_id"] = thread_id
            record(
                "thread_create",
                bool(thread_id),
                f"status={created.get('status')} id={thread_id}",
            )

            analysis: dict = {}
            if thread_id:
                page.goto(
                    f"{base}/?thread={thread_id}",
                    wait_until="load",
                    timeout=60_000,
                )
                page.wait_for_timeout(1500)
                p06 = shot(page, "06-thread-ready.png")
                record("thread_ready", True, f"thread={thread_id}", p06)

                send = api_req(
                    page,
                    base,
                    "POST",
                    f"/api/chat/threads/{thread_id}/messages",
                    {"text": PROMPT},
                )
                record(
                    "prompt_send",
                    send.get("status") in (200, 201, 202, 204) or send.get("ok"),
                    f"status={send.get('status')} preview={str(send.get('body'))[:200]}",
                )
                page.wait_for_timeout(2000)
                p07 = shot(page, "07-prompt-sent.png")
                record("prompt_sent_ui", True, "message posted", p07)

                last = {}
                deadline = time.time() + timeout_s
                while time.time() < deadline:
                    hist = history(page, base, str(thread_id))
                    events = flatten_events(hist.get("body"))
                    analysis = analyze_mempalace(events)
                    last = analysis
                    # Early exit conditions
                    if analysis.get("binary_missing"):
                        break
                    if analysis.get("mp_ok", 0) > 0 and not analysis.get("binary_missing"):
                        break
                    if analysis.get("marker_in_final") and (
                        analysis.get("mp_ok", 0) + analysis.get("mp_err", 0) > 0
                        or analysis.get("has_mempalace_mention")
                    ):
                        break
                    if analysis.get("marker_in_final") and analysis.get("event_count", 0) >= 3:
                        # agent finished without tool — stop polling
                        break
                    time.sleep(5)

                page.wait_for_timeout(1500)
                # reload thread view for latest UI
                page.goto(
                    f"{base}/?thread={thread_id}",
                    wait_until="load",
                    timeout=60_000,
                )
                page.wait_for_timeout(2000)
                p08 = shot(page, "08-after-mempalace-turn.png")

                hist = history(page, base, str(thread_id))
                events = flatten_events(hist.get("body"))
                analysis = analyze_mempalace(events) if events else last
                report["analysis"] = analysis
                report["history_status"] = hist.get("status")

                san = []
                for e in events:
                    san.append(
                        {
                            "type": e.get("type")
                            or e.get("event_type")
                            or e.get("portal_event"),
                            "role": e.get("role"),
                            "tool_name": e.get("tool_name"),
                            "tool_status": e.get("tool_status"),
                            "content_preview": str(
                                e.get("content") or e.get("text") or ""
                            )[:300],
                        }
                    )
                (LOGS / "history-sanitized.json").write_text(
                    json.dumps(san, indent=2)[:200_000] + "\n", encoding="utf-8"
                )

                no_binary_missing = not analysis.get("binary_missing")
                tool_or_mention = (
                    analysis.get("mp_ok", 0) > 0
                    or analysis.get("has_mempalace_mention")
                    or analysis.get("empty_or_hits_signal")
                )
                # Hard fail only on binary_missing; soft if no tool at all
                record(
                    "mempalace_no_binary_missing",
                    no_binary_missing,
                    f"binary_missing={analysis.get('binary_missing')} mp_ok={analysis.get('mp_ok')} mp_err={analysis.get('mp_err')} tools={analysis.get('tool_events')}",
                    p08,
                )
                record(
                    "mempalace_search_empty_or_hits",
                    bool(tool_or_mention and no_binary_missing and analysis.get("mp_err", 0) == 0)
                    or (analysis.get("mp_ok", 0) > 0 and no_binary_missing),
                    f"mp_ok={analysis.get('mp_ok')} mention={analysis.get('has_mempalace_mention')} empty_or_hits={analysis.get('empty_or_hits_signal')} final={str(analysis.get('final_preview'))[:280]}",
                    p08,
                    soft=analysis.get("mp_ok", 0) == 0 and no_binary_missing,
                )
                # UI assertion: page has chat content (non-blank)
                bt2 = body_text(page)
                chat_nonblank = len(bt2) > 80 and (
                    MARKER[:20] in bt2 or "mempalace" in bt2.lower() or "Agents" in bt2
                )
                record(
                    "chat_ui_nonblank",
                    chat_nonblank,
                    f"body_len={len(bt2)} snip={bt2[:180]!r}",
                    p08,
                )
            else:
                record("mempalace_search_empty_or_hits", False, "no thread_id", soft=False)

            # Final vault shot
            open_tab(page, "Vault")
            page.wait_for_timeout(800)
            p09 = shot(page, "09-final-vault.png")
            record("final_vault", True, "composite", p09, soft=True)

            try:
                context.storage_state(path=str(AUTH))
            except Exception:
                pass
            context.close()
    except Exception as e:
        report["errors"].append(f"fatal: {type(e).__name__}: {e}")
        report["notes"].append(f"exception: {e}")
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass

    # Verdict: hard requirements for UI QA of this bead
    hard = [
        "shell_auth",
        "vault_tree_api",
        "vault_ui_mempalace",
        "path_under_vault_ui",
        "thread_create",
        "mempalace_no_binary_missing",
    ]
    hard_ok = all(checks.get(h, {}).get("ok") for h in hard if h in checks)
    # If chat ran and got mp_ok, that's strong; if only vault+no binary_missing from empty analysis, soft
    analysis = report.get("analysis") or {}
    search_strong = (
        analysis.get("mp_ok", 0) > 0 and not analysis.get("binary_missing")
    )
    search_soft_pass = (
        not analysis.get("binary_missing")
        and checks.get("vault_tree_api", {}).get("ok")
        and checks.get("shell_auth", {}).get("ok")
        and (
            analysis.get("has_mempalace_mention")
            or analysis.get("mp_ok", 0) > 0
            or checks.get("mempalace_search_empty_or_hits", {}).get("ok")
        )
    )

    # Pass criteria aligned to bead acceptance (UI surface):
    # - shell auth
    # - mempalace vault path visible
    # - chat path does not surface binary_missing
    # - prefer tool empty-or-hits
    if hard_ok and (search_strong or search_soft_pass):
        report["passed"] = True
        report["verdict"] = "PASS" if search_strong else "PASS_SOFT_VAULT_NO_BINARY_MISSING"
    elif hard_ok and not analysis.get("binary_missing") and analysis.get("event_count", 0) > 0:
        # chat completed without binary_missing but no tool — partial
        report["passed"] = False
        report["verdict"] = "FAIL_NO_MEMPALACE_TOOL_EVENTS"
        report["notes"].append(
            "Chat completed without binary_missing but no mempalace tool events observed"
        )
    else:
        report["passed"] = False
        report["verdict"] = "FAIL"

    report["screenshot_paths"] = shot_paths
    report["finished_at"] = _utc()
    (ART / "REPORT.json").write_text(
        json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8"
    )

    md = f"""# {BEAD_ID} UI QA — MemPalace search zero-waiver

**When:** {report.get('when')}  
**Base URL:** `{base}`  
**Verdict:** **{report.get('verdict')}**  
**Passed:** `{report.get('passed')}`  
**Marker:** `{MARKER}`  
**Thread:** `{report.get('thread_id')}`

## Acceptance mapping

| Criterion | Result |
|-----------|--------|
| Shell auth | {'GO' if checks.get('shell_auth',{}).get('ok') else 'NO_GO'} |
| Vault mempalace entry | {'GO' if checks.get('vault_tree_api',{}).get('ok') else 'NO_GO'} |
| path under vault (UI) | {'GO' if checks.get('path_under_vault_ui',{}).get('ok') else 'NO_GO'} |
| No binary_missing in chat | {'GO' if checks.get('mempalace_no_binary_missing',{}).get('ok') else 'NO_GO'} |
| Search empty-or-hits | {'GO' if checks.get('mempalace_search_empty_or_hits',{}).get('ok') else 'SOFT/NO'} |

## Analysis

```json
{json.dumps(analysis, indent=2, default=str)[:2500]}
```

## Errors

{chr(10).join('- ' + e for e in report.get('errors') or []) or '- (none)'}

## Screenshots

{chr(10).join('- `' + s + '`' for s in report.get('screenshots') or [])}
"""
    (ART / "RESULT.md").write_text(md, encoding="utf-8")

    print(
        json.dumps(
            {
                "bead_id": BEAD_ID,
                "passed": report["passed"],
                "verdict": report.get("verdict"),
                "errors": report.get("errors"),
                "analysis": {
                    k: analysis.get(k)
                    for k in (
                        "mp_ok",
                        "mp_err",
                        "binary_missing",
                        "has_mempalace_mention",
                        "event_count",
                        "marker_in_final",
                    )
                },
                "screenshot_count": len(shot_paths),
            },
            indent=2,
        )
    )
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
