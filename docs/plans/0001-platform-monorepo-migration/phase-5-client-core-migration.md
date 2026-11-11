# Phase 5. Client-core migration

Back to [overview](overview.md).

## Goal

Move client-core into the monorepo while preserving its deploy artifact boundary.

Bead: `lp-k7g.9`.

## Path and ownership (locked — `lp-k7g.9.1`)

| Decision | Value |
| --- | --- |
| Final monorepo path | **`client-core/`** ([ADR 0004](../../adr/0004-monorepo-workspace-paths.md)) |
| Operational map | [workspace-map.md](../../architecture/workspace-map.md) |
| Ownership, review, package + deploy boundaries | [client-core-path-ownership.md](../../architecture/client-core-path-ownership.md) |
| Tree entrypoint | [`client-core/README.md`](../../../client-core/README.md) |

### Owners and review expectations

- **Primary:** client-core maintainers own `client-core/**` (seed, packs, scripts, product docs).
- **Deploy maintainers** own install/pin wiring and must keep client-core independent of backend artifacts.
- **Platform architects** own path renames (superseding ADR only).
- CODEOWNERS-style path rules and PR review checklist:
  [client-core-path-ownership.md](../../architecture/client-core-path-ownership.md#ownership-and-review-expectations).

### Deploy artifact boundary (preserved)

- Pins: top-level `client_core.{version,url,sha256}` — **never** nested under `backend`
  ([compatibility/README.md](../../../compatibility/README.md)).
- Landing zone: `s3://$BUCKET/client-core/<version>/…` — **not** under `backends/`
  ([deploy-artifact-landing-zones.md](../../architecture/deploy-artifact-landing-zones.md)).
- Terraform: separate `client_core_artifact_*` variables (not absorbed into `backend_artifact_*`).
- Host: install into vault root (`VAULT_ROOT`); independent of `BACKEND_HOME` and `backend.kind`.
- Publish: build tarball **from** monorepo `client-core/`; deploy still pins URL/SHA of the published object.

## Changes

- Final monorepo path is `client-core/` ([ADR 0004](../../adr/0004-monorepo-workspace-paths.md)).
- Import history with `git filter-repo` into `client-core/` ([ADR 0005](../../adr/0005-history-preserving-import-strategy.md); runbook [import-strategy.md](../../architecture/import-strategy.md)).
- Preserve seed content, packs, scripts, and docs.
- Update artifact publishing to package client-core from the monorepo subpath.
- Keep client-core independent from the selected backend implementation.
- Add validation for seed integrity and idempotent install behavior.

## Beads

| Bead | Title |
| --- | --- |
| `lp-k7g.9.1` | define monorepo path and ownership |
| `lp-k7g.9.2` | migrate seed content with history plan |
| `lp-k7g.9.3` | migrate pack scripts and validation |
| `lp-k7g.9.4` | publish artifact from monorepo subpath |
| `lp-k7g.9.5` | test seed idempotency |

## Data structures

- `ClientCoreArtifact`: version, url, sha256, packs, seed metadata.
- `ClientCorePack`: name, dependencies, enablement script, verification.

## Verification

- The generated client-core tarball has the same install shape as the current artifact.
- Bootstrap skips extraction when a live vault already has `AGENTS.md`
  (offline harness: `client-core/scripts/smoke-seed-idempotency.sh` / `seed-vault.sh`,
  wired as `scripts/validate.sh` check 16 — `lp-k7g.9.5`).
- Pack enablement remains opt-in and repeatable.
- Path/ownership docs resolve: `client-core/README.md`, [client-core-path-ownership.md](../../architecture/client-core-path-ownership.md), links from [workspace-map.md](../../architecture/workspace-map.md).
- Offline planning check: `bash scripts/validate.sh`.
