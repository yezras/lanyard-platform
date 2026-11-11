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
          const m = raw.match(/(\\\\/assets\\\\/index-[A-Za-z0-9_-]+\\\\.js)/);
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
