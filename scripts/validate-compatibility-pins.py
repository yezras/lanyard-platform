#!/usr/bin/env python3
"""Offline validation for compatibility pins (schema_version 2).

Validates:
  - compatibility/schema.json is loadable JSON Schema (Draft-07)
  - compatibility/pins.example.yaml (or a path argument) conforms
  - policy rules beyond pure schema:
      * artifact URLs must be s3:// or https:// (not git remotes / http)
      * versions must not be mutable git-like refs (main/master/latest/…)
      * backend.kind enum, sha256 format, contract majors
  - negative fixtures are rejected

No network calls. PyYAML required to parse pin YAML. jsonschema optional
for full Draft validation; a stdlib subset checker covers required rules.

Usage (from repository root):
  python3 scripts/validate-compatibility-pins.py
  python3 scripts/validate-compatibility-pins.py --root /path/to/repo
  python3 scripts/validate-compatibility-pins.py path/to/pins.yaml

Exit 0 on success; non-zero on failure.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

BACKEND_KINDS = frozenset({"hermes_upstream", "hermes_lanyard", "lanyard_agent"})
# Platform/product TARGET_ARCH labels (hermes pack + publish). Default product = linux-x86_64.
BACKEND_ARCHES = frozenset({"linux-x86_64", "linux-aarch64"})
REQUIRED_TOP = ("schema_version", "backend", "client_core", "portal")
REQUIRED_BACKEND = ("kind", "version", "sha256", "url", "contract")
REQUIRED_CONTRACT = ("runtime_layout", "relay", "brain_rpc")
REQUIRED_TARBALL = ("version", "sha256", "url")
LEGACY_TOP_KEYS = frozenset({"hermes", "relay_contract"})

# Mutable / branch-like version labels (case-insensitive exact match).
FORBIDDEN_VERSIONS = frozenset(
    {
        "main",
        "master",
        "head",
        "develop",
        "development",
        "trunk",
        "latest",
        "stable",
        "current",
        "tip",
        "default",
    }
)
PLACEHOLDER_VERSIONS = frozenset({"UNCONFIGURED", "REPLACE_ME", "TODO", "TBD"})

SHA256_RE = re.compile(r"^([a-fA-F0-9]{64}|sha256:[a-fA-F0-9]{64})$")
DIGEST_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
# Bare branch-like: no digits, no dots/semver separators — often a floating ref.
BARE_BRANCH_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_yaml(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "PyYAML is required to parse compatibility pin YAML. "
            "Install: python3 -m pip install --user pyyaml"
        ) from e
    return yaml.safe_load(text)


def is_forbidden_version(version: str) -> bool:
    v = version.strip()
    if not v:
        return True
    if v in PLACEHOLDER_VERSIONS:
        return True
    if v.lower() in FORBIDDEN_VERSIONS:
        return True
    # Bare branch-like tokens (no version digits) — e.g. "release", "staging".
    # Allow labels that contain a digit (v0.1.0, build-3) or look like tags.
    if BARE_BRANCH_RE.fullmatch(v) and not any(ch.isdigit() for ch in v):
        # Allow known non-ref labels used in examples / product names only if
        # they are already covered; everything else without a digit is suspect.
        return True
    return False


def is_git_remote_url(url: str) -> bool:
    u = url.strip()
    lower = u.lower()
    if lower.startswith(("git://", "git@", "ssh://git@")):
        return True
    if re.search(r"\.git($|[?#/])", u):
        return True
    if re.search(
        r"(github\.com|gitlab\.com|bitbucket\.org)/[^/]+/[^/]+/(tree|blob|raw)/",
        lower,
    ):
        return True
    return False


def check_artifact_url(label: str, url: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(url, str) or not url.strip():
        errors.append(f"{label}: url must be a non-empty string")
        return errors
    u = url.strip()
    if is_git_remote_url(u):
        errors.append(f"{label}: url looks like a git remote/source tree (got: {u})")
        return errors
    parsed = urlparse(u)
    scheme = (parsed.scheme or "").lower()
    if scheme in ("http", "ws", "wss", "ftp", "file", "git", "ssh"):
        errors.append(
            f"{label}: url uses non-artifact scheme {scheme!r} (got: {u}); "
            "allow only s3:// or https://"
        )
        return errors
    if scheme not in ("s3", "https"):
        errors.append(f"{label}: url must be s3:// or https:// (got: {u})")
        return errors
    # Minimal host/path sanity (s3 needs bucket; https needs host)
    if scheme == "s3":
        # s3://bucket/key — netloc is bucket
        if not parsed.netloc:
            errors.append(f"{label}: s3 url missing bucket (got: {u})")
    elif scheme == "https":
        if not parsed.netloc:
            errors.append(f"{label}: https url missing host (got: {u})")
    return errors


def check_sha256(label: str, raw: Any) -> list[str]:
    if not isinstance(raw, str) or not raw.strip():
        return [f"{label}: sha256 must be a non-empty string"]
    if not SHA256_RE.fullmatch(raw.strip()):
        return [
            f"{label}: sha256 must be 64 hex chars or sha256:<64hex> (got: {raw!r})"
        ]
    return []


def check_version(label: str, version: Any) -> list[str]:
    if not isinstance(version, str) or not version.strip():
        return [f"{label}: version must be a non-empty string"]
    if is_forbidden_version(version):
        return [
            f"{label}: version must not be a mutable/branch-like ref "
            f"(got: {version!r})"
        ]
    return []


def stdlib_validate(instance: Any, path: str = "$") -> list[str]:
    """Subset validator matching compatibility/schema.json + policy rules."""
    errors: list[str] = []

    def err(msg: str) -> None:
        errors.append(f"{path}: {msg}" if not msg.startswith(path) else msg)

    if not isinstance(instance, dict):
        err(f"must be object, got {type(instance).__name__}")
        return errors

    for key in REQUIRED_TOP:
        if key not in instance:
            err(f"missing required property '{key}'")

    for legacy in LEGACY_TOP_KEYS:
        if legacy in instance:
            err(
                f"legacy top-level '{legacy}' is not allowed in schema_version 2 "
                f"(use backend.* / backend.contract.*)"
            )

    sv = instance.get("schema_version")
    if "schema_version" in instance:
        if sv != 2:
            err(f"schema_version must be 2, got {sv!r}")

    # --- backend ---
    backend = instance.get("backend")
    if "backend" in instance:
        if not isinstance(backend, dict):
            err("backend must be an object")
        else:
            bpath = f"{path}.backend" if path != "$" else "backend"
            for key in REQUIRED_BACKEND:
                if key not in backend:
                    errors.append(f"{bpath}: missing required property '{key}'")

            if "client_core" in backend:
                errors.append(
                    f"{bpath}: client_core must not be nested under backend "
                    "(keep as top-level block)"
                )

            kind = backend.get("kind")
            if "kind" in backend:
                if not isinstance(kind, str) or kind not in BACKEND_KINDS:
                    errors.append(
                        f"{bpath}.kind: must be one of {sorted(BACKEND_KINDS)}, "
                        f"got {kind!r}"
                    )

            if "version" in backend:
                errors.extend(check_version(f"{bpath}.version", backend.get("version")))
            if "sha256" in backend:
                errors.extend(check_sha256(f"{bpath}.sha256", backend.get("sha256")))
            if "url" in backend:
                errors.extend(check_artifact_url(f"{bpath}.url", backend.get("url")))

            contract = backend.get("contract")
            if "contract" in backend:
                if not isinstance(contract, dict):
                    errors.append(f"{bpath}.contract: must be an object")
                else:
                    for ck in REQUIRED_CONTRACT:
                        if ck not in contract:
                            errors.append(
                                f"{bpath}.contract: missing required property '{ck}'"
                            )
                        else:
                            val = contract[ck]
                            if (
                                not isinstance(val, int)
                                or isinstance(val, bool)
                                or val < 1
                            ):
                                errors.append(
                                    f"{bpath}.contract.{ck}: must be integer >= 1, "
                                    f"got {val!r}"
                                )

            arch = backend.get("arch")
            if "arch" in backend:
                if not isinstance(arch, str) or arch not in BACKEND_ARCHES:
                    errors.append(
                        f"{bpath}.arch: must be one of {sorted(BACKEND_ARCHES)} "
                        f"(default product linux-x86_64), got {arch!r}"
                    )

            sig = backend.get("signature_b64")
            if sig is not None and (not isinstance(sig, str) or not sig.strip()):
                errors.append(f"{bpath}.signature_b64: must be non-empty string when set")

    # --- client_core ---
    client = instance.get("client_core")
    if "client_core" in instance:
        if not isinstance(client, dict):
            err("client_core must be an object")
        else:
            cpath = "client_core"
            for key in REQUIRED_TARBALL:
                if key not in client:
                    errors.append(f"{cpath}: missing required property '{key}'")
            if "version" in client:
                errors.extend(check_version(f"{cpath}.version", client.get("version")))
            if "sha256" in client:
                errors.extend(check_sha256(f"{cpath}.sha256", client.get("sha256")))
            if "url" in client:
                errors.extend(check_artifact_url(f"{cpath}.url", client.get("url")))

    # --- portal ---
    portal = instance.get("portal")
    if "portal" in instance:
        if not isinstance(portal, dict):
            err("portal must be an object")
        else:
            ppath = "portal"
            if "images" not in portal:
                errors.append(f"{ppath}: missing required property 'images'")
            else:
                images = portal.get("images")
                if not isinstance(images, dict) or len(images) < 1:
                    errors.append(
                        f"{ppath}.images: must be a non-empty mapping of image pins"
                    )
                else:
                    for name, img in images.items():
                        ip = f"{ppath}.images.{name}"
                        if not isinstance(img, dict):
                            errors.append(f"{ip}: must be an object")
                            continue
                        repo = img.get("repository")
                        if not isinstance(repo, str) or not repo.strip():
                            errors.append(f"{ip}.repository: required non-empty string")
                        digest = img.get("digest")
                        if not isinstance(digest, str) or not DIGEST_RE.fullmatch(
                            digest or ""
                        ):
                            errors.append(
                                f"{ip}.digest: must match sha256:<64 lowercase hex> "
                                f"(got: {digest!r})"
                            )

            web = portal.get("web")
            if web is not None:
                if not isinstance(web, dict):
                    errors.append(f"{ppath}.web: must be an object when present")
                else:
                    for key in REQUIRED_TARBALL:
                        if key not in web:
                            errors.append(
                                f"{ppath}.web: missing required property '{key}'"
                            )
                    if "version" in web:
                        errors.extend(
                            check_version(f"{ppath}.web.version", web.get("version"))
                        )
                    if "sha256" in web:
                        errors.extend(
                            check_sha256(f"{ppath}.web.sha256", web.get("sha256"))
                        )
                    if "url" in web:
                        errors.extend(
                            check_artifact_url(f"{ppath}.web.url", web.get("url"))
                        )

    # --- optional artifact_attestation ---
    att = instance.get("artifact_attestation")
    if att is not None:
        if not isinstance(att, dict):
            err("artifact_attestation must be an object")
        else:
            alg = att.get("alg")
            if alg is not None and alg != "ed25519":
                errors.append(
                    f"artifact_attestation.alg: must be 'ed25519' when set, got {alg!r}"
                )

    return errors


def jsonschema_validate(schema: dict, instance: Any) -> list[str] | None:
    """Return validation errors, or None if jsonschema is not installed."""
    try:
        import jsonschema  # type: ignore
    except ImportError:
        return None

    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '$'}: {e.message}"
        for e in validator.iter_errors(instance)
    ]


def validate_instance(schema: dict | None, instance: Any) -> list[str]:
    """Combine JSON Schema (if available) with policy/stdlib checks."""
    policy_errors = stdlib_validate(instance)
    if schema is None:
        return policy_errors
    js_errors = jsonschema_validate(schema, instance)
    if js_errors is None:
        return policy_errors
    # Merge unique messages; policy catches URL/version rules schema may miss.
    seen: set[str] = set()
    merged: list[str] = []
    for e in js_errors + policy_errors:
        if e not in seen:
            seen.add(e)
            merged.append(e)
    return merged


def make_valid_base() -> dict[str, Any]:
    """Minimal valid schema_version 2 pin document for negative cases."""
    return {
        "schema_version": 2,
        "backend": {
            "kind": "hermes_lanyard",
            "version": "v0.0.0-example",
            "sha256": "a" * 64,
            "url": "s3://example-bucket/backends/hermes-lanyard/v0.0.0-example/backend.tar.gz",
            "contract": {
                "runtime_layout": 1,
                "relay": 1,
                "brain_rpc": 1,
            },
        },
        "client_core": {
            "version": "v0.0.0-example",
            "sha256": "b" * 64,
            "url": "s3://example-bucket/client-core/v0.0.0-example/client-core.tar.gz",
        },
        "portal": {
            "web": {
                "version": "v0.0.0-example",
                "sha256": "c" * 64,
                "url": "s3://example-bucket/portal-web/v0.0.0-example/portal-web.tar.gz",
            },
            "images": {
                "bff": {
                    "repository": "example.dkr.ecr.example.amazonaws.com/portal/bff",
                    "digest": "sha256:" + ("0" * 64),
                }
            },
        },
    }


def negative_cases() -> list[tuple[str, dict[str, Any]]]:
    """Invalid instances that must be rejected."""
    cases: list[tuple[str, dict[str, Any]]] = []
    base = make_valid_base()

    # Mutable / branch-like backend versions
    for bad_ver in ("main", "master", "latest", "HEAD", "develop", "trunk", "stable"):
        bad = copy.deepcopy(base)
        bad["backend"]["version"] = bad_ver
        cases.append((f"backend_version_{bad_ver}", bad))

    # Bare branch-like without digits
    bare = copy.deepcopy(base)
    bare["backend"]["version"] = "release"
    cases.append(("backend_version_bare_branch", bare))

    # client_core / portal.web mutable versions
    for block, key in (("client_core", "version"),):
        bad = copy.deepcopy(base)
        bad[block][key] = "main"
        cases.append((f"{block}_version_main", bad))
    bad = copy.deepcopy(base)
    bad["portal"]["web"]["version"] = "latest"
    cases.append(("portal_web_version_latest", bad))

    # Bad URLs
    for scheme, label in (
        ("http://example.invalid/a.tar.gz", "http"),
        ("git://example.invalid/repo.git", "git"),
        ("git@github.com:org/repo.git", "git_ssh"),
        ("https://github.com/org/repo/tree/main/file", "github_tree"),
        ("ftp://example.invalid/a.tar.gz", "ftp"),
        ("file:///tmp/a.tar.gz", "file"),
        ("not-a-url", "no_scheme"),
    ):
        bad = copy.deepcopy(base)
        bad["backend"]["url"] = scheme
        cases.append((f"backend_url_{label}", bad))

    # Accept path for s3/https is tested via positive pins.example.yaml;
    # also reject empty url
    bad = copy.deepcopy(base)
    bad["backend"]["url"] = ""
    cases.append(("backend_url_empty", bad))

    # Bad sha256
    for raw, label in (
        ("deadbeef", "too_short"),
        ("g" * 64, "non_hex"),
        ("sha256:abc", "prefix_short"),
        ("", "empty"),
    ):
        bad = copy.deepcopy(base)
        bad["backend"]["sha256"] = raw
        cases.append((f"backend_sha256_{label}", bad))

    # Bad kind
    bad = copy.deepcopy(base)
    bad["backend"]["kind"] = "not_a_backend"
    cases.append(("backend_kind_invalid", bad))

    bad = copy.deepcopy(base)
    del bad["backend"]["kind"]
    cases.append(("backend_kind_missing", bad))

    # Bad arch (optional field; when set must be a known TARGET_ARCH label)
    bad = copy.deepcopy(base)
    bad["backend"]["arch"] = "linux-arm64"  # product label is linux-aarch64
    cases.append(("backend_arch_invalid", bad))

    bad = copy.deepcopy(base)
    bad["backend"]["arch"] = "amd64"
    cases.append(("backend_arch_short_label", bad))

    # Missing / bad contract majors
    bad = copy.deepcopy(base)
    del bad["backend"]["contract"]["relay"]
    cases.append(("backend_contract_missing_relay", bad))

    bad = copy.deepcopy(base)
    bad["backend"]["contract"]["brain_rpc"] = 0
    cases.append(("backend_contract_brain_rpc_zero", bad))

    bad = copy.deepcopy(base)
    bad["backend"]["contract"]["runtime_layout"] = "1"  # type: ignore[assignment]
    cases.append(("backend_contract_runtime_layout_string", bad))

    # Nested client_core under backend
    bad = copy.deepcopy(base)
    bad["backend"]["client_core"] = copy.deepcopy(base["client_core"])
    cases.append(("client_core_nested_under_backend", bad))

    # Legacy v1 top-level keys
    bad = copy.deepcopy(base)
    bad["hermes"] = {
        "version": "v0.1.0",
        "sha256": "d" * 64,
        "url": "s3://example/hermes.tar.gz",
    }
    cases.append(("legacy_hermes_top_level", bad))

    bad = copy.deepcopy(base)
    bad["relay_contract"] = {"major": 1}
    cases.append(("legacy_relay_contract_top_level", bad))

    # Wrong schema_version
    bad = copy.deepcopy(base)
    bad["schema_version"] = 1
    cases.append(("schema_version_1", bad))

    # Bad image digest
    bad = copy.deepcopy(base)
    bad["portal"]["images"]["bff"]["digest"] = "sha256:deadbeef"
    cases.append(("portal_image_digest_short", bad))

    # Missing top-level client_core
    bad = copy.deepcopy(base)
    del bad["client_core"]
    cases.append(("missing_client_core", bad))

    return cases


def positive_url_cases() -> list[tuple[str, str]]:
    """Valid artifact URL samples (policy only)."""
    return [
        ("s3_backend", "s3://example-artifacts-bucket/backends/x/v1/backend.tar.gz"),
        (
            "https_release",
            "https://github.com/example/releases/download/v0.1.0/backend.tar.gz",
        ),
        ("https_s3_virtual", "https://bucket.s3.amazonaws.com/path/to/artifact.tar.gz"),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Repository root (default: parent of scripts/)",
    )
    parser.add_argument(
        "pins",
        nargs="?",
        type=Path,
        default=None,
        help="Pin YAML to validate (default: compatibility/pins.example.yaml)",
    )
    parser.add_argument(
        "--skip-negatives",
        action="store_true",
        help="Skip built-in negative fixture checks",
    )
    args = parser.parse_args()

    if args.root is not None:
        root = args.root.resolve()
    else:
        root = Path(__file__).resolve().parent.parent

    schema_path = root / "compatibility" / "schema.json"
    default_pins = root / "compatibility" / "pins.example.yaml"
    pins_path = (args.pins if args.pins is not None else default_pins).resolve()

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

    print("==> Compatibility pins validation (schema_version 2, offline)")
    print(f"    root: {root}")
    print(f"    pins: {pins_path}")
    print()

    schema: dict | None = None
    if not schema_path.is_file():
        fail(f"missing schema: {schema_path.relative_to(root)}")
    else:
        try:
            schema = load_json(schema_path)
        except (OSError, json.JSONDecodeError) as e:
            fail(f"schema not loadable: {e}")
            schema = None
        else:
            if not isinstance(schema, dict) or schema.get("type") != "object":
                fail("schema must be a JSON Schema object with type=object")
            else:
                required = schema.get("required") or []
                for field in REQUIRED_TOP:
                    if field not in required:
                        fail(f"schema.required must include '{field}'")
                props = schema.get("properties") or {}
                sv = props.get("schema_version") or {}
                if sv.get("const") != 2:
                    fail(f"schema schema_version.const must be 2, got {sv.get('const')!r}")
                kind_enum = (
                    (props.get("backend") or {}).get("properties") or {}
                ).get("kind", {}).get("enum")
                if not kind_enum or set(kind_enum) != set(BACKEND_KINDS):
                    fail(
                        f"schema backend.kind.enum must be {sorted(BACKEND_KINDS)}, "
                        f"got {kind_enum!r}"
                    )
                if failed == 0:
                    pass_(
                        "schema loadable; schema_version const=2; "
                        f"kinds={sorted(BACKEND_KINDS)}"
                    )

    try:
        import jsonschema  # type: ignore  # noqa: F401

        engine = "jsonschema+policy"
    except ImportError:
        engine = "stdlib-policy"
    print(f"    validator engine: {engine}")
    print()

    # Positive: pins file
    if not pins_path.is_file():
        fail(f"missing pins file: {pins_path}")
    else:
        try:
            data = load_yaml(pins_path)
        except RuntimeError as e:
            fail(str(e))
            data = None
        except Exception as e:  # noqa: BLE001 — surface parse errors clearly
            fail(f"cannot parse pins YAML: {e}")
            data = None

        if data is not None:
            errors = validate_instance(schema, data)
            try:
                rel = pins_path.relative_to(root)
            except ValueError:
                rel = pins_path
            if errors:
                for e in errors:
                    fail(f"{rel}: {e}")
            else:
                kind = (
                    data.get("backend", {}).get("kind")
                    if isinstance(data.get("backend"), dict)
                    else None
                )
                pass_(
                    f"{rel} validates "
                    f"(schema_version={data.get('schema_version')}, "
                    f"backend.kind={kind})"
                )

    # Positive: s3 + https URL policy self-checks
    print()
    print("  positive URL policy (s3 / https)")
    for name, url in positive_url_cases():
        errs = check_artifact_url("selfcheck", url)
        if errs:
            fail(f"url_{name}: expected accept, got {errs}")
        else:
            pass_(f"url_{name}: accepted")

    # sha256 prefix form accepted
    for form, raw in (
        ("plain64", "a" * 64),
        ("sha256_prefix", "sha256:" + ("b" * 64)),
        ("uppercase_hex", "A" * 64),
    ):
        errs = check_sha256("selfcheck", raw)
        if errs:
            fail(f"sha256_{form}: expected accept, got {errs}")
        else:
            pass_(f"sha256_{form}: accepted")

    # Negative fixtures
    if not args.skip_negatives:
        print()
        print("  negative cases (must reject)")
        for name, instance in negative_cases():
            errors = validate_instance(schema, instance)
            if not errors:
                fail(f"{name}: expected validation errors, got none")
            else:
                pass_(f"{name}: rejected ({len(errors)} error(s))")

        # Internal helper self-checks
        if not is_forbidden_version("main"):
            fail("internal: main should be forbidden")
        else:
            pass_("internal: main forbidden")
        if is_forbidden_version("v0.1.0"):
            fail("internal: v0.1.0 should be allowed")
        else:
            pass_("internal: v0.1.0 allowed")

    print()
    if failed:
        print(f"FAILED  {failed} failure(s), {passed} pass(es).")
        return 1
    print(f"OK  {passed} check(s) passed (offline, no network).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
