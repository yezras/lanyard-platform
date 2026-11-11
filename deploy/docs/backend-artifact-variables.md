# Backend artifact Terraform variables

Canonical design (field map, legacy aliases, user_data dual-write, merge plan):

**[docs/architecture/deploy-backend-artifact-variables.md](../../docs/architecture/deploy-backend-artifact-variables.md)**

## Stubs in this tree

| File | Purpose |
| --- | --- |
| [`../modules/company-brain-ec2/backend_artifact_variables.tf`](../modules/company-brain-ec2/backend_artifact_variables.tf) | Module inputs: `backend_artifact_url` / `version` / `sha256` + kind + **`backend_artifact_arch`** (default `linux-x86_64`) + contract (`hermes_*` remain in `variables.tf`) |
| [`../modules/company-brain-ec2/backend_artifact_locals.tf`](../modules/company-brain-ec2/backend_artifact_locals.tf) | Effective pin resolution; conflict check when both names set |
| [`../modules/company-brain-ec2/backend_artifact_outputs.tf`](../modules/company-brain-ec2/backend_artifact_outputs.tf) | `backend_artifact_pins` output (+ temporary hermes-shaped keys) |
| [`../modules/company-brain-ec2/user_data_backend_pins.fragment.tftpl`](../modules/company-brain-ec2/user_data_backend_pins.fragment.tftpl) | `artifact-pins.env` dual-write fragment |
| [`../templates/tenant/backend_artifact_variables.tf`](../templates/tenant/backend_artifact_variables.tf) | Tenant-root inputs |
| [`../templates/tenant/backend_artifact_module_args.tf.example`](../templates/tenant/backend_artifact_module_args.tf.example) | How tenant passes vars into the EC2 module |
| [`../templates/tenant/backend_artifact_outputs.tf`](../templates/tenant/backend_artifact_outputs.tf) | Tenant outputs |
| [`../templates/tenant/terraform.tfvars.backend_artifact.example`](../templates/tenant/terraform.tfvars.backend_artifact.example) | Placeholder-safe tfvars |

## Temporary legacy aliases

`hermes_artifact_*`, `relay_contract_major`, and `hermes_install_path` remain in
product `variables.tf` (accept-only during the migration window). Prefer
`backend_artifact_*` / `backend_contract_*` / `backend_install_path` in all new
tfvars. `lp-k7g.10.2` keeps legacy names only in product files so roots validate
without duplicate declarations.
