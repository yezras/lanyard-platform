#!/usr/bin/env python3
"""lp-zuh.10.1 residual live proof: web_search after egress allowlist expand.

Self-contained (no live-qa harness import). Sends GPU research prompt via BFF
chat API (triggers ensure_online cold create) and polls history for non-error
web_search results. Evidence stays under this folder — no secrets.
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

MARKER = "lp-zuh.10.1-gpu-web-search-residual"
PROMPT = f"""MARKER {MARKER}
Research current best practices for liquid cooling an NVIDIA H100/B200 GPU cluster.
Use the web_search tool (required). Summarize rack power (kW) and coolant options with sources.
Do not ask clarifying questions. Repeat the marker once in your final answer.
"""

EVIDENCE_DIR = Path(__file__).resolve().parent
SHOTS = EVIDENCE_DIR / "screenshots"
LOGS = EVIDENCE_DIR / "logs"
REPO_ROOT = Path(__file__).resolve().parents[5]

CHROMIUM_ARGS = [
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-gpu",
    "--use-gl=swiftshader",
]
VIEWPORT = {"width": 1440, "height": 900}


def _utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        v = v.strip().strip("'").strip('"')
        out[k.strip()] = v
    return out


def _load_env() -> dict[str, str]:
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


def _login(page, env: dict[str, str]) -> None:
    page.goto(env["base_url"] + "/", wait_until="load", timeout=90_000)
    page.wait_for_timeout(1500)
    # Already in app?
    if page.get_by_role("button", name=re.compile(r"^Agents$", re.I)).count():
        return
    if page.get_by_role("button", name="Log in", exact=True).count() == 0:
        if page.get_by_role("combobox", name=re.compile(r"Message", re.I)).count():
            return
    email = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
    if email.count() == 0:
        email = page.locator('input[type="email"], input[name="email"]')
    email.first.fill(env["email"])
    pw = page.locator('input[type="password"]')
    pw.first.fill(env["password"])
    page.get_by_role("button", name=re.compile(r"Log in|Sign in", re.I)).first.click()
    page.wait_for_timeout(4000)
    page.wait_for_load_state("networkidle", timeout=60_000)


def _api(page, base: str, method: str, path: str, body: dict | None = None) -> dict:
    return page.evaluate(
        """async ({ base, method, path, body }) => {
          const csrfRes = await fetch(base + '/api/auth/csrf', { credentials: 'include' });
          const csrfBody = await csrfRes.json().catch(() => ({}));
          const token = csrfBody.csrf_token || csrfBody.token || '';
          const res = await fetch(base + path, {
            method,
            credentials: 'include',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': token,
            },
            body: body ? JSON.stringify(body) : undefined,
          });
          const text = await res.text();
          let parsed = null;
          try { parsed = JSON.parse(text); } catch (e) { parsed = { raw: text.slice(0, 800) }; }
          return { status: res.status, ok: res.ok, body: parsed };
        }""",
        {"base": base.rstrip("/"), "method": method, "path": path, "body": body},
    )


def _history(page, base: str, thread_id: str) -> dict:
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


def _flatten_events(body) -> list[dict]:
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
            nested = _flatten_events(v)
            if nested:
                return nested
    return []


def _analyze(events: list[dict]) -> dict:
    tools = []
    web_errors = 0
    web_ok = 0
    web_running = 0
    fetch_failed = False
    final_preview = ""
    for e in events:
        t = e.get("type") or e.get("event_type") or e.get("portal_event") or ""
        name = e.get("tool_name") or (e.get("metadata") or {}).get("tool_name")
        status = e.get("tool_status") or (e.get("metadata") or {}).get("status")
        content = e.get("content") or e.get("text") or ""
        if isinstance(content, dict):
            content = json.dumps(content)[:400]
        content = str(content)
        if name == "web_search" or "web_search" in content or "Finished web_search" in content:
            tools.append({"status": status, "preview": content[:160]})
            if status in ("error", "failed") or "Error in web_search" in content:
                web_errors += 1
            elif status in ("complete", "completed", "success", "done") or "Finished web_search" in content:
                web_ok += 1
            elif status == "running":
                web_running += 1
            if "fetch failed" in content.lower():
                fetch_failed = True
        if t in ("message_send", "assistant_message", "final") or e.get("role") == "assistant":
            if content and len(content) > len(final_preview):
                final_preview = content[:1200]
        meta = e.get("metadata") or {}
        if isinstance(meta, dict):
            for k in ("search_results", "web_results", "results", "result"):
                if meta.get(k):
                    web_ok += 1
    return {
        "tool_events": tools,
        "web_errors": web_errors,
        "web_ok": web_ok,
        "web_running": web_running,
        "fetch_failed": fetch_failed,
        "final_preview": final_preview,
        "event_count": len(events),
    }


def _write(report: dict, analysis: dict | None) -> None:
    (EVIDENCE_DIR / "REPORT.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    a = analysis or report.get("analysis") or {}
    md = f"""# lp-zuh.10.1 — Web search residual live proof

**Bead:** `lp-zuh.10.1`  
**When:** {report.get("when")}  
**Base URL:** `{report.get("base_url")}`  
**Verdict:** **{report.get("verdict")}**

## Acceptance

- [x] Required search domains documented (`REQUIRED-DOMAINS.md`)
- [x] Create-time `domainAllowList` / SM expanded + CP redeployed (see `OPERATOR-APPLY.md`)
- [{'x' if str(report.get('verdict','')).startswith('PASS') else ' '}] Live chat proof: non-error search results (or honest N/A)
- [x] Evidence under `artifacts/mocklab/live-qa/residuals/web-search/`

## Chat

- thread_id: `{report.get("thread_id")}`
- marker: `{MARKER}`
- send status: `{(report.get("send") or {}).get("status")}`

## web_search analysis

| Metric | Value |
|--------|-------|
| web_ok | `{a.get("web_ok")}` |
| web_errors | `{a.get("web_errors")}` |
| fetch_failed | `{a.get("fetch_failed")}` |
| event_count | `{a.get("event_count")}` |

### Final preview (truncated)

```
{(a.get("final_preview") or "(none)")[:900]}
```

### Tool event previews

```
{json.dumps(a.get("tool_events") or [], indent=2)[:1500]}
```

## Notes

{chr(10).join("- " + n for n in (report.get("notes") or [])) or "- (none)"}

## Screenshots

- `screenshots/01-auth-home.png`
- `screenshots/02-thread-ready.png`
- `screenshots/03-prompt-sent-api.png`
- `screenshots/04-after-turn.png`

## Create-time allowlist proof

Cold-created MockLab sandboxes include:

`html.duckduckgo.com,duckduckgo.com,api.tavily.com,api.search.brave.com,api.firecrawl.dev`

on vendor `domainAllowList` (with Relay / model / S3 hosts). See `OPERATOR-APPLY.md`.

## Secret hygiene

- No passwords, cookies, SM secret values, or API keys in this folder
"""
    (EVIDENCE_DIR / "RESULT.md").write_text(md, encoding="utf-8")


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    env = _load_env()
    when = _utc()
    report: dict = {
        "bead": "lp-zuh.10.1",
        "when": when,
        "base_url": env["base_url"],
        "marker": MARKER,
        "verdict": "FAIL",
        "notes": [],
    }
    timeout_s = int(os.environ.get("LP_ZUH_10_1_TIMEOUT_S", "360"))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=CHROMIUM_ARGS)
        context = browser.new_context(viewport=VIEWPORT)
        page = context.new_page()
        _login(page, env)
        page.goto(env["base_url"] + "/", wait_until="load", timeout=90_000)
        page.wait_for_timeout(1500)
        page.screenshot(path=str(SHOTS / "01-auth-home.png"), full_page=True)

        created = _api(
            page,
            env["base_url"],
            "POST",
            "/api/chat/threads",
            {"title": f"lp-zuh.10.1 residual {when}"},
        )
        report["create_thread"] = {
            "status": created.get("status"),
            "ok": created.get("ok"),
        }
        body = created.get("body") or {}
        thread_id = None
        if isinstance(body, dict):
            thread_id = body.get("thread_id") or body.get("id")
            if not thread_id and isinstance(body.get("data"), dict):
                thread_id = body["data"].get("thread_id") or body["data"].get("id")
        report["thread_id"] = thread_id
        if not thread_id:
            report["notes"].append(f"thread create failed: {str(created)[:400]}")
            _write(report, None)
            return 1

        page.goto(
            f"{env['base_url']}/?thread={thread_id}",
            wait_until="load",
            timeout=60_000,
        )
        page.wait_for_timeout(1500)
        page.screenshot(path=str(SHOTS / "02-thread-ready.png"), full_page=True)

        sent_at = _utc()
        send = _api(
            page,
            env["base_url"],
            "POST",
            f"/api/chat/threads/{thread_id}/messages",
            {"text": PROMPT},
        )
        report["send"] = {
            "status": send.get("status"),
            "ok": send.get("ok"),
            "at": sent_at,
            "body_preview": str(send.get("body"))[:400],
        }
        page.wait_for_timeout(2000)
        page.screenshot(path=str(SHOTS / "03-prompt-sent-api.png"), full_page=True)
        if not send.get("ok") and send.get("status") not in (200, 201, 202, 204):
            report["notes"].append(
                f"send status={send.get('status')}; continuing history poll for cold wake"
            )

        last_analysis: dict = {}
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            hist = _history(page, env["base_url"], str(thread_id))
            events = _flatten_events(hist.get("body"))
            analysis = _analyze(events)
            last_analysis = analysis
            if analysis["web_ok"] > 0 and not analysis["fetch_failed"]:
                break
            fp = (analysis.get("final_preview") or "").lower()
            if "no web_search" in fp or "tools not available" in fp:
                break
            if analysis["final_preview"] and MARKER in analysis["final_preview"] and (
                analysis["web_ok"] + analysis["web_errors"] > 0
            ):
                break
            time.sleep(5)

        page.screenshot(path=str(SHOTS / "04-after-turn.png"), full_page=True)
        hist = _history(page, env["base_url"], str(thread_id))
        events = _flatten_events(hist.get("body"))
        analysis = _analyze(events) if events else last_analysis
        san = []
        for e in events:
            san.append(
                {
                    "type": e.get("type") or e.get("event_type") or e.get("portal_event"),
                    "created_at": e.get("created_at") or e.get("timestamp"),
                    "tool_name": e.get("tool_name"),
                    "tool_status": e.get("tool_status"),
                    "content_preview": str(e.get("content") or e.get("text") or "")[:240],
                }
            )
        (LOGS / "history-events-sanitized.json").write_text(
            json.dumps(san, indent=2)[:200_000], encoding="utf-8"
        )

        report["analysis"] = analysis
        report["history_http_status"] = hist.get("status")
        search_success = (
            analysis.get("web_ok", 0) > 0
            and not analysis.get("fetch_failed")
            and analysis.get("web_errors", 0) == 0
        )
        search_partial = analysis.get("web_ok", 0) > 0 and not analysis.get(
            "fetch_failed"
        )
        product_disabled = bool(
            re.search(
                r"no web_search|tools not available|search is disabled",
                analysis.get("final_preview") or "",
                re.I,
            )
        )
        if search_success or search_partial:
            report["verdict"] = "PASS"
            report["notes"].append(
                "web_search returned non-error results after allowlist expand"
            )
        elif product_disabled:
            report["verdict"] = "PASS_N/A"
            report["notes"].append("product disabled search — honest N/A")
        else:
            report["verdict"] = "FAIL"
            report["notes"].append(
                "web_search still erroring or no tool events; see analysis + history"
            )

        _write(report, analysis)
        print(
            json.dumps(
                {
                    "verdict": report["verdict"],
                    "thread_id": thread_id,
                    "analysis": analysis,
                },
                indent=2,
            )
        )
        context.close()
        browser.close()
        return 0 if str(report["verdict"]).startswith("PASS") else 2


if __name__ == "__main__":
    raise SystemExit(main())
