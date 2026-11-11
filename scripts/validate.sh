#!/usr/bin/env bash
# Offline-by-default validation for the Lanyard Platform planning shell.
# No network calls. Safe for local runs and future GitHub Actions.
#
# Usage (from repository root):
#   bash scripts/validate.sh
#   bash scripts/validate.sh --help
#
# Exit 0 on success; non-zero if any check fails.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAILED=0
CHECKS_RUN=0

usage() {
  cat <<'EOF'
Usage: bash scripts/validate.sh [options]

Offline validation for docs links, compatibility pins YAML, backend-runtime
contract layout, and Beads export health. Does not call the network.

Options:
  -h, --help   Show this help and exit

Checks:
  1. Relative markdown links under README.md and docs/
  2. Compatibility pins schema_version 2 (URLs, immutable versions, backend contracts)
  3. Presence/structure of contracts/backend-runtime-v1/
  4. Offline Beads export health (.beads/issues.jsonl, config.yaml, metadata.json)
  5. Backend artifact manifest schema + examples (when schema present)
  6. Backend config schema + examples (when schema present)
  7. Backend profile capability schema + admin/contributor examples (when present)
  8. Brain RPC v1 method schemas + request/result examples (when present)
  9. Backend capability descriptor schema + examples (when present)
  10. Deploy backend_artifact Terraform interface stubs (when deploy/ present)
  11. Deploy bootstrap backend install scaffold + offline smoke (when present)
  12. Deploy generic backend systemd unit scaffold + offline smoke (when present)
  13. Deploy artifact landing zones + OIDC publisher trust (when present)
  14. client-core pack metadata (when client-core/packs present): discoverable
     pack list, missing/duplicate pack.yaml, enable-pack handlers, INDEX sync;
     meadow-core persona frontmatter snapshot when that pack is present
  15. client-core pack-release monorepo subpath dry-run (when pack-release.sh
     present): tarball shape, version/url/sha256 emission, pin fragment
  16. client-core vault seed idempotency (when seed-vault.sh present): first-run
     installs expected files, existing AGENTS.md prevents overwrite, re-run is
     non-destructive
  17. Deploy staging roots after monorepo move (when deploy/ present): offline
     bootstrap extract/inject smokes + platform-staging compose structure
     (SKIP_TERRAFORM=1; full terraform fmt/validate remains under deploy/)
  18. Fake relay harness unit tests (when
     contracts/backend-runtime-v1/harness/ present): hello validation, chat
     inject, interrupt + Brain RPC over mock socket (lp-k7g.11.1)
  19. Backend tarball manifest + entrypoint (lp-k7g.11.2): offline fixture
     has manifest/backend.json (schema), bin/company-brain-backend executable,
     kind/version/contract match compatibility pins
  20. Brain RPC required-method conformance (lp-k7g.11.3): FakeBrainRpcHost +
     harness exercises brain.ping/health, vault ACL (contributor vs admin),
     settings.snapshot + projects.list schema-shaped results (offline)
  21. Hermes-Lanyard artifact conformance job (lp-k7g.11.4): offline pin +
     fixture resolve, tarball validate, entrypoint smoke, fake relay +
     required Brain RPC checks for kind hermes_lanyard (no network)
  22. BackendRuntimeSecretsEnvelope schema + placeholder examples (lp-645.2):
     secrets-envelope.schema.json, examples, architecture mapping doc,
     negative payloads rejected (offline, no network)
  23. Materialize backend secrets host tool + offline smoke (lp-645.3):
     deploy/scripts/materialize-backend-secrets.py --from-file fixture,
     idempotent re-run, invalid schema fail-closed, no secret values in logs
  24. LiteLLM multi-slot + OAuth parity (lp-645.8.5): deploy/litellm config
     template slots, env placeholders, map-oauth-to-litellm offline self-test,
     agent envelope wiring (no live keys)
  25. parse_document F3 host tool reference (lp-uxy.10.4): offline unit tests
     for path ACL, dual-emit, truncation/sidecar; live anydoc skipped unless
     firecrawl-anydoc is installed (no network)
  26. parse_document F5 OCR cost-gate (lp-uxy.10.6): F5 docs + evidence; unit
     tests cover force/auto gates, placeholder key rejection, mock Firecrawl
     Parse (no live paid network)
  27. parse_document F6 prove attach→parse→answer (lp-uxy.10.7): offline host
     prove harness + story/docs/evidence present (no network; no live OCR)
  28. Sandbox vault mount IAM templates (lp-t86): offline cross-tenant isolation
     smoke for drafts/iam session/identity/trust/seed policies (no AWS apply)
  29. Pilot lab S3 vault bucket ensure (lp-d26): offline doc/constant checks
     (live HeadBucket optional via SMOKE_PILOT_VAULT_LIVE=1, not in CI)
  30. ChatTurnRecord v1 schema + examples (lp-gkh.2): contracts/chat-corpus-v1
     schema_version required, example hashes, negative payloads rejected
  31. Signed operation ledger domain (lp-ye4.5): contracts/backend-runtime-v1/
     signed-operation.schema.json + fixtures (human write, agent checkpoint,
     conflict, workspace tree advance) + DocumentRevision CAS compatibility
     (offline, no network)
  32. Access grants + unknown-agent identity (lp-ye4.9):
     access-grant.schema.json + human/agent/delegated fixtures + negatives
     (offline, no network)
  33. Daytona unused-sandbox archive hygiene (lp-oop.37.7): dry-run default
     job keeps CP-bound sandbox_id; offline smoke; no live Daytona
  34. Connectors v1 catalog (lp-xhf4.1): contracts/connectors-v1/catalog.json
     closed enums, command_map coverage, unmapped_gate=every_call, free-text
     connector names rejected (offline, no network)
  35. Harness MemPalace placement (lp-oop.38.13): toolbox CLI bind, palace
     on vault, write_policy gate, default-on without guest config.yaml
     (offline grep; no AWS / Daytona / Fargate PATH)
  37. group-rooms-v1 (lac-bx3.9): Speaker, WakeDecision, target_persona_ids,
     speaker-not-participant reject, fake-gateway fixture load (offline)
  38. Admin instructional copy (lp-hdzm.2): forbidden phrases under
     portal/apps/web/src/features/admin; planted-string self-test
  39. Local Muse Spark LiteLLM provider (lp-k5c4.17):
     LITELLM_BASE_URL=https://api.meta.ai (no /v1), createEnvLiteLlmTurnRunner
     only, no metaComplete, no Portal BFF Meta fetch (offline)

Requires: bash, python3 (stdlib only; PyYAML required for pin YAML + some config examples).
      jsonschema optional for full Draft validation of
      pins/manifests/config/profiles/brain-rpc/capabilities/provenance/
      secrets-envelope / chat-turn-record / access-grant / connectors-catalog / group-rooms.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

pass() {
  CHECKS_RUN=$((CHECKS_RUN + 1))
  echo "  PASS  $1"
}

fail() {
  CHECKS_RUN=$((CHECKS_RUN + 1))
  FAILED=$((FAILED + 1))
  echo "  FAIL  $1"
}

echo "==> Lanyard Platform validation (offline)"
echo "    root: $ROOT"
echo

# ---------------------------------------------------------------------------
# 1. Relative markdown link check
# ---------------------------------------------------------------------------
echo "1. Relative markdown links (README.md, docs/)"
set +e
LINK_OUT="$(python3 - "$ROOT" <<'PY'
import os
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

root = Path(sys.argv[1]).resolve()
# Match markdown links [text](target) and images ![alt](target)
LINK_RE = re.compile(r"!?\[([^\]]*)\]\(([^)]+)\)")

roots = [root / "README.md", root / "docs"]
files = []
for r in roots:
    if r.is_file():
        files.append(r)
    elif r.is_dir():
        files.extend(sorted(r.rglob("*.md")))

errors = []
checked = 0
for md in files:
    try:
        text = md.read_text(encoding="utf-8")
    except OSError as e:
        errors.append(f"{md.relative_to(root)}: cannot read: {e}")
        continue
    for m in LINK_RE.finditer(text):
        target = m.group(2).strip()
        # Strip angle brackets <path>
        if target.startswith("<") and target.endswith(">"):
            target = target[1:-1].strip()
        # Title after space or quoted title: path "title"
        if target.startswith(("'", '"')):
            continue  # unusual; skip
        # Split off title: url "title" or url 'title'
        title_split = re.match(r'^(\S+)\s+["\'].*', target)
        if title_split:
            target = title_split.group(1)
        # Skip empty, pure anchors, mailto, data, javascript
        if not target or target.startswith("#"):
            continue
        parsed = urlparse(target)
        # Skip absolute URLs / schemes (http, https, mailto, etc.)
        if parsed.scheme:
            continue
        # Protocol-relative //example.com
        if target.startswith("//"):
            continue
        path_part = unquote(parsed.path)
        # Windows-ish absolute paths not expected; treat as relative
        if path_part.startswith("/"):
            # Absolute-from-repo-root style (rare); resolve from root
            dest = (root / path_part.lstrip("/")).resolve()
        else:
            dest = (md.parent / path_part).resolve()
        # Ensure dest stays under root when possible (symlink edge cases ignored)
        try:
            dest.relative_to(root)
        except ValueError:
            # Outside repo: still require existence if path was relative-looking
            pass
        checked += 1
        if not dest.exists():
            rel_md = md.relative_to(root)
            errors.append(f"{rel_md}: broken relative link -> {target}")

if errors:
    for e in errors:
        print(e)
    print(f"__STATS__ checked={checked} errors={len(errors)}", file=sys.stderr)
    sys.exit(1)
print(f"checked {checked} relative link(s) across {len(files)} markdown file(s)")
sys.exit(0)
PY
)"
LINK_RC=$?
set -e
if [[ $LINK_RC -eq 0 ]]; then
  pass "$LINK_OUT"
else
  while IFS= read -r line; do
    [[ -n "$line" ]] && fail "$line"
  done <<<"$LINK_OUT"
  if [[ -z "$LINK_OUT" ]]; then
    fail "relative markdown link check failed"
  fi
fi

# ---------------------------------------------------------------------------
# 2. Compatibility pins (schema_version 2 + policy)
# ---------------------------------------------------------------------------
echo
echo "2. compatibility pins (schema_version 2)"
PINS_SCHEMA="$ROOT/compatibility/schema.json"
PINS_VALIDATOR="$ROOT/scripts/validate-compatibility-pins.py"
PINS_EXAMPLE="$ROOT/compatibility/pins.example.yaml"
if [[ ! -f "$PINS_SCHEMA" ]]; then
  fail "missing compatibility/schema.json"
elif [[ ! -f "$PINS_VALIDATOR" ]]; then
  fail "missing scripts/validate-compatibility-pins.py"
elif [[ ! -f "$PINS_EXAMPLE" ]]; then
  fail "missing compatibility/pins.example.yaml"
else
  set +e
  PINS_OUT="$(python3 "$PINS_VALIDATOR" --root "$ROOT" 2>&1)"
  PINS_RC=$?
  set -e
  if [[ $PINS_RC -eq 0 ]]; then
    SUMMARY="$(echo "$PINS_OUT" | grep -E '^OK  ' | tail -1)"
    if [[ -z "$SUMMARY" ]]; then
      SUMMARY="compatibility pins validated"
    fi
    pass "$SUMMARY"
  else
    while IFS= read -r line; do
      [[ "$line" == *"FAIL"* ]] && fail "$line"
    done <<<"$PINS_OUT"
    if ! echo "$PINS_OUT" | grep -q FAIL; then
      fail "validate-compatibility-pins.py exited $PINS_RC"
      echo "$PINS_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 3. contracts/backend-runtime-v1 structure
# ---------------------------------------------------------------------------
echo
echo "3. contracts/backend-runtime-v1/"
CONTRACT="$ROOT/contracts/backend-runtime-v1"
if [[ ! -d "$CONTRACT" ]]; then
  fail "missing directory contracts/backend-runtime-v1/"
else
  if [[ ! -f "$CONTRACT/README.md" ]]; then
    fail "missing contracts/backend-runtime-v1/README.md"
  else
    pass "directory and README.md present"
  fi
  if ! find "$CONTRACT" -maxdepth 1 -type f -name '*.md' | grep -q .; then
    fail "contracts/backend-runtime-v1/ has no markdown files"
  fi
  if [[ -f "$CONTRACT/artifact-manifest.schema.json" ]]; then
    pass "artifact-manifest.schema.json present"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Beads export / offline health
# ---------------------------------------------------------------------------
echo
echo "4. Beads offline health (.beads/)"
BEADS="$ROOT/.beads"
if [[ ! -d "$BEADS" ]]; then
  fail "missing .beads/ directory"
else
  set +e
  BEADS_OUT="$(python3 - "$BEADS" <<'PY'
import json
import sys
from pathlib import Path

beads = Path(sys.argv[1])
errors = []
notes = []

issues = beads / "issues.jsonl"
if not issues.is_file():
    errors.append("missing .beads/issues.jsonl")
else:
    n = 0
    bad = 0
    for i, line in enumerate(issues.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            errors.append(f"issues.jsonl line {i}: invalid JSON: {e}")
            bad += 1
            if bad >= 5:
                errors.append("issues.jsonl: too many JSON errors; stopping early")
                break
            continue
        if not isinstance(obj, dict):
            errors.append(f"issues.jsonl line {i}: expected object")
            continue
        if "id" not in obj:
            errors.append(f"issues.jsonl line {i}: missing id")
        n += 1
    notes.append(f"issues.jsonl: {n} issue record(s)")

meta = beads / "metadata.json"
if not meta.is_file():
    errors.append("missing .beads/metadata.json")
else:
    try:
        m = json.loads(meta.read_text(encoding="utf-8"))
        if not isinstance(m, dict):
            errors.append("metadata.json: expected object")
        else:
            notes.append("metadata.json: valid JSON object")
    except json.JSONDecodeError as e:
        errors.append(f"metadata.json: invalid JSON: {e}")

cfg = beads / "config.yaml"
if not cfg.is_file():
    errors.append("missing .beads/config.yaml")
else:
    text = cfg.read_text(encoding="utf-8")
    if not text.strip():
        errors.append("config.yaml is empty")
    else:
        # Offline: do not require PyYAML for config (mostly comments/defaults).
        # Ensure file is readable UTF-8 and non-empty; optional parse if yaml present.
        try:
            import yaml  # type: ignore
            yaml.safe_load(text)
            notes.append("config.yaml: parses as YAML")
        except ImportError:
            notes.append("config.yaml: present (PyYAML not installed; parse skipped)")
        except Exception as e:
            errors.append(f"config.yaml: YAML error: {e}")

if errors:
    for e in errors:
        print(e)
    sys.exit(1)
print("; ".join(notes))
sys.exit(0)
PY
)"
  BEADS_RC=$?
  set -e
  if [[ $BEADS_RC -eq 0 ]]; then
    pass "$BEADS_OUT"
  else
    while IFS= read -r line; do
      [[ -n "$line" ]] && fail "$line"
    done <<<"$BEADS_OUT"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Backend artifact manifest schema + examples (when schema present)
# ---------------------------------------------------------------------------
echo
echo "5. Backend artifact manifests (contracts/backend-runtime-v1/)"
MANIFEST_SCHEMA="$ROOT/contracts/backend-runtime-v1/artifact-manifest.schema.json"
MANIFEST_VALIDATOR="$ROOT/scripts/validate-artifact-manifests.py"
if [[ ! -f "$MANIFEST_SCHEMA" ]]; then
  pass "artifact-manifest.schema.json not present yet (skip)"
elif [[ ! -f "$MANIFEST_VALIDATOR" ]]; then
  fail "missing scripts/validate-artifact-manifests.py (schema present)"
else
  set +e
  MANIFEST_OUT="$(python3 "$MANIFEST_VALIDATOR" --root "$ROOT" 2>&1)"
  MANIFEST_RC=$?
  set -e
  if [[ $MANIFEST_RC -eq 0 ]]; then
    # Collapse multi-line OK summary into one pass line
    SUMMARY="$(echo "$MANIFEST_OUT" | grep -E '^OK  ' | tail -1)"
    if [[ -z "$SUMMARY" ]]; then
      SUMMARY="artifact manifests validated"
    fi
    pass "$SUMMARY"
  else
    while IFS= read -r line; do
      [[ "$line" == *"FAIL"* ]] && fail "$line"
    done <<<"$MANIFEST_OUT"
    if ! echo "$MANIFEST_OUT" | grep -q FAIL; then
      fail "validate-artifact-manifests.py exited $MANIFEST_RC"
      echo "$MANIFEST_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 6. Backend config schema + examples (when schema present)
# ---------------------------------------------------------------------------
echo
echo "6. Backend runtime config (contracts/backend-runtime-v1/)"
CONFIG_SCHEMA="$ROOT/contracts/backend-runtime-v1/config.schema.json"
CONFIG_VALIDATOR="$ROOT/scripts/validate-backend-config.py"
if [[ ! -f "$CONFIG_SCHEMA" ]]; then
  pass "config.schema.json not present yet (skip)"
elif [[ ! -f "$CONFIG_VALIDATOR" ]]; then
  fail "missing scripts/validate-backend-config.py (schema present)"
else
  set +e
  CONFIG_OUT="$(python3 "$CONFIG_VALIDATOR" --root "$ROOT" 2>&1)"
  CONFIG_RC=$?
  set -e
  if [[ $CONFIG_RC -eq 0 ]]; then
    SUMMARY="$(echo "$CONFIG_OUT" | grep -E '^OK  ' | tail -1)"
    if [[ -z "$SUMMARY" ]]; then
      SUMMARY="backend config schema + examples validated"
    fi
    pass "$SUMMARY"
  else
    while IFS= read -r line; do
      [[ "$line" == *"FAIL"* ]] && fail "$line"
    done <<<"$CONFIG_OUT"
    if ! echo "$CONFIG_OUT" | grep -q FAIL; then
      fail "validate-backend-config.py exited $CONFIG_RC"
      echo "$CONFIG_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 7. Backend profile capability schema + examples (when schema present)
# ---------------------------------------------------------------------------
echo
echo "7. Backend profile capabilities (contracts/backend-runtime-v1/)"
PROFILE_SCHEMA="$ROOT/contracts/backend-runtime-v1/profiles.schema.json"
PROFILE_VALIDATOR="$ROOT/scripts/validate-backend-profiles.py"
if [[ ! -f "$PROFILE_SCHEMA" ]]; then
  pass "profiles.schema.json not present yet (skip)"
elif [[ ! -f "$PROFILE_VALIDATOR" ]]; then
  fail "missing scripts/validate-backend-profiles.py (schema present)"
else
  set +e
  PROFILE_OUT="$(python3 "$PROFILE_VALIDATOR" --root "$ROOT" 2>&1)"
  PROFILE_RC=$?
  set -e
  if [[ $PROFILE_RC -eq 0 ]]; then
    SUMMARY="$(echo "$PROFILE_OUT" | grep -E '^OK  ' | tail -1)"
    if [[ -z "$SUMMARY" ]]; then
      SUMMARY="backend profile schema + examples validated"
    fi
    pass "$SUMMARY"
  else
    while IFS= read -r line; do
      [[ "$line" == *"FAIL"* ]] && fail "$line"
    done <<<"$PROFILE_OUT"
    if ! echo "$PROFILE_OUT" | grep -q FAIL; then
      fail "validate-backend-profiles.py exited $PROFILE_RC"
      echo "$PROFILE_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 8. Brain RPC method schemas + examples (when schema present)
# ---------------------------------------------------------------------------
echo
echo "8. Brain RPC method schemas (contracts/backend-runtime-v1/)"
BRAIN_RPC_SCHEMA="$ROOT/contracts/backend-runtime-v1/brain-rpc.schema.json"
BRAIN_RPC_VALIDATOR="$ROOT/scripts/validate-brain-rpc.py"
if [[ ! -f "$BRAIN_RPC_SCHEMA" ]]; then
  pass "brain-rpc.schema.json not present yet (skip)"
elif [[ ! -f "$BRAIN_RPC_VALIDATOR" ]]; then
  fail "missing scripts/validate-brain-rpc.py (schema present)"
else
  set +e
  BRAIN_RPC_OUT="$(python3 "$BRAIN_RPC_VALIDATOR" --root "$ROOT" 2>&1)"
  BRAIN_RPC_RC=$?
  set -e
  if [[ $BRAIN_RPC_RC -eq 0 ]]; then
    SUMMARY="$(echo "$BRAIN_RPC_OUT" | grep -E '^OK  ' | tail -1)"
    if [[ -z "$SUMMARY" ]]; then
      SUMMARY="brain RPC schema + examples validated"
    fi
    pass "$SUMMARY"
  else
    while IFS= read -r line; do
      [[ "$line" == *"FAIL"* ]] && fail "$line"
    done <<<"$BRAIN_RPC_OUT"
    if ! echo "$BRAIN_RPC_OUT" | grep -q FAIL; then
      fail "validate-brain-rpc.py exited $BRAIN_RPC_RC"
      echo "$BRAIN_RPC_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 9. Backend capability descriptor schema + examples (when schema present)
# ---------------------------------------------------------------------------
echo
echo "9. Backend capability descriptor (contracts/backend-runtime-v1/)"
CAP_SCHEMA="$ROOT/contracts/backend-runtime-v1/capabilities.schema.json"
CAP_VALIDATOR="$ROOT/scripts/validate-backend-capabilities.py"
if [[ ! -f "$CAP_SCHEMA" ]]; then
  pass "capabilities.schema.json not present yet (skip)"
elif [[ ! -f "$CAP_VALIDATOR" ]]; then
  fail "missing scripts/validate-backend-capabilities.py (schema present)"
else
  set +e
  CAP_OUT="$(python3 "$CAP_VALIDATOR" --root "$ROOT" 2>&1)"
  CAP_RC=$?
  set -e
  if [[ $CAP_RC -eq 0 ]]; then
    SUMMARY="$(echo "$CAP_OUT" | grep -E '^OK  ' | tail -1)"
    if [[ -z "$SUMMARY" ]]; then
      SUMMARY="backend capability schema + examples validated"
    fi
    pass "$SUMMARY"
  else
    while IFS= read -r line; do
      [[ "$line" == *"FAIL"* ]] && fail "$line"
    done <<<"$CAP_OUT"
    if ! echo "$CAP_OUT" | grep -q FAIL; then
      fail "validate-backend-capabilities.py exited $CAP_RC"
      echo "$CAP_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 10. Deploy backend_artifact Terraform interface stubs (lp-k7g.7.3)
# ---------------------------------------------------------------------------
echo
echo "10. Deploy backend_artifact Terraform stubs (deploy/)"
DEPLOY_MOD="$ROOT/deploy/modules/company-brain-ec2"
DEPLOY_TENANT="$ROOT/deploy/templates/tenant"
DEPLOY_DOC="$ROOT/docs/architecture/deploy-backend-artifact-variables.md"
if [[ ! -d "$ROOT/deploy" ]]; then
  pass "deploy/ not present yet (skip)"
elif [[ ! -f "$DEPLOY_DOC" ]]; then
  fail "missing docs/architecture/deploy-backend-artifact-variables.md"
else
  set +e
  DEPLOY_OUT="$(python3 - "$DEPLOY_MOD" "$DEPLOY_TENANT" <<'PY'
import re
import sys
from pathlib import Path

mod = Path(sys.argv[1])
tenant = Path(sys.argv[2])
errors = []

required_mod = [
    "backend_artifact_variables.tf",
    "backend_artifact_locals.tf",
    "backend_artifact_outputs.tf",
    "user_data_backend_pins.fragment.tftpl",
]
required_tenant = [
    "backend_artifact_variables.tf",
    "backend_artifact_outputs.tf",
    "backend_artifact_module_args.tf.example",
    "terraform.tfvars.backend_artifact.example",
]

for name in required_mod:
    p = mod / name
    if not p.is_file():
        errors.append(f"missing deploy/modules/company-brain-ec2/{name}")

for name in required_tenant:
    p = tenant / name
    if not p.is_file():
        errors.append(f"missing deploy/templates/tenant/{name}")

# Module additive stub must declare backend_* names (lp-k7g.7.3).
# After import rewire (lp-k7g.10.2), hermes_* live only in product variables.tf
# so Terraform does not see duplicate declarations next to the stubs.
mod_vars = mod / "backend_artifact_variables.tf"
if mod_vars.is_file():
    text = mod_vars.read_text(encoding="utf-8")
    for name in (
        "backend_artifact_url",
        "backend_artifact_version",
        "backend_artifact_sha256",
        "backend_artifact_kind",
        "backend_artifact_arch",
    ):
        if not re.search(rf'variable\s+"{re.escape(name)}"', text):
            errors.append(f"module variables.tf stub missing variable \"{name}\"")
    # Stub must not redeclare hermes_* (would break terraform validate after import).
    for legacy in (
        "hermes_artifact_url",
        "hermes_artifact_version",
        "hermes_artifact_sha256",
    ):
        if re.search(rf'variable\s+"{re.escape(legacy)}"', text):
            errors.append(
                f"module backend_artifact_variables.tf must not redeclare \"{legacy}\" "
                "(keep legacy only in product variables.tf for lp-k7g.10.2)"
            )

# Product variables.tf still owns temporary hermes_* accept-only aliases.
mod_product_vars = mod / "variables.tf"
if mod_product_vars.is_file():
    text = mod_product_vars.read_text(encoding="utf-8")
    for legacy in (
        "hermes_artifact_url",
        "hermes_artifact_version",
        "hermes_artifact_sha256",
    ):
        if not re.search(rf'variable\s+"{re.escape(legacy)}"', text):
            errors.append(f"module product variables.tf missing temporary alias \"{legacy}\"")

# Locals must still resolve backend_* + hermes_* (conflict checks / effective pins).
mod_locals = mod / "backend_artifact_locals.tf"
if mod_locals.is_file():
    text = mod_locals.read_text(encoding="utf-8")
    for token in (
        "effective_backend_artifact_url",
        "effective_backend_artifact_arch",
        "hermes_artifact_url",
        "backend_artifact_url",
    ):
        if token not in text:
            errors.append(f"module backend_artifact_locals.tf missing {token}")

# Tenant variables must expose the same primary names for template rendering.
tenant_vars = tenant / "backend_artifact_variables.tf"
if tenant_vars.is_file():
    text = tenant_vars.read_text(encoding="utf-8")
    for name in (
        "backend_artifact_url",
        "backend_artifact_version",
        "backend_artifact_sha256",
        "backend_artifact_arch",
    ):
        if not re.search(rf'variable\s+"{re.escape(name)}"', text):
            errors.append(f"tenant variables stub missing variable \"{name}\"")
    for legacy in (
        "hermes_artifact_url",
        "hermes_artifact_version",
        "hermes_artifact_sha256",
    ):
        if re.search(rf'variable\s+"{re.escape(legacy)}"', text):
            errors.append(
                f"tenant backend_artifact_variables.tf must not redeclare \"{legacy}\" "
                "(keep legacy only in product variables.tf for lp-k7g.10.2)"
            )

tenant_product_vars = tenant / "variables.tf"
if tenant_product_vars.is_file():
    text = tenant_product_vars.read_text(encoding="utf-8")
    for legacy in (
        "hermes_artifact_url",
        "hermes_artifact_version",
        "hermes_artifact_sha256",
    ):
        if not re.search(rf'variable\s+"{re.escape(legacy)}"', text):
            errors.append(f"tenant product variables.tf missing temporary alias \"{legacy}\"")

# user_data fragment dual-writes BACKEND_* and temporary HERMES_*
frag = mod / "user_data_backend_pins.fragment.tftpl"
if frag.is_file():
    text = frag.read_text(encoding="utf-8")
    for key in (
        "BACKEND_ARTIFACT_URL",
        "BACKEND_ARTIFACT_VERSION",
        "BACKEND_ARTIFACT_SHA256",
        "BACKEND_ARTIFACT_ARCH",
        "HERMES_ARTIFACT_URL",
        "HERMES_ARTIFACT_VERSION",
        "HERMES_ARTIFACT_SHA256",
        "HERMES_ARTIFACT_ARCH",
    ):
        if key not in text:
            errors.append(f"user_data fragment missing {key}")

if errors:
    for e in errors:
        print(f"FAIL  {e}")
    sys.exit(1)
print(
    "deploy backend_artifact stubs: module vars+locals+outputs, "
    "tenant vars+outputs+tfvars example, user_data dual-write fragment"
)
sys.exit(0)
PY
)"
  DEPLOY_RC=$?
  set -e
  if [[ $DEPLOY_RC -eq 0 ]]; then
    pass "$DEPLOY_OUT"
  else
    while IFS= read -r line; do
      [[ -n "$line" ]] && fail "$line"
    done <<<"$DEPLOY_OUT"
    if [[ -z "$DEPLOY_OUT" ]]; then
      fail "deploy backend_artifact stub check failed"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 11. Deploy bootstrap backend install paths + provenance (lp-k7g.7.4)
# ---------------------------------------------------------------------------
echo
echo "11. Deploy bootstrap backend install scaffold (deploy/)"
BOOTSTRAP_SCRIPT="$ROOT/deploy/scripts/bootstrap-backend-install.sh"
BOOTSTRAP_SMOKE="$ROOT/deploy/scripts/smoke-bootstrap-backend-install.sh"
PROV_SCHEMA="$ROOT/deploy/schemas/backend-install-provenance.schema.json"
PROV_EXAMPLE="$ROOT/deploy/examples/backend-install-provenance.example.json"
BOOTSTRAP_DOC="$ROOT/docs/architecture/deploy-bootstrap-backend-install.md"
if [[ ! -d "$ROOT/deploy" ]]; then
  pass "deploy/ not present yet (skip)"
elif [[ ! -f "$BOOTSTRAP_DOC" ]]; then
  fail "missing docs/architecture/deploy-bootstrap-backend-install.md"
else
  set +e
  BOOTSTRAP_OUT="$(python3 - "$BOOTSTRAP_SCRIPT" "$PROV_SCHEMA" "$PROV_EXAMPLE" "$BOOTSTRAP_DOC" <<'PY'
import re
import sys
from pathlib import Path

script = Path(sys.argv[1])
schema = Path(sys.argv[2])
example = Path(sys.argv[3])
doc = Path(sys.argv[4])
errors = []

for p, label in (
    (script, "deploy/scripts/bootstrap-backend-install.sh"),
    (schema, "deploy/schemas/backend-install-provenance.schema.json"),
    (example, "deploy/examples/backend-install-provenance.example.json"),
    (doc, "docs/architecture/deploy-bootstrap-backend-install.md"),
):
    if not p.is_file():
        errors.append(f"missing {label}")

if script.is_file():
    text = script.read_text(encoding="utf-8")
    for needle in (
        "download_artifact",
        "verify_sha256",
        "extract_archive",
        "versions/",
        "current",
        "provenance.json",
        "BACKEND_ARTIFACT_KIND",
        "BACKEND_CONTRACT_RELAY",
        "provenance_matches_pins",
        "require_host_arch_match",
        "TARGET_ARCH",
    ):
        if needle not in text:
            errors.append(f"bootstrap script missing marker: {needle}")
    # Enforce verify-before-extract order in the install function body
    m = re.search(
        r"install_backend_versioned\(\)\s*\{(.*?)^\s*\}",
        text,
        re.S | re.M,
    )
    if not m:
        errors.append("bootstrap script missing install_backend_versioned function")
    else:
        body = m.group(1)
        i_dl = body.find("download_artifact")
        i_vf = body.find("verify_sha256")
        i_ex = body.find("extract_archive")
        if min(i_dl, i_vf, i_ex) < 0:
            errors.append("install_backend_versioned must call download, verify, extract")
        elif not (i_dl < i_vf < i_ex):
            errors.append(
                "install order must be download → verify → extract "
                f"(positions dl={i_dl} vf={i_vf} ex={i_ex})"
            )

if schema.is_file() and example.is_file():
    import json
    try:
        sch = json.loads(schema.read_text(encoding="utf-8"))
        ex = json.loads(example.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        errors.append(f"provenance JSON parse error: {e}")
    else:
        for key in (
            "schema_version",
            "kind",
            "version",
            "url",
            "sha256",
            "contract",
            "installed_at",
            "install_root",
            "install_path",
        ):
            if key not in sch.get("required", []):
                errors.append(f"provenance schema required[] missing {key}")
            if key not in ex:
                errors.append(f"provenance example missing {key}")
        for key in ("runtime_layout", "relay", "brain_rpc"):
            if key not in (ex.get("contract") or {}):
                errors.append(f"provenance example contract missing {key}")
        try:
            import jsonschema  # type: ignore
            jsonschema.validate(ex, sch)
        except ImportError:
            pass
        except Exception as e:
            errors.append(f"provenance example failed schema: {e}")

if doc.is_file():
    dtext = doc.read_text(encoding="utf-8")
    for needle in (
        "/opt/company-brain-backend",
        "versions/",
        "current",
        "idempotent",
        "provenance",
        "TARGET_ARCH",
        "linux-x86_64",
        "fail closed",
    ):
        if needle not in dtext:
            errors.append(f"design doc missing marker: {needle}")

if errors:
    for e in errors:
        print(f"FAIL  {e}")
    sys.exit(1)
print(
    "bootstrap install scaffold: script (verify-before-extract), "
    "provenance schema+example, design doc layout"
)
sys.exit(0)
PY
)"
  BOOTSTRAP_RC=$?
  set -e
  if [[ $BOOTSTRAP_RC -eq 0 ]]; then
    pass "$BOOTSTRAP_OUT"
  else
    while IFS= read -r line; do
      [[ -n "$line" ]] && fail "$line"
    done <<<"$BOOTSTRAP_OUT"
    if [[ -z "$BOOTSTRAP_OUT" ]]; then
      fail "deploy bootstrap install scaffold check failed"
    fi
  fi

  # Offline behavioral smoke when smoke script is present
  if [[ -f "$BOOTSTRAP_SMOKE" ]]; then
    set +e
    SMOKE_OUT="$(bash "$BOOTSTRAP_SMOKE" 2>&1)"
    SMOKE_RC=$?
    set -e
    if [[ $SMOKE_RC -eq 0 ]]; then
      pass "smoke-bootstrap-backend-install (offline)"
    else
      fail "smoke-bootstrap-backend-install exited $SMOKE_RC"
      echo "$SMOKE_OUT" | sed 's/^/         /' | tail -20
    fi
  fi

  # Arch fail-closed helpers (lp-2md.3)
  ARCH_SMOKE="$ROOT/deploy/scripts/smoke-bootstrap-arch-check.sh"
  if [[ -f "$ARCH_SMOKE" ]]; then
    set +e
    ARCH_OUT="$(bash "$ARCH_SMOKE" 2>&1)"
    ARCH_RC=$?
    set -e
    if [[ $ARCH_RC -eq 0 ]]; then
      pass "smoke-bootstrap-arch-check (offline)"
    else
      fail "smoke-bootstrap-arch-check exited $ARCH_RC"
      echo "$ARCH_OUT" | sed 's/^/         /' | tail -30
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 12. Deploy generic backend systemd unit (lp-k7g.7.5)
# ---------------------------------------------------------------------------
echo
echo "12. Deploy backend systemd unit scaffold (deploy/)"
SYSTEMD_UNIT="$ROOT/deploy/modules/company-brain-ec2/systemd/company-brain-backend.service"
SYSTEMD_SMOKE="$ROOT/deploy/scripts/smoke-backend-systemd-unit.sh"
SYSTEMD_DOC="$ROOT/docs/architecture/deploy-backend-systemd-service.md"
SYSTEMD_POINTER="$ROOT/deploy/docs/backend-systemd-service.md"

if [[ ! -f "$SYSTEMD_UNIT" && ! -f "$SYSTEMD_DOC" ]]; then
  pass "deploy systemd scaffold not present yet (skip)"
else
  set +e
  SYSTEMD_OUT="$(python3 - "$SYSTEMD_UNIT" "$SYSTEMD_DOC" "$SYSTEMD_POINTER" <<'PY'
import re
import sys
from pathlib import Path

unit = Path(sys.argv[1])
doc = Path(sys.argv[2])
pointer = Path(sys.argv[3])
errors = []

for p, label in (
    (unit, "deploy/modules/company-brain-ec2/systemd/company-brain-backend.service"),
    (doc, "docs/architecture/deploy-backend-systemd-service.md"),
    (pointer, "deploy/docs/backend-systemd-service.md"),
):
    if not p.is_file():
        errors.append(f"missing {label}")

if unit.is_file():
    text = unit.read_text(encoding="utf-8")
    if not re.search(
        r"(?m)^ExecStart=.*/bin/company-brain-backend gateway\s*$",
        text,
    ):
        errors.append(
            "unit ExecStart must be …/bin/company-brain-backend gateway"
        )
    if re.search(r"(?m)^ExecStart=.*/bin/hermes\s", text):
        errors.append("unit must not ExecStart bin/hermes")
    for needle in (
        "Environment=BACKEND_HOME=",
        "Environment=BACKEND_KIND=",
        "Environment=BACKEND_INSTALL_PATH=",
        "Environment=VAULT_ROOT=",
        "Environment=HERMES_HOME=",
        "Environment=HERMES_INSTALL_PATH=",
        "EnvironmentFile=-/var/lib/company-brain-backend/.env",
        "EnvironmentFile=-/etc/company-brain/backend.env",
        "ReadWritePaths=",
        "/var/lib/company-brain-backend",
        "/opt/company-brain",
        "ProtectSystem=strict",
        "NoNewPrivileges=true",
    ):
        if needle not in text:
            errors.append(f"unit missing marker: {needle}")
    # Hermes-only primary env file path forbidden
    if re.search(r"(?m)^EnvironmentFile=.*/home/hermes/\.hermes/", text):
        errors.append(
            "unit EnvironmentFile must not use Hermes-only path as primary"
        )
    # HERMES_HOME must equal BACKEND_HOME path (compatibility alias)
    bh = re.search(r"(?m)^Environment=BACKEND_HOME=(.+)$", text)
    hh = re.search(r"(?m)^Environment=HERMES_HOME=(.+)$", text)
    if bh and hh and bh.group(1).strip() != hh.group(1).strip():
        errors.append("HERMES_HOME must equal BACKEND_HOME (alias rule)")
    bi = re.search(r"(?m)^Environment=BACKEND_INSTALL_PATH=(.+)$", text)
    hi = re.search(r"(?m)^Environment=HERMES_INSTALL_PATH=(.+)$", text)
    if bi and hi and bi.group(1).strip() != hi.group(1).strip():
        errors.append(
            "HERMES_INSTALL_PATH must equal BACKEND_INSTALL_PATH (alias rule)"
        )
    # ReadWritePaths must cover runtime home + vault
    m = re.search(r"(?m)^ReadWritePaths=(.+)$", text)
    if not m:
        errors.append("unit missing ReadWritePaths=")
    else:
        rwp = m.group(1)
        if "/var/lib/company-brain-backend" not in rwp:
            errors.append("ReadWritePaths must include BACKEND_HOME")
        if "/opt/company-brain" not in rwp:
            errors.append("ReadWritePaths must include VAULT_ROOT")

if doc.is_file():
    dtext = doc.read_text(encoding="utf-8")
    for needle in (
        "bin/company-brain-backend gateway",
        "BACKEND_HOME",
        "HERMES_HOME",
        "EnvironmentFile",
        "ReadWritePaths",
        "filesystem-layout",
        "hermes-gateway.service",
    ):
        if needle not in dtext:
            errors.append(f"design doc missing marker: {needle}")

if errors:
    for e in errors:
        print(f"FAIL  {e}")
    sys.exit(1)
print(
    "backend systemd scaffold: ExecStart gateway, backend-neutral "
    "EnvironmentFile, Hermes aliases, layout ReadWritePaths"
)
sys.exit(0)
PY
)"
  SYSTEMD_RC=$?
  set -e
  if [[ $SYSTEMD_RC -eq 0 ]]; then
    pass "$SYSTEMD_OUT"
  else
    while IFS= read -r line; do
      [[ -n "$line" ]] && fail "$line"
    done <<<"$SYSTEMD_OUT"
    if [[ -z "$SYSTEMD_OUT" ]]; then
      fail "deploy backend systemd scaffold check failed"
    fi
  fi

  if [[ -f "$SYSTEMD_SMOKE" ]]; then
    set +e
    SMOKE_OUT="$(bash "$SYSTEMD_SMOKE" 2>&1)"
    SMOKE_RC=$?
    set -e
    if [[ $SMOKE_RC -eq 0 ]]; then
      pass "smoke-backend-systemd-unit (offline)"
    else
      fail "smoke-backend-systemd-unit exited $SMOKE_RC"
      echo "$SMOKE_OUT" | sed 's/^/         /' | tail -20
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 13. Artifact landing zones + OIDC publisher trust (lp-k7g.7.6)
# ---------------------------------------------------------------------------
echo
echo "13. Deploy artifact landing zones + publisher trust (deploy/)"
LANDING_DOC="$ROOT/docs/architecture/deploy-artifact-landing-zones.md"
LANDING_POINTER="$ROOT/deploy/docs/artifact-landing-zones.md"
LANDING_MOD="$ROOT/deploy/modules/product-artifact-infra"
LANDING_SMOKE="$ROOT/deploy/scripts/smoke-artifact-landing-zones.sh"

if [[ ! -f "$LANDING_DOC" && ! -d "$LANDING_MOD" ]]; then
  pass "deploy artifact landing zones not present yet (skip)"
else
  set +e
  LANDING_OUT="$(python3 - "$LANDING_DOC" "$LANDING_POINTER" "$LANDING_MOD" <<'PY'
import re
import sys
from pathlib import Path

doc = Path(sys.argv[1])
pointer = Path(sys.argv[2])
mod = Path(sys.argv[3])
errors = []

required = [
    (doc, "docs/architecture/deploy-artifact-landing-zones.md"),
    (pointer, "deploy/docs/artifact-landing-zones.md"),
    (mod / "README.md", "deploy/modules/product-artifact-infra/README.md"),
    (mod / "artifact_prefixes.tf.example", "artifact_prefixes.tf.example"),
    (mod / "publisher_repos.tf.example", "publisher_repos.tf.example"),
    (mod / "outputs_landing_zones.tf.example", "outputs_landing_zones.tf.example"),
    (mod / "terraform.tfvars.landing_zones.example", "terraform.tfvars.landing_zones.example"),
]
for p, label in required:
    if not p.is_file():
        errors.append(f"missing {label}")

if doc.is_file():
    dtext = doc.read_text(encoding="utf-8")
    for needle in (
        "backends/hermes-lanyard/",
        "backends/lanyard-agent/",
        "backends/<kind-slug>",
        "repo:LanyardBrain/hermes-lanyard:ref:refs/tags/*",
        "repo:LanyardBrain/lanyard-agent:ref:refs/tags/*",
        "client-core/",
        "portal-web/",
        "UNCHANGED",
        "dual-write",
        "product-artifact-infra",
        "hermes/",
    ):
        if needle not in dtext:
            errors.append(f"design doc missing marker: {needle}")
    # Must not nest non-backend products under backends/
    if re.search(r"backends/(client-core|portal-web)/", dtext):
        errors.append("design doc must not nest client-core/ or portal-web/ under backends/")
    if re.search(r"ref:refs/heads/(main|master)", dtext):
        errors.append("design doc must not default OIDC trust to main/master heads")

if (mod / "artifact_prefixes.tf.example").is_file():
    ptext = (mod / "artifact_prefixes.tf.example").read_text(encoding="utf-8")
    for needle in (
        "backends/hermes-lanyard/",
        "backends/lanyard-agent/",
        'client_core',
        "client-core/",
        "portal-web/",
        "hermes/",
    ):
        if needle not in ptext:
            errors.append(f"prefix stub missing marker: {needle}")
    if re.search(r'backends/(client-core|portal-web)/', ptext):
        errors.append("prefix stub must not nest client-core/portal-web under backends/")

if (mod / "publisher_repos.tf.example").is_file():
    pub = (mod / "publisher_repos.tf.example").read_text(encoding="utf-8")
    for needle in (
        "hermes_lanyard",
        "lanyard_agent",
        "hermes-lanyard",
        "lanyard-agent",
        "portal_web",
        "client_core",
        "ref:refs/tags/*",
    ):
        if needle not in pub:
            errors.append(f"publisher stub missing marker: {needle}")
    if re.search(r"ref:refs/heads/(main|master)", pub):
        errors.append("publisher stub must not default OIDC trust to main/master heads")

if errors:
    for e in errors:
        print(f"FAIL  {e}")
    sys.exit(1)
print(
    "landing zones: backends/<kind-slug>/ strategy, Hermes dual-write trust, "
    "Lanyard Agent publisher, client-core/portal-web unchanged"
)
sys.exit(0)
PY
)"
  LANDING_RC=$?
  set -e
  if [[ $LANDING_RC -eq 0 ]]; then
    pass "$LANDING_OUT"
  else
    while IFS= read -r line; do
      [[ -n "$line" ]] && fail "$line"
    done <<<"$LANDING_OUT"
    if [[ -z "$LANDING_OUT" ]]; then
      fail "deploy artifact landing zones check failed"
    fi
  fi

  if [[ -f "$LANDING_SMOKE" ]]; then
    set +e
    SMOKE_OUT="$(bash "$LANDING_SMOKE" 2>&1)"
    SMOKE_RC=$?
    set -e
    if [[ $SMOKE_RC -eq 0 ]]; then
      pass "smoke-artifact-landing-zones (offline)"
    else
      fail "smoke-artifact-landing-zones exited $SMOKE_RC"
      echo "$SMOKE_OUT" | sed 's/^/         /' | tail -20
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 14. client-core pack metadata + enable-pack discovery (lp-k7g.9.3)
# ---------------------------------------------------------------------------
echo
echo "14. client-core packs (metadata, duplicates, enable-pack)"
CC_PACKS="$ROOT/client-core/packs"
CC_VALIDATE_PACKS="$ROOT/client-core/scripts/validate-packs.py"
CC_ENABLE_PACK="$ROOT/client-core/scripts/enable-pack.sh"

if [[ ! -d "$CC_PACKS" ]]; then
  pass "client-core/packs not present yet (skip)"
else
  if [[ ! -f "$CC_VALIDATE_PACKS" ]]; then
    fail "missing client-core/scripts/validate-packs.py"
  else
    set +e
    PACKS_OUT="$(python3 "$CC_VALIDATE_PACKS" --root "$ROOT" 2>&1)"
    PACKS_RC=$?
    set -e
    if [[ $PACKS_RC -eq 0 ]]; then
      SUMMARY="$(echo "$PACKS_OUT" | grep -E '^OK  ' | tail -1)"
      if [[ -z "$SUMMARY" ]]; then
        SUMMARY="client-core pack metadata validated"
      fi
      pass "$SUMMARY"
    else
      while IFS= read -r line; do
        [[ -n "$line" ]] && fail "$line"
      done <<<"$PACKS_OUT"
      if [[ -z "$PACKS_OUT" ]]; then
        fail "validate-packs.py exited $PACKS_RC"
      fi
    fi
  fi

  # Discoverable pack list: enable-pack.sh list must exit 0 and print packs
  if [[ -x "$CC_ENABLE_PACK" || -f "$CC_ENABLE_PACK" ]]; then
    set +e
    LIST_OUT="$(bash "$CC_ENABLE_PACK" list 2>&1)"
    LIST_RC=$?
    set -e
    if [[ $LIST_RC -eq 0 ]] && echo "$LIST_OUT" | grep -q "Available packs"; then
      PACK_COUNT="$(echo "$LIST_OUT" | grep -E '^\s+[a-z0-9]' | wc -l | tr -d ' ')"
      pass "enable-pack list discoverable ($PACK_COUNT pack line(s))"
    else
      fail "enable-pack.sh list failed (rc=$LIST_RC) — pack list not discoverable"
      echo "$LIST_OUT" | sed 's/^/         /' | head -20
    fi
  else
    fail "missing client-core/scripts/enable-pack.sh"
  fi

  # lac-bx3.17: first three-persona vault pack frontmatter + enable smoke
  CC_VALIDATE_PERSONAS="$ROOT/client-core/scripts/validate-persona-pack.py"
  if [[ -d "$CC_PACKS/meadow-core" ]]; then
    if [[ ! -f "$CC_VALIDATE_PERSONAS" ]]; then
      fail "missing client-core/scripts/validate-persona-pack.py (required with packs/meadow-core)"
    else
      set +e
      PERSONAS_OUT="$(python3 "$CC_VALIDATE_PERSONAS" --root "$ROOT" 2>&1)"
      PERSONAS_RC=$?
      set -e
      if [[ $PERSONAS_RC -eq 0 ]]; then
        SUMMARY="$(echo "$PERSONAS_OUT" | grep -E '^OK  ' | tail -1)"
        if [[ -z "$SUMMARY" ]]; then
          SUMMARY="meadow-core persona pack validated"
        fi
        pass "$SUMMARY"
      else
        while IFS= read -r line; do
          [[ -n "$line" ]] && fail "$line"
        done <<<"$PERSONAS_OUT"
        if [[ -z "$PERSONAS_OUT" ]]; then
          fail "validate-persona-pack.py exited $PERSONAS_RC"
        fi
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 15. client-core pack-release monorepo subpath (lp-k7g.9.4)
# ---------------------------------------------------------------------------
echo
echo "15. client-core pack-release (monorepo subpath dry-run)"
CC_PACK_RELEASE="$ROOT/client-core/scripts/pack-release.sh"
CC_SMOKE_PACK="$ROOT/client-core/scripts/smoke-pack-release.sh"

if [[ ! -f "$CC_PACK_RELEASE" ]]; then
  pass "client-core/scripts/pack-release.sh not present yet (skip)"
else
  if [[ ! -f "$CC_SMOKE_PACK" ]]; then
    fail "missing client-core/scripts/smoke-pack-release.sh (required with pack-release.sh)"
  else
    set +e
    PACK_SMOKE_OUT="$(bash "$CC_SMOKE_PACK" 2>&1)"
    PACK_SMOKE_RC=$?
    set -e
    if [[ $PACK_SMOKE_RC -eq 0 ]]; then
      SUMMARY="$(echo "$PACK_SMOKE_OUT" | grep -E '^OK  ' | tail -1)"
      if [[ -z "$SUMMARY" ]]; then
        SUMMARY="client-core pack-release monorepo subpath smoke"
      fi
      pass "$SUMMARY"
    else
      fail "smoke-pack-release exited $PACK_SMOKE_RC"
      echo "$PACK_SMOKE_OUT" | sed 's/^/         /' | tail -30
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 16. client-core vault seed idempotency (lp-k7g.9.5)
# ---------------------------------------------------------------------------
echo
echo "16. client-core vault seed idempotency (AGENTS.md gate)"
CC_SEED_VAULT="$ROOT/client-core/scripts/seed-vault.sh"
CC_SMOKE_SEED="$ROOT/client-core/scripts/smoke-seed-idempotency.sh"

if [[ ! -f "$CC_SEED_VAULT" ]]; then
  pass "client-core/scripts/seed-vault.sh not present yet (skip)"
else
  if [[ ! -f "$CC_SMOKE_SEED" ]]; then
    fail "missing client-core/scripts/smoke-seed-idempotency.sh (required with seed-vault.sh)"
  else
    set +e
    SEED_SMOKE_OUT="$(bash "$CC_SMOKE_SEED" 2>&1)"
    SEED_SMOKE_RC=$?
    set -e
    if [[ $SEED_SMOKE_RC -eq 0 ]]; then
      SUMMARY="$(echo "$SEED_SMOKE_OUT" | grep -E '^OK  ' | tail -1)"
      if [[ -z "$SUMMARY" ]]; then
        SUMMARY="client-core seed idempotency smoke"
      fi
      pass "$SUMMARY"
    else
      fail "smoke-seed-idempotency exited $SEED_SMOKE_RC"
      echo "$SEED_SMOKE_OUT" | sed 's/^/         /' | tail -40
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 17. Deploy staging roots + bootstrap smokes after monorepo move (lp-k7g.10.6)
# ---------------------------------------------------------------------------
echo
echo "17. Deploy staging roots after monorepo move (deploy/)"
STAGING_ROOT="$ROOT/deploy/environments/platform-staging"
BOOTSTRAP_EXTRACT_SMOKE="$ROOT/deploy/scripts/smoke-bootstrap-extract.sh"
BOOTSTRAP_INJECT_SMOKE="$ROOT/deploy/scripts/smoke-bootstrap-inject.sh"
STAGING_COMPOSE_SMOKE="$ROOT/deploy/scripts/smoke-platform-staging-compose.sh"

if [[ ! -d "$ROOT/deploy" ]]; then
  pass "deploy/ not present yet (skip)"
elif [[ ! -d "$STAGING_ROOT" ]]; then
  fail "missing deploy/environments/platform-staging after deploy import"
else
  # Structural presence for staging example root
  STAGING_MISSING=0
  for f in main.tf variables.tf outputs.tf versions.tf terraform.tfvars.example; do
    if [[ ! -f "$STAGING_ROOT/$f" ]]; then
      fail "missing deploy/environments/platform-staging/$f"
      STAGING_MISSING=1
    fi
  done
  if [[ $STAGING_MISSING -eq 0 ]]; then
    pass "platform-staging root files present"
  fi

  # Offline bootstrap path wiring (product ROOT = deploy/)
  if [[ -f "$BOOTSTRAP_EXTRACT_SMOKE" ]]; then
    set +e
    EXTRACT_OUT="$(bash "$BOOTSTRAP_EXTRACT_SMOKE" 2>&1)"
    EXTRACT_RC=$?
    set -e
    if [[ $EXTRACT_RC -eq 0 ]]; then
      pass "smoke-bootstrap-extract (offline)"
    else
      fail "smoke-bootstrap-extract exited $EXTRACT_RC"
      echo "$EXTRACT_OUT" | sed 's/^/         /' | tail -25
    fi
  else
    fail "missing deploy/scripts/smoke-bootstrap-extract.sh"
  fi

  if [[ -f "$BOOTSTRAP_INJECT_SMOKE" ]]; then
    set +e
    # Inject smoke uses local terraform templatefile only (no AWS providers).
    INJECT_OUT="$(bash "$BOOTSTRAP_INJECT_SMOKE" 2>&1)"
    INJECT_RC=$?
    set -e
    if [[ $INJECT_RC -eq 0 ]]; then
      pass "smoke-bootstrap-inject (offline)"
    else
      fail "smoke-bootstrap-inject exited $INJECT_RC"
      echo "$INJECT_OUT" | sed 's/^/         /' | tail -25
    fi
  else
    fail "missing deploy/scripts/smoke-bootstrap-inject.sh"
  fi

  # Compose structure + relative module sources (no registry/network)
  if [[ -f "$STAGING_COMPOSE_SMOKE" ]]; then
    set +e
    COMPOSE_OUT="$(SKIP_TERRAFORM=1 bash "$STAGING_COMPOSE_SMOKE" 2>&1)"
    COMPOSE_RC=$?
    set -e
    if [[ $COMPOSE_RC -eq 0 ]]; then
      pass "smoke-platform-staging-compose (offline, SKIP_TERRAFORM=1)"
    else
      fail "smoke-platform-staging-compose exited $COMPOSE_RC"
      echo "$COMPOSE_OUT" | sed 's/^/         /' | tail -30
    fi
  else
    fail "missing deploy/scripts/smoke-platform-staging-compose.sh"
  fi
fi

# ---------------------------------------------------------------------------
# 18. Fake relay harness offline unit tests (lp-k7g.11.1)
# ---------------------------------------------------------------------------
echo
echo "18. Fake relay harness (contracts/backend-runtime-v1/harness/)"
HARNESS_DIR="$ROOT/contracts/backend-runtime-v1/harness"
HARNESS_RUNNER="$HARNESS_DIR/run_tests.py"

if [[ ! -d "$HARNESS_DIR" ]]; then
  pass "relay harness not present yet (skip)"
elif [[ ! -f "$HARNESS_RUNNER" ]]; then
  fail "missing contracts/backend-runtime-v1/harness/run_tests.py"
else
  set +e
  HARNESS_OUT="$(python3 "$HARNESS_RUNNER" 2>&1)"
  HARNESS_RC=$?
  set -e
  if [[ $HARNESS_RC -eq 0 ]]; then
    SUMMARY="$(echo "$HARNESS_OUT" | grep -E '^OK|^Ran ' | tail -1)"
    if [[ -z "$SUMMARY" ]]; then
      SUMMARY="fake relay harness unit tests"
    fi
    pass "fake relay harness: $SUMMARY"
  else
    fail "fake relay harness tests exited $HARNESS_RC"
    echo "$HARNESS_OUT" | sed 's/^/         /' | tail -40
  fi
fi

# ---------------------------------------------------------------------------
# 19. Backend tarball manifest + entrypoint (lp-k7g.11.2)
# ---------------------------------------------------------------------------
echo
echo "19. Backend tarball manifest + entrypoint (lp-k7g.11.2)"
TARBALL_VALIDATOR="$ROOT/scripts/validate-backend-tarball.py"
MANIFEST_SCHEMA_FOR_TB="$ROOT/contracts/backend-runtime-v1/artifact-manifest.schema.json"

if [[ ! -f "$MANIFEST_SCHEMA_FOR_TB" ]]; then
  pass "artifact-manifest.schema.json not present yet (skip tarball check)"
elif [[ ! -f "$TARBALL_VALIDATOR" ]]; then
  fail "missing scripts/validate-backend-tarball.py (schema present)"
else
  set +e
  TARBALL_OUT="$(python3 "$TARBALL_VALIDATOR" 2>&1)"
  TARBALL_RC=$?
  set -e
  if [[ $TARBALL_RC -eq 0 ]]; then
    SUMMARY="$(echo "$TARBALL_OUT" | grep -E '^OK  ' | tail -1)"
    if [[ -z "$SUMMARY" ]]; then
      SUMMARY="backend tarball fixture validated"
    fi
    pass "$SUMMARY"
  else
    fail "validate-backend-tarball.py exited $TARBALL_RC"
    echo "$TARBALL_OUT" | sed 's/^/         /' | tail -40
  fi
fi

# ---------------------------------------------------------------------------
# 20. Brain RPC required-method conformance (lp-k7g.11.3)
# ---------------------------------------------------------------------------
echo
echo "20. Brain RPC required methods (FakeBrainRpcHost + harness)"
BRAIN_RPC_CONFORM_RUNNER="$ROOT/contracts/backend-runtime-v1/harness/run_brain_rpc_conformance.py"
BRAIN_RPC_CONFORM_HOST="$ROOT/contracts/backend-runtime-v1/harness/fake_brain_rpc.py"

if [[ ! -f "$BRAIN_RPC_CONFORM_HOST" ]]; then
  pass "FakeBrainRpcHost not present yet (skip)"
elif [[ ! -f "$BRAIN_RPC_CONFORM_RUNNER" ]]; then
  fail "missing contracts/backend-runtime-v1/harness/run_brain_rpc_conformance.py"
else
  set +e
  BRAIN_RPC_OUT="$(python3 "$BRAIN_RPC_CONFORM_RUNNER" 2>&1)"
  BRAIN_RPC_RC=$?
  set -e
  if [[ $BRAIN_RPC_RC -eq 0 ]]; then
    SUMMARY="$(echo "$BRAIN_RPC_OUT" | grep -E '^OK|^Ran ' | tail -1)"
    if [[ -z "$SUMMARY" ]]; then
      SUMMARY="Brain RPC required-method conformance"
    fi
    pass "Brain RPC required methods: $SUMMARY"
  else
    fail "Brain RPC required-method conformance exited $BRAIN_RPC_RC"
    echo "$BRAIN_RPC_OUT" | sed 's/^/         /' | tail -50
  fi
fi

# Optional: Portal FakeBrainRpcInvoker suite when node_modules already present
# (does not npm install — offline gate stays Python-first).
PORTAL_BR_PKG="$ROOT/portal/packages/backend-runtime"
if [[ -d "$PORTAL_BR_PKG/node_modules/vitest" && -f "$PORTAL_BR_PKG/test/brain-rpc-conformance.test.ts" ]]; then
  set +e
  TS_OUT="$(
    cd "$PORTAL_BR_PKG" && npx --no-install vitest run test/brain-rpc-conformance.test.ts 2>&1
  )"
  TS_RC=$?
  set -e
  if [[ $TS_RC -eq 0 ]]; then
    pass "Portal FakeBrainRpcInvoker brain-rpc-conformance (vitest)"
  else
    fail "Portal brain-rpc-conformance vitest exited $TS_RC"
    echo "$TS_OUT" | sed 's/^/         /' | tail -30
  fi
fi

# ---------------------------------------------------------------------------
# 21. Hermes-Lanyard artifact conformance job (lp-k7g.11.4)
# ---------------------------------------------------------------------------
echo
echo "21. Hermes-Lanyard artifact conformance job (offline)"
HL_CONFORM_JOB="$ROOT/scripts/run-hermes-lanyard-conformance.py"
HL_FIXTURE="$ROOT/contracts/backend-runtime-v1/fixtures/backend-conformance-fixture.tar.gz"
HL_PINS_EXAMPLE="$ROOT/compatibility/pins.example.yaml"

if [[ ! -f "$HL_CONFORM_JOB" ]]; then
  fail "missing scripts/run-hermes-lanyard-conformance.py"
elif [[ ! -f "$HL_PINS_EXAMPLE" ]]; then
  fail "missing compatibility/pins.example.yaml (Hermes-Lanyard pins)"
else
  # Offline mode only inside validate.sh (no network). Download mode is for
  # operator/CI secrets path — see .github/workflows/conformance.yml draft.
  set +e
  HL_OUT="$(python3 "$HL_CONFORM_JOB" --mode offline --root "$ROOT" 2>&1)"
  HL_RC=$?
  set -e
  if [[ $HL_RC -eq 0 ]]; then
    SUMMARY="$(echo "$HL_OUT" | grep -E '^OK  ' | tail -1)"
    if [[ -z "$SUMMARY" ]]; then
      SUMMARY="Hermes-Lanyard offline conformance job"
    fi
    pass "$SUMMARY"
  else
    fail "Hermes-Lanyard conformance job exited $HL_RC"
    echo "$HL_OUT" | sed 's/^/         /' | tail -50
  fi
  # Fixture presence is required for the stable offline path (job can rebuild,
  # but committed fixture is the CI cache-free pin substitute).
  if [[ -f "$HL_FIXTURE" ]]; then
    pass "Hermes-Lanyard offline fixture present (backend-conformance-fixture.tar.gz)"
  else
    fail "missing contracts/backend-runtime-v1/fixtures/backend-conformance-fixture.tar.gz"
  fi
fi

# ---------------------------------------------------------------------------
# 22. BackendRuntimeSecretsEnvelope schema + examples (lp-645.2)
# ---------------------------------------------------------------------------
echo
echo "22. BackendRuntimeSecretsEnvelope (contracts/backend-runtime-v1/)"
SECRETS_SCHEMA="$ROOT/contracts/backend-runtime-v1/secrets-envelope.schema.json"
SECRETS_VALIDATOR="$ROOT/scripts/validate-secrets-envelope.py"
if [[ ! -f "$SECRETS_SCHEMA" ]]; then
  pass "secrets-envelope.schema.json not present yet (skip)"
elif [[ ! -f "$SECRETS_VALIDATOR" ]]; then
  fail "missing scripts/validate-secrets-envelope.py (schema present)"
else
  set +e
  SECRETS_OUT="$(python3 "$SECRETS_VALIDATOR" --root "$ROOT" 2>&1)"
  SECRETS_RC=$?
  set -e
  if [[ $SECRETS_RC -eq 0 ]]; then
    SUMMARY="$(echo "$SECRETS_OUT" | grep -E '^OK  ' | tail -1)"
    if [[ -z "$SUMMARY" ]]; then
      SUMMARY="secrets envelope schema + examples validated"
    fi
    pass "$SUMMARY"
  else
    while IFS= read -r line; do
      [[ "$line" == *"FAIL"* ]] && fail "$line"
    done <<<"$SECRETS_OUT"
    if ! echo "$SECRETS_OUT" | grep -q FAIL; then
      fail "validate-secrets-envelope.py exited $SECRETS_RC"
      echo "$SECRETS_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 23. Materialize backend secrets host tool (lp-645.3)
# ---------------------------------------------------------------------------
echo
echo "23. Materialize backend secrets (deploy/scripts/)"
MATERIALIZE_TOOL="$ROOT/deploy/scripts/materialize-backend-secrets.py"
MATERIALIZE_SMOKE="$ROOT/deploy/scripts/smoke-materialize-backend-secrets.sh"
if [[ ! -d "$ROOT/deploy" ]]; then
  pass "deploy/ not present yet (skip materialize secrets)"
elif [[ ! -f "$MATERIALIZE_TOOL" && ! -f "$MATERIALIZE_SMOKE" ]]; then
  pass "materialize-backend-secrets not present yet (skip)"
else
  if [[ ! -f "$MATERIALIZE_TOOL" ]]; then
    fail "missing deploy/scripts/materialize-backend-secrets.py"
  else
    pass "materialize-backend-secrets.py present"
  fi
  if [[ ! -f "$MATERIALIZE_SMOKE" ]]; then
    fail "missing deploy/scripts/smoke-materialize-backend-secrets.sh"
  else
    set +e
    MATERIALIZE_OUT="$(bash "$MATERIALIZE_SMOKE" 2>&1)"
    MATERIALIZE_RC=$?
    set -e
    if [[ $MATERIALIZE_RC -eq 0 ]]; then
      pass "smoke-materialize-backend-secrets (offline)"
    else
      fail "smoke-materialize-backend-secrets exited $MATERIALIZE_RC"
      echo "$MATERIALIZE_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 24. LiteLLM multi-slot + OAuth parity (lp-645.8.5)
# ---------------------------------------------------------------------------
echo
echo "24. LiteLLM multi-slot secrets + OAuth parity (deploy/litellm/)"
LITELLM_CONFIG="$ROOT/deploy/litellm/config.yaml"
LITELLM_SMOKE="$ROOT/deploy/scripts/smoke-litellm-multi-slot.sh"
LITELLM_MAPPER="$ROOT/deploy/scripts/map-oauth-to-litellm.py"
if [[ ! -d "$ROOT/deploy" ]]; then
  pass "deploy/ not present yet (skip litellm multi-slot)"
elif [[ ! -f "$LITELLM_CONFIG" && ! -f "$LITELLM_SMOKE" && ! -f "$LITELLM_MAPPER" ]]; then
  pass "litellm multi-slot seed not present yet (skip)"
else
  if [[ ! -f "$LITELLM_CONFIG" ]]; then
    fail "missing deploy/litellm/config.yaml"
  else
    pass "deploy/litellm/config.yaml present"
  fi
  if [[ ! -f "$LITELLM_MAPPER" ]]; then
    fail "missing deploy/scripts/map-oauth-to-litellm.py"
  else
    pass "map-oauth-to-litellm.py present"
  fi
  if [[ ! -f "$LITELLM_SMOKE" ]]; then
    fail "missing deploy/scripts/smoke-litellm-multi-slot.sh"
  else
    set +e
    LITELLM_OUT="$(bash "$LITELLM_SMOKE" 2>&1)"
    LITELLM_RC=$?
    set -e
    if [[ $LITELLM_RC -eq 0 ]]; then
      pass "smoke-litellm-multi-slot (offline)"
    else
      fail "smoke-litellm-multi-slot exited $LITELLM_RC"
      echo "$LITELLM_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 25. parse_document F3 host tool reference (lp-uxy.10.4)
# ---------------------------------------------------------------------------
echo
echo "25. parse_document F3 host tool reference (local anydoc)"
PARSE_DOC_DIR="$ROOT/contracts/backend-runtime-v1/reference/tools/parse_document"
PARSE_DOC_TOOL="$PARSE_DOC_DIR/parse_document_tool.py"
PARSE_DOC_TEST="$PARSE_DOC_DIR/test_parse_document_tool.py"
PARSE_DOC_REQ="$PARSE_DOC_DIR/requirements.txt"
PARSE_DOC_DOC="$ROOT/docs/architecture/portal-parse-document-f3-host-tool.md"
PARSE_DOC_EVIDENCE="$ROOT/artifacts/ui/lp-uxy.10/f3-host-tool-local-anydoc.json"
if [[ ! -d "$PARSE_DOC_DIR" ]]; then
  pass "parse_document reference not present yet (skip)"
else
  for f in "$PARSE_DOC_TOOL" "$PARSE_DOC_TEST" "$PARSE_DOC_REQ" "$PARSE_DOC_DOC" "$PARSE_DOC_EVIDENCE"; do
    if [[ ! -f "$f" ]]; then
      fail "missing ${f#$ROOT/}"
    else
      pass "${f#$ROOT/} present"
    fi
  done
  if [[ -f "$PARSE_DOC_TEST" ]]; then
    set +e
    PARSE_DOC_OUT="$(python3 "$PARSE_DOC_TEST" 2>&1)"
    PARSE_DOC_RC=$?
    set -e
    if [[ $PARSE_DOC_RC -eq 0 ]]; then
      pass "parse_document unit tests (offline; live anydoc optional)"
    else
      fail "parse_document unit tests exited $PARSE_DOC_RC"
      echo "$PARSE_DOC_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 26. parse_document F5 scanned OCR cost-gate (lp-uxy.10.6)
# ---------------------------------------------------------------------------
echo
echo "26. parse_document F5 scanned OCR Firecrawl Parse cost-gate"
PARSE_DOC_F5_DOC="$ROOT/docs/architecture/portal-parse-document-f5-scanned-ocr.md"
PARSE_DOC_F5_EVIDENCE="$ROOT/artifacts/ui/lp-uxy.10/f5-scanned-ocr-cost-gate.json"
PARSE_DOC_F5_OCR_EXAMPLE="$ROOT/contracts/backend-runtime-v1/examples/parse-document.result.ocr.json"
for f in "$PARSE_DOC_F5_DOC" "$PARSE_DOC_F5_EVIDENCE" "$PARSE_DOC_F5_OCR_EXAMPLE" "$PARSE_DOC_TOOL"; do
  if [[ ! -f "$f" ]]; then
    fail "missing ${f#$ROOT/}"
  else
    pass "${f#$ROOT/} present"
  fi
done
if [[ -f "$PARSE_DOC_TOOL" ]]; then
  if grep -q "firecrawl_parse_upload" "$PARSE_DOC_TOOL" \
    && grep -q "is_live_firecrawl_key" "$PARSE_DOC_TOOL" \
    && grep -q "allow_ocr" "$PARSE_DOC_TOOL" \
    && grep -q "PARSER_FIRECRAWL_PARSE" "$PARSE_DOC_TOOL"; then
    pass "parse_document F5 OCR cost-gate symbols present"
  else
    fail "parse_document_tool.py missing F5 OCR cost-gate symbols"
  fi
fi
if [[ -f "$PARSE_DOC_F5_EVIDENCE" ]]; then
  if python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d.get('step')=='F5' and d.get('live_paid_ocr_in_ci') is False" \
    "$PARSE_DOC_F5_EVIDENCE" 2>/dev/null; then
    pass "f5 evidence JSON shape (step F5, no live paid OCR in CI)"
  else
    fail "f5-scanned-ocr-cost-gate.json invalid shape"
  fi
fi

# ---------------------------------------------------------------------------
# 27. parse_document F6 prove attach→parse→answer (lp-uxy.10.7)
# ---------------------------------------------------------------------------
echo
echo "27. parse_document F6 prove attach→parse→answer"
PARSE_F6_PROVE="$ROOT/contracts/backend-runtime-v1/reference/tools/parse_document/prove_parse_document_f6.py"
PARSE_F6_DOC="$ROOT/docs/architecture/portal-parse-document-f6-prove.md"
PARSE_F6_STORY="$ROOT/portal/apps/web/src/features/chat/ParseDocumentProofStory.tsx"
PARSE_F6_STORY_TEST="$ROOT/portal/apps/web/src/features/chat/ParseDocumentProofStory.test.tsx"
PARSE_F6_EVIDENCE="$ROOT/artifacts/ui/lp-uxy.10/f6-prove-attach-parse-answer.json"
if [[ ! -f "$PARSE_F6_PROVE" ]]; then
  pass "parse_document F6 prove not present yet (skip)"
else
  for f in "$PARSE_F6_PROVE" "$PARSE_F6_DOC" "$PARSE_F6_STORY" "$PARSE_F6_STORY_TEST"; do
    if [[ ! -f "$f" ]]; then
      fail "missing ${f#$ROOT/}"
    else
      pass "${f#$ROOT/} present"
    fi
  done
  set +e
  PARSE_F6_OUT="$(python3 "$PARSE_F6_PROVE" --evidence "$PARSE_F6_EVIDENCE" 2>&1)"
  PARSE_F6_RC=$?
  set -e
  if [[ $PARSE_F6_RC -eq 0 ]]; then
    pass "parse_document F6 prove harness (offline attach→parse→answer + negatives)"
  else
    fail "parse_document F6 prove harness exited $PARSE_F6_RC"
    echo "$PARSE_F6_OUT" | sed 's/^/         /'
  fi
  if [[ -f "$PARSE_F6_EVIDENCE" ]]; then
    if python3 -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get('all_passed') else 1)" "$PARSE_F6_EVIDENCE"; then
      pass "f6-prove-attach-parse-answer.json all_passed"
    else
      fail "f6-prove-attach-parse-answer.json reports failures"
    fi
  else
    fail "missing artifacts/ui/lp-uxy.10/f6-prove-attach-parse-answer.json"
  fi
  if grep -q 'parse-document' "$ROOT/portal/apps/web/src/stories/storyTree.tsx" 2>/dev/null; then
    pass "storyTree.tsx mounts ?story=parse-document"
  else
    fail "storyTree.tsx missing parse-document story route"
  fi
fi

# ---------------------------------------------------------------------------
# 28. Sandbox vault mount IAM templates (lp-t86) — offline isolation smoke
# ---------------------------------------------------------------------------
echo
echo "28. Sandbox vault mount IAM templates (lp-t86)"
VAULT_MOUNT_IAM_SMOKE="$ROOT/deploy/scripts/smoke-sandbox-vault-mount-iam.sh"
VAULT_MOUNT_IAM_DOC="$ROOT/docs/plans/0008-daytona-agent-sandboxes/iam-scoped-s3-mount-policy.md"
VAULT_MOUNT_IAM_DIR="$ROOT/docs/plans/0008-daytona-agent-sandboxes/drafts/iam"
if [[ ! -f "$VAULT_MOUNT_IAM_DOC" && ! -f "$VAULT_MOUNT_IAM_SMOKE" ]]; then
  pass "sandbox vault mount IAM templates not present yet (skip)"
else
  if [[ ! -f "$VAULT_MOUNT_IAM_SMOKE" ]]; then
    fail "missing deploy/scripts/smoke-sandbox-vault-mount-iam.sh (required with IAM design doc)"
  elif [[ ! -d "$VAULT_MOUNT_IAM_DIR" ]]; then
    fail "missing docs/plans/0008-daytona-agent-sandboxes/drafts/iam/"
  else
    set +e
    VAULT_IAM_OUT="$(bash "$VAULT_MOUNT_IAM_SMOKE" 2>&1)"
    VAULT_IAM_RC=$?
    set -e
    if [[ $VAULT_IAM_RC -eq 0 ]]; then
      pass "smoke-sandbox-vault-mount-iam (offline cross-tenant isolation)"
    else
      fail "smoke-sandbox-vault-mount-iam exited $VAULT_IAM_RC"
      echo "$VAULT_IAM_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 29. Pilot lab S3 vault bucket ensure (lp-d26) — offline doc smoke
# ---------------------------------------------------------------------------
echo
echo "29. Pilot lab S3 vault bucket ensure (lp-d26)"
PILOT_VAULT_SMOKE="$ROOT/deploy/scripts/smoke-pilot-lab-s3-vault-bucket.sh"
PILOT_VAULT_DOC="$ROOT/docs/plans/0008-daytona-agent-sandboxes/pilot-lab-s3-vault-bucket.md"
if [[ ! -f "$PILOT_VAULT_DOC" && ! -f "$PILOT_VAULT_SMOKE" ]]; then
  pass "pilot lab S3 vault ensure docs not present yet (skip)"
else
  if [[ ! -f "$PILOT_VAULT_SMOKE" ]]; then
    fail "missing deploy/scripts/smoke-pilot-lab-s3-vault-bucket.sh (required with ensure doc)"
  elif [[ ! -f "$PILOT_VAULT_DOC" ]]; then
    fail "missing docs/plans/0008-daytona-agent-sandboxes/pilot-lab-s3-vault-bucket.md"
  else
    set +e
    PILOT_VAULT_OUT="$(bash "$PILOT_VAULT_SMOKE" 2>&1)"
    PILOT_VAULT_RC=$?
    set -e
    if [[ $PILOT_VAULT_RC -eq 0 ]]; then
      pass "smoke-pilot-lab-s3-vault-bucket (offline ensure docs)"
    else
      fail "smoke-pilot-lab-s3-vault-bucket exited $PILOT_VAULT_RC"
      echo "$PILOT_VAULT_OUT" | sed 's/^/         /'
    fi
  fi
fi


# ---------------------------------------------------------------------------
# 30. Chat corpus infra (lp-gkh.3) — offline layout/IAM/lifecycle/vault-deny
# ---------------------------------------------------------------------------
echo
echo "30. Chat corpus infra (lp-gkh.3)"
CORPUS_SMOKE="$ROOT/deploy/scripts/smoke-chat-corpus-infra.sh"
CORPUS_DOC="$ROOT/docs/plans/0011-tenant-chat-corpus/infra-bucket-iam-lifecycle.md"
CORPUS_MOD="$ROOT/deploy/modules/chat-corpus-infra"
if [[ ! -f "$CORPUS_DOC" && ! -f "$CORPUS_SMOKE" && ! -d "$CORPUS_MOD" ]]; then
  pass "chat corpus infra not present yet (skip)"
else
  if [[ ! -f "$CORPUS_SMOKE" ]]; then
    fail "missing deploy/scripts/smoke-chat-corpus-infra.sh (required with corpus infra)"
  elif [[ ! -d "$CORPUS_MOD" ]]; then
    fail "missing deploy/modules/chat-corpus-infra/"
  elif [[ ! -f "$CORPUS_DOC" ]]; then
    fail "missing docs/plans/0011-tenant-chat-corpus/infra-bucket-iam-lifecycle.md"
  else
    set +e
    CORPUS_OUT="$(bash "$CORPUS_SMOKE" 2>&1)"
    CORPUS_RC=$?
    set -e
    if [[ $CORPUS_RC -eq 0 ]]; then
      pass "smoke-chat-corpus-infra (offline layout/IAM/lifecycle/vault-deny)"
    else
      fail "smoke-chat-corpus-infra exited $CORPUS_RC"
      echo "$CORPUS_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 30. ChatTurnRecord v1 schema + examples (lp-gkh.2)
# ---------------------------------------------------------------------------
echo
echo "30. ChatTurnRecord v1 (contracts/chat-corpus-v1/)"
CHAT_TURN_SCHEMA="$ROOT/contracts/chat-corpus-v1/chat-turn-record.schema.json"
CHAT_TURN_VALIDATOR="$ROOT/scripts/validate-chat-turn-record.py"
if [[ ! -f "$CHAT_TURN_SCHEMA" ]]; then
  pass "chat-turn-record.schema.json not present yet (skip)"
elif [[ ! -f "$CHAT_TURN_VALIDATOR" ]]; then
  fail "missing scripts/validate-chat-turn-record.py (schema present)"
else
  set +e
  CHAT_TURN_OUT="$(python3 "$CHAT_TURN_VALIDATOR" --root "$ROOT" 2>&1)"
  CHAT_TURN_RC=$?
  set -e
  if [[ $CHAT_TURN_RC -eq 0 ]]; then
    pass "chat-turn-record schema + examples + negatives (offline)"
  else
    while IFS= read -r line; do
      [[ "$line" == FAIL:* || "$line" == *"FAIL"* ]] && fail "$line"
    done <<<"$CHAT_TURN_OUT"
    if ! echo "$CHAT_TURN_OUT" | grep -q FAIL; then
      fail "validate-chat-turn-record.py exited $CHAT_TURN_RC"
      echo "$CHAT_TURN_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 31. Signed operation ledger domain (lp-ye4.5)
# ---------------------------------------------------------------------------
echo
echo "31. Signed operation ledger (contracts/backend-runtime-v1/signed-operation.schema.json)"
SIGNED_OP_SCHEMA="$ROOT/contracts/backend-runtime-v1/signed-operation.schema.json"
SIGNED_OP_VALIDATOR="$ROOT/scripts/validate-signed-operation.py"
if [[ ! -f "$SIGNED_OP_SCHEMA" ]]; then
  pass "signed-operation.schema.json not present yet (skip)"
elif [[ ! -f "$SIGNED_OP_VALIDATOR" ]]; then
  fail "missing scripts/validate-signed-operation.py (schema present)"
else
  set +e
  SIGNED_OP_OUT="$(python3 "$SIGNED_OP_VALIDATOR" --root "$ROOT" 2>&1)"
  SIGNED_OP_RC=$?
  set -e
  if [[ $SIGNED_OP_RC -eq 0 ]]; then
    pass "signed-operation schema + fixtures + negatives (offline)"
  else
    while IFS= read -r line; do
      [[ "$line" == FAIL:* || "$line" == *"FAIL"* ]] && fail "$line"
    done <<<"$SIGNED_OP_OUT"
    if ! echo "$SIGNED_OP_OUT" | grep -q FAIL; then
      fail "validate-signed-operation.py exited $SIGNED_OP_RC"
      echo "$SIGNED_OP_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 32. Access grants + unknown-agent identity (lp-ye4.9)
# ---------------------------------------------------------------------------
echo
echo "32. Access grants (contracts/backend-runtime-v1/access-grant.schema.json)"
ACCESS_GRANT_SCHEMA="$ROOT/contracts/backend-runtime-v1/access-grant.schema.json"
ACCESS_GRANT_VALIDATOR="$ROOT/scripts/validate-access-grant.py"
if [[ ! -f "$ACCESS_GRANT_SCHEMA" ]]; then
  pass "access-grant.schema.json not present yet (skip)"
elif [[ ! -f "$ACCESS_GRANT_VALIDATOR" ]]; then
  fail "missing scripts/validate-access-grant.py (schema present)"
else
  set +e
  ACCESS_GRANT_OUT="$(python3 "$ACCESS_GRANT_VALIDATOR" --root "$ROOT" 2>&1)"
  ACCESS_GRANT_RC=$?
  set -e
  if [[ $ACCESS_GRANT_RC -eq 0 ]]; then
    pass "access-grant schema + fixtures + negatives (offline)"
  else
    while IFS= read -r line; do
      [[ "$line" == FAIL:* || "$line" == *"FAIL"* ]] && fail "$line"
    done <<<"$ACCESS_GRANT_OUT"
    if ! echo "$ACCESS_GRANT_OUT" | grep -q FAIL; then
      fail "validate-access-grant.py exited $ACCESS_GRANT_RC"
      echo "$ACCESS_GRANT_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 33. Daytona unused-sandbox archive hygiene (lp-oop.37.7)
# ---------------------------------------------------------------------------
echo
echo "33. Daytona unused-sandbox archive hygiene (lp-oop.37.7)"
ARCHIVE_HYGIENE_SMOKE="$ROOT/deploy/scripts/smoke-archive-unused-daytona-sandboxes.sh"
ARCHIVE_HYGIENE_TOOL="$ROOT/deploy/scripts/archive-unused-daytona-sandboxes.py"
ARCHIVE_HYGIENE_DOC="$ROOT/docs/runbooks/daytona-sandbox-archive-hygiene.md"
if [[ ! -f "$ARCHIVE_HYGIENE_TOOL" && ! -f "$ARCHIVE_HYGIENE_SMOKE" && ! -f "$ARCHIVE_HYGIENE_DOC" ]]; then
  pass "unused-sandbox archive hygiene not present yet (skip)"
else
  if [[ ! -f "$ARCHIVE_HYGIENE_SMOKE" ]]; then
    fail "missing deploy/scripts/smoke-archive-unused-daytona-sandboxes.sh"
  elif [[ ! -f "$ARCHIVE_HYGIENE_TOOL" ]]; then
    fail "missing deploy/scripts/archive-unused-daytona-sandboxes.py"
  elif [[ ! -f "$ARCHIVE_HYGIENE_DOC" ]]; then
    fail "missing docs/runbooks/daytona-sandbox-archive-hygiene.md"
  else
    set +e
    ARCHIVE_HYGIENE_OUT="$(bash "$ARCHIVE_HYGIENE_SMOKE" 2>&1)"
    ARCHIVE_HYGIENE_RC=$?
    set -e
    if [[ $ARCHIVE_HYGIENE_RC -eq 0 ]]; then
      pass "smoke-archive-unused-daytona-sandboxes (offline keep-set + dry-run)"
    else
      fail "smoke-archive-unused-daytona-sandboxes exited $ARCHIVE_HYGIENE_RC"
      echo "$ARCHIVE_HYGIENE_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 34. Connectors v1 catalog (lp-xhf4.1)
# ---------------------------------------------------------------------------
echo
echo "34. Connectors v1 (contracts/connectors-v1/)"
CONNECTORS_SCHEMA="$ROOT/contracts/connectors-v1/catalog.schema.json"
CONNECTORS_VALIDATOR="$ROOT/scripts/validate-connectors-catalog.py"
if [[ ! -f "$CONNECTORS_SCHEMA" ]]; then
  pass "connectors catalog.schema.json not present yet (skip)"
elif [[ ! -f "$CONNECTORS_VALIDATOR" ]]; then
  fail "missing scripts/validate-connectors-catalog.py (schema present)"
else
  set +e
  CONNECTORS_OUT="$(python3 "$CONNECTORS_VALIDATOR" --root "$ROOT" 2>&1)"
  CONNECTORS_RC=$?
  set -e
  if [[ $CONNECTORS_RC -eq 0 ]]; then
    pass "connectors catalog enums + command_map + negatives (offline)"
  else
    while IFS= read -r line; do
      [[ "$line" == FAIL:* || "$line" == *"FAIL"* ]] && fail "$line"
    done <<<"$CONNECTORS_OUT"
    if ! echo "$CONNECTORS_OUT" | grep -q FAIL; then
      fail "validate-connectors-catalog.py exited $CONNECTORS_RC"
      echo "$CONNECTORS_OUT" | sed 's/^/         /'
    fi
  fi
fi


# ---------------------------------------------------------------------------
# 35. Harness MemPalace placement (lp-oop.38.13)
# ---------------------------------------------------------------------------
echo
echo "35. Harness MemPalace placement (lp-oop.38.13)"
MEMPALACE_SMOKE="$ROOT/deploy/scripts/smoke-harness-mempalace-placement.sh"
MEMPALACE_DOC="$ROOT/docs/architecture/short-stack-tool-placement.md"
if [[ ! -f "$MEMPALACE_SMOKE" && ! -f "$MEMPALACE_DOC" ]]; then
  pass "harness mempalace placement not present yet (skip)"
else
  if [[ ! -f "$MEMPALACE_SMOKE" ]]; then
    fail "missing deploy/scripts/smoke-harness-mempalace-placement.sh"
  elif [[ ! -f "$MEMPALACE_DOC" ]]; then
    fail "missing docs/architecture/short-stack-tool-placement.md"
  else
    set +e
    MEMPALACE_OUT="$(bash "$MEMPALACE_SMOKE" 2>&1)"
    MEMPALACE_RC=$?
    set -e
    if [[ $MEMPALACE_RC -eq 0 ]]; then
      pass "smoke-harness-mempalace-placement (toolbox CLI, vault palace, write_policy)"
    else
      fail "smoke-harness-mempalace-placement exited $MEMPALACE_RC"
      echo "$MEMPALACE_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 36. Harness exec IAM (lp-oop.38.20)
# ---------------------------------------------------------------------------
echo
echo "36. Harness exec IAM (lp-oop.38.20)"
HARNESS_EXEC_SMOKE="$ROOT/deploy/scripts/smoke-harness-exec-iam.sh"
HARNESS_EXEC_MOD="$ROOT/deploy/modules/harness-exec-iam"
if [[ ! -d "$HARNESS_EXEC_MOD" && ! -f "$HARNESS_EXEC_SMOKE" ]]; then
  pass "harness exec IAM not present yet (skip)"
else
  if [[ ! -f "$HARNESS_EXEC_SMOKE" ]]; then
    fail "missing deploy/scripts/smoke-harness-exec-iam.sh"
  elif [[ ! -d "$HARNESS_EXEC_MOD" ]]; then
    fail "missing deploy/modules/harness-exec-iam/"
  else
    set +e
    HARNESS_EXEC_OUT="$(bash "$HARNESS_EXEC_SMOKE" 2>&1)"
    HARNESS_EXEC_RC=$?
    set -e
    if [[ $HARNESS_EXEC_RC -eq 0 ]]; then
      pass "smoke-harness-exec-iam (GetSecretValue catalog + task secrets[] + BFF extra ARNs)"
    else
      fail "smoke-harness-exec-iam exited $HARNESS_EXEC_RC"
      echo "$HARNESS_EXEC_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 38. Admin instructional copy (lp-hdzm.2)
# ---------------------------------------------------------------------------
echo
echo "38. Admin instructional copy (lp-hdzm.2)"
ADMIN_COPY_LINT="$ROOT/scripts/lint-admin-instructional-copy.py"
ADMIN_FEATURES="$ROOT/portal/apps/web/src/features/admin"
if [[ ! -f "$ADMIN_COPY_LINT" ]]; then
  fail "missing scripts/lint-admin-instructional-copy.py"
elif [[ ! -d "$ADMIN_FEATURES" ]]; then
  set +e
  ADMIN_COPY_OUT="$(python3 "$ADMIN_COPY_LINT" --root "$ROOT" --self-test 2>&1)"
  ADMIN_COPY_RC=$?
  set -e
  if [[ $ADMIN_COPY_RC -eq 0 ]]; then
    pass "admin copy lint self-test (admin features not present yet)"
  else
    fail "admin copy lint self-test exited $ADMIN_COPY_RC"
    echo "$ADMIN_COPY_OUT" | sed 's/^/         /'
  fi
else
  set +e
  ADMIN_COPY_OUT="$(python3 "$ADMIN_COPY_LINT" --root "$ROOT" 2>&1)"
  ADMIN_COPY_RC=$?
  set -e
  if [[ $ADMIN_COPY_RC -eq 0 ]]; then
    pass "admin instructional copy lint (self-test + scan)"
  else
    fail "admin instructional copy lint exited $ADMIN_COPY_RC"
    echo "$ADMIN_COPY_OUT" | sed 's/^/         /'
  fi
fi

# ---------------------------------------------------------------------------
# 39. Local Muse Spark LiteLLM provider (lp-k5c4.17)
# ---------------------------------------------------------------------------
echo
echo "39. Local Muse Spark LiteLLM provider (lp-k5c4.17)"
MUSE_SPARK_SMOKE="$ROOT/deploy/scripts/smoke-localhost-muse-spark-provider.sh"
MUSE_SPARK_DIR="$ROOT/deploy/dev/localhost-muse-spark"
if [[ ! -d "$ROOT/deploy" ]]; then
  pass "deploy/ not present yet (skip muse-spark provider)"
elif [[ ! -d "$MUSE_SPARK_DIR" && ! -f "$MUSE_SPARK_SMOKE" ]]; then
  pass "localhost Muse Spark seed not present yet (skip)"
else
  if [[ ! -f "$MUSE_SPARK_SMOKE" ]]; then
    fail "missing deploy/scripts/smoke-localhost-muse-spark-provider.sh"
  elif [[ ! -d "$MUSE_SPARK_DIR" ]]; then
    fail "missing deploy/dev/localhost-muse-spark/"
  else
    set +e
    MUSE_SPARK_OUT="$(bash "$MUSE_SPARK_SMOKE" 2>&1)"
    MUSE_SPARK_RC=$?
    set -e
    if [[ $MUSE_SPARK_RC -eq 0 ]]; then
      pass "smoke-localhost-muse-spark-provider (offline LiteLLM contract)"
    else
      fail "smoke-localhost-muse-spark-provider exited $MUSE_SPARK_RC"
      echo "$MUSE_SPARK_OUT" | sed 's/^/         /'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
if [[ $FAILED -eq 0 ]]; then
  echo "OK  $CHECKS_RUN check(s) passed (offline, no network)."
  exit 0
else
  echo "FAILED  $FAILED failure(s) across $CHECKS_RUN check(s)."
  exit 1
fi
