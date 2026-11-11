# Agent gateway image CI → ECR digest (`lp-wu1`)

**Status:** Workflow + dry-run / blocked-path docs (no invented AWS account apply).  
**Bead:** `lp-wu1`  
**Parent:** `lp-4xa` (Phase 2: Agent image and snapshot pipeline)  
**Depends on:** Dockerfile local proof (`lp-e9l`) — [`deploy/daytona/agent-gateway/`](../../../deploy/daytona/agent-gateway/)  
**Downstream:** Snapshot create + pin (`lp-1wa`) — [agent-snapshot-live-pin.md](./agent-snapshot-live-pin.md), convention [agent-snapshot-pin.md](./agent-snapshot-pin.md), bump [agent-snapshot-bump-runbook.md](./agent-snapshot-bump-runbook.md)  
**Plan:** [overview §4.3](./overview.md) (Bucket A prebake; no install-on-boot)

## Purpose

Publish an **immutable registry digest** for the Daytona agent-gateway image (Bucket A):

1. **CI builds** `linux/amd64` from `deploy/daytona/agent-gateway/Dockerfile`
2. **When lab credentials exist** → push tag to ECR and capture `sha256:…` digest
3. **When credentials are missing** → still **build** (PR/branch) and emit a **pin template** + local image id; **never invent** digests
4. Document **least-privilege** IAM for push (operators apply when ready; this bead does not invent account changes)

Digest (not floating `latest`) is the input to Daytona snapshot create (`lp-1wa`). Control Plane continues to pin the **Daytona snapshot id**, not the ECR digest alone ([agent-snapshot-pin.md](./agent-snapshot-pin.md)).

## Workflow

| Item | Value |
|------|--------|
| File | [`.github/workflows/agent-gateway-image.yml`](../../../.github/workflows/agent-gateway-image.yml) |
| Dockerfile | [`deploy/daytona/agent-gateway/Dockerfile`](../../../deploy/daytona/agent-gateway/Dockerfile) |
| Local proof | `bash deploy/daytona/agent-gateway/build-local.sh --run-smoke` |
| Platform | `linux/amd64` |

### Triggers

| Event | Default mode |
|-------|----------------|
| `pull_request` (path-filtered) | **build-only** (never push) |
| `push` to `main` (path-filtered) | **build-only** |
| `push` tags `v*` / `agent-gateway-v*` | **publish** if vars present; else build-only + template |
| GitHub Release `published` | same as tags |
| `workflow_dispatch` | **publish** if vars present; `skip_push=true` forces build-only |

Path filters keep PR CI cheap: only agent-gateway tree, this workflow, and this doc.

### Modes

| Mode | Build | Push | Artifact |
|------|-------|------|----------|
| `publish` | yes | yes | real `repository` + `digest` |
| `build-only` | yes | no | `local_image_id` + pin **template** (`digest: sha256:<64-hex-from-ecr-publish>`) |

**Never invent digests.** Missing vars → warning + build-only; job still green so pipeline documents the blocked path without lying about ECR.

## Repository variables (lab)

Set under **Settings → Secrets and variables → Actions → Variables** (coords are not secrets). **Do not hard-code account IDs in workflow YAML.**

| Variable | Required for publish | Purpose |
|----------|----------------------|---------|
| `AGENT_GATEWAY_AWS_ROLE_ARN` **or** `AWS_ROLE_ARN` | yes | IAM role ARN assumable via GitHub OIDC |
| `AWS_REGION` | yes | ECR region |
| `ECR_NAME_PREFIX` | yes | Terraform-style `name_prefix` (e.g. `lanyard-platform-staging`) |
| `AGENT_GATEWAY_ECR_REPO_SUFFIX` | no | Default `daytona/agent-gateway` |

Full repository name:

```text
${ECR_NAME_PREFIX}/${AGENT_GATEWAY_ECR_REPO_SUFFIX}
# default: ${ECR_NAME_PREFIX}/daytona/agent-gateway
```

Registry host is derived by `aws-actions/amazon-ecr-login` from the assumed role — **no hard-coded account IDs**.

### Operator checklist (when lab is ready)

1. Create ECR repository (immutable tags recommended), name shape above — **or** extend `deploy/modules/product-artifact-infra` in a **future** bead; this bead does **not** apply TF.
2. Attach least-privilege push policy (below) to a GitHub OIDC role whose trust subject matches how you publish (prefer **release tags** only).
3. Set repo variables `AWS_ROLE_ARN` (or `AGENT_GATEWAY_AWS_ROLE_ARN`), `AWS_REGION`, `ECR_NAME_PREFIX`.
4. Tag `agent-gateway-vX.Y.Z` or run **Agent gateway image** workflow_dispatch with immutable version.
5. Download artifact `agent-gateway-<version>` → use `image.digest` in `lp-1wa` snapshot create.

### Blocked path (credentials absent)

If vars are missing or OIDC trust does not allow the current ref:

| Symptom | Expected behavior |
|---------|-------------------|
| Missing `AWS_ROLE_ARN` / `AWS_REGION` / `ECR_NAME_PREFIX` | `mode=build-only`, pin template artifact, step summary documents blocked path |
| PR / branch push | Always build-only (by design) |
| OIDC STS deny on tag publish | Job fails at assume-role — fix trust subjects / role; do not invent digests offline |

**Local rebuild proof (always available):**

```bash
bash deploy/daytona/agent-gateway/build-local.sh --run-smoke
```

Staging AWS hold (localhost-only) may block live ECR; local proof + workflow dry-run still satisfy build evidence until hold is lifted.

## Digest artifact shape

`agent-gateway-digests-<version>.json` (`schema_version` 1):

### Publish mode

```json
{
  "schema_version": 1,
  "component": "agent-gateway",
  "bead": "lp-wu1",
  "mode": "publish",
  "version": "v0.1.0",
  "git_sha": "<commit>",
  "platform": "linux/amd64",
  "registry": "<account>.dkr.ecr.<region>.amazonaws.com",
  "ecr_name_prefix": "<name_prefix>",
  "repo_suffix": "daytona/agent-gateway",
  "local_image_id": "sha256:…",
  "push": true,
  "image": {
    "repository": "<registry>/<name_prefix>/daytona/agent-gateway",
    "digest": "sha256:<64 hex>",
    "tag": "v0.1.0",
    "pin_ref": "<registry>/<name_prefix>/daytona/agent-gateway@sha256:<64 hex>"
  }
}
```

### Build-only / template mode

```json
{
  "schema_version": 1,
  "component": "agent-gateway",
  "bead": "lp-wu1",
  "mode": "build-only",
  "version": "…",
  "git_sha": "<commit>",
  "platform": "linux/amd64",
  "local_image_id": "sha256:…",
  "registry_digest": null,
  "push": false,
  "blocked": "missing-vars",
  "note": "No registry digest invented. …"
}
```

Twin YAML pin fragment / template: `agent-gateway-<version>.pins.yaml`.

## Least-privilege permissions (documented)

Goal: CI can push **only** the agent-gateway repository; no broad ECR `*`, no S3, no Daytona, no Secrets Manager read of product secrets.

### Trust (GitHub OIDC)

Prefer tag-scoped subjects (same pattern as portal product-artifact-infra):

```text
repo:LanyardBrain/lanyard-platform:ref:refs/tags/*
```

Optional (operators only if deliberate): `workflow_dispatch` subjects for a release branch. **Do not** grant `repo:…:*` to all refs in production.

### IAM policy sketch (ECR push to one repo)

Replace placeholders after real account setup — **do not commit live ARNs as secrets; ARNs are coords but prefer outputs from TF.**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRGetAuthorizationToken",
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken"],
      "Resource": "*"
    },
    {
      "Sid": "ECRPushPullAgentGatewayOnly",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:DescribeRepositories",
        "ecr:DescribeImages",
        "ecr:ListImages"
      ],
      "Resource": [
        "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/<ECR_NAME_PREFIX>/daytona/agent-gateway"
      ]
    }
  ]
}
```

Notes:

| Rule | Rationale |
|------|-----------|
| `ecr:GetAuthorizationToken` on `*` | AWS account-level API; unavoidable |
| All other ECR actions scoped to **one** repository ARN | Least privilege vs portal multi-service role |
| No `ecr:DeleteRepository` / `ecr:CreateRepository` | CI is not infra bootstrap |
| No SM / Daytona / S3 vault in this role | Image push only; wake secrets stay on CP path |
| Immutable tag mutability on repo | Matches portal product-artifact-infra practice; digest is authority |

### Relationship to `product-artifact-infra`

Portal images use `${name_prefix}/portal/{bff,relay,control-plane}` and publisher OIDC in [`deploy/modules/product-artifact-infra/`](../../../deploy/modules/product-artifact-infra/). Agent-gateway is **Daytona Bucket A**, not a portal service slot.

This bead **documents** the separate repo path and IAM sketch. Extending Terraform (`ecr.tf` / publisher map) is **out of scope** unless a later bead explicitly applies lab infra — do not invent AWS account changes here.

## Immutability rules

- Prefer **immutable** ECR tags (same policy as portal).
- **Digest** (`sha256:` + 64 hex) is the pin input for snapshot create.
- Refuse mutable version labels: `main`, `latest`, `HEAD`, `develop`, etc.
- Do **not** use floating `latest` as the sole product pin.

## Secrets policy

| In image / CI logs? | Material |
|---------------------|----------|
| **No** | `GATEWAY_RELAY_SECRET`, provider keys, Daytona org API key, vault bytes |
| **Yes (coords)** | Role ARN var name, region, name_prefix, repository path, digest |
| **Never commit** | `.env.mocklab-agent-dev`, live SM payloads, long-lived AWS keys |

Workflow uses **OIDC** (`id-token: write`); prefer role assumption over static `AWS_ACCESS_KEY_ID` in GitHub secrets.

## Acceptance (`lp-wu1`)

- [x] CI job builds and (when lab creds exist) pushes — [`.github/workflows/agent-gateway-image.yml`](../../../.github/workflows/agent-gateway-image.yml)
- [x] Digest output artifact or log — `agent-gateway-digests-<version>.json` (+ step summary); template when blocked
- [x] Permissions least-privilege documented — this file (OIDC trust + single-repo ECR policy sketch)
- [x] Blocked path + local build proof documented — missing vars → build-only; `build-local.sh --run-smoke`
- [x] No invented AWS account apply; no invented digests

## Links

| Doc / path | Role |
|------------|------|
| [overview.md §4.3](./overview.md) | Guest + prebake policy |
| [agent-snapshot-pin.md](./agent-snapshot-pin.md) | CP pin after `lp-1wa` |
| [gateway-env-contract.md](./gateway-env-contract.md) | Wake env (not baked in image) |
| [portal/docs/image-release.md](../../../portal/docs/image-release.md) | Parallel portal ECR pattern |
| [docs/architecture/ci-and-release.md](../../architecture/ci-and-release.md) | Monorepo release overview |
| `lp-e9l` | Dockerfile + local proof |
| `lp-1wa` | Snapshot from digest + pin id |
