# Runbook: Product artifact staging apply + OIDC publishers (Phase 2 / cbd-mta.5.1)

**Status:** Operator procedure — module and staging root are **infra_ready**, not auto-applied  
**Purpose:** Apply the deploy-owned S3 + ECR landing zones and least-privilege GitHub OIDC publisher roles in the **Lanyard platform staging** account  
**Root / module:**

| Path | Role |
|------|------|
| `environments/platform-staging` | Staging composed root (relative module sources; full apply/rollback: `platform-staging-compose.md`) |
| `modules/product-artifact-infra` | S3 (versioning + Object Lock + TLS-only) + Portal ECR (IMMUTABLE + scan) + optional OIDC roles |

**Related:** `references/product-artifact-release-contract.md`, `references/readiness-matrix.md`, `references/runbooks/staging-secrets-checklist.md`, `references/runbooks/pin-update.md`, `references/runbooks/portal-compute-staging-apply.md`, `scripts/smoke-product-artifact-iam.sh`, `scripts/verify-product-artifact-staging.sh`

---

## Honesty (read first)

| Claim | Truth |
|-------|--------|
| Module + root validate offline | Yes (`terraform validate` + `scripts/smoke-product-artifact-iam.sh`) |
| Auto-applied from this repo / CI | **No** — private operator backend + tfvars only |
| Example tfvars are apply-ready | **No** — `REPLACE` bucket suffix and OIDC off by default |
| Live staging landing zones exist | **Only after operator apply** in the correct platform account |
| Module creates GitHub OIDC provider | **No** — requires an **existing** provider ARN (create once outside the module if absent) |
| Product pins published | **Not this runbook** — product repos own release workflows after roles exist |

Do **not** flip readiness-matrix rows from **infra_ready** to **ready** / **applied** from docs alone. Record private evidence (operator notes outside git) after a successful apply + verify script pass.

**Do not apply** if the active AWS caller is not the Lanyard **platform staging** account (customer / client project accounts, empty-of-intent accounts, or credentials named for another product). Confirm identity first (step 0).

---

## Preconditions checklist

- [ ] `aws sts get-caller-identity` shows the **intended Lanyard platform staging** account (not a customer or unrelated project account)
- [ ] Account has no conflicting production product-artifact bucket you would overwrite; prefer **new** staging-named resources
- [ ] Remote state plan ready: private S3 state bucket + DynamoDB lock table (or approved alternative), **not** committed
- [ ] Globally unique `artifact_bucket_name` chosen (staging in the name; no `REPLACE` / `UNCONFIGURED`)
- [ ] `s3_force_destroy = false` for real staging (never force-destroy Object Lock release data)
- [ ] Offline gates green:
  - `bash scripts/smoke-product-artifact-iam.sh`
  - `cd environments/platform-staging && terraform init -backend=false -input=false && terraform validate`
- [ ] Product repo GitHub orgs/repos match defaults (`LanyardBrain` / `Portal`, `hermes-lanyard`, `client-core`) or private tfvars overrides are deliberate

---

## Step 0 — Confirm account and existing OIDC provider

```bash
aws sts get-caller-identity
# Expect: Lanyard platform staging account ID (operator-known). If wrong: STOP.

aws iam list-open-id-connect-providers
# If empty: create the GitHub OIDC provider ONCE (step 0b).
# If one exists for token.actions.githubusercontent.com: REUSE its ARN — never create a second.
# If more than one GitHub-related provider: STOP and reconcile; do not invent a second for this module.
```

### Step 0b — First-time GitHub OIDC provider (only when none exists)

The product-artifact module **never** creates `aws_iam_openid_connect_provider`. Create the account-level provider **once** with the AWS CLI or a separate one-shot IAM change (not a second provider later).

GitHub’s documented thumbprint set can change; use current GitHub Actions OIDC docs at apply time. Sketch (placeholders only):

```bash
# ONE-TIME when list-open-id-connect-providers is empty for this account.
# Confirm thumbprints against current GitHub OIDC documentation before running.
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list \
    "ffffffffffffffffffffffffffffffffffffffff" \
    "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
# Replace thumbprints with the current GitHub-published values. Do not commit live ARNs.

aws iam list-open-id-connect-providers
# Copy the provider ARN into private terraform.tfvars as github_oidc_provider_arn
```

Record the provider ARN in **private** operator notes only.

---

## Step 1 — Private working tree (never commit)

```bash
cd environments/platform-staging

# Remote state — gitignored
cp backend.tf.example backend.tf
# Edit backend.tf: real state bucket, key, region, dynamodb_table, encrypt=true

# Inputs — gitignored
cp terraform.tfvars.example terraform.tfvars
```

Recommended private `terraform.tfvars` shape (no live account IDs in git docs):

```hcl
region      = "us-east-1"
name_prefix = "lanyard-platform-staging"

# Globally unique; include staging; replace REPLACE with operator-chosen suffix
artifact_bucket_name = "lanyard-product-artifacts-staging-<operator-suffix>"

s3_force_destroy                      = false
s3_object_lock_default_retention_mode = "GOVERNANCE"
s3_object_lock_default_retention_days = 90
s3_noncurrent_version_expiration_days = 90
s3_sse_algorithm                      = "AES256"
ecr_image_count_limit                 = 50

# After step 0/0b
enable_oidc_publishers   = true
github_oidc_provider_arn = "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
github_org               = "LanyardBrain"

tags = {
  CostCenter  = "platform"
  Environment = "staging"
  ManagedBy   = "terraform"
  Bead        = "cbd-mta.5.1"
}
```

**Two-pass option (safer first land):** apply with `enable_oidc_publishers = false` first (S3 + ECR only), verify bucket/ECR, then enable OIDC with the existing provider ARN and re-apply.

---

## Step 2 — Plan and apply

```bash
cd environments/platform-staging
terraform init
terraform plan -out=tfplan
# Review: 1× S3 bucket + versioning/lock/encryption/PAB/lifecycle/policy,
#         4× ECR repos + lifecycle policies,
#         0 or 3× IAM roles + inline policies when OIDC on.
# Confirm no force_destroy true, no public access, no second OIDC provider resource.

terraform apply tfplan
terraform output -json > /tmp/platform-staging-product-artifacts.outputs.json
# Store outputs in private operator vault/notes — never commit
```

Expected resources (names depend on `name_prefix` / bucket):

| Kind | Pattern |
|------|---------|
| S3 | `artifact_bucket_name` (staging in name) |
| ECR | `<name_prefix>/portal/{web,bff,relay,control-plane}` |
| IAM roles (if OIDC) | `<name_prefix>-gha-{portal,hermes,client_core}` |

---

## Step 3 — Live verify (describe + denied-prefix simulation)

Uses env-driven inputs only (no hardcoded account/bucket in the script defaults for secrets):

```bash
export AWS_REGION="${AWS_REGION:-us-east-1}"
export ARTIFACT_BUCKET="$(terraform -chdir=environments/platform-staging output -raw artifact_bucket_id)"
export NAME_PREFIX="lanyard-platform-staging"   # must match applied name_prefix
export EXPECT_OIDC_PUBLISHERS=1                 # 0 if OIDC left off
export GITHUB_OIDC_PROVIDER_ARN="arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"

bash scripts/verify-product-artifact-staging.sh
```

The verify script checks:

1. **Caller identity** printed (operator confirms platform staging)
2. **S3:** versioning Enabled, Object Lock enabled, SSE configured, all four public-access blocks true, bucket policy denies `aws:SecureTransport=false`
3. **ECR:** four portal repos exist; `imageTagMutability=IMMUTABLE`; scan on push enabled
4. **OIDC (optional):** exactly one GitHub Actions OIDC provider when expected; publisher role trust subjects are `repo:ORG/REPO:ref:refs/tags/*` for Portal / hermes-lanyard / client-core
5. **Denied-path simulation:** hermes publisher is **denied** `s3:PutObject` under `client-core/` and `portal-web/`; portal denied under `hermes/` (IAM `simulate-principal-policy`)

---

## Step 4 — Wire product repos (private GitHub config)

From Terraform outputs (private notes), set product Actions variables per `references/runbooks/staging-secrets-checklist.md`:

| Repo | Variables / secrets |
|------|---------------------|
| `LanyardBrain/Portal` | `AWS_ROLE_ARN` = portal publisher role; `ARTIFACT_BUCKET`; `ECR_NAME_PREFIX` = `name_prefix`; `AWS_REGION` |
| `LanyardBrain/hermes-lanyard` | `AWS_ROLE_ARN` = hermes role; `ARTIFACT_BUCKET`; `AWS_REGION` |
| `LanyardBrain/client-core` | `AWS_ROLE_ARN` = client_core role; `ARTIFACT_BUCKET`; `AWS_REGION` |

Do **not** commit role ARNs or bucket names into this deploy repo as claimed live pins.

---

## Step 5 — Private evidence pack (outside git)

Store (operator vault / ticket attachment, not this repository):

- [ ] `sts get-caller-identity` account ID used
- [ ] `terraform output` JSON (bucket, ECR URLs, role ARNs)
- [ ] `verify-product-artifact-staging.sh` full log (pass)
- [ ] OIDC provider ARN (single) and confirmation no second provider was created
- [ ] Date/time of apply and operator identity

Update readiness only with honesty:

| Matrix / phase claim | After successful apply |
|----------------------|------------------------|
| Product artifact S3/ECR/OIDC skeleton | Remains **infra_ready** in git; operator may note **staging applied** in private evidence |
| Platform S3 mirror pins (G7 H2/C2/P) | Still **blocked** until product publish lands objects |
| Portal ECR digests | Still pending product image push + pin update |

Never commit live account IDs, bucket names used as “canonical pins,” or tfstate.

---

## Rollback / destroy notes

When product-artifact is part of the **full composed root**, use reverse destroy order and stop conditions in `references/runbooks/platform-staging-compose.md`. Artifacts-only notes:

- **Object Lock:** locked object versions cannot be deleted until retention ends (GOVERNANCE may allow break-glass with `s3:BypassGovernanceRetention` for privileged principals only).
- Prefer **leave staging resources** rather than destroy if objects exist.
- `s3_force_destroy` must stay **false** for real envs; even `true` cannot bypass compliance retention.
- Destroy order if deliberately tearing down empty staging: disable OIDC roles → ECR (empty) → bucket (empty, unlocked versions only) → never delete the account OIDC provider if other stacks use it.

---

## Failure / stop conditions

| Condition | Action |
|-----------|--------|
| Caller account is customer / wrong product / unknown | **Do not apply** — docs and scripts only |
| GitHub OIDC provider already exists | Pass existing ARN; **do not create another** |
| Plan shows OIDC provider resource in product-artifact module | **Abort** — module contract violated |
| Bucket name contains `REPLACE` / `UNCONFIGURED` | Fix private tfvars; do not apply |
| Plan sets `force_destroy = true` on staging with intent to keep data | Fix tfvars |
| Verify script fails denied-prefix or mutability checks | Do not wire product repos until fixed |

---

## Operator sequence (summary)

1. Confirm **platform staging** account (`get-caller-identity`).
2. Ensure **one** GitHub OIDC provider (create once if missing; else reuse ARN).
3. Private `backend.tf` + unique staging bucket name + optional OIDC tfvars.
4. `terraform plan` / `apply` from `environments/platform-staging`.
5. `scripts/verify-product-artifact-staging.sh` (S3/ECR/OIDC + denied-prefix).
6. Configure product repo `AWS_ROLE_ARN` / bucket / ECR prefix privately.
7. Hand off to publish beads (`cbd-mta.5.2` images, `cbd-mta.5.3` S3 mirrors) and pin-update runbook.
8. Keep git free of tfvars, state, and live claimed resource IDs.
