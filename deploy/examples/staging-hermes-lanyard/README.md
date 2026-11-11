# Staging Hermes-Lanyard pin fragments (`lp-k7g.12.5`)

Offline operator materials for staging a tenant host with **generic
`BACKEND_*` / `backend_artifact_*` pins** selecting Hermes-Lanyard.

| Path | Role |
| --- | --- |
| [`artifact-pins.env.fragment`](artifact-pins.env.fragment) | Host `/etc/company-brain/artifact-pins.env` dual-write example |
| [`tfvars.backend.fragment.hcl`](tfvars.backend.fragment.hcl) | Tenant `backend_artifact_*` tfvars fragment |
| [`rollback-pin-capture.template.sh`](rollback-pin-capture.template.sh) | Pre-change capture script template (run on host with sudo) |
| This README | Index |

Canonical pin document (schema_version 2):

[`compatibility/pins.hermes-lanyard-staging.example.yaml`](../../../compatibility/pins.hermes-lanyard-staging.example.yaml)

## Operator docs

- Staging runbook (exact commands): [`docs/runbooks/staging-hermes-lanyard-backend-pins.md`](../../../docs/runbooks/staging-hermes-lanyard-backend-pins.md)
- Upgrade / rollback (generic): [`docs/runbooks/backend-upgrade-rollback.md`](../../../docs/runbooks/backend-upgrade-rollback.md)
- Cutover evidence (offline prep + blockers): [`docs/plans/0001-platform-monorepo-migration/cutover-staging-hermes-lanyard.md`](../../../docs/plans/0001-platform-monorepo-migration/cutover-staging-hermes-lanyard.md)

## Honesty

These fragments do **not** prove live EC2 install. Live staging requires AWS
credentials, artifact download auth, and human approval for `terraform apply`
/ host changes. Orchestrator policy forbids unapproved cloud deploys.
