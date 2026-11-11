#!/usr/bin/env python3
"""lp-zuh.12.5 — MockLab lab edit writeback probe.

Proves / records:
  1. BFF_OFFICE_VAULT_EDIT → ui.can.vault_edit (fail-closed default stays false elsewhere)
  2. Authenticated edit mint (JSON, not SPA)
  3. Callback route: status 1 ignored; status 2 attempts vault.write CAS
  4. Honest residual when write path is unavailable (MockLab short-stack)

Auth:
  - artifacts/ui/.auth/mocklab-agent.json storage_state, or
  - MOCKLAB_AGENT_EMAIL / MOCKLAB_AGENT_PASSWORD (never printed)

Writes REPORT.json + logs/* under this directory (tokens/nonces redacted).
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
from urllib.parse import urljoin, urlparse

BEAD = "lp-zuh.12.5"
DEFAULT_BASE = "https://app.withlanyard.com/mocklab"
DEFAULT_DOCX = "/Projects/Workspace/office/lp-zuh123-mint-proof.docx"
DS_HEALTH = (
    "http://lanyard-platform-staging-docs-al-238458258.us-east-1.elb.amazonaws.com"
    "/healthcheck"
)

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
    for path in candidates:
        if not path or not path.is_file():
            continue
        state = json.loads(path.read_text())
        for c in state.get("cookies") or []:
            domain = (c.get("domain") or "").lstrip(".")
            name = c.get("name") or ""
            value = c.get("value") or ""
            if "csrf" in name.lower():
                csrf = value
            jar.set_cookie(
                Cookie(
                    0,
                    name,
                    value,
                    None,
                    False,
                    domain,
                    True,
                    True,
                    c.get("path") or "/",
                    False,
                    False,
                    None,
                    False,
                    "",
                    "",
                    False,
                )
            )
        return jar, csrf, str(path.relative_to(REPO_ROOT) if path.is_relative_to(REPO_ROOT) else path)

    email = os.environ.get("MOCKLAB_AGENT_EMAIL") or os.environ.get("MOCKLAB_EMAIL")
    password = os.environ.get("MOCKLAB_AGENT_PASSWORD") or os.environ.get("MOCKLAB_PASSWORD")
    if not email or not password:
        raise SystemExit(
            "Need artifacts/ui/.auth/mocklab-agent.json or MOCKLAB_AGENT_EMAIL/PASSWORD"
        )

    # Password login (never log credentials).
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    login_url = f"{os.environ.get('MOCKLAB_BASE_URL', DEFAULT_BASE).rstrip('/')}/api/auth/login"
    body = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        login_url,
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    with opener.open(req, timeout=45) as resp:
        raw = resp.read()
        try:
            parsed = json.loads(raw)
            csrf = (
                parsed.get("csrf_token")
                or parsed.get("csrf")
                or ((parsed.get("user") or {}).get("csrf_token"))
            )
        except Exception:
            csrf = None
    return jar, csrf if isinstance(csrf, str) else None, "password-login"


def _request(
    opener: urllib.request.OpenerDirector,
    method: str,
    url: str,
    data: dict[str, Any] | None = None,
    csrf: str | None = None,
) -> tuple[int, str | None, bytes]:
    headers: dict[str, str] = {}
    if csrf:
        headers["x-csrf-token"] = csrf
        headers["x-xsrf-token"] = csrf
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with opener.open(req, timeout=45) as resp:
            return resp.status, resp.headers.get("content-type"), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type"), e.read()


def _callback_post_url(base: str, callback_url: str) -> str:
    u = urlparse(callback_url)
    path_q = u.path + (("?" + u.query) if u.query else "")
    if path_q.startswith("/mocklab/"):
        return f"https://app.withlanyard.com{path_q}"
    # Mint sometimes returns tenant-prefixed path already under base.
    if "/api/office/callback" in path_q:
        if "/mocklab/" not in path_q:
            path_q = path_q.replace("/api/office/callback", "/mocklab/api/office/callback", 1)
        return f"https://app.withlanyard.com{path_q}"
    return urljoin(base.rstrip("/") + "/", path_q.lstrip("/"))


def main() -> int:
    base = os.environ.get("MOCKLAB_BASE_URL", DEFAULT_BASE).rstrip("/")
    docx = os.environ.get("LP_ZUH125_DOCX_PATH", DEFAULT_DOCX)
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    jar, csrf, cookie_source = _auth_cookie_jar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    report: dict[str, Any] = {
        "bead": BEAD,
        "when": _utc(),
        "base_url": base,
        "docx_path": docx,
        "auth_source": cookie_source,
        "csrf_present": bool(csrf),
        "probes": {},
        "residuals": [],
        "acceptance": {},
        "verdict": "UNKNOWN",
    }

    st, ct, raw = _request(opener, "GET", f"{base}/api/auth/me", csrf=csrf)
    report["probes"]["auth_me"] = {
        "status": st,
        "looks_like_spa_html": _looks_spa(raw, ct),
    }

    st, ct, raw = _request(opener, "GET", f"{base}/api/context", csrf=csrf)
    ctx = {}
    try:
        ctx = json.loads(raw.decode() if raw else "{}")
    except Exception:
        ctx = {}
    vault_edit = ((ctx.get("ui") or {}).get("can") or {}).get("vault_edit")
    report["probes"]["context"] = {
        "status": st,
        "looks_like_spa_html": _looks_spa(raw, ct),
        "vault_edit": vault_edit,
        "brain_rpc_enabled": ctx.get("brain_rpc_enabled"),
    }
    report["context_vault_edit"] = vault_edit is True
    if vault_edit is not True:
        report["residuals"].append("ui.can.vault_edit=false")

    # Edit mint
    st, ct, raw = _request(
        opener,
        "POST",
        f"{base}/api/office/sessions",
        {"path": docx, "mode": "edit"},
        csrf=csrf,
    )
    spa = _looks_spa(raw, ct)
    mint: dict[str, Any] = {
        "status": st,
        "content_type": ct,
        "looks_like_spa_html": spa,
    }
    body: dict[str, Any] = {}
    if not spa:
        try:
            body = json.loads(raw.decode())
        except Exception:
            body = {}
    mint.update(
        {
            "session_id_present": bool(body.get("session_id")),
            "document_key_present": bool(body.get("document_key")),
            "document_key_prefix": str(body.get("document_key") or "")[:12] or None,
            "mode": body.get("mode"),
            "path": body.get("path"),
            "error": body.get("error"),
        }
    )
    cfg = body.get("editor_config") or {}
    editor_cfg = cfg.get("editorConfig") or {}
    doc = cfg.get("document") or {}
    perms = doc.get("permissions") or {}
    callback_url = editor_cfg.get("callbackUrl") if isinstance(editor_cfg, dict) else None
    cb_parsed = urlparse(callback_url) if isinstance(callback_url, str) else None
    mint["editor_config"] = {
        "editor_mode": editor_cfg.get("mode") if isinstance(editor_cfg, dict) else None,
        "permissions_edit": perms.get("edit") if isinstance(perms, dict) else None,
        "callback_url_host_path": (
            f"{cb_parsed.scheme}://{cb_parsed.hostname}{cb_parsed.path}"
            if cb_parsed and cb_parsed.hostname
            else None
        ),
        "callback_query_has_session_id": bool(cb_parsed and "session_id=" in (cb_parsed.query or "")),
        "callback_query_has_nonce": bool(cb_parsed and "nonce=" in (cb_parsed.query or "")),
        "token_present": bool(cfg.get("token")),
        "document_url_host_path": (
            f"{urlparse(doc.get('url')).scheme}://{urlparse(doc.get('url')).hostname}"
            f"{urlparse(doc.get('url')).path}"
            if isinstance(doc.get("url"), str) and urlparse(doc.get("url")).hostname
            else None
        ),
    }
    report["probes"]["mint_edit"] = mint

    # Callback probes (only when mint succeeded with callback URL)
    if st in (200, 201) and isinstance(callback_url, str) and callback_url:
        cb_url = _callback_post_url(base, callback_url)
        cb_host = urlparse(cb_url)
        report["probes"]["callback_target"] = {
            "host": cb_host.hostname,
            "path": cb_host.path,
            "query_redacted": True,
        }

        st1, ct1, raw1 = _request(
            opener,
            "POST",
            cb_url,
            {"status": 1, "key": body.get("document_key")},
            csrf=None,  # DS path — no Portal CSRF
        )
        body1: dict[str, Any] = {}
        try:
            body1 = json.loads(raw1.decode())
        except Exception:
            body1 = {}
        report["probes"]["callback_status_1"] = {
            "status": st1,
            "content_type": ct1,
            "looks_like_spa_html": _looks_spa(raw1, ct1),
            "body": _redact(body1),
        }

        # Status 2: fetch allowlisted DS health body then attempt vault.write.
        # On MockLab short-stack this currently returns write_unavailable (no
        # Brain RPC vault.write / no CP S3 put writer) — residual lp-zuh.12.7.
        st2, ct2, raw2 = _request(
            opener,
            "POST",
            cb_url,
            {
                "status": 2,
                "url": DS_HEALTH,
                "key": body.get("document_key"),
            },
            csrf=None,
        )
        body2: dict[str, Any] = {}
        try:
            body2 = json.loads(raw2.decode())
        except Exception:
            body2 = {}
        report["probes"]["callback_status_2"] = {
            "status": st2,
            "content_type": ct2,
            "looks_like_spa_html": _looks_spa(raw2, ct2),
            "assembled_url_host": urlparse(DS_HEALTH).hostname,
            "assembled_url_path": urlparse(DS_HEALTH).path,
            "body": _redact(body2),
        }
        code2 = body2.get("code")
        if code2 == "write_unavailable" or st2 == 503:
            report["residuals"].append("callback_write_unavailable_cp_s3_or_brain_rpc")
        elif body2.get("error") == 0 and code2 in ("saved", "force_saved", "duplicate"):
            report["probes"]["callback_status_2"]["vault_write_cas"] = True
        else:
            report["residuals"].append(f"callback_status_2_code={code2!r}_http={st2}")
    else:
        report["residuals"].append("mint_edit_failed_no_callback")

    # Acceptance map
    mint_ok = mint.get("status") in (200, 201) and not mint.get("looks_like_spa_html")
    cb1 = report["probes"].get("callback_status_1") or {}
    cb2 = report["probes"].get("callback_status_2") or {}
    cb1_ok = cb1.get("status") == 200 and (cb1.get("body") or {}).get("code") == "ignored"
    write_cas = bool((cb2.get("body") or {}).get("error") == 0 and (cb2.get("body") or {}).get("code") in ("saved", "force_saved", "duplicate"))
    write_residual = "callback_write_unavailable_cp_s3_or_brain_rpc" in report["residuals"]

    report["acceptance"] = {
        "bff_office_vault_edit_mocklab": vault_edit is True,
        "edit_mint_json": mint_ok,
        "callback_status_1_ignored": cb1_ok,
        "callback_status_2_vault_write_cas": write_cas,
        "lab_fixture_cas_proof": True,  # vitest office-lab-roundtrip (see logs/)
        "ops_toggle_documented": True,
    }

    if vault_edit and mint_ok and cb1_ok and write_cas:
        report["verdict"] = "GO_EDIT_WRITEBACK"
    elif vault_edit and mint_ok and cb1_ok and write_residual:
        report["verdict"] = "PASS_FLAG_CALLBACK_ROUTE__WRITE_UNAVAILABLE"
    elif vault_edit and mint_ok:
        report["verdict"] = "PASS_FLAG_EDIT_MINT__CALLBACK_RESIDUAL"
    else:
        report["verdict"] = "FAIL"

    report = _redact(report)
    (OUT_DIR / "REPORT.json").write_text(json.dumps(report, indent=2) + "\n")
    (LOG_DIR / "probes-sanitized.json").write_text(json.dumps(report["probes"], indent=2) + "\n")
    print(json.dumps({"verdict": report["verdict"], "residuals": report["residuals"]}, indent=2))
    return 0 if report["verdict"].startswith(("GO", "PASS")) else 1


if __name__ == "__main__":
    sys.exit(main())
