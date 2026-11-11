"""Example Hermes-Lanyard registry wiring for parse_document (F3 + F5).

Copy into the external hermes-lanyard tree (e.g. tools/parse_document.py) and
adapt imports / vault root resolution to the product. This file is **not**
auto-imported by monorepo validate; it is teaching-only.

OCR (F5) is **off by default**. Operators must:

1. Put a live ``FIRECRAWL_API_KEY`` in the host secrets envelope (never BFF).
2. Set ``PARSE_DOCUMENT_ALLOW_OCR=true`` (budget / processor approved).
3. Optionally set ``PARSE_DOCUMENT_AUTO_OCR=true`` to escalate scanned PDFs
   without per-call ``force_ocr``.

Placeholder keys (``fc-placeholder-…``) never enable paid calls.
"""

from __future__ import annotations

import os
from typing import Any, Mapping

# Product imports (external):
# from tools.registry import registry
# from tools.parse_document_tool import (
#     EXTRACT_DOCUMENT_TEXT_SCHEMA,
#     PARSE_DOCUMENT_SCHEMA,
#     ParseDocumentConfig,
#     TOOL_ALIAS,
#     TOOL_NAME,
#     make_handler,
#     parse_document,
#     tool_result_for_model,
# )

# --- teaching sketch ---------------------------------------------------------


def _env_truthy(name: str, default: str = "false") -> bool:
    return (os.environ.get(name) or default).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _vault_roots_from_env() -> list[str]:
    roots: list[str] = []
    for key in ("VAULT_ROOT", "COMPANY_BRAIN_VAULT_ROOT"):
        val = (os.environ.get(key) or "").strip()
        if val:
            roots.append(val)
    # Fallback pilot pin shape
    if not roots and os.path.isdir("/opt/company-brain"):
        roots.append("/opt/company-brain")
    return roots


def build_config() -> "ParseDocumentConfig":  # type: ignore[name-defined]
    from parse_document_tool import ParseDocumentConfig  # local reference path

    return ParseDocumentConfig(
        vault_roots=_vault_roots_from_env(),
        staging_root=os.environ.get("STAGING_UPLOADS_ROOT", "/staging/uploads"),
        firecrawl_api_key=os.environ.get("FIRECRAWL_API_KEY") or None,
        # F5: both gates required for live paid OCR (key checked at call time).
        allow_ocr=_env_truthy("PARSE_DOCUMENT_ALLOW_OCR", "false"),
        auto_ocr=_env_truthy("PARSE_DOCUMENT_AUTO_OCR", "false"),
        firecrawl_api_base=os.environ.get(
            "FIRECRAWL_API_BASE", "https://api.firecrawl.dev/v2"
        ),
    )


def _handle_parse_document(args: Mapping[str, Any] | None = None, **kw: Any) -> str:
    from parse_document_tool import make_handler

    return make_handler(build_config())(args, **kw)


# registry.register(
#     name=TOOL_NAME,
#     toolset="document",
#     schema=PARSE_DOCUMENT_SCHEMA,
#     handler=_handle_parse_document,
#     emoji="📄",
# )
# registry.register(
#     name=TOOL_ALIAS,
#     toolset="document",
#     schema=EXTRACT_DOCUMENT_TEXT_SCHEMA,
#     handler=_handle_parse_document,
#     emoji="📄",
# )
