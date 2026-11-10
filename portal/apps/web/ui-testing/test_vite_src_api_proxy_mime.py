"""portal-mnn.7: headless proof that /src/api/* modules load as JS (not BFF text/plain).

Requires a live Vite dev server with the reserved-path proxy bypass (phases 2–3).
Set BASE_URL (default http://127.0.0.1:3010). If host :3010 still runs unfixed
Vite, point BASE_URL at a worktree server (e.g. http://127.0.0.1:3016).

Ignore MetaMask ObjectMultiplex console noise — not asserted here.
"""

from __future__ import annotations

import re
from pathlib import Path

from playwright.sync_api import Page, expect

# Module URLs that previously failed with "disallowed MIME type" when proxied to BFF.
SRC_API_MARKERS = (
    "/src/api/client",
    "/src/api/tenantBase",
    "/src/api/auth",
)

MIME_FAIL_RE = re.compile(
    r"disallowed MIME type|Failed to load module script|MIME type.*text/plain",
    re.I,
)


def _is_src_api_url(url: str) -> bool:
    return any(m in url for m in SRC_API_MARKERS)


def test_home_loads_without_src_api_mime_failures(
    page: Page, base_url: str, artifacts_dir: Path, shot, sel
):
    console_msgs: list[str] = []
    page_errors: list[str] = []
    failed_requests: list[tuple[str, int | None, str | None]] = []

    def on_console(msg):
        # Keep text for MIME assertions; MetaMask noise is ignored in checks below.
        console_msgs.append(f"{msg.type}: {msg.text}")

    def on_page_error(exc):
        page_errors.append(str(exc))

    def on_request_failed(req):
        fail = req.failure
        failed_requests.append((req.url, None, fail))

    def on_response(resp):
        url = resp.url
        if not _is_src_api_url(url):
            return
        ct = (resp.headers.get("content-type") or "").lower()
        status = resp.status
        if status >= 400 or "text/plain" in ct:
            failed_requests.append((url, status, ct))

    page.on("console", on_console)
    page.on("pageerror", on_page_error)
    page.on("requestfailed", on_request_failed)
    page.on("response", on_response)

    page.goto(base_url, wait_until="networkidle", timeout=60_000)

    # Named acceptance screenshot
    load_path = artifacts_dir / "load.png"
    page.screenshot(path=str(load_path), full_page=True)
    assert load_path.is_file() and load_path.stat().st_size > 0
    # Also via shot helper for skill-style naming
    shot("load_via_shot")

    assert "chrome-error://" not in page.url

    # No failed loads for /src/api/{client,tenantBase,auth} with MIME/text/plain issues
    bad_src_api = [
        f"{url} status={status} detail={detail}"
        for url, status, detail in failed_requests
        if _is_src_api_url(url)
    ]
    assert not bad_src_api, (
        "Failed or wrong-MIME /src/api module loads:\n" + "\n".join(bad_src_api)
    )

    mime_console = [
        m
        for m in console_msgs
        if MIME_FAIL_RE.search(m) and any(marker in m for marker in SRC_API_MARKERS)
    ]
    # Also catch MIME errors that mention Failed to load module without path in text
    mime_console += [
        m
        for m in console_msgs
        if MIME_FAIL_RE.search(m)
        and m not in mime_console
        and "module" in m.lower()
    ]
    assert not mime_console, "Console MIME/module failures:\n" + "\n".join(mime_console)

    mime_page_errors = [e for e in page_errors if MIME_FAIL_RE.search(e)]
    assert not mime_page_errors, "Page errors with MIME issues:\n" + "\n".join(
        mime_page_errors
    )

    # Meaningful UI: AuthView "Sign in" or non-empty #root/#app
    root = page.locator("#root, #app").first
    body_text = page.locator("body").inner_text(timeout=15_000)

    has_sign_in = False
    try:
        expect(sel("sign_in_heading")).to_be_visible(timeout=15_000)
        has_sign_in = True
    except Exception:
        has_sign_in = "Sign in" in body_text or "sign in" in body_text.lower()

    root_nonempty = False
    try:
        if root.count() > 0:
            html = root.inner_html(timeout=5_000)
            root_nonempty = bool(html and html.strip())
    except Exception:
        root_nonempty = False

    assert has_sign_in or root_nonempty or len(body_text.strip()) > 20, (
        "Page loaded but no meaningful UI (no Sign in / empty shell). "
        f"body snippet={body_text[:200]!r}"
    )


def test_src_api_modules_served_as_javascript(page: Page, base_url: str):
    """Secondary browser-level check: fetch module URLs and assert JS MIME."""
    for rel in (
        "/src/api/client.ts",
        "/src/api/tenantBase.ts",
        "/src/api/auth.ts",
    ):
        resp = page.request.get(f"{base_url}{rel}")
        assert resp.status == 200, f"{rel} status={resp.status}"
        ct = (resp.headers.get("content-type") or "").lower()
        assert "javascript" in ct or "ecmascript" in ct, (
            f"{rel} content-type={ct!r} (expected JS MIME, not text/plain)"
        )
        body = resp.text()
        assert "404" not in body[:80] or "import " in body[:200]
        assert "import " in body or "export " in body, (
            f"{rel} body does not look like a JS/TS module"
        )
