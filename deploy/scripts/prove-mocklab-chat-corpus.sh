#!/usr/bin/env bash
# lp-gkh.9 — Live proof: MockLab chat produces corpus objects with full I/O.
#
# Offline-by-default (no AWS apply required).
# Runs the in-process mocklab chat→corpus vitest and validates evidence JSON.
#
# Usage (from monorepo root):
#   bash deploy/scripts/prove-mocklab-chat-corpus.sh
#
# Evidence:
#   artifacts/mocklab/lp-gkh.9/live-proof-evidence-latest.json
#   artifacts/mocklab/lp-gkh.9/live-proof-evidence-<stamp>.json
#
# Optional live host path (operator):
#   Configure BFF with:
#     CHAT_CORPUS_BUCKET=lanyard-chat-corpus-lab
#     CHAT_CORPUS_FS_ROOT=/var/lib/lanyard/chat-corpus   # durable across restart
#   Enable tenant: PATCH /internal/tenants/:id/retention chat_corpus_enabled=true
#   (requires INTERNAL_OPS_TOKEN on CP). Then send a chat and assert object under
#   {FS_ROOT}/{bucket}/tenants/{tid}/chat-corpus/v1/...
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVIDENCE_DIR="${EVIDENCE_DIR:-$ROOT/artifacts/mocklab/lp-gkh.9}"
mkdir -p "$EVIDENCE_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$EVIDENCE_DIR/prove-${STAMP}.log"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

exec > >(tee -a "$LOG") 2>&1

echo "== lp-gkh.9 prove-mocklab-chat-corpus =="
echo "ROOT=$ROOT"
echo "STAMP=$STAMP"
echo "EVIDENCE_DIR=$EVIDENCE_DIR"

# G4.1: CP integration tests need Postgres (lab compose default; never commit secrets).
export CONTROL_PLANE_DATABASE_URL="${CONTROL_PLANE_DATABASE_URL:-${DATABASE_URL:-postgres://portal:portal@127.0.0.1:5432/portal_cp}}"
export DATABASE_URL="${DATABASE_URL:-$CONTROL_PLANE_DATABASE_URL}"
echo "CONTROL_PLANE_DATABASE_URL set (lab default if unset)"

# --- Unit: FsCorpusObjectStore restart durability ---
if [[ ! -d "$ROOT/portal/packages/chat-corpus" ]]; then
  fail "missing portal/packages/chat-corpus"
fi

echo "-- chat-corpus unit (fs store) --"
(
  cd "$ROOT/portal"
  if ! command -v pnpm >/dev/null 2>&1; then
    fail "pnpm required"
  fi
  # Ensure package dist exists for BFF imports (@lanyard/chat-corpus main=dist).
  if [[ ! -f packages/chat-corpus/dist/index.js ]]; then
    pnpm --filter @lanyard/chat-corpus build
  fi
  if [[ ! -f packages/shared/dist/index.js ]]; then
    pnpm --filter @lanyard/shared build
  fi
  pnpm --filter @lanyard/chat-corpus exec vitest run test/fs-object-store.test.ts
)
pass "FsCorpusObjectStore unit"

echo "-- bff corpus factory unit --"
(
  cd "$ROOT/portal"
  pnpm --filter @lanyard/bff exec vitest run test/corpus-writer-factory.test.ts
)
pass "corpus-writer-factory unit"

echo "-- bff live-proof integration (mocklab tenant + restart) --"
(
  cd "$ROOT/portal"
  # PG integration store may need DATABASE_URL; createTestStore handles local/sqlite-or-pg.
  pnpm --filter @lanyard/bff exec vitest run test/chat-corpus-live-proof.test.ts
)
pass "chat-corpus-live-proof integration"

LATEST="$EVIDENCE_DIR/live-proof-evidence-latest.json"
[[ -f "$LATEST" ]] || fail "missing evidence $LATEST"

python3 - "$LATEST" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
assert data.get("bead_id") == "lp-gkh.9", data.get("bead_id")
assert data.get("result") == "PASS", data.get("result")
assert data.get("object_key"), "object_key required"
assert "/chat-corpus/v1/" in data["object_key"], data["object_key"]
shape = data.get("record_shape_redacted") or {}
assert shape.get("input", {}).get("role") == "user"
assert shape.get("output", {}).get("role") == "assistant"
assert shape.get("input", {}).get("content_redacted") is True
assert shape.get("output", {}).get("content_redacted") is True
assert shape.get("input", {}).get("content_probe_match") is True
assert shape.get("output", {}).get("content_probe_match") is True
checks = data.get("checks") or {}
for k in (
    "enablement.chat_corpus_enabled",
    "corpus.object_exists",
    "corpus.user_content_present",
    "corpus.assistant_content_present",
    "bff_restart.object_still_present",
):
    assert checks.get(k) is True, f"check failed: {k}"
assert data.get("bff_restart", {}).get("object_present") is True
print("evidence schema OK:", path)
print("object_key:", data["object_key"])
PY
pass "evidence validated (object key + redacted shape + restart)"

# Honesty: no secret material patterns in evidence
if grep -Eiq 'lanyard_session=[A-Za-z0-9]{16,}|password|INTERNAL_OPS|AKIA[0-9A-Z]{16}' "$LATEST"; then
  fail "evidence appears to contain secret material"
fi
pass "no obvious secrets in evidence"

echo "prove-mocklab-chat-corpus: PASS"
echo "Evidence: $LATEST"
