# Portal chat artifact event protocol

**Bead:** `lp-5q6.10` (contract: chat artifact event protocol for document pane)  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Status:** Wire contract frozen; host emit planners/fixtures in `lp-5q6.31`  
**Implementation:** `portal/packages/shared/src/document-pane/artifact-events.ts`  
**Host emit:** [`portal-host-artifact-event-emission.md`](./portal-host-artifact-event-emission.md) (`lp-5q6.31`)  
**Domain sketch:** [`portal-document-session-domain-model.md`](./portal-document-session-domain-model.md) §2.3  
**Principles:** model-the-domain, boundary-discipline, type-system-discipline

---

## Purpose

Define the **event contract** that lets agent (and user) file work show in the
chat document pane **without requiring ONLYOFFICE**. This is the first
integration contract after domain grounding (`lp-5q6.6`).

Consumers:

| Consumer | Role |
| --- | --- |
| Gateway / Hermes-Lanyard (`lp-5q6.31`) | Emit explicit artifact events on agent file work |
| Shared emit planners (`lp-5q6.31`) | `planAgentFileWorkEmit` / fixtures — metadata-only dual-emit with `tool_progress` |
| Shared parser (`lp-5q6.11`) | Normalize relay metadata → typed events for chat / pane |
| Pane reducer (`lp-5q6.12`) | Drive open / progress / refresh / error / close |
| Host emit fixtures / mock gateway | Inject events for UI before real host lands |

Events are **append-only signals** relative to vault bytes: they never write
vault content and are not ACL authority.

---

## 1. Transport

Artifact events ride existing relay **outbound** frames (same path as
`tool_progress` / `mcq` / citations):

```text
Gateway OutboundAction
  → metadata.portal_event = "artifact.open" | "artifact.progress" | …
  → relay ChatDeliveryHub / SSE
  → durable history (must retain metadata; see §6)
  → shared parseArtifactEventMetadata
  → ArtifactEventWire → pane reducer / timeline
```

Do **not** invent a second SSE envelope type without updating shared types.
`chat_id` on the outbound action **must** be the Portal `thread_id`.

### 1.1 Envelope sketch

```json
{
  "type": "outbound",
  "requestId": "<uuid>",
  "action": {
    "op": "send",
    "chat_id": "<portal thread_id>",
    "content": "optional human-visible chrome",
    "message_id": "<stable id for edits>",
    "metadata": {
      "portal_event": "artifact.updated",
      "thread_id": "<same as chat_id preferred>",
      "artifact_id": "op:write-42",
      "vault_path": "/Projects/Legal/memo.md",
      "title": "memo.md",
      "mime_type": "text/markdown",
      "file_type": "md",
      "revision": { "token": "etag-abc", "kind": "etag" },
      "producer": "agent",
      "status": "ready",
      "timestamp": "2026-07-24T12:00:00.000Z",
      "tool_call_id": "tc-1",
      "operation": "writing",
      "additions": 12,
      "deletions": 3
    }
  }
}
```

Field names are **snake_case on the wire**. Portal TS may project to camelCase
at UI boundaries later; parsers accept the wire shape.

---

## 2. Event variants (discriminated union)

| `portal_event` | Meaning | Typical `status` |
| --- | --- | --- |
| `artifact.open` | Open or focus the pane on a vault document | `pending` \| `opening` \| `open` |
| `artifact.progress` | In-flight agent/user work on that document | `pending` \| `running` \| `writing` |
| `artifact.updated` | Bytes changed; pane may reload at `revision` | `ready` \| `writing` |
| `artifact.error` | Structured failure for pane / banner | `error` |
| `artifact.close` | Close or clear pane interest in the artifact | `closed` |

TypeScript: `ArtifactEventWire` in `@lanyard/shared` (`document-pane`).

Unknown `portal_event` values are **not** artifact events. Malformed
`artifact.*` payloads parse to `null` (fail soft — do not crash the stream).

---

## 3. Required and optional fields

### 3.1 Required on every explicit artifact event

| Field | Type | Notes |
| --- | --- | --- |
| `portal_event` | enum above | Discriminator |
| `thread_id` | string | Portal chat thread; may fall back to action `chat_id` |
| `artifact_id` | string | Stable id for this pane interest / operation (not only path) |
| `vault_path` | string | Vault-root-relative absolute path (`/…`); no `..` |
| `title` | string | Display title |
| `mime_type` **or** `file_type` | string | At least one; identifies markdown / PDF / image / Office / … |
| `producer` | enum | `agent` \| `user` \| `system` \| `gateway` \| `bff` |
| `status` | enum | Must be valid for the variant (see §2) |
| `timestamp` | string | ISO-8601; ordering and history replay |
| `revision` | object | **When known**; **required** for `artifact.updated` |

### 3.2 `revision` object (when present)

| Field | Required | Notes |
| --- | --- | --- |
| `token` | yes | Opaque host etag / content hash / revision |
| `kind` | yes | `etag` \| `content_hash` \| `host_revision` \| `mtime_size_fallback` |
| `size_bytes` | no | Content length at this revision |
| `modified_at` | no | ISO time for UI only — never sole CAS key |

Aligns with domain `DocumentRevision` (`lp-5q6.6`). Production Office edit
must not mint document keys from missing revision (fail closed).

### 3.3 Optional fields

| Field | Type | Notes |
| --- | --- | --- |
| `progress_label` | string | Header strip copy |
| `percent` | number | 0–100; omit when indeterminate |
| `operation` | string | e.g. `writing`, `formatting`, `uploading`, tool name |
| `additions` | number | Non-negative diff stats (edit tools) |
| `deletions` | number | Non-negative diff stats |
| `preview_mode` | enum | `auto` \| `markdown` \| `pdf` \| `image` \| `office` \| `text` \| `binary` \| `none` |
| `tool_call_id` | string | Correlate with timeline tool rows |
| `operation_id` | string | Multi-step agent work across events |
| `write_kind` | enum | `canonical` \| `checkpoint` \| `conflict_copy` |
| `source_path` | string | Canonical path when event path is a checkpoint |
| `error_code` | enum | Required with message on `artifact.error` |
| `error_message` | string | Safe UI/log text; never bodies/secrets |
| `preferred_mode` | `preview` \| `edit` | Hint only; server may ignore |
| `close_reason` | enum | `user` \| `thread_change` \| `superseded` \| `error` |

### 3.4 Variant-specific rules

| Variant | Extra rules |
| --- | --- |
| `artifact.updated` | `revision` **required** |
| `artifact.error` | `error_code` + `error_message` **required**; `status` must be `error` |
| `artifact.close` | `status` must be `closed` |
| `artifact.progress` | Prefer `progress_label` / `percent` / `operation` when available |
| All | At least one of `mime_type` / `file_type` |

---

## 4. Examples

### 4.1 Open (agent or citation-driven)

```json
{
  "portal_event": "artifact.open",
  "thread_id": "thread-1",
  "artifact_id": "citation:/Projects/Legal/memo.md",
  "vault_path": "/Projects/Legal/memo.md",
  "title": "Legal memo",
  "mime_type": "text/markdown",
  "file_type": "md",
  "producer": "agent",
  "status": "open",
  "timestamp": "2026-07-24T12:00:00.000Z",
  "preferred_mode": "preview",
  "preview_mode": "markdown"
}
```

### 4.2 Progress

```json
{
  "portal_event": "artifact.progress",
  "thread_id": "thread-1",
  "artifact_id": "op:draft-9",
  "vault_path": "/Projects/Legal/memo.md",
  "title": "memo.md",
  "file_type": "md",
  "producer": "agent",
  "status": "writing",
  "timestamp": "2026-07-24T12:00:05.000Z",
  "progress_label": "Drafting section 2",
  "percent": 45,
  "operation": "writing",
  "tool_call_id": "tc-write-3"
}
```

### 4.3 Updated (canonical or checkpoint)

```json
{
  "portal_event": "artifact.updated",
  "thread_id": "thread-1",
  "artifact_id": "op:draft-9",
  "vault_path": "/.lanyard/checkpoints/memo-20260724.md",
  "title": "memo checkpoint",
  "mime_type": "text/markdown",
  "producer": "agent",
  "status": "ready",
  "timestamp": "2026-07-24T12:00:10.000Z",
  "revision": {
    "token": "sha256:deadbeef",
    "kind": "content_hash",
    "size_bytes": 4096
  },
  "write_kind": "checkpoint",
  "source_path": "/Projects/Legal/memo.md",
  "additions": 40,
  "deletions": 2,
  "tool_call_id": "tc-write-3"
}
```

### 4.4 Error

```json
{
  "portal_event": "artifact.error",
  "thread_id": "thread-1",
  "artifact_id": "op:draft-9",
  "vault_path": "/Projects/Legal/memo.md",
  "title": "memo.md",
  "file_type": "md",
  "producer": "agent",
  "status": "error",
  "timestamp": "2026-07-24T12:00:11.000Z",
  "error_code": "human_edit_active",
  "error_message": "Human edit session owns this path; wrote checkpoint instead"
}
```

### 4.5 Close

```json
{
  "portal_event": "artifact.close",
  "thread_id": "thread-1",
  "artifact_id": "op:draft-9",
  "vault_path": "/Projects/Legal/memo.md",
  "title": "memo.md",
  "file_type": "md",
  "producer": "user",
  "status": "closed",
  "timestamp": "2026-07-24T12:05:00.000Z",
  "close_reason": "user"
}
```

---

## 5. Legacy promotion: `tool_progress` and citations

Explicit `artifact.*` events are **preferred**. Until hosts emit them
(`lp-5q6.31`), shared helpers may **promote** legacy metadata. Promotion is
best-effort and never vault write authority.

Implementation: `promoteToolProgressToArtifactEvent`,
`promoteCitationToArtifactOpen` in `@lanyard/shared`.

### 5.1 Priority order (for `lp-5q6.11`)

1. **Explicit** `metadata.portal_event` in `artifact.*` → `parseArtifactEventMetadata`
2. Else **citations** (`metadata.citations[]` or `portal_event: "citation"`) →
   `promoteCitationToArtifactOpen` per path (pane open / history hydrate)
3. Else **structured** `portal_event: "tool_progress"` with file-like tool +
   vault path target → `promoteToolProgressToArtifactEvent`
4. Else **do not** promote pure Hermes emoji tool chrome into artifact events
   (keep existing tool row heuristics only)

### 5.2 `tool_progress` → artifact

| Condition | Result |
| --- | --- |
| `tool_name` in file-tool set (`read_file`, `write_file`, `edit`, …) | Eligible |
| `tool_target` looks like vault path (extension or `/Projects/…`, no shell metacharacters / `..`) | Eligible |
| `tool_status` `pending` / `running` | `artifact.progress` |
| `tool_status` `complete` **without** host revision | `artifact.open` (refresh hint only — **not** `artifact.updated`) |
| `tool_status` `error` | `artifact.error` (`error_code: upstream`) |
| `bash` / `web_search` / non-path target | **No** promotion |

**Why complete ≠ updated:** `artifact.updated` requires `revision` for CAS /
pane reload correctness. Legacy tool rows lack host etag/hash. Hosts should
emit true `artifact.updated` with revision when a write lands.

`tool_progress` continues to power timeline tool rows independently. Pane
progress may dual-bind until emit is complete; do not treat tool rows as
document session authority (domain model §1.2, §6).

### 5.3 Citations → artifact.open

| Source | Promotion |
| --- | --- |
| `metadata.citations: [{ path, title }]` on final send | Each entry → `artifact.open`, `artifact_id = citation:<path>`, `preferred_mode: preview` |
| `portal_event: "citation"` with path fields | Same |
| User click on citation chip | UI may synthesize the same open event with `producer: user` |

Relative project paths are resolved by
`resolveArtifactVaultPath(path, project_vault_path)` in
`artifact-normalize.ts` (`lp-5q6.11`) before promotion. Pure promote helpers
in this module still expect **already absolute** vault paths when called
directly.

### 5.4 What is not promoted

- MCQ, reasoning, typing, plain `message_send` without citations
- Tool chrome heuristics without structured `portal_event: "tool_progress"`
- Paths that fail normalization (`..`, empty, URL schemes without path)

---

## 6. Durability and history

For pane state to survive reload:

- Explicit artifact metadata must be retained on durable outbound history
  (same class as `tool_progress` / `message_send` citations).
- `lp-5q6.11` ensures `durableOutboundFromRelayEvent` keeps `metadata`,
  `citations`, `tool_target` / `tool_name` / `tool_status` / `tool_call_id`,
  and optional `artifact_events` so consumers can re-parse after reload.
- Shared hydrate helpers: `normalizeArtifactEventsFromChatEvent`,
  `collectArtifactEventsFromHistory` in
  `portal/packages/shared/src/document-pane/artifact-normalize.ts`.
- `typing` remains non-durable; artifact events are durable when emitted as
  send/edit outbound.

---

## 7. Mapping to domain `ArtifactEvent` (`lp-5q6.6`)

| Wire | Domain sketch |
| --- | --- |
| `portal_event` | `type`: strip `artifact.` prefix (`open`, `progress`, …) |
| `vault_path` + `title` | `ref: VaultArtifactRef` |
| `revision` | `DocumentRevision` |
| `progress_label` / `percent` / `operation` | `message` / `percent` / `phase` |
| `tool_call_id` / `operation_id` / `thread_id` / `timestamp` | same-named base fields (`created_at` ← `timestamp`) |
| `write_kind` / `source_path` | `ArtifactUpdatedEvent` |
| `error_code` / `error_message` | `ArtifactErrorEvent` |
| `close_reason` | `ArtifactCloseEvent.reason` |
| `artifact_id`, `producer`, `status`, `mime_type`/`file_type`, `preview_mode` | Wire-only extras; pane may store as needed |

Wire is the **interoperability surface**. Domain types remain the in-process
model for reducer/session code. Projection helpers can live in `lp-5q6.11` /
`lp-5q6.12`.

---

## 8. Non-goals (this bead)

- Chat timeline / `ChatEvent` integration (→ `lp-5q6.11`; landed as shared
  normalizer + optional `ChatEvent.artifact_events` / history retention)
- Pane reducer UI state (→ `lp-5q6.12`)
- Host emission planners and fixtures (→ `lp-5q6.31` / [`portal-host-artifact-event-emission.md`](./portal-host-artifact-event-emission.md))
- ONLYOFFICE sessions, document keys, vault.write (later beads)
- Extending Brain RPC schemas

---

## 9. Acceptance checklist (`lp-5q6.10`)

| Criterion | Where satisfied |
| --- | --- |
| Variants `artifact.open` / `progress` / `updated` / `error` / `close` | §2 + `ArtifactEventWire` |
| Required fields: thread_id, artifact_id, vault_path, title, mime_type or file_type, revision when known, producer, status, timestamp | §3.1–§3.2 + parser |
| Optional: progress_label, percent, operation, additions, deletions, preview_mode, tool_call_id | §3.3 |
| Tests: valid parse + reject malformed | `artifact-events.test.ts` |
| Document legacy tool_progress + citation promotion | §5 + promote helpers |

No secrets. No product migration beyond shared contract types/tests and this
doc.
