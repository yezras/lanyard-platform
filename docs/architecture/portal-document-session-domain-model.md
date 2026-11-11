# Portal document session and artifact pane domain model

**Bead:** `lp-5q6.6` (architect: design document session and artifact pane domain model)  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Status:** Design accepted for implementation beads (docs + type sketch only; no product code)  
**Principles:** model-the-domain, type-system-discipline, separate-before-serializing-shared-state  
**Depends on:** `lp-5q6.5` HOW grounding, `lp-5q6.3` shared mutable state / conflict policy  
**Feeds:** `lp-5q6.10` (artifact event protocol), `lp-5q6.12` (pane reducer), `lp-5q6.17` (revision / binary), `lp-5q6.21` (session store)

## Purpose

Define the **core typed domain** for the chat document pane and ONLYOFFICE editing
before code fans out across ChatView, VaultReader, BFF, and deploy.

The key shape is a **document-session lifecycle**, not scattered booleans
(`isPaneOpen`, `isDirty`, `hasConflict`, …) in ChatView and VaultReader.

This note is phase-0 architecture. Implementation beads own concrete TypeScript
modules and JSON Schema; they must conform to these types or propose an
explicit revision.

Related durable policy:

- Shared writers and conflict rules: [`portal-document-shared-state-conflict-policy.md`](./portal-document-shared-state-conflict-policy.md)
- Binary transfer + revision: [`portal-binary-vault-transfer-and-revision.md`](./portal-binary-vault-transfer-and-revision.md) (`lp-5q6.17`)
- Source grounding (paths, size caps, no-write today): [`../plans/0004-portal-onlyoffice-integration/how-source-grounding.md`](../plans/0004-portal-onlyoffice-integration/how-source-grounding.md)

---

## 1. Caller usage first

Implementers and reviewers should read this section before the type sketches.
Each example shows **who** owns which types and **what must not leak** across
boundaries.

### 1.1 Chat citation opens preview pane (slice 1)

```text
User clicks VaultCitationChip(path)
  → ChatView / shell openDocumentInPane({ ref: VaultArtifactRef })
  → dispatch ArtifactEvent { type: "open", ref, reason: "citation" }
  → ArtifactPanelState reducer → { status: "previewing", ref, revision?: … }
  → VaultPreviewHost fetches GET /api/vault/content?path=…  (small-file only)
  → render existing VaultReader previews

Does NOT create OfficeDocumentSession.
Does NOT mint document.key.
Does NOT call vault.write.
```

### 1.2 Agent file work updates pane (slice 2)

```text
Gateway emits portal_event metadata (artifact protocol, lp-5q6.10)
  → relay → SSE / durable history
  → shared parseArtifactEvent(metadata) → ArtifactEvent
  → pane reducer:
       open | progress | updated | error | close
  → UI shows progress strip + reload preview at new DocumentRevision when idle

Agent path may be a checkpoint sibling (conflict policy §3.2).
Pane never treats tool_progress alone as vault write authority.
```

### 1.3 Human opens ONLYOFFICE edit (slice 4+, gated)

```text
User chooses Edit on Office-family file (capability + feature flag)
  → web POST /api/office/sessions  { path, mode: "edit" }
  → BFF:
       vault.stat → DocumentRevision
       create OfficeDocumentSession (server-owned)
       mint document.key = digest(tenant|path|revision)
       mint short-lived JWT editor config + signed download URL
  → web ArtifactPanelState → { status: "editing", sessionId, editorConfig }
  → OfficeEditorHost loads Document Server with opaque sessionId only

Web never sends vault path or ACL claims on the Document Server callback.
Document Server never calls Brain RPC.
```

### 1.4 Human save (callback writeback)

```text
Document Server POST /api/office/callback  (status=ready-to-save)
  → BFF loads OfficeDocumentSession by id + validates callback nonce
  → BFF downloads edited bytes from Document Server URL
  → BFF vault.write {
       mode: "replace_if_match",
       path: session.path,                 // server-side path only
       expected_revision: session.baseRevision,
       bytes…
     }
  → host CAS:
       match  → new DocumentRevision R2; session.markSaved(R2); SaveCallback ok
       mismatch → ConflictState; SaveCallback conflict; no partial write
  → web receives session status poll / SSE → ConflictState banner or clean close
```

### 1.5 Agent write while human dirty

```text
BFF/host: path P has dirty OfficeDocumentSession
  → agent tool MUST use write_checkpoint (or fail human_edit_active)
  → staged VaultArtifactRef under .lanyard/checkpoints/…
  → ArtifactEvent { type: "updated", ref: checkpoint, revision }
  → pane offers "open agent checkpoint" without swapping human editor key
```

---

## 2. Typed domain model

TypeScript sketches below are **normative intent** for later modules. Field
names use `snake_case` on the wire (relay metadata, Brain RPC, BFF JSON) and
`camelCase` in Portal TS as today; both are shown where they differ.

### 2.1 `VaultArtifactRef`

Stable identity of a vault document as the pane and events understand it.
Not a raw string path alone — path is necessary but insufficient for
multi-root / tenant-safe keys.

```typescript
/** Where the bytes live relative to the tenant vault. */
export type VaultPath = string; // vault-root-relative, absolute form "/…", no ".."

/**
 * Reference used by pane, artifact events, and session create.
 * ACL is NOT carried here — always re-checked server-side.
 */
export type VaultArtifactRef = {
  /** Normalized vault path (see vaultPaths helpers). */
  path: VaultPath;
  /** Optional display title (citation title, tool label). */
  title?: string;
  /**
   * Optional stable content id if host exposes one later.
   * Prefer path + revision for Office keys until host content-id exists.
   */
  content_id?: string;
  /**
   * Provenance of the open request (UI / analytics only).
   * Not used for ACL or document.key.
   */
  source?:
    | "citation"
    | "tool_target"
    | "agent_checkpoint"
    | "vault_browser"
    | "user_reload"
    | "deep_link";
};
```

**Invariants**

- `path` is normalized (root-relative absolute, consistent encoding, no `..`).
- Empty or relative-without-project-context refs are rejected at the open boundary.
- Refs never embed tenant id in the client payload as authority; BFF stamps tenant
  from the authenticated session.

### 2.2 `DocumentRevision`

Host-owned identity of **specific bytes** at a path. Part of every Office
document key and every CAS write.

```typescript
/**
 * Opaque revision token from host vault.stat / write result.
 * Prefer etag or content hash over mtime alone.
 */
export type DocumentRevision = {
  /** Opaque token; compared with constant-time equality on host. */
  token: string;
  /** How the token was produced (for debug / migration only). */
  kind: "etag" | "content_hash" | "host_revision" | "mtime_size_fallback";
  /** Optional content length at this revision. */
  size_bytes?: number;
  /** Optional ISO timestamp for UI only — never sole CAS key. */
  modified_at?: string;
};
```

**Invariants**

- Minting `document.key` without a revision is **forbidden** (fail closed).
- `mtime_size_fallback` is allowed only for lab/preview until `lp-5q6.17`
  lands a real etag/hash; production Office edit requires a stronger kind.
- Same path + different revision ⇒ different ONLYOFFICE document key.

### 2.3 `ArtifactEvent` (discriminated union)

Signals that open, refresh, or close the pane. Append-only relative to vault
bytes: events never write vault content.

```typescript
export type ArtifactEventBase = {
  /** Correlate multi-step agent work. */
  operation_id?: string;
  /** Chat thread id when event rides chat SSE. */
  thread_id?: string;
  /** Tool call id when derived from agent tools. */
  tool_call_id?: string;
  /** Event time (ISO) for history ordering. */
  created_at?: string;
};

export type ArtifactOpenEvent = ArtifactEventBase & {
  type: "open";
  ref: VaultArtifactRef;
  /** Hint preferred pane mode; server may ignore for capabilities. */
  preferred_mode?: "preview" | "edit";
  revision?: DocumentRevision;
  reason?: VaultArtifactRef["source"];
};

export type ArtifactProgressEvent = ArtifactEventBase & {
  type: "progress";
  ref?: VaultArtifactRef;
  /** 0–100 or omit when indeterminate. */
  percent?: number;
  message?: string;
  /** e.g. "writing", "formatting", "uploading". */
  phase?: string;
};

export type ArtifactUpdatedEvent = ArtifactEventBase & {
  type: "updated";
  ref: VaultArtifactRef;
  revision: DocumentRevision;
  /**
   * Whether the path is the canonical file or a staged checkpoint.
   * Default "canonical" when omitted.
   */
  write_kind?: "canonical" | "checkpoint" | "conflict_copy";
  /** When checkpoint, optional canonical path for UI linkage. */
  source_path?: VaultPath;
};

export type ArtifactErrorEvent = ArtifactEventBase & {
  type: "error";
  ref?: VaultArtifactRef;
  code:
    | "not_found"
    | "forbidden"
    | "payload_too_large"
    | "unsupported_type"
    | "revision_mismatch"
    | "human_edit_active"
    | "session_expired"
    | "upstream"
    | "unknown";
  message: string;
  /** Safe for UI; never include file bodies or secrets. */
  retryable?: boolean;
};

export type ArtifactCloseEvent = ArtifactEventBase & {
  type: "close";
  ref?: VaultArtifactRef;
  reason?: "user" | "thread_change" | "superseded" | "error";
};

export type ArtifactEvent =
  | ArtifactOpenEvent
  | ArtifactProgressEvent
  | ArtifactUpdatedEvent
  | ArtifactErrorEvent
  | ArtifactCloseEvent;
```

Wire mapping (normative for `lp-5q6.10`): prefer structured
`metadata.portal_event` values `artifact.open` \| `artifact.progress` \|
`artifact.updated` \| `artifact.error` \| `artifact.close` over scraping tool
chrome. Full wire field table, fixtures, and legacy promotion rules:
[`portal-chat-artifact-event-protocol.md`](./portal-chat-artifact-event-protocol.md).
Parse helpers live in `@lanyard/shared` (`document-pane/artifact-events.ts`);
ChatEvent / timeline integration is `lp-5q6.11`. Unknown or malformed variants
fail soft (ignore) rather than crash the chat stream.

### 2.4 `ArtifactPanelState` (reducer-owned state machine)

Browser-local UI state. **Not** authority for ACL, CAS, or agent overwrite.

```typescript
export type PanelMode = "preview" | "edit";

export type ArtifactPanelStatus =
  | "closed"
  | "opening"
  | "previewing"
  | "editing"
  | "progress"
  | "conflict"
  | "error";

/**
 * Single source of truth for the chat-side document pane.
 * Prefer one reducer module over flags in ChatView / VaultReader.
 */
export type ArtifactPanelState = {
  status: ArtifactPanelStatus;

  /** Current document, if any. */
  ref: VaultArtifactRef | null;

  /** Last known host revision for the open ref (preview or edit base). */
  knownRevision: DocumentRevision | null;

  mode: PanelMode;

  /**
   * Opaque Office session id when status is editing (or conflict mid-edit).
   * Web never reconstructs path authority from this alone for writeback.
   */
  officeSessionId: string | null;

  /** In-flight agent operation label / percent for header strip. */
  progress: {
    operationId?: string;
    percent?: number;
    message?: string;
    phase?: string;
  } | null;

  /** Structured conflict when human and external writers diverge. */
  conflict: ConflictState | null;

  /** Last error for status === "error". */
  error: ArtifactErrorEvent | null;

  /**
   * Local dirty hint from editor host (UX only).
   * Server dirty ownership lives on OfficeDocumentSession.
   */
  localDirty: boolean;

  /** Monotonic open generation so re-click same path re-runs effects. */
  openGeneration: number;
};
```

#### Transition sketch (pure reducer)

| From | Event / action | To | Notes |
| --- | --- | --- | --- |
| `closed` | `open` / user open | `opening` → `previewing` \| `error` | Preview default |
| `previewing` | `progress` | `progress` (or stay + progress strip) | Keep ref |
| `previewing` | `updated` (same path, idle) | `previewing` + new revision | Auto-reload ok |
| `previewing` | user Edit | `opening` → `editing` | Needs session create |
| `editing` | `updated` external revision | `conflict` | **No** auto key swap if dirty |
| `editing` | save success | `editing` or `previewing` | Advance `knownRevision` |
| `editing` | save CAS fail | `conflict` | Keep buffer; show choices |
| `*` | `close` / user close | `closed` | Clear session id locally; BFF expire |
| `*` | `error` fatal | `error` | Keep ref for retry when useful |

Reducer actions should be a closed union (`PANEL_OPEN`, `PANEL_EVENT`,
`PANEL_SET_DIRTY`, `PANEL_SESSION_BOUND`, `PANEL_CLOSE`, …) implemented in
`lp-5q6.12`. Do not set `status` from arbitrary component effects.

### 2.5 `OfficeDocumentSession` (server-owned)

Maps an **opaque session id** to tenant, user, path, revision, mode, and
callback nonce. Lives only in BFF (`lp-5q6.21`). Web and Document Server see
the id, never the full record.

```typescript
export type OfficeSessionMode = "view" | "edit";

export type OfficeSessionLifecycle =
  | "active"
  | "saving"
  | "saved"
  | "conflict"
  | "expired"
  | "closed"
  | "superseded_base";

export type OfficeDocumentSession = {
  /** Opaque id (cryptographically random). Primary key. */
  session_id: string;

  tenant_id: string;
  user_id: string;

  /** Canonical path this session may download / writeback. */
  path: VaultPath;

  /** Revision frozen at open (CAS base for save). */
  base_revision: DocumentRevision;

  mode: OfficeSessionMode;

  /**
   * ONLYOFFICE document.key minted at open.
   * digest(v1|tenant|normalized_path|revision.token[|mode]).
   */
  document_key: string;

  /**
   * Single-use or rotating nonce bound into callback URL / JWT claims.
   * Callback without matching nonce fails closed.
   */
  callback_nonce: string;

  lifecycle: OfficeSessionLifecycle;

  /** Conservative dirty: true once edit mode is active until clean close/save. */
  dirty: boolean;

  created_at: string;
  expires_at: string;
  last_callback_at?: string;

  /** After successful save, host's new revision. */
  saved_revision?: DocumentRevision;

  /** When base was invalidated by external write detection. */
  conflict?: ConflictState;
};
```

**Invariants**

- Path and tenant on the session record are authoritative for download and
  writeback; callback body cannot retarget path.
- Expired / closed / unknown session id → download and callback fail closed.
- Document key is **derived**, not an independent product entity (see conflict
  policy S4).

### 2.6 `SaveCallback`

Normalized result of Document Server → BFF writeback handling (internal +
optional web status projection).

```typescript
export type SaveCallbackStatus =
  | "ignored" // DS status that is not a save
  | "accepted" // bytes received, write in progress
  | "saved"
  | "conflict"
  | "forbidden"
  | "expired"
  | "upstream_error";

export type SaveCallback = {
  session_id: string;
  status: SaveCallbackStatus;
  /** Present when status === "saved". */
  new_revision?: DocumentRevision;
  /** Present when status === "conflict". */
  conflict?: ConflictState;
  /** Safe error code/message for logs and UI. */
  error_code?: string;
  error_message?: string;
  /** Document Server status code echoed for observability only. */
  onlyoffice_status?: number;
};
```

### 2.7 `ConflictState`

Structured conflict for pane banner and session lifecycle — not a free-form
string.

```typescript
export type ConflictReason =
  | "revision_mismatch"
  | "human_edit_active"
  | "superseded_base"
  | "concurrent_session"
  | "path_retarget_denied";

export type ConflictState = {
  reason: ConflictReason;
  path: VaultPath;
  /** Revision the editor or writer expected. */
  expected_revision?: DocumentRevision;
  /** Revision the host currently has, if known. */
  actual_revision?: DocumentRevision;
  /**
   * Optional staged path the user/agent can open instead of overwriting.
   * Populated for agent checkpoint and human save-as flows.
   */
  alternate_ref?: VaultArtifactRef;
  /** Short UI copy key or safe message. */
  message: string;
  /** Actions the UI may offer (product may subset). */
  offered_actions: Array<
    | "reload"
    | "save_as_conflict_copy"
    | "open_checkpoint"
    | "discard_local"
    | "retry_save"
  >;
};
```

---

## 3. Module boundaries

| Module | Package / path (planned) | Owns | Consumes | Must not own |
| --- | --- | --- | --- | --- |
| **Shared types + parsers** | `portal/packages/shared/src/` (e.g. `document-pane/`, `relay/artifact-events.ts`) | `VaultArtifactRef`, `ArtifactEvent`, parse/normalize from metadata, pure helpers | Relay frames / metadata conventions | BFF session store, React state, vault bytes |
| **Web pane reducer** | `portal/packages/web/src/features/chat/documentPane*` (or `features/documents/`) | `ArtifactPanelState` machine, openGeneration, progress strip wiring | Shared `ArtifactEvent`, shell open API | Office session secrets, document.key mint |
| **Vault preview host** | Reuse `VaultReader` / `vaultOffice.ts` + `fetchVaultContent` | Small-file preview render | `VaultArtifactRef`, existing `/api/vault/content` | Binary multi‑MB Office for DS; writeback |
| **Office editor host** | `portal/packages/web` flag-gated module (`lp-5q6.27`) | Embed Document Server UI; report localDirty; bind opaque sessionId | Editor config JWT from BFF | Path ACL, callback handling, vault.write |
| **BFF Office endpoints** | `portal/packages/bff/src/office/*` + route registration | `OfficeDocumentSession` store, signed download, callback, key mint, JWT | Brain RPC vault.stat/read-binary/write, conflict policy | React UI; DS process lifecycle |
| **Contracts** | `contracts/backend-runtime-v1/` | `vault.write` schema, `vault.read_chunk`, revision fields, binary transfer (`lp-5q6.17`) | — | Portal UI types |
| **Deploy config** | `deploy/`, runbooks under `docs/runbooks/` | DS image/topology, JWT secrets, network reachability BFF↔DS | Topology decision `lp-5q6.8` | Application domain types |

### Dependency direction

```text
contracts (vault.write, revision)
    ▲
    │
shared (ArtifactEvent, VaultArtifactRef, parsers)
    ▲                ▲
    │                │
web pane reducer   BFF office module ──► backend-runtime ──► host vault
    │                │
preview host     signed download / callback
editor host  ◄── editor config JWT
                 ▲
                 │
            Document Server (external)
```

Document Server depends **only** on BFF URLs. It never imports Portal packages
and never speaks Brain RPC.

---

## 4. Route sketch (BFF Office)

Normative names for later beads; exact paths may prefix with versioning but
semantics are fixed.

| Method | Route | Auth | Purpose | Session fields used |
| --- | --- | --- | --- | --- |
| `POST` | `/api/office/sessions` | Portal session + vault path ACL | Create `OfficeDocumentSession`; return `{ session_id, editor_config, document_key, base_revision }` | creates all |
| `GET` | `/api/office/sessions/:id` | Portal session (owner) | Poll lifecycle / conflict for UI | read |
| `DELETE` | `/api/office/sessions/:id` | Portal session (owner) | User close / discard; mark closed | lifecycle |
| `GET` | `/api/office/sessions/:id/content` | **Signed URL** (DS or BFF-minted token), not browser cookie alone | Binary download for Document Server | path, revision, expiry, ACL re-check |
| `POST` | `/api/office/callback` | Callback JWT / nonce (DS → BFF) | SaveCallback pipeline → vault.write CAS | path, base_revision, nonce |

**Explicit non-routes**

- Do **not** extend `GET /api/vault/content` as the Document Server download path.
- Do **not** accept vault path or `expected_revision` from the callback body as
  authoritative — only from `OfficeDocumentSession`.
- Do **not** expose `callback_nonce` or raw session records to the web bundle
  beyond what editor config requires.

---

## 5. How the model prevents failure modes

### 5.1 Stale ONLYOFFICE keys

| Mechanism | Type / rule |
| --- | --- |
| Key material includes `DocumentRevision.token` | `OfficeDocumentSession.document_key` |
| Successful vault write advances revision | New session mint ⇒ new key |
| Dirty session does not auto-swap key on external update | `ArtifactPanelState` → `conflict`; lifecycle `superseded_base` |
| Expired sessions cannot download | `expires_at` + lifecycle gate on content route |

Without revision in the key, Document Server would serve cached bytes after an
agent rewrite. The type system makes revision a required field at mint time.

### 5.2 Cross-tenant cache collisions

| Mechanism | Type / rule |
| --- | --- |
| `tenant_id` required on `OfficeDocumentSession` | Server-stamped from auth, not client body |
| `document_key = digest(v1\|tenant\|path\|revision…)` | Collision across tenants requires hash collision |
| Lab shared Document Server still safe | Tenants never share key material |

Raw path keys are rejected by design (conflict policy §4).

### 5.3 Agent / human overwrite conflicts

| Mechanism | Type / rule |
| --- | --- |
| Session `dirty` + path ownership on BFF | Agent `replace_if_match` on canonical path blocked or redirected |
| `vault.write` modes (`create_new` \| `replace_if_match` \| `write_checkpoint`) | Hard to express bare overwrite (`lp-5q6.18`) |
| `replace_if_match` requires `expected_revision: DocumentRevision` | Host CAS; `ConflictState.reason = revision_mismatch` |
| `ArtifactUpdatedEvent.write_kind` | Pane distinguishes checkpoint vs canonical |
| `ConflictState.offered_actions` | UI cannot invent silent overwrite paths |

Pane `localDirty` is UX-only; **server** session + host CAS are authoritative
(conflict policy §2.5).

---

## 6. Design alternatives rejected

| Alternative | Why rejected |
| --- | --- |
| Scatter `isPaneOpen` / `dirty` / `conflict` booleans across ChatView and VaultReader | Violates model-the-domain; races and lost transitions; hard tests. Use `ArtifactPanelState` reducer. |
| Reuse `tool_progress` alone as the document protocol | Tool rows are noisy (self-improve filters); missing open/close/revision; history mapping unclear. Dedicated `ArtifactEvent` union (`lp-5q6.10`) with optional bridge from tools. |
| Put `OfficeDocumentSession` in the browser (localStorage) | Client could retarget path, forge revision, or skip ACL. Session is BFF-owned; web holds opaque id only. |
| Use path string as ONLYOFFICE `document.key` | Cross-tenant and cross-revision cache collisions; length/charset issues. Digest(tenant, path, revision). |
| Extend `GET /api/vault/content` JSON/base64 for Document Server | 1–4 MiB cap; wrong shape for DS; couples preview ACL cache to editor. Separate signed binary route (`lp-5q6.17` / `.22`). |
| Live agent co-author inside Document Server (Automation API primary) | Epic non-goal; operational and license complexity; agent work is headless + checkpoints. |
| Last-writer-wins vault writes without revision | Silent data loss under concurrent human/agent. CAS + staged checkpoints. |
| Single global “current document” without `openGeneration` | Re-click same citation path no-ops in React; deep-link bugs (HOW gotcha). |

---

## 7. Mapping to implementation beads

| Domain piece | Bead(s) |
| --- | --- |
| Freeze artifact event wire protocol + fixtures | `lp-5q6.10` |
| Shared parse/normalize | `lp-5q6.11` |
| `ArtifactPanelState` reducer + tests | `lp-5q6.12` |
| Pane shell + preview host reuse | `lp-5q6.13`–`lp-5q6.15` |
| Progress UX from events | `lp-5q6.16` |
| Revision + binary transfer | `lp-5q6.17` |
| Typed `vault.write` | `lp-5q6.18` |
| Session store + download + callback + key policy | `lp-5q6.21`–`lp-5q6.24` |
| Editor host + flags | `lp-5q6.27`, `lp-5q6.30` |
| Dirty human vs agent policy enforcement | `lp-5q6.32` → [portal-active-human-edit-agent-write-policy.md](portal-active-human-edit-agent-write-policy.md) |

---

## 8. Acceptance checklist (`lp-5q6.6`)

| Criterion | Where satisfied |
| --- | --- |
| Typed models for `VaultArtifactRef`, `ArtifactEvent`, `ArtifactPanelState`, `OfficeDocumentSession`, `DocumentRevision`, `SaveCallback`, `ConflictState` | §2.1–§2.7 |
| Module boundaries: shared types, BFF Office endpoints, web pane reducer, vault preview host, Office editor host, deploy config | §3 |
| Caller usage first, then type sketch and route sketch | §1 → §2 → §4 |
| Model prevents stale keys, cross-tenant cache collisions, agent/human overwrite conflicts | §5 |
| Design alternatives rejected and why | §6 |

No product code in this bead. No secrets. Implementation must not invent parallel
ad-hoc shapes that bypass these types without updating this document.
