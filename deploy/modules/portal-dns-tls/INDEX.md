# portal-dns-tls

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pin; `configuration_aliases = [aws.us_east_1]` for CloudFront ACM |
| `variables.tf` | Hostnames, zone create/consume, existing cert ARNs, alias targets, honesty gate |
| `main.tf` | Optional Route53 zone; us-east-1 CloudFront ACM + DNS validation; regional ACM for BFF/relay/Docs; A/AAAA aliases (web/BFF/relay) |
| `outputs.tf` | Zone ID, validated cert ARNs, FQDNs, consumer wiring, TLS posture (no secrets) |
| `README.md` | Operator contract, dual-provider wiring, HTTP→HTTPS / wss-only posture |
| `terraform.tfvars.example` | Placeholder-safe inputs (no live account IDs or secrets) |
