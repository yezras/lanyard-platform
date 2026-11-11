# 0012 — Scheduled tasks (Portal offline UX + operational fire)

**Umbrella epic:** `lp-jzl`  
**Offline UX epic:** `lp-jzl.9`  
**Operational fire epic:** `lp-jzl.10`

## Split

| Track | Epic | Ships |
| --- | --- | --- |
| **Offline UX** | `lp-jzl.9` | Vocabulary, human schedule codec, Settings list/form, chat create wizard, skill picker, chat labels. No live Daytona fire required. |
| **Operational fire** | `lp-jzl.10` | Platform schedule evaluator, ensure_online wake, mid_turn run, idle stop, durable registry, live MockLab/staging proof. |

## Normative decisions

| Doc | Bead | Status |
| --- | --- | --- |
| [decision-vocabulary-human-schedule-wizard.md](./decision-vocabulary-human-schedule-wizard.md) | `lp-jzl.9.3` | Proposed — human gate |
| [durable-job-registry.md](./durable-job-registry.md) | `lp-jzl.10.1` | **Locked** — platform SoT + rematerialize on `ensure_online` (not vault-only; not guest `jobs.json` alone) |

## Related architecture (existing)

- [`docs/architecture/lanyard-agent-cron-portal.md`](../../architecture/lanyard-agent-cron-portal.md) — LA cron store, Brain RPC snapshot/patch, inventory refresh
- [`docs/architecture/portal-settings-brain-rpc.md`](../../architecture/portal-settings-brain-rpc.md) — Settings via Brain RPC
- [`contracts/backend-runtime-v1/examples/lanyard-agent.cron.jobs.json`](../../../contracts/backend-runtime-v1/examples/lanyard-agent.cron.jobs.json) — product job store shape
- Daytona presence / ensure_online: [`docs/plans/0008-daytona-agent-sandboxes/presence-state-machine.md`](../0008-daytona-agent-sandboxes/presence-state-machine.md)

## Downstream implementation beads (blocked on decision)

| Bead | Work |
| --- | --- |
| `lp-jzl.2` | Human schedule ↔ cron codec (pure TS) |
| `lp-jzl.3` | Brain RPC create/update for full job |
| `lp-jzl.4` | Settings list rename Crons → Scheduled tasks |
| `lp-jzl.5` | Settings New scheduled task form |
| `lp-jzl.9.1` | Chat interactive create wizard |
| `lp-jzl.9.2` | Skill attachment from vault / snapshot skills |
| `lp-jzl.6` | Chat tool labels — scheduled task language |
| `lp-jzl.10.1` | Durable job registry survives sandbox stop ([durable-job-registry.md](./durable-job-registry.md)) |
| `lp-jzl.7` | Ops fire path: `fireScheduledTask` — ensure_online → mid_turn → run → clear; real harness integration test |
| `lp-jzl.10.2` | Platform schedule evaluator + fire trigger (reads platform SoT; not guest ticker) — `schedule-evaluator.ts` |
| `lp-jzl.8` | Live MockLab/staging one-fire proof — evidence pack [artifacts/daytona-pilot/scheduled-task-fire/](../../../artifacts/daytona-pilot/scheduled-task-fire/EVIDENCE.md) (offline PASS; live residual under OPERATOR HOLD) |

## Operational fire path (platform, not guest ticker)

```text
Platform schedule evaluator (always-on CP / worker)
  → scan durable registry for due jobs (next_run_at / once run_at; fake clock OK)
  → fireScheduledTask(instance_id, job_id)
       → ensure_online (wake stopped/offline sandbox)
       → mid_turn arm → agent run-job → mid_turn clear
       → last_run_at / last_status on durable row
  → advance next_run_at (so re-scan does not re-fire)
  → idle reaper stops after grace

Guest in-guest ticker is NOT required while sandbox is stopped.
```

| Module | Role |
| --- | --- |
| `portal/packages/control-plane/src/scheduled-job-registry.ts` | Platform SoT + rematerialize on wake (`lp-jzl.10.1`) |
| `portal/packages/control-plane/src/scheduled-task-fire.ts` | Wake + mid_turn + run (`lp-jzl.7`) |
| `portal/packages/control-plane/src/schedule-evaluator.ts` | Due scan + fire trigger (`lp-jzl.10.2`) |

Opt-in background loop: `SCHEDULE_EVALUATOR_ENABLED=true` (+ optional `SCHEDULE_EVALUATOR_INTERVAL_MS`).
