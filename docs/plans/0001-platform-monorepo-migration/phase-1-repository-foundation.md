# Phase 1. Repository foundation

Back to [overview](overview.md).

## Goal

Create the monorepo foundation without moving product code yet.

Bead: `lp-k7g.5`.

## Changes

- Establish root docs, ADR, contract, compatibility, and Beads conventions.
- Pick root workspace conventions for later Portal, client-core, and deploy migration.
- Document which repositories stay external and why.
- Add offline validation plan and `scripts/validate.sh` for docs links, pins YAML, contract stub, and Beads export ([validation-plan.md](../../architecture/validation-plan.md)).
- Define agent Beads workflow: claim with `bd ready` / `bd show` / `bd update --claim`, close with completion evidence, discover phase epics `lp-k7g` and `lp-k7g.5`–`lp-k7g.12` ([beads-workflow.md](../../architecture/beads-workflow.md), [issue-map.md](issue-map.md)).

## Data structures

- `RepositoryBoundary`: in-scope code, external backend products, runtime-only state.
- `WorkspaceMap`: future path, source repository, migration method, verification command.

## Workspace paths (decided)

Accepted in [ADR 0004](../../adr/0004-monorepo-workspace-paths.md). Operational map: [workspace-map.md](../../architecture/workspace-map.md).

| Source | Path |
| --- | --- |
| `LanyardBrain/Portal` | `portal/` |
| `LanyardBrain/client-core` | `client-core/` |
| `LanyardBrain/company-brain-deploy` | `deploy/` |
| Platform-native | `contracts/`, `docs/`, `compatibility/` |

Import order: platform-native (present) → `client-core/` → `portal/` → `deploy/`. Portal keeps pnpm rooted at `portal/`; deploy stays Terraform/bash; client-core keeps its own pack scripts.

## Import strategy (decided)

Accepted in [ADR 0005](../../adr/0005-history-preserving-import-strategy.md). Operational runbook: [import-strategy.md](../../architecture/import-strategy.md).

| Source | Path | Method |
| --- | --- | --- |
| `LanyardBrain/client-core` | `client-core/` | `git filter-repo` → merge (no squash) |
| `LanyardBrain/Portal` | `portal/` | `git filter-repo` → merge (no squash) |
| `LanyardBrain/company-brain-deploy` | `deploy/` | `git filter-repo` → merge (no squash) |

- **Tags:** remain authoritative on source remotes/archives; do not bulk-import into monorepo.
- **Rollback:** abandon unmerged import branch; `git revert -m 1` of per-product merge on `main`; keep source repos as archive until cutover.
- **Fallback:** `git subtree add --prefix=…` if filter-repo unavailable. Squash only if history is unusable (justify on import Bead).
- Product source is **not** imported in phase 1; later Beads execute the runbook.

## Verification

```bash
bash scripts/validate.sh
git status --short
bd status
```

- Docs relative links, `compatibility/pins.example.yaml`, `contracts/backend-runtime-v1/`, and `.beads` export health pass offline (see [validation-plan.md](../../architecture/validation-plan.md)).
- Workspace map lists every incoming repo, tooling impact, and import order.
- Import strategy ADR selects method per repo, records history/tag tradeoffs, and documents rollback.
- Beads workflow documents claim/update/close, phase-epic discovery, and completion evidence; `AGENTS.md` points to `bd ready` and `bd show`.
- CI placement: root `.github/workflows/ci.yml` runs the same offline script (wired in `lp-k7g.12.4`; path filters in [ci-and-release.md](../../architecture/ci-and-release.md)).
