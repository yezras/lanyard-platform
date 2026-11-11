#!/usr/bin/env bash
# Offline smoke: deploy/dev/lab-shared-compose-ds (topology lab-shared-compose-ds, lp-5q6.25).
# Default: no Docker pull, no container start, no network.
# Optional: LIVE=1 starts compose (may pull) and curls healthcheck + api.js.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAB="$ROOT/dev/lab-shared-compose-ds"
RUNBOOK="$ROOT/references/runbooks/lab-onlyoffice-document-server.md"

err() { echo "[smoke-lab-onlyoffice-compose] ERROR: $*" >&2; }
log() { echo "[smoke-lab-onlyoffice-compose] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

require_file() {
  local f="$1"
  [ -f "$f" ] || fail "required file missing: $f"
}

require_dir() {
  local d="$1"
  [ -d "$d" ] || fail "required directory missing: $d"
}

# --- Layout ---
require_dir "$LAB"
for f in docker-compose.yml .env.example README.md; do
  require_file "$LAB/$f"
done
require_file "$RUNBOOK"
pass "lab compose tree + runbook present"

COMPOSE="$LAB/docker-compose.yml"
ENVEX="$LAB/.env.example"

# --- Compose invariants: image, JWT, host gateway, volumes, lab labels ---
grep -Eq 'image:[[:space:]]*onlyoffice/documentserver' "$COMPOSE" \
  || fail "compose must use onlyoffice/documentserver image (Community free track)"
grep -Eq 'JWT_ENABLED' "$COMPOSE" \
  || fail "compose must set JWT_ENABLED"
grep -Eq 'JWT_SECRET' "$COMPOSE" \
  || fail "compose must set JWT_SECRET from env"
grep -Eq 'host\.docker\.internal:host-gateway' "$COMPOSE" \
  || fail "compose must map host.docker.internal:host-gateway for DS→BFF reachability"
grep -Eq 'lab_onlyoffice_data' "$COMPOSE" \
  || fail "compose must declare lab_onlyoffice_data volume for teardown wipe"
grep -Eq 'lab-shared-compose-ds' "$COMPOSE" \
  || fail "compose must label topology lab-shared-compose-ds"
grep -Eq 'lp-5q6\.25' "$COMPOSE" \
  || fail "compose must label bead lp-5q6.25"
# Production honesty: must not claim production
if grep -Eiq 'production[[:space:]]*:[[:space:]]*"?true"?' "$COMPOSE"; then
  fail "compose must not set production=true"
fi
pass "compose image/JWT/host-gateway/volumes/labels"

# JWT must not be hard-coded as a production-looking secret in compose
if grep -E 'JWT_SECRET:[[:space:]]*["'\'']?(prod|production|sm-|arn:)' "$COMPOSE"; then
  fail "compose must not embed production-looking JWT_SECRET values"
fi
# Prefer env substitution for secret
grep -Eq 'JWT_SECRET:.*\$\{JWT_SECRET' "$COMPOSE" \
  || fail "JWT_SECRET must come from environment substitution, not a fixed production value"
pass "JWT_SECRET is env-driven (lab .env only)"

# Port publish should default to loopback-friendly mapping
grep -Eq '8080:80|DS_HOST_PORT' "$COMPOSE" \
  || fail "compose must publish DS on configurable host port (default 8080→80)"
pass "host port mapping present"

# --- .env.example: known lab secret, not production SM ---
grep -Eq '^JWT_ENABLED=true' "$ENVEX" \
  || fail ".env.example must set JWT_ENABLED=true"
grep -Eq '^JWT_SECRET=' "$ENVEX" \
  || fail ".env.example must define JWT_SECRET"
grep -Eq 'lab-only|not-for-production|not_for_production' "$ENVEX" \
  || fail ".env.example JWT_SECRET must be clearly lab-only (name contains lab-only / not-for-production)"
if grep -Eiq 'arn:aws:secretsmanager|AKIA[0-9A-Z]{16}|production-jwt' "$ENVEX"; then
  fail ".env.example must not contain production SM ARNs or cloud access keys"
fi
grep -Eq 'host\.docker\.internal' "$ENVEX" \
  || fail ".env.example must document LAB_BFF_PUBLIC_BASE_URL with host.docker.internal"
grep -Eq '^DS_HOST_PORT=' "$ENVEX" \
  || fail ".env.example must document DS_HOST_PORT"
pass ".env.example lab secret + BFF reachability docs"

# --- Runbook coverage: resources, ports, env, teardown, api.js, BFF reachability ---
for needle in \
  'CPU' \
  'RAM' \
  'Disk' \
  '8080' \
  'JWT_SECRET' \
  'Teardown' \
  'api.js' \
  'host.docker.internal' \
  'callback' \
  'download' \
  'lab-only' \
  'docker compose down'
do
  grep -Fq "$needle" "$RUNBOOK" \
    || fail "runbook must document/mention: $needle"
done
pass "runbook documents CPU/RAM/disk/ports/env/teardown/api.js/BFF reachability"

# README points at runbook
grep -Eq 'lab-onlyoffice-document-server' "$LAB/README.md" \
  || fail "lab README must link the operator runbook"
pass "README links runbook"

# --- gitignore must keep .env out of git ---
GITIGNORE="$ROOT/.gitignore"
require_file "$GITIGNORE"
grep -Eq '^\.env$' "$GITIGNORE" || grep -Eq '^\.env\.\*$' "$GITIGNORE" \
  || fail "deploy/.gitignore must ignore .env / .env.*"
pass "deploy/.gitignore ignores operator .env"

# --- Optional LIVE smoke: start stack and fetch api.js ---
if [ "${LIVE:-0}" = "1" ]; then
  log "LIVE=1: starting Document Server (may pull image; can take several minutes)"
  command -v docker >/dev/null 2>&1 || fail "LIVE=1 requires docker"
  docker compose version >/dev/null 2>&1 || fail "LIVE=1 requires docker compose v2"

  # Ensure .env exists for required JWT_SECRET
  if [ ! -f "$LAB/.env" ]; then
    cp "$ENVEX" "$LAB/.env"
    log "created $LAB/.env from .env.example"
  fi

  # shellcheck disable=SC1091
  set -a
  # shellcheck source=/dev/null
  source "$LAB/.env"
  set +a
  DS_PORT="${DS_HOST_PORT:-8080}"
  DS_URL="http://127.0.0.1:${DS_PORT}"

  (
    cd "$LAB"
    docker compose up -d
  )

  log "waiting for healthcheck at ${DS_URL}/healthcheck (up to ~4 min)"
  ok=0
  for i in $(seq 1 48); do
    if curl -fsS --connect-timeout 2 "${DS_URL}/healthcheck" 2>/dev/null | grep -qiE 'true|ok'; then
      ok=1
      break
    fi
    sleep 5
  done
  [ "$ok" = "1" ] || fail "Document Server healthcheck did not become ready in time"

  api_tmp="$(mktemp)"
  curl -fsS --connect-timeout 5 -o "$api_tmp" "${DS_URL}/web-apps/apps/api/documents/api.js" \
    || { rm -f "$api_tmp"; fail "failed to download api.js from ${DS_URL}"; }
  # Copyright header first; DocsAPI appears after AGPL banner — search full file.
  if ! grep -Eq 'DocsAPI|onlyoffice|DocEditor' "$api_tmp"; then
    rm -f "$api_tmp"
    fail "api.js body does not look like ONLYOFFICE Docs API loader"
  fi
  api_size="$(wc -c <"$api_tmp" | tr -d ' ')"
  rm -f "$api_tmp"
  [ "${api_size}" -gt 1000 ] || fail "api.js unexpectedly small (${api_size} bytes)"
  pass "LIVE healthcheck + api.js load (${DS_URL}, ${api_size} bytes)"

  # Best-effort: DS can resolve host gateway (BFF may be down — only check DNS/TCP path docs)
  if docker exec lab-onlyoffice-ds getent hosts host.docker.internal >/dev/null 2>&1 \
    || docker exec lab-onlyoffice-ds ping -c1 -W1 host.docker.internal >/dev/null 2>&1; then
    pass "LIVE host.docker.internal resolves inside DS container"
  else
    log "WARN: could not confirm host.docker.internal inside container (engine-specific); runbook still documents extra_hosts"
  fi
else
  log "skip LIVE docker proof (set LIVE=1 to start stack and curl api.js)"
fi

log "all checks passed"
exit 0
