# ADR 0004: Monorepo workspace paths

- Status: Accepted
- Date: 2026-07-20

## Context

Phase 1 must fix permanent root paths before history-preserving imports begin ([phase-1](../plans/0001-platform-monorepo-migration/phase-1-repository-foundation.md)). Migration verification examples and overview docs already assume top-level `portal/`, `client-core/`, `deploy/`, `contracts/`, `docs/`, and `compatibility/` ([overview](../plans/0001-platform-monorepo-migration/overview.md)).

Incoming product repositories:

| Source (today) | Product |
| --- | --- |
| `LanyardBrain/Portal` | Portal web, BFF, relay, control-plane, shared packages |
| `LanyardBrain/client-core` | Seed content, packs, publish scripts |
| `LanyardBrain/company-brain-deploy` | Terraform, bootstrap, pins, runbooks |

Platform-native trees already present (not imported from product repos):

- `contracts/` — backend runtime contract schemas and docs
- `docs/` — ADRs, architecture, migration plans
- `compatibility/` — example artifact pins
- Root agent/Beads conventions (`AGENTS.md`, `CLAUDE.md`, `.beads/`)

External products (no path reserved for source import; [ADR 0002](0002-external-backend-products.md)):

- Hermes upstream
- Hermes-Lanyard
- Lanyard Agent

Alternatives considered:

1. **Nested `packages/` or `apps/` tree** (e.g. `apps/portal`, `packages/client-core`). Familiar for pure JS monorepos, but deploy is Terraform/bash, client-core is content/artifacts, and overview verification already targets top-level paths. Nesting adds renames without tooling benefit.
2. **Keep deploy repo name** (`company-brain-deploy/`). Accurate historically, but longer and less clear once deploy is platform-owned.
3. **pnpm workspace root covering every tree**. Wrong for Terraform and client-core packaging; only Portal needs pnpm workspaces.

## Decision

Use **short, top-level, product-named paths**. No intermediate `apps/` or `packages/` prefix for the three product imports.

### Workspace map

| Source repository | Target path | Status | Package manager / tooling | Primary verification (after import) |
| --- | --- | --- | --- | --- |
| `LanyardBrain/Portal` | `portal/` | **Imported** (`lp-k7g.12.1` dry-run; freeze `981c727c3a2877301c5c60eb859495012a6d2dba`) | **pnpm workspaces** stay rooted at `portal/` (not the monorepo root). TypeScript packages, Docker images for BFF/relay/control-plane, and Portal CI run under this tree. Phase-4 scaffolds retained under `packages/*`. | `pnpm -C portal install`, `pnpm -C portal test`, `pnpm -C portal build` (see [portal/testing.md](../../portal/testing.md)) |
| `LanyardBrain/client-core` | `client-core/` | **Imported** (`lp-k7g.9.2`; cutover dry-run `lp-k7g.12.2`; freeze `4225110cb7549db615b01176884957d932cb2a3b`) | **Independent of pnpm root.** Pack/seed scripts and tarball publish from monorepo subpath. Artifact coordinate remains `client_core` in pins; path is source only. | `bash client-core/scripts/pack-release.sh --dry-run …`, `python3 client-core/scripts/validate-packs.py`, `bash client-core/scripts/smoke-pack-release.sh` (see [cutover-client-core-dry-run.md](../plans/0001-platform-monorepo-migration/cutover-client-core-dry-run.md)) |
| `LanyardBrain/company-brain-deploy` | `deploy/` | **Imported** (`lp-k7g.10.1`; cutover dry-run `lp-k7g.12.3`; freeze `301d313c23ea62de087118615f2c1494fffbc1c4`) | **Terraform + bash** (no Node workspace). Modules, environments, bootstrap scripts, runbooks. Validators and smoke scripts live under `deploy/scripts/`. | `bash deploy/scripts/validate-staging-roots.sh`, `bash deploy/scripts/smoke-bootstrap-inject.sh`, `bash scripts/validate.sh` check 17 (see [cutover-deploy-dry-run.md](../plans/0001-platform-monorepo-migration/cutover-deploy-dry-run.md)) |
| *(platform-native)* | `contracts/` | Present | Docs + JSON schemas only. No app runtime. | Contract/schema validation (phase 2+) |
| *(platform-native)* | `docs/` | Present | Markdown only. | Link checks; `bd status` / plan doc coherence |
| *(platform-native)* | `compatibility/` | Present | YAML pin examples and overlays. Consumed by deploy validators. | Pin schema validation via deploy scripts |
| Hermes upstream | — | **External** | N/A (artifact-only) | Conformance against published tarball |
| Hermes-Lanyard | — | **External** | N/A (artifact-only; v1 reference) | Conformance against published tarball |
| Lanyard Agent | — | **External** | N/A (artifact-only) | Conformance against published tarball |

### Package manager and tooling impact

| Concern | Choice | Rationale |
| --- | --- | --- |
| Root `package.json` / monorepo-wide pnpm workspace | **Do not require** for phase 1–6 | Portal already is a pnpm monorepo. Hoisting Portal packages to the git root would force Node tooling onto deploy and client-core. |
| Portal package paths | Import so **internal Portal workspace layout is preserved under `portal/`** | Minimizes import churn; `pnpm -C portal …` matches overview verification. |
| Deploy module paths | Land at `deploy/` then fix relative Terraform/module references in phase 6 beads | Path rename `company-brain-deploy` → `deploy` is intentional; module rewires are follow-on work. |
| Client-core publish | Build artifact **from** `client-core/` subpath; pins still name `client_core` | Source path ≠ runtime install path on hosts. Ownership, review expectations, and deploy artifact boundary for this tree: [client-core-path-ownership.md](../architecture/client-core-path-ownership.md) (`lp-k7g.9.1`). |
| Compatibility pins path | Stay at monorepo root `compatibility/` | Deploy scripts and overview already reference this location. |
| Contracts path | Stay at monorepo root `contracts/backend-runtime-v1/` | Shared by Portal, deploy, and external backends. |
| CI | Per-path jobs (portal / client-core / deploy / contracts) rather than one omnibus workspace install | Matches toolchains (pnpm vs terraform vs bash). |
| Future root tooling | Optional root scripts or task runners may *invoke* subpath tools; they must not absorb Portal into a single pnpm workspace without a new ADR | Keeps boundary discipline. |

### Import order

Recorded recommended order for history-preserving imports (product code moves only when later Beads request them). Platform-native trees (`docs/`, `contracts/`, `compatibility/`, Beads) are already in place and come first by definition.

1. **`contracts/` + `docs/` + `compatibility/`** — already present; extend before and during product imports (no product source import).
2. **`client-core/`** — smallest product surface; independent artifact boundary; unblocks pin examples and deploy smoke paths that install client-core next to a backend.
3. **`portal/`** — largest TypeScript surface; depends on contracts for backend abstraction work (phases 2/4) but not on deploy source living in-tree.
4. **`deploy/`** — last product import so Terraform/bootstrap can target final monorepo paths for Portal images, client-core publish coordinates, and `compatibility/` pins without double rewires.

Cutover dry-runs in phase 8 (`lp-k7g.12.1`–`12.3`) should follow the same product order: client-core, portal, deploy — after contracts/docs remain stable.

Import **strategy** (git filter-repo default, subtree fallback, tags, rollback) is decided in [ADR 0005](0005-history-preserving-import-strategy.md); operational runbook: [import-strategy.md](../architecture/import-strategy.md).

### Explicit non-paths

Do **not** create monorepo source trees for:

- `hermes/`, `hermes-lanyard/`, `lanyard-agent/`, or similar backend source checkouts
- Nested renames of the three product roots after this ADR without superseding it

## Consequences

- All planning, import, and CI docs should use these paths; overview verification commands remain valid.
- History-preserving import work (phase 5/6/8 beads) targets `portal/`, `client-core/`, and `deploy/` only, using [ADR 0005](0005-history-preserving-import-strategy.md).
- Portal keeps its own pnpm workspace root; monorepo root stays multi-toolchain.
- Client-core remains an **independent deploy artifact**: top-level pin block `client_core`, S3 prefix `client-core/`, not nested under `backend` / `backends/`, not bundled into a backend tarball. Path ownership and review contract: [client-core-path-ownership.md](../architecture/client-core-path-ownership.md); tree entrypoint: [`client-core/README.md`](../../client-core/README.md).
- Detailed operational copy of the map lives in [workspace-map.md](../architecture/workspace-map.md).
- Supersedes the open path-layout note in [ADR 0001](0001-platform-monorepo-boundary.md) consequences (paths are now decided here).
