#!/usr/bin/env bash
# lp-p37.2 — Run portal control-plane + BFF Postgres-backed integration suites.
#
# One command (preferred):
#   From portal workspace:   bash scripts/run-db-backed-integration-tests.sh
#   From monorepo root:      bash portal/scripts/run-db-backed-integration-tests.sh
#   Via pnpm (portal/):      pnpm test:db-integration
#
# What it does:
#   1. Ensures a reachable lab Postgres (starts docker compose service if needed,
#      or a disposable container with --disposable).
#   2. Exports CONTROL_PLANE_DATABASE_URL / DATABASE_URL for createTestStore().
#   3. Builds @lanyard/shared (required by CP/BFF tests).
#   4. Runs control-plane + BFF vitest suites (or a security-focused subset).
#   5. Prints pass/fail summary suitable for audit follow-up notes.
#
# Isolation:
#   - Integration tests open unique schemas (cp_test_<uuid>) and DROP them on close.
#   - Suites are idempotent against the shared lab DB; they do not seed durable rows
#     into the public schema under normal success paths.
#
# Cleanup (local):
#   - Default compose volume:  docker compose -f portal/docker-compose.yml down
#                              # add -v to drop portal-pg-data volume
#   - Disposable mode:         container is removed on exit unless --keep-db
#   - Orphan test schemas:     rarely left if a process is killed mid-test;
#                              re-running with a clean DB or DROP SCHEMA cp_test_* is enough
#
# Env (never commit real secrets):
#   CONTROL_PLANE_DATABASE_URL / DATABASE_URL
#     Default lab URL: postgres://portal:portal@127.0.0.1:5432/portal_cp
#   SKIP_BUILD=1           Skip shared package build
#   SKIP_INSTALL=1         Skip pnpm install when node_modules missing
#   EVIDENCE_PATH=…        Write a markdown summary (default: none)
#
# Options:
#   --cp-only              Only @lanyard/control-plane
#   --bff-only             Only @lanyard/bff
#   --security-focus       Only suites named in lp-p37.2 acceptance
#                          (CP: auth/rbac/tenant-authz; BFF: auth/settings/vault/
#                           projects/session-share)
#   --disposable           Start a temporary postgres:16 container; remove on exit
#   --keep-db              With --disposable, leave the container running
#   --skip-start           Do not start compose/disposable DB (URL must already work)
#   --help                 This help
#
# Exit codes: 0 all selected suites pass; 1 failure; 2 usage / missing tooling.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEFAULT_PG_URL="postgres://portal:portal@127.0.0.1:5432/portal_cp"
COMPOSE_FILE="${ROOT}/docker-compose.yml"
DISPOSABLE_NAME="${PORTAL_TEST_PG_NAME:-portal-db-backed-test-pg}"
DISPOSABLE_PORT="${PORTAL_TEST_PG_PORT:-55432}"

RUN_CP=1
RUN_BFF=1
SECURITY_FOCUS=0
DISPOSABLE=0
KEEP_DB=0
SKIP_START=0
EVIDENCE_PATH="${EVIDENCE_PATH:-}"

usage() {
  sed -n '2,48p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cp-only) RUN_CP=1; RUN_BFF=0; shift ;;
    --bff-only) RUN_CP=0; RUN_BFF=1; shift ;;
    --security-focus) SECURITY_FOCUS=1; shift ;;
    --disposable) DISPOSABLE=1; shift ;;
    --keep-db) KEEP_DB=1; shift ;;
    --skip-start) SKIP_START=1; shift ;;
    --evidence)
      EVIDENCE_PATH="${2:?--evidence requires a path}"
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required (Node 22+)." >&2
  exit 2
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm is required." >&2
  exit 2
fi

if [[ "$DISPOSABLE" -eq 1 ]]; then
  export CONTROL_PLANE_DATABASE_URL="${CONTROL_PLANE_DATABASE_URL:-postgres://portal:portal@127.0.0.1:${DISPOSABLE_PORT}/portal_cp}"
else
  export CONTROL_PLANE_DATABASE_URL="${CONTROL_PLANE_DATABASE_URL:-${DATABASE_URL:-$DEFAULT_PG_URL}}"
fi
export DATABASE_URL="${DATABASE_URL:-$CONTROL_PLANE_DATABASE_URL}"

# Never print full URLs (may contain credentials in non-lab setups).
redacted_url() {
  local u="$1"
  if [[ "$u" =~ ^(postgres(ql)?://[^:/@]+):([^@]+)@ ]]; then
    echo "${u//:${BASH_REMATCH[2]}@/:***@}"
  else
    echo "(set)"
  fi
}

pg_reachable() {
  CONTROL_PLANE_DATABASE_URL="$CONTROL_PLANE_DATABASE_URL" node --input-type=module -e '
import pg from "pg";
const url = process.env.CONTROL_PLANE_DATABASE_URL;
const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
try {
  await pool.query("SELECT 1");
  process.exit(0);
} catch {
  process.exit(1);
} finally {
  await pool.end().catch(() => {});
}
' 2>/dev/null
}

ensure_pg_module() {
  # Root portal package has pg as a devDependency; fall back to control-plane.
  if node --input-type=module -e 'import("pg")' 2>/dev/null; then
    return 0
  fi
  if [[ -d "$ROOT/node_modules/pg" ]] || [[ -d "$ROOT/packages/control-plane/node_modules/pg" ]]; then
    return 0
  fi
  return 1
}

start_compose_postgres() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker not available and Postgres unreachable at $(redacted_url "$CONTROL_PLANE_DATABASE_URL")." >&2
    echo "  Install docker or export CONTROL_PLANE_DATABASE_URL to a reachable Postgres." >&2
    exit 2
  fi
  echo "==> Starting compose postgres (portal/docker-compose.yml service: postgres)"
  docker compose -f "$COMPOSE_FILE" up -d postgres
  local i
  for i in $(seq 1 45); do
    if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U portal -d portal_cp >/dev/null 2>&1; then
      echo "==> Compose postgres is healthy"
      return 0
    fi
    sleep 1
  done
  echo "ERROR: compose postgres did not become healthy in time." >&2
  exit 1
}

start_disposable_postgres() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: --disposable requires docker." >&2
    exit 2
  fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$DISPOSABLE_NAME"; then
    echo "==> Removing existing disposable container: $DISPOSABLE_NAME"
    docker rm -f "$DISPOSABLE_NAME" >/dev/null
  fi
  echo "==> Starting disposable postgres:16-alpine on 127.0.0.1:${DISPOSABLE_PORT}"
  docker run -d --rm \
    --name "$DISPOSABLE_NAME" \
    -e POSTGRES_USER=portal \
    -e POSTGRES_PASSWORD=portal \
    -e POSTGRES_DB=portal_cp \
    -p "127.0.0.1:${DISPOSABLE_PORT}:5432" \
    postgres:16-alpine >/dev/null
  local i
  for i in $(seq 1 45); do
    if docker exec "$DISPOSABLE_NAME" pg_isready -U portal -d portal_cp >/dev/null 2>&1; then
      echo "==> Disposable postgres is healthy"
      return 0
    fi
    sleep 1
  done
  echo "ERROR: disposable postgres did not become healthy in time." >&2
  docker rm -f "$DISPOSABLE_NAME" >/dev/null 2>&1 || true
  exit 1
}

cleanup_disposable() {
  if [[ "$DISPOSABLE" -eq 1 && "$KEEP_DB" -eq 0 ]]; then
    if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$DISPOSABLE_NAME"; then
      echo "==> Stopping disposable postgres ($DISPOSABLE_NAME)"
      docker rm -f "$DISPOSABLE_NAME" >/dev/null 2>&1 || true
    fi
  elif [[ "$DISPOSABLE" -eq 1 && "$KEEP_DB" -eq 1 ]]; then
    echo "==> Keeping disposable postgres ($DISPOSABLE_NAME) on port ${DISPOSABLE_PORT}"
  fi
}
trap cleanup_disposable EXIT

STARTED_DB=0
if [[ "$SKIP_START" -eq 0 ]]; then
  if [[ "$DISPOSABLE" -eq 1 ]]; then
    start_disposable_postgres
    STARTED_DB=1
  else
    # Need node_modules/pg for reachability check; install first if missing.
    if [[ ! -d "$ROOT/node_modules" && "${SKIP_INSTALL:-0}" != "1" ]]; then
      echo "==> pnpm install (node_modules missing)"
      pnpm install --frozen-lockfile
    fi
    if ! ensure_pg_module && [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
      echo "==> pnpm install (pg module missing)"
      pnpm install --frozen-lockfile
    fi
    if ! pg_reachable; then
      start_compose_postgres
      STARTED_DB=1
      # Wait for TCP after compose health
      for i in $(seq 1 30); do
        if pg_reachable; then
          break
        fi
        sleep 1
      done
    fi
  fi
fi

if [[ ! -d "$ROOT/node_modules" && "${SKIP_INSTALL:-0}" != "1" ]]; then
  echo "==> pnpm install"
  pnpm install --frozen-lockfile
fi

if ! pg_reachable; then
  echo "ERROR: Postgres not reachable at $(redacted_url "$CONTROL_PLANE_DATABASE_URL")." >&2
  echo "  Start lab DB: docker compose -f portal/docker-compose.yml up -d postgres" >&2
  echo "  Or: bash scripts/run-db-backed-integration-tests.sh --disposable" >&2
  exit 1
fi
echo "==> Postgres reachable ($(redacted_url "$CONTROL_PLANE_DATABASE_URL"))"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  # BFF imports workspace packages via package.json main/exports (dist/).
  # control-plane tests only need shared; BFF needs shared + backend-runtime + hermes-compat.
  echo "==> Build workspace deps for integration suites"
  pnpm --filter @lanyard/shared run build
  if [[ "$RUN_BFF" -eq 1 ]]; then
    pnpm --filter @lanyard/backend-runtime run build
    pnpm --filter @lanyard/hermes-compat run build
  fi
fi

# File lists for security-focus mode (lp-p37.2 acceptance).
CP_SECURITY_TESTS=(
  test/auth.integration.test.ts
  test/rbac.integration.test.ts
  test/tenant-authz.integration.test.ts
  test/tenant-members.integration.test.ts
  test/service-auth.integration.test.ts
  test/session-shares.integration.test.ts
  test/schema-boundary.integration.test.ts
)

BFF_SECURITY_TESTS=(
  test/auth.integration.test.ts
  test/settings.integration.test.ts
  test/vault.integration.test.ts
  test/projects.integration.test.ts
  test/session-sharing.integration.test.ts
  test/session-shares-list.integration.test.ts
  test/org-members.integration.test.ts
  test/rbac.integration.test.ts
  test/staging.integration.test.ts
)

# Suite result accumulators (set by run_suite)
LAST_FILES_SUMMARY=""
LAST_TESTS_SUMMARY=""

run_suite() {
  local filter="$1"
  shift
  local label="$1"
  shift
  echo ""
  echo "================================================================"
  echo "==> $label"
  echo "================================================================"
  # Capture vitest output while still streaming to the terminal.
  local log
  log="$(mktemp)"
  set +e
  if [[ $# -gt 0 ]]; then
    pnpm --filter "$filter" exec vitest run "$@" 2>&1 | tee "$log"
  else
    pnpm --filter "$filter" exec vitest run 2>&1 | tee "$log"
  fi
  local rc=${PIPESTATUS[0]}
  set -e
  # Parse vitest summary lines like: "Tests  12 passed (12)" or "Tests  1 failed | 10 passed (11)"
  LAST_TESTS_SUMMARY="$(grep -E 'Tests[[:space:]]+' "$log" | tail -n 1 | sed 's/^[[:space:]]*//' || true)"
  LAST_FILES_SUMMARY="$(grep -E 'Test Files[[:space:]]+' "$log" | tail -n 1 | sed 's/^[[:space:]]*//' || true)"
  rm -f "$log"
  echo "SUITE_RESULT filter=$filter rc=$rc files=${LAST_FILES_SUMMARY:-n/a} tests=${LAST_TESTS_SUMMARY:-n/a}"
  return "$rc"
}

CP_RC=0
BFF_RC=0
CP_NOTE="skipped"
BFF_NOTE="skipped"
CP_FILES="n/a"
CP_TESTS="n/a"
BFF_FILES="n/a"
BFF_TESTS="n/a"
OVERALL=0

if [[ "$RUN_CP" -eq 1 ]]; then
  if [[ "$SECURITY_FOCUS" -eq 1 ]]; then
    if run_suite "@lanyard/control-plane" "control-plane security-focus integration" "${CP_SECURITY_TESTS[@]}"; then
      CP_NOTE="pass"
    else
      CP_RC=$?
      CP_NOTE="fail"
      OVERALL=1
    fi
  else
    if run_suite "@lanyard/control-plane" "control-plane full package tests (includes *.integration.test.ts)"; then
      CP_NOTE="pass"
    else
      CP_RC=$?
      CP_NOTE="fail"
      OVERALL=1
    fi
  fi
  CP_FILES="${LAST_FILES_SUMMARY:-n/a}"
  CP_TESTS="${LAST_TESTS_SUMMARY:-n/a}"
fi

if [[ "$RUN_BFF" -eq 1 ]]; then
  if [[ "$SECURITY_FOCUS" -eq 1 ]]; then
    if run_suite "@lanyard/bff" "bff security-focus integration" "${BFF_SECURITY_TESTS[@]}"; then
      BFF_NOTE="pass"
    else
      BFF_RC=$?
      BFF_NOTE="fail"
      OVERALL=1
    fi
  else
    if run_suite "@lanyard/bff" "bff full package tests (includes *.integration.test.ts)"; then
      BFF_NOTE="pass"
    else
      BFF_RC=$?
      BFF_NOTE="fail"
      OVERALL=1
    fi
  fi
  BFF_FILES="${LAST_FILES_SUMMARY:-n/a}"
  BFF_TESTS="${LAST_TESTS_SUMMARY:-n/a}"
fi

MODE_LABEL="$([[ "$SECURITY_FOCUS" -eq 1 ]] && echo security-focus || echo full-package)"
OVERALL_LABEL="$([[ "$OVERALL" -eq 0 ]] && echo PASS || echo FAIL)"
TS_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo ""
echo "================================================================"
echo "==> DB-backed integration summary (lp-p37.2)"
echo "================================================================"
echo "timestamp_utc:     $TS_UTC"
echo "database:          $(redacted_url "$CONTROL_PLANE_DATABASE_URL")"
echo "mode:              $MODE_LABEL"
echo "started_db_here:   $STARTED_DB (disposable=$DISPOSABLE)"
echo "control-plane:     $CP_NOTE (exit $CP_RC)"
echo "  files:           $CP_FILES"
echo "  tests:           $CP_TESTS"
echo "bff:               $BFF_NOTE (exit $BFF_RC)"
echo "  files:           $BFF_FILES"
echo "  tests:           $BFF_TESTS"
echo "overall:           $OVERALL_LABEL"
echo ""
echo "Cleanup guidance:"
if [[ "$DISPOSABLE" -eq 1 ]]; then
  if [[ "$KEEP_DB" -eq 1 ]]; then
    echo "  docker rm -f $DISPOSABLE_NAME"
  else
    echo "  (disposable container removed on exit)"
  fi
else
  echo "  Leave compose postgres running for dev, or:"
  echo "    docker compose -f $COMPOSE_FILE stop postgres"
  echo "    docker compose -f $COMPOSE_FILE down        # stop stack"
  echo "    docker compose -f $COMPOSE_FILE down -v     # also drop portal-pg-data volume"
fi
echo "  Test schemas are dropped automatically on suite close (cp_test_*)."

if [[ -n "$EVIDENCE_PATH" ]]; then
  mkdir -p "$(dirname "$EVIDENCE_PATH")"
  {
    echo "# lp-p37.2 DB-backed integration evidence"
    echo ""
    echo "| Field | Value |"
    echo "| --- | --- |"
    echo "| timestamp_utc | $TS_UTC |"
    echo "| mode | $MODE_LABEL |"
    echo "| database | \`$(redacted_url "$CONTROL_PLANE_DATABASE_URL")\` |"
    echo "| started_db_here | $STARTED_DB (disposable=$DISPOSABLE) |"
    echo "| control-plane | **$CP_NOTE** (exit $CP_RC) |"
    echo "| control-plane files | $CP_FILES |"
    echo "| control-plane tests | $CP_TESTS |"
    echo "| bff | **$BFF_NOTE** (exit $BFF_RC) |"
    echo "| bff files | $BFF_FILES |"
    echo "| bff tests | $BFF_TESTS |"
    echo "| overall | **$OVERALL_LABEL** |"
    echo ""
    echo "## Pass / fail counts (audit follow-up)"
    echo ""
    echo "| Suite | Files | Tests | Result |"
    echo "| --- | --- | --- | --- |"
    echo "| control-plane ($MODE_LABEL) | $CP_FILES | $CP_TESTS | $CP_NOTE |"
    echo "| bff ($MODE_LABEL) | $BFF_FILES | $BFF_TESTS | $BFF_NOTE |"
    echo "| **overall** | | | **$OVERALL_LABEL** |"
    echo ""
    echo "## Coverage (security-focus file set)"
    echo ""
    echo "Control-plane: auth, rbac, tenant-authz, tenant-members, service-auth, session-shares, schema-boundary."
    echo ""
    echo "BFF: auth, settings, vault, projects, session-sharing, session-shares-list, org-members, rbac, staging."
    echo ""
    echo "## Command"
    echo ""
    echo '```bash'
    echo "bash portal/scripts/run-db-backed-integration-tests.sh$([[ "$SECURITY_FOCUS" -eq 1 ]] && echo ' --security-focus')$([[ "$DISPOSABLE" -eq 1 ]] && echo ' --disposable')"
    echo '```'
    echo ""
    echo "## Cleanup"
    echo ""
    echo '```bash'
    echo "docker compose -f portal/docker-compose.yml down        # stop stack"
    echo "docker compose -f portal/docker-compose.yml down -v     # also drop portal-pg-data"
    echo "# disposable mode removes its container on exit unless --keep-db"
    echo '```'
  } >"$EVIDENCE_PATH"
  echo "==> Evidence written: $EVIDENCE_PATH"
fi

exit "$OVERALL"
