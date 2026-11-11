# Portal agent-backend parity (monorepo track)

**Plan id:** `docs/plans/0005-portal-agent-backend-parity/`  
**Beads epic:** `lp-rt5`  
**Status:** planned (grill locked 2026-07-27)  
**Sister plan (Lanyard Agent):** `lanyard-agent` `docs/plans/08-portal-backend-runtime-parity/`  
**Sister epic:** `lac-yt3` (phases `lac-yt3.1`–`lac-yt3.6`)

## Context

Portal Settings, Directory, composer inventory, and vault/project sandboxing still behave as if Hermes is the only backend. Local BFF discovery defaults to `HERMES_HOME` / `~/.hermes`. Preferred `/api/agent/*` routes and `web-settings-schema` are incomplete. Chat `@` agents are stubs. Office document pane work under `lp-5q6` already supports inline preview and flagged OnlyOffice edit, but operators still hit empty settings and, in some environments, non-inline open behavior.

Lanyard Agent can already chat on the pilot path (`docs/plans/06-portal-local-pilot` in the agent repo) but does **not** implement Brain RPC host methods required for settings, projects, and vault honesty (`docs/architecture/lanyard-agent-conformance-gaps.md`).

This monorepo track makes Portal **backend-agnostic** via capabilities + Brain RPC. The agent track makes Lanyard Agent an honest `backend-runtime-v1` host. **Joint GO** requires both.

## Product decisions (grill Q1–Q10)

| # | Decision |
| --- | --- |
| Q1 | Dual-track ownership: monorepo Portal/contract/verify; agent repo host RPC/layout/settings/projects |
| Q2 | Open Office = **inline client preview** (docx/xlsx/pptx). OnlyOffice = separate **Edit**. Never host X11/desktop from Portal |
| Q3 | One selected **agent** project (`projects.list`) drives Directory + chat cwd sandbox via `primary_path`. CP vault ACL still authorizes paths |
| Q4 | Composer `/` `@` inventory is **host/capability-driven**. No fake stubs. No Portal-owned orchestration |
| Q5 | Sandbox is **host-enforced** cwd + path ACL. Portal stamps context; soft UI scope hint |
| Q6 | **Two separate specs + beads**, one per repo, cross-linked |
| Q7 | **Joint GO only**: neither epic is done until mocklab proves Settings/projects/slash/Office with **real Lanyard Agent** |
| Q8 | Joint proof env = **Docker mocklab topology** (no AWS staging; operator hold) |
| Q9 | Prove **`hermes_lanyard` + `lanyard_agent` only**. Architecture stays capability-shaped for future harnesses |
| Q10 | **Hide** Settings sections the host does not support (no disabled-with-reason nav clutter) |

## Scope

### Included (this monorepo)

1. Kill hard-coded Hermes homes/paths/labels in Portal BFF + web for settings, projects, honesty copy.
2. Route settings snapshot **and** patches through `BackendRuntimeService` / Brain RPC handlers.
3. Mount and use preferred agent APIs (`/api/agent/*`); keep legacy `/api/hermes/*` only as deprecation dual-mount until removal criteria.
4. Wire `web-settings-schema` + capabilities so Settings nav **hides** unsupported sections.
5. Directory / project picker from `projects.list`; stamp chat `working_directory` from selected project `primary_path`.
6. Composer triggers from live host inventory; remove default agent stubs.
7. Office: Office mime/extension always uses Office client preview; never generic “Unsupported preview”; no Portal path opens desktop/X11; OnlyOffice remains Edit-only behind existing flags.
8. Mocklab joint GO script + evidence schema coordinated with the agent plan.
9. Update architecture gap docs and contract notes when Portal-side honesty improves.

### Explicitly excluded

- Vendoring Lanyard Agent (or Hermes) source into this monorepo (ADR 0002).
- Implementing Brain RPC handlers inside Portal for “fake LA behavior.”
- Real third harnesses (Codex, OpenCode, Pi) as first-class targets in this effort.
- AWS staging Document Server / spend (operator hold).
- Unifying control-plane vault ACL projects into `projects.db` (grill Q3 rejected B).
- Making OnlyOffice the default open path (grill Q2 rejected B/C).

## Constraints

- Localhost / Docker mocklab only for joint proof.
- Portal gates UI on **capabilities / methods / affordances**, never `backend_kind` branches.
- Hermes-Lanyard remains the reference host for Portal regression while LA catches up.
- Free-track OnlyOffice license: edit stays lab/localhost; not production customer claim.
- Conservative git profile: no commit/push unless the user asks.

## Alternatives considered

### Portal-only “read whatever is on disk”

Rejected for joint GO. LA does not use Hermes layout; empty Settings would remain with LA until host RPC exists.

### Host-first, freeze Portal

Rejected as sole strategy. Portal still has real Hermes hardcoding and stub inventory that block any backend.

### Dual-track with independent ship

Rejected (grill Q7). PRs may merge, but epic done requires joint mocklab proof.

### Selected: dual-track specs, joint GO

Portal becomes honest and capability-driven; LA implements required Brain RPC + projects + settings; mocklab proves both together.

## Applicable skills and principles

- `pstack-playbooks` / multi-phase plan
- `how` before each unfamiliar subsystem
- `architect` for inventory + projects data shapes
- `typescript-best-practices`
- `web-ui-testing` / existing Office UI tests for Office phases
- `principle-foundational-thinking` — capabilities + Brain RPC as core model
- `principle-redesign-from-first-principles` — finish phase-4 design, do not add Hermes special cases
- `principle-boundary-discipline` — host enforces sandbox; Portal stamps context
- `principle-migrate-callers-then-delete-legacy` — preferred `/api/agent/*` then drop Hermes-only callers
- `principle-sequence-verifiable-units` — each phase has static + runtime check
- `principle-prove-it-works` — joint mocklab evidence, not “it compiles”
- `principle-laziness-protocol` — reuse `@lanyard/backend-runtime`, `web-settings-schema`, `lp-5q6` pane
- `unslop` on plan and PR prose

## Phases

| Phase | File | Bead | Depends on |
| --- | --- | --- | --- |
| 1 | [phase-1-dehermes-paths.md](phase-1-dehermes-paths.md) | `lp-rt5.3` | framing closed |
| 2 | [phase-2-settings-brain-rpc-ui.md](phase-2-settings-brain-rpc-ui.md) | `lp-rt5.4` | phase 1 |
| 3 | [phase-3-projects-directory-sandbox-stamp.md](phase-3-projects-directory-sandbox-stamp.md) | `lp-rt5.5` | phase 1 |
| 4 | [phase-4-composer-host-inventory.md](phase-4-composer-host-inventory.md) | `lp-rt5.6` | phase 2 |
| 5 | [phase-5-office-inline-preview.md](phase-5-office-inline-preview.md) | `lp-rt5.7` | independent after framing |
| 6 | [phase-6-mocklab-joint-go.md](phase-6-mocklab-joint-go.md) | `lp-rt5.8` | phases 1–5 + **agent track joint-ready** |
| — | [testing.md](testing.md) | — | all |

Phases 2 and 3 may parallel after phase 1. Phase 5 may parallel from the start. Phase 6 is the joint gate.

## Sister plan contract

The agent plan must deliver (minimum for joint GO):

1. Relay Brain RPC request/response transport.
2. Required methods: `brain.ping`, `brain.health`, `vault.list|stat|read`, `settings.snapshot`, `projects.list`.
3. Expansion as needed for Settings toggles: `settings.patch` (or honest method_not_found + hide UI).
4. Host cwd sandbox for selected project `primary_path`.
5. Capabilities document that matches reality (no false `settings_snapshot` / `projects` claims).
6. Skills (and agents/workflows if claimed) inventory visible to Portal composer.

Portal must deliver:

1. No hard-coded Hermes home for product paths.
2. Settings/projects/composer driven by contract + capabilities.
3. Office open = inline client preview for Office types.
4. Mocklab compose + proof script that pins **lanyard_agent** and collects evidence.

## Verification (program level)

See [testing.md](testing.md).

**Joint GO predicate (falsifiable):** On Docker mocklab with backend kind `lanyard_agent`:

1. Settings shows at least the sections LA advertises; skills (and any other advertised sections) load non-empty when the host has data; no section appears for unsupported features.
2. Directory lists host projects; selecting one stamps chat working directory; agent tools cannot read/write outside that project tree (host ACL).
3. Composer `/` lists host skills; `@` lists host agents/contexts when advertised (no `researcher`/`writer` stubs unless host advertises them).
4. Opening a vault docx/xlsx/pptx shows Office client preview inline next to chat (or vault pane), never “Unsupported preview,” never a host desktop window from Portal.
5. Evidence JSON under `artifacts/localhost/` (or `artifacts/mocklab/`) records topology, backend kind/version, and pass/fail per check.

Hermes-Lanyard regression: same Portal build must still pass Settings/projects/composer against HL on mocklab or local HL fixture path.

## Implementation guidance

1. Prefer extending existing packages over new packages.
2. Do not branch UI on `backend_kind`.
3. Dual-mount legacy Hermes endpoints until `hermes-compat` removal criteria allow deletion.
4. For contested shapes (composer inventory wire format), run `architect` before coding.
5. Parallel phase leaves after phase 1 may use `/beads-execute` when file-disjoint.
6. Decision trail for joint GO: use `show-me-your-work` TSV under `artifacts/` when the mocklab run is multi-session.

## Beads

| Id | Title |
| --- | --- |
| `lp-rt5` | epic: plan + execution parent |
| `lp-rt5.1` | plan step: frame (closed) |
| `lp-rt5.2` | plan step: design phases + write plan docs (closed) |
| `lp-rt5.3` | phase 1: de-Hermes paths |
| `lp-rt5.4` | phase 2: settings Brain RPC + hide UI |
| `lp-rt5.5` | phase 3: projects Directory + stamp |
| `lp-rt5.6` | phase 4: composer host inventory |
| `lp-rt5.7` | phase 5: Office inline preview |
| `lp-rt5.8` | phase 6: mocklab joint GO |

Deps: 4←3; 5←3; 6←4; 8←3…7. Sister joint gate: `lac-yt3.6`.
