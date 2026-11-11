# Decision: Scheduled tasks vocabulary, human schedule model, chat wizard shape

**Bead:** `lp-jzl.9.3`  
**Epic:** `lp-jzl.9` — Scheduled tasks offline UX (Settings + chat wizard, no live fire)  
**Umbrella:** `lp-jzl`  
**Status:** Proposed (needs human product approval before production copy/RPC ship)  
**Date:** 2026-08-09  
**Needs human:** true — product vocabulary and UX shape gate offline implementation beads  
**Supersedes:** closed alias `lp-jzl.1` (same scope; re-homed under `lp-jzl.9.*`)

## Context

Portal Settings already lists backend **cron** jobs from Brain RPC
`settings.snapshot.crons[]` and toggles enable via `settings.patch`
(`cron.set_enabled`). Product store is `$BACKEND_HOME/cron/jobs.json` for
Lanyard Agent (never `~/.hermes`). Create today is agent-tool-only
(`cronjob`); there is no Settings create form and no human-facing schedule
builder.

Users should think in **scheduled tasks** (what to do, which days, what
time), not cron expressions. Backend products and Brain RPC keep **cron**
as the durable technical term and wire field names for compatibility.

This decision locks:

1. Product vocabulary (UI vs API/backend)
2. Human schedule field model and codec boundary
3. Chat interactive create wizard (MCQ / structured steps)
4. Execution lifecycle notes (ops track implements fire; offline track does not)

**Non-goals of this doc / offline epic:** live Daytona fire, platform
scheduler implementation, MockLab live proof (`lp-jzl.10` / `lp-jzl.7` /
`lp-jzl.8`).

### Linked sources

| Source | Role |
| --- | --- |
| [`lanyard-agent-cron-portal.md`](../../architecture/lanyard-agent-cron-portal.md) | LA store path, snapshot/patch, inventory refresh, current “Crons” Settings path |
| [`portal-settings-brain-rpc.md`](../../architecture/portal-settings-brain-rpc.md) | Settings BFF → Brain RPC |
| [`lanyard-agent.cron.jobs.json`](../../../contracts/backend-runtime-v1/examples/lanyard-agent.cron.jobs.json) | Job row shape (`schedule.kind`, `expr`, `display`, `prompt`) |
| [`brain-rpc.schema.json`](../../../contracts/backend-runtime-v1/brain-rpc.schema.json) `$defs/settingsCron` | Redacted cron row (`id`, `name`, `schedule`, `enabled`) |
| Portal MCQ protocol | `portal/README.md` § MCQ bubbles (`portal_event: "mcq"`, inbound `mcq_selection`) |
| Existing humanize helpers | `humanizeCronExpression` / `humanizeSchedule` (display-only; not a full codec) |
| Presence / ensure_online | [`presence-state-machine.md`](../0008-daytona-agent-sandboxes/presence-state-machine.md) for fire lifecycle vocabulary |

---

## Decision

### D1 — Vocabulary (UI vs backend)

| Surface | Preferred term | Forbidden / avoid in user-facing copy |
| --- | --- | --- |
| Portal Settings nav + page title | **Scheduled tasks** | “Crons”, “Cron jobs” as nav labels |
| Single row / entity | **Scheduled task** | “Cron”, “cron job” in table headers, empty states, toasts |
| Create affordance | **New scheduled task** | “Create cron”, “Add cron” |
| Schedule field label | **Schedule** | “Cron expression”, “Cron string” |
| Chat tool activity labels | **Managing scheduled tasks**, **Checking schedule**, **Starting task** (or existing “Starting job” only if product keeps it — prefer **task**) | Raw tool name `cronjob` as the only chrome |
| Chat wizard title / prompts | “scheduled task”, “schedule” | Asking the user to “enter a cron expression” |
| Backend product store | `cron/jobs.json`, job rows | N/A — keep technical paths |
| Brain RPC methods / ops | `settings.snapshot` `crons[]`, `cron.set_enabled`, future `cron.create` / `cron.update` / `cron.patch` | Do not rename wire fields for UI |
| BFF HTTP paths | `/api/settings/crons`, `/api/settings/crons/:id` may remain for compatibility | Paths are not user-facing |
| Capabilities | `features.cron`, `ui_affordances.cron_manager` stay as contract keys | Do not surface these strings in primary UI copy; use capability-honest notices in plain language if needed |
| Dev / story / test ids | Prefer migrating `data-testid` toward `scheduled-tasks-*` when touching UI (`lp-jzl.4`); temporary dual ids OK | Do not leave “Crons” as visible text |

**Rule:** If a string is shown to an end user in Portal (Settings, chat, toasts, empty states, a11y names), use **scheduled task** language. If a string is an API key, filesystem path, RPC op, capability flag, or internal log field, **cron** may remain.

**List column display:** show human schedule (from `schedule.display` / decoded human fields / humanized expression). Never show raw `expr` as the primary Schedule cell. Advanced/debug expanders (operator-only) may show technical detail later; default product UI must not require or display cron syntax.

### D2 — Reject raw cron in Portal UI

1. **Settings create/edit form** (`lp-jzl.5`): no free-text cron field. Users pick days, time, and timezone (see D3).
2. **Chat create wizard** (`lp-jzl.9.1`): no step that asks for a cron string. Schedule is collected via MCQ / structured controls.
3. **Paste / power-user:** out of scope for offline MVP. If ever added, it must be an explicit advanced mode behind a clear warning, fail-closed validation, and still store via the same codec — not a separate write path.
4. **Agent tools** may still accept cron on the host (product `cronjob` tool) for power users and existing skills; Portal must not *require* the user to type cron for the first-class create paths.
5. **Display of existing jobs** that only have `schedule.expr`: Portal may humanize via existing helpers or the new codec decode when possible; if undecodable, show a safe fallback such as “Custom schedule” (not the raw expression as the only label). Prefer host-provided `schedule.display` when present.

### D3 — Human schedule field model

Normative **Portal / codec** input (implementation: pure TS module `lp-jzl.2`, no UI dependency):

```ts
/** Human schedule for recurring weekly-pattern tasks (MVP). */
type HumanSchedule = {
  /** ISO weekday numbers 1=Monday … 7=Sunday (ISO-8601). At least one. */
  daysOfWeek: Array<1 | 2 | 3 | 4 | 5 | 6 | 7>;
  /** Local wall-clock time in the chosen timezone. */
  time: {
    hour: number;   // 0–23
    minute: number; // 0–59
  };
  /**
   * IANA timezone id (e.g. "America/New_York", "UTC").
   * Required on write. Portal defaults to the browser timezone when known;
   * otherwise prompt (Settings form / wizard step).
   */
  timezone: string;
};
```

**MVP recurrence:** weekly pattern only (selected weekdays + one local time). Same clock each selected day.

**Out of MVP (do not invent UI yet):**

| Pattern | Backend may store | Portal offline MVP |
| --- | --- | --- |
| Every N minutes / hourly | Existing jobs / agent tools | Display-only humanize; no builder |
| Monthly / nth weekday / complex cron | Possible via agent | “Custom schedule” display; no builder |
| One-shot `schedule.kind = "once"` | Already in fixture jobs | List/enable only; create via agent or later form |
| Multiple times per day | Not in human model | Reject or defer |

#### Encode → backend cron expression

Target compatibility: standard **5-field** cron as used in product store
`schedule.kind = "cron"` + `schedule.expr` (see LA fixture jobs).

| Human field | Cron field |
| --- | --- |
| `time.minute` | minute |
| `time.hour` | hour |
| (fixed) | day-of-month = `*` |
| (fixed) | month = `*` |
| `daysOfWeek` | day-of-week list |

**Day-of-week mapping (codec must document and test):**

| ISO `daysOfWeek` | Meaning | Cron DOW digit (common 0=Sunday … 6=Saturday) |
| --- | --- | --- |
| 1 | Monday | 1 |
| 2 | Tuesday | 2 |
| 3 | Wednesday | 3 |
| 4 | Thursday | 4 |
| 5 | Friday | 5 |
| 6 | Saturday | 6 |
| 7 | Sunday | 0 |

Examples:

| Human | `expr` | Suggested `display` |
| --- | --- | --- |
| Mon–Fri 09:00 America/New_York | `0 9 * * 1-5` | Weekdays at 9:00 AM (America/New_York) |
| Monday only 09:00 | `0 9 * * 1` | Weekly on Monday at 9:00 AM (…tz…) |
| Sat+Sun 18:30 | `30 18 * * 0,6` | Weekends at 6:30 PM (…tz…) |

**Timezone:**

- Human model always carries IANA `timezone`.
- Backend job rows today often store only `expr` + optional `display` without a first-class TZ field. Codec **encode** must:
  - Produce `expr` in the **local wall clock of `timezone`** (minute/hour as the user selected).
  - Persist timezone on the job when the create/update RPC allows (prefer a durable field such as `schedule.timezone` or top-level `timezone` — exact wire key is `lp-jzl.3` contract work; decision: **do not drop TZ on write**).
  - Set `schedule.display` to a human string that includes timezone when not UTC-only product default.
- **Decode** from legacy rows without TZ: treat missing TZ as host/default timezone for display only; do not invent silent DST-unsafe rewrites of `expr`.
- DST edge cases: fail closed or document “next local occurrence” semantics in codec tests (`lp-jzl.2`); do not expose cron quirks in UI.

**Fail closed:** empty `daysOfWeek`, invalid hour/minute, unknown IANA timezone → codec error; UI blocks submit.

#### Relationship to product store

Create/update (`lp-jzl.3`) writes a job compatible with existing snapshot shape:

```json
{
  "id": "…",
  "name": "Weekly digest",
  "enabled": true,
  "schedule": {
    "kind": "cron",
    "expr": "0 9 * * 1-5",
    "display": "Weekdays at 9:00 AM (America/New_York)",
    "timezone": "America/New_York"
  },
  "prompt": "Agent instructions / what the task should do",
  "skills": ["optional-skill-ids-from-inventory"]
}
```

Notes:

- `prompt` (or equivalent) = agent instructions for the task body.
- `skills` attachment is `lp-jzl.9.2` (from `settings.snapshot` skills / vault inventory). Optional on MVP create.
- `timezone` under `schedule` is the preferred durable home; if host cannot store it yet, Portal still encodes wall-clock into `expr` and puts TZ in `display` until contract expands (honest capability: document gap in create result / notice).

### D4 — Chat interactive create wizard shape

When the user asks in chat to create a scheduled task (NL intent), the
**first-class Portal path** is an interactive multi-step wizard using existing
MCQ / structured `portal_event` patterns — not free-text-only cron strings.

#### Goals

- Non-technical user can finish create without opening Settings.
- Structured answers (`mcq_selection`) drive agent or Brain RPC write with
  HumanSchedule + prompt + name.
- Job appears in Settings inventory after create (existing inventory mutator
  refresh path for tool complete; same for RPC create once wired).

#### Step sketch (normative order)

| Step | `mcq_id` prefix (example) | What user provides | UI shape |
| --- | --- | --- | --- |
| 0. Intent confirm (optional) | `st-confirm-intent` | Confirm they want a **scheduled task** (vs one-shot chat) | MCQ: Yes, create scheduled task / No, cancel |
| 1. What it should do | `st-instructions` | Task title + agent instructions | Prefer structured free-text turn (agent asks; user replies in chat). Optional short MCQ for templates (“Weekly digest”, “Vault index”, “Custom…”) then free text for Custom |
| 2. Days of week | `st-days` | One or more weekdays | MCQ multi-select **if** platform supports multi-select MCQ; otherwise sequential MCQ or a compact “preset” first (Weekdays / Weekends / Every day / Custom days…) then follow-up for Custom |
| 3. Time of day | `st-time` | Local time | MCQ presets (9:00 AM, 12:00 PM, 5:00 PM, …) + “Pick another time…” → agent/structured time capture. Prefer 12h labels in UI; store 24h in HumanSchedule |
| 4. Timezone | `st-tz` | IANA zone | Default = browser TZ with MCQ confirm (“Use America/New_York?” / “Choose another…”). Do not skip silently if browser TZ unknown |
| 5. Skills (optional) | `st-skills` | Skill ids from inventory | `lp-jzl.9.2` — skip step if no skills or none selected |
| 6. Confirm | `st-confirm` | Review card: name, human schedule string, instructions summary, skills | MCQ: Create / Edit schedule / Cancel |
| 7. Create | (tool or RPC) | Write job | Agent calls create tool **or** Portal/host uses Brain RPC create (`lp-jzl.3`). Emit inventory refresh. Success message uses **scheduled task** language + human schedule |

#### Wire conventions (reuse existing MCQ)

**Outbound** (agent → portal), per step:

```json
{
  "op": "send",
  "chat_id": "<thread_id>",
  "content": "Which days should this scheduled task run?",
  "metadata": {
    "portal_event": "mcq",
    "mcq_id": "st-days-<stable-session-id>",
    "choices": [
      { "id": "weekdays", "label": "Weekdays (Mon–Fri)" },
      { "id": "weekends", "label": "Weekends (Sat–Sun)" },
      { "id": "everyday", "label": "Every day" },
      { "id": "custom", "label": "Choose specific days…" }
    ]
  }
}
```

**Inbound** (portal → agent): existing `message_type: "mcq_selection"` +
`metadata.portal_inbound: "mcq_selection"` with `mcq_id`, `choice_id`,
`choice_label`.

Wizard state lives in the **agent turn / skill session** (correlation via
stable `mcq_id` prefixes and thread context). Portal does not need a
separate wizard state machine in Settings for the chat path.

#### Multi-select gap

If MCQ is single-select only today:

1. Prefer **presets** (weekdays / weekends / everyday) for the common path.
2. For custom days, use a short chain of yes/no per day **or** a single free-text day list that the agent parses into `daysOfWeek` with confirmation MCQ (“Mon, Wed, Fri — correct?”).
3. Future: structured `portal_event` for multi-select or a schedule chip control — out of this decision’s mandatory shape; do not block MVP on it.

#### Failure / cancel

- User chooses Cancel → agent acknowledges; no job written.
- Create fails (capability off, host error) → plain-language error; no fake success; Settings unchanged.
- `features.cron` false / create unsupported → wizard must not claim success; prefer early capability-honest message (Settings path still list-only when snapshot has rows).

### D5 — Execution lifecycle (notes only; ops implements)

Offline epic **creates and lists** jobs. **Fire** is `lp-jzl.10` / `lp-jzl.7`.

```text
[Offline UX — lp-jzl.9]
  User (Settings form or chat wizard)
    → HumanSchedule + prompt (+ optional skills)
    → codec encode → cron expr + display + timezone
    → Brain RPC create/update OR agent cronjob tool
    → durable job in registry (jobs.json / platform SoT)
    → Settings list shows Scheduled task + human schedule

[Operational fire — lp-jzl.10 / lp-jzl.7]
  Platform schedule evaluator (not guest-only ticker while sandbox stopped)
    → due job detected
    → ensure_online(instance)     # presence: offline|error → waking → online
    → mid_turn protect
    → run job instructions (agent prompt / skill-bound run)
    → clear mid_turn
    → idle grace → idle_stop → offline
    → last_run_at / last_status updated on job row
```

| Phase | Owner | Offline MVP requirement |
| --- | --- | --- |
| Create / update / list / enable | `lp-jzl.9` | **Required** |
| Human schedule codec | `lp-jzl.2` | **Required** |
| Skill ids on job | `lp-jzl.9.2` | Required for skill step; optional attach |
| Platform evaluator + wake + run | `lp-jzl.10`, `lp-jzl.7` | **Not** required for offline acceptance |
| Live MockLab one-fire proof | `lp-jzl.8` | **Not** required for offline acceptance |

Settings may show last run / status when the host provides `state`,
`last_run_at`, `last_status` (already partially used for “Running”). Offline
UI must not pretend a fire succeeded without host data.

---

## Settings surfaces (implementation mapping)

| Surface | Bead | Copy / behavior |
| --- | --- | --- |
| Nav + section | `lp-jzl.4` | **Scheduled tasks**; remove user-facing “Crons” |
| Table columns | `lp-jzl.4` | Name, Schedule (human), Status, Enabled |
| Empty state | `lp-jzl.4` / `lp-jzl.5` | CTA **New scheduled task** + optional “or ask in chat” |
| Create/edit form | `lp-jzl.5` | Title, instructions, day chips, time, timezone, enable — **no cron text field** |
| Chat labels | `lp-jzl.6` | Scheduled task language on tool chrome |
| Chat wizard | `lp-jzl.9.1` | Steps in D4 |
| RPC create | `lp-jzl.3` | Full job write beyond `set_enabled` |

API path rename is **not** required for MVP; display rename is.

---

## Acceptance checklist (this decision bead)

- [x] Decision doc exists under `docs/plans/0012-scheduled-tasks/`
- [x] Vocabulary table (UI vs backend) — D1
- [x] Human schedule field sketch + encode mapping — D3
- [x] Chat wizard step sketch — D4
- [x] Execution lifecycle notes (ops vs offline) — D5
- [x] Explicit **no user-facing cron** rule — D2
- [x] Overview index for plan folder

---

## Open questions for human gate

1. Confirm ISO weekday numbering (1=Mon … 7=Sun) vs UI Sunday-first calendars (display order may be locale; storage stays ISO).
2. Confirm default create path priority when both Settings form and chat wizard exist: either is valid; product preference for empty-state CTA order.
3. Confirm whether one-shot / “run once” belongs in Settings form later or stays agent-only.
4. Confirm durable TZ field name on job (`schedule.timezone` recommended) for `lp-jzl.3` contract expansion.

Until this decision is **Accepted**, implementation beads may proceed on the
**Proposed** text as the working SoT for offline work, but production copy and
contract expansions should not advertise final product language without human
sign-off on this document.

## Status transitions

| Status | Meaning |
| --- | --- |
| **Proposed** | This revision — implementers may follow for offline beads |
| **Accepted** | Human product approval recorded (date + approver) |
| **Superseded** | Replaced by a later decision doc revision |

---

## Revision history

| Date | Change |
| --- | --- |
| 2026-08-09 | Initial proposal (`lp-jzl.9.3`) |
