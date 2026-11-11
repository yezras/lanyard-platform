#!/usr/bin/env bash
# Offline smoke for LiteLLM multi-slot secrets + OAuth parity (lp-645.8.5).
# No network, no live keys — config template slots, env placeholders,
# map-oauth-to-litellm contract, agent envelope wiring.
#
# Usage (from repo root):
#   bash deploy/scripts/smoke-litellm-multi-slot.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LITELLM_DIR="$ROOT/deploy/litellm"
CONFIG="$LITELLM_DIR/config.yaml"
ENV_EXAMPLE="$LITELLM_DIR/env.secrets.example"
README="$LITELLM_DIR/README.md"
MAPPER="$ROOT/deploy/scripts/map-oauth-to-litellm.py"
AGENT_FIXTURE="$ROOT/contracts/backend-runtime-v1/examples/secrets-envelope.lanyard-agent.json"
FULL_FIXTURE="$ROOT/contracts/backend-runtime-v1/examples/secrets-envelope.full-matrix.json"
ARCH_DOC="$ROOT/docs/architecture/lanyard-agent-multi-provider-secrets.md"
FS_LAYOUT="$ROOT/contracts/backend-runtime-v1/filesystem-layout.md"

FAILED=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAILED=$((FAILED + 1)); }

echo "==> smoke-litellm-multi-slot (offline)"
echo "    root: $ROOT"

# --- presence ---
for p in "$CONFIG" "$ENV_EXAMPLE" "$README" "$MAPPER" "$AGENT_FIXTURE" \
  "$FULL_FIXTURE" "$ARCH_DOC" "$FS_LAYOUT"
do
  if [[ -f "$p" ]]; then
    pass "present: ${p#$ROOT/}"
  else
    fail "missing: ${p#$ROOT/}"
  fi
done

if [[ ! -f "$CONFIG" || ! -f "$MAPPER" ]]; then
  echo "FAILED  required files missing; aborting"
  exit 1
fi

# --- config.yaml model_list slots ---
CONFIG_TEXT="$(cat "$CONFIG")"

# Required model slots (names appear as model_name: <slot>)
REQUIRED_SLOTS=(
  "openai/*"
  "xai/*"
  "anthropic/*"
  "xai/grok-3-oauth"
  "xai/grok-build-oauth"
  "openai/codex-oauth"
  "meta/llama-3.1-405b"
  "corp/proxy-default"
  "poolside/*"
  "poolside/laguna-s-2.1"
  # Portal intelligence tiers + auto_router (lp-uxy.12)
  "lanyard-simple"
  "lanyard-moderate"
  "lanyard-complex"
  "lanyard-reasoning"
  "lanyard-auto"
)
for slot in "${REQUIRED_SLOTS[@]}"; do
  if grep -Fq "model_name: $slot" "$CONFIG"; then
    pass "model_list slot: $slot"
  else
    fail "missing model_list slot: $slot"
  fi
done

# auto_router wiring (lp-uxy.12)
if grep -Fq 'model: auto_router/complexity_router' "$CONFIG"; then
  pass "lanyard-auto uses auto_router/complexity_router"
else
  fail "missing auto_router/complexity_router on intelligence router"
fi
for tier_key in SIMPLE MEDIUM COMPLEX REASONING; do
  if grep -E "^\s+${tier_key}:" "$CONFIG" | grep -q 'lanyard-'; then
    pass "complexity_router tier $tier_key → lanyard-* pin"
  else
    fail "complexity_router tier $tier_key not mapped to lanyard-* pin"
  fi
done
if grep -Fq 'complexity_router_default_model:' "$CONFIG"; then
  pass "complexity_router_default_model set"
else
  fail "missing complexity_router_default_model"
fi
if grep -Fq 'lanyard_intelligence_router: true' "$CONFIG"; then
  pass "model_info marks lanyard_intelligence_router"
else
  fail "missing lanyard_intelligence_router annotation"
fi

# Env placeholders in litellm_params
for envkey in OPENAI_API_KEY XAI_API_KEY ANTHROPIC_API_KEY META_API_KEY POOLSIDE_API_KEY \
  CORP_LLM_API_KEY LITELLM_MASTER_KEY
do
  if grep -Fq "os.environ/$envkey" "$CONFIG" || grep -Fq "os.environ/${envkey}" "$CONFIG"; then
    pass "config references os.environ/$envkey"
  else
    # master_key uses os.environ/LITELLM_MASTER_KEY under general_settings
    if grep -Fq "$envkey" "$CONFIG"; then
      pass "config references $envkey"
    else
      fail "config missing env placeholder $envkey"
    fi
  fi
done

# OAuth clientside auth params
if grep -Fq 'configurable_clientside_auth_params' "$CONFIG"; then
  pass "OAuth models declare configurable_clientside_auth_params"
else
  fail "missing configurable_clientside_auth_params for *-oauth models"
fi

# OAuth provider annotations
for prov in xai-grok openai-codex; do
  if grep -Fq "lanyard_oauth_provider: $prov" "$CONFIG"; then
    pass "model_info lanyard_oauth_provider: $prov"
  else
    fail "missing lanyard_oauth_provider: $prov"
  fi
done

# Custom Meta api_base
if grep -Fq 'api_base: https://api.llama.com/compat/v1' "$CONFIG"; then
  pass "Meta custom api_base documented in model_list"
else
  fail "missing Meta api_base in config"
fi
if grep -Fq 'api_base: https://inference.poolside.ai/v1' "$CONFIG"; then
  pass "Poolside api_base documented in model_list"
else
  fail "missing Poolside api_base in config"
fi

# No live-looking secrets in config (no raw sk-live, no long tokens)
if grep -Eiq 'sk-[a-zA-Z0-9]{20,}' "$CONFIG"; then
  fail "config appears to embed a live-looking api key"
else
  pass "config has no live-looking api keys"
fi

# --- env.secrets.example full slot set ---
if [[ -f "$ENV_EXAMPLE" ]]; then
  for envkey in OPENAI_API_KEY XAI_API_KEY ANTHROPIC_API_KEY LITELLM_MASTER_KEY \
    LANYARD_OAUTH_KEY META_API_KEY CORP_LLM_API_KEY OPENROUTER_API_KEY POOLSIDE_API_KEY \
    GATEWAY_RELAY_SECRET
  do
    if grep -qE "^${envkey}=" "$ENV_EXAMPLE"; then
      pass "env.secrets.example has $envkey"
    else
      fail "env.secrets.example missing $envkey"
    fi
  done
  # Placeholders only
  if grep -Eiq 'sk-proj-|sk-ant-api|xai-[A-Za-z0-9]{20,}' "$ENV_EXAMPLE"; then
    fail "env.secrets.example may contain live-looking secrets"
  else
    pass "env.secrets.example placeholders only (heuristic)"
  fi
fi

# --- map-oauth-to-litellm self-test ---
set +e
MAP_OUT="$(python3 "$MAPPER" --self-test 2>&1)"
MAP_RC=$?
set -e
if [[ $MAP_RC -eq 0 ]]; then
  pass "map-oauth-to-litellm --self-test"
else
  fail "map-oauth-to-litellm --self-test exited $MAP_RC"
  echo "$MAP_OUT" | sed 's/^/         /'
fi

# --- map from agent envelope (no secret leak) ---
if [[ -f "$AGENT_FIXTURE" ]]; then
  set +e
  ENV_MAP_OUT="$(python3 "$MAPPER" --from-envelope "$AGENT_FIXTURE" 2>&1)"
  ENV_MAP_RC=$?
  set -e
  if [[ $ENV_MAP_RC -eq 0 ]]; then
    pass "map from secrets-envelope.lanyard-agent.json"
  else
    fail "map from agent envelope exited $ENV_MAP_RC"
    echo "$ENV_MAP_OUT" | sed 's/^/         /'
  fi
  # must mention both providers as mapped
  if echo "$ENV_MAP_OUT" | grep -q 'xai-grok' && echo "$ENV_MAP_OUT" | grep -q 'openai-codex'; then
    pass "agent envelope maps xai-grok + openai-codex"
  else
    fail "agent envelope map missing xai-grok/openai-codex"
  fi
  if echo "$ENV_MAP_OUT" | grep -q 'oauth_enc_via_files'; then
    # true expected for agent fixture
    if echo "$ENV_MAP_OUT" | grep -q '"oauth_enc_via_files": true'; then
      pass "agent fixture oauth.enc via files[] detected"
    else
      fail "agent fixture should flag oauth_enc_via_files true"
    fi
  fi
  # secret leak check
  LEAKS=0
  for needle in \
    "oauth-placeholder-xai-grok-access" \
    "oauth-placeholder-openai-codex-access" \
    "sk-placeholder-litellm-master" \
    "REPLACE_ME_oauth_encryption_key_32B_min" \
    "REPLACE_ME_base64_oauth_enc_blob" \
    "sk-placeholder-openai-replace-me" \
    "sk-placeholder-meta-replace-me"
  do
    if echo "$ENV_MAP_OUT" | grep -Fq "$needle"; then
      fail "mapper leaked value: ${needle:0:24}…"
      LEAKS=$((LEAKS + 1))
    fi
  done
  if [[ $LEAKS -eq 0 ]]; then
    pass "mapper output clean of secret/placeholder values"
  fi
fi

# --- list-table includes both providers ---
TABLE_OUT="$(python3 "$MAPPER" --list-table)"
for need in xai-grok openai-codex xai/grok-3-oauth openai/codex-oauth; do
  if echo "$TABLE_OUT" | grep -Fq "$need"; then
    pass "table contains $need"
  else
    fail "table missing $need"
  fi
done

# --- provider CLI ---
PROV_OUT="$(python3 "$MAPPER" --providers xai-grok,openai-codex)"
if echo "$PROV_OUT" | grep -q 'configurable_clientside_auth_params'; then
  pass "--providers emits clientside auth params"
else
  fail "--providers missing clientside auth params"
fi

# --- agent envelope has required multi-slot keys ---
if [[ -f "$AGENT_FIXTURE" ]]; then
  for key in OPENAI_API_KEY XAI_API_KEY LITELLM_MASTER_KEY LANYARD_OAUTH_KEY META_API_KEY POOLSIDE_API_KEY; do
    if grep -q "\"$key\"" "$AGENT_FIXTURE"; then
      pass "agent envelope env has $key"
    else
      fail "agent envelope missing env $key"
    fi
  done
  for prov in xai-grok openai-codex; do
    if grep -q "\"$prov\"" "$AGENT_FIXTURE"; then
      pass "agent envelope oauth has $prov"
    else
      fail "agent envelope missing oauth $prov"
    fi
  done
  if grep -q 'oauth.enc' "$AGENT_FIXTURE"; then
    pass "agent envelope files[] includes oauth.enc"
  else
    fail "agent envelope missing files[] oauth.enc"
  fi
fi

# --- docs mention OAuth path + Meta + EnvironmentFile ---
if [[ -f "$ARCH_DOC" ]]; then
  for needle in "xai-grok" "openai-codex" "oauth.enc" "configurable_clientside_auth_params" \
    "META_API_KEY" "POOLSIDE_API_KEY" "LITELLM_MASTER_KEY" "EnvironmentFile" "map-oauth-to-litellm"
  do
    if grep -Fq "$needle" "$ARCH_DOC"; then
      pass "arch doc mentions $needle"
    else
      fail "arch doc missing $needle"
    fi
  done
fi

if [[ -f "$FS_LAYOUT" ]]; then
  for needle in "oauth.enc" "litellm" "LANYARD_OAUTH_KEY" ".env.secrets"; do
    if grep -Fq "$needle" "$FS_LAYOUT"; then
      pass "filesystem-layout mentions $needle"
    else
      fail "filesystem-layout missing $needle"
    fi
  done
fi

if [[ -f "$README" ]]; then
  if grep -Fq 'custom Meta' "$README" || grep -Fq 'Custom Meta' "$README" || grep -Fq 'meta/llama' "$README"; then
    pass "litellm README documents custom Meta"
  else
    fail "litellm README missing custom Meta docs"
  fi
  for needle in "lanyard-auto" "auto_router" "lanyard-simple" "lp-uxy.12"; do
    if grep -Fq "$needle" "$README"; then
      pass "litellm README documents $needle"
    else
      fail "litellm README missing $needle"
    fi
  done
fi

# --- YAML parse (structure only; no live LiteLLM) ---
set +e
YAML_OUT="$(python3 - "$CONFIG" <<'PY' 2>&1
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
try:
    import yaml  # type: ignore
except ImportError:
    need = [
        "model_name: lanyard-auto",
        "auto_router/complexity_router",
        "SIMPLE:",
        "MEDIUM:",
        "COMPLEX:",
        "REASONING:",
        "lanyard-simple",
        "complexity_router_default_model:",
    ]
    missing = [n for n in need if n not in text]
    if missing:
        print("STRUCT_FAIL", ",".join(missing))
        sys.exit(2)
    print("STRUCT_OK_NO_YAML")
    sys.exit(0)

data = yaml.safe_load(text)
assert isinstance(data, dict), "root must be mapping"
models = data.get("model_list") or []
names = {m.get("model_name") for m in models if isinstance(m, dict)}
for need in (
    "lanyard-auto",
    "lanyard-simple",
    "lanyard-moderate",
    "lanyard-complex",
    "lanyard-reasoning",
):
    assert need in names, f"missing model_name {need}"
auto = next(m for m in models if m.get("model_name") == "lanyard-auto")
params = auto.get("litellm_params") or {}
assert params.get("model") == "auto_router/complexity_router"
cfg = params.get("complexity_router_config") or {}
tiers = cfg.get("tiers") or {}
for k in ("SIMPLE", "MEDIUM", "COMPLEX", "REASONING"):
    assert k in tiers, f"missing tier {k}"
assert params.get("complexity_router_default_model"), "missing default model"
print("YAML_OK", len(models), "models")
PY
)"
YAML_RC=$?
set -e
if [[ $YAML_RC -eq 0 ]]; then
  pass "config.yaml parses / intelligence router structure ok ($YAML_OUT)"
else
  fail "config.yaml intelligence structure check failed"
  echo "$YAML_OUT" | sed 's/^/         /'
fi

echo
if [[ $FAILED -eq 0 ]]; then
  echo "OK  smoke-litellm-multi-slot passed (offline)"
  exit 0
else
  echo "FAILED  $FAILED failure(s) in smoke-litellm-multi-slot"
  exit 1
fi
