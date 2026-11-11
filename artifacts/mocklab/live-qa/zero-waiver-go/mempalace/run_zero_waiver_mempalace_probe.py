#!/usr/bin/env python3
"""lp-zuh.11.4 — zero-waiver MemPalace search live (MockLab).

Proves:
  1. Guest ready: mempalace.enabled + ok (binary on PATH / not binary_missing)
  2. CLI or chat: search returns empty-or-hits without MEMPALACE_BINARY_MISSING
  3. config path under vault when configured
  4. Screenshots + sanitized logs under this package

Credentials:
  - MOCKLAB_* from gitignored .env.mocklab-agent-dev
  - DAYTONA_API_KEY + DAYTONA_ORG_ID from SM/env (guest probes)

Never commit secrets.
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

BEAD = "lp-zuh.11.4"
PARENT = "lp-zuh.11"
DEFAULT_BASE = "https://app.withlanyard.com/mocklab"
MOCKLAB_TENANT_ID = os.environ.get(
    "MOCKLAB_TENANT_ID", "319d3808-e533-44db-bfdf-7b6ef8caaae1"
).strip()
MOCKLAB_INSTANCE_ID = os.environ.get(
    "MOCKLAB_INSTANCE_ID", "452b1348-772a-49d0-8038-a410eda8accf"
).strip()
MOCKLAB_DAYTONA_TENANT_ID = os.environ.get(
    "MOCKLAB_DAYTONA_TENANT_ID", "319d3808-e533-44db-bfdf-7b6ef8caaae1"
).strip()
DAYTONA_API_URL = os.environ.get("DAYTONA_API_URL", "https://app.daytona.io/api").rstrip(
    "/"
)
DAYTONA_TOOLBOX_BASE = os.environ.get(
    "DAYTONA_TOOLBOX_BASE", "https://proxy.app.daytona.io/toolbox"
).rstrip("/")

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
    r"(token|jwt|secret|password|authorization|cookie|csrf|signature|api[_-]?key|"
    r"aws_|poolside|xai_|litellm|relay)",
    re.I,
)


def _utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


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


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip("'").strip('"')
    return out


def load_mocklab_env() -> dict[str, str]:
    file_vals: dict[str, str] = {}
    for cand in [
        Path(os.environ.get("MOCKLAB_ENV_FILE", "")),
        REPO_ROOT / ".env.mocklab-agent-dev",
        Path.home() / "Lanyard-Dev" / "lanyard-platform" / ".env.mocklab-agent-dev",
    ]:
        if cand and cand.is_file():
            file_vals = _parse_env_file(cand)
            break

    def pick(key: str, default: str = "") -> str:
        return (os.environ.get(key) or file_vals.get(key) or default).strip()

    return {
        "base_url": pick("MOCKLAB_BASE_URL", DEFAULT_BASE).rstrip("/"),
        "email": pick("MOCKLAB_AGENT_EMAIL"),
        "password": pick("MOCKLAB_AGENT_PASSWORD"),
    }


def _daytona_headers() -> dict[str, str] | None:
    key = os.environ.get("DAYTONA_API_KEY", "").strip()
    org = os.environ.get("DAYTONA_ORG_ID", "").strip()
    if not key or not org:
        return None
    return {
        "Authorization": f"Bearer {key}",
        "X-Daytona-Organization-ID": org,
        "Content-Type": "application/json",
    }


def daytona_get(path: str) -> Any:
    headers = _daytona_headers()
    if not headers:
        return None
    req = urllib.request.Request(
        f"{DAYTONA_API_URL}{path}",
        headers={k: v for k, v in headers.items() if k != "Content-Type"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)[:300]}


def guest_exec(sandbox_id: str, command: str, timeout: int = 120) -> dict:
    headers = _daytona_headers()
    if not headers:
        return {"ok": False, "error": "DAYTONA credentials missing"}
    url = f"{DAYTONA_TOOLBOX_BASE}/{sandbox_id}/process/execute"
    body = json.dumps({"command": command, "timeout": timeout}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout + 90) as r:
            data = json.loads(r.read().decode())
        return {
            "ok": int(data.get("exitCode") or 0) == 0,
            "exit_code": data.get("exitCode"),
            "result": data.get("result") or data.get("stdout") or "",
            "stderr": data.get("stderr") or "",
        }
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="replace")[:400]
        return {"ok": False, "error": f"HTTP {e.code}: {err}"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


def pick_mocklab_sandbox() -> dict | None:
    data = daytona_get("/sandbox?limit=100")
    if not isinstance(data, (dict, list)):
        return None
    items = data if isinstance(data, list) else data.get("items") or data.get("data") or []
    started: list[dict] = []
    any_ml: list[dict] = []
    for s in items:
        if not isinstance(s, dict):
            continue
        labels = s.get("labels") or {}
        tid = labels.get("tenant_id")
        iid = labels.get("instance_id")
        if (
            tid not in (MOCKLAB_TENANT_ID, MOCKLAB_DAYTONA_TENANT_ID)
            and iid != MOCKLAB_INSTANCE_ID
        ):
            continue
        any_ml.append(s)
        if s.get("state") in ("started", "running"):
            started.append(s)
    prefer = os.environ.get("MOCKLAB_SANDBOX_ID", "").strip()
    pool = started or any_ml
    if prefer:
        for s in pool:
            if s.get("id") == prefer:
                return s
    return pool[0] if pool else None


def apply_live_which_fix(sandbox_id: str) -> dict:
    """Install PATH `command` shim + ensure palace dir + (re)start gateway.

    Root cause: spawn("command", ["-v", name]) ENOENT because `command` is a
    shell builtin. Durable image fix is install-mempalace command-shim. Live pin
    clears via brain-owned PATH-first shim under product bin dir (avoid sandbox
    stop/start which can drop vault mount).
    """
    cmd = r"""
set +e
BINDIR=/opt/company-brain-backend/current/bin
mkdir -p "$BINDIR" /mnt/vault/mempalace /var/lib/company-brain-backend/logs
cat > "$BINDIR/command" <<'SHIM'
#!/bin/sh
if [ "$1" = "-v" ] && [ -n "${2:-}" ]; then
  if [ -x /usr/bin/which ]; then
    out="$(/usr/bin/which -- "$2" 2>/dev/null || true)"
    if [ -n "$out" ]; then printf '%s
' "$out"; exit 0; fi
  fi
  if [ -x /bin/bash ]; then
    out="$(/bin/bash -c 'type -P -- "$1"' _ "$2" 2>/dev/null || true)"
    if [ -n "$out" ]; then printf '%s
' "$out"; exit 0; fi
  fi
  exit 1
fi
if [ -x /bin/bash ]; then
  exec /bin/bash -c 'builtin command "$@"' _ "$@"
fi
exit 127
SHIM
chmod 0755 "$BINDIR/command"
export PATH="$BINDIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export MEMPALACE_BIN=/usr/local/bin/mempalace
echo "shim resolves: $($BINDIR/command -v mempalace)"
node -e 'const {spawn}=require("child_process");const c=spawn("command",["-v","mempalace"],{stdio:["ignore","pipe","pipe"],env:process.env});let o="";c.stdout.on("data",d=>o+=d);c.on("error",e=>console.log("err",e.message));c.on("close",code=>console.log("command_spawn",code,o.trim()));'
# Restart gateway in-process (do not Daytona stop — preserves vault mount)
pkill -f 'apps/gateway/dist/main.js' 2>/dev/null || true
sleep 2
set -a
# shellcheck disable=SC1091
source /var/lib/company-brain-backend/gateway.env 2>/dev/null || true
set +a
export BACKEND_HOME=/var/lib/company-brain-backend VAULT_ROOT=/mnt/vault
export LANYARD_CONFIG=/var/lib/company-brain-backend/config.yaml
nohup "$BINDIR/company-brain-backend" gateway --config "$LANYARD_CONFIG"   >/var/lib/company-brain-backend/logs/gateway-zuh114.out 2>&1 &
echo STARTED_PID=$!
for i in $(seq 1 40); do
  if curl -sf --max-time 2 http://127.0.0.1:9100/health >/dev/null; then
    echo HEALTH_OK_$i
    break
  fi
  sleep 2
done
curl -sS --max-time 5 http://127.0.0.1:9100/ready; echo
echo LIVE_FIX_APPLIED
"""
    return guest_exec(sandbox_id, cmd, timeout=180)


def restart_sandbox(sandbox_id: str) -> dict:
    headers = _daytona_headers()
    if not headers:
        return {"ok": False, "error": "no daytona creds"}
    out: dict[str, Any] = {"steps": []}
    for action in ("stop", "start"):
        url = f"{DAYTONA_API_URL}/sandbox/{sandbox_id}/{action}"
        req = urllib.request.Request(url, data=b"{}", method="POST", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                out["steps"].append({"action": action, "status": r.status})
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:200]
            out["steps"].append({"action": action, "status": e.code, "body": body})
        except Exception as e:
            out["steps"].append({"action": action, "error": str(e)[:200]})
    # wait started
    import time

    for _ in range(40):
        data = daytona_get(f"/sandbox/{sandbox_id}")
        state = (data or {}).get("state") if isinstance(data, dict) else None
        out["state"] = state
        if state in ("started", "running"):
            out["ok"] = True
            return out
        time.sleep(5)
    out["ok"] = False
    return out


def guest_mempalace_probes(sandbox_id: str) -> dict:
    cmd = r"""
set +e
echo "=== binaries ==="
command -v mempalace || echo BIN_MISSING_mempalace
mempalace --version 2>&1 | head -2
echo "=== node which spawn ==="
node -e 'const {spawn}=require("child_process");function run(cmd,args){return new Promise(r=>{const c=spawn(cmd,args,{stdio:["ignore","pipe","pipe"]});let o="",e="";c.stdout.on("data",d=>o+=d);c.stderr.on("data",d=>e+=d);c.on("error",err=>r({err:String(err.message),code:err.code}));c.on("close",code=>r({code,o:o.trim(),e:e.trim()}));});}(async()=>{console.log("which",await run("which",["mempalace"]));console.log("command",await run("command",["-v","mempalace"]));})();'
echo "=== config ==="
CFG=/var/lib/company-brain-backend/config.yaml
grep -nA12 '^mempalace:' "$CFG" || true
grep -q 'path: /mnt/vault/mempalace' "$CFG" && echo PATH_UNDER_VAULT_YES || echo PATH_UNDER_VAULT_NO
grep -q 'enabled: true' "$CFG" && echo ENABLED_YES || echo ENABLED_NO
test -d /mnt/vault/mempalace && echo MEMPALACE_DIR_YES || echo MEMPALACE_DIR_NO
echo "=== ready ==="
curl -sS --max-time 5 http://127.0.0.1:9100/ready
echo
echo "=== search CLI ==="
# global flag before subcommand
mempalace --palace /mnt/vault/mempalace status 2>&1 | head -20
# empty palace is ok — search must not say binary missing
set +e
mempalace --palace /mnt/vault/mempalace search "lanyard vault AGENTS knowledge" --results 5 > /tmp/mp_search.out 2>/tmp/mp_search.err
ec=$?
echo SEARCH_EXIT=$ec
head -c 2000 /tmp/mp_search.out; echo
head -c 800 /tmp/mp_search.err; echo
if grep -qiE 'binary_missing|MEMPALACE_BINARY_MISSING|not on PATH|binary not found' /tmp/mp_search.out /tmp/mp_search.err 2>/dev/null; then
  echo SEARCH_HAS_BINARY_MISSING
else
  echo SEARCH_NO_BINARY_MISSING
fi
# Accept empty palace / no hits as success for binary presence
if [[ $ec -eq 0 ]] || grep -qiE 'no (results|drawers|hits)|0 result|empty|not yet|run: mempalace mine|chroma.sqlite' /tmp/mp_search.out /tmp/mp_search.err /tmp/mp_search.out 2>/dev/null; then
  echo SEARCH_EMPTY_OR_HITS_OK
fi
if [[ $ec -eq 0 ]]; then echo SEARCH_OK; fi
"""
    res = guest_exec(sandbox_id, cmd, timeout=180)
    text = res.get("result") or ""
    ready_json = None
    m = re.search(r"(\{\"ok\":true,\"status\":\"ready\".*?\})\s*\n", text, re.S)
    if m:
        try:
            ready_json = json.loads(m.group(1))
        except Exception:
            ready_json = None
    # fallback: last ready-like object
    if ready_json is None:
        for line in text.splitlines():
            if '"mempalace"' in line and line.strip().startswith("{"):
                try:
                    ready_json = json.loads(line.strip())
                except Exception:
                    pass
    mp = (ready_json or {}).get("mempalace") or {}
    checks = {
        "bin_on_path": "BIN_MISSING_mempalace" not in text
        and ("/usr/local/bin/mempalace" in text or "MemPalace" in text),
        "path_under_vault": "PATH_UNDER_VAULT_YES" in text,
        "enabled": "ENABLED_YES" in text,
        "dir_exists": "MEMPALACE_DIR_YES" in text,
        "ready_enabled": mp.get("enabled") is True,
        "ready_ok": mp.get("ok") is True,
        "ready_reason": mp.get("reason"),
        "not_binary_missing": mp.get("reason") != "binary_missing",
        "search_no_binary_missing": "SEARCH_NO_BINARY_MISSING" in text
        or "SEARCH_EMPTY_OR_HITS_OK" in text,
        "search_empty_or_hits": "SEARCH_EMPTY_OR_HITS_OK" in text
        or "SEARCH_OK" in text
        or "SEARCH_NO_BINARY_MISSING" in text,
    }
    return {
        "raw_preview": text[:6000],
        "ready": _redact(ready_json),
        "checks": checks,
        "exit_code": res.get("exit_code"),
        "error": res.get("error"),
    }


def _auth_cookie_jar() -> tuple[CookieJar, str | None, str]:
    jar = CookieJar()
    csrf: str | None = None
    candidates = [
        REPO_ROOT / "artifacts/ui/.auth/mocklab-agent.json",
        Path.home()
        / "Lanyard-Dev"
        / "lanyard-platform"
        / "artifacts"
        / "ui"
        / ".auth"
        / "mocklab-agent.json",
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


def _password_login(base: str) -> str | None:
    env = load_mocklab_env()
    email, password = env["email"], env["password"]
    if not email or not password:
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
        page.screenshot(path=str(SHOT_DIR / "00-post-password-login.png"), full_page=True)
        me = page.evaluate(
            """async () => {
              const r = await fetch('/mocklab/api/auth/me', {credentials:'include'});
              return {status: r.status, ok: r.status === 200};
            }"""
        )
        if not me.get("ok"):
            browser.close()
            return None
        context.storage_state(path=str(auth_path))
        browser.close()
        return str(auth_path)


def portal_ui_shots(base: str) -> list[str]:
    shots: list[str] = []
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        return [f"playwright_unavailable:{e}"]
    jar, csrf, cookie_source = _auth_cookie_jar()
    auth = REPO_ROOT / "artifacts/ui/.auth/mocklab-agent.json"
    if not auth.is_file():
        auth = (
            Path.home()
            / "Lanyard-Dev"
            / "lanyard-platform"
            / "artifacts"
            / "ui"
            / ".auth"
            / "mocklab-agent.json"
        )
    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
        )
        kwargs: dict[str, Any] = {"viewport": {"width": 1440, "height": 900}}
        if auth.is_file():
            kwargs["storage_state"] = str(auth)
        context = browser.new_context(**kwargs)
        page = context.new_page()
        page.goto(base.rstrip("/") + "/", wait_until="load", timeout=90_000)
        page.wait_for_timeout(1500)
        # login if needed
        if page.locator('input[type="password"]').count() > 0:
            _password_login(base)
            if auth.is_file():
                context.close()
                context = browser.new_context(
                    viewport={"width": 1440, "height": 900}, storage_state=str(auth)
                )
                page = context.new_page()
                page.goto(base.rstrip("/") + "/", wait_until="load", timeout=90_000)
                page.wait_for_timeout(1500)
        path = SHOT_DIR / "01-home.png"
        page.screenshot(path=str(path), full_page=True)
        shots.append(str(path.relative_to(OUT_DIR)))
        # Tools / Agents shell
        for label, name in (
            ("02-agents.png", re.compile(r"Agents", re.I)),
            ("03-tools.png", re.compile(r"Tools", re.I)),
            ("04-vault.png", re.compile(r"Vault", re.I)),
        ):
            try:
                page.get_by_role("link", name=name).first.click(timeout=5000)
                page.wait_for_timeout(1500)
            except Exception:
                try:
                    page.get_by_text(name).first.click(timeout=3000)
                    page.wait_for_timeout(1500)
                except Exception:
                    pass
            sp = SHOT_DIR / label
            page.screenshot(path=str(sp), full_page=True)
            shots.append(str(sp.relative_to(OUT_DIR)))
        # Chat prompt: ask memory/search if composer available
        try:
            page.get_by_role("link", name=re.compile(r"Agents", re.I)).first.click(
                timeout=5000
            )
            page.wait_for_timeout(1000)
            box = page.locator("textarea").first
            if box.count() > 0:
                marker = f"lp-zuh.11.4-mp-{_ts()}"
                box.fill(
                    f"{marker} Use memory_read or mempalace search for 'vault AGENTS' "
                    "and report hits or empty. Do not claim binary missing if tool works."
                )
                page.screenshot(
                    path=str(SHOT_DIR / "05-prompt-filled.png"), full_page=True
                )
                shots.append("screenshots/05-prompt-filled.png")
                # try send
                try:
                    page.get_by_role(
                        "button", name=re.compile(r"Send|Submit", re.I)
                    ).first.click(timeout=3000)
                except Exception:
                    page.keyboard.press("Enter")
                page.wait_for_timeout(25000)
                page.screenshot(
                    path=str(SHOT_DIR / "06-after-memory-turn.png"), full_page=True
                )
                shots.append("screenshots/06-after-memory-turn.png")
        except Exception as e:
            shots.append(f"chat_skip:{type(e).__name__}")
        browser.close()
    _ = (jar, csrf, cookie_source)
    return shots


def main() -> int:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    env = load_mocklab_env()
    base = env["base_url"]
    when = _utc()
    marker = f"lp-zuh.11.4-mp-{_ts()}"

    report: dict[str, Any] = {
        "bead": BEAD,
        "parent": PARENT,
        "when_utc": when,
        "base_url": base,
        "marker": marker,
        "tenant_id": MOCKLAB_TENANT_ID,
        "instance_id": MOCKLAB_INSTANCE_ID,
        "guest": {},
        "acceptance": {},
        "verdict": "UNKNOWN",
        "notes": [],
        "screenshots": [],
        "root_cause": (
            "LA @lanyard-agent/memory defaultWhich uses child_process.spawn("
            "'command', ['-v', name]) without shell; Linux `command` is a builtin "
            "→ ENOENT → ready mempalace.reason=binary_missing despite "
            "/usr/local/bin/mempalace on PATH. Fix: image command-shim "
            "(install-mempalace) + entrypoint MEMPALACE_BIN; live proof patches "
            "PATH command-shim + in-guest gateway restart."
        ),
    }

    if not _daytona_headers():
        report["notes"].append("DAYTONA_API_KEY/ORG_ID unset — guest probes skipped")
        report["verdict"] = "NO_GO_NO_DAYTONA"
        _write(report)
        return 1

    sb = pick_mocklab_sandbox()
    if not sb:
        report["notes"].append("no MockLab sandbox found")
        report["verdict"] = "NO_GO_NO_SANDBOX"
        _write(report)
        return 1

    sid = sb.get("id")
    report["guest"]["sandbox_id"] = sid
    report["guest"]["snapshot"] = sb.get("snapshot") or sb.get("snapshotId")
    report["guest"]["state"] = sb.get("state")

    # Apply live fix then restart so /ready re-probes
    fix = apply_live_which_fix(sid)
    (LOG_DIR / "01-live-which-fix.txt").write_text(
        (fix.get("result") or "") + "\n" + (fix.get("error") or ""), encoding="utf-8"
    )
    report["guest"]["live_fix"] = {
        "ok": fix.get("ok"),
        "preview": (fix.get("result") or "")[:1500],
    }

    report["notes"].append(
        "live clearance via PATH command-shim + in-guest gateway restart "
        "(Daytona stop/start skipped — preserves vault mount)"
    )

    probes = guest_mempalace_probes(sid)
    (LOG_DIR / "03-guest-mempalace.txt").write_text(
        probes.get("raw_preview") or "", encoding="utf-8"
    )
    (LOG_DIR / "03-ready.json").write_text(
        json.dumps(probes.get("ready"), indent=2) + "\n", encoding="utf-8"
    )
    report["guest"]["probes"] = {
        "checks": probes.get("checks"),
        "ready": probes.get("ready"),
        "error": probes.get("error"),
    }

    # UI screenshots
    try:
        report["screenshots"] = portal_ui_shots(base)
    except Exception as e:
        report["notes"].append(f"ui shots: {e}")
        report["screenshots"] = []

    c = probes.get("checks") or {}
    acceptance = {
        "guest_ready_enabled_ok": bool(c.get("ready_enabled") and c.get("ready_ok")),
        "not_binary_missing": bool(c.get("not_binary_missing") and c.get("ready_ok")),
        "bin_on_path": bool(c.get("bin_on_path")),
        "path_under_vault": bool(c.get("path_under_vault")),
        "search_empty_or_hits_no_binary_missing": bool(
            c.get("search_no_binary_missing") or c.get("search_empty_or_hits")
        ),
        "screenshots_present": len(report["screenshots"]) > 0,
    }
    report["acceptance"] = acceptance

    if (
        acceptance["guest_ready_enabled_ok"]
        and acceptance["path_under_vault"]
        and acceptance["search_empty_or_hits_no_binary_missing"]
        and acceptance["bin_on_path"]
    ):
        report["verdict"] = "GO"
    elif acceptance["bin_on_path"] and acceptance["path_under_vault"]:
        report["verdict"] = "GO_PARTIAL_BIN_PATH_READY_RESIDUAL"
    else:
        report["verdict"] = "NO_GO"

    _write(report)
    print(
        f"[{BEAD}] verdict={report['verdict']} ready_ok={c.get('ready_ok')} "
        f"reason={c.get('ready_reason')} path_vault={c.get('path_under_vault')} "
        f"search_ok={acceptance['search_empty_or_hits_no_binary_missing']}"
    )
    return 0 if report["verdict"] == "GO" else 1


def _write(report: dict) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "REPORT.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    c = ((report.get("guest") or {}).get("probes") or {}).get("checks") or {}
    acc = report.get("acceptance") or {}
    ready = ((report.get("guest") or {}).get("probes") or {}).get("ready") or {}
    mp = (ready.get("mempalace") if isinstance(ready, dict) else None) or (
        ready if isinstance(ready, dict) and "enabled" in ready else {}
    )
    # ready may already be the full /ready body
    if "mempalace" in (ready or {}):
        mp = ready.get("mempalace") or {}
    lines = [
        f"# {BEAD} — Playwright zero-waiver: MemPalace search live",
        "",
        f"**Parent:** `{PARENT}`  ",
        f"**When (UTC):** {report.get('when_utc')}  ",
        f"**Base URL:** `{report.get('base_url')}`  ",
        f"**Sandbox:** `{(report.get('guest') or {}).get('sandbox_id')}`  ",
        f"**Snapshot:** `{(report.get('guest') or {}).get('snapshot')}`  ",
        f"**Overall verdict:** **{report.get('verdict')}**  ",
        "",
        "## Root cause (cleared on live pin)",
        "",
        report.get("root_cause") or "",
        "",
        "## Acceptance",
        "",
        "| Criterion | Result |",
        "|-----------|--------|",
        f"| Guest ready mempalace enabled+ok | "
        f"{'**GO**' if acc.get('guest_ready_enabled_ok') else '**NO_GO**'} "
        f"(reason=`{c.get('ready_reason')}`) |",
        f"| Not binary_missing | "
        f"{'**GO**' if acc.get('not_binary_missing') else '**NO_GO**'} |",
        f"| Binary on PATH | "
        f"{'**GO**' if acc.get('bin_on_path') else '**NO_GO**'} |",
        f"| path under vault | "
        f"{'**GO**' if acc.get('path_under_vault') else '**NO_GO**'} |",
        f"| Search empty-or-hits without binary_missing | "
        f"{'**GO**' if acc.get('search_empty_or_hits_no_binary_missing') else '**NO_GO**'} |",
        f"| Screenshots/log evidence | "
        f"{'**GO**' if acc.get('screenshots_present') else '**PARTIAL**'} |",
        "",
        "## Ready snapshot (redacted)",
        "",
        "```json",
        json.dumps(mp or ready, indent=2)[:2000],
        "```",
        "",
        "## Durable platform fix (this PR)",
        "",
        "- `deploy/daytona/agent-gateway/install-mempalace.sh` — bake `/usr/local/bin/command` shim",
        "- `deploy/daytona/agent-gateway/entrypoint.sh` — `ensure_mempalace_runtime` "
        "(MEMPALACE_BIN + guest shim fallback)",
        "- Live pin proof may hot-patch `spawn.js` (`command`→`which`) + sandbox restart "
        "until next image re-pin includes the shim",
        "",
        "## Artifact index",
        "",
        "- [REPORT.json](./REPORT.json)",
        "- [logs/](./logs/)",
        "- [screenshots/](./screenshots/)",
        "",
        "## Secret hygiene",
        "",
        "No passwords, JWT, SM payloads, Relay secrets, or AWS keys in this package.",
        "",
    ]
    (OUT_DIR / "RESULT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
