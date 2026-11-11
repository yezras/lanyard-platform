# lp-zuh.10.9 — Pin agent-gateway snapshot with Mountpoint ENOSYS cron store rename fallback

**Date:** 2026-08-14 (UTC)  
**Operator profile:** `AWS_PROFILE=lanyard-main` (account `123456789012`)  
**Bead:** `lp-zuh.10.9`  
**Parent:** `lp-zuh.10` (kitchen-sink residuals)  
**Residual from:** `lp-zuh.10.4` live vault cron fire (hot-patched gateway)

## Acceptance

| # | Criterion | Result |
|---|-----------|--------|
| 1 | LA FileCronStore ENOSYS rename fallback in product source | **GO** — merged [lanyard-agent#240](https://github.com/LanyardBrain/lanyard-agent/pull/240) commit `85622faa37d2` (`store.ts`, `tick.ts`, `cron-agent-runner.ts`) |
| 2 | Rebuild agent-gateway image with new LA pack | **GO** — `linux/amd64` bake; ENOSYS strings present in dist JS; version `0.0.0-main.85622faa37d2` |
| 3 | ECR publish immutable tag + digest | **GO** — tag `la-main-85622faa37d2-enosys-zuh109-20260814` digest `sha256:22734c070eb3ee85060b8bc26718ea82eef793ab2cc5dfdb8897fc47221dc860` |
| 4 | Daytona snapshot active | **GO** — id `5c0d199a-00cf-4510-bc81-b24956656d13` name `lanyard-la-main-85622faa37d2-enosys-zuh109-20260814` state **active** |
| 5 | Pin `DAYTONA_DEFAULT_SNAPSHOT` + MockLab `agent_snapshot_id` | **GO** — SM + `gateway_instances` row updated to new snapshot id |
| 6 | Stock create no longer needs live hot-patch | **GO** — snapshot bakes ENOSYS fallback; cold create uses pin (existing online sandbox keeps prior guest until stop/cold create) |

## Image

| Field | Value |
|-------|--------|
| Local tag | `lanyard/agent-gateway:la-main-85622faa37d2-enosys-zuh109` |
| ECR tag | `la-main-85622faa37d2-enosys-zuh109-20260814` |
| ECR digest | `sha256:22734c070eb3ee85060b8bc26718ea82eef793ab2cc5dfdb8897fc47221dc860` |
| Repository | `123456789012.dkr.ecr.us-east-1.amazonaws.com/lanyard-platform-staging/daytona/agent-gateway` |
| Product bake | LA `0.0.0-main.85622faa37d2` + mount-s3 1.23.0 + fuse/fusermount + mempalace 3.7.0 |
| LA sha256 | `98db6ddb44ad7d8a3cfa77fdb7dafdb97882da2777ee8ad0f7f5e893523ba3d5` |

### Image probe (no secrets)

```text
company-brain-backend (lanyard-agent) 0.0.0-main.85622faa37d2
mount-s3 1.23.0
MemPalace 3.7.0
grep ENOSYS …/packages/cron/dist/store.js → present (fallback path)
```

Offline: `bash deploy/daytona/agent-gateway/smoke-entrypoint.sh` — PASS.

## Snapshot

| Field | Value |
|-------|--------|
| Name | `lanyard-la-main-85622faa37d2-enosys-zuh109-20260814` |
| Id | `5c0d199a-00cf-4510-bc81-b24956656d13` |
| State | **active** |
| Class | container |
| Image | `…/agent-gateway:la-main-85622faa37d2-enosys-zuh109-20260814` |

## Pins updated

| Surface | Value |
|---------|--------|
| SM `lanyard/staging/portal/daytona` `DAYTONA_DEFAULT_SNAPSHOT` | `5c0d199a-00cf-4510-bc81-b24956656d13` |
| SM `DAYTONA_SNAPSHOT_NAME` | `lanyard-la-main-85622faa37d2-enosys-zuh109-20260814` |
| SM previous | `41e87f4d-d639-4445-9402-88d39d44ac2d` (zuh.9.4 mounts3) |
| MockLab instance `agent_snapshot_id` | `5c0d199a-…` on tenant `319d3808-…` / instance `452b1348-…` |
| Pins YAML | `deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml` |
| CP redeploy | force-new-deployment on `lanyard-platform-staging-cp` so task env reloads SM |

## Why this pin

`lp-zuh.10.4` proved vault `cron.state_dir=/mnt/vault` and live GPU brief fire, but stock image `FileCronStore` used write-tmp + **rename**. Mountpoint-S3 returns **ENOSYS** → create/update failed without a live hot-patch of gateway JS.

LA source fallback (overwrite canonical path on ENOSYS/EXDEV/EPERM) is now baked into the agent-gateway snapshot so stock cold create works.

## Build fix absorbed

`install-mount-s3.sh`: noninteractive `fuse` install with `--force-confold` so pre-seeded `/etc/fuse.conf` `user_allow_other` (lp-zuh.9.4) does not trip interactive conffile prompts during bake.

## Non-goals / residual

- Existing **online** MockLab sandbox keeps prior guest image until Daytona stop + cold create (orchestrator create-from-snapshot).
- Full kitchen-sink re-QA remains `lp-zuh.10.8`.
- Platform SoT rematerialize hybrid `$BACKEND_HOME/cron` path is orthogonal (lp-jzl.10.1).

## Operator re-verify

```bash
# Pins (secret-free)
grep -E 'daytona_default_snapshot|previous_daytona|lanyard_agent|enosys' \
  deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml

# Image probe after pull
docker run --rm --platform linux/amd64 --entrypoint /bin/bash \
  123456789012.dkr.ecr.us-east-1.amazonaws.com/lanyard-platform-staging/daytona/agent-gateway:la-main-85622faa37d2-enosys-zuh109-20260814 \
  -lc 'company-brain-backend version; grep -n ENOSYS /opt/company-brain-backend/current/lanyard-agent/packages/cron/dist/store.js | head'

# Cold create: stop sandbox for MockLab instance → ensure_online → cron create on vault
```

## Secret hygiene

- No tokens, passwords, AWS keys, Relay secrets, or SM payloads in this pack.
- Evidence is ids, digests, names, and command shapes only.
