# Sketch: Hermes → Lanyard Portal tools + vault citations

**Status:** design sketch (Hermes-only; no mock gateway)  
**Branch context:** `portal-hq7-ux-polish`  
**Portal consumer:** relay `outboundActionToChatEvent` → BFF SSE → `useChatEvents` → Astryx `ChatToolCalls` / `Citation`  
**Hermes producer:** gateway outbound over relay WS (`OutboundAction` frames)

---

## Goal

Use **only Hermes** as the brain, and still get:

1. **Astryx `ChatToolCalls`** rows (name, target, status, duration, node, +/- stats, expandable `resultDetail` / CodeBlock)
2. **Vault citations** that open the Vault tab when clicked from chat

Mock gateway remains optional for CI/UI demos; it is **not** required for production or local Hermes-only dev.

---

## Current state

### Portal (already implemented)

| Layer | Behavior |
|-------|----------|
| Relay | Maps `metadata.portal_event: "tool_progress"` (+ richer fields) → SSE `tool_progress` |
| Relay | Fallback: pure Hermes emoji tool chrome → `tool_progress` (lossy) |
| Relay | Maps `metadata.citations` / `portal_event: "citation"` on final send → `citations[]` |
| Web | Durable `assistant_turn.toolCalls` → `<ChatToolCalls resultDetail={CodeBlock}/>` |
| Web | `citations` → Markdown `sources` + footer `Citation` chips → Vault deep-link |
| Web | Fallback: file-like `tool_target` → citation chips on finalize |

### Hermes (today)

- Emits tool **display chrome** as plain text (`edit` / `send` content), e.g. `🔍 Searching…`, multi-line accumulate.
- Does **not** systematically set `metadata.portal_event: "tool_progress"` for `lanyard_web`.
- Does **not** attach `metadata.citations` on final answers.
- Config: `display.tool_progress: all` (chrome is on) — good, but chrome alone is incomplete for rich UI.

### Gap

Chrome heuristics are brittle (mixed prose drops tools; multi-line keeps last tool; weak names/targets; rare vault paths). Citations almost never appear without structured metadata.

---

## Architecture

```
Hermes agent turn
  ├─ tool start/update/end  ──► OutboundAction (edit/send)
  │     metadata.portal_event = "tool_progress"
  │     tool_name, tool_call_id, tool_status, tool_target, result, …
  │
  └─ final answer ──────────► OutboundAction (send)
        content = markdown answer (optional [1] markers)
        metadata.citations = [{ path, title }, …]
        metadata.model = "…"   (optional)

Portal relay WebPlatformAdapter
  → ChatDeliveryHub SSE tool_progress / message_send

BFF /api/chat/threads/:id/events
  → EventSource

useChatEvents
  → assistant_turn.toolCalls + citations

ChatTimeline / ChatMessageContent
  → ChatToolCalls + Citation → Vault tab
```

**Session rule:** only Hermes may own the relay `instanceId` (stop mock / use `portal-gateway-mode.sh hermes`).

---

## Wire contract (normative for `lanyard_web`)

All frames are existing relay `outbound` NDJSON:

```json
{
  "type": "outbound",
  "requestId": "<uuid-hex>",
  "action": {
    "op": "send" | "edit",
    "chat_id": "<portal thread_id>",
    "content": "<string, required by portal send handler>",
    "message_id": "<stable id for edit upserts>",
    "metadata": { ... }
  }
}
```

`chat_id` **must** be portal `thread_id` (inbound `source.chat_id`). Wrong id → hub silent drop.

### A. Tool progress

**When:** tool starts, updates, completes, or errors during a turn.

**`metadata` fields** (portal already reads these):

| Field | Required | Notes |
|-------|----------|--------|
| `portal_event` | **yes** | `"tool_progress"` (or `"subagent"` for subagent rows) |
| `tool_call_id` | **yes** | Stable across running→complete for the same invocation |
| `tool_name` | **yes** | e.g. `bash`, `read_file`, `web_search`, `edit` |
| `tool_status` | **yes** | `pending` \| `running` \| `complete` \| `error` |
| `tool_target` | recommended | Path, command, query string |
| `tool_label` | optional | Human label if different from name |
| `duration` / `duration_ms` | on complete | Display string or ms number |
| `result` / `result_detail` / `output` | on complete | Expandable body (diff, stdout) |
| `error_message` / `errorMessage` | on error | Tooltip / error row |
| `additions` / `deletions` | edit tools | Diff stats |
| `node` / `sandbox` | optional | e.g. `cli:remote-server` |
| `tool_kind` / `subagent_name` | subagents | Distinct row naming |
| `parent_subagent_id` | nested tools under a subagent (lp-uxy.1) | Parent SubagentRun id (= that subagent's `tool_call_id`). Aliases: `subagent_run_id`, `parent_subagent_run_id`. Required for activity-pane nested stream. |
| `parent_tool_call_id` | subagent → spawn/wait | Links subagent row to parent Task/spawn tool (lp-dpr.6); **not** the nested-stream field |
| `artifacts` / `artifact_list` | subagent complete (lp-uxy.2) | Array of `{ vault_path\|path\|url, title?, kind? }` produced by the run. Portal shows chips in SubagentDetail and harvests into final assistant citations. Prefer host emit; Portal also harvests nested file-tool targets when omitted. |

**Nested tools under a subagent (lp-uxy.1):** dual-emit child tools with a
stable `tool_call_id` **and** `parent_subagent_id` matching the parent
subagent's `tool_call_id`. Portal filters the SubagentDetail nested list to
attributed tools only; unattributed tools never appear there.

**Subagent artifacts (lp-uxy.2):** on subagent complete, stamp `artifacts[]`
with each vault path (and any web URLs) the run produced so Portal can soft-open
from activity detail and merge into final-report citations after the
orchestrator finishes. Example:

```json
{
  "op": "send",
  "chat_id": "thread-…",
  "content": "done",
  "metadata": {
    "portal_event": "subagent",
    "tool_call_id": "sa-coder-1",
    "tool_status": "complete",
    "subagent_name": "coder",
    "artifacts": [
      { "vault_path": "/Notes/report.md", "title": "report.md", "kind": "vault" }
    ]
  }
}
```

```json
{
  "op": "send",
  "chat_id": "thread-…",
  "content": "running",
  "metadata": {
    "portal_event": "tool_progress",
    "tool_call_id": "tc-nested-read-1",
    "tool_name": "read_file",
    "tool_status": "running",
    "tool_target": "/Projects/notes.md",
    "parent_subagent_id": "sa-explore-1"
  }
}
```

**Minimum that works:**

```json
{
  "op": "send",
  "chat_id": "thread-…",
  "content": "running",
  "metadata": {
    "portal_event": "tool_progress",
    "tool_call_id": "tc-read-1",
    "tool_name": "read_file",
    "tool_status": "running",
    "tool_target": "/Projects/notes.md"
  }
}
```

**Complete with expandable detail (InteractiveToolCalls-quality):**

```json
{
  "op": "send",
  "chat_id": "thread-…",
  "content": "done",
  "metadata": {
    "portal_event": "tool_progress",
    "tool_call_id": "tc-bash-1",
    "tool_name": "bash",
    "tool_status": "complete",
    "tool_target": "yarn test",
    "duration": "1.8s",
    "node": "cli:remote-server",
    "result": "$ yarn test\n PASS  …\nTests: 14 passed"
  }
}
```

**Lifecycle (recommended):**

```
1. tool_status: running   (same tool_call_id)
2. tool_status: complete | error  (same tool_call_id, + duration/result/error)
3. final message_send with answer (+ citations)
```

Use **`edit`** for progressive tool chrome if Hermes already uses edit-streaming; portal keeps the turn open on `message_edit` by default. Prefer a **new `send` per tool status change** if simpler — both work if `tool_call_id` is stable.

### B. Vault citations

**When:** final assistant answer (or last finalize segment).

```json
{
  "op": "send",
  "chat_id": "thread-…",
  "content": "I updated the auth flow based on your notes[1].",
  "metadata": {
    "model": "grok-4.5",
    "citations": [
      { "path": "/Projects/notes.md", "title": "notes.md" },
      { "path": "/Projects/middleware.ts", "title": "middleware.ts" }
    ]
  }
}
```

| Rule | Detail |
|------|--------|
| `path` | Vault-absolute (`/…`) matching Vault API / tree ids |
| `title` | Short label (basename OK) |
| Inline markers | Optional `[1]`, `[2]` matching citation order for Markdown `sources` |
| No citations array | Portal may still promote file-like `tool_target`s from this turn |

### B2. Web search / Firecrawl structured results (lp-uxy.7)

**Tool ids:** `web_search`, `firecrawl_search`, `firecrawl_scrape`, `firecrawl_crawl`,
`firecrawl_map`, `x_search`, plus existing Tavily/Brave ids. Portal labels search
as **Searching the web** and scrape/crawl as **Browsing the web**.

**On tool complete**, prefer structured JSON in `result` (or
`metadata.search_results`):

```json
{
  "portal_event": "tool_progress",
  "tool_call_id": "fc-1",
  "tool_name": "firecrawl_search",
  "tool_status": "complete",
  "tool_target": "2026 FIFA World Cup",
  "result": "{\"results\":[{\"url\":\"https://en.wikipedia.org/wiki/2026_FIFA_World_Cup\",\"title\":\"2026 FIFA World Cup\",\"snippet\":\"The 23rd FIFA World Cup…\",\"provider\":\"firecrawl\"}]}"
}
```

**On final answer**, web citations use exact http(s) URLs as `path`/`url` plus
optional `snippet` for rich chips:

```json
"citations": [
  {
    "path": "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
    "title": "2026 FIFA World Cup",
    "snippet": "The 23rd FIFA World Cup…"
  }
]
```

**Cost gate:** do not call paid Firecrawl without host env `FIRECRAWL_API_KEY`.
See [`docs/architecture/portal-web-search-firecrawl.md`](../../docs/architecture/portal-web-search-firecrawl.md).

**Dedicated citation event (optional):**

```json
"metadata": {
  "portal_event": "citation",
  "path": "/Projects/notes.md",
  "title": "notes.md"
}
```

Must still include non-undefined `content` (portal send handler) and prefer attaching to the final answer body to avoid empty bubbles.

---

## Where to implement (Hermes side)

### Preferred placement

| Layer | Responsibility |
|-------|----------------|
| **Agent runtime** (tool hooks) | Emit structured tool start/end events with id, name, args, result, error |
| **Gateway stream consumer / delivery** | When platform is **relay** / destination is **lanyard_web**, translate tool events → `OutboundAction.metadata` as above instead of (or in addition to) emoji chrome content |
| **Final answer path** | Collect vault paths touched this turn → `metadata.citations` |

### Mapping Hermes tools → portal fields (suggested)

| Hermes concept | Portal field |
|----------------|--------------|
| Tool call UUID / run id | `tool_call_id` |
| Tool function name | `tool_name` |
| First path-like arg / command string | `tool_target` |
| Start | `tool_status: "running"` |
| Success | `tool_status: "complete"`, `result` = truncated stdout/diff |
| Failure | `tool_status: "error"`, `error_message` |
| Subagent spawn | `portal_event: "subagent"` or `tool_kind: "subagent"`, `subagent_name` |
| Files under vault / TERMINAL_CWD projected into vault | absolute vault path in `citations[].path` |

**Path projection:** Hermes cwd may be `$HOME/Lanyard` or a project primary_path. Convert absolute disk paths to portal vault paths (strip `VAULT_ROOT` / project root prefix, ensure leading `/`). Only cite paths the portal Vault API can open.

**Truncation:** cap `result` (e.g. 32–64 KiB) so SSE stays light; full artifacts can live in vault and be cited.

### What not to rely on

- Mixed “prose + 🔍 Searching” in one content blob as the only signal  
- Chrome-only multi-tool accumulate without `tool_call_id`  
- Mock gateway for production or Hermes-only local

Chrome fallback in portal remains as a **degraded** path if structured metadata is missing.

---

## Portal-side follow-ups (optional, smaller)

Already mostly done; remaining polish if Hermes ships structured events:

1. **Docs:** mark mock as optional; Hermes contract is SoT (this doc + README).  
2. **Relay:** log `publish` with zero subscribers (debug missed SSE).  
3. **Web:** when `tool_status: complete` arrives with path targets mid-turn, optionally preview citation chips before finalize.  
4. **Tests:** integration fixture: Hermes-shaped outbound sequence → SSE → RTL `ChatToolCalls` + citation click.

No portal change is **required** for Hermes to light up tools if Hermes emits the metadata table above.

---

## Phased rollout

### Phase 0 — Ops (Hermes-only)

- [ ] Never run mock alongside Hermes on the same instanceId  
- [ ] `./scripts/portal-gateway-mode.sh hermes` (or stop mock + start `hermes-gateway.service`)  
- [ ] Confirm relay is current (emoji chrome mapping present)  
- [ ] `display.tool_progress` not `off`

**Outcome:** partial tools from chrome when Hermes emits pure progress bubbles.

### Phase 1 — Structured tool_progress from Hermes (MVP)

- [ ] On tool start/end for relay/`lanyard_web`, attach `portal_event` + `tool_call_id` + `tool_name` + `tool_status` + `tool_target`  
- [ ] Keep content as short label (required string)  
- [ ] E2E: portal shows `ChatToolCalls` rows with stable upsert

**Outcome:** reliable tool list without mock.

### Phase 2 — InteractiveToolCalls quality

- [ ] Pass `result` (stdout / unified diff) on complete  
- [ ] Pass `duration_ms`, `additions`/`deletions`, `node` when known  
- [ ] Subagent rows via `tool_kind` / `subagent_name`

**Outcome:** expandable CodeBlock rows matching Astryx InteractiveToolCalls.

### Phase 3 — Vault citations

- [ ] Track vault-openable paths used in the turn  
- [ ] Attach `metadata.citations` on final `send`  
- [ ] Optional: insert `[n]` markers in answer markdown  

**Outcome:** clickable chips → Vault tab + reader.

### Phase 4 — Hardening

- [ ] Unit tests in hermes-agent for metadata shape  
- [ ] Portal integration test with recorded Hermes outbound fixtures  
- [ ] Truncation, redaction, ACL (don’t cite paths outside vault / role prefixes)

---

## Acceptance criteria (Hermes-only)

1. Mock gateway **not** running; Hermes owns relay session.  
2. User message that triggers ≥1 tool shows **≥1** `ChatToolCalls` row with correct status transitions.  
3. Completed bash/edit tools with results show expandable detail when `result` is set.  
4. Final answer that used vault files shows ≥1 citation chip; click opens Vault tab on that path.  
5. No regression: normal answers without tools still render as ghost assistant bubbles.

---

## Example end-to-end sequence

```
→ inbound  chat_id=thread-abc  "fix auth middleware"

← tool_progress  call_id=1  read_file  running   target=/Projects/middleware.ts
← tool_progress  call_id=1  read_file  complete  duration=40ms  result=<file excerpt>
← tool_progress  call_id=2  bash       running   target=rg refreshToken src/
← tool_progress  call_id=2  bash       complete  duration=120ms result=<rg output>
← message_send   content="…based on middleware[1]…"
                 citations=[{path:/Projects/middleware.ts, title:middleware.ts}]
                 model=grok-4.5
```

Portal UI: two tool rows (expand bash for output) + citation chip → Vault.

---

## Open decisions

1. **Emit site:** agent core hooks vs only gateway delivery path for relay platforms.  
2. **Edit vs send:** one progressive `message_id` edit stream vs discrete sends per tool event.  
3. **Citation policy:** all files read vs only files cited in the final answer text.  
4. **Cross-repo ownership:** hermes-agent PR vs portal-only heuristic improvements (prefer Hermes metadata).

---

## Related portal docs

- **README** — Hermes-first tool/citation convention + link to this sketch  
- **testing.md** — Hermes-only local setup, `portal-gateway-mode.sh hermes`, troubleshooting  
- **scripts/portal-gateway-mode.sh** — exclusive Hermes vs optional mock

## References

- Portal: `packages/relay/src/chat-delivery-hub.ts` (`detectToolProgress`, `extractCitations`)  
- Portal: `packages/web/src/hooks/useChatEvents.ts` (`upsertToolCall`, `citationsFromToolCalls`)  
- Portal: `packages/web/src/features/chat/ChatTimeline.tsx` (`resultDetail` → CodeBlock)  
- Portal: `packages/shared/src/relay/frames.ts` (`OutboundAction`)  
- Hermes: `docs/relay-connector-contract.md`, `gateway/relay/adapter.py`  
- Astryx: `ChatToolCallsInteractiveToolCalls`, `CitationInlineText`
