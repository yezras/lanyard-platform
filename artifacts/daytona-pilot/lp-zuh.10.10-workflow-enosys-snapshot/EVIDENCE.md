# lp-zuh.10.10 — Bake workflow ENOSYS rename fallback in agent-gateway snapshot

**Date:** 2026-08-14 (UTC)  
**Operator profile:** `AWS_PROFILE=lanyard-main` (account `123456789012`)  
**Bead:** `lp-zuh.10.10`  
**Parent:** `lp-zuh.10` (kitchen-sink residuals)  
**Residual from:** `lp-zuh.10.5` live vault workflow admit (hot-patched run-store)

## Acceptance

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Merge LA #241 to main | **GO** — [lanyard-agent#241](https://github.com/LanyardBrain/lanyard-agent/pull/241) squash merge `9bcada6780d2` (`packages/workflow/src/run-store.ts` atomicWriteJson ENOSYS/EXDEV/EPERM overwrite) |
| 2 | Rebuild agent-gateway image + Daytona snapshot pin (extend lp-zuh.10.9) | **GO** — `linux/amd64` bake LA `0.0.0-main.9bcada6780d2` + mount-s3 1.23.0 + mempalace 3.7.0; ECR immutable tag; Daytona snapshot **active**; SM + MockLab `agent_snapshot_id` pinned |
| 3 | Cold ensure_online MockLab: research-lite admit under `/mnt/vault/wf_*` without guest hot-patch | **GO** — stock sandbox from **new snapshot** + Mountpoint vault: `company-brain-backend cli workflow run research-lite` admitted `wf_4e8440b25d42613a` under `/mnt/vault/wf_*` with durable `program.json`/`args.json`/`state.json`/`journal.jsonl`; image dist **not writable** (no hot-patch); Mountpoint rename returns **ENOSYS** (errno 38) proving fallback path required. S3 objects present. Product portal chat `ensure_online` UI path closed by `lp-zuh.10.11` on the same pin. |
| 4 | Optional: journal append EPERM residual | **Open residual** — reconfirmed on stock pin (`journal io: EPERM` mid-plan after admit); program/args/state remain durable (same as `lp-zuh.10.5`) |

## Image

| Field | Value |
|-------|--------|
| Local tag | `lanyard/agent-gateway:la-main-9bcada6780d2-wf-enosys-zuh1010` |
| ECR tag | `la-main-9bcada6780d2-wf-enosys-zuh1010-20260814` |
| ECR digest | `sha256:d2acd6097f8b936832f2c4e0c36cc6bf8457877bb50b8a0fa03abc5dccaf0cd0` |
| Repository | `123456789012.dkr.ecr.us-east-1.amazonaws.com/lanyard-platform-staging/daytona/agent-gateway` |
| Product bake | LA `0.0.0-main.9bcada6780d2` + mount-s3 1.23.0 + fuse/fusermount + mempalace 3.7.0 |
| LA sha256 | `6acbc8aa8825165d0f86ddbf3b7ac0511d36b5184e2eef63c2df380539a7e8b8` |

### Image probe (no secrets)

```text
company-brain-backend (lanyard-agent) 0.0.0-main.9bcada6780d2
mount-s3 1.23.0
MemPalace 3.7.0
grep ENOSYS …/packages/workflow/dist/run-store.js → present (fallback path)
grep ENOSYS …/packages/cron/dist/store.js → present (lp-zuh.10.9 retained)
```

Offline: `bash deploy/daytona/agent-gateway/smoke-entrypoint.sh` — **PASS**.

## Snapshot

| Field | Value |
|-------|--------|
| Name | `lanyard-la-main-9bcada6780d2-wf-enosys-zuh1010-20260814b` |
| Id | `efa7c007-dbde-40c0-a7d4-ab24d47461c1` |
| State | **active** |
| Class | container |
| Image | `…/agent-gateway:la-main-9bcada6780d2-wf-enosys-zuh1010-20260814` (tag form; `@sha256` digest form failed registry inspect on Daytona runner) |

## Pins updated

| Surface | Value |
|---------|--------|
| SM `lanyard/staging/portal/daytona` `DAYTONA_DEFAULT_SNAPSHOT` | `efa7c007-dbde-40c0-a7d4-ab24d47461c1` |
| SM `DAYTONA_SNAPSHOT_NAME` | `lanyard-la-main-9bcada6780d2-wf-enosys-zuh1010-20260814b` |
| SM previous | `5c0d199a-00cf-4510-bc81-b24956656d13` (zuh.10.9 cron ENOSYS) |
| MockLab instance `agent_snapshot_id` | `efa7c007-…` on tenant `319d3808-…` / instance `452b1348-…` |
| Pins YAML | `deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml` |
| CP redeploy | force-new-deployment on `lanyard-platform-staging-cp` so task env reloads SM |

## Stock vault admit (no hot-patch) — acceptance #3

| Field | Value |
|-------|--------|
| Sandbox | `28a8b277-5bb6-4a6c-b78f-b7db78f88aa1` (deleted after proof) |
| Snapshot | `lanyard-la-main-9bcada6780d2-wf-enosys-zuh1010-20260814b` |
| Guest version | `0.0.0-main.9bcada6780d2` |
| Dist | `/opt/.../workflow/dist/run-store.js` mtime bake-time; **not writable** as `brain` |
| Mount | `mountpoint-s3` at `/mnt/vault` (rw, uid/gid 990) |
| Rename probe | `os.rename` on vault → **ENOSYS** (errno 38) |
| CLI | `company-brain-backend cli workflow run research-lite --budget 8 --args '{"question":"lp-zuh.10.10 stock pin no hot-patch vault admit"}'` |
| Admit | `Launched workflow: research-lite` id=`wf_4e8440b25d42613a` |
| Guest path | `/mnt/vault/wf_4e8440b25d42613a/{program,args,state,journal,scratch}` |
| S3 | `s3://lanyard-mocklab-vault-…/tenants/…/vault/wf_4e8440b25d42613a/` has same four files |

```text
# Guest (toolbox as brain uid 990) — excerpt
company-brain-backend (lanyard-agent) 0.0.0-main.9bcada6780d2
RENAME_ERR code=38 name=ENOSYS
DIST_NOT_WRITABLE
Launched workflow: research-lite
[running] research-lite id=wf_4e8440b25d42613a …
HIT /mnt/vault/wf_4e8440b25d42613a [args.json, journal.jsonl, program.json, scratch, state.json]
```

Artifact: [stock-vault-admit.txt](./stock-vault-admit.txt), [s3-run-dir.txt](./s3-run-dir.txt).

This closes the residual that stock MockLab guest still needed a live hot-patch of `run-store.js` after `lp-zuh.10.5`.

## Why this pin

`lp-zuh.10.5` proved vault `workflow.state_dir=/mnt/vault` and research-lite durable under `/mnt/vault/wf_*`, but stock image `atomicWriteJson` used write-tmp + **rename**. Mountpoint-S3 returns **ENOSYS** → admit failed without hot-patched dist.

LA source fallback (overwrite canonical path on ENOSYS/EXDEV/EPERM, mirrors FileCronStore / `lp-zuh.10.9`) is now baked into the agent-gateway snapshot so stock cold create does not need a guest hot-patch for workflow admit.

## Non-goals / residual

- **Product portal chat `ensure_online`** — closed by follow-up `lp-zuh.10.11` (PR #464): ops rotate restored instance secret material after CP force-new-deployment wipe; cold ensure_online bound sandbox on pin `efa7c007`; Portal UIQA PASS (`wf_4e8440b25d42613a`, Tools→Workflows, slash `/workflow`). See `artifacts/mocklab/live-qa/lp-zuh.10.11/` and `artifacts/ui/lp-zuh.10.11/`.
- Journal append **EPERM** on Mountpoint after first write remains optional residual (`lp-zuh.10.5`); reconfirmed on stock pin — admit durability still GO.
- Entrypoint can die on a brief post-`mount-s3` write-probe race (`after mount-s3, /mnt/vault is not writable`); mount later becomes writable — separate residual from ENOSYS bake (not blocking this bead).
- Orphan proof sandboxes deleted after session.

## Operator re-verify

```bash
# Pins (secret-free)
grep -E 'daytona_default_snapshot|workflow_enosys|lanyard_agent' \
  deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml

# Image probe after pull
docker run --rm --platform linux/amd64 --entrypoint /bin/bash \
  123456789012.dkr.ecr.us-east-1.amazonaws.com/lanyard-platform-staging/daytona/agent-gateway:la-main-9bcada6780d2-wf-enosys-zuh1010-20260814 \
  -lc 'company-brain-backend version; grep -n ENOSYS /opt/company-brain-backend/current/lanyard-agent/packages/workflow/dist/run-store.js | head'

# Stock admit (toolbox or portal cold create):
#   company-brain-backend version  # expect 0.0.0-main.9bcada6780d2
#   company-brain-backend cli workflow run research-lite --budget 8 \
#     --args '{"question":"lp-zuh.10.10 stock pin"}'
#   ls /mnt/vault/wf_*/state.json

# Portal UIQA (closed by lp-zuh.10.11):
#   stop MockLab sandbox → chat ensure_online → same guest checks
#   artifacts/ui/lp-zuh.10.11/RESULT.md (passed=true)
```

## Secret hygiene

- No tokens, passwords, AWS keys, Relay secrets, or SM payloads in this pack.
- Evidence is ids, digests, names, and command shapes only.
