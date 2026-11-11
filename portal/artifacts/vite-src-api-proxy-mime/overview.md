# Plan: Vite `/src/api/*` module MIME failures (dev)

**Status:** planned (not implemented)  
**Playbook:** multi-phase-plan → bug-fix execution  
**Surface:** `@lanyard/web` Vite dev server on port 3010

## Context

Loading the portal in the browser shows:

```
Loading module from "http://localhost:3010/src/api/client.ts" was blocked
  because of a disallowed MIME type ("text/plain").
Loading failed for the module with source "…/src/api/client.ts". AuthView.tsx
(same for tenantBase.ts, auth.ts via PortalShell.tsx)
```

Vite HMR connects successfully. Other modules under `/src/**` (for example `AuthView.tsx`, `main.tsx`) load as `text/javascript`. Only paths matching `/src/api/*` fail.

**Runtime evidence (2026-07-15, live `:3010`):**

| URL | Status | Content-Type | Who answers |
|-----|--------|--------------|-------------|
| `/src/main.tsx` | 200 | `text/javascript` | Vite |
| `/src/features/auth/AuthView.tsx` | 200 | `text/javascript` | Vite |
| `/src/hooks/useSession.ts` | 200 | `text/javascript` | Vite |
| `/src/api/client.ts` | **404** | **`text/plain`** | BFF (proxied) |
| `/src/api/types.ts` | **404** | **`text/plain`** | BFF (proxied) |
| `/@fs/…/packages/web/src/api/client.ts` | 200 | `text/javascript` | Vite |
| `http://127.0.0.1:4000/src/api/client.ts` | 404 | `text/plain` | BFF directly |

Body of the failing response is plain `404 Not Found`, identical to the BFF. The browser reports MIME type because ES modules require a JavaScript MIME type; a BFF plain-text 404 is rejected.

### Root cause (confirmed mechanism)

`packages/web/vite.config.ts` proxies:

```ts
"^/[a-z0-9][a-z0-9-]*/api": { target: bffTarget, changeOrigin: true }
```

That pattern treats the first path segment as a **tenant slug**. Vite source modules live at `/src/api/*.ts`, so the first segment is literally `src`. The proxy forwards `/src/api/*` to the BFF, which has no such route and returns `404 text/plain`.

Client routing already knows `src` is reserved:

```ts
// packages/web/src/api/tenantBase.ts
const RESERVED = new Set([…, "src", …]);
```

`parseTenantSlugFromPathname` will never treat `src` as a tenant. The **dev proxy does not share that model**, so browser module loads and API fetch prefixes disagree.

### Noise in the same console (out of scope)

- `ObjectMultiplex - orphaned data for stream "background-liveness"` / `"metamask-multichain-provider"`: browser extension (MetaMask). Not app code.
- `[vite] connecting…` / `connected.`: healthy HMR.

## Scope

**In**

- Fix Vite dev proxy so `/src/api/**` (and other reserved first segments) are served by Vite, not the BFF.
- Align reserved path segments with `tenantBase` tenant parsing.
- Prove with curl + browser that modules load and real tenant path proxy still works.
- Regression guard so this class of collision cannot return silently.

**Out**

- MetaMask / extension console noise.
- Renaming `packages/web/src/api` (wrong lever).
- Production reverse-proxy / edge routing (unless the same regex pattern exists there; check only, do not expand scope without evidence).
- Changing BFF 404 content types as a “fix” (symptom of wrong hop).

## Constraints

- Path-based MVP must keep proxying `/<tenantSlug>/api/*` → BFF (`BFF_URL`, default `http://127.0.0.1:4000`).
- Legacy `/api/*` proxy stays.
- Prefer sharing or deriving the reserved-segment list from one place (`tenantBase` already owns RESERVED).
- Smallest change that removes the collision (Laziness Protocol). No feature work.

## Alternatives

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **A. Bypass reserved first segments in Vite proxy** (bypass / refine regex using same reserved set as `tenantBase`) | Root cause; tiny; keeps path layout | Must keep list in sync | **Chosen** |
| B. Rename `src/api` → `src/lib/http` (or similar) | Avoids `/api` substring | Large rename; still leaves other reserved collisions possible | Rejected |
| C. Serve app under a different Vite base so modules are not under `/src` | Avoids collision by path shape | Breaks standard Vite layout; high churn | Rejected |
| D. Configure BFF to return JS MIME on 404 | Silences MIME message only | Still 404; modules never load | Rejected (symptom) |

## Applicable skills / principles

**Playbooks:** bug-fix (execute), opening-a-pr (ship)

**Principles that shaped this plan**

| Principle | Decision it changed |
|-----------|---------------------|
| **Fix Root Causes** | Do not “fix MIME”; stop proxying Vite modules to BFF |
| **Laziness Protocol** | Prefer proxy bypass over package rename or base-path redesign |
| **Model the Domain** | Tenant slug vs Vite path segment; proxy must use same RESERVED model as `tenantBase` |
| **Encode Lessons in Structure** | Shared reserved list + regression test, not a one-off comment |
| **Sequence Verifiable Units** | Red curl first → fix → green curl + tenant proxy check |
| **Prove It Works** | Browser/module load is the bar; unit tests alone insufficient |
| **Foundational Thinking** | Shared reserved-segment data first, then wire proxy, then guard |

**Skills for implementers:** how (proxy + tenantBase), **web-ui-testing** (phase 4 surface proof), prove-it-works, unslop on PR text

## Phases

1. [phase-1-repro-baseline.md](./phase-1-repro-baseline.md) — Capture failing curl baseline and hypothesis lock
2. [phase-2-proxy-reserved-align.md](./phase-2-proxy-reserved-align.md) — Align Vite proxy with reserved segments
3. [phase-3-regression-guard.md](./phase-3-regression-guard.md) — Automated guard (test or script)
4. [phase-4-verify-ship.md](./phase-4-verify-ship.md) — **web-ui-testing** prove + PR

## Verification (project-level)

**Phases 1–3 (curl / unit):**

```bash
# Failing today / must pass after fix
curl -sI http://localhost:3010/src/api/client.ts | grep -i content-type
# expect: text/javascript (or application/javascript), HTTP 200

curl -sI http://localhost:3010/src/api/auth.ts | head -5
curl -sI http://localhost:3010/src/api/tenantBase.ts | head -5

# Tenant path proxy still hits BFF (not Vite transforming a module)
curl -sI http://localhost:3010/demo/api/health   # or a real BFF health under tenant path
# expect: BFF response shape (not Vite JS transform of a .ts file)

# Package tests
pnpm --filter @lanyard/web test
```

**Phase 4 (required proof):** **`/web-ui-testing`** skill  
(`~/.grok/skills/web-ui-testing/SKILL.md`). Headless Playwright against `BASE_URL` on **port 3010**, assert no MIME/module failures for `/src/api/*.ts`, write screenshots under `artifacts/ui/vite-src-api-proxy-mime/`. Curl is secondary. Details: [phase-4-verify-ship.md](./phase-4-verify-ship.md).

## Implementation guidance

- Run **how** over `vite.config.ts` proxy + `tenantBase.ts` before editing.
- Architect only if exporting RESERVED crosses a non-trivial boundary (keep export minimal).
- Do not ship belt-and-suspenders MIME middleware.
- Commit story: (1) repro note or failing guard, (2) proxy fix, (3) green guard.
- After PR: pr-babysit if available.
- Parallelism: phases 1→2→3→4 are sequential; do not `/beads-execute` in parallel.

## Beads

| Role | ID |
|------|-----|
| Epic | `portal-mnn` |
| Phase 1 repro | `portal-mnn.4` |
| Phase 2 proxy fix | `portal-mnn.5` |
| Phase 3 regression | `portal-mnn.6` |
| Phase 4 web-ui-testing prove+PR | `portal-mnn.7` |

Planning steps closed under epic. Start execution with `bd update portal-mnn.4 --claim`.
