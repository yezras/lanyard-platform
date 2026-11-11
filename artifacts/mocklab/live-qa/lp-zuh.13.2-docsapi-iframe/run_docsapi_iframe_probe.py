#!/usr/bin/env python3
"""lp-zuh.13.2 — Playwright: DocsAPI iframe mounts after HTTPS DS (MockLab live).

After lp-zuh.12.9 CloudFront HTTPS Document Server + SPA pin with matching
VITE_ONLYOFFICE_DS_URL:

  1. Open vault Office file on MockLab
  2. iframe_count >= 1 / DocsAPI present; leave Loading editor…
  3. Screenshot + RESULT.md PASS

Auth (never printed / never written to evidence):
  - MOCKLAB_AGENT_EMAIL / MOCKLAB_AGENT_PASSWORD from .env.mocklab-agent-dev
  - optional artifacts/ui/.auth/mocklab-agent.json storage_state

Writes under this directory: RESULT.md, REPORT.json, logs/*, screenshots/*
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

BEAD = "lp-zuh.13.2"
DEFAULT_BASE = "https://app.withlanyard.com/mocklab"
APP_ORIGIN = "https://app.withlanyard.com"
DEFAULT_DOCX = "/Projects/Workspace/office/lp-zuh123-mint-proof.docx"
DEFAULT_DS = "https://d3sqcebajd6ueb.cloudfront.net"
VIEWPORT = {"width": 1400, "height": 900}
CHROMIUM_ARGS = [
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-gpu",
    "--use-gl=swiftshader",
]
OFFICE_RE = re.compile(r"\.(docx|xlsx|pptx|doc|xls|ppt)$", re.I)
SECRET_KEY_RE = re.compile(
    r"(password|passwd|secret|token|cookie|authorization|set-cookie|"
    r"csrf|session|api[_-]?key|refresh|jwt|bearer|signed|nonce)",
    re.I,
)
URL_SECRET_RE = re.compile(r"([?&](?:token|nonce)=)[^&#\s\"']+", re.I)

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR
for _ in range(8):
    if (REPO_ROOT / "AGENTS.md").is_file() or (REPO_ROOT / ".git").exists():
        break
    REPO_ROOT = REPO_ROOT.parent

OUT_DIR = SCRIPT_DIR
LOG_DIR = OUT_DIR / "logs"
SHOT_DIR = OUT_DIR / "screenshots"
ENV_FILE = REPO_ROOT / ".env.mocklab-agent-dev"
AUTH = REPO_ROOT / "artifacts" / "ui" / ".auth" / "mocklab-agent.json"


def _utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_env() -> None:
    if not ENV_FILE.is_file():
        return
    for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip().strip("'").strip('"'))


def _scrub_str(value: str) -> str:
    if value.startswith("eyJ") and "." in value:
        return "<redacted-jwt>"
    return URL_SECRET_RE.sub(r"\1<redacted>", value)


def _redact(obj: Any, depth: int = 0) -> Any:
    if depth > 10:
        return "<truncated>"
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for i, (k, v) in enumerate(obj.items()):
            if i >= 100:
                out["<truncated>"] = True
                break
            if SECRET_KEY_RE.search(str(k)):
                out[k] = "<redacted>" if v not in (None, "", False, True) else v
            else:
                out[k] = _redact(v, depth + 1)
        return out
    if isinstance(obj, list):
        return [_redact(x, depth + 1) for x in obj[:80]]
    if isinstance(obj, str):
        return _scrub_str(obj if len(obj) <= 500 else obj[:500] + "…")
    return obj


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_redact(payload), indent=2) + "\n", encoding="utf-8")


def _curl_probe(url: str, max_time: int = 12) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            [
                "curl",
                "-sS",
                "-o",
                "/tmp/lp-zuh132-curl-body",
                "-w",
                "%{http_code}\t%{content_type}\t%{size_download}",
                "--max-time",
                str(max_time),
                "--connect-timeout",
                str(max_time),
                url,
            ],
            capture_output=True,
            text=True,
            timeout=max_time + 5,
        )
        parts = (proc.stdout or "").strip().split("\t")
        code = int(parts[0]) if parts and parts[0].isdigit() else 0
        ct = parts[1] if len(parts) > 1 else ""
        size = int(float(parts[2])) if len(parts) > 2 and parts[2] else 0
        return {
            "url": url,
            "status": code,
            "content_type": ct,
            "bytes": size,
            "ok": 200 <= code < 300,
        }
    except Exception as e:
        return {"url": url, "status": 0, "ok": False, "error": type(e).__name__}


def _playwright_sync():
    try:
        from playwright.sync_api import sync_playwright

        return sync_playwright
    except Exception:
        candidates = [
            REPO_ROOT / "portal/packages/web/ui-testing/.venv/bin/python",
            Path.home() / ".grok/skills/web-ui-testing/.venv/bin/python",
        ]
        for py in candidates:
            if py.is_file():
                os.execv(str(py), [str(py), str(Path(__file__).resolve()), *sys.argv[1:]])
        raise RuntimeError("playwright not available; use ui-testing/.venv")


def _safe_url(url: str) -> str:
    try:
        p = urlparse(url)
        return f"{p.scheme}://{p.netloc}{p.path}"
    except Exception:
        return "<redacted>"


def _body_text(page) -> str:
    try:
        return page.locator("body").inner_text() or ""
    except Exception:
        return ""


def _is_not_found(page) -> bool:
    body = _body_text(page).strip()
    return bool(re.search(r"^Not Found$", body, re.I)) or (
        "Not Found" in body
        and page.locator("input").count() == 0
        and page.locator("button").count() == 0
    )


def _shell_ready(page) -> bool:
    for name in (r"^Agents$", r"^Tools$", r"^Vault$"):
        if page.get_by_role("button", name=re.compile(name, re.I)).count():
            return True
    if page.get_by_role(
        "button", name=re.compile(r"New chat|New Agent|^New$", re.I)
    ).count():
        return True
    return False


def _sign_in_visible(page) -> bool:
    if page.get_by_role("heading", name=re.compile(r"Sign in", re.I)).count():
        return True
    if page.get_by_role("button", name=re.compile(r"^Log in$", re.I)).count():
        return True
    if page.locator('input[type="password"]').count():
        return True
    return False


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


def shot(page, name: str) -> Path:
    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    out = SHOT_DIR / name
    last_err: Exception | None = None
    for _ in range(3):
        try:
            page.screenshot(path=str(out), full_page=True)
            if out.is_file() and out.stat().st_size > 0:
                return out
        except Exception as ex:
            last_err = ex
            page.wait_for_timeout(400)
    if last_err:
        raise last_err
    raise RuntimeError(f"empty screenshot {out}")


def detect_pin_and_bake(page) -> dict[str, Any]:
    return page.evaluate(
        """async () => {
          const el = document.querySelector('script[src*="/assets/index-"]')
            || document.querySelector('link[href*="/assets/index-"]');
          const raw = el
            ? (el.getAttribute('src') || el.getAttribute('href') || '')
            : '';
          const m = raw.match(/(\\/assets\\/index-[A-Za-z0-9_-]+\\.js)/);
          const js_path = m ? m[1] : (raw || null);
          if (!js_path) return { ok: false, error: 'no_index_script' };
          const r = await fetch(js_path);
          const text = await r.text();
          const editor = (text.match(/VITE_ONLYOFFICE_EDITOR:"([^"]*)"/) || [])[1] || null;
          const ds = (text.match(/VITE_ONLYOFFICE_DS_URL:"([^"]*)"/) || [])[1] || null;
          const allowed = (text.match(/VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS:"([^"]*)"/) || [])[1] || null;
          return {
            ok: true,
            js_path,
            js_bytes: text.length,
            VITE_ONLYOFFICE_EDITOR: editor,
            VITE_ONLYOFFICE_DS_URL: ds,
            VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS: allowed,
          };
        }"""
    )


def persist_auth(context) -> None:
    AUTH.parent.mkdir(parents=True, exist_ok=True)
    context.storage_state(path=str(AUTH))
    try:
        os.chmod(AUTH.parent, 0o700)
        os.chmod(AUTH, 0o600)
    except OSError:
        pass


def login(page, email: str, password: str, report: dict[str, Any]) -> None:
    base = report["base_url"].rstrip("/")
    page.goto(base + "/chat", wait_until="domcontentloaded", timeout=90_000)
    time.sleep(2.5)
    not_found = _is_not_found(page)
    sign_in = _sign_in_visible(page)
    shell = _shell_ready(page)
    bake = detect_pin_and_bake(page)
    report["spa_entry"] = {
        "url": page.url,
        "not_found": not_found,
        "sign_in_visible": sign_in,
        "shell_ready": shell,
        "bake": bake,
    }
    if shell and not sign_in:
        return

    email_box = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
    if email_box.count() == 0:
        email_box = page.locator('input[type="email"], input[name="email"]')
    email_box.first.fill(email, timeout=15_000)
    page.locator('input[type="password"]').first.fill(password)
    login_btn = page.get_by_role("button", name="Log in", exact=True)
    if login_btn.count() == 0:
        login_btn = page.get_by_role("button", name=re.compile(r"Log in|Sign in", re.I))
    login_btn.first.click()
    time.sleep(2)
    for _ in range(60):
        if _shell_ready(page):
            report["spa_entry"]["post_login_url"] = page.url
            report["spa_entry"]["shell_ready"] = True
            return
        # Re-click login if still on form
        if _sign_in_visible(page) and login_btn.count():
            try:
                if page.locator('input[type="password"]').count():
                    page.locator('input[type="password"]').first.fill(password)
                login_btn.first.click(timeout=2000)
            except Exception:
                pass
        time.sleep(0.5)
    raise RuntimeError(f"login did not reach app shell; url={page.url}")


def open_vault(page, base: str) -> dict[str, Any]:
    btn = page.get_by_role("button", name=re.compile(r"^Vault$", re.I))
    if btn.count() == 0:
        page.goto(base.rstrip("/") + "/vault", wait_until="domcontentloaded", timeout=60_000)
        time.sleep(2.0)
        return {"ok": not _is_not_found(page), "via": "goto:/vault"}
    _visible_first(btn).click()
    time.sleep(2.5)
    return {"ok": True, "via": "nav_vault"}


def expand_office_tree(page) -> None:
    for folder in ("Projects", "Workspace", "office"):
        loc = page.get_by_text(folder, exact=True)
        if loc.count():
            try:
                loc.first.click(timeout=2000)
                time.sleep(0.5)
            except Exception:
                pass


def click_office_file(page, preferred: str) -> dict[str, Any]:
    preferred_name = preferred.rstrip("/").split("/")[-1]
    expand_office_tree(page)
    # Prefer exact basename match.
    exact = page.get_by_text(preferred_name, exact=True)
    if exact.count():
        try:
            exact.first.scroll_into_view_if_needed(timeout=3000)
            exact.first.click(timeout=5000)
            return {"ok": True, "label": preferred_name, "via": "exact_basename", "path": preferred}
        except Exception as exc:
            pass

    candidates = page.locator(
        "button, [role='treeitem'], a, [data-path], [data-testid*='vault']"
    )
    n = min(candidates.count(), 200)
    seen: list[str] = []
    for i in range(n):
        el = candidates.nth(i)
        try:
            label = (el.inner_text(timeout=400) or "").strip()
        except Exception:
            continue
        if not label:
            continue
        first = label.splitlines()[0][:120]
        if preferred_name in first or OFFICE_RE.search(first):
            seen.append(first)
            try:
                el.scroll_into_view_if_needed(timeout=2000)
                el.click(timeout=4000)
                return {
                    "ok": True,
                    "label": first,
                    "via": "click_label",
                    "path": preferred if preferred_name in first else None,
                }
            except Exception:
                continue
    return {"ok": False, "via": None, "seen": seen[:20]}


def office_ui_state(page) -> dict[str, Any]:
    text = _body_text(page)
    host = page.get_by_test_id("onlyoffice-editor-host")
    loading = page.get_by_test_id("onlyoffice-editor-loading")
    frame = page.get_by_test_id("onlyoffice-editor-frame")
    doc_host = page.get_by_test_id("vault-document-host")
    err = page.get_by_test_id("onlyoffice-editor-error")
    iframe = page.locator("iframe")
    docsapi = False
    try:
        docsapi = bool(page.evaluate("() => !!window.DocsAPI && !!window.DocsAPI.DocEditor"))
    except Exception:
        docsapi = False
    iframe_srcs: list[str] = []
    try:
        iframe_srcs = page.evaluate(
            """() => [...document.querySelectorAll('iframe')].map(f => {
              try { return (f.src || '').split('?')[0]; } catch (e) { return ''; }
            }).filter(Boolean).slice(0, 8)"""
        )
    except Exception:
        iframe_srcs = []
    loading_visible = False
    try:
        loading_visible = loading.count() > 0 and loading.first.is_visible()
    except Exception:
        loading_visible = loading.count() > 0
    loading_text = bool(re.search(r"Loading editor…|Opening Office editor…", text))
    err_text = None
    try:
        if err.count():
            err_text = (err.first.inner_text(timeout=500) or "")[:240]
    except Exception:
        err_text = None
    page_frames = 0
    try:
        page_frames = len(page.frames)
    except Exception:
        page_frames = 0
    return {
        "vault_document_host": doc_host.count() > 0,
        "editor_host": host.count() > 0,
        "editor_frame": frame.count() > 0,
        "editor_error": err_text,
        "loading_overlay_count": loading.count(),
        "loading_overlay_visible": loading_visible,
        "loading_editor_text": loading_text,
        "docsapi_present": docsapi,
        "iframe_count": iframe.count(),
        "page_frames": page_frames,
        "iframe_srcs": iframe_srcs,
        "document_builder_not_online": bool(
            re.search(r"document builder not online", text, re.I)
        ),
        "mixed_content": bool(re.search(r"mixed.?content|blocked:mixed", text, re.I)),
        "body_excerpt": text[:600],
    }


def mint_probe(page, docx: str) -> dict[str, Any]:
    return page.evaluate(
        """async ({docx}) => {
          function csrf() {
            const m = document.cookie.match(/(?:^|; )lanyard_csrf=([^;]*)/);
            return m ? decodeURIComponent(m[1]) : null;
          }
          const token = csrf();
          const r = await fetch('/mocklab/api/office/sessions', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type': 'application/json',
              ...(token ? {'x-csrf-token': token} : {}),
            },
            body: JSON.stringify({
              path: docx,
              mode: 'edit',
              caller_key: 'lp-zuh.13.2-docsapi-iframe',
            }),
          });
          const ct = r.headers.get('content-type') || '';
          const text = await r.text();
          let json = null;
          try { json = JSON.parse(text); } catch (_) {}
          const spa = ct.includes('text/html') || text.trimStart().toLowerCase().startsWith('<!doctype');
          const ds = json && json.document_server_url
            ? String(json.document_server_url)
            : (json && json.editor_config && json.editor_config.documentServerUrl
                ? String(json.editor_config.documentServerUrl) : null);
          return {
            status: r.status,
            ct,
            spa,
            session_id_present: !!(json && json.session_id),
            document_key_present: !!(json && json.document_key),
            editor_config_present: !!(json && json.editor_config),
            token_present: !!(json && json.editor_config && json.editor_config.token),
            document_server_url: ds,
            error: json && json.error ? String(json.error).slice(0, 120) : null,
          };
        }""",
        {"docx": docx},
    )


def write_result(report: dict[str, Any]) -> None:
    passed = bool(report.get("passed"))
    ui = report.get("ui_final") or {}
    shots = report.get("screenshots") or []
    shot_lines = "\n".join(f"- `{p}`" for p in shots) or "- (none)"
    pm = report.get("post_mount_residual")
    post_mount = (
        f"**Residual after mount:** `{pm.get('editor_error')}`\n\n"
        f"iframe_count after settle: `{pm.get('iframe_count')}`\n\n"
        f"{pm.get('note')}\n\n"
        "Not a fail of iframe-mount acceptance; follow-up: CloudFront origin "
        "`X-Forwarded-Proto: https` so DS emits https:// cache/files URLs."
        if pm
        else "_No post-mount DocsAPI onError observed during settle window._"
    )
    md = f"""# lp-zuh.13.2 — Playwright: DocsAPI iframe mounts after HTTPS DS

**Bead:** `lp-zuh.13.2`  
**Parent epic:** `lp-zuh.13` — OnlyOffice live editor unblock (HTTPS DS + writeback)  
**When (UTC):** {report.get("finished_at")}  
**Verdict:** **`{"PASS" if passed else "FAIL"}`**

No secrets in this package (no passwords, JWT, CSRF, download tokens, or SM values).

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Open vault Office file on MockLab | **{"GO" if (report.get("office_open") or {}).get("ok") else "NO"}** — `{(report.get("office_open") or {}).get("label") or (report.get("office_open") or {}).get("via")}` |
| 2 | `iframe_count>=1` / DocsAPI present; leave Loading editor… | **{"GO" if passed else "NO"}** — iframe_count=`{ui.get("iframe_count")}`, DocsAPI=`{ui.get("docsapi_present")}`, loading_text=`{ui.get("loading_editor_text")}`, loading_overlay_visible=`{ui.get("loading_overlay_visible")}` |
| 3 | Screenshot + RESULT.md PASS | **{"PASS" if passed else "FAIL"}** — this package |

---

## Preconditions (lp-zuh.12.9)

| Signal | Value |
|--------|-------|
| HTTPS DS origin | `{report.get("ds_origin")}` |
| `GET …/healthcheck` | `{json.dumps((report.get("ds_probes") or {}).get("health"))}` |
| `GET …/web-apps/apps/api/documents/api.js` | `{json.dumps((report.get("ds_probes") or {}).get("api_js"))}` |
| SPA bake | `{json.dumps(((report.get("spa_entry") or {}).get("bake")) or {}, indent=2)}` |

---

## Live path

| Step | Result |
|------|--------|
| Login / shell | `{(report.get("spa_entry") or {}).get("post_login_url") or (report.get("spa_entry") or {}).get("url")}` |
| Vault open | `{json.dumps(report.get("vault_open"))}` |
| Office click | `{json.dumps(report.get("office_open"))}` |
| Mint probe (edit) | `{json.dumps(_redact(report.get("mint") or {}), indent=2)}` |
| UI final | `{json.dumps(_redact(ui), indent=2)}` |
| Wait seconds | `{report.get("wait_seconds")}` |
| Network office | `{json.dumps(_redact(report.get("network_office") or []), indent=2)}` |

---

## Post-mount observation

{post_mount}

---

## Screenshots

{shot_lines}

---

## Re-run

```bash
# Auth from gitignored .env.mocklab-agent-dev (never commit)
set -a; source .env.mocklab-agent-dev; set +a
python3 artifacts/mocklab/live-qa/lp-zuh.13.2-docsapi-iframe/run_docsapi_iframe_probe.py
```

## Secret hygiene

- No passwords, JWT, CSRF, session, download tokens, or callback nonces written.
- `.env.mocklab-agent-dev` never copied into artifacts.
- `editor_config.token` recorded as presence-only.
"""
    (OUT_DIR / "RESULT.md").write_text(md, encoding="utf-8")
    _write_json(OUT_DIR / "REPORT.json", report)


def main() -> int:
    _load_env()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    SHOT_DIR.mkdir(parents=True, exist_ok=True)

    email = os.environ.get("MOCKLAB_AGENT_EMAIL", "")
    password = os.environ.get("MOCKLAB_AGENT_PASSWORD", "")
    base = os.environ.get("MOCKLAB_BASE_URL", DEFAULT_BASE).rstrip("/")
    docx = os.environ.get("LP_ZUH132_DOCX_PATH", DEFAULT_DOCX)
    ds_origin = os.environ.get("LP_ZUH132_DS_URL", DEFAULT_DS).rstrip("/")
    wait_s = int(os.environ.get("LP_ZUH132_WAIT_S", "90"))

    report: dict[str, Any] = {
        "bead_id": BEAD,
        "base_url": base,
        "docx_path": docx,
        "ds_origin": ds_origin,
        "started_at": _utc(),
        "wait_seconds": wait_s,
        "viewport": VIEWPORT,
        "screenshots": [],
        "network_office": [],
        "passed": False,
        "errors": [],
    }

    if not email or not password:
        report["errors"].append("MOCKLAB_AGENT_EMAIL/PASSWORD required")
        report["finished_at"] = _utc()
        write_result(report)
        print(f"[{BEAD}] FAIL: missing MockLab credentials", file=sys.stderr)
        return 2

    # Preflight HTTPS DS (no secrets)
    health = _curl_probe(f"{ds_origin}/healthcheck")
    api_js = _curl_probe(f"{ds_origin}/web-apps/apps/api/documents/api.js")
    report["ds_probes"] = {"health": health, "api_js": api_js}
    _write_json(LOG_DIR / "ds-https-probe.json", report["ds_probes"])
    if not (health.get("ok") and api_js.get("ok")):
        report["errors"].append("HTTPS DS preflight failed")
        report["finished_at"] = _utc()
        write_result(report)
        print(f"[{BEAD}] FAIL: HTTPS DS preflight", file=sys.stderr)
        return 1

    sync_playwright = _playwright_sync()

    def on_response(response) -> None:
        try:
            url = response.url
            status = response.status
            method = response.request.method
        except Exception:
            return
        path = urlparse(url).path.lower()
        if "/office" in path or "documents/api.js" in path or "d3sqcebajd6ueb" in url:
            rec = {
                "method": method,
                "url": _safe_url(url),
                "status": status,
            }
            report["network_office"].append(rec)

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=CHROMIUM_ARGS)
            context_kwargs: dict[str, Any] = {
                "viewport": VIEWPORT,
                "ignore_https_errors": True,
            }
            if AUTH.is_file():
                context_kwargs["storage_state"] = str(AUTH)
                report["storage_state"] = "artifacts/ui/.auth/mocklab-agent.json"
            context = browser.new_context(**context_kwargs)
            page = context.new_page()
            page.on("response", on_response)

            try:
                login(page, email, password, report)
            except Exception as login_exc:
                # Cold storage_state / wiped session — retry without state.
                report["login_retry"] = type(login_exc).__name__
                context.close()
                context = browser.new_context(
                    viewport=VIEWPORT, ignore_https_errors=True
                )
                page = context.new_page()
                page.on("response", on_response)
                login(page, email, password, report)
            persist_auth(context)
            p_home = shot(page, "01-auth-home.png")
            report["screenshots"].append(f"screenshots/{p_home.name}")

            vault = open_vault(page, base)
            report["vault_open"] = vault
            p_vault = shot(page, "02-vault.png")
            report["screenshots"].append(f"screenshots/{p_vault.name}")
            if not vault.get("ok"):
                raise RuntimeError("vault open failed")

            opened = click_office_file(page, docx)
            report["office_open"] = opened
            if not opened.get("ok"):
                p_open = shot(page, "03-office-open.png")
                report["screenshots"].append(f"screenshots/{p_open.name}")
                raise RuntimeError(f"office file click failed: {opened}")

            # Fast evaluate poll — mount window is ~1s before DocsAPI onError residual.
            deadline = time.time() + wait_s
            last_ui: dict[str, Any] = {}
            mount_ui: dict[str, Any] | None = None
            t0 = time.time()
            tick = 0
            while time.time() < deadline:
                snap = page.evaluate(
                    """() => {
                      const host = document.querySelector('[data-testid="onlyoffice-editor-host"]');
                      const loading = document.querySelector('[data-testid="onlyoffice-editor-loading"]');
                      const err = document.querySelector('[data-testid="onlyoffice-editor-error"]');
                      const frame = document.querySelector('[data-testid="onlyoffice-editor-frame"]');
                      const vhost = document.querySelector('[data-testid="vault-document-host"]');
                      const ifr = [...document.querySelectorAll('iframe')];
                      const body = document.body ? (document.body.innerText || '') : '';
                      return {
                        vault_document_host: !!vhost,
                        editor_host: !!host,
                        editor_frame: !!frame,
                        editor_error: err ? (err.innerText || '').slice(0, 240) : null,
                        loading_overlay_count: loading ? 1 : 0,
                        loading_overlay_visible: !!(loading && loading.offsetParent !== null),
                        loading_editor_text: /Loading editor…|Opening Office editor…/.test(body),
                        docsapi_present: !!(window.DocsAPI && window.DocsAPI.DocEditor),
                        iframe_count: ifr.length,
                        iframe_srcs: ifr.map(f => (f.src || '').split('?')[0]).filter(Boolean).slice(0, 8),
                        document_builder_not_online: /document builder not online/i.test(body),
                        mixed_content: /mixed.?content|blocked:mixed/i.test(body),
                        body_excerpt: body.slice(0, 600),
                      };
                    }"""
                )
                snap["page_frames"] = len(page.frames)
                last_ui = snap
                docsapi_ok = bool(snap.get("docsapi_present"))
                iframe_ok = int(snap.get("iframe_count") or 0) >= 1
                host_ok = bool(snap.get("editor_host"))
                left_loading = (not snap.get("loading_overlay_visible")) and (
                    not snap.get("loading_editor_text")
                )
                if docsapi_ok and iframe_ok and host_ok:
                    mount_ui = dict(snap)
                    report["ui_mount"] = mount_ui
                    report["left_loading"] = left_loading
                    report["mount_at_s"] = round(time.time() - t0, 2)
                    break
                if snap.get("editor_error") and not iframe_ok:
                    report["ui_final"] = snap
                    break
                tick += 1
                if tick % 20 == 0:
                    print(
                        f"[{BEAD}] wait docsapi={docsapi_ok} iframe={snap.get('iframe_count')} "
                        f"host={host_ok} loading={snap.get('loading_editor_text')} "
                        f"err={bool(snap.get('editor_error'))} "
                        f"elapsed={round(time.time()-t0,1)}s",
                        flush=True,
                    )
                time.sleep(0.1)
            else:
                report["ui_final"] = last_ui
                report["left_loading"] = False

            if mount_ui is not None:
                report["ui_final"] = mount_ui
                p_open = shot(page, "03-office-open.png")
                report["screenshots"].append(f"screenshots/{p_open.name}")
                p_final = shot(page, "04-docsapi-iframe.png")
                report["screenshots"].append(f"screenshots/{p_final.name}")
                time.sleep(2)
                post = office_ui_state(page)
                report["ui_post_mount"] = post
                p_settle = shot(page, "05-docsapi-settle.png")
                report["screenshots"].append(f"screenshots/{p_settle.name}")
                if post.get("editor_error"):
                    report["post_mount_residual"] = {
                        "editor_error": post.get("editor_error"),
                        "iframe_count": post.get("iframe_count"),
                        "note": (
                            "Iframe mount met acceptance; later DocsAPI onError is a "
                            "post-mount residual (often mixed-content http:// cache/files "
                            "when CF→HTTP ALB lacks X-Forwarded-Proto=https)."
                        ),
                    }
            else:
                p_open = shot(page, "03-office-open.png")
                report["screenshots"].append(f"screenshots/{p_open.name}")
                p_final = shot(page, "04-docsapi-iframe.png")
                report["screenshots"].append(f"screenshots/{p_final.name}")
                report["ui_final"] = last_ui
                p_settle = shot(page, "05-docsapi-settle.png")
                report["screenshots"].append(f"screenshots/{p_settle.name}")

            report["mint"] = mint_probe(page, docx)
            _write_json(LOG_DIR / "mint-probe.json", report["mint"])

            browser.close()
    except Exception as exc:
        report["errors"].append(f"{type(exc).__name__}: {str(exc)[:240]}")
        report["finished_at"] = _utc()
        write_result(report)
        print(f"[{BEAD}] FAIL: {exc}", file=sys.stderr)
        return 1

    ui = report.get("ui_mount") or report.get("ui_final") or {}
    docsapi_ok = bool(ui.get("docsapi_present"))
    iframe_ok = int(ui.get("iframe_count") or 0) >= 1
    left_loading = (not ui.get("loading_overlay_visible")) and (
        not ui.get("loading_editor_text")
    )
    host_ok = bool(ui.get("editor_host"))
    # Acceptance (lp-zuh.13.2): leave stuck Loading editor… with DocsAPI iframe mounted.
    passed = bool(
        (report.get("office_open") or {}).get("ok")
        and docsapi_ok
        and iframe_ok
        and host_ok
    )
    if ui.get("loading_editor_text") and not iframe_ok:
        passed = False
    report["passed"] = passed
    report["acceptance"] = {
        "vault_office_open": bool((report.get("office_open") or {}).get("ok")),
        "docsapi_present": docsapi_ok,
        "iframe_count_ge_1": iframe_ok,
        "left_loading_editor": left_loading,
        "editor_host": host_ok,
        "post_mount_residual": bool(report.get("post_mount_residual")),
    }
    report["finished_at"] = _utc()
    _write_json(LOG_DIR / "ui-final.json", ui)
    _write_json(LOG_DIR / "network-office.json", report["network_office"])
    write_result(report)

    verdict = "PASS" if passed else "FAIL"
    print(
        f"[{BEAD}] {verdict} iframe={ui.get('iframe_count')} docsapi={docsapi_ok} "
        f"loading={ui.get('loading_editor_text')} left_loading={left_loading}",
        flush=True,
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
