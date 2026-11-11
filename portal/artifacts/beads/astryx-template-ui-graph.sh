#!/usr/bin/env bash
# One-time: create Astryx template UI bead graph (see artifacts/astryx-template-ui-plan.md).
# Safe to re-run only if no template epics exist yet.
set -euo pipefail
export PATH="${HOME}/.local/bin:$PATH"
cd "$(dirname "$0")/../.."

if ! command -v bd >/dev/null; then
  echo "bd not found; install beads first"
  exit 1
fi

if bd list 2>/dev/null | grep -q "Epic: Astryx ai-chat template"; then
  echo "Template UI beads already exist. Aborting. Use: bd list | grep -i template"
  exit 1
fi

bd remember "Astryx template UI: ai-chat, shell-nav, settings-sidebar, login-card scaffolds; extract to features/*; no raw page.tsx mount. Plan: artifacts/astryx-template-ui-plan.md"

DECISION=$(bd create --title "Astryx template UI plan (canonical)" --type decision --priority 2 --silent \
  --description "Authoritative spec: artifacts/astryx-template-ui-plan.md")

E1=$(bd create --title "Epic: Astryx ai-chat template for Portal Chat" --type epic --priority 1 --silent \
  --description "CLI ai-chat scaffold + extract into ChatView. Plan: artifacts/astryx-template-ui-plan.md")
E2=$(bd create --title "Epic: Astryx shell-nav template for Portal Vault" --type epic --priority 1 --silent \
  --description "CLI shell-nav scaffold + VaultView layout. Plan: artifacts/astryx-template-ui-plan.md")
E3=$(bd create --title "Epic: Astryx settings-sidebar template (clean skills UI)" --type epic --priority 1 --silent \
  --description "CLI settings-sidebar; structured skills table, no JSON dump. Plan: artifacts/astryx-template-ui-plan.md")
E4=$(bd create --title "Epic: Astryx login-card template for Portal login" --type epic --priority 1 --silent \
  --description "CLI login-card scaffold + AuthView. Plan: artifacts/astryx-template-ui-plan.md")

# Optional: link epics under migration epic when it exists
MIGRATION_EPIC=$(bd list --json 2>/dev/null | jq -r '.[] | select(.title == "Astryx frontend migration for @lanyard/web") | .id' | head -1 || true)
if [[ -n "${MIGRATION_EPIC:-}" ]]; then
  for E in "$E1" "$E2" "$E3" "$E4"; do
    bd dep add "$E" "$MIGRATION_EPIC" --type parent-child
  done
fi

for E in "$E1" "$E2" "$E3" "$E4"; do
  bd dep add "$E" "$DECISION" --type parent-child
done

T11=$(bd create --title "Scaffold ai-chat under src/app/ai-chat" --type task --priority 1 --silent \
  --acceptance "page.tsx committed under packages/web/src/app/ai-chat; pnpm --filter @lanyard/web astryx:doctor passes.")
T12=$(bd create --title "Extract chat layout from scaffold into ChatView" --type task --priority 1 --silent \
  --acceptance "No duplicate AppShell under PortalShell; demo data removed from chat UI.")
T13=$(bd create --title "Wire SSE timeline, MCQ, upload, tool progress" --type task --priority 1 --silent \
  --acceptance "Parity with useChatEvents and testing.md chat flows.")
T14=$(bd create --title "Update Chat RTL/tests" --type task --priority 1 --silent \
  --acceptance "useChatEvents.test.ts green; chat tests updated for new layout.")

T21=$(bd create --title "Scaffold shell-nav under src/app/shell-nav" --type task --priority 1 --silent \
  --acceptance "page.tsx committed under packages/web/src/app/shell-nav.")
T22=$(bd create --title "Extract side-nav + main layout into VaultView" --type task --priority 1 --silent \
  --acceptance "Tree, search, and VaultReader behavior unchanged.")
T23=$(bd create --title "Remove redundant vault layout CSS" --type task --priority 1 --silent \
  --acceptance "vault.css minimized or removed where template covers layout.")
T24=$(bd create --title "Vault manual verification (testing.md)" --type task --priority 1 --silent \
  --acceptance "testing.md vault paths pass manually.")

T31=$(bd create --title "Scaffold settings-sidebar under src/app/settings-sidebar" --type task --priority 1 --silent \
  --acceptance "page.tsx committed under packages/web/src/app/settings-sidebar.")
T32=$(bd create --title "Add snapshot types + fetch layer in web" --type task --priority 1 --silent \
  --acceptance "Typed skills, crons, mcp_servers, models, integrations in web client.")
T33=$(bd create --title "Build sidebar sections + skills table/list (no JSON skills list)" --type task --priority 1 --silent \
  --acceptance "Skills shown as structured rows; no primary JSON CodeBlock for skills.")
T34=$(bd create --title "Health check structured UI" --type task --priority 1 --silent \
  --acceptance "Integration health readable without raw JSON wall.")
T35=$(bd create --title "Settings RTL smoke test" --type task --priority 1 --silent \
  --acceptance "Mock snapshot; skills section renders rows in test.")

T41=$(bd create --title "Scaffold login-card under src/app/login-card" --type task --priority 2 --silent \
  --acceptance "page.tsx committed under packages/web/src/app/login-card.")
T42=$(bd create --title "Port AuthView onto login-card layout" --type task --priority 2 --silent \
  --acceptance "Email/password, Google, dev stub unchanged.")
T43=$(bd create --title "Update AuthView.test.tsx" --type task --priority 2 --silent \
  --acceptance "All existing auth tests pass.")

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP=$(mktemp)
sed -e "s/portal-DEC/$DECISION/g" \
  -e "s/portal-E1/$E1/g" -e "s/portal-E2/$E2/g" -e "s/portal-E3/$E3/g" -e "s/portal-E4/$E4/g" \
  -e "s/portal-T11/$T11/g" -e "s/portal-T12/$T12/g" -e "s/portal-T13/$T13/g" -e "s/portal-T14/$T14/g" \
  -e "s/portal-T21/$T21/g" -e "s/portal-T22/$T22/g" -e "s/portal-T23/$T23/g" -e "s/portal-T24/$T24/g" \
  -e "s/portal-T31/$T31/g" -e "s/portal-T32/$T32/g" -e "s/portal-T33/$T33/g" -e "s/portal-T34/$T34/g" -e "s/portal-T35/$T35/g" \
  -e "s/portal-T41/$T41/g" -e "s/portal-T42/$T42/g" -e "s/portal-T43/$T43/g" \
  "$ROOT/artifacts/beads/astryx-template-ui-deps.jsonl" > "$TMP"
bd dep add --file "$TMP"
rm -f "$TMP"

echo "Decision: $DECISION"
echo "Epics: $E1 $E2 $E3 $E4"
bd ready