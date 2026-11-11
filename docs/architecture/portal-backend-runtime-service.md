# Portal BackendRuntimeService boundary

Bead: `lp-k7g.8.1` (phase 4 — Portal backend abstraction).

## Purpose

Portal must stop importing Hermes-specific services from route handlers and UI
loaders. All host operations for health, projects, settings, vault, and
capabilities go through a single BFF interface:

```ts
interface BackendRuntimeService {
  health(ctx): Promise<BackendHealthResult>;
  listProjects(ctx, params?): Promise<ProjectsListResult>;
  createProject?(ctx, input): Promise<BackendProject>; // expansion
  settingsSnapshot(ctx, params?): Promise<SettingsSnapshot>;
  patchSettings?(ctx, input): Promise<SettingsPatchResult>; // expansion
  listVault(ctx, params?): Promise<VaultListResult>;
  statVault(ctx, params): Promise<VaultEntry>;
  readVault(ctx, params): Promise<VaultReadResult>;
  capabilities(ctx): Promise<BackendCapabilitySet>;
}
```

Package (pre-import scaffolding):
[`portal/packages/backend-runtime`](../../portal/packages/backend-runtime/).

## Why a monorepo-owned package before Portal import

Full Portal product code is not in this repository yet. Phase 4 still needs a
stable boundary that:

1. Aligns with `contracts/backend-runtime-v1` (brain-rpc + capabilities)
2. Mirrors real BFF Hermes modules under `/portal/packages/bff` today
3. Coexists with a future history-preserving import under `portal/`
4. Can be unit-tested without the full Portal pnpm graph

The package name `@lanyard/backend-runtime` is ready to join the Portal
workspace when product code lands.

## Alignment with backend-runtime-v1

| Interface area | Brain RPC / contract | Notes |
| --- | --- | --- |
| Health | `brain.health` | status `ok` \| `degraded` \| `unavailable`; checks include `backend_home_present` (preferred) and `hermes_home_present` (alias) |
| Projects | `projects.list`, `projects.create` | Empty list when store missing; create is expansion |
| Settings | `settings.snapshot`, `settings.patch` (exp.) | Always redacted; `backend_home` preferred, `hermes_home` alias; patch validates against config.schema |
| Vault | `vault.list`, `vault.stat`, `vault.read` | Vault-root-relative paths; ACL via subject path prefixes |
| Capabilities | `brain.capabilities` + manifest fallback | `BackendCapabilitySet` = capability descriptor |

Normative schemas:

- [brain-rpc.schema.json](../../contracts/backend-runtime-v1/brain-rpc.schema.json)
- [capabilities.schema.json](../../contracts/backend-runtime-v1/capabilities.schema.json)

Architecture overview: [backend-runtime-contract.md](backend-runtime-contract.md).

## Data structures (phase-4 plan)

| Type | Role |
| --- | --- |
| `BackendRuntimeService` | BFF-facing host operations API |
| `BackendCapabilitySet` | Methods, feature flags, UI affordances for gating |
| `BackendProfileRef` | Selected profile name + path prefixes (`hermesProfileAlias` during migration) |
| `BackendRuntimeContext` | Tenant/instance/user/session + profile/roles stamped by BFF |

## Hermes implementation (migration wrap)

`HermesBackendRuntimeService` is the reference adapter for existing deployments.

It does **not** re-implement Hermes SQLite/CLI/FS logic in the monorepo. It
**wraps** current Portal BFF modules via injectable ports:

| Port | Real Portal BFF module (source of truth today) | Contract method |
| --- | --- | --- |
| `projects` | `hermes-projects.ts` (`HermesProjectsService`, `$HERMES_HOME/projects.db`) | `listProjects` / `createProject` |
| `settings` | `settings-snapshot.ts` + `settings-discover.ts` | `settingsSnapshot` / `patchSettings` (test-only when `settingsRequireBrainRpc`) |
| `vault` | `vault/service.ts` + FS/fixture providers | `listVault` / `statVault` / `readVault` |
| `health` | local probes or Brain RPC | `health` |
| `invokeBrainRpc` | `brain-rpc.ts` + relay client | preferred path for all RPC methods |

Preference order when `invokeBrainRpc` is configured:

1. Brain RPC (authenticated relay) for the matching method
2. Local Hermes port (filesystem / SQLite / CLI)
3. Safe empty / degraded / `not_implemented` scaffold behavior

This keeps Hermes-Lanyard powering existing settings, projects, vault, and
health flows while callers only see `BackendRuntimeService`.

### Profile field migration

Prefer `backend_profile` / `BackendProfileRef.name` in new Portal APIs.
Accept legacy `hermes_profile` as a wire alias on Brain RPC subjects (see
brain-rpc schema `brainRpcSubject`). The adapter may set
`hermesProfileAlias` equal to `name` when stamping auth for Hermes-Lanyard.

## Tests target the interface

Unit tests live in the package and use `FakeBackendRuntimeService`:

- Required methods present (`isBackendRuntimeService`)
- Contract-shaped results for health, projects, settings, vault, capabilities
- ACL denial and not_found / invalid_argument vault errors
- Hermes adapter: port injection, Brain RPC preference, capabilities fallback

Broader fake-host harness: `lp-k7g.8.8` —
[`FakeBrainRpcInvoker`](../../portal/packages/backend-runtime/src/fake-brain-rpc.ts)
covers all seven required Brain RPC methods; integration suite
`test/fake-backend-contract.test.ts` drives settings/projects/vault BFF and
capability → UI state through production composition. Capabilities → web UI
state: `lp-k7g.8.5` ([portal-capabilities-bff.md](portal-capabilities-bff.md)).
Web settings schema descriptors: `lp-k7g.8.6`
([portal-web-settings-schema.md](portal-web-settings-schema.md)).

## Composition (after Portal import)

```text
BFF composition root
  └─ createProductionHermesBackendRuntimeService({
       invokeBrainRpc: relayBrainRpcInvoke,  // required for projects + settings
     })
  └─ createAgentProjectsHandlers(backend)
  └─ createSettingsHandlers(backend)
  └─ createContextHandlers(backend)   // GET /api/context (lp-k7g.8.5)
  └─ inject BackendRuntimeService into route modules
Web (packages/web)
  └─ buildSettingsUiSchema({ snapshot, ui, capabilities })  // lp-k7g.8.6
```

Route handlers must not import `hermes-projects` / `settings-snapshot` /
vault providers directly.

## Related work

| Bead | Follow-on |
| --- | --- |
| `lp-k7g.8.2` | Control-plane backend fields and aliases — [portal-control-plane-backend-fields.md](portal-control-plane-backend-fields.md), package [`portal/packages/control-plane-fields`](../../portal/packages/control-plane-fields/) |
| `lp-k7g.8.3` | Route projects through Brain RPC — [portal-projects-brain-rpc.md](portal-projects-brain-rpc.md), `projects-bff.ts` + `createProductionHermesBackendRuntimeService` |
| `lp-k7g.8.4` | Route settings through Brain RPC — [portal-settings-brain-rpc.md](portal-settings-brain-rpc.md), `settings-bff.ts` + config.schema validation + unavailable states |
| `lp-k7g.8.5` | Model backend capabilities in BFF responses — [portal-capabilities-bff.md](portal-capabilities-bff.md), `capabilities-bff.ts` + context payload + UI affordance derivation |
| `lp-k7g.8.6` | Web settings UI from backend schema — [portal-web-settings-schema.md](portal-web-settings-schema.md), package [`portal/packages/web-settings-schema`](../../portal/packages/web-settings-schema/) |
| `lp-k7g.8.7` | Preserve Hermes deployment compatibility — [portal-hermes-deployment-compat.md](portal-hermes-deployment-compat.md), package [`portal/packages/hermes-compat`](../../portal/packages/hermes-compat/) |
| `lp-k7g.8.8` | Broader fake backend contract tests — `fake-brain-rpc.ts` + `test/fake-backend-contract.test.ts`; web capability UI states in `@lanyard/web-settings-schema` |

Plan: [phase-4-portal-backend-abstraction.md](../plans/0001-platform-monorepo-migration/phase-4-portal-backend-abstraction.md).
