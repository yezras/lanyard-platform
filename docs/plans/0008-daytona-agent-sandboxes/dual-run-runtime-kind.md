# Dual-run: per-instance `runtime_kind` (lp-gu2)

**Bead:** `lp-gu2` (Phase 7 dual-run migration under `lp-0pr`)  
**Depends on:** CP model fields (`lp-nye`), dual-path plumbing (`lp-kng.2.11`), daytona provision (`lp-6jx`)  
**Related cutover leaves:** vault copy (`lp-3ux`), cutover checklist (`lp-6h8`), rollback (`lp-ky7`), EC2 decommission (`lp-u00`)

## What dual-run is

Dual-run means **some gateway instances run the EC2 always-on path and others run the Daytona on-demand path at the same time**, in the same environment.

The switch is the **per-instance field** on `gateway_instances`:

| Field | Values | Meaning |
|-------|--------|---------|
| `runtime_kind` | `ec2` (default) \| `daytona` | Compute path for that instance |

This is a **per-tenant / per-instance feature field**, not a single global product cutover.

```text
Tenant A instance  → runtime_kind=ec2      → always-on host path (no Daytona)
Tenant B instance  → runtime_kind=daytona  → ensure_online → Fake/live Daytona
```

No global config change is required for those two paths to coexist. Operators set `runtime_kind` at provision (or via registry update for pilot cutover/rollback prep).

## What dual-run is not

| Not dual-run | Why |
|--------------|-----|
| Flipping `DAYTONA_ENABLED` for the whole platform as the *only* cutover | That gate enables the managed Daytona client path; it does **not** flip every tenant’s compute. Instances with `runtime_kind=ec2` stay on the EC2 path. |
| Mutating `runtime_kind` inside `ensure_online` / `stop` | Dual-path plumbing **never** flips kind as a side-effect (`assertRuntimeKindUnchanged`). |
| One Terraform apply that migrates all tenants | §4.11: daytona tenants skip company-brain EC2 TF; EC2 tenants keep their stack. |

Platform env knobs (`DAYTONA_ENABLED`, `DAYTONA_TENANT_ALLOWLIST`) are **safety gates** on the daytona *orchestration path*. They can deny wake for a daytona-kind instance without changing the stored field. They are not a substitute for per-instance `runtime_kind`.

## Operator surfaces

| Action | How |
|--------|-----|
| **Set path at provision** | `POST /tenants/:id/instances/register` (or `…/provision`) with body `{ "runtime_kind": "ec2" \| "daytona", … }` |
| **Default** | Omit body → `runtime_kind=ec2` (existing product path) |
| **Daytona CP-first** | `runtime_kind=daytona` → assigns `s3_vault_prefix`, `sandbox_id=null`, no EC2, no Daytona create at provision ([provision-runbook-daytona.md](./provision-runbook-daytona.md), `lp-6jx`) |
| **Dual-run update** | `PATCH /tenants/:id/instances/:instanceId/registry` with `{ "runtime_kind": "daytona" \| "ec2", … }` (and related fields: prefix / snapshot for daytona). Used for pilot cutover/rollback prep; full checklists are `lp-6h8` / `lp-ky7`. |
| **Read path** | `GET /internal/instances/:instanceId/presence` (and list/registry reads) returns `runtime_kind` |

Store helpers: `ControlPlaneStore.provisionInstance({ runtime_kind })`, `provisionDaytonaInstance`, `updateInstanceRegistry({ runtime_kind })`.

## Runtime branch (product)

```text
ensure_online(instance_id)
  ├─ runtime_kind=ec2      → short-circuit already-online (no Daytona)
  └─ runtime_kind=daytona  → wake via Instance Orchestrator (+ optional enable/allowlist gate)

stop(instance_id)
  ├─ runtime_kind=ec2      → no-op (always-on host stays up)
  └─ runtime_kind=daytona  → stop/clear ephemeral sandbox only
```

Idle reaper and mid-turn protection only target `runtime_kind=daytona`.

## Tests (acceptance evidence)

| Suite | Proof |
|-------|-------|
| `portal/packages/control-plane/test/runtime-kind-dual-run.test.ts` | Field switches path; two tenants coexist on real harness + store; no global cutover; registry update path |
| `portal/packages/control-plane/test/runtime-path.test.ts` | Pure dual-path decisions + real harness coexistence (lp-kng.2.11) |
| `portal/packages/control-plane/test/provision-daytona.test.ts` | Provision fields for daytona vs ec2 (lp-6jx) |

Postgres store cases in `runtime-kind-dual-run.test.ts` run when `CONTROL_PLANE_DATABASE_URL` or `DATABASE_URL` is set; offline real harness cases always run in CI.

## Out of scope for this bead

- Vault host-disk → S3 copy tool/runbook → **`lp-3ux`** (delivered): [vault-ec2-to-s3-copy.md](./vault-ec2-to-s3-copy.md) + `deploy/scripts/copy-vault-ec2-to-s3.sh`
- Full pilot cutover checklist → **`lp-6h8`**: [cutover-ec2-to-daytona.md](./cutover-ec2-to-daytona.md) + `deploy/scripts/smoke-cutover-ec2-to-daytona.sh`
- Rollback (flip back to EC2 + stop sandbox) procedure → `lp-ky7`
- Decommission EC2 for migrated tenants → `lp-u00`
- Live staging cutover (operator hold / Relay DNS residuals still apply)

## See also

- Deploy split §4.11: [overview.md](./overview.md)
- Identity model: [identity-model.md](./identity-model.md)
- Vault EC2 → S3 copy (pilot): [vault-ec2-to-s3-copy.md](./vault-ec2-to-s3-copy.md) (`lp-3ux`)
- Cutover checklist (keep credentials): [cutover-ec2-to-daytona.md](./cutover-ec2-to-daytona.md) (`lp-6h8`)
- Dual-path plumbing: `portal/packages/control-plane/src/runtime-path.ts` (`lp-kng.2.11`)
- Registry columns: [portal/docs/deployment-resource-registry.md](../../../portal/docs/deployment-resource-registry.md)

- Rollback: [rollback-daytona-to-ec2.md](./rollback-daytona-to-ec2.md) (`lp-ky7`)
