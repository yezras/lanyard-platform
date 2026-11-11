#!/usr/bin/env bash
# Package a client-core seed release tarball (tracked files only) + SHA-256.
#
# Works from:
#   - monorepo:   bash client-core/scripts/pack-release.sh [VERSION]
#                 (packages only the client-core/ subpath; does not require a
#                 standalone client-core repository root)
#   - standalone: ./scripts/pack-release.sh [VERSION]
#                 (legacy single-repo layout; whole tree is the seed)
#
# Usage:
#   ./scripts/pack-release.sh [VERSION]
#   ./scripts/pack-release.sh --dry-run [VERSION]
#   VERSION=v0.1.0 ./scripts/pack-release.sh
#   OUT_DIR=/tmp/out ARTIFACT_BUCKET=my-bucket ./scripts/pack-release.sh v0.1.0
#
# VERSION defaults to the exact git tag at HEAD when present; otherwise the
# first CLI arg is required. Mutable labels (main, latest, HEAD, …) are rejected.
#
# Output (default OUT_DIR=<product-root>/dist):
#   client-core-<version>.tar.gz
#   client-core-<version>.tar.gz.sha256
#   client-core-<version>.pins.yaml   (pin fragment for compatibility/)
#   client-core-<version>.meta.env    (machine-readable version/url/sha256)
#
# Contract (company-brain-deploy product-artifact-infra + bootstrap):
#   s3://$ARTIFACT_BUCKET/client-core/<version>/client-core-<version>.tar.gz
#   Bootstrap flattens a single top-level directory; AGENTS.md must be at root
#   after flatten. No .git, no live customer data, no *.db / embeddings / secrets.
#
# Dry-run (--dry-run / DRY_RUN=1): still packs locally and emits pin fields +
# URL shape; never uploads. Suitable for offline CI / scripts/validate.sh.
set -euo pipefail

PRODUCT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PRODUCT_ROOT"

OUT_DIR="${OUT_DIR:-$PRODUCT_ROOT/dist}"
TREE_ISH="${TREE_ISH:-HEAD}"
ARTIFACT_BUCKET="${ARTIFACT_BUCKET:-<ARTIFACT_BUCKET>}"
DRY_RUN="${DRY_RUN:-0}"

log() { echo "[pack-release] $*"; }
err() { echo "[pack-release] ERROR: $*" >&2; }

usage() {
  cat <<'EOF'
Usage: pack-release.sh [--dry-run] [VERSION]

Package the client-core seed from the monorepo client-core/ subpath (or a
standalone client-core repo root) into an immutable tarball + SHA-256.

Options:
  --dry-run, -n   Offline pack only; emit version, sha256, URL shape, pin YAML.
                  Never uploads (pack-release never uploads by itself).
  -h, --help      Show this help.

Environment:
  VERSION           Immutable version label (e.g. v0.1.0)
  OUT_DIR           Output directory (default: <product-root>/dist)
  TREE_ISH          Git commit/tree to archive (default: HEAD)
  ARTIFACT_BUCKET   Bucket name used in emitted pin URL (default placeholder)
  DRY_RUN=1         Same as --dry-run

Outputs under OUT_DIR:
  client-core-<version>.tar.gz
  client-core-<version>.tar.gz.sha256
  client-core-<version>.pins.yaml
  client-core-<version>.meta.env

S3 object key (publish contract):
  client-core/<version>/client-core-<version>.tar.gz

Compatibility pin fields (schema_version 2 top-level client_core block):
  client_core.version / client_core.sha256 / client_core.url
EOF
}

# --- args -------------------------------------------------------------------
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -n|--dry-run)
      DRY_RUN=1
      shift
      ;;
    --)
      shift
      while [ $# -gt 0 ]; do POSITIONAL+=("$1"); shift; done
      break
      ;;
    -*)
      err "Unknown option: $1"
      usage >&2
      exit 2
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done
set -- "${POSITIONAL[@]+"${POSITIONAL[@]}"}"

# Reject live git branches / mutable refs used as "versions".
# Artifacts must be immutable release labels (e.g. v0.1.0), never main/master/HEAD.
is_forbidden_version_ref() {
  local v
  v="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
  case "$v" in
    ""|main|master|head|develop|development|trunk|latest|origin/*|refs/*)
      return 0
      ;;
  esac
  return 1
}

resolve_version() {
  local v="${1:-${VERSION:-}}"
  if [ -z "$v" ]; then
    # Prefer an exact tag pointing at TREE_ISH (release cut from a tag).
    if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      v="$(git describe --tags --exact-match "$TREE_ISH" 2>/dev/null || true)"
    fi
  fi
  if [ -z "$v" ]; then
    err "VERSION is required (arg or env), or run from an exact git tag."
    err "Example: $0 v0.1.0"
    err "Offline dry-run: $0 --dry-run v0.1.0-test"
    exit 2
  fi
  # Strip accidental leading refs/tags/
  v="${v#refs/tags/}"
  if is_forbidden_version_ref "$v"; then
    err "Refusing mutable/empty version label: '$v'"
    err "Use an immutable label such as v0.1.0 (not main/master/HEAD/latest)."
    exit 2
  fi
  # Basic shape: no path separators or whitespace
  if echo "$v" | grep -Eq '[[:space:]/\\]'; then
    err "VERSION must not contain whitespace or path separators: '$v'"
    exit 2
  fi
  printf '%s' "$v"
}

if ! command -v git >/dev/null 2>&1; then
  err "git is required (pack uses git archive for tracked files only)."
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  err "Not inside a git work tree: $PRODUCT_ROOT"
  exit 1
fi

GIT_ROOT="$(git rev-parse --show-toplevel)"

# Resolve packaging mode: monorepo subpath vs standalone product root.
# Monorepo (ADR 0004): product lives at <git-root>/client-core/; archive only that tree.
# Standalone (legacy): product root == git root; archive the whole tree.
SOURCE_MODE=""
SOURCE_SUBPATH=""
ARCHIVE_TREE=""
AGENTS_BLOB=""

if [ "$PRODUCT_ROOT" = "$GIT_ROOT" ]; then
  SOURCE_MODE="standalone"
  SOURCE_SUBPATH=""
  ARCHIVE_TREE="$TREE_ISH"
  AGENTS_BLOB="${TREE_ISH}:AGENTS.md"
else
  SOURCE_MODE="monorepo"
  SOURCE_SUBPATH="${PRODUCT_ROOT#"$GIT_ROOT"/}"
  SOURCE_SUBPATH="${SOURCE_SUBPATH#/}"
  SOURCE_SUBPATH="${SOURCE_SUBPATH%/}"
  if [ -z "$SOURCE_SUBPATH" ] || [ "$SOURCE_SUBPATH" = "$PRODUCT_ROOT" ]; then
    err "Could not resolve monorepo subpath for product root: $PRODUCT_ROOT"
    err "Git root: $GIT_ROOT"
    exit 1
  fi
  # Archive the product tree so members are AGENTS.md, packs/, … under PREFIX
  # (not client-core/AGENTS.md nested again).
  ARCHIVE_TREE="${TREE_ISH}:${SOURCE_SUBPATH}"
  AGENTS_BLOB="${TREE_ISH}:${SOURCE_SUBPATH}/AGENTS.md"
fi

VERSION_LABEL="$(resolve_version "${1:-}")"
ARCHIVE_BASENAME="client-core-${VERSION_LABEL}"
TARBALL_NAME="${ARCHIVE_BASENAME}.tar.gz"
SHA_NAME="${TARBALL_NAME}.sha256"
PINS_NAME="${ARCHIVE_BASENAME}.pins.yaml"
META_NAME="${ARCHIVE_BASENAME}.meta.env"
PREFIX="${ARCHIVE_BASENAME}/"

# S3 / pin URL contract (company-brain-deploy product-artifact-infra)
S3_KEY="client-core/${VERSION_LABEL}/${TARBALL_NAME}"
# Alternate filename under the same version prefix (also accepted by deploy docs):
#   client-core/<version>/client-core.tar.gz
S3_KEY_ALT="client-core/${VERSION_LABEL}/client-core.tar.gz"
PIN_URL="s3://${ARTIFACT_BUCKET}/${S3_KEY}"

if ! git -C "$GIT_ROOT" rev-parse --verify "$TREE_ISH" >/dev/null 2>&1; then
  err "Invalid TREE_ISH: $TREE_ISH"
  exit 1
fi

# Confirm the archive tree exists (monorepo: TREE_ISH:client-core).
if ! git -C "$GIT_ROOT" rev-parse --verify "$ARCHIVE_TREE" >/dev/null 2>&1; then
  err "Archive tree not found: $ARCHIVE_TREE"
  if [ "$SOURCE_MODE" = "monorepo" ]; then
    err "Expected monorepo product path '${SOURCE_SUBPATH}/' to exist at ${TREE_ISH}."
  fi
  exit 1
fi

# Confirm AGENTS.md is tracked at the seed root (required after bootstrap flatten).
if ! git -C "$GIT_ROOT" cat-file -e "$AGENTS_BLOB" 2>/dev/null; then
  err "AGENTS.md is not present at the seed root of ${ARCHIVE_TREE}."
  err "Looked for blob: $AGENTS_BLOB"
  err "Seed tarball must include AGENTS.md so bootstrap can detect a seeded vault."
  exit 1
fi

mkdir -p "$OUT_DIR"
TARBALL_PATH="$OUT_DIR/$TARBALL_NAME"
SHA_PATH="$OUT_DIR/$SHA_NAME"
PINS_PATH="$OUT_DIR/$PINS_NAME"
META_PATH="$OUT_DIR/$META_NAME"

# Remove any previous artifacts for this version in OUT_DIR
rm -f "$TARBALL_PATH" "$SHA_PATH" "$PINS_PATH" "$META_PATH"

if [ "$DRY_RUN" = "1" ]; then
  log "Dry-run: offline pack + pin emission (no upload)"
fi
log "Source mode: ${SOURCE_MODE}"
if [ "$SOURCE_MODE" = "monorepo" ]; then
  log "Monorepo subpath: ${SOURCE_SUBPATH}/ (git root: $GIT_ROOT)"
fi
log "Packing ${ARCHIVE_TREE} as version ${VERSION_LABEL}"
log "Prefix: ${PREFIX}"

# Tracked files only — never local junk, .git, or gitignored runtime state.
# Single top-level directory so bootstrap flatten leaves AGENTS.md at vault root.
# Monorepo: ARCHIVE_TREE is TREE_ISH:client-core so paths are seed-relative.
#
# Always invoke git from GIT_ROOT. Running `git archive TREE:client-core` from
# inside client-core/ treats the path relative to cwd and yields an empty pack.
git -C "$GIT_ROOT" archive \
  --format=tar.gz \
  --prefix="$PREFIX" \
  -o "$TARBALL_PATH" \
  "$ARCHIVE_TREE"

if [ ! -s "$TARBALL_PATH" ]; then
  err "Tarball missing or empty: $TARBALL_PATH"
  exit 1
fi

# --- post-pack validation (fail closed) ---
list_members() {
  tar -tzf "$TARBALL_PATH"
}

MEMBERS="$(list_members)"

# Here-string (not echo | grep -q): with pipefail, grep -q closing early SIGPIPEs echo
# and the check reports a missing AGENTS.md even when the member is present.
if ! grep -Fqx -- "${PREFIX}AGENTS.md" <<<"$MEMBERS"; then
  err "Tarball missing ${PREFIX}AGENTS.md"
  err "Deploy bootstrap expects AGENTS.md at vault root after flattening one top-level dir."
  exit 1
fi

# Reject nested monorepo leakage (portal/deploy/… under the seed prefix).
# After a correct monorepo subpath pack these must not appear as seed children.
LEAK_RE="^${PREFIX}(portal|deploy|contracts|compatibility|client-core)(/|$)"
if echo "$MEMBERS" | grep -Eq "$LEAK_RE"; then
  err "Tarball contains monorepo paths that must not ship in the client-core seed:"
  echo "$MEMBERS" | grep -E "$LEAK_RE" >&2 || true
  err "Pack must archive only the client-core/ product tree (TREE:client-core)."
  exit 1
fi

# No nested .git (git archive should never include it; belt-and-suspenders)
if echo "$MEMBERS" | grep -E '(^|/)\.git(/|$)' >/dev/null; then
  err "Tarball unexpectedly contains .git paths"
  exit 1
fi

# No database / embedding / secret-shaped paths
FORBIDDEN_RE='(^|/)\.env($|\.)|(^|/)\.env\.|(^|/)\.mempalace(/|$)|(^|/)\.hermes(/|$)|(^|/)node_modules(/|$)|\.db($|-)|chroma/|\.chroma$|\.sqlite3?$|embeddings?'
if echo "$MEMBERS" | grep -Eiq "$FORBIDDEN_RE"; then
  err "Tarball contains forbidden runtime/secret/data paths:"
  echo "$MEMBERS" | grep -Ei "$FORBIDDEN_RE" >&2 || true
  exit 1
fi

# sha256sum format: "<hex>  <basename>" (two spaces) for easy pin copy
if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$OUT_DIR"
    sha256sum "$TARBALL_NAME" > "$SHA_NAME"
  )
else
  # macOS fallback
  (
    cd "$OUT_DIR"
    shasum -a 256 "$TARBALL_NAME" | awk '{print $1"  "$2}' > "$SHA_NAME"
  )
fi

SHA_HEX="$(awk '{print $1}' "$SHA_PATH")"
if ! echo "$SHA_HEX" | grep -Eq '^[0-9a-f]{64}$'; then
  err "Invalid SHA-256 digest recorded: $SHA_HEX"
  exit 1
fi

BYTES="$(wc -c <"$TARBALL_PATH" | tr -d ' ')"
MEMBER_COUNT="$(echo "$MEMBERS" | wc -l | tr -d ' ')"

# Machine-readable pin / metadata files for compatibility overlays and CI.
cat > "$META_PATH" <<EOF
# Generated by client-core/scripts/pack-release.sh — do not hand-edit for release.
CLIENT_CORE_VERSION=${VERSION_LABEL}
CLIENT_CORE_SHA256=${SHA_HEX}
CLIENT_CORE_TARBALL=${TARBALL_NAME}
CLIENT_CORE_S3_KEY=${S3_KEY}
CLIENT_CORE_URL=${PIN_URL}
CLIENT_CORE_URL_TEMPLATE=s3://\${ARTIFACT_BUCKET}/${S3_KEY}
CLIENT_CORE_SOURCE_MODE=${SOURCE_MODE}
CLIENT_CORE_SOURCE_SUBPATH=${SOURCE_SUBPATH}
CLIENT_CORE_TREE_ISH=${TREE_ISH}
CLIENT_CORE_ARCHIVE_TREE=${ARCHIVE_TREE}
CLIENT_CORE_BYTES=${BYTES}
EOF

cat > "$PINS_PATH" <<EOF
# Compatibility pin fragment for client-core (schema_version 2).
# Generated by client-core/scripts/pack-release.sh (offline dry-run / local pack).
#
# Merge the client_core block into an operator pin file (never nest under backend).
# URL shape (company-brain-deploy product-artifact-infra):
#   s3://\$ARTIFACT_BUCKET/client-core/<version>/client-core-<version>.tar.gz
# Alternate object name under the same version prefix (also documented):
#   s3://\$ARTIFACT_BUCKET/client-core/<version>/client-core.tar.gz
#
# Terraform (separate from backend_artifact_*):
#   client_core_artifact_version = "${VERSION_LABEL}"
#   client_core_artifact_sha256  = "${SHA_HEX}"
#   client_core_artifact_url     = "${PIN_URL}"
#
# Validate after merge:
#   python3 scripts/validate-compatibility-pins.py path/to/operator-pins.yaml

# client_core:                         # top-level — separate from backend
#   version: "${VERSION_LABEL}"
#   sha256: "${SHA_HEX}"
#   url: "${PIN_URL}"

client_core:
  version: "${VERSION_LABEL}"
  sha256: "${SHA_HEX}"
  url: "${PIN_URL}"
EOF

log "Wrote $TARBALL_PATH ($BYTES bytes, $MEMBER_COUNT members)"
log "Wrote $SHA_PATH"
log "Wrote $PINS_PATH"
log "Wrote $META_PATH"
log "SHA-256: $SHA_HEX"
log "Source: mode=${SOURCE_MODE} archive_tree=${ARCHIVE_TREE}"
log "S3 object key (contract): ${S3_KEY}"
log "S3 object key (alt name): ${S3_KEY_ALT}"
log "URL shape: s3://\$ARTIFACT_BUCKET/${S3_KEY}"
log "Pin fields (compatibility schema_version 2):"
log "  client_core.version=${VERSION_LABEL}"
log "  client_core.sha256=${SHA_HEX}"
log "  client_core.url=${PIN_URL}"
log "Terraform pin aliases:"
log "  client_core_artifact_version=${VERSION_LABEL}"
log "  client_core_artifact_sha256=${SHA_HEX}"
log "  client_core_artifact_url=${PIN_URL}"

if [ "$DRY_RUN" = "1" ]; then
  log "Dry-run complete (local artifacts only; no S3 upload)."
fi
