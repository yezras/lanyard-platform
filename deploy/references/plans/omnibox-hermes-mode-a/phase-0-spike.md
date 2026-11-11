# Phase 0: Spike and tool choice

Back-link: [overview.md](./overview.md)  
**Bead:** `cbd-o9s.6`

## Goal

Prove OS isolation for a command as user `hermes` on Linux. Choose Omnigent Omnibox CLI vs in-repo bwrap wrapper. No production install.

## Changes

- Lab host only.
- Write-up: `references/runbooks/omnibox-mode-a-spike.md` (created when spike done).
- Decision: Option 1 (Omnigent Omnibox CLI as library/CLI) or Option 2 (deploy-owned bwrap + optional local egress proxy).

## Data structures

- Decision record: `{ tool: omnigent_cli | bwrap_inrepo, version, invoke_template, known_gaps }`.

## Verification

**Static:** N/A beyond markdown.  
**Runtime:** On lab Linux:

1. Denied read of a secrets path inside sandbox.
2. Denied curl to non-allowlisted host.
3. Allowed write under a granted path.
4. Recorded invoke line for wrapper design.

## Acceptance (bead)

- [ ] Spike notes file exists with pass/fail table.
- [ ] Tool choice locked and noted on epic.
- [ ] No Mode B / Omnigent server explored as deliverable.
