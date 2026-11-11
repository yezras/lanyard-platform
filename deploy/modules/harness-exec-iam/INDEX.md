# harness-exec-iam

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pins |
| `variables.tf` | Role name, account/region for ARN patterns, extra names/ARNs, honesty gate |
| `secret-catalog.json` | SM names the harness task `secrets[]` references (SoT) |
| `main.tf` | Catalog → ARN patterns; fail-closed checks |
| `iam.tf` | ECS exec role + scoped GetSecretValue (no Resource="*") |
| `outputs.tf` | Role ARN, secret **names** / ARN patterns (never values) |
| `README.md` | Operator contract; live residual vs dedicated role |
| `terraform.tfvars.example` | Placeholder-only inputs |
