# Phase 1: Policy seeds

Back-link: [overview.md](./overview.md)  
**Bead:** `cbd-o9s.7`  
**Depends on:** phase 0 decision (field names may follow chosen tool)

## Goal

Check in declarative admin and contributor Omnibox policies aligned with existing Hermes profiles and tool allowlists.

## Changes

- Create `scripts/omnibox/admin.yaml`
- Create `scripts/omnibox/contributor.yaml`
- Create `scripts/omnibox/README.md` (mapping table only)

## Data structures

- `OmniboxPolicy` files keyed by profile name.
- `never_grant` list includes gateway secrets paths.
- Network default deny + metadata/private block.

## Verification

**Static:** YAML present; README maps profile → file → tool-allowlist.  
**Runtime:** Offline grep smoke (full smoke in phase 3): contributor policy mentions `.env` deny.

## Acceptance

- [ ] Seeds committed with no secrets.
- [ ] Mapping admin/contributor documented.
- [ ] Contributor policy stricter than admin on FS/shell expectation.
