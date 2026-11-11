# client-core release packaging

How to cut an **immutable** client-core seed release and land it on the platform artifact bucket for `company-brain-deploy` bootstrap pins.

After monorepo import (`lp-k7g.9.2`+), the seed is packaged **from the monorepo `client-core/` subpath**. Deploy still pins the published object URL/SHA — hosts never clone this repository.

## Object contract

| Field | Value |
|-------|--------|
| S3 key | `client-core/<version>/<filename>.tar.gz` |
| Filename (pack-release default) | `client-core-<version>.tar.gz` |
| Filename (alt, also accepted) | `client-core.tar.gz` under the same version prefix |
| Companion digest | `client-core-<version>.tar.gz.sha256` (`sha256sum` format) |
| Version label | Immutable only (e.g. `v0.1.0`) — **never** `main` / `master` / `HEAD` / `latest` |
| Layout | Single top-level directory `client-core-<version>/` so host bootstrap can flatten; **`AGENTS.md` at root after flatten** |
| Contents | **Tracked git files under `client-core/` only** (`git archive TREE:client-core`) — no monorepo `portal/`/`deploy/`/…, no `.git`, no `*.db`, no embeddings, no secrets |

Example:

```text
s3://$ARTIFACT_BUCKET/client-core/v0.1.0/client-core-v0.1.0.tar.gz
s3://$ARTIFACT_BUCKET/client-core/v0.1.0/client-core-v0.1.0.tar.gz.sha256
```

Bootstrap (`company-brain-deploy` `scripts/bootstrap-host.sh`) extracts into `/opt/company-brain` **only if `AGENTS.md` is absent**, flattens one top-level directory, and records provenance under `.seed/`.

Monorepo offline equivalent (same gate, for tests and local dry-runs):

```bash
# Seed empty vault from artifact or tree
bash client-core/scripts/seed-vault.sh --vault /tmp/vault \
  --tarball client-core/dist/client-core-v0.1.0-test.tar.gz \
  --version v0.1.0-test

# Re-run is a no-op when AGENTS.md already exists (live vault preserve)
bash client-core/scripts/seed-vault.sh --vault /tmp/vault \
  --tarball client-core/dist/client-core-v0.1.0-test.tar.gz

# Offline acceptance smoke (lp-k7g.9.5; also scripts/validate.sh check 16)
bash client-core/scripts/smoke-seed-idempotency.sh
```

## Source path (monorepo)

| Concern | Value |
|---------|--------|
| Product path | `client-core/` (ADR 0004) |
| Pack script | `client-core/scripts/pack-release.sh` |
| Archive tree | `git archive <TREE_ISH>:client-core` (seed-relative members) |
| Standalone legacy | Still supported when product root == git root |

`pack-release.sh` auto-detects monorepo vs standalone. It always runs `git archive` from the git root so subdirectory pathspec quirks cannot empty the pack.

### Cutover dry-run notes (`lp-k7g.12.2`)

Phase-8 re-verification of monorepo packaging (no second import). Full evidence:
[cutover-client-core-dry-run.md](../../docs/plans/0001-platform-monorepo-migration/cutover-client-core-dry-run.md).

| Check | Command / requirement |
| --- | --- |
| Seed vs freeze `4225110…` | Root seed files byte-identical; monorepo deltas only in pack/publish tooling |
| Offline pack dry-run | `bash client-core/scripts/pack-release.sh --dry-run v0.0.0-local-test` → monorepo mode, single prefix, `AGENTS.md`, pin fields |
| Tarball shape smoke | `bash client-core/scripts/smoke-pack-release.sh` (`scripts/validate.sh` check 15) |
| Pack validation | `python3 client-core/scripts/validate-packs.py` + `enable-pack.sh list` (check 14) |
| Seed idempotency | `bash client-core/scripts/smoke-seed-idempotency.sh` (check 16) |

## Cut a release (operators)

### 1. Tag an immutable version

```bash
git checkout main
git pull
# Inspect: strip list, data boundary, version in client-core/index.yaml
git tag -a v0.1.1 -m "client-core v0.1.1"
git push origin v0.1.1
```

Prefer annotated tags. Tag name **is** the pin version label. Monorepo tags are platform-wide; coordinate version strings with other product releases.

### 2. CI publishes the tarball

Workflow (imported under product tree; monorepo root CI may re-home later):

[`.github/workflows/release-artifact.yml`](../.github/workflows/release-artifact.yml)

Triggers:

| Event | Version source |
|-------|----------------|
| Push tag `v*` | Tag name |
| GitHub Release published | Release tag |
| `workflow_dispatch` | Required `version` input (still packs from the selected ref) |

Pipeline: pack monorepo `client-core/` → SHA-256 → (optional) OIDC AWS → `s3://$ARTIFACT_BUCKET/client-core/$VERSION/`.

### 3. Required repository variables

Set under **Settings → Secrets and variables → Actions → Variables** (no hard-coded account IDs in the repo):

| Variable | Meaning |
|----------|---------|
| `ARTIFACT_BUCKET` | Platform product artifact bucket name (`product-artifact-infra`) |
| `AWS_ROLE_ARN` | IAM role ARN for the **`client_core`** OIDC publisher |
| `AWS_REGION` | Bucket region |

If any variable is missing, the workflow still packs and uploads **GitHub Actions artifacts**, but skips S3.

### 4. OIDC trust

Default publisher trust (deploy module, role key **`client_core`**):

```text
repo:LanyardBrain/client-core:ref:refs/tags/*
```

After cutover, product-artifact-infra may also trust the monorepo publisher subject (e.g. `repo:LanyardBrain/lanyard-platform:ref:refs/tags/*`) while keeping the **S3 prefix** `client-core/` unchanged. See [deploy-artifact-landing-zones.md](../../docs/architecture/deploy-artifact-landing-zones.md).

Permissions on that role: S3 list/write under prefix `client-core/` only (see `company-brain-deploy` `modules/product-artifact-infra`).

## Local pack / offline dry-run

From the **monorepo root** (preferred after import):

```bash
# Offline dry-run: packs + emits version/url/sha256 + pin fragment (no upload)
bash client-core/scripts/pack-release.sh --dry-run v0.1.0-test

# Or from the product directory
cd client-core && ./scripts/pack-release.sh --dry-run v0.1.0-test
```

Outputs under `client-core/dist/` (or `OUT_DIR`):

| File | Purpose |
|------|---------|
| `client-core-<version>.tar.gz` | Seed tarball |
| `client-core-<version>.tar.gz.sha256` | Digest (`sha256sum` format) |
| `client-core-<version>.meta.env` | Machine-readable `CLIENT_CORE_VERSION` / `SHA256` / `URL` / `S3_KEY` |
| `client-core-<version>.pins.yaml` | `client_core` pin fragment for compatibility overlays |

Inspect:

```bash
tar -tzf client-core/dist/client-core-v0.1.0-test.tar.gz | head
tar -tzf client-core/dist/client-core-v0.1.0-test.tar.gz | grep -E 'AGENTS\.md|\.git|\.db' || true
sha256sum -c client-core/dist/client-core-v0.1.0-test.tar.gz.sha256
cat client-core/dist/client-core-v0.1.0-test.meta.env
```

Offline smoke (wired into monorepo `scripts/validate.sh` as check 15):

```bash
bash client-core/scripts/smoke-pack-release.sh
```

Environment overrides:

| Variable | Default | Purpose |
|----------|---------|---------|
| `VERSION` | (arg or exact tag) | Immutable label |
| `OUT_DIR` | `client-core/dist/` | Output directory |
| `TREE_ISH` | `HEAD` | Commit/tree to archive |
| `ARTIFACT_BUCKET` | `<ARTIFACT_BUCKET>` | Bucket name embedded in emitted pin URL |
| `DRY_RUN=1` | off | Same as `--dry-run` |

## Pin fields for company-brain-deploy

After publish, set tenant / platform pins (do **not** float on `main`):

| Pin | Example |
|-----|---------|
| `client_core.version` / `client_core_artifact_version` | `v0.1.0` |
| `client_core.sha256` / `client_core_artifact_sha256` | 64-char hex from the `.sha256` file |
| `client_core.url` / `client_core_artifact_url` | `s3://$ARTIFACT_BUCKET/client-core/v0.1.0/client-core-v0.1.0.tar.gz` |

**URL shape (documented contract):**

```text
s3://$ARTIFACT_BUCKET/client-core/<version>/client-core-<version>.tar.gz
```

Compatibility pin schema lives in the monorepo at [`compatibility/`](../../compatibility/) (`schema_version` 2, top-level `client_core` separate from `backend`). Validate:

```bash
python3 scripts/validate-compatibility-pins.py path/to/operator-pins.yaml
```

Updating live operator pins is a **separate** deploy change, not part of packing this seed.

## Data boundary (tarball must not include)

- Live CRM rows, transcripts, proposals
- Credentials, tokens, `.env*`
- `*.db` (schema SQL is fine and tracked)
- Embeddings / MemPalace indexes (`.mempalace/`, chroma)
- Local runtime: `.hermes/`, `node_modules/`, enabled-packs runtime state
- Other monorepo products: `portal/`, `deploy/`, `contracts/`, platform `docs/` outside `client-core/`

Packing uses **`git archive` of the `client-core/` tree only**, so gitignored runtime files and sibling monorepo paths never enter the tarball. The script also fail-closes if forbidden path patterns or monorepo leakage appear in the archive listing.

## Related

- Seed doctrine: `AGENTS.md`, `docs/STRIP-LIST.md`
- Path / ownership: [client-core-path-ownership.md](../../docs/architecture/client-core-path-ownership.md)
- Deploy contract: company-brain-deploy `references/product-artifact-release-contract.md`
- Landing zones: [deploy-artifact-landing-zones.md](../../docs/architecture/deploy-artifact-landing-zones.md)
- Bootstrap: company-brain-deploy `scripts/bootstrap-host.sh`, `artifacts/README.md`
- Beads: `lp-k7g.9.4` (pack from monorepo subpath), `lp-k7g.9.5` (seed idempotency)
- Seed install harness: [`scripts/seed-vault.sh`](../scripts/seed-vault.sh), smoke [`scripts/smoke-seed-idempotency.sh`](../scripts/smoke-seed-idempotency.sh)
