# account-factory

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pins |
| `variables.tf` | Request interface, honesty gates, baseline toggles, deploy/break-glass trust |
| `main.tf` | Optional in-account baseline: KMS, S3/DynamoDB state, logs, Backup vault, budget, IAM roles |
| `outputs.tf` | account_id, deploy_role_arn, KMS, state backend template, request contract, decommission checklist |
| `README.md` | Contract honesty, CT/AFT wiring, non-claims |
| `terraform.tfvars.example` | Placeholder-only inputs (no live account IDs as production claims) |
| `scp/*.json` | Baseline SCP templates for OU attach (not applied by module) |
| `templates/aft-account-request.example.json` | Example AFT/CT request shape |
