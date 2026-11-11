# @lanyard/web — static release contract

Production web is a **static SPA artifact**, not a required runtime container.
Backend services (`bff`, `relay`, `control-plane`) publish to ECR; the UI publishes
a versioned tarball under the platform artifact bucket prefix `portal-web/`.

## Object layout

| Field | Value |
|-------|--------|
| Bucket | Platform product artifact bucket (`ARTIFACT_BUCKET`) |
| Prefix | `portal-web/` |
| Object | `portal-web/<version>/portal-web.tar.gz` |
| SHA companion | `portal-web/<version>/portal-web.tar.gz.sha256` |

Versions are **immutable labels only** (e.g. `v0.1.0`). Never `main`, `master`,
`HEAD`, `latest`, or other live branch names.

### Archive contents

Local pack produces `portal-web-<version>.tar.gz` with a single top-level
directory:

```text
portal-web-<version>/
  index.html
  assets/…
  VERSION
  build.env
```

Consumers may flatten that single top-level directory into a private S3 origin
(or other static host) behind CloudFront OAC. The S3 key always uses the fixed
filename `portal-web.tar.gz`; the version lives in the path prefix.

## Compatibility pins (company-brain-deploy)

| Pin field | Meaning |
|-----------|---------|
| `portal.web.version` | Immutable version label (e.g. `v0.1.0`) |
| `portal.web.sha256` | 64-char hex SHA-256 of the tarball bytes |
| `portal.web.url` | `s3://$ARTIFACT_BUCKET/portal-web/<version>/portal-web.tar.gz` |

Example (operator fills after verifying the published object):

```text
portal.web.version=v0.1.0
portal.web.sha256=<64-hex>
portal.web.url=s3://$ARTIFACT_BUCKET/portal-web/v0.1.0/portal-web.tar.gz
```

These pins are **optional** for backend-only deploys. Static web is not a
required runtime container; absence of `portal.web.*` does not block BFF/relay
image pins (`portal.images.*`).

## Pack locally (no AWS)

From the Portal package root (`portal/`):

```bash
pnpm install
./scripts/pack-web.sh --version v0.0.0-test
```

### MockLab / staging OnlyOffice bake (`lp-zuh.12.1`)

Product default is editor **off**. For MockLab dogfood, pack with Vite flags:

```bash
./scripts/pack-web-mocklab-oo.sh --version v0.1.6-mocklab-oo-zuh121
# Recipe: scripts/pack-web-mocklab-oo.env.example
#   VITE_ONLYOFFICE_EDITOR=true
#   VITE_ONLYOFFICE_DS_URL=https://<staging-docs-host>
#   VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS=https://<staging-docs-host>,https://app.withlanyard.com
```

`build.env` inside the tarball records the non-secret `VITE_ONLYOFFICE_*` stamps.  
Staging Docs ALB may still be HTTP-only — HTTPS Docs origin is `lp-zuh.12.2`.

Outputs under `dist/portal-web/`:

- `portal-web-v0.0.0-test.tar.gz`
- `portal-web-v0.0.0-test.tar.gz.sha256`
- `portal-web-v0.0.0-test.sha256`

Verify:

```bash
sha256sum -c dist/portal-web/portal-web-v0.0.0-test.tar.gz.sha256
tar -tzf dist/portal-web/portal-web-v0.0.0-test.tar.gz | head
```

## Publish (GitHub Actions + OIDC)

Workflow: [`.github/workflows/release-static-web.yml`](../../.github/workflows/release-static-web.yml)

| Trigger | Version source |
|---------|----------------|
| Tag push `v*` | tag name |
| GitHub Release published | release tag |
| `workflow_dispatch` | input `version` |

Repository variables (no hard-coded accounts):

| Variable | Purpose |
|----------|---------|
| `ARTIFACT_BUCKET` | Platform product artifact bucket name |
| `AWS_ROLE_ARN` | Portal OIDC publisher role (S3 write under `portal-web/`) |
| `AWS_REGION` | Bucket region |

OIDC trust (default product-artifact-infra): `repo:LanyardBrain/Portal:ref:refs/tags/*`.

On success the workflow summary prints the three pin fields. Workflow artifacts
always include the tarball + SHA even when S3 upload is skipped
(`skip_upload=true` or missing AWS vars on dispatch).

## Operator promote (S3 mirror → origin sync → CloudFront)

**This worker / pack step does not upload to AWS.** Orchestrator or platform
operators publish and promote using env-sourced coordinates only — **never**
commit live account IDs, bucket names, distribution IDs, or ARNs into git.

Variables (fill from Terraform outputs / private pin file / CI secrets):

| Env | Source (typical) |
|-----|------------------|
| `ARTIFACT_BUCKET` | product-artifact-infra `artifact_bucket_id` |
| `ORIGIN_BUCKET` | portal-static-edge `origin_bucket_id` |
| `CLOUDFRONT_DISTRIBUTION_ID` | portal-static-edge `cloudfront_distribution_id` |
| `AWS_REGION` | platform region |
| `VERSION` | immutable label (e.g. `v0.1.1-g7p1`) — never `main`/`latest` |
| `PACK_SHA256` | sidecar digest of the packed tarball |

### 1. Mirror pack into the product artifact bucket

Contract object name is fixed; version is the path prefix.

```bash
# From monorepo root after pack-web.sh --version "$VERSION"
TARBALL="dist/portal-web/portal-web-${VERSION}.tar.gz"
SHA_FILE="dist/portal-web/portal-web-${VERSION}.tar.gz.sha256"
test -s "$TARBALL" && test -s "$SHA_FILE"
echo "${PACK_SHA256}  ${TARBALL}" | sha256sum -c -

PREFIX="portal-web/${VERSION}"
aws s3 cp "$TARBALL" \
  "s3://${ARTIFACT_BUCKET}/${PREFIX}/portal-web.tar.gz" \
  --region "${AWS_REGION}" \
  --metadata "portal-web-version=${VERSION},sha256=${PACK_SHA256}"

aws s3 cp "$SHA_FILE" \
  "s3://${ARTIFACT_BUCKET}/${PREFIX}/portal-web.tar.gz.sha256" \
  --region "${AWS_REGION}" \
  --content-type "text/plain" \
  --metadata "portal-web-version=${VERSION},sha256=${PACK_SHA256}"
```

Pin after verify:

```text
portal.web.version=<VERSION>
portal.web.sha256=<PACK_SHA256>
portal.web.url=s3://$ARTIFACT_BUCKET/portal-web/<VERSION>/portal-web.tar.gz
```

### 2. Sync extracted SPA into the private CloudFront origin

`portal-static-edge` does **not** download at `terraform apply`. Operators extract
the single top-level directory and sync objects into the OAC origin bucket.

```bash
WORKDIR="$(mktemp -d)"
aws s3 cp "s3://${ARTIFACT_BUCKET}/portal-web/${VERSION}/portal-web.tar.gz" \
  "${WORKDIR}/portal-web.tar.gz" --region "${AWS_REGION}"
echo "${PACK_SHA256}  ${WORKDIR}/portal-web.tar.gz" | sha256sum -c -

tar -xzf "${WORKDIR}/portal-web.tar.gz" -C "${WORKDIR}"
# Flatten single top-level portal-web-<VERSION>/ into a stage dir
STAGE="${WORKDIR}/stage"
mkdir -p "$STAGE"
rsync -a "${WORKDIR}/portal-web-${VERSION}/" "${STAGE}/"
test -f "${STAGE}/index.html"

# Optional versioned prefix if origin_path is set on the edge module:
# ORIGIN_PREFIX="releases/${VERSION}/"
ORIGIN_PREFIX="${ORIGIN_PREFIX:-}"

aws s3 sync "${STAGE}/" "s3://${ORIGIN_BUCKET}/${ORIGIN_PREFIX}" \
  --region "${AWS_REGION}" \
  --delete
```

### 3. Invalidate CloudFront

```bash
aws cloudfront create-invalidation \
  --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" \
  --paths "/*"
```

### Prior pin rollback

Versions are immutable; do **not** overwrite an existing `portal-web/<version>/`
prefix. To roll back the edge:

1. Re-pin `portal.web.*` to the previous known-good label (example prior pin:
   `v0.1.0-g7p` / SHA `b1d00dafc01c1e7b1de5d0ace59f44b1697de8e90eefd290829b4f9d45d8dff1`).
2. Re-run origin sync (§2) from that version’s artifact object (or a local
   verified tarball with matching SHA).
3. Invalidate CloudFront (§3).
4. If `origin_path` points at a versioned prefix, switch it back to the prior
   prefix instead of re-uploading root objects.

Deploy residual (orchestrator / company-brain-deploy): private pin update,
`bash scripts/validate-compatibility.sh /path/to/private-pins.yaml`, and
staging evidence — not part of this pack worker.

## Non-goals

- Web is **not** published as a required ECR runtime image
- This path does not push backend Docker images (see G7.P3 image release)
- Deploy edge (CloudFront/OAC origin wiring) is owned by company-brain-deploy
- This pack worker does **not** require AWS credentials or perform live uploads
