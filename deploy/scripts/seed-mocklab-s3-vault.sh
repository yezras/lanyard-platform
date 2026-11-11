#!/usr/bin/env bash
# Seed MockLab durable vault content under an S3 prefix or local VAULT_ROOT.
#
# Purpose (lp-zuh.9.5 / lp-oop.38.18):
#   After Mountpoint R/W is proven (lp-zuh.9.4), install skills / AGENTS /
#   Projects / workflows so vault.tree is non-empty and chat can read a file.
#   Kitchen-sink config.yaml (subagents/workflow/mempalace/cron/catalog_search)
#   is the same document harness BACKEND_HOME reads for Tools snapshot.
#
# Usage (from deploy/ or repo root via path):
#   bash scripts/seed-mocklab-s3-vault.sh --dry-run
#   bash scripts/seed-mocklab-s3-vault.sh --local-vault /tmp/mocklab-vault
#   AWS_PROFILE=lanyard-main bash scripts/seed-mocklab-s3-vault.sh \
#     --s3-uri s3://lanyard-mocklab-vault-123456789012/tenants/<tenant_id>/vault/
#
# Defaults:
#   SOURCE = <deploy>/artifacts/mocklab-vault-seed
#   MockLab tenant from live proof: 319d3808-e533-44db-bfdf-7b6ef8caaae1
#
# Safety:
#   - Gate: if vault-root AGENTS.md exists → skip (unless --force)
#   - Never deletes remote/local extras (no --delete on sync)
#   - Refuses employee-vault-like local paths
#   - Refuses unexpected S3 bucket names
#
# See: artifacts/mocklab-vault-seed/README.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="${MOCKLAB_VAULT_SEED_SOURCE:-$ROOT/artifacts/mocklab-vault-seed}"
S3_URI="${MOCKLAB_S3_VAULT_URI:-}"
LOCAL_VAULT="${MOCKLAB_LOCAL_VAULT:-}"
FORCE="${FORCE:-0}"
DRY_RUN="${DRY_RUN:-0}"
SEED_MARKER="mocklab-vault-seed:lp-zuh.9.5"
VAULT_FS_REL="mcp/vault_fs_server.py"
DEFAULT_BUCKET="lanyard-mocklab-vault-123456789012"
DEFAULT_TENANT="319d3808-e533-44db-bfdf-7b6ef8caaae1"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"

usage() {
  cat <<EOF
Usage: $0 [options]

  --s3-uri URI          s3://bucket/tenants/{id}/vault/  (trailing slash OK)
  --local-vault PATH    Local directory target (offline / guest FS)
  --source DIR          Seed tree (default: artifacts/mocklab-vault-seed)
  --force               Re-put seed objects even when AGENTS.md exists
  --dry-run             Print actions only
  --use-mocklab-default Use known MockLab lab bucket + tenant prefix
  -h, --help            This help

Environment:
  MOCKLAB_S3_VAULT_URI, MOCKLAB_LOCAL_VAULT, MOCKLAB_VAULT_SEED_SOURCE,
  FORCE, DRY_RUN, AWS_PROFILE, AWS_REGION

Exactly one of --s3-uri / --local-vault / --use-mocklab-default is required
(unless MOCKLAB_S3_VAULT_URI or MOCKLAB_LOCAL_VAULT is set).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --s3-uri) S3_URI="$2"; shift 2 ;;
    --local-vault) LOCAL_VAULT="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --use-mocklab-default)
      S3_URI="s3://${DEFAULT_BUCKET}/tenants/${DEFAULT_TENANT}/vault/"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

log() { echo "[seed-mocklab-s3-vault] $*"; }
warn() { echo "[seed-mocklab-s3-vault] WARN: $*" >&2; }
err() { echo "[seed-mocklab-s3-vault] ERROR: $*" >&2; }

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
  local abs
  abs="$(abs_path "$1")"
  case "$abs" in
    */employee-vault|*/employee-vault/*|*/employee_vault|*/employee_vault/*) return 0 ;;
    */Lanyard|*/Lanyard/*) return 0 ;;
  esac
  if [ -f "$abs/.employee-vault" ] || [ -f "$abs/EMPLOYEE-VAULT.md" ]; then
    return 0
  fi
  return 1
}

parse_s3_uri() {
  # Sets BUCKET and PREFIX (no leading s3://; PREFIX has trailing slash)
  local uri="$1"
  case "$uri" in
    s3://*) ;;
    *) err "S3 URI must start with s3://"; return 2 ;;
  esac
  local rest="${uri#s3://}"
  BUCKET="${rest%%/*}"
  PREFIX="${rest#*/}"
  if [ -z "$BUCKET" ] || [ "$BUCKET" = "$rest" ]; then
    err "S3 URI missing bucket or key prefix: $uri"
    return 2
  fi
  case "$BUCKET" in
    lanyard-mocklab-vault-*|lanyard-vault-*) ;;
    *)
      err "refusing unexpected bucket name: $BUCKET (expected lanyard-mocklab-vault-* or lanyard-vault-*)"
      return 2
      ;;
  esac
  # Normalize trailing slash on vault prefix
  case "$PREFIX" in
    */) ;;
    *) PREFIX="${PREFIX}/" ;;
  esac
  case "$PREFIX" in
    tenants/*/vault/) ;;
    *)
      err "prefix must look like tenants/{tenant_id}/vault/ (got: $PREFIX)"
      return 2
      ;;
  esac
}

require_source() {
  SOURCE="$(abs_path "$SOURCE")"
  if [ ! -d "$SOURCE" ]; then
    err "seed source not found: $SOURCE"
    exit 2
  fi
  if [ ! -f "$SOURCE/AGENTS.md" ]; then
    err "seed source missing AGENTS.md (gate file): $SOURCE"
    exit 2
  fi
  if [ ! -f "$SOURCE/Projects/Workspace/welcome.md" ]; then
    err "seed source missing Projects/Workspace/welcome.md"
    exit 2
  fi
  if [ ! -f "$SOURCE/skills/mocklab-research/SKILL.md" ]; then
    err "seed source missing skills/mocklab-research/SKILL.md"
    exit 2
  fi
  if [ ! -f "$SOURCE/config.yaml" ]; then
    err "seed source missing config.yaml (harness kitchen-sink, lp-oop.38.18)"
    exit 2
  fi
  if [ ! -f "$SOURCE/workflows/research-lite.yaml" ]; then
    err "seed source missing workflows/research-lite.yaml"
    exit 2
  fi
  if [ ! -f "$SOURCE/$VAULT_FS_REL" ]; then
    err "seed source missing $VAULT_FS_REL (vault stdio MCP, lp-oop.38.19)"
    exit 2
  fi
}

install_local_file() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if command -v install >/dev/null 2>&1; then
    install -m 0644 "$src" "$dest"
  else
    cp -f "$src" "$dest"
    chmod 0644 "$dest"
  fi
}

# List regular files under SOURCE as relative paths (no leading ./).
# Skip only the pack-root deploy README.md (docs); nested README.md files seed.
list_seed_files() {
  (cd "$SOURCE" && find . -type f -print | sed 's|^\./||' | sort | while read -r rel; do
    case "$rel" in
      README.md) continue ;;
      *) printf '%s\n' "$rel" ;;
    esac
  done)
}

seed_local() {
  local dest rel src
  dest="$(abs_path "$LOCAL_VAULT")"
  if looks_like_employee_vault "$dest"; then
    err "Refusing seed: path looks like employee vault: $dest"
    exit 3
  fi

  local gate=0
  if [ -f "$dest/AGENTS.md" ]; then
    gate=1
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would seed local vault $dest from $SOURCE"
    list_seed_files | while read -r rel; do
      if [ "$FORCE" != "1" ] && [ -f "$dest/$rel" ]; then
        continue
      fi
      log "DRY-RUN: install $rel"
    done
    return 0
  fi

  mkdir -p "$dest"
  local n=0
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    if [ "$FORCE" != "1" ] && [ -f "$dest/$rel" ]; then
      continue
    fi
    src="$SOURCE/$rel"
    install_local_file "$src" "$dest/$rel"
    n=$((n + 1))
  done < <(list_seed_files)

  if [ "$n" -eq 0 ] && [ "$gate" = "1" ] && [ "$FORCE" != "1" ]; then
    log "AGENTS.md present at $dest — no missing seed files (preserve live vault)"
    log "result=skipped reason=agents_md_present target=local"
    return 0
  fi

  # Provenance
  mkdir -p "$dest/.seed"
  cat >"$dest/.seed/provenance.json" <<EOF
{
  "schema_version": 1,
  "product": "mocklab_vault_seed",
  "bead": "lp-zuh.9.5",
  "marker": "${SEED_MARKER}",
  "source": "${SOURCE}",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "target": "local",
  "vault_root": "${dest}",
  "object_count": ${n},
  "seed_gate": "AGENTS.md",
  "kitchen_sink": "lp-oop.38.18"
}
EOF

  [ -f "$dest/AGENTS.md" ] || { err "post-check: AGENTS.md missing"; exit 3; }
  [ -f "$dest/Projects/Workspace/welcome.md" ] || { err "post-check: welcome.md missing"; exit 3; }
  [ -f "$dest/config.yaml" ] || { err "post-check: config.yaml missing"; exit 3; }
  [ -f "$dest/$VAULT_FS_REL" ] || { err "post-check: $VAULT_FS_REL missing"; exit 3; }
  if [ "$gate" = "1" ] && [ "$FORCE" != "1" ]; then
    log "result=filled target=local vault=$dest objects=$n (missing kitchen-sink files only)"
  else
    log "result=seeded target=local vault=$dest objects=$n"
  fi
}

s3_head_exists() {
  local key="$1"
  aws s3api head-object --bucket "$BUCKET" --key "$key" --region "$AWS_REGION" >/dev/null 2>&1
}

seed_s3() {
  parse_s3_uri "$S3_URI" || exit $?
  if ! command -v aws >/dev/null 2>&1; then
    err "aws CLI required for S3 seed"
    exit 2
  fi

  local agents_key="${PREFIX}AGENTS.md"
  local gate=0
  if s3_head_exists "$agents_key"; then
    gate=1
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: would seed s3://${BUCKET}/${PREFIX} from $SOURCE"
    list_seed_files | while read -r rel; do
      if [ "$FORCE" != "1" ] && s3_head_exists "${PREFIX}${rel}"; then
        continue
      fi
      log "DRY-RUN: put s3://${BUCKET}/${PREFIX}${rel}"
    done
    return 0
  fi

  local n=0
  local rel ctype
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    if [ "$FORCE" != "1" ] && s3_head_exists "${PREFIX}${rel}"; then
      continue
    fi
    ctype="application/octet-stream"
    case "$rel" in
      *.md) ctype="text/markdown; charset=utf-8" ;;
      *.json) ctype="application/json" ;;
      *.yaml|*.yml) ctype="application/yaml" ;;
      *.txt) ctype="text/plain; charset=utf-8" ;;
      *.py) ctype="text/x-python; charset=utf-8" ;;
      .keep) ctype="application/octet-stream" ;;
    esac
    aws s3 cp "$SOURCE/$rel" "s3://${BUCKET}/${PREFIX}${rel}" \
      --region "$AWS_REGION" \
      --content-type "$ctype" \
      --only-show-errors
    n=$((n + 1))
  done < <(list_seed_files)

  if [ "$n" -eq 0 ] && [ "$gate" = "1" ] && [ "$FORCE" != "1" ]; then
    log "AGENTS.md present at s3://${BUCKET}/${agents_key} — no missing seed files (preserve live vault)"
    log "result=skipped reason=agents_md_present target=s3"
    return 0
  fi

  # Provenance (guest-visible under vault)
  local prov
  prov="$(mktemp "${TMPDIR:-/tmp}/mocklab-seed-prov.XXXXXX.json")"
  cat >"$prov" <<EOF
{
  "schema_version": 1,
  "product": "mocklab_vault_seed",
  "bead": "lp-zuh.9.5",
  "marker": "${SEED_MARKER}",
  "source": "deploy/artifacts/mocklab-vault-seed",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "target": "s3",
  "bucket": "${BUCKET}",
  "s3_vault_prefix": "${PREFIX}",
  "object_count": ${n},
  "seed_gate": "AGENTS.md",
  "kitchen_sink": "lp-oop.38.18"
}
EOF
  aws s3 cp "$prov" "s3://${BUCKET}/${PREFIX}.seed/provenance.json" \
    --region "$AWS_REGION" \
    --content-type "application/json" \
    --only-show-errors
  rm -f "$prov"
  n=$((n + 1))

  # Platform bootstrap marker (outside mount root) — best-effort
  local tenant_id platform_key platform_body
  tenant_id="$(printf '%s' "$PREFIX" | sed -n 's|^tenants/\([^/]*\)/vault/$|\1|p')"
  if [ -n "$tenant_id" ]; then
    platform_key="tenants/${tenant_id}/_platform/bootstrap.json"
    platform_body="$(mktemp "${TMPDIR:-/tmp}/mocklab-bootstrap.XXXXXX.json")"
    cat >"$platform_body" <<EOF
{
  "version": 1,
  "tenant_id": "${tenant_id}",
  "s3_vault_prefix": "${PREFIX}",
  "seed_version": "lp-zuh.9.5",
  "seed_source": "deploy/artifacts/mocklab-vault-seed",
  "seeded_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "object_count": ${n},
  "gate": "AGENTS.md"
}
EOF
    aws s3 cp "$platform_body" "s3://${BUCKET}/${platform_key}" \
      --region "$AWS_REGION" \
      --content-type "application/json" \
      --only-show-errors || warn "could not write platform bootstrap marker"
    rm -f "$platform_body"
  fi

  if ! s3_head_exists "${PREFIX}AGENTS.md"; then
    err "post-check: AGENTS.md missing under s3://${BUCKET}/${PREFIX}"
    exit 3
  fi
  if ! s3_head_exists "${PREFIX}Projects/Workspace/welcome.md"; then
    err "post-check: welcome.md missing"
    exit 3
  fi
  if ! s3_head_exists "${PREFIX}skills/mocklab-research/SKILL.md"; then
    err "post-check: mocklab-research skill missing"
    exit 3
  fi
  if ! s3_head_exists "${PREFIX}config.yaml"; then
    err "post-check: config.yaml missing"
    exit 3
  fi
  if ! s3_head_exists "${PREFIX}${VAULT_FS_REL}"; then
    err "post-check: $VAULT_FS_REL missing"
    exit 3
  fi
  if [ "$gate" = "1" ] && [ "$FORCE" != "1" ]; then
    log "result=filled target=s3 uri=s3://${BUCKET}/${PREFIX} objects=$n (missing kitchen-sink files only)"
  else
    log "result=seeded target=s3 uri=s3://${BUCKET}/${PREFIX} objects=$n"
  fi
  log "default_project primary_path=/mnt/vault/Projects/Workspace"
}

# --- main ---
require_source

if [ -n "$S3_URI" ] && [ -n "$LOCAL_VAULT" ]; then
  err "Provide only one of --s3-uri or --local-vault"
  exit 2
fi
if [ -z "$S3_URI" ] && [ -z "$LOCAL_VAULT" ]; then
  err "Provide --s3-uri, --local-vault, or --use-mocklab-default"
  usage >&2
  exit 2
fi

log "source=$SOURCE force=$FORCE dry_run=$DRY_RUN"

if [ -n "$LOCAL_VAULT" ]; then
  seed_local
else
  seed_s3
fi
