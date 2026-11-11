# Phase 3: Regression guard

Back: [overview.md](./overview.md)

## Goal

Encode the lesson in structure so `/src/api` vs tenant proxy cannot drift again without a red check.

## Changes

Pick the **smallest** durable guard (Laziness Protocol):

**Preferred:** unit test on the shared matcher/bypass helper:

- `isReservedPathSegment("src") === true`
- `shouldProxyTenantApi("/src/api/client.ts") === false`
- `shouldProxyTenantApi("/demo/api/health") === true`
- `shouldProxyTenantApi("/api/auth/me")` handled by separate `/api` rule (document in test name)

**Alternative if pure helper is awkward:** a tiny Node script run in CI/`package.json` that starts nothing but asserts regex/bypass logic against path fixtures (no live server).

Avoid a full Playwright smoke unless already cheap in-repo.

## Data structures

- Pure function over path strings (same model as phase 2).

## Verification

```bash
pnpm --filter @lanyard/web test
```

Tests cover reserved vs tenant cases without requiring a live BFF.

## Bead

See overview Beads section (phase-3 child).