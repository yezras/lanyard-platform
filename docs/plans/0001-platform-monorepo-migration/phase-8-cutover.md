# Phase 8. Cutover and repository archival

Back to [overview](overview.md).

## Goal

Cut over to the monorepo after contracts, deploy, Portal, and client-core migration are verified.

Bead: `lp-k7g.12`.

## Changes

- Dry-run source imports with history preservation per [ADR 0005](../../adr/0005-history-preserving-import-strategy.md) and [import-strategy.md](../../architecture/import-strategy.md): `git filter-repo` prefix rewrite then merge (order `client-core` → `portal` → `deploy`); practice branch abandon and merge-revert rollback.
  - **`lp-k7g.12.1` Portal dry-run:** landed under `portal/` (freeze `981c727c3a2877301c5c60eb859495012a6d2dba`); phase-4 scaffolds retained; commands mapped in [portal/testing.md](../../../portal/testing.md).
  - **`lp-k7g.12.2` client-core dry-run:** re-verified phase-5 import under `client-core/` (freeze `4225110cb7549db615b01176884957d932cb2a3b`); seed matches source; pack-release dry-run + pack validation pass. Evidence: [cutover-client-core-dry-run.md](cutover-client-core-dry-run.md).
  - **`lp-k7g.12.3` deploy dry-run:** re-verified phase-6 import under `deploy/` (freeze `301d313c23ea62de087118615f2c1494fffbc1c4`); module paths resolve; terraform validate on example roots; bootstrap path injects. Evidence: [cutover-deploy-dry-run.md](cutover-deploy-dry-run.md).
- Update CI and release workflows — **landed `lp-k7g.12.4`:** root [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) (path-filtered offline + portal / client-core / deploy / contracts), [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) (emit `client_core` + `portal` pin data; **contract-gate blocks release** on failure), integrated [`.github/workflows/conformance.yml`](../../../.github/workflows/conformance.yml) path filters. Path matrix: [ci-and-release.md](../../architecture/ci-and-release.md).
- Publish new compatibility pins from the monorepo (release workflow artifacts; backend pins remain external product releases).
- Run staging deploy with Hermes-Lanyard.
  - **`lp-k7g.12.5` offline prep (partial):** staging runbook + schema_version 2 HL pins + `BACKEND_*` fragments + rollback capture template; live EC2/Portal **not** executed (no apply without human approval). Evidence: [cutover-staging-hermes-lanyard.md](cutover-staging-hermes-lanyard.md). Runbook: [staging-hermes-lanyard-backend-pins.md](../../runbooks/staging-hermes-lanyard-backend-pins.md).
- Run staging deploy with Lanyard Agent once it conforms.
- Mark old Portal, client-core, and deploy repositories read-only after cutover (source tags stay on those archives).

## Data structures

- `CutoverChecklist`: repository, import status, CI status, release status, archive status.
- `RollbackPoint`: previous repo release pins, deploy state, recovery command.

## Verification

- Staging deploy succeeds with generic backend pins.
- Portal settings, vault, projects, chat, and relay health work through Brain RPC.
- Rollback runbook can restore the previous artifact pins.
- **client-core dry-run (`lp-k7g.12.2`):** seed matches freeze; tarball shape + pack validation offline — see [cutover-client-core-dry-run.md](cutover-client-core-dry-run.md); re-run `bash scripts/validate.sh` (checks 14–16).
- **deploy dry-run (`lp-k7g.12.3`):** module paths resolve; terraform validate example roots; bootstrap path resolves — see [cutover-deploy-dry-run.md](cutover-deploy-dry-run.md); re-run `bash deploy/scripts/validate-staging-roots.sh` and `bash scripts/validate.sh` (check 17).
- **Hermes-Lanyard staging pins (`lp-k7g.12.5`):** offline pin validate + bootstrap/inject/systemd smokes + rollback template — see [cutover-staging-hermes-lanyard.md](cutover-staging-hermes-lanyard.md); live EC2 install and Portal E2E remain **pending** human-approved staging.
