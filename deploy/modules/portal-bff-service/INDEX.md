# portal-bff-service

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pins |
| `variables.tf` | Network, digest pin, health, G5 scale gate, secrets map (REDIS_URL via Valkey), execution_extra_secret_arns (IAM-only), honesty |
| `main.tf` | Public ALB, TG `/health`, Fargate service, scoped SM/SSM IAM, logs |
| `outputs.tf` | ALB DNS, SGs, image pin, secret_names (no REDIS_URL values), module_status |
| `README.md` | Operator contract + Valkey/REDIS_URL + session TTLs + store outage notes |
| `terraform.tfvars.example` | Placeholder-only inputs; `module.portal_valkey.redis_url_secret_arn` pattern |
