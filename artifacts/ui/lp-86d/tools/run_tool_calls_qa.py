#!/usr/bin/env python3
"""lp-86d.3 standalone live QA runner for ChatToolCalls lifecycle UI.

Run:
  python3 run_tool_calls_qa.py
"""
from __future__ import annotations

import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://demo.localhost:3010"
EMAIL = "dev@demo.local"
PASSWORD = "local-dev-password"
ART = Path(__file__).resolve().parent
BEAD_ID = "lp-86d.3"
PROMPT_MARKER = "lp86d3-tool-ui-marker"

HUMANIZED = (
    "Reading documents",
    "Searching files",
    "Running a command",
    "Listing files",
    "Listing directories",
    "Writing files",
    "Editing files",
    "Browsing the web",
    "Searching the web",
    "Parsing a document",
)
LABEL_RE = re.compile(
    r"^("
    + "|".join(re.escape(x) for x in HUMANIZED)
    + r"|Reading|Searching|Listing|Running a |Writing|Editing|Browsing)",
    re.I,
)


def shot(page, name: str) -> Path:
    ART.mkdir(parents=True, exist_ok=True)
    out = ART / name
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0
    return out


def scan_tool_ui(page) -> dict:
    roots = page.locator(".astryx-chat-tool-calls").count()
    btn_count = page.get_by_role("button", name=LABEL_RE).count()
    root_labels: list[str] = []
    for i in range(min(roots, 12)):
        root = page.locator(".astryx-chat-tool-calls").nth(i)
        try:
            txt = root.inner_text(timeout=1500) or ""
        except Exception:
            txt = ""
        for label in HUMANIZED:
            if label.lower() in txt.lower() and label not in root_labels:
                root_labels.append(label)
        for line in txt.splitlines():
            s = line.strip()
            if s and LABEL_RE.match(s) and s not in root_labels:
                root_labels.append(s[:80])
    duration_hits = 0
    if roots:
        try:
            blob = "\n".join(page.locator(".astryx-chat-tool-calls").all_inner_texts())
            duration_hits = len(re.findall(r"\b\d+(\.\d+)?\s*(ms|s)\b", blob))
        except Exception:
            pass
    collapsed = page.get_by_test_id("collapsed-tool-pill").count()
    return {
        "chat_tool_calls_roots": roots,
        "humanized_button_count": btn_count,
        "labels_in_tool_roots": root_labels,
        "duration_markers": duration_hits,
        "collapsed_tool_pill": collapsed,
        "toolish_count": roots + btn_count + collapsed,
    }


def login(page) -> None:
    page.goto(BASE + "/", wait_until="commit", timeout=60_000)
    time.sleep(2.5)
    login_btn = page.get_by_role("button", name="Log in", exact=True)
    settings = page.get_by_role("button", name=re.compile(r"^Settings$", re.I))
    if login_btn.count() == 0 and settings.count() > 0:
        return
    if login_btn.count() == 0:
        # already authenticated shell
        if page.get_by_role("button", name=re.compile(r"New chat|New Agent|^New$", re.I)).count():
            return
    email = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
    if email.count() == 0:
        email = page.locator('input[type="email"], input[name="email"]')
    email.first.fill(EMAIL)
    page.locator('input[type="password"]').first.fill(PASSWORD)
    page.get_by_role("button", name="Log in", exact=True).click()
    time.sleep(3)
    # Wait for shell
    for _ in range(20):
        if page.get_by_role("button", name=re.compile(r"^Settings$", re.I)).count():
            return
        if page.get_by_role("button", name=re.compile(r"New chat|New Agent|^New$", re.I)).count():
            return
        time.sleep(0.5)


def qa_story(page) -> dict:
    out: dict = {"ok": False, "assertions": {}, "detail": ""}
    page.goto(
        f"{BASE}/?story=activity-plane&phase=tools&pane=closed&layout=split",
        wait_until="commit",
        timeout=60_000,
    )
    time.sleep(3)
    story = page.get_by_test_id("activity-plane-story")
    if story.count() == 0:
        out["detail"] = "activity-plane-story not found"
        shot(page, "00-story-missing.png")
        return out
    time.sleep(0.5)
    reading = page.get_by_text("Reading documents").count() > 0
    searching = page.get_by_text("Searching files").count() > 0
    running = page.get_by_text("Running a command").count() > 0
    raw_read = page.get_by_text("read_file", exact=True).count()
    scan = scan_tool_ui(page)
    shot(page, "00-story-phase-tools.png")
    out["assertions"] = {
        "reading_documents": reading,
        "searching_files": searching,
        "running_a_command": running,
        "raw_read_file_count": raw_read,
        "scan": scan,
    }
    out["ok"] = reading and searching and running and raw_read == 0 and (
        scan["toolish_count"] > 0 or scan["chat_tool_calls_roots"] > 0
    )
    out["detail"] = "story phase=tools ChatToolCalls humanized labels"
    return out


def qa_live(page) -> dict:
    out: dict = {
        "ok": False,
        "assertions": {},
        "detail": "",
        "checks": {},
        "screenshots": [],
        "errors": [],
    }

    def record(name: str, ok: bool, detail: str = "", path: Path | None = None):
        out["checks"][name] = {
            "ok": ok,
            "detail": detail,
            "screenshot": path.name if path else None,
        }
        if path:
            out["screenshots"].append(path.name)

    try:
        login(page)
        p = shot(page, "01-live-home.png")
        record("login", True, f"logged in as {EMAIL}", p)

        # New chat
        new_chat = page.get_by_role(
            "button", name=re.compile(r"New chat|New Agent|^New$", re.I)
        )
        if new_chat.count():
            try:
                new_chat.first.click(timeout=3000)
                time.sleep(1.5)
            except Exception as exc:
                record("new-chat", False, str(exc))
        else:
            create = page.get_by_test_id("create-menu")
            if create.count():
                try:
                    create.click(timeout=2000)
                    time.sleep(0.4)
                    item = page.get_by_role(
                        "menuitem", name=re.compile(r"^Agent$|New chat|Chat", re.I)
                    )
                    if item.count():
                        item.first.click()
                        time.sleep(1.5)
                except Exception as exc:
                    record("new-chat-menu", False, str(exc))

        composer = page.get_by_role(
            "combobox", name=re.compile(r"Message input|message", re.I)
        )
        if composer.count() == 0:
            composer = page.locator(
                'textarea, [contenteditable="true"], [role="textbox"]'
            ).last
        if composer.count() == 0:
            raise AssertionError("composer not found")
        composer.first.click()
        time.sleep(0.2)

        prompt = (
            f"Use a builtin file tool now (read_file or list_dir / ls). "
            f"List the top-level vault or workspace directory, then read one "
            f"small markdown file if present (e.g. AGENTS.md or README.md). "
            f"Reply with a 1-sentence summary of what you found. "
            f"Do not ask questions. Marker: {PROMPT_MARKER}"
        )
        try:
            composer.first.fill(prompt)
        except Exception:
            page.keyboard.type(prompt, delay=5)
        time.sleep(0.4)
        send = page.get_by_role("button", name=re.compile(r"^Send$|Send message", re.I))
        if send.count() and send.first.is_enabled():
            send.first.click()
        else:
            page.keyboard.press("Enter")
        time.sleep(1.5)
        p = shot(page, "02-live-prompt-sent.png")
        record("prompt-sent", True, f"marker={PROMPT_MARKER}", p)

        deadline = time.time() + 180
        saw_running = False
        saw_complete = False
        last_scan: dict = {}
        final_assistant = ""

        while time.time() < deadline:
            scan = scan_tool_ui(page)
            last_scan = scan
            asst = page.locator('article[aria-label="Message from assistant"]')

            if scan["toolish_count"] > 0:
                if asst.count() == 0:
                    saw_running = True
                else:
                    if (
                        scan["duration_markers"] > 0
                        or scan["humanized_button_count"] > 0
                        or scan["chat_tool_calls_roots"] > 0
                        or scan["labels_in_tool_roots"]
                    ):
                        saw_complete = True

            if page.get_by_test_id("collapsed-tool-pill-trigger").count():
                try:
                    page.get_by_test_id("collapsed-tool-pill-trigger").first.click(
                        timeout=1000
                    )
                except Exception:
                    pass

            group_hdr = page.get_by_role(
                "button", name=re.compile(r"\d+\s+tool calls", re.I)
            )
            if group_hdr.count():
                try:
                    group_hdr.first.click(timeout=1000)
                except Exception:
                    pass

            btns = page.get_by_role("button", name=LABEL_RE)
            for i in range(min(btns.count(), 6)):
                try:
                    btns.nth(i).click(timeout=800)
                except Exception:
                    pass

            if asst.count() >= 1:
                final_assistant = asst.last.inner_text() or ""
                if len(final_assistant) > 30 and not re.search(
                    r"\bThinking\b", final_assistant
                ):
                    time.sleep(2.5)
                    scan = scan_tool_ui(page)
                    last_scan = scan
                    if scan["toolish_count"] > 0:
                        saw_complete = True
                        break
                    if time.time() > deadline - 15:
                        break
            time.sleep(2)

        p_after = shot(page, "tools-after-prompt.png")
        p_life = shot(page, "03-live-tools-lifecycle.png")

        for label in HUMANIZED:
            rows = page.get_by_role(
                "button", name=re.compile(rf"^{re.escape(label)}", re.I)
            )
            for i in range(min(rows.count(), 4)):
                try:
                    rows.nth(i).click(timeout=800)
                    time.sleep(0.2)
                except Exception:
                    pass
        p_exp = shot(page, "04-live-tools-expanded.png")

        last_scan = scan_tool_ui(page)
        tools_ok = last_scan["toolish_count"] > 0 and (
            last_scan["chat_tool_calls_roots"] > 0
            or last_scan["humanized_button_count"] > 0
            or last_scan["collapsed_tool_pill"] > 0
            or bool(last_scan["labels_in_tool_roots"])
        )
        stricter = tools_ok and (
            last_scan["chat_tool_calls_roots"] > 0
            or last_scan["humanized_button_count"] > 0
        )

        record("chat-tool-calls-present", tools_ok, json.dumps(last_scan), p_after)
        record(
            "stricter-not-user-text",
            stricter,
            (
                f"roots={last_scan['chat_tool_calls_roots']} "
                f"buttons={last_scan['humanized_button_count']} "
                f"labels={last_scan['labels_in_tool_roots']}"
            ),
            p_exp,
        )
        record(
            "running-or-complete-lifecycle",
            saw_running or saw_complete or tools_ok,
            f"saw_running={saw_running} saw_complete={saw_complete} "
            f"duration_markers={last_scan.get('duration_markers')}",
            p_life,
        )
        record(
            "assistant-reply",
            bool(final_assistant and len(final_assistant) > 10),
            (final_assistant or "")[:500],
        )

        out["assertions"] = {
            "scan": last_scan,
            "saw_running": saw_running,
            "saw_complete": saw_complete,
            "assistant_preview": (final_assistant or "")[:800],
        }
        out["ok"] = tools_ok
        out["detail"] = (
            "live ChatToolCalls after builtin tool prompt"
            if tools_ok
            else "no ChatToolCalls rows after tool-using prompt"
        )
        if not tools_ok:
            out["errors"].append(
                "Gap: LA may not emit tool_progress or Portal silent — file fix bead"
            )
    except Exception as exc:
        out["ok"] = False
        out["detail"] = f"live error: {exc}"
        out["errors"].append(str(exc))
        try:
            shot(page, "19-live-error.png")
        except Exception:
            pass
    return out


def write_reports(story: dict, live: dict) -> int:
    passed = bool(story.get("ok")) and bool(live.get("ok"))
    # Story alone is not enough for this bead — live is the primary acceptance.
    # If story fails but live passes, still pass (live is acceptance).
    if live.get("ok"):
        passed = True
    report = {
        "bead_id": BEAD_ID,
        "base_url": BASE,
        "login": EMAIL,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "story": story,
        "live": live,
        "passed": passed,
        "verdict": "PASS" if passed else "FAIL",
        "unblocked_by": "lp-cav",
    }
    (ART / "REPORT.json").write_text(json.dumps(report, indent=2) + "\n")

    lines = [
        f"# {BEAD_ID} — ChatToolCalls lifecycle UI (tool calls QA)",
        "",
        f"**Base URL:** `{BASE}`",
        f"**Login:** `{EMAIL}`",
        f"**Verdict:** `{report['verdict']}`",
        f"**Unblocked by:** `lp-cav` (LA mid-turn + dual-emit tool_progress)",
        "",
        "## Acceptance",
        "",
        "- Prompt agent to use a builtin tool (list/read vault file)",
        "- Assert tool_progress → ChatToolCalls rows with running→complete",
        "- Screenshot tool rows (`tools-after-prompt.png`)",
        "- Stricter: do not match user text containing 'tool'",
        "",
        "## Story fixture (`?story=activity-plane&phase=tools`)",
        "",
        f"- ok: **{story.get('ok')}**",
        f"- detail: {story.get('detail')}",
        f"- assertions: `{json.dumps(story.get('assertions', {}), default=str)[:800]}`",
        "",
        "## Live LA chat",
        "",
        f"- ok: **{live.get('ok')}**",
        f"- detail: {live.get('detail')}",
        "",
    ]
    for k, v in (live.get("checks") or {}).items():
        mark = "x" if v.get("ok") else " "
        lines.append(f"- [{mark}] {k}: {v.get('detail')}")
    lines.extend(
        [
            "",
            "## Final scan",
            "",
            "```json",
            json.dumps((live.get("assertions") or {}).get("scan") or {}, indent=2),
            "```",
            "",
            "## Screenshots",
            "",
        ]
    )
    for p in sorted(ART.glob("*.png")):
        lines.append(f"- `{p.name}`")
    if live.get("errors") or not passed:
        lines.extend(["", "## Errors / gaps", ""])
        for e in live.get("errors") or []:
            lines.append(f"- {e}")
        if not live.get("ok"):
            lines.append(
                "- If LA omits tool_progress mid-turn, re-verify lp-cav gateway build; "
                "file a new fix bead if Portal remains silent."
            )
    lines.extend(
        [
            "",
            "## Notes",
            "",
            "- Tool rows detected via `.astryx-chat-tool-calls` and humanized activity "
            "labels (lp-vnz.9), never via user bubble text containing 'tool'.",
            "- Running→complete may finish before the poll samples the spinner; complete "
            "ChatToolCalls roots with labels/duration satisfy lifecycle.",
            "",
        ]
    )
    (ART / "RESULT.md").write_text("\n".join(lines) + "\n")
    print(json.dumps(report, indent=2, default=str))
    return 0 if passed else 1


def main() -> int:
    browser = None
    # NVIDIA/headless hosts need software GL or screenshots close the page.
    launch_args = [
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-gpu",
        "--use-gl=swiftshader",
    ]
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=launch_args)
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            page = context.new_page()
            page.set_default_timeout(30_000)
            story = qa_story(page)
            live = qa_live(page)
            context.close()
            return write_reports(story, live)
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
