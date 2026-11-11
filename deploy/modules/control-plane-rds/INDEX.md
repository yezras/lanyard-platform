# control-plane-rds

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS + random provider pins |
| `variables.tf` | Network, engine, encryption, backups, secrets, honesty gates |
| `main.tf` | Locals, private-subnet checks, SG, RDS Postgres, Secrets Manager URL payload, optional SSM ARN pointer |
| `outputs.tf` | Endpoints, secret ARN, redacted URL shape, env contract (no raw password outputs) |
| `README.md` | Operator contract, fail-closed posture, product `CONTROL_PLANE_DATABASE_URL` wiring |
| `terraform.tfvars.example` | Placeholder-only inputs (no live account IDs or passwords) |
