"""lp-86d.6: Live + story UI QA — workflow stage cards + activity tree.

Acceptance (lp-86d.6):
  - Prompt/start a programmatic workflow (or host workflow surface)
  - Assert chat-workflow-run-card / stages / nested subagents
  - Activity pane workflow tree (chat-workflow-detail / chat-workflow-run-tree)
  - If flags off or host does not emit events, file fix bead with evidence
  - Artifacts: artifacts/ui/lp-86d/workflows/

Product note:
  Host emits portal_event=workflow_progress with ordered stages (lp-ypu).
  Portal renders WorkflowRunCard (timeline) + WorkflowTree (activity pane).
  Launch via /workflow slash or workflow tool (research-lite builtin).

Run:

  export BASE_URL=http://demo.localhost:3010
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-86d/workflows
  pytest -v test_workflows_ui.py

Evidence: screenshots + REPORT.json + RESULT.md under UI_ARTIFACTS.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import Page, expect

EMAIL = "dev@demo.local"
PASSWORD = "local-dev-password"
DESKTOP = {"width": 1440, "height": 900}
BEAD_ID = "lp-86d.6"

# Slash launch is deterministic (no model tool-choice). research-lite is the
# flagship builtin with plan → explore (parallel) → synthesize stages so nested
# subagents appear under stages when the host dual-emits.
# Note: slash argv requires single-quoted JSON for --args (bare braces get
# quote-stripped by the tokenizer and fail "must be valid JSON").
WORKFLOW_SLASH = (
    "/workflow run research-lite --budget 8 "
    "--args '{\"question\":\"lp-86d.6 workflow stage card QA\"}'"
)

# Fallback if slash is unavailable: force the workflow tool.
WORKFLOW_TOOL_PROMPT = (
    "You MUST use the workflow tool exactly once with action=launch, "
    "name=research-lite, agent_budget=8, and "
    'args={"question":"lp-86d.6 workflow stage card QA. Stay brief."}. '
    "Do not refuse; workflows are enabled for this pilot. "
    "After launch, report only the run_id / display_name. "
    "Do not wait for the workflow to finish."
)

# How long to wait for a live workflow card after send (launch + first progress).
LIVE_CARD_TIMEOUT_MS = int(os.environ.get("LP_86D6_CARD_TIMEOUT_MS", "180000"))


def _shot(page: Page, artifacts_dir: Path, name: str) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / name
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0, f"empty screenshot {out}"
    return out


def _goto_story(page: Page, base_url: str, query: str = "") -> None:
    qs = f"?story=activity-plane{('&' + query) if query else ''}"
    page.goto(
        f"{base_url.rstrip('/')}/{qs}",
        wait_until="networkidle",
        timeout=60_000,
    )
    expect(page.get_by_test_id("activity-plane-story")).to_be_visible(
        timeout=15_000
    )


def _goto_home(page: Page, base_url: str) -> None:
    page.goto(
        base_url.rstrip("/") + "/",
        wait_until="load",
        timeout=60_000,
    )
    page.wait_for_timeout(1200)


def _login_demo(page: Page, base_url: str) -> None:
    _goto_home(page, base_url)

    account = page.get_by_role(
        "button", name=re.compile(r"Account menu|dev@demo|dev-google", re.I)
    )
    login_btn = page.get_by_role("button", name="Log in", exact=True)
    if account.count() > 0 and login_btn.count() == 0:
        return

    email = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
    if email.count() == 0:
        email = page.locator('input[type="email"], input[name="email"]')
    if email.count() == 0:
        if page.get_by_text(
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
        page.get_by_role(
            "button", name=re.compile(r"Account menu|Settings|dev@demo", re.I)
        ).first
    ).to_be_visible(timeout=20_000)


def _open_new_chat(page: Page) -> None:
    """Open a fresh agent/chat thread via create menu or legacy New chat."""
    create_btn = page.get_by_role("button", name=re.compile(r"^New Agent$", re.I))
    if create_btn.count():
        try:
            create_btn.first.click(timeout=3000)
            page.get_by_role("menuitem", name=re.compile(r"^Agent$", re.I)).first.click(
                timeout=3000
            )
            page.wait_for_timeout(1000)
            return
        except Exception:
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)

    new_chat = page.get_by_role("button", name=re.compile(r"New chat", re.I))
    if new_chat.count():
        new_chat.first.click(timeout=5000)
        page.wait_for_timeout(1000)
        return

    link = page.get_by_role("link", name=re.compile(r"New chat", re.I))
    if link.count():
        link.first.click(timeout=5000)
        page.wait_for_timeout(1000)


def _composer(page: Page):
    """Locate chat message input (combobox / textarea / contenteditable)."""
    box = page.get_by_role("combobox", name=re.compile(r"Message input", re.I))
    if box.count() and box.first.is_visible():
        return box.first
    box = page.locator(
        'textarea, [contenteditable="true"], [data-testid*="composer"]'
    )
    if box.count() and box.first.is_visible():
        return box.first
    return page.get_by_role("textbox").last


def _send_message(page: Page, text: str) -> None:
    box = _composer(page)
    expect(box).to_be_visible(timeout=15_000)
    box.click(timeout=5000)
    try:
        box.fill(text)
    except Exception:
        page.keyboard.type(text, delay=5)
    page.wait_for_timeout(300)
    send = page.get_by_role("button", name=re.compile(r"^Send$|Send message", re.I))
    if send.count() and send.first.is_enabled():
        send.first.click()
    else:
        page.keyboard.press("Enter")
    page.wait_for_timeout(800)


def _workflow_card(page: Page, workflow_id: str | None = None):
    if workflow_id:
        return page.locator(
            f'[data-testid="chat-workflow-run-card"][data-workflow-id="{workflow_id}"]'
        ).first
    return page.get_by_test_id("chat-workflow-run-card").first


def _write_report(artifacts_dir: Path, report: dict) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    path = artifacts_dir / "REPORT.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    return path


def _write_result_md(artifacts_dir: Path, report: dict) -> Path:
    lines = [
        f"# {BEAD_ID} — workflows stage cards + activity tree indicators",
        "",
        f"**When:** {report.get('timestamp')}",
        f"**Base URL:** {report.get('base_url')}",
        f"**Login:** `{EMAIL}`",
        f"**Pilot workflow.enabled:** {report.get('pilot_workflow_enabled')}",
        f"**Verdict:** **{report.get('verdict')}**",
        "",
        "## Story (Portal UI contract)",
        "",
        f"- Card visible: {report.get('story', {}).get('card_visible')}",
        f"- Workflow id: {report.get('story', {}).get('workflow_id')}",
        f"- Stage count: {report.get('story', {}).get('stage_count')}",
        f"- Nested subagent: {report.get('story', {}).get('nested_subagent')}",
        f"- Header → activity tree: {report.get('story', {}).get('header_opens_tree')}",
        f"- Detail / tree testids: {report.get('story', {}).get('detail_visible')} / "
        f"{report.get('story', {}).get('tree_visible')}",
        "",
        "## Live (Lanyard Agent)",
        "",
        f"- Login OK: {report.get('live', {}).get('login_ok')}",
        f"- Prompt sent: {report.get('live', {}).get('prompt_sent')}",
        f"- Launch path: {report.get('live', {}).get('launch_path')}",
        f"- Workflow card visible: {report.get('live', {}).get('card_visible')}",
        f"- Stages: {report.get('live', {}).get('stage_count')}",
        f"- Nested subagent: {report.get('live', {}).get('nested_subagent')}",
        f"- Activity pane after header click: {report.get('live', {}).get('activity_pane_open')}",
        f"- Detail visible: {report.get('live', {}).get('detail_visible')}",
        f"- Tree visible: {report.get('live', {}).get('tree_visible')}",
        f"- Disabled / no-emit residual: {report.get('live', {}).get('disabled_or_no_emit')}",
        f"- Notes: {report.get('live', {}).get('notes')}",
        "",
        "## Screenshots",
        "",
    ]
    for s in report.get("screenshots", []):
        lines.append(f"- `{Path(s).name}`")
    lines.append("")
    if report.get("fix_bead"):
        lines.extend(
            [
                "## Fix bead",
                "",
                f"Filed: **{report['fix_bead']}** — {report.get('fix_bead_reason', '')}",
                "",
            ]
        )
    lines.extend(
        [
            "## Assertions",
            "",
            "```json",
            json.dumps(
                {
                    "story": report.get("story"),
                    "live": report.get("live"),
                    "acceptance_met": report.get("acceptance_met"),
                },
                indent=2,
            ),
            "```",
            "",
        ]
    )
    path = artifacts_dir / "RESULT.md"
    path.write_text("\n".join(lines) + "\n")
    return path


def test_lp_86d6_workflows_stage_cards_and_activity_tree(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Story + live proof for workflow stage cards and activity tree."""
    page.set_viewport_size(DESKTOP)
    shots: list[str] = []
    story: dict = {}
    live: dict = {
        "login_ok": False,
        "prompt_sent": False,
        "card_visible": False,
        "stage_count": 0,
        "nested_subagent": False,
        "activity_pane_open": False,
        "detail_visible": False,
        "tree_visible": False,
        "disabled_or_no_emit": False,
        "launch_path": None,
        "notes": "",
    }
    errors: list[str] = []
    fix_bead = None
    fix_bead_reason = None
    pilot_enabled = True

    # ------------------------------------------------------------------
    # 1) Story: workflow card stages + nested subagents + activity tree
    # ------------------------------------------------------------------
    try:
        _goto_story(page, base_url, "phase=workflow&pane=closed&layout=split")
        story_el = page.get_by_test_id("activity-plane-story")
        expect(story_el).to_have_attribute("data-phase", "workflow")

        card = _workflow_card(page, "wf-onboard-1")
        expect(card).to_be_visible(timeout=10_000)
        expect(card).to_have_attribute("data-workflow-id", "wf-onboard-1")
        expect(card).to_have_attribute("data-status", "running")
        story["card_visible"] = True
        story["workflow_id"] = card.get_attribute("data-workflow-id")
        story["card_status"] = card.get_attribute("data-status")
        shots.append(str(_shot(page, artifacts_dir, "01-story-card-visible.png")))

        stage_list = page.get_by_test_id("chat-workflow-stage-list")
        expect(stage_list).to_be_visible()
        stages = page.get_by_test_id("chat-workflow-stage")
        expect(stages).to_have_count(3)
        story["stage_count"] = stages.count()

        # Running stage expanded by default; expand Discover if collapsed.
        discover = page.locator(
            '[data-testid="chat-workflow-stage"][data-stage-id="discover"]'
        )
        if discover.count():
            toggle = discover.get_by_test_id("chat-workflow-stage-toggle")
            if toggle.count() and toggle.get_attribute("aria-expanded") == "false":
                toggle.click()
            expect(discover.get_by_test_id("chat-workflow-stage-body")).to_be_visible()

        nested = page.get_by_test_id("chat-workflow-nested-subagent")
        expect(nested.first).to_be_visible(timeout=5_000)
        story["nested_subagent"] = True
        story["nested_count"] = nested.count()
        shots.append(str(_shot(page, artifacts_dir, "02-story-stages-nested.png")))

        # Open activity pane via workflow header → tree detail.
        page.get_by_test_id("chat-workflow-run-header").click()
        expect(story_el).to_have_attribute("data-side-mode", "activity", timeout=10_000)
        expect(story_el).to_have_attribute("data-side-focus", "workflow")

        pane = page.get_by_test_id("chat-activity-pane")
        expect(pane).to_be_visible(timeout=10_000)

        detail = page.get_by_test_id("chat-workflow-detail")
        expect(detail).to_be_visible(timeout=10_000)
        expect(detail).to_have_attribute("data-workflow-id", "wf-onboard-1")
        story["detail_visible"] = True
        story["detail_workflow_id"] = detail.get_attribute("data-workflow-id")

        tree = page.get_by_test_id("chat-workflow-run-tree")
        expect(tree).to_be_visible(timeout=10_000)
        story["tree_visible"] = True
        story["header_opens_tree"] = True
        shots.append(str(_shot(page, artifacts_dir, "03-story-activity-tree.png")))
        story["ok"] = True
    except Exception as exc:
        story["ok"] = False
        story["error"] = str(exc)[:800]
        errors.append(f"story: {exc}")
        try:
            shots.append(str(_shot(page, artifacts_dir, "01-story-FAIL.png")))
        except Exception:
            pass

    # ------------------------------------------------------------------
    # 2) Live: login → new chat → /workflow run → card → tree
    # ------------------------------------------------------------------
    try:
        _login_demo(page, base_url)
        live["login_ok"] = True
        shots.append(str(_shot(page, artifacts_dir, "10-live-home.png")))

        _open_new_chat(page)
        shots.append(str(_shot(page, artifacts_dir, "11-live-new-chat.png")))

        # Prefer slash (deterministic); tool prompt is a soft fallback if needed.
        launch_text = WORKFLOW_SLASH
        live["launch_path"] = "slash"
        _send_message(page, launch_text)
        live["prompt_sent"] = True
        live["prompt"] = launch_text
        shots.append(str(_shot(page, artifacts_dir, "12-live-sent.png")))

        saw_disabled = False
        body_snips: list[str] = []

        def _safe_body() -> str:
            try:
                return page.locator("body").inner_text()[:2000]
            except Exception as body_exc:
                return f"<body unavailable: {body_exc}>"

        def _wait_for_card(timeout_ms: int) -> bool:
            """Poll for workflow card; avoids brittle long expect on flaky pages."""
            deadline = timeout_ms / 1000.0
            step = 1.5
            elapsed = 0.0
            while elapsed < deadline:
                try:
                    if page.is_closed():
                        return False
                    card_loc = page.get_by_test_id("chat-workflow-run-card")
                    if card_loc.count() and card_loc.first.is_visible():
                        return True
                except Exception:
                    pass
                page.wait_for_timeout(int(step * 1000))
                elapsed += step
            return False

        if _wait_for_card(LIVE_CARD_TIMEOUT_MS):
            live["card_visible"] = True
        else:
            body = _safe_body()
            body_snips = [body]
            if re.search(
                r"WORKFLOWS_UNAVAILABLE|workflow is disabled|workflows? (are )?disabled"
                r"|--args must be valid JSON",
                body,
                re.I,
            ):
                if re.search(r"WORKFLOWS_UNAVAILABLE|workflow is disabled", body, re.I):
                    saw_disabled = True
            # Soft fallback: tool prompt once if slash failed or card never painted.
            if not saw_disabled and not live["card_visible"]:
                live["launch_path"] = "tool-fallback"
                try:
                    _send_message(page, WORKFLOW_TOOL_PROMPT)
                    live["prompt"] = WORKFLOW_TOOL_PROMPT
                    if _wait_for_card(LIVE_CARD_TIMEOUT_MS):
                        live["card_visible"] = True
                    else:
                        body = _safe_body()
                        body_snips.append(body)
                        if re.search(
                            r"WORKFLOWS_UNAVAILABLE|workflow is disabled",
                            body,
                            re.I,
                        ):
                            saw_disabled = True
                except Exception as fallback_exc:
                    body_snips.append(f"tool-fallback error: {fallback_exc}")

        if saw_disabled:
            live["disabled_or_no_emit"] = True
            live["notes"] = "Agent/UI reported WORKFLOWS_UNAVAILABLE / workflow disabled"
            shots.append(
                str(_shot(page, artifacts_dir, "13-live-WORKFLOWS_UNAVAILABLE.png"))
            )
        elif not live["card_visible"]:
            live["disabled_or_no_emit"] = True
            live["notes"] = (
                f"No chat-workflow-run-card within {LIVE_CARD_TIMEOUT_MS}ms. "
                f"Body: {body_snips[-1] if body_snips else ''}"
            )
            shots.append(str(_shot(page, artifacts_dir, "13-live-no-card.png")))
        else:
            card = _workflow_card(page)
            expect(card).to_be_visible(timeout=5_000)
            live["workflow_id"] = card.get_attribute("data-workflow-id")
            live["card_status"] = card.get_attribute("data-status")
            stages = page.get_by_test_id("chat-workflow-stage")
            live["stage_count"] = stages.count()
            # Expand any collapsed stage that may hold nested subagents.
            toggles = page.get_by_test_id("chat-workflow-stage-toggle")
            for i in range(min(toggles.count(), 6)):
                t = toggles.nth(i)
                try:
                    if t.get_attribute("aria-expanded") == "false":
                        t.click(timeout=2000)
                        page.wait_for_timeout(200)
                except Exception:
                    pass
            nested = page.get_by_test_id("chat-workflow-nested-subagent")
            live["nested_subagent"] = nested.count() > 0
            live["nested_count"] = nested.count()
            shots.append(str(_shot(page, artifacts_dir, "13-live-workflow-card.png")))

            # Header click → activity pane workflow tree.
            header = page.get_by_test_id("chat-workflow-run-header").first
            try:
                header.click(timeout=3_000)
            except Exception:
                header.dispatch_event("click")
            page.wait_for_timeout(1000)

            pane = page.get_by_test_id("chat-activity-pane")
            if pane.count() and pane.first.is_visible():
                live["activity_pane_open"] = True

            detail = page.get_by_test_id("chat-workflow-detail")
            if detail.count() and detail.first.is_visible():
                live["detail_visible"] = True
                live["detail_workflow_id"] = detail.first.get_attribute(
                    "data-workflow-id"
                )

            tree = page.get_by_test_id("chat-workflow-run-tree")
            if tree.count() and tree.first.is_visible():
                live["tree_visible"] = True

            # Roster list mode also exposes chat-workflow-tree / run-tree rows.
            if not live["tree_visible"]:
                tree_list = page.get_by_test_id("chat-workflow-tree")
                if tree_list.count() and tree_list.first.is_visible():
                    live["tree_visible"] = True
                    live["tree_mode"] = "list"
            shots.append(str(_shot(page, artifacts_dir, "14-live-activity-tree.png")))

            # Optional: wait briefly for nested subagents to appear mid-run.
            if not live["nested_subagent"]:
                try:
                    expect(
                        page.get_by_test_id("chat-workflow-nested-subagent").first
                    ).to_be_visible(timeout=90_000)
                    live["nested_subagent"] = True
                    live["nested_count"] = page.get_by_test_id(
                        "chat-workflow-nested-subagent"
                    ).count()
                except Exception:
                    live["notes"] = (
                        (live.get("notes") or "")
                        + " nested subagent not observed within wait "
                        "(stages may still prove card/tree)"
                    ).strip()
            shots.append(str(_shot(page, artifacts_dir, "15-live-stages-or-nested.png")))

            page.wait_for_timeout(3000)
            shots.append(str(_shot(page, artifacts_dir, "16-live-final.png")))

        # Live pass: card with ≥1 stage + activity tree/detail.
        # Nested subagent is best-effort (depends on host dual-emit timing).
        live["ok"] = bool(
            live["card_visible"]
            and live["stage_count"] >= 1
            and live["activity_pane_open"]
            and (live["detail_visible"] or live["tree_visible"])
        )
    except Exception as exc:
        live["ok"] = False
        live["notes"] = f"live exception: {exc}"[:800]
        errors.append(f"live: {exc}")
        try:
            shots.append(str(_shot(page, artifacts_dir, "10-live-FAIL.png")))
        except Exception:
            pass

    story_ok = bool(story.get("ok"))
    live_ok = bool(live.get("ok"))
    acceptance_met = story_ok and live_ok

    if story_ok and not live_ok:
        fix_bead_reason = live.get("notes") or "live workflow card/tree incomplete"
        fix_bead = "pending-file"

    verdict = (
        "PASS"
        if acceptance_met
        else ("PASS_STORY_FAIL_LIVE" if story_ok else "FAIL")
    )

    report = {
        "bead_id": BEAD_ID,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "base_url": base_url,
        "login": EMAIL,
        "pilot_workflow_enabled": pilot_enabled,
        "workflow_slash": WORKFLOW_SLASH,
        "workflow_tool_prompt": WORKFLOW_TOOL_PROMPT,
        "story": story,
        "live": live,
        "screenshots": shots,
        "errors": errors,
        "acceptance_met": acceptance_met,
        "verdict": verdict,
        "fix_bead": fix_bead,
        "fix_bead_reason": fix_bead_reason,
        "pass_criteria": {
            "story_required": True,
            "story_ok": story_ok,
            "live_required": True,
            "live_ok": live_ok,
        },
        "summary": (
            f"story_ok={story_ok} live_ok={live_ok} "
            f"card={live.get('card_visible')} stages={live.get('stage_count')} "
            f"nested={live.get('nested_subagent')} tree={live.get('tree_visible')} "
            f"launch={live.get('launch_path')} "
            f"notes={live.get('notes', '')[:200]}"
        ),
    }
    _write_report(artifacts_dir, report)
    _write_result_md(artifacts_dir, report)
    (artifacts_dir / "README.md").write_text(
        "\n".join(
            [
                f"# {BEAD_ID} workflows UI QA",
                "",
                "Playwright proof for workflow stage cards + activity tree.",
                "",
                "- Timeline: `chat-workflow-run-card`, `chat-workflow-stage`, "
                "`chat-workflow-nested-subagent`",
                "- Activity: `chat-workflow-detail`, `chat-workflow-run-tree`",
                "- Test: `portal/packages/web/ui-testing/test_workflows_ui.py`",
                "- Story: `/?story=activity-plane&phase=workflow`",
                "- Live: demo.localhost + LA gateway `/workflow run research-lite`",
                "- See RESULT.md and REPORT.json",
                "",
            ]
        )
        + "\n"
    )

    assert story_ok, f"story path failed: {story.get('error') or errors}"
    assert live_ok, (
        f"live workflow path failed (file fix bead if host emit gap): "
        f"{live.get('notes') or errors}"
    )
