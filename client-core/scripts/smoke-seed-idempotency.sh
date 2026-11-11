#!/usr/bin/env bash
# Offline smoke for client-core vault seed idempotency (lp-k7g.9.5).
#
# Simulates company-brain-deploy bootstrap seed from a pack-release artifact
# (or the monorepo client-core tree) and proves:
#   1. First-run empty vault gets AGENTS.md + expected seed files
#   2. Pre-existing AGENTS.md is not overwritten
#   3. Second seed is idempotent (no destructive changes to live content)
#
# Usage (from monorepo root or anywhere):
#   bash client-core/scripts/smoke-seed-idempotency.sh
#
# Exit 0 on success; non-zero on failure. No network.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SEED_VAULT="$SCRIPT_DIR/seed-vault.sh"
PACK_RELEASE="$SCRIPT_DIR/pack-release.sh"

if git -C "$PRODUCT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_ROOT="$(git -C "$PRODUCT_ROOT" rev-parse --show-toplevel)"
else
  GIT_ROOT="$PRODUCT_ROOT"
fi

VERSION_LABEL="v0.0.0-smoke-lp-k7g.9.5"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/cc-seed-smoke.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*" >&2; exit 1; }

fingerprint_tree() {
  # Stable fingerprint of a vault tree (paths + sha256 of files).
  # Excludes nothing under vault — seed must not change anything on re-run.
  local root="$1"
  (
    cd "$root"
    # Paths only for empty dirs; content hash for files
    find . -print0 | sort -z | while IFS= read -r -d '' p; do
      if [ -f "$p" ]; then
        if command -v sha256sum >/dev/null 2>&1; then
          h="$(sha256sum "$p" | awk '{print $1}')"
        else
          h="$(shasum -a 256 "$p" | awk '{print $1}')"
        fi
        printf 'F %s %s\n' "$h" "$p"
      elif [ -d "$p" ]; then
        printf 'D %s\n' "$p"
      else
        printf 'O %s\n' "$p"
      fi
    done
  )
}

[ -f "$SEED_VAULT" ] || fail "missing seed-vault.sh at $SEED_VAULT"
[ -f "$PRODUCT_ROOT/AGENTS.md" ] || fail "missing seed AGENTS.md at $PRODUCT_ROOT/AGENTS.md"
[ -x "$SEED_VAULT" ] || chmod +x "$SEED_VAULT"

echo "smoke-seed-idempotency: WORK=$WORK VERSION=$VERSION_LABEL"

# ---------------------------------------------------------------------------
# Build artifact via pack-release (preferred) or fall back to --source tree
# ---------------------------------------------------------------------------
TARBALL=""
SHA_HEX=""
URL=""
if [ -f "$PACK_RELEASE" ]; then
  OUT_DIR="$WORK/dist"
  mkdir -p "$OUT_DIR"
  set +e
  PACK_OUT="$(
    OUT_DIR="$OUT_DIR" \
    ARTIFACT_BUCKET="example-artifacts-bucket" \
    bash "$PACK_RELEASE" --dry-run "$VERSION_LABEL" 2>&1
  )"
  PACK_RC=$?
  set -e
  if [ "$PACK_RC" -ne 0 ]; then
    echo "$PACK_OUT" | sed 's/^/         /' >&2
    fail "pack-release.sh --dry-run exited $PACK_RC"
  fi
  TARBALL="$OUT_DIR/client-core-${VERSION_LABEL}.tar.gz"
  [ -s "$TARBALL" ] || fail "missing tarball from pack-release: $TARBALL"
  if command -v sha256sum >/dev/null 2>&1; then
    SHA_HEX="$(sha256sum "$TARBALL" | awk '{print $1}')"
  else
    SHA_HEX="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
  fi
  URL="s3://example-artifacts-bucket/client-core/${VERSION_LABEL}/client-core-${VERSION_LABEL}.tar.gz"
  pass "built seed artifact via pack-release ($VERSION_LABEL)"
else
  pass "pack-release.sh absent — will seed from product tree"
fi

# Expected always-on seed markers (folder spine from AGENTS.md / index.yaml)
EXPECTED_FILES=(
  AGENTS.md
  INDEX.md
  index.yaml
  mempalace.yaml
  Clients/INDEX.md
  Clients/AGENTS.md
  Clients/schema.sql
  agents/vault-writer.md
  agents/researcher.md
  templates/clients/AGENTS.md.template
  packs
  skills
  Knowledge
  Projects
  memory
  staging/uploads
  .seed/README.md
)

assert_expected_seed() {
  local vault="$1" f
  for f in "${EXPECTED_FILES[@]}"; do
    if [ ! -e "$vault/$f" ]; then
      fail "first-run vault missing expected seed path: $f"
    fi
  done
}

# ===========================================================================
# 1) First-run: empty vault gets AGENTS.md + expected seed files
# ===========================================================================
VAULT1="$WORK/vault-first-run"
mkdir -p "$VAULT1"
# Empty (only the directory itself)
[ -z "$(find "$VAULT1" -mindepth 1 -maxdepth 1 2>/dev/null | head -1)" ] \
  || fail "vault1 not empty before seed"

set +e
if [ -n "$TARBALL" ]; then
  SEED1_OUT="$(
    bash "$SEED_VAULT" \
      --vault "$VAULT1" \
      --tarball "$TARBALL" \
      --version "$VERSION_LABEL" \
      --url "$URL" \
      --sha256 "$SHA_HEX" 2>&1
  )"
else
  SEED1_OUT="$(
    bash "$SEED_VAULT" \
      --vault "$VAULT1" \
      --source "$PRODUCT_ROOT" \
      --version "$VERSION_LABEL" 2>&1
  )"
fi
SEED1_RC=$?
set -e
if [ "$SEED1_RC" -ne 0 ]; then
  echo "$SEED1_OUT" | sed 's/^/         /' >&2
  fail "first-run seed-vault exited $SEED1_RC"
fi
echo "$SEED1_OUT" | grep -q "result=seeded" \
  || fail "first-run expected result=seeded; got: $SEED1_OUT"

assert_expected_seed "$VAULT1"
[ -f "$VAULT1/.seed/provenance.json" ] || fail "missing .seed/provenance.json after first-run"

# Provenance shape
python3 - "$VAULT1/.seed/provenance.json" "$VERSION_LABEL" <<'PY' || fail "provenance.json invalid"
import json, sys
path, ver = sys.argv[1], sys.argv[2]
d = json.load(open(path, encoding="utf-8"))
assert d.get("product") == "client_core", d
assert d.get("seed_gate") == "AGENTS.md", d
assert d.get("version") == ver, d
assert d.get("vault_root"), d
assert "installed_at" in d
print("ok")
PY
pass "first-run seed installs AGENTS.md + expected seed files + provenance"

# Snapshot for idempotency check
FP1="$WORK/fp-first.txt"
fingerprint_tree "$VAULT1" >"$FP1"
AGENTS_HASH1="$(
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$VAULT1/AGENTS.md" | awk '{print $1}'
  else
    shasum -a 256 "$VAULT1/AGENTS.md" | awk '{print $1}'
  fi
)"

# ===========================================================================
# 2) Re-run on seeded vault: idempotent, no destructive changes
# ===========================================================================
# Mutate the live vault slightly (operator content) — seed must not touch it
echo "operator-live-note-$(date +%s)" >"$VAULT1/LIVE_OPERATOR_NOTE.md"
mkdir -p "$VAULT1/Knowledge/CustomDept"
echo "# live knowledge" >"$VAULT1/Knowledge/CustomDept/note.md"
# Also tweak AGENTS.md as a live vault would after Discover
cp "$VAULT1/AGENTS.md" "$WORK/agents-before-rerun.md"
echo "" >>"$VAULT1/AGENTS.md"
echo "<!-- live customer edit after Discover -->" >>"$VAULT1/AGENTS.md"
LIVE_AGENTS_HASH="$(
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$VAULT1/AGENTS.md" | awk '{print $1}'
  else
    shasum -a 256 "$VAULT1/AGENTS.md" | awk '{print $1}'
  fi
)"
[ "$LIVE_AGENTS_HASH" != "$AGENTS_HASH1" ] || fail "test setup: live AGENTS.md should differ from seed"

FP_BEFORE_RERUN="$WORK/fp-before-rerun.txt"
fingerprint_tree "$VAULT1" >"$FP_BEFORE_RERUN"

set +e
if [ -n "$TARBALL" ]; then
  SEED2_OUT="$(
    bash "$SEED_VAULT" \
      --vault "$VAULT1" \
      --tarball "$TARBALL" \
      --version "$VERSION_LABEL" \
      --url "$URL" \
      --sha256 "$SHA_HEX" 2>&1
  )"
else
  SEED2_OUT="$(
    bash "$SEED_VAULT" \
      --vault "$VAULT1" \
      --source "$PRODUCT_ROOT" \
      --version "$VERSION_LABEL" 2>&1
  )"
fi
SEED2_RC=$?
set -e
if [ "$SEED2_RC" -ne 0 ]; then
  echo "$SEED2_OUT" | sed 's/^/         /' >&2
  fail "re-run seed-vault exited $SEED2_RC"
fi
echo "$SEED2_OUT" | grep -q "result=skipped" \
  || fail "re-run expected result=skipped (AGENTS.md gate); got: $SEED2_OUT"
echo "$SEED2_OUT" | grep -qi "preserve live vault\|agents_md_present\|AGENTS.md present" \
  || fail "re-run should mention live-vault preserve; got: $SEED2_OUT"

FP_AFTER_RERUN="$WORK/fp-after-rerun.txt"
fingerprint_tree "$VAULT1" >"$FP_AFTER_RERUN"
if ! cmp -s "$FP_BEFORE_RERUN" "$FP_AFTER_RERUN"; then
  echo "--- before rerun ---" >&2
  cat "$FP_BEFORE_RERUN" >&2
  echo "--- after rerun ---" >&2
  cat "$FP_AFTER_RERUN" >&2
  fail "re-run changed vault contents (not idempotent)"
fi

AFTER_AGENTS_HASH="$(
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$VAULT1/AGENTS.md" | awk '{print $1}'
  else
    shasum -a 256 "$VAULT1/AGENTS.md" | awk '{print $1}'
  fi
)"
[ "$AFTER_AGENTS_HASH" = "$LIVE_AGENTS_HASH" ] \
  || fail "re-run overwrote live AGENTS.md"
[ -f "$VAULT1/LIVE_OPERATOR_NOTE.md" ] || fail "re-run destroyed LIVE_OPERATOR_NOTE.md"
[ -f "$VAULT1/Knowledge/CustomDept/note.md" ] || fail "re-run destroyed live Knowledge content"
pass "rerun produces no destructive changes (idempotent skip)"

# ===========================================================================
# 3) Pre-existing AGENTS.md prevents overwrite (empty-ish live vault)
# ===========================================================================
VAULT2="$WORK/vault-preexisting-agents"
mkdir -p "$VAULT2"
MARKER="lp-k7g.9.5-preserve-$(date +%s)"
cat >"$VAULT2/AGENTS.md" <<EOF
# CUSTOM LIVE AGENTS — do not overwrite
This vault was hand-bootstrapped / migrated.
marker=${MARKER}
EOF
echo "preexisting-sidecar" >"$VAULT2/sidecar.txt"
AGENTS_BEFORE="$WORK/agents-preexisting-before.md"
cp "$VAULT2/AGENTS.md" "$AGENTS_BEFORE"
# Intentionally missing INDEX.md / packs — seed must NOT fill them when
# AGENTS.md exists (gate skips entire extract).

set +e
if [ -n "$TARBALL" ]; then
  SEED3_OUT="$(
    bash "$SEED_VAULT" \
      --vault "$VAULT2" \
      --tarball "$TARBALL" \
      --version "$VERSION_LABEL" \
      --url "$URL" \
      --sha256 "$SHA_HEX" 2>&1
  )"
else
  SEED3_OUT="$(
    bash "$SEED_VAULT" \
      --vault "$VAULT2" \
      --source "$PRODUCT_ROOT" \
      --version "$VERSION_LABEL" 2>&1
  )"
fi
SEED3_RC=$?
set -e
if [ "$SEED3_RC" -ne 0 ]; then
  echo "$SEED3_OUT" | sed 's/^/         /' >&2
  fail "preexisting-AGENTS seed-vault exited $SEED3_RC"
fi
echo "$SEED3_OUT" | grep -q "result=skipped" \
  || fail "preexisting AGENTS.md expected result=skipped; got: $SEED3_OUT"

cmp -s "$AGENTS_BEFORE" "$VAULT2/AGENTS.md" \
  || fail "existing AGENTS.md was overwritten"
grep -Fq "marker=${MARKER}" "$VAULT2/AGENTS.md" \
  || fail "existing AGENTS.md lost custom marker"
[ -f "$VAULT2/sidecar.txt" ] || fail "sidecar.txt destroyed"
# Must not have extracted seed content on top of the live gate
if [ -f "$VAULT2/INDEX.md" ]; then
  fail "seed extracted INDEX.md despite existing AGENTS.md (gate failed)"
fi
if [ -d "$VAULT2/packs" ]; then
  fail "seed extracted packs/ despite existing AGENTS.md (gate failed)"
fi
pass "existing AGENTS.md prevents overwrite (full seed skip)"

# ===========================================================================
# 4) Tree-source path also honors the gate (when we used a tarball above)
# ===========================================================================
if [ -n "$TARBALL" ]; then
  VAULT3="$WORK/vault-from-tree"
  mkdir -p "$VAULT3"
  set +e
  SEED4_OUT="$(
    bash "$SEED_VAULT" \
      --vault "$VAULT3" \
      --source "$PRODUCT_ROOT" \
      --version "tree-$VERSION_LABEL" 2>&1
  )"
  SEED4_RC=$?
  set -e
  if [ "$SEED4_RC" -ne 0 ]; then
    echo "$SEED4_OUT" | sed 's/^/         /' >&2
    fail "tree-source first-run exited $SEED4_RC"
  fi
  echo "$SEED4_OUT" | grep -q "result=seeded" || fail "tree-source expected seeded"
  [ -f "$VAULT3/AGENTS.md" ] || fail "tree-source missing AGENTS.md"
  assert_expected_seed "$VAULT3"

  set +e
  SEED5_OUT="$(
    bash "$SEED_VAULT" \
      --vault "$VAULT3" \
      --source "$PRODUCT_ROOT" \
      --version "tree-$VERSION_LABEL" 2>&1
  )"
  SEED5_RC=$?
  set -e
  [ "$SEED5_RC" -eq 0 ] || fail "tree-source re-run exited $SEED5_RC"
  echo "$SEED5_OUT" | grep -q "result=skipped" \
    || fail "tree-source re-run expected skipped"
  pass "tree-source seed also first-runs and skips on AGENTS.md"
else
  pass "tree-source dual-path covered via primary --source runs"
fi

echo "OK  smoke-seed-idempotency (offline) version=${VERSION_LABEL}"
