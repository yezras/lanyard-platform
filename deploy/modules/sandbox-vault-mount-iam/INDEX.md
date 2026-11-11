# sandbox-vault-mount-iam

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pins |
| `variables.tf` | Role name, vault bucket, orchestrator principals, ExternalId, attach flags |
| `main.tf` | Locals + fail-closed checks |
| `iam.tf` | Base mount role, trust, upper-bound identity, CP task AssumeRole grant |
| `templates/session-policy.json` | Per-tenant STS session policy template (placeholders) |
| `outputs.tf` | Role ARN, policy JSON, CP env contract, contract summary |
| `README.md` | Operator contract and gated non-goals |
| `terraform.tfvars.example` | Documentation-only module inputs |
