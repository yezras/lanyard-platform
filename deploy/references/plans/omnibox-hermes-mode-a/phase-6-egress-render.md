# Phase 6: Egress allowlist render

Back-link: [overview.md](./overview.md)  
**Bead:** `cbd-o9s.12`  
**Depends on:** phase 1 (can proceed parallel to 2–5 once seeds exist)

## Goal

Generate host runtime egress allowlist from approved data processors and tenant model endpoints without committing secrets.

## Changes

- Create `scripts/omnibox/render-egress-allowlist.sh`
- Output under `/etc/company-brain/omnibox/runtime/` (generated on host)
- Note consumer in `references/approved-data-processors.md`

## Data structures

- Input: static processor host list + tenant model hosts (tfvars or env).
- Output: runtime fragment merged by wrapper.

## Verification

**Static:** Script dry-run produces allowlist without secrets.  
**Runtime:** Wrapper using runtime allowlist still blocks example.com.

## Acceptance

- [ ] No live keys in git.
- [ ] Metadata and private ranges stay blocked.
