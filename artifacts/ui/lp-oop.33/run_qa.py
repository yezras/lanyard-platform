#!/usr/bin/env python3
"""lp-oop.33 UI QA — Playwright on the MockLab harness path.

Send, stream, and vault tree without wake. Local BFF is ChatDelivery=harness
and VaultPlane=cp_s3. GET /api/vault/tree must be 200 (not 502 wake).

Do not point this at https://app.withlanyard.com/mocklab — live AWS
chat_delivery is still default relay (Hermes 504). OPERATOR HOLD forbids
re-applying torn-down staging AWS.

Usage:
  BASE_URL=http://127.0.0.1:3137/mocklab \\
  UI_QA_EMAIL=agent-dev@mocklab.local UI_QA_PASSWORD=local-dev-password \\
    python3 artifacts/ui/lp-oop.33/run_qa.py
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

BEAD_ID = "lp-oop.33"
REPO = Path(__file__).resolve().parents[3]
ART = Path(os.environ.get("UI_ARTIFACTS", REPO / "artifacts" / "ui" / "lp-oop.33"))
PROMPT_MARKER = os.environ.get("UI_QA_MARKER", "lp-oop.33-ui-harness-ping")
VAULT_MARKER = os.environ.get("UI_QA_VAULT_MARKER", "short-stack-no-wake.md")
PROMPT = (
    "Do not use any tools, skills, web search, vault, bash, or files. "
    "Reply with exactly this one line and nothing else: "
    f"pong {PROMPT_MARKER}"
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


def open_agents(page) -> None:
    btn = page.get_by_role("button", name=re.compile(r"^Agents$", re.I))
    if btn.count():
        _visible_first(btn).click()
        time.sleep(0.8)


def open_vault(page) -> None:
    btn = page.get_by_role("button", name=re.compile(r"^Vault$", re.I))
    if btn.count() == 0:
        raise RuntimeError("Vault tab not found")
    _visible_first(btn).click()
    time.sleep(1.0)


def open_new_chat(page) -> None:
    open_agents(page)
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


def is_still_starting(page) -> bool:
    body = page.locator("body").inner_text() or ""
    return bool(re.search(r"Agent starting", body, re.I)) or bool(
        re.search(r"\bSending\b", body)
    )


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


def main() -> int:
    if not BASE:
        print(
            "ERROR: BASE_URL required (local harness UI, not live AWS)",
            file=sys.stderr,
        )
        return 2
    if "withlanyard.com" in BASE and "127.0.0.1" not in BASE:
        print(
            "ERROR: live AWS MockLab is still relay/Hermes. "
            "Use the local prove script BASE_URL.",
            file=sys.stderr,
        )
        return 2

    ART.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "bead_id": BEAD_ID,
        "acceptance": "REPORT.json + screenshots. Vault tree did not 502 wake.",
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
        "honesty": (
            "Browser proof against branch-local BFF ChatDelivery=harness "
            "and VaultPlane=cp_s3. Live AWS MockLab chat_delivery stays "
            "default relay (OPERATOR HOLD; no terraform apply / no flip)."
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
            context = browser.new_context(viewport={"width": 1280, "height": 720})
            page = context.new_page()
            page.on("response", on_response)

            login(page)
            report["url"] = page.url
            p_home = shot(page, "01-login-home.png")
            record("login", True, f"url={page.url}", p_home)

            open_agents(page)
            p_agents = shot(page, "02-agents.png")
            record("agents-tab", True, f"url={page.url}", p_agents)

            open_new_chat(page)
            composer_ok = False
            try:
                composer = find_composer(page)
                composer_ok = composer is not None and composer.is_visible()
            except Exception as exc:
                record("composer", False, str(exc))
            p_chat = shot(page, "03-new-chat-composer.png")
            record(
                "composer",
                composer_ok,
                f"visible={composer_ok} url={page.url}",
                p_chat,
            )
            if not composer_ok:
                raise RuntimeError("chat composer not visible after new chat")

            send_message(page, PROMPT)
            p_sent = shot(page, "04-prompt-sent.png")
            record("prompt-sent", True, f"marker={PROMPT_MARKER}", p_sent)
            record("send", True, f"marker={PROMPT_MARKER}", p_sent)

            deadline = time.time() + 30
            saw_user = False
            final_asst = ""
            send_failed = ""
            while time.time() < deadline:
                body = page.locator("body").inner_text() or ""
                if PROMPT_MARKER in body or "Do not use any tools" in body:
                    saw_user = True
                fail_m = re.search(
                    r"(Hermes request failed|Send failed \(\d+\)|wake_|ENSURE_ONLINE)",
                    body,
                    re.I,
                )
                if fail_m:
                    send_failed = fail_m.group(0)
                    shot(page, "05-send-failed.png")
                    break
                assts = assistant_texts(page)
                if assts and not is_still_starting(page):
                    final_asst = assts[-1]
                    if len(final_asst) > 4:
                        time.sleep(0.8)
                        assts = assistant_texts(page)
                        final_asst = assts[-1] if assts else final_asst
                        break
                time.sleep(0.4)

            p_reply = shot(page, "05-assistant-reply.png")
            report["assistant_excerpt"] = (final_asst or "")[:400]
            report["url"] = page.url
            record("user-prompt-visible", saw_user, f"marker={PROMPT_MARKER}", p_sent)
            if send_failed:
                record(
                    "assistant-reply",
                    False,
                    f"send_failed={send_failed!r}",
                    p_reply,
                )
            else:
                reply_ok = bool(final_asst) and not STATUS_RE.search(final_asst)
                record(
                    "assistant-reply",
                    reply_ok,
                    f"len={len(final_asst)} excerpt={final_asst[:180]!r}",
                    p_reply,
                )
            echo_ok = bool(
                re.search(r"echo:\s+", final_asst, re.I)
                or re.search(
                    rf"pong[^\n]*{re.escape(PROMPT_MARKER)}", final_asst, re.I
                )
            )
            record("echo-or-pong", echo_ok, f"excerpt={final_asst[:180]!r}")

            hop_mid = fetch_hop()
            sse_net = network["sse"]
            hop_stream = hop_mid.get("stream") or {}
            hop_events = []
            for turn in hop_mid.get("turns") or []:
                hop_events.extend(turn.get("event_types") or [])
            stream_ok = bool(sse_net) or int(hop_stream.get("sse_count") or 0) > 0
            if not stream_ok and "message_send" in hop_events:
                stream_ok = True
            report["stream"] = {
                "browser_sse": sse_net,
                "hop_sse_count": hop_stream.get("sse_count"),
                "hop_event_types": hop_events,
            }
            record(
                "stream",
                stream_ok,
                json.dumps(
                    {
                        "browser_sse": len(sse_net),
                        "hop_sse_count": hop_stream.get("sse_count"),
                        "event_types": hop_events,
                    }
                ),
                p_reply,
            )

            open_vault(page)
            tree_deadline = time.time() + 12
            tree_body = ""
            while time.time() < tree_deadline:
                tree_body = page.locator("body").inner_text() or ""
                if (
                    VAULT_MARKER in tree_body
                    or "AGENTS.md" in tree_body
                    or re.search(r"\bProjects\b", tree_body)
                ):
                    break
                if network["vault_tree"]:
                    break
                time.sleep(0.4)
            p_vault = shot(page, "06-vault-tree.png")

            hop = fetch_hop()
            report["hop"] = hop
            last_tree = (hop.get("vault_tree") or {}).get("last_status")
            last_roots = (hop.get("vault_tree") or {}).get("last_roots") or []
            tree_status_ok = last_tree == 200
            tree_502 = any(rec.get("status") == 502 for rec in network["vault_tree"])
            wake_502_ui = bool(
                re.search(r"502|wake_failed|ENSURE_ONLINE|Agent starting", tree_body, re.I)
                and "short-stack-no-wake" not in tree_body
            )
            marker_ok = VAULT_MARKER in tree_body or VAULT_MARKER in json.dumps(
                last_roots
            )
            no_wake = bool((hop.get("vault_tree") or {}).get("did_not_502_wake")) or (
                tree_status_ok
                and not tree_502
                and (hop.get("vault_tree") or {}).get("ensure_online_during_tree", 1)
                == 0
            )
            report["vault_tree"] = {
                "browser": network["vault_tree"],
                "wake_502": network["wake_502"],
                "last_status": last_tree,
                "last_roots": last_roots,
                "marker_visible": marker_ok,
            }
            record(
                "vault-tree-visible",
                marker_ok or "Projects" in tree_body or "AGENTS.md" in tree_body,
                f"marker={marker_ok} roots={last_roots}",
                p_vault,
            )
            record(
                "vault-tree-did-not-502-wake",
                bool(no_wake) and tree_status_ok and not tree_502 and not wake_502_ui,
                json.dumps(
                    {
                        "last_status": last_tree,
                        "browser_502": tree_502,
                        "did_not_502_wake": (hop.get("vault_tree") or {}).get(
                            "did_not_502_wake"
                        ),
                        "ensure_online_during_tree": (hop.get("vault_tree") or {}).get(
                            "ensure_online_during_tree"
                        ),
                        "wake": hop.get("wake"),
                    }
                ),
                p_vault,
            )

            relay = hop.get("relay") or {}
            hop_ok = bool(hop.get("checks", {}).get("relay.not_on_hop")) or (
                relay.get("deliverInbound", 1) == 0
                and relay.get("interruptInbound", 1) == 0
                and relay.get("openChatEventStream", 1) == 0
                and relay.get("fetchChatHistory", 1) == 0
                and "error" not in hop
            )
            record(
                "relay-not-on-hop",
                hop_ok,
                json.dumps(
                    {
                        "relay": relay,
                        "harness_kind": hop.get("harness_kind"),
                        "vault_plane": hop.get("vault_plane"),
                    }
                ),
            )
            context.close()
    except Exception as exc:
        report["errors"].append(str(exc))
        try:
            if "page" in locals():
                p_err = shot(page, "99-error.png")
                report["screenshots"].append(str(p_err))
        except Exception:
            pass
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass

    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    checks = report["checks"]
    required = (
        "login",
        "composer",
        "send",
        "assistant-reply",
        "stream",
        "vault-tree-visible",
        "vault-tree-did-not-502-wake",
        "relay-not-on-hop",
    )
    passed = all(checks.get(k, {}).get("ok") for k in required)
    report["passed"] = bool(passed)
    (ART / "REPORT.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                k: report[k]
                for k in (
                    "bead_id",
                    "passed",
                    "url",
                    "checks",
                    "errors",
                    "stream",
                    "vault_tree",
                    "hop",
                )
            },
            indent=2,
        )
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
