# Portal image release (ECR digests)

How Lanyard Portal publishes **bff**, **relay**, and **control-plane** container images to Amazon ECR, and how operators pin digests in **company-brain-deploy**.

Deploy infrastructure and pin schema live in [company-brain-deploy](https://github.com/LanyardBrain/company-brain-deploy) (`modules/product-artifact-infra`, `compatibility/`). This repository owns Dockerfiles and the GitHub Actions publish workflow.

## What gets published

| Service | Dockerfile | ECR repository name | Compatibility pin |
|---------|------------|---------------------|-------------------|
| `bff` | `packages/bff/Dockerfile` | `${ECR_NAME_PREFIX}/portal/bff` | `portal.images.bff.repository` + `digest` |
| `relay` | `packages/relay/Dockerfile` | `${ECR_NAME_PREFIX}/portal/relay` | `portal.images.relay.repository` + `digest` |
| `control-plane` | `packages/control-plane/Dockerfile` | `${ECR_NAME_PREFIX}/portal/control-plane` | `portal.images.control-plane.repository` + `digest` |

**Not published by this workflow:** `@lanyard/web` as a runtime container. A `web` ECR repo may exist as a deploy compatibility slot; production web is a **static S3 artifact** (separate track). Do not require a web container at deploy time.

Build context is always the **monorepo root** (workspace packages must resolve).

## Immutability rules

- ECR image tags are **IMMUTABLE** (product-artifact-infra). Re-pushing the same tag fails.
- Deploy authority is the **digest** (`sha256:` + 64 hex), not the tag alone.
- Version labels must be immutable (e.g. `v0.1.0`). The workflow **fail-closes** on `main`, `master`, `HEAD`, `latest`, `develop`, and similar mutable names.

## Workflow

File: [`.github/workflows/release-images.yml`](../.github/workflows/release-images.yml)

| Trigger | Version source |
|---------|----------------|
| GitHub Release `published` | release tag name |
| Push tag `v*` | tag name |
| `workflow_dispatch` | explicit `version` input |

Default OIDC trust in product-artifact-infra is **release tags only**:

```text
repo:LanyardBrain/Portal:ref:refs/tags/*
```

`workflow_dispatch` from a branch will not assume the role unless subjects are deliberately extended in Terraform. Prefer tagging (`v*`) or publishing a GitHub Release.

### What the job does

1. Resolve and validate the version label (fail-closed for mutable names).
2. Assume the **portal** publisher role via GitHub OIDC (`AWS_ROLE_ARN`).
3. Log in to ECR (`aws-actions/amazon-ecr-login` — registry host comes from the assumed role; **no hard-coded account IDs**).
4. For each backend service: `docker build` from monorepo root → tag `${registry}/${ECR_NAME_PREFIX}/portal/<svc>:<version>` → `docker push`.
5. Capture the image digest with `docker buildx imagetools inspect`.
6. Upload workflow artifact `portal-image-digests-<version>.json` (+ markdown twin).
7. Write a job summary listing repository + digest per service and a ready-to-copy pin YAML snippet.

Local smoke (no ECR): `bash scripts/docker-smoke.sh`.

## Required GitHub repository variables

Set under **Settings → Secrets and variables → Actions → Variables** (not secrets for these non-sensitive coords). **Do not hard-code account IDs in workflow YAML.**

| Variable | Purpose | Source |
|----------|---------|--------|
| `AWS_ROLE_ARN` | IAM role ARN for the portal OIDC publisher | Terraform output `oidc_publisher_role_arns["portal"]` from `product-artifact-infra` |
| `AWS_REGION` | AWS region of the ECR registries | Same region as platform staging / product artifact infra |
| `ECR_NAME_PREFIX` | Terraform `name_prefix` used in ECR repo paths | e.g. `lanyard-platform-staging` → repos `…/portal/bff` etc. |

Registry hostname is **not** a required variable: `amazon-ecr-login` derives `<account>.dkr.ecr.<region>.amazonaws.com` from the role session.

### Operator checklist (platform)

1. Apply `modules/product-artifact-infra` with `enable_oidc_publishers = true` and an **existing** GitHub OIDC provider ARN.
2. Confirm ECR repos exist: `${name_prefix}/portal/{bff,relay,control-plane}` (and optional `web` slot unused by this workflow).
3. Copy portal publisher role ARN → Portal repo variable `AWS_ROLE_ARN`.
4. Set `AWS_REGION` and `ECR_NAME_PREFIX` (`name_prefix`).
5. Create a release tag `vX.Y.Z` (or publish a GitHub Release) on Portal.
6. Download `portal-image-digests-vX.Y.Z` from the workflow run artifacts.

## Digest artifact shape

`portal-image-digests-<version>.json` (schema_version 1):

```json
{
  "schema_version": 1,
  "version": "v0.1.0",
  "git_sha": "<commit>",
  "registry": "<account>.dkr.ecr.<region>.amazonaws.com",
  "ecr_name_prefix": "<name_prefix>",
  "images": {
    "bff": {
      "repository": "<registry>/<name_prefix>/portal/bff",
      "digest": "sha256:<64 hex>",
      "tag": "v0.1.0",
      "pin_ref": "<registry>/<name_prefix>/portal/bff@sha256:<64 hex>"
    },
    "relay": { "...": "..." },
    "control-plane": { "...": "..." }
  }
}
```

## Copy digests into company-brain-deploy pins

**Do not invent digests.** Only use values from a successful `Release images` run.

1. Download `portal-image-digests-<version>.json` from the Actions artifact.
2. Copy into a **private** pin file (never commit live account-specific pins to public git if policy forbids it):

```yaml
schema_version: 1
# ... hermes / client_core / relay_contract as required ...

portal:
  images:
    bff:
      repository: "<from artifact images.bff.repository>"
      digest: "sha256:<from artifact images.bff.digest>"
      tag: "v0.1.0"   # optional human label; digest is authority
    relay:
      repository: "<from artifact images.relay.repository>"
      digest: "sha256:<from artifact images.relay.digest>"
      tag: "v0.1.0"
    control-plane:
      repository: "<from artifact images.control-plane.repository>"
      digest: "sha256:<from artifact images.control-plane.digest>"
      tag: "v0.1.0"
```

3. Validate with company-brain-deploy:

```bash
bash scripts/validate-compatibility.sh /path/to/pins.yaml
```

4. Feed the same repository + digest values into tenant / platform Terraform variables when Portal backend compute modules consume them.

See company-brain-deploy:

- `compatibility/schema.json` / `compatibility/pins.example.yaml` (placeholder digests only)
- `references/product-artifact-release-contract.md`
- `modules/product-artifact-infra/` (ECR + OIDC)

## Related local commands

```bash
# Build + /health without ECR
bash scripts/docker-smoke.sh

# Single service
docker build -f packages/bff/Dockerfile -t lanyard/bff:local .
```

## Out of scope

- Publishing `@lanyard/web` static tarball to S3 (`portal-web/` prefix) — separate track
- Pushing a `web` container image
- Deploying ECS/ALB/services (company-brain-deploy later phase)
- Inventing digests in company-brain-deploy examples
