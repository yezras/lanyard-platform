# Phase 4 — Composer host inventory (skills / agents / workflows)

**Back-link:** [overview.md](./overview.md)  
**Architecture:** [portal-composer-host-inventory.md](../../architecture/portal-composer-host-inventory.md)  
**Bead:** `lp-rt5.6`  
**Depends on:** phase 2 (skills from settings snapshot)

## Goal

Chat composer `/` and `@` (and workflow trigger if advertised) use **live host inventory**. Remove default stub agents (`researcher`, `writer`, etc.). Selection is pass-through tokens/context the host understands (grill Q4).

## Changes

- Skills menu: only from settings snapshot (or expansion list method when added); no hard-coded summarize fallback when snapshot loaded empty for a supporting host.
- Contexts/agents menu: from host-advertised list (settings integrations, capabilities expansion, or dedicated list method once contract has it). If none, omit `@` agent stubs entirely (tags may remain product-local if desired).
- Workflows: if host capabilities advertise workflows, add composer surface; otherwise do not invent Portal workflow runner UI.
- Document token conventions (`/skill-name`, `@agent-id`) for host authors in architecture note.
- Display of subagent tool events remains read-only telemetry (existing).

## Data structures

- `SearchableItem[]` for composer triggers.
- Optional contract expansion: `agents.list` / `workflows.list` — only if architect decides snapshot is insufficient; prefer reusing snapshot/capabilities before new RPC methods.

## Verification

**Static:** chatComposerTriggers tests with empty vs full sources; no DEFAULT_AGENT_STUBS in production path when sources empty.

**Runtime:** with fixture skills A,B → `/` shows A,B. With no agent inventory → `@` does not offer fake researcher/writer.

## Sister awareness

Agent plan must surface skills (and agents/workflows if product claims them) in snapshot or list methods and honor slash/mention tokens in the agent turn. Portal will not implement workflow engines.
