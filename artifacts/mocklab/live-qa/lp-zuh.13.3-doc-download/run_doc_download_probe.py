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
