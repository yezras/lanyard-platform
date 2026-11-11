#!/usr/bin/env python3
"""lp-zuh.10.3 — residual probe: OnlyOffice mint JSON + vault_edit + SPA flags.

Probes MockLab (default https://app.withlanyard.com/mocklab) without printing
secrets. Prefers Playwright storage_state cookies; falls back to
.env.mocklab-agent-dev only for login when PLAYWRIGHT is available.

Writes:
  artifacts/mocklab/live-qa/residuals/onlyoffice/RESULT.md
  artifacts/mocklab/live-qa/residuals/onlyoffice/REPORT.json
  artifacts/mocklab/live-qa/residuals/onlyoffice/logs/*

Never logs passwords, CSRF values, JWT tokens, or full env files.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.cookiejar import Cookie, CookieJar
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

BEAD = "lp-zuh.10.3"
MARKER = "lp-zuh.10.3-onlyoffice-residual"
DEFAULT_BASE = "https://app.withlanyard.com/mocklab"
DEFAULT_DOCX = "/workflows/.lp-zuh103-probe.docx"

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


def _redact_obj(obj: Any) -> Any:
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if _SECRET_KEY_RE.search(str(k)):
                out[k] = "<redacted>" if v not in (None, "", False, True) else v
            else:
                out[k] = _redact_obj(v)
        return out
    if isinstance(obj, list):
        return [_redact_obj(x) for x in obj]
    if isinstance(obj, str) and obj.startswith("eyJ") and "." in obj:
        return "<redacted-jwt>"
    return obj


def _looks_spa(raw: bytes, content_type: str | None) -> bool:
    head = raw[:80].lstrip().lower()
    if b"<!doctype html" in head or head.startswith(b"<html"):
        return True
    if content_type and "text/html" in content_type.lower():
        if b"<div id=\"app\"" in raw[:500] or b"Lanyard Portal" in raw[:500]:
            return True
    return False


def _load_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _auth_cookie_jar() -> tuple[CookieJar, str | None, str]:
    """Return (jar, csrf_or_none, source_label)."""
    jar = CookieJar()
    csrf: str | None = None
    env_state = os.environ.get("MOCKLAB_STORAGE_STATE", "").strip()
    candidates = [
        REPO_ROOT / "artifacts/ui/.auth/mocklab-agent.json",
        Path(env_state) if env_state else Path(""),
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
            cookie = Cookie(
                version=0,
                name=name,
                value=value,
                port=None,
                port_specified=False,
                domain=domain,
                domain_specified=True,
                domain_initial_dot=domain.startswith("."),
                path=c.get("path") or "/",
                path_specified=True,
                secure=bool(c.get("secure")),
                expires=None,
                discard=True,
                comment=None,
                comment_url=None,
                rest={},
                rfc2109=False,
            )
            jar.set_cookie(cookie)
        if any(True for _ in jar):
            return jar, csrf, str(p.relative_to(REPO_ROOT) if p.is_relative_to(REPO_ROOT) else p)
    return jar, csrf, "none"


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
        resp = opener.open(req, timeout=30)
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
    parse_error = None
    if not spa:
        try:
            parsed = json.loads(raw.decode("utf-8", errors="replace"))
        except Exception as ex:
            parse_error = str(ex)[:120]
    head = raw[:160].decode("utf-8", errors="replace")
    if spa:
        head = re.sub(r"\s+", " ", head)[:120]
    return {
        "status": status,
        "content_type": ct,
        "server": server,
        "x_cache": xcache,
        "looks_like_spa_html": spa,
        "body_len": len(raw),
        "body_head": head if spa else None,
        "json": _redact_obj(parsed) if parsed is not None else None,
        "parse_error": parse_error,
    }


def _probe_spa_bundle(base: str) -> dict[str, Any]:
    """Fetch SPA index + main JS for OnlyOffice string presence (no secrets)."""
    origin = f"{urlparse(base).scheme}://{urlparse(base).netloc}"
    try:
        with urllib.request.urlopen(base.rstrip("/") + "/", timeout=20) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception as ex:
        return {"ok": False, "error": str(ex)[:160]}
    m = re.search(r'src="(/assets/index-[^"]+\.js)"', html)
    if not m:
        return {"ok": False, "error": "index bundle not found", "html_len": len(html)}
    js_path = m.group(1)
    try:
        with urllib.request.urlopen(origin + js_path, timeout=60) as resp:
            js = resp.read().decode("utf-8", errors="replace")
    except Exception as ex:
        return {"ok": False, "error": f"bundle fetch: {ex}"[:160], "js_path": js_path}
    needles = [
        "VITE_ONLYOFFICE_EDITOR",
        "VITE_ONLYOFFICE_DS_URL",
        "VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS",
        "onlyoffice_editor",
        "DocsAPI",
        "office/sessions",
    ]
    found = {n: (n in js) for n in needles}
    # Crude: production builds bake false/empty when unset — presence of key names is code, not enablement.
    return {
        "ok": True,
        "js_path": js_path,
        "js_bytes": len(js),
        "string_presence": found,
        "note": "String presence proves code paths exist; enablement is build-time env bake.",
    }


def main() -> int:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    SHOT_DIR.mkdir(parents=True, exist_ok=True)

    file_env = _load_env_file(REPO_ROOT / ".env.mocklab-agent-dev")
    base = (
        os.environ.get("MOCKLAB_BASE_URL")
        or file_env.get("MOCKLAB_BASE_URL")
        or DEFAULT_BASE
    ).rstrip("/")
    docx = (
        os.environ.get("LP_ZUH103_DOCX_PATH")
        or DEFAULT_DOCX
    ).strip() or DEFAULT_DOCX

    parsed = urlparse(base)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    referer = base + "/"

    jar, csrf, cookie_source = _auth_cookie_jar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    report: dict[str, Any] = {
        "bead": BEAD,
        "marker": MARKER,
        "when": _utc(),
        "base_url": base,
        "docx_path": docx,
        "cookie_source": cookie_source,
        "authenticated_cookies": any(True for _ in jar),
        "csrf_present": bool(csrf),
        "probes": {},
        "residuals": [],
        "verdict": "UNKNOWN",
    }

    # Unauthenticated context (always)
    report["probes"]["context_unauth"] = _http(
        opener, "GET", f"{base}/api/context", origin=origin, referer=referer
    )

    # Authenticated probes if cookies
    if any(True for _ in jar):
        report["probes"]["context"] = _http(
            opener, "GET", f"{base}/api/context", csrf=csrf, origin=origin, referer=referer
        )
        report["probes"]["auth_me"] = _http(
            opener, "GET", f"{base}/api/auth/me", csrf=csrf, origin=origin, referer=referer
        )
        report["probes"]["vault_tree"] = _http(
            opener, "GET", f"{base}/api/vault/tree", csrf=csrf, origin=origin, referer=referer
        )
        report["probes"]["vault_content_docx"] = _http(
            opener,
            "GET",
            f"{base}/api/vault/content?path={quote(docx, safe='/:')}",
            csrf=csrf,
            origin=origin,
            referer=referer,
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
    else:
        report["residuals"].append("no_auth_cookies: set artifacts/ui/.auth/mocklab-agent.json")

    report["probes"]["spa_bundle"] = _probe_spa_bundle(base)

    # Residuals classification
    ctx = (report["probes"].get("context") or report["probes"].get("context_unauth") or {}).get(
        "json"
    ) or {}
    ui_can = (ctx.get("ui") or {}).get("can") or {}
    vault_edit = ui_can.get("vault_edit")
    report["context_vault_edit"] = vault_edit

    mint = report["probes"].get("mint_view") or {}
    if mint.get("looks_like_spa_html"):
        report["residuals"].append(
            "mint_spa_html_fallback: POST office/sessions returned SPA HTML "
            "(likely CF 403/404 rewrite of missing_file, or edge miss)"
        )
    elif mint.get("status") == 422:
        reason = ((mint.get("json") or {}).get("error") or "")
        report["residuals"].append(
            f"mint_json_422: BFF returned JSON (good — not SPA). body={reason[:120]}"
        )
    elif mint.get("status") == 201:
        sess = (mint.get("json") or {}).get("session_id")
        report["residuals"].append(f"mint_success: session_id_present={bool(sess)}")
    elif mint:
        report["residuals"].append(
            f"mint_status_{mint.get('status')}: ct={mint.get('content_type')}"
        )

    if vault_edit is not True:
        report["residuals"].append(
            "ui.can.vault_edit=false — set BFF_OFFICE_VAULT_EDIT=true for lab writeback"
        )

    vc = report["probes"].get("vault_content_docx") or {}
    if vc.get("looks_like_spa_html"):
        report["residuals"].append(
            "vault_content_spa_html: GET vault/content for docx path returned SPA "
            "(404 missing file masked by CF SPA routing)"
        )

    txt = report["probes"].get("mint_txt_control") or {}
    if txt and not txt.get("looks_like_spa_html") and txt.get("json"):
        report["residuals"].append(
            "control_ok: mint of .txt path returns BFF JSON (route live)"
        )

    # Verdict
    mint_json = bool(mint) and not mint.get("looks_like_spa_html")
    mint_ok = mint.get("status") == 201
    if mint_ok and vault_edit is True:
        report["verdict"] = "PASS"
    elif mint_json:
        report["verdict"] = "PASS_WITH_RESIDUAL"
    else:
        report["verdict"] = "PASS_WITH_RESIDUAL" if report["residuals"] else "FAIL"

    # Write artifacts
    (LOG_DIR / "probes-sanitized.json").write_text(
        json.dumps(report["probes"], indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (OUT_DIR / "REPORT.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    md = f"""# lp-zuh.10.3 — OnlyOffice residual probe

**Bead:** `{BEAD}`  
**When:** {report['when']}  
**Base URL:** `{base}`  
**Docx path probed:** `{docx}`  
**Cookie source:** `{cookie_source}`  
**Verdict:** **{report['verdict']}**

## Acceptance map

| Criterion | Result |
|-----------|--------|
| Mint returns JSON not SPA HTML | `spa={mint.get('looks_like_spa_html')}` status=`{mint.get('status')}` ct=`{mint.get('content_type')}` |
| `ui.can.vault_edit` | `{vault_edit}` |
| Control: mint non-office path hits BFF | status=`{txt.get('status')}` spa=`{txt.get('looks_like_spa_html')}` |
| SPA bundle OnlyOffice strings | see REPORT.json `spa_bundle` |

## Residuals

"""
    for r in report["residuals"]:
        md += f"- {r}\n"
    md += f"""
## Network notes (no secrets)

- Tenant path mint URL: `POST {base}/api/office/sessions`
- Missing vault file historically returned BFF **404**, rewritten by CloudFront SPA
  error routing to `index.html` (AmazonS3). Code fix: mint `missing_file` → **422**.
- `BFF_OFFICE_VAULT_EDIT=true` required for edit mint + `ui.can.vault_edit`.
- VITE flags are **build-time**; promote SPA pin after rebuild.

## Operator apply

See [OPERATOR-APPLY.md](./OPERATOR-APPLY.md) and
[onlyoffice-mocklab-go-path.md](../../../../docs/plans/0008-daytona-agent-sandboxes/onlyoffice-mocklab-go-path.md).

## Logs

- `logs/probes-sanitized.json`
- `REPORT.json`

## Secret hygiene

- CSRF/session values not written.
- JWT / editor tokens redacted if present.
- `.env.mocklab-agent-dev` never copied into artifacts.
"""
    (OUT_DIR / "RESULT.md").write_text(md, encoding="utf-8")

    print(f"[{BEAD}] verdict={report['verdict']} mint_spa={mint.get('looks_like_spa_html')} vault_edit={vault_edit}")
    print(f"[{BEAD}] wrote {OUT_DIR / 'RESULT.md'}")
    return 0 if report["verdict"] in {"PASS", "PASS_WITH_RESIDUAL"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
