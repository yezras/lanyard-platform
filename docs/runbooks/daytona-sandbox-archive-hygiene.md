# Runbook: Daytona unused-sandbox archive hygiene (30 GiB cap)

**Bead:** `lp-oop.37.7` · **Parent:** `lp-oop.37`  
**Audience:** operators / agents on MockLab or a future tenant sharing the Daytona org

## Why

The managed Daytona org has a **30 GiB disk cap**. Stopped sandboxes still count
until they are **archived**. A normal idle-reaper stop **retains** the Control
Plane `sandbox_id` so the next wake is `start_from_stopped` — that bound box
must **not** be archived.

What fills the cap:

| Source | What is left | Counts against disk? |
|--------|----------------|----------------------|
| Idle reaper stop (`lp-0y3` / `lp-kng.8`) | Bound sandbox, state `stopped` | Yes — **keep** this id |
| Recreate after relay never-connect | Previous sandbox stop + best-effort archive | Yes if archive 409s |
| One-off / leftover unbound boxes | No CP `sandbox_id` | Yes — **archive** |

On 2026-08-18 a cold MockLab create returned `400 Total disk limit exceeded`.
An operator archived eight unused boxes as a one-off. This runbook is the
recurring, keep-set-safe replacement.

Orchestrator already best-effort archives on recreate
(`waitRelayConnectedOrRecreate`). Live Daytona often returns **409**
archive-from-wrong-state (sandbox still stopping). Treat 409 as skip-and-retry,
not a hard job failure.

## Do not

- Do **not** `terraform apply`.
- Do **not** run `--apply` without a keep-set from the CP instance registry.
- Do **not** archive the bound MockLab (or future tenant) `sandbox_id`.
- Do **not** print `DAYTONA_API_KEY`, CP service tokens, or Authorization headers.
- Do **not** use the old `deploy/daytona/archive-orphan-sandboxes.py` apply-everything path. It now wraps the safe script and is dry-run by default.

## Script

Canonical: [`deploy/scripts/archive-unused-daytona-sandboxes.py`](../../deploy/scripts/archive-unused-daytona-sandboxes.py)

Offline smoke: `bash deploy/scripts/smoke-archive-unused-daytona-sandboxes.sh`

Selection (normative):

1. List org sandboxes (`GET /sandbox`, paginated).
2. Load keep-set = every non-null `sandbox_id` on active CP gateway instances
   (plus any `--keep-id` / file).
3. **Keep** keep-set ids in any state (including `stopped` after idle).
4. **Skip** `archived` / `archiving` / `destroying` / `destroyed`.
5. **Skip** `creating` / `starting` / `restoring` (in flight).
6. **Skip** unbound `started` unless `--include-started-unbound`.
7. **Archive** remaining unbound boxes (`stopped`, `error`, …).
8. Default is **dry-run**. `--apply` mutates. `--apply` without a keep-set
   exits 2 unless `--allow-empty-keep-set`.

`--apply` stop+archive: if archive returns **409**, stop again, wait, retry
once, then skip. 404 = already gone.

## Recurring operator path

Dry-run first (no mutate):

```bash
export AWS_PROFILE=lanyard-main
# Optional if you already exported them; otherwise the script reads SM
# lanyard/staging/portal/daytona (names only — never echo values).

# 1) Dump CP keep-set (service token from the operator secret store; do not log it).
# GET {CONTROL_PLANE_URL}/tenants/{tenant_id}/gateway-instances
# Save the JSON to a 0600 file. Extracted field is sandbox_id only.

python3 deploy/scripts/archive-unused-daytona-sandboxes.py \
  --cp-instances-json /tmp/cp-gateway-instances.json

# or pass ids directly (repeat --keep-id for every bound box):
python3 deploy/scripts/archive-unused-daytona-sandboxes.py \
  --keep-id "$BOUND_SANDBOX_ID"
```

Live CP pull (token in env, never in argv logs):

```bash
export CONTROL_PLANE_URL="http://127.0.0.1:3100"   # SSM tunnel / internal ALB
export CONTROL_PLANE_SERVICE_TOKEN="…"             # or INTERNAL_OPS_TOKEN
python3 deploy/scripts/archive-unused-daytona-sandboxes.py \
  --tenant-id "$MOCKLAB_TENANT_ID"
```

Apply only after the dry-run plan shows `keep <bound-id> reason=bound_instance`
and `would_archive` only on unused ids:

```bash
python3 deploy/scripts/archive-unused-daytona-sandboxes.py \
  --cp-instances-json /tmp/cp-gateway-instances.json \
  --apply
```

Cadence: after snapshot bumps, after failed wakes, or when `headroom_GiB` on
the dry-run plan is under ~6 GiB (two 3 GiB MockLab boxes). A weekly dry-run
is enough while MockLab is the only tenant; add each new tenant `--tenant-id`
to the keep-set load.

Cron / systemd timer is operator-owned. Always leave the job in dry-run until
the keep-set source is wired; never default a timer to `--apply` without
`--tenant-id` or a registry dump.

## After a normal idle stop

The bound box is **stopped**, not archived. Dry-run must list it under `keep`.
A later cold create (new `sandbox_id`, or first wake with a null binding)
must not see `Total disk limit exceeded`. If it does, re-run the dry-run:
leftover unbound stopped boxes are the usual cause.

## Live proof

| Check | Status |
|-------|--------|
| Offline selection keeps bound id, targets unbound | **Done** (`--self-test` + smoke) |
| Dry-run default / `--apply` refuses empty keep-set | **Done** |
| Live org list + archive unused + MockLab cold create after idle stop | **Pending** — this pass does not call live Daytona or archive real boxes |

Re-prove live (operator): dry-run → confirm keep-set → `--apply` unused only →
idle-stop the bound MockLab box (or wait for the reaper) → `ensure_online`
must not return Daytona disk-limit 400.

## Related

- Snapshot bump leftover note: [agent-snapshot-bump-runbook.md](../plans/0008-daytona-agent-sandboxes/agent-snapshot-bump-runbook.md) § Daytona org disk limit
- Idle stop retains `sandbox_id`: [idle-reaper.md](../plans/0008-daytona-agent-sandboxes/idle-reaper.md), [warm-pool-snapshot-wake.md](../plans/0008-daytona-agent-sandboxes/warm-pool-snapshot-wake.md)
- Recreate archive: `portal/packages/control-plane/src/instance-orchestrator.ts` (`waitRelayConnectedOrRecreate`)
- Prior one-off recovery: `lp-zuh.11.7` (`artifacts/mocklab/live-qa/lp-zuh.11.7/EVIDENCE.md`)
