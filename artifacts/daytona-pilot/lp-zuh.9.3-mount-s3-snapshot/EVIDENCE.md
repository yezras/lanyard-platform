# lp-zuh.9.3 — Image+snapshot: bake mount-s3/fuse and pin DAYTONA_DEFAULT_SNAPSHOT

**Date:** 2026-08-14  
**Operator profile:** `AWS_PROFILE=lanyard-main` (account `123456789012`)

## Acceptance

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Image build `linux/arm64` (Fargate) + `linux/amd64` | **GO** — both verified with `mount-s3 1.23.0` + `fusermount` |
| 2 | `mount-s3 --version` and `fusermount` present in image | **GO** — build-time verify + docker run probes |
| 3 | Snapshot created; SM pin updated | **GO** — snapshot active; SM + MockLab instance pin updated |
| 4 | Cold sandbox PATH has `mount-s3` without install-on-boot | **GO** — prebaked in image layers; entrypoint never installs |
| 5 | Link `lp-qh2` kitchen-sink config seed still present | **GO** — `ensure_agent_config` in entrypoint; smoke asserts seed |

## Image

| Field | Value |
|-------|--------|
| Local tags | `lanyard/agent-gateway:lp-zuh93-amd64` (product LA), `…:lp-zuh93-arm64` (stub + mount-s3) |
| ECR tag | `la-main-508b0b736ad5-mounts3-20260814` |
| ECR digest | `sha256:04ea0047592622cb0f0bdab9163622bbc6cb47b4e548b6d32f0bb64bf4645fa6` |
| Repository | `123456789012.dkr.ecr.us-east-1.amazonaws.com/lanyard-platform-staging/daytona/agent-gateway` |
| Product bake | LA `0.0.0-main.508b0b736ad5` + mount-s3 1.23.0 + fuse/libfuse2 + fusermount |
| mount-s3 pin | versioned deb (`…/1.23.0/{x86_64\|arm64}/mount-s3-1.23.0-….deb`) via `install-mount-s3.sh` |

## Snapshot

| Field | Value |
|-------|--------|
| Name | `lanyard-la-main-508b0b736ad5-mounts3-20260814c` |
| Id | `a3008149-f1ac-4769-ba9f-e73bf61ed837` |
| State | **active** |
| Class | container |
| Image | `…/agent-gateway:la-main-508b0b736ad5-mounts3-20260814` |
| Notes | First attempts failed (digest `@` → invalid ref; expired ECR token). Refreshed org registries via `PATCH /api/docker-registry/{id}`; create with **immutable tag** succeeded. |

## Pins updated

| Surface | Value |
|---------|--------|
| SM `lanyard/staging/portal/daytona` `DAYTONA_DEFAULT_SNAPSHOT` | `a3008149-f1ac-4769-ba9f-e73bf61ed837` |
| SM `DAYTONA_SNAPSHOT_NAME` | `lanyard-la-main-508b0b736ad5-mounts3-20260814c` |
| SM previous | `86d85356-78eb-4318-b885-93f80c435464` (stored as `DAYTONA_PREVIOUS_DEFAULT_SNAPSHOT`) |
| MockLab instance `agent_snapshot_id` | `a3008149-…` on tenant `319d3808-…` / instance `452b1348-…` |
| Pins YAML | `deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml` |
| CP redeploy | force-new-deployment on `lanyard-platform-staging-cp` so task env reloads SM |

## Repo surfaces

- `deploy/daytona/agent-gateway/Dockerfile` — multi-arch + mount-s3 bake
- `deploy/daytona/agent-gateway/install-mount-s3.sh` — pinned 1.23.0, arch map
- `deploy/daytona/agent-gateway/entrypoint.sh` — `ensure_vault_mount` + kitchen-sink seed (`lp-qh2`)
- `deploy/daytona/agent-gateway/build-local.sh` / `smoke-entrypoint.sh` / README
- `.github/workflows/agent-gateway-image.yml` — CI verifies mount-s3 + fusermount

## Residual (not this bead)

- Live cold ensure_online R/W Mountpoint proof → `lp-zuh.9.4` (needs IAM `lp-zuh.9.1` + CP STS inject `lp-zuh.9.2`)
- Existing online sandbox keeps prior guest image until stop + cold create
- Guest FUSE may still need privileged/`/dev/fuse` on Daytona container class (spike residual)

## Operator verify

```bash
# Image probe (local or after pull)
docker run --rm --platform linux/amd64 --entrypoint /bin/bash \
  123456789012.dkr.ecr.us-east-1.amazonaws.com/lanyard-platform-staging/daytona/agent-gateway:la-main-508b0b736ad5-mounts3-20260814 \
  -lc 'mount-s3 --version; command -v fusermount'

# Offline smoke
bash deploy/daytona/agent-gateway/smoke-entrypoint.sh
```
