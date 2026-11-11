# Phase 1: Repro baseline

Back: [overview.md](./overview.md)

## Goal

Lock the failing surface with runtime evidence so the fix cannot ship without a red→green story.

## Changes

- No product code change required.
- Optional: add a one-shot repro snippet under `packages/web` scripts or document curl commands only in this plan (prefer plan + bead notes over new docs unless a script is the regression vehicle in phase 3).
- Confirm MetaMask ObjectMultiplex lines are extension noise (note on bead; no code).

## Data structures

None.

## Verification

With `pnpm --filter @lanyard/web dev` (or existing process on 3010):

1. `curl -sI http://localhost:3010/src/api/client.ts` → 404, `content-type: text/plain`
2. `curl -sI http://localhost:3010/src/main.tsx` → 200, JS MIME
3. Paste both into the phase bead notes as baseline.

## Bead

See overview Beads section (phase-1 child).