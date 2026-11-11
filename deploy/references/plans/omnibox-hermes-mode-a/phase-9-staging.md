# Phase 9: Staging validation

Back-link: [overview.md](./overview.md)  
**Bead:** `cbd-o9s.15`  
**Depends on:** phases 5, 6, 7, 8

## Goal

Prove Mode A on a real staging Company Brain EC2 against Portal chat and isolation checks.

## Changes

- No new code required if prior phases done.
- Record results in runbook staging table.

## Verification (runtime surface)

| Check | Surface | Expected |
|-------|---------|----------|
| Portal chat contributor | Portal web | Success, vault ACL holds |
| Portal chat admin | Portal web | Success |
| Admin shell isolation | Gateway tool / SSM | Cannot read `.env`; blocked host fails |
| Contributor shell | Gateway tool | Denied by allowlist |
| Break-glass | Host env + restart | Pre-Omnibox behavior |
| Reboot | Host | Gateway + policies healthy |

No browser control skill required if Portal is exercised manually; flag manual in notes.

## Acceptance

- [ ] All table rows recorded pass/fail with date.
- [ ] Epic MVP definition of done satisfied or residual issues filed as beads.
