#!/usr/bin/env python3
"""lp-zuh.12.8 UI QA — MockLab SPA /mocklab/* client Not Found (hydration #418).

Acceptance (live browser against real MockLab URL):
  After pack/promote of tenantUiLocationRewrite pin, /mocklab/chat must render
  the portal shell (Agents/Vault/Tools), NOT client "Not Found".

Auth: MOCKLAB_* from gitignored .env.mocklab-agent-dev (never print password).
storage_state: artifacts/ui/.auth/mocklab-agent.json
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

BEAD_ID = "lp-zuh.12.8"
REPO = Path("/home/operator/Lanyard-Dev/lanyard-platform")
ART = REPO / "artifacts" / "ui" / BEAD_ID
AUTH = REPO / "artifacts" / "ui" / ".auth" / "mocklab-agent.json"

BASE = os.environ.get("MOCKLAB_BASE_URL", "https://app.withlanyard.com/mocklab").rstrip("/")
EMAIL = os.environ.get("MOCKLAB_AGENT_EMAIL", "")
PASSWORD = os.environ.get("MOCKLAB_AGENT_PASSWORD", "")
APP_ORIGIN = os.environ.get("MOCKLAB_APP_ORIGIN", "https://app.withlanyard.com").rstrip("/")
# Pre-fix pin from lp-zuh.12.1; post-fix pack must change this.
OLD_PIN_JS = "index-DzazbXcP.js"
EXPECTED_PIN_SUBSTR = "index-yB4LmRb5.js"

CHROMIUM_ARGS = [
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-gpu",
    "--use-gl=swiftshader",
]


def shot(page, name: str) -> Path:
    ART.mkdir(parents=True, exist_ok=True)
    out = ART / name
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


def api_login_cookies() -> dict:
    jar = tempfile.NamedTemporaryFile(delete=False, suffix=".cj")
    jar.close()
    try:
        subprocess.check_call(
            [
                "curl", "-sS", "-c", jar.name, "-b", jar.name,
                "-o", "/tmp/lpzuh128-csrf.json",
                f"{BASE}/api/auth/csrf",
            ],
            timeout=30,
        )
        csrf = json.loads(Path("/tmp/lpzuh128-csrf.json").read_text())["csrf_token"]
        payload = json.dumps({"email": EMAIL, "password": PASSWORD})
        subprocess.check_call(
            [
                "curl", "-sS", "-c", jar.name, "-b", jar.name,
                "-o", "/tmp/lpzuh128-login.json",
                "-X", "POST", f"{BASE}/api/auth/login",
                "-H", "content-type: application/json",
                "-H", "accept: application/json",
                "-H", f"x-csrf-token: {csrf}",
                "-d", payload,
            ],
            timeout=30,
        )
        login_body = json.loads(Path("/tmp/lpzuh128-login.json").read_text())
        cookies: list[dict] = []
        for line in Path(jar.name).read_text().splitlines():
            if not line.strip():
                continue
            if line.startswith("#") and not line.startswith("#HttpOnly_"):
                continue
            parts = line.split("\t")
            if len(parts) < 7:
                continue
            domain, _flag, path, secure, _exp, name, value = parts[:7]
            http_only = domain.startswith("#HttpOnly_")
            domain = domain.replace("#HttpOnly_", "")
            cookies.append(
                {
                    "name": name,
                    "value": value,
                    "domain": domain,
                    "path": path,
                    "httpOnly": http_only,
                    "secure": secure.upper() == "TRUE",
                    "sameSite": "Lax",
                }
            )
        return {"cookies": cookies, "login": login_body}
    finally:
        try:
            os.unlink(jar.name)
        except Exception:
            pass


def main() -> int:
    ART.mkdir(parents=True, exist_ok=True)
    AUTH.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(AUTH.parent, 0o700)

    checks: list[dict] = []
    screenshots: list[str] = []
    residuals: list[str] = []
    network: dict = {}
    error = ""
    passed = False
    skipped = False
    browser = None

    if not EMAIL or not PASSWORD:
        error = "MOCKLAB_AGENT_EMAIL/PASSWORD required"

    try:
        if error:
            raise RuntimeError(error)

        login_info = api_login_cookies()
        network["api_login"] = {
            "email": (login_info.get("login") or {}).get("email"),
            "user_id_present": bool((login_info.get("login") or {}).get("user_id")),
            "cookie_names": [c["name"] for c in login_info.get("cookies") or []],
        }
        checks.append({
            "id": "api-login",
            "ok": bool((login_info.get("login") or {}).get("user_id"))
            and any(c["name"] == "lanyard_session" for c in login_info.get("cookies") or []),
            "detail": network["api_login"],
        })

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=CHROMIUM_ARGS)
            context = browser.new_context(
                viewport={"width": 1400, "height": 900},
                ignore_https_errors=True,
            )
            if login_info.get("cookies"):
                context.add_cookies(login_info["cookies"])
            page = context.new_page()
            page.set_default_timeout(30_000)
            page_errors: list[str] = []
            console_errors: list[str] = []
            page.on("pageerror", lambda e: page_errors.append(str(e)[:300]))
            page.on(
                "console",
                lambda msg: console_errors.append(msg.text[:240])
                if msg.type == "error"
                else None,
            )

            # 0+1) Navigate to /mocklab/chat first (same origin), then diagnose pin+shell
            page.goto(BASE + "/chat", wait_until="domcontentloaded", timeout=90_000)
            page.wait_for_timeout(3000)
            screenshots.append(str(shot(page, "01-mocklab-chat-shell.png")))

            # Identify live SPA pin from document / fetch of same-origin HTML
            pin = page.evaluate(
                """async () => {
                  const fromDoc = (() => {
                    const el = document.querySelector('script[src*="/assets/index-"]')
                      || document.querySelector('link[href*="/assets/index-"]');
                    if (!el) return null;
                    const v = el.getAttribute('src') || el.getAttribute('href');
                    const m = (v || '').match(/(\\/assets\\/index-[A-Za-z0-9_-]+\\.js)/);
                    return m ? m[1] : null;
                  })();
                  let js_path = fromDoc;
                  let status = null;
                  let html_len = null;
                  try {
                    const htmlRes = await fetch(location.origin + location.pathname.replace(/\\/chat.*/, '/') || '/', { credentials: 'include' });
                    status = htmlRes.status;
                    const html = await htmlRes.text();
                    html_len = html.length;
                    if (!js_path) {
                      const m = html.match(/src=["'](\\/assets\\/index-[^"']+\\.js)["']/)
                        || html.match(/href=["'](\\/assets\\/index-[^"']+\\.js)["']/)
                        || html.match(/(\\/assets\\/index-[A-Za-z0-9_-]+\\.js)/);
                      js_path = m ? m[1] : null;
                    }
                  } catch (e) {
                    return { status, js_path, html_len, fetch_error: String(e) };
                  }
                  return { status, js_path, html_len, fromDoc };
                }"""
            )
            # Fallback: curl HTML if page eval missed the modulepreload
            if not (pin or {}).get("js_path"):
                try:
                    html = subprocess.check_output(
                        ["curl", "-sS", "--max-time", "20", BASE + "/chat"],
                        text=True,
                    )
                    m = re.search(r"(/assets/index-[A-Za-z0-9_-]+\.js)", html)
                    pin = {
                        **(pin or {}),
                        "js_path": m.group(1) if m else None,
                        "html_len": len(html),
                        "via": "curl",
                    }
                except Exception as ex:
                    pin = {**(pin or {}), "curl_error": f"{type(ex).__name__}: {ex}"}
            network["live_pin"] = pin
            js_path = (pin or {}).get("js_path") or ""
            pin_is_old = OLD_PIN_JS in js_path
            checks.append({
                "id": "live-pin-identity",
                "ok": bool(js_path),
                "detail": {
                    "js_path": js_path,
                    "is_pre_fix_pin_DzazbXcP": pin_is_old,
                    "note": "630a91d7 / f162f4e7 rewrite fix requires new pack/promote beyond index-DzazbXcP.js",
                    "pin": pin,
                },
            })

            body_text = (page.locator("body").inner_text() or "").strip()
            shell_buttons = page.get_by_role(
                "button", name=re.compile(r"^Agents$|^Vault$|^Tools$", re.I)
            ).count()
            # Also look for nav links / sidebar labels used by portal shell
            shell_nav = page.get_by_text(
                re.compile(r"^(Agents|Vault|Tools|Settings|Chat)$"), exact=True
            ).count()
            first_line = body_text.split("\n")[0].strip() if body_text else ""
            not_found = (
                body_text.lower().startswith("not found")
                or body_text.strip() == "Not Found"
                or bool(re.search(r"(?i)^not found$", first_line))
            )
            hydration_418 = any(
                "#418" in e or "Minified React error #418" in e for e in page_errors + console_errors
            )
            path_diag = page.evaluate(
                """() => {
                  const reserved=new Set(["api","health","assets","static","public","src","chat","vault","settings","stories","favicon.ico","robots.txt"]);
                  const slugRe=/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
                  const p3=(pathname)=>{
                    const t=pathname.split('/').filter(Boolean);
                    if(!t.length) return null;
                    const n=t[0].toLowerCase();
                    return (reserved.has(n)||!slugRe.test(n))?null:n;
                  };
                  const m3=(hostname)=>{
                    const t=hostname.toLowerCase().split(':')[0]??hostname;
                    return !(t.endsWith('.withlanyard.com')&&t!=='withlanyard.com'&&t!=='app.withlanyard.com'
                      || t.endsWith('.localhost')&&t!=='localhost'&&t!=='app.localhost');
                  };
                  const e={hostname:location.hostname,pathname:location.pathname};
                  const slug=m3(e.hostname)?p3(e.pathname):null;
                  return {
                    href: location.href,
                    pathname: location.pathname,
                    tenant_basepath: slug?`/${slug}`:'',
                    api_prefix: slug?`/${slug}/api`:'/api',
                    body_snip: (document.body.innerText||'').slice(0,160),
                    title: document.title || '',
                  };
                }"""
            )
            network["path_diag"] = path_diag
            network["page_errors"] = page_errors[:8]
            network["console_errors"] = console_errors[:8]
            shell_ok = (shell_buttons > 0 or shell_nav > 0) and not not_found
            checks.append({
                "id": "mocklab-shell-not-not-found",
                "ok": shell_ok,
                "detail": {
                    "url": page.url,
                    "shell_buttons": shell_buttons,
                    "shell_nav": shell_nav,
                    "not_found": not_found,
                    "hydration_418": hydration_418,
                    "body_snip": body_text[:200],
                    "path_diag": path_diag,
                    "js_path": js_path,
                },
            })
            if not shell_ok:
                residuals.append(
                    "mocklab_spa_not_found: live pin still renders client Not Found on "
                    f"/mocklab/chat (js={js_path or '?'}); pack/promote of 630a91d7 / f162f4e7 "
                    "tenantUiLocationRewrite not yet live"
                )

            # Overlay evidence card for vision / humans
            page.evaluate(
                """({ shellOk, notFound, jsPath, pinOld, href, bodySnip }) => {
                  const existing = document.querySelector('[data-testid="lp-zuh-12-8-shell-evidence"]');
                  if (existing) existing.remove();
                  const card = document.createElement('div');
                  card.setAttribute('data-testid', 'lp-zuh-12-8-shell-evidence');
                  card.style.cssText = 'position:fixed;inset:16px;z-index:99999;background:#0b1220;color:#e2e8f0;padding:20px;font:13px/1.45 ui-monospace,Menlo,monospace;border:2px solid #f59e0b;border-radius:12px;overflow:auto;';
                  const okColor = shellOk ? '#4ade80' : '#f87171';
                  card.innerHTML = `<h1 style="margin:0 0 10px;font:600 18px system-ui,sans-serif">lp-zuh.12.8 MockLab SPA shell</h1>
                    <div>page: ${href}</div>
                    <div>js pin: ${jsPath || '(unknown)'} ${pinOld ? '(PRE-FIX DzazbXcP)' : ''}</div>
                    <div>shell_ok: <b style="color:${okColor}">${shellOk}</b></div>
                    <div>not_found: <b style="color:${notFound?'#f87171':'#4ade80'}">${notFound}</b></div>
                    <div style="margin-top:10px;opacity:.85">body: ${String(bodySnip||'').slice(0,140)}</div>
                    <div style="margin-top:10px;color:#fbbf24">Fix commit 630a91d7 / f162f4e7 uses tenantUiLocationRewrite(); requires MockLab pack/promote.</div>`;
                  document.body.appendChild(card);
                }""",
                {
                    "shellOk": shell_ok,
                    "notFound": not_found,
                    "jsPath": js_path,
                    "pinOld": pin_is_old,
                    "href": page.url,
                    "bodySnip": body_text[:160],
                },
            )
            screenshots.append(str(shot(page, "02-shell-evidence-overlay.png")))

            # 2) auth/me still works under tenant API (BFF path ok even when SPA broken)
            me = page.evaluate(
                """async (base) => {
                  const r = await fetch(base + '/api/auth/me', { credentials: 'include' });
                  const t = await r.text();
                  const ct = r.headers.get('content-type') || '';
                  let body=null; try { body=JSON.parse(t); } catch(e) { body={raw:t.slice(0,120)}; }
                  return {status:r.status, ct, body};
                }""",
                BASE,
            )
            network["auth_me"] = {
                "status": me.get("status"),
                "email": (me.get("body") or {}).get("email") if isinstance(me.get("body"), dict) else None,
                "ct": me.get("ct"),
            }
            checks.append({
                "id": "auth-me",
                "ok": me.get("status") == 200 and bool(network["auth_me"]["email"]),
                "detail": network["auth_me"],
            })

            # 3) Probe vault + agents routes (should also be shell when fixed)
            for route, shot_name in (
                ("/vault", "03-mocklab-vault.png"),
                ("/agents", "04-mocklab-agents.png"),
            ):
                page.goto(BASE + route, wait_until="domcontentloaded", timeout=60_000)
                page.wait_for_timeout(2000)
                screenshots.append(str(shot(page, shot_name)))
                rbody = (page.locator("body").inner_text() or "").strip()
                r_not_found = rbody.lower().startswith("not found") or rbody == "Not Found"
                checks.append({
                    "id": f"mocklab-route-{route.strip('/')}",
                    "ok": not r_not_found,
                    "detail": {
                        "url": page.url,
                        "not_found": r_not_found,
                        "body_snip": rbody[:120],
                    },
                    "soft": True,
                })

            # 4) Contrast: root /chat sign-in (non-tenant) still loads SPA chrome
            page.goto(f"{APP_ORIGIN}/chat", wait_until="domcontentloaded", timeout=60_000)
            page.wait_for_timeout(1500)
            screenshots.append(str(shot(page, "05-root-chat.png")))
            root_pwd = page.locator('input[type="password"]').count()
            root_not_found = ((page.locator("body").inner_text() or "").strip().lower().startswith("not found"))
            checks.append({
                "id": "root-chat-contrast",
                "ok": (root_pwd > 0 or not root_not_found),
                "detail": {
                    "url": page.url,
                    "password_inputs": root_pwd,
                    "not_found": root_not_found,
                },
                "soft": True,
            })

            context.storage_state(path=str(AUTH))
            os.chmod(AUTH, 0o600)
            context.close()
            browser.close()
            browser = None

    except Exception as ex:
        error = f"{type(ex).__name__}: {ex}"
        try:
            if browser is not None:
                browser.close()
        except Exception:
            pass

    api_ok = any(c["id"] == "api-login" and c["ok"] for c in checks)
    me_ok = any(c["id"] == "auth-me" and c["ok"] for c in checks)
    shell_check = next((c for c in checks if c["id"] == "mocklab-shell-not-not-found"), None)
    shell_ok = bool(shell_check and shell_check.get("ok"))
    pin_check = next((c for c in checks if c["id"] == "live-pin-identity"), None)

    # Hard gate: shell must recover. Auth/API alone is not enough.
    passed = (not error) and api_ok and shell_ok
    if pin_check and (pin_check.get("detail") or {}).get("is_pre_fix_pin_DzazbXcP") and not shell_ok:
        residuals.append(
            "live_pin_pre_fix: still serving index-DzazbXcP.js; "
            "feature branch beads/lp-zuh.12.8 @ 630a91d7 / f162f4e7 not packed/promoted to MockLab"
        )

    summary = (
        f"{'PASS' if passed else 'FAIL'}_MOCKLAB_SPA_SHELL: "
        f"shell_ok={shell_ok} not_found={(shell_check or {}).get('detail', {}).get('not_found')} "
        f"js={(network.get('live_pin') or {}).get('js_path')} "
        f"api_ok={api_ok} me_ok={me_ok} residuals={residuals} "
        f"shots={len(screenshots)} passed={passed}"
    )

    report = {
        "bead_id": BEAD_ID,
        "when": datetime.now(timezone.utc).isoformat(),
        "base_url": BASE,
        "app_origin": APP_ORIGIN,
        "login_email": EMAIL,
        "passed": passed,
        "skipped": skipped,
        "summary": summary,
        "checks": checks,
        "residuals": residuals,
        "network": network,
        "screenshot_paths": screenshots,
        "error": error,
        "feature_branch": "beads/lp-zuh.12.8-mocklab-spa-mocklab-client-not-found-hyd",
        "fix_commit": "630a91d7 / f162f4e7dada33c928dce9074165d3c698a3bfd4",
        "acceptance": {
            "mocklab_chat_shell_not_not_found": shell_ok,
            "live_pin_promoted_beyond_DzazbXcP": not (
                (pin_check or {}).get("detail") or {}
            ).get("is_pre_fix_pin_DzazbXcP", True),
        },
    }
    (ART / "REPORT.json").write_text(json.dumps(report, indent=2) + "\n")
    (ART / "RESULT.md").write_text(
        f"""# {BEAD_ID} — MockLab SPA Not Found / hydration #418 UI QA

**When:** {report['when']}
**Base:** `{BASE}`
**Login:** `{EMAIL}`
**passed:** `{passed}`
**skipped:** `{skipped}`

## Acceptance

- /mocklab/chat shell (not Not Found): `{shell_ok}`
- live pin promoted beyond `{OLD_PIN_JS}`: `{report['acceptance']['live_pin_promoted_beyond_DzazbXcP']}`
- live js: `{(network.get('live_pin') or {}).get('js_path')}`

## Checks

{chr(10).join(f"- [{'x' if c.get('ok') else ' '}] {c['id']}: {json.dumps(c.get('detail'), default=str)[:240]}" for c in checks)}

## Residuals

{chr(10).join(f"- {r}" for r in residuals) or '- (none)'}

## Screenshots

{chr(10).join(f"- `{Path(p).name}`" for p in screenshots)}

## Summary

{summary}

error: `{error}`
"""
    )
    print(json.dumps({
        "bead_id": BEAD_ID,
        "passed": passed,
        "skipped": skipped,
        "summary": summary,
        "screenshot_paths": screenshots,
        "error": error or None,
    }, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
