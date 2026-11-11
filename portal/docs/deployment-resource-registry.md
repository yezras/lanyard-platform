# Deployment / resource registry (cbd-mta.3.3)

**Status:** Product schema + store + API implemented.  
**DDL authority:** `packages/control-plane/src/migrate.ts`  
**Store:** `packages/control-plane/src/deployment-registry.ts` + `ControlPlaneStore`  
**Cross-repo contract (deploy authority):**  
[company-brain-deploy `references/deployment-resource-registry.md`](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/deployment-resource-registry.md)

---

## Purpose

Store **enough non-secret AWS/deployment metadata** in the central control-plane Postgres to:

- route Portal traffic to the right gateway instance
- operate tenants (hosting track, account/region, pin versions, health)
- audit control-plane mutations

…**without** duplicating Terraform state, credentials, or Company Brain vault bodies.

| Stable CP IDs (authority) | AWS IDs (metadata only) |
|---------------------------|-------------------------|
| `tenant_id`, `instance_id` | `i-…`, `vol-…`, account numbers, ARNs |
| Used for authz / Brain RPC subject | Used for ops inventory; **never** auth |

Canonical vault bytes remain on the customer host via **Brain RPC**  
(deploy [`references/brain-rpc-contract.md`](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/brain-rpc-contract.md)).

---

## Doctrine: registry ≠ Terraform state

| Registry may hold | Registry must **not** hold |
|-------------------|----------------------------|
| Hosting track / isolation mode | `*.tfstate`, plan files, provider credentials |
| AWS account id + region (metadata) | Long-lived access keys or session tokens |
| Project name / artifact **versions** | Full artifact tarballs or image layers |
| Resource **refs** (`aws_id`, `arn`) | Resource graphs that replace per-tenant backends |
| Secret **ARN** / SSM parameter ARN | Reusable plaintext secrets or secret JSON |
| Health / last-seen / rotation timestamps | Vault file bodies, chat transcripts |
| Redacted audit metadata | Secrets or vault bodies in `metadata_json` |

Detailed dependency graphs stay in **per-tenant Terraform backends**. The control plane holds a **minimal inventory** for routing and ops.

---

## Tables

### `tenant_deployments` (1 row per tenant)

| Column | Meaning |
|--------|---------|
| `tenant_id` | PK / FK → `tenants` |
| `hosting_track` | `lanyard_hosted` \| `customer_account` |
| `isolation_mode` | `account` \| `vpc_interim` \| `customer_account` |
| `aws_account_id` | Optional 12-digit account (metadata) |
| `aws_region` | Primary region |
| `project_name` | Deploy name prefix |
| `status` | `registered` → `active` → `offboarding` / `retired` |
| `client_core_version` / `hermes_version` | Pin **versions** only |
| `primary_instance_id` | Soft ref to `gateway_instances` (same tenant) |

### `tenant_resource_refs`

| Column | Meaning |
|--------|---------|
| `resource_ref_id` | PK |
| `tenant_id` | FK (required) |
| `resource_kind` | `ec2_instance`, `ebs_volume`, `kms_key`, `ssm_parameter`, … |
| `name` | Stable ops name within tenant + kind |
| `aws_id` / `arn` | Non-secret identifiers |
| `secret_arn` | **ARN only** for secret containers |
| `status` | `active` \| `replaced` \| `retired` |
| `last_seen_at` | Optional health observation |
| `metadata_json` | Redacted non-secret tags only |

### `gateway_instances` registry columns (additive)

`label`, `last_seen_at`, `health_status`, `credential_rotated_at`,  
`secret_param_arn` (ARN ref), `ec2_instance_id`, `aws_region`  
alongside existing credential **hashes** (G2).

**Daytona dual-run fields (`lp-nye` / plan §2.3):**

| Column | Meaning |
|--------|---------|
| `runtime_kind` | `ec2` (default) \| `daytona` — compute path (**per-instance dual-run switch**, `lp-gu2` — not a global-only cutover) |
| `sandbox_id` | Ephemeral Daytona handle; null when offline; **not** Relay identity |
| `presence` | `offline` \| `waking` \| `online` \| `error` (state machine: `lp-eya` / `docs/plans/0008-daytona-agent-sandboxes/presence-state-machine.md`) |
| `agent_snapshot_id` | Pinned agent image/snapshot for create-from-snapshot |
| `s3_vault_prefix` | Durable vault root ref (S3 Mountpoint); survives stop/recreate |
| `last_activity_at` | Idle grace clock (ISO); null until activity/wake (`lp-omt` presence store) |

**Dual-run operator note (`lp-gu2`):** set `runtime_kind` at `POST …/instances/register` (default `ec2`) or update via `PATCH …/instances/:instanceId/registry`. Two tenants may differ without a platform-wide flip. Normative: `docs/plans/0008-daytona-agent-sandboxes/dual-run-runtime-kind.md`. Identity model: `docs/plans/0008-daytona-agent-sandboxes/identity-model.md`.

### `audit_log` boundary columns (additive)

| Column | Meaning |
|--------|---------|
| `actor` | Who initiated the mutation |
| `tenant_id` | Tenant scope (nullable for platform events) |
| `instance_id` | Optional gateway instance |
| `action` | Stable action name |
| `result` | `success` \| `failure` \| `denied` \| `partial` |
| `request_id` | Correlation id (never a vault body) |
| `metadata_json` | Redacted JSON only (`redactAuditMetadata`) |

---

## API (tenant-scoped)

| Method | Path | Permission |
|--------|------|------------|
| `GET` | `/tenants/:id/deployment` | `instances.read` |
| `PUT` | `/tenants/:id/deployment` | `instances.manage` |
| `GET` | `/tenants/:id/resources` | `instances.read` |
| `PUT` | `/tenants/:id/resources` | `instances.manage` |
| `DELETE` | `/tenants/:id/resources/:resourceRefId` | `instances.manage` |
| `PATCH` | `/tenants/:id/instances/:instanceId/registry` | `instances.manage` |
| `GET` | `/tenants/:id/audit` | `instances.read` |

Headers: `x-lanyard-actor`, optional `x-request-id` (stored on audit rows).

Deprovision (`POST /tenants/:id/deprovision`) still revokes instances and now **soft-retires** resource refs + marks deployment `offboarding`.

---

## Tests

`packages/control-plane/test/deployment-registry.integration.test.ts`:

- deployment upsert + invalid account id
- foreign-tenant primary instance / resource retire rejection
- secret ARN validation (reject values)
- rotation sets `credential_rotated_at` + audit fields
- offboarding retires resources
- schema inventory (no vault/tfstate tables)

---

## Honesty

- Product schema/API **ready** for registry metadata.
- Does **not** claim live multi-tenant production isolation (G1a live / cbd-mta.6.2).
- Does **not** claim control-plane RDS is applied (deploy G4.3 **infra_ready** only).
- Does **not** store or serve Company Brain content (Brain RPC boundary).

## Related

- `docs/control-plane-schema-boundary.md` (when present; cbd-mta.3.1)
- `packages/control-plane/README.md`
- Deploy readiness: company-brain-deploy `references/readiness-matrix.md` (G4 + registry row)
