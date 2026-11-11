# chat-corpus-infra

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pins |
| `variables.tf` | Naming, bucket, encryption, lifecycle, IAM inputs + validations |
| `main.tf` | Locals + check blocks (KMS when aws:kms; prefix template lock) |
| `s3.tf` | Private corpus bucket + encryption + lifecycle + TLS-only bucket policy + optional CMK |
| `iam.tf` | Writer/reader roles + policies; Deny vault paths |
| `outputs.tf` | Bucket, roles, lifecycle summary, policy JSON, contract summary |
| `README.md` | Operator contract and gated non-goals |
| `terraform.tfvars.example` | Documentation-only module inputs |
