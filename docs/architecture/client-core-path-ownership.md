# Client-core: monorepo path and ownership

Bead: `lp-k7g.9.1` (phase 5). Parent epic: `lp-k7g.9`.

This document **locks the monorepo path, ownership, package boundaries, docs
entrypoints, and deploy artifact boundary** for client-core before any seed
import (`lp-k7g.9.2+`). It reinforces [ADR 0004](../adr/0004-monorepo-workspace-paths.md);
it does not change the path decision.

Operational path map: [workspace-map.md](workspace-map.md).  
Phase plan: [phase-5-client-core-migration.md](../plans/0001-platform-monorepo-migration/phase-5-client-core-migration.md).  
Tree README: [`client-core/README.md`](../../client-core/README.md).

## Target path (locked)

| Concern | Decision |
| --- | --- |
| Source repository (today) | `LanyardBrain/client-core` |
| Monorepo source path | **`client-core/`** (top-level; no `apps/` or `packages/` prefix) |
| Path authority | [ADR 0004](../adr/0004-monorepo-workspace-paths.md) |
| Import method | `git filter-repo` → merge under `client-core/` ([ADR 0005](../adr/0005-history-preserving-import-strategy.md), [import-strategy.md](import-strategy.md)) |
| Import order | First product import (after platform-native `docs/`, `contracts/`, `compatibility/`) |
| Toolchain | Independent of Portal pnpm root; keep upstream pack/seed/publish scripts |
| Host install path | **Not** the monorepo path — vault root via `VAULT_ROOT` (typically `/opt/company-brain`) |

Do **not**:

- Nest client-core under `portal/`, `deploy/`, `packages/`, or `apps/`
- Fold client-core into a monorepo-root pnpm workspace
- Treat monorepo `client-core/` as the runtime path on customer hosts
- Create a monorepo source tree for backends (Hermes / Hermes-Lanyard / Lanyard Agent)

## What client-core owns (product surface)

Client-core is the **vault seed and pack product**: content and tooling that
bootstrap and extend the company-brain vault independently of which backend
kind is selected.

| Surface | Role after import |
| --- | --- |
| Seed tree | Default vault content (`AGENTS.md`, skills library, indexes, baseline docs) |
| Packs | Optional, opt-in content packs with enablement scripts and verification |
| Pack / seed scripts | Build, validate, enable packs; produce installable archive |
| Publish scripts | Emit versioned `client-core.tar.gz` (+ digest) to the product landing zone |
| Product docs | Client-core-specific README / pack docs under `client-core/` |

### Explicit non-ownership

| Concern | Owner | Why not client-core |
| --- | --- | --- |
| Backend runtime binary / gateway | External backend product | [ADR 0002](../adr/0002-external-backend-products.md) |
| Backend home layout (`BACKEND_HOME`) | Backend + deploy | [filesystem-layout.md](../../contracts/backend-runtime-v1/filesystem-layout.md) |
| Portal web / BFF / relay / control-plane | `portal/` | Separate product import |
| Terraform, bootstrap, pins install orchestration | `deploy/` | Consumes the **published** client-core artifact |
| Compatibility pin schema / examples | `compatibility/` | Platform-native pin contract |
| Backend runtime contract schemas | `contracts/backend-runtime-v1/` | Shared by all backends and Portal |

Vault content under `VAULT_ROOT` is **client-core + operators** at runtime;
backend-local `skills/` under `BACKEND_HOME` is distinct ([filesystem-layout.md](../../contracts/backend-runtime-v1/filesystem-layout.md)).

## Package and publish boundaries

```text
                    source (this monorepo)          released artifact
                    -----------------------        -------------------
  developers  -->   client-core/            -->    client-core.tar.gz
                    (seed, packs, scripts)         version + sha256 + url

  deploy pins -->   client_core.{version,url,sha256}   (top-level pin block)
  bootstrap   -->   download → verify → extract into VAULT_ROOT (idempotent)
  backend     -->   reads vault via VAULT_ROOT; never ships client-core inside
                    the backend tarball
```

| Boundary | Rule |
| --- | --- |
| Source path ≠ pin coordinate | Monorepo path is `client-core/`; pin block is top-level `client_core` |
| Source path ≠ host path | Host install is vault root (`VAULT_ROOT`), not a checkout of this repo |
| Artifact name | Prefer `client-core.tar.gz` under `s3://$BUCKET/client-core/<version>/` |
| Not a backend | Never nested under pin `backend.*` or S3 `backends/` |
| Arch | **Arch-neutral seed tarball** — no `linux-x86_64` path segment, no `backend.arch` / `backend_artifact_arch`. Backend runtime tarballs (Hermes) carry native wheels and **do** require arch labels (`lp-2md`). Adopt the same labeling contract only if client-core later ships native deps. |
| Not a Portal package | Not a pnpm workspace member of `portal/` |
| Not bundled into backend tarball | Backend upgrades/swaps must not change client-core bytes or pin shape |
| Publish from monorepo subpath | After import, CI packs **from** `client-core/` (`lp-k7g.9.4`); deploy still pins URL/SHA |

Pin invariant (already in [`compatibility/README.md`](../../compatibility/README.md)):

> `client_core` is never a property of `backend`. Deploy installs client-core
> into the vault root regardless of which backend kind is selected. Swapping
> `backend.kind` must not change the client-core pin shape.

Landing zone prefix **unchanged** by multi-backend work
([deploy-artifact-landing-zones.md](deploy-artifact-landing-zones.md)):

```text
s3://$BUCKET/client-core/<version>/client-core.tar.gz
```

Terraform keeps **separate** `client_core_artifact_*` variables
([deploy-backend-artifact-variables.md](deploy-backend-artifact-variables.md));
they are not renamed into `backend_artifact_*`.

## Ownership and review expectations

Ownership is **directory-based**. Until GitHub teams and a live
`.github/CODEOWNERS` land, treat the table below as the code-review contract.
When CODEOWNERS is enabled, mirror these paths.

### Responsible areas

| Path / surface | Primary owner (role) | Review expectations |
| --- | --- | --- |
| `client-core/**` (seed, packs, scripts, product docs) | **Client-core maintainers** (platform seed/content) | Required for seed shape, pack enablement, publish scripts, tarball install shape |
| `docs/architecture/client-core-*.md`, phase-5 plan | Client-core maintainers + platform docs | Path/ownership and migration plan changes need client-core + platform review |
| `docs/adr/0004-*.md` (path only) | Platform architects | Path renames require a **new ADR** that supersedes 0004 — not a silent edit |
| `compatibility/**` `client_core` block shape | Deploy + platform contracts | Schema/pin shape changes need deploy + platform review; do not nest under `backend` |
| `deploy/**` client-core install / `client_core_artifact_*` | Deploy maintainers | Bootstrap and TF changes must keep client-core independent of backend install |
| S3/OIDC `client_core` publisher role | Deploy / product-artifact-infra | Prefix stays `client-core/`; not under `backends/` |
| `portal/**` | Portal maintainers | Portal must not vendor client-core source or assume a monorepo checkout on the host |

### CODEOWNERS-style rules (target)

Illustrative GitHub CODEOWNERS patterns (team slugs are placeholders until org
teams exist). Do not invent live `@org/team` names in a committed CODEOWNERS
file without real teams.

```text
# Client-core product tree (after import)
/client-core/                          @lanyard/client-core-maintainers

# Platform docs that define client-core path / migration
/docs/architecture/client-core-*.md    @lanyard/client-core-maintainers @lanyard/platform
/docs/plans/0001-platform-monorepo-migration/phase-5-client-core-migration.md \
                                       @lanyard/client-core-maintainers @lanyard/platform

# Pin and deploy surfaces that must preserve the artifact boundary
/compatibility/                        @lanyard/deploy-maintainers @lanyard/platform
/deploy/                               @lanyard/deploy-maintainers
```

### Review checklist (client-core PRs)

Reviewers should confirm:

1. **Path:** changes stay under `client-core/` (or docs that explicitly describe it).
2. **Artifact boundary:** no merge of client-core into backend tarball, pin
   `backend.*`, or S3 `backends/` prefix.
3. **Install shape:** pack/tarball still seeds vault root; bootstrap idempotency
   preserved (skip when live vault already has `AGENTS.md` — phase-5 verification).
4. **Independence:** no hard dependency on a specific `backend.kind`.
5. **Publish:** version + sha256 + immutable URL coordinates remain the deploy interface.
6. **Cross-tree:** if deploy/compatibility/Portal must change, land those as
   coordinated PRs with the owning reviewers above.

### Who to pull in for boundary changes

| Change type | Must involve |
| --- | --- |
| Rename or move `client-core/` | Platform architects (superseding ADR 0004) |
| Nest `client_core` under `backend` in pins | **Reject** unless a new ADR + pin major; current policy forbids it |
| Change S3 prefix `client-core/` | Deploy + client-core + pin consumers |
| Bundle seed into backend artifact | **Reject**; violates platform monorepo boundary and deploy model |
| Portal reading monorepo `client-core/` at runtime | **Reject**; Portal talks to backends via relay/Brain RPC and vault is host-side |

## Docs entrypoints

| Doc | Audience | Role |
| --- | --- | --- |
| [`client-core/README.md`](../../client-core/README.md) | Contributors | Tree entrypoint; import status; verification pointers |
| **This file** | Architects / reviewers | Path, ownership, package + deploy boundaries |
| [ADR 0004](../adr/0004-monorepo-workspace-paths.md) | Decision log | Permanent path decision |
| [workspace-map.md](workspace-map.md) | Operators / importers | Full monorepo map + verification commands |
| [phase-5-client-core-migration.md](../plans/0001-platform-monorepo-migration/phase-5-client-core-migration.md) | Migrators | Phase goals, beads, verification |
| [import-strategy.md](import-strategy.md) | Importers | `git filter-repo` procedure for `client-core/` |
| [compatibility/README.md](../../compatibility/README.md) | Deploy / pins | `client_core` pin block invariant |
| [deploy-artifact-landing-zones.md](deploy-artifact-landing-zones.md) | Deploy | S3 `client-core/` prefix unchanged |
| [deploy-backend-artifact-variables.md](deploy-backend-artifact-variables.md) | Deploy | Separate `client_core_artifact_*` TF vars |
| Root [README.md](../../README.md) | Everyone | Repository boundary table includes `client-core/` |

## Deploy artifact boundary (preserved)

Summary of invariants this bead **reinforces** (not invents):

| Invariant | Where it already lives | Status |
| --- | --- | --- |
| Top-level pin block `client_core` | `compatibility/schema.json`, `pins.example.yaml` | Preserved |
| Never nest under `backend` | `compatibility/README.md` | Preserved |
| S3 prefix `client-core/<version>/` | Landing zones design | Unchanged / not under `backends/` |
| Separate TF variables | `client_core_artifact_url` / `_version` / `_sha256` | Unchanged by backend generalization |
| Install into vault root | Bootstrap / `VAULT_ROOT` | Independent of backend install path |
| Backend kind swap ≠ client-core change | Upgrade/rollback runbook | Client-core not swapped with backend |
| Publish coordinate name `client_core` | Pins + OIDC role key | Source path `client-core/` is independent |

Phase-5 follow-on beads **must** keep these invariants when they import seed
(`lp-k7g.9.2`), migrate pack scripts (`lp-k7g.9.3`), publish from the monorepo
subpath (`lp-k7g.9.4`), and test seed idempotency (`lp-k7g.9.5`).

## Import status

| Item | State |
| --- | --- |
| `client-core/` product tree | **Imported** (`lp-k7g.9.2`) — seed, packs, scripts, skills, templates under prefix |
| Source freeze SHA | `4225110cb7549db615b01176884957d932cb2a3b` (`LanyardBrain/client-core`) |
| Import method | `git filter-repo` → merge (ADR 0005); monorepo entrypoint README retained |
| Path decision | **Locked** at `client-core/` |
| Ownership / review contract | **Documented** (this file) |
| Deploy artifact boundary | **Preserved** in pins, landing zones, TF var design |
| Pack scripts + metadata validation | **Landed** (`lp-k7g.9.3`) — `packs/*/pack.yaml`, `enable-pack.sh list`, `scripts/validate-packs.py`, monorepo `validate.sh` check 14 |
| Phase-5 publish + seed | Publish-from-subpath **landed** (`9.4`); seed idempotency **landed** (`9.5`) |
| Phase-8 cutover dry-run | **`lp-k7g.12.2` re-verified** — seed vs freeze, tarball shape, pack validation ([cutover-client-core-dry-run.md](../plans/0001-platform-monorepo-migration/cutover-client-core-dry-run.md)) |

## Related beads

| Bead | Title | Depends on this path/ownership lock |
| --- | --- | --- |
| `lp-k7g.9.1` | define monorepo path and ownership | *(this doc)* |
| `lp-k7g.9.2` | migrate seed content with history plan | Target prefix `client-core/` |
| `lp-k7g.9.3` | migrate pack scripts and validation | Package boundaries under `client-core/` |
| `lp-k7g.9.4` | publish artifact from monorepo subpath | Publish-from-`client-core/` + pin boundary |
| `lp-k7g.9.5` | test seed idempotency | Install shape / vault independence |

## Related docs

- [ADR 0001 — Platform monorepo boundary](../adr/0001-platform-monorepo-boundary.md)
- [ADR 0004 — Monorepo workspace paths](../adr/0004-monorepo-workspace-paths.md)
- [ADR 0005 — History-preserving import strategy](../adr/0005-history-preserving-import-strategy.md)
- [Workspace map](workspace-map.md)
- [Import strategy](import-strategy.md)
- [Phase 5 — Client-core migration](../plans/0001-platform-monorepo-migration/phase-5-client-core-migration.md)
- [Validation plan](validation-plan.md)
- [Compatibility pins](../../compatibility/README.md)
- [Artifact landing zones](deploy-artifact-landing-zones.md)
