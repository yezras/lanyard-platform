# Product artifact release contract

Deployment-owned contract for **where** product releases land and **how** deploy pins bind to them. Publishing pipelines live in product repos; this repository owns infra + pin validation.

## Coordinates

### Hermes + client-core (dual path: S3 preferred, private GitHub Release accepted)

| Field | Hermes | client-core |
|-------|--------|-------------|
| Preferred landing zone | Platform S3 bucket (`modules/product-artifact-infra`) prefix `hermes/` | same bucket, prefix `client-core/` |
| Preferred object shape | **Arch-labeled:** `hermes/<version>/linux-x86_64/<filename>.tar.gz` (default product). Optional `…/linux-aarch64/…` when arm pack published. Unlabeled `hermes/<version>/<filename>.tar.gz` is **deprecated**. | `client-core/<version>/<filename>.tar.gz` (**arch-neutral** seed; no arch path segment) |
| First private releases (G7.H2/C2) | GitHub Release `LanyardBrain/hermes-lanyard` tag **`v0.1.0-g7h2`** | GitHub Release `LanyardBrain/client-core` tag **`v0.1.0-g7c2`** |
| Pin fields | `hermes.version`, `hermes.sha256`, `hermes.url`, `hermes.arch` / `hermes.target_arch` (→ pins v2 `backend.arch`; default `linux-x86_64`) | `client_core.version`, `client_core.sha256`, `client_core.url` |
| Bootstrap / TF vars | `hermes_artifact_*` / preferred `backend_artifact_*` + `backend_artifact_arch` | `client_core_artifact_*` |
| Committed pin file | `compatibility/pins.real-releases.yaml` (coordinates only) | same |

Versions must be **immutable labels** (e.g. `v0.1.0-g7h2`), never `main` / `master` / `HEAD` / `latest`.

**Private GitHub HTTPS downloads:** bootstrap requires **`GITHUB_TOKEN` or `GH_TOKEN`** in the environment (repo read scope). **Never commit tokens.** Browser-style `…/releases/download/…` URLs are resolved via the GitHub API asset endpoint (`Accept: application/octet-stream`) because private repos often 404 the browser URL. Prefer migrating pins to **`s3://`** + instance role when OIDC publish mirrors the same SHA.

### S3 immutability (Object Lock)

| Control | Contract |
|---------|----------|
| Versioning | **Enabled** |
| Object Lock | **Enabled at bucket creation** (module always sets `object_lock_enabled = true`) |
| Default retention | Configurable; safe default **GOVERNANCE / 90 days** |
| `force_destroy` | **false** for real environments |
| Lifecycle | Noncurrent expiration cannot remove locked versions until retention ends |

S3 versioning alone is not sufficient: putting a new object on the same key still creates a new current version. Object Lock retention is the deploy-owned contract that prevents deletion of locked object versions during the retention window.

### Portal web (S3 static artifact)

The canonical production web release is a static artifact, not a required ECR runtime image.

Status: **deploy-owned S3/OIDC landing zone implemented** in `modules/product-artifact-infra` (`artifact_prefixes.portal_web` → `portal-web/`; default Portal publisher `s3_write_prefix_keys = ["portal_web"]` plus existing ECR push). **First private GitHub pin** recorded for Portal static web `v0.1.0-g7p` in `compatibility/pins.real-releases.yaml` (`portal.web.*`). Platform S3 mirror of that object is still optional/pending OIDC publish.

| Field | Contract |
|-------|----------|
| Bucket | Platform artifact bucket (`modules/product-artifact-infra`) |
| Prefix | `portal-web/` |
| Object shape | `portal-web/<version>/portal-web.tar.gz` |
| Pin fields | `portal.web.version`, `portal.web.sha256`, `portal.web.url` |
| Consumer | `modules/portal-static-edge` — operators sync/extract into private S3 origin behind CloudFront OAC |

The current Phase 2 infra may still expose a `web` ECR compatibility slot while compatibility schema migration is pending. Future Portal compute must not require a web container.

### Portal backend services (ECR images)

| Service key | ECR name pattern | Pin |
|-------------|------------------|-----|
| `bff` | `<name_prefix>/portal/bff` | `portal.images.bff.repository` + `digest` |
| `relay` | `<name_prefix>/portal/relay` | `portal.images.relay.repository` + `digest` |
| `control-plane` | `<name_prefix>/portal/control-plane` | `portal.images.control-plane.repository` + `digest` |

Image tags are **IMMUTABLE** in ECR. Deploy authority is always the **digest** (`sha256:` + 64 hex).

## OIDC publishers (optional)

### Hermes product git authority

| Repo | Role |
|------|------|
| **`LanyardBrain/hermes-lanyard`** (private non-fork) | **Product authority** — OIDC publisher trust default, release tags, brain RPC, weekly Nous sync |
| `LanyardBrain/hermes-agent` (public fork) | **Archived** — historical only; do not publish product artifacts from here |
| `NousResearch/hermes-agent` | Upstream source for weekly rebase into `hermes-lanyard` |



| Role key | Trust (default) | Permissions |
|----------|-----------------|-------------|
| `portal` | `repo:LanyardBrain/Portal:ref:refs/tags/*` | S3 write under `portal-web/` plus ECR push to configured Portal repos; `ecr:GetAuthorizationToken` on `*` |
| `hermes` | `repo:LanyardBrain/hermes-lanyard:ref:refs/tags/*` | S3 write under `hermes/` |
| `client_core` | `repo:LanyardBrain/client-core:ref:refs/tags/*` | S3 write under `client-core/` |

S3 publisher IAM splits bucket location from list: `s3:GetBucketLocation` is bucket-scoped **without** an `s3:prefix` condition; `ListBucket` / `ListBucketVersions` stay prefix-conditioned; object writes stay prefix-scoped.

Requirements:

- Existing IAM OIDC provider ARN for `token.actions.githubusercontent.com` (module does **not** create the provider).
- Subjects configurable; defaults are **release tags only**.
- Staging apply procedure: `references/runbooks/product-artifact-staging-apply.md` (account gate, private backend/tfvars, live `scripts/verify-product-artifact-staging.sh` including denied-prefix simulation).

## Consumer wiring

| Consumer | How it uses releases |
|----------|----------------------|
| Tenant brain hosts | `s3://` (instance role) or HTTPS (public/pre-signed or private GitHub + `GITHUB_TOKEN`/`GH_TOKEN`) + SHA-256 via bootstrap |
| `modules/portal-static-edge` | Static web artifact URL/version/SHA from compatibility pins (operator sync) |
| `modules/portal-bff-service` / `portal-relay-service` / `portal-control-plane-service` | ECR repository URL + digest from compatibility pins |
| Operators | `compatibility/pins.real-releases.yaml` + optional private overlays; validate with `scripts/validate-compatibility.sh`; procedure `references/runbooks/pin-update.md` |

## Production topology gates

Release availability is necessary but not sufficient for deployment:

- BFF/control-plane service authentication and verified Google/OIDC must pass **staging proof (G1.4)** before production exposure (product code alone insufficient).
- Relay register/revoke/rotation product APIs exist; multi-tenant pilot still needs **live staging lifecycle E2E** (G2 matrix **blocked**).
- Control-plane RDS module is **infra_ready** (`modules/control-plane-rds/`) after product Postgres (G4.1 `CONTROL_PLANE_DATABASE_URL`) + G4.2; **not auto-applied** — operator private root only.
- BFF desired count must remain one until shared session/chat metadata state exists.
- Relay desired count must remain one until shared routing and revocation exist.
- Vault/settings/projects production support waits for brain RPC **staging E2E (G3.4)**. Contract authority: `references/brain-rpc-contract.md` (G3.1 defined; G3 overall still **blocked**).

## Explicit non-goals of this contract

- Running product release workflows or inventing published digests/SHAs
- Claiming RDS is production-applied from git examples (module exists; apply is operator-owned; G1 still required)
- Deploying Portal CloudFront/ECS/services
- Treating `@lanyard/web` as a required runtime container

See `references/readiness-matrix.md` for the live gate list.

## Pin consumption (deploy)

1. Product publishes immutable objects/digests (private GitHub Release and/or S3/ECR landing zones above).
2. Use `compatibility/pins.real-releases.yaml` for first Hermes/client-core coordinates, or copy `pins.example.yaml` for a clean template.
3. Fill real URL/version/SHA-256 and Portal repository+digest — never invent values; never put tokens in the pin file.
4. `bash scripts/validate-compatibility.sh compatibility/pins.real-releases.yaml` (and any operator overlay).
5. Map into tenant `terraform.tfvars` artifact variables; for private GH HTTPS pins inject `GITHUB_TOKEN`/`GH_TOKEN` at runtime only; bootstrap enforces SHA-256 (+ optional Ed25519).

Full steps: `references/runbooks/pin-update.md`. Field reference: `compatibility/README.md`.
