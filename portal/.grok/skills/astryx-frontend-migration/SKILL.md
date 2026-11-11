---
name: astryx-frontend-migration
description: Implement @lanyard/web React + Astryx migration in Lanyard Portal. Use when claiming migration beads, Phase 0–3 work, PortalShell, Auth, Chat SSE, Vault, CI astryx doctor, or references to artifacts/astryx-frontend-migration-plan.md.
---

# Astryx frontend migration (Portal)

## Before coding

1. `bd prime` and `bd show <id> --json` for the claimed bead.  
2. Read **`artifacts/astryx-frontend-migration-plan.md`** (**Locked decisions** + bead acceptance).  
3. Manual checks: **`testing.md`**.  
4. UI components: `pnpm --filter @lanyard/web astryx search <keyword>` (after Phase 0).

## Locked constraints (do not relitigate)

- React-only shell after Phase 1; empty states for unmigrated tabs.  
- Node 22+, light Lanyard theme, icons in `packages/web/public/brand/` (Core `dev/design` canonical).  
- Login-only UI; Google real OAuth + local dev stub only.  
- Tabs only (no react-router) through Phase 3.  
- Phase 3 tests: RTL auth/shell + `api/client` + Chat hook unit tests.

## Typical PR slices

| Bead area | Touch |
|-----------|--------|
| Phase 0 | `packages/web` deps, `main.tsx` entry path, theme CSS, `api/client.ts`, CI web build + doctor |
| #2b | `seed-demo-tenant.sh`, BFF register auto-assign + stub gate, `testing.md` |
| Phase 1 | `PortalShell`, `App.tsx`, `MIGRATED_VIEWS` |
| Auth | `features/auth/`, Google + stub |
| Chat | `useChatEvents`, SSE, staging upload |

## Verification

- `pnpm --filter @lanyard/web build`  
- `pnpm --filter @lanyard/web astryx:doctor` (or `astryx doctor`)  
- `pnpm test` (root) unchanged  
- `testing.md` flows for the slice

Close bead only when acceptance + manual checks pass; then `bd dolt push`.