"""lp-a79.13: headless proof of Astryx table in chat with badge + vault/external links.

Auth-free story route `/?story=table-badge-links` renders ChatMessageContent with
a ```table findings fence (High badge, vault runbook, external Linear ticket).

Requires a live Vite dev server:

  # From packages/web
  pnpm exec vite --port 3022 --host 127.0.0.1

  cd ui-testing
  export BASE_URL=http://127.0.0.1:3022
  # monorepo root artifacts (preferred):
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-a79
  pytest -v test_table_badge_links.py

Screenshot: artifacts/ui/lp-a79/table-badge-links.png
Evidence JSON: artifacts/ui/lp-a79/table-badge-links.json
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import Page, expect

# Documented vault link path (must match findingsTableFixture.ts)
PROJECT_VAULT_PATH = "/home/u/Core"
VAULT_HREF = "docs/runbooks/finding-f12.md"
VAULT_RESOLVED = f"{PROJECT_VAULT_PATH}/{VAULT_HREF}"
EXTERNAL_HREF = "https://linear.app/example/issue/LIN-204"
EXTERNAL_LABEL = "LIN-204"


def test_table_badge_links_in_chat(
    page: Page, base_url: str, artifacts_dir: Path
):
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(
        f"{base_url}/?story=table-badge-links",
        wait_until="networkidle",
        timeout=60_000,
    )

    story = page.get_by_test_id("table-badge-links-proof-story")
    expect(story).to_be_visible(timeout=15_000)
    expect(page.get_by_test_id("table-badge-links-assistant-bubble")).to_be_visible()

    # Astryx PortalTableCard (not plain GFM HTML only)
    card = page.get_by_test_id("portal-table-card")
    expect(card).to_be_visible()
    expect(card).to_have_attribute("data-table-density", "compact")
    expect(page.get_by_test_id("portal-table-title")).to_have_text("Open findings")

    table = card.get_by_role("table")
    expect(table).to_be_visible()
    expect(table.get_by_text("Severity")).to_be_visible()
    expect(table.get_by_text("F-12")).to_be_visible()

    # Categorical badge High
    badges = page.get_by_test_id("portal-table-badge")
    expect(badges.first).to_be_visible()
    expect(page.get_by_text("High", exact=True)).to_be_visible()

    # External ticket
    external = page.get_by_test_id("portal-table-external-link")
    expect(external).to_have_count(1)
    expect(external).to_have_attribute("href", EXTERNAL_HREF)
    expect(external).to_have_attribute("target", "_blank")
    expect(external).to_contain_text(EXTERNAL_LABEL)

    # Vault doc link → click → resolved path logged
    vault_links = page.get_by_test_id("portal-table-vault-link")
    expect(vault_links.first).to_be_visible()
    vault_links.first.click()
    last = page.get_by_test_id("table-badge-links-last-vault-click")
    expect(last).to_have_text(VAULT_RESOLVED)

    # Documented path panel
    expect(page.get_by_test_id("table-badge-links-vault-href")).to_have_text(
        VAULT_HREF
    )
    expect(page.get_by_test_id("table-badge-links-vault-resolved")).to_have_text(
        VAULT_RESOLVED
    )
    expect(page.get_by_test_id("table-badge-links-project-path")).to_have_text(
        PROJECT_VAULT_PATH
    )

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    shot_path = artifacts_dir / "table-badge-links.png"
    page.screenshot(path=str(shot_path), full_page=True)
    assert shot_path.is_file() and shot_path.stat().st_size > 0

    evidence = {
        "bead": "lp-a79.13",
        "story": "table-badge-links",
        "url": f"{base_url}/?story=table-badge-links",
        "screenshot": str(shot_path.name),
        "assertions": {
            "portal_table_card": True,
            "table_role": True,
            "badge_high": True,
            "external_link": EXTERNAL_HREF,
            "vault_href": VAULT_HREF,
            "vault_resolved_path": VAULT_RESOLVED,
            "project_vault_path": PROJECT_VAULT_PATH,
            "vault_click_opened_path": VAULT_RESOLVED,
        },
        "notes": (
            "Astryx Table in chat via ```table fence (ChatMessageContent → "
            "ChatRichCodeBlock → PortalTableCard). Vault links call "
            "onCitationClick with project-joined path; external opens new tab."
        ),
    }
    json_path = artifacts_dir / "table-badge-links.json"
    json_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    assert json_path.is_file()
