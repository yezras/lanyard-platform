# Phase 7: Documentation and threat model

Back-link: [overview.md](./overview.md)  
**Bead:** `cbd-o9s.13`  
**Depends on:** phase 4 (env names stable)

## Goal

Operators can enable, verify, and break-glass Omnibox Mode A. Security docs state residual shared-kernel risk.

## Changes

- Create `references/runbooks/omnibox-mode-a.md`
- Update `references/runbooks/host-runtime-hardening.md`
- Update `references/hermes-profile-rbac.md`
- Update `references/threat-model-private-by-default.md`
- Pointers in `INDEX.md` / `AGENTS.md` if required by repo norms

## Data structures

None beyond doc tables (profile → policy).

## Verification

**Static:** Links resolve; no claim of microVM or production pen-test pass.  
**Runtime:** N/A.

## Acceptance

- [ ] Break-glass documented (`OMNIBOX_ENABLED=0`).
- [ ] Isolation verify commands listed.
- [ ] Residual risk explicit.
