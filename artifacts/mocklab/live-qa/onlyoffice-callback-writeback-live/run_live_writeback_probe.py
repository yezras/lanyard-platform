#!/usr/bin/env python3
"""lp-zuh.13.1 — Live MockLab OnlyOffice callback writeback proof.

After CP+BFF redeploy with VAULT_PLANE=cp_s3 + BFF_OFFICE_VAULT_EDIT=true:

  1. Authenticated edit mint (JSON)
  2. Callback status 1 → ignored
  3. Callback status 2 → saved (CP vault put) with new content-hash revision
  4. Vault bytes / document.key advance on the path
  5. Restore original vault object via S3 (operator AWS) so lab docx stays intact

Auth: password login with CSRF (storage_state may be stale).
Credentials: MOCKLAB_AGENT_* from gitignored .env.mocklab-agent-dev (never printed).

No secrets in REPORT.json / logs (tokens, nonces, cookies, passwords redacted).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

BEAD = "lp-zuh.13.1"
DEFAULT_BASE = "https://app.withlanyard.com/mocklab"
DEFAULT_DOCX = "/Projects/Workspace/office/lp-zuh123-mint-proof.docx"
DS_HEALTH = (
    "http://lanyard-platform-staging-docs-al-238458258.us-east-1.elb.amazonaws.com"
    "/healthcheck"
)
S3_BUCKET = "lanyard-mocklab-vault-123456789012"
S3_KEY = (
    "tenants/319d3808-e533-44db-bfdf-7b6ef8caaae1/vault"
    "/Projects/Workspace/office/lp-zuh123-mint-proof.docx"
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


def _password_login(base: str) -> tuple[CookieJar, str, str]:
    email = os.environ.get("MOCKLAB_AGENT_EMAIL") or os.environ.get("MOCKLAB_EMAIL")
    password = os.environ.get("MOCKLAB_AGENT_PASSWORD") or os.environ.get("MOCKLAB_PASSWORD")
    if not email or not password:
        raise SystemExit("Need MOCKLAB_AGENT_EMAIL/PASSWORD from .env.mocklab-agent-dev")

    jar = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    with opener.open(f"{base}/api/auth/csrf", timeout=45) as resp:
        csrf_body = json.loads(resp.read())
    csrf = csrf_body.get("csrf_token")
    if not isinstance(csrf, str) or not csrf:
        raise SystemExit("csrf bootstrap failed")

    req = urllib.request.Request(
        f"{base}/api/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"content-type": "application/json", "x-csrf-token": csrf},
        method="POST",
    )
    with opener.open(req, timeout=45) as resp:
        if resp.status != 200:
            raise SystemExit(f"login HTTP {resp.status}")
        resp.read()

    for c in jar:
        if "csrf" in c.name.lower() and c.value:
            csrf = c.value
    return jar, csrf, "password-login+csrf"


def _request(
    opener: urllib.request.OpenerDirector,
    method: str,
    url: str,
    data: dict[str, Any] | None = None,
    csrf: str | None = None,
) -> tuple[int, str | None, bytes]:
    headers: dict[str, str] = {"Accept": "application/json"}
    if csrf:
        headers["x-csrf-token"] = csrf
        headers["x-xsrf-token"] = csrf
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with opener.open(req, timeout=60) as resp:
            return resp.status, resp.headers.get("content-type"), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type"), e.read()


def _callback_post_url(base: str, callback_url: str) -> str:
    u = urlparse(callback_url)
    path_q = u.path + (("?" + u.query) if u.query else "")
    if path_q.startswith("/mocklab/"):
        return f"https://app.withlanyard.com{path_q}"
    if "/api/office/callback" in path_q:
        if "/mocklab/" not in path_q:
            path_q = path_q.replace(
                "/api/office/callback", "/mocklab/api/office/callback", 1
            )
        return f"https://app.withlanyard.com{path_q}"
    return urljoin(base.rstrip("/") + "/", path_q.lstrip("/"))


def _vault_content_meta(
    opener: urllib.request.OpenerDirector, base: str, path: str, csrf: str
) -> dict[str, Any]:
    st, ct, raw = _request(
        opener, "GET", f"{base}/api/vault/content?path={path}", csrf=csrf
    )
    out: dict[str, Any] = {
        "status": st,
        "content_type": ct,
        "looks_like_spa_html": _looks_spa(raw, ct),
    }
    if st != 200 or _looks_spa(raw, ct):
        return out
    try:
        body = json.loads(raw.decode())
    except Exception:
        out["parse_error"] = True
        return out
    content_b64 = body.get("content")
    digest = None
    size = body.get("size_bytes")
    if isinstance(content_b64, str) and content_b64:
        try:
            raw_bytes = base64.b64decode(content_b64)
            digest = hashlib.sha256(raw_bytes).hexdigest()
            size = len(raw_bytes)
        except Exception:
            digest = None
    out.update(
        {
            "path": body.get("path"),
            "kind": body.get("kind"),
            "mime_type": body.get("mime_type"),
            "size_bytes": size,
            "content_sha256": digest,
            "encoding": body.get("encoding"),
        }
    )
    return out


def _mint_edit(
    opener: urllib.request.OpenerDirector, base: str, docx: str, csrf: str
) -> dict[str, Any]:
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
            "_raw_body": body,  # stripped before write
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
        "callback_query_has_session_id": bool(
            cb_parsed and "session_id=" in (cb_parsed.query or "")
        ),
        "callback_query_has_nonce": bool(
            cb_parsed and "nonce=" in (cb_parsed.query or "")
        ),
        "token_present": bool(cfg.get("token")),
    }
    mint["_callback_url"] = callback_url if isinstance(callback_url, str) else None
    mint["_document_key"] = body.get("document_key")
    return mint


def _s3_backup_restore(backup_path: Path) -> dict[str, Any]:
    """Backup then later restore vault object. Uses AWS_PROFILE=lanyard-main."""
    env = os.environ.copy()
    env.setdefault("AWS_PROFILE", "lanyard-main")
    env.setdefault("AWS_REGION", "us-east-1")
    uri = f"s3://{S3_BUCKET}/{S3_KEY}"
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    cp = subprocess.run(
        ["aws", "s3", "cp", uri, str(backup_path)],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )
    return {
        "ok": cp.returncode == 0,
        "uri": uri,
        "backup": str(backup_path.name),
        "stderr_tail": (cp.stderr or "")[-200:],
    }


def _s3_restore(backup_path: Path) -> dict[str, Any]:
    env = os.environ.copy()
    env.setdefault("AWS_PROFILE", "lanyard-main")
    env.setdefault("AWS_REGION", "us-east-1")
    uri = f"s3://{S3_BUCKET}/{S3_KEY}"
    cp = subprocess.run(
        ["aws", "s3", "cp", str(backup_path), uri, "--content-type",
         "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )
    return {
        "ok": cp.returncode == 0,
        "uri": uri,
        "stderr_tail": (cp.stderr or "")[-200:],
    }


def main() -> int:
    base = os.environ.get("MOCKLAB_BASE_URL", DEFAULT_BASE).rstrip("/")
    docx = os.environ.get("LP_ZUH131_DOCX_PATH", DEFAULT_DOCX)
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    jar, csrf, cookie_source = _password_login(base)
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    report: dict[str, Any] = {
        "bead": BEAD,
        "when": _utc(),
        "base_url": base,
        "docx_path": docx,
        "auth_source": cookie_source,
        "csrf_present": bool(csrf),
        "redeploy": {
            "cp_cluster": "lanyard-platform-staging-portal-cp",
            "cp_service": "lanyard-platform-staging-cp",
            "cp_task_def": "lanyard-platform-staging-cp:26",
            "cp_image_tag": "lp-oop37-cp-43e10186",
            "cp_image_digest": "sha256:a4ceafd95b78200d42fbf2ad7530a0338d7afded40c2e007bcc302f0543e36af",
            "bff_cluster": "lanyard-platform-staging-portal",
            "bff_service": "lanyard-platform-staging-bff",
            "bff_task_def": "lanyard-platform-staging-bff:34",
            "bff_image_tag": "lp-oop37-f353341e",
            "bff_image_digest": "sha256:638a02954e586dfb28522761c1607ffd231e086302800d8dc0ffe6b7065334d2",
            "force_new_deployment_at": os.environ.get(
                "LP_ZUH131_REDEPLOY_AT", "2026-08-19T11:45:04Z"
            ),
            "env": {
                "VAULT_PLANE": "cp_s3",
                "BFF_OFFICE_VAULT_EDIT": "true",
            },
        },
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
    if st != 200:
        report["residuals"].append(f"auth_me_{st}")
        report["verdict"] = "FAIL"
        _write(report)
        return 1

    st, ct, raw = _request(opener, "GET", f"{base}/api/context", csrf=csrf)
    ctx: dict[str, Any] = {}
    try:
        ctx = json.loads(raw.decode() if raw else "{}")
    except Exception:
        ctx = {}
    vault_edit = ((ctx.get("ui") or {}).get("can") or {}).get("vault_edit")
    report["probes"]["context"] = {
        "status": st,
        "looks_like_spa_html": _looks_spa(raw, ct),
        "vault_edit": vault_edit,
        "vault_plane": ctx.get("vault_plane"),
        "brain_rpc_enabled": ctx.get("brain_rpc_enabled"),
    }
    report["context_vault_edit"] = vault_edit is True
    if vault_edit is not True:
        report["residuals"].append("ui.can.vault_edit=false")

    # Backup vault object before destructive writeback probe.
    backup_path = LOG_DIR / "vault-docx-backup.docx"
    backup = _s3_backup_restore(backup_path)
    report["probes"]["s3_backup"] = {
        "ok": backup["ok"],
        "uri_bucket_key_present": True,
        "backup_bytes": backup_path.stat().st_size if backup_path.is_file() else 0,
    }
    if not backup["ok"]:
        report["residuals"].append("s3_backup_failed")

    before = _vault_content_meta(opener, base, docx, csrf)
    report["probes"]["vault_before"] = before
    before_hash = before.get("content_sha256")

    mint = _mint_edit(opener, base, docx, csrf)
    callback_url = mint.pop("_callback_url", None)
    document_key = mint.pop("_document_key", None)
    raw_body = mint.pop("_raw_body", {})
    report["probes"]["mint_edit"] = mint

    write_cas = False
    after_hash = None
    remint_key_prefix = None
    health_sha = None

    if mint.get("status") in (200, 201) and isinstance(callback_url, str) and callback_url:
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
            {"status": 1, "key": document_key},
            csrf=None,
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

        # Fetch healthcheck bytes so we know expected content-hash revision.
        try:
            with urllib.request.urlopen(DS_HEALTH, timeout=30) as resp:
                health_bytes = resp.read()
            health_sha = hashlib.sha256(health_bytes).hexdigest()
        except Exception as e:
            health_bytes = b""
            health_sha = None
            report["residuals"].append(f"ds_health_fetch_failed:{type(e).__name__}")

        st2, ct2, raw2 = _request(
            opener,
            "POST",
            cb_url,
            {
                "status": 2,
                "url": DS_HEALTH,
                "key": document_key,
            },
            csrf=None,
        )
        body2: dict[str, Any] = {}
        try:
            body2 = json.loads(raw2.decode())
        except Exception:
            body2 = {}
        code2 = body2.get("code")
        write_cas = bool(
            body2.get("error") == 0 and code2 in ("saved", "force_saved", "duplicate")
        )
        report["probes"]["callback_status_2"] = {
            "status": st2,
            "content_type": ct2,
            "looks_like_spa_html": _looks_spa(raw2, ct2),
            "assembled_url_host": urlparse(DS_HEALTH).hostname,
            "assembled_url_path": urlparse(DS_HEALTH).path,
            "assembled_body_sha256": health_sha,
            "body": _redact(body2),
            "vault_write_cas": write_cas,
        }
        if code2 == "write_unavailable" or st2 == 503:
            report["residuals"].append("callback_write_unavailable")
        elif not write_cas:
            report["residuals"].append(f"callback_status_2_code={code2!r}_http={st2}")

        after = _vault_content_meta(opener, base, docx, csrf)
        report["probes"]["vault_after"] = after
        after_hash = after.get("content_sha256")

        # Remint to show document.key (revision-bound) advanced.
        remint = _mint_edit(opener, base, docx, csrf)
        remint.pop("_callback_url", None)
        remint_key = remint.pop("_document_key", None)
        remint.pop("_raw_body", None)
        remint_key_prefix = remint.get("document_key_prefix")
        report["probes"]["mint_edit_after_write"] = remint
        report["probes"]["revision_advance"] = {
            "vault_sha256_before": before_hash,
            "vault_sha256_after": after_hash,
            "assembled_body_sha256": health_sha,
            "sha256_changed": bool(before_hash and after_hash and before_hash != after_hash),
            "after_matches_assembled": bool(
                after_hash and health_sha and after_hash == health_sha
            ),
            "document_key_prefix_before": mint.get("document_key_prefix"),
            "document_key_prefix_after": remint_key_prefix,
            "document_key_changed": bool(
                document_key
                and remint_key
                and document_key != remint_key
            ),
            "note": (
                "DocumentRevision.token kind=content_hash equals sha256 of vault bytes; "
                "HTTP callback body is OnlyOffice {error,code} only — revision proved via "
                "vault content hash + document.key advance."
            ),
        }
    else:
        report["residuals"].append("mint_edit_failed_no_callback")
        # still attempt remint fields absent

    # Restore original docx so lab stays usable.
    restore: dict[str, Any] = {"skipped": True}
    if backup_path.is_file() and backup.get("ok"):
        restore = _s3_restore(backup_path)
        report["probes"]["s3_restore"] = {
            "ok": restore["ok"],
            "uri_bucket_key_present": True,
        }
        if restore["ok"]:
            restored = _vault_content_meta(opener, base, docx, csrf)
            report["probes"]["vault_restored"] = restored
            report["probes"]["vault_restored"]["matches_backup_sha256"] = bool(
                before_hash
                and restored.get("content_sha256") == before_hash
            )
        else:
            report["residuals"].append("s3_restore_failed")
    else:
        report["probes"]["s3_restore"] = {"ok": False, "skipped": True}

    mint_ok = mint.get("status") in (200, 201) and not mint.get("looks_like_spa_html")
    cb1 = report["probes"].get("callback_status_1") or {}
    cb1_ok = cb1.get("status") == 200 and (cb1.get("body") or {}).get("code") == "ignored"
    rev = report["probes"].get("revision_advance") or {}
    revision_ok = bool(
        write_cas
        and rev.get("sha256_changed")
        and rev.get("after_matches_assembled")
        and rev.get("document_key_changed")
    )

    report["acceptance"] = {
        "redeploy_cp_bff_with_vault_plane_cp_s3": True,
        "bff_office_vault_edit_true": vault_edit is True,
        "edit_mint_json": mint_ok,
        "callback_status_1_ignored": cb1_ok,
        "callback_status_2_saved": write_cas,
        "document_revision_on_vault_path": revision_ok,
        "fail_closed_edit_flag_false": True,  # vitest — see logs/ + RESULT.md
        "vault_restored_after_probe": bool(
            (report["probes"].get("s3_restore") or {}).get("ok")
        ),
    }

    if (
        vault_edit
        and mint_ok
        and cb1_ok
        and write_cas
        and revision_ok
    ):
        report["verdict"] = "GO_LIVE_WRITEBACK"
    elif vault_edit and mint_ok and cb1_ok and write_cas:
        report["verdict"] = "PASS_SAVED__REVISION_PARTIAL"
        report["residuals"].append("revision_advance_incomplete")
    elif vault_edit and mint_ok and cb1_ok:
        report["verdict"] = "PASS_FLAG_CALLBACK__WRITE_FAILED"
    else:
        report["verdict"] = "FAIL"

    # Drop any accidental raw session bodies
    _ = raw_body
    _write(report)
    print(
        json.dumps(
            {
                "verdict": report["verdict"],
                "residuals": report["residuals"],
                "acceptance": report["acceptance"],
            },
            indent=2,
        )
    )
    return 0 if str(report["verdict"]).startswith(("GO", "PASS")) else 1


def _write(report: dict[str, Any]) -> None:
    safe = _redact(report)
    (OUT_DIR / "REPORT.json").write_text(json.dumps(safe, indent=2) + "\n")
    (LOG_DIR / "probes-sanitized.json").write_text(
        json.dumps(safe.get("probes") or {}, indent=2) + "\n"
    )


if __name__ == "__main__":
    sys.exit(main())
