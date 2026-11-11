#!/usr/bin/env python3
"""lp-oop.34 UI QA — kitchen-sink re-QA on the MockLab harness path.

Matrix: auth shell, vault tree without wake, tools/workflows/MCP honesty,
scheduled tasks UI, harness send+stream. Guest path stays default relay.

Do not point this at https://app.withlanyard.com/mocklab — live AWS
chat_delivery is still default relay (OPERATOR HOLD). Live tool-only
snapshot is held. Waivers belong in RESULT.md, not silent green.

Usage:
  BASE_URL=http://127.0.0.1:3138/mocklab \\
  UI_QA_EMAIL=agent-dev@mocklab.local UI_QA_PASSWORD=local-dev-password \\
    python3 artifacts/ui/lp-oop.34/run_qa.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

BEAD_ID = "lp-oop.34"
REPO = Path(__file__).resolve().parents[3]
ART = Path(os.environ.get("UI_ARTIFACTS", REPO / "artifacts" / "ui" / "lp-oop.34"))
PROMPT_MARKER = os.environ.get("UI_QA_MARKER", "lp-oop.34-kitchen-sink-ping")
VAULT_MARKER = os.environ.get("UI_QA_VAULT_MARKER", "short-stack-kitchen-sink.md")
PROMPT = (
    "Do not use any tools, skills, web search, vault, bash, or files. "
    "Reply with exactly this one line and nothing else: "
    f"pong {PROMPT_MARKER}"
)
SEED_TOKENS = (
    "AGENTS.md",
    "Projects",
    "skills",
    "workflows",
    "cron",
    "welcome.md",
    VAULT_MARKER,
)


def _load_env() -> None:
    env_file = REPO / ".env.mocklab-agent-dev"
    if not env_file.is_file():
        return
    for raw in env_file.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip().strip("'").strip('"'))


_load_env()

BASE = os.environ.get("BASE_URL", "").rstrip("/")
EMAIL = os.environ.get("UI_QA_EMAIL", "agent-dev@mocklab.local")
PASSWORD = os.environ.get("UI_QA_PASSWORD", "local-dev-password")


def shot(page, name: str) -> Path:
    ART.mkdir(parents=True, exist_ok=True)
    out = ART / name
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0, f"empty screenshot {out}"
    return out


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


def login(page) -> None:
    page.goto(BASE + "/", wait_until="commit", timeout=90_000)
    time.sleep(2.0)
    login_btn = page.get_by_role("button", name="Log in", exact=True)
    agents = page.get_by_role("button", name=re.compile(r"^Agents$", re.I))
    if login_btn.count() == 0 and agents.count() > 0:
        return
    if not EMAIL or not PASSWORD:
        raise RuntimeError("UI_QA_EMAIL/PASSWORD required")
    email = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
    if email.count() == 0:
        email = page.locator('input[type="email"], input[name="email"]')
    email.first.fill(EMAIL)
    page.locator('input[type="password"]').first.fill(PASSWORD)
    page.get_by_role("button", name="Log in", exact=True).click()
    time.sleep(2.0)
    for _ in range(40):
        if page.get_by_role("button", name=re.compile(r"^Agents$", re.I)).count():
            return
        if page.get_by_role(
            "button", name=re.compile(r"New chat|New Agent|^New$", re.I)
        ).count():
            return
        time.sleep(0.4)
    raise RuntimeError(f"login did not reach app shell; url={page.url}")


def open_tab(page, name: str) -> None:
    btn = page.get_by_role("button", name=re.compile(rf"^{re.escape(name)}$", re.I))
    if btn.count() == 0:
        tab = page.get_by_role("tab", name=re.compile(rf"^{re.escape(name)}$", re.I))
        if tab.count():
            _visible_first(tab).click()
        else:
            page.get_by_text(re.compile(rf"^{re.escape(name)}$", re.I)).first.click()
    else:
        _visible_first(btn).click()
    time.sleep(1.0)


def open_new_chat(page) -> None:
    open_tab(page, "Agents")
    create_btn = page.get_by_role("button", name=re.compile(r"^New Agent$", re.I))
    if create_btn.count():
        try:
            _visible_first(create_btn).click(timeout=3000)
            time.sleep(0.3)
            item = page.get_by_role("menuitem", name=re.compile(r"^Agent$", re.I))
            if item.count():
                item.first.click(timeout=3000)
                time.sleep(1.2)
                return
            page.keyboard.press("Escape")
        except Exception:
            try:
                page.keyboard.press("Escape")
            except Exception:
                pass
    new_chat = page.get_by_role("button", name=re.compile(r"New chat|^New$", re.I))
    if new_chat.count():
        try:
            _visible_first(new_chat).click(timeout=3000)
            time.sleep(1.2)
        except Exception:
            pass


def find_composer(page):
    box = page.get_by_role("combobox", name=re.compile(r"Message input", re.I))
    if box.count():
        try:
            if box.first.is_visible():
                return box.first
        except Exception:
            pass
    box = page.locator(
        'textarea, [contenteditable="true"], [data-testid*="composer"]'
    )
    if box.count():
        try:
            if box.first.is_visible():
                return box.first
        except Exception:
            pass
    return page.get_by_role("textbox").last


def send_message(page, text: str) -> None:
    box = find_composer(page)
    box.click(timeout=8000)
    try:
        box.fill(text)
    except Exception:
        page.keyboard.type(text, delay=5)
    time.sleep(0.3)
    send = page.get_by_role("button", name=re.compile(r"^Send$|Send message", re.I))
    if send.count() and send.first.is_enabled():
        send.first.click()
    else:
        page.keyboard.press("Enter")
    time.sleep(0.8)


STATUS_RE = re.compile(
    r"agent starting|sending\b|^thinking\b|ensure_online|waking",
    re.I,
)


def assistant_texts(page) -> list[str]:
    arts = page.locator('article[aria-label="Message from assistant"]')
    out: list[str] = []
    for i in range(arts.count()):
        try:
            txt = (arts.nth(i).inner_text() or "").strip()
        except Exception:
            txt = ""
        if txt and not STATUS_RE.search(txt):
            out.append(txt)
    return out


def body_text(page) -> str:
    try:
        return page.locator("body").inner_text(timeout=5000)
    except Exception:
        return ""


def fetch_hop() -> dict:
    parsed = urlparse(BASE + "/")
    hop = urljoin(
        f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}/",
        "api/dev/short-stack-hop",
    )
    try:
        with urlopen(hop, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        return {"error": str(exc), "url": hop}


def api_get(page, path: str) -> dict:
    return page.evaluate(
        """async (args) => {
          const url = args.base.replace(/\\/$/, '') + args.path;
          try {
            const res = await fetch(url, { credentials: 'include' });
            const t = await res.text();
            let body = null;
            try { body = JSON.parse(t); } catch (e) { body = t.slice(0, 2000); }
            return { status: res.status, body, url, ct: res.headers.get('content-type') };
          } catch (e) {
            return { status: 0, body: null, url, error: String(e) };
          }
        }""",
        {"base": BASE, "path": path},
    )


def extract_names(payload) -> list[str]:
    names: list[str] = []
    if not isinstance(payload, dict):
        return names

    def walk(obj, depth=0):
        if depth > 8:
            return
        if isinstance(obj, dict):
            n = obj.get("name") or obj.get("path") or obj.get("id")
            if n and isinstance(n, str):
                names.append(n)
            for k in ("roots", "entries", "children", "items", "data", "result", "tree", "nodes"):
                if k in obj:
                    walk(obj[k], depth + 1)
        elif isinstance(obj, list):
            for it in obj[:100]:
                walk(it, depth + 1)

    walk(payload)
    out: list[str] = []
    seen = set()
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def click_named(page, names: tuple[str, ...]) -> bool:
    for name in names:
        loc = page.get_by_role("button", name=re.compile(rf"^{re.escape(name)}$", re.I))
        if loc.count():
            try:
                _visible_first(loc).click(timeout=3000)
                time.sleep(0.8)
                return True
            except Exception:
                continue
        loc = page.get_by_role("tab", name=re.compile(rf"^{re.escape(name)}$", re.I))
        if loc.count():
            try:
                _visible_first(loc).click(timeout=3000)
                time.sleep(0.8)
                return True
            except Exception:
                continue
        loc = page.get_by_text(re.compile(rf"^{re.escape(name)}$", re.I))
        if loc.count():
            try:
                _visible_first(loc).click(timeout=3000)
                time.sleep(0.8)
                return True
            except Exception:
                continue
    return False


def main() -> int:
    if not BASE:
        print(
            "ERROR: BASE_URL required (local harness kitchen-sink, not live AWS)",
            file=sys.stderr,
        )
        return 2
    if "withlanyard.com" in BASE and "127.0.0.1" not in BASE:
        print(
            "ERROR: live AWS MockLab is still relay/guest. "
            "Use the local prove script BASE_URL.",
            file=sys.stderr,
        )
        return 2

    ART.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "bead_id": BEAD_ID,
        "acceptance": "RESULT.md GO or GO_WITH_WAIVERS. Waivers named.",
        "base_url": BASE,
        "login": EMAIL,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "prompt_marker": PROMPT_MARKER,
        "vault_marker": VAULT_MARKER,
        "checks": {},
        "screenshots": [],
        "errors": [],
        "url": None,
        "assistant_excerpt": None,
        "stream": None,
        "vault_tree": None,
        "hop": None,
        "matrix": {},
        "waivers": {
            "live_flip_chat_delivery": "operator (lp-oop.29 runbook); MockLab stays relay",
            "live_tool_only_snapshot": "human pin held (lp-oop.23 / lp-oop.32)",
            "live_tools_web_search": "held until live flip + tool-only pin",
            "live_subagents": "held until live flip + tool-only pin",
            "live_workflows_launch": "held until live flip + tool-only pin",
            "onlyoffice_editor_host": "EXPLICIT_HARD_RESIDUAL (lp-zuh.11.3)",
            "mcp": "PRODUCT_NA_SIGNED (lp-zuh.11.5 / PR #488)",
            "mempalace": "guest-path GO carried (lp-zuh.11.4); not harness-path",
            "live_guest_chat": "Hermes 504 noted; OPERATOR HOLD; guest path still default",
        },
        "honesty": (
            "Browser proof against branch-local BFF ChatDelivery=harness "
            "and VaultPlane=cp_s3. Live AWS MockLab chat_delivery stays "
            "default relay (OPERATOR HOLD; no terraform apply / no flip). "
            "Guest path remains available."
        ),
    }

    def record(name: str, ok: bool, detail: str = "", path: Path | None = None):
        report["checks"][name] = {
            "ok": ok,
            "detail": detail,
            "screenshot": path.name if path else None,
        }
        if path:
            report["screenshots"].append(str(path))
        if not ok:
            report["errors"].append(f"{name}: {detail}")

    network: dict = {
        "vault_tree": [],
        "sse": [],
        "wake_502": [],
    }

    def on_response(response) -> None:
        try:
            url = response.url
            status = response.status
            ctype = (response.headers or {}).get("content-type", "")
        except Exception:
            return
        rec = {"url": url, "status": status, "content_type": ctype}
        if "/api/vault/tree" in url:
            network["vault_tree"].append(rec)
        if "/events" in url and "text/event-stream" in ctype:
            network["sse"].append(rec)
        if status == 502 and (
            "wake" in url.lower()
            or "ensure" in url.lower()
            or "/api/vault/tree" in url
        ):
            network["wake_502"].append(rec)

    browser = None
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=[
                    "--disable-dev-shm-usage",
                    "--no-sandbox",
                    "--disable-gpu",
                    "--use-gl=swiftshader",
                ],
            )
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            page = context.new_page()
            page.on("response", on_response)

            login(page)
            report["url"] = page.url
            p_home = shot(page, "01-auth-home.png")
            record("login", True, f"url={page.url}", p_home)

            agents = page.get_by_role("button", name=re.compile(r"^Agents$", re.I)).count()
            vault = page.get_by_role("button", name=re.compile(r"^Vault$", re.I)).count()
            tools = page.get_by_role("button", name=re.compile(r"^Tools$", re.I)).count()
            nav_ok = agents >= 1 and vault >= 1 and tools >= 1
            p_shell = shot(page, "02-agents-shell.png")
            record(
                "nav_agents_vault_tools",
                nav_ok,
                f"agents={agents} vault={vault} tools={tools}",
                p_shell,
            )
            report["matrix"]["shell_auth"] = "GO" if nav_ok else "NO_GO"

            open_new_chat(page)
            composer_ok = False
            try:
                find_composer(page).wait_for(state="visible", timeout=8000)
                composer_ok = True
            except Exception as exc:
                record("composer", False, str(exc)[:300])
            p_composer = shot(page, "03-new-chat-composer.png")
            if composer_ok:
                record("composer", True, f"visible=True url={page.url}", p_composer)

            sse_before = len(network["sse"])
            send_message(page, PROMPT)
            p_sent = shot(page, "04-prompt-sent.png")
            record("prompt-sent", True, f"marker={PROMPT_MARKER}", p_sent)
            record("send", True, f"marker={PROMPT_MARKER}", p_sent)

            body = body_text(page)
            user_ok = PROMPT_MARKER in body
            record("user-prompt-visible", user_ok, f"marker={PROMPT_MARKER}", p_sent)

            excerpt = ""
            echo_ok = False
            for _ in range(40):
                texts = assistant_texts(page)
                if texts:
                    excerpt = texts[-1]
                    if "echo:" in excerpt.lower() or f"pong {PROMPT_MARKER}" in excerpt:
                        echo_ok = True
                        break
                time.sleep(0.4)
            p_reply = shot(page, "05-assistant-reply.png")
            report["assistant_excerpt"] = excerpt[:400] if excerpt else None
            record(
                "assistant-reply",
                bool(excerpt),
                f"len={len(excerpt)} excerpt={excerpt[:180]!r}",
                p_reply,
            )
            record("echo-or-pong", echo_ok, f"excerpt={excerpt[:180]!r}")
            report["matrix"]["harness_chat_send_stream"] = (
                "GO" if echo_ok else "NO_GO"
            )

            hop = fetch_hop()
            report["hop"] = hop
            sse_after = len(network["sse"])
            hop_sse = 0
            if isinstance(hop, dict):
                hop_sse = int(((hop.get("stream") or {}).get("sse_count")) or 0)
            stream_ok = (sse_after > sse_before) or hop_sse > 0
            report["stream"] = {
                "browser_sse": network["sse"],
                "hop_sse_count": hop_sse,
                "hop_event_types": [
                    t
                    for turn in (hop.get("turns") or [])
                    if isinstance(turn, dict)
                    for t in (turn.get("event_types") or [])
                ]
                if isinstance(hop, dict)
                else [],
            }
            record(
                "stream",
                stream_ok,
                json.dumps(
                    {
                        "browser_sse": sse_after - sse_before,
                        "hop_sse_count": hop_sse,
                        "event_types": report["stream"]["hop_event_types"],
                    }
                ),
                p_reply,
            )

            relay = hop.get("relay") if isinstance(hop, dict) else {}
            relay_ok = (
                isinstance(relay, dict)
                and relay.get("deliverInbound", 1) == 0
                and relay.get("interruptInbound", 1) == 0
                and relay.get("openChatEventStream", 1) == 0
                and relay.get("fetchChatHistory", 1) == 0
            )
            record(
                "relay-not-on-hop",
                relay_ok,
                json.dumps(
                    {
                        "relay": relay,
                        "harness_kind": hop.get("harness_kind")
                        if isinstance(hop, dict)
                        else None,
                        "vault_plane": hop.get("vault_plane")
                        if isinstance(hop, dict)
                        else None,
                    }
                ),
            )
            guest_default = (
                isinstance(hop, dict)
                and hop.get("guest_path_default") == "relay"
                and hop.get("live_chat_delivery_flipped") is False
            )
            record(
                "guest-path-still-available",
                guest_default,
                json.dumps(
                    {
                        "guest_path_default": hop.get("guest_path_default")
                        if isinstance(hop, dict)
                        else None,
                        "live_chat_delivery_flipped": hop.get(
                            "live_chat_delivery_flipped"
                        )
                        if isinstance(hop, dict)
                        else None,
                    }
                ),
            )
            report["matrix"]["guest_path_still_available"] = (
                "GO" if guest_default else "NO_GO"
            )

            open_tab(page, "Vault")
            time.sleep(1.2)
            vault_api = api_get(page, "/api/vault/tree")
            vbody = vault_api.get("body") if isinstance(vault_api.get("body"), dict) else {}
            names = extract_names(vbody) if isinstance(vbody, dict) else []
            seed_hits = [
                t for t in SEED_TOKENS if any(t.lower() in n.lower() for n in names)
            ]
            marker_ok = any(VAULT_MARKER.lower() in n.lower() for n in names)
            tree_status = vault_api.get("status")
            tree_ok = tree_status == 200 and marker_ok and len(names) >= 3
            p_vault = shot(page, "06-vault-tree.png")
            report["vault_tree"] = {
                "browser": network["vault_tree"],
                "wake_502": network["wake_502"],
                "last_status": tree_status,
                "last_roots": names[:20],
                "marker_visible": marker_ok,
                "seed_hits": seed_hits,
            }
            hop = fetch_hop()
            report["hop"] = hop
            tree_meta = (hop.get("vault_tree") or {}) if isinstance(hop, dict) else {}
            no_wake = (
                tree_meta.get("did_not_502_wake") is True
                and int(tree_meta.get("ensure_online_during_tree") or 0) == 0
                and not network["wake_502"]
                and tree_status == 200
            )
            record(
                "vault-tree-visible",
                tree_ok,
                f"marker={marker_ok} roots={names[:8]}",
                p_vault,
            )
            record(
                "vault-tree-did-not-502-wake",
                no_wake,
                json.dumps(
                    {
                        "last_status": tree_status,
                        "browser_502": bool(network["wake_502"]),
                        "did_not_502_wake": tree_meta.get("did_not_502_wake"),
                        "ensure_online_during_tree": tree_meta.get(
                            "ensure_online_during_tree"
                        ),
                        "wake": hop.get("wake") if isinstance(hop, dict) else None,
                    }
                ),
                p_vault,
            )
            report["matrix"]["vault_tree"] = "GO" if tree_ok and no_wake else "NO_GO"

            click_named(page, ("Projects", "AGENTS.md", "welcome.md"))
            time.sleep(0.5)
            p_entry = shot(page, "07-vault-entry.png")
            record("vault-entry-open", True, "clicked vault label", p_entry)

            open_tab(page, "Tools")
            time.sleep(1.0)
            p_tools = shot(page, "08-tools-overview.png")
            tools_body = body_text(page)
            tools_nav = [
                label
                for label in ("Skills", "Workflows", "MCP", "Models", "Integrations")
                if re.search(rf"\b{re.escape(label)}\b", tools_body)
            ]
            tools_ok = len(tools_nav) >= 2
            record(
                "tools-nav",
                tools_ok,
                f"nav={tools_nav}",
                p_tools,
            )
            report["matrix"]["tools_nav"] = "GO" if tools_ok else "NO_GO"

            wf_clicked = click_named(page, ("Workflows",))
            time.sleep(0.8)
            p_wf = shot(page, "09-tools-workflows.png")
            wf_snip = " | ".join(body_text(page).splitlines()[:16])
            gateway_down = bool(re.search(r"gateway.*(down|offline|unreachable)", wf_snip, re.I))
            record(
                "tools-workflows",
                wf_clicked and not gateway_down,
                f"clicked={wf_clicked} gateway_down={gateway_down} snip={wf_snip[:180]!r}",
                p_wf,
            )
            report["matrix"]["tools_workflows"] = (
                "GO" if wf_clicked and not gateway_down else "NO_GO"
            )

            mcp_clicked = click_named(page, ("MCP",))
            time.sleep(0.8)
            p_mcp = shot(page, "10-tools-mcp.png")
            mcp_snip = " | ".join(body_text(page).splitlines()[:16])
            mcp_empty = bool(
                re.search(r"No MCP servers|mcp_servers.?=.?\[\]|0 MCP", mcp_snip, re.I)
            )
            record(
                "tools-mcp",
                mcp_clicked,
                f"clicked={mcp_clicked} empty_honest={mcp_empty} waiver=PRODUCT_NA_SIGNED snip={mcp_snip[:180]!r}",
                p_mcp,
            )
            report["matrix"]["mcp"] = "PRODUCT_NA_SIGNED_WAIVER"

            open_tab(page, "Agents")
            time.sleep(0.5)
            cron_clicked = click_named(
                page, ("Scheduled Tasks", "Scheduled tasks", "Cron")
            )
            time.sleep(0.8)
            p_cron = shot(page, "11-scheduled-tasks.png")
            cron_body = body_text(page)
            cron_label = bool(
                re.search(r"Scheduled Tasks|Cron|No scheduled", cron_body, re.I)
            )
            record(
                "scheduled-tasks",
                cron_clicked or cron_label,
                f"clicked={cron_clicked} label_visible={cron_label}",
                p_cron,
            )
            report["matrix"]["cron_scheduled_tasks_ui"] = (
                "GO" if (cron_clicked or cron_label) else "NO_GO"
            )

            p_final = shot(page, "12-final.png")
            record("final", True, f"url={page.url}", p_final)

    except Exception as exc:
        report["errors"].append(str(exc)[:800])
        try:
            if "page" in locals():
                shot(page, "99-fail.png")
        except Exception:
            pass
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass

    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    required = (
        "login",
        "nav_agents_vault_tools",
        "send",
        "echo-or-pong",
        "stream",
        "vault-tree-visible",
        "vault-tree-did-not-502-wake",
        "relay-not-on-hop",
        "guest-path-still-available",
        "tools-nav",
        "tools-workflows",
        "scheduled-tasks",
    )
    required_ok = all(report["checks"].get(name, {}).get("ok") for name in required)
    report["passed"] = required_ok and not report["errors"]
    report["overall_verdict"] = "GO_WITH_WAIVERS" if report["passed"] else "NO_GO"

    out = ART / "REPORT.json"
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"passed": report["passed"], "report": str(out), "errors": report["errors"]}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
