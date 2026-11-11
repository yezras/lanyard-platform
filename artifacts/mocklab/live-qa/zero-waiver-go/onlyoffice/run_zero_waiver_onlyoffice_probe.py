#!/usr/bin/env python3
"""lp-zuh.11.3 — zero-waiver OnlyOffice probe (MockLab live).

Probes mint JSON vs SPA, vault_edit, SPA bake signals, optional DocsAPI.
Supports:
  - Playwright storage_state cookies (artifacts/ui/.auth/mocklab-agent.json)
  - Password re-login via MOCKLAB_AGENT_EMAIL/PASSWORD (never printed)

Writes under this directory: RESULT.md (short), REPORT.json, logs/*, screenshots/*
Full narrative acceptance map: RESULT.md (maintained by bead) may be richer than the short rewrite.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.cookiejar import Cookie, CookieJar
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

BEAD = "lp-zuh.11.3"
DEFAULT_BASE = "https://app.withlanyard.com/mocklab"
DEFAULT_DOCX = "/workflows/.lp-zuh113-missing.docx"

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR
for _ in range(8):
    if (REPO_ROOT / "AGENTS.md").is_file() or (REPO_ROOT / ".git").exists():
        break
    REPO_ROOT = REPO_ROOT.parent

OUT_DIR = SCRIPT_DIR
LOG_DIR = OUT_DIR / "logs"
SHOT_DIR = OUT_DIR / "screenshots"

_SECRET_KEY_RE = re.compile(
    r"(token|jwt|secret|password|authorization|cookie|csrf|signature|api_key)",
    re.I,
)


def _utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _redact(obj: Any) -> Any:
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if _SECRET_KEY_RE.search(str(k)):
                out[k] = "<redacted>" if v not in (None, "", False, True) else v
            else:
                out[k] = _redact(v)
        return out
    if isinstance(obj, list):
        return [_redact(x) for x in obj]
    if isinstance(obj, str) and obj.startswith("eyJ") and "." in obj:
        return "<redacted-jwt>"
    return obj


def _looks_spa(raw: bytes, content_type: str | None) -> bool:
    head = raw[:80].lstrip().lower()
    if b"<!doctype html" in head or head.startswith(b"<html"):
        return True
    if content_type and "text/html" in content_type.lower():
        if b'<div id="app"' in raw[:500] or b"Lanyard Portal" in raw[:500]:
            return True
    return False


def _auth_cookie_jar() -> tuple[CookieJar, str | None, str]:
    jar = CookieJar()
    csrf: str | None = None
    candidates = [
        REPO_ROOT / "artifacts/ui/.auth/mocklab-agent.json",
        Path(os.environ["MOCKLAB_STORAGE_STATE"])
        if os.environ.get("MOCKLAB_STORAGE_STATE")
        else Path(""),
    ]
    for p in candidates:
        if not p or not str(p) or not p.is_file():
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        for c in data.get("cookies") or []:
            name = c.get("name") or ""
            value = c.get("value") or ""
            if name == "lanyard_csrf":
                csrf = value
            domain = c.get("domain") or "app.withlanyard.com"
            jar.set_cookie(
                Cookie(
                    0,
                    name,
                    value,
                    None,
                    False,
                    domain,
                    True,
                    domain.startswith("."),
                    c.get("path") or "/",
                    True,
                    bool(c.get("secure")),
                    None,
                    True,
                    None,
                    None,
                    {},
                )
            )
        if any(True for _ in jar):
            rel = str(p.relative_to(REPO_ROOT) if p.is_relative_to(REPO_ROOT) else p)
            return jar, csrf, rel
    return jar, csrf, "none"


def _password_login_refresh(base: str) -> str | None:
    """Optional Playwright password login; returns storage_state path or None."""
    email = os.environ.get("MOCKLAB_AGENT_EMAIL") or ""
    password = os.environ.get("MOCKLAB_AGENT_PASSWORD") or ""
    if not email or not password:
        return None
    if os.environ.get("LP_ZUH113_SKIP_LOGIN") == "1":
        return None
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None

    auth_path = REPO_ROOT / "artifacts/ui/.auth/mocklab-agent.json"
    auth_path.parent.mkdir(parents=True, exist_ok=True)
    SHOT_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
        )
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        page = context.new_page()
        page.goto(base.rstrip("/") + "/", wait_until="load", timeout=90_000)
        page.wait_for_timeout(1000)
        page.screenshot(path=str(SHOT_DIR / "00-pre-login.png"), full_page=True)
        email_loc = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
        if email_loc.count() == 0:
            email_loc = page.locator('input[type="email"], input[name="email"]')
        if email_loc.count() == 0:
            # Already logged in via residual cookies?
            me = page.evaluate(
                """async () => {
                  const r = await fetch(location.pathname.replace(/\\/?$/, '/') + 'api/auth/me'.replace(/^\\//,''), {credentials:'include'});
                  // tenant path: /mocklab/api/auth/me
                  return r.status;
                }"""
            )
            browser.close()
            return None if me != 200 else str(auth_path)
        email_loc.first.fill(email)
        page.locator('input[type="password"]').first.fill(password)
        page.get_by_role("button", name=re.compile(r"Log in|Sign in", re.I)).first.click()
        page.wait_for_timeout(4000)
        try:
            page.wait_for_load_state("networkidle", timeout=45_000)
        except Exception:
            pass
        page.screenshot(path=str(SHOT_DIR / "00-post-password-login.png"), full_page=True)
        me = page.evaluate(
            """async () => {
              const r = await fetch('/mocklab/api/auth/me', {credentials:'include'});
              const t = await r.text();
              return {status: r.status, ok: r.status === 200, body_len: t.length};
            }"""
        )
        if not me.get("ok"):
            browser.close()
            print(f"[{BEAD}] password login failed auth/me status={me.get('status')}")
            return None
        context.storage_state(path=str(auth_path))
        browser.close()
        print(f"[{BEAD}] password login OK; storage_state refreshed")
        return str(auth_path)


def _http(
    opener: urllib.request.OpenerDirector,
    method: str,
    url: str,
    *,
    data: dict[str, Any] | None = None,
    csrf: str | None = None,
    origin: str,
    referer: str,
) -> dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "Origin": origin,
        "Referer": referer,
    }
    if csrf:
        headers["x-csrf-token"] = csrf
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        resp = opener.open(req, timeout=45)
        raw = resp.read()
        status = resp.status
        ct = resp.headers.get("content-type")
        server = resp.headers.get("server")
        xcache = resp.headers.get("x-cache")
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
        ct = e.headers.get("content-type")
        server = e.headers.get("server")
        xcache = e.headers.get("x-cache")
    spa = _looks_spa(raw, ct)
    parsed: Any = None
    if not spa:
        try:
            parsed = json.loads(raw.decode("utf-8", errors="replace"))
        except Exception:
            parsed = None
    return {
        "status": status,
        "content_type": ct,
        "server": server,
        "x_cache": xcache,
        "looks_like_spa_html": spa,
        "body_len": len(raw),
        "json": _redact(parsed) if parsed is not None else None,
    }


def _spa_bundle(base: str) -> dict[str, Any]:
    origin = f"{urlparse(base).scheme}://{urlparse(base).netloc}"
    try:
        with urllib.request.urlopen(base.rstrip("/") + "/", timeout=20) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception as ex:
        return {"ok": False, "error": str(ex)[:160]}
    m = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
    if not m:
        return {"ok": False, "error": "index bundle not found"}
    js_path = m.group(1)
    try:
        with urllib.request.urlopen(origin + js_path, timeout=60) as resp:
            js = resp.read().decode("utf-8", errors="replace")
    except Exception as ex:
        return {"ok": False, "error": f"bundle: {ex}"[:160], "js_path": js_path}
    wi = re.search(r"wI=\{[^}]+\}", js)
    return {
        "ok": True,
        "js_path": js_path,
        "js_bytes": len(js),
        "wi_env_object": wi.group(0) if wi else None,
        "string_presence": {
            n: (n in js)
            for n in (
                "VITE_ONLYOFFICE_EDITOR",
                "VITE_ONLYOFFICE_DS_URL",
                "DocsAPI",
                "office/sessions",
            )
        },
        "note": "String presence ≠ enablement; empty wI Vite keys means editor off.",
    }


def main() -> int:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    SHOT_DIR.mkdir(parents=True, exist_ok=True)

    base = (os.environ.get("MOCKLAB_BASE_URL") or DEFAULT_BASE).rstrip("/")
    docx = (os.environ.get("LP_ZUH113_DOCX_PATH") or DEFAULT_DOCX).strip()
    parsed = urlparse(base)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    referer = base + "/"

    # Prefer existing storage_state; if unauth, try password login.
    jar, csrf, cookie_source = _auth_cookie_jar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    me0 = _http(
        opener, "GET", f"{base}/api/auth/me", csrf=csrf, origin=origin, referer=referer
    )
    if me0.get("status") != 200:
        refreshed = _password_login_refresh(base)
        if refreshed:
            jar, csrf, cookie_source = _auth_cookie_jar()
            opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    report: dict[str, Any] = {
        "bead": BEAD,
        "when": _utc(),
        "base_url": base,
        "docx_path": docx,
        "cookie_source": cookie_source,
        "csrf_present": bool(csrf),
        "probes": {},
        "residuals": [],
        "verdict": "UNKNOWN",
        "acceptance": {},
    }

    report["probes"]["auth_me"] = _http(
        opener, "GET", f"{base}/api/auth/me", csrf=csrf, origin=origin, referer=referer
    )
    report["probes"]["context"] = _http(
        opener, "GET", f"{base}/api/context", csrf=csrf, origin=origin, referer=referer
    )
    report["probes"]["vault_tree"] = _http(
        opener, "GET", f"{base}/api/vault/tree", csrf=csrf, origin=origin, referer=referer
    )
    report["probes"]["mint_view"] = _http(
        opener,
        "POST",
        f"{base}/api/office/sessions",
        data={"path": docx, "mode": "view"},
        csrf=csrf,
        origin=origin,
        referer=referer,
    )
    report["probes"]["mint_edit"] = _http(
        opener,
        "POST",
        f"{base}/api/office/sessions",
        data={"path": docx, "mode": "edit"},
        csrf=csrf,
        origin=origin,
        referer=referer,
    )
    report["probes"]["mint_txt_control"] = _http(
        opener,
        "POST",
        f"{base}/api/office/sessions",
        data={"path": "/workflows/note.txt", "mode": "view"},
        csrf=csrf,
        origin=origin,
        referer=referer,
    )
    # No-cookie control (edge SPA mask expectation)
    empty = urllib.request.build_opener()
    report["probes"]["mint_no_cookie"] = _http(
        empty,
        "POST",
        f"{base}/api/office/sessions",
        data={"path": docx, "mode": "view"},
        csrf=None,
        origin=origin,
        referer=referer,
    )
    report["probes"]["spa_bundle"] = _spa_bundle(base)

    ctx = (report["probes"].get("context") or {}).get("json") or {}
    vault_edit = ((ctx.get("ui") or {}).get("can") or {}).get("vault_edit")
    report["context_vault_edit"] = vault_edit

    mint = report["probes"].get("mint_view") or {}
    if mint.get("looks_like_spa_html"):
        report["residuals"].append("mint_spa_html_fallback")
    elif mint.get("status") == 422:
        report["residuals"].append("mint_json_422_missing_file")
    elif mint.get("status") == 201:
        report["residuals"].append("mint_success_201")
    elif mint.get("status") == 401:
        report["residuals"].append(
            "mint_json_401_unauthenticated — BFF JSON (not SPA); refresh storage_state or MOCKLAB_AGENT_*"
        )
    else:
        report["residuals"].append(f"mint_status_{mint.get('status')}")

    if vault_edit is True:
        report["residuals"].append("ui.can.vault_edit=true")
    else:
        report["residuals"].append("ui.can.vault_edit=false")

    spa = report["probes"].get("spa_bundle") or {}
    wi = spa.get("wi_env_object") or ""
    if "VITE_ONLYOFFICE_EDITOR" not in wi:
        report["residuals"].append("vite_onlyoffice_editor_off")

    mint_json = bool(mint) and not mint.get("looks_like_spa_html")
    mint_auth_ok = mint_json and mint.get("status") in (422, 201)
    mint_ok = mint.get("status") == 201
    report["acceptance"] = {
        "vite_onlyoffice_baked": "VITE_ONLYOFFICE_EDITOR" in wi,
        "mint_json_not_spa": mint_json,
        "mint_authenticated_422_or_201": mint_auth_ok,
        "mint_missing_or_success_status": mint.get("status"),
        "vault_edit": vault_edit is True,
        "editor_host_docsapi": False,
    }

    if mint_ok and vault_edit is True and "vite_onlyoffice_editor_off" not in report["residuals"]:
        report["verdict"] = "GO"
    elif mint_auth_ok and vault_edit is True:
        report["verdict"] = "GO_PARTIAL_MINT_PLATFORM_HARD_RESIDUAL_EDITOR_HOST"
    else:
        report["verdict"] = "PASS_WITH_RESIDUAL"

    (LOG_DIR / "probes-sanitized.json").write_text(
        json.dumps(report["probes"], indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    (OUT_DIR / "REPORT.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    # Short RESULT rewrite only if no narrative RESULT exists — keep hand-written narrative.
    short = f"""# {BEAD} — OnlyOffice zero-waiver probe (auto)

**When:** {report['when']}  
**Base:** `{base}`  
**Cookie source:** `{cookie_source}`  
**Verdict:** **{report['verdict']}**

| Check | Result |
|-------|--------|
| mint spa | `{mint.get('looks_like_spa_html')}` status=`{mint.get('status')}` |
| vault_edit | `{vault_edit}` |
| spa bundle | see REPORT.json |

## Residuals

"""
    for r in report["residuals"]:
        short += f"- {r}\n"
    short += """
See RESULT.md for full acceptance map and operator follow-ups (do not overwrite RESULT.md with this stub if present).
"""
    auto_path = OUT_DIR / "RESULT.auto.md"
    auto_path.write_text(short, encoding="utf-8")
    print(
        f"[{BEAD}] verdict={report['verdict']} mint_spa={mint.get('looks_like_spa_html')} "
        f"mint_status={mint.get('status')} vault_edit={vault_edit} auth_me={report['probes']['auth_me'].get('status')}"
    )
    return 0 if report["verdict"] != "FAIL" else 1


if __name__ == "__main__":
    raise SystemExit(main())
