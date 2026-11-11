#!/usr/bin/env bash
# Offline smoke: Muse Spark via LiteLLM provider contract (lp-k5c4.17).
# No live Meta keys. No Portal BFF Meta fetch. No /tmp metaComplete wrapper.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="$ROOT/deploy/dev/localhost-muse-spark"
START_FARGATE="$ROOT/deploy/dev/mocklab-short-stack-harness/start-la-harness.mjs"
README="$LAB/README.md"
EXAMPLE="$LAB/meta.env.example"
LITELLM_README="$ROOT/deploy/litellm/README.md"
BFF_SRC="$ROOT/portal/packages/bff/src"
LOCAL_DEV="$ROOT/docs/runbooks/local-dev-monorepo.md"

err() { echo "[smoke-localhost-muse-spark-provider] ERROR: $*" >&2; }
log() { echo "[smoke-localhost-muse-spark-provider] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

require_file() {
  local f="$1"
  [[ -f "$f" ]] || fail "required file missing: $f"
}

for f in \
  "$LAB/litellm-base-url.mjs" \
  "$LAB/litellm-base-url.test.mjs" \
  "$LAB/serve-la.mjs" \
  "$LAB/serve-la.test.mjs" \
  "$LAB/prove-turn.mjs" \
  "$README" \
  "$EXAMPLE" \
  "$START_FARGATE" \
  "$LITELLM_README"
do
  require_file "$f"
done
pass "muse-spark files present"

node --check "$LAB/litellm-base-url.mjs" || fail "litellm-base-url.mjs failed node --check"
node --check "$LAB/serve-la.mjs" || fail "serve-la.mjs failed node --check"
node --check "$LAB/prove-turn.mjs" || fail "prove-turn.mjs failed node --check"
node --test "$LAB/litellm-base-url.test.mjs" "$LAB/serve-la.test.mjs" \
  || fail "localhost-muse-spark node tests failed"
pass "node --check + node:test"

# Contract docs: base is https://api.meta.ai, never .../v1 as the operator value.
for f in "$README" "$EXAMPLE" "$LITELLM_README"; do
  grep -Fq 'https://api.meta.ai' "$f" || fail "$f must document https://api.meta.ai"
  grep -Fq 'muse-spark-1.2-contributor' "$f" || fail "$f must name HARNESS_MODEL muse-spark-1.2-contributor"
  grep -Eq 'no trailing `/v1`|not .*api\.meta\.ai/v1|not https://api.meta.ai/v1' "$f" \
    || fail "$f must warn against LITELLM_BASE_URL=.../v1"
done
if [[ -f "$LOCAL_DEV" ]]; then
  grep -Fq 'https://api.meta.ai' "$LOCAL_DEV" || fail "local-dev runbook must document Muse Spark base URL"
fi
grep -Fq '~/.lanyard-agent/meta.env' "$README" "$EXAMPLE" \
  || fail "docs must keep keys in ~/.lanyard-agent/meta.env"
grep -Fq 'sk-placeholder-meta-replace-me' "$EXAMPLE" \
  || fail "meta.env.example must use a placeholder key"
if grep -Eiq 'LLM_[0-9]{6,}|sk-[a-zA-Z0-9]{20,}' "$EXAMPLE" "$README" "$LAB"/*.mjs; then
  fail "muse-spark files must not embed live-looking keys"
fi
pass "documented env: https://api.meta.ai (no /v1) + placeholder keys"

# serve-la uses the factory only — no Meta fetch wrapper
python3 - "$LAB/serve-la.mjs" "$LAB/litellm-base-url.mjs" "$START_FARGATE" <<'PY' || fail "LiteLLM bind must not pass complete / fetch Meta"
from pathlib import Path
import re
import sys
serve, helper, fargate = (Path(p).read_text() for p in sys.argv[1:])
for blob, name in ((serve, "serve-la.mjs"), (helper, "litellm-base-url.mjs"), (fargate, "start-la-harness.mjs")):
    if re.search(r"function\s+metaComplete", blob):
        raise SystemExit(f"{name} still defines a Meta complete wrapper")
    if re.search(r"fetch\(\s*['\"]https://api\.meta\.ai", blob):
        raise SystemExit(f"{name} fetches Meta chat completions directly")
if "createEnvLiteLlmTurnRunner" not in serve:
    raise SystemExit("serve-la.mjs must call createEnvLiteLlmTurnRunner")
if "bindEnvLiteLlmTurnRunner" not in serve:
    raise SystemExit("serve-la.mjs must bind via bindEnvLiteLlmTurnRunner")
# Fargate LiteLLM fallback: factory() with no options.complete
if "createEnvLiteLlmTurnRunner" not in fargate:
    raise SystemExit("start-la-harness.mjs must look for createEnvLiteLlmTurnRunner")
if "complete:" in fargate and "createLabVaultMcpComplete" not in fargate:
    raise SystemExit("unexpected complete: in start-la-harness.mjs")
print("bind contract ok")
PY
pass "no metaComplete; LiteLLM factory has no custom complete"

# Portal BFF must not fetch Meta
if [[ -d "$BFF_SRC" ]]; then
  if grep -R -E --include='*.ts' 'api\.meta\.ai|metaComplete' "$BFF_SRC" >/dev/null; then
    fail "Portal BFF src must not mention api.meta.ai or metaComplete"
  fi
  pass "Portal BFF has no Meta-specific fetch"
else
  pass "Portal BFF src not present (skip)"
fi

# Optional: mock turn through real LA dist when checkout is built
PROVE="$ROOT/deploy/scripts/prove-localhost-muse-spark-turn.sh"
require_file "$PROVE"
bash -n "$PROVE" || fail "prove-localhost-muse-spark-turn.sh failed bash -n"
if [[ -n "${LANYARD_AGENT_ROOT:-}" && -d "${LANYARD_AGENT_ROOT}" ]]; then
  if [[ -f "$LANYARD_AGENT_ROOT/packages/adapters-portal/dist/harness/index.js" \
     || -f "$LANYARD_AGENT_ROOT/packages/adapters-portal/dist/index.js" ]]; then
    MOCK_OUT="$(mktemp -d /tmp/lp-k5c4.17-mock-XXXXXX)"
    LIVE=0 OUT_DIR="$MOCK_OUT" bash "$PROVE" || fail "mock prove-turn against LA dist failed"
    rm -rf "$MOCK_OUT"
    pass "mock harness turn via createEnvLiteLlmTurnRunner"
  else
    pass "LANYARD_AGENT_ROOT set but adapters-portal dist missing (skip mock turn)"
  fi
else
  pass "LANYARD_AGENT_ROOT unset (skip mock LA turn)"
fi

pass "lp-k5c4.17 offline smoke"
