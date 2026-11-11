#!/usr/bin/env bash
# Idempotent demo tenant for local portal dev (control plane must be up).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CP_URL="${CONTROL_PLANE_URL:-http://127.0.0.1:3100}"
# G1.2: when CP has CONTROL_PLANE_SERVICE_TOKEN set, seed must present it.
CP_SERVICE_TOKEN="${CONTROL_PLANE_SERVICE_TOKEN:-placeholder-control-plane-service-token}"
DATA_DIR="${PORTAL_DATA_DIR:-$ROOT/.data}"
ENV_FILE="$DATA_DIR/demo-env.sh"
# lp-p37.13: owner-only local secret dir (relay secrets, demo-env).
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR" 2>/dev/null || true

# Write a secret/env artifact with mode 0600 (owner read/write only).
write_secret_file() {
  local path="$1"
  local content="$2"
  # umask so the create is private even if chmod is skipped.
  (
    umask 077
    printf '%s' "$content" >"$path"
  )
  chmod 600 "$path" 2>/dev/null || true
}

cp_curl() {
  # shellcheck disable=SC2086
  curl -sf -H "x-control-plane-service-token: $CP_SERVICE_TOKEN" "$@"
}

json_field() {
  local json="$1"
  local field="$2"
  printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['$field'])"
}

echo "Seeding demo tenant via $CP_URL …"

tenant_json="$(cp_curl "$CP_URL/tenants/by-slug/demo" 2>/dev/null || true)"
if [[ -z "$tenant_json" ]]; then
  tenant_json="$(cp_curl -X POST "$CP_URL/tenants" \
    -H 'content-type: application/json' \
    -d '{"slug":"demo","display_name":"Demo"}')"
  echo "Created tenant demo"
else
  echo "Tenant demo already exists"
fi

tenant_id="$(json_field "$tenant_json" tenant_id)"

roles_json="$(cp_curl "$CP_URL/tenants/$tenant_id/roles" || echo '{}')"
role_id=""
if command -v python3 >/dev/null 2>&1; then
  role_id="$(printf '%s' "$roles_json" | python3 -c "
import json,sys
body=json.load(sys.stdin)
roles=body.get('roles') or []
for r in roles:
    if r.get('name')=='member':
        print(r['role_id'])
        break
" 2>/dev/null || true)"
fi

if [[ -z "$role_id" ]]; then
  # hermes_profile must be a host-known profile (LA: admin|contributor; HL: same).
  # "default" is rejected by Lanyard Agent Brain RPC auth (unknown hermes_profile).
  role_json="$(cp_curl -X POST "$CP_URL/tenants/$tenant_id/roles" \
    -H 'content-type: application/json' \
    -d '{"name":"member","hermes_profile":"admin","path_prefixes":["/"]}')"
  role_id="$(json_field "$role_json" role_id)"
  echo "Created role member (hermes_profile=admin, paths=/)"
else
  echo "Role member already exists"
fi

instances_json="$(cp_curl "$CP_URL/tenants/$tenant_id/gateway-instances")"
instance_id=""
instance_id="$(printf '%s' "$instances_json" | python3 -c "
import json,sys
body=json.load(sys.stdin)
instances=body.get('instances') or []
print(instances[0]['instance_id'] if instances else '')
" 2>/dev/null || true)"

secret=""
if [[ -z "$instance_id" ]]; then
  prov_json="$(cp_curl -X POST "$CP_URL/tenants/$tenant_id/instances/provision")"
  instance_id="$(json_field "$prov_json" instance_id)"
  secret="$(json_field "$prov_json" secret)"
  echo "Provisioned gateway instance $instance_id"
else
  echo "Gateway instance $instance_id already active (relay may need RELAY_DEV_SECRETS from last provision)"
  if [[ -f "$DATA_DIR/last-relay-secret.txt" ]]; then
    secret="$(cat "$DATA_DIR/last-relay-secret.txt")"
  fi
fi

if [[ -n "$secret" ]]; then
  write_secret_file "$DATA_DIR/last-relay-secret.txt" "$secret"
fi

relay_secrets_json="[]"
if [[ -n "$instance_id" && -n "$secret" ]]; then
  relay_secrets_json="$(python3 -c "import json; print(json.dumps([{'gatewayId':'dev-gateway','instanceId':'$instance_id','secret':'$secret','tenantId':'$tenant_id'}]))")"
fi

DEV_USER_EMAIL="dev@demo.local"
DEV_USER_PASSWORD="local-dev-password"

dev_user_id=""
register_http_code=""
register_json="$(curl -s -w $'\n%{http_code}' -X POST "$CP_URL/tenants/$tenant_id/users/register" \
  -H "x-control-plane-service-token: $CP_SERVICE_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$DEV_USER_EMAIL\",\"password\":\"$DEV_USER_PASSWORD\"}")"
register_http_code="$(printf '%s' "$register_json" | tail -n1)"
register_body="$(printf '%s' "$register_json" | sed '$d')"

if [[ "$register_http_code" == "201" ]]; then
  dev_user_id="$(json_field "$register_body" user_id)"
  echo "Created dev user $DEV_USER_EMAIL"
elif [[ "$register_http_code" == "409" ]]; then
  # G4.1: resolve via CP member directory API (Postgres-backed). Do not use
  # legacy DB_PATH/sqlite — under set -u that path unbound-variable aborted seed.
  members_json="$(cp_curl "$CP_URL/internal/tenants/$tenant_id/users" 2>/dev/null || true)"
  if [[ -n "$members_json" ]]; then
    dev_user_id="$(printf '%s' "$members_json" | python3 -c "
import json,sys
email = sys.argv[1].lower()
body = json.load(sys.stdin)
for m in body.get('members') or []:
    if (m.get('email') or '').lower() == email:
        print(m['user_id'])
        break
" "$DEV_USER_EMAIL" 2>/dev/null || true)"
  fi
  if [[ -z "$dev_user_id" ]]; then
    echo "Dev user $DEV_USER_EMAIL already exists but could not resolve user_id" >&2
    exit 1
  fi
  echo "Dev user $DEV_USER_EMAIL already exists"
else
  echo "Failed to seed dev user (HTTP $register_http_code): $register_body" >&2
  exit 1
fi

cp_curl -X PUT "$CP_URL/tenants/$tenant_id/users/$dev_user_id/roles" \
  -H 'content-type: application/json' \
  -d "{\"role_ids\":[\"$role_id\"]}" >/dev/null
echo "Assigned member role to $DEV_USER_EMAIL ($dev_user_id)"

# Shell env with relay secrets — owner-only (lp-p37.13).
# lp-upc: also export VITE_ONLYOFFICE_* so `pnpm dev:web` / dev-tmux web can
# enable the Edit path when a lab Document Server is present. Vite only sees
# env vars present at process start (import.meta.env); sourcing after `vite`
# starts does nothing. Default open remains client VaultReader preview.
ONLYOFFICE_EDITOR_DEFAULT="${VITE_ONLYOFFICE_EDITOR:-true}"
ONLYOFFICE_DS_DEFAULT="${VITE_ONLYOFFICE_DS_URL:-http://127.0.0.1:8080}"
(
  umask 077
  cat > "$ENV_FILE" <<EOF
# Generated by scripts/seed-demo-tenant.sh — source before relay/bff/web
# Mode 0600 (owner-only). Do not commit. See docs/runbooks/local-secret-hygiene.md
export DEV_TENANT_SLUG=demo
export CONTROL_PLANE_URL=$CP_URL
export CONTROL_PLANE_SERVICE_TOKEN=$CP_SERVICE_TOKEN
export RELAY_URL=http://127.0.0.1:8787
export RELAY_INTERNAL_TOKEN=placeholder-relay-internal-token
export RELAY_DEV_SECRETS='$relay_secrets_json'
export PORTAL_DEMO_TENANT_ID='$tenant_id'
export PORTAL_DEMO_MEMBER_ROLE_ID='$role_id'
# Local /admin stub: any of these emails. Production stays fail-closed.
export PLATFORM_OPERATOR_EMAILS=ops@lanyard.local,dev@demo.local,agent-dev@mocklab.example.com
# lp-upc / lp-5q6: ONLYOFFICE Edit (not default open). Vite injects these at
# dev-server start — web must source this file before \`pnpm dev:web\`.
# Default open is always client VaultReader preview; Edit needs flag + DS + vault_edit.
export VITE_ONLYOFFICE_EDITOR=$ONLYOFFICE_EDITOR_DEFAULT
export VITE_ONLYOFFICE_DS_URL=$ONLYOFFICE_DS_DEFAULT
EOF
)
chmod 600 "$ENV_FILE" 2>/dev/null || true

echo "Wrote $ENV_FILE (mode 0600)"
if [[ -f "$DATA_DIR/last-relay-secret.txt" ]]; then
  echo "Relay secret file: $DATA_DIR/last-relay-secret.txt (mode 0600)"
fi
echo ""
echo "Open: http://demo.localhost:3010  (or http://localhost:3010 with DEV_TENANT_SLUG)"
echo "Sign in: $DEV_USER_EMAIL / $DEV_USER_PASSWORD (credentials documented in testing.md only)"
echo "OnlyOffice Edit (lab): VITE_ONLYOFFICE_EDITOR=$ONLYOFFICE_EDITOR_DEFAULT VITE_ONLYOFFICE_DS_URL=$ONLYOFFICE_DS_DEFAULT"
echo "  → source $ENV_FILE before pnpm dev:web (dev-tmux / scripts/dev-web.sh do this)"
echo "Secret hygiene: bash scripts/secure-local-secrets.sh  (or docs/runbooks/local-secret-hygiene.md)"