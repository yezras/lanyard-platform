#!/usr/bin/env bash
# Emit a portal-image-digests JSON document for local/CI use.
#
# Production digests come from .github/workflows/release-images.yml after ECR
# push. This helper formats the same schema when you already know repository
# URLs and digests (e.g. post-push operator tooling), or when you only have
# local image IDs for smoke (not valid ECR pin coordinates).
#
# Usage:
#   bash scripts/emit-image-digests.sh \
#     --version v0.1.0 \
#     --git-sha "$(git rev-parse HEAD)" \
#     --registry 123456789012.dkr.ecr.us-east-1.amazonaws.com \
#     --name-prefix lanyard-platform-staging \
#     --svc bff=sha256:abc... \
#     --svc relay=sha256:def... \
#     --svc control-plane=sha256:ghi...
#
# Or read digests from already-pushed tags:
#   bash scripts/emit-image-digests.sh --version v0.1.0 --from-ecr \
#     --registry "$REGISTRY" --name-prefix "$ECR_NAME_PREFIX"
#
# Writes portal-image-digests-<version>.json to stdout or --out PATH.
set -euo pipefail

VERSION=""
GIT_SHA="${GIT_SHA:-}"
REGISTRY=""
NAME_PREFIX=""
OUT=""
FROM_ECR=0
declare -A DIGESTS=()

usage() {
  sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --git-sha) GIT_SHA="${2:-}"; shift 2 ;;
    --registry) REGISTRY="${2:-}"; shift 2 ;;
    --name-prefix) NAME_PREFIX="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --from-ecr) FROM_ECR=1; shift ;;
    --svc)
      entry="${2:-}"
      svc="${entry%%=*}"
      dig="${entry#*=}"
      if [[ -z "$svc" || -z "$dig" || "$svc" == "$dig" ]]; then
        echo "error: --svc expects name=sha256:…" >&2
        exit 2
      fi
      DIGESTS["$svc"]="$dig"
      shift 2
      ;;
    -h|--help) usage 0 ;;
    *)
      echo "error: unknown arg: $1" >&2
      usage 2
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "error: --version is required" >&2
  exit 2
fi
lower="$(echo "$VERSION" | tr '[:upper:]' '[:lower:]')"
case "$lower" in
  main|master|head|develop|development|trunk|latest|origin/*|refs/*)
    echo "error: refusing mutable version label: $VERSION" >&2
    exit 2
    ;;
esac

SERVICES=(bff relay control-plane)

if [[ "$FROM_ECR" -eq 1 ]]; then
  if [[ -z "$REGISTRY" || -z "$NAME_PREFIX" ]]; then
    echo "error: --from-ecr requires --registry and --name-prefix" >&2
    exit 2
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "error: docker not found" >&2
    exit 1
  fi
  for svc in "${SERVICES[@]}"; do
    ref="${REGISTRY}/${NAME_PREFIX}/portal/${svc}:${VERSION}"
    dig="$(docker buildx imagetools inspect "$ref" --format '{{json .Manifest.Digest}}' | tr -d '"')"
    if ! echo "$dig" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
      echo "error: invalid digest for $ref: $dig" >&2
      exit 2
    fi
    DIGESTS["$svc"]="$dig"
  done
fi

for svc in "${SERVICES[@]}"; do
  if [[ -z "${DIGESTS[$svc]:-}" ]]; then
    echo "error: missing digest for service '$svc' (pass --svc ${svc}=sha256:… or --from-ecr)" >&2
    exit 2
  fi
  if ! echo "${DIGESTS[$svc]}" | grep -Eq '^sha256:[0-9a-f]{64}$'; then
    echo "error: invalid digest for $svc: ${DIGESTS[$svc]}" >&2
    exit 2
  fi
done

if [[ -z "$GIT_SHA" ]] && command -v git >/dev/null 2>&1; then
  GIT_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
fi
GIT_SHA="${GIT_SHA:-unknown}"

export VERSION GIT_SHA REGISTRY NAME_PREFIX
for svc in "${SERVICES[@]}"; do
  export "DIGEST_${svc//-/_}=${DIGESTS[$svc]}"
done

json="$(python3 - <<'PY'
import json, os

services = ["bff", "relay", "control-plane"]
registry = os.environ.get("REGISTRY") or ""
prefix = os.environ.get("NAME_PREFIX") or ""
images = {}
for svc in services:
    env_key = "DIGEST_" + svc.replace("-", "_")
    digest = os.environ[env_key]
    if registry and prefix:
        repository = f"{registry}/{prefix}/portal/{svc}"
    else:
        repository = f"<registry>/{prefix or '<name_prefix>'}/portal/{svc}"
    images[svc] = {
        "repository": repository,
        "digest": digest,
        "tag": os.environ["VERSION"],
        "pin_ref": f"{repository}@{digest}",
    }

doc = {
    "schema_version": 1,
    "version": os.environ["VERSION"],
    "git_sha": os.environ["GIT_SHA"],
    "registry": registry or None,
    "ecr_name_prefix": prefix or None,
    "images": images,
}
print(json.dumps(doc, indent=2))
PY
)"

if [[ -n "$OUT" ]]; then
  printf '%s\n' "$json" >"$OUT"
  echo "wrote $OUT" >&2
else
  printf '%s\n' "$json"
fi
