#!/usr/bin/env bash
# Offline honesty guard for mocklab chat smoke formal close (lp-t7q.5).
# Does NOT hit staging. Fails if the close document is missing required sections
# or over-claims host-backed panes / production gates.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOC="${ROOT}/deploy/deployments/mocklab/CHAT-SMOKE-CLOSE.md"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "OK: $*"; }

[[ -f "$DOC" ]] || fail "missing $DOC"

need() {
  local pat="$1" msg="$2"
  grep -Eq "$pat" "$DOC" || fail "$msg"
  pass "$msg"
}

need 'lp-t7q\.5' "documents bead lp-t7q.5"
need 'cbd-mta\.8\.8\.1' "links migrated source cbd-mta.8.8.1"
need '2026-07-26' "has dated pass (2026-07-26)"
need 'Login OK' "has Login OK section"
need 'Chat stream OK|Chat stream' "has Chat stream section"
need 'Live Hermes path|hermes-gateway' "has live Hermes / hermes-gateway evidence"
need 'ack — lp-t7q\.5 chat live\.|PONG-lp-t7q\.5' "records Hermes reply content"
need 'message_send' "records SSE message_send"
need 'lanyard_session' "notes session cookie name only"
need 'Residual host panes|not claimed done' "residual host panes called out"
need 'lp-t7q\.4' "links residual lp-t7q.4"
need 'brain_rpc_enabled=false|brain_rpc_enabled.*false' "notes brain_rpc still false"
need 'Not G1|not G1|G1–G8|G1-G8' "explicit non-claim of G* ready"
need 'Post-proof environment note|re-UIQA' "documents post-proof / re-UIQA environment gate"
need 'Control plane|lanyard-platform-staging-cp|desired=0' "notes CP health dependency for live re-proof"

# Forbidden: raw cookie/session material patterns that look like committed secrets
if grep -Eiq 'lanyard_session=[A-Za-z0-9]{16,}|MOCKLAB_AGENT_PASSWORD=|GATEWAY_RELAY_SECRET=[^P]' "$DOC"; then
  fail "document appears to contain secret material"
fi
pass "no obvious secret material in close doc"

# Must not claim host panes done
if grep -Eiq 'Directory.*PASS|Vault.*PASS|Settings.*PASS|host-backed panes? (complete|done|closed)' "$DOC"; then
  # allow "not claimed done" language only — block false completion claims
  if ! grep -Eq 'not claimed done|Residual host panes' "$DOC"; then
    fail "possible over-claim of host-backed panes"
  fi
fi
pass "host panes residual language present"

echo "smoke-mocklab-chat-smoke-close: PASS"
