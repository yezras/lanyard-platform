# portal-cognito

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pin |
| `variables.tf` | Naming, honesty gate, optional callback URLs |
| `main.tf` | User pool + confidential app client (`ADMIN_USER_PASSWORD_AUTH`) |
| `outputs.tf` | Pool/client ids; client secret marked sensitive |
| `README.md` | Operator contract — not auto-applied |
| `terraform.tfvars.example` | Placeholder-safe inputs |

Infra_ready only. Live apply is operator-owned. Client secret must go through the BFF secrets map (`COGNITO_CLIENT_SECRET`), never plaintext `environment_variables`.
