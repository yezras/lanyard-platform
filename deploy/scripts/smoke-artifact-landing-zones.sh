#!/usr/bin/env bash
# Offline guardrails for multi-backend artifact landing zones + OIDC publisher
# trust docs/stubs (lp-k7g.7.6). No AWS credentials, no network, no terraform apply.
#
# Validates:
#   - design doc documents backends/<kind-slug>/ strategy
#   - Hermes-Lanyard publisher trust (tags + dual-write) is documented
#   - Lanyard Agent publisher path is documented
#   - client-core/ and portal-web/ remain unchanged (not under backends/)
#   - deploy stubs present with matching markers
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DOC="$ROOT/docs/architecture/deploy-artifact-landing-zones.md"
POINTER="$ROOT/deploy/docs/artifact-landing-zones.md"
MOD="$ROOT/deploy/modules/product-artifact-infra"
PREFIXES="$MOD/artifact_prefixes.tf.example"
PUBLISHERS="$MOD/publisher_repos.tf.example"
OUTPUTS="$MOD/outputs_landing_zones.tf.example"
TFVARS="$MOD/terraform.tfvars.landing_zones.example"
MOD_README="$MOD/README.md"

err() { echo "[smoke-artifact-landing-zones] ERROR: $*" >&2; }
log() { echo "[smoke-artifact-landing-zones] $*"; }
fail() { err "$*"; exit 1; }
pass() { log "OK: $*"; }

need_file() {
  [ -f "$1" ] || fail "missing required file: $1"
}

need_file "$DOC"
need_file "$POINTER"
need_file "$PREFIXES"
need_file "$PUBLISHERS"
need_file "$OUTPUTS"
need_file "$TFVARS"
need_file "$MOD_README"

# --- 1. Backend prefix strategy ---
for needle in \
  "backends/hermes-lanyard/" \
  "backends/lanyard-agent/" \
  "backends/<kind-slug>" \
  "hermes_lanyard" \
  "lanyard_agent"
do
  grep -Fq "$needle" "$DOC" || fail "design doc missing backend strategy marker: $needle"
done
pass "backend artifact prefix strategy documented (backends/<kind-slug>/)"

# --- 2. Hermes-Lanyard publisher trust still works ---
for needle in \
  "repo:LanyardBrain/hermes-lanyard:ref:refs/tags/*" \
  "Hermes-Lanyard" \
  "dual-write" \
  "hermes/"
do
  grep -Fq "$needle" "$DOC" || fail "design doc missing Hermes-Lanyard trust marker: $needle"
done
# Must not default OIDC trust to main/master branch heads in design or stubs
if grep -REn 'ref:refs/heads/(main|master)' "$DOC" "$PUBLISHERS" "$TFVARS" >/dev/null 2>&1; then
  fail "landing-zone docs/stubs must not default OIDC trust to refs/heads/main or master"
fi
pass "Hermes-Lanyard publisher trust (tag OIDC + dual-write hermes/) documented"

# --- 3. Lanyard Agent publisher path ---
for needle in \
  "repo:LanyardBrain/lanyard-agent:ref:refs/tags/*" \
  "backends/lanyard-agent/" \
  "lanyard_agent"
do
  grep -Fq "$needle" "$DOC" || fail "design doc missing Lanyard Agent publisher marker: $needle"
done
grep -Fq "lanyard_agent" "$PUBLISHERS" || fail "publisher stub missing lanyard_agent"
grep -Fq "backends/lanyard-agent/" "$PREFIXES" || fail "prefix stub missing backends/lanyard-agent/"
pass "Lanyard Agent publisher path documented (role + backends/lanyard-agent/)"

# --- 4. client-core and portal prefixes unchanged ---
for needle in \
  "client-core/" \
  "portal-web/" \
  "UNCHANGED"
do
  grep -Fq "$needle" "$DOC" || fail "design doc missing unchanged non-backend marker: $needle"
done
# Must not nest client-core or portal-web under backends/
if grep -E 'backends/(client-core|portal-web)/' "$DOC" "$PREFIXES" "$TFVARS" >/dev/null 2>&1; then
  fail "client-core/ and portal-web/ must not be nested under backends/"
fi
grep -Fq 'client_core     = "client-core/"' "$PREFIXES" \
  || grep -Fq 'client_core = "client-core/"' "$PREFIXES" \
  || grep -Fq 'client_core     = "client-core/"' "$TFVARS" \
  || fail "stubs must keep client_core prefix as client-core/"
grep -Fq 'portal_web' "$PREFIXES" || fail "prefix stub missing portal_web"
grep -Fq 'portal-web/' "$PREFIXES" || fail "prefix stub missing portal-web/ string"
pass "client-core/ and portal-web/ remain top-level unchanged prefixes"

# --- 5. Stubs cross-check ---
grep -Fq "backends/hermes-lanyard/" "$TFVARS" || fail "tfvars example missing backends/hermes-lanyard/"
grep -Fq "backends/lanyard-agent/" "$TFVARS" || fail "tfvars example missing backends/lanyard-agent/"
grep -Fq "hermes_lanyard_artifact_url_template" "$OUTPUTS" \
  || fail "outputs stub missing hermes_lanyard_artifact_url_template"
grep -Fq "lanyard_agent_artifact_url_template" "$OUTPUTS" \
  || fail "outputs stub missing lanyard_agent_artifact_url_template"
grep -Fq "client_core_artifact_url_template" "$OUTPUTS" \
  || fail "outputs stub missing unchanged client_core template"
grep -Fq "portal_web_artifact_url_template" "$OUTPUTS" \
  || fail "outputs stub missing unchanged portal_web template"
grep -Fq "product-artifact-infra" "$MOD_README" || fail "module README missing product-artifact-infra"
grep -Fq "deploy-artifact-landing-zones.md" "$POINTER" || fail "deploy pointer must link canonical design"

# Pins example in monorepo already prefers backends/ shape
PINS="$ROOT/compatibility/pins.example.yaml"
if [ -f "$PINS" ]; then
  grep -Fq "backends/hermes-lanyard/" "$PINS" \
    || fail "compatibility/pins.example.yaml should illustrate backends/hermes-lanyard/ URL"
  grep -Fq "linux-x86_64" "$PINS" \
    || fail "compatibility/pins.example.yaml should illustrate linux-x86_64 arch-labeled URL / arch field"
  grep -Fq "client-core/" "$PINS" || fail "pins.example.yaml missing client-core/ URL"
  grep -Fq "portal-web/" "$PINS" || fail "pins.example.yaml missing portal-web/ URL"
  pass "compatibility pins.example.yaml aligns with backends/ + arch labels + unchanged client-core/portal-web"
fi

# Arch-labeled backend contract (lp-2md.4)
for needle in \
  "linux-x86_64" \
  "backend.arch" \
  "backend_artifact_arch"
do
  grep -Fq "$needle" "$DOC" || fail "design doc missing arch pin marker: $needle"
done
grep -Fq "linux-x86_64" "$OUTPUTS" \
  || fail "outputs stub should document default linux-x86_64 arch segment"
grep -Fq "linux-x86_64" "$TFVARS" \
  || fail "landing-zone tfvars example should show linux-x86_64 pin URL"
pass "arch-labeled backend pin contract documented (linux-x86_64 default)"

pass "all landing-zone offline contract checks passed"
exit 0
