#!/usr/bin/env python3
"""Offline validation for backend release tarballs (backend-runtime-v1).

Checks that a backend artifact archive (or a fixture built offline):
  - contains manifest/backend.json
  - validates that manifest against artifact-manifest.schema.json
  - contains bin/company-brain-backend with the Unix execute bit set
  - optionally matches kind / version / contract majors from a pins YAML

No network calls. Uses stdlib only for archive work; reuses the same
schema rules as validate-artifact-manifests.py (jsonschema optional).
PyYAML is required only when --pins is used (or default self-test pins).

Usage (from repository root):
  python3 scripts/validate-backend-tarball.py
  python3 scripts/validate-backend-tarball.py --tarball path/to/backend.tar.gz
  python3 scripts/validate-backend-tarball.py --tarball path --pins compatibility/pins.example.yaml
  python3 scripts/validate-backend-tarball.py --build-fixture \\
      contracts/backend-runtime-v1/fixtures/backend-conformance-fixture.tar.gz

Default (no --tarball): builds a fixture from the hermes-lanyard example
manifest, validates it, and compares metadata to compatibility/pins.example.yaml.

Exit 0 on success; non-zero on failure.
"""

from __future__ import annotations

import argparse
import importlib.util
import io
import json
import stat
import sys
import tarfile
import tempfile
from pathlib import Path
from typing import Any

MANIFEST_MEMBER = "manifest/backend.json"
ENTRYPOINT_MEMBER = "bin/company-brain-backend"
DEFAULT_ENTRYPOINT = "bin/company-brain-backend"


def _load_artifact_validator(scripts_dir: Path) -> Any:
    """Load validate-artifact-manifests.py as a module (hyphenated filename)."""
    path = scripts_dir / "validate-artifact-manifests.py"
    spec = importlib.util.spec_from_file_location(
        "validate_artifact_manifests", path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_pins_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "PyYAML is required to load pins YAML "
            f"({path}); install pyyaml or omit --pins"
        ) from e
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: pins root must be a mapping")
    return data


def normalize_archive_path(name: str) -> str:
    """Strip leading ./ and collapse //; keep relative POSIX path."""
    n = name.replace("\\", "/").lstrip("/")
    while n.startswith("./"):
        n = n[2:]
    return n


def flatten_prefix(names: list[str]) -> str | None:
    """If all members share a single top-level directory, return that prefix.

    Mirrors deploy bootstrap flatten: release tarballs often wrap payload in
    one directory (e.g. payload/bin/..., payload/manifest/...).
    """
    tops: set[str] = set()
    for raw in names:
        n = normalize_archive_path(raw)
        if not n or n.endswith("/"):
            # directory entries still contribute a top component
            n = n.rstrip("/")
            if not n:
                continue
        parts = n.split("/")
        if parts[0] in (".", ".."):
            continue
        tops.add(parts[0])
        if len(tops) > 1:
            return None
    if len(tops) != 1:
        return None
    top = next(iter(tops))
    # Only flatten when the sole top looks like a wrapper dir (not a file root)
    # Heuristic: at least one member is top/<something>
    has_nested = any(
        normalize_archive_path(n).startswith(top + "/")
        for n in names
        if normalize_archive_path(n) and not normalize_archive_path(n).endswith("/")
    )
    return top if has_nested else None


def member_relpath(name: str, prefix: str | None) -> str:
    n = normalize_archive_path(name)
    if prefix and (n == prefix or n.startswith(prefix + "/")):
        n = n[len(prefix) :].lstrip("/")
    return n


def open_tarball(path: Path) -> tarfile.TarFile:
    # Accept .tar.gz / .tgz / .tar
    return tarfile.open(path, mode="r:*")


def list_logical_members(tf: tarfile.TarFile) -> tuple[list[str], str | None]:
    names = [m.name for m in tf.getmembers()]
    prefix = flatten_prefix(names)
    logical = []
    for m in tf.getmembers():
        rel = member_relpath(m.name, prefix)
        if rel:
            logical.append(rel)
    return logical, prefix


def find_member(
    tf: tarfile.TarFile, logical_name: str, prefix: str | None
) -> tarfile.TarInfo | None:
    for m in tf.getmembers():
        if member_relpath(m.name, prefix) == logical_name:
            return m
    return None


def extract_member_bytes(
    tf: tarfile.TarFile, member: tarfile.TarInfo
) -> bytes:
    f = tf.extractfile(member)
    if f is None:
        raise ValueError(f"cannot extract {member.name}")
    with f:
        return f.read()


def is_executable_mode(mode: int) -> bool:
    return bool(mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH))


def build_fixture_tarball(
    root: Path,
    out_path: Path,
    *,
    kind_example: str = "hermes-lanyard",
) -> dict[str, Any]:
    """Build a minimal offline backend tarball from contract examples.

    Layout (archive root):
      bin/company-brain-backend   # executable stub
      manifest/backend.json
      config/defaults.yaml
      docs/backend-release.md
    """
    example = (
        root
        / "contracts"
        / "backend-runtime-v1"
        / "examples"
        / f"{kind_example}.manifest.json"
    )
    if not example.is_file():
        raise FileNotFoundError(f"missing example manifest: {example}")

    manifest = load_json(example)
    if not isinstance(manifest, dict):
        raise ValueError("example manifest must be a JSON object")

    entrypoint = manifest.get("entrypoint") or DEFAULT_ENTRYPOINT
    if not isinstance(entrypoint, str) or not entrypoint:
        raise ValueError("manifest.entrypoint must be a non-empty string")

    out_path.parent.mkdir(parents=True, exist_ok=True)

    stub = (
        "#!/bin/sh\n"
        "# Offline conformance fixture entrypoint (lp-k7g.11.2).\n"
        "# Real backends implement: $0 gateway …\n"
        'echo "company-brain-backend fixture: $*"\n'
        "exit 0\n"
    )
    defaults = (
        "# Fixture config defaults (not a full runtime config).\n"
        "schema_version: 1\n"
        "fixture: true\n"
    )
    docs = (
        "# Backend release notes (fixture)\n\n"
        "Offline tarball fixture for monorepo conformance "
        "(lp-k7g.11.2).\n"
    )

    # Build tar.gz with explicit executable mode on the entrypoint.
    with tarfile.open(out_path, mode="w:gz") as tf:
        def add_bytes(name: str, data: bytes, *, mode: int = 0o644) -> None:
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            info.mode = mode
            info.type = tarfile.REGTYPE
            info.mtime = 0
            tf.addfile(info, io.BytesIO(data))

        add_bytes(
            entrypoint,
            stub.encode("utf-8"),
            mode=0o755,
        )
        add_bytes(
            MANIFEST_MEMBER,
            (json.dumps(manifest, indent=2) + "\n").encode("utf-8"),
            mode=0o644,
        )
        if manifest.get("config_defaults"):
            add_bytes(
                str(manifest["config_defaults"]),
                defaults.encode("utf-8"),
                mode=0o644,
            )
        if manifest.get("docs"):
            add_bytes(
                str(manifest["docs"]),
                docs.encode("utf-8"),
                mode=0o644,
            )

    return manifest


def compare_manifest_to_pins(
    manifest: dict[str, Any], pins: dict[str, Any]
) -> list[str]:
    """Return error strings if version/kind/contract do not match pins.backend."""
    errors: list[str] = []
    backend = pins.get("backend")
    if not isinstance(backend, dict):
        return ["pins: missing object 'backend'"]

    for field in ("kind", "version"):
        mval = manifest.get(field)
        pval = backend.get(field)
        if pval is None:
            errors.append(f"pins.backend missing '{field}'")
            continue
        if mval != pval:
            errors.append(
                f"manifest.{field}={mval!r} does not match "
                f"pins.backend.{field}={pval!r}"
            )

    m_contract = manifest.get("contract")
    p_contract = backend.get("contract")
    if not isinstance(m_contract, dict):
        errors.append("manifest.contract must be an object")
        return errors
    if not isinstance(p_contract, dict):
        errors.append("pins.backend.contract must be an object")
        return errors

    for ck in ("runtime_layout", "relay", "brain_rpc"):
        if ck not in p_contract:
            errors.append(f"pins.backend.contract missing '{ck}'")
            continue
        if ck not in m_contract:
            errors.append(f"manifest.contract missing '{ck}'")
            continue
        if m_contract[ck] != p_contract[ck]:
            errors.append(
                f"manifest.contract.{ck}={m_contract[ck]!r} does not match "
                f"pins.backend.contract.{ck}={p_contract[ck]!r}"
            )

    return errors


def validate_tarball(
    tarball: Path,
    schema: dict[str, Any],
    artifact_mod: Any,
    *,
    prefer_jsonschema: bool,
    pins: dict[str, Any] | None,
) -> list[str]:
    """Validate one tarball; return list of failure messages (empty = OK)."""
    errors: list[str] = []

    if not tarball.is_file():
        return [f"tarball not found: {tarball}"]

    try:
        tf = open_tarball(tarball)
    except (OSError, tarfile.TarError) as e:
        return [f"cannot open tarball {tarball}: {e}"]

    with tf:
        logical_names, prefix = list_logical_members(tf)

        # --- manifest ---
        man_info = find_member(tf, MANIFEST_MEMBER, prefix)
        if man_info is None:
            errors.append(
                f"missing {MANIFEST_MEMBER} "
                f"(prefix={prefix!r}; members sample={logical_names[:12]})"
            )
            manifest: dict[str, Any] | None = None
        elif not man_info.isfile():
            errors.append(f"{MANIFEST_MEMBER} is not a regular file")
            manifest = None
        else:
            try:
                raw = extract_member_bytes(tf, man_info)
                parsed = json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError, tarfile.TarError) as e:
                errors.append(f"{MANIFEST_MEMBER}: cannot parse JSON: {e}")
                manifest = None
            else:
                if not isinstance(parsed, dict):
                    errors.append(f"{MANIFEST_MEMBER}: must be a JSON object")
                    manifest = None
                else:
                    schema_errors = artifact_mod.validate_instance(
                        schema, parsed, prefer_jsonschema=prefer_jsonschema
                    )
                    if schema_errors:
                        for se in schema_errors:
                            errors.append(f"{MANIFEST_MEMBER}: {se}")
                    manifest = parsed

        # --- entrypoint ---
        entrypoint_path = DEFAULT_ENTRYPOINT
        if manifest and isinstance(manifest.get("entrypoint"), str):
            entrypoint_path = manifest["entrypoint"]

        ent_info = find_member(tf, entrypoint_path, prefix)
        # Also require the contract reference name when different
        ref_info = find_member(tf, ENTRYPOINT_MEMBER, prefix)

        if ent_info is None:
            errors.append(
                f"missing entrypoint {entrypoint_path!r} in archive"
            )
        else:
            if not ent_info.isfile():
                errors.append(f"entrypoint {entrypoint_path!r} is not a file")
            if not is_executable_mode(ent_info.mode):
                errors.append(
                    f"entrypoint {entrypoint_path!r} is not executable "
                    f"(mode={oct(ent_info.mode & 0o777)})"
                )
            # Size > 0 so empty placeholder files fail
            if ent_info.size <= 0:
                errors.append(f"entrypoint {entrypoint_path!r} is empty")

        if entrypoint_path != ENTRYPOINT_MEMBER and ref_info is None:
            errors.append(
                f"contract reference entrypoint {ENTRYPOINT_MEMBER!r} "
                f"missing (manifest.entrypoint={entrypoint_path!r})"
            )

        # --- pins ---
        if pins is not None and manifest is not None and not any(
            e.startswith(f"{MANIFEST_MEMBER}:") for e in errors
        ):
            # Only compare pins when schema validation of manifest succeeded
            pin_errors = compare_manifest_to_pins(manifest, pins)
            errors.extend(pin_errors)

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Repository root (default: parent of scripts/)",
    )
    parser.add_argument(
        "--tarball",
        type=Path,
        default=None,
        help="Path to backend.tar.gz (or .tar) to validate",
    )
    parser.add_argument(
        "--pins",
        type=Path,
        default=None,
        help=(
            "Compatibility pins YAML; when set, require "
            "manifest kind/version/contract to match pins.backend"
        ),
    )
    parser.add_argument(
        "--build-fixture",
        type=Path,
        default=None,
        metavar="OUT",
        help="Write an offline fixture tarball to OUT and exit after write+validate",
    )
    parser.add_argument(
        "--no-pins",
        action="store_true",
        help="Skip pin comparison even in default self-test mode",
    )
    args = parser.parse_args()

    if args.root is not None:
        root = args.root.resolve()
    else:
        root = Path(__file__).resolve().parent.parent

    scripts_dir = root / "scripts"
    contract_dir = root / "contracts" / "backend-runtime-v1"
    schema_path = contract_dir / "artifact-manifest.schema.json"
    fixtures_dir = contract_dir / "fixtures"
    default_fixture = fixtures_dir / "backend-conformance-fixture.tar.gz"
    default_pins = root / "compatibility" / "pins.example.yaml"

    failed = 0
    passed = 0

    def pass_(msg: str) -> None:
        nonlocal passed
        passed += 1
        print(f"  PASS  {msg}")

    def fail(msg: str) -> None:
        nonlocal failed
        failed += 1
        print(f"  FAIL  {msg}")

    print("==> Backend tarball validation (offline)")
    print(f"    root: {root}")
    print()

    if not schema_path.is_file():
        fail(f"missing schema: {schema_path.relative_to(root)}")
        print()
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1

    try:
        schema = load_json(schema_path)
    except (OSError, json.JSONDecodeError) as e:
        fail(f"schema not loadable: {e}")
        print()
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1
    pass_(f"schema loadable ({schema_path.relative_to(root)})")

    try:
        artifact_mod = _load_artifact_validator(scripts_dir)
    except (OSError, RuntimeError, ImportError) as e:
        fail(f"cannot load validate-artifact-manifests.py: {e}")
        print()
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1

    try:
        import jsonschema  # type: ignore  # noqa: F401

        use_js = True
        engine = "jsonschema"
    except ImportError:
        use_js = False
        engine = "stdlib-subset"
    print(f"    validator engine: {engine}")
    print()

    # Resolve pins
    pins: dict[str, Any] | None = None
    pins_path: Path | None = None
    if args.pins is not None:
        pins_path = args.pins if args.pins.is_absolute() else root / args.pins
    elif not args.no_pins and args.tarball is None and args.build_fixture is None:
        # Default self-test: compare fixture to example pins
        pins_path = default_pins
    elif not args.no_pins and args.tarball is not None and args.pins is None:
        pins_path = None  # explicit tarball without --pins: no pin check
    elif not args.no_pins and args.build_fixture is not None:
        pins_path = default_pins

    if pins_path is not None:
        if not pins_path.is_file():
            fail(f"pins file missing: {pins_path}")
            print()
            print(f"FAILED  {failed} failure(s), {passed} pass(es).")
            return 1
        try:
            pins = load_pins_yaml(pins_path)
        except (OSError, RuntimeError, ValueError) as e:
            fail(f"cannot load pins: {e}")
            print()
            print(f"FAILED  {failed} failure(s), {passed} pass(es).")
            return 1
        rel_pins = (
            pins_path.relative_to(root)
            if pins_path.is_relative_to(root)
            else pins_path
        )
        pass_(f"pins loaded ({rel_pins})")

    # Determine which tarball(s) to validate
    tarballs: list[tuple[str, Path]] = []
    tmp_dir: tempfile.TemporaryDirectory[str] | None = None

    try:
        if args.build_fixture is not None:
            out = (
                args.build_fixture
                if args.build_fixture.is_absolute()
                else root / args.build_fixture
            )
            try:
                manifest = build_fixture_tarball(root, out)
            except (OSError, ValueError, FileNotFoundError) as e:
                fail(f"build fixture: {e}")
                print()
                print(f"FAILED  {failed} failure(s), {passed} pass(es).")
                return 1
            pass_(
                f"built fixture {out} "
                f"(kind={manifest.get('kind')}, version={manifest.get('version')})"
            )
            tarballs.append(("built-fixture", out))
        elif args.tarball is not None:
            tb = args.tarball if args.tarball.is_absolute() else root / args.tarball
            tarballs.append(("cli-tarball", tb))
        else:
            # Default self-test: build fixture under tmp (and refresh committed path)
            tmp_dir = tempfile.TemporaryDirectory(prefix="backend-tarball-")
            tmp_path = Path(tmp_dir.name) / "backend-conformance-fixture.tar.gz"
            try:
                manifest = build_fixture_tarball(root, tmp_path)
            except (OSError, ValueError, FileNotFoundError) as e:
                fail(f"build fixture: {e}")
                print()
                print(f"FAILED  {failed} failure(s), {passed} pass(es).")
                return 1
            pass_(
                f"built offline fixture "
                f"(kind={manifest.get('kind')}, version={manifest.get('version')})"
            )
            tarballs.append(("self-test-fixture", tmp_path))

            # If a committed fixture exists, validate it too (stable offline path).
            if default_fixture.is_file():
                tarballs.append(
                    ("committed-fixture", default_fixture.resolve())
                )

        for label, tb in tarballs:
            print()
            print(f"  validating [{label}] {tb}")
            errs = validate_tarball(
                tb,
                schema,
                artifact_mod,
                prefer_jsonschema=use_js,
                pins=pins,
            )
            if errs:
                for e in errs:
                    fail(f"{label}: {e}")
            else:
                pin_note = " + pins match" if pins is not None else ""
                pass_(
                    f"{label}: manifest schema OK, "
                    f"{ENTRYPOINT_MEMBER} executable{pin_note}"
                )

        # Negative checks on a deliberately broken tarball (self-test only)
        if args.tarball is None and args.build_fixture is None:
            print()
            print("  negative cases (must reject)")
            assert tmp_dir is not None
            bad_dir = Path(tmp_dir.name)
            # missing manifest
            bad1 = bad_dir / "missing-manifest.tar.gz"
            with tarfile.open(bad1, mode="w:gz") as tf:
                data = b"#!/bin/sh\nexit 0\n"
                info = tarfile.TarInfo(name=ENTRYPOINT_MEMBER)
                info.size = len(data)
                info.mode = 0o755
                tf.addfile(info, io.BytesIO(data))
            errs = validate_tarball(
                bad1, schema, artifact_mod, prefer_jsonschema=use_js, pins=None
            )
            if any("missing manifest/backend.json" in e for e in errs):
                pass_("missing_manifest: rejected")
            else:
                fail(f"missing_manifest: expected rejection, got {errs!r}")

            # non-executable entrypoint
            bad2 = bad_dir / "nonexec-entrypoint.tar.gz"
            with tarfile.open(bad2, mode="w:gz") as tf:
                man = (
                    root
                    / "contracts"
                    / "backend-runtime-v1"
                    / "examples"
                    / "hermes-lanyard.manifest.json"
                )
                mbytes = man.read_bytes()
                info = tarfile.TarInfo(name=MANIFEST_MEMBER)
                info.size = len(mbytes)
                info.mode = 0o644
                tf.addfile(info, io.BytesIO(mbytes))
                data = b"#!/bin/sh\nexit 0\n"
                info = tarfile.TarInfo(name=ENTRYPOINT_MEMBER)
                info.size = len(data)
                info.mode = 0o644  # not executable
                tf.addfile(info, io.BytesIO(data))
            errs = validate_tarball(
                bad2, schema, artifact_mod, prefer_jsonschema=use_js, pins=None
            )
            if any("not executable" in e for e in errs):
                pass_("nonexec_entrypoint: rejected")
            else:
                fail(f"nonexec_entrypoint: expected rejection, got {errs!r}")

            # pin mismatch
            if pins is not None:
                bad3 = bad_dir / "pin-mismatch.tar.gz"
                try:
                    # Build from example then rewrite version in archive
                    build_fixture_tarball(root, bad3)
                    with tarfile.open(bad3, mode="r:gz") as src:
                        members = {m.name: m for m in src.getmembers()}
                        files = {
                            n: src.extractfile(m).read()  # type: ignore[union-attr]
                            for n, m in members.items()
                            if m.isfile()
                        }
                    man = json.loads(files[MANIFEST_MEMBER].decode("utf-8"))
                    man["version"] = "v9.9.9-mismatch"
                    files[MANIFEST_MEMBER] = (
                        json.dumps(man, indent=2) + "\n"
                    ).encode("utf-8")
                    with tarfile.open(bad3, mode="w:gz") as dst:
                        for name, data in files.items():
                            info = tarfile.TarInfo(name=name)
                            info.size = len(data)
                            info.mode = (
                                0o755 if name == ENTRYPOINT_MEMBER else 0o644
                            )
                            dst.addfile(info, io.BytesIO(data))
                    errs = validate_tarball(
                        bad3,
                        schema,
                        artifact_mod,
                        prefer_jsonschema=use_js,
                        pins=pins,
                    )
                    if any("does not match" in e and "version" in e for e in errs):
                        pass_("pin_version_mismatch: rejected")
                    else:
                        fail(
                            f"pin_version_mismatch: expected rejection, got {errs!r}"
                        )
                except (OSError, ValueError, KeyError, tarfile.TarError) as e:
                    fail(f"pin_version_mismatch setup failed: {e}")

    finally:
        if tmp_dir is not None:
            tmp_dir.cleanup()

    print()
    if failed:
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1
    print(f"OK  {passed} check(s) passed (offline, no network).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
