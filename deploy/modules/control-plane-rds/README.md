# control-plane-rds

Reusable Terraform module for **private, encrypted Amazon RDS PostgreSQL** used by the Lanyard Portal **control plane**.

| Resource | Purpose |
|----------|---------|
| RDS Postgres instance | Multi-AZ capable control-plane database |
| DB subnet group | **Private subnets only** (≥2) |
| Security group | Ingress 5432 from allow-listed SGs/CIDRs (**not** `0.0.0.0/0`) |
| Secrets Manager secret | `CONTROL_PLANE_DATABASE_URL` / `DATABASE_URL` JSON payload |
| Optional SSM String | Pointer to the secret **ARN** (not the password) |

## Status

| Claim | Truth |
|-------|--------|
| Module is real Terraform | **Yes** — validates with `terraform init -backend=false && terraform validate` |
| Product Postgres (G4.1/G4.2) | Product migrated off better-sqlite3 / `CONTROL_PLANE_DB_PATH` to `CONTROL_PLANE_DATABASE_URL` (Portal #15, migration #19) |
| Tenant-scoped schema boundary (cbd-mta.3.1) | Product inventory + FKs/triggers in Portal `migrate.ts` / `docs/control-plane-schema-boundary.md` — **metadata only**; not vault content |
| Deployment/resource registry (cbd-mta.3.3) | Product tables `tenant_deployments` / `tenant_resource_refs` + audit boundary columns; deploy contract `references/deployment-resource-registry.md` — **not** Terraform state; not vault bodies |
| Applied in platform staging from this repo | **No** — not wired into `environments/platform-staging` apply path; operator-owned private root |
| Production control-plane security | Still requires **G1** private boundary (separate gate); G1a product authz ≠ live staging proof |
| Postgres RLS in this module | **Not** configured here — product deferred RLS with app/trigger compensating controls |

Readiness: **infra_ready** until an operator applies into a real private VPC and the control plane consumes the secret. See `references/readiness-matrix.md`.

## Fail-closed posture

- `publicly_accessible` **must** be `false` (variable validation + resource hardcode).
- `subnet_ids` requires **≥2** subnets; plan-time checks require `map_public_ip_on_launch=false` and matching `vpc_id`.
- `allowed_cidr_blocks` rejects `0.0.0.0/0` and `::/0`.
- At least one of `allowed_security_group_ids` or `allowed_cidr_blocks` is required.
- Storage encryption is **always** on (`storage_encrypted = true`).
- Master password is **generated** (`random_password`) — never accepted via tfvars.
- `acknowledge_not_auto_applied=true` required so callers do not treat examples as live apply.

## Product env contract

Portal control plane (G4.1) expects:

```text
CONTROL_PLANE_DATABASE_URL=postgresql://user:pass@host:5432/dbname?uselibpqcompat=true&sslmode=require
# or DATABASE_URL with the same shape (TLS required when rds.force_ssl=1; uselibpqcompat
# keeps node-pg sslmode=require as encrypt-only until Amazon CA is bundled for verify-full)
```

This module stores that value under Secrets Manager. Preferred wiring:

1. Read `control_plane_database_url_secret_arn` (or SSM pointer).
2. `GetSecretValue` → JSON key `url` or `CONTROL_PLANE_DATABASE_URL`.
3. Inject into the private control-plane task environment at runtime.

**Do not** commit passwords, full URLs, or live ARNs to git. Example tfvars use placeholder `vpc-` / `subnet-` / `sg-` shapes only.

Outputs:

| Output | Contents |
|--------|----------|
| `control_plane_database_url_secret_arn` | Secret ARN (preferred) |
| `control_plane_database_url_shape` | Redacted `postgresql://user:***@host:port/db` |
| `control_plane_env_contract` | Machine-readable consumption notes |
| `db_instance_endpoint` | Host:port only |

Raw passwords are **not** exposed as non-sensitive outputs. Terraform state still contains generated secrets — protect the state backend.

## Usage

```hcl
module "control_plane_rds" {
  source = "../../modules/control-plane-rds"

  name_prefix = "lanyard-cp-staging"
  environment = "staging"

  vpc_id     = var.vpc_id
  subnet_ids = var.private_subnet_ids

  allowed_security_group_ids = [var.control_plane_task_security_group_id]

  acknowledge_not_auto_applied = true
}

# Task role / runtime:
#   secret_arn = module.control_plane_rds.control_plane_database_url_secret_arn
#   env CONTROL_PLANE_DATABASE_URL from secret JSON key "url"
```

Prefer **relative** module sources inside this monorepo. External consumers must pin a tag/commit — never `ref=main`.

## Validate (no credentials / no apply)

```bash
cd modules/control-plane-rds
terraform init -backend=false -input=false
terraform validate
```

Offline posture smoke (repo root):

```bash
bash scripts/smoke-control-plane-rds.sh
```

## Schema boundary (product-owned)

This module provisions empty private Postgres. **Application schema** is applied by the Portal control-plane process (`migrateControlPlaneSchema`).

Normative content rule (Brain RPC):

- Canonical Company Brain / vault **file bodies** are **not** stored in this database.
- Host content is reached only via Brain RPC on the customer data plane (`references/brain-rpc-contract.md` §1.1).
- CP holds tenants, OIDC/users, roles/path prefixes, instance credential **hashes**, project path refs, session-share grants, audit metadata.

Product authority: Portal `docs/control-plane-schema-boundary.md`. Deploy readiness row: readiness-matrix § “Control-plane Postgres”.

## What this does **not** do

| Non-goal | Why |
|----------|-----|
| Publish Portal images or ECS services | G8 / product release gates |
| Clear G1 private control-plane production claim | Staging proof still required |
| Auto-apply from CI or platform-staging examples | Operator-owned; placeholders only in git |
| Accept master passwords in tfvars | Secrets Manager only |
| Public RDS or public-subnet DB groups | Rejected fail-closed |
| Store vault / Company Brain file bodies | Content stays on customer host (Brain RPC) |
| Enable Postgres RLS by default | Deferred in product schema boundary; revisit when multi-role DB access lands |

## Files

See [INDEX.md](./INDEX.md).
