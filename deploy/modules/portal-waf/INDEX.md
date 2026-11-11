# portal-waf

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pin; `configuration_aliases = [aws.us_east_1]` for CloudFront-scope WAF |
| `variables.tf` | Scope toggles, managed rules + rate-based knobs, ALB association ARNs, honesty gate |
| `main.tf` | CLOUDFRONT WebACL (us-east-1), REGIONAL WebACL, optional ALB associations |
| `outputs.tf` | WebACL ARNs/IDs, association list, consumer wiring, WAF posture (no secrets) |
| `README.md` | Operator contract, dual-provider wiring, public-edge-only posture |
| `terraform.tfvars.example` | Placeholder-safe inputs (no live account IDs or secrets) |
