# Phase 2: Align Vite proxy with reserved path segments

Back: [overview.md](./overview.md)

## Goal

Stop the path-based tenant proxy from intercepting Vite modules under reserved first segments (at minimum `src`).

## Changes

**Primary file:** `packages/web/vite.config.ts`

- Replace or wrap the `"^/[a-z0-9][a-z0-9-]*/api"` rule so reserved first segments are **not** proxied.
- Prefer a single source of truth for reserved segments:
  - Export `RESERVED` (or a pure helper like `isReservedPathSegment`) from `tenantBase.ts` / a tiny shared module both can import, **or**
  - Duplicate a minimal list only if Node/Vite config cannot cleanly import app code (document why).
- Keep:
  - `/api` → BFF
  - `/<realTenant>/api` → BFF (e.g. `demo`)

**Touch as needed:** `packages/web/src/api/tenantBase.ts` (export RESERVED or helper only).

Do **not** rename `src/api` or change fetch paths.

## Data structures

- Domain: **path first segment** is either a **tenant slug** or a **reserved app/Vite segment**.
- Encode as one set/helper used by:
  - browser tenant parsing (`parseTenantSlugFromPathname`)
  - Vite `server.proxy` match/bypass

## Verification

```bash
curl -sI http://localhost:3010/src/api/client.ts   # 200 + JS MIME
curl -sI http://localhost:3010/src/api/auth.ts
curl -sI http://localhost:3010/src/api/tenantBase.ts
curl -s  http://localhost:3010/src/api/client.ts | head -5  # transformed module, not "404 Not Found"
# Real tenant still proxied:
curl -sI http://localhost:3010/demo/api/…   # BFF status, not Vite module body
```

Restart Vite after config change (`strictPort: 3010`).

## Bead

See overview Beads section (phase-2 child).