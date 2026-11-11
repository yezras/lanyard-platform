#!/usr/bin/env bash
# Copy company-brain vault tree from an EC2 host path (or local fixture) to
# the pilot S3 vault prefix (or a local destination that mirrors the prefix).
#
# Bead: lp-3ux (Phase 7 dual-run migration under lp-0pr)
# Runbook: docs/plans/0008-daytona-agent-sandboxes/vault-ec2-to-s3-copy.md
#
# One-writer migration: freeze EC2 vault writes during the live copy window.
# Default is --dry-run (plan + inventory only). Pass --execute to copy.
#
# Dest modes:
#   --dest-local DIR     Offline / lab fixture dest (no AWS required)
#   --s3-uri URI         s3://bucket/tenants/{tenant_id}/vault/
#   --bucket B --prefix  tenants/{tenant_id}/vault/  (same as --s3-uri)
#
# Verification (always available; default on for --execute):
#   - Regular file count (source vs dest)
#   - Sorted relative-path + sha256 manifest equality
#
# Examples:
#   # Offline dry-run + execute against fixtures
#   bash deploy/scripts/copy-vault-ec2-to-s3.sh \
#     --source /tmp/fixtures/src --dest-local /tmp/fixtures/dst --dry-run
#   bash deploy/scripts/copy-vault-ec2-to-s3.sh \
#     --source /tmp/fixtures/src --dest-local /tmp/fixtures/dst --execute --verify
#
#   # Live pilot (lab account; freeze EC2 first — see runbook)
#   AWS_PROFILE=lanyard-main AWS_REGION=us-east-1 \
#   bash deploy/scripts/copy-vault-ec2-to-s3.sh \
#     --source /opt/company-brain \
#     --s3-uri s3://lanyard-mocklab-vault-123456789012/tenants/mocklab/vault/ \
#     --execute --verify
#
# NEVER prints secret values. NEVER deletes the destination prefix wholesale.
# NEVER destroys the pilot lab bucket.
set -euo pipefail

SOURCE=""
DEST_LOCAL=""
S3_URI=""
BUCKET=""
PREFIX=""
DRY_RUN=1
EXECUTE=0
VERIFY=0
VERIFY_EXPLICIT=0
VERIFY_ONLY=0
MANIFEST_DIR=""
EXCLUDE_FILE=""
STRICT_PREFIX=1
ALLOW_EMPLOYEE=0

log() { echo "[copy-vault-ec2-to-s3] $*"; }
warn() { echo "[copy-vault-ec2-to-s3] WARN: $*" >&2; }
err() { echo "[copy-vault-ec2-to-s3] ERROR: $*" >&2; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

usage() {
  sed -n '2,40p' "$0" | sed 's/^# \?//'
  cat <<'EOF'

Flags:
  --source PATH         Source vault root (EC2 host path or local fixture)
  --dest-local PATH     Local destination root (offline path; no AWS)
  --s3-uri URI          Destination s3://bucket/prefix/ (trailing slash required)
  --bucket NAME         S3 bucket (use with --prefix)
  --prefix PREFIX       S3 key prefix tenants/{tenant_id}/vault/
  --dry-run             Plan only (default)
  --execute             Perform copy (local rsync/cp or aws s3 sync)
  --verify              Compare file counts + sha256 manifests after copy
  --no-verify           Skip verification even with --execute
  --verify-only         Re-check source vs dest without copying (requires dest already present)
  --manifest-dir DIR    Write source/dest manifests here (default: temp under dest/source)
  --exclude-from FILE   rsync/aws exclude file (one pattern per line)
  --allow-employee-path Allow paths that look like the employee vault (dangerous)
  -h, --help            This help

Environment:
  AWS_PROFILE / AWS_REGION   Used only for --s3-uri --execute
  LANYARD_VAULT_BUCKET       Optional default bucket name guard hint
EOF
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="${2:-}"; shift 2 ;;
    --dest-local) DEST_LOCAL="${2:-}"; shift 2 ;;
    --s3-uri) S3_URI="${2:-}"; shift 2 ;;
    --bucket) BUCKET="${2:-}"; shift 2 ;;
    --prefix) PREFIX="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; EXECUTE=0; VERIFY_ONLY=0; shift ;;
    --execute) EXECUTE=1; DRY_RUN=0; VERIFY_ONLY=0; shift ;;
    --verify) VERIFY=1; VERIFY_EXPLICIT=1; shift ;;
    --no-verify) VERIFY=0; VERIFY_EXPLICIT=1; shift ;;
    --verify-only) VERIFY_ONLY=1; DRY_RUN=0; EXECUTE=0; VERIFY=1; VERIFY_EXPLICIT=1; shift ;;
    --manifest-dir) MANIFEST_DIR="${2:-}"; shift 2 ;;
    --exclude-from) EXCLUDE_FILE="${2:-}"; shift 2 ;;
    --allow-employee-path) ALLOW_EMPLOYEE=1; shift ;;
    -h|--help) usage 0 ;;
    *) err "Unknown arg: $1"; usage 1 ;;
  esac
done

# Default: verify on execute unless explicitly disabled
if [[ "$EXECUTE" -eq 1 && "$VERIFY_EXPLICIT" -eq 0 ]]; then
  VERIFY=1
fi

abs_path() {
  local p="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath -m "$p" 2>/dev/null && return 0
  fi
  case "$p" in
    /*) printf '%s\n' "$p" ;;
    ~*) printf '%s\n' "${p/#\~/$HOME}" ;;
    *) printf '%s\n' "$(pwd)/$p" ;;
  esac
}

looks_like_employee_vault() {
  local root="$1"
  local abs
  abs="$(abs_path "$root")"
  case "$abs" in
    */employee-vault|*/employee-vault/*|*/employee_vault|*/employee_vault/*) return 0 ;;
    */Lanyard|*/Lanyard/*) return 0 ;;
  esac
  if [[ -f "$abs/.employee-vault" || -f "$abs/EMPLOYEE-VAULT.md" ]]; then
    return 0
  fi
  return 1
}

parse_s3_uri() {
  # Sets BUCKET and PREFIX from S3_URI (s3://bucket/key/prefix/)
  local uri="$1"
  [[ "$uri" == s3://* ]] || fail "S3 URI must start with s3:// (got: $uri)"
  local rest="${uri#s3://}"
  BUCKET="${rest%%/*}"
  if [[ "$rest" == */* ]]; then
    PREFIX="${rest#*/}"
  else
    PREFIX=""
  fi
  [[ -n "$BUCKET" ]] || fail "empty bucket in S3 URI: $uri"
}

normalize_prefix() {
  local p="$1"
  # Ensure trailing slash when non-empty
  if [[ -n "$p" && "$p" != */ ]]; then
    p="${p}/"
  fi
  printf '%s\n' "$p"
}

validate_prefix_shape() {
  local p="$1"
  [[ -n "$p" ]] || fail "S3 prefix is empty"
  case "$p" in
    tenants/*/vault/) ;;
    *)
      if [[ "$STRICT_PREFIX" -eq 1 ]]; then
        fail "prefix must match tenants/{tenant_id}/vault/ (got: $p)"
      else
        warn "prefix does not match tenants/{tenant_id}/vault/: $p"
      fi
      ;;
  esac
  case "$p" in
    *..*|*/./*|*/.|.)
      fail "prefix must not contain path traversal: $p"
      ;;
  esac
}

# --- inventory helpers -------------------------------------------------------

# List relative file paths (regular files only), sorted.
# Vault trees must not contain newlines in path components (operator contract).
list_files() {
  local root="$1"
  (
    cd "$root" || exit 1
    find . -type f ! -path './.copy-vault-ec2-to-s3/*' \
      | sed 's|^\./||' \
      | LC_ALL=C sort
  )
}

file_count() {
  local root="$1"
  list_files "$root" | wc -l | tr -d ' '
}

# Write manifest: "<sha256>  <relative/path>" per line, sorted by path.
# Uses sha256sum when available; falls back to shasum -a 256 (macOS).
hash_file() {
  local f="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$f" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$f" | awk '{print $1}'
  else
    fail "need sha256sum or shasum for checksum verification"
  fi
}

write_manifest() {
  local root="$1"
  local out="$2"
  mkdir -p "$(dirname "$out")"
  : >"$out"
  (
    cd "$root" || exit 1
    list_files "$root" | while IFS= read -r rel || [[ -n "$rel" ]]; do
      [[ -z "$rel" ]] && continue
      sum="$(hash_file "$rel")"
      printf '%s  %s\n' "$sum" "$rel"
    done
  ) | LC_ALL=C sort -k2 >"$out"
}

compare_manifests() {
  local a="$1"
  local b="$2"
  if cmp -s "$a" "$b"; then
    return 0
  fi
  return 1
}

# --- argument validation -----------------------------------------------------

[[ -n "$SOURCE" ]] || fail "--source is required"
SOURCE="$(abs_path "$SOURCE")"
[[ -d "$SOURCE" ]] || fail "source is not a directory: $SOURCE"

if [[ "$ALLOW_EMPLOYEE" -eq 0 ]] && looks_like_employee_vault "$SOURCE"; then
  fail "refusing employee-vault-like source path: $SOURCE (pass --allow-employee-path only if intentional)"
fi

if [[ -n "$S3_URI" ]]; then
  parse_s3_uri "$S3_URI"
fi
if [[ -n "$BUCKET" || -n "$PREFIX" ]]; then
  [[ -n "$BUCKET" && -n "$PREFIX" ]] || fail "both --bucket and --prefix required when using either"
fi
if [[ -n "$PREFIX" ]]; then
  PREFIX="$(normalize_prefix "$PREFIX")"
  validate_prefix_shape "$PREFIX"
fi

HAS_LOCAL=0
HAS_S3=0
[[ -n "$DEST_LOCAL" ]] && HAS_LOCAL=1
[[ -n "$BUCKET" ]] && HAS_S3=1

if [[ "$HAS_LOCAL" -eq 0 && "$HAS_S3" -eq 0 ]]; then
  fail "provide --dest-local and/or --s3-uri (or --bucket + --prefix)"
fi
if [[ "$HAS_LOCAL" -eq 1 && "$HAS_S3" -eq 1 ]]; then
  fail "choose one destination: --dest-local OR S3 (--s3-uri / --bucket+--prefix), not both"
fi

if [[ -n "$EXCLUDE_FILE" && ! -f "$EXCLUDE_FILE" ]]; then
  fail "exclude file not found: $EXCLUDE_FILE"
fi

if [[ -z "$MANIFEST_DIR" ]]; then
  MANIFEST_DIR="${TMPDIR:-/tmp}/copy-vault-ec2-to-s3-$$"
fi
MANIFEST_DIR="$(abs_path "$MANIFEST_DIR")"
mkdir -p "$MANIFEST_DIR"

SRC_COUNT="$(file_count "$SOURCE")"
SRC_MANIFEST="$MANIFEST_DIR/source.sha256"
write_manifest "$SOURCE" "$SRC_MANIFEST"

log "source=${SOURCE}"
log "source_file_count=${SRC_COUNT}"
log "source_manifest=${SRC_MANIFEST}"
if [[ "$HAS_LOCAL" -eq 1 ]]; then
  DEST_LOCAL="$(abs_path "$DEST_LOCAL")"
  log "dest_mode=local dest=${DEST_LOCAL}"
else
  log "dest_mode=s3 bucket=${BUCKET} prefix=${PREFIX}"
  log "dest_uri=s3://${BUCKET}/${PREFIX}"
fi
if [[ "$VERIFY_ONLY" -eq 1 ]]; then
  log "mode=verify-only (no copy)"
elif [[ "$DRY_RUN" -eq 1 ]]; then
  log "mode=dry-run (no writes; pass --execute to copy)"
else
  log "mode=execute verify=${VERIFY}"
fi

# Inventory preview (capped)
PREVIEW_N=20
log "source inventory (first ${PREVIEW_N} of ${SRC_COUNT}):"
list_files "$SOURCE" | head -n "$PREVIEW_N" | while IFS= read -r rel; do
  log "  ${rel}"
done
if [[ "$SRC_COUNT" -gt "$PREVIEW_N" ]]; then
  log "  ... ($((SRC_COUNT - PREVIEW_N)) more)"
fi

# --- dry-run exit ------------------------------------------------------------

if [[ "$DRY_RUN" -eq 1 && "$VERIFY_ONLY" -eq 0 ]]; then
  if [[ "$HAS_LOCAL" -eq 1 ]]; then
    log "would rsync/cp ${SRC_COUNT} files: ${SOURCE}/ → ${DEST_LOCAL}/"
  else
    log "would aws s3 sync ${SRC_COUNT} files: ${SOURCE}/ → s3://${BUCKET}/${PREFIX}"
    log "live AWS not invoked in dry-run (offline-safe)"
  fi
  log "would verify: file_count + sha256 manifest equality"
  log "DRY-RUN complete. Freeze EC2 writes before --execute on a live host."
  # Emit machine-readable summary for smoke harnesses
  cat >"$MANIFEST_DIR/dry-run-summary.txt" <<EOF
mode=dry-run
source=${SOURCE}
source_file_count=${SRC_COUNT}
dest_mode=$([[ "$HAS_LOCAL" -eq 1 ]] && echo local || echo s3)
dest_local=${DEST_LOCAL:-}
bucket=${BUCKET:-}
prefix=${PREFIX:-}
source_manifest=${SRC_MANIFEST}
EOF
  pass "dry-run planned ${SRC_COUNT} file(s); summary ${MANIFEST_DIR}/dry-run-summary.txt"
  exit 0
fi

# --- execute (skipped for --verify-only) -------------------------------------

copy_local() {
  mkdir -p "$DEST_LOCAL"
  if command -v rsync >/dev/null 2>&1; then
    # Default rsync: no --delete (additive; safer for partial re-runs / rollback).
    local -a args=(-a)
    if [[ -n "$EXCLUDE_FILE" ]]; then
      args+=(--exclude-from="$EXCLUDE_FILE")
    fi
    # Trailing slash: copy contents of SOURCE into DEST_LOCAL
    rsync "${args[@]}" "${SOURCE}/" "${DEST_LOCAL}/"
  else
    warn "rsync not found; using cp -a (no exclude-from support)"
    # Preserve structure: copy contents
    (
      cd "$SOURCE" || exit 1
      find . -type d -print0 | while IFS= read -r -d '' d; do
        mkdir -p "${DEST_LOCAL}/${d#./}"
      done
      find . -type f -print0 | while IFS= read -r -d '' f; do
        rel="${f#./}"
        mkdir -p "$(dirname "${DEST_LOCAL}/${rel}")"
        cp -a -- "$rel" "${DEST_LOCAL}/${rel}"
      done
    )
  fi
}

copy_s3() {
  command -v aws >/dev/null 2>&1 || fail "aws CLI required for S3 execute (or use --dest-local for offline)"
  # Guard unexpected bucket names (same spirit as smoke-pilot-lab-s3-vault-bucket)
  case "$BUCKET" in
    lanyard-mocklab-vault-*|lanyard-vault-*) ;;
    *)
      fail "refusing unexpected bucket name: ${BUCKET} (expected lanyard-mocklab-vault-* or lanyard-vault-*)"
      ;;
  esac
  local -a args=(s3 sync "${SOURCE}/" "s3://${BUCKET}/${PREFIX}" --only-show-errors)
  if [[ -n "$EXCLUDE_FILE" ]]; then
    # aws s3 sync supports --exclude repeatedly; translate file lines
    while IFS= read -r pat || [[ -n "$pat" ]]; do
      [[ -z "$pat" || "$pat" == \#* ]] && continue
      args+=(--exclude "$pat")
    done <"$EXCLUDE_FILE"
  fi
  log "running: aws ${args[*]}"
  aws "${args[@]}"
}

if [[ "$VERIFY_ONLY" -eq 0 ]]; then
  if [[ "$HAS_LOCAL" -eq 1 ]]; then
    if [[ "$ALLOW_EMPLOYEE" -eq 0 ]] && looks_like_employee_vault "$DEST_LOCAL"; then
      fail "refusing employee-vault-like dest path: $DEST_LOCAL"
    fi
    log "copying source → dest-local..."
    copy_local
    pass "local copy finished"
  else
    log "copying source → S3 (ensure EC2 vault writes are frozen)..."
    copy_s3
    pass "S3 sync finished"
  fi
else
  log "skipping copy (--verify-only)"
  if [[ "$HAS_LOCAL" -eq 1 && ! -d "$DEST_LOCAL" ]]; then
    fail "verify-only requires existing dest-local: $DEST_LOCAL"
  fi
fi

# --- verify ------------------------------------------------------------------

if [[ "$VERIFY" -eq 0 ]]; then
  warn "verification skipped (--no-verify)"
  exit 0
fi

DST_MANIFEST="$MANIFEST_DIR/dest.sha256"
VERIFY_REPORT="$MANIFEST_DIR/verify-report.txt"

if [[ "$HAS_LOCAL" -eq 1 ]]; then
  [[ -d "$DEST_LOCAL" ]] || fail "dest missing after copy: $DEST_LOCAL"
  DST_COUNT="$(file_count "$DEST_LOCAL")"
  write_manifest "$DEST_LOCAL" "$DST_MANIFEST"
else
  # Pull objects under prefix into a temp tree for checksum equality.
  # Prefer re-download for true content verification (not just ETag).
  command -v aws >/dev/null 2>&1 || fail "aws CLI required for S3 verify"
  VERIFY_TREE="$MANIFEST_DIR/s3-verify-tree"
  rm -rf "$VERIFY_TREE"
  mkdir -p "$VERIFY_TREE"
  log "downloading s3://${BUCKET}/${PREFIX} → ${VERIFY_TREE} for checksum verify..."
  aws s3 sync "s3://${BUCKET}/${PREFIX}" "${VERIFY_TREE}/" --only-show-errors
  DST_COUNT="$(file_count "$VERIFY_TREE")"
  write_manifest "$VERIFY_TREE" "$DST_MANIFEST"
fi

{
  echo "source_file_count=${SRC_COUNT}"
  echo "dest_file_count=${DST_COUNT}"
  echo "source_manifest=${SRC_MANIFEST}"
  echo "dest_manifest=${DST_MANIFEST}"
} >"$VERIFY_REPORT"

if [[ "$SRC_COUNT" != "$DST_COUNT" ]]; then
  err "file count mismatch: source=${SRC_COUNT} dest=${DST_COUNT}"
  if command -v diff >/dev/null 2>&1; then
    diff -u <(list_files "$SOURCE") <(
      if [[ "$HAS_LOCAL" -eq 1 ]]; then list_files "$DEST_LOCAL"; else list_files "$MANIFEST_DIR/s3-verify-tree"; fi
    ) | head -n 80 >&2 || true
  fi
  fail "verification failed: file count"
fi
pass "file count match: ${SRC_COUNT}"

if compare_manifests "$SRC_MANIFEST" "$DST_MANIFEST"; then
  pass "sha256 manifest match (${SRC_COUNT} files)"
  {
    echo "file_count_ok=1"
    echo "checksum_ok=1"
    echo "result=PASS"
  } >>"$VERIFY_REPORT"
  log "verify report: ${VERIFY_REPORT}"
  exit 0
fi

err "sha256 manifest mismatch"
if command -v diff >/dev/null 2>&1; then
  diff -u "$SRC_MANIFEST" "$DST_MANIFEST" | head -n 80 >&2 || true
fi
{
  echo "file_count_ok=1"
  echo "checksum_ok=0"
  echo "result=FAIL"
} >>"$VERIFY_REPORT"
fail "verification failed: checksum (report ${VERIFY_REPORT})"
