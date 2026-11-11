# Phase 4. Portal backend abstraction

Back to [overview](overview.md).

## Goal

Move Portal from Hermes-specific assumptions to a backend runtime interface.

Bead: `lp-k7g.8`.

## Changes

- Rename or wrap control-plane fields that currently say Hermes.
- Replace local Hermes project reads with backend project operations.
- Route settings snapshot and patch operations through Brain RPC.
- Represent backend capabilities in BFF and web UI state.
- Keep compatibility aliases during migration where they protect existing deployments.
- Add tests that prove the UI works through the backend contract.

## Data structures

- `BackendRuntimeService`: health, projects, settings, vault, capabilities.
- `BackendCapabilitySet`: supported host operations and UI affordances.
- `BackendProfileRef`: selected profile name and allowed path prefixes.
- Control-plane preferred fields: `backend_kind`, `backend_version`,
  `backend_profile`, `backend_capabilities` (with `hermes_*` aliases).

Scaffolding (pre-import):

| Package | Bead | Role |
| --- | --- | --- |
| [`portal/packages/backend-runtime`](../../../portal/packages/backend-runtime/) | `lp-k7g.8.1`, `lp-k7g.8.3`, `lp-k7g.8.4`, `lp-k7g.8.5`, `lp-k7g.8.8` | Interface, Hermes adapter, fake backend + **FakeBrainRpcInvoker**, **agent projects + settings BFF → Brain RPC**, **capabilities → `/api/context` UI state**, **contract harness tests** |
| [`portal/packages/control-plane-fields`](../../../portal/packages/control-plane-fields/) | `lp-k7g.8.2` | CP field types, aliases, migration SQL stubs, API mappers |
| [`portal/packages/web-settings-schema`](../../../portal/packages/web-settings-schema/) | `lp-k7g.8.6`, `lp-k7g.8.8` | Pure web settings control descriptors from **config.schema categories + snapshot + capabilities** (disabled reasons); **capability-driven UI state tests** |
| [`portal/packages/hermes-compat`](../../../portal/packages/hermes-compat/) | `lp-k7g.8.7` | **Hermes deployment compatibility**: `HERMES_*` → `BACKEND_*` env aliases, `/hermes/*` deprecation notes, removal criteria checklist |

Boundary design:

- [portal-backend-runtime-service.md](../../architecture/portal-backend-runtime-service.md)
- [portal-control-plane-backend-fields.md](../../architecture/portal-control-plane-backend-fields.md)
- [portal-projects-brain-rpc.md](../../architecture/portal-projects-brain-rpc.md) (`lp-k7g.8.3`: `projects.list` via Brain RPC; `projects.create` contract + capability gate; fixtures test-only)
- [portal-settings-brain-rpc.md](../../architecture/portal-settings-brain-rpc.md) (`lp-k7g.8.4`: `settings.snapshot` via Brain RPC; `settings.patch` + config.schema validation; unavailable states)
- [portal-capabilities-bff.md](../../architecture/portal-capabilities-bff.md) (`lp-k7g.8.5`: capability set on context payload; UI affordance derivation; soft-fail discovery)
- [portal-web-settings-schema.md](../../architecture/portal-web-settings-schema.md) (`lp-k7g.8.6`: web settings UI from backend schema; disabled reasons)
- [portal-hermes-deployment-compat.md](../../architecture/portal-hermes-deployment-compat.md) (`lp-k7g.8.7`: env aliases, endpoint deprecation, removal criteria)

## Verification

- Portal works with a fake backend implementing the contract.
- Hermes-Lanyard still powers existing settings, projects, vault, and chat flows.
- Unsupported backend capabilities render unavailable states instead of crashing.
- Control-plane dual-emits preferred + `hermes_*` fields; schema migration plan exists.
- Settings UI descriptors gate model/skills/cron on capabilities with disabled reasons.

Offline package checks (before full Portal import):

```bash
cd portal/packages/backend-runtime && npm install && npm test && npm run build
cd portal/packages/control-plane-fields && npm install && npm test && npm run build
cd portal/packages/web-settings-schema && npm install && npm test && npm run build
cd portal/packages/hermes-compat && npm install && npm test && npm run build
```
