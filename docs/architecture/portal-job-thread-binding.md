# Portal job↔thread binding (lp-fn5.5.1 + lp-fn5.5.3)

**Status:** implemented (E1 binding + E3 fire append)  
**Epic:** lp-fn5.5 Scheduled Tasks folder + durable job chat streams  
**Related:** [portal-agent-llm-name.md](./portal-agent-llm-name.md), sub-epic E2 (folder)

## Goal

Each scheduled job has **one durable agent chat stream** per portal owner. The
stream title tracks the job name while `title_source=job`. Fires append turns to
that thread — never allocate a new chat per run (E3).

## Domain fields

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `chat` \| `scheduled_task` | Product kind; default `chat` |
| `scheduled_job_id` | `string \| null` | Job id binding; null for interactive chats |
| `agent_id` | `string \| null` | Durable agent this job runs as (lp-cxhb.11). Product creates require it. |
| `title` | string | Display name (= job name when job-owned) |
| `title_source` | `default` \| `llm` \| `user` \| `job` | `job` means stream title follows job renames |

Normative rules:

1. **One stream per (tenant, user, job_id)** — partial unique index in SQLite.
2. Interactive creates stay `kind=chat`, `scheduled_job_id=null`.
3. LLM assign-name never overwrites `title_source=user|job` (existing C4 policy).
4. Explicit user rename of a stream sets `title_source=user` and stops job-name sync.
5. Product **+ New scheduled task** binds **one** catalog `agent_id`. Fire appends to this stream and never to a channel.

## `ensureAgentChatForJob`

Store method: `ChatThreadStore.ensureForJob({ tenant_id, user_id, job_id, name, agent_id? })`.

```
if existing stream for (tenant, user, job_id):
  if unbound and agent_id provided → bind agent_id (never replace an existing bind)
  if title_source == job and name differs → update title
  return { thread, created: false }
else:
  create kind=scheduled_task, title_source=job, title=name,
         scheduled_job_id=job_id, agent_id=agent_id
  return { thread, created: true }
```

Unknown `agent_id` is rejected. Inventory/fire re-ensure may omit it when the stream already exists.

### HTTP: `POST /api/chat/threads/ensure-for-job`

**Auth:** session + CSRF; RBAC member (same as create thread).

**Request:**

```json
{
  "job_id": "cron-abc",
  "name": "Daily digest",
  "agent_id": "agent-legal"
}
```

**Response** (201 first ensure, 200 subsequent):

```json
{
  "thread_id": "…",
  "title": "Daily digest",
  "project_id": null,
  "project_vault_path": null,
  "created_at": "…",
  "avatar_seed": "…",
  "title_source": "job",
  "kind": "scheduled_task",
  "scheduled_job_id": "cron-abc",
  "agent_id": "agent-legal",
  "created": true
}
```

### Create flags (alternative)

`POST /api/chat/threads` accepts optional:

```json
{
  "title": "Daily digest",
  "kind": "scheduled_task",
  "scheduled_job_id": "cron-abc",
  "title_source": "job",
  "agent_id": "agent-legal"
}
```

When `scheduled_job_id` is present, the handler **routes through `ensureForJob`**
so create flags cannot double-allocate streams.

## Job rename

`ChatThreadStore.syncJobTitle({ tenant_id, job_id, name, user_id? })` updates
bound streams where `title_source=job` only.

Wired on successful `PATCH /api/settings/crons/:cronId` when the patch result
includes a cron `id` + `name`.

## Job create

Successful `POST /api/settings/crons` best-effort ensures a stream and may
include `thread_id` / `thread` on the response for clients that want to select
the stream immediately. Clients can always call ensure-for-job themselves.

## Client helper

```ts
import { ensureAgentChatForJob } from "../api/chat";

const stream = await ensureAgentChatForJob({
  jobId: cron.id,
  name: cron.name,
});
// stream.thread_id, stream.created, stream.kind === "scheduled_task"
```

`normalizeChatThreadSummary` backfills `kind=chat` and `scheduled_job_id=null`
for legacy list rows; infers `scheduled_task` when only `scheduled_job_id` is set.

## Fire path append (lp-fn5.5.3)

Platform `fireScheduledTask` (lp-jzl.10) accepts optional stream hooks:

| Hook | Role |
| --- | --- |
| `ensureJobStream` | Resolve binding **before** agent run; result `thread_id` is passed into `runJob` |
| `appendJobStreamTurn` | After run: append user (job prompt) + optional assistant (`result_text` / error) |

```text
fireScheduledTask(instance_id, job_id)
  → ensure_online
  → ensureJobStream(job) → thread_id   // same id every fire
  → mid_turn arm
  → runJob({ …, thread_id })           // deliver-inbound chat_id = thread_id
  → appendJobStreamTurn(thread_id, …)
  → mid_turn clear
```

### Deliver mode `portal_thread`

Job field `deliver: "portal_thread"` means production AgentJobRunner should
call Relay `deliver-inbound` with `source.chat_id =` the bound stream id so
agent outbound SSE/history lands on that chat. Constant:
`PORTAL_THREAD_DELIVER` in CP + BFF.

BFF helpers:

| Helper | Package path |
| --- | --- |
| `ensureJobStreamChat` / `appendJobStreamFireTurn` | `portal/packages/bff/src/scheduled-task-job-stream.ts` |
| `deliverScheduledTaskFireToJobStream` | ensure → history user turn → deliver-inbound |
| `createJobStreamFireHooks` | Wire into `fireScheduledTask` deps |

Acceptance: **two fires of the same job → two turns on the same `thread_id`**.

## Related siblings

| Bead | Work |
| --- | --- |
| lp-fn5.5.2 | Perpetual Scheduled Tasks folder in sidenav (group by kind/job) — **implemented** below |
| lp-fn5.5.3 | Fire/delivery always appends to bound `thread_id` — **implemented** above |

## Agents sidenav — Scheduled Tasks folder (lp-fn5.5.2)

Synthetic group injected by `groupThreadsByProject` in
`portal/packages/web/src/features/projects/threadGroups.ts`.

| Property | Value |
| --- | --- |
| Key | `__scheduled_tasks__` |
| Label | `Scheduled Tasks` |
| Folder icon | `CalendarIcon` (same as Tools → Scheduled tasks) |
| Vault project? | **No** — `kind: "scheduled_tasks"`, `projectId: null`, no delete/archive menu |
| Children | Threads with `kind=scheduled_task` or non-null `scheduled_job_id` |
| Child row icon | **None** (no dither / share glyph); calendar only on the folder |
| Always present | Yes, even with zero job streams |

### Sort / placement policy

Documented in code and enforced by unit tests:

1. **Folder order (sidenav top → bottom)**
   1. **Scheduled Tasks** (always first)
   2. Vault Directory **projects** (host list order)
   3. **General** (unscoped interactive chats, when applicable)
   4. **Orphan projects** (threads whose `project_id` is not in Directory)
2. **Within Scheduled Tasks:** case-insensitive title (job name) ascending,
   then `created_at` ascending, then `thread_id` for stability.
3. Job streams never appear under vault projects or General, even if a row
   incorrectly carries a `project_id`.
4. Clicking the Scheduled Tasks folder does **not** change new-chat project
   scope (`selectedProjectId`).

## Evidence

```bash
cd portal/packages/bff && pnpm test test/ensure-agent-chat-for-job.test.ts
cd portal/packages/bff && pnpm test test/scheduled-task-job-stream.test.ts
cd portal/packages/control-plane && pnpm test test/scheduled-task-fire.integration.test.ts
cd portal/packages/web && pnpm test \
  src/api/threadMeta.test.ts \
  src/features/projects/threadGroups.test.ts \
  src/features/projects/ChatHistorySideNav.test.tsx \
  src/features/projects/AgentSideNavRow.test.tsx
```
