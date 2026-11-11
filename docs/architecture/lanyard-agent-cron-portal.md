# Lanyard Agent cron + Portal Settings (Brain RPC)

**Bead:** `lp-uxy.3` / `lp-su0`  
**Related:** `lp-86d.8`, `lp-uxy.4`  
**Contract:** [`contracts/backend-runtime-v1/`](../../contracts/backend-runtime-v1/)  
**Gaps checklist:** [`lanyard-agent-conformance-gaps.md`](lanyard-agent-conformance-gaps.md) (LA-FS-06, LA-RPC-09, LA-EXP-06)

## Goal

Cron/jobs created for **Lanyard Agent** live under the LA runtime home/state
(`$BACKEND_HOME/cron/jobs.json`), are visible via Brain RPC
`settings.snapshot` (`crons[]`), and can be enabled/disabled from Portal
Settings without writing Hermes install paths (`~/.hermes`).

**lp-su0 (Settings + start-job UI path):** Portal shows Settings → Crons for LA
even when `jobs.json` is empty (product source `lanyard_agent` +
`settings.patch` enable path). Chat `cronjob` tool completions refresh
inventory. Running jobs surface a Status indicator when the host includes
`state` (e.g. `running`). Chat activity labels distinguish start/manage vs
list.

## Contract layout

```text
$BACKEND_HOME/                    # e.g. /var/lib/lanyard-agent
  cron/
    jobs.json                     # durable job registry (product + RPC)
    output/{job_id}/              # run artifacts (product)
```

Rules:

1. **Never** store LA product cron under Hermes install home (`~/.hermes`,
   Hermes artifact unpack prefix). `HERMES_HOME` for pure LA pins is optional;
   if set for dual tooling it **must equal** `BACKEND_HOME`.
2. Product cron store `stateDir` (CLI `/cron`, agent `cronjob` tool, ticker)
   **must resolve to the same root** as `$BACKEND_HOME` so Brain RPC
   `settings.snapshot` / `settings.patch` (`cron.set_enabled`) see the same
   `jobs.json` the scheduler mutates.
3. Prefer explicit `cron.state_dir = $BACKEND_HOME` (or omit and default the
   product path to `BACKEND_HOME`) — do **not** default to
   `dirname(session.sqlite_path)` if that would place jobs under
   `$BACKEND_HOME/sessions/cron/…` while snapshot reads `$BACKEND_HOME/cron/…`.
4. **Daytona durability (`lp-jzl.10.1`):** guest `$BACKEND_HOME` is ephemeral.
   Platform Control Plane holds the **source of truth** for job definitions
   (keyed by permanent `instance_id`) and **rematerializes**
   `$BACKEND_HOME/cron/jobs.json` on every successful `ensure_online` wake
   (stop+retain and cold create). See
   [`durable-job-registry.md`](../plans/0012-scheduled-tasks/durable-job-registry.md).
   Vault-only job storage was rejected for V1 **platform** ops fire — schedule
   evaluation must not require guest online.
5. **Kitchen-sink guest product store on vault (`lp-zuh.9` / `lp-zuh.10.4`):**
   MockLab seeds `cron.state_dir: /mnt/vault` so agent create/ticker share
   `/mnt/vault/cron/jobs.json` (S3 durable across stop/start). Writers must
   tolerate Mountpoint **no-rename** (`ENOSYS` on `rename`) via overwrite
   fallback — see live proof
   [`artifacts/mocklab/live-qa/lp-zuh.10.4/RESULT.md`](../../artifacts/mocklab/live-qa/lp-zuh.10.4/RESULT.md).
5b. **Kitchen-sink workflow run state on vault (`lp-zuh.10.5`):** MockLab seeds
   `workflow.state_dir: /mnt/vault` so admitted runs land at
   `/mnt/vault/wf_{id}/` (program/args/state/journal — S3 durable). Explicit
   `workflow.state_dir` **is** the workflowsDir (not a parent of `/workflows`).
   Atomic JSON admit must use the same Mountpoint **no-rename** overwrite
   fallback as cron (`packages/workflow` `atomicWriteJson`; LA PR #241). Live
   proof:
   [`artifacts/mocklab/live-qa/lp-zuh.10.5/RESULT.md`](../../artifacts/mocklab/live-qa/lp-zuh.10.5/RESULT.md).
6. **Platform schedule evaluator (`lp-jzl.10.2`):** due jobs are scanned on CP
   (or always-on worker) via `evaluateDueScheduledJobs` /
   `createScheduleEvaluatorJob` — **not** the in-guest ticker while the
   sandbox is stopped. On fire: `fireScheduledTask` → `ensure_online` →
   mid_turn run → clear; idle reaper stops after grace.

Normative path catalog: [`filesystem-layout.md`](../../contracts/backend-runtime-v1/filesystem-layout.md).

## Brain RPC + capabilities honesty

| Surface | When real | Capability claim |
| --- | --- | --- |
| `settings.snapshot` include=`crons` | Jobs under `$BACKEND_HOME/cron/jobs.json` | `settings_snapshot` / method present |
| `settings.patch` op=`cron.set_enabled` | Mutates same `jobs.json` | `settings_patch` / method present |
| `cron.list` / `cron.patch` | Dedicated expansion RPCs | `features.cron=true`, `cron_manager=supported` |

**Honest baseline** (example
[`capabilities.lanyard-agent.json`](../../contracts/backend-runtime-v1/examples/capabilities.lanyard-agent.json)):

- `features.cron=false`, `ui_affordances.cron_manager=unsupported` until
  dedicated `cron.list` / `cron.patch` are implemented and advertised.
- Portal may still **list** crons when snapshot returns non-empty `crons[]`,
  and **toggle** when `settings.patch` is advertised (`cronPatchIsAdvertised`
  treats `settings_patch` as sufficient for `cron.set_enabled`).

**Aspirational pin** when dedicated cron RPCs ship:
[`capabilities.lanyard-agent.cron.json`](../../contracts/backend-runtime-v1/examples/capabilities.lanyard-agent.cron.json).

## Portal path

```text
GET  /api/settings/snapshot     → settings.snapshot
POST /api/settings/crons        → settings.patch { op: cron.create, … }   (lp-jzl.3)
PATCH /api/settings/crons/:id   → settings.patch { op: cron.set_enabled | cron.update, … }
```

Full job create/update (name, prompt, schedule, enabled) is gated on
`features.cron` or dedicated `cron.patch` / `cron.create` / `cron.update`
methods — **not** on `settings_patch` alone (honest LA baseline can toggle
enable without shipping create).

No Portal or BFF direct open of `$BACKEND_HOME/cron/jobs.json` in production.
Capability-hidden UI (grill Q10):

| Condition | Settings → Crons |
| --- | --- |
| Snapshot has `crons[]` rows | Show table |
| `features.cron` / `cron_manager` / `cron.*` methods | Show (empty OK) |
| Source `lanyard_agent` (or Hermes product) + empty `crons[]` + `settings.patch` | Show empty state (lp-su0) |
| Generic/fixture source + empty + `cron_manager` unsupported | **Hide** (Q10) |
| Patch advertised | Interactive enable toggles |
| Host row includes `state` (e.g. `running`) | Status column badge (lp-su0) |


### Chat interactive create wizard (lp-jzl.9.1)

When the user asks in chat to create a scheduled task, Portal (or the agent)
walks an MCQ / structured `portal_event` wizard — **not** free-text cron:

1. Optional intent confirm (`st-intent-*`)
2. What it should do — templates or free text (`st-instructions_*`)
3. Days presets / custom (`st-days*`)
4. Time presets / custom (`st-time*`) — 12h labels; store 24h in HumanSchedule
5. Timezone confirm (`st-tz*`) — default browser IANA when known
6. Confirm (`st-confirm*`) → create

Selections wire as `message_type: "mcq_selection"` / `portal_inbound: "mcq_selection"`.
Create uses `POST /api/settings/crons` with structured schedule from
`encodeHumanSchedule` (or agent `cronjob` / `cron_create` tool). Settings inventory
refreshes so the new **scheduled task** appears without reload.

Pure module: `portal/packages/web/src/features/chat/scheduledTaskChatWizard.ts`.
Proof story: `?story=scheduled-task-chat-wizard`.

### Start-job UI path (chat)

1. User asks agent to create/run a scheduled task.
2. LA exposes `cronjob` tool when gateway `cronEnabled` (product config).
3. Portal maps tool activity (lp-jzl.6 D1 — user chrome uses **scheduled task** language; wire ids stay cron/job):
   - `cronjob` / manage family → **Managing scheduled tasks**
   - `cron_create` / `schedule_job` / create family → **Scheduling a task**
   - `start_job` / `run_job` / `cron_run` → **Starting task**
   - list/check family → **Checking schedule**
4. On tool complete, `isInventoryMutatingToolName("cronjob")` triggers Settings
   inventory refresh (lp-a8u.7) so new jobs appear without full page reload.
5. When host snapshot includes `state: "running"`, Settings **Scheduled tasks** shows Status
   **Running**.

Mocklab QA (`lp-86d.8`): enable product cron (`config.cron.enabled`), seed
`$BACKEND_HOME/cron/jobs.json` (or create via chat), open Settings → Scheduled tasks,
assert list and/or running indicator. Artifacts: `artifacts/ui/lp-86d/jobs/`.

## Fixtures / evidence (monorepo)

| Artifact | Role |
| --- | --- |
| [`lanyard-agent.cron.jobs.json`](../../contracts/backend-runtime-v1/examples/lanyard-agent.cron.jobs.json) | Product store shape under LA home |
| [`brain-rpc.settings-snapshot.lanyard-agent.result.json`](../../contracts/backend-runtime-v1/examples/brain-rpc.settings-snapshot.lanyard-agent.result.json) | Redacted snapshot with LA `backend_home` + crons |
| [`capabilities.lanyard-agent.json`](../../contracts/backend-runtime-v1/examples/capabilities.lanyard-agent.json) | Honest baseline (`cron:false`) |
| [`capabilities.lanyard-agent.cron.json`](../../contracts/backend-runtime-v1/examples/capabilities.lanyard-agent.cron.json) | Pin when dedicated cron RPCs claimed |
| `createLanyardAgentFakeBackendRuntimeService` | Portal offline pin (`@lanyard/backend-runtime`) |
| `portal/packages/backend-runtime/test/lanyard-agent-cron.test.ts` | Acceptance fixture tests |

## External product residual

Closing live mocklab against a published LA pin still requires product work in
[LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent)
(ADR 0002 — source stays external):

1. **LA-FS-06** — Product cron `stateDir` aligns with `$BACKEND_HOME/cron/jobs.json`.
2. **LA-RPC-09** — Live `settings.snapshot` crons from that path (no secrets).
3. **LA-EXP-03 / settings.patch** — `cron.set_enabled` writes the same store.
4. **LA-EXP-06** — Optional `cron.list` / `cron.patch` before advertising
   `features.cron=true`.

Platform residual for live mocklab (`lp-86d.8`): enable gateway cron + seed or
NL-create a job; UI path is implemented under `lp-su0`. External product still
owns stateDir alignment and optional `cron.list` / `cron.patch` advertising.

## NL job creation + Settings refresh (`lp-uxy.4`)

Portal does **not** ship a Settings “Create cron” form. Create is the
agent-tool path; Settings is list + enable/disable only.

### Supported path

```text
User chat NL
  → agent tool (Hermes/LA: `cronjob` action=create|add|update|delete;
                aliases: cron_create, schedule_job, create_job, …)
  → durable write $BACKEND_HOME/cron/jobs.json   (never ~/.hermes for LA)
  → chat tool_progress complete (tool_name recognized as inventory mutator)
  → SettingsSnapshotProvider.scheduleInventoryRefresh (debounced, lp-a8u.7)
  → GET /api/settings/snapshot → settings.snapshot.crons[]
  → Settings → Crons shows the new job without full page reload
```

Also refreshes when the Settings tab regains focus (`SettingsView isActive`).

### Tool names Portal recognizes as cron mutators

| Emission | Portal treatment |
| --- | --- |
| `cronjob` (Hermes primary; LA product) | Mutator; skip refresh when `metadata.action` is list/get/check/view |
| `cron_create`, `create_cron`, `cron_add`, `schedule_job`, `create_job`, … | Mutator |
| `cron_list`, `list_cron`, `list_jobs` | Non-mutator (no refresh) |
| `metadata.inventory_mutated: true` on any tool | Mutator (host override) |

Implementation: `isInventoryMutatingToolName` /
`isInventoryMutatingToolEvent` in
`portal/packages/web/src/features/settings/SettingsSnapshotContext.tsx`.

### Failure modes when `features.cron` is false

| State | Portal surface |
| --- | --- |
| `features.cron=false`, `cron_manager=unsupported`, **no** snapshot crons | Crons nav **hidden** (Q10) |
| Same caps but snapshot has crons + `settings.patch` | Crons list + toggles; intro + capability notice (create still agent-only) |
| Product / agent create disabled | Host tool fails; fake pin: `createCronJobFromAgent` → `not_implemented` with clear message |

Settings create form is unblocked when Brain RPC exposes full create
(`settings.patch` op `cron.create` / `cron.update`, lp-jzl.3) and capabilities
advertise `features.cron` (or dedicated cron methods). UI form ships under
`lp-jzl.5`.

### Offline evidence

| Artifact | Role |
| --- | --- |
| `createCronJobFromAgent` on `FakeBackendRuntimeService` | Durable NL create under LA home |
| `portal/packages/backend-runtime/test/lanyard-agent-cron.test.ts` | Create + snapshot + failure mode |
| `SettingsSnapshotContext` inventory tests | `cronjob` → debounced refresh → new job in shared snapshot |
| Settings Crons intro + capability notice | Operator-facing create path + honest caps |
| `?story=nl-cron-create-settings` | Auth-free UI proof (fetch mock; no live LA/mocklab) |
| `?story=nl-cron-create-settings&mode=capability-off` | Capability honesty notice + intro with seeded job |

Live product-pin mocklab (when LA advertises `features.cron` + agent `cronjob`) remains `lp-86d.8`. Platform UI QA for this bead is the story path above.

## Non-goals

- Migrating Hermes-Lanyard cron implementation into this monorepo.
- Writing LA product source into `lanyard-platform` (external only).
- Settings Create form without a real Brain RPC create op.
