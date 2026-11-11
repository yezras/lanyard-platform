# Monorepo CI and release workflows

Bead: `lp-k7g.12.4` (phase 8 cutover).

GitHub Actions at the **repository root** (only path GitHub loads). Jobs run on the org **self-hosted** runner (`spark-0a00`). GitHub-hosted `ubuntu-latest` is blocked by org billing. Portal CI Postgres is published on host port **55432** so it does not collide with a local `portal-postgres` on 5432. The deploy job must not use `sudo apt-get`.

| Workflow | File | Purpose |
| --- | --- | --- |
| **ci** | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | Path-filtered PR/push checks |
| **release** | [`.github/workflows/release.yml`](../../.github/workflows/release.yml) | Emit compatibility pin data; publish when AWS vars set |
| **conformance** | [`.github/workflows/conformance.yml`](../../.github/workflows/conformance.yml) | Hermes-Lanyard offline (path-filtered) + optional download |

Nested product workflows under `portal/.github/workflows/`, `client-core/.github/workflows/`, and `deploy/.github/workflows/` remain as **historical source copies**. They are not executed by GitHub after monorepo cutover; root workflows re-home monorepo paths (`pnpm -C portal`, `client-core/scripts/…`, `deploy/scripts/…`).

Offline local parity (no Actions required):

```bash
bash scripts/validate.sh
```

## Path-filtered CI

Job scheduling uses [`dorny/paths-filter`](https://github.com/dorny/paths-filter) in `ci.yml`. The **offline-validate** job always runs. Product jobs run only when their filters match (or on `workflow_dispatch`, which forces all jobs).

| Job | Path filters (summary) | Commands |
| --- | --- | --- |
| **offline-validate** | Always | `bash scripts/validate.sh` (checks 1–21 when surfaces exist) |
| **contracts** | `contracts/**`, `scripts/validate*.py`, `scripts/run-hermes-lanyard-conformance.py`, `compatibility/**`, related workflow files | `validate-compatibility-pins.py`, `validate.sh`, Hermes-Lanyard offline conformance |
| **portal** | `portal/**` | `pnpm -C portal install/build/test` (+ Postgres service); phase-4 scaffold `npm test` when lockfiles present. 0017 SLO T1–T9 ride `@lanyard/control-plane` / `@lanyard/bff` `test` scripts (real harness (via harness-local) only; T8 n/a in those packages, see [testing.md](../plans/0017-sandbox-first-chat-speed/testing.md)). |
| **client-core** | `client-core/**` | `validate-packs.py`, `smoke-pack-release.sh`, `smoke-seed-idempotency.sh`, `enable-pack.sh list` |
| **deploy** | `deploy/**`, `compatibility/**` | bootstrap smokes, `validate-compatibility.sh`, `validate-staging-roots.sh` |
| **ci-ok** | Aggregate | Fails if offline gate or any *scheduled* product job failed; path-skipped jobs are OK |

### Detailed path filters (`ci.yml` `changes` job)

```yaml
platform:     scripts/**, compatibility/**, docs/**, README.md, AGENTS.md,
              CLAUDE.md, .beads/**, .github/workflows/{ci,conformance,release}.yml
contracts:    contracts/**, scripts/validate.sh, scripts/validate-*.py,
              scripts/run-hermes-lanyard-conformance.py, compatibility/**,
              .github/workflows/conformance.yml
portal:       portal/**, .github/workflows/ci.yml
client_core:  client-core/**, .github/workflows/ci.yml
deploy:       deploy/**, compatibility/**, .github/workflows/ci.yml
```

### Conformance path filters (`conformance.yml`)

On `push` / `pull_request` to `main`/`master`, offline conformance runs when any of these change:

- `contracts/backend-runtime-v1/**`
- `scripts/run-hermes-lanyard-conformance.py`
- `scripts/validate-backend-tarball.py`
- `scripts/validate-brain-rpc.py`
- `scripts/validate-compatibility-pins.py`
- `compatibility/**`
- `.github/workflows/conformance.yml`

`workflow_dispatch` supports `offline` (default) and `download` (real pins + secrets).

### Branch protection suggestions

Require:

1. `CI aggregate` (`ci-ok`) — covers offline + path-filtered product jobs
2. Optionally `Hermes-Lanyard offline conformance` when tightening contract changes

Keep the default PR gate **offline** so forks without AWS secrets can still merge.

## Release and compatibility pins

Trigger **release** on:

- GitHub Release published
- Tag push `v*`
- `workflow_dispatch` (version required; `skip_upload` defaults **true** for dry pin emission)

### Contract checks block release

Job **`contract-gate`** runs first and must succeed:

1. `bash scripts/validate.sh`
2. `python3 scripts/validate-compatibility-pins.py compatibility/pins.example.yaml`
3. `python3 scripts/run-hermes-lanyard-conformance.py --mode offline`

All pin-emitting jobs use `needs: [version, contract-gate]` and `if: needs.contract-gate.result == 'success'`. A failed contract surface **blocks** client-core, portal-web, portal-images, and combined pin assembly.

### Pin data emitted by monorepo release

| Component | Job | Pin block | Artifact |
| --- | --- | --- | --- |
| client-core seed tarball | `release-client-core` | `client_core.{version,sha256,url}` | `client-core-<ver>.pins.yaml` (+ tarball) |
| Portal static web | `release-portal-web` | `portal.web.{version,sha256,url}` | `portal-web-<ver>.pins.yaml` (+ tarball) |
| Portal images | `release-portal-images` | `portal.images.<svc>.{repository,digest,tag}` | digests JSON + pins YAML (or **template** if no ECR vars / `skip_upload`) |
| Combined document | `emit-compatibility-pins` | schema_version 2 merge of above + **backend placeholder** | `compatibility-pins-<ver>.yaml` |

**Backend pins are external.** Hermes-Lanyard, Hermes upstream, and Lanyard Agent publish versioned artifacts outside this monorepo. Operators merge a real `backend:` block (after offline/download conformance) with monorepo-emitted `client_core` + `portal` fragments. Shape reference: [`compatibility/pins.example.yaml`](../../compatibility/pins.example.yaml).

### Repository variables (optional publish)

| Variable | Used by |
| --- | --- |
| `ARTIFACT_BUCKET` | client-core + portal-web S3 keys |
| `AWS_ROLE_ARN` | Default OIDC publisher (override with product-specific roles) |
| `CLIENT_CORE_AWS_ROLE_ARN` | Optional client-core OIDC role |
| `PORTAL_AWS_ROLE_ARN` | Optional portal OIDC role |
| `AWS_REGION` | AWS region |
| `ECR_NAME_PREFIX` | Portal image ECR repo prefix (`${prefix}/portal/{bff,relay,control-plane}`) |

Without these variables (or with `skip_upload=true`), release still **packs** and **emits pin fragments** as workflow artifacts; it does not invent image digests.

## Relation to `scripts/validate.sh`

| Surface | Local | CI |
| --- | --- | --- |
| Docs, pins, contracts, beads, packs, deploy stubs, harness, offline conformance | `bash scripts/validate.sh` | `offline-validate` always; also part of `contract-gate` |
| Portal full test graph | `pnpm -C portal test` (see [portal/testing.md](../../portal/testing.md)) | `portal` job when `portal/**` changes |
| Deploy terraform roots | `bash deploy/scripts/validate-staging-roots.sh` | `deploy` job when `deploy/**` or `compatibility/**` change |
| Live S3/ECR publish | Operator | `release` only with vars + tag/release |

## Related docs

- [Validation plan](validation-plan.md) — check inventory and local commands
- [Workspace map](workspace-map.md) — permanent path prefixes
- [Compatibility pins](../../compatibility/README.md)
- [Backend runtime conformance](../../contracts/backend-runtime-v1/conformance.md)
- [Phase 8 cutover](../plans/0001-platform-monorepo-migration/phase-8-cutover.md)
- Portal image release (product history): [portal/docs/image-release.md](../../portal/docs/image-release.md)
- Agent gateway image (Daytona Bucket A): [.github/workflows/agent-gateway-image.yml](../../.github/workflows/agent-gateway-image.yml) + [agent-gateway-ecr-push.md](../plans/0008-daytona-agent-sandboxes/agent-gateway-ecr-push.md) (`lp-wu1`)
