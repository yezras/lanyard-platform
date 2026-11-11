# portal-relay-service

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pins |
| `variables.tf` | Network, digest pin, health, G6 scale gate, secrets map (REDIS_URL via Valkey), honesty |
| `main.tf` | Public ALB, TG `/health`, Fargate, scoped SM/SSM IAM, stickiness |
| `outputs.tf` | ALB DNS, SGs, image pin, secret_names (no REDIS_URL values), module_status |
| `README.md` | Operator contract + Valkey bus/jti/leases + store outage notes |
| `terraform.tfvars.example` | Placeholder-only inputs; `module.portal_valkey.redis_url_secret_arn` pattern |
