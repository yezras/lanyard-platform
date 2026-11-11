# customer-account-access

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pins |
| `variables.tf` | Trust principals, ExternalId, session controls, artifact ARNs, honesty gate |
| `main.tf` | Customer IAM role trust (ExternalId), permissions boundary, deploy policy, cross-tenant denies |
| `outputs.tf` | Role ARN, ExternalId parameter *name*, assume-role CLI + provider HCL templates, rotate/revoke summary |
| `README.md` | Track B contract, provider alias wiring, artifact paths, offboard |
| `terraform.tfvars.example` | Placeholder-only inputs (no live account IDs or ExternalIds as production secrets) |
