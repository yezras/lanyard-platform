#!/usr/bin/env python3
"""lp-xhf4.8 UI proof: chat Connect wizard + Connectors page.

Prefers the auth-free story (`?story=connector-chat-wizard`) so the
Connectors catalog and chat wizard can be exercised without a live
Google consent. Set BASE_URL to a Portal origin that serves the SPA.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
OUT = ROOT
BASE_URL = os.environ.get("BASE_URL", "http://demo.localhost:3010").rstrip("/")
STORY = f"{BASE_URL}/?story=connector-chat-wizard"
VIEWPORT = {"width": 1280, "height": 720}


def fail(failures: list[str], cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)


def main() -> int:
    failures: list[str] = []
    report: dict[str, object] = {"story": STORY, "failures": failures}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport=VIEWPORT)
        page.goto(STORY, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_selector("[data-testid='cc-wizard-proof-story']", timeout=15_000)
        page.screenshot(path=str(OUT / "01-wizard-and-connectors.png"))
        fail(
            failures,
            page.get_by_role("button", name="Connect Google").count() >= 1,
            "missing Connect Google in chat wizard",
        )
        fail(
            failures,
            page.locator("[data-testid='connectors-page']").count() == 1,
            "missing Connectors page",
        )
        fail(
            failures,
            page.locator("[data-testid='cc-wizard-step']").inner_text() == "needs_auth",
            "wizard did not start at needs_auth",
        )
        page.get_by_role("button", name="Connect Google").first.click()
        page.wait_for_timeout(200)
        fail(
            failures,
            page.locator("[data-testid='cc-wizard-step']").inner_text() == "waiting_oauth",
            "Connect did not wait for OAuth",
        )
        page.get_by_role("button", name="Simulate OAuth success").click()
        page.wait_for_timeout(200)
        resume = page.locator("[data-testid='cc-wizard-resume']").inner_text()
        fail(failures, "drafts create" in resume, f"resume was not drafts.create: {resume}")
        fail(failures, "messages send" not in resume, f"resume replayed send: {resume}")
        page.screenshot(path=str(OUT / "02-resumed-draft.png"))
        browser.close()
    OUT.joinpath("REPORT.json").write_text(json.dumps(report, indent=2) + "\n")
    if failures:
        print("FAIL", *failures, sep="\n")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
