#!/usr/bin/env bash
# Build bff / relay / control-plane images and smoke-test GET /health.
# Run from anywhere; resolves monorepo root from this script path.
#
# Usage:
#   bash scripts/docker-smoke.sh
#   SMOKE_KEEP=1 bash scripts/docker-smoke.sh   # leave containers running on failure
#
# Tags are local artifacts (lanyard/<svc>:local). Production pins ECR digests — not :latest.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found on PATH" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "error: docker daemon not reachable" >&2
  exit 1
fi

TAG_SUFFIX="${SMOKE_TAG_SUFFIX:-local}"
BFF_IMAGE="lanyard/bff:${TAG_SUFFIX}"
RELAY_IMAGE="lanyard/relay:${TAG_SUFFIX}"
CP_IMAGE="lanyard/control-plane:${TAG_SUFFIX}"

BFF_NAME="portal-smoke-bff-$$"
RELAY_NAME="portal-smoke-relay-$$"
CP_NAME="portal-smoke-cp-$$"
PG_NAME=""
NET_NAME=""

BFF_HOST_PORT="${SMOKE_BFF_PORT:-14000}"
RELAY_HOST_PORT="${SMOKE_RELAY_PORT:-18787}"
CP_HOST_PORT="${SMOKE_CP_PORT:-13100}"

cleanup() {
  local code=$?
  if [[ "${SMOKE_KEEP:-0}" == "1" && "$code" -ne 0 ]]; then
    echo "SMOKE_KEEP=1 — leaving containers for debug: $BFF_NAME $RELAY_NAME $CP_NAME" >&2
    return
  fi
  docker rm -f "$BFF_NAME" "$RELAY_NAME" "$CP_NAME" "$PG_NAME" >/dev/null 2>&1 || true
  docker network rm "$NET_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Building ${BFF_IMAGE}"
docker build -f packages/bff/Dockerfile -t "$BFF_IMAGE" .

echo "==> Building ${RELAY_IMAGE}"
docker build -f packages/relay/Dockerfile -t "$RELAY_IMAGE" .

echo "==> Building ${CP_IMAGE}"
docker build -f packages/control-plane/Dockerfile -t "$CP_IMAGE" .

echo "==> Starting containers"
docker run -d --name "$BFF_NAME" \
  -p "127.0.0.1:${BFF_HOST_PORT}:4000" \
  -e BFF_PORT=4000 \
  "$BFF_IMAGE" >/dev/null

docker run -d --name "$RELAY_NAME" \
  -p "127.0.0.1:${RELAY_HOST_PORT}:8787" \
  -e PORT=8787 \
  -e RELAY_PORT=8787 \
  -e RELAY_HOST=0.0.0.0 \
  "$RELAY_IMAGE" >/dev/null

# Postgres for control-plane (G4.1)
PG_NAME="portal-smoke-pg-$$"
docker run -d --name "$PG_NAME" \
  -e POSTGRES_USER=portal \
  -e POSTGRES_PASSWORD=portal \
  -e POSTGRES_DB=portal_cp \
  postgres:16-alpine >/dev/null
# Wait for postgres
for _ in $(seq 1 30); do
  if docker exec "$PG_NAME" pg_isready -U portal -d portal_cp >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
# Shared network so CP can reach postgres by container name
NET_NAME="portal-smoke-net-$$"
docker network create "$NET_NAME" >/dev/null
docker network connect "$NET_NAME" "$PG_NAME"
docker run -d --name "$CP_NAME" --network "$NET_NAME" \
  -p "127.0.0.1:${CP_HOST_PORT}:3100" \
  -e CONTROL_PLANE_PORT=3100 \
  -e CONTROL_PLANE_DATABASE_URL=postgres://portal:portal@${PG_NAME}:5432/portal_cp \
  "$CP_IMAGE" >/dev/null

wait_health() {
  local name="$1" url="$2" attempts="${3:-30}"
  local i=1
  while (( i <= attempts )); do
    if curl -sf --max-time 2 "$url" >/dev/null 2>&1; then
      echo "    ok  $name  $url"
      return 0
    fi
    # surface early container exit
    if ! docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null | grep -q true; then
      echo "error: container $name is not running" >&2
      docker logs "$name" 2>&1 | tail -50 >&2 || true
      return 1
    fi
    sleep 1
    ((i++)) || true
  done
  echo "error: health timeout for $name ($url)" >&2
  docker logs "$name" 2>&1 | tail -50 >&2 || true
  return 1
}

echo "==> Waiting for /health"
wait_health "$BFF_NAME" "http://127.0.0.1:${BFF_HOST_PORT}/health"
wait_health "$RELAY_NAME" "http://127.0.0.1:${RELAY_HOST_PORT}/health"
wait_health "$CP_NAME" "http://127.0.0.1:${CP_HOST_PORT}/health"

echo "==> Health response bodies"
echo -n "bff:           "; curl -sS "http://127.0.0.1:${BFF_HOST_PORT}/health"; echo
echo -n "relay:         "; curl -sS "http://127.0.0.1:${RELAY_HOST_PORT}/health"; echo
echo -n "control-plane: "; curl -sS "http://127.0.0.1:${CP_HOST_PORT}/health"; echo

echo "==> Image digests (for later ECR pin story — not :latest-only)"
docker image inspect --format '{{.RepoTags}}  {{.Id}}  {{.RepoDigests}}' \
  "$BFF_IMAGE" "$RELAY_IMAGE" "$CP_IMAGE"

echo "OK: docker smoke passed for bff, relay, control-plane"
