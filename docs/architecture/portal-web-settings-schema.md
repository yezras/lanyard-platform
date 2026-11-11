# Portal web: settings UI from backend schema

Bead: `lp-k7g.8.6` (phase 4 — Portal backend abstraction).

## Goal

Render Portal settings controls from **backend config categories** and
**capability data** rather than Hermes-specific assumptions.

| Acceptance | Approach |
| --- | --- |
| Model config displays through backend schema | `config.schema.json` `model` / `modelSettings` → `models` section → `model_activate` controls from `settings.snapshot.models` |
| Skills and cron settings display through backend schema | `skills` / `cron` categories → toggle controls from snapshot; patch ops `skill.set_enabled` / `cron.set_enabled` |
| Disabled controls explain unavailable backend support | `availability.disabledReason` + `unavailableCode` when capabilities / affordances lack edit support |

## Package

[`portal/packages/web-settings-schema`](../../portal/packages/web-settings-schema/)
(`@lanyard/web-settings-schema`):

| Module | Role |
| --- | --- |
| `catalog.ts` | config.schema category → section → patch op → affordance map |
| `capabilities.ts` | Edit gates (mirrors settings-bff + capabilities-bff rules) |
| `map-controls.ts` | `buildSettingsUiSchema` pure mapper |
| `reasons.ts` | Stable user-facing disabled copy |

**No React, no I/O, no BFF dependency** — safe for `packages/web` after import.

## Data flow (after Portal import)

```text
GET /api/context
  → context.ui / context.backend_capabilities   (lp-k7g.8.5)

GET /api/settings/snapshot
  → SettingsSnapshot                            (lp-k7g.8.4 → Brain RPC)

buildSettingsUiSchema({ snapshot, ui, capabilities, snapshotError? })
  → SettingsUiSchema { page, sections, controls }

SettingsView (or successor)
  → map descriptors to tables / toggles / banners
  → only call patchSettings* when control.availability.interactive
```

## Config schema categories

Normative schema: [`config.schema.json`](../../contracts/backend-runtime-v1/config.schema.json).

| Category | Snapshot field | Patch op | Edit affordance / features |
| --- | --- | --- | --- |
| `model` | `models[]` | `model.set_active` | `model_selector` or `settings_patch` / `models` / `models.set_active`. When none are advertised, section may still **show** snapshot models as read-only; `model_activate` controls are non-interactive with `model_selector_unsupported` (`lp-kng.7.2` pilot honesty). |
| `skills` | `skills[]` | `skill.set_enabled` | `settings_editor` / `settings_patch` |
| `cron` | `crons[]` | `cron.set_enabled` | `cron_manager` or `settings_patch` / `cron` / `cron.patch` |
| `mcp_servers` | `mcp_servers[]` | `mcp.set_enabled` | `settings_editor` / `settings_patch` |

`overview` (backend home, source, exported_at) and `integrations` remain
snapshot chrome — not config.schema patch surfaces. Prefer `backend_home`
over legacy `hermes_home` when displaying home path.

## Control kinds

| Kind | Meaning |
| --- | --- |
| `skill_toggle` / `cron_toggle` / `mcp_toggle` | Enable/disable entity |
| `model_activate` | Set active provider+model |
| `section_banner` | Read-only notice when edit unsupported but entities exist |
| `unavailable_banner` | Section/page blocked (no snapshot / method missing) |
| `empty_state` | Snapshot loaded, list empty |
| `readonly_field` | Overview / integrations display |

Every non-interactive entity control sets:

- `availability.interactive: false`
- `availability.disabledReason` — human copy
- `availability.unavailableCode` — machine code for tests / i18n

## Wiring real Portal web settings pages

Reference tree (live monorepo path): `portal/`

| Path today | Role after import |
| --- | --- |
| `packages/web/src/features/settings/SettingsView.tsx` | Consume `buildSettingsUiSchema`; stop assuming every toggle is live |
| `packages/web/src/features/settings/SettingsSnapshotContext.tsx` | Keep snapshot fetch; add context/capabilities from `/api/context` |
| `packages/web/src/api/settings.ts` | Unchanged URLs; respect `unavailable` on error bodies |
| `packages/web` package.json | Depend on `@lanyard/web-settings-schema` (workspace) |

### Suggested integration steps

1. Register `@lanyard/web-settings-schema` in Portal `pnpm-workspace.yaml`
   (package already lives at `portal/packages/web-settings-schema`).
2. Load `GET /api/context` once per session (see
   [portal-capabilities-bff.md](portal-capabilities-bff.md)).
3. In settings feature code:

   ```ts
   import { buildSettingsUiSchema, sectionById } from "@lanyard/web-settings-schema";

   const schema = buildSettingsUiSchema({
     snapshot,
     ui: portalContext.ui,
     capabilities: portalContext.backend_capabilities,
     snapshotError: loadErrorBody, // when fetch fails with unavailable
   });

   if (!schema.page.interactive) {
     // Show schema.page.disabledReason banner; skip patch handlers
   }

   const skills = sectionById(schema, "skills");
   // Render skills.controls: skill_toggle → EnabledToggleButton only if interactive
   // else show disabledReason tooltip / section_banner
   ```

4. Map interactive controls to existing API helpers:

   | Control kind | API |
   | --- | --- |
   | `skill_toggle` | `patchSettingsSkill(id, enabled)` |
   | `cron_toggle` | `patchSettingsCron(id, enabled)` |
   | `mcp_toggle` | `patchSettingsMcp(name, enabled)` |
   | `model_activate` | `patchSettingsActiveModel(provider, model)` |

5. Replace hard-coded “Hermes home” / “Hermes & tools” chrome with
   `schema.page.backendHome` and backend-neutral section labels from
   `SECTION_LABELS` / catalog.
6. Do **not** branch on `backend_kind` or open `$HERMES_HOME` from the browser.

### Error / unavailable mapping

| BFF / HTTP | UI |
| --- | --- |
| Snapshot 404/503 with `unavailable: true` | `snapshotError` → page + section `unavailable_banner` |
| `ui.can.settings_edit === false` | Skill/MCP toggles non-interactive + reason |
| `ui.can.model_select === false` and no settings_patch | Model activate disabled + reason |
| `ui.can.cron_manage === false` and no settings_patch | Cron toggles disabled + reason |
| Empty list in snapshot | `empty_state` (not an error) |

## Acceptance mapping

| Criterion | Evidence |
| --- | --- |
| Model config displays through backend schema | `CONFIG_CATEGORY_CATALOG.model` + `buildCategoryControls("model")` → `model_activate` from snapshot; `schemaPath: properties.model` |
| Skills and cron through backend schema | `skills` / `cron` categories → toggle controls + patch ops; unit tests |
| Disabled controls explain unavailable support | `availability.disabledReason` / `unavailableCode` on non-interactive controls; unit tests for missing patch / models / cron |

## Related

- [portal-settings-brain-rpc.md](portal-settings-brain-rpc.md) — BFF settings snapshot/patch (`lp-k7g.8.4`)
- [portal-capabilities-bff.md](portal-capabilities-bff.md) — context UI state (`lp-k7g.8.5`)
- [portal-backend-runtime-service.md](portal-backend-runtime-service.md) — service boundary
- Phase plan: [phase-4-portal-backend-abstraction.md](../plans/0001-platform-monorepo-migration/phase-4-portal-backend-abstraction.md)
- Follow-on: [portal-hermes-deployment-compat.md](portal-hermes-deployment-compat.md) (`lp-k7g.8.7`)
