#!/usr/bin/env python3
"""parse_document host tool — local AnyDoc + cost-gated Firecrawl Parse OCR.

Normative monorepo **reference** for Hermes-Lanyard (Python first) and Lanyard
Agent (port the same shape). Implements the locked F2 contract:

  docs/architecture/portal-parse-document-f2-tool-contract.md

F3 (lp-uxy.10.4): local ``firecrawl-anydoc`` path, ACL, dual-emit, sidecar.
F5 (lp-uxy.10.6): optional scanned-PDF escalation to Firecrawl Parse hosted
OCR — only when policy + live ``FIRECRAWL_API_KEY``; fail closed otherwise.
Never call paid OCR from Portal BFF; never commit real keys.

This module is intentionally host-framework agnostic:

* Path ACL, truncation, sidecar, and result shape live here.
* Dual-emit ``tool_progress`` is surfaced via an optional progress callback;
  hosts wire it to Portal ``portal_event: tool_progress`` (running → complete/error).
* Local converter is ``firecrawl-anydoc`` (``import anydoc``) when available;
  inject ``to_markdown_bytes`` for offline unit tests.
* OCR client is stdlib HTTP to ``POST /v2/parse``; inject ``firecrawl_parse`` for
  offline tests (no live paid calls in monorepo CI).

Copy / adapt into external product trees as ``tools/parse_document`` (or a
skills-pack wrapper that registers the same tool id + alias). Do **not** invent
a second Args/Result shape.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import stat
import uuid
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping, Optional, Sequence

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Contract constants (locked F2)
# ---------------------------------------------------------------------------

TOOL_NAME = "parse_document"
TOOL_ALIAS = "extract_document_text"
TOOL_LABEL = "Parsing a document"

DEFAULT_MAX_CHARS = 48_000
MAX_CHARS_MIN = 1_000
MAX_CHARS_MAX = 200_000
DEFAULT_MAX_SOURCE_BYTES = 25 * 1024 * 1024  # 25 MiB — DEFAULT_STAGING_MAX_UPLOAD_BYTES
DEFAULT_STAGING_ROOT = "/staging/uploads"

PARSER_ANYDOC = "anydoc"
PARSER_FIRECRAWL_PARSE = "firecrawl_parse"
PARSER_PDFTOTEXT = "pdftotext"
PARSER_FOCR = "focr"

ERROR_UNSUPPORTED_SCANNED = "unsupported_scanned"
ERROR_PATH_DENIED = "path_denied"
ERROR_TOO_LARGE = "too_large"
ERROR_NO_OCR_KEY = "no_ocr_key"
ERROR_UNSUPPORTED_FORMAT = "unsupported_format"
ERROR_PARSE_FAILED = "parse_failed"

DEFAULT_FIRECRAWL_API_BASE = "https://api.firecrawl.dev/v2"
# Git/SM placeholders must never enable paid OCR (lp-uxy.7 + F5 cost gate).
_PLACEHOLDER_KEY_FRAGMENTS = (
    "placeholder",
    "unused",
    "replace-me",
    "replace_me",
    "your-api-key",
    "your_api_key",
    "example",
    "changeme",
    "todo",
)

ProgressCallback = Callable[[Mapping[str, Any]], None]
ToMarkdownBytes = Callable[[bytes, Optional[str]], str]
# firecrawl_parse(data, *, filename, content_type, api_key, api_base) -> markdown str
FirecrawlParseFn = Callable[..., str]


# ---------------------------------------------------------------------------
# Result helpers
# ---------------------------------------------------------------------------


def _empty_result(
    *,
    format_token: str = "unknown",
    parser: Optional[str] = None,
    error_code: str,
    error_message: str,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "markdown": "",
        "format": format_token,
        "chars": 0,
        "truncated": False,
        "error_code": error_code,
        "error_message": error_message,
    }
    if parser is not None:
        out["parser"] = parser
    return out


def clamp_max_chars(value: Any) -> int:
    """Clamp max_chars to F2 range; default 48000 when missing/invalid."""
    if value is None or value is False:
        return DEFAULT_MAX_CHARS
    try:
        n = int(value)
    except (TypeError, ValueError):
        return DEFAULT_MAX_CHARS
    if n < MAX_CHARS_MIN:
        return MAX_CHARS_MIN
    if n > MAX_CHARS_MAX:
        return MAX_CHARS_MAX
    return n


def truncate_markdown(full: str, max_chars: int) -> tuple[str, bool]:
    """Pure code-point slice (Python str indexing); no truncation marker (v1)."""
    if len(full) <= max_chars:
        return full, False
    return full[:max_chars], True


def sidecar_path_for(source: Path) -> Path:
    """``report.pdf`` → ``report.parse.md`` (last extension only)."""
    stem = source.name
    if "." in stem:
        stem = stem.rsplit(".", 1)[0]
    return source.with_name(f"{stem}.parse.md")


def detect_format_token(path: Path, data: bytes, format_from_bytes: Optional[Callable[[bytes], Any]] = None) -> str:
    """Best-effort format token for ParseDocumentResult.format."""
    if format_from_bytes is not None:
        try:
            fmt = format_from_bytes(data)
            if fmt is not None:
                return str(fmt).lower().split(".")[-1]
        except Exception:
            pass
    ext = path.suffix.lower().lstrip(".")
    if ext:
        return ext
    return "unknown"


# ---------------------------------------------------------------------------
# Path ACL
# ---------------------------------------------------------------------------


def _normalize_abs(path: str | Path) -> Path:
    """Lexical absolute path (no symlink resolve yet)."""
    p = Path(os.path.expanduser(str(path)))
    if not p.is_absolute():
        # Relative paths are denied by default — tool requires absolute paths.
        return p
    # Collapse .. and . without following symlinks
    return Path(os.path.normpath(str(p)))


def _is_under(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def resolve_allowed_path(
    raw_path: str,
    *,
    vault_roots: Sequence[str | Path],
    staging_root: str | Path = DEFAULT_STAGING_ROOT,
    follow_symlinks: bool = True,
) -> tuple[Optional[Path], Optional[dict[str, Any]]]:
    """Resolve ``raw_path`` under vault roots ∪ staging; refuse escape.

    Returns ``(resolved_path, None)`` on success or ``(None, error_result)``.
    """
    if raw_path is None or not str(raw_path).strip():
        return None, _empty_result(
            error_code=ERROR_PATH_DENIED,
            error_message="Path is required",
        )

    candidate = _normalize_abs(str(raw_path).strip())
    if not candidate.is_absolute():
        return None, _empty_result(
            error_code=ERROR_PATH_DENIED,
            error_message="Path must be absolute under vault or staging roots",
        )

    roots: list[Path] = []
    for r in vault_roots:
        if r is None or str(r).strip() == "":
            continue
        roots.append(_normalize_abs(r))
    roots.append(_normalize_abs(staging_root))

    # Lexical membership first (blocks obvious .. escape after normpath)
    lexically_ok = any(_is_under(candidate, root) for root in roots)
    if not lexically_ok:
        return None, _empty_result(
            error_code=ERROR_PATH_DENIED,
            error_message="Path outside vault or staging roots",
        )

    if not candidate.exists():
        return None, _empty_result(
            error_code=ERROR_PATH_DENIED,
            error_message="Path does not exist",
        )

    try:
        st = candidate.lstat()
    except OSError:
        return None, _empty_result(
            error_code=ERROR_PATH_DENIED,
            error_message="Path is not readable",
        )

    if stat.S_ISLNK(st.st_mode):
        if not follow_symlinks:
            return None, _empty_result(
                error_code=ERROR_PATH_DENIED,
                error_message="Symlinks are not allowed",
            )
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            return None, _empty_result(
                error_code=ERROR_PATH_DENIED,
                error_message="Symlink target is not readable",
            )
        if not any(_is_under(resolved, root.resolve() if root.exists() else root) for root in roots):
            # Also check lexical roots without resolve for staging that may not exist as realpath root
            if not any(_is_under(resolved, root) for root in roots):
                return None, _empty_result(
                    error_code=ERROR_PATH_DENIED,
                    error_message="Symlink escapes vault or staging roots",
                )
        candidate = resolved
        try:
            st = candidate.stat()
        except OSError:
            return None, _empty_result(
                error_code=ERROR_PATH_DENIED,
                error_message="Path is not readable",
            )
    else:
        # Resolve non-symlink to absolute realpath for consistent return, but
        # re-check membership after realpath.
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            resolved = candidate
        if resolved != candidate:
            if not any(_is_under(resolved, root.resolve() if root.exists() else root) for root in roots):
                if not any(_is_under(resolved, root) for root in roots):
                    return None, _empty_result(
                        error_code=ERROR_PATH_DENIED,
                        error_message="Path outside vault or staging roots",
                    )
            candidate = resolved
            try:
                st = candidate.stat()
            except OSError:
                return None, _empty_result(
                    error_code=ERROR_PATH_DENIED,
                    error_message="Path is not readable",
                )

    if not stat.S_ISREG(st.st_mode):
        return None, _empty_result(
            error_code=ERROR_PATH_DENIED,
            error_message="Path is not a regular file",
        )

    return candidate, None


# ---------------------------------------------------------------------------
# OCR cost gate (F5)
# ---------------------------------------------------------------------------


def is_live_firecrawl_key(key: Optional[str]) -> bool:
    """True only for a non-empty, non-placeholder Firecrawl API key.

    Placeholders in git templates (``fc-placeholder-…``) and empty env must
    **not** enable paid OCR. No live calls without a real key.
    """
    if key is None:
        return False
    k = str(key).strip()
    if not k:
        return False
    lower = k.lower()
    if any(frag in lower for frag in _PLACEHOLDER_KEY_FRAGMENTS):
        return False
    return True


def ocr_policy_ready(config: "ParseDocumentConfig") -> bool:
    """Processor approved (allow_ocr) **and** live host key present."""
    return bool(config.allow_ocr) and is_live_firecrawl_key(config.firecrawl_api_key)


def want_ocr_escalation(force_ocr: bool, config: "ParseDocumentConfig") -> bool:
    """Whether to attempt hosted OCR after local anydoc reports scanned/empty.

    * ``force_ocr=True`` always requests the OCR path (then fail closed if
      policy/key missing → ``no_ocr_key``).
    * ``auto_ocr`` (auto_policy) only escalates when policy+key are ready so
      operators are not spammed with ``no_ocr_key`` on every scanned PDF.
    """
    if force_ocr:
        return True
    if config.auto_ocr and ocr_policy_ready(config):
        return True
    return False


def _no_ocr_key_result(format_token: str, *, reason: str) -> dict[str, Any]:
    return _empty_result(
        format_token=format_token,
        parser=PARSER_ANYDOC,
        error_code=ERROR_NO_OCR_KEY,
        error_message=reason,
    )


def _unsupported_scanned_result(format_token: str) -> dict[str, Any]:
    return _empty_result(
        format_token=format_token,
        parser=PARSER_ANYDOC,
        error_code=ERROR_UNSUPPORTED_SCANNED,
        error_message=(
            "Scanned PDF requires OCR; set force_ocr (or enable auto_ocr) with "
            "FIRECRAWL_API_KEY + allow_ocr on the host, or use offline focr"
        ),
    )


def guess_content_type(filename: str, format_token: str) -> str:
    guessed, _ = mimetypes.guess_type(filename)
    if guessed:
        return guessed
    if format_token == "pdf":
        return "application/pdf"
    return "application/octet-stream"


def firecrawl_parse_upload(
    data: bytes,
    *,
    filename: str,
    content_type: str,
    api_key: str,
    api_base: str = DEFAULT_FIRECRAWL_API_BASE,
    timeout_s: float = 60.0,
    pdf_mode: str = "ocr",
) -> str:
    """POST multipart file to Firecrawl ``/v2/parse`` (hosted OCR path).

    Uses stdlib only so agent images need no extra SDK for the reference path.
    Raises ``RuntimeError`` / ``urllib.error.URLError`` on transport or API failure.
    **Never call unless** :func:`is_live_firecrawl_key` and ``allow_ocr`` passed.
    """
    base = (api_base or DEFAULT_FIRECRAWL_API_BASE).rstrip("/")
    url = f"{base}/parse"
    boundary = f"----lanyardParse{uuid.uuid4().hex}"
    options = {
        "formats": ["markdown"],
        "parsers": [{"type": "pdf", "mode": pdf_mode}],
    }
    options_json = json.dumps(options, separators=(",", ":"))

    def _part(name: str, body: bytes, *, filename_param: Optional[str] = None, ctype: Optional[str] = None) -> bytes:
        disposition = f'form-data; name="{name}"'
        if filename_param is not None:
            disposition += f'; filename="{filename_param}"'
        headers = [f"--{boundary}", f"Content-Disposition: {disposition}"]
        if ctype:
            headers.append(f"Content-Type: {ctype}")
        headers.append("")
        return ("\r\n".join(headers) + "\r\n").encode("utf-8") + body + b"\r\n"

    body = b"".join(
        [
            _part("options", options_json.encode("utf-8"), ctype="application/json"),
            _part("file", data, filename_param=filename or "document.pdf", ctype=content_type),
            f"--{boundary}--\r\n".encode("utf-8"),
        ]
    )
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
            "User-Agent": "lanyard-parse-document/1.0 (F5 reference)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            detail = str(exc.reason)
        raise RuntimeError(
            f"Firecrawl Parse HTTP {exc.code}: {detail or exc.reason}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Firecrawl Parse network error: {exc.reason}") from exc

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Firecrawl Parse returned non-JSON body") from exc

    if isinstance(payload, dict) and payload.get("success") is False:
        err = payload.get("error") or payload.get("message") or "success=false"
        raise RuntimeError(f"Firecrawl Parse failed: {err}")

    # Prefer data.markdown; also accept top-level markdown.
    md: Any = None
    if isinstance(payload, dict):
        data_obj = payload.get("data")
        if isinstance(data_obj, dict):
            md = data_obj.get("markdown")
        if md is None:
            md = payload.get("markdown")
    if md is None:
        raise RuntimeError("Firecrawl Parse response missing markdown")
    if not isinstance(md, str):
        md = str(md)
    return md


# ---------------------------------------------------------------------------
# AnyDoc backend
# ---------------------------------------------------------------------------


def default_anydoc_to_markdown_bytes() -> Optional[ToMarkdownBytes]:
    """Load firecrawl-anydoc when installed; else None."""
    try:
        import anydoc  # type: ignore
    except ImportError:
        return None

    def _convert(data: bytes, fmt: Optional[str] = None) -> str:
        # anydoc.to_markdown_bytes(data, format=None)
        if fmt:
            return anydoc.to_markdown_bytes(data, format=fmt)
        return anydoc.to_markdown_bytes(data)

    return _convert


def _classify_anydoc_error(exc: BaseException, format_token: str) -> dict[str, Any]:
    msg = str(exc).lower()
    raw = str(exc)
    # Upstream scanned / image-only PDFs surface as unsupported.
    if any(
        token in msg
        for token in (
            "unsupported",
            "scanned",
            "image-only",
            "image only",
            "no text",
            "ocr",
        )
    ) and format_token == "pdf":
        # Distinguish format unsupported vs scanned
        if "unrecognized" in msg or "unsupported input" in msg or "format" in msg:
            if "scanned" in msg or "image" in msg or "ocr" in msg:
                return _unsupported_scanned_result(format_token)
        if "scanned" in msg or "image" in msg or "ocr" in msg or "no text" in msg:
            return _unsupported_scanned_result(format_token)
        return _empty_result(
            format_token=format_token,
            parser=PARSER_ANYDOC,
            error_code=ERROR_UNSUPPORTED_FORMAT,
            error_message=raw or "Unsupported document format",
        )
    if "unsupported" in msg or "unrecognized" in msg:
        return _empty_result(
            format_token=format_token,
            parser=PARSER_ANYDOC,
            error_code=ERROR_UNSUPPORTED_FORMAT,
            error_message=raw or "Unsupported document format",
        )
    return _empty_result(
        format_token=format_token,
        parser=PARSER_ANYDOC,
        error_code=ERROR_PARSE_FAILED,
        error_message=raw or "Document parse failed",
    )


# ---------------------------------------------------------------------------
# Progress dual-emit
# ---------------------------------------------------------------------------


def build_tool_progress_event(
    *,
    tool_status: str,
    path: str,
    tool_call_id: str,
    tool_name: str = TOOL_NAME,
    tool_label: str = TOOL_LABEL,
    result: Any = None,
    error_message: Optional[str] = None,
    chat_id: Optional[str] = None,
) -> dict[str, Any]:
    """Build a Portal-shaped tool_progress metadata envelope (host may wrap)."""
    metadata: dict[str, Any] = {
        "portal_event": "tool_progress",
        "tool_name": tool_name,
        "tool_call_id": tool_call_id,
        "tool_status": tool_status,
        "tool_target": path,
        "tool_label": tool_label,
    }
    if result is not None:
        metadata["result"] = result
    if error_message:
        metadata["error_message"] = error_message
    event: dict[str, Any] = {"metadata": metadata}
    if chat_id is not None:
        event["op"] = "send"
        event["chat_id"] = chat_id
    return event


def _emit(
    progress: Optional[ProgressCallback],
    event: Mapping[str, Any],
) -> None:
    if progress is None:
        return
    try:
        progress(event)
    except Exception:  # pragma: no cover - host callback must not fail the tool
        logger.exception("parse_document progress callback failed")


# ---------------------------------------------------------------------------
# Core tool
# ---------------------------------------------------------------------------


@dataclass
class ParseDocumentConfig:
    """Runtime knobs for the host tool."""

    vault_roots: Sequence[str | Path] = field(default_factory=list)
    staging_root: str | Path = DEFAULT_STAGING_ROOT
    max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES
    # Inject for tests; default loads firecrawl-anydoc at call time.
    to_markdown_bytes: Optional[ToMarkdownBytes] = None
    format_from_bytes: Optional[Callable[[bytes], Any]] = None
    # --- F5 OCR cost gate (host secrets envelope only; never BFF) ---
    firecrawl_api_key: Optional[str] = None
    # Processor / budget approved: operator must flip true to enable paid OCR.
    allow_ocr: bool = False
    # Auto escalate scanned PDF when allow_ocr + live key (without force_ocr).
    auto_ocr: bool = False
    firecrawl_api_base: str = DEFAULT_FIRECRAWL_API_BASE
    # Inject for offline tests; default uses firecrawl_parse_upload (network).
    firecrawl_parse: Optional[FirecrawlParseFn] = None
    firecrawl_timeout_s: float = 60.0


def parse_document(
    args: Mapping[str, Any] | None,
    *,
    config: ParseDocumentConfig,
    progress: Optional[ProgressCallback] = None,
    tool_call_id: Optional[str] = None,
    tool_name: str = TOOL_NAME,
    chat_id: Optional[str] = None,
) -> dict[str, Any]:
    """Run parse_document and dual-emit tool_progress when ``progress`` is set.

    Returns a ``ParseDocumentResult`` dict. On success ``error_code`` is absent.
    """
    args = dict(args or {})
    call_id = tool_call_id or f"parse-{uuid.uuid4().hex[:12]}"
    raw_path = args.get("path")
    path_str = str(raw_path).strip() if raw_path is not None else ""
    max_chars = clamp_max_chars(args.get("max_chars"))
    write_sidecar = args.get("write_sidecar")
    if write_sidecar is None:
        write_sidecar = True
    else:
        write_sidecar = bool(write_sidecar)
    force_ocr = bool(args.get("force_ocr") or False)

    # Always emit running first when we have a path target (even denied paths).
    target_for_progress = path_str or "(missing path)"
    _emit(
        progress,
        build_tool_progress_event(
            tool_status="running",
            path=target_for_progress,
            tool_call_id=call_id,
            tool_name=tool_name,
            chat_id=chat_id,
        ),
    )

    resolved, err = resolve_allowed_path(
        path_str,
        vault_roots=config.vault_roots,
        staging_root=config.staging_root,
    )
    if err is not None:
        _emit(
            progress,
            build_tool_progress_event(
                tool_status="error",
                path=target_for_progress,
                tool_call_id=call_id,
                tool_name=tool_name,
                result=err,
                error_message=err.get("error_message"),
                chat_id=chat_id,
            ),
        )
        return err

    assert resolved is not None
    target_for_progress = str(resolved)

    try:
        size = resolved.stat().st_size
    except OSError as exc:
        out = _empty_result(
            error_code=ERROR_PATH_DENIED,
            error_message=f"Cannot stat path: {exc}",
        )
        _emit(
            progress,
            build_tool_progress_event(
                tool_status="error",
                path=target_for_progress,
                tool_call_id=call_id,
                tool_name=tool_name,
                result=out,
                error_message=out["error_message"],
                chat_id=chat_id,
            ),
        )
        return out

    if size > int(config.max_source_bytes):
        out = _empty_result(
            error_code=ERROR_TOO_LARGE,
            error_message=(
                f"Source file exceeds max size "
                f"({size} > {config.max_source_bytes} bytes)"
            ),
        )
        _emit(
            progress,
            build_tool_progress_event(
                tool_status="error",
                path=target_for_progress,
                tool_call_id=call_id,
                tool_name=tool_name,
                result=out,
                error_message=out["error_message"],
                chat_id=chat_id,
            ),
        )
        return out

    try:
        data = resolved.read_bytes()
    except OSError as exc:
        out = _empty_result(
            error_code=ERROR_PARSE_FAILED,
            error_message=f"Failed to read file: {exc}",
        )
        _emit(
            progress,
            build_tool_progress_event(
                tool_status="error",
                path=target_for_progress,
                tool_call_id=call_id,
                tool_name=tool_name,
                result=out,
                error_message=out["error_message"],
                chat_id=chat_id,
            ),
        )
        return out

    format_fn = config.format_from_bytes
    if format_fn is None:
        try:
            import anydoc  # type: ignore

            format_fn = getattr(anydoc, "format_from_bytes", None)
        except ImportError:
            format_fn = None
    format_token = detect_format_token(resolved, data, format_fn)

    converter = config.to_markdown_bytes
    if converter is None:
        converter = default_anydoc_to_markdown_bytes()
    if converter is None:
        out = _empty_result(
            format_token=format_token,
            error_code=ERROR_PARSE_FAILED,
            error_message=(
                "firecrawl-anydoc is not installed on this host "
                "(pip install firecrawl-anydoc)"
            ),
        )
        _emit(
            progress,
            build_tool_progress_event(
                tool_status="error",
                path=target_for_progress,
                tool_call_id=call_id,
                tool_name=tool_name,
                result=out,
                error_message=out["error_message"],
                chat_id=chat_id,
            ),
        )
        return out

    parser_used = PARSER_ANYDOC
    full_md: Optional[str] = None
    anydoc_scanned = False

    try:
        full_md = converter(data, None)
    except Exception as exc:  # ConvertError and others
        classified = _classify_anydoc_error(exc, format_token)
        if classified.get("error_code") == ERROR_UNSUPPORTED_SCANNED:
            anydoc_scanned = True
            full_md = None
        else:
            _emit(
                progress,
                build_tool_progress_event(
                    tool_status="error",
                    path=target_for_progress,
                    tool_call_id=call_id,
                    tool_name=tool_name,
                    result=classified,
                    error_message=classified.get("error_message"),
                    chat_id=chat_id,
                ),
            )
            return classified

    if full_md is None and not anydoc_scanned:
        full_md = ""
    if full_md is not None and not isinstance(full_md, str):
        full_md = str(full_md)

    # Empty binary output is not silent success.
    binary_formats = {
        "pdf",
        "docx",
        "doc",
        "pptx",
        "ppt",
        "xlsx",
        "xls",
        "odt",
        "odp",
        "ods",
        "epub",
        "rtf",
    }
    if (
        not anydoc_scanned
        and full_md is not None
        and full_md.strip() == ""
        and format_token in binary_formats
    ):
        if format_token == "pdf":
            anydoc_scanned = True
            full_md = None
        else:
            out = _empty_result(
                format_token=format_token,
                parser=PARSER_ANYDOC,
                error_code=ERROR_PARSE_FAILED,
                error_message="Converter returned empty Markdown for binary document",
            )
            _emit(
                progress,
                build_tool_progress_event(
                    tool_status="error",
                    path=target_for_progress,
                    tool_call_id=call_id,
                    tool_name=tool_name,
                    result=out,
                    error_message=out.get("error_message"),
                    chat_id=chat_id,
                ),
            )
            return out

    # --- F5: optional Firecrawl Parse OCR escalation (cost-gated) ---
    if anydoc_scanned:
        ocr_result = _escalate_or_fail_scanned(
            data=data,
            resolved=resolved,
            format_token=format_token,
            force_ocr=force_ocr,
            config=config,
        )
        if ocr_result.get("error_code"):
            _emit(
                progress,
                build_tool_progress_event(
                    tool_status="error",
                    path=target_for_progress,
                    tool_call_id=call_id,
                    tool_name=tool_name,
                    result=ocr_result,
                    error_message=ocr_result.get("error_message"),
                    chat_id=chat_id,
                ),
            )
            return ocr_result
        # Success path from OCR: markdown already truncated? No — full body here.
        full_md = str(ocr_result.get("markdown") or "")
        parser_used = str(ocr_result.get("parser") or PARSER_FIRECRAWL_PARSE)

    assert full_md is not None

    markdown, truncated = truncate_markdown(full_md, max_chars)
    result: dict[str, Any] = {
        "markdown": markdown,
        "format": format_token,
        "parser": parser_used,
        "chars": len(markdown),
        "truncated": truncated,
    }

    if write_sidecar:
        side = sidecar_path_for(resolved)
        try:
            staging_root = _normalize_abs(config.staging_root)
            vaults = [_normalize_abs(r) for r in config.vault_roots if r]
            under = any(_is_under(side.parent, r) for r in vaults + [staging_root])
            if under and side.parent.is_dir() and os.access(side.parent, os.W_OK):
                side.write_text(full_md, encoding="utf-8")
                result["sidecar_path"] = str(side)
            # else soft-fail: omit sidecar_path
        except OSError:
            logger.info("parse_document sidecar write soft-failed for %s", side)

    # Prefer structured JSON string in tool_progress result (F2).
    progress_result = json.dumps(result, ensure_ascii=False)
    _emit(
        progress,
        build_tool_progress_event(
            tool_status="complete",
            path=target_for_progress,
            tool_call_id=call_id,
            tool_name=tool_name,
            result=progress_result,
            chat_id=chat_id,
        ),
    )
    return result


def _escalate_or_fail_scanned(
    *,
    data: bytes,
    resolved: Path,
    format_token: str,
    force_ocr: bool,
    config: ParseDocumentConfig,
) -> dict[str, Any]:
    """Handle scanned/empty PDF: OCR when policy+key, else fail closed.

    Returns either a success-shaped dict with full markdown (pre-truncation)
    and ``parser=firecrawl_parse``, or an error result with ``error_code``.
    """
    if not want_ocr_escalation(force_ocr, config):
        return _unsupported_scanned_result(format_token)

    # force_ocr (or auto with ready policy) requested OCR path.
    if not config.allow_ocr:
        return _no_ocr_key_result(
            format_token,
            reason=(
                "OCR requested but host allow_ocr policy is false "
                "(processor/budget not approved; F5 cost-gated)"
            ),
        )
    if not is_live_firecrawl_key(config.firecrawl_api_key):
        return _no_ocr_key_result(
            format_token,
            reason=(
                "OCR requested but FIRECRAWL_API_KEY is missing or a placeholder "
                "on the host (F5 cost-gated; never BFF)"
            ),
        )

    api_key = str(config.firecrawl_api_key).strip()
    filename = resolved.name or "document.pdf"
    content_type = guess_content_type(filename, format_token)
    parse_fn = config.firecrawl_parse or firecrawl_parse_upload

    try:
        md = parse_fn(
            data,
            filename=filename,
            content_type=content_type,
            api_key=api_key,
            api_base=config.firecrawl_api_base,
            timeout_s=config.firecrawl_timeout_s,
        )
    except TypeError:
        # Injected test doubles may use a simpler signature.
        try:
            md = parse_fn(data, filename=filename, content_type=content_type, api_key=api_key)  # type: ignore[misc]
        except Exception as exc:
            return _empty_result(
                format_token=format_token,
                parser=PARSER_FIRECRAWL_PARSE,
                error_code=ERROR_PARSE_FAILED,
                error_message=f"Firecrawl Parse OCR failed: {exc}",
            )
    except Exception as exc:
        return _empty_result(
            format_token=format_token,
            parser=PARSER_FIRECRAWL_PARSE,
            error_code=ERROR_PARSE_FAILED,
            error_message=f"Firecrawl Parse OCR failed: {exc}",
        )

    if md is None:
        md = ""
    if not isinstance(md, str):
        md = str(md)
    if md.strip() == "":
        return _empty_result(
            format_token=format_token,
            parser=PARSER_FIRECRAWL_PARSE,
            error_code=ERROR_PARSE_FAILED,
            error_message="Firecrawl Parse OCR returned empty Markdown",
        )

    # Success: return full markdown; caller truncates + sidecar + complete emit.
    return {
        "markdown": md,
        "format": format_token,
        "parser": PARSER_FIRECRAWL_PARSE,
        "chars": len(md),
        "truncated": False,
    }


def tool_result_for_model(result: Mapping[str, Any]) -> str:
    """Model-facing tool channel body: Markdown on success, JSON error on failure."""
    if result.get("error_code"):
        return json.dumps(result, ensure_ascii=False)
    md = result.get("markdown")
    if isinstance(md, str) and md:
        return md
    return json.dumps(result, ensure_ascii=False)


# ---------------------------------------------------------------------------
# OpenAI-style tool schema (HL-shaped)
# ---------------------------------------------------------------------------

PARSE_DOCUMENT_SCHEMA: dict[str, Any] = {
    "name": TOOL_NAME,
    "description": (
        "Convert an office or PDF document at a vault or staging path to "
        "Markdown so it can be reasoned over. Prefer this over read_file for "
        "binary/non-text docs. Paths must be absolute under vault roots or "
        f"{DEFAULT_STAGING_ROOT}/… Local AnyDoc is $0 SaaS; scanned PDF OCR "
        "uses Firecrawl Parse only when host allow_ocr + live FIRECRAWL_API_KEY "
        "(F5 cost-gated)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": (
                    "Absolute path under vault roots or /staging/uploads/…"
                ),
            },
            "max_chars": {
                "type": "integer",
                "description": (
                    f"Max characters of Markdown returned (default {DEFAULT_MAX_CHARS}; "
                    f"clamped to [{MAX_CHARS_MIN}, {MAX_CHARS_MAX}])."
                ),
            },
            "force_ocr": {
                "type": "boolean",
                "description": (
                    "Request hosted Firecrawl Parse OCR after local anydoc "
                    "reports unsupported scanned PDF. Requires host allow_ocr "
                    "policy + live FIRECRAWL_API_KEY; otherwise no_ocr_key."
                ),
            },
            "write_sidecar": {
                "type": "boolean",
                "description": (
                    "When true (default), write full Markdown to <stem>.parse.md "
                    "beside the source when the directory is writable under ACL."
                ),
            },
        },
        "required": ["path"],
    },
}

# Alias schema shares parameters
EXTRACT_DOCUMENT_TEXT_SCHEMA: dict[str, Any] = {
    **PARSE_DOCUMENT_SCHEMA,
    "name": TOOL_ALIAS,
}


def make_handler(
    config: ParseDocumentConfig,
    *,
    progress: Optional[ProgressCallback] = None,
    chat_id: Optional[str] = None,
) -> Callable[..., str]:
    """Return a Hermes-style handler(args, **kw) → str for registry.register."""

    def _handle(args: Mapping[str, Any] | None = None, **kw: Any) -> str:
        result = parse_document(
            args,
            config=config,
            progress=kw.get("progress", progress),
            tool_call_id=kw.get("tool_call_id"),
            tool_name=str(kw.get("tool_name") or TOOL_NAME),
            chat_id=kw.get("chat_id", chat_id),
        )
        return tool_result_for_model(result)

    return _handle


# ---------------------------------------------------------------------------
# CLI self-check (optional)
# ---------------------------------------------------------------------------

if __name__ == "__main__":  # pragma: no cover
    import argparse
    import sys

    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser(description="parse_document reference CLI")
    ap.add_argument("path")
    ap.add_argument("--vault-root", action="append", default=[])
    ap.add_argument("--staging-root", default=DEFAULT_STAGING_ROOT)
    ap.add_argument("--max-chars", type=int, default=None)
    ap.add_argument("--no-sidecar", action="store_true")
    ap.add_argument("--force-ocr", action="store_true")
    ap.add_argument(
        "--allow-ocr",
        action="store_true",
        help="Enable paid Firecrawl Parse OCR when FIRECRAWL_API_KEY is live",
    )
    ap.add_argument(
        "--auto-ocr",
        action="store_true",
        help="Auto-escalate scanned PDFs when allow_ocr + live key",
    )
    ns = ap.parse_args()
    events: list[dict[str, Any]] = []

    def _prog(ev: Mapping[str, Any]) -> None:
        events.append(dict(ev))
        meta = ev.get("metadata") or {}
        print(
            f"[progress] {meta.get('tool_status')} target={meta.get('tool_target')}",
            file=sys.stderr,
        )

    key = os.environ.get("FIRECRAWL_API_KEY") or None
    # If path is under /staging, no vault needed; else use parent chain
    if not ns.vault_root:
        p = Path(ns.path).resolve()
        vaults = [str(p.anchor), str(p.parent)]
    else:
        vaults = list(ns.vault_root)
    cfg = ParseDocumentConfig(
        vault_roots=vaults,
        staging_root=ns.staging_root,
        firecrawl_api_key=key,
        allow_ocr=bool(ns.allow_ocr),
        auto_ocr=bool(ns.auto_ocr),
    )
    res = parse_document(
        {
            "path": ns.path,
            "max_chars": ns.max_chars,
            "write_sidecar": not ns.no_sidecar,
            "force_ocr": bool(ns.force_ocr),
        },
        config=cfg,
        progress=_prog,
    )
    print(json.dumps(res, indent=2, ensure_ascii=False)[:4000])
    sys.exit(0 if not res.get("error_code") else 1)
