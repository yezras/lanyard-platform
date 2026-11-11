#!/usr/bin/env bash
# Seed a company-brain vault from a client-core artifact (tarball) or seed tree.
#
# Mirrors company-brain-deploy bootstrap-host seed semantics:
#   - Install into VAULT_ROOT only when AGENTS.md is absent (live-vault gate)
#   - Flatten a single top-level archive directory when present
#   - Never use rsync --delete (first-run copy only; no destructive wipe)
#   - Write .seed/provenance.json after a successful first-run seed
#
# Usage:
#   seed-vault.sh --vault VAULT_ROOT --tarball path/to/client-core-*.tar.gz
#   seed-vault.sh --vault VAULT_ROOT --source /path/to/client-core
#   seed-vault.sh --vault VAULT_ROOT --tarball … --version V --url U --sha256 HEX
#
# Exit codes:
#   0  seeded or skipped (AGENTS.md already present — idempotent preserve)
#   2  usage / validation error
#   3  extract / install failure
#
# Offline-safe. No network. Bead: lp-k7g.9.5
set -euo pipefail

log() { echo "[seed-vault] $*"; }
err() { echo "[seed-vault] ERROR: $*" >&2; }

usage() {
  cat <<'EOF'
Usage: seed-vault.sh --vault VAULT_ROOT (--tarball FILE | --source DIR) [options]

Seed VAULT_ROOT from a client-core tarball or unpacked seed tree.

Gate (company-brain-deploy bootstrap):
  If VAULT_ROOT/AGENTS.md already exists, do nothing and exit 0.
  Live vault content is never overwritten by re-seed.

Options:
  --vault, -v PATH     Destination vault root (required)
  --tarball, -t FILE   client-core release tarball (.tar.gz)
  --source, -s DIR     Unpacked seed tree (must contain AGENTS.md)
  --version VER        Version label recorded in provenance
  --url URL            Artifact URL recorded in provenance
  --sha256 HEX         Artifact digest recorded in provenance
  --force              Re-seed even when AGENTS.md exists (DESTRUCTIVE
                       for matching seed paths; still never deletes
                       extra live files). Intended for tests only.
  -h, --help           Show this help

Environment (override flags when flags omitted):
  VAULT_ROOT, CLIENT_CORE_TARBALL, CLIENT_CORE_SOURCE,
  CLIENT_CORE_VERSION, CLIENT_CORE_URL, CLIENT_CORE_SHA256
EOF
}

VAULT_ROOT="${VAULT_ROOT:-}"
TARBALL="${CLIENT_CORE_TARBALL:-}"
SOURCE="${CLIENT_CORE_SOURCE:-}"
VERSION="${CLIENT_CORE_VERSION:-}"
URL="${CLIENT_CORE_URL:-}"
SHA256="${CLIENT_CORE_SHA256:-}"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -v|--vault)
      VAULT_ROOT="${2:-}"
      shift 2
      ;;
    -t|--tarball)
      TARBALL="${2:-}"
      shift 2
      ;;
    -s|--source)
      SOURCE="${2:-}"
      shift 2
      ;;
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --url)
      URL="${2:-}"
      shift 2
      ;;
    --sha256)
      SHA256="${2:-}"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      err "Unknown option: $1"
      usage >&2
      exit 2
      ;;
    *)
      err "Unexpected argument: $1"
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$VAULT_ROOT" ]; then
  err "--vault is required"
  usage >&2
  exit 2
fi

if [ -n "$TARBALL" ] && [ -n "$SOURCE" ]; then
  err "Provide only one of --tarball or --source"
  exit 2
fi
if [ -z "$TARBALL" ] && [ -z "$SOURCE" ]; then
  err "Provide --tarball or --source"
  usage >&2
  exit 2
fi

# Refuse pathologically unsafe vault roots.
case "$VAULT_ROOT" in
  ""|"/"|"."|"..")
    err "Refusing unsafe VAULT_ROOT: ${VAULT_ROOT:-<empty>}"
    exit 2
    ;;
esac

mkdir -p "$VAULT_ROOT"
VAULT_ROOT="$(cd "$VAULT_ROOT" && pwd)"

# ---------------------------------------------------------------------------
# Live-vault gate: existing AGENTS.md prevents overwrite (default path)
# ---------------------------------------------------------------------------
if [ -f "$VAULT_ROOT/AGENTS.md" ] && [ "$FORCE" != "1" ]; then
  log "AGENTS.md present at $VAULT_ROOT — skip seed (preserve live vault)"
  log "result=skipped reason=agents_md_present"
  exit 0
fi

if [ -f "$VAULT_ROOT/AGENTS.md" ] && [ "$FORCE" = "1" ]; then
  log "WARN: --force with existing AGENTS.md; seed files may overwrite"
fi

# ---------------------------------------------------------------------------
# Stage seed content (tarball extract + flatten, or copy from source tree)
# ---------------------------------------------------------------------------
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/cc-seed-stage.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

flatten_stage() {
  local dest="$1" top tmp_parent
  local -a entries children staged
  if [ -z "$dest" ] || [ "$dest" = "/" ]; then
    err "Refusing to flatten unsafe destination: ${dest:-<empty>}"
    exit 2
  fi
  shopt -s dotglob nullglob
  entries=("$dest"/*)
  if [ "${#entries[@]}" = "1" ] && [ -d "${entries[0]}" ]; then
    top="${entries[0]}"
    # Only flatten when the single top-level dir looks like a seed
    # (AGENTS.md inside) — matches company-brain-deploy flatten contract.
    if [ -f "$top/AGENTS.md" ]; then
      tmp_parent="$(mktemp -d "${dest:?}/.flatten.XXXXXX")"
      children=("$top"/*)
      if [ "${#children[@]}" -gt 0 ]; then
        mv -- "${children[@]}" "$tmp_parent/"
      fi
      rm -rf -- "${top:?}"
      staged=("$tmp_parent"/*)
      if [ "${#staged[@]}" -gt 0 ]; then
        mv -- "${staged[@]}" "$dest/"
      fi
      rmdir -- "$tmp_parent" 2>/dev/null || rm -rf -- "$tmp_parent"
      log "Flattened single top-level seed directory"
    fi
  fi
  shopt -u dotglob nullglob
}

if [ -n "$TARBALL" ]; then
  if [ ! -f "$TARBALL" ]; then
    err "Tarball not found: $TARBALL"
    exit 2
  fi
  TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"
  log "Extracting $TARBALL → stage"
  case "$TARBALL" in
    *.tar.gz|*.tgz)
      tar -xzf "$TARBALL" -C "$STAGE"
      ;;
    *.tar)
      tar -xf "$TARBALL" -C "$STAGE"
      ;;
    *)
      err "Unsupported archive extension (want .tar.gz / .tgz / .tar): $TARBALL"
      exit 2
      ;;
  esac
  flatten_stage "$STAGE"
  # Auto-fill sha256 when not provided
  if [ -z "$SHA256" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      SHA256="$(sha256sum "$TARBALL" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
      SHA256="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
    fi
  fi
  if [ -z "$VERSION" ]; then
    base="$(basename "$TARBALL")"
    # client-core-v0.1.0.tar.gz → v0.1.0
    if [[ "$base" =~ ^client-core-(.+)\.tar\.gz$ ]]; then
      VERSION="${BASH_REMATCH[1]}"
    elif [[ "$base" =~ ^client-core-(.+)\.tgz$ ]]; then
      VERSION="${BASH_REMATCH[1]}"
    fi
  fi
else
  if [ ! -d "$SOURCE" ]; then
    err "Source directory not found: $SOURCE"
    exit 2
  fi
  if [ ! -f "$SOURCE/AGENTS.md" ]; then
    err "Source is not a client-core seed tree (missing AGENTS.md): $SOURCE"
    exit 2
  fi
  SOURCE="$(cd "$SOURCE" && pwd)"
  log "Staging from source tree $SOURCE"
  # Copy seed tree; exclude common non-seed / monorepo noise when present.
  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude '.git/' \
      --exclude 'dist/' \
      --exclude 'node_modules/' \
      --exclude '.hermes/' \
      --exclude '.mempalace/' \
      --exclude '*.db' \
      "$SOURCE"/ "$STAGE"/
  else
    # Fallback: tar pipe (preserves modes, skips nothing fancy)
    (cd "$SOURCE" && tar -cf - \
      --exclude='.git' \
      --exclude='dist' \
      --exclude='node_modules' \
      --exclude='.hermes' \
      --exclude='.mempalace' \
      .) | (cd "$STAGE" && tar -xf -)
  fi
  if [ -z "$VERSION" ]; then
    VERSION="tree-local"
  fi
fi

if [ ! -f "$STAGE/AGENTS.md" ]; then
  err "Staged seed missing AGENTS.md (bad tarball shape or source)"
  exit 3
fi

# ---------------------------------------------------------------------------
# Install into vault (first-run copy; never --delete)
# ---------------------------------------------------------------------------
log "Installing seed → $VAULT_ROOT"
if command -v rsync >/dev/null 2>&1; then
  # No --delete: live extra files are never removed by seed.
  rsync -a "$STAGE"/ "$VAULT_ROOT"/
else
  # cp -a merges; does not delete extras in destination.
  cp -a "$STAGE"/. "$VAULT_ROOT"/
fi

if [ ! -f "$VAULT_ROOT/AGENTS.md" ]; then
  err "Post-install check failed: AGENTS.md missing under $VAULT_ROOT"
  exit 3
fi

# ---------------------------------------------------------------------------
# Provenance (parity with backend bootstrap .seed/provenance.json)
# ---------------------------------------------------------------------------
PROV_DIR="$VAULT_ROOT/.seed"
PROV_FILE="$PROV_DIR/provenance.json"
mkdir -p "$PROV_DIR"
INSTALLED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SOURCE_KIND="tarball"
[ -n "${SOURCE:-}" ] && [ -z "${TARBALL:-}" ] && SOURCE_KIND="tree"

# shellcheck disable=SC2016
CLIENT_CORE_VERSION="${VERSION:-unknown}" \
CLIENT_CORE_URL="${URL:-}" \
CLIENT_CORE_SHA256="${SHA256:-}" \
CLIENT_CORE_VAULT="$VAULT_ROOT" \
CLIENT_CORE_INSTALLED_AT="$INSTALLED_AT" \
CLIENT_CORE_SOURCE_KIND="$SOURCE_KIND" \
python3 - <<'PY' >"$PROV_FILE"
import json, os
doc = {
    "schema_version": 1,
    "product": "client_core",
    "version": os.environ.get("CLIENT_CORE_VERSION") or "unknown",
    "url": os.environ.get("CLIENT_CORE_URL") or "",
    "sha256": (os.environ.get("CLIENT_CORE_SHA256") or "").lower().replace("sha256:", "", 1),
    "installed_at": os.environ["CLIENT_CORE_INSTALLED_AT"],
    "vault_root": os.environ["CLIENT_CORE_VAULT"],
    "seed_gate": "AGENTS.md",
    "source_kind": os.environ["CLIENT_CORE_SOURCE_KIND"],
    "bootstrap": "artifact" if os.environ["CLIENT_CORE_SOURCE_KIND"] == "tarball" else "tree",
}
print(json.dumps(doc, indent=2, sort_keys=False))
print()
PY

log "Wrote provenance $PROV_FILE"
log "result=seeded vault=$VAULT_ROOT version=${VERSION:-unknown}"
exit 0
