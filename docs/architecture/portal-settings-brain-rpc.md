# Portal: route settings through Brain RPC

Bead: `lp-k7g.8.4` (phase 4 — Portal backend abstraction).

## Goal

Stop BFF route handlers from reading/writing `$HERMES_HOME/config.yaml` and
`cron/jobs.json` directly for the settings page. Settings snapshot and patch
go through `BackendRuntimeService`, which in production invokes Brain RPC.

| Surface | Contract | Production path |
| --- | --- | --- |
| Settings page load | `settings.snapshot` (**required** v1) | `getSettingsSnapshot` → `BackendRuntimeService.settingsSnapshot` → Brain RPC |
| Skill / MCP enable | `settings.patch` (**expansion**) | `patchSettingsSkill` / `patchSettingsMcp` → capability gate → config.schema validation → `patchSettings?` → Brain RPC |
| Cron enable | `settings.patch` or `cron.patch` | Same BFF path; host may implement either |
| Active model | `settings.patch` or `models.set_active` | Same BFF path; host may implement either |

## Why not local Hermes files

| Today (pre-import Portal) | Problem |
| --- | --- |
| `loadSettingsSnapshot` → discover from `$HERMES_HOME` | Couples BFF to Hermes filesystem layout |
| `patchSettingsSkill` → write `config.yaml` | Secrets and schema drift risk; not multi-backend |
| Fixture overrides in-process | Fine for tests; not a production SoT |

Production SoT for settings discovery/mutation is the **backend host** via
Brain RPC. Local ports remain available only when
`settingsRequireBrainRpc: false` (unit tests / temporary migration harnesses).

## Package surface

[`portal/packages/backend-runtime`](../../portal/packages/backend-runtime/):

| Module | Role |
| --- | --- |
| `src/settings-bff.ts` | Thin BFF adapter: snapshot, patch parse, **config.schema validation**, capability gate, HTTP error map with **unavailable** flag |
| `src/hermes-adapter.ts` | `settingsRequireBrainRpc` + `createProductionHermesBackendRuntimeService` |
| `src/fake-backend.ts` | **Test-only** in-memory settings + optional patch |
| `src/service.ts` | `settingsSnapshot` / optional `patchSettings` |

### Production composition (after Portal import)

```ts
// packages/bff composition root
import {
  createProductionHermesBackendRuntimeService,
  createSettingsHandlers,
  backendContextFromSession,
  settingsErrorToHttp,
} from "@lanyard/backend-runtime";

const backendRuntime = createProductionHermesBackendRuntimeService({
  invokeBrainRpc: (input) => relay.invokeBrainRpc(input), // brain-rpc.ts + relay
});

const settings = createSettingsHandlers(backendRuntime);

// app.ts — replace loadSettingsSnapshot / patchSettings*
api.get("/settings/snapshot", async (c) => {
  const ctx = backendContextFromSession({ /* tenant, user, rbac… */ });
  try {
    return c.json(await settings.snapshot(ctx));
  } catch (err) {
    const { status, body } = settingsErrorToHttp(err);
    return c.json(body, status);
  }
});

api.patch("/settings/skills/:skillId", csrfProtection, async (c) => {
  const ctx = backendContextFromSession({ /* … */ });
  try {
    const result = await settings.patchSkill(
      ctx,
      c.req.param("skillId"),
      await c.req.json(),
    );
    return c.json(result);
  } catch (err) {
    const { status, body } = settingsErrorToHttp(err);
    return c.json(body, status);
  }
});
// similarly: patchCron, patchMcp, patchActiveModel
```

**Do not** inject `settings: hermesSettingsPort` into production composition.
Local config.yaml / jobs.json ports remain available on
`HermesBackendRuntimeService` only when `settingsRequireBrainRpc: false`.

## settings.patch contract (defined before UI enablement)

Normative wire shapes live in
[`contracts/backend-runtime-v1/brain-rpc.schema.json`](../../contracts/backend-runtime-v1/brain-rpc.schema.json):

- `$defs/params_settings_patch` — `{ op, skill_id?|cron_id?|mcp_name?|provider+model, enabled? }`
- `$defs/result_settings_patch` — `{ op, source, skill?|cron?|mcp?|model? }`

Ops:

| `op` | Config schema surface | Portal route |
| --- | --- | --- |
| `skill.set_enabled` | `skills.disabled[]` | `PATCH /settings/skills/:skillId` |
| `cron.set_enabled` | `cron/jobs.json` enabled flag | `PATCH /settings/crons/:cronId` |
| `mcp.set_enabled` | `mcp_servers[name].enabled` | `PATCH /settings/mcp/:mcpName` |
| `model.set_active` | `model: { provider, default }` (`modelSettings`) | `PATCH /settings/models/active` |

Examples:

- [`brain-rpc.settings-patch.request.json`](../../contracts/backend-runtime-v1/examples/brain-rpc.settings-patch.request.json)
- [`brain-rpc.settings-patch.result.json`](../../contracts/backend-runtime-v1/examples/brain-rpc.settings-patch.result.json)

BFF **always** validates patch payloads against backend
[`config.schema.json`](../../contracts/backend-runtime-v1/config.schema.json)
surfaces (and rejects secret-shaped keys) before calling the service.

### UI / BFF gates (required)

1. **Capability**: host must advertise `features.settings_patch === true` **or**
   `brain_rpc_methods` includes `settings.patch` (model/cron ops may also use
   `models` / `cron` features or `models.set_active` / `cron.patch`).
2. **BFF**: `applySettingsPatch` enforces the gate by default
   (`requireCapabilityAdvertisement: true`).
3. **UI**: do not show editor controls until the same capability is true
   (follow-on: `lp-k7g.8.5` / `lp-k7g.8.6`).
4. Expansion hosts may return `method_not_found` — map to HTTP 404 with
   `unavailable: true` so the settings UI renders empty/disabled (no crash).

## Unavailable states

| Situation | HTTP | Body |
| --- | --- | --- |
| Method not advertised / not implemented | 404 | `{ code: "method_not_found", unavailable: true, method }` |
| Brain RPC required but invoker missing / host down | 503 | `{ code: "unavailable", unavailable: true, method }` |
| Service method not wired | 400 | `{ code: "not_implemented", unavailable: true, method }` |
| Bad body / secret key / config schema fail | 400 | `{ code: "invalid_argument" }` (not unavailable) |
| Skill/cron/mcp/model not found | 404 | `{ code: "not_found" }` (not unavailable) |

`settingsErrorToHttp` sets `unavailable: true` for method_not_found,
unavailable, and not_implemented so web settings can show a clear disabled
state instead of crashing.

## Local fixtures remain test-only

| Fixture | Allowed where |
| --- | --- |
| `FakeBackendRuntimeService` | Unit / contract tests (`supportPatchSettings` opt-in) |
| Local `HermesSettingsPort` | Migration harness with `settingsRequireBrainRpc: false` — **not** production default |
| In-process fixture skill/cron overrides in real Portal | BFF integration tests only |

Production always: `createProductionHermesBackendRuntimeService({ invokeBrainRpc })`.

## Real portal paths (reference tree)

Live monorepo path: `portal/`

| Path | Role today |
| --- | --- |
| `packages/bff/src/app.ts` | `GET /settings/snapshot`, `PATCH /settings/skills|crons|mcp|models/*` |
| `packages/bff/src/settings-snapshot.ts` | Discover + redact + write Hermes config/jobs |
| `packages/bff/src/settings-discover.ts` | Filesystem walk under HERMES_HOME |
| `packages/bff/src/brain-rpc.ts` | Auth stamp + request frame builder |
| `packages/web/src/api/settings.ts` | `fetchSettingsSnapshot` / `patchSettings*` |
| `packages/web/src/features/settings/*` | Settings page UI |

### Migration steps when Portal lands

1. Add `@lanyard/backend-runtime` to Portal pnpm workspace.
2. Composition root: `createProductionHermesBackendRuntimeService({ invokeBrainRpc })`.
3. Swap `/settings/*` handlers to `createSettingsHandlers`.
4. Keep `settings-snapshot.ts` only for tests / optional offline dev flag.
5. Web: keep URLs `/api/settings/*` for wire stability; gate editor on
   `settings_patch` (`lp-k7g.8.5` / `lp-k7g.8.6`).
6. Map `settingsErrorToHttp` → UI unavailable banners on the settings page.

## Acceptance mapping

| Criterion | Evidence |
| --- | --- |
| `settings.snapshot` powers the settings page | `getSettingsSnapshot` / `createSettingsHandlers.snapshot` → `settingsSnapshot` → Brain RPC in production |
| patch methods validate through backend config schema | `validateSettingsPatchAgainstConfigSchema` + `parseSettingsPatchInput`; ops map to `skills.disabled`, `modelSettings`, `mcp_servers` |
| unavailable methods produce clear unavailable states | `settingsErrorToHttp` sets `unavailable: true` for method_not_found / unavailable / not_implemented; capability gate on patch |

## Related

- [portal-backend-runtime-service.md](portal-backend-runtime-service.md) — interface boundary
- [portal-projects-brain-rpc.md](portal-projects-brain-rpc.md) — same pattern for projects
- [backend-runtime-contract.md](backend-runtime-contract.md) — Brain RPC overview
- Phase plan: [phase-4-portal-backend-abstraction.md](../plans/0001-platform-monorepo-migration/phase-4-portal-backend-abstraction.md)
- Follow-on: [portal-capabilities-bff.md](portal-capabilities-bff.md) (`lp-k7g.8.5`); [portal-web-settings-schema.md](portal-web-settings-schema.md) (`lp-k7g.8.6`)
