"""Pytest fixtures for headless Playwright UI tests (@lanyard/web)."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import pytest
import yaml
from playwright.sync_api import Locator, Page

from screenshot_utils import stable_page_screenshot

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[2]
SELECTORS_PATH = ROOT / "selectors.yaml"
DEFAULT_BASE_URL = "http://127.0.0.1:3010"
DEFAULT_VIEWPORT = {"width": 1280, "height": 720}


def _parse_viewport(raw: str | None) -> dict[str, int]:
    if not raw:
        return dict(DEFAULT_VIEWPORT)
    m = re.fullmatch(r"(\d+)x(\d+)", raw.strip())
    if not m:
        return dict(DEFAULT_VIEWPORT)
    return {"width": int(m.group(1)), "height": int(m.group(2))}


def load_selector_table(path: Path = SELECTORS_PATH) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text()) or {}
    if "selectors" in data:
        return data["selectors"] or {}
    return data


def resolve_locator(page: Page, entry: Any) -> Locator:
    """Turn a map value into a Playwright Locator."""
    if isinstance(entry, str):
        return page.locator(entry)
    if not isinstance(entry, dict):
        raise TypeError(f"Unsupported selector entry: {entry!r}")
    if "testid" in entry:
        return page.get_by_test_id(str(entry["testid"]))
    if "role" in entry:
        kwargs: dict[str, Any] = {}
        if "name" in entry:
            kwargs["name"] = entry["name"]
        return page.get_by_role(str(entry["role"]), **kwargs)
    if "label" in entry:
        return page.get_by_label(str(entry["label"]))
    if "text" in entry:
        return page.get_by_text(str(entry["text"]))
    if "css" in entry:
        return page.locator(str(entry["css"]))
    raise KeyError(f"Selector entry missing known keys: {entry!r}")


@pytest.fixture(scope="session")
def base_url() -> str:
    return os.environ.get("BASE_URL", DEFAULT_BASE_URL).rstrip("/")


@pytest.fixture(scope="session")
def selectors() -> dict[str, Any]:
    return load_selector_table()


@pytest.fixture(scope="session")
def artifacts_dir() -> Path:
    env = os.environ.get("UI_ARTIFACTS")
    if env:
        path = Path(env)
    else:
        path = REPO_ROOT / "artifacts" / "ui" / "vite-src-api-proxy-mime"
    path.mkdir(parents=True, exist_ok=True)
    return path


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args: dict) -> dict:
    args = dict(browser_context_args)
    args["viewport"] = _parse_viewport(os.environ.get("UI_VIEWPORT"))
    storage = os.environ.get("UI_STORAGE_STATE")
    if storage and Path(storage).is_file():
        # lp-p37.13: ensure existing auth-state stays owner-only when reused.
        try:
            from secure_paths import secure_secret_path

            secure_secret_path(storage)
        except Exception:
            pass
        args["storage_state"] = storage
    return args


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args: dict) -> dict:
    """Stable headless Chromium on NVIDIA / aarch64 hosts (lp-86d.3).

    Without software GL, Playwright can fail screenshots with
    ``Unable to capture screenshot`` or close the page mid-wait.
    Override with ``PW_CHROMIUM_ARGS`` (space-separated) if needed.
    """
    args = dict(browser_type_launch_args)
    extra = os.environ.get("PW_CHROMIUM_ARGS")
    if extra:
        launch = extra.split()
    else:
        launch = [
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--disable-gpu",
            "--use-gl=swiftshader",
        ]
    existing = list(args.get("args") or [])
    for flag in launch:
        if flag not in existing:
            existing.append(flag)
    args["args"] = existing
    return args


@pytest.fixture
def sel(page: Page, selectors: dict[str, Any]):
    def _sel(key: str) -> Locator:
        if key not in selectors:
            raise KeyError(
                f"Unknown selector key {key!r}. "
                f"Known: {sorted(selectors)}"
            )
        return resolve_locator(page, selectors[key])

    return _sel


@pytest.fixture
def shot(page: Page, artifacts_dir: Path):
    def _shot(
        name: str,
        full_page: bool = True,
        *,
        clip: dict[str, float] | None = None,
    ) -> Path:
        safe = re.sub(r"[^\w.\-]+", "_", name).strip("_")
        if not safe.endswith(".png"):
            safe = f"{safe}.png"
        out = artifacts_dir / safe
        return stable_page_screenshot(
            page, out, full_page=full_page, clip=clip
        )

    return _shot
