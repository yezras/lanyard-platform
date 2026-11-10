# `@lanyard/backend-runtime`

Portal BFF **backend runtime service boundary** for swappable backend agents.

Beads: `lp-k7g.8.1` (interface), `lp-k7g.8.3` (projects via Brain RPC),
`lp-k7g.8.4` (settings via Brain RPC), `lp-k7g.8.5` (capabilities in BFF context),
`lp-k7g.8.8` (fake backend contract tests).
Web settings descriptors: sibling package `@lanyard/web-settings-schema`
(`lp-k7g.8.6`).

## Why this package exists

Today Portal BFF imports Hermes-specific modules directly (`hermes-projects`,
local settings discovery, FS vault providers). Phase 4 moves those calls
behind a single TypeScript interface so:

- Route handlers depend on `BackendRuntimeService`, not Hermes types
- Tests can target a fake backend implementing the same surface
- Hermes-Lanyard remains the migration adapter (wraps current behavior)
- Lanyard Agent and other `backend-runtime-v1` hosts plug in later

## Layout

```text
portal/packages/backend-runtime/
  src/
    service.ts              # BackendRuntimeService interface
    types.ts                # health, projects, settings, vault, capabilities
    errors.ts               # BackendRuntimeError + HTTP mapping
    hermes-adapter.ts       # HermesBackendRuntimeService (migration wrap)
    projects-bff.ts         # Thin BFF agent-projects handlers (Brain RPC path)
    settings-bff.ts         # Thin BFF settings snapshot/patch (Brain RPC path)
    capabilities-bff.ts     # GET /api/context: capabilities → UI state
    fake-backend.ts         # FakeBackendRuntimeService (tests only; writeVault→ledger lp-ye4.8)
    fake-runtime-ledger.ts  # In-memory signed-op ledger + heads (lp-ye4.6)
    history-bff.ts          # history.list / heads.* BFF adapters (lp-ye4.7)
    fake-brain-rpc.ts       # FakeBrainRpcInvoker — required Brain RPC methods
    signed-operation.ts     # Ledger domain types + parse (lp-ye4.5)
    access-grant.ts         # Access grant domain + validate (lp-ye4.9)
    access-grant-bff.ts     # BFF stamp / never trust client ACL (lp-ye4.9)
    capability-defaults.ts  # Static Hermes-Lanyard capability defaults
    index.ts
  test/
    backend-runtime-service.test.ts
    projects-bff.test.ts
    settings-bff.test.ts
    capabilities-bff.test.ts
    fake-backend-contract.test.ts   # lp-k7g.8.8 harness
    signed-operation.test.ts        # lp-ye4.5 domain
    fake-runtime-ledger.test.ts     # lp-ye4.6 ledger/heads
    history-bff.test.ts             # lp-ye4.7 history/head RPC + ACL
    vault-bff.test.ts               # vault.write + commit ledger (lp-ye4.8)
    access-grant.test.ts            # grants + unknown-agent identity (lp-ye4.9)
```

This tree is **pre-import scaffolding**. Full Portal product code is not in
this monorepo yet. The package lives under `portal/packages/` so a future
history-preserving Portal import coexists: add this package to the Portal
pnpm workspace (`portal/pnpm-workspace.yaml`) when the product lands.

## Interface surface

| Method | Contract op | Domain |
| --- | --- | --- |
| `health` | `brain.health` | Host readiness |
| `listProjects` | `projects.list` | Agent projects |
| `createProject?` | `projects.create` (expansion) | Create project |
| `settingsSnapshot` | `settings.snapshot` | Redacted settings (settings page) |
| `patchSettings?` | `settings.patch` (expansion) | Skill/cron/MCP/model patches |
| `listVault` / `statVault` / `readVault` | `vault.*` | Vault browser |
| `capabilities` | `brain.capabilities` / pin fallback | Feature gating |
| `listHistory?` | `history.list` (expansion) | Artifact signed-op history |
| `readArtifactHead?` | `heads.artifact` (expansion) | File current head |
| `readWorkspaceHead?` | `heads.workspace` (expansion) | Workspace tree head |

Normative schemas:

- [`contracts/backend-runtime-v1/brain-rpc.schema.json`](../../../contracts/backend-runtime-v1/brain-rpc.schema.json)
- [`contracts/backend-runtime-v1/capabilities.schema.json`](../../../contracts/backend-runtime-v1/capabilities.schema.json)

Design docs:

- [`docs/architecture/portal-backend-runtime-service.md`](../../../docs/architecture/portal-backend-runtime-service.md)
- [`docs/architecture/portal-projects-brain-rpc.md`](../../../docs/architecture/portal-projects-brain-rpc.md) (`lp-k7g.8.3`)
- [`docs/architecture/portal-settings-brain-rpc.md`](../../../docs/architecture/portal-settings-brain-rpc.md) (`lp-k7g.8.4`)
- [`docs/architecture/portal-capabilities-bff.md`](../../../docs/architecture/portal-capabilities-bff.md) (`lp-k7g.8.5`)

## Agent projects BFF routing (`lp-k7g.8.3`)

Use **`listAgentProjects` / `createAgentProject`** (or
`createAgentProjectsHandlers`) from route modules — never import
`hermes-projects.ts` in handlers.

Production composition:

```ts
import {
  createProductionHermesBackendRuntimeService,
  createAgentProjectsHandlers,
} from "@lanyard/backend-runtime";

const backend = createProductionHermesBackendRuntimeService({
  invokeBrainRpc: relayInvoke, // required — projects.list via Brain RPC
});
const agentProjects = createAgentProjectsHandlers(backend);
// GET  /hermes/projects → agentProjects.list(ctx)
// POST /hermes/projects → agentProjects.create(ctx, body)  // gated on projects_create
```

- **`projects.list`**: required v1; production uses Brain RPC only
  (`projectsRequireBrainRpc` defaults true when invoker is set).
- **`projects.create`**: expansion contract is defined
  (`params_projects_create` / `result_projects_create`); BFF refuses create
  unless capabilities advertise it. UI must gate before enablement.
- **Fixtures** (`FakeBackendRuntimeService`, memory projects stores): **test-only**.

## Settings BFF routing (`lp-k7g.8.4`)

Use **`getSettingsSnapshot` / `applySettingsPatch`** (or
`createSettingsHandlers`) from route modules — never import
`settings-snapshot.ts` / `settings-discover.ts` in handlers.

Production composition:

```ts
import {
  createProductionHermesBackendRuntimeService,
  createSettingsHandlers,
} from "@lanyard/backend-runtime";

const backend = createProductionHermesBackendRuntimeService({
  invokeBrainRpc: relayInvoke, // required — settings.snapshot via Brain RPC
});
const settings = createSettingsHandlers(backend);
// GET   /settings/snapshot           → settings.snapshot(ctx)
// PATCH /settings/skills/:id         → settings.patchSkill(ctx, id, body)
// PATCH /settings/crons/:id          → settings.patchCron(ctx, id, body)
// PATCH /settings/mcp/:name          → settings.patchMcp(ctx, name, body)
// PATCH /settings/models/active      → settings.patchActiveModel(ctx, body)
```

- **`settings.snapshot`**: required v1; production uses Brain RPC only
  (`settingsRequireBrainRpc` defaults true when invoker is set). Powers the
  settings page.
- **`settings.patch`**: expansion contract is defined
  (`params_settings_patch` / `result_settings_patch`); BFF validates ops
  against `config.schema.json` surfaces and refuses patch unless capabilities
  advertise it. UI must gate before enablement.
- **Unavailable**: `settingsErrorToHttp` sets `unavailable: true` for
  method_not_found / unavailable / not_implemented so the UI can render
  empty/disabled states without crashing.
- **Fixtures** (`FakeBackendRuntimeService` with optional
  `supportPatchSettings`): **test-only**.

## Backend capabilities in BFF context (`lp-k7g.8.5`)

Use **`getPortalContext`** / **`createContextHandlers`** so web can gate UI
on capabilities without `backend_kind` conditionals.

Production composition:

```ts
import {
  createProductionHermesBackendRuntimeService,
  createContextHandlers,
} from "@lanyard/backend-runtime";

const backend = createProductionHermesBackendRuntimeService({
  invokeBrainRpc: relayInvoke,
});
const context = createContextHandlers(backend);
// GET /api/context → context.get(ctx)
// body.backend_capabilities  — capabilityDescriptor (+ complete ui_affordances)
// body.ui.can.settings_edit  — supported-only booleans for feature panels
// body.capabilities_degraded — true when live discovery soft-failed
```

- **Live path:** `BackendRuntimeService.capabilities` → Brain RPC
  `brain.capabilities` when available.
- **Fallback:** artifact/static descriptor when method is missing; static
  defaults if the service throws. **Context always returns a usable payload**
  (discovery failures do not crash the request).
- **UI derivation:** `deriveUiAffordances` implements
  `capabilities.schema.json` `x-lanyard-ui-affordance-catalog.derivation`.
- **Helpers:** `uiStateFromCapabilities`, `isAffordanceSupported` /
  `isAffordanceUnsupported` for web modules after import.

## Hermes migration adapter

`HermesBackendRuntimeService` documents the wrap of current BFF modules:

| Port | Current BFF module (when Portal imported) | Production |
| --- | --- | --- |
| `invokeBrainRpc` | `packages/bff/src/brain-rpc.ts` + relay client | **Required** for projects + settings |
| `projects` | `packages/bff/src/hermes-projects.ts` | Test / migration only |
| `settings` | `packages/bff/src/settings-snapshot.ts` | Test / migration only |
| `vault` | `packages/bff/src/vault/service.ts` | Prefer RPC |

Prefer Brain RPC when `invokeBrainRpc` is provided. For production projects
and settings, use `createProductionHermesBackendRuntimeService` so local
`projects.db` / `config.yaml` are never consulted.

## Develop

Self-contained — no full Portal monorepo install required:

```bash
cd portal/packages/backend-runtime
npm install
npm test
npm run build
```

## Related beads

- `lp-k7g.8.2` — control-plane backend fields and aliases
- `lp-k7g.8.3` — route projects through Brain RPC
- `lp-k7g.8.4` — route settings through Brain RPC (this package + contract)
- `lp-k7g.8.5` — model backend capabilities in BFF responses (this package:
  `capabilities-bff.ts` + context payload)
- `lp-k7g.8.6` — web settings UI backend schema
- `lp-k7g.8.8` — fake backend contract tests (this package: `fake-brain-rpc.ts` +
  `test/fake-backend-contract.test.ts`; web capability UI states in
  `@lanyard/web-settings-schema`)

## Fake backend contract harness (`lp-k7g.8.8`)

Offline, fast proof that Portal BFF paths work against the contract — not
Hermes internals:

```ts
import {
  createFakeBrainRpcInvoker,
  createProductionHermesBackendRuntimeService,
  createSettingsHandlers,
  createAgentProjectsHandlers,
  createContextHandlers,
  REQUIRED_BRAIN_RPC_METHODS,
} from "@lanyard/backend-runtime";

const invoke = createFakeBrainRpcInvoker({
  projects: [{ id: "p1", name: "Legal", primary_path: "/Projects/Legal" }],
  files: [{ path: "/Projects/Legal/memo.md", content: "# Memo\n" }],
  supportPatchSettings: true,
});
// All seven required methods: brain.ping/health, vault.*, settings.snapshot, projects.list
const backend = createProductionHermesBackendRuntimeService({
  invokeBrainRpc: invoke,
});
const settings = createSettingsHandlers(backend);
const projects = createAgentProjectsHandlers(backend);
const context = createContextHandlers(backend);
// GET settings / projects / vault / context → fake host only
```

Contract suite: `npm test` → `test/fake-backend-contract.test.ts`.
