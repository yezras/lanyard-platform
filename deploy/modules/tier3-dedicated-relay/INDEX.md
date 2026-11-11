# tier3-dedicated-relay

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pins |
| `variables.tf` | Tenant naming, network, digest pin, secrets, optional DNS/WAF, honesty gates |
| `main.tf` | Compose `portal-relay-service` + optional Route53 alias + optional WAFv2 association |
| `outputs.tf` | `relay_wss_url`, ALB/ECS handles, secret_names, module_status (infra_ready) |
| `README.md` | Operator contract, SOW language, control-plane routing, honesty |
| `terraform.tfvars.example` | Placeholder-only inputs; not auto-applied |

## Status

**infra_ready** — real ALB/ECS/digest-pin topology; not auto-applied; not production-certified until staging proof + G2.
