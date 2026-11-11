#!/usr/bin/env bash
# lp-p37.13 — tighten permissions on local portal secret/session artifacts.
#
# Usage (from portal/):
#   bash scripts/secure-local-secrets.sh           # fix modes (default)
#   bash scripts/secure-local-secrets.sh --check   # report only; exit 1 if any too open
#   bash scripts/secure-local-secrets.sh --scan    # lightweight secret-path inventory
#
# Targets (when present):
#   .data/                         dir 0700
#   .data/demo-env.sh              0600
#   .data/last-relay-secret.txt    0600
#   .data/hermes-portal-relay.env  0600
#   .data/chat.db*                 0600
#   .data/*.env                    0600
#   monorepo artifacts/ui/.auth/   dir 0700, files 0600
#   monorepo .env.mocklab*         0600
#
# See docs/runbooks/local-secret-hygiene.md

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# portal/ is one level under monorepo when checked out as lanyard-platform/portal
MONOREPO_ROOT="$(cd "$ROOT/.." && pwd)"
DATA_DIR="${PORTAL_DATA_DIR:-$ROOT/.data}"
AUTH_DIR="${UI_AUTH_DIR:-$MONOREPO_ROOT/artifacts/ui/.auth}"

MODE="${1:---fix}"
case "$MODE" in
  --fix | --check | --scan) ;;
  -h | --help)
    sed -n '2,20p' "$0"
    exit 0
    ;;
  *)
    echo "Unknown mode: $MODE (use --fix, --check, or --scan)" >&2
    exit 2
    ;;
esac

FAILED=0
FIXED=0
CHECKED=0

mode_octal() {
  # portable-ish: prefer stat -c (GNU), fall back to python
  local path="$1"
  if stat -c '%a' "$path" >/dev/null 2>&1; then
    stat -c '%a' "$path"
  else
    python3 -c "import os,stat; print(oct(stat.S_IMODE(os.stat('$path').st_mode))[2:])"
  fi
}

secure_dir() {
  local path="$1"
  [[ -d "$path" ]] || return 0
  CHECKED=$((CHECKED + 1))
  local cur
  cur="$(mode_octal "$path")"
  if [[ "$cur" != "700" && "$cur" != "500" ]]; then
    if [[ "$MODE" == "--check" ]]; then
      echo "FAIL dir mode $cur (want 700): $path"
      FAILED=1
    else
      chmod 700 "$path"
      echo "fixed dir 0700: $path (was $cur)"
      FIXED=$((FIXED + 1))
    fi
  else
    [[ "$MODE" == "--check" ]] && echo "ok dir 0$cur: $path"
  fi
}

secure_file() {
  local path="$1"
  [[ -f "$path" ]] || return 0
  CHECKED=$((CHECKED + 1))
  local cur
  cur="$(mode_octal "$path")"
  # Accept 600 or 400 (read-only secret)
  if [[ "$cur" != "600" && "$cur" != "400" ]]; then
    if [[ "$MODE" == "--check" ]]; then
      echo "FAIL file mode $cur (want 600): $path"
      FAILED=1
    else
      chmod 600 "$path"
      echo "fixed file 0600: $path (was $cur)"
      FIXED=$((FIXED + 1))
    fi
  else
    [[ "$MODE" == "--check" ]] && echo "ok file 0$cur: $path"
  fi
}

if [[ "$MODE" == "--scan" ]]; then
  echo "=== Local secret / session artifact inventory (lp-p37.13) ==="
  echo "DATA_DIR=$DATA_DIR"
  echo "AUTH_DIR=$AUTH_DIR"
  echo ""
  for p in \
    "$DATA_DIR" \
    "$DATA_DIR/demo-env.sh" \
    "$DATA_DIR/last-relay-secret.txt" \
    "$DATA_DIR/hermes-portal-relay.env" \
    "$DATA_DIR/chat.db" \
    "$AUTH_DIR" \
    "$AUTH_DIR/mocklab-agent.json" \
    "$MONOREPO_ROOT/.env.mocklab-agent-dev"
  do
    if [[ -e "$p" ]]; then
      echo "$(mode_octal "$p")  $p"
    else
      echo "----  $p  (absent)"
    fi
  done
  echo ""
  echo "Expected: dirs 700, secret files 600. Gitignored paths must stay untracked."
  echo "Documented placeholders/tests are fine; never commit real tokens."
  exit 0
fi

echo "secure-local-secrets: mode=$MODE data=$DATA_DIR auth=$AUTH_DIR"

secure_dir "$DATA_DIR"
# Known secret filenames under .data
for f in \
  demo-env.sh \
  last-relay-secret.txt \
  hermes-portal-relay.env \
  chat.db \
  chat.db-wal \
  chat.db-shm \
  chat.db-journal
do
  secure_file "$DATA_DIR/$f"
done
# Any other .env-like files under .data
# (|| true: `read` returns 1 on EOF under set -e)
if [[ -d "$DATA_DIR" ]]; then
  while IFS= read -r -d '' f; do
    secure_file "$f"
  done < <(find "$DATA_DIR" -maxdepth 1 -type f \( -name '*.env' -o -name '*.env.*' -o -name '*secret*' -o -name 'demo-env.sh' \) -print0 2>/dev/null) || true
fi

secure_dir "$AUTH_DIR"
if [[ -d "$AUTH_DIR" ]]; then
  while IFS= read -r -d '' f; do
    secure_file "$f"
  done < <(find "$AUTH_DIR" -maxdepth 1 -type f -print0 2>/dev/null) || true
fi

# Monorepo mocklab env (never commit)
if [[ -d "$MONOREPO_ROOT" ]]; then
  while IFS= read -r -d '' f; do
    secure_file "$f"
  done < <(find "$MONOREPO_ROOT" -maxdepth 1 -type f -name '.env.mocklab*' -print0 2>/dev/null) || true
fi

echo "checked=$CHECKED fixed=$FIXED"
if [[ "$MODE" == "--check" && "$FAILED" -ne 0 ]]; then
  echo "One or more secret artifacts are group/world accessible. Re-run without --check to fix." >&2
  exit 1
fi
echo "ok"
