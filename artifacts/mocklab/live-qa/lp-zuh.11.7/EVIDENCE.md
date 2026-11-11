# lp-zuh.11.7 — Fix UI QA residual for lp-zuh.11.4 (MemPalace / disk limit)

**Date:** 2026-08-17 (UTC)  
**Bead:** `lp-zuh.11.7` (bug)  
**Parent:** `lp-zuh.11.4` (closed) / epic `lp-zuh.11`  
**Verdict:** **PASS** (portal UI QA + guest MemPalace proof)

## Failure under repair

UI QA for `lp-zuh.11.4` returned **FAIL_INFRA_DAYTONA_DISK_LIMIT**:

- MockLab shell auth OK (`agent-dev@mocklab.example.com`)
- `ensure_online` → Daytona create **Total disk limit exceeded (30GiB)**
- Brain health 502; vault roots empty; chat `wake_failed`
- Could not re-prove guest mempalace ready/search

Screenshots of residual: `artifacts/ui/lp-zuh.11.4/`.

## Root cause chain

1. **Disk quota full** — 10× stopped 3 GiB sandboxes for MockLab instance `452b1348-…` (autoDeleteInterval=-1) filled the 30 GiB org limit.
2. **Orphan thrash** — relay never-connect kill path only `stop`ped sandboxes (no archive), so recreate left stopped volumes counting against disk.
3. **After free disk** — live snapshot `lanyard-la-main-9bcada6780d2-seed-zuh111-20260814` entrypoint **lacks** the post-mount writable wait from `lp-zuh.11.2`; cold boot dies with  
   `after mount-s3, /mnt/vault is not writable by uid=990` → gateway never starts → `relay_never_connect`.
4. Main branch entrypoint already has the wait (`LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC`); **snapshot re-bake residual** remains open.

## Fix applied

| Step | Result |
|------|--------|
| Archive all stopped/started thrash sandboxes via Daytona API | Active disk freed (0–3 GiB kept for one host) |
| `POST …/instances/452b1348…/rotate` (service token, Fargate on BFF SG) | **200** — re-seed secret material + Relay notify |
| Hot-start gateway after mount became writable on sandbox `9c523b48-…` | `/ready` mempalace **ok**; portal channel connected |
| `PATCH …/registry` `{sandbox_id, presence:online}` | Presence **online** bound to hot sandbox |
| Portal UI QA re-run | **passed=true** — see `artifacts/ui/lp-zuh.11.7/` |
| Guest CLI | `mempalace search "MockLab zero-waiver"` → hits; binary on PATH |

## Portal UI QA proof (acceptance of lp-zuh.11.4 surfaces)

| Criterion | Result | Evidence |
|-----------|--------|----------|
| Shell auth | GO | `01-auth-home.png` |
| Guest ready mempalace ok | GO | guest `/ready` mempalace.reason=ok; logs/guest-mempalace-probe.txt |
| Search empty-or-hits without binary_missing | GO | guest search hits; chat no binary_missing (`RESULT.md`) |
| path under vault | GO | vault tree lists `mempalace` |
| Screenshots/log evidence | GO | `artifacts/ui/lp-zuh.11.7/` |

## Code harden (this bead)

- `waitRelayConnectedOrRecreate`: best-effort **archive** after stop on kill path so recreates free disk (`lp-zuh.11.7`).
- Unit test: `ensure-online-relay.test.ts` expects `getArchiveCount() >= 1`.
- Ops helper: `deploy/daytona/archive-orphan-sandboxes.py`.

## Residuals

| Item | Status |
|------|--------|
| Re-bake+pin agent-gateway snapshot including post-mount writable wait + 11.4 command-shim | **Open** — pin still `f4d947f3` / zuh111; cold entrypoint can still die pre-gateway without hot-start |
| Durable secret-material store across CP recycle | Open (from 10.11) |
| Auto-archive orphans on cold create in CP | Partial — archive on recreate only; full GC optional follow-up |
| Agent tool surface: chat used `memory_read` not `mempalace_search` | Soft — guest CLI + ready prove MemPalace; tool naming residual |

## Secret hygiene

- No tokens, passwords, SM payloads, or `.env.mocklab-agent-dev` contents in this pack.
- Rotate response secret values never committed.
