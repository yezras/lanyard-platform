# lp-zuh.10.4 — Evidence pack (Daytona guest + S3)

Companion to [../../mocklab/live-qa/lp-zuh.10.4/RESULT.md](../../mocklab/live-qa/lp-zuh.10.4/RESULT.md).

## Mountpoint rename ENOSYS (root cause)

Kitchen-sink after `lp-zuh.9` correctly seeds:

```yaml
cron:
  enabled: true
  state_dir: /mnt/vault
```

Product store resolves to `/mnt/vault/cron/jobs.json`. LA `FileCronStore` historically:

1. write `.jobs_*.tmp`
2. `fsync`
3. `rename(tmp → jobs.json)`

On **Mountpoint-S3**, `rename` returns **`ENOSYS` (errno 38)**. Direct overwrite of `jobs.json` works (also O_EXCL lock create + unlink).

### Fix (Lanyard Agent — must pin into next gateway snapshot)

| File | Change |
|------|--------|
| `packages/cron/src/store.ts` | rename failure → overwrite canonical `jobs.json` when code is `ENOSYS`/`EXDEV`/`EPERM` |
| `packages/cron/src/tick.ts` | same for ticker heartbeat |
| `apps/gateway/src/cron-agent-runner.ts` | same for fire output markdown writer |

Aligns with [vault-io-pilot-decision.md](../../../docs/plans/0008-daytona-agent-sandboxes/vault-io-pilot-decision.md) §3.3 (write-temp + replace / overwrite; no POSIX rename assumption).

## Live fire

| Field | Value |
|-------|--------|
| Job id | `09b7330db248` |
| Name | GPU capacity brief lp-zuh.10.4-… |
| Store | `/mnt/vault/cron/jobs.json` |
| Fire path | Guest cron ticker + `createAgentCronRunner` (Poolside `laguna-s-2.1`) |
| Tick log | `cron_tick fired=1 errorCount=0` |
| `last_status` | `ok` |
| Output | `cron/output/09b7330db248/20260814T171330Z.md` |

## Survival

| Check | Result |
|-------|--------|
| S3 `…/vault/cron/jobs.json` after fire | 1156 bytes, status ok |
| S3 fire markdown | 2299 bytes |
| Daytona stop → start same sandbox | Guest remount lists same job + output |
| `$BACKEND_HOME/cron/jobs.json` | absent (no hybrid) |

## Files in this directory

- `jobs.json` — product store after fire
- `cron-fire-output.md` — brief deliverable
- `guest-after-stop-start.txt` — remount probe notes
- `s3-proof.txt` — external listing summary
