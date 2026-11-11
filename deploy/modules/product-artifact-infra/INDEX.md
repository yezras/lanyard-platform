# product-artifact-infra

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pins |
| `variables.tf` | Naming, S3, ECR, optional OIDC inputs + validations |
| `main.tf` | Locals + check blocks (OIDC provider required; ECR subset) |
| `s3.tf` | Private versioned artifact bucket + Object Lock + encryption + lifecycle + TLS-only / optional VPCE bucket policy |
| `ecr.tf` | Immutable-tag ECR repos for Portal services |
| `iam_oidc.tf` | Optional GitHub Actions OIDC publisher roles/policies |
| `outputs.tf` | Bucket, prefixes, ECR URLs, role ARNs, release contract summary |
| `README.md` | Operator contract and gated non-goals |
| `terraform.tfvars.example` | Documentation-only module inputs |
