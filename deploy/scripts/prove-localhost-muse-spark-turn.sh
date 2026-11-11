#!/usr/bin/env bash
# Prove one harness message_send through createEnvLiteLlmTurnRunner (lp-k5c4.17).
# Default: mock LiteLLM fetch (no network). LIVE=1 hits Muse Spark.
# Never prints API keys. Writes artifacts/localhost/lp-k5c4.17/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LAB="$ROOT/deploy/dev/localhost-muse-spark"
OUT_DIR="${OUT_DIR:-$ROOT/artifacts/localhost/lp-k5c4.17}"
LIVE="${LIVE:-0}"

fail() { echo "[prove-localhost-muse-spark-turn] ERROR: $*" >&2; exit 1; }
log() { echo "[prove-localhost-muse-spark-turn] $*"; }

[[ -f "$LAB/prove-turn.mjs" ]] || fail "missing $LAB/prove-turn.mjs"

if [[ -z "${LANYARD_AGENT_ROOT:-}" ]]; then
  for candidate in \
    "${HOME}/Lanyard-Dev/lanyard-agent" \
    /home/operator/Lanyard-Dev/lanyard-agent
  do
    if [[ -d "$candidate/packages/adapters-portal/dist" ]]; then
      export LANYARD_AGENT_ROOT="$candidate"
      break
    fi
  done
fi
[[ -n "${LANYARD_AGENT_ROOT:-}" ]] || fail "set LANYARD_AGENT_ROOT"

META_ENV="${MUSE_SPARK_META_ENV:-$HOME/.lanyard-agent/meta.env}"
if [[ "$LIVE" == "1" || "$LIVE" == "true" ]]; then
  [[ -f "$META_ENV" ]] || fail "LIVE=1 needs $META_ENV (mode 600)"
  # shellcheck disable=SC1090
  set -a
  source "$META_ENV"
  set +a
  export LIVE=1
else
  export LIVE=0
  export LITELLM_BASE_URL="${LITELLM_BASE_URL:-https://api.meta.ai}"
  export LITELLM_API_KEY="${LITELLM_API_KEY:-test-not-a-secret}"
  export HARNESS_MODEL="${HARNESS_MODEL:-muse-spark-1.2-contributor}"
fi

mkdir -p "$OUT_DIR"
JSON_OUT="$(node "$LAB/prove-turn.mjs")"
echo "$JSON_OUT" | python3 -c 'import json,sys; json.load(sys.stdin)' >/dev/null \
  || fail "prove-turn.mjs did not print JSON"
echo "$JSON_OUT" > "$OUT_DIR/prove.json"
chmod 600 "$OUT_DIR/prove.json" 2>/dev/null || true

python3 - "$OUT_DIR/prove.json" "$OUT_DIR/RESULT.md" <<'PY'
import json, sys
from pathlib import Path
src, dest = Path(sys.argv[1]), Path(sys.argv[2])
data = json.loads(src.read_text())
if data.get("ok") is not True:
    raise SystemExit("prove json ok != true")
if data.get("runner") != "createEnvLiteLlmTurnRunner":
    raise SystemExit("runner")
if data.get("complete") is not None:
    raise SystemExit("complete must be null")
if data.get("litellm_base_url") != "https://api.meta.ai":
    raise SystemExit("base url")
if "/v1/v1/" in str(data.get("chat_completions_url") or ""):
    raise SystemExit("double v1")
send = data.get("message_send") or {}
if int(send.get("content_len") or 0) < 1:
    raise SystemExit("empty message_send")
if send.get("echo_prefix"):
    raise SystemExit("echo prefix")
preview = str(send.get("content_preview") or "").replace("`", "'")
live = "LIVE Muse Spark" if data.get("live") else "mock fetch"
dest.write_text(
    f"# lp-k5c4.17 — Muse Spark LiteLLM provider\n\n"
    f"**Result:** PASS ({live})\n"
    f"**Runner:** `createEnvLiteLlmTurnRunner` (no `complete` wrapper)\n"
    f"**LITELLM_BASE_URL:** `https://api.meta.ai` (no trailing `/v1`)\n"
    f"**Model:** `{data.get('model')}`\n"
    f"**Completions URL:** `{data.get('chat_completions_url')}`\n\n"
    f"## message_send\n\n"
    f"- count: {send.get('count')}\n"
    f"- content_len: {send.get('content_len')}\n"
    f"- preview: {preview}\n\n"
    f"Keys were not written. Portal BFF does not fetch Meta.\n"
)
print("evidence ok")
PY

log "wrote $OUT_DIR/RESULT.md"
cat "$OUT_DIR/RESULT.md"
