# `@lanyard/control-plane-fields`

Backend-neutral **control-plane field types**, temporary **`hermes_*` aliases**,
API response mappers, and **schema migration stubs**.

Bead: `lp-k7g.8.2` (phase 4 — Portal backend abstraction).

## Why this package exists

Today Portal control-plane stores Hermes-named fields:

| Table | Current column | Problem |
| --- | --- | --- |
| `tenant_deployments` | `hermes_version` | Product-specific; cannot represent Lanyard Agent cleanly |
| `roles` | `hermes_profile` | Brain RPC subject still stamps Hermes naming |
| (none) | — | No `backend_kind` or cached `backend_capabilities` |

Phase 4 needs control-plane to speak the same backend-neutral vocabulary as
`contracts/backend-runtime-v1` and `@lanyard/backend-runtime` **before** the
full Portal import lands.

## Preferred fields

| Preferred | Legacy alias | Where |
| --- | --- | --- |
| `backend_kind` | *(none — new)* | `tenant_deployments` |
| `backend_version` | `hermes_version` | `tenant_deployments` |
| `backend_capabilities` | *(none — new)* | `tenant_deployments` (JSON TEXT snapshot) |
| `backend_profile` | `hermes_profile` | `roles`, `UserRbac` |

API responses **dual-emit** preferred + legacy names during the migration
window. Writes accept either name; conflicting pairs return `ALIAS_CONFLICT`.

## Layout

```text
portal/packages/control-plane-fields/
  src/
    types.ts       # BackendKind, deployment/role field types, catalogs
    aliases.ts     # dual-read / dual-write + conflict errors
    api-shape.ts   # request parse + response mappers
    migration.ts   # SQL migration plan + ensureOptionalColumns stubs
    index.ts
  test/
    control-plane-fields.test.ts
```

Pre-import scaffolding only. After Portal import, fold helpers into
`portal/packages/control-plane` (or keep this package as a shared dependency
of control-plane + BFF).

## Schema migration (planned)

See `CONTROL_PLANE_BACKEND_FIELD_MIGRATION` and design doc:

[`docs/architecture/portal-control-plane-backend-fields.md`](../../../docs/architecture/portal-control-plane-backend-fields.md)

Phases:

1. **add_columns** — `backend_kind`, `backend_version`, `backend_capabilities`, `backend_profile`
2. **backfill** — copy hermes_* ↔ preferred both directions where null
3. **constraints** — optional CHECK on `backend_kind`
4. **cutover_later** — drop `hermes_*` columns (criteria in `lp-k7g.8.7` / `@lanyard/hermes-compat`; execute phase 8)

## Develop

```bash
cd portal/packages/control-plane-fields
npm install
npm test
npm run build
```

## Related

- `@lanyard/backend-runtime` — BFF host ops interface (`lp-k7g.8.1`)
- Real control-plane (external until import): `packages/control-plane` types /
  `migrate.ts` / `deployment-registry.ts` / `rbac.ts`
- `lp-k7g.8.7` — preserve Hermes deployment compatibility / removal criteria (`@lanyard/hermes-compat`)
