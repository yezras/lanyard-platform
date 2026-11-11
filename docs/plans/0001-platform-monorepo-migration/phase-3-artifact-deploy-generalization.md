# Phase 3. Artifact and deploy generalization

Back to [overview](overview.md).

## Goal

Generalize the existing Hermes tarball pipeline into a backend artifact pipeline.

Bead: `lp-k7g.7`.

## Changes

- Replace `hermes.*` compatibility pins with `backend.*` pins.
- Keep legacy Hermes pin aliases only for migration.
- Render generic backend artifact variables into EC2 user data.
- Install backend artifacts under a generic path and maintain a current symlink.
- Write backend provenance using backend names.
- Keep client-core as a separate artifact and install it into the vault root.

## Data structures

- `CompatibilityPinsV2`: backend, client_core, portal, contract versions.
  - Pin document design: [`compatibility/schema.json`](../../../compatibility/schema.json), [`compatibility/README.md`](../../../compatibility/README.md).
  - Legacy `hermes.*` → `backend.*` translation: [`compatibility/translation-v1-to-v2.md`](../../../compatibility/translation-v1-to-v2.md).
  - `client_core` remains a separate top-level block (never nested under `backend`).
- **Terraform variables** (`hermes_artifact_*` → `backend_artifact_*`):
  - Design: [`docs/architecture/deploy-backend-artifact-variables.md`](../../architecture/deploy-backend-artifact-variables.md).
  - Merge-ready HCL stubs: [`deploy/modules/company-brain-ec2/`](../../../deploy/modules/company-brain-ec2/), [`deploy/templates/tenant/`](../../../deploy/templates/tenant/) (Bead `lp-k7g.7.3`).
  - Temporary legacy aliases (`hermes_artifact_*`, `relay_contract_major`) are accept-only for the migration window.
- **Bootstrap install + provenance** (Bead `lp-k7g.7.4`):
  - Design: [`docs/architecture/deploy-bootstrap-backend-install.md`](../../architecture/deploy-bootstrap-backend-install.md).
  - Layout: `/opt/company-brain-backend/versions/<version>/` + `current` → selected version.
  - Provenance JSON schema: [`deploy/schemas/backend-install-provenance.schema.json`](../../../deploy/schemas/backend-install-provenance.schema.json).
  - Reference script: [`deploy/scripts/bootstrap-backend-install.sh`](../../../deploy/scripts/bootstrap-backend-install.sh) (generalizes Hermes block of `bootstrap-host.sh`).
  - Offline smoke: [`deploy/scripts/smoke-bootstrap-backend-install.sh`](../../../deploy/scripts/smoke-bootstrap-backend-install.sh).
- `BackendInstallProfile`: install path, entrypoint, env aliases, service unit (`lp-k7g.7.5` for systemd).
  - Design: [`docs/architecture/deploy-backend-systemd-service.md`](../../architecture/deploy-backend-systemd-service.md).
  - Unit scaffold: [`deploy/modules/company-brain-ec2/systemd/company-brain-backend.service`](../../../deploy/modules/company-brain-ec2/systemd/company-brain-backend.service).
  - `ExecStart=/opt/company-brain-backend/current/bin/company-brain-backend gateway`; `HERMES_HOME` only as compatibility alias equal to `BACKEND_HOME`.
- **Artifact landing zones + OIDC publisher trust** (Bead `lp-k7g.7.6`):
  - Design: [`docs/architecture/deploy-artifact-landing-zones.md`](../../architecture/deploy-artifact-landing-zones.md).
  - Backend families: `s3://$BUCKET/backends/<kind-slug>/<version>/…` (`hermes-lanyard`, `lanyard-agent`, …).
  - **Unchanged:** `client-core/` and `portal-web/` prefixes and their publisher roles.
  - Hermes-Lanyard OIDC trust stays `repo:LanyardBrain/hermes-lanyard:ref:refs/tags/*` (temporary dual-write to legacy `hermes/`).
  - Lanyard Agent publisher path: role `lanyard_agent` → `backends/lanyard-agent/` only.
  - Stubs: [`deploy/modules/product-artifact-infra/`](../../../deploy/modules/product-artifact-infra/); offline smoke [`deploy/scripts/smoke-artifact-landing-zones.sh`](../../../deploy/scripts/smoke-artifact-landing-zones.sh).
  - References company-brain-deploy `modules/product-artifact-infra` + `references/product-artifact-release-contract.md` (pre-import).
- `ArtifactProvenance`: kind, version, url, sha256, contract majors, installed_at (JSON under `.seed/provenance.json`).
- **Upgrade / rollback runbook** (Bead `lp-k7g.7.7`):
  - Operator procedure: change `backend.*` pins → apply deploy / re-bootstrap → verify (health, Portal settings, provenance, systemd) → Hermes-Lanyard → Lanyard Agent swap → roll back to previous pins.
  - Runbook: [`docs/runbooks/backend-upgrade-rollback.md`](../../runbooks/backend-upgrade-rollback.md).
  - Previous version trees under `/opt/company-brain-backend/versions/` are retained for fast host rollback.

## Verification

- Existing Hermes-Lanyard pins convert to backend pins.
- Bootstrap can still install Hermes-Lanyard (as `kind: hermes_lanyard` under the generic root).
- Re-running bootstrap converges to the same selected backend and client-core version.
- `bash deploy/scripts/smoke-bootstrap-backend-install.sh` passes offline (verify-before-extract, `current` symlink, provenance fields, idempotency).
- `bash deploy/scripts/smoke-artifact-landing-zones.sh` passes offline (backends/ strategy, Hermes dual-write trust, Lanyard Agent path, client-core/portal-web unchanged).
- Upgrade/rollback runbook covers Hermes-Lanyard ↔ Lanyard Agent swap, previous-pin rollback, and concrete verification commands ([`docs/runbooks/backend-upgrade-rollback.md`](../../runbooks/backend-upgrade-rollback.md)).
