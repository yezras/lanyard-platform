# Workspace map

Permanent monorepo paths for the Lanyard Platform repository. Decision record: [ADR 0004](../adr/0004-monorepo-workspace-paths.md).

This document is the operational `WorkspaceMap` referenced by [phase 1](../plans/0001-platform-monorepo-migration/phase-1-repository-foundation.md). Do not migrate product code until a Bead explicitly requests import work.

## Incoming product repositories

| Source repository | Target path | Migration method | Package manager / tooling | Verification command (after import) |
| --- | --- | --- | --- | --- |
| `LanyardBrain/Portal` | `portal/` | `git filter-repo` prefix rewrite → merge ([ADR 0005](../adr/0005-history-preserving-import-strategy.md)) | pnpm workspaces **rooted at `portal/`** | `pnpm -C portal test` · `pnpm -C portal build` · per-package filters (see [portal/README.md](../../portal/README.md), [portal/testing.md](../../portal/testing.md)) |
| `LanyardBrain/client-core` | `client-core/` | `git filter-repo` prefix rewrite → merge ([ADR 0005](../adr/0005-history-preserving-import-strategy.md)) | Existing pack/seed/publish scripts (not part of Portal pnpm root) | Pack/tarball from `client-core/`; install-shape vs current artifact |
| `LanyardBrain/company-brain-deploy` | `deploy/` | `git filter-repo` prefix rewrite → merge into shorter path ([ADR 0005](../adr/0005-history-preserving-import-strategy.md)) | Terraform + bash scripts | `terraform -chdir=deploy/environments/<env> validate` · `bash deploy/scripts/validate-compatibility.sh deploy/compatibility/pins.example.yaml` |

`deploy/` product tree **imported** (`lp-k7g.10.1`, history via `git filter-repo` → merge; freeze `301d313c23ea62de087118615f2c1494fffbc1c4`; cutover dry-run **`lp-k7g.12.3`** re-verified): [deploy/README.md](../../deploy/README.md), [deploy/docs/import-path-assumptions.md](../../deploy/docs/import-path-assumptions.md) (old path assumptions for `lp-k7g.10.2`), [cutover-deploy-dry-run.md](../plans/0001-platform-monorepo-migration/cutover-deploy-dry-run.md). Platform phase-3 scaffolds (`backend_artifact_*`, generic systemd, landing-zone stubs, bootstrap-backend-install) retained alongside imported product files. Module path rewires (`lp-k7g.10.2`) and staging validation (`lp-k7g.10.6`) complete; cutover re-check confirms terraform validate + bootstrap inject.

`portal/` product tree **imported** (`lp-k7g.12.1` dry-run, history via `git filter-repo` → merge; freeze `981c727c3a2877301c5c60eb859495012a6d2dba`): [portal/README.md](../../portal/README.md), [portal/testing.md](../../portal/testing.md) (path-mapped commands). Product packages: `packages/{bff,web,relay,control-plane,shared}`. Platform phase-4 scaffolds **retained** alongside product (`packages/{backend-runtime,control-plane-fields,web-settings-schema,hermes-compat}`). Design: [portal-backend-runtime-service.md](portal-backend-runtime-service.md), [portal-control-plane-backend-fields.md](portal-control-plane-backend-fields.md), [portal-projects-brain-rpc.md](portal-projects-brain-rpc.md), [portal-settings-brain-rpc.md](portal-settings-brain-rpc.md), [portal-capabilities-bff.md](portal-capabilities-bff.md), [portal-web-settings-schema.md](portal-web-settings-schema.md), [portal-hermes-deployment-compat.md](portal-hermes-deployment-compat.md).

`client-core/` product tree **imported** (`lp-k7g.9.2`, history via `git filter-repo` → merge; freeze `4225110cb7549db615b01176884957d932cb2a3b`; cutover dry-run **`lp-k7g.12.2`** re-verified): [client-core/README.md](../../client-core/README.md), [client-core-path-ownership.md](client-core-path-ownership.md), [cutover-client-core-dry-run.md](../plans/0001-platform-monorepo-migration/cutover-client-core-dry-run.md). Final path remains `client-core/`; deploy continues to pin client-core as a **separate** vault-seed artifact (`client_core` pin block, S3 `client-core/` prefix, not nested under `backend` / `backends/`). Pack scripts + metadata validation **landed** (`lp-k7g.9.3`: `packs/*/pack.yaml`, `enable-pack.sh list`, `validate-packs.py`, `scripts/validate.sh` check 14). Publish-from-subpath **landed** (`lp-k7g.9.4`: `pack-release.sh` packs `HEAD:client-core`, dry-run emits version/url/sha256, `scripts/validate.sh` check 15). Seed idempotency **landed** (`lp-k7g.9.5`: `seed-vault.sh` + smoke, check 16).

## Platform-native trees (already in repo)

| Path | Role | Tooling | Verification |
| --- | --- | --- | --- |
| `contracts/` | Shared backend runtime contract (`backend-runtime-v1`) | Schemas + docs | Contract validation (phase 2+) |
| `docs/` | ADRs, architecture, migration plans | Markdown | Doc links resolve; plan/ADR coherence |
| `compatibility/` | Example and overlay artifact pins | YAML | Deploy pin validators |
| `.beads/` / Beads CLI | Migration backlog and agent workflow | `bd` | `bd ready` · `bd show` · `bd status` · see [beads-workflow.md](beads-workflow.md) |
| Root `README.md`, `AGENTS.md`, `CLAUDE.md` | Boundary and agent instructions | N/A | Readability; instructions match ADRs |

## External repositories (no monorepo source path)

| Repository | Path in this monorepo | Integration |
| --- | --- | --- |
| Hermes upstream | None | Versioned artifacts + optional conformance ([published matrix](backend-compatibility-matrix.md); surface: [conformance.md](../../contracts/backend-runtime-v1/conformance.md); assessment: [hermes-upstream-compatibility.md](hermes-upstream-compatibility.md)) |
| Hermes-Lanyard | None | Reference backend artifact for `backend-runtime-v1` |
| Lanyard Agent | None | Target conforming backend artifact; current gaps: [lanyard-agent-conformance-gaps.md](lanyard-agent-conformance-gaps.md). Short-stack tool placement (harness vs Daytona toolbox): [short-stack-tool-placement.md](short-stack-tool-placement.md) |

Do not reserve `hermes/`, `hermes-lanyard/`, or `lanyard-agent/` source trees. See [ADR 0002](../adr/0002-external-backend-products.md).

## Target tree (after product imports)

```text
.
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── .beads/
├── client-core/          # from LanyardBrain/client-core
├── compatibility/        # pins (present)
├── contracts/            # backend-runtime-v1 (present)
├── deploy/               # from LanyardBrain/company-brain-deploy
├── docs/                 # ADRs, architecture, plans (present)
└── portal/               # from LanyardBrain/Portal (pnpm workspace root)
```

## Package manager and tooling impact

| Tree | Toolchain | Monorepo-root coupling |
| --- | --- | --- |
| `portal/` | pnpm, TypeScript, container builds | Commands run with `-C portal` / `working-directory: portal`. **No** requirement for a root pnpm workspace that includes deploy or client-core. |
| `client-core/` | Shell/Python/other pack scripts as upstream uses today | Publishes `client_core` tarball; deploy installs via pin URL/SHA, not via monorepo path on the host. |
| `deploy/` | Terraform, bash bootstrap | Reads `compatibility/` pins; may reference published Portal/client-core/backend artifact coordinates. Relative module paths updated after import (phase 6). |
| `contracts/` | Schema files only | Consumed by Portal, deploy validators, and external conformance jobs. |
| `compatibility/` | YAML | Validated by scripts that will live under `deploy/scripts/`. |

### Why not a single root pnpm workspace

Portal is already a multi-package pnpm monorepo. Deploy and client-core are not Node package graphs in the same sense. Forcing one root workspace would:

- Pull Terraform/bootstrap into Node install semantics
- Risk hoisting and path breakage inside Portal packages
- Contradict overview checks that use `pnpm -C portal …` and `terraform -chdir=deploy/…`

Optional root-level task runners may call into subpaths later; that does not change workspace roots without a new ADR.

## Import order

Platform-native content is already present and is always “first.”

| Order | Path | Why this order |
| --- | --- | --- |
| 0 (done / ongoing) | `docs/`, `contracts/`, `compatibility/`, Beads | Contracts and pins must exist before abstraction and deploy generalization land. |
| 1 | `client-core/` | Smallest product import; independent artifact; needed for bootstrap seed flows. |
| 2 | `portal/` | Large TypeScript surface; uses contracts; not blocked on deploy source in-tree. |
| 3 | `deploy/` (**imported** `lp-k7g.10.1`) | Last so Terraform and bootstrap rewires target final monorepo paths once. Path/content rewires: `lp-k7g.10.2+`. |

Phase 8 cutover dry-runs should follow product order **client-core → portal → deploy**.

History-preserving **mechanism**: `git filter-repo` (subtree fallback; squash only if history unusable). Tags stay on source remotes; rollback via abandon branch / revert merge / source archives. See [ADR 0005](../adr/0005-history-preserving-import-strategy.md) and [import-strategy.md](import-strategy.md).

## Related commands (planning shell today)

```bash
bash scripts/validate.sh
bd status
bd list
git status --short
```

Offline validation surfaces and root `.github/workflows/` placement: [validation-plan.md](validation-plan.md), [ci-and-release.md](ci-and-release.md).

## Related commands (after imports; from migration overview)

```bash
bash deploy/scripts/validate-compatibility.sh compatibility/pins.example.yaml
bash deploy/scripts/smoke-bootstrap-extract.sh
pnpm -C portal install   # workspace root is portal/ (not monorepo root)
pnpm -C portal test
pnpm -C portal build
# Path-mapped filters / scaffold offline checks: portal/testing.md
terraform -chdir=deploy/environments/platform-staging validate
```

## Related docs

- [ADR 0004 — Monorepo workspace paths](../adr/0004-monorepo-workspace-paths.md)
- [ADR 0005 — History-preserving import strategy](../adr/0005-history-preserving-import-strategy.md)
- [Import strategy (operational runbook)](import-strategy.md)
- [Client-core path and ownership](client-core-path-ownership.md)
- [Validation plan](validation-plan.md)
- [ADR 0001 — Platform monorepo boundary](../adr/0001-platform-monorepo-boundary.md)
- [Migration overview](../plans/0001-platform-monorepo-migration/overview.md)
- [Phase 1 — Repository foundation](../plans/0001-platform-monorepo-migration/phase-1-repository-foundation.md)
- [Phase 5 — Client-core migration](../plans/0001-platform-monorepo-migration/phase-5-client-core-migration.md)
- [Phase 6 — Deploy migration](../plans/0001-platform-monorepo-migration/phase-6-deploy-migration.md)
