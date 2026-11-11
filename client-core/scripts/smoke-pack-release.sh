#!/usr/bin/env bash
# Offline smoke for client-core/scripts/pack-release.sh (lp-k7g.9.4).
#
# Verifies monorepo subpath packaging:
#   - tarball shape matches deploy bootstrap expectations (single prefix + AGENTS.md)
#   - version, url, and sha256 are emitted (meta.env + pins.yaml + stdout)
#   - pin fragment is shape-compatible with compatibility/schema.json client_core
#   - no monorepo leakage (portal/deploy/contracts/…)
#
# Usage (from monorepo root or anywhere):
#   bash client-core/scripts/smoke-pack-release.sh
#
# Exit 0 on success; non-zero on failure. No network.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PACK_RELEASE="$SCRIPT_DIR/pack-release.sh"

# Prefer monorepo root when present (for pin schema path); else product root.
if git -C "$PRODUCT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_ROOT="$(git -C "$PRODUCT_ROOT" rev-parse --show-toplevel)"
else
  GIT_ROOT="$PRODUCT_ROOT"
fi

VERSION_LABEL="v0.0.0-smoke-lp-k7g.9.4"
OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cc-pack-smoke.XXXXXX")"
cleanup() { rm -rf "$OUT_DIR"; }
trap cleanup EXIT

pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*" >&2; exit 1; }

[ -f "$PACK_RELEASE" ] || fail "missing pack-release.sh at $PACK_RELEASE"
[ -f "$PRODUCT_ROOT/AGENTS.md" ] || fail "missing seed AGENTS.md at $PRODUCT_ROOT/AGENTS.md"

echo "smoke-pack-release: OUT_DIR=$OUT_DIR VERSION=$VERSION_LABEL"

set +e
PACK_OUT="$(
  OUT_DIR="$OUT_DIR" \
  ARTIFACT_BUCKET="example-artifacts-bucket" \
  bash "$PACK_RELEASE" --dry-run "$VERSION_LABEL" 2>&1
)"
PACK_RC=$?
set -e

if [ "$PACK_RC" -ne 0 ]; then
  echo "$PACK_OUT" | sed 's/^/         /' >&2
  fail "pack-release.sh --dry-run exited $PACK_RC"
fi

TARBALL="$OUT_DIR/client-core-${VERSION_LABEL}.tar.gz"
SHA_FILE="$OUT_DIR/client-core-${VERSION_LABEL}.tar.gz.sha256"
PINS_FILE="$OUT_DIR/client-core-${VERSION_LABEL}.pins.yaml"
META_FILE="$OUT_DIR/client-core-${VERSION_LABEL}.meta.env"
PREFIX="client-core-${VERSION_LABEL}/"

[ -s "$TARBALL" ] || fail "missing/empty tarball: $TARBALL"
[ -s "$SHA_FILE" ] || fail "missing/empty sha256 file: $SHA_FILE"
[ -s "$PINS_FILE" ] || fail "missing pins fragment: $PINS_FILE"
[ -s "$META_FILE" ] || fail "missing meta.env: $META_FILE"
pass "wrote tarball + sha256 + pins.yaml + meta.env"

# --- tarball shape (company-brain-deploy bootstrap) ---------------------------
MEMBERS="$(tar -tzf "$TARBALL")"
echo "$MEMBERS" | grep -qx "${PREFIX}AGENTS.md" \
  || fail "tarball missing ${PREFIX}AGENTS.md (bootstrap flatten contract)"
pass "AGENTS.md at seed root under single top-level prefix"

# Every member must live under the version prefix (no multi-root archive).
while IFS= read -r m; do
  [ -z "$m" ] && continue
  case "$m" in
    "$PREFIX"|"${PREFIX}"*) ;;
    *) fail "member outside version prefix: $m" ;;
  esac
done <<<"$MEMBERS"
pass "single top-level directory prefix (${PREFIX%/})"

# No monorepo product trees leaked into the seed
if echo "$MEMBERS" | grep -Eq "^${PREFIX}(portal|deploy|contracts|compatibility|client-core)(/|$)"; then
  echo "$MEMBERS" | grep -E "^${PREFIX}(portal|deploy|contracts|compatibility|client-core)(/|$)" | head -10 >&2
  fail "monorepo paths leaked into client-core seed tarball"
fi
pass "no monorepo leakage (portal/deploy/contracts/compatibility/client-core)"

if echo "$MEMBERS" | grep -E '(^|/)\.git(/|$)' >/dev/null; then
  fail "tarball contains .git paths"
fi
pass "no .git in archive"

# Seed should include packs/ and scripts/ from monorepo client-core/
echo "$MEMBERS" | grep -q "^${PREFIX}packs/" \
  || fail "tarball missing packs/ (seed content)"
echo "$MEMBERS" | grep -q "^${PREFIX}scripts/pack-release.sh" \
  || fail "tarball missing scripts/pack-release.sh"
pass "seed content includes packs/ and scripts/"

# --- version + sha256 + url emission -----------------------------------------
SHA_HEX="$(awk '{print $1}' "$SHA_FILE")"
echo "$SHA_HEX" | grep -Eq '^[0-9a-f]{64}$' \
  || fail "invalid sha256 in $SHA_FILE: $SHA_HEX"

# Verify digest matches tarball bytes
if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$OUT_DIR"
    sha256sum -c "client-core-${VERSION_LABEL}.tar.gz.sha256" >/dev/null
  ) || fail "sha256sum -c failed"
else
  GOT="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
  [ "$GOT" = "$SHA_HEX" ] || fail "sha256 mismatch: file=$SHA_HEX computed=$GOT"
fi
pass "sha256 digest verifies ($SHA_HEX)"

grep -q "CLIENT_CORE_VERSION=${VERSION_LABEL}" "$META_FILE" \
  || fail "meta.env missing CLIENT_CORE_VERSION"
grep -q "CLIENT_CORE_SHA256=${SHA_HEX}" "$META_FILE" \
  || fail "meta.env missing CLIENT_CORE_SHA256"
grep -q "CLIENT_CORE_URL=s3://example-artifacts-bucket/client-core/${VERSION_LABEL}/client-core-${VERSION_LABEL}.tar.gz" "$META_FILE" \
  || fail "meta.env missing expected CLIENT_CORE_URL"
grep -q "CLIENT_CORE_S3_KEY=client-core/${VERSION_LABEL}/client-core-${VERSION_LABEL}.tar.gz" "$META_FILE" \
  || fail "meta.env missing CLIENT_CORE_S3_KEY"
grep -Eq 'CLIENT_CORE_SOURCE_MODE=(monorepo|standalone)' "$META_FILE" \
  || fail "meta.env missing CLIENT_CORE_SOURCE_MODE"
pass "meta.env emits version, url, sha256, s3 key, source mode"

echo "$PACK_OUT" | grep -q "client_core.version=${VERSION_LABEL}" \
  || fail "stdout missing client_core.version"
echo "$PACK_OUT" | grep -q "client_core.sha256=${SHA_HEX}" \
  || fail "stdout missing client_core.sha256"
echo "$PACK_OUT" | grep -q "client_core.url=s3://example-artifacts-bucket/client-core/${VERSION_LABEL}/" \
  || fail "stdout missing client_core.url"
echo "$PACK_OUT" | grep -q "S3 object key (contract): client-core/${VERSION_LABEL}/client-core-${VERSION_LABEL}.tar.gz" \
  || fail "stdout missing S3 object key contract line"
pass "stdout emits pin fields + URL shape"

# Prefer monorepo mode when product is nested (this worktree)
if [ "$PRODUCT_ROOT" != "$GIT_ROOT" ]; then
  grep -q "CLIENT_CORE_SOURCE_MODE=monorepo" "$META_FILE" \
    || fail "expected monorepo source mode when product_root != git_root"
  grep -q "CLIENT_CORE_SOURCE_SUBPATH=client-core" "$META_FILE" \
    || fail "expected SOURCE_SUBPATH=client-core"
  echo "$PACK_OUT" | grep -q "Source mode: monorepo" \
    || fail "stdout missing Source mode: monorepo"
  pass "monorepo subpath packaging mode"
else
  pass "standalone source mode (product root == git root)"
fi

# --- pins fragment usable by compatibility validator -------------------------
grep -q "^client_core:" "$PINS_FILE" || fail "pins.yaml missing client_core block"
grep -q "version: \"${VERSION_LABEL}\"" "$PINS_FILE" || fail "pins.yaml missing version"
grep -q "sha256: \"${SHA_HEX}\"" "$PINS_FILE" || fail "pins.yaml missing sha256"
grep -q "url: \"s3://example-artifacts-bucket/client-core/${VERSION_LABEL}/client-core-${VERSION_LABEL}.tar.gz\"" "$PINS_FILE" \
  || fail "pins.yaml missing url"

# Build a minimal full pin doc and validate if monorepo schema tools exist.
SCHEMA="$GIT_ROOT/compatibility/schema.json"
VALIDATOR="$GIT_ROOT/scripts/validate-compatibility-pins.py"
if [ -f "$SCHEMA" ] && [ -f "$VALIDATOR" ]; then
  PIN_DOC="$OUT_DIR/full-pins.yaml"
  cat > "$PIN_DOC" <<EOF
schema_version: 2
backend:
  kind: hermes_lanyard
  version: "v0.0.0-example"
  sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  url: "s3://example-artifacts-bucket/backends/hermes-lanyard/v0.0.0-example/backend.tar.gz"
  contract:
    runtime_layout: 1
    relay: 1
    brain_rpc: 1
client_core:
  version: "${VERSION_LABEL}"
  sha256: "${SHA_HEX}"
  url: "s3://example-artifacts-bucket/client-core/${VERSION_LABEL}/client-core-${VERSION_LABEL}.tar.gz"
portal:
  images:
    bff:
      repository: "example.dkr.ecr.example.amazonaws.com/lanyard-platform/portal/bff"
      digest: "sha256:0000000000000000000000000000000000000000000000000000000000000002"
      tag: "v0.0.0-example"
EOF
  set +e
  VAL_OUT="$(python3 "$VALIDATOR" "$PIN_DOC" 2>&1)"
  VAL_RC=$?
  set -e
  if [ "$VAL_RC" -ne 0 ]; then
    echo "$VAL_OUT" | sed 's/^/         /' >&2
    fail "compatibility pin validator rejected generated client_core fragment"
  fi
  pass "compatibility pins can reference the artifact (validator OK)"
else
  pass "compatibility validator not present (skipped pin schema check)"
fi

# Refuse mutable version labels
set +e
BAD_OUT="$(OUT_DIR="$OUT_DIR" bash "$PACK_RELEASE" --dry-run main 2>&1)"
BAD_RC=$?
set -e
[ "$BAD_RC" -ne 0 ] || fail "pack-release should reject mutable version 'main'"
echo "$BAD_OUT" | grep -qi "refusing mutable\|mutable" \
  || fail "expected mutable-version error for 'main'"
pass "rejects mutable version labels (main)"

echo "OK  smoke-pack-release (offline) version=${VERSION_LABEL} sha256=${SHA_HEX}"
