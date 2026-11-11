#!/usr/bin/env python3
"""Hermes-Lanyard artifact conformance job (lp-k7g.11.4).

Orchestrates the first backend product conformance run against the
``backend-runtime-v1`` contract:

  1. Resolve a ``hermes_lanyard`` artifact from pins (or offline fixture)
  2. Validate tarball (manifest schema, executable entrypoint, pin match)
  3. Start a backend session on the fake relay harness
  4. Run required contract checks (hello + Brain RPC required methods + ACL)

Modes
-----
``offline`` (default)
    No network. Uses the committed fixture under
    ``contracts/backend-runtime-v1/fixtures/backend-conformance-fixture.tar.gz``
    (built from the hermes-lanyard example manifest) and the in-process
    reference backend path (``FakeBrainRpcHost`` + ``FakeBackendClient``).

``download``
    Fetch ``pins.backend.url`` (``s3://`` or ``https://``), verify SHA-256,
    then run the same validation + harness checks. Requires network and
    credentials when the URL is private:

      * ``s3://``  — AWS CLI + instance/role credentials
      * ``https://`` public — ``curl`` or ``wget``
      * private GitHub release — ``GITHUB_TOKEN`` or ``GH_TOKEN`` + ``curl``

    Download mode still drives Brain RPC over the **fake relay + reference
    host** unless/until a live gateway adapter is added (product binaries are
    external; this monorepo owns the contract harness).

Usage (from repository root)::

  python3 scripts/run-hermes-lanyard-conformance.py
  python3 scripts/run-hermes-lanyard-conformance.py --mode offline
  python3 scripts/run-hermes-lanyard-conformance.py --mode download \\
      --pins path/to/operator-pins.yaml
  python3 scripts/run-hermes-lanyard-conformance.py --tarball path/to/backend.tar.gz

Wired as **check 21** in ``scripts/validate.sh`` (offline mode only).

Exit 0 on success; non-zero on failure.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

EXPECTED_KIND = "hermes_lanyard"
DEFAULT_FIXTURE = (
    "contracts/backend-runtime-v1/fixtures/backend-conformance-fixture.tar.gz"
)
DEFAULT_PINS = "compatibility/pins.example.yaml"
MANIFEST_MEMBER = "manifest/backend.json"
ENTRYPOINT_MEMBER = "bin/company-brain-backend"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_module(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_pins_yaml(path: Path) -> dict[str, Any]:
    try:
        import yaml  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            f"PyYAML is required to load pins YAML ({path}); install pyyaml"
        ) from e
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: pins root must be a mapping")
    return data


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize_sha256(value: str) -> str:
    v = value.strip().lower()
    if v.startswith("sha256:"):
        v = v[len("sha256:") :]
    return v


# ---------------------------------------------------------------------------
# Artifact resolution
# ---------------------------------------------------------------------------


def resolve_offline_tarball(
    root: Path,
    *,
    tarball: Path | None,
    fixture_path: Path,
) -> tuple[Path, str]:
    """Return (tarball_path, source_label). Never hits the network."""
    if tarball is not None:
        tb = tarball if tarball.is_absolute() else root / tarball
        if not tb.is_file():
            raise FileNotFoundError(f"tarball not found: {tb}")
        return tb.resolve(), "cli-tarball"

    if fixture_path.is_file():
        return fixture_path.resolve(), "committed-fixture"

    # Build fixture on the fly from hermes-lanyard example (same as 11.2).
    tarball_mod = _load_module(
        "validate_backend_tarball",
        root / "scripts" / "validate-backend-tarball.py",
    )
    tmp = Path(tempfile.mkdtemp(prefix="hl-conform-fixture-"))
    out = tmp / "backend-conformance-fixture.tar.gz"
    tarball_mod.build_fixture_tarball(root, out)
    return out.resolve(), "built-fixture"


def download_artifact(
    url: str,
    dest: Path,
    *,
    github_token: str | None = None,
) -> None:
    """Download artifact bytes to dest. Supports s3:// and https:// only."""
    parsed = urlparse(url)
    scheme = (parsed.scheme or "").lower()
    dest.parent.mkdir(parents=True, exist_ok=True)

    if scheme == "s3":
        if shutil.which("aws") is None:
            raise RuntimeError(
                "aws CLI required for s3:// artifact URLs "
                "(install awscli and configure credentials / role)"
            )
        subprocess.run(
            ["aws", "s3", "cp", url, str(dest)],
            check=True,
        )
        return

    if scheme != "https":
        raise ValueError(
            f"unsupported artifact URL scheme {scheme!r} "
            f"(need s3:// or https://); got {url!r}"
        )

    # Private GitHub release assets need a token + Accept header.
    is_github = "github.com" in (parsed.netloc or "")
    token = github_token or os.environ.get("GITHUB_TOKEN") or os.environ.get(
        "GH_TOKEN"
    )

    if is_github and token:
        # Prefer curl for GitHub private assets (API Accept header).
        if shutil.which("curl") is None:
            raise RuntimeError(
                "curl required for private GitHub release downloads"
            )
        # Browser download URLs work with Authorization + octet-stream for
        # many private assets; API asset URLs need Accept: application/octet-stream.
        headers = [
            "-H",
            f"Authorization: Bearer {token}",
            "-H",
            "Accept: application/octet-stream",
        ]
        subprocess.run(
            [
                "curl",
                "-fsSL",
                "--retry",
                "3",
                "-L",
                *headers,
                "-o",
                str(dest),
                url,
            ],
            check=True,
        )
        return

    # Public HTTPS (or GitHub without token — may fail on private assets).
    if shutil.which("curl") is not None:
        subprocess.run(
            ["curl", "-fsSL", "--retry", "3", "-L", "-o", str(dest), url],
            check=True,
        )
        return
    if shutil.which("wget") is not None:
        subprocess.run(
            ["wget", "-q", "-O", str(dest), url],
            check=True,
        )
        return

    # Last resort: stdlib urllib (no private GitHub support).
    try:
        with urllib.request.urlopen(url, timeout=120) as resp:  # noqa: S310
            dest.write_bytes(resp.read())
    except urllib.error.URLError as e:
        raise RuntimeError(f"download failed for {url}: {e}") from e


def resolve_download_tarball(
    root: Path,
    pins: dict[str, Any],
    *,
    work_dir: Path,
) -> tuple[Path, str]:
    backend = pins.get("backend")
    if not isinstance(backend, dict):
        raise ValueError("pins: missing object 'backend'")
    url = backend.get("url")
    sha = backend.get("sha256")
    kind = backend.get("kind")
    version = backend.get("version")
    if kind != EXPECTED_KIND:
        raise ValueError(
            f"pins.backend.kind={kind!r} is not {EXPECTED_KIND!r} "
            "(this job only runs Hermes-Lanyard)"
        )
    if not isinstance(url, str) or not url:
        raise ValueError("pins.backend.url must be a non-empty string")
    if not isinstance(sha, str) or not sha:
        raise ValueError("pins.backend.sha256 must be a non-empty string")

    # Placeholder example pins intentionally use fake digests — refuse.
    expected = normalize_sha256(sha)
    if expected == "a" * 64 or url.startswith("s3://example-"):
        raise RuntimeError(
            "refusing download of placeholder pins "
            f"(url={url!r}, sha256 looks like example). "
            "Pass operator pins with real coordinates, or use --mode offline."
        )

    dest = work_dir / f"hermes-lanyard-{version or 'artifact'}.tar.gz"
    print(f"    downloading {url}")
    download_artifact(url, dest)
    actual = sha256_file(dest)
    if actual != expected:
        raise RuntimeError(
            f"SHA-256 mismatch for downloaded artifact:\n"
            f"  expected: {expected}\n"
            f"  actual:   {actual}\n"
            f"  file:     {dest}"
        )
    print(f"    sha256 OK ({actual[:12]}…)")
    return dest.resolve(), "downloaded-pin"


# ---------------------------------------------------------------------------
# Tarball validation + extract
# ---------------------------------------------------------------------------


def validate_hermes_lanyard_tarball(
    root: Path,
    tarball: Path,
    pins: dict[str, Any] | None,
) -> dict[str, Any]:
    """Validate tarball; return manifest dict. Raises on failure."""
    tarball_mod = _load_module(
        "validate_backend_tarball",
        root / "scripts" / "validate-backend-tarball.py",
    )
    artifact_mod = tarball_mod._load_artifact_validator(root / "scripts")
    schema_path = (
        root / "contracts" / "backend-runtime-v1" / "artifact-manifest.schema.json"
    )
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    try:
        import jsonschema  # type: ignore  # noqa: F401

        prefer_js = True
    except ImportError:
        prefer_js = False

    errors = tarball_mod.validate_tarball(
        tarball,
        schema,
        artifact_mod,
        prefer_jsonschema=prefer_js,
        pins=pins,
    )
    if errors:
        raise RuntimeError(
            "tarball validation failed:\n  - " + "\n  - ".join(errors)
        )

    # Load manifest for kind check (validate_tarball already schema-checked).
    with tarfile.open(tarball, mode="r:*") as tf:
        names = [m.name for m in tf.getmembers()]
        prefix = tarball_mod.flatten_prefix(names)
        man_info = tarball_mod.find_member(tf, MANIFEST_MEMBER, prefix)
        if man_info is None:
            raise RuntimeError(f"missing {MANIFEST_MEMBER} after validation?")
        raw = tarball_mod.extract_member_bytes(tf, man_info)
        manifest = json.loads(raw.decode("utf-8"))

    if manifest.get("kind") != EXPECTED_KIND:
        raise RuntimeError(
            f"manifest.kind={manifest.get('kind')!r} is not {EXPECTED_KIND!r}"
        )
    return manifest


def extract_tarball(tarball: Path, dest: Path) -> Path:
    """Extract archive into dest; return payload root (after optional flatten)."""
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tarball, mode="r:*") as tf:
        # Safe extract (Python 3.12+ has filter=; use data filter when available).
        if hasattr(tarfile, "data_filter"):
            tf.extractall(dest, filter="data")  # type: ignore[call-arg]
        else:
            tf.extractall(dest)

    # Flatten single top-level wrapper directory if present.
    children = [p for p in dest.iterdir() if p.name not in (".", "..")]
    if len(children) == 1 and children[0].is_dir():
        # Check if wrapper contains bin/ or manifest/
        wrapper = children[0]
        if (wrapper / "bin").is_dir() or (wrapper / "manifest").is_dir():
            return wrapper
    return dest


def smoke_entrypoint(install_root: Path, entrypoint: str) -> None:
    """Run the fixture/product entrypoint with 'gateway' once (must exit 0)."""
    bin_path = install_root / entrypoint
    if not bin_path.is_file():
        raise FileNotFoundError(f"entrypoint missing after extract: {bin_path}")
    mode = bin_path.stat().st_mode
    if not (mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)):
        raise PermissionError(f"entrypoint not executable: {bin_path}")

    # Offline fixture stub accepts any args and exits 0. Real Hermes-Lanyard
    # would need GATEWAY_RELAY_* env and a live WSS; we only smoke that the
    # binary is present and runnable here.
    env = os.environ.copy()
    env.setdefault("BACKEND_HOME", str(install_root / "runtime-home"))
    env.setdefault("HERMES_HOME", env["BACKEND_HOME"])
    env.setdefault("BACKEND_KIND", EXPECTED_KIND)
    Path(env["BACKEND_HOME"]).mkdir(parents=True, exist_ok=True)

    proc = subprocess.run(
        [str(bin_path), "gateway", "--conformance-smoke"],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"entrypoint smoke failed (rc={proc.returncode}):\n"
            f"  stdout: {proc.stdout!r}\n"
            f"  stderr: {proc.stderr!r}"
        )


# ---------------------------------------------------------------------------
# Fake relay + required contract checks (reference Hermes-Lanyard path)
# ---------------------------------------------------------------------------


def run_fake_relay_contract_checks(
    contract_dir: Path,
) -> list[str]:
    """Start FakeBackendClient on FakeRelayHarness; run required checks.

    Returns list of human-readable pass messages. Raises on first failure.
    """
    harness_parent = contract_dir  # backend-runtime-v1
    if str(harness_parent) not in sys.path:
        sys.path.insert(0, str(harness_parent))

    from harness.fake_backend import FakeBackendClient  # noqa: WPS433
    from harness.fake_brain_rpc import (  # noqa: WPS433
        REQUIRED_BRAIN_RPC_METHODS,
        FakeBrainRpcHost,
        assert_health_result,
        assert_ping_result,
        assert_projects_list_result,
        assert_settings_snapshot_result,
        assert_vault_list_result,
        assert_vault_read_result,
        assert_vault_stat_result,
    )
    from harness.harness import FakeRelayHarness  # noqa: WPS433
    from harness.mock_socket import MockSocket  # noqa: WPS433

    notes: list[str] = []

    relay_sock, gateway_sock = MockSocket.create_pair(
        "relay-hl-job", "gateway-hl-job"
    )
    # In-process reference host mirrors Hermes-Lanyard Brain RPC behavior
    # (product binary stays external; live WSS adapter is a follow-up).
    host = FakeBrainRpcHost()

    harness = FakeRelayHarness(
        relay_sock,
        instance_id="inst_hermes_lanyard_job",
        tenant_id="ten_hermes_lanyard",
    )
    backend = FakeBackendClient(
        gateway_sock,
        brain_rpc=host,
        auto_brain_rpc=True,
        bot_id="bot-hermes-lanyard-conform",
    )

    # 1. Hello + descriptor (fake relay starts backend session)
    backend.connect_hello()
    harness.accept_hello()
    desc = backend.await_descriptor()
    if not isinstance(desc, dict) and backend.descriptor is None:
        raise RuntimeError("descriptor not received after hello")
    notes.append("fake relay: hello accepted, descriptor delivered")

    def call(
        method: str,
        *,
        params: dict | None = None,
        backend_profile: str = "contributor",
        path_prefixes: list[str] | None = None,
        request_id: str,
    ) -> dict:
        prefixes = path_prefixes
        if prefixes is None:
            prefixes = ["/"] if backend_profile == "admin" else ["/Projects"]
        harness.send_brain_rpc(
            method,
            request_id=request_id,
            params=params or {},
            backend_profile=backend_profile,
            path_prefixes=prefixes,
            wait=False,
        )
        backend.poll()
        return harness.wait_brain_rpc_result(request_id)

    # Catalog
    supported = set(host.supported_methods())
    missing = [m for m in REQUIRED_BRAIN_RPC_METHODS if m not in supported]
    if missing:
        raise RuntimeError(f"reference host missing required methods: {missing}")
    notes.append(
        f"required Brain RPC methods present ({len(REQUIRED_BRAIN_RPC_METHODS)})"
    )

    # brain.ping
    frame = call(
        "brain.ping",
        params={"echo": "hl-conform"},
        request_id="hl_ping",
    )
    if not frame.get("ok"):
        raise RuntimeError(f"brain.ping failed: {frame}")
    assert_ping_result(frame["result"])
    if frame["result"].get("echo") != "hl-conform":
        raise RuntimeError("brain.ping echo mismatch")
    notes.append("brain.ping OK")

    # brain.health
    frame = call(
        "brain.health",
        backend_profile="admin",
        path_prefixes=["/"],
        request_id="hl_health",
    )
    if not frame.get("ok"):
        raise RuntimeError(f"brain.health failed: {frame}")
    assert_health_result(frame["result"])
    if frame["result"].get("status") != "ok":
        raise RuntimeError(f"brain.health status={frame['result'].get('status')!r}")
    notes.append("brain.health OK")

    # vault ACL: contributor allowed
    frame = call(
        "vault.list",
        params={"path": "/Projects/Legal"},
        backend_profile="contributor",
        path_prefixes=["/Projects"],
        request_id="hl_vlist_ok",
    )
    if not frame.get("ok"):
        raise RuntimeError(f"vault.list allowed path failed: {frame}")
    assert_vault_list_result(frame["result"])
    notes.append("vault.list (contributor allowed prefix) OK")

    # vault ACL: contributor denied
    frame = call(
        "vault.list",
        params={"path": "/Secrets"},
        backend_profile="contributor",
        path_prefixes=["/Projects"],
        request_id="hl_vlist_deny",
    )
    if frame.get("ok"):
        raise RuntimeError("vault.list outside prefix should be forbidden")
    err = frame.get("error") or {}
    if err.get("code") != "forbidden":
        raise RuntimeError(f"expected forbidden, got {err!r}")
    notes.append("vault.list (contributor forbidden outside prefix) OK")

    # vault.stat + vault.read
    path = "/Projects/Legal/memo.md"
    frame = call(
        "vault.stat",
        params={"path": path},
        backend_profile="contributor",
        path_prefixes=["/Projects"],
        request_id="hl_vstat",
    )
    if not frame.get("ok"):
        raise RuntimeError(f"vault.stat failed: {frame}")
    assert_vault_stat_result(frame["result"])
    notes.append("vault.stat OK")

    frame = call(
        "vault.read",
        params={"path": path},
        backend_profile="contributor",
        path_prefixes=["/Projects"],
        request_id="hl_vread",
    )
    if not frame.get("ok"):
        raise RuntimeError(f"vault.read failed: {frame}")
    assert_vault_read_result(frame["result"])
    notes.append("vault.read OK")

    # settings.snapshot
    frame = call(
        "settings.snapshot",
        backend_profile="admin",
        path_prefixes=["/"],
        request_id="hl_settings",
    )
    if not frame.get("ok"):
        raise RuntimeError(f"settings.snapshot failed: {frame}")
    assert_settings_snapshot_result(frame["result"])
    notes.append("settings.snapshot OK")

    # projects.list
    frame = call(
        "projects.list",
        backend_profile="admin",
        path_prefixes=["/"],
        request_id="hl_projects",
    )
    if not frame.get("ok"):
        raise RuntimeError(f"projects.list failed: {frame}")
    assert_projects_list_result(frame["result"])
    notes.append("projects.list OK")

    # Chat inject smoke (relay contract surface used by Hermes-Lanyard)
    harness.inject_chat("conformance ping", chat_id="hl-chat-1")
    backend.poll()
    notes.append("fake relay: chat inbound inject OK")

    return notes


# ---------------------------------------------------------------------------
# Main job
# ---------------------------------------------------------------------------


class JobReporter:
    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0

    def pass_(self, msg: str) -> None:
        self.passed += 1
        print(f"  PASS  {msg}")

    def fail(self, msg: str) -> None:
        self.failed += 1
        print(f"  FAIL  {msg}")


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
        "--mode",
        choices=("offline", "download"),
        default="offline",
        help="offline (default, fixture) or download (pins URL)",
    )
    parser.add_argument(
        "--pins",
        type=Path,
        default=None,
        help=f"Compatibility pins YAML (default: {DEFAULT_PINS})",
    )
    parser.add_argument(
        "--tarball",
        type=Path,
        default=None,
        help="Explicit local tarball (offline mode; skips fixture resolve)",
    )
    parser.add_argument(
        "--skip-entrypoint-smoke",
        action="store_true",
        help="Skip running bin/company-brain-backend gateway once",
    )
    parser.add_argument(
        "--keep-work",
        action="store_true",
        help="Keep temporary work directory (print path on exit)",
    )
    args = parser.parse_args()

    root = (
        args.root.resolve()
        if args.root is not None
        else Path(__file__).resolve().parent.parent
    )
    contract_dir = root / "contracts" / "backend-runtime-v1"
    pins_path = (
        (args.pins if args.pins.is_absolute() else root / args.pins)
        if args.pins is not None
        else root / DEFAULT_PINS
    )
    fixture_path = root / DEFAULT_FIXTURE

    rep = JobReporter()
    print("==> Hermes-Lanyard artifact conformance job (lp-k7g.11.4)")
    print(f"    root: {root}")
    print(f"    mode: {args.mode}")
    print()

    work = tempfile.mkdtemp(prefix="hl-conform-")
    work_dir = Path(work)
    try:
        # --- pins ---
        if not pins_path.is_file():
            rep.fail(f"pins missing: {pins_path}")
            print()
            print(f"FAILED  {rep.failed} failure(s), {rep.passed} pass(es).")
            return 1
        try:
            pins = load_pins_yaml(pins_path)
        except (OSError, RuntimeError, ValueError) as e:
            rep.fail(f"cannot load pins: {e}")
            print()
            print(f"FAILED  {rep.failed} failure(s), {rep.passed} pass(es).")
            return 1

        backend = pins.get("backend")
        if not isinstance(backend, dict):
            rep.fail("pins: missing object 'backend'")
            print()
            print(f"FAILED  {rep.failed} failure(s), {rep.passed} pass(es).")
            return 1
        if backend.get("kind") != EXPECTED_KIND:
            rep.fail(
                f"pins.backend.kind={backend.get('kind')!r} "
                f"(expected {EXPECTED_KIND!r})"
            )
            print()
            print(f"FAILED  {rep.failed} failure(s), {rep.passed} pass(es).")
            return 1
        rel_pins = (
            pins_path.relative_to(root)
            if pins_path.is_relative_to(root)
            else pins_path
        )
        rep.pass_(
            f"pins loaded ({rel_pins}): kind={backend.get('kind')} "
            f"version={backend.get('version')}"
        )

        # --- resolve artifact ---
        try:
            if args.mode == "download":
                tarball, source = resolve_download_tarball(
                    root, pins, work_dir=work_dir
                )
            else:
                tarball, source = resolve_offline_tarball(
                    root,
                    tarball=args.tarball,
                    fixture_path=fixture_path,
                )
        except (OSError, RuntimeError, ValueError, FileNotFoundError) as e:
            rep.fail(f"resolve artifact: {e}")
            print()
            print(f"FAILED  {rep.failed} failure(s), {rep.passed} pass(es).")
            return 1
        rep.pass_(f"artifact resolved [{source}]: {tarball}")

        # --- validate tarball ---
        try:
            # Offline example pins use placeholder sha256/url but matching
            # kind/version/contract to the fixture manifest — pin compare OK.
            manifest = validate_hermes_lanyard_tarball(root, tarball, pins)
        except (OSError, RuntimeError, ValueError) as e:
            rep.fail(f"validate tarball: {e}")
            print()
            print(f"FAILED  {rep.failed} failure(s), {rep.passed} pass(es).")
            return 1
        rep.pass_(
            f"tarball valid: kind={manifest.get('kind')} "
            f"version={manifest.get('version')} "
            f"entrypoint={manifest.get('entrypoint')} "
            f"contract={manifest.get('contract')}"
        )

        # --- extract + entrypoint smoke ("download" + "start backend") ---
        install_root = work_dir / "install"
        try:
            payload = extract_tarball(tarball, install_root)
        except (OSError, tarfile.TarError) as e:
            rep.fail(f"extract tarball: {e}")
            print()
            print(f"FAILED  {rep.failed} failure(s), {rep.passed} pass(es).")
            return 1
        entrypoint = str(manifest.get("entrypoint") or ENTRYPOINT_MEMBER)
        rep.pass_(f"extracted to {payload} (entrypoint={entrypoint})")

        if not args.skip_entrypoint_smoke:
            try:
                smoke_entrypoint(payload, entrypoint)
            except (
                OSError,
                RuntimeError,
                FileNotFoundError,
                PermissionError,
                subprocess.TimeoutExpired,
            ) as e:
                rep.fail(f"entrypoint smoke: {e}")
                print()
                print(f"FAILED  {rep.failed} failure(s), {rep.passed} pass(es).")
                return 1
            rep.pass_(f"entrypoint smoke: {entrypoint} gateway (exit 0)")

        # --- start backend with fake relay + required checks ---
        print()
        print("  running required contract checks (fake relay + reference host)")
        try:
            check_notes = run_fake_relay_contract_checks(contract_dir)
        except Exception as e:  # noqa: BLE001 — job boundary
            rep.fail(f"contract checks: {e}")
            print()
            print(f"FAILED  {rep.failed} failure(s), {rep.passed} pass(es).")
            return 1
        for note in check_notes:
            rep.pass_(note)

        print()
        if rep.failed:
            print(f"FAILED  {rep.failed} failure(s), {rep.passed} pass(es).")
            return 1
        mode_note = (
            "offline, no network"
            if args.mode == "offline"
            else "download mode (network used for artifact only)"
        )
        print(
            f"OK  Hermes-Lanyard conformance: {rep.passed} check(s) passed "
            f"({mode_note})."
        )
        return 0
    finally:
        if args.keep_work:
            print(f"    work dir kept: {work_dir}", file=sys.stderr)
        else:
            shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
