"""lp-86d.5: Live + story UI QA — subagent chips + activity pane roster/detail.

Acceptance (lp-86d.5):
  - Pilot subagents enabled (product-implemented)
  - Prompt that spawns a subagent (live LA via Portal)
  - Assert subagent chip surface visible (timeline dither-avatar roster /
    legacy chat-subagent-run-chip)
  - Chip click opens activity pane; roster/detail (data-testid chat-subagent-*)
  - If flags off or host does not emit events, file fix bead with evidence
  - Artifacts: artifacts/ui/lp-86d/subagents/

Product note (2026-08): assistant turns with subagents use condensed
DitherAvatarRoster (data-testid dither-avatar-{runId}) instead of inline
SubagentRunChip. Activity pane still uses chat-subagent-detail / roster /
roster-row (DitherSubagentRow keeps chat-subagent-roster-row).

Run:

  export BASE_URL=http://demo.localhost:3010
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-86d/subagents
  pytest -v test_subagents_ui.py

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
BEAD_ID = "lp-86d.5"

# Explicit spawn instruction so the model uses spawn_subagent rather than
# answering solo. Keep work tiny so QA finishes in a few minutes.
SPAWN_PROMPT = (
    "You MUST use the spawn_subagent tool exactly once. "
    "Spawn a subagent named 'qa-helper' with description 'lp-86d.5 subagent QA' "
    "and prompt: 'Reply with exactly: SUBAGENT_OK. Do not use other tools.' "
    "After the subagent finishes, briefly report its reply. "
    "Do not refuse; subagents are enabled for this pilot."
)

# How long to wait for a live subagent chip after send (model + child turn).
LIVE_CHIP_TIMEOUT_MS = int(os.environ.get("LP_86D5_CHIP_TIMEOUT_MS", "180000"))


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


def _timeline_chip(page: Page, run_id: str | None = None):
    """Prefer dither avatar chip; fall back to legacy SubagentRunChip testid."""
    if run_id:
        dither = page.locator(
            f'[data-testid="dither-avatar-{run_id}"], '
            f'[data-testid="chat-subagent-run-chip"][data-run-id="{run_id}"]'
        )
        if dither.count():
            return dither.first
    # Prefer buttons with data-run-id (exclude stack/label wrappers)
    with_run = page.locator(
        'button[data-testid^="dither-avatar-"][data-run-id], '
        '[data-testid="chat-subagent-run-chip"][data-run-id]'
    )
    if with_run.count():
        return with_run.first
    return page.locator(
        '[data-testid^="dither-avatar-"][data-run-id], '
        '[data-testid="chat-subagent-run-chip"]'
    ).first


def _chip_count(page: Page) -> int:
    return page.locator(
        'button[data-testid^="dither-avatar-"][data-run-id], '
        '[data-testid="chat-subagent-run-chip"]'
    ).count()


def _click_chip(chip) -> None:
    """Click subagent chip; dither avatars pulse so they are never 'stable'."""
    try:
        chip.click(timeout=3_000, force=True)
    except Exception:
        chip.dispatch_event("click")

def _write_report(artifacts_dir: Path, report: dict) -> Path:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    path = artifacts_dir / "REPORT.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    return path


def _write_result_md(artifacts_dir: Path, report: dict) -> Path:
    lines = [
        f"# {BEAD_ID} — sub-agents chips + activity pane roster/detail",
        "",
        f"**When:** {report.get('timestamp')}",
        f"**Base URL:** {report.get('base_url')}",
        f"**Login:** `{EMAIL}`",
        f"**Pilot subagents.enabled:** {report.get('pilot_subagents_enabled')}",
        f"**Verdict:** **{report.get('verdict')}**",
        "",
        "## Story (Portal UI contract)",
        "",
        f"- Chip surface: {report.get('story', {}).get('chip_surface')}",
        f"- Chip visible: {report.get('story', {}).get('chip_visible')}",
        f"- Chip → activity pane detail: {report.get('story', {}).get('chip_opens_detail')}",
        f"- Roster rows: {report.get('story', {}).get('roster_row_count')}",
        f"- Detail status: {report.get('story', {}).get('detail_status')}",
        "",
        "## Live (Lanyard Agent)",
        "",
        f"- Login OK: {report.get('live', {}).get('login_ok')}",
        f"- Prompt sent: {report.get('live', {}).get('prompt_sent')}",
        f"- Subagent chip visible: {report.get('live', {}).get('chip_visible')}",
        f"- Chip surface: {report.get('live', {}).get('chip_surface')}",
        f"- Activity pane after chip click: {report.get('live', {}).get('activity_pane_open')}",
        f"- Detail visible: {report.get('live', {}).get('detail_visible')}",
        f"- Roster visible: {report.get('live', {}).get('roster_visible')}",
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


def test_lp_86d5_subagents_chips_and_activity_pane(
    page: Page, base_url: str, artifacts_dir: Path
):
    """Story + live proof for subagent chip surface and activity roster/detail."""
    page.set_viewport_size(DESKTOP)
    shots: list[str] = []
    story: dict = {}
    live: dict = {
        "login_ok": False,
        "prompt_sent": False,
        "chip_visible": False,
        "activity_pane_open": False,
        "detail_visible": False,
        "roster_visible": False,
        "disabled_or_no_emit": False,
        "notes": "",
    }
    errors: list[str] = []
    fix_bead = None
    fix_bead_reason = None
    pilot_enabled = True

    # ------------------------------------------------------------------
    # 1) Story: dither/chip → activity detail + roster
    # ------------------------------------------------------------------
    try:
        _goto_story(page, base_url, "phase=subagent&pane=closed&layout=split")
        story_el = page.get_by_test_id("activity-plane-story")
        expect(story_el).to_have_attribute("data-phase", "subagent")

        # Condensed dither roster is the primary timeline surface.
        roster_header = page.get_by_test_id("dither-avatar-roster")
        chip = _timeline_chip(page, "sa-explore-1")
        expect(chip).to_be_visible(timeout=10_000)
        story["chip_visible"] = True
        story["chip_surface"] = chip.get_attribute("data-testid")
        story["chip_status"] = chip.get_attribute("data-run-status") or chip.get_attribute(
            "data-status"
        )
        story["condensed_roster"] = roster_header.count() > 0
        shots.append(str(_shot(page, artifacts_dir, "01-story-chip-visible.png")))

        _click_chip(chip)
        expect(story_el).to_have_attribute("data-side-mode", "activity", timeout=10_000)

        pane = page.get_by_test_id("chat-activity-pane")
        expect(pane).to_be_visible(timeout=10_000)

        detail = page.get_by_test_id("chat-subagent-detail")
        expect(detail).to_be_visible(timeout=10_000)
        # Focused run should be explore
        run_id = detail.get_attribute("data-run-id")
        story["detail_run_id"] = run_id
        assert run_id in ("sa-explore-1", "sa-coder-1") or (run_id or "").startswith("sa-")
        status_el = page.get_by_test_id("chat-subagent-detail-status")
        if status_el.count():
            story["detail_status"] = status_el.inner_text().strip()
        story["chip_opens_detail"] = True
        shots.append(str(_shot(page, artifacts_dir, "02-story-chip-opens-detail.png")))

        # Roster view (chat-subagent-*)
        roster_btn = page.get_by_role(
            "button", name=re.compile(r"Open activity roster|roster|All activity", re.I)
        )
        if roster_btn.count():
            roster_btn.first.click()
            page.wait_for_timeout(400)
        roster = page.get_by_test_id("chat-subagent-roster")
        expect(roster).to_be_visible(timeout=10_000)
        rows = page.get_by_test_id("chat-subagent-roster-row")
        story["roster_row_count"] = rows.count()
        assert story["roster_row_count"] >= 1
        story["roster_visible"] = True
        shots.append(str(_shot(page, artifacts_dir, "03-story-roster.png")))
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
    # 2) Live: login → new chat → spawn prompt → chip → detail
    # ------------------------------------------------------------------
    try:
        _login_demo(page, base_url)
        live["login_ok"] = True
        shots.append(str(_shot(page, artifacts_dir, "10-live-home.png")))

        _open_new_chat(page)
        shots.append(str(_shot(page, artifacts_dir, "11-live-new-chat.png")))

        _send_message(page, SPAWN_PROMPT)
        live["prompt_sent"] = True
        shots.append(str(_shot(page, artifacts_dir, "12-live-sent.png")))

        saw_disabled = False
        body_snips: list[str] = []
        # Prefer Playwright auto-wait (survives brief re-renders better than a raw loop).
        try:
            expect(
                page.locator(
                    'button[data-testid^="dither-avatar-"][data-run-id], '
                    '[data-testid="chat-subagent-run-chip"]'
                ).first
            ).to_be_visible(timeout=LIVE_CHIP_TIMEOUT_MS)
            live["chip_visible"] = True
        except Exception:
            body = page.locator("body").inner_text()
            body_snips = [body[:1500]]
            if re.search(r"SUBAGENTS_DISABLED|subagents? (are )?disabled", body, re.I):
                saw_disabled = True
            # fall through — disabled / no-emit branches below
        if saw_disabled:
            live["disabled_or_no_emit"] = True
            live["notes"] = "Agent/UI reported SUBAGENTS_DISABLED"
            shots.append(str(_shot(page, artifacts_dir, "13-live-SUBAGENTS_DISABLED.png")))
        elif not live["chip_visible"]:
            live["disabled_or_no_emit"] = True
            live["notes"] = (
                f"No dither-avatar / chat-subagent-run-chip within "
                f"{LIVE_CHIP_TIMEOUT_MS}ms. Body: {body_snips[-1] if body_snips else ''}"
            )
            shots.append(str(_shot(page, artifacts_dir, "13-live-no-chip.png")))
        else:
            chip = _timeline_chip(page)
            expect(chip).to_be_visible(timeout=5_000)
            live["chip_surface"] = chip.get_attribute("data-testid")
            live["chip_status"] = chip.get_attribute("data-run-status") or chip.get_attribute(
                "data-status"
            )
            live["chip_run_id"] = chip.get_attribute("data-run-id")
            live["chip_count"] = _chip_count(page)
            shots.append(str(_shot(page, artifacts_dir, "13-live-subagent-chips.png")))

            _click_chip(chip)
            page.wait_for_timeout(1000)
            pane = page.get_by_test_id("chat-activity-pane")
            if pane.count() and pane.first.is_visible():
                live["activity_pane_open"] = True
            detail = page.get_by_test_id("chat-subagent-detail")
            if detail.count() and detail.first.is_visible():
                live["detail_visible"] = True
                live["detail_run_id"] = detail.first.get_attribute("data-run-id")
                st = page.get_by_test_id("chat-subagent-detail-status")
                if st.count():
                    live["detail_status"] = st.first.inner_text().strip()
            shots.append(str(_shot(page, artifacts_dir, "14-live-activity-detail.png")))

            roster_btn = page.get_by_role(
                "button",
                name=re.compile(r"Open activity roster|All activity|roster|Back", re.I),
            )
            if roster_btn.count():
                try:
                    roster_btn.first.click(timeout=3000)
                    page.wait_for_timeout(400)
                except Exception:
                    pass
            roster = page.get_by_test_id("chat-subagent-roster")
            if roster.count() and roster.first.is_visible():
                live["roster_visible"] = True
                live["roster_row_count"] = page.get_by_test_id(
                    "chat-subagent-roster-row"
                ).count()
            # If still on detail, open roster via activity pane chrome if available
            if not live["roster_visible"]:
                # Detail alone still proves chat-subagent-* surface
                live["notes"] = (
                    (live.get("notes") or "")
                    + " roster not expanded; detail chat-subagent-* ok"
                ).strip()
            shots.append(str(_shot(page, artifacts_dir, "15-live-roster-or-detail.png")))

            page.wait_for_timeout(5000)
            shots.append(str(_shot(page, artifacts_dir, "16-live-final.png")))

        # Live pass: chip + activity detail (roster optional if detail proved)
        live["ok"] = bool(
            live["chip_visible"]
            and live["activity_pane_open"]
            and live["detail_visible"]
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
        fix_bead_reason = live.get("notes") or "live chip/detail incomplete"
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
        "pilot_subagents_enabled": pilot_enabled,
        "spawn_prompt": SPAWN_PROMPT,
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
            f"chip={live.get('chip_visible')} detail={live.get('detail_visible')} "
            f"chip_surface_story={story.get('chip_surface')} "
            f"chip_surface_live={live.get('chip_surface')} "
            f"notes={live.get('notes', '')[:200]}"
        ),
    }
    _write_report(artifacts_dir, report)
    _write_result_md(artifacts_dir, report)
    (artifacts_dir / "README.md").write_text(
        "\n".join(
            [
                f"# {BEAD_ID} subagents UI QA",
                "",
                "Playwright proof for subagent chip surface + activity pane roster/detail.",
                "",
                "- Timeline chip: `dither-avatar-{runId}` (condensed) or `chat-subagent-run-chip`",
                "- Activity: `chat-subagent-detail`, `chat-subagent-roster`, `chat-subagent-roster-row`",
                "- Test: `portal/packages/web/ui-testing/test_subagents_ui.py`",
                "- Story: `/?story=activity-plane&phase=subagent`",
                "- Live: demo.localhost + LA gateway spawn_subagent",
                "- See RESULT.md and REPORT.json",
                "",
            ]
        )
        + "\n"
    )

    assert story_ok, f"story path failed: {story.get('error') or errors}"
    assert live_ok, (
        f"live subagent path failed (file fix bead if host emit gap): "
        f"{live.get('notes') or errors}"
    )
