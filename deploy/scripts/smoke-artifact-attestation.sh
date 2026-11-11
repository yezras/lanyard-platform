#!/usr/bin/env bash
# Offline smoke: Ed25519 artifact attestation accept/reject (openssl).
# Generates ephemeral keys only — no live secrets committed.
#
# Usage (from repo root):
#   bash scripts/smoke-artifact-attestation.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BOOTSTRAP="$ROOT/scripts/bootstrap-host.sh"

if [ ! -f "$BOOTSTRAP" ]; then
  echo "FAIL: missing $BOOTSTRAP" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "FAIL: openssl required for attestation smoke" >&2
  exit 1
fi

# shellcheck disable=SC1090
BOOTSTRAP_HOST_LIB_ONLY=1 source "$BOOTSTRAP"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/cb-artifact-attest-smoke.XXXXXX")"
cleanup() {
  cleanup_attestation_tmp 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# Set attestation pins for bootstrap lib functions (same shell, no subshells).
# Export so shellcheck and any helper that inspects the environment see them.
set_attest_pins() {
  export ARTIFACT_SIGNING_PUBKEY_FILE="${1-}"
  export ARTIFACT_SIGNING_PUBKEY_B64="${2-}"
  export ARTIFACT_SIGNING_PUBKEY="${3-}"
  export REQUIRE_ARTIFACT_ATTESTATION="${4:-0}"
  export ARTIFACT_SIGNING_IDENTITY="${5:-smoke-ephemeral-test-key}"
  _ATTESTATION_PUBKEY_PATH=""
  _ATTESTATION_PUBKEY_TMP=""
  ARTIFACT_SIGNING_PUBKEY_FINGERPRINT=""
}

# Run a command that must fail-closed. Bootstrap lib uses `exit 6` on attestation
# failure, so invoke in a subshell so only the child exits.
expect_fail() {
  local label="$1"
  shift
  set +e
  (
    # Inherit exported attestation pins from set_attest_pins.
    "$@"
  ) >/dev/null 2>&1
  local rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    fail "expected failure: $label"
  fi
}

# --- ephemeral Ed25519 keypair (test only) ---
openssl genpkey -algorithm Ed25519 -out "$TMP/priv.pem" 2>/dev/null
openssl pkey -in "$TMP/priv.pem" -pubout -out "$TMP/pub.pem" 2>/dev/null
if [ ! -s "$TMP/priv.pem" ] || [ ! -s "$TMP/pub.pem" ]; then
  fail "keypair generation"
fi

# Wrong key for reject path
openssl genpkey -algorithm Ed25519 -out "$TMP/wrong-priv.pem" 2>/dev/null
openssl pkey -in "$TMP/wrong-priv.pem" -pubout -out "$TMP/wrong-pub.pem" 2>/dev/null

# --- fixture artifact ---
mkdir -p "$TMP/src/payload"
echo "attestation-smoke-payload" >"$TMP/src/payload/marker.txt"
( cd "$TMP/src" && tar -czf "$TMP/artifact.tar.gz" payload )
cp "$TMP/artifact.tar.gz" "$TMP/artifact.bytes"
SHA="$(sha256sum "$TMP/artifact.bytes" | awk '{print $1}')"
verify_sha256 "$TMP/artifact.bytes" "$SHA" "smoke-artifact"
pass "SHA-256 still required and verified first"

# Sign raw artifact bytes
openssl pkeyutl -sign -inkey "$TMP/priv.pem" -out "$TMP/sig.bin" -rawin -in "$TMP/artifact.bytes"
SIG_B64="$(base64 -w0 <"$TMP/sig.bin" 2>/dev/null || base64 <"$TMP/sig.bin" | tr -d '\n')"
[ -n "$SIG_B64" ] || fail "empty signature b64"
PUB_B64="$(base64 -w0 <"$TMP/pub.pem" 2>/dev/null || base64 <"$TMP/pub.pem" | tr -d '\n')"

# --- accept: correct signature + pubkey file ---
set_attest_pins "$TMP/pub.pem" "" "" 0 "smoke-ephemeral-test-key"
verify_artifact_attestation "$TMP/artifact.bytes" "$SIG_B64" "smoke-accept"
[ "$ATTESTATION_LAST_STATUS" = "verified" ] || fail "expected verified status, got $ATTESTATION_LAST_STATUS"
[ -n "$ARTIFACT_SIGNING_PUBKEY_FINGERPRINT" ] || fail "expected pubkey fingerprint"
FP1="$ARTIFACT_SIGNING_PUBKEY_FINGERPRINT"
pass "accept: valid Ed25519 signature (pubkey file)"

# --- accept: pubkey via B64 PEM ---
set_attest_pins "" "$PUB_B64" "" 0 "smoke-ephemeral-test-key"
verify_artifact_attestation "$TMP/artifact.bytes" "$SIG_B64" "smoke-accept-b64"
[ "$ATTESTATION_LAST_STATUS" = "verified" ] || fail "b64 pubkey path expected verified"
[ "$ARTIFACT_SIGNING_PUBKEY_FINGERPRINT" = "$FP1" ] || fail "fingerprint mismatch between file and b64 paths"
pass "accept: ARTIFACT_SIGNING_PUBKEY_B64"

# --- reject: tampered payload ---
echo "tampered" >>"$TMP/artifact.bytes"
set_attest_pins "$TMP/pub.pem" "" "" 0
expect_fail "tampered artifact" verify_artifact_attestation "$TMP/artifact.bytes" "$SIG_B64" "smoke-tamper"
cp "$TMP/artifact.tar.gz" "$TMP/artifact.bytes"
pass "reject: tampered artifact (fail-closed)"

# --- reject: wrong public key ---
set_attest_pins "$TMP/wrong-pub.pem" "" "" 0
expect_fail "wrong pubkey" verify_artifact_attestation "$TMP/artifact.bytes" "$SIG_B64" "smoke-wrong-key"
pass "reject: wrong public key (fail-closed)"

# --- reject: garbage signature ---
set_attest_pins "$TMP/pub.pem" "" "" 0
expect_fail "invalid signature b64" verify_artifact_attestation "$TMP/artifact.bytes" "not-valid-base64!!!" "smoke-bad-sig"
pass "reject: invalid signature encoding"

# --- reject: signature set but no pubkey ---
set_attest_pins "" "" "" 0
expect_fail "missing pubkey with signature" verify_artifact_attestation "$TMP/artifact.bytes" "$SIG_B64" "smoke-no-pubkey"
pass "reject: signature without pubkey"

# --- lab skip: no signature, require=0 ---
set_attest_pins "" "" "" 0
verify_artifact_attestation "$TMP/artifact.bytes" "" "smoke-lab-skip"
[ "$ATTESTATION_LAST_STATUS" = "skipped" ] || fail "lab mode should skip, got $ATTESTATION_LAST_STATUS"
pass "lab: skip when signature unset"

# --- production require: missing signature fails ---
set_attest_pins "$TMP/pub.pem" "" "" 1
expect_fail "REQUIRE without signature" verify_artifact_attestation "$TMP/artifact.bytes" "" "smoke-require-missing-sig"
pass "production: REQUIRE_ARTIFACT_ATTESTATION=1 fails without signature"

# --- production require: missing pubkey config fails ---
set_attest_pins "" "" "" 1
expect_fail "REQUIRE without pubkey" require_attestation_config_if_needed
pass "production: REQUIRE_ARTIFACT_ATTESTATION=1 fails without pubkey"

# --- production require: full accept ---
set_attest_pins "$TMP/pub.pem" "" "" 1 "smoke-ephemeral-test-key"
require_attestation_config_if_needed
verify_artifact_attestation "$TMP/artifact.bytes" "$SIG_B64" "smoke-require-ok"
[ "$ATTESTATION_LAST_STATUS" = "verified" ] || fail "require path expected verified"
pass "production: REQUIRE_ARTIFACT_ATTESTATION=1 accepts valid signature"

# --- has_sig_pin helpers ---
has_sig_pin "abc" || fail "has_sig_pin should accept non-empty"
has_sig_pin "" && fail "has_sig_pin should reject empty"
has_sig_pin "UNCONFIGURED" && fail "has_sig_pin should reject UNCONFIGURED"
pass "has_sig_pin placeholder handling"

echo
echo "All artifact attestation smoke checks passed."
