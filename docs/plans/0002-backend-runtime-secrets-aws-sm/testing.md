# Testing

Back to [overview](overview.md).

## Offline (every PR)

| Check | Command / method |
| --- | --- |
| Envelope schema | validate examples + negatives |
| Materialize merge | `--from-file` fixture; second run checksum |
| Terraform | `terraform validate` mocklab + company-brain-ec2 |
| Monorepo gate | `bash scripts/validate.sh` |

## Staging / mocklab (phase 4)

| Check | Method |
| --- | --- |
| SM readable by role | IAM policy simulation or materialize exit 0 |
| Env key names present | SSM Run Command `grep -E '^[A-Z_]+=' .env.secrets \| cut -d= -f1` |
| Gateway up | `systemctl is-active hermes-gateway` |
| Product | Portal settings models / chat |

## Non-goals for automated CI

- No real API keys in CI.
- No live SM in default `validate.sh` (optional opt-in job later).
