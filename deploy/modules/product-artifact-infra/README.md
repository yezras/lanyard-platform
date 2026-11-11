# product-artifact-infra

Reusable Terraform module for **deployment-owned product release infrastructure**:

| Resource | Purpose |
|----------|---------|
| Private versioned **S3** bucket with **Object Lock** | Hermes + client-core + portal-web release tarballs (immutable object versions) |
| **ECR** repositories (immutable tags) | Portal services: `web`, `bff`, `relay`, `control-plane` |
| Optional **GitHub Actions OIDC** roles | Least-privilege publishers for the three product repos |

This module is the **Phase 2 foundation**. It does **not** publish artifacts, build images, deploy Portal services, or provision RDS.

**Monorepo status (`lp-k7g.10.1`):** Imported from `LanyardBrain/company-brain-deploy` under `deploy/modules/product-artifact-infra/`. Platform phase-3 landing-zone stubs (`*.tf.example` for multi-backend prefixes) sit **alongside** this module and are not yet wired into live `.tf` (follow-on: phase 6 / `lp-k7g.10.x`). Canonical multi-backend design: [docs/architecture/deploy-artifact-landing-zones.md](../../../docs/architecture/deploy-artifact-landing-zones.md).

## What this enables

- Operators can apply platform infra and obtain stable **bucket names**, **object URL templates**, and **ECR repository URLs**.
- Product repos (when they gain release workflows) assume OIDC roles to push under scoped prefixes/repos.
- Deploy pins (`compatibility/`) continue to require **Portal digests** + **Hermes/client-core version+SHA+URL**; static web adds **`portal.web` version+SHA+URL** after first successful publish.
- Portal OIDC publisher may write under `portal-web/` **and** push backend ECR images (deploy-owned landing zone ready; product workflows exist — **published pins still missing**).

## What this does **not** do

| Gated item | Why |
|------------|-----|
| Portal static web **published pins** | Product packaging/release workflows exist; first successful pin not recorded here |
| Portal backend **published ECR digests** | Dockerfiles + image-release workflow exist in Portal; digests not invented in deploy |
| Hermes Lanyard **published** runtime artifact | Product release workflow exists; no successful S3 pin yet (G7.H2) |
| client-core **published** tarball pin | Product release workflow exists; no successful S3 pin yet (G7.C2) |
| Control-plane Postgres / RDS apply | Product G4.1/G4.2 done; deploy module is `modules/control-plane-rds/` (**infra_ready**, not this module) |
| Portal ECS/ALB/service deployment | Later migration phase |
| CloudFront / static edge origin module | Later migration phase (G8) |

See `references/readiness-matrix.md`.

## Usage

```hcl
module "product_artifacts" {
  source = "../../modules/product-artifact-infra"

  name_prefix          = "lanyard-platform-staging"
  environment          = "staging"
  artifact_bucket_name = "lanyard-product-artifacts-staging-REPLACE"

  # OIDC publishers off until an existing provider ARN is supplied
  enable_oidc_publishers  = false
  # github_oidc_provider_arn = "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
  # enable_oidc_publishers  = true
}
```

Prefer **relative** module sources inside this monorepo. External consumers must pin a tag/commit — never `ref=main`.

## S3 contract

| Prefix (default) | Product | Pin fields |
|------------------|---------|------------|
| `hermes/` | LanyardBrain/hermes-lanyard | `hermes.url` / version / sha256 |
| `client-core/` | LanyardBrain/client-core | `client_core.url` / version / sha256 |
| `portal-web/` | LanyardBrain/Portal static web | `portal.web.url` / version / sha256 |

- Versioning **enabled**
- **Object Lock enabled at bucket creation** (cannot be added later; module always sets this)
- Default Object Lock retention: **GOVERNANCE / 90 days** (configurable via `s3_object_lock_default_retention_*`)
- Why Object Lock: versioning alone still allows a new current version on the same key; locked versions cannot be deleted/overwritten until retention ends
- `force_destroy` defaults to **false** for real environments (Object Lock still blocks purge of locked versions even if true)
- Public access **blocked** (all four PAB flags)
- BucketOwnerEnforced (no ACLs)
- **TLS-only bucket policy** — always denies `s3:*` when `aws:SecureTransport` is `false`
- SSE-S3 (AES256) by default; optional SSE-KMS (`aws:kms` + customer-managed CMK recommended)
- Lifecycle: abort incomplete multipart; expire noncurrent versions (default 90d)
- **Lifecycle ↔ Object Lock:** noncurrent-version expiration cannot delete a version still under retention; Object Lock wins until the retention window ends. Prefer expiration ≥ default retention days.
- **Optional VPC endpoint restriction** — see below (advanced; off by default)

Example pin URL after publish:

```text
s3://<bucket>/hermes/v0.1.0/hermes-lanyard.tar.gz
s3://<bucket>/client-core/v0.1.0/client-core.tar.gz
s3://<bucket>/portal-web/v0.1.0/portal-web.tar.gz
```

### TLS-only (always on)

The module attaches an `aws_s3_bucket_policy` with:

| Sid | Effect | Condition |
|-----|--------|-----------|
| `DenyInsecureTransport` | Deny `s3:*` on bucket + objects | `aws:SecureTransport = false` |

Plain HTTP to the bucket is rejected for every principal (including account root). Clients must use HTTPS.

### Optional VPC endpoint restriction (advanced)

Default `s3_vpc_endpoint_ids = []` keeps the public S3 API path available to authorized IAM principals (bucket remains non-public via PAB + IAM).

When you set `s3_vpc_endpoint_ids` to one or more S3 Gateway/Interface endpoint IDs (`vpce-…`), the policy adds:

| Sid | Effect | Condition |
|-----|--------|-----------|
| `DenyRequestsOutsideAllowedVPCEndpoints` | Deny `s3:*` | `aws:SourceVpce` not in allow-list **and** `aws:PrincipalArn` not matching exempt principals |

**Do not enable VPCE restriction until you have planned exemptions.** Otherwise operators (and often Terraform itself) lose access from outside the VPC.

| Principal class | How exemption works |
|-----------------|---------------------|
| OIDC publisher roles (this module) | **Auto-exempt** when `enable_oidc_publishers = true` (role ARN + `sts:assumed-role/<name>/*`) so GitHub Actions can still publish over the public S3 API |
| Operator / admin / break-glass roles | Pass ARNs in `s3_vpc_endpoint_exempt_principal_arns` (IAM role ARNs are expanded to include assumed-role sessions) |
| Brain-host instance roles reading via VPCE | No exemption needed if their path uses an allowed `vpce-` |
| Brain-host readers **not** on a listed VPCE | Must be exempted or will be denied |

Example (placeholders only — replace at apply time; never invent live account/vpce IDs in git):

```hcl
s3_vpc_endpoint_ids = ["vpce-REPLACE"]
s3_vpc_endpoint_exempt_principal_arns = [
  "arn:aws:iam::ACCOUNT_ID:role/platform-admin-REPLACE",
]
```

Prefer VPCE restriction for **consumer** (brain host) paths after OIDC publishers and admin roles are exempt. Leaving the list empty is the correct default for platform staging until endpoints exist.

### KMS key policy (when `s3_sse_algorithm = "aws:kms"`)

Set `s3_kms_key_id` to a **customer-managed CMK ARN**. A check block fails plan if `aws:kms` is selected without a key id (avoids silent AWS-managed `aws/s3` use). This module does **not** create or attach KMS key policies — operators must grant least privilege on the key:

| Principal | Minimum key actions | Why |
|-----------|---------------------|-----|
| OIDC S3 publisher roles (Hermes, client-core, Portal for `portal-web/`) | `kms:Encrypt`, `kms:GenerateDataKey`, `kms:GenerateDataKeyWithoutPlaintext`, `kms:Decrypt`, `kms:DescribeKey` | PutObject with SSE-KMS + multipart |
| Brain-host / bootstrap instance roles (artifact readers) | `kms:Decrypt`, `kms:DescribeKey` | GetObject of encrypted tarballs |
| Terraform / platform admin roles that manage objects | Same as publishers (or broader break-glass) | Lifecycle, re-encrypt, emergency ops |
| S3 service (if using bucket keys / grants) | Often covered via key policy `Service: s3.amazonaws.com` + `kms:ViaService` conditions in account-specific designs | Optional; prefer role-based grants |

Key policy sketch (illustrative — scope ARNs to real roles at apply time):

```json
{
  "Sid": "AllowProductArtifactPublishers",
  "Effect": "Allow",
  "Principal": {
    "AWS": [
      "arn:aws:iam::ACCOUNT_ID:role/PREFIX-gha-hermes",
      "arn:aws:iam::ACCOUNT_ID:role/PREFIX-gha-client_core",
      "arn:aws:iam::ACCOUNT_ID:role/PREFIX-gha-portal"
    ]
  },
  "Action": [
    "kms:Encrypt",
    "kms:Decrypt",
    "kms:GenerateDataKey",
    "kms:GenerateDataKeyWithoutPlaintext",
    "kms:DescribeKey"
  ],
  "Resource": "*"
}
```

Also retain account root (or a dedicated key-admin role) with `kms:*` for key administration so you cannot lock yourself out of the CMK. Do not grant `kms:*` to publisher or instance roles.

When using AES256 (default), no KMS key policy is required.

## ECR contract

| Service key | Expected product image | Mutability |
|-------------|------------------------|------------|
| `web` | Portal web | IMMUTABLE |
| `bff` | Portal BFF (`/health`) | IMMUTABLE |
| `relay` | Portal relay (`/health`) | IMMUTABLE |
| `control-plane` | Portal control-plane | IMMUTABLE |

Deploy paths pin **`repository` + `digest`** (`sha256:…`). Mutable `:latest` alone is never a pin.

## OIDC publisher contract

1. **Require existing provider** — set `github_oidc_provider_arn` to an already-created IAM OIDC provider for `token.actions.githubusercontent.com`. This module **never** creates a second provider.
2. **Default trust subjects** (release tags only):
   - `repo:LanyardBrain/Portal:ref:refs/tags/*`
   - `repo:LanyardBrain/hermes-lanyard:ref:refs/tags/*`
   - `repo:LanyardBrain/client-core:ref:refs/tags/*`
3. **Scope**:
   - Portal → S3 write under `portal-web/` **and** ECR push to the four service repos; `ecr:GetAuthorizationToken` on `*` (AWS requirement)
   - Hermes → S3 write under `hermes/` only
   - client-core → S3 write under `client-core/` only
   - S3 IAM: `s3:GetBucketLocation` is a separate bucket-scoped statement (no `s3:prefix` condition); `ListBucket` / `ListBucketVersions` remain prefix-conditioned; object writes remain prefix-scoped
4. Override `publisher_repos.*.subjects` only for deliberate break-glass; do not default to `refs/heads/main`.

Offline guardrails: `scripts/smoke-product-artifact-iam.sh`.

## Platform multi-backend stubs (phase 3, merge pending)

Imported product module still uses the **legacy** S3 layout (`hermes/` · `client-core/` · `portal-web/`). Platform stubs from `lp-k7g.7.6` live in this directory and record the **target** multi-backend map:

| File | Role |
| --- | --- |
| [`artifact_prefixes.tf.example`](artifact_prefixes.tf.example) | Target `artifact_prefixes` object + kind → slug locals (`backends/<kind-slug>/`) |
| [`publisher_repos.tf.example`](publisher_repos.tf.example) | Target `publisher_repos` defaults (Hermes dual-write + Lanyard Agent) |
| [`outputs_landing_zones.tf.example`](outputs_landing_zones.tf.example) | URL template outputs for multi-backend |
| [`terraform.tfvars.landing_zones.example`](terraform.tfvars.landing_zones.example) | Placeholder-safe inputs |

**Invariants for the merge (do not violate):**

1. **Backend families** land under `backends/<kind-slug>/` (underscore → hyphen).
2. **`client-core/` and `portal-web/` stay unchanged** — never nested under `backends/`.
3. **Hermes-Lanyard OIDC trust** remains `repo:LanyardBrain/hermes-lanyard:ref:refs/tags/*`.
4. **Lanyard Agent** gets its own publisher role writing only `backends/lanyard-agent/`.
5. Legacy **`hermes/`** is temporary dual-write only.
6. Do **not** create a second OIDC provider; keep `github_oidc_provider_arn` input.

Wire steps: expand live `variables.tf` / `iam_oidc.tf` / outputs using the stubs; update `references/product-artifact-release-contract.md` and `scripts/smoke-product-artifact-iam.sh` for new prefixes and denied-prefix simulations.

## Validation

```bash
cd modules/product-artifact-infra
terraform init -backend=false -input=false
terraform validate
```

From monorepo root after import:

```bash
cd deploy/modules/product-artifact-infra
terraform init -backend=false -input=false
terraform validate
```

No live AWS credentials are required for `validate`.

Offline IAM/Object Lock/TLS contract: `bash scripts/smoke-product-artifact-iam.sh` (from deploy tree root).

## Staging apply (operator-owned)

This module is **infra_ready** and is **not** auto-applied from CI or example tfvars.

1. Confirm the active AWS account is **Lanyard platform staging** (`aws sts get-caller-identity`). Do not apply from a customer or unrelated product account.
2. Follow `references/runbooks/product-artifact-staging-apply.md` (private `backend.tf` + unique staging bucket name + optional existing OIDC provider ARN).
3. After apply: `scripts/verify-product-artifact-staging.sh` with env-driven bucket/prefix (S3 versioning/Object Lock/encryption/PAB/TLS, ECR IMMUTABLE+scan, OIDC single-provider, denied-prefix IAM simulation).
4. Keep live outputs, role ARNs, and account IDs in private operator notes — never commit as claimed pins.

The module **never** creates `aws_iam_openid_connect_provider`. If the account has no GitHub OIDC provider, create **one** outside this module (runbook step 0b); if one already exists, pass its ARN only.

## Related

- Consumer root: `environments/platform-staging/`
- Apply runbook: `references/runbooks/product-artifact-staging-apply.md`
- Live verify: `scripts/verify-product-artifact-staging.sh`
- Product pins (imported): `deploy/compatibility/`
- Platform pins (monorepo v2): `compatibility/` at monorepo root
- Artifact bootstrap: `artifacts/README.md`, `scripts/bootstrap-host.sh`
- Phases / gates: `references/migration-phases.md`, `references/readiness-matrix.md`
- Multi-backend landing zones design: [docs/architecture/deploy-artifact-landing-zones.md](../../../docs/architecture/deploy-artifact-landing-zones.md)
