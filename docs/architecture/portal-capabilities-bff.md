# Portal BFF: backend capabilities in context responses

Bead: `lp-k7g.8.5` (phase 4 — Portal backend abstraction).

## Purpose

Expose backend capability data from the BFF so Portal **web** can adapt UI
without backend-specific conditionals (`if hermes…`, kind string switches).

```text
GET /api/context  (or equivalent session bootstrap)
  → getPortalContext(service, ctx)
  → BackendRuntimeService.capabilities(ctx)
  → brain.capabilities (live) | artifact / static fallback
  → normalize + derive ui_affordances
  → { backend_capabilities, ui, capabilities_source, capabilities_degraded }
```

Package module:
[`portal/packages/backend-runtime/src/capabilities-bff.ts`](../../portal/packages/backend-runtime/src/capabilities-bff.ts).

## Why not gate on `backend_kind`

`backend_kind` is an operator / inventory field. Feature presence differs by
release and pin, not only by product family. Web must read:

1. `backend_capabilities.features.*`
2. `backend_capabilities.ui_affordances.*` (or pre-derived `ui.can.*`)
3. optionally `backend_capabilities.brain_rpc_methods`

Never: `if (kind === "hermes_lanyard") showCreateProject()`.

## Response shape (`PortalContextHttpBody`)

| Field | Role |
| --- | --- |
| `backend_capabilities` | Normalized `BackendCapabilitySet` (capabilities.schema.json `#/$defs/capabilityDescriptor`). Always includes complete v1 `ui_affordances`. |
| `ui` | Pre-derived `PortalUiState`: `affordances`, `can` (supported-only booleans), `degraded`, `unsupported` lists |
| `capabilities_source` | `brain_rpc` \| `artifact_manifest` \| `combined` \| `static_default` |
| `capabilities_degraded` | `true` when live discovery failed, descriptor was repaired, or static/manifest fallback was used |
| `capabilities_notes` | Optional operator-safe note |

### `ui.can` mapping

| Flag | Affordance (must be `supported`) |
| --- | --- |
| `chat` | `chat_panel` |
| `vault_browse` | `vault_browser` |
| `vault_edit` | `vault_editor` |
| `settings_view` | `settings_page` |
| `settings_edit` | `settings_editor` |
| `project_list` | `project_picker` |
| `project_create` | `project_create` |
| `model_select` | `model_selector` |
| `cron_manage` | `cron_manager` |
| `host_health` | `host_health` |

Degraded affordances stay **visible but limited** — use `ui.affordances[name]`
when you need the three-way state; `ui.can.*` is the full-support gate only.

## Affordance derivation

When the host omits `ui_affordances` (typical for artifact_manifest fallback),
the BFF applies
[`capabilities.schema.json`](../../contracts/backend-runtime-v1/capabilities.schema.json)
`x-lanyard-ui-affordance-catalog.derivation`:

1. **supported** if every `requires_features_all_of` is true **and** every
   `requires_methods_all_of` is listed **and** (if `requires_methods_any_of`
   non-empty) at least one of those methods is listed.
2. **unsupported** otherwise.
3. **degraded** is host-asserted only (never invented by Portal).

Catalog constants and helpers: `UI_AFFORDANCE_CATALOG`, `deriveUiAffordances`,
`uiStateFromCapabilities`.

## Graceful degradation (acceptance: missing capabilities do not crash)

| Situation | Behavior |
| --- | --- |
| `brain.capabilities` → `method_not_found` | Hermes adapter returns static/pin descriptor (`source=artifact_manifest`); context marks degraded |
| Relay / host `unavailable` | `getPortalContext` catches error; returns static defaults; HTTP **200** + `capabilities_degraded: true` |
| Malformed descriptor | `normalizeCapabilityDescriptor` repairs required fields; degraded |
| Missing `ui_affordances` | Derived from features + methods |

`getPortalContext` **does not throw** for discovery failures. Route handlers
should still use `contextErrorToHttp` for session/auth construction errors
outside the capabilities path.

Prefer **200 + unsupported/degraded state** over 5xx for capability absence
(contract: `x-lanyard-unsupported-error-states`).

## Production composition

```ts
import {
  createProductionHermesBackendRuntimeService,
  createContextHandlers,
  createAgentProjectsHandlers,
  createSettingsHandlers,
  backendContextFromSession,
} from "@lanyard/backend-runtime";

const backend = createProductionHermesBackendRuntimeService({
  invokeBrainRpc: relayInvoke,
});
const context = createContextHandlers(backend);
const agentProjects = createAgentProjectsHandlers(backend);
const settings = createSettingsHandlers(backend);

// GET /api/context → c.json(await context.get(ctx))
// Web: if (!ctx.ui.can.settings_edit) hide patch controls
// Web: if (ctx.ui.affordances.project_create === "unsupported") hide create
```

## Real portal paths (reference tree)

Live monorepo path: `portal/`

| Path | Role today / after import |
| --- | --- |
| `packages/bff/src/app.ts` | Add `GET /context` (or extend existing bootstrap) |
| `packages/bff/src/brain-rpc.ts` | Invoker for `brain.capabilities` |
| `packages/web/src/api/*` | New context client; gate settings/projects on `ui` |
| `packages/web/src/features/*` | Empty/disabled states from affordance catalog |

### Migration steps when Portal lands

1. Register `@lanyard/backend-runtime` in Portal pnpm workspace.
2. Composition root already uses `createProductionHermesBackendRuntimeService`.
3. Add `createContextHandlers` → `GET /api/context`.
4. Web bootstrap loads context once per session; store `ui` in client state.
5. Settings editor / project create / model selector gate on `ui.can.*`
   (`lp-k7g.8.6` consumes this for settings UI schema work).

## Acceptance mapping

| Criterion | Evidence |
| --- | --- |
| capability set is returned in `/api/context` or equivalent | `getPortalContext` / `createContextHandlers.get` → `PortalContextHttpBody.backend_capabilities` |
| UI state derives from capabilities | `ui` / `deriveUiAffordances` / `uiStateFromCapabilities` from features + methods + catalog |
| missing capabilities do not crash requests | Soft-fail on throw/malformed; static fallback; always complete `ui_affordances` |

## Related

- [portal-backend-runtime-service.md](portal-backend-runtime-service.md) — interface boundary
- [portal-settings-brain-rpc.md](portal-settings-brain-rpc.md) — settings gates on `settings_patch`
- [portal-projects-brain-rpc.md](portal-projects-brain-rpc.md) — project create gate on `projects_create`
- [portal-control-plane-backend-fields.md](portal-control-plane-backend-fields.md) — CP `backend_capabilities` snapshot (not a live substitute)
- Contract: [capabilities.schema.json](../../contracts/backend-runtime-v1/capabilities.schema.json)
- Phase plan: [phase-4-portal-backend-abstraction.md](../plans/0001-platform-monorepo-migration/phase-4-portal-backend-abstraction.md)
- Follow-on: [portal-web-settings-schema.md](portal-web-settings-schema.md) (`lp-k7g.8.6` web settings UI backend schema)
