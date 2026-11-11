# portal-valkey

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS + random provider pins |
| `variables.tf` | Network, engine/HA, encryption, backup/maintenance, logs/alarms, secrets, honesty gates |
| `main.tf` | Locals, private-subnet checks, SG, ElastiCache Valkey replication group, Secrets Manager REDIS_URL, optional SSM pointer + CloudWatch alarms |
| `outputs.tf` | Endpoints, port, secret ARN, redacted URL shape, ECS injection contract (no raw auth token outputs) |
| `README.md` | Operator contract, fail-closed posture, staging cost vs HA, product `REDIS_URL` wiring, residual honesty (G5 dual-BFF defer; not production certified) |
| `terraform.tfvars.example` | Placeholder-only inputs (no live account IDs or auth tokens) |
