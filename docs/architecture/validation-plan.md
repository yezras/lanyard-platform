# Initial validation plan

Bead: `lp-k7g.5.4` (phase 1 repository foundation).

This document defines the **first offline CI checks** for the planning-shell monorepo: docs links, compatibility pin examples, backend-runtime contract layout, and Beads export health.

Product-tree checks (`pnpm`, Terraform, deploy pin validators) land after import Beads; they are listed only as future placement, not required today.

## Principles

1. **Offline by default.** Validation must not call the network (`curl`, package registries, remote git, artifact URLs). External URLs in markdown are skipped, not fetched.
2. **Runnable locally** with tools already expected for planning work: `bash`, `python3`. PyYAML is preferred for pin YAML parse (stdlib JSON covers Beads export).
3. **Fail closed** on broken relative docs links, unparseable or incomplete pin examples, missing contract stub, or corrupt Beads export.
4. **CI placement is documented and wired.** Root workflows under [`.github/workflows/`](../../.github/workflows/) (`ci.yml`, `release.yml`, `conformance.yml`) run the same offline script; local validation must still pass without Actions. Path filters and release pin emission: [ci-and-release.md](ci-and-release.md) (`lp-k7g.12.4`).

## Validation commands (today)

From the repository root:

```bash
bash scripts/validate.sh
```

Help:

```bash
bash scripts/validate.sh --help
```

Optional planning-shell status (not part of `scripts/validate.sh`; may use local Beads/Dolt only):

```bash
git status --short
bd status
bd list
```

### What `scripts/validate.sh` checks

| # | Surface | Behavior |
| --- | --- | --- |
| 1 | **Relative markdown links** | Scan `README.md` and all `docs/**/*.md`. Resolve relative targets (including `#fragment` stripped). Report missing files. Skip `http(s):`, `mailto:`, and other schemes (no network). |
| 2 | **Compatibility pins** | Run [`scripts/validate-compatibility-pins.py`](../../scripts/validate-compatibility-pins.py) against `compatibility/pins.example.yaml` (**schema_version 2**). Require `backend` (`kind` enum, immutable `version`, sha256, `s3://`\|`https://` url, `contract.{runtime_layout,relay,brain_rpc}`), separate top-level `client_core`, and `portal` images/web. Reject mutable refs (`main`/`master`/`latest`/bare branch-like) and legacy `hermes`/`relay_contract` keys. Schema: [`compatibility/schema.json`](../../compatibility/schema.json). Does **not** download pin URLs or verify remote digests. |
| 3 | **Backend runtime contract** | Require `contracts/backend-runtime-v1/` and `README.md`. Machine-readable schemas are planned (phase 2); presence of the directory stub is enough for phase 1. |
| 4 | **Beads export health** | Offline file checks only: `.beads/issues.jsonl` (each non-empty line valid JSON with `id`), `.beads/metadata.json`, `.beads/config.yaml` present and non-empty. Does **not** run `bd sync` or touch remotes. |
| 14 | **client-core packs** (when `client-core/packs/` present) | Run [`client-core/scripts/validate-packs.py`](../../client-core/scripts/validate-packs.py): every pack dir has unique `pack.yaml` (`name` matches basename), no missing/duplicate metadata, `sources` exist, `enable-pack.sh` handlers and `packs/INDEX.md` / `index.yaml` stay in sync. Also require `enable-pack.sh list` to print a discoverable catalog. |
| 15 | **client-core pack-release** (when `client-core/scripts/pack-release.sh` present) | Offline dry-run via [`client-core/scripts/smoke-pack-release.sh`](../../client-core/scripts/smoke-pack-release.sh): monorepo subpath pack (`git archive TREE:client-core`), tarball shape (`client-core-<ver>/AGENTS.md`), no monorepo leakage, emits version + sha256 + URL shape, pin fragment validates against `compatibility/schema.json` `client_core` block. |
| 18 | **Fake relay harness** (when `contracts/backend-runtime-v1/harness/` present) | Run [`contracts/backend-runtime-v1/harness/run_tests.py`](../../contracts/backend-runtime-v1/harness/run_tests.py): hello validation, chat inject, interrupt + Brain RPC over mock socket (`lp-k7g.11.1`). Stdlib only; no Portal, no network. |
| 19 | **Backend tarball** (when artifact schema present) | Run [`scripts/validate-backend-tarball.py`](../../scripts/validate-backend-tarball.py): fixture has `manifest/backend.json` + executable `bin/company-brain-backend`, kind/version/contract match pins (`lp-k7g.11.2`). |
| 20 | **Brain RPC required methods** (when `harness/fake_brain_rpc.py` present) | Run [`contracts/backend-runtime-v1/harness/run_brain_rpc_conformance.py`](../../contracts/backend-runtime-v1/harness/run_brain_rpc_conformance.py): `brain.ping` / `brain.health`, vault ACL (contributor vs admin), schema-shaped `settings.snapshot` + `projects.list` (`lp-k7g.11.3`). Optional vitest of Portal `FakeBrainRpcInvoker` when `node_modules` already present. |
| 21 | **Hermes-Lanyard conformance job** (when job script present) | Run [`scripts/run-hermes-lanyard-conformance.py`](../../scripts/run-hermes-lanyard-conformance.py) **offline**: pin + fixture resolve → tarball validate → entrypoint smoke → fake relay + required Brain RPC for `kind: hermes_lanyard` (`lp-k7g.11.4`). Download mode (S3/HTTPS + secrets) is documented in the script and draft [`.github/workflows/conformance.yml`](../../.github/workflows/conformance.yml); not invoked by `validate.sh`. |

Exit code: `0` if all checks pass; non-zero on any failure.

Checks 5–13 cover backend-runtime schemas and deploy scaffolds when those trees are present (see script `--help`).

### Non-goals (phase 1)

- Fetching or HEAD-checking external markdown URLs
- Validating live S3/ECR artifact pins
- Portal product toolchains beyond packages already under `portal/packages/`
- Installing npm/pip/terraform as part of this script
- Requiring GitHub Actions runners or secrets
- Uploading client-core artifacts to S3 (offline pack dry-run is check 15 / `lp-k7g.9.4`; live publish is operator/CI)
- Seed idempotency tests (`lp-k7g.9.5`)

## CI placement (`lp-k7g.12.4`)

Root workflows (authoritative; nested product `.github/workflows/` are historical):

```text
.github/workflows/ci.yml           # path-filtered monorepo CI
.github/workflows/release.yml      # pin emission; contract-gate blocks release
.github/workflows/conformance.yml  # offline path-filtered + download dispatch
```

Full path-filter matrix, release pin artifacts, and branch-protection notes: **[ci-and-release.md](ci-and-release.md)**.

### Offline job (always)

```yaml
# excerpt from .github/workflows/ci.yml
jobs:
  offline-validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: python3 -m pip install --user pyyaml
      - run: bash scripts/validate.sh
```

### Path-filtered jobs

| Paths | Workflow job / command | Status |
| --- | --- | --- |
| Always (all PRs/pushes) | `ci.yml` → **offline-validate**: `bash scripts/validate.sh` | Wired |
| `contracts/**`, pin/conformance scripts, `compatibility/**` | `ci.yml` → **contracts**; `conformance.yml` offline | Wired |
| `portal/**` | `ci.yml` → **portal**: `pnpm -C portal` test/build (+ Postgres). Path map: [portal/testing.md](../../portal/testing.md) | Wired |
| `client-core/**` | `ci.yml` → **client-core**: packs, pack-release dry-run, seed idempotency | Wired |
| `client-core/packs/**`, `client-core/scripts/…` | Also `scripts/validate.sh` checks 14–16 | Wired |
| `deploy/**`, `compatibility/**` | `ci.yml` → **deploy**: compatibility + `validate-staging-roots.sh` | Wired |
| Tag / Release / dispatch | `release.yml`: contract-gate → emit `client_core` + `portal` pin fragments | Wired |

Keep the default PR gate **offline** so forks and air-gapped agents can validate without credentials. Networked jobs (artifact pull, ECR/S3 publish, staging deploys) stay on `release` / `workflow_dispatch` and optional.

### Local vs CI parity

| Environment | Command |
| --- | --- |
| Developer / agent workstation | `bash scripts/validate.sh` |
| GitHub Actions (`ci.yml` offline-validate, `release.yml` contract-gate) | same script, same exit codes |
| Pre-commit (optional later) | wrap the same script; do not fork logic |

## Extending the plan

Add new checks only when a Bead lands the corresponding surface:

1. **Phase 2+:** JSON Schema validation for files under `contracts/backend-runtime-v1/`.
2. **Phase 3:** `backend_artifact_*` Terraform interface stubs under `deploy/` (check 10 in `scripts/validate.sh`; design: [deploy-backend-artifact-variables.md](deploy-backend-artifact-variables.md)).
3. **Phase 3:** bootstrap install paths + provenance scaffold (check 11 + offline smoke; design: [deploy-bootstrap-backend-install.md](deploy-bootstrap-backend-install.md)).
4. **Phase 3:** generic backend systemd unit scaffold (check 12 + offline smoke; design: [deploy-backend-systemd-service.md](deploy-backend-systemd-service.md)).
5. **Phase 3 / deploy import:** call `deploy/scripts/validate-compatibility.sh` against `compatibility/pins.example.yaml` (still no download of pin URLs unless a flag opts in).
6. **Phase 5–6 / 8:** product path jobs from the [workspace map](workspace-map.md) verification column.
7. **Optional network mode:** a separate script or `scripts/validate.sh --network` for link checkers that fetch external URLs—never the default.

## Related docs

- [Phase 1 — Repository foundation](../plans/0001-platform-monorepo-migration/phase-1-repository-foundation.md)
- [Migration overview](../plans/0001-platform-monorepo-migration/overview.md)
- [Workspace map](workspace-map.md)
- [ADR 0004 — Monorepo workspace paths](../adr/0004-monorepo-workspace-paths.md)
- [Compatibility pins example](../../compatibility/pins.example.yaml)
- [Backend runtime v1 placeholder](../../contracts/backend-runtime-v1/README.md)
- [Deploy backend artifact Terraform variables](deploy-backend-artifact-variables.md)
- [Deploy bootstrap backend install](deploy-bootstrap-backend-install.md)
- [Deploy backend systemd service](deploy-backend-systemd-service.md)
- [CI and release workflows](ci-and-release.md)
