# Phase 3. Terraform wiring

Back to [overview](overview.md).

## Goal

Wire secret **references**, IAM, and materialize invocation into the monorepo deploy path so apply/bootstrap is enough for every tenant.

## Variables (company-brain-ec2 + tenant roots)

| Variable | Purpose |
| --- | --- |
| `backend_runtime_secrets_arn` | SM ARN (required for production intent; optional lab) |
| `backend_runtime_secrets_enabled` | bool, default true when ARN set |
| `backend_model_provider` | non-secret default provider id (e.g. `openai`, `xai`) |
| `backend_model_default` | non-secret default model id |
| `backend_runtime_secrets_region` | optional override |

**Never** variables for raw API key strings.

## Resources / attachments

1. **IAM** on instance role: `secretsmanager:GetSecretValue` (+ `kms:Decrypt` via service condition if needed) **only** for `backend_runtime_secrets_arn`.
2. **user_data / setup.sh**: export `BACKEND_RUNTIME_SECRETS_ARN`, call materialize after home dirs exist, before or as part of gateway enable.
3. **systemd**: ensure unit has `EnvironmentFile` for secrets file **or** materialize into existing `.env` before `ExecStart`. Prefer `ExecStartPre=` materialize for rotation without full reprovision.
4. **Public config seed**: write non-secret `model.provider` / `model.default` into config if missing (do not overwrite operator non-secret customizations unless flagged).

## Mocklab monorepo root

- Ensure `deploy/deployments/mocklab` has committed **non-secret** Terraform sources (`main.tf`, `variables.tf`, …) derived from the live operator tree (sanitize; no secrets).
- gitignore remains for `backend.tf`, `terraform.tfvars`.
- `terraform.tfvars.example` documents `backend_runtime_secrets_arn`.

## Pattern reuse

Mirror `customer-gateway-relay` / Tailscale:

- ARN in TF, value only in SM
- Host fetch, not TF `local_file` of secret content in production

## Verification

- `terraform validate` on company-brain-ec2 + mocklab
- `terraform plan` on mocklab with dummy ARN shape (or real ARN): shows IAM + user_data change, **no secret values in plan**
- Offline policy scripts still reject inline secret patterns for production mode

## Beads

Implementable leaves: module vars/IAM/user_data; mocklab root commit; examples.
