# harness-exec-iam

ECS **task execution** role for the shared Fargate harness (`lp-oop.38.20`).

Live roll of `lanyard-platform-staging-harness:11` failed to place until
`lanyard-platform-staging-bff-exec-secrets` allowed `secretsmanager:GetSecretValue`
on SM names `harness-litellm` and `daytona` already referenced by the task
definition. `:10` had fetched those secrets earlier; draining it left the
service unable to start.

This module is the dedicated exec role so IAM reconcile keeps those ARNs
without expanding the BFF container secrets map.

| Resource | Purpose |
|----------|---------|
| Exec role `{name_prefix}-harness-exec` | `ecs-tasks.amazonaws.com` assume |
| `AmazonECSTaskExecutionRolePolicy` | ECR pull + awslogs |
| Inline `…-harness-exec-secrets` | `GetSecretValue` on the catalog only |

**Offline smoke:** `bash deploy/scripts/smoke-harness-exec-iam.sh`  
**Example task def:** `deploy/dev/mocklab-short-stack-harness/task-definition.example.json`  
Not auto-applied. Do not terraform apply from this bead.

## Catalog (names only)

SoT: [`secret-catalog.json`](./secret-catalog.json)

| SM name | Why the harness task references it |
|---------|------------------------------------|
| `lanyard/staging/portal/harness-service-token` | BFF ↔ harness header |
| `lanyard/staging/portal/harness-litellm` | LiteLLM keys for the Fargate runner |
| `lanyard/staging/portal/daytona` | Toolbox client (`DAYTONA_API_KEY` JSON keys). Guest still must not receive this secret |

IAM Resource is `arn:aws:secretsmanager:{region}:{account}:secret:{name}-*`
(the `-*` matches the SM random suffix). Never `Resource="*"`.

## Live residual (shared BFF exec)

Until the harness **task definition** `executionRoleArn` is this role, live still
uses `lanyard-platform-staging-bff-exec`. A BFF IAM apply would strip the
emergency patch unless `execution_extra_secret_arns` on
`modules/portal-bff-service` lists the same two ARNs (no BFF container inject).

Preferred: apply this module from a **private** root, register a new harness
revision with `executionRoleArn` = this role, then drop the BFF extra ARNs.

## What this does **not** do

| Item | Why |
|------|-----|
| `terraform apply` | Operator-owned; bead forbids it |
| New ECS cluster / ALB | Existing CP cluster (`lp-oop.30`) |
| Harness **task** role | Logs only; never CP task role |
| Inject secrets into BFF | Extra ARNs on BFF are IAM-only |
| Guest `DAYTONA_API_KEY` | Tool-only snapshot stays free of platform keys |

## Usage

```hcl
module "harness_exec_iam" {
  source = "../../modules/harness-exec-iam"

  name_prefix                    = "lanyard-platform-staging"
  environment                    = "staging"
  aws_region                     = "us-east-1"
  aws_account_id                 = var.aws_account_id # private tfvars
  acknowledge_not_auto_applied   = true
}
```

Prefer **relative** module sources. External consumers pin a tag/commit — never `ref=main`.
