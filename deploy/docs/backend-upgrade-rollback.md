# Backend upgrade and rollback

**Bead:** `lp-k7g.7.7` · **Status:** operator runbook (platform paths).

## Full runbook

Canonical procedure (change pins → apply/bootstrap → verify → Hermes-Lanyard →
Lanyard Agent swap → roll back to previous pins):

**[docs/runbooks/backend-upgrade-rollback.md](../../docs/runbooks/backend-upgrade-rollback.md)**

Hermes-Lanyard **staging cutover** (generic `BACKEND_*` path, exact commands,
offline prep + live blockers): **[docs/runbooks/staging-hermes-lanyard-backend-pins.md](../../docs/runbooks/staging-hermes-lanyard-backend-pins.md)** (`lp-k7g.12.5`).

## Scaffold this procedure uses

| Path | Role |
| --- | --- |
| [`../scripts/bootstrap-backend-install.sh`](../scripts/bootstrap-backend-install.sh) | Versioned install + `current` + provenance |
| [`../schemas/backend-install-provenance.schema.json`](../schemas/backend-install-provenance.schema.json) | Provenance JSON Schema |
| [`../modules/company-brain-ec2/systemd/company-brain-backend.service`](../modules/company-brain-ec2/systemd/company-brain-backend.service) | Generic gateway unit |
| [`../templates/tenant/terraform.tfvars.backend_artifact.example`](../templates/tenant/terraform.tfvars.backend_artifact.example) | Pin → Terraform field map |
| [`../../compatibility/pins.example.yaml`](../../compatibility/pins.example.yaml) | Pin document shape (schema_version 2) |
| [`../../compatibility/pins.hermes-lanyard-staging.example.yaml`](../../compatibility/pins.hermes-lanyard-staging.example.yaml) | HL staging cutover pins (`lp-k7g.12.5`) |
| [`../examples/staging-hermes-lanyard/`](../examples/staging-hermes-lanyard/) | `artifact-pins.env` + tfvars fragments + rollback capture template |

## One-line flow

```text
capture live pins → edit backend.{kind,version,url,sha256,contract}
  → terraform apply and/or bootstrap-backend-install.sh
  → verify provenance + systemd + Portal health/settings
  → on failure: ln -sfn versions/<prev> current (or re-bootstrap previous pins)
```
