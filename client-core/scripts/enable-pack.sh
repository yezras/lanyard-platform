#!/usr/bin/env bash
# Enable an optional pack into the live vault skill/tool tree.
#
# Works from a deployed vault root or monorepo client-core/ checkout:
#   ./scripts/enable-pack.sh <pack>
#   bash client-core/scripts/enable-pack.sh <pack>
#
# Discovery (lp-k7g.9.3):
#   ./scripts/enable-pack.sh list
#   ./scripts/enable-pack.sh            # same as list when no pack given
#
# Pack directories under packs/ with pack.yaml are the source of truth for the
# discoverable list. Enablement still uses the handlers below (behavior preserved).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACK="${1:-}"

log() { echo "[enable-pack] $*"; }

# List pack directory names that contain pack.yaml (discoverable catalog).
# Falls back to bare directories under packs/ if metadata is absent (still listed,
# but validate-packs.py will fail closed on missing metadata).
discover_packs() {
  local d name
  if [ ! -d "$ROOT/packs" ]; then
    return 0
  fi
  for d in "$ROOT/packs"/*/; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    # Skip non-pack files/dirs (e.g. nothing unexpected)
    case "$name" in
      .* ) continue ;;
    esac
    printf '%s\n' "$name"
  done | sort -u
}

# Human-readable list: name + summary from pack.yaml when present.
list_packs() {
  local name meta summary line
  local -a packs
  mapfile -t packs < <(discover_packs)
  if [ "${#packs[@]}" -eq 0 ]; then
    echo "No packs found under $ROOT/packs/" >&2
    return 1
  fi
  echo "Available packs (from $ROOT/packs/):"
  for name in "${packs[@]}"; do
    meta="$ROOT/packs/$name/pack.yaml"
    summary=""
    if [ -f "$meta" ]; then
      # Prefer summary:, else when_to_enable:
      summary="$(
        awk '
          /^summary:[[:space:]]*/ {
            sub(/^summary:[[:space:]]*/, "")
            gsub(/^[\"'\'']|[\"'\'']$/, "")
            print
            exit
          }
        ' "$meta" 2>/dev/null || true
      )"
      if [ -z "$summary" ]; then
        summary="$(
          awk '
            /^when_to_enable:[[:space:]]*/ {
              sub(/^when_to_enable:[[:space:]]*/, "")
              gsub(/^[\"'\'']|[\"'\'']$/, "")
              print
              exit
            }
          ' "$meta" 2>/dev/null || true
        )"
      fi
    fi
    if [ -n "$summary" ]; then
      printf '  %-16s %s\n' "$name" "$summary"
    else
      printf '  %-16s (missing pack.yaml metadata)\n' "$name"
    fi
  done
  echo
  echo "Enable: $0 <pack-name>"
  echo "Validate: $ROOT/scripts/validate-packs.py"
}

usage() {
  echo "Usage: $0 <pack-name>" >&2
  echo "       $0 list" >&2
  echo >&2
  echo "Discoverable packs:" >&2
  local name
  while IFS= read -r name; do
    echo "  $name" >&2
  done < <(discover_packs)
  echo >&2
  echo "ROOT=$ROOT (script-relative; monorepo or vault)" >&2
}

if [ -z "$PACK" ] || [ "$PACK" = "list" ] || [ "$PACK" = "--list" ] || [ "$PACK" = "-l" ]; then
  list_packs
  # Empty arg / list is not an error — pack list is discoverable without enabling.
  exit 0
fi

if [ "$PACK" = "-h" ] || [ "$PACK" = "--help" ]; then
  usage
  exit 0
fi

PACK_DIR="$ROOT/packs/$PACK"
if [ ! -d "$PACK_DIR" ]; then
  echo "Unknown pack: $PACK (expected under packs/)" >&2
  echo >&2
  usage
  exit 1
fi

case "$PACK" in
  gws)
    mkdir -p "$ROOT/skills"
    if [ -d "$PACK_DIR/skills/gws" ]; then
      rsync -a "$PACK_DIR/skills/gws/" "$ROOT/skills/gws/"
      log "Installed skills/gws"
    fi
    if [ -d "$PACK_DIR/skills/productivity-gws" ]; then
      mkdir -p "$ROOT/skills/productivity"
      rsync -a "$PACK_DIR/skills/productivity-gws/" "$ROOT/skills/productivity/gws/"
      log "Installed skills/productivity/gws"
    fi
    ;;
  crm)
    mkdir -p "$ROOT/skills"
    rsync -a "$PACK_DIR/skills/crm/" "$ROOT/skills/crm/"
    log "Installed skills/crm"
    ;;
  self-improve)
    mkdir -p "$ROOT/skills" "$ROOT/tools" "$ROOT/scripts"
    rsync -a "$PACK_DIR/skills/self-improve/" "$ROOT/skills/self-improve/"
    if [ -d "$PACK_DIR/tools/self-improve" ]; then
      rsync -a "$PACK_DIR/tools/self-improve/" "$ROOT/tools/self-improve/"
    fi
    if [ -d "$PACK_DIR/scripts" ]; then
      cp -a "$PACK_DIR/scripts/." "$ROOT/scripts/"
      chmod +x "$ROOT/scripts/"*.sh 2>/dev/null || true
    fi
    log "Installed self-improve skill/tools/scripts"
    log "Next: ./scripts/init-evals-db.sh <VaultRoot> && ./scripts/sync-self-improve-to-hermes.sh"
    ;;
  wacli)
    mkdir -p "$ROOT/tools"
    rsync -a "$PACK_DIR/tools/wacli/" "$ROOT/tools/wacli/"
    chmod +x "$ROOT/tools/wacli/install-wacli.sh" 2>/dev/null || true
    log "Installed tools/wacli — run tools/wacli/install-wacli.sh if needed"
    ;;
  focr)
    mkdir -p "$ROOT/infra"
    rsync -a "$PACK_DIR/infra/focr/" "$ROOT/infra/focr/"
    log "Installed infra/focr — follow pack INDEX for install on OCR workers"
    ;;
  granola)
    mkdir -p "$ROOT/mcp"
    rsync -a "$PACK_DIR/mcp/" "$ROOT/mcp/"
    log "Installed mcp granola package — configure Hermes MCP connection separately"
    ;;
  excel-author)
    mkdir -p "$ROOT/skills/finance"
    rsync -a "$PACK_DIR/skills/excel-author/" "$ROOT/skills/finance/excel-author/"
    log "Installed skills/finance/excel-author"
    ;;
  meadow-core)
    mkdir -p "$ROOT/agents/meadow-core"
    if [ -d "$PACK_DIR/agents" ]; then
      rsync -a "$PACK_DIR/agents/" "$ROOT/agents/meadow-core/"
    fi
    if [ -f "$PACK_DIR/instructions.md" ]; then
      cp "$PACK_DIR/instructions.md" "$ROOT/agents/meadow-core/instructions.md"
    fi
    log "Installed agents/meadow-core personas + team instructions"
    ;;
  *)
    echo "Unhandled pack: $PACK (directory exists but enable-pack has no handler)" >&2
    echo "Add a case arm in scripts/enable-pack.sh and pack.yaml metadata." >&2
    exit 1
    ;;
esac

# Record enabled packs
mkdir -p "$ROOT/.seed"
echo "$PACK" >> "$ROOT/.seed/enabled-packs.txt"
sort -u "$ROOT/.seed/enabled-packs.txt" -o "$ROOT/.seed/enabled-packs.txt"
log "Recorded in .seed/enabled-packs.txt"
log "Done: $PACK"
