#!/usr/bin/env bash
# Assign demo member role to all portal users in the demo tenant (local dev only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${PORTAL_DATA_DIR:-$ROOT/.data}/demo-env.sh"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — run scripts/seed-demo-tenant.sh first"
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

CP_URL="${CONTROL_PLANE_URL:-http://127.0.0.1:3100}"
TENANT_ID="${PORTAL_DEMO_TENANT_ID:?}"
ROLE_ID="${PORTAL_DEMO_MEMBER_ROLE_ID:?}"
# G1.2: CP requires service token when configured (dev-tmux / docker-compose).
CP_SERVICE_TOKEN="${CONTROL_PLANE_SERVICE_TOKEN:-placeholder-control-plane-service-token}"

# G4.1: query Postgres (CONTROL_PLANE_DATABASE_URL / DATABASE_URL).
DEFAULT_PG_URL="postgres://portal:portal@127.0.0.1:5432/portal_cp"
PG_URL="${CONTROL_PLANE_DATABASE_URL:-${DATABASE_URL:-$DEFAULT_PG_URL}}"

query_users() {
  if command -v psql >/dev/null 2>&1; then
    psql "$PG_URL" -At -F $'\t' \
      -c "SELECT user_id, email FROM users WHERE tenant_id = '$TENANT_ID';"
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
      psql -U portal -d portal_cp -At -F $'\t' \
      -c "SELECT user_id, email FROM users WHERE tenant_id = '$TENANT_ID';"
    return
  fi
  echo "Need psql or docker compose postgres to list users" >&2
  exit 1
}

mapfile -t user_rows < <(query_users)

if [[ "${#user_rows[@]}" -eq 0 ]]; then
  echo "No users on tenant $TENANT_ID — register in the UI first, then re-run."
  exit 0
fi

for row in "${user_rows[@]}"; do
  uid="${row%%$'\t'*}"
  email="${row#*$'\t'}"
  curl -sf -X PUT "$CP_URL/tenants/$TENANT_ID/users/$uid/roles" \
    -H "x-control-plane-service-token: $CP_SERVICE_TOKEN" \
    -H 'content-type: application/json' \
    -d "{\"role_ids\":[\"$ROLE_ID\"]}" >/dev/null
  echo "Assigned member role to $email ($uid)"
done
