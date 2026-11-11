#!/usr/bin/env bash
# Rollback pin capture template — Hermes-Lanyard staging (lp-k7g.12.5)
#
# Run on the EC2 host BEFORE any pin change / re-bootstrap / terraform apply
# that touches backend_artifact_* or /etc/company-brain/artifact-pins.env.
# Save the output off-host (ticket, local file, or secrets manager note).
#
# Usage (on host):
#   sudo bash rollback-pin-capture.template.sh | tee "rollback-pins-$(hostname)-$(date -u +%Y%m%dT%H%M%SZ).txt"
#
# Offline dry-run (no host): this script is documentation + structure only;
# see docs/plans/0001-platform-monorepo-migration/cutover-staging-hermes-lanyard.md
# for the filled template fields operators must record.
#
# Related: docs/runbooks/backend-upgrade-rollback.md §0
#          docs/runbooks/staging-hermes-lanyard-backend-pins.md

set -euo pipefail

ROOT="${BACKEND_INSTALL_ROOT:-/opt/company-brain-backend}"
PINS_ENV="${ARTIFACT_PINS_ENV:-/etc/company-brain/artifact-pins.env}"
BACKEND_ENV="${BACKEND_ENV_FILE:-/etc/company-brain/backend.env}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HOST="$(hostname -f 2>/dev/null || hostname || echo unknown)"

echo "=== rollback pin capture ==="
echo "captured_at_utc: ${STAMP}"
echo "host: ${HOST}"
echo "install_root: ${ROOT}"
echo

echo "=== artifact-pins.env ==="
if [ -f "$PINS_ENV" ]; then
  # Redact any accidental token-like lines (should never be present)
  grep -E '^(BACKEND_|HERMES_|CLIENT_CORE_|RELAY_|VAULT_|ENABLE_|OMNIBOX_)' "$PINS_ENV" \
    | grep -Eiv 'TOKEN|SECRET|PASSWORD|PRIVATE_KEY' || true
else
  echo "(missing: ${PINS_ENV})"
fi
echo

echo "=== backend.env ==="
if [ -f "$BACKEND_ENV" ]; then
  cat "$BACKEND_ENV"
else
  echo "(missing: ${BACKEND_ENV})"
fi
echo

echo "=== current symlink ==="
if [ -L "$ROOT/current" ] || [ -e "$ROOT/current" ]; then
  echo "readlink: $(readlink "$ROOT/current" 2>/dev/null || true)"
  echo "resolved: $(readlink -f "$ROOT/current" 2>/dev/null || true)"
  ls -la "$ROOT/current" 2>/dev/null || true
else
  echo "(no current under ${ROOT})"
fi
echo

echo "=== active provenance.json ==="
PROV="$ROOT/current/.seed/provenance.json"
if [ -f "$PROV" ]; then
  cat "$PROV"
else
  echo "(no provenance at ${PROV})"
  # Legacy Hermes flat install (migration window)
  if [ -f /opt/hermes-lanyard/.seed/provenance.env ]; then
    echo "--- legacy /opt/hermes-lanyard/.seed/provenance.env ---"
    cat /opt/hermes-lanyard/.seed/provenance.env
  fi
fi
echo

echo "=== installed versions ==="
ls -la "$ROOT/versions" 2>/dev/null || echo "(no versions dir)"
echo

echo "=== systemd ==="
for UNIT in company-brain-backend.service hermes-gateway.service; do
  echo "-- ${UNIT} --"
  systemctl is-active "$UNIT" 2>/dev/null || echo "(inactive or missing)"
  systemctl is-enabled "$UNIT" 2>/dev/null || true
done
echo

echo "=== operator checklist (fill offline / ticket) ==="
cat <<'EOF'
| Field | Value (from above) |
| --- | --- |
| backend.kind / BACKEND_ARTIFACT_KIND | |
| backend.version / BACKEND_ARTIFACT_VERSION | |
| backend.url / BACKEND_ARTIFACT_URL | |
| backend.sha256 / BACKEND_ARTIFACT_SHA256 | |
| backend.contract.runtime_layout | |
| backend.contract.relay | |
| backend.contract.brain_rpc | |
| client_core.version | |
| client_core.sha256 | |
| client_core.url | |
| current → versions/<ver> | |
| unit active (company-brain-backend or hermes-gateway) | |
| pin YAML / tfvars git revision or ticket path | |
| capture file stored at (off-host) | |
EOF

echo
echo "=== done ==="
echo "Rollback is re-pin of previous immutable coordinates, not rebuild from main."
