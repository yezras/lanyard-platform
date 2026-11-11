# Portal host: emit artifact events for agent file work

**Bead:** `lp-5q6.31` (gateway/backend: emit artifact events for agent file work)  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Depends on:** wire contract [`portal-chat-artifact-event-protocol.md`](./portal-chat-artifact-event-protocol.md) (`lp-5q6.10`)  
**Implementation (monorepo):** `@lanyard/shared` — `document-pane/artifact-emit.ts`, fixtures `fixtures/artifact-agent-file-work.ts`  
**Host pin:** Hermes-Lanyard (or any backend) stamps the same metadata on relay outbound frames  

---

## Purpose

Teach the **agent path** how to drive the document pane through events.

- Keep payloads **small and metadata-only**.
- The pane **refreshes from vault APIs** — never trust event content as file bytes.
- **Dual-emit** structured `tool_progress` so existing ChatToolCalls rows stay correct.
- Prefer explicit `artifact.*` over legacy promotion (`promoteToolProgressToArtifactEvent`).

---

## 1. Transport (unchanged)

```text
Agent file tool lifecycle
  → host planAgentFileWorkEmit (or Python equivalent)
  → OutboundAction metadata (portal_event = artifact.* | tool_progress)
  → relay ChatDeliveryHub / SSE
  → shared parseArtifactEventMetadata (lp-5q6.11)
  → pane reducer (lp-5q6.12+)
```

`chat_id` on the outbound action **must** be the Portal `thread_id`.

---

## 2. When to emit

| Tool phase | Write tools (`write_file`, `patch`, `edit`, …) | Read tools (`read_file`, …) |
| --- | --- | --- |
| **started** | `artifact.open` (`opening`) + `artifact.progress` (`writing`) | `artifact.open` (`open`) |
| **progress** (optional ticks) | `artifact.progress` | `artifact.progress` |
| **succeeded** + host **revision** | `artifact.updated` (`ready`) with `revision`, `vault_path`, `tool_call_id` | `artifact.open` (refresh optional) |
| **succeeded** without revision | `artifact.open` refresh hint only — **never** claim `updated` | `artifact.open` |
| **failed** | `artifact.error` (sanitized `error_message`, no body) | `artifact.error` |

Non-file tools (`bash`, `web_search`, …) and non-path targets: **do not** emit artifact events.

Always dual-emit `portal_event: "tool_progress"` with matching `tool_status`
(`running` / `complete` / `error`) and the same `tool_call_id` / `tool_target`.

---

## 3. Ordering (acceptance)

Replay fixtures freeze this order for one successful write turn:

1. `reasoning` (optional CoT)
2. `tool_progress` (running) — timeline row first
3. `artifact.open` + `artifact.progress` — pane focuses active path
4. further `tool_progress` / `artifact.progress` as needed
5. `tool_progress` (complete) + `artifact.updated` (with revision)
6. final `message_send` / answer (optional citations)

Error turn: `reasoning` → started dual-emit → `tool_progress` error + `artifact.error` → final answer.

Fixture source: `portal/packages/shared/src/fixtures/artifact-agent-file-work.ts`.

---

## 4. Payload rules (boundary discipline)

| Allowed on wire | Forbidden on wire |
| --- | --- |
| `vault_path`, `title`, `mime_type` / `file_type` | File body, base64 content, data URLs |
| `revision.token` / `kind` / optional size | Secrets, tokens, full tool stdout dumps |
| `tool_call_id`, `operation_id`, diff stats | Paths with `..`, shell commands as targets |
| Short `error_message` (≤ 280 chars, sanitized) | Fenced code blocks, multi-line bodies |

Sanitize errors with `sanitizeArtifactErrorMessage` (or host equivalent) before stamp.

---

## 5. Monorepo API (TypeScript)

```ts
import {
  planAgentFileWorkEmit,
  emitMetadataForAgentFileWork,
  flattenEmitPlanMetadata,
  sanitizeArtifactErrorMessage,
} from "@lanyard/shared";

const plan = planAgentFileWorkEmit({
  thread_id: chatId,
  phase: "succeeded",
  tool_name: "write_file",
  vault_path: "/Projects/Legal/memo.md",
  tool_call_id: "tc-1",
  revision: { token: etag, kind: "etag", size_bytes: n },
});

// Each entry → separate outbound metadata (or edit) frame
for (const metadata of flattenEmitPlanMetadata(plan!)) {
  await sendOrEdit({ chat_id: chatId, content: label, metadata });
}
```

Hosts in Python should **mirror** the mapping tables; they do not need to import TS.
Conformance is shape + ordering + leak tests against the frozen fixtures.

---

## 6. Hermes-Lanyard integration sketch

Suggested hook points (external repo; not mixed into Portal web/BFF PRs):

1. **Tool start/complete callbacks** (existing `tool_progress_callback` / portal
   `tool_progress` metadata path) — when `tool_name` ∈ file write set and
   `tool_target` is a vault path, also stamp `artifact.*` frames.
2. **After successful write** — compute host revision (etag, content hash, or
   mtime+size fallback) and emit `artifact.updated`.
3. **On tool error** — pass only a short message through sanitization; never
   attach the attempted write body.

Until the host pin ships, mock gateway / UI tests inject
`buildSuccessfulWriteTurnFixture()` / `buildFailedWriteTurnFixture()`.

---

## 7. Non-goals

- ChatEvent / timeline integration (`lp-5q6.11`)
- Pane reducer UI (`lp-5q6.12`–`lp-5q6.16`)
- `vault.write` Brain RPC (`lp-5q6.18`–`lp-5q6.20`)
- Human-edit vs agent-write policy enforcement (`lp-5q6.32`) — see [`portal-active-human-edit-agent-write-policy.md`](portal-active-human-edit-agent-write-policy.md)
- Shipping Hermes-Lanyard source inside this monorepo

---

## 8. Acceptance checklist (`lp-5q6.31`)

| Criterion | Where satisfied |
| --- | --- |
| Write/edit tools emit `artifact.open` or `artifact.progress` when path becomes active | `planAgentFileWorkEmit` phase `started` |
| Successful writes emit `artifact.updated` with `vault_path`, `revision`, `tool_call_id` | phase `succeeded` + revision |
| Errors emit `artifact.error` without file body | `sanitizeArtifactErrorMessage` + failed phase |
| Existing `tool_progress` rows still render | dual-emit `tool_progress` in every plan |
| Tests/fixtures show ordering with reasoning, tool progress, final answer, artifact updates | `artifact-emit.test.ts`, `artifact-agent-file-work` fixtures |

Evidence: unit tests under `portal/packages/shared`; architecture docs in this file + protocol link.
