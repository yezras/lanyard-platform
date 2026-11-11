# Phase 3: Ensure script and offline smoke

Back-link: [overview.md](./overview.md)  
**Bead:** `cbd-o9s.9`  
**Depends on:** phase 2

## Goal

Idempotent host install of bubblewrap (or deps), policies, wrapper; offline smoke for CI.

## Changes

- Create `scripts/ensure-omnibox.sh` (`--dry-run`, `--require`)
- Create `scripts/smoke-omnibox.sh`
- Register paths in `index.yaml`

## Data structures

- Host layout under `/etc/company-brain/omnibox/` and workspaces under `/var/lib/company-brain/omnibox/`.
- Flags: `ENABLE_OMNIBOX`, `OMNIBOX_REQUIRED`.

## Verification

**Static:** `bash scripts/smoke-omnibox.sh` and `bash scripts/ensure-omnibox.sh --dry-run` exit 0.  
**Runtime:** Live install only on lab/staging, not required to close this phase if dry-run covers layout.

## Acceptance

- [ ] Dry-run safe without root mutations when requested.
- [ ] Smoke fails closed if seeds missing.
- [ ] No secrets in repo paths.
