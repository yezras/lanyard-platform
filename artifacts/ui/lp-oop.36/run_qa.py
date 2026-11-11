#!/usr/bin/env python3
"""lp-oop.36 UI QA — harness-path no-tool chat turn (lp-oop.31 acceptance).

Drive the Portal chat pane against a branch-local BFF with ChatDelivery=harness.
Asserts assistant echo, no tool chrome, and Relay counters stay zero.

Do not point this at https://app.withlanyard.com/mocklab — live AWS
chat_delivery is still default relay (Hermes 504). Harness-path QA on a
flipped MockLab is lp-oop.33.

Usage:
  BASE_URL=http://127.0.0.1:3136/mocklab \\
  UI_QA_EMAIL=agent-dev@mocklab.local UI_QA_PASSWORD=local-dev-password \\
    python3 artifacts/ui/lp-oop.36/run_qa.py
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

BEAD_ID = "lp-oop.36"
REPO = Path(__file__).resolve().parents[3]
ART = Path(os.environ.get("UI_ARTIFACTS", REPO / "artifacts" / "ui" / "lp-oop.36"))
PROMPT_MARKER = os.environ.get("UI_QA_MARKER", "lp-oop.36-ui-no-tool-ping")
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


def tool_ui_count(page) -> dict[str, int]:
    return {
        "chat_tool_calls": page.locator(".astryx-chat-tool-calls").count(),
        "collapsed_pills": page.get_by_test_id("collapsed-tool-pill-trigger").count(),
        "tool_group": page.get_by_role(
            "button", name=re.compile(r"\d+\s+tool calls", re.I)
        ).count(),
    }


def fetch_hop() -> dict:
    parsed = urlparse(BASE + "/")
    hop = urljoin(f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}/", "api/dev/short-stack-hop")
    try:
        with urlopen(hop, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        return {"error": str(exc), "url": hop}


def main() -> int:
    if not BASE:
        print("ERROR: BASE_URL required (local harness UI, not live AWS)", file=sys.stderr)
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
        "parent_acceptance": "lp-oop.31 Evidence files. Relay not on the hop.",
        "base_url": BASE,
        "login": EMAIL,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "prompt_marker": PROMPT_MARKER,
        "checks": {},
        "screenshots": [],
        "errors": [],
        "url": None,
        "assistant_excerpt": None,
        "tool_ui": None,
        "hop": None,
        "honesty": (
            "Browser proof against branch-local BFF ChatDelivery=harness. "
            "Live AWS MockLab chat_delivery stays default relay. "
            "lp-oop.33 is Playwright on a flipped MockLab."
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

            deadline = time.time() + 30
            saw_user = False
            final_asst = ""
            send_failed = ""
            last_tools = tool_ui_count(page)
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
                last_tools = tool_ui_count(page)
                assts = assistant_texts(page)
                if assts and not is_still_starting(page):
                    final_asst = assts[-1]
                    if len(final_asst) > 4:
                        time.sleep(0.8)
                        assts = assistant_texts(page)
                        final_asst = assts[-1] if assts else final_asst
                        last_tools = tool_ui_count(page)
                        break
                time.sleep(0.4)

            p_reply = shot(page, "05-assistant-reply.png")
            report["assistant_excerpt"] = (final_asst or "")[:400]
            report["tool_ui"] = last_tools
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
                or re.search(rf"pong[^\n]*{re.escape(PROMPT_MARKER)}", final_asst, re.I)
            )
            record("echo-or-pong", echo_ok, f"excerpt={final_asst[:180]!r}")
            record(
                "no-tool-chrome",
                sum(last_tools.values()) == 0,
                json.dumps(last_tools),
                p_reply,
            )

            hop = fetch_hop()
            report["hop"] = hop
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
                json.dumps({"relay": relay, "harness_kind": hop.get("harness_kind")}),
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
        "prompt-sent",
        "assistant-reply",
        "echo-or-pong",
        "relay-not-on-hop",
    )
    passed = all(checks.get(k, {}).get("ok") for k in required)
    report["passed"] = bool(passed)
    (ART / "REPORT.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                k: report[k]
                for k in ("bead_id", "passed", "url", "checks", "errors", "hop")
            },
            indent=2,
        )
    )
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
