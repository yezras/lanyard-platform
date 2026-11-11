# lp-jzl.8 — Scheduled-task operational fire: evidence pack

**Bead:** `lp-jzl.8`  
**Parent epic:** `lp-jzl.10` (Scheduled tasks operational fire)  
**Depends on (closed):** `lp-jzl.7`, `lp-jzl.10.1`, `lp-jzl.10.2`, `lp-jzl.5`, `lp-jzl.6`  
**Plan:** [docs/plans/0012-scheduled-tasks/overview.md](../../../docs/plans/0012-scheduled-tasks/overview.md)  
**Hold:** [deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md](../../../deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md)

## Verdict (this pack)

| Path | Status | Evidence |
| --- | --- | --- |
| **Offline fire path** (real-harness + vitest) | **PASS** | [RESULT.md](./RESULT.md) — regenerate via [smoke-offline.sh](./smoke-offline.sh); re-run 2026-08-10 **24/24** |
| **Live create + list** (localhost pilot) | **PASS** | [RESULT-live-create.md](./RESULT-live-create.md) — Settings form + chat `cronjob action=setup` wizard; inventory lists both |
| **Live MockLab / platform one-fire** (ensure_online wake) | **BLOCKED residual** | OPERATOR HOLD + local pilot CP has no Daytona/evaluator/agent job-runner wire; no invented live wake success |

No `terraform apply`, no ECS re-enable, no spend to force a staging fire while the hold is active.

---

## 1. Offline proof (done here)

### What is proven without live compute

```text
Platform schedule evaluator (real-harness + fake clock)
  → due job in durable platform registry
  → fireScheduledTask(instance_id, job_id)
       → ensure_online (cold create or start-from-stopped)
       → mid_turn arm → agent job runner → mid_turn clear
       → last_run_at / last_status on durable row
  → advance next_run_at
  → idle reaper stops after grace; job definition still in registry
  → re-wake rematerializes guest $BACKEND_HOME/cron/jobs.json
```

Guest-only ticker is **not** required while the sandbox is stopped.

### Commands

From monorepo root (after portal deps):

```bash
# One-shot offline smoke (writes RESULT.md next to this file)
bash artifacts/daytona-pilot/scheduled-task-fire/smoke-offline.sh
```

Or run suites directly:

```bash
cd portal
pnpm install --filter @lanyard/control-plane...
cd packages/control-plane
pnpm exec vitest run \
  test/durable-job-registry.test.ts \
  test/scheduled-task-fire.integration.test.ts \
  test/schedule-evaluator.test.ts
```

### Suites → acceptance mapping

| File | Bead | Cases (expected green) |
| --- | --- | --- |
| `portal/packages/control-plane/test/durable-job-registry.test.ts` | `lp-jzl.10.1` | put/list/serialize; file-backed reload; rematerialize on wake; **stop → wipe ephemeral → re-wake → full job list**; cold create rematerialize |
| `portal/packages/control-plane/test/scheduled-task-fire.integration.test.ts` | `lp-jzl.7` | fire wakes offline sandbox + mid_turn during run + reaper stop + **job survives stop**; warm start-from-stopped (not create); mid_turn cleared on agent error; refuse missing/disabled without wake |
| `portal/packages/control-plane/test/schedule-evaluator.test.ts` | `lp-jzl.10.2` | due rules (cron/once/disabled/running); **offline instance gets ensure_online on fire**; skip disabled without wake; platform SoT scan (not guest ticker); `runOnce` / env defaults |

**Expected offline result:** 3 files, **24** tests, all pass (see RESULT.md for a captured run).

### Implementation anchors (no secrets)

| Module | Role |
| --- | --- |
| `portal/packages/control-plane/src/scheduled-job-registry.ts` | Platform SoT + rematerialize on `ensure_online` |
| `portal/packages/control-plane/src/scheduled-task-fire.ts` | `fireScheduledTask` — wake + mid_turn + run |
| `portal/packages/control-plane/src/schedule-evaluator.ts` | Due scan + fire trigger; opt-in `SCHEDULE_EVALUATOR_ENABLED` |
| `portal/packages/control-plane/src/instance-orchestrator.ts` | Rematerialize hook after sandbox Started |
| `portal/packages/control-plane/src/fake-daytona-client.ts` | Offline Daytona stand-in |

### Create path inventory (offline UX; not live-proven here)

Bead description asks: create in UI, create in chat, list both. Offline create/list landed under `lp-jzl.9` track:

| Surface | Bead | Notes |
| --- | --- | --- |
| Settings → New scheduled task form | `lp-jzl.5` | Human schedule builder; no cron strings in UI copy |
| Chat interactive create wizard | `lp-jzl.9.1` | MCQ / structured steps |
| Chat skill attachment | `lp-jzl.9.2` | Snapshot / vault skills |
| Settings list rename | `lp-jzl.4` | “Scheduled tasks” copy |
| Chat tool activity labels | `lp-jzl.6` | Scheduled-task language |
| Brain RPC create/update | `lp-jzl.3` | Full job rows into product store / registry dual-write path |

Live “create in UI + create in chat + list both” on **localhost pilot** is **§1b** (PASS).  
Platform **one-fire** (wake sandbox → run → idle stop) remains **§2 residual**.

### 1b. Live create + list (localhost pilot) — 2026-08-10

**Stack:** Portal web `:3010` (`portal-main-qa` / main), BFF, Relay, LA gateway `:9100` (post LA #233 + platform #355), LiteLLM `:4001`.  
**Not Daytona:** agent runs as host process; Brain RPC `settings.patch` / product `cron/jobs.json` under `~/.lanyard-agent`.

| Step | Result |
| --- | --- |
| Settings → Scheduled tasks → **New scheduled task** | Form create works after LA `features.cron` + `cron.create` advertised |
| Chat: natural language → agent calls **`cronjob` `action=setup`** | Portal opens MCQ wizard (no hard-coded NL intercept) |
| Complete wizard → create | Job appears under Settings list |
| List both | UI-created + chat-created (and prior pilot jobs) visible in inventory / `jobs.json` |

Details: [RESULT-live-create.md](./RESULT-live-create.md).

---

## 2. Live MockLab / staging runbook (when stack is up)

**Do not execute** while [OPERATOR HOLD](../../../deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md) forbids re-enabling fixed staging network/compute, or without human-approved thrifty lab spend.

### Preconditions (all required)

1. Hold lifted **or** explicit human-approved lab path that is **not** a full platform-staging re-apply.
2. Public Relay WSS healthy for Daytona guest dial (see residual `lp-kng.3` / Relay DNS runbook).
3. Control plane running with:
   - Daytona enabled + ready config
   - Scheduled job registry wired (in-memory only is **not** enough across CP restarts — use file/Postgres SoT when available)
   - `SCHEDULE_EVALUATOR_ENABLED=true` (and optional `SCHEDULE_EVALUATOR_INTERVAL_MS`) **or** operator can call `ScheduleEvaluatorJob.runOnce` / force-fire path
4. MockLab (or lab) tenant with `runtime_kind=daytona`, permanent `instance_id`, vault prefix, agent snapshot pin.
5. Portal UI reachable against that tenant (Settings + Chat).

### Steps

```text
A. Create in Settings UI
   Settings → Scheduled tasks → New
   → name, instructions, days/time/tz, optional skills
   → save
   → list shows the new task (enabled)

B. Create in Chat
   User asks to schedule a second task (or wizard)
   → complete MCQ / confirm
   → Settings inventory refresh shows BOTH tasks (A + B)

C. Force fire or wait
   Prefer force/runOnce against job A (or wait until next_run_at):
   → platform evaluator selects due job
   → fireScheduledTask → ensure_online(I)
   → presence online; sandbox_id set; guest jobs.json rematerialized
   → agent run-job for instructions (+ skills)
   → last_run_at / last_status updated on durable row
   → mid_turn clear
   → after idle grace, reaper stops sandbox (binding retained by default)

D. Record evidence (no secrets)
   - timestamps (UTC)
   - instance_id (ok), never log secrets / full prompts if tenant content
   - presence transitions: offline|error → waking → online → offline
   - job ids present before stop and after re-wake
   - screenshots optional under artifacts/ui/ if UI proof needed
   - paste redacted CP logs: fire, ensure_online path (cold vs warm), reaper stop
```

### Pass criteria (live)

| Check | Pass |
| --- | --- |
| List shows UI-created and chat-created jobs | Both present, enabled |
| Fire wakes offline/stopped sandbox | ensure_online success; presence online |
| Job ran | last_status ok (or documented agent error with mid_turn cleared) |
| Idle stop | presence offline after grace; platform registry still has jobs |
| Re-wake list complete | ensure_online rematerializes guest jobs.json |

### Force-fire notes

- Evaluator loop is **opt-in** (`SCHEDULE_EVALUATOR_ENABLED`). Default off avoids surprise spend.
- For a single proof, prefer `runOnce` / internal force with a **one-shot** schedule (`kind: once`, `run_at` near now) over a long-running 1-minute cron.
- Do **not** leave thrifty sandboxes online; confirm idle reaper after the proof.

---

## 3. Residual / blocked path (honest)

| Item | Status | Why |
| --- | --- | --- |
| Live create UI + chat + list | **PASS (localhost)** | §1b / RESULT-live-create.md |
| Live platform one-fire (ensure_online → run → reaper stop) | **Blocked residual** | (1) OPERATOR HOLD on full platform-staging re-enable; (2) current localhost pilot CP process has no `DAYTONA_*` / `SCHEDULE_EVALUATOR_ENABLED` / production `AgentJobRunner` wire observed in env |
| terraform apply / ECS desired-count | **Forbidden** without human lift of hold | See OPERATOR-HOLD-LOCALHOST-ONLY.md |
| Invented “Daytona live fire PASS” | **Not claimed** | No live wake/run evidence in this bead |
| Offline ops path | **Green** | 24/24 vitest via smoke-offline.sh (re-run 2026-08-10) |

### Unblock checklist (human) — platform one-fire

1. Written approval to lift hold (scope: lab-only vs full staging) **or** thrifty Daytona-enabled localhost CP (not full staging re-apply).
2. Relay public WSS healthy if guests must dial public Relay.
3. CP with: Daytona enabled, scheduled job registry (file SoT), `SCHEDULE_EVALUATOR_ENABLED` or `runOnce` force-fire, production `AgentJobRunner` (Relay deliver-inbound / Brain run-job).
4. Re-run §2; attach `RESULT-live-fire.md` + redacted logs under this directory or `artifacts/ui/lp-jzl.8/`.
5. Close residual note on bead / parent epic.

---

## 4. Artifact index

| Path | Purpose |
| --- | --- |
| [EVIDENCE.md](./EVIDENCE.md) | This pack (offline + live create + live runbook + residual) |
| [smoke-offline.sh](./smoke-offline.sh) | CI-safe offline smoke |
| [RESULT.md](./RESULT.md) | Last offline smoke output (PASS/FAIL) |
| [RESULT-live-create.md](./RESULT-live-create.md) | Localhost create UI + chat wizard + list (PASS) |

Related plan docs:

- [overview.md](../../../docs/plans/0012-scheduled-tasks/overview.md)
- [durable-job-registry.md](../../../docs/plans/0012-scheduled-tasks/durable-job-registry.md)
