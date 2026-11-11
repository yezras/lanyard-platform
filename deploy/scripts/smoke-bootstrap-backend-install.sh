#!/usr/bin/env bash
# Offline smoke for deploy/scripts/bootstrap-backend-install.sh (lp-k7g.7.4).
# No network: exercises verify-before-extract order, versioned layout, current
# symlink, provenance fields, and idempotent fast path.
#
# Usage (from repo root):
#   bash deploy/scripts/smoke-bootstrap-backend-install.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/deploy/scripts/bootstrap-backend-install.sh"
SCHEMA="$ROOT/deploy/schemas/backend-install-provenance.schema.json"
EXAMPLE="$ROOT/deploy/examples/backend-install-provenance.example.json"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[ -f "$SCRIPT" ] || fail "missing $SCRIPT"
[ -f "$SCHEMA" ] || fail "missing $SCHEMA"
[ -f "$EXAMPLE" ] || fail "missing $EXAMPLE"

# shellcheck disable=SC1090
BOOTSTRAP_BACKEND_INSTALL_LIB_ONLY=1 source "$SCRIPT"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/cb-backend-install-smoke.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# --- fixture archive ---
mkdir -p "$TMP/src/payload/bin"
echo '#!/bin/sh' >"$TMP/src/payload/bin/company-brain-backend"
echo 'echo gateway' >>"$TMP/src/payload/bin/company-brain-backend"
chmod +x "$TMP/src/payload/bin/company-brain-backend"
echo "marker" >"$TMP/src/payload/marker.txt"
( cd "$TMP/src" && tar -czf "$TMP/backend.tar.gz" payload )

ARCHIVE="$TMP/backend-v0.0.0-smoke.artifact"
cp "$TMP/backend.tar.gz" "$ARCHIVE"
SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
URL="https://artifacts.example.invalid/backends/hermes-lanyard/v0.0.0-smoke/backend.tar.gz"
VERSION="v0.0.0-smoke"
KIND="hermes_lanyard"
INSTALL_ROOT="$TMP/opt/company-brain-backend"

# --- format + verify helpers ---
[ "$(archive_format_from_ref "$URL")" = "tar.gz" ] || fail "URL format detection"
[ "$(archive_format_from_magic "$ARCHIVE")" = "tar.gz" ] || fail "magic format detection"
verify_sha256 "$ARCHIVE" "$SHA" "smoke-backend"
pass "download-name .artifact + verify_sha256 (pre-extract)"

# --- extract only after verify (order exercised by sequential calls) ---
STAGE="$TMP/stage"
mkdir -p "$STAGE"
extract_archive "$ARCHIVE" "$STAGE" "$URL"
flatten_extract "$STAGE"
[ -f "$STAGE/marker.txt" ] || fail "flatten missing marker"
[ -x "$STAGE/bin/company-brain-backend" ] || fail "missing entrypoint after flatten"
pass "extract after verify + flatten"

# --- materialize versioned tree + provenance + current ---
BACKEND_ARTIFACT_KIND="$KIND"
BACKEND_ARTIFACT_VERSION="$VERSION"
BACKEND_ARTIFACT_URL="$URL"
BACKEND_ARTIFACT_SHA256="$SHA"
BACKEND_CONTRACT_RUNTIME_LAYOUT=1
BACKEND_CONTRACT_RELAY=1
BACKEND_CONTRACT_BRAIN_RPC=1
BACKEND_INSTALL_ROOT="$INSTALL_ROOT"
BACKEND_INSTALL_LAYOUT=versioned
BACKEND_ATTESTATION_STATUS=skipped
ARTIFACT_SIGNING_PUBKEY_FINGERPRINT=""
ARTIFACT_SIGNING_IDENTITY=""
BACKEND_ENTRYPOINT="bin/company-brain-backend"

VERSION_DIR="$INSTALL_ROOT/versions/$VERSION"
mkdir -p "$VERSION_DIR"
# Simulate rsync from stage (no sudo in smoke)
cp -a "$STAGE"/. "$VERSION_DIR"/
write_provenance_json "$VERSION_DIR"
ensure_current_symlink "$INSTALL_ROOT" "$VERSION"

[ -L "$INSTALL_ROOT/current" ] || fail "current is not a symlink"
TARGET="$(readlink "$INSTALL_ROOT/current")"
[ "$TARGET" = "versions/$VERSION" ] || fail "current target want versions/$VERSION got $TARGET"
[ -f "$INSTALL_ROOT/current/marker.txt" ] || fail "current does not resolve to version tree"
[ -f "$VERSION_DIR/.seed/provenance.json" ] || fail "missing provenance.json"
pass "versioned path + current symlink + provenance file"

# --- provenance required fields ---
python3 - "$VERSION_DIR/.seed/provenance.json" "$KIND" "$VERSION" "$URL" "$SHA" <<'PY'
import json, sys
path, kind, ver, url, sha = sys.argv[1:6]
d = json.load(open(path, encoding="utf-8"))
req = ["schema_version", "kind", "version", "url", "sha256", "contract", "installed_at", "install_root", "install_path"]
missing = [k for k in req if k not in d]
if missing:
    raise SystemExit(f"missing fields: {missing}")
if d["kind"] != kind or d["version"] != ver or d["url"] != url or d["sha256"] != sha:
    raise SystemExit("pin fields mismatch")
c = d["contract"]
for k in ("runtime_layout", "relay", "brain_rpc"):
    if k not in c or int(c[k]) < 1:
        raise SystemExit(f"bad contract.{k}")
if d.get("schema_version") != 1:
    raise SystemExit("schema_version must be 1")
print("ok")
PY
pass "provenance records kind, version, url, sha256, contract versions"

# --- example validates against schema (jsonschema optional) ---
python3 - "$SCHEMA" "$EXAMPLE" "$VERSION_DIR/.seed/provenance.json" <<'PY'
import json, sys
from pathlib import Path
schema = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
example = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
written = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
# Minimal required-key check without jsonschema dependency
for doc_name, doc in ("example", example), ("written", written):
    for key in schema.get("required", []):
        if key not in doc:
            raise SystemExit(f"{doc_name} missing required {key}")
    for key in schema["properties"]["contract"]["required"]:
        if key not in doc.get("contract", {}):
            raise SystemExit(f"{doc_name} missing contract.{key}")
try:
    import jsonschema  # type: ignore
    jsonschema.validate(example, schema)
    jsonschema.validate(written, schema)
    print("jsonschema ok")
except ImportError:
    print("required keys ok (jsonschema not installed)")
except Exception as e:
    raise SystemExit(f"schema validation failed: {e}")
PY
pass "schema + example + written provenance shape"

# --- idempotent fast path ---
provenance_matches_pins "$VERSION_DIR/.seed/provenance.json" || fail "expected provenance to match pins"
# Flip current away, re-ensure — should fix symlink without re-extract
ln -sfn "versions/does-not-exist" "$INSTALL_ROOT/current"
ensure_current_symlink "$INSTALL_ROOT" "$VERSION"
[ "$(readlink "$INSTALL_ROOT/current")" = "versions/$VERSION" ] || fail "symlink not repaired"
[ -f "$INSTALL_ROOT/current/marker.txt" ] || fail "repaired current broken"
pass "idempotent provenance match + current repair"

# --- sha mismatch must not match ---
BACKEND_ARTIFACT_SHA256="$(printf '%064d' 1)"
if provenance_matches_pins "$VERSION_DIR/.seed/provenance.json"; then
  fail "provenance must not match when sha256 differs"
fi
pass "provenance mismatch on sha change"

echo
echo "OK  smoke-bootstrap-backend-install (offline)"
