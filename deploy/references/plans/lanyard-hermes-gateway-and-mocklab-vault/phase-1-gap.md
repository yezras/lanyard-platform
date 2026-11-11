# Phase 1: Gap report (pinned Hermes vs portal needs)

**Bead:** `cbd-ukg.4`  
**Depends on:** plan approved (`cbd-ukg.1`–`.3`)  

## Goal

Decide whether mocklab must republish/redeploy Hermes before chat/vault work, with cited evidence.

## Work

1. On hermes-lanyard tree, list portal-critical paths:
   - `gateway/brain_rpc/`
   - `gateway/relay/auth.py` (jti)
   - portal metadata / cwd pin in `gateway/run.py` and relay adapter
2. Compare to contents of staged pin `v0.1.0-g7h2` (unpack tarball or read release notes / pack provenance).
3. Check host mocklab if reachable: `/opt/hermes-lanyard/.seed/provenance.env` vs pin SHA.
4. Write gap table: file/feature | in pin? | needed for chat? | needed for vault UI?

## Verification

- Gap report: [`phase-1-gap-report.md`](./phase-1-gap-report.md) (this plan dir).
- Explicit go/no-go for phase 2 pack: **GO** (see report).

## Acceptance

- [x] Portal-required features enumerated with file pointers — `phase-1-gap-report.md`
- [x] Current mocklab pin classified: **missing X** (portal-integration + G2a jti); host provenance **unknown (host unreachable)**
- [x] Phase 2 either starts or is skipped with reason — **GO pack** (pin not sufficient for portal chat UX)
