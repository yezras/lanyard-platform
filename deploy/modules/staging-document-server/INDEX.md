# staging-document-server

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS + random provider pins |
| `variables.tf` | Network, digest pin, JWT/license SM, health, honesty gates |
| `main.tf` | Public Docs ALB, TG `/healthcheck`, Fargate ONLYOFFICE Community, SM JWT |
| `outputs.tf` | ALB DNS, JWT secret **ARN**, host for BFF allowlist, module_status (no secret values) |
| `README.md` | Topology contract, reachability, secrets, rollback, honesty |
| `terraform.tfvars.example` | Placeholder-only inputs |

**Topology:** `staging-platform-shared-ds` (ADR 0006)  
**Bead:** `lp-5q6.34`
