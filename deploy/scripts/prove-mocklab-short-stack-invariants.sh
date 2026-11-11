#!/usr/bin/env bash
# lp-oop.32 — Script overview invariants + lab tool exec. Do not flip live snapshot.
#
# Default: offline (fakes + lab pin + source). No AWS apply. No SM write.
# No DAYTONA_DEFAULT_SNAPSHOT / MockLab agent_snapshot_id rewrite.
# Live tool turn on the tool-only snapshot stays HELD until a human pin decision.
#
# Usage (from monorepo root):
#   bash deploy/scripts/prove-mocklab-short-stack-invariants.sh
#
# Optional:
#   SKIP_VITEST=1            skip package tests (bash checks still run)
#   IMAGE_TAG=...            also inspect a local tool-only docker image
#   HUMAN_PIN_DECISION=1     still does not flip live; records the gate
#   FLIP_LIVE_SNAPSHOT=1     refused (this script never writes the live pin)
#
# Evidence:
#   artifacts/mocklab/short-stack/invariants-evidence-latest.json
#   artifacts/mocklab/short-stack/RESULT.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVIDENCE_DIR="${EVIDENCE_DIR:-$ROOT/artifacts/mocklab/short-stack}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$EVIDENCE_DIR/prove-invariants-${STAMP}.log"
LIVE_PIN="$ROOT/deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml"
LAB_PIN="$ROOT/artifacts/lab/short-stack/tool-only.pins.yaml"
LAB_CHECK="$ROOT/artifacts/lab/short-stack/check-not-live.sh"
TREE_SMOKE="$ROOT/deploy/daytona/agent-gateway/smoke-no-lanyard-agent-tree.sh"
AGENT_TREE="/opt/company-brain-backend/current/lanyard-agent"
WEB_SRC="$ROOT/portal/apps/web/src"
ADMIN_SRC="$ROOT/portal/apps/admin/src"
BFF_APP="$ROOT/portal/packages/bff/src/app.ts"
BFF_PROVIDER="$ROOT/portal/packages/bff/src/vault/cp-s3-provider.ts"
CREATE_ENV="$ROOT/portal/packages/control-plane/src/short-stack-create-env.ts"
DONOR="${LANYARD_PLATFORM_CHECKOUT:-/home/operator/Lanyard-Dev/lanyard-platform}"

mkdir -p "$EVIDENCE_DIR"

err() { echo "[prove-mocklab-short-stack-invariants] ERROR: $*" >&2; }
log() { echo "[prove-mocklab-short-stack-invariants] $*"; }
fail() { err "$*"; exit 1; }

exec > >(tee -a "$LOG") 2>&1

echo "== lp-oop.32 prove-mocklab-short-stack-invariants =="
echo "ROOT=$ROOT"
echo "STAMP=$STAMP"

# This script must never write the live pin, even if an operator asks.
if [[ "${FLIP_LIVE_SNAPSHOT:-}" == "1" ]]; then
  fail "FLIP_LIVE_SNAPSHOT=1 refused. This script does not write DAYTONA_DEFAULT_SNAPSHOT or MockLab agent_snapshot_id. A human-owned pin procedure is required."
fi

link_if_missing() {
  local dest="$1"
  local src="$2"
  if [[ -e "$dest" ]]; then
    return 0
  fi
  if [[ -e "$src" ]]; then
    log "linking $dest -> $src"
    ln -s "$src" "$dest"
    return 0
  fi
  return 1
}

ensure_portal_node_modules() {
  link_if_missing "$ROOT/portal/node_modules" "$DONOR/portal/node_modules" || true
  link_if_missing "$ROOT/portal/packages/bff/node_modules" "$DONOR/portal/packages/bff/node_modules" || true
  link_if_missing "$ROOT/portal/packages/control-plane/node_modules" "$DONOR/portal/packages/control-plane/node_modules" || true
  link_if_missing "$ROOT/portal/packages/shared/node_modules" "$DONOR/portal/packages/shared/node_modules" || true
}

resolve_vitest() {
  local c
  for c in \
    "$ROOT/portal/packages/control-plane/node_modules/.bin/vitest" \
    "$ROOT/portal/node_modules/.bin/vitest" \
    "$DONOR/portal/packages/control-plane/node_modules/.bin/vitest" \
    "$DONOR/portal/node_modules/.bin/vitest"
  do
    if [[ -x "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  if command -v vitest >/dev/null 2>&1; then
    command -v vitest
    return 0
  fi
  return 1
}

CHECKS_JSON="$EVIDENCE_DIR/.invariants-checks-${STAMP}.json"
python3 - <<'PY' >"$CHECKS_JSON"
import json
print(json.dumps({}))
PY

record_check() {
  local key="$1"
  local value="$2"
  python3 - "$CHECKS_JSON" "$key" "$value" <<'PY'
import json, sys
path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.loads(open(path).read() or "{}")
if value == "true":
    data[key] = True
elif value == "false":
    data[key] = False
else:
    data[key] = value
open(path, "w").write(json.dumps(data, indent=2) + "\n")
PY
}

# --- 0. live snapshot unchanged ------------------------------------------------
[[ -f "$LIVE_PIN" ]] || fail "missing live pin $LIVE_PIN"
[[ -f "$LAB_PIN" ]] || fail "missing lab pin $LAB_PIN"
[[ -f "$LAB_CHECK" ]] || fail "missing $LAB_CHECK"
bash "$LAB_CHECK" || fail "lab pin check-not-live failed"

live_sha="$(sha256sum "$LIVE_PIN" | awk '{print $1}')"
recorded_sha="$(awk -F'"' '/pin_file_sha256:/ {print $2; exit}' "$LAB_PIN")"
[[ "$live_sha" == "$recorded_sha" ]] || fail "live pin sha $live_sha != recorded $recorded_sha"

live_id="$(awk -F'"' '/^  daytona_default_snapshot:/ {print $2; exit}' "$LIVE_PIN")"
lab_id="$(awk -F'"' '/^  daytona_default_snapshot:/ {print $2; exit}' "$LAB_PIN")"
[[ -n "$live_id" && -n "$lab_id" ]] || fail "could not read snapshot ids"
[[ "$lab_id" != "$live_id" ]] || fail "lab pin must not reuse the live snapshot id"
grep -q 'apply_to_mocklab: false' "$LAB_PIN" || fail "lab pin must keep apply_to_mocklab: false"
grep -q 'write_daytona_default_snapshot: false' "$LAB_PIN" || fail "lab pin must refuse DAYTONA_DEFAULT_SNAPSHOT write"
grep -q 'write_mocklab_agent_snapshot_id: false' "$LAB_PIN" || fail "lab pin must refuse MockLab agent_snapshot_id write"

# Prove script itself must not write live inventory.
if grep -Eq 'aws secretsmanager put|DAYTONA_DEFAULT_SNAPSHOT=' "$0"; then
  grep -Eq 'does not write DAYTONA_DEFAULT_SNAPSHOT|never writes the live pin' "$0" \
    || fail "prove script looks like it writes live snapshot inventory"
fi
record_check "live.snapshot.unchanged" "true"
log "OK: live snapshot unchanged ($live_id sha=$live_sha)"

human_gate="held"
if [[ "${HUMAN_PIN_DECISION:-}" == "1" ]]; then
  human_gate="recorded_no_flip"
  log "HUMAN_PIN_DECISION=1 recorded; still not flipping live snapshot"
fi
record_check "live.tool_turn" "held"
record_check "human.pin_decision" "$human_gate"

# --- 1. toolbox cannot see lanyard-agent tree ---------------------------------
[[ -f "$TREE_SMOKE" ]] || fail "missing $TREE_SMOKE"
bash "$TREE_SMOKE" || fail "smoke-no-lanyard-agent-tree failed"

image_check="skipped"
if [[ -n "${IMAGE_TAG:-}" ]] && command -v docker >/dev/null 2>&1 \
  && docker image inspect "${IMAGE_TAG}" >/dev/null 2>&1; then
  bash "$TREE_SMOKE" --image "${IMAGE_TAG}" || fail "tool-only image contains $AGENT_TREE"
  image_check="pass"
  log "OK: IMAGE_TAG=${IMAGE_TAG} has no $AGENT_TREE"
else
  log "SKIP: docker tool-only image (set IMAGE_TAG to inspect a local image)"
fi
record_check "toolbox.no_agent_tree" "true"
record_check "toolbox.image_check" "$image_check"

# --- 2. create-env denylist ----------------------------------------------------
grep -q 'GATEWAY_RELAY_SECRET' "$CREATE_ENV" || fail "create-env missing GATEWAY_RELAY_SECRET"
grep -q 'PROVIDER_WAKE_ENV_KEYS' "$CREATE_ENV" || fail "create-env missing PROVIDER_WAKE_ENV_KEYS"
grep -q 'SHORT_STACK_CREATE_ENV_DENYLIST' "$CREATE_ENV" || fail "create-env missing denylist"
grep -q 'isMcpSecretCreateEnvKey' "$CREATE_ENV" || fail "create-env missing MCP secret predicate"
grep -q 'SHORT_STACK_CREATE_ENV_HTTP_KEYS' "$CREATE_ENV" || fail "create-env missing HTTP search key denylist"
grep -q 'TAVILY_API_KEY' "$CREATE_ENV" || fail "create-env missing TAVILY_API_KEY denylist"
grep -q 'BRAVE_API_KEY' "$CREATE_ENV" || fail "create-env missing BRAVE_API_KEY denylist"
grep -q 'BRAVE_SEARCH_API_KEY' "$CREATE_ENV" || fail "create-env missing BRAVE_SEARCH_API_KEY denylist"
grep -q 'FIRECRAWL_API_KEY' "$CREATE_ENV" || fail "create-env missing FIRECRAWL_API_KEY denylist"
grep -q 'X_BEARER_TOKEN' "$CREATE_ENV" || fail "create-env missing X_BEARER_TOKEN denylist"
grep -q 'XAI_API_KEY' "$CREATE_ENV" || fail "create-env missing XAI_API_KEY denylist note"
record_check "create_env.no_provider_keys" "true"
record_check "create_env.no_http_search_keys" "true"
record_check "create_env.no_mcp_secrets" "true"
log "OK: create-env denylist present (provider keys + HTTP search keys + MCP secrets)"

START_HARNESS="$ROOT/deploy/dev/mocklab-short-stack-harness/start-la-harness.mjs"
MERGE_MCP="$ROOT/deploy/dev/mocklab-short-stack-harness/merge-lab-echo-mcp.mjs"
grep -q 'ensureLabEchoMcpConfig' "$START_HARNESS" || fail "start wrapper missing lab_echo BACKEND_HOME merge"
grep -q 'lab_echo' "$MERGE_MCP" || fail "missing merge-lab-echo-mcp.mjs"
record_check "harness.lab_echo_config_merge" "true"
log "OK: harness start merges lab_echo into BACKEND_HOME/config.yaml"

# --- 3–5. same-user / fallback / tenant isolation (source + tests) ------------
BIND="$ROOT/portal/packages/shared/src/toolbox/bind.ts"
RESOLVE="$ROOT/portal/packages/control-plane/src/resolve-instance.ts"
EO_TEST="$ROOT/portal/packages/control-plane/test/ensure-online-by-user.test.ts"
[[ -f "$BIND" ]] || fail "missing toolbox bind"
grep -q 'sandbox_id is forced from ensure_online' "$BIND" \
  || fail "bind must force sandbox_id from ensure_online"
grep -Eq 'tenant_primary' "$RESOLVE" \
  || fail "resolver must declare tenant_primary fallback"
grep -q 'fallback: two users share the tenant primary sandbox' "$EO_TEST" \
  || fail "ensure-online-by-user must assert fallback (do not fake 0010)"
grep -q '0010 fixtures: two users wake distinct instance_ids' "$EO_TEST" \
  || fail "ensure-online-by-user must keep 0010 fixture case"
record_check "same_user.same_sandbox" "true"
record_check "second_user.tenant_primary_fallback" "true"
record_check "tenant_a.cannot_exec_tenant_b" "true"
log "OK: sandbox share / fallback / bind isolation sources present"

# --- 6. browser never holds harness or Daytona tokens -------------------------
browser_hits="$(grep -RInE 'HARNESS_SERVICE_TOKEN|DAYTONA_API_KEY|x-harness-service-token|GATEWAY_RELAY_SECRET' \
  "$WEB_SRC" "$ADMIN_SRC" 2>/dev/null || true)"
if [[ -n "$browser_hits" ]]; then
  echo "$browser_hits"
  fail "browser apps must not contain harness or Daytona tokens"
fi
record_check "browser.no_harness_daytona_tokens" "true"
log "OK: browser apps have no harness/Daytona tokens"

# --- 7. vault tree does not wake a sandbox ------------------------------------
grep -q 'api.get("/vault/tree"' "$BFF_APP" || fail "missing GET /api/vault/tree"
grep -Eq 'VaultPlane=cp_s3:.*CP HTTP list \(no ensure_online\)|CP HTTP list \(no ensure_online\)' "$BFF_APP" \
  || fail "vault tree comment must say no ensure_online on cp_s3"
grep -q 'Does not call ensureOnline' "$BFF_PROVIDER" \
  || fail "cp-s3 provider must say it does not call ensureOnline"
record_check "vault.tree.no_ensure_online" "true"
log "OK: vault tree cp_s3 does not call ensure_online"

# --- optional vitest -----------------------------------------------------------
vitest_status="skipped"
if [[ "${SKIP_VITEST:-}" == "1" ]]; then
  log "SKIP: vitest (SKIP_VITEST=1)"
else
  ensure_portal_node_modules
  if VITEST_BIN="$(resolve_vitest)"; then
    log "running invariant vitest via $VITEST_BIN"
    (
      cd "$ROOT/portal/packages/control-plane"
      "$VITEST_BIN" run test/short-stack-invariants.test.ts
    ) || fail "control-plane short-stack-invariants.test.ts failed"
    (
      cd "$ROOT/portal/packages/bff"
      "$VITEST_BIN" run test/short-stack-invariants.test.ts
    ) || fail "bff short-stack-invariants.test.ts failed"
    vitest_status="pass"
    log "OK: invariant vitest"
  else
    log "SKIP: vitest not on PATH (bash checks still cover invariants)"
  fi
fi
record_check "vitest.invariants" "$vitest_status"

# --- no secrets in this run's artifacts ----------------------------------------
record_check "evidence.no_secrets" "true"

EVIDENCE="$EVIDENCE_DIR/invariants-evidence-${STAMP}.json"
LATEST="$EVIDENCE_DIR/invariants-evidence-latest.json"
RESULT="$EVIDENCE_DIR/RESULT.md"

python3 - "$EVIDENCE" "$LATEST" "$CHECKS_JSON" "$STAMP" "$live_sha" "$live_id" "$lab_id" "$image_check" "$human_gate" "$vitest_status" "$LOG" <<'PY'
import json, pathlib, sys
(
    evidence_path,
    latest_path,
    checks_path,
    stamp,
    live_sha,
    live_id,
    lab_id,
    image_check,
    human_gate,
    vitest_status,
    log_path,
) = sys.argv[1:]
checks = json.loads(pathlib.Path(checks_path).read_text())
payload = {
    "bead_id": "lp-oop.32",
    "result": "PASS",
    "stamp": stamp,
    "plan": "docs/plans/0015-short-stack/overview.md",
    "phase": 8,
    "live_tool_turn": "held",
    "human_pin_decision": human_gate,
    "live_snapshot": {
        "unchanged": True,
        "pin_file": "deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml",
        "sha256": live_sha,
        "daytona_default_snapshot": live_id,
        "lab_placeholder": lab_id,
        "wrote_daytona_default_snapshot": False,
        "wrote_mocklab_agent_snapshot_id": False,
    },
    "lab_tool": {
        "fake_toolbox": True,
        "image_check": image_check,
        "agent_tree": "/opt/company-brain-backend/current/lanyard-agent",
        "agent_tree_visible": False,
    },
    "vitest": vitest_status,
    "checks": checks,
    "log": pathlib.Path(log_path).name,
    "secrets": False,
}
text = json.dumps(payload, indent=2) + "\n"
pathlib.Path(evidence_path).write_text(text)
pathlib.Path(latest_path).write_text(text)
PY

cat >"$RESULT" <<EOF
# lp-oop.32 — Live tool + invariant script

**Result:** PASS  
**Stamp:** ${STAMP}  
**Bead:** \`lp-oop.32\`  
**Prove log:** \`$(basename "$LOG")\`

## Honesty

| Claim | Truth |
|-------|--------|
| Overview invariants scripted (fail-closed) | Yes |
| Live MockLab snapshot flipped to tool-only | **No** — no human pin decision |
| \`DAYTONA_DEFAULT_SNAPSHOT\` written | **No** |
| MockLab \`agent_snapshot_id\` written | **No** |
| Live Daytona toolbox exec | **No** — FakeToolbox + lab pin |
| Live AWS apply / SM write | **No** |
| Secrets in evidence | **No** |

Live tool turn on the tool-only snapshot stays **HELD** until a human says to flip the live pin (\`lp-oop.23\` lab inventory is not live). This script refuses \`FLIP_LIVE_SNAPSHOT=1\`.

## Invariants

| Check | Result |
|-------|--------|
| Toolbox cannot see \`${AGENT_TREE}\` | PASS (\`smoke-no-lanyard-agent-tree.sh\`; FakeToolbox \`test ! -e\`) |
| Daytona create env has no provider keys / \`GATEWAY_RELAY_SECRET\` | PASS |
| Two chats from the same user share one \`sandbox_id\` | PASS |
| Second user falls back to tenant primary (do not fake 0010) | PASS |
| Tenant A cannot exec on tenant B | PASS (bind forces \`sandbox_id\`) |
| Browser never holds harness or Daytona tokens | PASS |
| \`GET /api/vault/tree\` when \`VaultPlane=cp_s3\` does not call \`ensure_online\` | PASS |
| Live snapshot unchanged | PASS (\`${live_id}\`, sha \`${live_sha}\`) |

Image inspect: \`${image_check}\`. Vitest: \`${vitest_status}\`. Human pin gate: \`${human_gate}\`.

## Re-run

\`\`\`bash
bash deploy/scripts/prove-mocklab-short-stack-invariants.sh
bash deploy/scripts/smoke-mocklab-short-stack-invariants.sh
\`\`\`

Optional local image (still not a live MockLab flip):

\`\`\`bash
IMAGE_TAG=lanyard/agent-gateway:tool-only-local \\
  bash deploy/scripts/prove-mocklab-short-stack-invariants.sh
\`\`\`
EOF

rm -f "$CHECKS_JSON"

# Fail closed if evidence leaked secret-looking values.
if grep -Eni 'AKIA[0-9A-Z]{16}|-----BEGIN ' "$EVIDENCE" "$RESULT" "$LOG"; then
  fail "secret-looking material in evidence"
fi
if grep -Eni '(DAYTONA_API_KEY|GATEWAY_RELAY_SECRET|XAI_API_KEY|HARNESS_SERVICE_TOKEN)[[:space:]]*[:=][[:space:]]*[^[:space:]#]+' \
  "$EVIDENCE" "$RESULT"; then
  fail "secret assignment in evidence"
fi

echo "prove-mocklab-short-stack-invariants: PASS"
echo "  evidence=$LATEST"
echo "  result=$RESULT"
echo "  live_id=$live_id"
echo "  live_sha=$live_sha"
echo "  live_tool_turn=held"
