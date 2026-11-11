#!/usr/bin/env python3
"""lp-zuh.12.4 — Playwright: OnlyOffice editor host mounts DocsAPI (nonblank canvas).

Tracks:
  A) Auth-free Vite story mode (?story=document-pane&mode=onlyoffice) — product-
     allowed mock DocsAPI lab surface (acceptance criterion 3).
  B) Live MockLab vault/editor residual probe (HTTPS DS + SPA shell).
  C) Optional localhost lab BFF+DS real DocsAPI iframe when LAB_BFF_URL healthy.

Auth (track B only):
  - artifacts/ui/.auth/mocklab-agent.json storage_state, or
  - MOCKLAB_AGENT_EMAIL / MOCKLAB_AGENT_PASSWORD (never printed)

Writes REPORT.json + RESULT.md + logs/* + screenshots/* under this directory.
No secrets in evidence.
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

BEAD = "lp-zuh.12.4"
DEFAULT_LIVE_BASE = "https://app.withlanyard.com/mocklab"
DEFAULT_DOCX = "/Projects/Workspace/office/lp-zuh123-mint-proof.docx"
DEFAULT_STORY_BASE = "http://127.0.0.1:3027"
DEFAULT_LAB_BFF = "http://127.0.0.1:4100"
DEFAULT_LAB_DS = "http://127.0.0.1:8080"

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


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_redact(payload), indent=2) + "\n", encoding="utf-8")


def _http_ok(url: str, timeout: float = 5.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


def _curl_probe(url: str, max_time: int = 8) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            [
                "curl",
                "-sS",
                "-o",
                "/tmp/lp-zuh124-curl-body",
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
        head = ""
        body_path = Path("/tmp/lp-zuh124-curl-body")
        if body_path.is_file():
            head = body_path.read_bytes()[:160].decode("utf-8", errors="replace")
        return {
            "url": url,
            "status": code,
            "content_type": ct,
            "bytes": size,
            "head": head,
            "ok": 200 <= code < 300,
        }
    except Exception as e:
        return {"url": url, "status": 0, "ok": False, "error": type(e).__name__}


def _tcp_probe(host: str, port: int, timeout: float = 3.0) -> dict[str, Any]:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return {"host": host, "port": port, "ok": True}
    except Exception as e:
        return {"host": host, "port": port, "ok": False, "error": str(e)[:120]}


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        v = v.strip().strip("'").strip('"')
        if k and k not in os.environ:
            os.environ[k] = v


def _playwright():
    try:
        from playwright.sync_api import sync_playwright

        return sync_playwright
    except Exception:
        # Prefer known project / skill venvs without mutating system python.
        candidates = [
            REPO_ROOT / "portal/packages/web/ui-testing/.venv/bin/python",
            Path.home() / ".grok/skills/web-ui-testing/.venv/bin/python",
        ]
        for py in candidates:
            if not py.is_file():
                continue
            # Re-exec under venv python so imports resolve.
            os.execv(str(py), [str(py), str(Path(__file__).resolve()), *sys.argv[1:]])
        raise RuntimeError("playwright not available; activate ui-testing/.venv")


def track_a_story_mock(story_base: str, report: dict[str, Any]) -> dict[str, Any]:
    """Product-allowed mock DocsAPI lab surface via document-pane story."""
    from playwright.sync_api import sync_playwright, expect

    out: dict[str, Any] = {
        "track": "A_story_mock_surface",
        "base": story_base,
        "passed": False,
        "checks": {},
    }
    if not _http_ok(story_base.rstrip("/") + "/"):
        out["error"] = "story_host_unreachable"
        report["tracks"]["A"] = out
        return out

    # Prefer /chat?story=… (root also preserves search after lp-zuh.12.4 redirect fix).
    base = story_base.rstrip("/")
    url = f"{base}/chat?story=document-pane&mode=onlyoffice&layout=split"
    url_root = f"{base}/?story=document-pane&mode=onlyoffice&layout=split"
    flag_off = f"{base}/chat?story=document-pane&mode=flag_off&layout=split"
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
        )
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(url, wait_until="networkidle", timeout=90_000)

        story = page.get_by_test_id("document-pane-story")
        expect(story).to_be_visible(timeout=20_000)
        mode = story.get_attribute("data-story-mode")
        out["checks"]["story_mode"] = mode
        out["checks"]["story_url"] = page.url
        assert mode == "onlyoffice"

        pane = page.get_by_test_id("chat-document-pane")
        expect(pane).to_be_visible(timeout=15_000)
        renderer = pane.get_attribute("data-renderer")
        out["checks"]["renderer"] = renderer
        assert renderer == "onlyoffice"

        host = page.get_by_test_id("onlyoffice-editor-host")
        expect(host).to_be_visible(timeout=15_000)
        out["checks"]["editor_host_visible"] = True

        surface = page.get_by_test_id("onlyoffice-editor-mock-surface")
        expect(surface).to_be_visible(timeout=15_000)
        text = surface.inner_text()
        out["checks"]["mock_surface_text_snip"] = text[:160]
        assert "ONLYOFFICE editor" in text
        assert "nonblank mount" in text
        box = surface.bounding_box()
        out["checks"]["mock_surface_box"] = box
        assert box is not None and box["height"] >= 200 and box["width"] >= 200

        # No silent preview fallback when editor claimed on.
        preview_count = page.get_by_text("Document pane preview").count()
        fallback_attr = story.get_attribute("data-preview-fallback")
        out["checks"]["preview_text_count"] = preview_count
        out["checks"]["data_preview_fallback"] = fallback_attr
        assert preview_count == 0
        assert fallback_attr in (None, "0", "")

        # Root `/?story=` must preserve search → story (not naked /chat sign-in).
        page.goto(url_root, wait_until="networkidle", timeout=60_000)
        out["checks"]["root_story_redirect_url"] = page.url
        expect(page.get_by_test_id("document-pane-story")).to_be_visible(timeout=15_000)
        out["checks"]["root_story_mode"] = page.get_by_test_id(
            "document-pane-story"
        ).get_attribute("data-story-mode")
        assert "story=document-pane" in page.url
        assert page.get_by_test_id("onlyoffice-editor-host").count() == 1

        # Negative control: flag_off must use preview (not silent when editor on).
        page.goto(flag_off, wait_until="networkidle", timeout=60_000)
        story2 = page.get_by_test_id("document-pane-story")
        expect(story2).to_be_visible(timeout=15_000)
        out["checks"]["flag_off_mode"] = story2.get_attribute("data-story-mode")
        out["checks"]["flag_off_preview_fallback"] = story2.get_attribute(
            "data-preview-fallback"
        )
        pane2 = page.get_by_test_id("chat-document-pane")
        expect(pane2).to_be_visible(timeout=15_000)
        out["checks"]["flag_off_renderer"] = pane2.get_attribute("data-renderer")
        assert pane2.get_attribute("data-renderer") == "preview"
        assert page.get_by_test_id("onlyoffice-editor-host").count() == 0

        shot2 = SHOT_DIR / "02-story-flag-off-preview-fallback.png"
        page.screenshot(path=str(shot2), full_page=True)
        out["checks"]["flag_off_screenshot"] = shot2.name

        # Return to onlyoffice for primary screenshot.
        page.goto(url, wait_until="networkidle", timeout=60_000)
        expect(page.get_by_test_id("onlyoffice-editor-host")).to_be_visible(
            timeout=15_000
        )
        shot = SHOT_DIR / "01-story-onlyoffice-editor-host-nonblank.png"
        page.screenshot(path=str(shot), full_page=True)
        out["checks"]["screenshot"] = shot.name
        out["checks"]["screenshot_bytes"] = shot.stat().st_size
        assert shot.stat().st_size > 5_000

        browser.close()

    out["passed"] = True
    report["tracks"]["A"] = out
    return out


def track_b_live_mocklab(live_base: str, report: dict[str, Any]) -> dict[str, Any]:
    """Honest residual probe against live MockLab (SPA + HTTPS DS)."""
    from playwright.sync_api import sync_playwright

    out: dict[str, Any] = {
        "track": "B_live_mocklab_residual",
        "base": live_base,
        "passed": False,
        "editor_go_claimed": False,
        "checks": {},
        "residuals": [],
    }

    # DS HTTPS vs HTTP
    ds_https = (
        "https://lanyard-platform-staging-docs-al-238458258.us-east-1.elb.amazonaws.com"
    )
    ds_http = (
        "http://lanyard-platform-staging-docs-al-238458258.us-east-1.elb.amazonaws.com"
    )
    https_api = _curl_probe(f"{ds_https}/web-apps/apps/api/documents/api.js", max_time=6)
    http_api = _curl_probe(f"{ds_http}/web-apps/apps/api/documents/api.js", max_time=6)
    https_tcp = _tcp_probe(
        "lanyard-platform-staging-docs-al-238458258.us-east-1.elb.amazonaws.com", 443
    )
    out["checks"]["ds_https_api_js"] = https_api
    out["checks"]["ds_http_api_js"] = http_api
    out["checks"]["ds_https_tcp"] = https_tcp
    if not https_api.get("ok"):
        out["residuals"].append("https_ds_residual")

    auth_candidates = [
        REPO_ROOT / "artifacts/ui/.auth/mocklab-agent.json",
        Path(os.environ["MOCKLAB_STORAGE_STATE"])
        if os.environ.get("MOCKLAB_STORAGE_STATE")
        else Path(""),
    ]
    storage = next((p for p in auth_candidates if p and p.is_file()), None)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
        )
        context_kwargs: dict[str, Any] = {"viewport": {"width": 1400, "height": 900}}
        if storage:
            context_kwargs["storage_state"] = str(storage)
            out["checks"]["storage_state"] = str(
                storage.relative_to(REPO_ROOT)
                if storage.is_relative_to(REPO_ROOT)
                else storage
            )
        context = browser.new_context(**context_kwargs)
        page = context.new_page()

        # Shell probe
        page.goto(live_base.rstrip("/") + "/chat", wait_until="domcontentloaded", timeout=90_000)
        page.wait_for_timeout(2500)
        body = page.locator("body").inner_text()[:500]
        not_found = "Not Found" in body
        shell_buttons = page.get_by_role("button").count()
        out["checks"]["shell"] = {
            "url": page.url,
            "not_found": not_found,
            "shell_buttons": shell_buttons,
            "body_snip": body[:180],
        }
        shot = SHOT_DIR / "03-live-mocklab-chat-shell.png"
        page.screenshot(path=str(shot), full_page=True)
        out["checks"]["shell_screenshot"] = shot.name
        if not_found or shell_buttons == 0:
            out["residuals"].append("mocklab_spa_not_found")

        # Vault path
        page.goto(live_base.rstrip("/") + "/vault", wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_timeout(2000)
        vault_body = page.locator("body").inner_text()[:400]
        out["checks"]["vault"] = {
            "url": page.url,
            "not_found": "Not Found" in vault_body,
            "body_snip": vault_body[:180],
            "host_count": page.get_by_test_id("onlyoffice-editor-host").count(),
            "docsapi": page.evaluate("() => !!window.DocsAPI"),
        }
        shot_v = SHOT_DIR / "04-live-mocklab-vault.png"
        page.screenshot(path=str(shot_v), full_page=True)
        out["checks"]["vault_screenshot"] = shot_v.name

        # Authenticated mint still GO (platform path from 12.3) — no secrets
        me = page.evaluate(
            """async () => {
              try {
                const r = await fetch('/mocklab/api/auth/me', {credentials:'include'});
                return {status: r.status, ok: r.status===200, ct: r.headers.get('content-type')};
              } catch (e) {
                return {ok:false, error: String(e)};
              }
            }"""
        )
        out["checks"]["auth_me"] = me

        mint = page.evaluate(
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
                  mode: 'view',
                  caller_key: 'lp-zuh.12.4-editor-host-probe',
                }),
              });
              const ct = r.headers.get('content-type') || '';
              const text = await r.text();
              let json = null;
              try { json = JSON.parse(text); } catch (_) {}
              const spa = ct.includes('text/html') || text.trimStart().toLowerCase().startsWith('<!doctype');
              return {
                status: r.status,
                ct,
                spa,
                session_id_present: !!(json && json.session_id),
                document_key_present: !!(json && json.document_key),
                editor_config_present: !!(json && json.editor_config),
                token_present: !!(json && json.editor_config && json.editor_config.token),
                error: json && json.error ? String(json.error).slice(0,120) : null,
              };
            }""",
            {"docx": os.environ.get("LP_ZUH124_DOCX_PATH", DEFAULT_DOCX)},
        )
        out["checks"]["mint"] = mint

        # SPA bake still has flags?
        bake = page.evaluate(
            """async () => {
              const scripts = [...document.querySelectorAll('script[src*="/assets/"]')];
              const src = scripts.map(s => s.getAttribute('src')).find(s => s && s.includes('index-'));
              if (!src) return {ok:false, error:'no_index_script'};
              const r = await fetch(src);
              const text = await r.text();
              const editor = (text.match(/VITE_ONLYOFFICE_EDITOR:"([^"]*)"/) || [])[1] || null;
              const ds = (text.match(/VITE_ONLYOFFICE_DS_URL:"([^"]*)"/) || [])[1] || null;
              return {
                ok: true,
                js_path: src,
                js_bytes: text.length,
                VITE_ONLYOFFICE_EDITOR: editor,
                VITE_ONLYOFFICE_DS_URL: ds,
              };
            }"""
        )
        out["checks"]["spa_vite_bake"] = bake

        browser.close()

    # Track B "passed" means residual honestly documented; not editor GO.
    out["passed"] = True
    out["editor_go_claimed"] = False
    if out["checks"].get("mint", {}).get("session_id_present"):
        out["checks"]["mint_happy_path_still_go"] = True
    report["tracks"]["B"] = out
    return out


def track_c_lab_docsapi(lab_bff: str, lab_ds: str, report: dict[str, Any]) -> dict[str, Any]:
    """Optional real DocsAPI iframe via localhost lab BFF editor page."""
    from playwright.sync_api import sync_playwright, expect

    out: dict[str, Any] = {
        "track": "C_lab_real_docsapi",
        "lab_bff": lab_bff,
        "lab_ds": lab_ds,
        "passed": False,
        "skipped": False,
        "checks": {},
    }
    if not _http_ok(f"{lab_ds.rstrip('/')}/healthcheck"):
        out["skipped"] = True
        out["skip_reason"] = "lab_ds_unhealthy"
        report["tracks"]["C"] = out
        return out
    if not _http_ok(f"{lab_bff.rstrip('/')}/lab/health"):
        out["skipped"] = True
        out["skip_reason"] = "lab_bff_unhealthy"
        report["tracks"]["C"] = out
        return out

    api_js = _curl_probe(f"{lab_ds.rstrip('/')}/web-apps/apps/api/documents/api.js")
    out["checks"]["api_js"] = api_js

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
        )
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.goto(
            f"{lab_bff.rstrip('/')}/lab/editor?type=docx",
            wait_until="domcontentloaded",
            timeout=60_000,
        )
        try:
            expect(page.get_by_test_id("lab-oo-bar")).to_be_visible(timeout=15_000)
        except Exception:
            out["checks"]["lab_oo_bar"] = False
            shot = SHOT_DIR / "05-lab-docsapi-open-attempt.png"
            page.screenshot(path=str(shot), full_page=True)
            out["checks"]["screenshot"] = shot.name
            out["error"] = "lab_oo_bar_missing"
            browser.close()
            report["tracks"]["C"] = out
            return out

        page.wait_for_function(
            "() => document.body.getAttribute('data-doc-ready') === '1' "
            "|| document.body.getAttribute('data-doc-error') === '1' "
            "|| window.__LAB_ERROR__",
            timeout=180_000,
        )
        err = page.evaluate("() => window.__LAB_ERROR__ || null")
        ready = page.evaluate("() => !!window.__LAB_DOC_READY__")
        docsapi = page.evaluate("() => !!window.DocsAPI")
        iframe_count = page.locator("iframe").count()
        out["checks"].update(
            {
                "doc_ready": ready,
                "docsapi_present": docsapi,
                "iframe_count": iframe_count,
                "error": err,
            }
        )
        shot = SHOT_DIR / "05-lab-docsapi-docx-nonblank.png"
        page.screenshot(path=str(shot), full_page=True)
        out["checks"]["screenshot"] = shot.name
        out["checks"]["screenshot_bytes"] = shot.stat().st_size
        browser.close()

    out["passed"] = bool(ready and docsapi and not err and iframe_count >= 1)
    report["tracks"]["C"] = out
    return out


def _write_result_md(report: dict[str, Any]) -> None:
    a = report["tracks"].get("A") or {}
    b = report["tracks"].get("B") or {}
    c = report["tracks"].get("C") or {}
    verdict = report["verdict"]
    lines = [
        f"# {BEAD} — OnlyOffice editor host mounts DocsAPI (nonblank canvas)",
        "",
        f"**Bead:** `{BEAD}`  ",
        f"**Parent epic:** `lp-zuh.12` — OnlyOffice MockLab/staging editor GO  ",
        f"**When (UTC):** {report.get('when')}  ",
        f"**Verdict:** **`{verdict}`**",
        "",
        "No secrets in this package (no passwords, JWT, CSRF, download tokens, or SM values).",
        "",
        "---",
        "",
        "## Acceptance map",
        "",
        "| # | Criterion | Result |",
        "|---|-----------|--------|",
        f"| 1 | Open vault Office file from chat pane or vault | **{'GO (story pane Office open)' if a.get('passed') else 'NO'}** — live vault UI residual documented in track B |",
        f"| 2 | onlyoffice-editor-host mounts | **{'GO' if a.get('passed') else 'NO'}** — story `data-testid=onlyoffice-editor-host` |",
        f"| 3 | DocsAPI script/iframe present; canvas nonblank (or mock DS lab surface) | **{'GO (mock DS lab surface)' if a.get('passed') else 'NO'}**"
        + (
            f"; lab real DocsAPI **{'GO' if c.get('passed') else 'skip/fail'}**"
            if c
            else ""
        )
        + " |",
        f"| 4 | No silent preview fallback when editor claimed on | **{'GO' if a.get('passed') else 'NO'}** — onlyoffice renderer; flag_off control uses preview |",
        f"| 5 | Screenshots + RESULT.md verdict PASS | **{verdict}** — this package |",
        "",
        "---",
        "",
        "## Track A — story mock DocsAPI lab surface (product-allowed)",
        "",
        f"- Base: `{a.get('base')}`",
        f"- Passed: `{a.get('passed')}`",
        f"- Checks: `{json.dumps(_redact(a.get('checks') or {}), separators=(',', ':'))[:900]}`",
        "",
        "## Track B — live MockLab residual (not editor GO)",
        "",
        f"- Base: `{b.get('base')}`",
        f"- Residuals: `{', '.join(b.get('residuals') or []) or 'none'}`",
        f"- Shell: `{json.dumps(_redact((b.get('checks') or {}).get('shell') or {}), separators=(',', ':'))[:400]}`",
        f"- Mint: `{json.dumps(_redact((b.get('checks') or {}).get('mint') or {}), separators=(',', ':'))[:400]}`",
        f"- SPA bake: `{json.dumps(_redact((b.get('checks') or {}).get('spa_vite_bake') or {}), separators=(',', ':'))[:400]}`",
        "",
        "## Track C — localhost lab real DocsAPI (optional)",
        "",
        f"- Skipped: `{c.get('skipped')}` reason=`{c.get('skip_reason')}`",
        f"- Passed: `{c.get('passed')}`",
        f"- Checks: `{json.dumps(_redact(c.get('checks') or {}), separators=(',', ':'))[:700]}`",
        "",
        "---",
        "",
        "## Residuals (honest)",
        "",
        "1. **`https_ds_residual`** — Staging Docs ALB HTTP-only; SPA bakes HTTPS DS URL (`lp-zuh.12.2`).",
        "2. **`mocklab_spa_not_found`** — Live `/mocklab/*` client Not Found until `lp-zuh.12.6` pin promote.",
        "3. **Live DocsAPI host GO** — blocked by (1)+(2); not claimed. Mock lab surface satisfies acceptance criterion 3.",
        "",
        "## Screenshots",
        "",
        "- `screenshots/01-story-onlyoffice-editor-host-nonblank.png`",
        "- `screenshots/02-story-flag-off-preview-fallback.png`",
        "- `screenshots/03-live-mocklab-chat-shell.png`",
        "- `screenshots/04-live-mocklab-vault.png`",
        "- `screenshots/05-lab-docsapi-docx-nonblank.png` (when track C runs)",
        "",
        "## Re-run",
        "",
        "```bash",
        "# Story host:",
        "#   cd portal/apps/web && pnpm exec vite --port 3027 --host 127.0.0.1",
        "# Optional lab BFF (real DocsAPI):",
        "#   pnpm --filter @lanyard/bff exec tsx scripts/lab-onlyoffice-live-server.mts",
        "export STORY_BASE_URL=http://127.0.0.1:3027",
        "# Auth for track B: MOCKLAB_AGENT_* from gitignored .env.mocklab-agent-dev",
        "python3 artifacts/mocklab/live-qa/onlyoffice-editor-host/run_editor_host_docsapi_probe.py",
        "```",
        "",
        "## Secret hygiene",
        "",
        "- No passwords, JWT, CSRF, session, download tokens, or callback nonces written.",
        "- `.env.mocklab-agent-dev` never copied into artifacts.",
        "- `editor_config.token` recorded as presence-only when mint is probed.",
        "",
    ]
    (OUT_DIR / "RESULT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    _load_env_file(REPO_ROOT / ".env.mocklab-agent-dev")
    # Also allow main-checkout env when running from worktree
    _load_env_file(
        Path("/home/operator/Lanyard-Dev/lanyard-platform/.env.mocklab-agent-dev")
    )

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    SHOT_DIR.mkdir(parents=True, exist_ok=True)

    story_base = os.environ.get("STORY_BASE_URL") or os.environ.get("BASE_URL") or DEFAULT_STORY_BASE
    live_base = os.environ.get("MOCKLAB_BASE_URL") or DEFAULT_LIVE_BASE
    lab_bff = os.environ.get("LAB_BFF_URL") or DEFAULT_LAB_BFF
    lab_ds = os.environ.get("LAB_DS_URL") or DEFAULT_LAB_DS
    skip_live = os.environ.get("LP_ZUH124_SKIP_LIVE") == "1"
    skip_lab = os.environ.get("LP_ZUH124_SKIP_LAB") == "1"

    # Ensure playwright import (may re-exec into venv)
    _playwright()

    report: dict[str, Any] = {
        "bead": BEAD,
        "when": _utc(),
        "tracks": {},
        "verdict": "FAIL",
        "acceptance_met": False,
    }

    print(f"[{BEAD}] track A story mock @ {story_base}")
    a = track_a_story_mock(story_base, report)
    _write_json(LOG_DIR / "track-a-story.json", a)

    if not skip_live:
        print(f"[{BEAD}] track B live MockLab residual @ {live_base}")
        b = track_b_live_mocklab(live_base, report)
        _write_json(LOG_DIR / "track-b-live.json", b)
    else:
        report["tracks"]["B"] = {"skipped": True, "skip_reason": "LP_ZUH124_SKIP_LIVE"}

    if not skip_lab:
        print(f"[{BEAD}] track C lab DocsAPI @ {lab_bff} / {lab_ds}")
        c = track_c_lab_docsapi(lab_bff, lab_ds, report)
        _write_json(LOG_DIR / "track-c-lab.json", c)
    else:
        report["tracks"]["C"] = {"skipped": True, "skip_reason": "LP_ZUH124_SKIP_LAB"}

    a_ok = bool((report["tracks"].get("A") or {}).get("passed"))
    c_ok = bool((report["tracks"].get("C") or {}).get("passed"))
    if a_ok and c_ok:
        report["verdict"] = "PASS"
    elif a_ok:
        report["verdict"] = "PASS"
    else:
        report["verdict"] = "FAIL"
    report["acceptance_met"] = a_ok
    report["notes"] = (
        "PASS via product-allowed mock DocsAPI lab surface (acceptance #3). "
        "Live MockLab DocsAPI host not claimed (HTTPS DS + SPA Not Found residuals)."
    )

    _write_json(OUT_DIR / "REPORT.json", report)
    _write_result_md(report)
    print(f"[{BEAD}] verdict={report['verdict']} acceptance_met={report['acceptance_met']}")
    return 0 if a_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
