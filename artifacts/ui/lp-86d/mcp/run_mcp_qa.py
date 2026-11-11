#!/usr/bin/env python3
"""lp-86d.7 standalone live QA — Settings MCP inventory + chat MCP tool indicator.

Acceptance (bead):
  - Settings MCP section: hide if unsupported, OR list host MCP servers when
    advertised (honest empty state is OK when LA has no mcp_servers).
  - When an MCP tool is used in chat, the tool row shows MCP tool name/status.
  - Gaps → file a fix bead (not silent fail).

Run:
  /path/to/ui-testing/.venv/bin/python artifacts/ui/lp-86d/mcp/run_mcp_qa.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

# Local demo default; live MockLab via MOCKLAB_BASE_URL + MOCKLAB_AGENT_* (lp-zuh.14.3).
BASE = (
    os.environ.get("MOCKLAB_BASE_URL")
    or os.environ.get("MCP_QA_BASE_URL")
    or "http://demo.localhost:3010"
).rstrip("/")
EMAIL = (
    os.environ.get("MOCKLAB_AGENT_EMAIL")
    or os.environ.get("MCP_QA_EMAIL")
    or "dev@demo.local"
)
PASSWORD = (
    os.environ.get("MOCKLAB_AGENT_PASSWORD")
    or os.environ.get("MCP_QA_PASSWORD")
    or "local-dev-password"
)
BEAD_ID = "lp-86d.7"
PROMPT_MARKER = "lp86d7-mcp-ui-marker"

# Prefer paths relative to this script (worktree or main checkout).
SCRIPT_DIR = Path(__file__).resolve().parent
# script is at <repo>/artifacts/ui/lp-86d/mcp/
REPO_ROOT = SCRIPT_DIR.parents[3]
ART = SCRIPT_DIR

# Humanized labels the Portal maps from tool names (incl. MCP-qualified bare keys).
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
    "Checking schedule",
    "Scheduling a task",
    "Managing scheduled tasks",
    "Searching tools",
    "Using a tool",
)
LABEL_RE = re.compile(
    r"^("
    + "|".join(re.escape(x) for x in HUMANIZED)
    + r"|Finished |Error in |Reading|Searching|Listing|Running a |Writing|Editing|Browsing|Using |Calling )",
    re.I,
)
MCP_NAME_RE = re.compile(r"\bmcp__[\w.-]+|server__[\w.-]+|search_tool|use_tool", re.I)


def shot(page, name: str) -> Path:
    ART.mkdir(parents=True, exist_ok=True)
    out = ART / name
    page.screenshot(path=str(out), full_page=True)
    assert out.is_file() and out.stat().st_size > 0
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
    page.goto(BASE + "/", wait_until="commit", timeout=60_000)
    time.sleep(2.5)
    login_btn = page.get_by_role("button", name="Log in", exact=True)
    # Modern shell: Agents | Vault | Tools (Settings is under Tools).
    agents = page.get_by_role("button", name=re.compile(r"^Agents$", re.I))
    tools = page.get_by_role("button", name=re.compile(r"^Tools$", re.I))
    if login_btn.count() == 0 and (agents.count() > 0 or tools.count() > 0):
        return
    if login_btn.count() == 0:
        if page.get_by_role(
            "button", name=re.compile(r"New chat|New Agent|^New$", re.I)
        ).count():
            return
    email = page.get_by_role("textbox", name=re.compile(r"Email", re.I))
    if email.count() == 0:
        email = page.locator('input[type="email"], input[name="email"]')
    email.first.fill(EMAIL)
    page.locator('input[type="password"]').first.fill(PASSWORD)
    page.get_by_role("button", name="Log in", exact=True).click()
    time.sleep(3)
    for _ in range(20):
        if page.get_by_role("button", name=re.compile(r"^Agents$", re.I)).count():
            return
        if page.get_by_role("button", name=re.compile(r"^Tools$", re.I)).count():
            return
        if page.get_by_role(
            "button", name=re.compile(r"New chat|New Agent|^New$", re.I)
        ).count():
            return
        time.sleep(0.5)


def open_tools(page) -> None:
    """Open Tools tab (settings inventory: Skills / Workflows / MCP / …)."""
    btn = page.get_by_role("button", name=re.compile(r"^Tools$", re.I))
    if btn.count() == 0:
        tab = page.get_by_role("tab", name=re.compile(r"^Tools$", re.I))
        if tab.count():
            _visible_first(tab).click()
        else:
            page.get_by_text(re.compile(r"^Tools$", re.I)).first.click()
    else:
        _visible_first(btn).click()
    time.sleep(1.5)
    # Wait for Tools sections rail when present
    for _ in range(15):
        if page.get_by_label("Tools sections").count():
            break
        if page.get_by_text("Skills", exact=True).count():
            break
        time.sleep(0.3)


def open_agents(page) -> None:
    btn = page.get_by_role("button", name=re.compile(r"^Agents$", re.I))
    if btn.count():
        _visible_first(btn).click()
        time.sleep(1.0)


def open_new_chat(page) -> None:
    """Open a fresh agent/chat thread via create menu (New Agent → Agent)."""
    open_agents(page)
    # lp-7st.2: New Agent is a dropdown; must pick menuitem Agent
    create_btn = page.get_by_role("button", name=re.compile(r"^New Agent$", re.I))
    if create_btn.count():
        try:
            _visible_first(create_btn).click(timeout=3000)
            time.sleep(0.4)
            item = page.get_by_role("menuitem", name=re.compile(r"^Agent$", re.I))
            if item.count():
                item.first.click(timeout=3000)
                time.sleep(1.2)
                return
            page.keyboard.press("Escape")
            time.sleep(0.2)
        except Exception:
            try:
                page.keyboard.press("Escape")
            except Exception:
                pass

    # Plus create-menu testid fallback
    create = page.get_by_test_id("create-menu")
    if create.count():
        try:
            _visible_first(create).click(timeout=2000)
            time.sleep(0.4)
            item = page.get_by_role(
                "menuitem", name=re.compile(r"^Agent$|New chat|Chat", re.I)
            )
            if item.count():
                item.first.click()
                time.sleep(1.2)
                return
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


def scan_tool_ui(page) -> dict:
    """Scan tool-row chrome only — never the user prompt / assistant prose.

    User messages often *mention* search_tool / use_tool / mcp__; those must
    not count as a tool-use indicator (lp-86d.7 false-positive guard).
    """
    roots = page.locator(".astryx-chat-tool-calls").count()
    btn_count = page.get_by_role("button", name=LABEL_RE).count()
    root_labels: list[str] = []
    mcp_hits: list[str] = []
    raw_blob_parts: list[str] = []
    for i in range(min(roots, 12)):
        root = page.locator(".astryx-chat-tool-calls").nth(i)
        try:
            txt = root.inner_text(timeout=1500) or ""
        except Exception:
            txt = ""
        raw_blob_parts.append(txt)
        for label in HUMANIZED:
            if label.lower() in txt.lower() and label not in root_labels:
                root_labels.append(label)
        for line in txt.splitlines():
            s = line.strip()
            if s and LABEL_RE.match(s) and s not in root_labels:
                root_labels.append(s[:80])
            for m in MCP_NAME_RE.findall(s):
                if m not in mcp_hits:
                    mcp_hits.append(m)
    # Collapsed tool pills / humanized buttons are tool chrome, not body text
    for sel in (
        page.get_by_test_id("collapsed-tool-pill"),
        page.get_by_role("button", name=LABEL_RE),
    ):
        for i in range(min(sel.count(), 12)):
            try:
                t = sel.nth(i).inner_text(timeout=800) or ""
            except Exception:
                t = ""
            if t:
                raw_blob_parts.append(t)
            for m in MCP_NAME_RE.findall(t):
                if m not in mcp_hits:
                    mcp_hits.append(m)
    # Expandable "Finished …" / "Error in …" buttons often carry bare tool ids
    fin_btns = page.get_by_role(
        "button", name=re.compile(r"^(Finished |Error in )", re.I)
    )
    for i in range(min(fin_btns.count(), 12)):
        try:
            t = fin_btns.nth(i).inner_text(timeout=800) or ""
        except Exception:
            t = ""
        if t and t not in root_labels:
            root_labels.append(t[:80])
        for m in MCP_NAME_RE.findall(t):
            if m not in mcp_hits:
                mcp_hits.append(m)
    blob = "\n".join(raw_blob_parts)
    duration_hits = len(re.findall(r"\b\d+(\.\d+)?\s*(ms|s)\b", blob)) if blob else 0
    finished = len(re.findall(r"\bFinished\b", blob, re.I))
    errors = len(re.findall(r"\bError in\b", blob, re.I))
    collapsed = page.get_by_test_id("collapsed-tool-pill").count()
    # Web-search chrome sometimes shows "Searching the web" without mcp__ id —
    # capture as humanized activity only; do NOT treat assistant prose as hits.
    return {
        "chat_tool_calls_roots": roots,
        "humanized_button_count": btn_count,
        "labels_in_tool_roots": root_labels,
        "duration_markers": duration_hits,
        "collapsed_tool_pill": collapsed,
        "finished_labels": finished,
        "error_labels": errors,
        "mcp_name_hits": mcp_hits,
        "toolish_count": roots + btn_count + collapsed + fin_btns.count(),
    }


def fetch_settings_snapshot(page) -> dict:
    resp = page.request.get(BASE + "/api/settings/snapshot")
    out: dict = {"http_status": resp.status}
    try:
        data = resp.json()
    except Exception as exc:
        out["error"] = str(exc)
        out["text"] = (resp.text() or "")[:500]
        return out
    if not isinstance(data, dict):
        out["raw_type"] = type(data).__name__
        return out
    mcp = data.get("mcp_servers") or []
    out.update(
        {
            "source": data.get("source"),
            "backend_home": data.get("backend_home"),
            "mcp_servers": mcp,
            "mcp_count": len(mcp) if isinstance(mcp, list) else None,
            "skills_count": len(data.get("skills") or []),
            "integrations": data.get("integrations"),
            "exported_at": data.get("exported_at"),
        }
    )
    # Redacted write of full inventory (no secrets expected in snapshot)
    redacted = {
        "exported_at": data.get("exported_at"),
        "source": data.get("source"),
        "backend_home": data.get("backend_home"),
        "mcp_servers": mcp,
        "mcp_count": len(mcp) if isinstance(mcp, list) else 0,
        "skills_count": len(data.get("skills") or []),
        "integrations": data.get("integrations"),
        "skill_names": [
            (s.get("name") or s.get("id"))
            for s in (data.get("skills") or [])
            if isinstance(s, dict)
        ][:30],
        "model_count": len(data.get("models") or []),
        "workflow_count": len(data.get("workflows") or []),
        "cron_count": len(data.get("crons") or []),
    }
    (ART / "settings-snapshot-redacted.json").write_text(
        json.dumps(redacted, indent=2) + "\n"
    )
    return out


def qa_settings(page, report: dict) -> dict:
    checks: dict = {}

    def record(name: str, ok: bool, detail: str = "", path: Path | None = None):
        checks[name] = {
            "ok": ok,
            "detail": detail,
            "screenshot": path.name if path else None,
        }
        if path:
            report.setdefault("screenshots", []).append(path.name)

    login(page)
    p_home = shot(page, "01-live-home.png")
    record("login", True, EMAIL, p_home)

    snap = fetch_settings_snapshot(page)
    record(
        "settings-snapshot-api",
        snap.get("http_status") == 200 and snap.get("source") is not None,
        json.dumps(
            {
                "http_status": snap.get("http_status"),
                "source": snap.get("source"),
                "mcp_count": snap.get("mcp_count"),
                "skills_count": snap.get("skills_count"),
            }
        ),
    )
    report["settings_snapshot"] = snap

    open_tools(page)
    p_settings = shot(page, "02-tools-overview.png")
    tools_nav = page.get_by_label("Tools sections")
    body = page.locator("body").inner_text() or ""
    nav_labels = []
    for lab in ("Skills", "Workflows", "MCP", "Models", "Integrations"):
        # Prefer the tools side rail when present
        if tools_nav.count() and tools_nav.get_by_text(lab, exact=True).count():
            nav_labels.append(lab)
        elif re.search(rf"\b{re.escape(lab)}\b", body):
            nav_labels.append(lab)
    mcp_nav = "MCP" in nav_labels
    record(
        "settings-nav-inventory",
        len(nav_labels) >= 1 and tools_nav.count() >= 1,
        f"nav={nav_labels} mcp_nav={mcp_nav} tools_rail={tools_nav.count()}",
        p_settings,
    )

    # Click MCP section if present
    mcp_section_visible = False
    mcp_table_count = 0
    mcp_empty_message = False
    mcp_row_names: list[str] = []
    if mcp_nav:
        # Prefer Tools sections rail
        mcp_btn = (
            tools_nav.get_by_text("MCP", exact=True)
            if tools_nav.count()
            else page.get_by_text("MCP", exact=True)
        )
        if mcp_btn.count() == 0:
            mcp_btn = page.get_by_role("button", name=re.compile(r"^MCP$", re.I))
        if mcp_btn.count():
            try:
                _visible_first(mcp_btn).click(timeout=3000)
                time.sleep(1.2)
            except Exception as exc:
                record("mcp-nav-click", False, str(exc))
        mcp_section_visible = True
        mcp_table_count = page.get_by_test_id("mcp-table").count()
        body2 = page.locator("body").inner_text() or ""
        mcp_empty_message = bool(
            re.search(r"No MCP servers in this snapshot", body2, re.I)
        )
        # Collect names from snapshot when table present
        servers = snap.get("mcp_servers") or []
        if isinstance(servers, list):
            for s in servers:
                if isinstance(s, dict) and s.get("name"):
                    mcp_row_names.append(str(s["name"]))
        p_mcp = shot(page, "03-tools-mcp.png")
        advertised = (snap.get("mcp_count") or 0) > 0
        if advertised:
            # Must list host servers
            listed = mcp_table_count > 0 and len(mcp_row_names) > 0
            # Prefer visible names in UI
            names_in_ui = [n for n in mcp_row_names if n in body2]
            ok = listed and len(names_in_ui) >= 1
            record(
                "mcp-inventory-list",
                ok,
                f"advertised={advertised} table={mcp_table_count} "
                f"names={mcp_row_names} in_ui={names_in_ui}",
                p_mcp,
            )
            mcp_mode = "listed"
        else:
            # Empty inventory: empty message OR still-visible MCP section is honest
            # when settings view is supported (LA always returns mcp_servers: []).
            ok = mcp_section_visible and (mcp_empty_message or mcp_table_count == 0)
            record(
                "mcp-inventory-empty-or-hidden",
                ok,
                f"nav={mcp_nav} empty_msg={mcp_empty_message} "
                f"table={mcp_table_count} api_count={snap.get('mcp_count')}",
                p_mcp,
            )
            mcp_mode = "empty_honest"
    else:
        # Hidden — acceptable when unsupported
        p_hidden = shot(page, "03-tools-mcp-hidden.png")
        record(
            "mcp-section-hidden",
            True,
            "MCP nav not present (hide-if-unsupported path)",
            p_hidden,
        )
        mcp_mode = "hidden"

    report["mcp_settings"] = {
        "mode": mcp_mode,
        "nav_present": mcp_nav,
        "nav_labels": nav_labels,
        "table_count": mcp_table_count,
        "empty_message": mcp_empty_message,
        "api_mcp_count": snap.get("mcp_count"),
        "api_mcp_servers": snap.get("mcp_servers"),
        "row_names": mcp_row_names,
    }

    # Overall settings acceptance: one of hide / list / honest empty
    settings_ok = any(
        checks.get(k, {}).get("ok")
        for k in (
            "mcp-inventory-list",
            "mcp-inventory-empty-or-hidden",
            "mcp-section-hidden",
        )
    )
    record(
        "settings-mcp-acceptance",
        settings_ok,
        f"mode={mcp_mode}",
    )
    return checks


def qa_chat_mcp_indicator(page, report: dict) -> dict:
    checks: dict = {}

    def record(name: str, ok: bool, detail: str = "", path: Path | None = None):
        checks[name] = {
            "ok": ok,
            "detail": detail,
            "screenshot": path.name if path else None,
        }
        if path:
            report.setdefault("screenshots", []).append(path.name)

    # Chat lives under Agents (not legacy Chat top tab).
    open_agents(page)
    open_new_chat(page)
    p_chat = shot(page, "04-live-new-chat.png")
    record("new-chat", True, "opened", p_chat)

    try:
        composer = find_composer(page)
    except Exception as exc:
        record("composer", False, str(exc))
        return checks

    # Prompt designed to:
    # 1) Prefer MCP meta-tools (search_tool) if catalog search is on
    # 2) Otherwise any web/MCP-qualified tool
    # 3) Fall back to a builtin so we still observe tool-row UI plumbing
    prompt = (
        "IMPORTANT: Do not run workflows. Do not call /workflow. "
        "You have meta-tools search_tool and use_tool for MCP/integration tools. "
        "First call search_tool with query 'mcp' (or 'web' / 'search'). "
        "If any MCP-qualified tool name is returned (mcp__… or server__…), "
        "call use_tool on one of them with minimal args. "
        "If the catalog is empty, call a normal web search or a single builtin "
        "list_dir/ls tool once, then stop. Reply with one short sentence "
        "summarizing what tools you found or used. Do not ask questions. "
        f"Marker: {PROMPT_MARKER}"
    )
    composer.click()
    time.sleep(0.2)
    try:
        composer.fill(prompt)
    except Exception:
        page.keyboard.type(prompt, delay=3)
    time.sleep(0.5)
    # Verify prompt is in the input before send
    try:
        val = composer.input_value()
    except Exception:
        try:
            val = composer.inner_text()
        except Exception:
            val = ""
    if PROMPT_MARKER not in (val or ""):
        # contenteditable may not expose input_value — check body after type
        body_pre = page.locator("body").inner_text() or ""
        if PROMPT_MARKER not in body_pre:
            # Force type into focused composer
            composer.click()
            page.keyboard.press("Control+a")
            page.keyboard.type(prompt, delay=2)
            time.sleep(0.3)
    send = page.get_by_role("button", name=re.compile(r"^Send$|Send message", re.I))
    if send.count() and send.first.is_enabled():
        send.first.click()
    else:
        page.keyboard.press("Enter")
    time.sleep(2.0)
    p_sent = shot(page, "05-live-prompt-sent.png")
    body_after = page.locator("body").inner_text() or ""
    sent_ok = PROMPT_MARKER in body_after
    record(
        "prompt-sent",
        sent_ok,
        f"marker={PROMPT_MARKER} visible={sent_ok}",
        p_sent,
    )
    if not sent_ok:
        record(
            "chat-tool-rows-present",
            False,
            "prompt never landed in a fresh chat; abort chat MCP checks",
        )
        record(
            "mcp-tool-name-status-indicator",
            False,
            "skipped — prompt not visible in timeline",
        )
        return checks

    deadline = time.time() + 180
    last_scan: dict = {}
    final_assistant = ""
    saw_tool_ui = False

    while time.time() < deadline:
        scan = scan_tool_ui(page)
        last_scan = scan
        if scan["toolish_count"] > 0:
            saw_tool_ui = True
        # Expand groups / pills
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
        for i in range(min(btns.count(), 8)):
            try:
                btns.nth(i).click(timeout=800)
            except Exception:
                pass
        asst = page.locator('article[aria-label="Message from assistant"]')
        if asst.count() >= 1:
            final_assistant = asst.last.inner_text() or ""
            if len(final_assistant) > 20 and not re.search(
                r"\bThinking\b", final_assistant, re.I
            ):
                time.sleep(2)
                last_scan = scan_tool_ui(page)
                if last_scan["toolish_count"] > 0 or time.time() > deadline - 20:
                    break
        time.sleep(2)

    p_tools = shot(page, "06-live-tool-rows.png")
    # Expand again for final shot
    btns = page.get_by_role("button", name=LABEL_RE)
    for i in range(min(btns.count(), 8)):
        try:
            btns.nth(i).click(timeout=800)
            time.sleep(0.15)
        except Exception:
            pass
    p_exp = shot(page, "07-live-tools-expanded.png")
    last_scan = scan_tool_ui(page)

    tools_ok = last_scan["toolish_count"] > 0 or saw_tool_ui
    record(
        "chat-tool-rows-present",
        tools_ok,
        json.dumps(last_scan),
        p_tools,
    )

    mcp_hits = last_scan.get("mcp_name_hits") or []
    labels = last_scan.get("labels_in_tool_roots") or []
    # Strong signal only from tool chrome (scan_tool_ui never reads user prose):
    # - mcp__ / server__ ids in tool roots / Finished buttons
    # - search_tool / use_tool meta rows
    # - humanized labels that map from MCP-qualified bare keys (web search/browse)
    #   only when tool chrome is present (roots/buttons/pills)
    has_tool_chrome = last_scan.get("toolish_count", 0) > 0
    mcp_indicator = bool(mcp_hits) or (
        has_tool_chrome
        and any(
            re.search(
                r"search_tool|use_tool|mcp__|Searching the web|Browsing the web",
                lab,
                re.I,
            )
            for lab in labels
        )
    )
    record(
        "mcp-tool-name-status-indicator",
        mcp_indicator,
        f"mcp_hits={mcp_hits} labels={labels} toolish={last_scan.get('toolish_count')} "
        f"assistant={(final_assistant or '')[:240]!r}",
        p_exp,
    )
    record(
        "assistant-reply",
        bool(final_assistant and len(final_assistant) > 8),
        (final_assistant or "")[:600],
    )

    report["chat_mcp"] = {
        "scan": last_scan,
        "mcp_indicator": mcp_indicator,
        "assistant_preview": (final_assistant or "")[:800],
        "prompt_marker": PROMPT_MARKER,
    }
    return checks


def write_result(report: dict) -> None:
    checks = report.get("checks") or {}
    settings_ok = bool(checks.get("settings-mcp-acceptance", {}).get("ok"))
    mcp_indicator = bool(checks.get("mcp-tool-name-status-indicator", {}).get("ok"))
    tools_present = bool(checks.get("chat-tool-rows-present", {}).get("ok"))
    login_ok = bool(checks.get("login", {}).get("ok"))

    # Acceptance: settings path always required; MCP chat indicator required when
    # host advertises MCP servers. When inventory is empty (LA has no MCP product
    # surface yet), indicator may fail → gap → fix bead (documented).
    advertised = (report.get("mcp_settings") or {}).get("api_mcp_count") or 0
    if advertised > 0:
        acceptance = settings_ok and mcp_indicator
        verdict = "PASS" if acceptance else "FAIL"
    else:
        # Honest empty inventory: settings acceptance is enough for partial pass;
        # chat MCP indicator is a documented gap when no MCP servers exist.
        acceptance = settings_ok and login_ok
        if mcp_indicator:
            verdict = "PASS"
            acceptance = True
        elif settings_ok:
            verdict = "PASS_PARTIAL_GAP"
        else:
            verdict = "FAIL"
            acceptance = False

    report["passed"] = acceptance and verdict in ("PASS", "PASS_PARTIAL_GAP")
    report["acceptance_met"] = acceptance
    report["verdict"] = verdict
    report["gap"] = {
        "mcp_chat_indicator_unproven": not mcp_indicator,
        "reason": (
            None
            if mcp_indicator
            else (
                "Live host advertises mcp_servers=[] (LA: no MCP product surface "
                "yet per settings.patch). Cannot exercise mcp__* tool rows until "
                "an MCP server is configured on the pilot agent."
            )
        ),
        "fix_bead_recommended": not mcp_indicator,
    }
    report["finished_at"] = datetime.now(timezone.utc).isoformat()

    (ART / "REPORT.json").write_text(json.dumps(report, indent=2) + "\n")

    lines = [
        f"# {BEAD_ID} — MCP servers: settings inventory + tool use indicator",
        "",
        f"**Base URL:** `{BASE}`",
        f"**Login:** `{EMAIL}`",
        f"**Verdict:** `{verdict}`",
        f"**Acceptance met:** `{acceptance}`",
        "",
        "## Settings MCP",
        "",
        f"- Mode: `{(report.get('mcp_settings') or {}).get('mode')}`",
        f"- Nav present: `{(report.get('mcp_settings') or {}).get('nav_present')}`",
        f"- API mcp_count: `{(report.get('mcp_settings') or {}).get('api_mcp_count')}`",
        f"- Empty message: `{(report.get('mcp_settings') or {}).get('empty_message')}`",
        f"- Servers: `{(report.get('mcp_settings') or {}).get('api_mcp_servers')}`",
        "",
        "## Chat MCP tool indicator",
        "",
        f"- Tool rows present: `{tools_present}`",
        f"- MCP name/status indicator: `{mcp_indicator}`",
        f"- Scan: ```json\n{json.dumps((report.get('chat_mcp') or {}).get('scan'), indent=2)}\n```",
        f"- Assistant preview: {(report.get('chat_mcp') or {}).get('assistant_preview')!r}",
        "",
        "## Gap",
        "",
        f"- Unproven chat MCP indicator: `{report['gap']['mcp_chat_indicator_unproven']}`",
        f"- Reason: {report['gap']['reason']}",
        f"- Fix bead recommended: `{report['gap']['fix_bead_recommended']}`",
        "",
        "## Checks",
        "",
    ]
    for name, c in checks.items():
        mark = "x" if c.get("ok") else " "
        lines.append(f"- [{mark}] {name}: {c.get('detail')}")
    lines.extend(
        [
            "",
            "## Screenshots",
            "",
        ]
    )
    for s in report.get("screenshots") or []:
        lines.append(f"- `{s}`")
    lines.append("")
    (ART / "RESULT.md").write_text("\n".join(lines))


def main() -> int:
    ART.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "bead_id": BEAD_ID,
        "base_url": BASE,
        "login": EMAIL,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "checks": {},
        "screenshots": [],
        "errors": [],
    }

    browser = None
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=[
                    "--disable-dev-shm-usage",
                    "--no-sandbox",
                    "--disable-gpu",
                ],
            )
            context = browser.new_context(viewport={"width": 1280, "height": 720})
            # Persist auth for reuse (owner-only path under artifacts/ui/.auth)
            page = context.new_page()
            settings_checks = qa_settings(page, report)
            chat_checks = qa_chat_mcp_indicator(page, report)
            report["checks"] = {**settings_checks, **chat_checks}
            # Save storage state
            auth_dir = REPO_ROOT / "artifacts" / "ui" / ".auth"
            auth_dir.mkdir(parents=True, exist_ok=True)
            auth_path = auth_dir / f"demo-localhost-{BEAD_ID}.json"
            context.storage_state(path=str(auth_path))
            try:
                auth_path.chmod(0o600)
            except Exception:
                pass
            browser.close()
            browser = None
    except Exception as exc:
        report["errors"].append(str(exc))
        report["passed"] = False
        report["acceptance_met"] = False
        report["verdict"] = "ERROR"
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        (ART / "REPORT.json").write_text(json.dumps(report, indent=2) + "\n")
        (ART / "RESULT.md").write_text(
            f"# {BEAD_ID} ERROR\n\n```\n{exc}\n```\n"
        )
        print("ERROR", exc, file=sys.stderr)
        return 2
    finally:
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass

    write_result(report)
    print(json.dumps({"verdict": report.get("verdict"), "acceptance_met": report.get("acceptance_met"), "gap": report.get("gap")}, indent=2))
    return 0 if report.get("passed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
