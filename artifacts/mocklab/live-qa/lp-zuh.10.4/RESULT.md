# lp-zuh.10.4 — Cron live fire proof + durable jobs.json on vault

**Bead:** `lp-zuh.10.4`  
**Parent epic:** `lp-zuh.10` (kitchen-sink residuals; depends on `lp-zuh.9.4` vault mount GO)  
**When (UTC):** 2026-08-14T17:09Z–17:16Z  
**Tenant:** MockLab (`319d3808-e533-44db-bfdf-7b6ef8caaae1`)  
**Instance:** `452b1348-772a-49d0-8038-a410eda8accf`  
**Sandbox:** `32d6e20f-3c8e-4141-b20e-a11c514f5ba2`  
**Snapshot:** `lanyard-la-main-508b0b736ad5-mounts3-zuh…` / `41e87f4d-…`  
**Verdict:** **PASS** (with residual: LA Mountpoint rename ENOSYS fix must ship in next agent-gateway pin)

## Acceptance

| # | Criterion | Result |
|---|-----------|--------|
| 1 | After `lp-zuh.9`, `cron.state_dir` on vault; jobs survive sandbox stop/recreate | **PASS** — `cron.state_dir: /mnt/vault`; `jobs.json` at `/mnt/vault/cron/jobs.json`; survives Daytona **stop → start**; external S3 object durable |
| 2 | At least one scheduled fire (or manual run-job) delivers GPU capacity brief | **PASS** — guest ticker claim + agent fire; `last_status=ok`; brief in vault `cron/output/…md` |
| 3 | Evidence RESULT.md | **PASS** — this file + companion pack under `artifacts/daytona-pilot/lp-zuh.10.4-cron/` |

## Residual closed vs `lp-zuh.7.4`

| Surface | `lp-zuh.7.4` | `lp-zuh.10.4` |
|---------|--------------|--------------|
| Create | PASS (hybrid `BACKEND_HOME`) | PASS on **vault** store |
| `jobs.json` path | `/var/lib/company-brain-backend/cron/jobs.json` | **`/mnt/vault/cron/jobs.json`** |
| `cron.state_dir` | `null` / hybrid | **`/mnt/vault`** (kitchen-sink after zuh.9) |
| Fire | Not forced | **Live fire GO** (`fired=1`, status ok) |
| Durability | Platform rematerialize only (residual) | **Vault + S3** jobs + output survive stop/start |

## Live proof sequence (no secrets)

1. **Precondition:** MockLab sandbox online with mountpoint-s3 at `/mnt/vault` (`lp-zuh.9.4` snapshot).
2. **Config:** kitchen-sink `config.yaml` already has:
   ```yaml
   cron:
     enabled: true
     state_dir: /mnt/vault
   ```
3. **Blocker found:** LA `FileCronStore` uses write-tmp + **`rename`**. Mountpoint-S3 returns **`ENOSYS`** for rename → create failed on stock image.
4. **Fix applied (LA source + live patched gateway for proof):**
   - On `ENOSYS` / `EXDEV` / `EPERM` from rename → **overwrite** canonical `jobs.json` (and ticker heartbeat / agent fire output writers).
   - Source: `lanyard-agent` `packages/cron/src/store.ts`, `packages/cron/src/tick.ts`, `apps/gateway/src/cron-agent-runner.ts`.
   - Live: restarted gateway from writable tree with patched `store.js` (image `/opt` not writable as brain).
5. **Create:** job `09b7330db248` — *GPU capacity brief lp-zuh.10.4-…* — daily `0 9 * * *`, deliver `local`.
6. **Fire:** marked `next_run_at` past; guest ticker claimed + agent runner (`poolside/laguna-s-2.1`);  
   log: `cron_tick fired=1`; job `last_status=ok` at `2026-08-14T17:14:47.327Z`.
7. **Brief:** `/mnt/vault/cron/output/09b7330db248/20260814T171330Z.md` (also S3).
8. **Survival:** Daytona **stop → start** same sandbox; remount shows same `jobs.json` + output; S3 objects unchanged.  
   `$BACKEND_HOME/cron/` remains **empty** (no hybrid jobs store).

## Job inventory (redacted)

```json
{
  "id": "09b7330db248",
  "name": "GPU capacity brief lp-zuh.10.4-20260814170905",
  "enabled": true,
  "state": "scheduled",
  "schedule": "0 9 * * *",
  "deliver": "local",
  "last_status": "ok",
  "last_run_at": "2026-08-14T17:14:47.327Z",
  "path": "/mnt/vault/cron/jobs.json"
}
```

## Brief proof (excerpt)

See [cron-fire-output.md](./cron-fire-output.md). Status **ok**; body includes marker `lp-zuh.10.4-gpu-cron-capacity` and H100/B200 + rack kW + cooling sections.

## Artifact index

| Path | Purpose |
|------|---------|
| [RESULT.md](./RESULT.md) | This verdict |
| [jobs.json](./jobs.json) | Vault product store snapshot after fire |
| [cron-fire-output.md](./cron-fire-output.md) | Agent fire markdown (local deliver) |
| [../../daytona-pilot/lp-zuh.10.4-cron/](../../daytona-pilot/lp-zuh.10.4-cron/) | Guest stop/start + S3 proof notes |

## Product residual (not blocking this PASS)

| Item | Status | Notes |
|------|--------|-------|
| Ship ENOSYS rename fallback in **agent-gateway snapshot** | **Required residual** | Live proof used patched store; stock image still ENOSYS without pin |
| Platform SoT rematerialize still writes `$BACKEND_HOME/cron/jobs.json` | Orthogonal | V1 fire evaluator path (`lp-jzl.10.1`) remains platform SoT; vault product store is guest durable path for kitchen-sink |
| Portal Settings create path on vault without LA pin | Blocked until snapshot | API/NL create will hit same rename until LA ships |

## How to re-verify (ops)

```bash
# Guest
grep -A2 'cron:' /var/lib/company-brain-backend/config.yaml
# expect state_dir: /mnt/vault
test -f /mnt/vault/cron/jobs.json && python3 -c 'import json;print(len(json.load(open("/mnt/vault/cron/jobs.json"))["jobs"]))'

# External
aws s3 ls s3://lanyard-mocklab-vault-123456789012/tenants/<tenant>/vault/cron/
```

## Secret hygiene

- No tokens, passwords, AWS keys, or Relay secrets in this pack.
- Job prompt is synthetic lab content (GPU capacity theme).
