# `@lanyard/web-settings-schema`

Pure **UI control descriptors** for Portal web settings, driven by:

1. **`settings.snapshot`** (Brain RPC / BFF GET `/api/settings/snapshot`)
2. **Backend capabilities / `PortalUiState`** (GET `/api/context` from `lp-k7g.8.5`)
3. **`config.schema.json` categories** (`model`, `skills`, `cron`, `mcp_servers`)

Bead: `lp-k7g.8.6` (phase 4 — Portal backend abstraction).

## Why this package exists

Today’s settings UI (`packages/web/src/features/settings/SettingsView.tsx` in
the external Portal tree) renders Hermes snapshot fields directly and always
offers enable/disable controls. Phase 4 needs the web layer to:

- Display **model / skills / cron** (and MCP) through **backend schema**
  categories, not Hermes-only labels or filesystem assumptions
- **Disable** edit controls when capabilities do not advertise support
- **Explain** unavailable backend support with stable reason copy

This package is **browser-safe** (no Node, no React, no `@lanyard/backend-runtime`
import) so it can land under `packages/web` after Portal import without pulling
BFF code into the client bundle.

## Layout

```text
portal/packages/web-settings-schema/
  src/
    types.ts          # Snapshot / capability structural types + descriptors
    catalog.ts        # config.schema.json category → section → patch op map
    capabilities.ts   # Edit gates (settings_patch / models / cron)
    reasons.ts        # Disabled-reason catalog
    map-controls.ts   # buildSettingsUiSchema() pure mapper
    index.ts
  test/
    web-settings-schema.test.ts
```

## Quick use

```ts
import {
  buildSettingsUiSchema,
  interactiveControls,
  sectionById,
} from "@lanyard/web-settings-schema";

// After Portal import: snapshot from /api/settings/snapshot,
// ui + capabilities from /api/context
const schema = buildSettingsUiSchema({
  snapshot,
  ui: context.ui,
  capabilities: context.backend_capabilities,
  snapshotError, // optional settingsErrorToHttp body
});

// schema.page.interactive === false → show page-level unavailable banner
// schema.page.disabledReason → human copy

const models = sectionById(schema, "models");
// models.configCategory === "model"
// models.schemaPath === "properties.model"
// models.controls[] → model_activate descriptors

for (const control of interactiveControls(schema)) {
  // wire to patchSettingsSkill / patchSettingsCron / patchSettingsActiveModel
  if (!control.availability.interactive) {
    // show control.availability.disabledReason on tooltip / banner
  }
}
```

## Config schema categories

| Category (`config.schema.json`) | Settings section | Patch op | Edit gate |
| --- | --- | --- | --- |
| `model` (`modelSettings`) | `models` | `model.set_active` | `model_selector` **or** `settings_patch` / `models` |
| `skills` (`skillsSettings`) | `skills` | `skill.set_enabled` | `settings_editor` / `settings_patch` |
| `cron` (`cronSettings` + jobs.json) | `crons` | `cron.set_enabled` | `cron_manager` **or** `settings_patch` / `cron` |
| `mcp_servers` | `mcp` | `mcp.set_enabled` | `settings_editor` / `settings_patch` |

`integrations` is Portal chrome (snapshot inventory) — not a config.schema
patch surface. Overview was removed from the settings rail (lp-fn5.1.4).

## Disabled reasons

When a control is non-interactive, `availability.disabledReason` is always set
for entity controls and section banners. Machine codes live in
`availability.unavailableCode` (e.g. `model_selector_unsupported`,
`skill_edit_unsupported`, `settings_snapshot_unavailable`).

Never branch the web UI on `backend_kind`.

## Develop

```bash
cd portal/packages/web-settings-schema
npm install
npm test
npm run build
```

## Related

- Design: [`docs/architecture/portal-web-settings-schema.md`](../../../docs/architecture/portal-web-settings-schema.md)
- Settings BFF: `@lanyard/backend-runtime` `settings-bff.ts` (`lp-k7g.8.4`)
- Capabilities context: `capabilities-bff.ts` (`lp-k7g.8.5`)
- Contract: `contracts/backend-runtime-v1/config.schema.json`
- Reference UI (monorepo):  
  `portal/packages/web/src/features/settings/`
