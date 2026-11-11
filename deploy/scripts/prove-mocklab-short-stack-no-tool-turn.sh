#!/usr/bin/env bash
# lp-oop.31 — Live no-tool turn: BFF → real LA harness. Relay not on the hop.
#
# Starts Lanyard Agent `createHarnessTurnServer` (PR 242) and runs the BFF
# live proof. Does not flip MockLab chat_delivery. Does not terraform apply.
# Does not print secret values.
#
# Usage (from monorepo root):
#   LANYARD_AGENT_ROOT=/path/to/lanyard-agent \
#     bash deploy/scripts/prove-mocklab-short-stack-no-tool-turn.sh
#
# Evidence:
#   artifacts/mocklab/short-stack/no-tool-turn-evidence-latest.json
#   artifacts/mocklab/short-stack/RESULT.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVIDENCE_DIR="${EVIDENCE_DIR:-$ROOT/artifacts/mocklab/short-stack}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$EVIDENCE_DIR/prove-${STAMP}.log"
LAB_TOKEN="placeholder-harness-service-token"
LA_PR="https://github.com/LanyardBrain/lanyard-agent/pull/242"
LA_SHA_PIN="cc37ff4dd9119d32db32ce8110ea508b7e7a3cb0"

mkdir -p "$EVIDENCE_DIR"

err() { echo "[prove-mocklab-short-stack-no-tool-turn] ERROR: $*" >&2; }
log() { echo "[prove-mocklab-short-stack-no-tool-turn] $*"; }
fail() { err "$*"; exit 1; }

exec > >(tee -a "$LOG") 2>&1

echo "== lp-oop.31 prove-mocklab-short-stack-no-tool-turn =="
echo "ROOT=$ROOT"
echo "STAMP=$STAMP"

resolve_agent_root() {
  if [[ -n "${LANYARD_AGENT_ROOT:-}" ]]; then
    echo "$LANYARD_AGENT_ROOT"
    return 0
  fi
  local c
  for c in \
    /tmp/lp-bead-lp-oop.26-la \
    /tmp/lp-oop26-review/la-wt \
    "$ROOT/../lanyard-agent"
  do
    if [[ -f "$c/packages/adapters-portal/src/harness/index.ts" ]]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

resolve_tsx() {
  local c
  for c in \
    "$ROOT/portal/node_modules/.bin/tsx" \
    "${LANYARD_PLATFORM_CHECKOUT:-/home/operator/Lanyard-Dev/lanyard-platform}/portal/node_modules/.bin/tsx" \
    "${AGENT_ROOT:-}/node_modules/.bin/tsx"
  do
    if [[ -x "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  if command -v tsx >/dev/null 2>&1; then
    command -v tsx
    return 0
  fi
  return 1
}

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
  local donor="${LANYARD_PLATFORM_CHECKOUT:-/home/operator/Lanyard-Dev/lanyard-platform}/portal"
  link_if_missing "$ROOT/portal/node_modules" "$donor/node_modules" || true
  link_if_missing "$ROOT/portal/packages/bff/node_modules" "$donor/packages/bff/node_modules" || true
  link_if_missing "$ROOT/portal/packages/shared/node_modules" "$donor/packages/shared/node_modules" || true
  if [[ ! -d "$ROOT/portal/node_modules" && ! -d "$ROOT/portal/packages/bff/node_modules" ]]; then
    fail "portal node_modules missing; run pnpm install in portal/ or set LANYARD_PLATFORM_CHECKOUT"
  fi
}

resolve_vitest() {
  local c
  for c in \
    "$ROOT/portal/packages/bff/node_modules/.bin/vitest" \
    "$ROOT/portal/node_modules/.bin/vitest" \
    "${LANYARD_PLATFORM_CHECKOUT:-/home/operator/Lanyard-Dev/lanyard-platform}/portal/packages/bff/node_modules/.bin/vitest"
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

AGENT_ROOT="$(resolve_agent_root)" || fail "set LANYARD_AGENT_ROOT to a lanyard-agent checkout with createHarnessTurnServer (PR 242)"
[[ -f "$AGENT_ROOT/packages/adapters-portal/src/harness/index.ts" ]] \
  || fail "LANYARD_AGENT_ROOT missing adapters-portal harness: $AGENT_ROOT"

TSX="$(resolve_tsx)" || fail "tsx not found (need portal/node_modules/.bin/tsx)"
ensure_portal_node_modules

if [[ ! -f "$ROOT/portal/packages/backend-runtime/dist/index.js" ]]; then
  log "building portal workspace packages needed by BFF tests"
  (
    cd "$ROOT/portal"
    if [[ ! -d node_modules ]]; then
      pnpm install --prefer-offline
    fi
    pnpm --filter @lanyard/shared --filter @lanyard/hermes-compat \
      --filter @lanyard/chat-corpus --filter @lanyard/backend-runtime build
  )
fi

HARNESS_MODULE="$AGENT_ROOT/packages/adapters-portal/src/harness/index.ts"
if [[ -f "$AGENT_ROOT/packages/adapters-portal/dist/index.js" ]]; then
  HARNESS_MODULE="$AGENT_ROOT/packages/adapters-portal/dist/index.js"
fi

LANYARD_AGENT_SHA="$(git -C "$AGENT_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
log "LA root=$AGENT_ROOT sha=$LANYARD_AGENT_SHA pin=$LA_SHA_PIN pr=$LA_PR"
log "module=$HARNESS_MODULE"

HARNESS_PORT="$(
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)"
HARNESS_URL="http://127.0.0.1:${HARNESS_PORT}"
HARNESS_PID=""

cleanup() {
  if [[ -n "${HARNESS_PID:-}" ]] && kill -0 "$HARNESS_PID" 2>/dev/null; then
    kill "$HARNESS_PID" 2>/dev/null || true
    wait "$HARNESS_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

log "starting harness on $HARNESS_URL"
HARNESS_HOST=127.0.0.1 \
HARNESS_PORT="$HARNESS_PORT" \
LANYARD_HARNESS_SERVICE_TOKEN="$LAB_TOKEN" \
HARNESS_MODULE="$HARNESS_MODULE" \
"$TSX" --input-type=module <<'JS' &
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(process.env.HARNESS_MODULE).href;
const mod = await import(moduleUrl);
if (typeof mod.createHarnessTurnServer !== "function") {
  console.error("[prove] createHarnessTurnServer not exported (need LA PR 242+)");
  process.exit(1);
}
const host = process.env.HARNESS_HOST || "127.0.0.1";
const port = Number(process.env.HARNESS_PORT || 0);
const serviceToken = process.env.LANYARD_HARNESS_SERVICE_TOKEN || "";
const server = mod.createHarnessTurnServer({ host, port, serviceToken });
await server.start();
console.log(`[prove] listening http://${host}:${server.boundPort}`);
const stop = async () => {
  try { await server.stop(); } finally { process.exit(0); }
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
JS
HARNESS_PID=$!

ready=0
for _ in $(seq 1 50); do
  if ! kill -0 "$HARNESS_PID" 2>/dev/null; then
    fail "harness process exited before listen"
  fi
  code="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 1 \
    -X POST "$HARNESS_URL/internal/turns" || true)"
  if [[ "$code" == "401" ]]; then
    ready=1
    break
  fi
  sleep 0.1
done
[[ "$ready" == "1" ]] || fail "harness did not answer 401 on POST /internal/turns"

log "harness ready (401 without token)"

export HARNESS_URL
export HARNESS_SERVICE_TOKEN="$LAB_TOKEN"
export LANYARD_HARNESS_SERVICE_TOKEN="$LAB_TOKEN"
export LANYARD_AGENT_SHA
export REQUIRE_LIVE=1
export LP_OOP_31_LIVE=1

VITEST="$(resolve_vitest)" || fail "vitest missing (pnpm install in portal/packages/bff)"
(
  cd "$ROOT/portal/packages/bff"
  "$VITEST" run test/chat-harness-live-no-tool.test.ts
)
log "vitest live no-tool turn PASS"

EVIDENCE="$EVIDENCE_DIR/no-tool-turn-evidence-latest.json"
[[ -f "$EVIDENCE" ]] || fail "evidence missing: $EVIDENCE"

python3 - "$EVIDENCE" "$EVIDENCE_DIR/RESULT.md" "$STAMP" "$LANYARD_AGENT_SHA" "$LA_SHA_PIN" "$LA_PR" "$LOG" <<'PY'
import json, sys, pathlib, re
path, result_md, stamp, sha, pin, pr, log_path = sys.argv[1:8]
data = json.loads(pathlib.Path(path).read_text())
if data.get("bead_id") != "lp-oop.31":
    raise SystemExit(f"bead_id mismatch: {data.get('bead_id')}")
if data.get("result") != "PASS":
    raise SystemExit("evidence result is not PASS")
checks = data.get("checks") or {}
for key in (
    "relay.not_on_hop",
    "harness.echo_no_tools",
    "sse.no_tool_progress",
    "evidence.no_secrets",
):
    if checks.get(key) is not True:
        raise SystemExit(f"check failed: {key}={checks.get(key)}")
relay = data.get("relay") or {}
if any(int(relay.get(k, 1)) != 0 for k in (
    "deliverInbound_calls",
    "interruptInbound_calls",
    "openChatEventStream_calls",
    "fetchChatHistory_calls",
)):
    raise SystemExit(f"relay was on the hop: {relay}")
blob = json.dumps(data)
if re.search(r"AKIA[0-9A-Z]{16}", blob):
    raise SystemExit("evidence looks like it contains an AWS access key")
if "GATEWAY_RELAY_SECRET=" in blob:
    raise SystemExit("evidence must not embed GATEWAY_RELAY_SECRET")
# Lab token name is ok; the value must not appear.
if "placeholder-harness-service-token" in blob or "test-harness-service-token" in blob:
    raise SystemExit("evidence must not include harness token values")
turn = data.get("turn") or {}
md = f"""# lp-oop.31 — Live no-tool turn

**Result:** PASS  
**Stamp:** {data.get("stamp") or stamp}  
**Bead:** `lp-oop.31`  
**Prove log:** `{pathlib.Path(log_path).name}`

## Hop

```
BFF  ─HTTP + SSE─►  Harness (LA createHarnessTurnServer)
```

Relay was **not** on the hop (`deliverInbound` / `interruptInbound` / `openChatEventStream` / `fetchChatHistory` = 0).

## Turn

| Field | Value |
|-------|--------|
| Delivery | `harness` |
| Probe | `{turn.get("message_probe")}` |
| Echo | `{turn.get("echo")}` |
| Turn id | `{turn.get("turn_id")}` |
| Tool events | `{turn.get("tool_events")}` |

LA: [{pr}]({pr}) observed SHA `{sha}` (pin `{pin}`).

## Honesty

- real harness was **not** used (`topology.fake_harness_http=false`).
- Live AWS MockLab `chat_delivery` is **not** flipped. Guest/Relay stays default until an operator follows the [harness runbook](../../../deploy/references/runbooks/mocklab-short-stack-harness.md) §4 and `lp-oop.29`.
- OPERATOR HOLD still forbids re-applying torn-down staging AWS.
- No secrets in this file or the evidence JSON.
- Browser Playwright is `lp-oop.33`.

## Re-run

```bash
LANYARD_AGENT_ROOT=/path/to/lanyard-agent \\
  bash deploy/scripts/prove-mocklab-short-stack-no-tool-turn.sh
```
"""
pathlib.Path(result_md).write_text(md)
print("evidence+RESULT.md ok")
PY

log "evidence validated (Relay not on hop; no tools; no secrets)"
echo "prove-mocklab-short-stack-no-tool-turn: PASS"
