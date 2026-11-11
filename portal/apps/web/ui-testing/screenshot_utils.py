"""Stable Playwright screenshot helpers for UI-QA gates."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page


def stable_page_screenshot(
    page: Page,
    path: Path | str,
    *,
    full_page: bool = True,
    retries: int = 3,
    clip: dict[str, float] | None = None,
) -> Path:
    """Capture a page screenshot with retry and full_page fallback.

    Playwright occasionally raises Protocol error (Page.captureScreenshot)
    for full_page captures even when the page is fully loaded and layout
    asserts pass. Prefer retrying, then fall back to a viewport (or clip)
    capture so UI-QA gates stay green without losing proof artifacts.
    """
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    last_err: BaseException | None = None

    # Attempt order: requested full_page first (if any), then viewport, then clip.
    modes: list[dict[str, Any]] = []
    if full_page:
        modes.append({"full_page": True})
    modes.append({"full_page": False})
    if clip is not None:
        modes.append({"clip": clip})

    for attempt in range(max(1, retries)):
        for kwargs in modes:
            try:
                page.screenshot(path=str(out), **kwargs)
                if out.is_file() and out.stat().st_size > 0:
                    return out
            except PlaywrightError as exc:
                last_err = exc
                msg = str(exc).lower()
                # Only absorb capture protocol failures; re-raise other errors.
                if "screenshot" not in msg and "capture" not in msg:
                    raise
            except OSError as exc:
                last_err = exc
        if attempt + 1 < retries:
            time.sleep(0.2 * (attempt + 1))

    if last_err is not None:
        raise last_err
    raise RuntimeError(f"screenshot produced empty file: {out}")
