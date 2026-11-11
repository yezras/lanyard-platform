# Runbook: platform-staging composed root (apply + rollback)

**Status:** Operator procedure — root and modules are **infra_ready**, not production-applied or G8/G1/G2 certified  
**Purpose:** Maintainable apply, backend, secret handling, and rollback for the **composed** central platform root  
**Root:** `environments/platform-staging/`

**Related:**

| Doc / tool | Role |
|------------|------|
| `environments/platform-staging/INDEX.md` | Layer map + end-to-end wiring table |
| `references/runbooks/product-artifact-staging-apply.md` | Phase 2 S3/ECR/OIDC-only apply and live verify |
| `references/runbooks/portal-compute-staging-apply.md` | G8 pin map, ordered compute apply, security honesty |
| `references/runbooks/staging-secrets-checklist.md` | Secret **names** only (no live values) |
| `references/runbooks/upgrade-rollback.md` | Host Hermes/client-core upgrade (customer data plane) |
| `scripts/smoke-platform-staging-compose.sh` | Offline compose + wiring invariants |
| `scripts/smoke-pilot-cost-profile.sh` | Offline lock on pilot-safe compose defaults (RDS size, optional layers off) |
| `.github/workflows/ci.yml` | fmt + validate + compose smoke (no apply) |

---

## Honesty (read first)

| Claim | Truth |
|-------|--------|
| Offline `terraform validate` + compose smoke | Yes |
| CI runs live `terraform apply` | **No** |
| Example `terraform.tfvars` / committed backend | **No** — placeholders and `*.example` only |
| Production-applied / G8 certified / G1–G2 ready | **No** until private staging evidence + matrix rows clear |
| Control plane on public ALB | **Forbidden** — compose forces `internal = true` |

Do **not** flip readiness-matrix rows to **ready** or claim staging-applied from module presence, CI green, or this runbook alone. Keep **infra_ready**.

---

## What the composed root owns

Relative module sources only (never `ref=main` / remote float):

| Layer | Module | Default |
|-------|--------|---------|
| Product artifacts | `modules/product-artifact-infra` | on |
| Platform VPC | `modules/platform-vpc` | on |
| Control-plane RDS | `modules/control-plane-rds` | on (private, encrypted) |
| Portal Valkey | `modules/portal-valkey` | **off** (pilot default; enable path `portal-valkey-g5-enable.md`) |
| Control plane | `modules/portal-control-plane-service` | on (**internal** ALB) |
| BFF | `modules/portal-bff-service` | on (public ALB; digest pin) |
| Relay | `modules/portal-relay-service` | on (separate public ALB; digest pin) |
| Static edge | `modules/portal-static-edge` | on (private S3 + CloudFront OAC) |
| DNS/TLS | `modules/portal-dns-tls` | **off** (ACM + optional Route53 aliases) |

End-to-end wiring (cbd-mta.1.3): ECR repos → task `image_repository`; operator digests; label SGs + external ingress rules (BFF/relay → CP ALB, CP → RDS, BFF/relay → Valkey when on); secret **ARNs** into tasks; private `CONTROL_PLANE_URL`; static-edge BFF origin from BFF ALB DNS. See `environments/platform-staging/INDEX.md`.

---

## Backend handling

1. Copy `backend.tf.example` → `backend.tf` in a **private** working copy (or local path ignored by git).
2. Point state at a **private** S3 (or other) backend in the **Lanyard platform staging** account only.
3. **Never** commit `backend.tf`, `*.tfstate`, or state lock tables into this repository.
4. CI uses `terraform init -backend=false` only — no remote state, no credentials required for validate.

Stop if the backend would land in a customer account or shared product account not designated for platform staging.

---

## Secret handling

| Kind | Where | Rule |
|------|-------|------|
| Image digests / static web pins | Private compatibility file → private `terraform.tfvars` | Never commit live digests to git examples |
| `CONTROL_PLANE_DATABASE_URL` | Secrets Manager via RDS module | Wire **ARN** only (`database_url_secret_arn`) |
| `REDIS_URL` | Secrets Manager via Valkey module | Wire **ARN** only into BFF/relay `secrets` map |
| BFF/CP/relay app secrets | SM/SSM via module `secrets` maps | Checklist names only: `staging-secrets-checklist.md` |
| OIDC publisher role | Existing GitHub OIDC provider ARN | **One** provider per account; pass ARN; never create a second |
| Outputs | Root `outputs.tf` | Endpoints, IDs, secret **ARNs**, private DNS — **never** passwords/tokens |

Offline checklist: `bash scripts/check-staging-secrets-checklist.sh`.

---

## Apply (composed root)

### Prerequisites

1. Caller is **Lanyard platform staging** (`aws sts get-caller-identity`) — never customer/wrong product account.
2. Private `backend.tf` + private `terraform.tfvars` (from examples).
3. Unique `artifact_bucket_name` and `static_origin_bucket_name` (no `REPLACE` / `UNCONFIGURED`).
4. Real image digests from a **private** pin file (`bash scripts/validate-compatibility.sh /path/to/private-pins.yaml`).
5. Optional: existing `github_oidc_provider_arn` when enabling OIDC publishers.
6. Optional: `enable_portal_valkey=true` only when G5/G6 consumers exist — full enable path + dual-BFF residual (live multi-BFF proof **deferred**): `references/runbooks/portal-valkey-g5-enable.md`. Module **infra_ready** ≠ production cert / G5 ready.
7. Optional: `enable_portal_dns_tls=true` only with real hostnames + zone/cert strategy (prefer existing zone/certs).

### Sequence

```bash
cd environments/platform-staging   # or private copy

# Offline first (no credentials):
terraform init -backend=false -input=false && terraform validate
bash ../../scripts/smoke-platform-staging-compose.sh

# Live (operator credentials + private backend/tfvars):
terraform init
terraform plan
# Review: no public control-plane ALB; no 0.0.0.0/0 data-plane; digests sha256:…; force_destroy false
terraform apply
```

### Prefer full compose; split only when needed

- **Full compose (recommended):** defaults on; `auto_wire_security_groups=true` for SG + secret/URL wiring without copy/paste of non-secret outputs.
- **Artifacts-only:** disable compute/RDS/VPC layers when landing Phase 2 alone — see `product-artifact-staging-apply.md`.
- **Two-phase SG:** set `auto_wire_security_groups=false` and pass explicit `*_allowed_*_security_group_ids` after task SGs exist.

### Post-apply (private evidence only)

| Step | Action |
|------|--------|
| Artifacts | `scripts/verify-product-artifact-staging.sh` (env-driven; no live IDs in git) |
| Endpoints | Record ALB DNS, CloudFront domain, secret **ARNs**, `control_plane_url` privately |
| Health | BFF/relay/CP `/health` from allowed paths; CP not public |
| Pins | Keep prior private pin files immutable (`pin-update.md`) |
| Matrix | Do **not** mark G1/G2/G8 **ready** without staging proof harness evidence |

---

## Rollback (composed platform)

Prefer **pin/config rollback** over destroy. Never `terraform destroy` data stores casually.

| Situation | Action |
|-----------|--------|
| Bad BFF / relay / CP image | Re-pin previous `*_image_digest` in private tfvars; `terraform apply` — ECS replaces tasks |
| Bad static web artifact | Re-upload previous versioned prefix; restore pin URL/version/SHA; invalidate CloudFront |
| Bad SG / wiring change | Revert root HCL or tfvars; `plan`/`apply`; do not open `0.0.0.0/0` |
| Bad `CONTROL_PLANE_URL` / secret ARN wiring | Restore previous root config; confirm tasks use secret **ARN** inject, not plaintext |
| Valkey unhealthy | Disable redis backends in product config; set `enable_portal_valkey=false` only after consumers tolerate absence; keep `desired_count=1` |
| DNS/TLS mistake | Prefer flip aliases to previous cert/target; do not delete shared hosted zone used elsewhere |
| RDS regression | Snapshot restore / point-in-time; keep `skip_final_snapshot=false` in real envs; deletion protection stays on |
| Full abort (empty staging only) | Destroy **reverse** order of create: DNS aliases → static edge → public BFF/relay → Valkey → internal CP → RDS → VPC → product-artifact (empty ECR/bucket only). Respect Object Lock and deletion protection. **Never** delete the account GitHub OIDC provider if other stacks share it. |

### Destroy order sketch (empty staging only)

```text
1. portal-dns-tls aliases / optional certs (if enabled and owned by this root)
2. portal-static-edge (CloudFront + origin bucket objects you own)
3. portal-bff-service + portal-relay-service (public edges)
4. portal-valkey (if enabled)
5. portal-control-plane-service (internal)
6. control-plane-rds (final snapshot if real data ever existed)
7. platform-vpc
8. product-artifact-infra (only if S3 empty / unlocked and ECR empty)
```

Object Lock on artifact bucket may **block** bucket destroy until retention ends — see `product-artifact-staging-apply.md` rollback notes.

---

## Layer toggles (safe defaults)

| Variable | Safe default | Notes |
|----------|--------------|-------|
| `enable_platform_vpc` | true | Foundation for private tasks + public ALBs |
| `enable_control_plane_rds` | true | Private Postgres; SM URL secret |
| `enable_portal_valkey` | **false** | Opt-in for G5/G6 store; pilot often off; enable path `portal-valkey-g5-enable.md` |
| `enable_portal_control_plane` | true | Internal only |
| `enable_portal_bff` / `enable_portal_relay` | true | Separate public ALBs |
| `enable_portal_static_edge` | true | Private S3 + OAC |
| `enable_portal_dns_tls` | **false** | Offline-safe; enable with real DNS |
| `enable_portal_waf` | **false** | Opt-in edge WebACLs |
| `auto_wire_security_groups` | true | Prefer over broad private CIDRs |
| `s3_force_destroy` | false | Real envs never force-destroy locked data |

---

## Pilot cost profile

Compose defaults are **pilot-lean**, not production HA. Do **not** treat this section as G1/G2/G8 ready or production-applied.

| Area | Pilot default | Why |
|------|---------------|-----|
| Optional layers | Valkey / WAF / DNS-TLS / OIDC publishers **off** | Avoid idle shared cost until consumers exist |
| RDS class / storage / multi-AZ | `db.t4g.small`, **20** GiB, **Single-AZ** | CP holds tenants/users/instance registry only; chat/vault on client EBS |
| Valkey *if later enabled* | 1 node; multi-AZ + automatic failover **false** | Staging cost path until G5/G6 need failover |
| Fargate | 256/512, `desired_count=1` | Already floor-sized |

**Indicative bill band (planning only):** shared platform ~$135–220/mo; +~$50–85 per client host; combined ~$200–300 (1 client) / ~$300–450 (3 clients). Model API spend excluded. Not measured Cost Explorer.

### HA re-enable (private tfvars)

```hcl
# RDS prod-like
rds_instance_class    = "db.t4g.medium"
rds_allocated_storage = 50
rds_multi_az          = true

# Valkey HA (only with enable_portal_valkey = true)
valkey_num_cache_clusters           = 2
valkey_multi_az_enabled             = true
valkey_automatic_failover_enabled   = true

# Edge / DNS when real hostnames and consumers exist
# enable_portal_dns_tls = true
# enable_portal_waf     = true
```

### NAT vs interface endpoints (cost experiment — document only)

Pilot keeps **`enable_nat_gateway=true`** with **`single_nat_gateway=true`** (one NAT). Interface/gateway endpoints default **on** as well, so compose runs in `private_egress_mode = nat_and_endpoints`. That is the safe private path for AWS APIs **and** general internet, but **NAT + full interface endpoints can double-pay** for egress plumbing (NAT hourly/GB plus interface-endpoint hourly and data processing).

Before experimenting with **`enable_nat_gateway=false`** in private tfvars:

1. Keep the **full** endpoint set true: S3 gateway + ECR (api+dkr) + Logs + Secrets Manager + SSM family.
2. Confirm plan/module checks stay green — `modules/platform-vpc` `private_egress_path` requires NAT **or** the full endpoint set; offline: `bash scripts/smoke-platform-vpc.sh`.
3. **Measure** interface-endpoint hourly cost vs single-NAT cost (Pricing Calculator / Cost Explorer) in the staging account before flipping.
4. Accept that **non-AWS** egress (package mirrors, third-party HTTPS) fails without NAT.

**Do not** flip the compose or module **default** of `enable_nat_gateway` to `false` without operator proof from a private apply that endpoints-only covers required private traffic. Keep git defaults pilot-safe; record any endpoints-only experiment in private operator notes only. See `modules/platform-vpc/README.md` § Private egress matrix.

Regression lock (offline):

```bash
bash scripts/smoke-pilot-cost-profile.sh
```

Fails if compose `variables.tf` defaults regress to Multi-AZ medium RDS, storage above pilot floor without intentional change, Valkey HA by default, or Valkey/WAF/DNS-TLS default **on**.

---

## CI and offline validation (no apply)

CI (`.github/workflows/ci.yml`) must keep:

1. `bash -n` + ShellCheck on `scripts/smoke-platform-staging-compose.sh`
2. `bash scripts/smoke-platform-staging-compose.sh`
3. Per-module and `environments/platform-staging` `terraform init -backend=false && terraform validate`
4. Sibling smokes: portal-compute, platform-vpc, control-plane-rds, portal-valkey, portal-dns-tls, product-artifact-iam
5. `terraform fmt -check -recursive`
6. Policy-as-code + production-gate honesty (G1/G2 remain blocked)

Local full set for root/docs changes:

```bash
bash scripts/smoke-platform-staging-compose.sh
bash scripts/smoke-pilot-cost-profile.sh
bash scripts/smoke-portal-compute.sh
bash scripts/smoke-platform-vpc.sh
bash scripts/smoke-control-plane-rds.sh
bash scripts/smoke-portal-valkey.sh
bash scripts/smoke-portal-dns-tls.sh
bash scripts/smoke-portal-waf.sh
bash scripts/smoke-product-artifact-iam.sh
bash scripts/policy-as-code-security.sh
bash scripts/validate-production-gates.sh
bash scripts/check-staging-secrets-checklist.sh
terraform fmt -check -recursive
(
  cd environments/platform-staging
  terraform init -backend=false -input=false
  terraform validate
)
```

---

## Failure / stop conditions

| Condition | Action |
|-----------|--------|
| Wrong AWS account | **Do not apply** |
| Plan attaches control plane to public ALB / `internal=false` | **Abort** |
| Plan opens data-plane or CP with `0.0.0.0/0` | **Abort** |
| Digests missing / tag-only / `:latest` authority | **Abort** — fix private pins |
| Bucket or hostname still `REPLACE` | **Abort** |
| Second GitHub OIDC provider in plan | **Abort** — reuse existing ARN |
| Desire to claim G1/G2/G8 ready from this apply alone | **Refuse** — record private evidence; keep matrix fail-closed |

---

## Operator sequence (summary)

1. Confirm platform staging account.
2. Private backend + tfvars (unique buckets, real digests).
3. Offline validate + `smoke-platform-staging-compose.sh`.
4. `terraform plan` / `apply` from composed root (or private copy).
5. Live verify artifacts; smoke health endpoints; record secret ARNs privately.
6. On regression: re-pin digests / reverse HCL — prefer pin rollback over destroy.
7. Keep git free of backend, tfvars, state, and live resource IDs.
