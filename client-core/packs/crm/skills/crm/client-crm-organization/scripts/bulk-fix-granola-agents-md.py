#!/usr/bin/env python3
"""Bulk-replace Codex/Grok Granola delegation in bucket-level client AGENTS.md."""
from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path("<VaultRoot>/Clients")
BUCKETS = ("Active", "Discovery", "Prospect", "Graveyard")

NATIVE_LINE = "- Use native `mcp_granola_*` for meeting notes (see `Clients/AGENTS.md`)."
NATIVE_BLOCK = (
    "Use native Hermes `mcp_granola_*` tools for meeting notes and transcripts "
    "(no Codex/Grok delegation)."
)

PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"- Granola → delegate to Codex\.\s*"), NATIVE_LINE + "\n"),
    (re.compile(r"- Granola notes → delegate to Codex\.\s*"), NATIVE_LINE + "\n"),
    (re.compile(r"- Granola/meeting notes → delegate to Codex\.\s*"), NATIVE_LINE + "\n"),
    (
        re.compile(r"3\. For Granola/meeting notes → delegate to Codex\.\s*"),
        "3. " + NATIVE_LINE.lstrip("- ") + "\n",
    ),
    (
        re.compile(r"4\. For Granola/meeting notes -> delegate to Codex\.\s*"),
        "4. " + NATIVE_LINE.lstrip("- ") + "\n",
    ),
    (re.compile(r"- For meeting notes/Granola → delegate to Codex\.\s*"), NATIVE_LINE + "\n"),
    (
        re.compile(
            r"When working with meeting notes, transcripts, or any Granola-related information, "
            r"\*\*always delegate to Codex\*\* instead of using the Granola MCP directly in Hermes\.?\s*"
        ),
        NATIVE_BLOCK + "\n",
    ),
    (
        re.compile(
            r"- For meeting notes/Granola → delegate to Grok \(via escalate-to-grok \+ "
            r"client-crm-organization\) per the updated post-meeting-triage skill\.\s*"
        ),
        NATIVE_LINE + "\n",
    ),
]


def main() -> int:
    changed: list[pathlib.Path] = []
    for bucket in BUCKETS:
        base = ROOT / bucket
        if not base.is_dir():
            continue
        for agents in base.glob("*/AGENTS.md"):
            text = agents.read_text(encoding="utf-8")
            orig = text
            for pat, repl in PATTERNS:
                text = pat.sub(repl, text)
            if text != orig:
                agents.write_text(text, encoding="utf-8")
                changed.append(agents)
    print(f"updated {len(changed)}")
    for p in sorted(changed):
        print(p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())