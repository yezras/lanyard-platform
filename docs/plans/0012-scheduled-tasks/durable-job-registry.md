# Durable scheduled job registry (Daytona stop/re-wake)

**Bead:** `lp-jzl.10.1`  
**Epic:** `lp-jzl.10` (Scheduled tasks operational fire)  
**Depends on:** `lp-jzl.3` (Brain RPC cron.create / cron.update)  
**Unblocks:** `lp-jzl.10.2` (platform schedule evaluator + fire trigger)  
**Related:** [overview.md](./overview.md), [lanyard-agent-cron-portal.md](../../architecture/lanyard-agent-cron-portal.md), [gateway-env-contract.md](../0008-daytona-agent-sandboxes/gateway-env-contract.md)

## Problem

Lanyard Agent product jobs live at:

```text
$BACKEND_HOME/cron/jobs.json
```

On **Daytona**, `BACKEND_HOME` is **ephemeral sandbox disk**. After idle stop
(or cold recreate), that tree is not a durable SoT:

| What survives stop/retain | What does not |
| --- | --- |
| Permanent `instance_id` | Guest `$BACKEND_HOME/**` |
| `s3_vault_prefix` / vault content | In-guest cron ticker state alone |
| CP presence + secret material | Jobs written only to sandbox disk |

Offline create (`lp-jzl.3` / chat wizard) is insufficient for operational fire
if the fire path and guest re-wake cannot recover the full job list.

## Decision (locked for V1 ops fire)

**Platform source of truth + rematerialize on `ensure_online`.**

| Option | Verdict | Why |
| --- | --- | --- |
| **A. Platform SoT (CP registry) + inject/rematerialize on wake** | **Chosen** | Fire evaluator (`lp-jzl.10.2`) must see schedules **without** guest online. Same document is rematerialized into guest `cron/jobs.json` so Brain RPC / agent ticker match after stop+retain or cold create. |
| B. Vault-backed jobs under `VAULT_ROOT` only | Rejected for V1 fire | Vault is tenant **content** plane (`VAULT_ROOT` / Mountpoint). Jobs are runtime schedule definitions; platform evaluator should not depend on Mountpoint I/O or guest being mounted. Mixing runtime registry into vault conflicts with gateway-env “do not put BACKEND_HOME runtime into vault” guidance for secrets/logs (jobs would also couple fire to vault availability). |
| C. Guest `jobs.json` only | Rejected | Lost on ephemeral disk; cannot drive platform wake-on-fire. |

### Normative rules

1. **Platform SoT** is keyed by permanent **`instance_id`** (never `sandbox_id`).
2. Document shape matches product store:
   [`lanyard-agent.cron.jobs.json`](../../../contracts/backend-runtime-v1/examples/lanyard-agent.cron.jobs.json)
   (`{ jobs: [...], updated_at }`).
3. On every successful Daytona wake (after sandbox **Started**, after Relay wait when wired), the orchestrator **rematerializes** the platform document into guest:

   ```text
   $BACKEND_HOME/cron/jobs.json
   ```

   Cold create **and** `start_from_stopped` both rematerialize so the guest list is complete even if ephemeral disk was wiped or the job was registered while offline.
4. Fire path and guest list must observe the **same** definitions after:
   - stop + retain + re-wake
   - cold create (binding lost / recreate)
5. Do **not** log job `prompt` bodies (tenant content). Metrics/logs: job counts and ids only when needed.
6. EC2 always-on path: host disk may still hold `jobs.json`; platform SoT remains authoritative for multi-runtime fire and dual-write targets.

### Sequence (wake)

```text
ensure_online(instance_id)
  → presence offline|error → waking
  → start_from_stopped | cold_create | …
  → sandbox Started
  → (optional) wait Relay connected
  → rematerialize: platform registry[instance_id] → guest $BACKEND_HOME/cron/jobs.json
  → presence online
```

Stop does **not** clear the platform registry. Guest wipe of `BACKEND_HOME` is expected; re-wake rewrites jobs.json from SoT.

## Implementation (this bead)

| Piece | Location |
| --- | --- |
| Registry + materializer ports | `portal/packages/control-plane/src/scheduled-job-registry.ts` |
| In-memory registry / guest FS | `createInMemoryScheduledJobRegistry`, `createInMemoryGuestCronMaterializer` |
| Optional durable file on CP volume | `SCHEDULED_JOB_REGISTRY_PATH` → `createFileScheduledJobRegistry` |
| Orchestrator hook | `InstanceOrchestratorDeps.scheduledJobRegistry` + `guestCronMaterializer`; rematerialize in `runWake` after Started |
| Fake stop → re-wake proof | `portal/packages/control-plane/test/durable-job-registry.test.ts` |

### Ports (summary)

```text
ScheduledJobRegistry
  getDocument / list / putDocument / putJob / deleteJob / deleteInstance

GuestCronMaterializer
  materialize({ instanceId, sandboxId, document }) → guest cron/jobs.json
  readGuest(sandboxId)          # tests
  wipeEphemeral(sandboxId)      # simulate BACKEND_HOME loss
```

Live Daytona guest FS write adapter is a thin follow-on on the materializer port; offline fake is sufficient for acceptance.

## Out of scope (sibling beads)

| Bead | Work |
| --- | --- |
| `lp-jzl.10.2` | Platform schedule evaluator + fire trigger (reads **this** SoT) |
| `lp-jzl.7` | ensure_online → mid_turn run → idle stop fire orchestration |
| Dual-write from Brain RPC create/update | Portal/BFF should `putJob` into platform registry when create succeeds on Daytona path (follow-on once fire path wires registry into CP server) |

Until dual-write ships, ops/tests seed the platform registry explicitly; rematerialize still proves stop/re-wake completeness.

## Short-stack exception (`lp-oop.38.8`)

On `ChatDelivery=harness` the guest is tool-only: there is no in-guest ticker and no `GATEWAY_RELAY_SECRET` on create env. Jobs are durable as S3 vault object `{s3_vault_prefix}cron/jobs.json` (CP is the S3 caller). Settings create (BFF) and chat `scheduled_task` create (harness runner, `lp-oop.38.16`) write that object. Fire is `fireScheduledTaskHarnessTurn` (harness HTTP turn with `tenant_id` / `user_id` / `instance_id`). Guest rematerialize remains the relay/guest-gateway path only.

**Residual:** live `SCHEDULE_EVALUATOR_ENABLED` ticker is not rolled this wave; call the fire function from tests/ops. Do not put a ticker on Daytona.

## Acceptance

- [x] Decision documented (this file + overview link).
- [x] Durable path implemented (platform SoT + rematerialize on ensure_online).
- [x] Fake test: seed jobs → ensure_online → stop → wipe ephemeral guest → re-wake → guest job list still complete.

## Evidence

```bash
cd portal/packages/control-plane && pnpm test test/durable-job-registry.test.ts
```
