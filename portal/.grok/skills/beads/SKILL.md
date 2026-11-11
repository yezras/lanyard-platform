---
name: beads
description: Use when working in Lanyard Portal with bd (Beads) for task tracking — find ready work, claim/close beads, dependencies, session handoff, or Astryx migration execution. Triggers include bd ready, claim bead, close task, blockers, and "what should I work on next" in this repo.
---

# Beads (Portal)

**Source of truth:** local Dolt DB under `.beads/`; sync with `bd dolt push` / `bd dolt pull` on `git+https://github.com/LanyardBrain/Portal.git`. Do not use markdown TODO lists or TodoWrite for **project** work.

## First commands

```bash
export PATH="$HOME/.local/bin:$PATH"   # if bd not on PATH
bd prime
bd ready --json
bd show <id> --json
```

## Workflow

1. `bd ready --json` — pick unblocked work  
2. `bd update <id> --claim` — before coding  
3. Implement; commit messages end with `(portal-xxxx)`  
4. Verify per bead acceptance + `testing.md`  
5. `bd close <id> --reason "…"`  
6. `bd dolt push` after meaningful bead changes (team sync)

## Rules

- Do not use `bd edit` (interactive). Use `bd update` flags.  
- Create follow-ups with `bd create`, not ad-hoc checklists.  
- Durable decisions: `bd remember "…"` (see `artifacts/astryx-frontend-migration-plan.md` **Locked decisions**).  
- Read full agent block in repo root `AGENTS.md`.

## Astryx epic

Migration tasks live under epic **Astryx frontend migration for @lanyard/web**. Canonical design: `artifacts/astryx-frontend-migration-plan.md`. For implementation slices, also load skill **astryx-frontend-migration**.