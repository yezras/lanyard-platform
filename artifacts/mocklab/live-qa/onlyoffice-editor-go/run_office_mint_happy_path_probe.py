#!/usr/bin/env python3
"""lp-zuh.12.3 — MockLab live office mint happy-path probe.

Seeds are assumed already present (or set LP_ZUH123_DOCX_PATH to an existing
vault .docx). Proves authenticated POST /api/office/sessions returns JSON
success (201 create / 200 idempotent replay) with session_id, document_key,
editor_config — not SPA HTML. Edit mode probed when ui.can.vault_edit=true.

Auth:
  - artifacts/ui/.auth/mocklab-agent.json storage_state, or
  - MOCKLAB_AGENT_EMAIL / MOCKLAB_AGENT_PASSWORD (never printed)

Writes REPORT.json + logs/* under this directory (tokens redacted).
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
from urllib.parse import quote, urlparse

BEAD = "lp-zuh.12.3"
DEFAULT_BASE = "https://app.withlanyard.com/mocklab"
DEFAULT_DOCX = "/Projects/Workspace/office/lp-zuh123-mint-proof.docx"

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR
for _ in range(8):
    if (REPO_ROOT / "AGENTS.md").is_file() or (REPO_ROOT / ".git").exists():
        break
    REPO_ROOT = REPO_ROOT.parent

OUT_DIR = SCRIPT_DIR
LOG_DIR = OUT_DIR / "logs"

_SECRET_KEY_RE = re.compile(
    r"(token|jwt|secret|password|authorization|cookie|csrf|signature|api_key|nonce)",
    re.I,
)
_URL_SECRET_RE = re.compile(r"([?&](?:token|nonce)=)[^&#\s\"']+", re.I)


def _utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _scrub_str(value: str) -> str:
    if value.startswith("eyJ") and "." in value:
        return "<redacted-jwt>"
    return _URL_SECRET_RE.sub(r"\1<redacted>", value)


def _redact(obj: Any) -> Any:
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            if _SECRET_KEY_RE.search(str(k)):
                if isinstance(v, str) and v:
                    out[k] = "<redacted>"
                elif isinstance(v, (dict, list)):
                    out[k] = _redact(v)
                else:
                    out[k] = v if v in (None, "", False, True) else "<redacted>"
            else:
                out[k] = _redact(v)
        return out
    if isinstance(obj, list):
        return [_redact(x) for x in obj]
    if isinstance(obj, str):
        return _scrub_str(obj)
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
    email = os.environ.get("MOCKLAB_AGENT_EMAIL") or ""
    password = os.environ.get("MOCKLAB_AGENT_PASSWORD") or ""
    if not email or not password:
        return None
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None

    auth_path = REPO_ROOT / "artifacts/ui/.auth/mocklab-agent.json"
    auth_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
        )
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        page = context.new_page()
        page.goto(base.rstrip("/") + "/", wait_until="load", timeout=90_000)
        page.wait_for_timeout(800)
        email_loc = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
        if email_loc.count() == 0:
            email_loc = page.locator('input[type="email"], input[name="email"]')
        if email_loc.count() == 0:
            browser.close()
            return None
        email_loc.first.fill(email)
        page.locator('input[type="password"]').first.fill(password)
        page.get_by_role("button", name=re.compile(r"Log in|Sign in", re.I)).first.click()
        page.wait_for_timeout(4000)
        try:
            page.wait_for_load_state("networkidle", timeout=45_000)
        except Exception:
            pass
        me = page.evaluate(
            """async () => {
              const r = await fetch('/mocklab/api/auth/me', {credentials:'include'});
              return {status: r.status, ok: r.status === 200};
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
        resp = opener.open(req, timeout=90)
        raw = resp.read()
        status = resp.status
        ct = resp.headers.get("content-type")
        xcache = resp.headers.get("x-cache")
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
        ct = e.headers.get("content-type")
        xcache = e.headers.get("x-cache")
    spa = _looks_spa(raw, ct)
    parsed: Any = None
    if not spa:
        try:
            parsed = json.loads(raw.decode("utf-8", errors="replace"))
        except Exception:
            parsed = None
    # Never keep large binary bodies in evidence
    if isinstance(parsed, dict) and isinstance(parsed.get("content"), str):
        if len(parsed["content"]) > 64:
            parsed = dict(parsed)
            parsed["content"] = f"<redacted-body len={len(parsed['content'])}>"
    return {
        "status": status,
        "content_type": ct,
        "x_cache": xcache,
        "looks_like_spa_html": spa,
        "body_len": len(raw),
        "json": _redact(parsed) if parsed is not None else None,
    }


def _mint_summary(probe: dict[str, Any]) -> dict[str, Any]:
    j = probe.get("json") or {}
    ec = j.get("editor_config") or {}
    doc = ec.get("document") or {}
    ed = ec.get("editorConfig") or {}
    url = doc.get("url") or ""
    return {
        "status": probe.get("status"),
        "content_type": probe.get("content_type"),
        "looks_like_spa_html": probe.get("looks_like_spa_html"),
        "session_id_present": bool(j.get("session_id")),
        "document_key_present": bool(j.get("document_key")),
        "document_key_prefix": (j.get("document_key") or "")[:12] or None,
        "mode": j.get("mode"),
        "file_type": j.get("file_type"),
        "path": j.get("path"),
        "idempotent_replay": j.get("idempotent_replay"),
        "editor_config": {
            "documentType": ec.get("documentType"),
            "document_fileType": doc.get("fileType"),
            "document_title": doc.get("title"),
            "document_url_host_path": url.split("?", 1)[0] if url else None,
            "permissions_edit": (doc.get("permissions") or {}).get("edit"),
            "editor_mode": ed.get("mode"),
            "callback_url_path_present": bool(ed.get("callbackUrl")),
            "token_present": bool(ec.get("token")),
        },
    }


def main() -> int:
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    base = (os.environ.get("MOCKLAB_BASE_URL") or DEFAULT_BASE).rstrip("/")
    docx = (os.environ.get("LP_ZUH123_DOCX_PATH") or DEFAULT_DOCX).strip()
    parsed = urlparse(base)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    referer = base + "/"

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
        "verdict": "UNKNOWN",
        "acceptance": {},
    }

    report["probes"]["auth_me"] = _http(
        opener, "GET", f"{base}/api/auth/me", csrf=csrf, origin=origin, referer=referer
    )
    report["probes"]["context"] = _http(
        opener, "GET", f"{base}/api/context", csrf=csrf, origin=origin, referer=referer
    )
    report["probes"]["vault_content_get"] = _http(
        opener,
        "GET",
        f"{base}/api/vault/content?path={quote(docx, safe='/:')}",
        csrf=csrf,
        origin=origin,
        referer=referer,
    )
    caller = f"{BEAD}-view-probe"
    report["probes"]["mint_view"] = _http(
        opener,
        "POST",
        f"{base}/api/office/sessions",
        data={"path": docx, "mode": "view", "caller_key": caller},
        csrf=csrf,
        origin=origin,
        referer=referer,
    )
    report["probes"]["mint_view_replay"] = _http(
        opener,
        "POST",
        f"{base}/api/office/sessions",
        data={"path": docx, "mode": "view", "caller_key": caller},
        csrf=csrf,
        origin=origin,
        referer=referer,
    )
    report["probes"]["mint_edit"] = _http(
        opener,
        "POST",
        f"{base}/api/office/sessions",
        data={"path": docx, "mode": "edit", "caller_key": f"{BEAD}-edit-probe"},
        csrf=csrf,
        origin=origin,
        referer=referer,
    )
    report["probes"]["mint_missing"] = _http(
        opener,
        "POST",
        f"{base}/api/office/sessions",
        data={"path": "/workflows/.lp-zuh123-missing.docx", "mode": "view"},
        csrf=csrf,
        origin=origin,
        referer=referer,
    )

    ctx = (report["probes"].get("context") or {}).get("json") or {}
    vault_edit = ((ctx.get("ui") or {}).get("can") or {}).get("vault_edit")
    report["context_vault_edit"] = vault_edit

    view = report["probes"]["mint_view"]
    replay = report["probes"]["mint_view_replay"]
    edit = report["probes"]["mint_edit"]
    view_ok = (
        not view.get("looks_like_spa_html")
        and view.get("status") in (200, 201)
        and bool((view.get("json") or {}).get("session_id"))
        and bool((view.get("json") or {}).get("document_key"))
        and bool((view.get("json") or {}).get("editor_config"))
    )
    replay_200 = (
        not replay.get("looks_like_spa_html")
        and replay.get("status") == 200
        and bool((replay.get("json") or {}).get("idempotent_replay"))
    )
    edit_ok = (
        not edit.get("looks_like_spa_html")
        and edit.get("status") in (200, 201)
        and ((edit.get("json") or {}).get("mode") == "edit")
    )
    edit_denied_ok = (
        vault_edit is not True
        and not edit.get("looks_like_spa_html")
        and edit.get("status") == 403
    )

    report["acceptance"] = {
        "mint_view_success_json": view_ok,
        "mint_view_status": view.get("status"),
        "mint_replay_200": replay_200,
        "mint_edit_when_vault_edit": (edit_ok if vault_edit is True else edit_denied_ok),
        "vault_edit": vault_edit is True,
        "not_spa": not view.get("looks_like_spa_html"),
        "missing_still_422_json": (
            (report["probes"]["mint_missing"].get("status") == 422)
            and not report["probes"]["mint_missing"].get("looks_like_spa_html")
        ),
    }

    if view_ok and report["acceptance"]["mint_edit_when_vault_edit"] and report["acceptance"]["not_spa"]:
        report["verdict"] = "GO_MINT_HAPPY_PATH"
    elif view_ok:
        report["verdict"] = "GO_PARTIAL"
    else:
        report["verdict"] = "FAIL"

    summaries = {
        "mint_view": _mint_summary(view),
        "mint_view_replay": _mint_summary(replay),
        "mint_edit": _mint_summary(edit),
        "mint_missing": {
            "status": report["probes"]["mint_missing"].get("status"),
            "looks_like_spa_html": report["probes"]["mint_missing"].get(
                "looks_like_spa_html"
            ),
            "json": report["probes"]["mint_missing"].get("json"),
        },
        "vault_content_get": {
            "status": report["probes"]["vault_content_get"].get("status"),
            "looks_like_spa_html": report["probes"]["vault_content_get"].get(
                "looks_like_spa_html"
            ),
            "path": ((report["probes"]["vault_content_get"].get("json") or {}).get("path")),
            "size_bytes": (
                (report["probes"]["vault_content_get"].get("json") or {}).get("size_bytes")
            ),
        },
    }
    (LOG_DIR / "mint-happy-path.json").write_text(
        json.dumps(summaries, indent=2) + "\n", encoding="utf-8"
    )
    (OUT_DIR / "REPORT.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )

    print(
        f"[{BEAD}] verdict={report['verdict']} "
        f"view={view.get('status')} replay={replay.get('status')} "
        f"edit={edit.get('status')} vault_edit={vault_edit} "
        f"spa={view.get('looks_like_spa_html')}"
    )
    return 0 if report["verdict"].startswith("GO") else 1


if __name__ == "__main__":
    raise SystemExit(main())
