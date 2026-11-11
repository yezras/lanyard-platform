#!/usr/bin/env bash
# Offline smoke for company-brain-backend.service scaffold (lp-k7g.7.5).
# No root, no systemctl, no network — content/contract checks only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT="$ROOT/deploy/modules/company-brain-ec2/systemd/company-brain-backend.service"
SANDBOX="$ROOT/deploy/modules/company-brain-ec2/systemd/company-brain-backend.service.d/sandbox.conf"
OMNIBOX="$ROOT/deploy/modules/company-brain-ec2/systemd/company-brain-backend.service.d/omnibox.conf"
DESIGN="$ROOT/docs/architecture/deploy-backend-systemd-service.md"

FAILED=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAILED=$((FAILED + 1)); }

echo "==> smoke-backend-systemd-unit (offline)"
echo "    root: $ROOT"

for p in "$UNIT" "$SANDBOX" "$OMNIBOX" "$DESIGN"; do
  if [[ -f "$p" ]]; then
    pass "present: ${p#$ROOT/}"
  else
    fail "missing: ${p#$ROOT/}"
  fi
done

if [[ ! -f "$UNIT" ]]; then
  echo "FAILED  unit missing; aborting content checks"
  exit 1
fi

UNIT_TEXT="$(cat "$UNIT")"

# Acceptance: service uses bin/company-brain-backend gateway
if grep -qE '^ExecStart=.*/bin/company-brain-backend gateway[[:space:]]*$' "$UNIT"; then
  pass "ExecStart uses bin/company-brain-backend gateway"
else
  fail "ExecStart must be …/bin/company-brain-backend gateway"
fi

if grep -q '/opt/company-brain-backend/current/bin/company-brain-backend gateway' "$UNIT"; then
  pass "ExecStart prefers versioned current install path"
else
  fail "ExecStart should use /opt/company-brain-backend/current/…"
fi

# Must not call Hermes-private CLI as primary entrypoint
if grep -qE '^ExecStart=.*/bin/hermes ' "$UNIT"; then
  fail "ExecStart must not call bin/hermes (use company-brain-backend)"
else
  pass "ExecStart does not call bin/hermes"
fi

# Acceptance: env file paths are backend-neutral
if grep -qE '^EnvironmentFile=-/var/lib/company-brain-backend/\.env' "$UNIT"; then
  pass "EnvironmentFile under BACKEND_HOME (.env)"
else
  fail "missing EnvironmentFile=-/var/lib/company-brain-backend/.env"
fi

if grep -qE '^EnvironmentFile=-/etc/company-brain/backend\.env' "$UNIT"; then
  pass "EnvironmentFile under /etc/company-brain/backend.env"
else
  fail "missing EnvironmentFile=-/etc/company-brain/backend.env"
fi

if grep -qE '^EnvironmentFile=.*/home/hermes/\.hermes/' "$UNIT"; then
  fail "primary unit must not use Hermes-only EnvironmentFile path"
else
  pass "no Hermes-only EnvironmentFile in primary unit"
fi

# Platform BACKEND_* present
for key in BACKEND_HOME BACKEND_KIND BACKEND_INSTALL_PATH VAULT_ROOT; do
  if grep -qE "^Environment=${key}=" "$UNIT"; then
    pass "Environment=${key} set"
  else
    fail "missing Environment=${key}=…"
  fi
done

# Acceptance: Hermes aliases only as compatibility (equal to platform paths)
if grep -qE '^Environment=HERMES_HOME=/var/lib/company-brain-backend' "$UNIT" \
  && grep -qE '^Environment=BACKEND_HOME=/var/lib/company-brain-backend' "$UNIT"; then
  pass "HERMES_HOME equals BACKEND_HOME (compatibility alias)"
else
  fail "HERMES_HOME must equal BACKEND_HOME path"
fi

if grep -qE '^Environment=HERMES_INSTALL_PATH=/opt/company-brain-backend/current' "$UNIT" \
  && grep -qE '^Environment=BACKEND_INSTALL_PATH=/opt/company-brain-backend/current' "$UNIT"; then
  pass "HERMES_INSTALL_PATH equals BACKEND_INSTALL_PATH (compatibility alias)"
else
  fail "HERMES_INSTALL_PATH must equal BACKEND_INSTALL_PATH"
fi

# Acceptance: writable paths match runtime layout
if grep -qE '^ReadWritePaths=.*(/var/lib/company-brain-backend)' "$UNIT"; then
  pass "ReadWritePaths includes BACKEND_HOME"
else
  fail "ReadWritePaths must include BACKEND_HOME (/var/lib/company-brain-backend)"
fi

if grep -qE '^ReadWritePaths=.*(/opt/company-brain)' "$UNIT"; then
  pass "ReadWritePaths includes VAULT_ROOT (/opt/company-brain)"
else
  fail "ReadWritePaths must include VAULT_ROOT"
fi

# Sandbox knobs present on unit
for knob in NoNewPrivileges=true ProtectSystem=strict ProtectHome=true PrivateTmp=true; do
  if grep -qF "$knob" "$UNIT"; then
    pass "sandbox: $knob"
  else
    fail "missing sandbox knob: $knob"
  fi
done

# Omnibox must not change ExecStart
if [[ -f "$OMNIBOX" ]]; then
  if grep -qE '^ExecStart=' "$OMNIBOX"; then
    fail "omnibox drop-in must not set ExecStart"
  else
    pass "omnibox drop-in does not set ExecStart"
  fi
fi

# Design doc markers
if [[ -f "$DESIGN" ]]; then
  DTEXT="$(cat "$DESIGN")"
  for needle in \
    'bin/company-brain-backend gateway' \
    'BACKEND_HOME' \
    'HERMES_HOME' \
    'EnvironmentFile' \
    'ReadWritePaths' \
    'filesystem-layout'; do
    if grep -qF "$needle" <<<"$DTEXT"; then
      pass "design doc mentions: $needle"
    else
      fail "design doc missing: $needle"
    fi
  done
fi

echo
if [[ $FAILED -eq 0 ]]; then
  echo "OK  smoke-backend-systemd-unit passed"
  exit 0
else
  echo "FAILED  $FAILED check(s) in smoke-backend-systemd-unit"
  exit 1
fi
