#!/usr/bin/env bash
# Smoke / re-check for pilot lab S3 vault bucket (lp-d26).
#
# Default (offline): validates plan docs + locked constants. No network, no AWS.
# Live: set SMOKE_PILOT_VAULT_LIVE=1 and AWS_PROFILE=lanyard-main to HeadBucket,
# verify encryption / public-access-block / ownership, and Put/Get/Delete a
# disposable probe under the mocklab prefix.
#
# NEVER deletes the bucket or the durable .lanyard-lab-marker.
# NEVER prints secret values.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DOC="$ROOT/docs/plans/0008-daytona-agent-sandboxes/pilot-lab-s3-vault-bucket.md"
LAYOUT="$ROOT/docs/plans/0008-daytona-agent-sandboxes/s3-vault-prefix-layout.md"

BUCKET="${LANYARD_VAULT_BUCKET:-lanyard-mocklab-vault-123456789012}"
REGION="${AWS_REGION:-us-east-1}"
PREFIX="${LANYARD_VAULT_PILOT_PREFIX:-tenants/mocklab/vault/}"
ACCOUNT_EXPECTED="123456789012"
MARKER_KEY="${PREFIX}.lanyard-lab-marker"

err() { echo "[smoke-pilot-lab-s3-vault-bucket] ERROR: $*" >&2; }
log() { echo "[smoke-pilot-lab-s3-vault-bucket] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

need_file() {
  [ -f "$1" ] || fail "missing required file: $1"
}

need_file "$DOC"
need_file "$LAYOUT"
pass "plan docs present (lp-d26 ensure + layout)"

for needle in \
  "lanyard-mocklab-vault-123456789012" \
  "123456789012" \
  "us-east-1" \
  "tenants/mocklab/vault/" \
  "Do not destroy" \
  "OPERATOR HOLD" \
  "AWS_PROFILE=lanyard-main" \
  "lp-d26"
do
  grep -qF -- "$needle" "$DOC" || fail "ensure doc missing required string: $needle"
done
pass "ensure doc covers bucket, account, region, prefix, hold, access profile"

grep -qF -- "lanyard-mocklab-vault-123456789012" "$LAYOUT" || fail "layout doc missing lab bucket name"
grep -qF -- "lp-d26" "$LAYOUT" || fail "layout doc missing lp-d26 pointer"
pass "layout doc references lab bucket + lp-d26"

# Refuse destructive bucket names / empty env overrides that look wrong
if [[ "$BUCKET" != lanyard-mocklab-vault-* && "$BUCKET" != lanyard-vault-* ]]; then
  fail "refusing unexpected bucket name override: $BUCKET"
fi
case "$PREFIX" in
  tenants/*/vault/) ;;
  *) fail "prefix must match tenants/{tenant_id}/vault/ (got: $PREFIX)" ;;
esac
pass "bucket/prefix shape guards"

if [[ "${SMOKE_PILOT_VAULT_LIVE:-0}" != "1" ]]; then
  log "offline mode only (set SMOKE_PILOT_VAULT_LIVE=1 for live HeadBucket + R/W probe)"
  pass "lp-d26 offline smoke complete"
  exit 0
fi

# --- live path ---
command -v aws >/dev/null 2>&1 || fail "aws CLI required for live mode"
export AWS_REGION="$REGION"
PROFILE_HINT="${AWS_PROFILE:-<unset>}"
log "live mode: profile=${PROFILE_HINT} bucket=${BUCKET} region=${REGION} prefix=${PREFIX}"

IDENT_JSON="$(aws sts get-caller-identity --output json 2>/dev/null)" \
  || fail "sts get-caller-identity failed (set AWS_PROFILE=lanyard-main for lab account)"
ACCOUNT="$(printf '%s' "$IDENT_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Account"])')"
ARN="$(printf '%s' "$IDENT_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Arn"])')"
log "caller account=${ACCOUNT} arn=${ARN}"
[[ "$ACCOUNT" == "$ACCOUNT_EXPECTED" ]] \
  || fail "expected account ${ACCOUNT_EXPECTED}, got ${ACCOUNT} (wrong profile? use lanyard-main)"
pass "caller in lab account ${ACCOUNT_EXPECTED}"

aws s3api head-bucket --bucket "$BUCKET" >/dev/null \
  || fail "HeadBucket failed for ${BUCKET}"
pass "HeadBucket ${BUCKET}"

ENC="$(aws s3api get-bucket-encryption --bucket "$BUCKET" --output json)"
printf '%s' "$ENC" | grep -q 'AES256' \
  || fail "expected default SSE-S3 AES256 on pilot bucket"
pass "default encryption AES256 (SSE-S3)"

PAB="$(aws s3api get-public-access-block --bucket "$BUCKET" --output json)"
printf '%s' "$PAB" | python3 -c '
import json, sys
c = json.load(sys.stdin)["PublicAccessBlockConfiguration"]
needed = (
    "BlockPublicAcls",
    "IgnorePublicAcls",
    "BlockPublicPolicy",
    "RestrictPublicBuckets",
)
missing = [f for f in needed if c.get(f) is not True]
if missing:
    raise SystemExit("PAB flags not true: " + ", ".join(missing))
' || fail "Block Public Access must have all four settings ON"
pass "Block Public Access all four ON"

OWN="$(aws s3api get-bucket-ownership-controls --bucket "$BUCKET" --output json)"
printf '%s' "$OWN" | grep -q 'BucketOwnerEnforced' \
  || fail "expected ObjectOwnership BucketOwnerEnforced"
pass "Object Ownership BucketOwnerEnforced"

# Disposable R/W probe — never touch durable marker
TS="$(date -u +%Y%m%dT%H%M%SZ)"
PROBE_KEY="${PREFIX}.lp-d26-smoke-${TS}.txt"
PROBE_URI="s3://${BUCKET}/${PROBE_KEY}"
cleanup() {
  aws s3 rm "$PROBE_URI" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "lp-d26 live smoke ${TS}" | aws s3 cp - "$PROBE_URI" >/dev/null \
  || fail "PutObject probe failed under ${PREFIX}"
GOT="$(aws s3 cp "$PROBE_URI" - 2>/dev/null)" \
  || fail "GetObject probe failed"
[[ "$GOT" == "lp-d26 live smoke ${TS}" ]] || fail "probe body mismatch"
aws s3 rm "$PROBE_URI" >/dev/null || fail "DeleteObject probe failed"
trap - EXIT
pass "Put/Get/Delete probe under ${PREFIX} (deleted)"

# Durable marker must still exist (or at least listing of prefix must not be AccessDenied)
if aws s3api head-object --bucket "$BUCKET" --key "$MARKER_KEY" >/dev/null 2>&1; then
  pass "durable marker present: ${MARKER_KEY}"
else
  log "WARN: durable marker ${MARKER_KEY} not found (prefix may be empty); bucket still usable"
fi

# Explicit non-goals
log "NOTE: this script never deletes the bucket; do not aws s3 rb ${BUCKET}"
pass "lp-d26 live smoke complete"
