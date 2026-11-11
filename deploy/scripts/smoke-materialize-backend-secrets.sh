#!/usr/bin/env bash
# Offline smoke for deploy/scripts/materialize-backend-secrets.py (lp-645.3 / lp-645.8.3).
# No network, no AWS — exercises --from-file, idempotency, fail-closed schema,
# OAuth auth store + custom_providers projection, and that secret values never
# appear in tool logs.
#
# Usage (from repo root):
#   bash deploy/scripts/smoke-materialize-backend-secrets.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL="$ROOT/deploy/scripts/materialize-backend-secrets.py"
FIXTURE="$ROOT/contracts/backend-runtime-v1/examples/secrets-envelope.hermes-lanyard.json"
AGENT_FIXTURE="$ROOT/contracts/backend-runtime-v1/examples/secrets-envelope.lanyard-agent.json"
MINIMAL="$ROOT/contracts/backend-runtime-v1/examples/secrets-envelope.minimal.json"
SCHEMA="$ROOT/contracts/backend-runtime-v1/secrets-envelope.schema.json"

FAILED=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAILED=$((FAILED + 1)); }

echo "==> smoke-materialize-backend-secrets (offline)"
echo "    root: $ROOT"

for p in "$TOOL" "$FIXTURE" "$AGENT_FIXTURE" "$MINIMAL" "$SCHEMA"; do
  if [[ -f "$p" ]]; then
    pass "present: ${p#$ROOT/}"
  else
    fail "missing: ${p#$ROOT/}"
  fi
done

if [[ ! -f "$TOOL" || ! -f "$FIXTURE" ]]; then
  echo "FAILED  prerequisites missing; aborting"
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/materialize-secrets-smoke.XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

HOME_DIR="$TMP/backend-home"
mkdir -p "$HOME_DIR"
LOG1="$TMP/run1.log"
LOG2="$TMP/run2.log"
LOG_BAD="$TMP/bad.log"
LOG_DRY="$TMP/dry.log"
LOG_AGENT="$TMP/agent.log"
LOG_MULTI="$TMP/multi.log"

# --- 1. --from-file materializes expected env keys + overlay + oauth ---
set +e
python3 "$TOOL" \
  --from-file "$FIXTURE" \
  --backend-home "$HOME_DIR" \
  --backend-kind hermes_lanyard \
  --schema "$SCHEMA" \
  >"$LOG1" 2>&1
RC1=$?
set -e

if [[ $RC1 -eq 0 ]]; then
  pass "first --from-file run exit 0"
else
  fail "first --from-file run exit $RC1"
  sed 's/^/         /' "$LOG1" || true
fi

ENV_FILE="$HOME_DIR/.env.secrets"
OVERLAY_FILE="$HOME_DIR/config.secrets.yaml"
AUTH_FILE="$HOME_DIR/auth.json"

if [[ -f "$ENV_FILE" ]]; then
  pass "wrote .env.secrets"
else
  fail "missing .env.secrets after materialize"
fi

if [[ -f "$OVERLAY_FILE" ]]; then
  pass "wrote config.secrets.yaml (config_secret_overlay present)"
else
  fail "missing config.secrets.yaml for hermes-lanyard fixture"
fi

if [[ -f "$AUTH_FILE" ]]; then
  pass "wrote auth.json from structured oauth"
else
  fail "missing auth.json for hermes-lanyard oauth materialize"
fi

# Expected env keys from secrets-envelope.hermes-lanyard.json
for key in OPENAI_API_KEY XAI_API_KEY ANTHROPIC_API_KEY META_API_KEY; do
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    pass "env key present: $key"
  else
    fail "env key missing: $key"
  fi
done

# Keys sorted stably (OPENAI before XAI)
if [[ -f "$ENV_FILE" ]]; then
  KEYS="$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | cut -d= -f1 || true)"
  SORTED="$(printf '%s\n' $KEYS | sort)"
  # shellcheck disable=SC2086
  if [[ "$(printf '%s\n' $KEYS)" == "$SORTED" ]]; then
    pass "env keys sorted stably"
  else
    fail "env keys not sorted: $(printf '%s ' $KEYS)"
  fi
fi

# Mode 0600 (best-effort; some FS/umask environments may differ — require no group/other write)
check_mode_600() {
  local f="$1"
  local label="$2"
  if [[ ! -f "$f" ]]; then
    fail "missing $label for mode check"
    return
  fi
  local MODE
  MODE="$(stat -c '%a' "$f" 2>/dev/null || stat -f '%OLp' "$f" 2>/dev/null || echo '')"
  if [[ "$MODE" == "600" ]]; then
    pass "$label mode 0600"
  elif [[ -n "$MODE" ]]; then
    if [[ "$MODE" =~ ^[0-7]00$ ]]; then
      pass "$label owner-only mode ($MODE)"
    else
      fail "$label mode want 600 got $MODE"
    fi
  else
    fail "could not stat $label mode"
  fi
}

check_mode_600 "$ENV_FILE" ".env.secrets"
check_mode_600 "$AUTH_FILE" "auth.json"
check_mode_600 "$OVERLAY_FILE" "config.secrets.yaml"

# Overlay mentions managed path marker and expected structure key (not secret value assert by name only)
if [[ -f "$OVERLAY_FILE" ]] && grep -q 'mcp_servers' "$OVERLAY_FILE"; then
  pass "config.secrets.yaml contains mcp_servers key"
else
  fail "config.secrets.yaml missing mcp_servers"
fi

# custom_providers projected into providers.meta with key_env (not inline api_key)
if [[ -f "$OVERLAY_FILE" ]] && grep -q 'META_API_KEY' "$OVERLAY_FILE" && grep -qE 'key_env|providers' "$OVERLAY_FILE"; then
  pass "config.secrets.yaml projects custom provider key_env (META_API_KEY)"
else
  fail "config.secrets.yaml missing custom provider key_env projection"
fi

# auth.json Hermes layout: providers map with xai-oauth + openai-codex (ids only)
if [[ -f "$AUTH_FILE" ]]; then
  if python3 - "$AUTH_FILE" <<'PY' >/dev/null
import json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
providers = data.get("providers")
if not isinstance(providers, dict):
    sys.exit("auth.json missing providers object")
for need in ("xai-oauth", "openai-codex"):
    if need not in providers:
        sys.exit(f"auth.json missing provider {need}")
    mat = providers[need]
    if not isinstance(mat, dict) or "access_token" not in mat:
        sys.exit(f"auth.json provider {need} missing access_token field")
# stable sort: keys should be sorted (openai-codex before xai-oauth)
keys = list(providers.keys())
if keys != sorted(keys):
    sys.exit(f"auth.json providers keys not sorted: {keys}")
PY
  then
    pass "auth.json Hermes providers layout (xai-oauth, openai-codex, sorted)"
  else
    fail "auth.json Hermes providers layout invalid"
  fi
fi

# --- 2. Second run is idempotent (byte-identical) ---
SUM1_ENV="$(sha256sum "$ENV_FILE" | awk '{print $1}')"
SUM1_OVL="$(sha256sum "$OVERLAY_FILE" | awk '{print $1}')"
SUM1_AUTH="$(sha256sum "$AUTH_FILE" | awk '{print $1}')"

set +e
python3 "$TOOL" \
  --from-file "$FIXTURE" \
  --backend-home "$HOME_DIR" \
  --backend-kind hermes_lanyard \
  --schema "$SCHEMA" \
  >"$LOG2" 2>&1
RC2=$?
set -e

if [[ $RC2 -eq 0 ]]; then
  pass "second --from-file run exit 0"
else
  fail "second --from-file run exit $RC2"
fi

SUM2_ENV="$(sha256sum "$ENV_FILE" | awk '{print $1}')"
SUM2_OVL="$(sha256sum "$OVERLAY_FILE" | awk '{print $1}')"
SUM2_AUTH="$(sha256sum "$AUTH_FILE" | awk '{print $1}')"

if [[ "$SUM1_ENV" == "$SUM2_ENV" ]]; then
  pass "idempotent .env.secrets (sha256 match)"
else
  fail "idempotent .env.secrets mismatch $SUM1_ENV vs $SUM2_ENV"
fi

if [[ "$SUM1_OVL" == "$SUM2_OVL" ]]; then
  pass "idempotent config.secrets.yaml (sha256 match)"
else
  fail "idempotent config.secrets.yaml mismatch"
fi

if [[ "$SUM1_AUTH" == "$SUM2_AUTH" ]]; then
  pass "idempotent auth.json (sha256 match)"
else
  fail "idempotent auth.json mismatch"
fi

# --- 3. Invalid schema fails closed ---
BAD_JSON="$TMP/bad-envelope.json"
cat >"$BAD_JSON" <<'EOF'
{"env": {"OPENAI_API_KEY": "x"}}
EOF
# missing schema_version

BAD_HOME="$TMP/bad-home"
mkdir -p "$BAD_HOME"
set +e
python3 "$TOOL" \
  --from-file "$BAD_JSON" \
  --backend-home "$BAD_HOME" \
  --schema "$SCHEMA" \
  >"$LOG_BAD" 2>&1
RC_BAD=$?
set -e

if [[ $RC_BAD -ne 0 ]]; then
  pass "invalid schema fails closed (exit $RC_BAD)"
else
  fail "invalid schema should exit non-zero"
fi

if [[ -f "$BAD_HOME/.env.secrets" ]]; then
  fail "invalid envelope must not write .env.secrets"
else
  pass "invalid envelope did not write .env.secrets"
fi

# Also reject non-object env
BAD2="$TMP/bad2.json"
echo '{"schema_version":1,"env":["OPENAI_API_KEY"]}' >"$BAD2"
set +e
python3 "$TOOL" --from-file "$BAD2" --backend-home "$BAD_HOME" --schema "$SCHEMA" >/dev/null 2>&1
RC_BAD2=$?
set -e
if [[ $RC_BAD2 -ne 0 ]]; then
  pass "env_not_object fails closed"
else
  fail "env_not_object should fail"
fi

# Wrong-type env value must fail closed without echoing the numeric secret-like value
BAD_TYPE="$TMP/bad-type.json"
# Distinctive numeric "secret" that jsonschema would normally embed in e.message
SECRET_NUM="91234567890123456789"
cat >"$BAD_TYPE" <<EOF
{"schema_version":1,"env":{"OPENAI_API_KEY": ${SECRET_NUM}}}
EOF
LOG_BAD_TYPE="$TMP/bad-type.log"
set +e
python3 "$TOOL" \
  --from-file "$BAD_TYPE" \
  --backend-home "$BAD_HOME" \
  --schema "$SCHEMA" \
  >"$LOG_BAD_TYPE" 2>&1
RC_BAD_TYPE=$?
set -e
if [[ $RC_BAD_TYPE -ne 0 ]]; then
  pass "env_wrong_type fails closed (exit $RC_BAD_TYPE)"
else
  fail "env_wrong_type should exit non-zero"
fi
if grep -Fq "$SECRET_NUM" "$LOG_BAD_TYPE"; then
  fail "wrong-type env value leaked into validation logs"
  sed 's/^/         /' "$LOG_BAD_TYPE" || true
else
  pass "wrong-type env value not present in validation logs"
fi
# Logs should still mention the path/key for operators
if grep -Eq 'OPENAI_API_KEY|env\.' "$LOG_BAD_TYPE"; then
  pass "wrong-type validation log names env key (no value)"
else
  # Soft: still pass structure if type mentioned without value
  if grep -Eqi 'type|string|invalid' "$LOG_BAD_TYPE"; then
    pass "wrong-type validation log reports type error without value"
  else
    fail "wrong-type validation log missing useful error context"
  fi
fi

# Invalid oauth shape fails closed (missing access_token)
BAD_OAUTH="$TMP/bad-oauth.json"
cat >"$BAD_OAUTH" <<'EOF'
{
  "schema_version": 1,
  "env": {"OPENAI_API_KEY": "sk-placeholder-x"},
  "oauth": {
    "xai-oauth": {
      "refresh_token": "oauth-placeholder-only-refresh"
    }
  }
}
EOF
LOG_BAD_OAUTH="$TMP/bad-oauth.log"
set +e
python3 "$TOOL" \
  --from-file "$BAD_OAUTH" \
  --backend-home "$BAD_HOME" \
  --schema "$SCHEMA" \
  >"$LOG_BAD_OAUTH" 2>&1
RC_BAD_OAUTH=$?
set -e
if [[ $RC_BAD_OAUTH -ne 0 ]]; then
  pass "oauth missing access_token fails closed"
else
  fail "oauth missing access_token should fail"
fi
if grep -Fq "oauth-placeholder-only-refresh" "$LOG_BAD_OAUTH"; then
  fail "oauth refresh token leaked into validation logs"
else
  pass "oauth validation log does not leak token values"
fi

# Invalid custom_providers fails closed
BAD_CP="$TMP/bad-cp.json"
cat >"$BAD_CP" <<'EOF'
{
  "schema_version": 1,
  "env": {"OPENAI_API_KEY": "sk-placeholder-x"},
  "custom_providers": [{"id": "meta"}]
}
EOF
set +e
python3 "$TOOL" \
  --from-file "$BAD_CP" \
  --backend-home "$BAD_HOME" \
  --schema "$SCHEMA" \
  >/dev/null 2>&1
RC_BAD_CP=$?
set -e
if [[ $RC_BAD_CP -ne 0 ]]; then
  pass "custom_providers missing base_url fails closed"
else
  fail "custom_providers missing base_url should fail"
fi

# Invalid files path fails closed
BAD_FILES="$TMP/bad-files.json"
cat >"$BAD_FILES" <<'EOF'
{
  "schema_version": 1,
  "env": {"OPENAI_API_KEY": "sk-placeholder-x"},
  "files": [{"path_relative": "../etc/passwd", "content": "x"}]
}
EOF
set +e
python3 "$TOOL" \
  --from-file "$BAD_FILES" \
  --backend-home "$BAD_HOME" \
  --schema "$SCHEMA" \
  >/dev/null 2>&1
RC_BAD_FILES=$?
set -e
if [[ $RC_BAD_FILES -ne 0 ]]; then
  pass "files path traversal fails closed"
else
  fail "files path traversal should fail"
fi

# --- 4. No secret values in logs ---
# Placeholder values from committed fixtures must never appear in tool stderr/stdout logs.
# ALL_LOGS is extended after later sections (agent/multi-slot/cp) with a final needle pass.
ALL_LOGS="$TMP/all-logs.txt"
cat "$LOG1" "$LOG2" "$LOG_BAD" "$LOG_BAD_TYPE" "$LOG_BAD_OAUTH" >"$ALL_LOGS" 2>/dev/null || true

# Dry-run should also avoid secret values
set +e
python3 "$TOOL" \
  --from-file "$FIXTURE" \
  --backend-home "$HOME_DIR" \
  --dry-run \
  --schema "$SCHEMA" \
  >"$LOG_DRY" 2>&1
RC_DRY=$?
set -e
cat "$LOG_DRY" >>"$ALL_LOGS"

if [[ $RC_DRY -eq 0 ]]; then
  pass "dry-run exit 0"
else
  fail "dry-run exit $RC_DRY"
fi

# Primary needle pass (early logs); expanded final pass after agent/multi-slot below.
SECRET_LEAKS=0
for needle in \
  "sk-placeholder-openai-replace-me" \
  "sk-placeholder-xai-replace-me" \
  "sk-placeholder-anthropic-replace-me" \
  "sk-placeholder-meta-replace-me" \
  "REPLACE_ME_mcp_token" \
  "oauth-placeholder-xai-oauth-access" \
  "oauth-placeholder-openai-codex-access" \
  "oauth-placeholder-xai-oauth-refresh" \
  "oauth-placeholder-openai-codex-refresh"
do
  if grep -Fq "$needle" "$ALL_LOGS"; then
    fail "secret value leaked into logs: ${needle:0:20}…"
    SECRET_LEAKS=$((SECRET_LEAKS + 1))
  fi
done
if [[ $SECRET_LEAKS -eq 0 ]]; then
  pass "no secret/oauth values in materialize logs (early)"
fi

# Dry-run must not rewrite files (checksum still matches first write)
SUM3_ENV="$(sha256sum "$ENV_FILE" | awk '{print $1}')"
SUM3_AUTH="$(sha256sum "$AUTH_FILE" | awk '{print $1}')"
if [[ "$SUM1_ENV" == "$SUM3_ENV" && "$SUM1_AUTH" == "$SUM3_AUTH" ]]; then
  pass "dry-run does not mutate .env.secrets or auth.json"
else
  fail "dry-run mutated managed secret files"
fi

# --- 5. minimal fixture: env only, no overlay file (or remove stale) ---
MIN_HOME="$TMP/min-home"
mkdir -p "$MIN_HOME"
# Plant a stale overlay to ensure removal when absent from envelope
echo "stale: true" >"$MIN_HOME/config.secrets.yaml"
set +e
python3 "$TOOL" \
  --from-file "$MINIMAL" \
  --backend-home "$MIN_HOME" \
  --schema "$SCHEMA" \
  >"$TMP/min.log" 2>&1
RC_MIN=$?
set -e
if [[ $RC_MIN -eq 0 && -f "$MIN_HOME/.env.secrets" ]]; then
  if grep -qE '^OPENAI_API_KEY=' "$MIN_HOME/.env.secrets"; then
    pass "minimal fixture writes OPENAI_API_KEY"
  else
    fail "minimal fixture missing OPENAI_API_KEY"
  fi
else
  fail "minimal fixture materialize failed (exit $RC_MIN)"
fi
if [[ ! -f "$MIN_HOME/config.secrets.yaml" ]]; then
  pass "minimal fixture removes stale config.secrets.yaml"
else
  fail "minimal fixture left config.secrets.yaml"
fi

# Ensure min.log also has no secret values
if grep -Fq "sk-placeholder-openai-replace-me" "$TMP/min.log"; then
  fail "minimal run leaked secret into logs"
else
  pass "minimal run logs clean"
fi
cat "$TMP/min.log" >>"$ALL_LOGS" 2>/dev/null || true

# --- 5b. M2: env-only materialize removes stale auth.json / oauth.enc ---
STALE_HOME="$TMP/stale-oauth-home"
mkdir -p "$STALE_HOME"
printf '%s\n' '{"providers":{"xai-oauth":{"access_token":"stale-token-must-be-removed"}}}' \
  >"$STALE_HOME/auth.json"
chmod 600 "$STALE_HOME/auth.json"
printf 'stale-oauth-enc-bytes' >"$STALE_HOME/oauth.enc"
chmod 600 "$STALE_HOME/oauth.enc"
LOG_STALE="$TMP/stale-oauth.log"
set +e
python3 "$TOOL" \
  --from-file "$MINIMAL" \
  --backend-home "$STALE_HOME" \
  --backend-kind hermes_lanyard \
  --schema "$SCHEMA" \
  >"$LOG_STALE" 2>&1
RC_STALE=$?
set -e
if [[ $RC_STALE -eq 0 ]]; then
  pass "env-only materialize exit 0 (stale oauth cleanup path)"
else
  fail "env-only materialize for stale cleanup exit $RC_STALE"
  sed 's/^/         /' "$LOG_STALE" || true
fi
if [[ ! -f "$STALE_HOME/auth.json" ]]; then
  pass "stale auth.json removed when envelope has no oauth/files"
else
  fail "stale auth.json left after env-only materialize"
fi
if [[ ! -f "$STALE_HOME/oauth.enc" ]]; then
  pass "stale oauth.enc removed when envelope has no oauth/files"
else
  fail "stale oauth.enc left after env-only materialize"
fi
if grep -Fq "stale-token-must-be-removed" "$LOG_STALE"; then
  fail "stale oauth token leaked into cleanup logs"
else
  pass "stale oauth cleanup logs clean"
fi
cat "$LOG_STALE" >>"$ALL_LOGS" 2>/dev/null || true

# --- 6. Multi-slot fixture: oauth + custom provider + placeholders (hermes) ---
# Synthetic multi-slot envelope (no real secrets) covering env placeholders,
# structured oauth, one custom provider with key_env, and optional files[].
MULTI_JSON="$TMP/multi-slot.json"
# Valid base64 for a tiny opaque blob (placeholder text, not a real store)
# shellcheck disable=SC2016
python3 - "$MULTI_JSON" <<'PY'
import base64, json, sys
path = sys.argv[1]
blob = base64.b64encode(b"oauth-placeholder-opaque-store-bytes").decode("ascii")
doc = {
    "schema_version": 1,
    "kind_hint": "hermes_lanyard",
    "env": {
        "OPENAI_API_KEY": "sk-placeholder-openai-optional",
        "XAI_API_KEY": "sk-placeholder-xai-optional",
        "META_API_KEY": "sk-placeholder-meta-multi",
        "ANTHROPIC_API_KEY": "sk-placeholder-anthropic-unused",
    },
    "oauth": {
        "xai-oauth": {
            "access_token": "oauth-placeholder-multi-xai-access",
            "refresh_token": "oauth-placeholder-multi-xai-refresh",
            "expires_at": "2026-12-31T00:00:00Z",
        },
        "openai-codex": {
            "access_token": "oauth-placeholder-multi-codex-access",
            "metadata": {"chatgpt_account_id": "REPLACE_ME_chatgpt_account_id"},
        },
    },
    "custom_providers": [
        {
            "id": "meta",
            "base_url": "https://api.llama.com/compat/v1",
            "api_key_env": "META_API_KEY",
            "default_model": "llama-3.1-405b",
        }
    ],
    "files": [
        {
            "path_relative": "auth.json",
            "encoding": "utf-8",
            "content": json.dumps(
                {
                    "providers": {
                        "xai-oauth": {
                            "access_token": "oauth-placeholder-from-files-xai"
                        }
                    }
                },
                sort_keys=True,
            ),
            "mode": "0600",
        }
    ],
    "meta": {"notes": "smoke multi-slot fixture — placeholders only"},
}
# hermes files[] auth.json must win over structured oauth.
with open(path, "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2, sort_keys=True)
    f.write("\n")
PY

MULTI_HOME="$TMP/multi-home"
mkdir -p "$MULTI_HOME"
set +e
python3 "$TOOL" \
  --from-file "$MULTI_JSON" \
  --backend-home "$MULTI_HOME" \
  --backend-kind hermes_lanyard \
  --schema "$SCHEMA" \
  >"$LOG_MULTI" 2>&1
RC_MULTI=$?
set -e

if [[ $RC_MULTI -eq 0 ]]; then
  pass "multi-slot fixture materialize exit 0"
else
  fail "multi-slot fixture materialize exit $RC_MULTI"
  sed 's/^/         /' "$LOG_MULTI" || true
fi

# env + placeholders written
if [[ -f "$MULTI_HOME/.env.secrets" ]] && grep -qE '^META_API_KEY=' "$MULTI_HOME/.env.secrets"; then
  pass "multi-slot wrote env including META_API_KEY placeholder"
else
  fail "multi-slot missing env META_API_KEY"
fi

# files[] auth.json wins over structured oauth
if [[ -f "$MULTI_HOME/auth.json" ]] && grep -q 'oauth-placeholder-from-files-xai' "$MULTI_HOME/auth.json"; then
  pass "multi-slot files[] auth.json wins over structured oauth"
else
  fail "multi-slot auth.json should come from files[] opaque export"
fi

# custom provider overlay with key_env
if [[ -f "$MULTI_HOME/config.secrets.yaml" ]] \
  && grep -q 'META_API_KEY' "$MULTI_HOME/config.secrets.yaml" \
  && grep -q 'key_env' "$MULTI_HOME/config.secrets.yaml"; then
  pass "multi-slot custom_providers projected with key_env"
else
  fail "multi-slot missing custom_providers key_env overlay"
fi

# multi-slot logs clean of secret-looking values
MULTI_LEAKS=0
for needle in \
  "sk-placeholder-openai-optional" \
  "sk-placeholder-meta-multi" \
  "oauth-placeholder-multi-xai-access" \
  "oauth-placeholder-from-files-xai"
do
  if grep -Fq "$needle" "$LOG_MULTI"; then
    fail "multi-slot leaked value into logs: ${needle:0:24}…"
    MULTI_LEAKS=$((MULTI_LEAKS + 1))
  fi
done
if [[ $MULTI_LEAKS -eq 0 ]]; then
  pass "multi-slot logs clean of env/oauth values"
fi

# multi-slot idempotent
SUM_M1="$(sha256sum "$MULTI_HOME/auth.json" "$MULTI_HOME/.env.secrets" "$MULTI_HOME/config.secrets.yaml" | sha256sum | awk '{print $1}')"
set +e
python3 "$TOOL" \
  --from-file "$MULTI_JSON" \
  --backend-home "$MULTI_HOME" \
  --backend-kind hermes_lanyard \
  --schema "$SCHEMA" \
  >/dev/null 2>&1
set -e
SUM_M2="$(sha256sum "$MULTI_HOME/auth.json" "$MULTI_HOME/.env.secrets" "$MULTI_HOME/config.secrets.yaml" | sha256sum | awk '{print $1}')"
if [[ "$SUM_M1" == "$SUM_M2" ]]; then
  pass "multi-slot second run idempotent"
else
  fail "multi-slot second run not idempotent"
fi

# --- 7. Lanyard Agent: env + files[] oauth.enc + custom provider overlay ---
if [[ -f "$AGENT_FIXTURE" ]]; then
  AGENT_HOME="$TMP/agent-home"
  mkdir -p "$AGENT_HOME"
  set +e
  python3 "$TOOL" \
    --from-file "$AGENT_FIXTURE" \
    --backend-home "$AGENT_HOME" \
    --backend-kind lanyard_agent \
    --schema "$SCHEMA" \
    >"$LOG_AGENT" 2>&1
  RC_AGENT=$?
  set -e
  if [[ $RC_AGENT -eq 0 ]]; then
    pass "lanyard_agent fixture materialize exit 0"
  else
    fail "lanyard_agent fixture materialize exit $RC_AGENT"
    sed 's/^/         /' "$LOG_AGENT" || true
  fi
  for key in OPENAI_API_KEY XAI_API_KEY LITELLM_MASTER_KEY LANYARD_OAUTH_KEY META_API_KEY; do
    if [[ -f "$AGENT_HOME/.env.secrets" ]] && grep -qE "^${key}=" "$AGENT_HOME/.env.secrets"; then
      pass "agent env key present: $key"
    else
      fail "agent env key missing: $key"
    fi
  done
  if [[ -f "$AGENT_HOME/oauth.enc" ]]; then
    pass "agent wrote oauth.enc from files[]"
    check_mode_600 "$AGENT_HOME/oauth.enc" "oauth.enc"
  else
    fail "agent missing oauth.enc"
  fi
  # Agent must not write cleartext auth.json from structured oauth when kind=lanyard_agent
  if [[ -f "$AGENT_HOME/auth.json" ]]; then
    fail "agent should not write Hermes auth.json for lanyard_agent kind"
  else
    pass "agent did not write Hermes auth.json"
  fi
  if [[ -f "$AGENT_HOME/config.secrets.yaml" ]] && grep -q 'META_API_KEY' "$AGENT_HOME/config.secrets.yaml"; then
    pass "agent config.secrets.yaml has custom provider key_env"
  else
    fail "agent missing custom provider overlay"
  fi
  AGENT_LEAKS=0
  for needle in \
    "sk-placeholder-litellm-master" \
    "REPLACE_ME_oauth_encryption_key_32B_min" \
    "oauth-placeholder-xai-grok-access" \
    "REPLACE_ME_base64_oauth_enc_blob"
  do
    if grep -Fq "$needle" "$LOG_AGENT"; then
      fail "agent run leaked value into logs: ${needle:0:20}…"
      AGENT_LEAKS=$((AGENT_LEAKS + 1))
    fi
  done
  if [[ $AGENT_LEAKS -eq 0 ]]; then
    pass "agent run logs clean"
  fi
else
  fail "agent fixture missing; skipped agent materialize checks"
fi

# --- 8. custom_providers only (no config_secret_overlay) still writes overlay ---
CP_ONLY="$TMP/cp-only.json"
cat >"$CP_ONLY" <<'EOF'
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {
    "META_API_KEY": "sk-placeholder-meta-cp-only",
    "OPENAI_API_KEY": "sk-placeholder-openai-cp-only"
  },
  "custom_providers": [
    {
      "id": "meta",
      "base_url": "https://api.llama.com/compat/v1",
      "key_env": "META_API_KEY"
    }
  ]
}
EOF
CP_HOME="$TMP/cp-only-home"
mkdir -p "$CP_HOME"
set +e
python3 "$TOOL" \
  --from-file "$CP_ONLY" \
  --backend-home "$CP_HOME" \
  --backend-kind hermes_lanyard \
  --schema "$SCHEMA" \
  >"$TMP/cp-only.log" 2>&1
RC_CP=$?
set -e
if [[ $RC_CP -eq 0 && -f "$CP_HOME/config.secrets.yaml" ]] \
  && grep -q 'key_env' "$CP_HOME/config.secrets.yaml" \
  && grep -q 'META_API_KEY' "$CP_HOME/config.secrets.yaml"; then
  pass "custom_providers-only envelope writes config.secrets.yaml via key_env"
else
  fail "custom_providers-only should project config.secrets.yaml"
  sed 's/^/         /' "$TMP/cp-only.log" || true
fi
if grep -Fq "sk-placeholder-meta-cp-only" "$TMP/cp-only.log"; then
  fail "cp-only run leaked secret into logs"
else
  pass "cp-only run logs clean"
fi
cat "$TMP/cp-only.log" >>"$ALL_LOGS" 2>/dev/null || true
# Fold multi-slot + agent logs into primary ALL_LOGS needle pass (m2)
if [[ -f "$LOG_MULTI" ]]; then
  cat "$LOG_MULTI" >>"$ALL_LOGS" 2>/dev/null || true
fi
if [[ -f "$LOG_AGENT" ]]; then
  cat "$LOG_AGENT" >>"$ALL_LOGS" 2>/dev/null || true
fi

# --- 9. M1: files[].mode 0644/0777 must not leave world-readable secret files ---
MODE_HOME="$TMP/mode-clamp-home"
mkdir -p "$MODE_HOME"
MODE_JSON="$TMP/mode-0644.json"
cat >"$MODE_JSON" <<'EOF'
{
  "schema_version": 1,
  "kind_hint": "hermes_lanyard",
  "env": {"OPENAI_API_KEY": "sk-placeholder-mode-clamp"},
  "files": [
    {
      "path_relative": "auth.json",
      "content": "{\"providers\":{\"xai-oauth\":{\"access_token\":\"oauth-placeholder-mode-clamp\"}}}",
      "mode": "0644"
    }
  ]
}
EOF
LOG_MODE="$TMP/mode-0644.log"
set +e
python3 "$TOOL" \
  --from-file "$MODE_JSON" \
  --backend-home "$MODE_HOME" \
  --backend-kind hermes_lanyard \
  --schema "$SCHEMA" \
  >"$LOG_MODE" 2>&1
RC_MODE=$?
set -e
if [[ $RC_MODE -eq 0 && -f "$MODE_HOME/auth.json" ]]; then
  MODE_GOT="$(stat -c '%a' "$MODE_HOME/auth.json" 2>/dev/null || stat -f '%OLp' "$MODE_HOME/auth.json" 2>/dev/null || echo '')"
  if [[ "$MODE_GOT" == "600" || "$MODE_GOT" == "400" ]]; then
    pass "files[].mode 0644 clamped to owner-only (got $MODE_GOT)"
  else
    fail "files[].mode 0644 left non-owner-only mode $MODE_GOT"
  fi
else
  fail "mode clamp materialize failed (exit $RC_MODE)"
  sed 's/^/         /' "$LOG_MODE" || true
fi
if grep -Fq "oauth-placeholder-mode-clamp" "$LOG_MODE" || grep -Fq "sk-placeholder-mode-clamp" "$LOG_MODE"; then
  fail "mode clamp run leaked secret into logs"
else
  pass "mode clamp logs clean"
fi
cat "$LOG_MODE" >>"$ALL_LOGS" 2>/dev/null || true

# 0777 also forced owner-only
MODE777_HOME="$TMP/mode-777-home"
mkdir -p "$MODE777_HOME"
MODE777_JSON="$TMP/mode-0777.json"
cat >"$MODE777_JSON" <<'EOF'
{
  "schema_version": 1,
  "env": {"OPENAI_API_KEY": "sk-placeholder-mode-777"},
  "files": [
    {
      "path_relative": "oauth.enc",
      "content": "oauth-placeholder-mode-777-blob",
      "mode": "0777"
    }
  ]
}
EOF
set +e
python3 "$TOOL" \
  --from-file "$MODE777_JSON" \
  --backend-home "$MODE777_HOME" \
  --backend-kind lanyard_agent \
  --schema "$SCHEMA" \
  >"$TMP/mode-0777.log" 2>&1
RC_MODE777=$?
set -e
if [[ $RC_MODE777 -eq 0 && -f "$MODE777_HOME/oauth.enc" ]]; then
  MODE777_GOT="$(stat -c '%a' "$MODE777_HOME/oauth.enc" 2>/dev/null || stat -f '%OLp' "$MODE777_HOME/oauth.enc" 2>/dev/null || echo '')"
  if [[ "$MODE777_GOT" == "600" || "$MODE777_GOT" == "400" ]]; then
    pass "files[].mode 0777 clamped to owner-only (got $MODE777_GOT)"
  else
    fail "files[].mode 0777 left non-owner-only mode $MODE777_GOT"
  fi
else
  fail "mode 0777 clamp materialize failed (exit $RC_MODE777)"
fi
cat "$TMP/mode-0777.log" >>"$ALL_LOGS" 2>/dev/null || true

# --- 10. M3: non-placeholder garbage content_base64 fails closed, no write ---
B64_HOME="$TMP/bad-b64-home"
mkdir -p "$B64_HOME"
# Plant nothing; ensure no write after fail
B64_JSON="$TMP/bad-b64.json"
cat >"$B64_JSON" <<'EOF'
{
  "schema_version": 1,
  "env": {"OPENAI_API_KEY": "sk-placeholder-bad-b64"},
  "files": [
    {
      "path_relative": "oauth.enc",
      "encoding": "base64",
      "content_base64": "!!!not-valid-b64@@@",
      "mode": "0600"
    }
  ]
}
EOF
LOG_B64="$TMP/bad-b64.log"
set +e
python3 "$TOOL" \
  --from-file "$B64_JSON" \
  --backend-home "$B64_HOME" \
  --backend-kind lanyard_agent \
  --schema "$SCHEMA" \
  >"$LOG_B64" 2>&1
RC_B64=$?
set -e
if [[ $RC_B64 -ne 0 ]]; then
  pass "invalid non-placeholder content_base64 fails closed (exit $RC_B64)"
else
  fail "invalid content_base64 should exit non-zero"
fi
if [[ ! -f "$B64_HOME/oauth.enc" ]]; then
  pass "invalid content_base64 did not write oauth.enc"
else
  fail "invalid content_base64 must not write oauth.enc"
fi
if grep -Fq "!!!not-valid-b64@@@" "$LOG_B64"; then
  fail "invalid base64 value leaked into logs"
else
  pass "invalid base64 value not present in logs"
fi
cat "$LOG_B64" >>"$ALL_LOGS" 2>/dev/null || true

# --- 11. m1: lanyard_agent + structured oauth without files[] oauth.enc fails closed ---
AGENT_OAUTH_ONLY="$TMP/agent-oauth-only.json"
cat >"$AGENT_OAUTH_ONLY" <<'EOF'
{
  "schema_version": 1,
  "kind_hint": "lanyard_agent",
  "env": {
    "OPENAI_API_KEY": "sk-placeholder-agent-oauth-only",
    "LANYARD_OAUTH_KEY": "REPLACE_ME_oauth_key_agent_only"
  },
  "oauth": {
    "xai-grok": {
      "access_token": "oauth-placeholder-agent-only-access"
    }
  }
}
EOF
AGENT_OO_HOME="$TMP/agent-oauth-only-home"
mkdir -p "$AGENT_OO_HOME"
LOG_AGENT_OO="$TMP/agent-oauth-only.log"
set +e
python3 "$TOOL" \
  --from-file "$AGENT_OAUTH_ONLY" \
  --backend-home "$AGENT_OO_HOME" \
  --backend-kind lanyard_agent \
  --schema "$SCHEMA" \
  >"$LOG_AGENT_OO" 2>&1
RC_AGENT_OO=$?
set -e
if [[ $RC_AGENT_OO -ne 0 ]]; then
  pass "agent structured oauth without files[] oauth.enc fails closed"
else
  fail "agent oauth without files[] should exit non-zero"
fi
if [[ ! -f "$AGENT_OO_HOME/oauth.enc" && ! -f "$AGENT_OO_HOME/auth.json" ]]; then
  pass "agent oauth-only did not write oauth store files"
else
  fail "agent oauth-only must not write oauth.enc/auth.json"
fi
if grep -Fq "oauth-placeholder-agent-only-access" "$LOG_AGENT_OO"; then
  fail "agent oauth-only leaked access token into logs"
else
  pass "agent oauth-only logs clean of token values"
fi
cat "$LOG_AGENT_OO" >>"$ALL_LOGS" 2>/dev/null || true

# --- Final expanded log leak pass (m2: agent + multi-slot + cp + harden paths) ---
FINAL_LEAKS=0
for needle in \
  "sk-placeholder-openai-replace-me" \
  "sk-placeholder-xai-replace-me" \
  "sk-placeholder-anthropic-replace-me" \
  "sk-placeholder-meta-replace-me" \
  "sk-placeholder-litellm-master" \
  "REPLACE_ME_mcp_token" \
  "REPLACE_ME_oauth_encryption_key_32B_min" \
  "REPLACE_ME_relay_secret" \
  "REPLACE_ME_base64_oauth_enc_blob" \
  "GATEWAY_RELAY_SECRET=REPLACE_ME" \
  "oauth-placeholder-xai-oauth-access" \
  "oauth-placeholder-openai-codex-access" \
  "oauth-placeholder-xai-oauth-refresh" \
  "oauth-placeholder-openai-codex-refresh" \
  "oauth-placeholder-xai-grok-access" \
  "oauth-placeholder-multi-xai-access" \
  "oauth-placeholder-from-files-xai" \
  "sk-placeholder-meta-multi" \
  "sk-placeholder-meta-cp-only" \
  "sk-placeholder-mode-clamp" \
  "oauth-placeholder-mode-clamp" \
  "!!!not-valid-b64@@@" \
  "oauth-placeholder-agent-only-access" \
  "stale-token-must-be-removed"
do
  if grep -Fq "$needle" "$ALL_LOGS"; then
    fail "secret value leaked into logs (final): ${needle:0:24}…"
    FINAL_LEAKS=$((FINAL_LEAKS + 1))
  fi
done
if [[ $FINAL_LEAKS -eq 0 ]]; then
  pass "no secret/oauth values in materialize logs (final expanded)"
fi

echo
if [[ $FAILED -eq 0 ]]; then
  echo "OK  smoke-materialize-backend-secrets passed (offline)"
  exit 0
else
  echo "FAILED  $FAILED failure(s) in smoke-materialize-backend-secrets"
  exit 1
fi
