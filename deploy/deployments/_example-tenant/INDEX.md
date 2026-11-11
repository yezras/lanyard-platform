# Example tenant (not a live deployment)

Copy from `../../templates/tenant/` when creating a real tenant directory under `deployments/<tenant_slug>/`.

This folder is **documentation-only** so this repository never holds live tfvars, state, account IDs, or customer data.

Pilot lean client host notes (`t3.medium` MVP, optional layers off): `templates/tenant/terraform.tfvars.example` § Pilot cost profile — plan `references/plans/pilot-cost-rightsize/overview.md`.

## Checklist for a real tenant

1. `cp -a templates/tenant deployments/<tenant_slug>`
2. Configure artifact pins (not `UNCONFIGURED`) — **Hermes from hermes-lanyard only** (never raw Nous); install path `/opt/hermes-lanyard` (`references/runbooks/pin-update.md`)
3. Configure `relay_wss_url` + `relay_instance_id`; put provision secret in SSM SecureString; set `relay_secret_ssm_parameter_name` (not `relay_instance_secret` in production)
4. Configure remote state (`backend.tf.example` → `backend.tf`) with encryption + locking
5. Apply Terraform; prefer SSM, then run `sudo /usr/local/sbin/company-brain-bootstrap`
6. On host: fetch relay secret via instance role → `/home/hermes/.hermes/.env` (see `references/runbooks/relay-secret-lifecycle.md`)
7. `sudo systemctl enable --now hermes-gateway` — unit ExecStart is `/opt/hermes-lanyard/bin/hermes gateway` (no second gateway binary)
8. Optional **lab/mock only:** `seed-demo-vault.sh` / `seed-demo-hermes-projects.sh` — **not** for production customer content
9. Never commit `terraform.tfvars`, state, or plans with secrets

Post-bootstrap detail: `templates/tenant/INDEX.md` § Post-bootstrap checklist.
