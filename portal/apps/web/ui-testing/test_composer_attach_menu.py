"""lp-khq.5 / lp-khq.6 / lp-khq.7 / lp-khq.12.3 / lp-khq.12.4: headless proof of composer + attach menu.

Auth-free story route `/?story=composer-attach-menu` renders ChatComposer with
+ in the footer (former paperclip slot), root items Attach file / Skills /
Select from vault (folder browse + path insert) / workflow stubs.

Selecting a skill or vault file inserts into the **controlled** composer value.
lp-khq.7: folder drill-in + file insert.
lp-khq.12.3: Attach file root item sets last_action=attach:file.
lp-khq.12.4: no Open vault deep-link control.

Requires a live Vite dev server:

  # From packages/web
  pnpm exec vite --port 3035 --host 127.0.0.1

  cd ui-testing
  export BASE_URL=http://127.0.0.1:3035
  export UI_ARTIFACTS=../../../../artifacts/ui/lp-khq.12.4
  pytest -v test_composer_attach_menu.py

Screenshots under monorepo artifacts/ui/lp-khq.12.4/ (also covers .5 / .6 / .7 / .12.3):
  01-story-root.png
  02-attach-menu-open.png
  03-skills-panel.png
  04-skill-inserted.png
  05-vault-panel-root.png
  06-vault-folder-drill.png
  07-vault-file-inserted.png
  08-attach-file-menu.png
  REPORT.json
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from playwright.sync_api import Page, expect


def test_composer_attach_menu_shell(
    page: Page, base_url: str, artifacts_dir: Path
):
    page.set_viewport_size({"width": 1280, "height": 900})
    page.goto(
        f"{base_url}/?story=composer-attach-menu",
        wait_until="networkidle",
        timeout=60_000,
    )

    story = page.get_by_test_id("composer-attach-menu-proof-story")
    expect(story).to_be_visible(timeout=15_000)
    menu = page.get_by_test_id("composer-attach-menu")
    expect(menu).to_be_visible()
    # 5 fixture skills: 3 with desc + plain-skill + long-desc (lp-khq.6)
    expect(menu).to_have_attribute("data-skill-count", "5")
    # 3 files in fixture tree (lp-khq.7 tree mode)
    expect(menu).to_have_attribute("data-vault-count", "3")
    expect(menu).to_have_attribute("data-vault-mode", "tree")

    value_panel = page.get_by_test_id("composer-attach-menu-value")
    expect(value_panel).to_be_visible()
    expect(value_panel).to_have_attribute("data-value", "")

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(artifacts_dir / "01-story-root.png"), full_page=True)

    trigger = page.get_by_role("button", name="Attach to message")
    expect(trigger).to_be_visible()
    trigger.click()

    # lp-khq.12.3: Attach file is inside + menu (not a standalone paperclip).
    expect(page.get_by_role("menuitem", name="Attach file")).to_be_visible()
    expect(page.get_by_role("menuitem", name="Skills")).to_be_visible()
    expect(page.get_by_role("menuitem", name="Select from vault")).to_be_visible()
    expect(page.get_by_role("menuitem", name="New workflow")).to_have_count(0)
    expect(page.get_by_role("menuitem", name="Workflow wizard")).to_have_count(0)
    page.screenshot(
        path=str(artifacts_dir / "02-attach-menu-open.png"), full_page=True
    )

    page.get_by_role("menuitem", name="Skills").click()
    # Nested panel re-opens after Astryx close-on-click.
    expect(menu).to_have_attribute("data-panel", "skills", timeout=5_000)
    expect(page.get_by_role("menuitem", name="summarize")).to_be_visible()
    expect(
        page.get_by_role("menuitem", name="post-meeting-triage")
    ).to_be_visible()
    # lp-khq.6: one-line descriptions under skill names.
    expect(
        page.get_by_text("Condense long documents into key points")
    ).to_be_visible()
    expect(
        page.get_by_text("Extract actions and owners from meeting notes")
    ).to_be_visible()
    # Name-only skill still listed without a description line requirement.
    expect(page.get_by_role("menuitem", name="plain-skill")).to_be_visible()
    expect(page.get_by_role("menuitem", name="long-desc")).to_be_visible()
    expect(
        page.get_by_text("This is a deliberately long one-line skill description")
    ).to_be_visible()
    page.screenshot(path=str(artifacts_dir / "03-skills-panel.png"), full_page=True)

    page.get_by_role("menuitem", name="summarize").click()
    last = page.get_by_test_id("composer-attach-menu-last-action")
    expect(last).to_have_attribute("data-action", "skill:summarize", timeout=5_000)
    # Controlled value must contain the skill token (not empty).
    expect(value_panel).to_have_attribute("data-value", "/summarize", timeout=5_000)
    expect(value_panel).to_contain_text("/summarize")
    page.screenshot(
        path=str(artifacts_dir / "04-skill-inserted.png"), full_page=True
    )

    # --- lp-khq.7 / lp-khq.12.4: folder browse + path insert (no Open vault) ---
    trigger.click()
    page.get_by_role("menuitem", name="Select from vault").click()
    expect(menu).to_have_attribute("data-panel", "vault", timeout=5_000)
    expect(menu).to_have_attribute("data-vault-browse-path", "/")
    expect(page.get_by_role("menuitem", name="Open vault")).to_have_count(0)
    expect(page.get_by_role("menuitem", name="Business/")).to_be_visible()
    page.screenshot(
        path=str(artifacts_dir / "05-vault-panel-root.png"), full_page=True
    )

    page.get_by_role("menuitem", name="Business/").click()
    expect(menu).to_have_attribute("data-vault-browse-path", "/Business", timeout=5_000)
    # Nested folder still has no Open vault control.
    expect(page.get_by_role("menuitem", name="Open vault")).to_have_count(0)
    page.get_by_role("menuitem", name="Contracts/").click()
    expect(menu).to_have_attribute(
        "data-vault-browse-path", "/Business/Contracts", timeout=5_000
    )
    expect(page.get_by_role("menuitem", name="MSA.docx")).to_be_visible()
    page.screenshot(
        path=str(artifacts_dir / "06-vault-folder-drill.png"), full_page=True
    )

    page.get_by_role("menuitem", name="MSA.docx").click()
    expect(last).to_have_attribute(
        "data-action", "vault:/Business/Contracts/MSA.docx", timeout=5_000
    )
    expect(value_panel).to_have_attribute(
        "data-value",
        "/summarize /Business/Contracts/MSA.docx",
        timeout=5_000,
    )
    expect(value_panel).to_contain_text("/Business/Contracts/MSA.docx")
    page.screenshot(
        path=str(artifacts_dir / "07-vault-file-inserted.png"), full_page=True
    )

    # --- lp-khq.12.3: Attach file from + menu ---
    trigger.click()
    page.get_by_role("menuitem", name="Attach file").click()
    expect(last).to_have_attribute("data-action", "attach:file", timeout=5_000)
    page.screenshot(
        path=str(artifacts_dir / "08-attach-file-menu.png"), full_page=True
    )

    report = {
        "bead": "lp-khq.12.4",
        "also_covers": ["lp-khq.5", "lp-khq.6", "lp-khq.7", "lp-khq.12.3"],
        "story": "composer-attach-menu",
        "base_url": base_url,
        "placement": "footerActions (former paperclip slot)",
        "skill_insert": "skill:summarize",
        "skill_composer_value": "/summarize",
        "skill_descriptions_visible": True,
        "name_only_skill": "plain-skill",
        "vault_mode": "tree",
        "vault_folder_drill": ["/Business", "/Business/Contracts"],
        "vault_insert": "vault:/Business/Contracts/MSA.docx",
        "final_composer_value": "/summarize /Business/Contracts/MSA.docx",
        "open_vault_deeplink_removed": True,
        "attach_file_menu": "attach:file",
        "root_items": [
            "Attach file",
            "Skills",
            "Select from vault",
        ],
        "verdict": "PASS",
    }
    (artifacts_dir / "REPORT.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    assert report["verdict"] == "PASS"
    assert report["final_composer_value"]
    assert report["open_vault_deeplink_removed"] is True
    assert report["attach_file_menu"] == "attach:file"
