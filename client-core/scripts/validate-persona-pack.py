#!/usr/bin/env python3
"""Validate the meadow-core three-persona vault pack (lac-bx3.17).

Prove command:
  python3 client-core/scripts/validate-persona-pack.py

Checks:
  - skip.persona.md, lev.persona.md, bana.persona.md, and instructions.md exist
  - YAML frontmatter parses into the Persona typed model
  - Skip is orchestrator with all_messages; Lev and Bana are read-only mention-only
  - enable-pack.sh copies the pack into agents/meadow-core/

Exit 0 on success; non-zero on failure. No network.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PACK_NAME = "meadow-core"
PERSONA_FILES = ("skip.persona.md", "lev.persona.md", "bana.persona.md")
INSTRUCTIONS_FILE = "instructions.md"
ROLES = frozenset({"orchestrator", "security", "architecture"})
PERSONA_ID_CHARS = frozenset("abcdefghijklmnopqrstuvwxyz0123456789_-")

# Snapshot of the first three-persona pack. Parser tests pin this, not body prose.
EXPECTED_SNAPSHOT: dict[str, dict[str, Any]] = {
    "skip": {
        "display_name": "Skip",
        "role": "orchestrator",
        "read_only": False,
        "mentions": True,
        "all_messages": True,
    },
    "lev": {
        "display_name": "Lev",
        "role": "security",
        "read_only": True,
        "mentions": True,
        "all_messages": False,
    },
    "bana": {
        "display_name": "Bana",
        "role": "architecture",
        "read_only": True,
        "mentions": True,
        "all_messages": False,
    },
}


class PersonaPackError(ValueError):
    """Invalid persona pack or frontmatter at the file boundary."""


@dataclass(frozen=True)
class PersonaTriggers:
    mentions: bool
    all_messages: bool


@dataclass(frozen=True)
class Persona:
    persona_id: str
    display_name: str
    description: str
    role: str
    read_only: bool
    triggers: PersonaTriggers
    body: str
    relpath: str


@dataclass(frozen=True)
class PersonaPack:
    name: str
    instructions: str
    personas: tuple[Persona, ...]

    def by_id(self) -> dict[str, Persona]:
        return {p.persona_id: p for p in self.personas}


def _require_str(data: dict[str, Any], key: str, source: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise PersonaPackError(f"{source}: missing or empty {key!r}")
    return value.strip()


def _require_bool(data: dict[str, Any], key: str, source: str) -> bool:
    value = data.get(key)
    if not isinstance(value, bool):
        raise PersonaPackError(f"{source}: {key!r} must be a boolean")
    return value


def parse_persona_id(raw: str, source: str) -> str:
    persona_id = raw.strip()
    if not persona_id:
        raise PersonaPackError(f"{source}: empty persona id")
    if ":" in persona_id:
        raise PersonaPackError(f"{source}: persona id must not contain ':'")
    if persona_id[0] not in "abcdefghijklmnopqrstuvwxyz":
        raise PersonaPackError(f"{source}: persona id must start with a lowercase letter")
    if any(ch not in PERSONA_ID_CHARS for ch in persona_id):
        raise PersonaPackError(
            f"{source}: persona id may contain only lowercase letters, digits, '_' and '-'"
        )
    return persona_id


def split_frontmatter(text: str, source: str) -> tuple[str, str]:
    if not text.startswith("---"):
        raise PersonaPackError(f"{source}: missing YAML frontmatter")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise PersonaPackError(f"{source}: missing YAML frontmatter opener")
    close_at = None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            close_at = i
            break
    if close_at is None:
        raise PersonaPackError(f"{source}: unterminated YAML frontmatter")
    yaml_text = "\n".join(lines[1:close_at])
    body = "\n".join(lines[close_at + 1 :]).strip()
    return yaml_text, body


def load_yaml_mapping(text: str, source: str) -> dict[str, Any]:
    try:
        import yaml  # type: ignore
    except ImportError:
        return _parse_simple_mapping(text, source)
    obj = yaml.safe_load(text)
    if not isinstance(obj, dict):
        raise PersonaPackError(f"{source}: frontmatter root must be a mapping")
    return obj


def _parse_scalar(raw: str) -> Any:
    value = raw.strip()
    if value in ("true", "True"):
        return True
    if value in ("false", "False"):
        return False
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]
    return value


def _parse_simple_mapping(text: str, source: str) -> dict[str, Any]:
    """Minimal nested mapping parser for environments without PyYAML."""
    root: dict[str, Any] = {}
    stack: list[tuple[int, dict[str, Any]]] = [(0, root)]
    pending_key: str | None = None
    pending_indent = 0
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        stripped = raw.strip()
        if ":" not in stripped:
            raise PersonaPackError(f"{source}: cannot parse line: {stripped}")
        key, _, rest = stripped.partition(":")
        key = key.strip()
        rest = rest.strip()
        while stack and indent < stack[-1][0]:
            stack.pop()
        if indent > stack[-1][0]:
            if pending_key is None:
                raise PersonaPackError(f"{source}: unexpected indent at {key}")
            child: dict[str, Any] = {}
            stack[-1][1][pending_key] = child
            stack.append((pending_indent, child))
            pending_key = None
        parent = stack[-1][1]
        if rest == "":
            pending_key = key
            pending_indent = indent + 2
            parent[key] = {}
        else:
            parent[key] = _parse_scalar(rest)
            pending_key = None
    return root


def parse_persona_markdown(text: str, *, relpath: str, expected_id: str) -> Persona:
    yaml_text, body = split_frontmatter(text, relpath)
    data = load_yaml_mapping(yaml_text, relpath)
    persona_id = parse_persona_id(_require_str(data, "name", relpath), relpath)
    if persona_id != expected_id:
        raise PersonaPackError(
            f"{relpath}: name {persona_id!r} does not match filename stem {expected_id!r}"
        )
    role = _require_str(data, "role", relpath)
    if role not in ROLES:
        raise PersonaPackError(f"{relpath}: role {role!r} is not one of {sorted(ROLES)}")
    triggers_raw = data.get("triggers")
    if not isinstance(triggers_raw, dict):
        raise PersonaPackError(f"{relpath}: triggers must be a mapping")
    triggers = PersonaTriggers(
        mentions=_require_bool(triggers_raw, "mentions", f"{relpath} triggers"),
        all_messages=_require_bool(triggers_raw, "all_messages", f"{relpath} triggers"),
    )
    if not body:
        raise PersonaPackError(f"{relpath}: persona body is empty")
    return Persona(
        persona_id=persona_id,
        display_name=_require_str(data, "display_name", relpath),
        description=_require_str(data, "description", relpath),
        role=role,
        read_only=_require_bool(data, "read_only", relpath),
        triggers=triggers,
        body=body,
        relpath=relpath,
    )


def load_pack(pack_dir: Path) -> PersonaPack:
    if not pack_dir.is_dir():
        raise PersonaPackError(f"missing pack directory: {pack_dir}")
    instructions_path = pack_dir / INSTRUCTIONS_FILE
    if not instructions_path.is_file():
        raise PersonaPackError(f"missing {INSTRUCTIONS_FILE} in {pack_dir}")
    instructions = instructions_path.read_text(encoding="utf-8").strip()
    if not instructions:
        raise PersonaPackError("instructions.md is empty")
    personas: list[Persona] = []
    for filename in PERSONA_FILES:
        path = pack_dir / "agents" / filename
        if not path.is_file():
            raise PersonaPackError(f"missing {path}")
        expected_id = filename.removesuffix(".persona.md")
        relpath = f"packs/{PACK_NAME}/agents/{filename}"
        personas.append(
            parse_persona_markdown(
                path.read_text(encoding="utf-8"),
                relpath=relpath,
                expected_id=expected_id,
            )
        )
    ids = [p.persona_id for p in personas]
    if len(ids) != len(set(ids)):
        raise PersonaPackError(f"duplicate persona ids: {ids}")
    return PersonaPack(name=PACK_NAME, instructions=instructions, personas=tuple(personas))


def snapshot_of(persona: Persona) -> dict[str, Any]:
    return {
        "display_name": persona.display_name,
        "role": persona.role,
        "read_only": persona.read_only,
        "mentions": persona.triggers.mentions,
        "all_messages": persona.triggers.all_messages,
    }


def check_snapshot(pack: PersonaPack) -> list[str]:
    errors: list[str] = []
    by_id = pack.by_id()
    expected_ids = set(EXPECTED_SNAPSHOT)
    got_ids = set(by_id)
    for missing in sorted(expected_ids - got_ids):
        errors.append(f"missing persona {missing!r}")
    for extra in sorted(got_ids - expected_ids):
        errors.append(f"unexpected persona {extra!r}")
    for persona_id, expected in EXPECTED_SNAPSHOT.items():
        persona = by_id.get(persona_id)
        if persona is None:
            continue
        got = snapshot_of(persona)
        if got != expected:
            errors.append(f"{persona_id}: frontmatter snapshot {got} != {expected}")
    skip = by_id.get("skip")
    if skip is not None and not skip.triggers.all_messages:
        errors.append("skip: orchestrator must have triggers.all_messages true")
    for persona_id in ("lev", "bana"):
        persona = by_id.get(persona_id)
        if persona is not None and not persona.read_only:
            errors.append(f"{persona_id}: must be read_only true")
    return errors


def smoke_enable_pack(pack_dir: Path, enable_script: Path) -> list[str]:
    errors: list[str] = []
    if not enable_script.is_file():
        return [f"missing enable-pack.sh: {enable_script}"]
    with tempfile.TemporaryDirectory(prefix="meadow-core-enable.") as tmp:
        root = Path(tmp)
        (root / "scripts").mkdir()
        shutil.copy2(enable_script, root / "scripts" / "enable-pack.sh")
        shutil.copytree(pack_dir, root / "packs" / PACK_NAME)
        proc = subprocess.run(
            ["bash", str(root / "scripts" / "enable-pack.sh"), PACK_NAME],
            check=False,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            errors.append(
                "enable-pack.sh meadow-core failed: "
                + (proc.stderr or proc.stdout).strip()
            )
            return errors
        dest = root / "agents" / PACK_NAME
        for filename in (*PERSONA_FILES, INSTRUCTIONS_FILE):
            landed = dest / filename
            if not landed.is_file():
                errors.append(f"enable-pack did not install agents/{PACK_NAME}/{filename}")
    return errors


def resolve_client_core(root: Path | None, explicit: Path | None) -> Path:
    if explicit is not None:
        return explicit.resolve()
    cwd = Path.cwd().resolve()
    base = root.resolve() if root is not None else cwd
    for candidate in (base / "client-core", base, cwd / "client-core", cwd):
        if (candidate / "packs").is_dir() and (candidate / "scripts" / "enable-pack.sh").is_file():
            return candidate
    return (base / "client-core").resolve()


def validate(client_core: Path) -> list[str]:
    pack_dir = client_core / "packs" / PACK_NAME
    errors: list[str] = []
    try:
        pack = load_pack(pack_dir)
    except PersonaPackError as exc:
        return [str(exc)]
    errors.extend(check_snapshot(pack))
    errors.extend(smoke_enable_pack(pack_dir, client_core / "scripts" / "enable-pack.sh"))
    return errors


class PersonaParserTests(unittest.TestCase):
    def test_rejects_colon_in_persona_id(self) -> None:
        text = (
            "---\n"
            "name: skip:evil\n"
            "display_name: Skip\n"
            "description: x\n"
            "role: orchestrator\n"
            "read_only: false\n"
            "triggers:\n"
            "  mentions: true\n"
            "  all_messages: true\n"
            "---\n"
            "body\n"
        )
        with self.assertRaises(PersonaPackError) as ctx:
            parse_persona_markdown(text, relpath="x.persona.md", expected_id="skip:evil")
        self.assertIn("must not contain ':'", str(ctx.exception))

    def test_rejects_missing_read_only(self) -> None:
        text = (
            "---\n"
            "name: lev\n"
            "display_name: Lev\n"
            "description: x\n"
            "role: security\n"
            "triggers:\n"
            "  mentions: true\n"
            "  all_messages: false\n"
            "---\n"
            "body\n"
        )
        with self.assertRaises(PersonaPackError) as ctx:
            parse_persona_markdown(text, relpath="lev.persona.md", expected_id="lev")
        self.assertIn("read_only", str(ctx.exception))

    def test_parses_nested_triggers_without_pyyaml_helper(self) -> None:
        mapping = _parse_simple_mapping(
            "name: skip\ntriggers:\n  mentions: true\n  all_messages: true\n",
            "fixture",
        )
        self.assertEqual(mapping["name"], "skip")
        self.assertEqual(mapping["triggers"]["all_messages"], True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=None, help="Monorepo root (default: cwd).")
    parser.add_argument(
        "--client-core",
        type=Path,
        default=None,
        help="Explicit path to client-core tree.",
    )
    parser.add_argument(
        "--unittest",
        action="store_true",
        help="Run parser unit tests only (no pack files).",
    )
    args = parser.parse_args(argv)

    if args.unittest:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(PersonaParserTests)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        return 0 if result.wasSuccessful() else 1

    client_core = resolve_client_core(args.root, args.client_core)
    errors = validate(client_core)

    # Parser illegal-state tests run with the pack check so the prove command is one shot.
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PersonaParserTests)
    result = unittest.TextTestRunner(verbosity=1, stream=sys.stderr).run(suite)
    if not result.wasSuccessful():
        errors.append("persona parser unit tests failed")

    if errors:
        print(f"FAIL  meadow-core persona pack ({client_core})", file=sys.stderr)
        for err in errors:
            print(f"  FAIL  {err}", file=sys.stderr)
        print(f"FAILED  {len(errors)} persona pack error(s)", file=sys.stderr)
        return 1

    pack = load_pack(client_core / "packs" / PACK_NAME)
    ids = ", ".join(p.persona_id for p in pack.personas)
    print(
        f"OK  meadow-core personas: {len(pack.personas)} file(s) ({ids}); "
        "Skip all_messages; Lev/Bana read_only; enable-pack smoke passed"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
