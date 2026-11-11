#!/usr/bin/env bash
# Offline check: staging secrets checklist runbook is present, complete, and safe.
# Does not contact GitHub/AWS and never prints secret values.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOC="${ROOT}/references/runbooks/staging-secrets-checklist.md"
FAIL=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAIL=1; }

if [[ ! -f "$DOC" ]]; then
  fail "missing $DOC"
  exit 1
fi
pass "runbook present: references/runbooks/staging-secrets-checklist.md"

# Required secret / config names documented (as names only)
REQUIRED_NAMES=(
  CONTROL_PLANE_SERVICE_TOKEN
  GOOGLE_CLIENT_SECRET
  GOOGLE_CLIENT_ID
  SESSION_SECRET
  GOOGLE_REDIRECT_PATH
  INTERNAL_OPS_TOKEN
  CONTROL_PLANE_DATABASE_URL
  REDIS_URL
  RELAY_INTERNAL_TOKEN
  AWS_ROLE_ARN
  ARTIFACT_BUCKET
  ECR_NAME_PREFIX
  GITHUB_TOKEN
  BRAIN_RPC_ENABLED
  BFF_SESSION_BACKEND
  HARNESS_URL
  HARNESS_SERVICE_TOKEN
  CHAT_DELIVERY
  harness-litellm
  harness-exec
  RELAY_CLUSTER_MODE
  CONTROL_PLANE_AUTH_MODE
  SESSION_TTL_SECONDS
  SESSION_MAX_AGE_SECONDS
  redis_url_secret_arn
  portal-valkey
  # OIDC path-first URL / membership contract (names + shapes only)
  auth/google/callback
  auth/logout
  tenant_slug
  membership
)

for name in "${REQUIRED_NAMES[@]}"; do
  if grep -qF "$name" "$DOC"; then
    pass "documents $name"
  else
    fail "missing documentation for $name"
  fi
done

# Cross-links
for link in \
  "product-artifact-staging-apply.md" \
  "portal-compute-staging-apply.md" \
  "relay-secret-lifecycle.md" \
  "pin-update.md" \
  "security-e2e-acceptance.md" \
  "mocklab-short-stack-harness.md"
do
  if grep -qF "$link" "$DOC"; then
    pass "cross-links $link"
  else
    fail "missing cross-link $link"
  fi
done

# OIDC fail-closed honesty: client secret via secrets map; no live proof claim
if grep -Eq 'GOOGLE_CLIENT_SECRET' "$DOC" && grep -Eqi 'secrets map|ECS secrets|value_from' "$DOC"; then
  pass "documents GOOGLE_CLIENT_SECRET via secrets map / value_from"
else
  fail "must document GOOGLE_CLIENT_SECRET injection via ECS secrets map"
fi
if grep -Eqi 'path-first|app\.withlanyard\.com' "$DOC"; then
  pass "documents path-first OIDC callback host shape"
else
  fail "must document path-first OIDC callback host shapes"
fi
if grep -Eqi 'does \*\*not\*\* flip|not claim.*OIDC|G1\.4|live OIDC' "$DOC"; then
  pass "honest: no live OIDC proof claim from checklist alone"
else
  fail "must state OIDC wiring does not flip G1 / live proof"
fi

# Safety: no private-key PEM blocks or obvious committed credential material
if grep -qE 'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY' "$DOC"; then
  fail "document contains private key PEM block"
else
  pass "no private key PEM blocks"
fi

# Reject lines that look like assigned live secrets (heuristic)
if grep -nE '(sk_live_|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|password\s*=\s*["'\'''][^"'\''']{8,})' "$DOC"; then
  fail "document may contain live credential material"
else
  pass "no obvious live credential patterns"
fi

# INDEX / index.yaml / related runbooks should reference this checklist
for f in \
  "${ROOT}/INDEX.md" \
  "${ROOT}/index.yaml" \
  "${ROOT}/references/runbooks/portal-compute-staging-apply.md" \
  "${ROOT}/references/runbooks/security-e2e-acceptance.md"
do
  if [[ -f "$f" ]] && grep -qF "staging-secrets-checklist" "$f"; then
    pass "wired from ${f#"$ROOT"/}"
  else
    fail "not wired from ${f#"$ROOT"/}"
  fi
done

if [[ "$FAIL" -ne 0 ]]; then
  echo ""
  echo "check-staging-secrets-checklist: FAILED"
  exit 1
fi

echo ""
echo "check-staging-secrets-checklist: OK"
echo "Next: gh secret list -R LanyardBrain/Portal --env staging  # names only"
exit 0
