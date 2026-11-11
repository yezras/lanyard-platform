# Portal chat tool events → Astryx ChatToolCalls

**Bead:** `lp-dpr.3` (phase 2: route all agent tool events into ChatToolCalls lifecycle)  
**Epic:** `lp-dpr` — chat activity plane  
**Consumers:** `@lanyard/web` `useChatEvents` / `ChatTimeline`  
**Producers:** Hermes-Lanyard, Lanyard Agent, optional mock gateway  
**Related:** [`portal-host-artifact-event-emission.md`](./portal-host-artifact-event-emission.md), [`portal/artifacts/hermes-lanyard-tool-citations-contract.md`](../../portal/artifacts/hermes-lanyard-tool-citations-contract.md)

---

## Purpose

Every backend tool call that reaches Portal chat must render as durable
Astryx `@astryxdesign/core` **ChatToolCalls** rows with a full status
lifecycle:

| Status | Meaning |
| --- | --- |
| `pending` | Queued / not started |
| `running` | In flight |
| `complete` | Succeeded |
| `error` | Failed / cancelled / timed out |

Live SSE and durable history hydrate **share one reducer**
(`applyChatEvent` / `historyEventsToTimelineItems`) so reload and live
stream cannot diverge.

---

## Wire path

```text
Host outbound (relay WS)
  metadata.portal_event = "tool_progress" (+ richer fields)
  OR Hermes chrome fallback (emoji tool lines)
  OR content prefix "🔧 tool: …"
        │
        ▼
relay ChatDeliveryHub.detectToolProgress / outboundActionToChatEvent
  → SSE type: tool_progress
        │
        ▼
BFF /api/chat/threads/:id/events  (+ durable history tee)
        │
        ▼
useChatEvents.applyChatEvent
  mapToolCallFields → assistant_turn.segments / toolCalls
        │
        ▼
ChatTimeline.groupSegmentsForRender → <ChatToolCalls />
```

Implementation pointers:

| Layer | Path |
| --- | --- |
| Relay detect + status aliases | `portal/packages/relay/src/chat-delivery-hub.ts` |
| Web pure mapper | `portal/packages/web/src/features/chat/chatToolCallMapper.ts` |
| Timeline grouping / context collapse | `portal/packages/web/src/features/chat/chatTimelineGrouping.ts` |
| SSE + history hydrate | `portal/packages/web/src/hooks/useChatEvents.ts` |

---

## Preferred host shape (structured)

On each tool phase (`send` / `edit` outbound):

```json
{
  "op": "send",
  "chat_id": "<thread_id>",
  "content": "optional chrome / short label",
  "metadata": {
    "portal_event": "tool_progress",
    "tool_name": "read_file",
    "tool_call_id": "stable-id",
    "tool_status": "running",
    "tool_target": "/Projects/notes.md",
    "duration": "1.2s",
    "result": "optional expandable body",
    "node": "optional sandbox badge",
    "additions": 2,
    "deletions": 1,
    "error_message": "only when tool_status is error"
  }
}
```

### Accepted status aliases

Hosts may send aliases; Portal normalizes before render:

| Canonical | Also accepted |
| --- | --- |
| `pending` | `queued`, `waiting`, `scheduled`, `idle` |
| `running` | `in_progress`, `in-progress`, `started`, `active`, `executing`, `working` |
| `complete` | `completed`, `done`, `success`, `succeeded`, `ok`, `finished` |
| `error` | `failed`, `failure`, `cancelled`, `canceled`, `timeout`, `timed_out`, `aborted` |

Also read from `metadata.status` / `state` / `phase` when `tool_status` is omitted.

### Accepted portal_event aliases (non-Hermes)

Prefer **`tool_progress`**. Portal also treats these as tool lifecycle rows:

- `subagent` (subagent task row)
- `tool`, `tool_call`, `agent_tool`
- `tool.*` namespace except `tool.approval` (reserved for approval UI)

---

## Timeline grouping

- Consecutive tool segments share **one** `ChatToolCalls` list (order preserved).
- A reasoning segment **breaks** the group so mid-turn CoT stays interleaved.
- When **≥ 3 consecutive context-gathering** tools (read/search/list/grep/…),
  the group uses summary label **`Context gathering (N)`** and collapses by
  default once complete (stays expanded while any call is pending/running).

---

## Web search / Firecrawl structured results (lp-uxy.7)

Hosts that run web search or Firecrawl should emit **structured hits** so Portal
shows title + snippet cards instead of bare URL dumps:

| Field | Where | Notes |
| --- | --- | --- |
| `tool_name` | metadata | `web_search`, `firecrawl_search`, `firecrawl_scrape`, `x_search`, … |
| `result` | metadata / top-level | JSON `{ results: [{ url, title, snippet, published_at?, content_summary?, provider? }] }` or a single scrape object |
| `metadata.search_results` | optional | Same array shape if not inlined in `result` |
| Final `citations[]` | message_send | `{ path: "https://…", title, snippet? }` — opens external URL |

Portal classifiers and card UI live in
`portal/packages/web/src/features/chat/webCitations.ts` + `WebSearchResults.tsx`.
Normative product doc: [`portal-web-search-firecrawl.md`](./portal-web-search-firecrawl.md).
**Cost gate:** no live paid Firecrawl without `FIRECRAWL_API_KEY`.

---

## Document parse / AnyDoc (`lp-uxy.10`)

Office and PDF → Markdown is a **host tool** (`parse_document` / alias
`extract_document_text`), not BFF-side conversion of customer uploads.

| Field | Notes |
| --- | --- |
| `tool_name` | `parse_document` (or documented alias) |
| `tool_target` | Vault or `/staging/uploads/…` absolute path |
| `tool_status` | Dual-emit `running` → `complete` / `error` (same lifecycle as all tools) |
| `result` | Truncated Markdown body for expandable tool row / model context |
| Portal label | Prefer host `tool_label`; monorepo maps to **Parsing a document** (**F4 shipped**) |

Local primary converter: Firecrawl **AnyDoc** (MIT, host CPU, $0 SaaS). Scanned
PDF OCR via hosted Firecrawl Parse is **F5 cost-gated** on host
`FIRECRAWL_API_KEY` only. Soft-open / document pane remains human preview — not
model ingest. Portal never parses customer document bytes on the BFF.

HOW + blast radius (F0): [`portal-parse-document-anydoc.md`](./portal-parse-document-anydoc.md).  
Ship order (F1): [`portal-parse-document-f1-throughput-checkpoint.md`](./portal-parse-document-f1-throughput-checkpoint.md).  
Args / result contract (F2): [`portal-parse-document-f2-tool-contract.md`](./portal-parse-document-f2-tool-contract.md).  
Portal labels (F4): [`portal-parse-document-f4-portal-labels.md`](./portal-parse-document-f4-portal-labels.md).  
Evidence: [`artifacts/ui/lp-uxy.10/`](../../artifacts/ui/lp-uxy.10/).

---

## Self-improve filter honesty

Defense-in-depth denylist (web) mirrors Hermes
`should_emit_portal_tool_progress` for the self-improve skill family on
`skill_view` / `skill_manage` / `skills_list`. Hosts **should not emit**
those rows; if they do, Portal hides them rather than inventing fake
progress. Non-family skills (`architect`, path-qualified non-self-improve)
remain visible.

---

## Residual host dual-emit requirements

Until all hosts emit perfect structured tool rows for every tool phase,
the following dual-emit rules remain **required**:

### 1. File tools + document pane (`lp-5q6.31`)

For agent file work that drives the document pane, hosts **must dual-emit**:

1. `portal_event: "tool_progress"` (timeline / ChatToolCalls) — **first**
2. `portal_event: "artifact.*"` (pane focus / revision) — **after**

Same `tool_call_id` / `tool_target` on both. See
[`portal-host-artifact-event-emission.md`](./portal-host-artifact-event-emission.md).

Artifact-only emission is **not** enough for ChatToolCalls fidelity.

### 2. Structured preferred over chrome

| Host capability | Emit |
| --- | --- |
| Structured metadata available | **Only** `portal_event: tool_progress` (optional short content label) |
| Hermes chrome only (legacy) | Plain emoji tool lines — relay maps lossily; multi-tool bubbles may collapse to last line |
| Both chrome + structured | Prefer **structured only** on the same outbound; do **not** dual-emit chrome + structured for the same call (relay would double-count chrome expansion only when `portal_event` is absent) |

### 3. Durable history

Every `tool_progress` SSE event must be **teed into durable history** with:

- top-level tool fields (`tool_name`, `tool_call_id`, `tool_status`, …)
- raw `metadata` object (for artifact re-parse and result fields)

History hydrate replays the same reducer as live SSE. Omitting tool rows
from history causes reload to lose ChatToolCalls while the live session
had them.

### 4. Non-Hermes / Lanyard Agent

Lanyard Agent (and any future backend) must publish the same
`portal_event: tool_progress` contract over relay outbound. Portal does
**not** require Hermes-specific chrome. Status aliases and portal_event
aliases above exist so Agent can ship without renaming to Hermes enums
first — but the **preferred** vocabulary is the canonical table.

### 5. Subagents (lp-dpr.5)

`portal_event: "subagent"` or `tool_kind: "subagent"` (or `subagent_name`
present) maps as a **first-class SubagentRun**, not a generic ChatToolCalls
row:

| Field | Purpose |
| --- | --- |
| `tool_call_id` / `subagent_id` | Stable run id (upsert key) |
| `subagent_name` | Display name (Explore, Researcher, …) |
| `tool_status` | `running` / `needs_input` / `done` / `failed` (+ aliases) |
| `tool_target` / summary | Short work label on chip + roster |
| optional `subagent_color` / `subagent_icon` | Override identity; otherwise Portal hashes name → color + icon heuristic |

**UI:**

- Inline chip: `Explore · running 0:42` (clickable) → opens activity pane
  focused on that run.
- Activity roster: concurrent/recent subagents with stable color + icon.
- Select roster row → detail (summary / result + nested tool stream when
  host attributes child tools — see §6b / lp-uxy.1).

Implementation: `portal/packages/web/src/features/chat/subagentRun.ts`,
`SubagentRunChip.tsx`, `activityPane/SubagentRoster.tsx`.

### 6. Subagent complete → parent tool (lp-dpr.6)

When the host spawns a subagent via a **parent** ChatToolCalls row
(`Task` / `spawn_*` / `wait_for_*`, or any tool) and links the child with:

```json
{
  "portal_event": "subagent",
  "tool_call_id": "sa-1",
  "tool_status": "complete",
  "duration": "4.1s",
  "metadata": {
    "parent_tool_call_id": "parent-1"
  }
}
```

Portal keeps parent and child consistent:

| Rule | Behavior |
| --- | --- |
| Link | `metadata.parent_tool_call_id` (or `parentToolCallId`) on the child = parent `tool_call_id` |
| Terminal child | `done` / `complete` → parent `complete`; `failed` / `error` → parent `error` |
| Multi-child | Parent flips only when **all** children under that parent id are terminal; any failure → parent `error` |
| Duration / result | Copied onto parent when missing so spawn/wait rows are not stuck `running` without duration |
| Same-id upsert | If parent and child share one `tool_call_id`, the normal tool upsert already updates that row |

Implementation: `applySubagentParentCompletion` in `subagentRun.ts`, applied after
every tool upsert in `useChatEvents.upsertToolInSegments`.

Hosts **should** set `parent_tool_call_id` on subagent lifecycle events when a
distinct spawn/wait tool row exists. Without the link, Portal cannot infer the
parent and the spawn row stays open until turn finalize.

### 6b. Nested tools under a subagent (lp-uxy.1)

When a subagent executes its own tools, dual-emit **child** `tool_progress`
rows attributed to that SubagentRun so Portal can show a live nested stream
in **SubagentDetail** (activity pane).

Preferred shape:

```json
{
  "op": "send",
  "chat_id": "<thread_id>",
  "content": "optional short label",
  "metadata": {
    "portal_event": "tool_progress",
    "tool_call_id": "tc-nested-read-1",
    "tool_name": "read_file",
    "tool_status": "running",
    "tool_target": "/Projects/notes.md",
    "parent_subagent_id": "sa-1"
  }
}
```

| Field | Purpose |
| --- | --- |
| `tool_call_id` | **Stable** upsert key for the child tool (running → complete) |
| `parent_subagent_id` | **Preferred** parent SubagentRun id (= that subagent's `tool_call_id`) |
| `subagent_run_id` | Alias for parent run id on child tools |
| `parent_subagent_run_id` | Alias for parent run id |
| `parent_tool_call_id` | **Not** used for nested stream — that links subagent → spawn/wait parent (lp-dpr.6) |

**Host dual-emit (required for nested identity):**

1. Emit `portal_event: "subagent"` (or `tool_kind: "subagent"`) for the run
   with stable `tool_call_id` (= SubagentRun id).
2. Emit each nested tool as normal `portal_event: "tool_progress"` with its
   own stable `tool_call_id` **and** `parent_subagent_id` / `subagent_run_id`
   equal to the parent subagent's `tool_call_id`.
3. Lifecycle: `running` then `complete` / `error` on the same child
   `tool_call_id` (same as top-level tools).

**Portal rules:**

| Rule | Behavior |
| --- | --- |
| Nested list | Only tools with matching `parentSubagentId` appear under SubagentDetail |
| Unattributed | Tools without parent subagent attribution are **ignored** in the nested list (may still render on the main ChatToolCalls spine) |
| After finish | Completed nested rows remain visible when the subagent is terminal |
| Empty states | Running + no tools → waiting copy; done + no tools → "no nested tools reported" |

Implementation: `readParentSubagentIdFromEvent` / `mapToolCallFields` in
`chatToolCallMapper.ts`; `collectNestedToolsForSubagent` in `subagentRun.ts`;
`SubagentRoster` NestedToolStream UI. Story: `?story=activity-plane&phase=nested`.

### 6c. Subagent artifacts + final citation harvest (lp-uxy.2)

When subagents produce vault files (or cite web URLs), Portal must keep those
paths openable **after** the orchestrator finishes — from SubagentDetail and
from the final assistant message.

**Host emit (preferred)** on subagent complete (and optionally on incremental
writes):

```json
{
  "op": "send",
  "chat_id": "<thread_id>",
  "content": "optional label",
  "metadata": {
    "portal_event": "subagent",
    "tool_call_id": "sa-1",
    "tool_status": "complete",
    "subagent_name": "coder",
    "artifacts": [
      {
        "vault_path": "/Notes/report.md",
        "title": "report.md",
        "kind": "vault"
      },
      {
        "url": "https://example.com/spec",
        "title": "spec",
        "kind": "web"
      }
    ]
  }
}
```

| Field | Purpose |
| --- | --- |
| `artifacts[]` | Ordered list of produced artifacts (alias: `artifact_list`) |
| `artifacts[].vault_path` / `path` | Vault path (absolute or project-relative) |
| `artifacts[].url` / `href` | Exact http(s) URL for web citations |
| `artifacts[].title` | Display title (optional) |
| `artifacts[].kind` | `vault` \| `web` (inferred from path/url when omitted) |

**Portal rules:**

| Rule | Behavior |
| --- | --- |
| SubagentDetail chips | "Artifacts from this run" — vault chips soft-open the document pane; web chips open externally |
| Host preferred | When `artifacts[]` present, chips use that list first |
| Nested harvest | When host omits `artifacts[]`, harvest vault paths from nested file-tool `tool_target` (+ safe absolute paths in tool result bodies) |
| Final report | On turn finalize, merge subagent artifacts into assistant `citations` (alongside file-tool + web promotions) |
| History | `artifacts` stored on the timeline subagent tool row so reload still shows chips |
| Web vs vault | http(s) URLs never open the vault document pane |

Implementation: `parseSubagentArtifacts` / `resolveSubagentArtifacts` /
`citationsFromSubagentToolCalls` in `subagentRun.ts` + `useChatEvents.ts`;
`SubagentRoster` artifact chips. Story: `?story=activity-plane&phase=artifacts`.

### 7. Workflows (lp-dpr.7)

When the host runs a workflow (composer `$workflow-id` or host-scheduled
graph), emit **workflow progress** so Portal can render a stage list with
expand/collapse and nested subagents.

Preferred shape on each phase (`send` / `edit` outbound):

```json
{
  "op": "send",
  "chat_id": "<thread_id>",
  "content": "optional short label",
  "metadata": {
    "portal_event": "workflow_progress",
    "workflow_id": "wf-onboard-1",
    "workflow_name": "Onboard project",
    "workflow_status": "running",
    "tool_call_id": "wf-onboard-1",
    "tool_kind": "workflow",
    "summary": "Discover → plan → implement",
    "started_at": "2026-07-29T12:00:00.000Z",
    "duration": "12.4s",
    "stages": [
      {
        "id": "discover",
        "name": "Discover",
        "status": "complete",
        "duration": "2.1s",
        "summary": "Scan vault structure",
        "subagent_ids": ["sa-explore-1"],
        "tool_call_ids": ["tc-list-1"]
      },
      {
        "id": "implement",
        "name": "Implement",
        "status": "running",
        "subagent_ids": ["sa-coder-1"]
      },
      {
        "id": "verify",
        "name": "Verify",
        "status": "pending"
      }
    ]
  }
}
```

| Field | Purpose |
| --- | --- |
| `portal_event` | Prefer `workflow_progress`. Also accepted: `workflow`, `workflow.start` / `.update` / `.end` / `.error` |
| `workflow_id` / `tool_call_id` | Stable upsert key for the workflow card |
| `workflow_name` | Display title on card + activity tree |
| `workflow_status` / `tool_status` | `pending` / `running` / `complete` / `error` / `skipped` (+ tool aliases) |
| `stages[]` | **Ordered** stage snapshot (preferred full replace when length &gt; 1) |
| `stages[].subagent_ids` | Nested subagent run ids (must match subagent `tool_call_id`s already emitted) |
| `stages[].tool_call_ids` | Peer tool rows under the stage (optional count label when no subagents) |
| Partial update | Single-stage patch: `stage_id` + `stage_status` (+ optional duration/summary/subagent_ids) merges by id |

**Status aliases** reuse the tool table above; additionally `skipped` /
`skip` / `omitted` map to stage status `skipped`.

**UI:**

- Inline **WorkflowRunCard** in the chat spine: stage list with expand/collapse;
  nested subagent chips under expanded stages; header click opens activity pane.
- Activity pane **workflow tree**: same stages + nested subagents; roster lists
  workflows above subagents when both are present.
- Peer tools remain normal ChatToolCalls rows (or are counted under the stage
  via `tool_call_ids`); they are not re-parented in the tool list for v1.

**Host dual-emit (preferred for nested identity):**

1. Emit `portal_event: "workflow_progress"` with ordered `stages` (this card).
2. Emit normal `portal_event: "subagent"` (or `tool_progress` + `tool_kind`)
   rows for each nested subagent **with the same** `tool_call_id` listed in
   `stages[].subagent_ids`.
3. Optional: emit stage peer tools as `tool_progress` with matching
   `tool_call_id`s in `stages[].tool_call_ids`.

When the host omits `subagent_ids` / `summary` (current MockLab emit), Portal
reduces sibling timeline tools onto the running stage during event replay and
maps `result.agents` / `state.agents` onto stages. Later snapshots must not
wipe that nest. Unresolved helper ids still render name + status. Portal does
not invent helpers when no nested work ran.

Portal does **not** invent workflow runners. Composer `$` only inserts a
pass-through token; the host must emit progress. Relay maps
`workflow_progress` onto SSE `type: tool_progress` with `tool_kind: workflow`
and retains full `metadata` (including `stages`) for durable history.

Implementation: `portal/packages/web/src/features/chat/workflowRun.ts`,
`WorkflowRunCard.tsx`, `activityPane/WorkflowTree.tsx`; relay
`detectToolProgress` accepts workflow portal_event aliases.

---

## Out of scope (this phase)

- Building a new design-system tool component (extend Astryx ChatToolCalls).
- Hermes multi-host fleet.
- Playwright / browser proof (`lp-dpr.8` / UI QA).
- Re-parenting peer tools under stages inside the ChatToolCalls list (stage
  nesting is visual on the workflow card only).

---

## Verification

```bash
pnpm --filter @lanyard/web test -- src/features/chat/workflowRun.test.ts src/features/chat/WorkflowRunCard.test.tsx src/features/chat/chatToolCallMapper.test.ts src/features/chat/ChatTimeline.test.tsx src/hooks/useChatEvents.test.ts
pnpm --filter @lanyard/relay test -- test/chat-delivery-hub.test.ts
```

Manual: with Hermes exclusive gateway, run a skill that uses multiple
read tools + one write; confirm ChatToolCalls lifecycle, context-gathering
collapse after three reads, and durable tools after hard reload. For
workflows: host-emit `workflow_progress` with stages + nested subagent ids;
confirm inline card expand/collapse and activity pane tree.
