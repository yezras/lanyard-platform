# Issue map

Main migration epic: `lp-k7g`.

How agents claim, update, close, and record completion evidence: [beads-workflow.md](../../architecture/beads-workflow.md). Discover live status with:

```bash
bd ready
bd show lp-k7g          # root epic + phase children
bd show lp-k7g.5        # phase 1 epic (through lp-k7g.12 for later phases)
```

## Phase epics (quick index)

| Phase | Epic | Plan |
| --- | --- | --- |
| — | `lp-k7g` | [overview.md](overview.md) (main migration epic) |
| 1 | `lp-k7g.5` | [phase-1-repository-foundation.md](phase-1-repository-foundation.md) |
| 2 | `lp-k7g.6` | [phase-2-backend-runtime-contract.md](phase-2-backend-runtime-contract.md) |
| 3 | `lp-k7g.7` | [phase-3-artifact-deploy-generalization.md](phase-3-artifact-deploy-generalization.md) |
| 4 | `lp-k7g.8` | [phase-4-portal-backend-abstraction.md](phase-4-portal-backend-abstraction.md) |
| 5 | `lp-k7g.9` | [phase-5-client-core-migration.md](phase-5-client-core-migration.md) |
| 6 | `lp-k7g.10` | [phase-6-deploy-migration.md](phase-6-deploy-migration.md) |
| 7 | `lp-k7g.11` | [phase-7-backend-conformance.md](phase-7-backend-conformance.md) |
| 8 | `lp-k7g.12` | [phase-8-cutover.md](phase-8-cutover.md) |

## Planning records

These are closed. They explain how this first planning commit was produced.

- `lp-k7g.1`: plan step: read pstack principles and playbook.
- `lp-k7g.2`: plan step: capture scope and repository boundary.
- `lp-k7g.3`: plan step: write migration plan docs.
- `lp-k7g.4`: plan step: create migration backlog.

## Phase 1. Repository foundation

Epic: `lp-k7g.5`.

- `lp-k7g.5.1`: doc: finalize repo boundary and ADR index.
- `lp-k7g.5.2`: chore: choose monorepo workspace paths.
- `lp-k7g.5.3`: chore: define history-preserving import strategy.
- `lp-k7g.5.4`: chore: add initial validation plan.
- `lp-k7g.5.5`: doc: define Beads workflow for migration.

## Phase 2. Backend runtime contract

Epic: `lp-k7g.6`.

- `lp-k7g.6.1`: contract: define backend artifact manifest schema.
- `lp-k7g.6.2`: contract: define backend runtime filesystem layout.
- `lp-k7g.6.3`: contract: define backend config schema from Hermes-Lanyard baseline.
- `lp-k7g.6.4`: contract: define backend profile capability schema.
- `lp-k7g.6.5`: contract: define Brain RPC v1 method schemas.
- `lp-k7g.6.6`: contract: define backend capability descriptor.
- `lp-k7g.6.7`: contract: document Lanyard Agent conformance gaps.

## Phase 3. Artifact and deploy contract generalization

Epic: `lp-k7g.7`.

- `lp-k7g.7.1`: deploy: design compatibility pins v2 backend block.
- `lp-k7g.7.2`: deploy: update pin validator for backend artifacts.
- `lp-k7g.7.3`: deploy: migrate Terraform variables to backend_artifact.
- `lp-k7g.7.4`: deploy: generalize bootstrap install paths and provenance.
- `lp-k7g.7.5`: deploy: design generic backend systemd service.
- `lp-k7g.7.6`: deploy: update artifact landing zones and publisher trust.
- `lp-k7g.7.7`: deploy: write upgrade and rollback runbook for backend swaps.

## Phase 4. Portal backend abstraction

Epic: `lp-k7g.8`.

- `lp-k7g.8.1`: portal: introduce BackendRuntimeService interface.
- `lp-k7g.8.2`: portal: add control-plane backend fields and aliases.
- `lp-k7g.8.3`: portal: route projects through Brain RPC.
- `lp-k7g.8.4`: portal: route settings through Brain RPC.
- `lp-k7g.8.5`: portal: model backend capabilities in BFF responses.
- `lp-k7g.8.6`: portal: update web settings UI to use backend schema.
- `lp-k7g.8.7`: portal: preserve existing Hermes deployment compatibility.
- `lp-k7g.8.8`: portal: add fake backend contract tests.

## Phase 5. Client-core migration

Epic: `lp-k7g.9`.

- `lp-k7g.9.1`: client-core: define monorepo path and ownership.
- `lp-k7g.9.2`: client-core: migrate seed content with history plan.
- `lp-k7g.9.3`: client-core: migrate pack scripts and validation.
- `lp-k7g.9.4`: client-core: publish artifact from monorepo subpath.
- `lp-k7g.9.5`: client-core: test seed idempotency.

## Phase 6. Deploy migration

Epic: `lp-k7g.10`.

- `lp-k7g.10.1`: deploy: move company-brain-deploy under deploy.
- `lp-k7g.10.2`: deploy: update Terraform module paths after import.
- `lp-k7g.10.3`: deploy: update EC2 user_data to write generic backend pins.
- `lp-k7g.10.4`: deploy: update runtime hardening for generic backend paths.
- `lp-k7g.10.5`: deploy: update security and observability docs.
- `lp-k7g.10.6`: deploy: validate staging roots after move.

## Phase 7. Backend conformance and external backend readiness

Epic: `lp-k7g.11`.

- `lp-k7g.11.1`: conformance: create fake relay harness.
- `lp-k7g.11.2`: conformance: validate backend tarball manifest and entrypoint.
- `lp-k7g.11.3`: conformance: test Brain RPC required methods.
- `lp-k7g.11.4`: conformance: add Hermes-Lanyard artifact conformance job.
- `lp-k7g.11.5`: conformance: add Hermes upstream compatibility assessment.
- `lp-k7g.11.6`: external: make Lanyard Agent implement backend runtime v1.
- `lp-k7g.11.7`: conformance: publish backend compatibility matrix.

## Phase 8. Cutover and repository archival

Epic: `lp-k7g.12`.

- `lp-k7g.12.1`: cutover: dry-run Portal import.
- `lp-k7g.12.2`: cutover: dry-run client-core import.
- `lp-k7g.12.3`: cutover: dry-run deploy import.
- `lp-k7g.12.4`: cutover: wire monorepo CI and release workflow.
- `lp-k7g.12.5`: cutover: stage deploy with Hermes-Lanyard backend pins.
- `lp-k7g.12.6`: cutover: stage deploy with Lanyard Agent backend pins.
- `lp-k7g.12.7`: cutover: archive replaced repos after successful production cutover.
