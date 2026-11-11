# Portal control-plane backend fields and aliases

Bead: `lp-k7g.8.2` (phase 4 — Portal backend abstraction).

## Purpose

Rename control-plane metadata that currently says **Hermes** so Portal can
register, pin, and authorize **any** `backend-runtime-v1` product (Hermes
upstream, Hermes-Lanyard, Lanyard Agent) without product-specific columns.

Scaffolding package:
[`portal/packages/control-plane-fields`](../../portal/packages/control-plane-fields/).

## Source of truth (current product, not yet imported)

Read from real Portal control-plane under development:

| Area | Path (product repo) | Hermes fields today |
| --- | --- | --- |
| Schema | `packages/control-plane/src/migrate.ts` | `tenant_deployments.hermes_version`, `roles.hermes_profile` |
| Types | `packages/control-plane/src/types.ts` | `TenantDeployment.hermes_version`, `Role.hermes_profile`, `UserRbac.hermes_profile` |
| Deployment registry | `packages/control-plane/src/deployment-registry.ts` | read/write `hermes_version` |
| RBAC | `packages/control-plane/src/rbac.ts` | create/list/get use `hermes_profile` |
| HTTP | `packages/control-plane/src/app.ts` | Zod: `hermes_version`, `hermes_profile`; JSON bodies pass them through |

## Preferred field model

| Preferred name | Type | Table / object | Legacy alias | Notes |
| --- | --- | --- | --- | --- |
| `backend_kind` | `hermes_upstream` \| `hermes_lanyard` \| `lanyard_agent` \| null | `tenant_deployments` | — | New. Matches artifact `kind` / pin `backend.kind`. |
| `backend_version` | string \| null | `tenant_deployments` | `hermes_version` | Preferred pin version; dual-write both columns. |
| `backend_capabilities` | JSON object \| null | `tenant_deployments` | — | Cached capability **snapshot** for registry/UI. Live discovery remains `BackendRuntimeService.capabilities()` / Brain RPC. |
| `backend_profile` | string (required on roles) | `roles`, `UserRbac` | `hermes_profile` | Maps to Brain RPC `auth.subject.backend_profile` (preferred) with `hermes_profile` still stamped for Hermes-Lanyard. |

Catalog constants: `PREFERRED_BACKEND_FIELDS`, `LEGACY_HERMES_ALIASES`,
`FIELD_MIGRATION_MAP` in the package.

### What `backend_capabilities` is (and is not)

| Is | Is not |
| --- | --- |
| Install/registry claim of host ability (methods, features, UI affordances) | Session ACL / path prefixes |
| Optional snapshot written at pin apply or health observe | Live substitute for `brain.capabilities` |
| Aligns with `capabilities.schema.json` `#/$defs/capabilityDescriptor` | Full Brain RPC result envelope |

BFF still calls `BackendRuntimeService.capabilities()` for runtime gating
(`lp-k7g.8.5`). Control-plane storage is for operator inventory and cold start.

### What `backend_profile` is

Named capability bundle on the **role** (admin, contributor, team-a, …), not
the deployment pin. Effective user profile is still “first assigned role’s
profile” as today in `getUserRbac`. Path prefixes stay on `role_path_prefixes`.

## Schema migration plan

Executable stubs: `CONTROL_PLANE_BACKEND_FIELD_MIGRATION` /
`ENSURE_OPTIONAL_COLUMN_STATEMENTS` /
`migrationSqlForApply()` in
[`portal/packages/control-plane-fields/src/migration.ts`](../../portal/packages/control-plane-fields/src/migration.ts).

### Phase A — Additive columns (this bead; apply after Portal import)

```sql
ALTER TABLE tenant_deployments ADD COLUMN IF NOT EXISTS backend_kind TEXT;
ALTER TABLE tenant_deployments ADD COLUMN IF NOT EXISTS backend_version TEXT;
ALTER TABLE tenant_deployments ADD COLUMN IF NOT EXISTS backend_capabilities TEXT;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS backend_profile TEXT;
```

Merge into product `ensureOptionalColumns` (same try/catch `42701` pattern as
existing gateway_instances upgrades) **or** use `IF NOT EXISTS` when the
Postgres version allows.

### Phase B — Backfill both directions

```sql
UPDATE tenant_deployments
SET backend_version = hermes_version
WHERE backend_version IS NULL AND hermes_version IS NOT NULL;

UPDATE tenant_deployments
SET hermes_version = backend_version
WHERE hermes_version IS NULL AND backend_version IS NOT NULL;

UPDATE roles
SET backend_profile = hermes_profile
WHERE backend_profile IS NULL AND hermes_profile IS NOT NULL;

UPDATE roles
SET hermes_profile = backend_profile
WHERE (hermes_profile IS NULL OR hermes_profile = '')
  AND backend_profile IS NOT NULL;
```

Optional:

```sql
ALTER TABLE tenant_deployments
ADD CONSTRAINT tenant_deployments_backend_kind_check
CHECK (
  backend_kind IS NULL OR backend_kind IN (
    'hermes_upstream', 'hermes_lanyard', 'lanyard_agent'
  )
);
```

### Phase C — Application dual-write / dual-read (scaffolded now)

| Operation | Behavior |
| --- | --- |
| Write deployment version | `parseDeploymentUpsertInput` → set **both** `backend_version` and `hermes_version` |
| Write role profile | `parseRoleCreateInput` → set **both** `backend_profile` and `hermes_profile` |
| Read any row | `resolveBackendVersion` / `resolveBackendProfile` coalesce preferred \|\| legacy |
| Conflicting pair | `AliasConflictError` → HTTP 400 |
| JSON response | `toDeploymentApiResponse` / `toRoleApiResponse` / `toUserRbacApiResponse` **dual-emit** preferred + hermes_* |

Greenfield CREATE TABLE should list preferred columns first and keep hermes_*
as documented temporary columns (`GREENFIELD_*_BACKEND_COLUMNS`).

### Phase D — Alias retirement (NOT this bead)

**Criteria defined** in `lp-k7g.8.7`
([portal-hermes-deployment-compat.md](portal-hermes-deployment-compat.md),
`@lanyard/hermes-compat` `HERMES_COMPAT_REMOVAL_CRITERIA` surfaces
`control_plane` + `wire_field`). **Execution** is phase 8 / dedicated cutover:

- Stop accepting `hermes_version` / `hermes_profile` on write (or accept-only
  with deprecation headers)
- Stop dual-emitting legacy keys on read
- `ALTER TABLE … DROP COLUMN hermes_version` / `hermes_profile`

Migration steps marked `phase: "cutover_later"` are comments only and must not
run in apply scripts today.

## API response shapes (backend-neutral names)

### `GET/PUT /tenants/:id/deployment`

```json
{
  "tenant_id": "…",
  "hosting_track": "lanyard_hosted",
  "isolation_mode": "account",
  "client_core_version": "v1.0.0",
  "backend_kind": "hermes_lanyard",
  "backend_version": "v0.1.0-g7h2",
  "backend_capabilities": {
    "schema_version": 1,
    "kind": "hermes_lanyard",
    "brain_rpc_methods": ["brain.health", "vault.read"]
  },
  "hermes_version": "v0.1.0-g7h2",
  "status": "active"
}
```

- **Required for new clients:** `backend_kind`, `backend_version`,
  `backend_capabilities` (nullable values OK).
- **Temporary:** `hermes_version` equals effective `backend_version`.

### `POST /tenants/:id/roles` body

Accepts either:

```json
{ "name": "Admin", "backend_profile": "admin", "path_prefixes": ["/"] }
```

or legacy:

```json
{ "name": "Admin", "hermes_profile": "admin", "path_prefixes": ["/"] }
```

### Role / UserRbac responses

```json
{
  "role_id": "…",
  "name": "Admin",
  "backend_profile": "admin",
  "hermes_profile": "admin",
  "path_prefixes": ["/"]
}
```

```json
{
  "user_id": "…",
  "tenant_id": "…",
  "backend_profile": "contributor",
  "hermes_profile": "contributor",
  "allowed_path_prefixes": ["/docs"],
  "role_names": ["Contributor"]
}
```

Internal BFF route `GET /internal/tenants/:tenantId/users/:userId/rbac` must
expose `backend_profile` so Brain RPC subjects can stamp preferred + legacy
(`lp-k7g.8.1` `BackendProfileRef` / `hermesProfileAlias`).

## Integration after Portal import

```text
portal/packages/control-plane/
  src/migrate.ts              ← merge ENSURE_OPTIONAL_COLUMN_STATEMENTS + backfill
  src/types.ts                ← TenantDeployment + Role use preferred fields
  src/deployment-registry.ts  ← dual-write version/kind/capabilities
  src/rbac.ts                 ← dual-write backend_profile
  src/app.ts                  ← Zod accept both; responses via to*ApiResponse
  package.json                ← optional dep on @lanyard/control-plane-fields
```

Composition with backend-runtime:

```text
control-plane UserRbac.backend_profile
  → BFF stamps BackendRuntimeContext.profile.name
  → Hermes adapter may set hermesProfileAlias = name
  → Brain RPC subject: backend_profile + hermes_profile
```

## Verification (offline, pre-import)

```bash
cd portal/packages/control-plane-fields
npm install
npm test
npm run build
```

Acceptance mapping:

| Criterion | Evidence |
| --- | --- |
| schema migration is planned | `migration.ts` + this doc Phases A–D |
| old fields have explicit aliases or migration path | `PREFERRED_TO_LEGACY_ALIAS`, dual-write helpers, backfill SQL |
| API responses expose backend-neutral names | `toDeploymentApiResponse`, `toRoleApiResponse`, `toUserRbacApiResponse` |

## Related work

| Bead | Follow-on |
| --- | --- |
| `lp-k7g.8.1` | BackendRuntimeService interface (done scaffolding) |
| `lp-k7g.8.2` | **This document** — control-plane fields + aliases |
| `lp-k7g.8.3` | Route projects through Brain RPC (uses profile from CP) |
| `lp-k7g.8.5` | Model backend capabilities in BFF responses (live, not only CP snapshot) |
| `lp-k7g.8.7` | Preserve Hermes compatibility; removal criteria for later alias retirement — [portal-hermes-deployment-compat.md](portal-hermes-deployment-compat.md) |

Plan: [phase-4-portal-backend-abstraction.md](../plans/0001-platform-monorepo-migration/phase-4-portal-backend-abstraction.md).
