# portal-control-plane-service

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pins |
| `variables.tf` | Private network, digest pin, secrets map, legacy DB secret ARN + format (json_keys/plain), optional instance-secret-material SM ARN (`lp-oop.37.6`), honesty |
| `main.tf` | Internal ALB only, TG `/health`, Fargate, scoped SM/SSM IAM; dual CP DB URL inject |
| `outputs.tf` | Internal ALB DNS, SGs, image pin, secret_names, module_status |
| `README.md` | G1 private posture + product wiring |
| `terraform.tfvars.example` | Placeholder-only inputs |
