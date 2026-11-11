#!/usr/bin/env python3
"""Offline validation for client-core optional packs (lp-k7g.9.3).

Checks:
  - every packs/<name>/ directory has pack.yaml metadata
  - pack.yaml has required fields (name, summary or when_to_enable)
  - pack name matches directory basename
  - no duplicate pack names across pack.yaml files
  - declared sources/ paths exist under the pack
  - enable-pack.sh has a case handler for every discovered pack
  - index.yaml folders.packs entries and packs/INDEX.md table stay in sync
    with the discoverable pack set (warn-level mismatch is still FAIL)

Works from monorepo root or client-core/:
  python3 client-core/scripts/validate-packs.py
  python3 scripts/validate-packs.py --client-core /path/to/client-core

Exit 0 on success; non-zero on failure. No network calls.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

REQUIRED_NAME = "name"
# At least one human-facing description field
DESCRIPTION_KEYS = ("summary", "when_to_enable", "description")

# Known install handlers in enable-pack.sh (must match case arms)
# Parsed from the script when possible; this is the fail-closed fallback set.
FALLBACK_HANDLERS = frozenset(
    {
        "gws",
        "crm",
        "self-improve",
        "wacli",
        "focr",
        "granola",
        "excel-author",
        "meadow-core",
    }
)

# index.yaml folders.packs maps logical keys → path; skip non-directory entries
INDEX_YAML_SKIP_KEYS = frozenset({"purpose", "index", "note"})


def load_pack_yaml(path: Path) -> dict[str, Any]:
    """Load pack.yaml; use a dedicated simple parser when structure is flat."""
    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore

        obj = yaml.safe_load(text)
        if not isinstance(obj, dict):
            raise ValueError(f"{path}: pack.yaml root must be a mapping")
        return obj
    except ImportError:
        return _parse_pack_yaml_simple(text, path)


def _parse_pack_yaml_simple(text: str, path: Path) -> dict[str, Any]:
    data: dict[str, Any] = {}
    current_list: str | None = None
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        line = raw.rstrip()
        stripped = line.strip()
        if stripped.startswith("- "):
            if current_list is None:
                raise ValueError(f"{path}: list item without key: {stripped}")
            data.setdefault(current_list, []).append(stripped[2:].strip().strip("\"'"))
            continue
        if ":" in stripped:
            key, _, rest = stripped.partition(":")
            key = key.strip()
            rest = rest.strip()
            if rest == "":
                data[key] = []
                current_list = key
            else:
                data[key] = rest.strip("\"'")
                current_list = None
            continue
        raise ValueError(f"{path}: cannot parse line: {stripped}")
    return data


def discover_pack_dirs(packs_root: Path) -> list[Path]:
    if not packs_root.is_dir():
        return []
    dirs = [
        p
        for p in sorted(packs_root.iterdir())
        if p.is_dir() and not p.name.startswith(".")
    ]
    return dirs


def parse_enable_pack_handlers(enable_script: Path) -> set[str]:
    if not enable_script.is_file():
        return set(FALLBACK_HANDLERS)
    text = enable_script.read_text(encoding="utf-8")
    # Match case arms like "  gws)" or "  self-improve)" before the install body.
    # Avoid matching "*)" default.
    arms = set(re.findall(r"(?m)^[ \t]+([a-z0-9][a-z0-9-]*)\)\s*$", text))
    arms.discard("*")
    # Filter out shell function noise if any — keep only known pack-like tokens
    # Also drop patterns that are not under the main case (hard).
    # Prefer intersection with discoverable packs later; return all arms found.
    if not arms:
        return set(FALLBACK_HANDLERS)
    return arms


def parse_index_md_packs(index_md: Path) -> list[str]:
    if not index_md.is_file():
        return []
    text = index_md.read_text(encoding="utf-8")
    # Table rows: | `name` | ...
    return re.findall(r"^\|\s*`([a-z0-9][a-z0-9-]*)`\s*\|", text, re.M)


def parse_index_yaml_packs(index_yaml: Path) -> dict[str, str]:
    """Return mapping of logical key → relative path under packs/ for pack entries."""
    if not index_yaml.is_file():
        return {}
    try:
        import yaml  # type: ignore

        doc = yaml.safe_load(index_yaml.read_text(encoding="utf-8"))
    except ImportError:
        # Fallback: regex for "key: packs/name" lines under packs:
        text = index_yaml.read_text(encoding="utf-8")
        found = re.findall(
            r"(?m)^[ \t]+([A-Za-z0-9_]+):\s*(packs/[A-Za-z0-9._-]+)\s*$",
            text,
        )
        return {k: v for k, v in found if k not in INDEX_YAML_SKIP_KEYS}

    if not isinstance(doc, dict):
        return {}
    folders = doc.get("folders") or {}
    packs = folders.get("packs") if isinstance(folders, dict) else None
    if not isinstance(packs, dict):
        return {}
    out: dict[str, str] = {}
    for key, val in packs.items():
        if key in INDEX_YAML_SKIP_KEYS:
            continue
        if isinstance(val, str) and val.startswith("packs/"):
            out[str(key)] = val
    return out


def validate(client_core: Path) -> list[str]:
    errors: list[str] = []
    packs_root = client_core / "packs"
    enable_script = client_core / "scripts" / "enable-pack.sh"
    index_md = packs_root / "INDEX.md"
    index_yaml = client_core / "index.yaml"

    if not packs_root.is_dir():
        errors.append(f"missing packs directory: {packs_root}")
        return errors

    dirs = discover_pack_dirs(packs_root)
    if not dirs:
        errors.append(f"no pack directories under {packs_root}")
        return errors

    names_from_meta: dict[str, Path] = {}
    dir_names: list[str] = []

    for d in dirs:
        dir_names.append(d.name)
        meta_path = d / "pack.yaml"
        if not meta_path.is_file():
            errors.append(f"missing pack metadata: packs/{d.name}/pack.yaml")
            continue
        try:
            meta = load_pack_yaml(meta_path)
        except Exception as e:  # noqa: BLE001 — report parse errors as validation failures
            errors.append(f"packs/{d.name}/pack.yaml: parse error: {e}")
            continue
        if not isinstance(meta, dict):
            errors.append(f"packs/{d.name}/pack.yaml: root must be a mapping")
            continue

        name = meta.get(REQUIRED_NAME)
        if name is None or (isinstance(name, str) and not name.strip()):
            errors.append(f"packs/{d.name}/pack.yaml: missing required field 'name'")
            name_s = None
        elif not isinstance(name, str):
            errors.append(
                f"packs/{d.name}/pack.yaml: 'name' must be a string, got {type(name).__name__}"
            )
            name_s = None
        else:
            name_s = name.strip()
            if name_s != d.name:
                errors.append(
                    f"packs/{d.name}/pack.yaml: name {name_s!r} does not match "
                    f"directory basename {d.name!r}"
                )
            if name_s in names_from_meta:
                other = names_from_meta[name_s]
                errors.append(
                    f"duplicate pack name {name_s!r}: "
                    f"packs/{other.parent.name}/pack.yaml and packs/{d.name}/pack.yaml"
                )
            else:
                names_from_meta[name_s] = meta_path

        # description field
        if not any(
            isinstance(meta.get(k), str) and str(meta.get(k)).strip()
            for k in DESCRIPTION_KEYS
        ):
            errors.append(
                f"packs/{d.name}/pack.yaml: missing description field "
                f"(one of {', '.join(DESCRIPTION_KEYS)})"
            )

        # sources must exist when declared
        sources = meta.get("sources")
        if sources is not None:
            if not isinstance(sources, list) or not all(
                isinstance(s, str) and s.strip() for s in sources
            ):
                errors.append(
                    f"packs/{d.name}/pack.yaml: 'sources' must be a list of non-empty strings"
                )
            else:
                for rel in sources:
                    rel_n = rel.strip().lstrip("./")
                    target = d / rel_n
                    if not target.exists():
                        errors.append(
                            f"packs/{d.name}/pack.yaml: source path missing: {rel_n}"
                        )

        # dependencies shape (optional)
        deps = meta.get("dependencies")
        if deps is not None and not (
            isinstance(deps, list) and all(isinstance(x, str) for x in deps)
        ):
            errors.append(
                f"packs/{d.name}/pack.yaml: 'dependencies' must be a list of strings"
            )

    # Duplicate directory names are impossible on a single filesystem path;
    # still flag if dir list has dups (symlink edge).
    if len(dir_names) != len(set(dir_names)):
        seen: set[str] = set()
        for n in dir_names:
            if n in seen:
                errors.append(f"duplicate pack directory name: {n}")
            seen.add(n)

    handlers = parse_enable_pack_handlers(enable_script)
    if not enable_script.is_file():
        errors.append("missing scripts/enable-pack.sh")
    else:
        for n in dir_names:
            if n not in handlers:
                errors.append(
                    f"pack {n!r} has no enable-pack.sh case handler "
                    f"(handlers found: {sorted(handlers)})"
                )
        # Handlers without directories
        for h in sorted(handlers):
            if h not in dir_names and h in FALLBACK_HANDLERS:
                # Only flag handlers that look like packs and lack a directory
                if not (packs_root / h).is_dir():
                    errors.append(
                        f"enable-pack.sh handler {h!r} has no packs/{h}/ directory"
                    )

    # INDEX.md table
    md_packs = parse_index_md_packs(index_md)
    if not md_packs:
        errors.append("packs/INDEX.md: no pack rows discovered in table")
    else:
        md_set = set(md_packs)
        dir_set = set(dir_names)
        for n in sorted(dir_set - md_set):
            errors.append(f"packs/INDEX.md: missing table row for pack {n!r}")
        for n in sorted(md_set - dir_set):
            errors.append(
                f"packs/INDEX.md: table lists pack {n!r} but packs/{n}/ is missing"
            )
        # duplicate rows in INDEX.md
        if len(md_packs) != len(md_set):
            from collections import Counter

            for n, c in Counter(md_packs).items():
                if c > 1:
                    errors.append(
                        f"packs/INDEX.md: duplicate table row for pack {n!r} ({c} times)"
                    )

    # index.yaml folders.packs
    yaml_packs = parse_index_yaml_packs(index_yaml)
    if not yaml_packs:
        errors.append("index.yaml: no folders.packs path entries found")
    else:
        yaml_dir_names = set()
        for key, rel in yaml_packs.items():
            # rel like packs/gws
            base = Path(rel).name
            yaml_dir_names.add(base)
            if not (client_core / rel).is_dir():
                errors.append(f"index.yaml folders.packs.{key}: path missing: {rel}")
        dir_set = set(dir_names)
        for n in sorted(dir_set - yaml_dir_names):
            errors.append(
                f"index.yaml folders.packs: missing entry for pack directory {n!r}"
            )
        for n in sorted(yaml_dir_names - dir_set):
            errors.append(
                f"index.yaml folders.packs: references packs/{n} but directory missing"
            )
        # duplicate paths
        path_counts: dict[str, int] = {}
        for rel in yaml_packs.values():
            path_counts[rel] = path_counts.get(rel, 0) + 1
        for rel, c in path_counts.items():
            if c > 1:
                errors.append(
                    f"index.yaml folders.packs: duplicate path {rel!r} ({c} times)"
                )

    return errors


def resolve_client_core(root: Path | None, explicit: Path | None) -> Path:
    if explicit is not None:
        return explicit.resolve()
    cwd = Path.cwd().resolve()
    if root is not None:
        base = root.resolve()
    else:
        base = cwd
    # Prefer monorepo layout
    candidates = [
        base / "client-core",
        base,  # already inside client-core
        cwd / "client-core",
        cwd,
    ]
    for c in candidates:
        if (c / "packs").is_dir() and (c / "scripts" / "enable-pack.sh").is_file():
            return c
    # Default monorepo path even if incomplete (validator will report missing)
    return (base / "client-core").resolve()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Monorepo root (default: cwd). client-core/ is resolved under this path.",
    )
    parser.add_argument(
        "--client-core",
        type=Path,
        default=None,
        help="Explicit path to client-core tree (vault or monorepo subpath).",
    )
    args = parser.parse_args(argv)

    client_core = resolve_client_core(args.root, args.client_core)
    errors = validate(client_core)

    if errors:
        print(f"FAIL  client-core packs ({client_core})", file=sys.stderr)
        for e in errors:
            print(f"  FAIL  {e}", file=sys.stderr)
        print(f"FAILED  {len(errors)} pack validation error(s)", file=sys.stderr)
        return 1

    dirs = discover_pack_dirs(client_core / "packs")
    names = ", ".join(d.name for d in dirs)
    print(
        f"OK  client-core packs: {len(dirs)} pack(s) with unique metadata "
        f"({names}); enable-pack handlers + INDEX/index.yaml in sync"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
