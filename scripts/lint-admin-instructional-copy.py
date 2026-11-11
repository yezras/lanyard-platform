#!/usr/bin/env python3
"""Fail if admin UI sources contain instructional-copy canaries (lp-hdzm.2).

Scan root: portal/apps/web/src/features/admin
Empty states and field errors are allowed. These phrases are not.

Usage (from repository root):
  python3 scripts/lint-admin-instructional-copy.py
  python3 scripts/lint-admin-instructional-copy.py --root /path/to/repo
  python3 scripts/lint-admin-instructional-copy.py --self-test

Exit 0 on success; non-zero on failure. Default runs the planted-string
self-test, then scans the repo.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

FORBIDDEN_PHRASES: tuple[str, ...] = (
    "Tenant admins never",
    "selecting a row opens",
    "Ops never finishes",
)

SCAN_REL = Path("portal/apps/web/src/features/admin")
SCAN_SUFFIXES = {".ts", ".tsx", ".js", ".jsx"}
SKIP_DIR_NAMES = {".git", "node_modules", "dist", "coverage"}


@dataclass(frozen=True)
class Hit:
    path: Path
    line_no: int
    phrase: str
    line: str


def iter_source_files(admin_dir: Path) -> list[Path]:
    files: list[Path] = []
    if not admin_dir.is_dir():
        return files
    for path in sorted(admin_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix not in SCAN_SUFFIXES:
            continue
        if any(part in SKIP_DIR_NAMES for part in path.parts):
            continue
        files.append(path)
    return files


def _collapsed(text: str) -> str:
    return " ".join(text.split())


def find_hits(path: Path, text: str) -> list[Hit]:
    hits: list[Hit] = []
    lines = text.splitlines()
    collapsed = _collapsed(text).lower()
    for phrase in FORBIDDEN_PHRASES:
        needle = phrase.lower()
        line_hits = [
            Hit(path=path, line_no=i, phrase=phrase, line=line.strip())
            for i, line in enumerate(lines, 1)
            if needle in line.lower()
        ]
        if line_hits:
            hits.extend(line_hits)
            continue
        if needle in collapsed:
            hits.append(
                Hit(
                    path=path,
                    line_no=0,
                    phrase=phrase,
                    line=f"(wrapped) {phrase}",
                )
            )
    return hits


def scan_admin_dir(admin_dir: Path) -> list[Hit]:
    hits: list[Hit] = []
    for path in iter_source_files(admin_dir):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            hits.append(
                Hit(path=path, line_no=0, phrase="", line=f"cannot read: {exc}")
            )
            continue
        hits.extend(find_hits(path, text))
    return hits


def self_test() -> list[str]:
    errors: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        dirty = Path(tmp) / "dirty"
        dirty.mkdir()
        for i, phrase in enumerate(FORBIDDEN_PHRASES):
            (dirty / f"planted{i}.tsx").write_text(
                f'export const copy = "{phrase}";\n',
                encoding="utf-8",
            )
        dirty_hits = scan_admin_dir(dirty)
        found = {hit.phrase for hit in dirty_hits if hit.phrase}
        missing = [phrase for phrase in FORBIDDEN_PHRASES if phrase not in found]
        if missing:
            errors.append(
                "self-test: planted string(s) not detected: "
                + ", ".join(missing)
            )

        wrapped = Path(tmp) / "wrapped"
        wrapped.mkdir()
        (wrapped / "Wrapped.tsx").write_text(
            "export const copy = `Ops never\nfinishes OAuth`;\n",
            encoding="utf-8",
        )
        wrapped_hits = scan_admin_dir(wrapped)
        if not any(hit.phrase == "Ops never finishes" for hit in wrapped_hits):
            errors.append("self-test: wrapped 'Ops never finishes' not detected")

        clean = Path(tmp) / "clean"
        clean.mkdir()
        (clean / "Empty.tsx").write_text(
            'export function Empty() { return <p>No tenants</p>; }\n'
            'export const err = "Name is required";\n',
            encoding="utf-8",
        )
        clean_hits = scan_admin_dir(clean)
        if clean_hits:
            details = "; ".join(
                f"{hit.path.name}:{hit.line_no}:{hit.phrase}" for hit in clean_hits
            )
            errors.append(f"self-test: clean tree produced hits: {details}")
    return errors


def format_hit(hit: Hit, admin_dir: Path) -> str:
    try:
        rel = hit.path.relative_to(admin_dir)
    except ValueError:
        rel = hit.path
    loc = f"{rel}:{hit.line_no}" if hit.line_no else str(rel)
    if not hit.phrase:
        return f"{loc}: {hit.line}"
    return f'{loc}: forbidden phrase "{hit.phrase}": {hit.line}'


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Lint admin UI sources for instructional-copy canaries."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="repository root (default: parent of scripts/)",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="run planted-string self-test only",
    )
    parser.add_argument(
        "--skip-self-test",
        action="store_true",
        help="scan the repo without the planted-string self-test",
    )
    args = parser.parse_args(argv)

    failed = 0

    if not args.skip_self_test:
        st_errors = self_test()
        if st_errors:
            failed = 1
            for err in st_errors:
                print(f"FAIL  {err}", file=sys.stderr)
        else:
            print("OK  planted-string self-test (dirty fails, clean passes)")

    if args.self_test:
        return failed

    root = args.root
    if root is None:
        root = Path(__file__).resolve().parent.parent
    root = root.resolve()
    admin_dir = root / SCAN_REL
    if not admin_dir.is_dir():
        print(f"OK  {SCAN_REL} not present (skip)")
        return failed

    hits = scan_admin_dir(admin_dir)
    if hits:
        failed = 1
        for hit in hits:
            print(f"FAIL  {format_hit(hit, admin_dir)}", file=sys.stderr)
        print(
            f"FAIL  {len(hits)} instructional-copy hit(s) under {SCAN_REL}",
            file=sys.stderr,
        )
        return failed

    print(f"OK  no forbidden phrases under {SCAN_REL}")
    return failed


if __name__ == "__main__":
    sys.exit(main())
