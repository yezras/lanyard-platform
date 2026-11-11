# lab-sandbox-vault-mount-iam

Lab apply root for **`lp-zuh.9.1`**: shared base role `lanyard-sandbox-vault-mount` + CP task `sts:AssumeRole` grant on the existing mocklab vault bucket.

## Prerequisites

| Item | Value |
|------|--------|
| AWS account | `123456789012` (lab / mocklab) |
| Profile | `AWS_PROFILE=lanyard-main` |
| Vault bucket | `lanyard-mocklab-vault-123456789012` (must exist — `lp-d26`) |
| CP task role | `lanyard-platform-staging-cp-task` |

## Apply

```bash
export AWS_PROFILE=lanyard-main AWS_REGION=us-east-1
cd deploy/deployments/lab-sandbox-vault-mount-iam
terraform init
terraform plan
terraform apply
```

## Outputs (non-secret)

- `role_arn` → set CP `SANDBOX_VAULT_MOUNT_ROLE_ARN`
- `vault_bucket_name` → `LANYARD_VAULT_BUCKET` / platform vault config
- `orchestrator_roles_with_assume_policy` → should include `lanyard-platform-staging-cp-task`

## Validate

```bash
bash deploy/scripts/smoke-sandbox-vault-mount-iam.sh
SMOKE_SANDBOX_VAULT_MOUNT_IAM_LIVE=1 bash deploy/scripts/smoke-sandbox-vault-mount-iam.sh
```

## Live evidence (`lp-zuh.9.1`, lab account `123456789012`)

Applied role: `arn:aws:iam::123456789012:role/lanyard-sandbox-vault-mount`  
Trust (durable): `lanyard-platform-staging-cp-task` only  
CP grant: inline `lanyard-sandbox-vault-mount-assume` on CP task (`sts:AssumeRole` + `TagSession`)

| Check | Result (names only; no secrets) |
|-------|----------------------------------|
| Offline smoke | PASS |
| Live smoke (`SMOKE_SANDBOX_VAULT_MOUNT_IAM_LIVE=1`) | PASS — trust + CP grant + simulate bound allow / foreign+platform deny; operator AssumeRole AccessDenied when not in trust |
| Positive STS + session policy (ephemeral dual-trust for operator proof, then restored CP-only) | Session `…/lanyard-sandbox-vault-mount/lp-zuh91-live-proof`; bound list/put/delete OK; foreign prefix + root list **AccessDenied** |

## Do not

- Commit `*.tfstate`, `terraform.tfvars` with secrets, or access keys
- Destroy the vault bucket
- Add `Principal: *` to trust
- Create long-lived IAM users/keys for guest mount
