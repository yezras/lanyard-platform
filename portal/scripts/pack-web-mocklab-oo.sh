#!/usr/bin/env bash
# pack-web-mocklab-oo.sh — Pack @lanyard/web with MockLab OnlyOffice Vite flags.
#
# Bead: lp-zuh.12.1
# Product default remains editor OFF; this recipe is for MockLab/staging dogfood.
#
# Usage (from portal/):
#   ./scripts/pack-web-mocklab-oo.sh --version v0.1.6-mocklab-oo-zuh121
#   ./scripts/pack-web-mocklab-oo.sh --version vX.Y.Z --env-file scripts/pack-web-mocklab-oo.env.example
#
# HTTPS Docs origin (lp-zuh.12.9): bake CloudFront (or custom docs host) HTTPS URL +
# app.withlanyard.com allowlist. Default env.example points at
# https://d3sqcebajd6ueb.cloudfront.net (CF → HTTP Docs ALB). See:
#   docs/plans/0008-daytona-agent-sandboxes/onlyoffice-mocklab-go-path.md
#   artifacts/mocklab/live-qa/lp-zuh.12.9-ds-https/
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/scripts/pack-web-mocklab-oo.env.example"
VERSION=""
OUTPUT_DIR=""
PACK_ARGS=()

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  echo "Usage: $0 --version <vX.Y.Z> [--env-file PATH] [--output-dir DIR]"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *)
      PACK_ARGS+=("$1")
      shift
      ;;
  esac
done

[ -n "$VERSION" ] || { usage >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERROR: env file not found: $ENV_FILE" >&2; exit 1; }

# shellcheck disable=SC1090
set -a
# Export only VITE_ONLYOFFICE_* / VITE_FEATURE_ONLYOFFICE_* lines (no secrets expected).
# shellcheck disable=SC1091
source <(grep -E '^(export[[:space:]]+)?VITE_(ONLYOFFICE_|FEATURE_ONLYOFFICE_)' "$ENV_FILE" | sed 's/^export[[:space:]]//')
set +a

: "${VITE_ONLYOFFICE_EDITOR:?VITE_ONLYOFFICE_EDITOR must be set by env file}"
: "${VITE_ONLYOFFICE_DS_URL:?VITE_ONLYOFFICE_DS_URL must be set by env file}"
: "${VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS:?VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS must be set by env file}"

echo "[pack-web-mocklab-oo] version=${VERSION}"
echo "[pack-web-mocklab-oo] env_file=${ENV_FILE}"
echo "[pack-web-mocklab-oo] VITE_ONLYOFFICE_EDITOR=${VITE_ONLYOFFICE_EDITOR}"
echo "[pack-web-mocklab-oo] VITE_ONLYOFFICE_DS_URL=${VITE_ONLYOFFICE_DS_URL}"
echo "[pack-web-mocklab-oo] VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS=${VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS}"

cd "$ROOT"
chmod +x scripts/pack-web.sh
ARGS=(--version "$VERSION")
if [ -n "$OUTPUT_DIR" ]; then
  ARGS+=(--output-dir "$OUTPUT_DIR")
fi
if [ ${#PACK_ARGS[@]} -gt 0 ]; then
  ARGS+=("${PACK_ARGS[@]}")
fi
exec ./scripts/pack-web.sh "${ARGS[@]}"
