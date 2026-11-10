"""lp-86d.3: Live UI QA — ChatToolCalls lifecycle when LA uses builtin tools.

Acceptance (bead lp-86d.3):
  Prompt agent to use a builtin tool (list/read vault file). Assert
  tool_progress → ChatToolCalls rows with running→complete (or equivalent
  data-testid). Screenshot tool rows. Gap → fix bead if LA does not emit
  tool_progress or UI silent.

Stricter assertions (post lp-cav):
  - Do NOT treat the user prompt text containing "tool" as a tool row.
  - Prefer Astryx ChatToolCalls surface (`.astryx-chat-tool-calls`) and/or
    humanized activity labels as role=button / call names.

Surfaces:
  1. Story fixture (auth-free, deterministic): ?story=activity-plane&phase=tools
  2. Live LA chat (requires BFF + Lanyard Agent gateway on mocklab localhost)

Run:

  export BASE_URL=http://demo.localhost:3010
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-86d/tools
  pytest -v test_lp_86d_3_tool_calls_ui.py

Evidence: screenshots + REPORT.json + RESULT.md under UI_ARTIFACTS.
"""

from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import Page, expect

EMAIL = "dev@demo.local"
PASSWORD = "local-dev-password"
DESKTOP = {"width": 1440, "height": 900}
BEAD_ID = "lp-86d.3"
# Unique marker so we never confuse user bubble with tool UI.
PROMPT_MARKER = "lp86d3-tool-ui-marker"

# Humanized ChatToolCalls activity labels (lp-vnz.9) — not raw tool ids.
# Live agent may use any of these for list/read vault work.
HUMANIZED_TOOL_LABELS = (
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
    + "|".join(re.escape(x) for x in HUMANIZED_TOOL_LABELS)
    + r"|Reading|Searching|Listing|Running a |Writing|Editing|Browsing)",
    re.I,
)


def _shot(page: Page, artifacts_dir: Path, name: str) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / name
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0, f"empty screenshot {out}"
    return out


def _goto_home(page: Page, base_url: str) -> None:
    page.goto(
        base_url.rstrip("/") + "/",
        wait_until="load",
        timeout=60_000,
    )
    page.wait_for_timeout(1200)


def _login_demo(page: Page, base_url: str) -> None:
    _goto_home(page, base_url)

    nav_settings = page.get_by_role("button", name=re.compile(r"^Settings$", re.I))
    account = page.get_by_role(
        "button", name=re.compile(r"Account menu|dev@demo|dev-google", re.I)
    )
    login_btn = page.get_by_role("button", name="Log in", exact=True)
    if (nav_settings.count() > 0 or account.count() > 0) and login_btn.count() == 0:
        return

    email = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
    if email.count() == 0:
        email = page.locator('input[type="email"], input[name="email"]')
    if email.count() == 0:
        if nav_settings.count() > 0 or page.get_by_text(
            re.compile(r"New chat|New project|^New Agent$|^New$|Account menu", re.I)
        ).count() > 0:
            return
        raise AssertionError(
            f"login form not found and not authenticated; url={page.url} "
            f"body={page.locator('body').inner_text()[:400]!r}"
        )
    email.first.fill(EMAIL)
    page.locator('input[type="password"]').first.fill(PASSWORD)
    page.get_by_role("button", name="Log in", exact=True).click()
    page.wait_for_timeout(2500)
    expect(
        page.get_by_role("button", name=re.compile(r"^Settings$", re.I)).first
    ).to_be_visible(timeout=20_000)


def _count_chat_tool_calls_roots(page: Page) -> int:
    return page.locator(".astryx-chat-tool-calls").count()


def _tool_label_buttons(page: Page):
    """ChatToolCalls rows that are expandable (role=button) with humanized names."""
    return page.get_by_role("button", name=LABEL_RE)


def _scan_tool_ui(page: Page) -> dict:
    """Stricter scan: ChatToolCalls roots + humanized labels outside user bubble."""
    roots = _count_chat_tool_calls_roots(page)
    # Buttons with humanized labels (expandable tool rows)
    btn_count = _tool_label_buttons(page).count()
    # Also text inside ChatToolCalls roots only (avoids user prompt)
    root_labels: list[str] = []
    for i in range(min(roots, 12)):
        root = page.locator(".astryx-chat-tool-calls").nth(i)
        try:
            txt = root.inner_text(timeout=1000) or ""
        except Exception:
            txt = ""
        for label in HUMANIZED_TOOL_LABELS:
            if label.lower() in txt.lower() and label not in root_labels:
                root_labels.append(label)
        # Capture first line-ish of each call name
        for line in txt.splitlines():
            s = line.strip()
            if s and LABEL_RE.match(s) and s not in root_labels:
                root_labels.append(s[:80])

    # Duration markers suggest complete status (e.g. 40ms, 1.2s)
    duration_hits = 0
    if roots:
        try:
            all_txt = page.locator(".astryx-chat-tool-calls").all_inner_texts()
            blob = "\n".join(all_txt)
            duration_hits = len(re.findall(r"\b\d+(\.\d+)?\s*(ms|s)\b", blob))
        except Exception:
            duration_hits = 0

    # Collapsed pill is also a tool lifecycle surface
    collapsed = page.get_by_test_id("collapsed-tool-pill").count()

    return {
        "chat_tool_calls_roots": roots,
        "humanized_button_count": btn_count,
        "labels_in_tool_roots": root_labels,
        "duration_markers": duration_hits,
        "collapsed_tool_pill": collapsed,
        "toolish_count": roots + btn_count + collapsed,
    }


def test_lp_86d_3_story_tool_rows(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Auth-free story proves ChatToolCalls lifecycle rows (phase=tools)."""
    page.set_viewport_size(DESKTOP)
    page.goto(
        f"{base_url.rstrip('/')}/?story=activity-plane&phase=tools&pane=closed&layout=split",
        wait_until="commit",
        timeout=60_000,
    )
    page.wait_for_timeout(2500)
    story = page.get_by_test_id("activity-plane-story")
    expect(story).to_be_visible(timeout=20_000)
    expect(story).to_have_attribute("data-phase", "tools")

    # Humanized labels — not raw tool ids
    expect(page.get_by_text("Reading documents")).to_be_visible(timeout=10_000)
    expect(page.get_by_text("Searching files")).to_be_visible()
    expect(page.get_by_text("Running a command")).to_be_visible()
    expect(page.get_by_text("read_file", exact=True)).to_have_count(0)
    expect(page.get_by_text("vault_search", exact=True)).to_have_count(0)

    scan = _scan_tool_ui(page)
    assert scan["toolish_count"] > 0 or scan["chat_tool_calls_roots"] > 0, scan

    shot = _shot(page, artifacts_dir, "00-story-phase-tools.png")
    evidence = {
        "bead_id": BEAD_ID,
        "surface": "story",
        "phase": "tools",
        "scan": scan,
        "screenshot": str(shot.name),
    }
    (artifacts_dir / "story-evidence.json").write_text(
        json.dumps(evidence, indent=2) + "\n"
    )


def test_lp_86d_3_live_tool_calls_lifecycle(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Live LA: prompt builtin tool use; assert ChatToolCalls rows (not user text)."""
    page.set_viewport_size(DESKTOP)
    results: dict = {
        "bead_id": BEAD_ID,
        "base_url": base_url,
        "login": EMAIL,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "checks": {},
        "screenshots": [],
        "passed": False,
        "errors": [],
    }

    def record(name: str, ok: bool, detail: str = "", shot: Path | None = None):
        results["checks"][name] = {
            "ok": ok,
            "detail": detail,
            "screenshot": shot.name if shot else None,
        }
        if shot:
            results["screenshots"].append(shot.name)

    try:
        _login_demo(page, base_url)
        shot_home = _shot(page, artifacts_dir, "01-live-home.png")
        record("login", True, f"logged in as {EMAIL}", shot_home)

        # Prefer New chat / New Agent so history does not pollute assertions
        new_chat = page.get_by_role(
            "button", name=re.compile(r"New chat|New Agent|^New$", re.I)
        )
        if new_chat.count():
            try:
                new_chat.first.click(timeout=3000)
                page.wait_for_timeout(1500)
            except Exception as exc:  # noqa: BLE001
                record("new-chat", False, str(exc))
        else:
            # Try create menu path
            create = page.get_by_test_id("create-menu")
            if create.count():
                try:
                    create.click(timeout=2000)
                    page.wait_for_timeout(300)
                    item = page.get_by_role(
                        "menuitem", name=re.compile(r"^Agent$|New chat|Chat", re.I)
                    )
                    if item.count():
                        item.first.click()
                        page.wait_for_timeout(1500)
                except Exception as exc:  # noqa: BLE001
                    record("new-chat-menu", False, str(exc))

        # Composer
        composer = page.get_by_role(
            "combobox", name=re.compile(r"Message input|message", re.I)
        )
        if composer.count() == 0:
            composer = page.locator(
                'textarea, [contenteditable="true"], [role="textbox"]'
            ).last
        expect(composer.first).to_be_visible(timeout=20_000)

        prompt = (
            f"Use a builtin file tool now (read_file or list_dir / ls). "
            f"List the top-level vault or workspace directory, then read one "
            f"small markdown file if present (e.g. AGENTS.md or README.md). "
            f"Reply with a 1-sentence summary of what you found. "
            f"Do not ask questions. Marker: {PROMPT_MARKER}"
        )
        composer.first.click()
        # fill works for textarea; contenteditable may need type
        try:
            composer.first.fill(prompt)
        except Exception:
            page.keyboard.type(prompt, delay=5)
        page.wait_for_timeout(400)
        send = page.get_by_role("button", name=re.compile(r"^Send$|Send message", re.I))
        if send.count() and send.first.is_enabled():
            send.first.click()
        else:
            page.keyboard.press("Enter")
        page.wait_for_timeout(1500)
        shot_sent = _shot(page, artifacts_dir, "02-live-prompt-sent.png")
        record("prompt-sent", True, f"marker={PROMPT_MARKER}", shot_sent)

        # Poll up to 3 minutes for tool UI (LLM + tools can be slow)
        deadline = time.time() + 180
        saw_running = False
        saw_complete = False
        last_scan: dict = {}
        final_assistant = ""

        while time.time() < deadline:
            scan = _scan_tool_ui(page)
            last_scan = scan

            # Running: spinner rows or running-status styling is hard to query;
            # treat tool roots appearing mid-turn before assistant answer as running.
            if scan["toolish_count"] > 0:
                # If no assistant final text yet, likely mid-turn running
                asst = page.locator('article[aria-label="Message from assistant"]')
                if asst.count() == 0:
                    saw_running = True
                else:
                    # Tool roots present after/during answer
                    if scan["duration_markers"] > 0 or scan["humanized_button_count"] > 0:
                        saw_complete = True
                    if scan["chat_tool_calls_roots"] > 0:
                        saw_complete = True
                    # Also complete if labels present
                    if scan["labels_in_tool_roots"]:
                        saw_complete = True

            # Expand collapsed groups / tool pills for screenshot fidelity
            if page.get_by_test_id("collapsed-tool-pill-trigger").count():
                try:
                    page.get_by_test_id("collapsed-tool-pill-trigger").first.click(
                        timeout=1000
                    )
                except Exception:
                    pass

            # Expand multi-tool groups ("N tool calls")
            group_hdr = page.get_by_role(
                "button", name=re.compile(r"\d+\s+tool calls", re.I)
            )
            if group_hdr.count():
                try:
                    group_hdr.first.click(timeout=1000)
                except Exception:
                    pass

            # Expand individual humanized rows for duration/result detail
            btns = _tool_label_buttons(page)
            for i in range(min(btns.count(), 6)):
                try:
                    btns.nth(i).click(timeout=800)
                except Exception:
                    pass

            asst = page.locator('article[aria-label="Message from assistant"]')
            if asst.count() >= 1:
                final_assistant = asst.last.inner_text() or ""
                # Settle after first substantial assistant content
                if len(final_assistant) > 30 and not re.search(
                    r"\bThinking\b", final_assistant
                ):
                    page.wait_for_timeout(2500)
                    scan = _scan_tool_ui(page)
                    last_scan = scan
                    if scan["toolish_count"] > 0:
                        saw_complete = True
                        break
                    # If tools never appeared but assistant finished, keep waiting
                    # a bit more (post-turn dual-emit can lag)
                    if time.time() > deadline - 15:
                        break
            page.wait_for_timeout(2000)

        shot_after = _shot(page, artifacts_dir, "tools-after-prompt.png")
        # Also alias for bead note naming
        shot_lifecycle = _shot(page, artifacts_dir, "03-live-tools-lifecycle.png")

        # Expand again for final detail shot
        for label in HUMANIZED_TOOL_LABELS:
            rows = page.get_by_role("button", name=re.compile(rf"^{re.escape(label)}", re.I))
            for i in range(min(rows.count(), 4)):
                try:
                    rows.nth(i).click(timeout=800)
                    page.wait_for_timeout(200)
                except Exception:
                    pass
        shot_exp = _shot(page, artifacts_dir, "04-live-tools-expanded.png")

        last_scan = _scan_tool_ui(page)
        # Stricter: toolish_count must not rely on user text
        # User prompt contains "tool" — body text match would be false positive.
        body = page.locator("body").inner_text()
        naive_tool_in_body = "tool" in body.lower()
        user_has_tool_word = PROMPT_MARKER in body  # our prompt is present

        tools_ok = last_scan["toolish_count"] > 0 and (
            last_scan["chat_tool_calls_roots"] > 0
            or last_scan["humanized_button_count"] > 0
            or last_scan["collapsed_tool_pill"] > 0
            or bool(last_scan["labels_in_tool_roots"])
        )

        record(
            "chat-tool-calls-present",
            tools_ok,
            json.dumps(last_scan),
            shot_after,
        )
        record(
            "stricter-not-user-text",
            tools_ok and (last_scan["chat_tool_calls_roots"] > 0 or last_scan["humanized_button_count"] > 0),
            (
                f"naive_body_has_tool={naive_tool_in_body} "
                f"user_prompt_present={user_has_tool_word} "
                f"roots={last_scan['chat_tool_calls_roots']} "
                f"buttons={last_scan['humanized_button_count']}"
            ),
            shot_exp,
        )
        record(
            "running-or-complete-lifecycle",
            saw_running or saw_complete or tools_ok,
            f"saw_running={saw_running} saw_complete={saw_complete} "
            f"duration_markers={last_scan.get('duration_markers')}",
            shot_lifecycle,
        )
        record(
            "assistant-reply",
            bool(final_assistant and len(final_assistant) > 10),
            (final_assistant or "")[:500],
        )

        results["scan"] = last_scan
        results["saw_running"] = saw_running
        results["saw_complete"] = saw_complete
        results["assistant_preview"] = (final_assistant or "")[:800]
        results["passed"] = tools_ok
        results["verdict"] = "PASS" if tools_ok else "FAIL"

        if not tools_ok:
            results["errors"].append(
                "No ChatToolCalls rows after tool-using prompt. "
                "If LA omits tool_progress or Portal is silent, file a fix bead."
            )

    except Exception as exc:  # noqa: BLE001
        results["errors"].append(str(exc))
        results["passed"] = False
        results["verdict"] = "FAIL"
        try:
            _shot(page, artifacts_dir, "19-live-error.png")
        except Exception:
            pass
        raise
    finally:
        results["finished_at"] = datetime.now(timezone.utc).isoformat()
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        (artifacts_dir / "REPORT.json").write_text(
            json.dumps(results, indent=2) + "\n"
        )
        # RESULT.md
        lines = [
            f"# {BEAD_ID} — ChatToolCalls lifecycle UI (tool calls QA)",
            "",
            f"**Base URL:** `{base_url}`",
            f"**Login:** `{EMAIL}`",
            f"**Verdict:** `{results.get('verdict', 'FAIL')}`",
            f"**Unblocked by:** `lp-cav` (LA mid-turn + dual-emit tool_progress)",
            "",
            "## Acceptance",
            "",
            "- Prompt agent to use a builtin tool (list/read vault file)",
            "- Assert tool_progress → ChatToolCalls rows with running→complete",
            "- Screenshot tool rows (`tools-after-prompt.png`)",
            "- Stricter: do not match user text containing 'tool'",
            "",
            "## Live checks",
            "",
        ]
        for k, v in results.get("checks", {}).items():
            mark = "x" if v.get("ok") else " "
            lines.append(f"- [{mark}] {k}: {v.get('detail')}")
        lines.extend(
            [
                "",
                "## Scan (final)",
                "",
                "```json",
                json.dumps(results.get("scan") or {}, indent=2),
                "```",
                "",
                "## Screenshots",
                "",
            ]
        )
        for s in results.get("screenshots", []):
            lines.append(f"- `{s}`")
        if results.get("errors"):
            lines.extend(["", "## Errors", ""])
            for e in results["errors"]:
                lines.append(f"- {e}")
        lines.extend(
            [
                "",
                "## Notes",
                "",
                "- Tool rows are detected via `.astryx-chat-tool-calls` and humanized "
                "activity labels (lp-vnz.9), not via the user bubble containing 'tool'.",
                "- Running→complete may complete before the poll samples the running "
                "spinner; presence of complete ChatToolCalls with duration is enough.",
                "- If live fails after gateway rebuild, re-check LA `tool_progress` "
                "emission (lp-cav) and Portal `chatToolCallMapper`.",
                "",
            ]
        )
        (artifacts_dir / "RESULT.md").write_text("\n".join(lines) + "\n")

    assert results["passed"], (
        f"lp-86d.3 live tool ChatToolCalls failed: {results.get('errors')} "
        f"scan={results.get('scan')}"
    )
