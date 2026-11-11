#!/usr/bin/env bash
# Offline smoke for bootstrap arch fail-closed helpers (lp-2md.3).
# No network: exercises normalize/detect/resolve + match/mismatch/missing.
#
# Usage (from repo root):
#   bash deploy/scripts/smoke-bootstrap-arch-check.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/deploy/scripts/bootstrap-backend-install.sh"
HOST_SCRIPT="$ROOT/deploy/scripts/bootstrap-host.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[ -f "$SCRIPT" ] || fail "missing $SCRIPT"
[ -f "$HOST_SCRIPT" ] || fail "missing $HOST_SCRIPT"
grep -q 'require_host_arch_match' "$SCRIPT" || fail "backend install missing require_host_arch_match"
grep -q 'require_hermes_host_arch_match' "$HOST_SCRIPT" || fail "bootstrap-host missing require_hermes_host_arch_match"

# shellcheck disable=SC1090
BOOTSTRAP_BACKEND_INSTALL_LIB_ONLY=1 source "$SCRIPT"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/cb-arch-smoke.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

HOST_ARCH="$(detect_host_target_arch)" || fail "detect_host_target_arch"
HOST_M="$(uname -m)"
pass "host target arch: $HOST_ARCH (uname -m=$HOST_M)"

# --- normalize helpers ---
[ "$(normalize_cpu_arch x86_64)" = "x86_64" ] || fail "normalize_cpu x86_64"
[ "$(normalize_cpu_arch amd64)" = "x86_64" ] || fail "normalize_cpu amd64"
[ "$(normalize_cpu_arch aarch64)" = "aarch64" ] || fail "normalize_cpu aarch64"
[ "$(normalize_cpu_arch arm64)" = "aarch64" ] || fail "normalize_cpu arm64"
[ "$(normalize_target_arch linux-x86_64)" = "linux-x86_64" ] || fail "norm linux-x86_64"
[ "$(normalize_target_arch linux/x86_64)" = "linux-x86_64" ] || fail "norm linux/x86_64"
[ "$(normalize_target_arch linux_x86_64)" = "linux-x86_64" ] || fail "norm linux_x86_64"
[ "$(normalize_target_arch linux-arm64)" = "linux-aarch64" ] || fail "norm linux-arm64 → aarch64"
[ "$(normalize_target_arch linux-aarch64)" = "linux-aarch64" ] || fail "norm linux-aarch64"
[ "$(normalize_target_arch arm64)" = "linux-aarch64" ] || fail "norm bare arm64"
[ "$(normalize_target_arch x86_64)" = "linux-x86_64" ] || fail "norm bare x86_64"
if normalize_target_arch powerpc >/dev/null 2>&1; then
  fail "expected invalid target arch to fail"
fi
pass "normalize_cpu_arch + normalize_target_arch"

# --- URL inference ---
[ "$(infer_target_arch_from_url 's3://b/hermes/v1/linux-x86_64/hermes-v1.tar.gz')" = "linux-x86_64" ] \
  || fail "URL x86_64"
[ "$(infer_target_arch_from_url 's3://b/hermes/v1/linux-aarch64/hermes-v1.tar.gz')" = "linux-aarch64" ] \
  || fail "URL aarch64"
[ "$(infer_target_arch_from_url 's3://b/hermes/v1/linux-arm64/hermes-v1.tar.gz')" = "linux-aarch64" ] \
  || fail "URL arm64 alias"
if infer_target_arch_from_url 's3://b/hermes/v1/hermes-v1.tar.gz' >/dev/null 2>&1; then
  fail "unlabeled URL must not infer arch"
fi
pass "infer_target_arch_from_url"

# --- in-tree TARGET_ARCH + .seed/build.env ---
mkdir -p "$TMP/tree_ok/.seed"
printf '%s\n' "$HOST_ARCH" >"$TMP/tree_ok/TARGET_ARCH"
[ "$(read_target_arch_from_tree "$TMP/tree_ok")" = "$HOST_ARCH" ] || fail "read TARGET_ARCH file"

mkdir -p "$TMP/tree_env/.seed"
echo "TARGET_ARCH=$HOST_ARCH" >"$TMP/tree_env/.seed/build.env"
[ "$(read_target_arch_from_tree "$TMP/tree_env")" = "$HOST_ARCH" ] || fail "read build.env"

mkdir -p "$TMP/tree_empty"
if read_target_arch_from_tree "$TMP/tree_empty" >/dev/null 2>&1; then
  fail "empty tree must not resolve arch"
fi
pass "read_target_arch_from_tree"

# --- resolve: pin > tree > url ---
resolve_artifact_target_arch "$HOST_ARCH" "" "" || fail "resolve pin"
[ "$RESOLVED_ARTIFACT_TARGET_ARCH" = "$HOST_ARCH" ] || fail "resolved pin value"

resolve_artifact_target_arch "" "$TMP/tree_ok" "" || fail "resolve tree"
[ "$RESOLVED_ARTIFACT_TARGET_ARCH" = "$HOST_ARCH" ] || fail "resolved tree value"

URL_OK="https://example.invalid/hermes/v0/$(echo "$HOST_ARCH" | tr '-' '_')/pkg.tar.gz"
# Prefer dash form in path for URL helper
URL_OK="https://example.invalid/hermes/v0/${HOST_ARCH}/pkg.tar.gz"
resolve_artifact_target_arch "" "" "$URL_OK" || fail "resolve url"
[ "$RESOLVED_ARTIFACT_TARGET_ARCH" = "$HOST_ARCH" ] || fail "resolved url value"
pass "resolve_artifact_target_arch sources"

# --- mismatch: opposite arch ---
if [ "$HOST_ARCH" = "linux-x86_64" ]; then
  OTHER="linux-aarch64"
else
  OTHER="linux-x86_64"
fi

mkdir -p "$TMP/tree_bad"
printf '%s\n' "$OTHER" >"$TMP/tree_bad/TARGET_ARCH"

set +e
OUT="$(require_host_arch_match "smoke@mismatch" "" "$TMP/tree_bad" "" 0 2>&1)"
RC=$?
set -e
[ "$RC" -eq 5 ] || fail "mismatch expected exit 5 got $RC"
echo "$OUT" | grep -qi 'mismatch\|Architecture mismatch' || fail "mismatch message missing: $OUT"
echo "$OUT" | grep -qi 'hermes-gateway\|wrong-arch\|refuse' || fail "operator guidance missing: $OUT"
pass "require_host_arch_match mismatch fail-closed (exit 5)"

# --- match ---
require_host_arch_match "smoke@match" "" "$TMP/tree_ok" "" 0
pass "require_host_arch_match match OK"

# --- pin mismatch vs tree ---
set +e
OUT="$(require_host_arch_match "smoke@disagree" "$OTHER" "$TMP/tree_ok" "" 0 2>&1)"
RC=$?
set -e
[ "$RC" -eq 5 ] || fail "pin/tree disagree expected exit 5 got $RC"
echo "$OUT" | grep -qi 'disagree' || fail "disagree message missing: $OUT"
pass "pin vs tree disagreement fail-closed"

# --- missing meta fail-closed ---
set +e
OUT="$(require_host_arch_match "smoke@missing" "" "$TMP/tree_empty" "" 0 2>&1)"
RC=$?
set -e
[ "$RC" -eq 5 ] || fail "missing expected exit 5 got $RC"
echo "$OUT" | grep -qi 'missing\|Arch metadata' || fail "missing message: $OUT"
pass "missing TARGET_ARCH fail-closed"

# --- missing allowed for emergency legacy ---
require_host_arch_match "smoke@legacy" "" "$TMP/tree_empty" "" 1
pass "ALLOW_MISSING_ARCH=1 permits unlabeled legacy"

# --- pin alone match / mismatch ---
require_host_arch_match "smoke@pin-ok" "$HOST_ARCH" "" "" 0
set +e
OUT="$(require_host_arch_match "smoke@pin-bad" "$OTHER" "" "" 0 2>&1)"
RC=$?
set -e
[ "$RC" -eq 5 ] || fail "pin mismatch expected exit 5 got $RC"
pass "pin-only match + mismatch"

# --- bootstrap-host compact helper (extract functions into a harness) ---
HARNESS="$TMP/host-arch-harness.sh"
python3 - "$HOST_SCRIPT" "$HARNESS" <<'PY'
from pathlib import Path
import sys

text = Path(sys.argv[1]).read_text(encoding="utf-8")
# Take require_hermes_host_arch_match (and any short comment immediately above).
fn = text.find("require_hermes_host_arch_match()")
if fn < 0:
    raise SystemExit("require_hermes_host_arch_match not found")
# Include preceding comment block (lp-2md.3 marker) when present.
start = text.rfind("\n# lp-2md.3", 0, fn)
if start < 0:
    start = text.rfind("\n", 0, fn) + 1
else:
    start = start + 1
i = fn
depth = 0
started = False
end = None
while i < len(text):
    c = text[i]
    if c == "{":
        depth += 1
        started = True
    elif c == "}":
        depth -= 1
        if started and depth == 0:
            end = i + 1
            break
    i += 1
if end is None:
    raise SystemExit("unterminated require_hermes_host_arch_match")

body = text[start:end]
Path(sys.argv[2]).write_text(
    "#!/usr/bin/env bash\nset -euo pipefail\n"
    'log() { echo "[bootstrap-host] $*"; }\n'
    'err() { echo "[bootstrap-host] ERROR: $*" >&2; }\n'
    + body
    + "\n",
    encoding="utf-8",
)
PY

# shellcheck disable=SC1090
source "$HARNESS"

mkdir -p "$TMP/host_tree"
printf '%s\n' "$OTHER" >"$TMP/host_tree/TARGET_ARCH"
set +e
OUT="$(require_hermes_host_arch_match "$TMP/host_tree" "" "" 0 2>&1)"
RC=$?
set -e
[ "$RC" -eq 5 ] || fail "host helper mismatch expected exit 5 got $RC ($OUT)"
echo "$OUT" | grep -qi 'mismatch\|Architecture mismatch' || fail "host mismatch msg: $OUT"
pass "bootstrap-host require_hermes_host_arch_match mismatch"

printf '%s\n' "$HOST_ARCH" >"$TMP/host_tree/TARGET_ARCH"
require_hermes_host_arch_match "$TMP/host_tree" "" "" 0
pass "bootstrap-host require_hermes_host_arch_match match"

set +e
OUT="$(require_hermes_host_arch_match "$TMP/tree_empty" "" "" 0 2>&1)"
RC=$?
set -e
[ "$RC" -eq 5 ] || fail "host missing expected exit 5 got $RC"
pass "bootstrap-host missing TARGET_ARCH fail-closed"

echo
echo "OK  smoke-bootstrap-arch-check (offline) host=$HOST_ARCH"
