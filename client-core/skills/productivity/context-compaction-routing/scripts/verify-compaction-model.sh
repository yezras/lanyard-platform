#!/usr/bin/env bash
# Verify a `hermes chat -q` compaction sub-agent call actually ran on the
# model it was pinned to, rather than trusting the echoed -m/--provider flags.
#
# Usage: verify-compaction-model.sh <session_id> <expected_model>
# Example: verify-compaction-model.sh 20260702_170943_712134 deepseek/deepseek-v4-flash

set -euo pipefail

SESSION_ID="${1:?Usage: verify-compaction-model.sh <session_id> <expected_model>}"
EXPECTED_MODEL="${2:?Usage: verify-compaction-model.sh <session_id> <expected_model>}"

TMP_FILE="$(mktemp /tmp/compaction-verify-XXXX.jsonl)"
trap 'rm -f "$TMP_FILE"' EXIT

hermes sessions export "$TMP_FILE" --session "$SESSION_ID" >/dev/null

ACTUAL_MODEL=$(grep -o '"model": *"[^"]*"' "$TMP_FILE" | head -1 | sed -E 's/.*"model": *"([^"]*)"/\1/')

if [ "$ACTUAL_MODEL" = "$EXPECTED_MODEL" ]; then
  echo "OK: session $SESSION_ID ran on $ACTUAL_MODEL as expected."
  exit 0
else
  echo "MISMATCH: session $SESSION_ID ran on '$ACTUAL_MODEL', expected '$EXPECTED_MODEL'." >&2
  exit 1
fi
