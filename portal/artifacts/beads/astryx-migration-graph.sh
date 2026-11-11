#!/usr/bin/env bash
# One-time: create Astryx migration bead graph (see astryx-frontend-migration-plan.md).
set -euo pipefail
export PATH="${HOME}/.local/bin:${PATH}"
cd "$(dirname "$0")/../.."

if ! command -v bd >/dev/null; then
  echo "bd not found; install beads first"
  exit 1
fi

if bd list 2>/dev/null | grep -qE '^○|^◐|^●|^✓'; then
  echo "Issues already exist. Aborting to avoid duplicates. Use bd list."
  exit 1
fi

bd remember "Astryx epic: React-only shell, Node 22, light Lanyard theme, icon-only brand, Mackinac fallback, tabs-no-router through Phase 3, login-only + Google stub local-only. Plan: artifacts/astryx-frontend-migration-plan.md"

INIT=$(bd create --title "Initialize bd + AGENTS.md in Portal repo" --type chore --priority 1 --silent \
  --description "bd init, hooks, Dolt remote to Portal, AGENTS.md. Acceptance: bd where works; bd dolt remote list shows origin.")

DECISION=$(bd create --title "Astryx frontend migration plan (canonical design)" --type decision --priority 2 --silent \
  --description "Authoritative spec: artifacts/astryx-frontend-migration-plan.md (locked decisions 2026-03-08).")

EPIC=$(bd create --title "Astryx frontend migration for @lanyard/web" --type epic --priority 0 --silent \
  --description "React + Astryx rewrite of packages/web. Track all child beads; close when Phase 3 complete and epic verification passes.")

P0=$(bd create --title "Phase 0: React + Astryx deps, Node 22, Lanyard theme, brand icons, api/client, astryx CLI" --type task --priority 0 --silent \
  --acceptance "Node 22 in root engines and CI; @lanyard/web has React, Astryx, globals.css + lanyard-theme.css; icons in public/brand/; api/client.ts + types extracted; astryx scripts + init agents; pnpm --filter @lanyard/web build and astryx doctor pass." \
  --description "Foundation per migration plan Phase 0. No PortalShell yet.")

P2B=$(bd create --title "Local dev: seeded user + auto-assign member; Google stub gate" --type task --priority 0 --silent \
  --acceptance "seed-demo-tenant.sh creates dev@demo.local + member role; testing.md credentials; auto-assign member on register when DEV_TENANT_SLUG; BFF 404/stub gate outside local dev; manual login + /api/context hermes_profile default." \
  --description "Bead 2b: testing.md A+C, Auth prerequisites.")

P1=$(bd create --title "Phase 1: PortalShell + App auth gate (light shell, empty states)" --type task --priority 0 --silent \
  --acceptance "React-only #app entry; light Astryx shell + Lanyard blue icon; auth gate; MIGRATED_VIEWS empty states for chat/vault/settings; dev:tmux loads." \
  --description "React-only cutover; no parallel main.ts DOM.")

AUTH=$(bd create --title "Migrate Auth view to Astryx (login-only, Google + local stub)" --type task --priority 1 --silent \
  --acceptance "Email/password login only; GET /api/auth/google when configured; dev stub button local-only; no register-on-401.")

PROJ=$(bd create --title "Migrate Projects toolbar (select, new thread)" --type task --priority 1 --silent \
  --acceptance "Project select + new thread parity with main.ts; works with session and /api/projects.")

CHAT=$(bd create --title "Migrate Chat (SSE, MCQ, upload) to React + Astryx" --type task --priority 0 --silent \
  --acceptance "SSE via useChatEvents; MCQ, tool progress, staging upload; mock-gateway E2E per testing.md.")

VAULT=$(bd create --title "Migrate Vault (tree, reader, search)" --type task --priority 1 --silent \
  --acceptance "Vault tree, markdown/PDF reader, search parity; vault-browser.ts retired.")

SETTINGS=$(bd create --title "Migrate Settings launchpad" --type task --priority 2 --silent \
  --acceptance "Snapshot + health check UI with Astryx settings layout.")

P3=$(bd create --title "Phase 3: Remove main.ts/vault-browser; Vitest RTL + api client + Chat hook" --type task --priority 0 --silent \
  --acceptance "Monolith deleted; pnpm --filter @lanyard/web test passes (auth/shell RTL, api/client, Chat hook); CI runs web test.")

CI=$(bd create --title "CI: Node 22, web build + astryx doctor; web test after Phase 3" --type task --priority 1 --silent \
  --acceptance "ci.yml Node 22; web build + doctor on every run; web test step when Phase 3 bead done.")

# Tasks cannot block epics; use parent-child + blocks JSONL (IDs are portal-* hashes).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP=$(mktemp)
sed -e "s/portal-6eb/$EPIC/g" -e "s/portal-o6g/$DECISION/g" \
  -e "s/portal-11c/$P0/g" -e "s/portal-rdp/$P2B/g" -e "s/portal-156/$P1/g" \
  -e "s/portal-8y8/$AUTH/g" -e "s/portal-ehd/$PROJ/g" -e "s/portal-gx4/$CHAT/g" \
  -e "s/portal-e7s/$VAULT/g" -e "s/portal-bie/$SETTINGS/g" -e "s/portal-5k6/$P3/g" \
  -e "s/portal-jzu/$CI/g" \
  "$ROOT/artifacts/beads/astryx-migration-deps.jsonl" > "$TMP"
bd dep add --file "$TMP"
rm -f "$TMP"

bd close "$INIT" --reason "bd init completed; hooks and Dolt remote configured."

echo "Created epic: $EPIC"
echo "Decision: $DECISION"
bd ready
bd dolt push 2>/dev/null || true