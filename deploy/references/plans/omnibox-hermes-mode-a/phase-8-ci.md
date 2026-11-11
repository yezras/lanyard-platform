# Phase 8: CI wiring

Back-link: [overview.md](./overview.md)  
**Bead:** `cbd-o9s.14`  
**Depends on:** phase 3

## Goal

Every PR runs offline Omnibox smoke.

## Changes

- Modify `.github/workflows/ci.yml` to run `bash scripts/smoke-omnibox.sh`

## Verification

**Static:** CI config valid.  
**Runtime:** CI job green on a PR that only adds smoke (or full branch).

## Acceptance

- [ ] Smoke in default CI path.
- [ ] Does not require root or network for offline checks.
