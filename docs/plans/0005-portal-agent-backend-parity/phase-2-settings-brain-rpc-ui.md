# Phase 2 — Settings via Brain RPC + capability-hidden UI

**Back-link:** [overview.md](./overview.md)  
**Bead:** `lp-rt5.4`  
**Depends on:** phase 1

## Goal

Settings snapshot and patches go through `BackendRuntimeService` / Brain RPC. UI sections that the host does not support are **hidden** (grill Q10). No empty broken Skills/Cron/MCP/Models panels for unsupported hosts.

## Changes

- Wire PATCH routes (`skills`, `crons`, `mcp`, `models/active`) through `settings-bff` / `settings.patch` when Brain RPC is enabled (close the known wire gap in `bff/src/app.ts`).
- Keep local FS write path only as explicit offline/dev fallback using backend-home resolution from phase 1.
- Import `@lanyard/web-settings-schema` (or equivalent derived catalog) into Settings UI to decide section visibility from capabilities + snapshot include list.
- Hide nav sections with no affordance; show remaining sections with real data or an honest empty-state for “supported but no items.”
- Health/integrations section only when advertised.

## Data structures

- `SettingsSnapshot` (contract redacted view): skills, crons, mcp_servers, models, integrations.
- `BackendCapabilitySet` / UI affordances → section visibility map.
- Patch params per section (existing Brain RPC `settings.patch` shape).

## Verification

**Static:** settings-bff tests for patch via invoker; web tests that unsupported affordances hide nav items; HL fixture still shows full sections when capabilities allow.

**Runtime:** mock/fake backend with partial capabilities (e.g. skills only) → only Skills (+ overview) visible. Full HL capabilities → full nav.

## Sister awareness

Agent plan must implement `settings.snapshot` with real skill/MCP/model data from LA config, and `settings.patch` for toggles Portal already offers (or leave methods unimplemented so capabilities hide those sections). Do not advertise `settings_patch` until patch works.
