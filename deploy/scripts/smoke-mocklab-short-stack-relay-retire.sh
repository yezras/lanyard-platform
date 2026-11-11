#!/usr/bin/env bash
# Offline smoke: lp-oop.35 Relay retire from Daytona harness hop (no AWS).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SMOKE_SELF="$ROOT/deploy/scripts/smoke-mocklab-short-stack-relay-retire.sh"
PHASE9="$ROOT/docs/plans/0015-short-stack/phase-9-relay-retire.md"
ADR="$ROOT/docs/adr/0013-daytona-chat-relay-retire.md"
SEND="$ROOT/portal/packages/bff/src/chat-delivery-send.ts"
APP="$ROOT/portal/packages/bff/src/app.ts"
TEST="$ROOT/portal/packages/bff/test/chat-relay-retire.test.ts"
CONFIG="$ROOT/portal/packages/bff/src/config.ts"
GATE="$ROOT/artifacts/mocklab/short-stack/relay-retire/RESULT.md"
TESTING="$ROOT/docs/plans/0015-short-stack/testing.md"
OVERVIEW="$ROOT/docs/plans/0015-short-stack/overview.md"

err() { echo "[smoke-mocklab-short-stack-relay-retire] ERROR: $*" >&2; }
log() { echo "[smoke-mocklab-short-stack-relay-retire] $*"; }
fail() { err "$*"; exit 1; }

require_file() {
  [[ -f "$1" ]] || fail "required file missing: $1"
}

require_file "$SMOKE_SELF"
require_file "$PHASE9"
require_file "$ADR"
require_file "$SEND"
require_file "$APP"
require_file "$TEST"
require_file "$CONFIG"
require_file "$GATE"
require_file "$TESTING"
require_file "$OVERVIEW"

bash -n "$SMOKE_SELF" || fail "smoke script failed bash -n"

grep -q 'export type DeliverHarnessChatTurnInput' "$SEND" \
  || fail "harness deliver input type missing"
grep -q 'export type DeliverRelayChatTurnInput' "$SEND" \
  || fail "relay deliver input type missing"
grep -q 'chatDelivery: "harness"' "$SEND" \
  || fail "harness discriminant missing"

# Harness variant must not declare a Relay client.
awk '
  /export type DeliverHarnessChatTurnInput = \\{/ {in_type=1}
  in_type && /relayClient/ {found=1}
  in_type && /^\\};$/ {in_type=0}
  END { if (found) exit 1 }
' "$SEND" || fail "DeliverHarnessChatTurnInput must not include relayClient"

awk '
  /export type InterruptHarnessChatTurnInput = \\{/ {in_type=1}
  in_type && /relayClient/ {found=1}
  in_type && /^\\};$/ {in_type=0}
  END { if (found) exit 1 }
' "$SEND" || fail "InterruptHarnessChatTurnInput must not include relayClient"

grep -q 'chatDelivery: "harness"' "$APP" \
  || fail "app.ts must branch harness send/cancel"
grep -q 'Do not resolve a Relay instance or call interruptInbound' "$APP" \
  || fail "harness cancel must skip Relay primary lookup"

grep -q 'export const DEFAULT_CHAT_DELIVERY: ChatDelivery = "relay"' "$CONFIG" \
  || fail "DEFAULT_CHAT_DELIVERY must stay relay"

grep -Eq 'deliverInbound' "$TEST" \
  || fail "retire tests must name deliverInbound"
grep -Eq 'EC2/guest|EC2 / guest' "$TEST" "$PHASE9" "$ADR" \
  || fail "EC2/guest dual-run must be documented"
grep -Eq 'lp-oop\\.35' "$PHASE9" "$ADR" "$TEST" "$TESTING" "$OVERVIEW" \
  || fail "lp-oop.35 must be named"

grep -Eq 'Live AWS not flipped|does not flip live|not flipped' "$PHASE9" "$GATE" \
  || fail "live AWS must stay unflipped"
grep -Eq 'GO' "$GATE" \
  || fail "gate RESULT.md must record a verdict"

if grep -Eq 'FLIP_LIVE' "$PHASE9" "$GATE" "$ADR"; then
  fail "retire docs must not mention FLIP_LIVE"
fi

log "OK: lp-oop.35 Relay retire docs/types/tests present"
echo "smoke-mocklab-short-stack-relay-retire: PASS"
