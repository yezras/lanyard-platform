# Deployment / resource registry contract (cbd-mta.3.3)

**Status:** Contract **defined** (deploy-repo authority). Product schema/store/API in Portal control plane.  
**Not claimed:** Live production multi-tenant isolation proof, RDS apply, or that the registry replaces per-tenant Terraform state.

**Related:**

| Doc | Role |
|-----|------|
| `references/brain-rpc-contract.md` | Canonical vault content boundary (host-local via Brain RPC) |
| `references/tenant-isolation-decision.md` | Hosting track / isolation mode doctrine |
| `templates/tenant/` | Terraform variables that **feed** registry metadata (not stored as tfstate in CP) |
| `modules/control-plane-rds/` | Private Postgres home for this metadata when applied |
| Portal `docs/deployment-resource-registry.md` | Product table/API inventory |

---

## 1. Purpose

The **central control-plane Postgres** holds a **minimal deployment/resource registry** so platform operators and Portal can:

1. Know **where** a tenant runs (hosting track, account, region).
2. Route to the correct **gateway instance** (`instance_id` is authority).
3. Track **non-secret** resource references and secret **ARN** pointers.
4. Record **audit** events for control-plane mutations.

It does **not** become a second Terraform state store, credential vault, or Company Brain content store.

| Stable control-plane IDs (**authority**) | AWS resource identifiers (**metadata only**) |
|------------------------------------------|-----------------------------------------------|
| `tenant_id`, `instance_id`, `user_id` | Account id, `i-…`, `vol-…`, ARNs, regions |
| Used for authz, Brain RPC subject, audit | Used for inventory/ops; **never** authentication |

---

## 2. Explicit non-goals (registry ≠ tfstate)

| Must **not** store in CP registry | Why / where it lives instead |
|-----------------------------------|------------------------------|
| Terraform state / plans / lock files | Per-tenant (or platform) remote state backends |
| Provider credentials, deploy role session tokens | Operator SSO / STS; not CP DB |
| Reusable plaintext `GATEWAY_RELAY_SECRET` | Show-once at register/rotate; host SSM/SM holds value; CP holds **hash** + optional **parameter ARN** |
| Company Brain / vault **file bodies** | Customer EBS via **Brain RPC** (`references/brain-rpc-contract.md` §1 / §1.1) |
| Full resource dependency graphs | Tenant Terraform modules + backends |
| Artifact tarball bytes / image layers | Product artifact S3/ECR (`modules/product-artifact-infra`) |

---

## 3. Registry model (tenant-scoped)

### 3.1 Deployment row (`tenant_deployments`)

One current deployment metadata row per tenant (upsert by `tenant_id`).

| Field | Source of truth input | Notes |
|-------|----------------------|--------|
| `hosting_track` | `templates/tenant` `hosting_track` | `lanyard_hosted` \| `customer_account` |
| `isolation_mode` | `isolation_mode` / defaults | `account` \| `vpc_interim` \| `customer_account` |
| `aws_account_id` | Operator / account factory | 12-digit when known; metadata only |
| `aws_region` | Tenant deploy region | |
| `project_name` | `project_name` / name prefix | |
| `status` | Ops lifecycle | `registered` → `provisioning` → `active` → `degraded` / `offboarding` / `retired` |
| `client_core_version` / `hermes_version` | Compatibility pins | **Version strings only** (not full URLs with secrets) |
| `primary_instance_id` | CP gateway instance | Must same-tenant; soft ref |

### 3.2 Resource refs (`tenant_resource_refs`)

Minimal inventory of non-secret resources, always with `tenant_id` FK.

| Kind examples | Typical refs |
|---------------|--------------|
| `ec2_instance` | `aws_id=i-…` |
| `ebs_volume` | `aws_id=vol-…` |
| `kms_key` | `arn=arn:aws:kms:…` |
| `ssm_parameter` / `secrets_manager_secret` | `secret_arn` only (container ARN) |
| `log_group`, `dlm_policy`, `iam_role`, `security_group`, `subnet`, `vpc` | `arn` / `aws_id` as available |
| `s3_artifact_prefix` | Prefix path metadata (not object bodies) |

**Secret fields:** `secret_arn` / instance `secret_param_arn` hold **ARN references and lifecycle timestamps** only — never secret values or verifiers beyond existing scrypt hashes on `gateway_instances`.

### 3.3 Gateway instance registry fields

Additive on `gateway_instances` (alongside G2 credential hashes):

| Field | Meaning |
|-------|---------|
| `label` | Optional ops label |
| `last_seen_at` | Last presence/health observation |
| `health_status` | `unknown` \| `healthy` \| `degraded` \| `unreachable` \| `revoked` |
| `credential_rotated_at` | Last successful rotate |
| `secret_param_arn` | SSM/SM **ARN** where host material is stored |
| `ec2_instance_id` | Optional `i-…` link |
| `aws_region` | Instance region metadata |

### 3.4 Audit boundary (`audit_log`)

Every control-plane mutation that changes registry or credentials should emit an audit row with:

| Field | Required |
|-------|----------|
| `actor` | Who (ops user, `api`, `relay`, service) |
| `tenant_id` | Tenant scope (nullable only for true platform events) |
| `instance_id` | When the mutation touches a gateway instance |
| `action` | Stable name (`instance.rotated`, `tenant.deployment_upserted`, …) |
| `result` | `success` \| `failure` \| `denied` \| `partial` |
| `request_id` | Correlation id when available |
| `metadata_json` | **Redacted** — no vault bodies, secrets, or tfstate |

Product redaction: Portal `redactAuditMetadata` (G2b.2). Deploy doctrine: same as Brain RPC logging rules (`brain-rpc-contract.md` §6).

---

## 4. Offboarding / retention

| Event | Registry behavior |
|-------|-------------------|
| Instance revoke | Soft: `revoked_at` + `health_status=revoked`; secrets never re-issued from store |
| Tenant deprovision | Revoke active instances; **retire** resource refs; deployment → `offboarding` |
| Resource replace | Prior ref `status=replaced` or `retired`; new ref under same `(kind, name)` upsert |
| Hard tenant DELETE | Not a product API; FKs prevent casual delete; audit rows may SET NULL tenant |

Retention policy flags on `tenants` (`retention_mode`, etc.) remain separate from registry row lifetime.

---

## 5. Product surface (Portal)

| Surface | Location |
|---------|----------|
| DDL | Portal `packages/control-plane/src/migrate.ts` |
| Store | `deployment-registry.ts` + `ControlPlaneStore` |
| HTTP | `GET/PUT …/deployment`, `GET/PUT …/resources`, `DELETE …/resources/:id`, `PATCH …/instances/:id/registry`, `GET …/audit` |
| Tests | `test/deployment-registry.integration.test.ts` |
| Product doc | Portal `docs/deployment-resource-registry.md` |

Deploy operators **write** registry metadata after apply (automation or manual API) using non-secret outputs from `templates/tenant` / module outputs — never commit live ARNs or account ids into this git repo.

---

## 6. Deploy wiring honesty

| Claim | Truth |
|-------|--------|
| Contract documented here | **Yes** |
| Product tables/API exist | Portal cbd-mta.3.3 |
| CP RDS module ready to host tables | G4.3 **infra_ready** (`modules/control-plane-rds`) |
| RDS applied in staging/prod from examples | **No** — operator-owned |
| Production G1 private CP boundary proven | **blocked** until G1.4 staging proof |
| Registry replaces tenant Terraform state | **No** — explicitly forbidden |

Readiness matrix: `references/readiness-matrix.md` (G4 + deployment registry row).

---

## 7. Acceptance checklist (cbd-mta.3.3)

- [x] Registry model documented as distinct from Terraform state
- [x] Resource fields tenant-scoped and minimal (FK + kinds + refs)
- [x] Secret fields are refs/verifiers + lifecycle timestamps only
- [x] Audit includes actor, tenant, instance, action, result, request_id without bodies
- [x] Offboarding / retire path defined and product-tested
- [x] Brain RPC content boundary cited (no vault bodies in CP)
- [ ] Live staging write of registry after real tenant apply (operator; not claimed here)
