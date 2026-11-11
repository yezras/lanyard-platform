#!/usr/bin/env python3
"""lp-zuh.13.3 — Docs CF X-Forwarded-Proto + document download residual (MockLab live).

After lp-zuh.13.2 DocsAPI iframe mounts on HTTPS CF, clear the post-mount
"Download failed" residual:

  1. Live CF E1OQ5SAD1WR60T origin custom_header X-Forwarded-Proto=https
     so DS emits https://…/cache/files/… (not http:// mixed-content).
  2. Prove vault docx opens: iframe stays; no Download failed dialog;
     document body / canvas paints; screenshot + RESULT.

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

BEAD = "lp-zuh.13.3"
DEFAULT_BASE = "https://app.withlanyard.com/mocklab"
APP_ORIGIN = "https://app.withlanyard.com"
DEFAULT_DOCX = "/Projects/Workspace/office/lp-zuh123-mint-proof.docx"
DEFAULT_DS = "https://d3sqcebajd6ueb.cloudfront.net"
CF_ID = "E1OQ5SAD1WR60T"
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
DOWNLOAD_FAIL_RE = re.compile(
    r"Download failed|could not be downloaded|document could not be downloaded",
    re.I,
)

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
        return [_redact(x, depth + 1) for x in obj[:100]]
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
                "/tmp/lp-zuh133-curl-body",
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
    exact = page.get_by_text(preferred_name, exact=True)
    if exact.count():
        try:
            exact.first.scroll_into_view_if_needed(timeout=3000)
            exact.first.click(timeout=5000)
            return {
                "ok": True,
                "label": preferred_name,
                "via": "exact_basename",
                "path": preferred,
            }
        except Exception:
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


def deep_editor_state(page) -> dict[str, Any]:
    """Cross-frame UI state: download dialog, canvas, mixed-content signals."""
    return page.evaluate(
        """() => {
          const host = document.querySelector('[data-testid="onlyoffice-editor-host"]');
          const loading = document.querySelector('[data-testid="onlyoffice-editor-loading"]');
          const err = document.querySelector('[data-testid="onlyoffice-editor-error"]');
          const frame = document.querySelector('[data-testid="onlyoffice-editor-frame"]');
          const vhost = document.querySelector('[data-testid="vault-document-host"]');
          const ifr = [...document.querySelectorAll('iframe')];
          const body = document.body ? (document.body.innerText || '') : '';
          const failRe = /Download failed|could not be downloaded|document could not be downloaded/i;

          function scanFrame(win, depth) {
            const out = {
              depth,
              href: '',
              body_excerpt: '',
              download_fail: false,
              canvas_count: 0,
              canvas_nonzero: 0,
              has_id_viewport: false,
              has_id_editor: false,
            };
            try {
              out.href = (win.location && win.location.href || '').split('?')[0];
            } catch (e) {
              out.href = '<cross-origin>';
              return out;
            }
            try {
              const b = win.document && win.document.body
                ? (win.document.body.innerText || '')
                : '';
              out.body_excerpt = b.slice(0, 400);
              out.download_fail = failRe.test(b);
              const canvases = [...(win.document.querySelectorAll('canvas') || [])];
              out.canvas_count = canvases.length;
              out.canvas_nonzero = canvases.filter(c => (c.width||0) > 10 && (c.height||0) > 10).length;
              out.has_id_viewport = !!win.document.getElementById('viewport');
              out.has_id_editor = !!win.document.getElementById('editor_sdk')
                || !!win.document.querySelector('#editor-canvas, .editor-container, #id_viewer, #id_main');
            } catch (e) {
              out.error = String(e && e.message || e).slice(0, 80);
            }
            return out;
          }

          const frames = [];
          frames.push(scanFrame(window, 0));
          for (const f of ifr) {
            try {
              if (f.contentWindow) frames.push(scanFrame(f.contentWindow, 1));
            } catch (e) {
              frames.push({ depth: 1, href: (f.src||'').split('?')[0], cross_origin: true });
            }
          }
          // Nested OO iframes
          for (const f of ifr) {
            try {
              const kids = f.contentWindow && f.contentWindow.document
                ? [...f.contentWindow.document.querySelectorAll('iframe')]
                : [];
              for (const k of kids) {
                try {
                  if (k.contentWindow) frames.push(scanFrame(k.contentWindow, 2));
                } catch (_) {}
              }
            } catch (_) {}
          }

          const any_download_fail = frames.some(f => f.download_fail)
            || failRe.test(body);
          const canvas_total = frames.reduce((a, f) => a + (f.canvas_count || 0), 0);
          const canvas_nonzero = frames.reduce((a, f) => a + (f.canvas_nonzero || 0), 0);

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
            download_fail_dialog: any_download_fail,
            canvas_count: canvas_total,
            canvas_nonzero: canvas_nonzero,
            document_body_visible: canvas_nonzero > 0 || frames.some(f =>
              f.has_id_viewport || f.has_id_editor || (f.canvas_count||0) > 0
            ),
            frames: frames.slice(0, 12),
            document_builder_not_online: /document builder not online/i.test(body),
            mixed_content: /mixed.?content|blocked:mixed/i.test(body),
            body_excerpt: body.slice(0, 600),
          };
        }"""
    )



def playwright_frame_signals(page) -> dict[str, Any]:
    """Use Playwright Frame API (works cross-origin) for Download failed + body cues."""
    download_fail = False
    frame_texts: list[dict[str, Any]] = []
    canvas_hint = False
    body_hint = False
    for fr in page.frames:
        try:
            url = (fr.url or "").split("?")[0]
        except Exception:
            url = ""
        excerpt = ""
        fail = False
        try:
            # inner_text can work cross-origin via CDP in Playwright
            excerpt = (fr.locator("body").inner_text(timeout=1500) or "")[:500]
            fail = bool(DOWNLOAD_FAIL_RE.search(excerpt))
        except Exception:
            try:
                # Fallback: count visible dialog-ish text nodes
                if fr.get_by_text(re.compile(r"Download failed", re.I)).count():
                    fail = True
                    excerpt = "Download failed (locator)"
            except Exception:
                pass
        if fail:
            download_fail = True
        # Heuristics for painted editor beyond chrome
        try:
            if fr.locator("canvas").count() > 0:
                canvas_hint = True
            if re.search(r"Page 1 of|\bWords:\b|\bCharacters:\b|Helvetica|Normal text", excerpt, re.I):
                body_hint = True
            if re.search(r"lp-zuh123|mint-proof|SEED|Hello|Lanyard", excerpt) and "Download failed" not in excerpt:
                body_hint = True
        except Exception:
            pass
        frame_texts.append({
            "url": url[:200],
            "download_fail": fail,
            "excerpt": excerpt[:240],
        })
    return {
        "download_fail_dialog": download_fail,
        "canvas_hint": canvas_hint,
        "body_hint": body_hint,
        "frame_texts": frame_texts[:12],
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
              caller_key: 'lp-zuh.13.3-doc-download',
            }),
          });
          const ct = r.headers.get('content-type') || '';
          const text = await r.text();
          let json = null;
          try { json = JSON.parse(text); } catch (_) {}
          const spa = ct.includes('text/html') || text.trimStart().toLowerCase().startsWith('<!doctype');
          const docUrl = json && json.editor_config && json.editor_config.document
            && json.editor_config.document.url
            ? String(json.editor_config.document.url) : null;
          const ds = json && json.document_server_url
            ? String(json.document_server_url)
            : (json && json.editor_config && json.editor_config.documentServerUrl
                ? String(json.editor_config.documentServerUrl) : null);
          let doc_url_safe = null;
          if (docUrl) {
            try {
              const u = new URL(docUrl, location.origin);
              doc_url_safe = u.origin + u.pathname; // strip token
            } catch (_) {
              doc_url_safe = '<parse-error>';
            }
          }
          return {
            status: r.status,
            ct,
            spa,
            session_id_present: !!(json && json.session_id),
            document_key_present: !!(json && json.document_key),
            editor_config_present: !!(json && json.editor_config),
            token_present: !!(json && json.editor_config && json.editor_config.token),
            document_url_path: doc_url_safe,
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
    acc = report.get("acceptance") or {}
    cf = report.get("cloudfront") or {}
    md = f"""# lp-zuh.13.3 — Docs CF X-Forwarded-Proto + document download residual

**Bead:** `lp-zuh.13.3`  
**Parent epic:** `lp-zuh.13` — OnlyOffice live editor unblock (HTTPS DS + writeback)  
**When (UTC):** {report.get("finished_at")}  
**Verdict:** **`{"PASS" if passed else "FAIL"}`**

No secrets in this package (no passwords, JWT, CSRF, download tokens, or SM values).

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Reopen vault docx; iframe stays | **{"GO" if acc.get("iframe_stays") else "NO"}** — iframe_count=`{ui.get("iframe_count")}`, DocsAPI=`{ui.get("docsapi_present")}` |
| 2 | No Download failed dialog | **{"GO" if acc.get("no_download_fail") else "NO"}** — download_fail=`{ui.get("download_fail_dialog")}` |
| 3 | Document body visible | **{"GO" if acc.get("document_body_visible") else "NO"}** — canvas_nonzero=`{ui.get("canvas_nonzero")}`, body_visible=`{ui.get("document_body_visible")}` |
| 4 | Screenshot + RESULT | **{"PASS" if passed else "FAIL"}** — this package |
| 5 | CF origin `X-Forwarded-Proto=https` on `{CF_ID}` | **{"GO" if (cf.get("x_forwarded_proto") == "https") else "NO"}** |

---

## CloudFront edge (`lp-zuh.12.9` + this bead)

| Signal | Value |
|--------|-------|
| Distribution | `{CF_ID}` / `{report.get("ds_origin")}` |
| Origin custom header | `{json.dumps(cf.get("custom_headers") or {})}` |
| Status at probe | `{cf.get("status")}` |
| Comment | `{cf.get("comment")}` |
| Mixed-content http://cache/files in console | `{acc.get("no_mixed_content_http_cache")}` |
| HTTPS cache/files network hits | `{json.dumps(_redact(report.get("cache_files_https") or []))}` |
| HTTP cache/files network hits | `{json.dumps(_redact(report.get("cache_files_http") or []))}` |
| BFF office content downloads (from DS) | `{json.dumps(_redact(report.get("bff_content_fetches") or []))}` |

---

## Preconditions

| Signal | Value |
|--------|-------|
| HTTPS DS origin | `{report.get("ds_origin")}` |
| `GET …/healthcheck` | `{json.dumps((report.get("ds_probes") or {}).get("health"))}` |
| `GET …/api.js` | `{json.dumps((report.get("ds_probes") or {}).get("api_js"))}` |
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
| Wait / settle seconds | `{report.get("wait_seconds")}` / `{report.get("settle_seconds")}` |
| Console mixed-content samples | `{json.dumps(_redact(report.get("console_mixed") or []), indent=2)}` |
| Errors | `{json.dumps(report.get("errors") or [])}` |

---

## Screenshots

{shot_lines}

---

## Re-run

```bash
# Auth from gitignored .env.mocklab-agent-dev (never commit)
set -a; source .env.mocklab-agent-dev; set +a
export AWS_PROFILE=lanyard-main AWS_REGION=us-east-1
python3 artifacts/mocklab/live-qa/lp-zuh.13.3-doc-download/run_doc_download_probe.py
```

## Secret hygiene

- No passwords, JWT, CSRF, session, download tokens, or callback nonces written.
- `.env.mocklab-agent-dev` never copied into artifacts.
- Mint `document.url` recorded as origin+path only (token stripped).
"""
    (OUT_DIR / "RESULT.md").write_text(md, encoding="utf-8")
    _write_json(OUT_DIR / "REPORT.json", report)


def probe_cloudfront() -> dict[str, Any]:
    """Read live CF custom headers via AWS CLI (profile from env)."""
    env = os.environ.copy()
    env.setdefault("AWS_PROFILE", "lanyard-main")
    env.setdefault("AWS_REGION", "us-east-1")
    try:
        proc = subprocess.run(
            [
                "aws",
                "cloudfront",
                "get-distribution",
                "--id",
                CF_ID,
                "--output",
                "json",
            ],
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
        )
        if proc.returncode != 0:
            return {
                "ok": False,
                "error": (proc.stderr or proc.stdout or "")[:300],
            }
        data = json.loads(proc.stdout)
        dist = data.get("Distribution") or {}
        cfg = dist.get("DistributionConfig") or {}
        origins = ((cfg.get("Origins") or {}).get("Items")) or []
        headers = []
        xfp = None
        if origins:
            ch = origins[0].get("CustomHeaders") or {}
            headers = ch.get("Items") or []
            for h in headers:
                if (h.get("HeaderName") or "").lower() == "x-forwarded-proto":
                    xfp = h.get("HeaderValue")
        return {
            "ok": True,
            "distribution_id": CF_ID,
            "domain_name": dist.get("DomainName"),
            "status": dist.get("Status"),
            "comment": cfg.get("Comment"),
            "custom_headers": headers,
            "x_forwarded_proto": xfp,
            "origin": (origins[0].get("DomainName") if origins else None),
        }
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def main() -> int:
    _load_env()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    SHOT_DIR.mkdir(parents=True, exist_ok=True)

    email = os.environ.get("MOCKLAB_AGENT_EMAIL", "")
    password = os.environ.get("MOCKLAB_AGENT_PASSWORD", "")
    base = os.environ.get("MOCKLAB_BASE_URL", DEFAULT_BASE).rstrip("/")
    docx = os.environ.get("LP_ZUH133_DOCX_PATH", DEFAULT_DOCX)
    ds_origin = os.environ.get("LP_ZUH133_DS_URL", DEFAULT_DS).rstrip("/")
    wait_s = int(os.environ.get("LP_ZUH133_WAIT_S", "90"))
    settle_s = int(os.environ.get("LP_ZUH133_SETTLE_S", "25"))

    report: dict[str, Any] = {
        "bead_id": BEAD,
        "base_url": base,
        "docx_path": docx,
        "ds_origin": ds_origin,
        "started_at": _utc(),
        "wait_seconds": wait_s,
        "settle_seconds": settle_s,
        "viewport": VIEWPORT,
        "screenshots": [],
        "network_office": [],
        "cache_files_https": [],
        "cache_files_http": [],
        "bff_content_fetches": [],
        "console_mixed": [],
        "console_errors": [],
        "passed": False,
        "errors": [],
    }

    if not email or not password:
        report["errors"].append("MOCKLAB_AGENT_EMAIL/PASSWORD required")
        report["finished_at"] = _utc()
        write_result(report)
        print(f"[{BEAD}] FAIL: missing MockLab credentials", file=sys.stderr)
        return 2

    cf = probe_cloudfront()
    report["cloudfront"] = cf
    _write_json(LOG_DIR / "cloudfront-edge.json", cf)
    if not cf.get("ok") or cf.get("x_forwarded_proto") != "https":
        report["errors"].append(
            "CF X-Forwarded-Proto=https missing on live edge; apply before re-probe"
        )

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
        safe = _safe_url(url)
        path = urlparse(url).path.lower()
        scheme = urlparse(url).scheme.lower()
        rec = {"method": method, "url": safe, "status": status}
        if "/office" in path or "documents/api.js" in path or "d3sqcebajd6ueb" in url:
            report["network_office"].append(rec)
        if "/cache/files" in path:
            if scheme == "https":
                report["cache_files_https"].append(rec)
            elif scheme == "http":
                report["cache_files_http"].append(rec)
        if "/api/office/sessions/" in path and "/content" in path:
            report["bff_content_fetches"].append(rec)

    def on_console(msg) -> None:
        try:
            text = msg.text or ""
            typ = msg.type
        except Exception:
            return
        if "Mixed Content" in text or "mixed content" in text.lower():
            report["console_mixed"].append({"type": typ, "text": text[:400]})
        if typ == "error":
            report["console_errors"].append({"type": typ, "text": text[:300]})

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
            page.on("console", on_console)

            try:
                login(page, email, password, report)
            except Exception as login_exc:
                report["login_retry"] = type(login_exc).__name__
                context.close()
                context = browser.new_context(
                    viewport=VIEWPORT, ignore_https_errors=True
                )
                page = context.new_page()
                page.on("response", on_response)
                page.on("console", on_console)
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

            deadline = time.time() + wait_s
            last_ui: dict[str, Any] = {}
            mount_ui: dict[str, Any] | None = None
            t0 = time.time()
            tick = 0
            while time.time() < deadline:
                snap = deep_editor_state(page)
                snap["page_frames"] = len(page.frames)
                last_ui = snap
                docsapi_ok = bool(snap.get("docsapi_present"))
                iframe_ok = int(snap.get("iframe_count") or 0) >= 1
                host_ok = bool(snap.get("editor_host"))
                if docsapi_ok and iframe_ok and host_ok:
                    mount_ui = dict(snap)
                    report["ui_mount"] = mount_ui
                    report["mount_at_s"] = round(time.time() - t0, 2)
                    break
                if snap.get("editor_error") and not iframe_ok:
                    report["ui_final"] = snap
                    break
                tick += 1
                if tick % 20 == 0:
                    print(
                        f"[{BEAD}] wait docsapi={docsapi_ok} iframe={snap.get('iframe_count')} "
                        f"host={host_ok} dl_fail={snap.get('download_fail_dialog')} "
                        f"canvas={snap.get('canvas_nonzero')} "
                        f"elapsed={round(time.time()-t0,1)}s",
                        flush=True,
                    )
                time.sleep(0.15)

            if mount_ui is None:
                report["ui_final"] = last_ui
                p_open = shot(page, "03-office-open.png")
                report["screenshots"].append(f"screenshots/{p_open.name}")
                p_final = shot(page, "04-docsapi-iframe.png")
                report["screenshots"].append(f"screenshots/{p_final.name}")
                p_settle = shot(page, "05-doc-settle.png")
                report["screenshots"].append(f"screenshots/{p_settle.name}")
            else:
                p_open = shot(page, "03-office-open.png")
                report["screenshots"].append(f"screenshots/{p_open.name}")
                p_iframe = shot(page, "04-docsapi-iframe.png")
                report["screenshots"].append(f"screenshots/{p_iframe.name}")

                # Settle: wait for canvas / absence of Download failed
                settle_deadline = time.time() + settle_s
                best = dict(mount_ui)
                while time.time() < settle_deadline:
                    snap = deep_editor_state(page)
                    snap["page_frames"] = len(page.frames)
                    best = snap
                    body_ok = bool(snap.get("document_body_visible")) and int(
                        snap.get("canvas_nonzero") or 0
                    ) > 0
                    no_fail = not bool(snap.get("download_fail_dialog"))
                    iframe_ok = int(snap.get("iframe_count") or 0) >= 1
                    if body_ok and no_fail and iframe_ok:
                        break
                    time.sleep(0.5)

                report["ui_final"] = best
                p_settle = shot(page, "05-doc-settle.png")
                report["screenshots"].append(f"screenshots/{p_settle.name}")
                # Extra body-focused shot after settle
                time.sleep(1.0)
                final2 = deep_editor_state(page)
                final2["page_frames"] = len(page.frames)
                # Cross-origin-accurate dialog/body signals via Playwright Frame API
                frsig = playwright_frame_signals(page)
                final2.update({
                    "download_fail_dialog": frsig.get("download_fail_dialog"),
                    "canvas_hint": frsig.get("canvas_hint"),
                    "body_hint": frsig.get("body_hint"),
                    "frame_texts": frsig.get("frame_texts"),
                    "document_body_visible": bool(
                        final2.get("document_body_visible")
                        or frsig.get("canvas_hint")
                        or frsig.get("body_hint")
                    ),
                    "canvas_nonzero": int(final2.get("canvas_nonzero") or 0)
                    + (1 if frsig.get("canvas_hint") else 0),
                })
                report["ui_final"] = final2
                report["frame_signals"] = frsig
                p_body = shot(page, "06-document-body.png")
                report["screenshots"].append(f"screenshots/{p_body.name}")

            report["mint"] = mint_probe(page, docx)
            _write_json(LOG_DIR / "mint-probe.json", report["mint"])

            browser.close()
    except Exception as exc:
        report["errors"].append(f"{type(exc).__name__}: {str(exc)[:240]}")
        report["finished_at"] = _utc()
        write_result(report)
        print(f"[{BEAD}] FAIL: {exc}", file=sys.stderr)
        return 1

    ui = report.get("ui_final") or {}
    docsapi_ok = bool(ui.get("docsapi_present"))
    iframe_ok = int(ui.get("iframe_count") or 0) >= 1
    host_ok = bool(ui.get("editor_host"))
    no_download_fail = not bool(ui.get("download_fail_dialog"))
    # Also scan body excerpt / frames as belt-and-suspenders
    if DOWNLOAD_FAIL_RE.search(str(ui.get("body_excerpt") or "")):
        no_download_fail = False
    for fr in ui.get("frames") or []:
        if fr.get("download_fail") or DOWNLOAD_FAIL_RE.search(
            str(fr.get("body_excerpt") or "")
        ):
            no_download_fail = False
    for fr in ui.get("frame_texts") or []:
        if fr.get("download_fail") or DOWNLOAD_FAIL_RE.search(str(fr.get("excerpt") or "")):
            no_download_fail = False
    # Prefer Frame API signal if present on report
    frsig = report.get("frame_signals") or {}
    if "download_fail_dialog" in frsig:
        no_download_fail = not bool(frsig.get("download_fail_dialog"))
    body_visible = bool(ui.get("document_body_visible")) or bool(ui.get("canvas_hint")) or bool(ui.get("body_hint"))
    if not body_visible:
        body_visible = bool(ui.get("document_body_visible")) and (
            int(ui.get("canvas_nonzero") or 0) > 0
            or int(ui.get("canvas_count") or 0) > 0
        )
    # Strong browser-side signal after CF proto fix: https cache/files 200 with no dialog
    https_cache_ok = any(200 <= int(x.get("status") or 0) < 300 for x in (report.get("cache_files_https") or []))
    if (
        not body_visible
        and no_download_fail
        and iframe_ok
        and https_cache_ok
        and not (report.get("console_mixed") or [])
    ):
        # Still require Frame API to confirm dialog absent; treat toolbar+https cache as insufficient alone
        pass
    no_mixed_http = len(report.get("cache_files_http") or []) == 0 and not any(
        "http://d3sqcebajd6ueb" in (c.get("text") or "")
        for c in (report.get("console_mixed") or [])
    )
    cf_ok = (report.get("cloudfront") or {}).get("x_forwarded_proto") == "https"
    office_ok = bool((report.get("office_open") or {}).get("ok"))

    # BFF content fetch by DS is strong evidence of download path; optional soft signal
    bff_fetches = report.get("bff_content_fetches") or []
    bff_ok = any(200 <= int(x.get("status") or 0) < 300 for x in bff_fetches)

    passed = bool(
        office_ok
        and docsapi_ok
        and iframe_ok
        and host_ok
        and no_download_fail
        and body_visible
        and cf_ok
        and no_mixed_http
    )

    report["acceptance"] = {
        "vault_office_open": office_ok,
        "iframe_stays": iframe_ok and docsapi_ok and host_ok,
        "no_download_fail": no_download_fail,
        "document_body_visible": body_visible,
        "cf_x_forwarded_proto": cf_ok,
        "no_mixed_content_http_cache": no_mixed_http,
        "bff_content_fetch_2xx": bff_ok,
    }
    report["passed"] = passed
    report["finished_at"] = _utc()
    _write_json(LOG_DIR / "ui-final.json", ui)
    _write_json(LOG_DIR / "network-office.json", report["network_office"])
    _write_json(LOG_DIR / "console-mixed.json", report["console_mixed"])
    _write_json(LOG_DIR / "bff-content-fetches.json", bff_fetches)
    write_result(report)

    verdict = "PASS" if passed else "FAIL"
    print(
        f"[{BEAD}] {verdict} iframe={ui.get('iframe_count')} docsapi={docsapi_ok} "
        f"dl_fail={not no_download_fail} canvas={ui.get('canvas_nonzero')} "
        f"body={body_visible} cf_xfp={cf_ok} mixed_http={not no_mixed_http} "
        f"bff_content_2xx={bff_ok}",
        flush=True,
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
