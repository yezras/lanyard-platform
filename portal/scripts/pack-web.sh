#!/usr/bin/env bash
# pack-web.sh — Build @lanyard/web (Vite) and package a static portal-web tarball.
#
# Deploy contract (company-brain-deploy product-artifact-infra):
#   Object shape: s3://$ARTIFACT_BUCKET/portal-web/<version>/portal-web.tar.gz
#   Pin fields:   portal.web.version / portal.web.sha256 / portal.web.url
#
# Versions must be immutable labels (e.g. v0.1.0). Never main/master/HEAD/latest.
#
# Local dry-run (no AWS):
#   ./scripts/pack-web.sh --version v0.0.0-test
#
# Output (default OUT_DIR=dist/portal-web):
#   portal-web-<version>.tar.gz
#   portal-web-<version>.tar.gz.sha256   (sha256sum-compatible: "<hex>  <basename>")
#   portal-web-<version>.sha256          (same content; companion name used by some pins)
#
# Archive layout: single top-level directory portal-web-<version>/ containing the
# Vite dist contents (index.html at the root of that directory after extract).
# Consumers may flatten the single top-level directory into the origin root.
#
# Env / flags:
#   --version VER          Required immutable version label
#   --output-dir DIR       Where to write tarball + sha files (default: dist/portal-web)
#   --skip-build           Use existing apps/web/dist (faster re-pack smoke)
#   VERSION                Alternative to --version
#   OUT_DIR                Alternative to --output-dir
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
VERSION="${VERSION:-}"
OUTPUT_DIR="${OUT_DIR:-${ROOT}/dist/portal-web}"
SKIP_BUILD=0

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  echo "Usage: $0 --version <vX.Y.Z> [--output-dir DIR] [--skip-build]"
}

log() { echo "[pack-web] $*" >&2; }
die() { echo "[pack-web] ERROR: $*" >&2; exit 1; }

# Reject live git branches / mutable refs used as "versions".
is_forbidden_version_ref() {
  local v
  v="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
  case "$v" in
    main|master|head|develop|development|trunk|latest|origin/*|refs/*|"")
      return 0
      ;;
  esac
  return 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      # Positional version for convenience: pack-web.sh v0.1.0
      if [ -z "$VERSION" ] && [[ "$1" != -* ]]; then
        VERSION="$1"
        shift
      else
        die "Unknown argument: $1"
      fi
      ;;
  esac
done

[ -n "$VERSION" ] || die "--version is required (e.g. v0.1.0)"
VERSION="${VERSION#refs/tags/}"
if is_forbidden_version_ref "$VERSION"; then
  die "Refusing mutable/forbidden version label: '${VERSION}'. Use an immutable tag-style label (e.g. v0.1.0)."
fi
if ! echo "$VERSION" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._+-]*$'; then
  die "Version contains unsafe characters: '${VERSION}'"
fi
if echo "$VERSION" | grep -Eq '[[:space:]/\\]'; then
  die "VERSION must not contain whitespace or path separators: '${VERSION}'"
fi

command -v tar >/dev/null 2>&1 || die "tar is required"
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  die "sha256sum (or shasum) is required"
fi

cd "$ROOT"

if [ "$SKIP_BUILD" -eq 0 ]; then
  command -v pnpm >/dev/null 2>&1 || die "pnpm is required on PATH"
  log "Building @lanyard/web (TanStack Start SPA → apps/web/dist)"
  # Ensure workspace deps resolve; CI should already have run pnpm install.
  if [ ! -d "${ROOT}/node_modules" ] && [ ! -d "${ROOT}/apps/web/node_modules" ]; then
    log "Installing workspace dependencies (pnpm install --frozen-lockfile)"
    pnpm install --frozen-lockfile
  fi
  # VITE_ONLYOFFICE_* are build-time only (lp-zuh.10.3 / MockLab GO).
  # Operators export them before pack for staging MockLab SPA pins; defaults off.
  if [ -n "${VITE_ONLYOFFICE_EDITOR:-}" ]; then
    log "VITE_ONLYOFFICE_EDITOR=${VITE_ONLYOFFICE_EDITOR}"
  else
    log "VITE_ONLYOFFICE_EDITOR unset (editor host off — product default)"
  fi
  if [ -n "${VITE_ONLYOFFICE_DS_URL:-}" ]; then
    log "VITE_ONLYOFFICE_DS_URL=${VITE_ONLYOFFICE_DS_URL}"
  fi
  if [ -n "${VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS:-}" ]; then
    log "VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS=${VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS}"
  fi
  pnpm --filter @lanyard/web build
fi

# Resolve SPA root *after* build (TanStack Start writes dist/client/; clean
# trees have no dist/client until vite finishes — lp-zuh.12.1).
WEB_DIST="${ROOT}/apps/web/dist/client"
if [ ! -d "$WEB_DIST" ] || [ ! -f "${WEB_DIST}/index.html" ]; then
  WEB_DIST="${ROOT}/apps/web/dist"
fi

if [ "$SKIP_BUILD" -ne 0 ]; then
  log "Skipping build (--skip-build); using existing ${WEB_DIST}"
fi

if [ ! -d "$WEB_DIST" ]; then
  die "Missing Vite output directory: ${WEB_DIST} (run build first or drop --skip-build)"
fi
if [ ! -f "${WEB_DIST}/index.html" ]; then
  die "Missing ${WEB_DIST}/index.html — build did not produce a static SPA root"
fi

STAGE_PARENT="$(mktemp -d "${TMPDIR:-/tmp}/portal-web-pack.XXXXXX")"
cleanup() { rm -rf "$STAGE_PARENT"; }
trap cleanup EXIT

# Single top-level directory so consumers can flatten cleanly.
TOP_NAME="portal-web-${VERSION}"
PREFIX="${STAGE_PARENT}/${TOP_NAME}"
mkdir -p "$PREFIX"

log "Staging prefix: $PREFIX"
log "Version: $VERSION"

# Copy static assets into the top-level directory (preserve structure).
# Prefer rsync when available; fall back to tar-pipe for hidden files + fidelity.
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "${WEB_DIST}/" "${PREFIX}/"
else
  tar -C "$WEB_DIST" -cf - . | tar -C "$PREFIX" -xf -
fi

# Stamp version + build metadata for operators (not required by the SPA).
printf '%s\n' "$VERSION" >"${PREFIX}/VERSION"
{
  echo "version=${VERSION}"
  echo "product=portal-web"
  echo "package=@lanyard/web"
  echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "git_sha=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
  fi
  # OnlyOffice build-time flags (non-secret). Empty means editor off / not set.
  # lp-zuh.10.3: MockLab GO requires VITE_ONLYOFFICE_EDITOR=true + HTTPS DS URL
  # + allowlist matching portal-static-edge onlyoffice_document_server_origins.
  echo "VITE_ONLYOFFICE_EDITOR=${VITE_ONLYOFFICE_EDITOR:-}"
  echo "VITE_ONLYOFFICE_DS_URL=${VITE_ONLYOFFICE_DS_URL:-}"
  echo "VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS=${VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS:-}"
  echo "VITE_FEATURE_ONLYOFFICE_EDITOR=${VITE_FEATURE_ONLYOFFICE_EDITOR:-}"
  echo "VITE_ONLYOFFICE_DOCUMENT_SERVER_URL=${VITE_ONLYOFFICE_DOCUMENT_SERVER_URL:-}"
} >"${PREFIX}/build.env"

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(CDPATH= cd -- "$OUTPUT_DIR" && pwd)"
TARBALL_NAME="portal-web-${VERSION}.tar.gz"
TARBALL_PATH="${OUTPUT_DIR}/${TARBALL_NAME}"
SHA_PATH="${OUTPUT_DIR}/${TARBALL_NAME}.sha256"
SHA_COMPANION="${OUTPUT_DIR}/portal-web-${VERSION}.sha256"

rm -f "$TARBALL_PATH" "$SHA_PATH" "$SHA_COMPANION"

log "Creating ${TARBALL_PATH}"
# Prefer deterministic ownership; fall back if tar flags unsupported.
tar \
  --sort=name \
  --owner=0 --group=0 --numeric-owner \
  -C "$STAGE_PARENT" \
  -czf "$TARBALL_PATH" \
  "$TOP_NAME" 2>/dev/null \
  || tar -C "$STAGE_PARENT" -czf "$TARBALL_PATH" "$TOP_NAME"

if [ ! -s "$TARBALL_PATH" ]; then
  die "Tarball missing or empty: $TARBALL_PATH"
fi

# Layout smoke: exactly one top-level directory with index.html
SMOKE="$(mktemp -d "${TMPDIR:-/tmp}/portal-web-smoke.XXXXXX")"
tar -xzf "$TARBALL_PATH" -C "$SMOKE"
_entry_count=0
TOP_EXTRACTED=""
for entry in "$SMOKE"/*; do
  [ -e "$entry" ] || continue
  _entry_count=$((_entry_count + 1))
  TOP_EXTRACTED="$entry"
done
if [ "$_entry_count" -ne 1 ] || [ ! -d "$TOP_EXTRACTED" ]; then
  rm -rf "$SMOKE"
  die "Smoke check failed: expected exactly one top-level directory in tarball"
fi
if [ ! -f "${TOP_EXTRACTED}/index.html" ]; then
  rm -rf "$SMOKE"
  die "Smoke check failed: index.html missing under top-level directory"
fi
if [ ! -f "${TOP_EXTRACTED}/VERSION" ]; then
  rm -rf "$SMOKE"
  die "Smoke check failed: VERSION stamp missing under top-level directory"
fi
log "Smoke layout OK (top-level ${TOP_NAME}/ + index.html)"
rm -rf "$SMOKE"

# sha256sum format: "<hex>  <basename>" (two spaces)
if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$OUTPUT_DIR"
    sha256sum "$TARBALL_NAME" >"$(basename "$SHA_PATH")"
  )
else
  (
    cd "$OUTPUT_DIR"
    shasum -a 256 "$TARBALL_NAME" | awk '{print $1"  "$2}' >"$(basename "$SHA_PATH")"
  )
fi
# Companion without .tar.gz in the name (matches hermes-style pin tools)
cp -f "$SHA_PATH" "$SHA_COMPANION"

SHA="$(awk '{print $1}' "$SHA_PATH")"
if ! echo "$SHA" | grep -Eq '^[0-9a-f]{64}$'; then
  die "Invalid SHA-256 digest recorded: $SHA"
fi

BYTES="$(wc -c <"$TARBALL_PATH" | tr -d ' ')"
log "Wrote $TARBALL_PATH ($BYTES bytes)"
log "Wrote $SHA_PATH"
log "Wrote $SHA_COMPANION"
log "SHA-256: $SHA"
log "S3 object key (contract): portal-web/${VERSION}/portal-web.tar.gz"
log "Pin fields for company-brain-deploy:"
log "  portal.web.version=${VERSION}"
log "  portal.web.sha256=${SHA}"
log "  portal.web.url=s3://<ARTIFACT_BUCKET>/portal-web/${VERSION}/portal-web.tar.gz"

# Machine-readable summary for CI
cat <<EOF
PACK_VERSION=${VERSION}
PACK_TARBALL=${TARBALL_PATH}
PACK_TARBALL_NAME=${TARBALL_NAME}
PACK_SHA256=${SHA}
PACK_SHA_FILE=${SHA_PATH}
PACK_S3_KEY=portal-web/${VERSION}/portal-web.tar.gz
PACK_S3_SHA_KEY=portal-web/${VERSION}/portal-web.tar.gz.sha256
EOF
