# HOW: Portal chat, vault, BFF, relay, and Brain RPC document paths

**Bead:** `lp-5q6.5`  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Status:** Source-grounded (read live packages; do not treat as product code)  
**Date:** 2026-07-24  

## Purpose

Ground the document-pane / ONLYOFFICE epic against **current** Portal source so later beads do not mistake the existing **VaultReader JSON preview API** for a production path for large Office binaries or ONLYOFFICE download/writeback.

This note is input to:

- `lp-5q6.6` architect domain model  
- `lp-5q6.10` / `lp-5q6.11` artifact events  
- `lp-5q6.13`–`lp-5q6.16` chat document pane  
- `lp-5q6.17`–`lp-5q6.20` binary transfer + `vault.write`  
- `lp-5q6.21`–`lp-5q6.28` ONLYOFFICE BFF bridge  

Related wire sketch (tools/citations only):  
[`portal/artifacts/hermes-lanyard-tool-citations-contract.md`](../../../portal/artifacts/hermes-lanyard-tool-citations-contract.md)

---

## 1. Citation click and tool-target → Vault tab (today)

There is **no chat document pane**. Citations and file-like tool targets leave Chat and switch the shell tab to **Vault**.

### End-to-end

```text
Hermes / mock gateway  OutboundAction (send|edit)
        │  metadata.portal_event = "tool_progress"
        │  metadata.citations = [{ path, title }, …]   (final send)
        ▼
relay  WebPlatformAdapter
        → outboundActionToChatEvents / outboundActionToChatEvent
        → ChatDeliveryHub.publish (SSE + ring history)
        ▼
BFF    GET /api/chat/threads/:threadId/events  (SSE proxy)
        + tee durableOutboundFromRelayEvent into ChatThreadStore
        ▼
web    useChatEvents (EventSource + history hydrate)
        → assistant_turn.toolCalls / citations
        ▼
       ChatTimeline → ChatMessageContent
        → VaultCitationChip / Markdown source click
        → onCitationClick(resolvedPath)
        ▼
       ChatView.onCitationNavigate
        → PortalShell.handleCitationNavigate
        → openVaultPath(path)
             set vaultDeepLinkPath + vaultDeepLinkKey
             setActiveView("vault")
        ▼
       VaultView deep-link effect
        → fetchVaultContent(path) → VaultReader
```

### Key files

| Layer | Path | Role |
| --- | --- | --- |
| Relay map | `portal/packages/relay/src/chat-delivery-hub.ts` | `detectToolProgress`, `extractCitations`, `outboundActionToChatEvent(s)`, hub history |
| Relay publish | `portal/packages/relay/src/web-platform-adapter.ts` | Gateway outbound → hub |
| Web reduce | `portal/packages/web/src/hooks/useChatEvents.ts` | SSE → timeline; `citationsFromToolCalls`; history replay |
| Chips / click | `portal/packages/web/src/features/chat/ChatMessageContent.tsx` | `activateVaultCitation`, `resolveVaultCitationClickPath` |
| Timeline | `portal/packages/web/src/features/chat/ChatTimeline.tsx` | Passes `onCitationClick` |
| View wire | `portal/packages/web/src/features/chat/ChatView.tsx` | `onCitationNavigate` prop |
| Shell | `portal/packages/web/src/layout/PortalShell.tsx` | `openVaultPath` → vault tab + deep-link key |
| Context | `portal/packages/web/src/features/vault/VaultDeepLinkContext.tsx` | `openVaultPath` API for other callers |
| Path join | `portal/packages/web/src/features/vault/vaultPaths.ts` | Project-relative → vault-absolute |
| Vault open | `portal/packages/web/src/features/vault/VaultView.tsx` | Deep-link open + tree focus |
| Mock demo | `portal/scripts/dev-mock-gateway.ts` | Canned `tool_progress` + citations |

### Citation sources (priority)

1. **Explicit** `metadata.citations` / `portal_event: "citation"` on final `message_send` (relay → SSE `citations[]`).
2. **Fallback** on turn finalize: file-like `tool_target` values promoted via `citationsFromToolCalls` (joined with `projectVaultPath` when relative).
3. Paths should be vault-absolute (`/…`) for reliable open; relatives need `project_vault_path` on the thread.

### Gotchas for the pane epic

- **Tab switch is hard-coded.** `openVaultPath` always `setActiveView("vault")`. Pane work (`lp-5q6.13` / `lp-5q6.14`) must introduce a second open mode (stay on Chat + right pane) without breaking Vault-tab deep-link.
- **Re-click same path** needs `vaultDeepLinkKey` (monotonic) — React bails on identical `deepLinkPath` strings.
- **Keep-alive panes:** Chat and Vault stay mounted (`KeepAlivePane` / `display:contents|none`) so chat SSE/state survives tab switches. A document pane should follow the same keep-alive discipline.
- Tool rows do **not** currently open vault; only citation chips / vault-looking markdown links do. Routing `tool_target` into a pane is new work (`lp-5q6.14`).

---

## 2. Vault preview flow (web → BFF → Brain RPC / fixture)

### HTTP surface (read-only)

| Client API | HTTP | Production (Brain RPC on) | Dev / tests (flag off) |
| --- | --- | --- | --- |
| `fetchVaultTree()` | `GET /api/vault/tree` | Bounded initial snapshot via `vaultHandlers.tree` → recursive `vault.list` / `vault.stat` | `VaultService.getTree` + FS/fixture provider |
| `fetchVaultEntries(path, cursor?)` | `GET /api/vault/entries?path=&cursor=` | Lazy folder pages via `vault.list` | `VaultService.listEntries` (complete local page) |
| `fetchVaultContent(path)` | `GET /api/vault/content?path=` | `vault.read` | `VaultService.readContent` |
| `searchVaultIndex(q)` | `GET /api/vault/search?q=` | **Local index only** (no Brain RPC search method yet) | Fixture/FS index |

Web client: `portal/packages/web/src/api/vault.ts`  
BFF routes: `portal/packages/bff/src/app.ts` (`/vault/tree`, `/entries`, `/content`, `/search`)  
Brain RPC adapter: `portal/packages/backend-runtime/src/vault-bff.ts`  
Composition: `portal/packages/bff/src/backend-runtime-compose.ts` (`createProductionBackendRuntimeService`)  
Local service: `portal/packages/bff/src/vault/service.ts`  
Providers: `fixture-provider.ts`, `fs-provider.ts`, `multi-root-fs-provider.ts`

### Response shape (`GET /api/vault/content`)

JSON body compatible with web `VaultFileContent`:

```text
path, kind: "file", mime_type, encoding: "utf-8" | "base64", content, size_bytes
(+ source when Brain RPC path)
```

Binary Office bytes arrive as **base64 inside JSON**. `VaultReader` decodes and hands buffers to client preview libs (`docx-preview`, SheetJS, `pptx-preview`, PDF iframe) in:

- `portal/packages/web/src/features/vault/VaultReader.tsx`
- `portal/packages/web/src/features/vault/vaultOffice.ts`

### Brain RPC size envelope (normative)

From `contracts/backend-runtime-v1/brain-rpc.schema.json` / README:

| Limit | Value |
| --- | --- |
| `vault.read` default max | **1 MiB** |
| `vault.read` hard max | **4 MiB** (`max_bytes` ≤ 4194304) |
| Oversized | `payload_too_large` — **no partial dump** |
| Encoding | utf-8 for text-like MIME; base64 for binary |

### Critical product constraint

> **`vault.read` + `GET /api/vault/content` is a small-file JSON preview API.**  
> It is **not** the production path for large Office files or for ONLYOFFICE Document Server download.

Document Server needs a **fetchable binary URL** (streamed bytes, signed, short-lived), not a base64 JSON field under 1–4 MiB. That binary contract is `lp-5q6.17` / BFF Office download (`lp-5q6.22`), not an extension of VaultReader.

### ACL

- BFF: `assertVaultPathAccess` / shared `isVaultPathAllowed` on subject `allowed_path_prefixes`.
- Brain RPC path: subject path prefixes + host path ACL; adapter re-filters with `isVaultPathAllowedByPrefixes` (defense in depth).
- Empty prefix list → **deny** (empty tree; no silent walk of `/`).

### Tree walk caps (Brain RPC)

`VAULT_TREE_MAX_DEPTH = 8`, `VAULT_TREE_MAX_NODES = 500`, list page limit 200 (`vault-bff.ts`).

`GET /api/vault/tree` is only the bounded initial tree snapshot. When it
returns `truncated: true`, the UI must say the snapshot is partial rather than
claiming the vault is unavailable. Folder expansion uses
`GET /api/vault/entries?path=&cursor=` to fetch children on demand, preserving
the same ACL checks and Brain RPC fail-closed behavior. `next_cursor` keeps
large folders paginated through explicit load-more rows.

---

## 3. `tool_progress` metadata and durable history

### Live path

```text
OutboundAction.metadata
  portal_event: "tool_progress"
  tool_name, tool_call_id, tool_status, tool_target,
  duration, result, additions, deletions, node, tool_kind, subagent_name, …
        ▼
outboundActionToChatEvent → ChatOutboundEvent { type: "tool_progress", … }
        ▼
ChatDeliveryHub.publish
  → SSE subscribers (BFF proxies to browser)
  → in-memory ring (MAX 2000, no typing)
        ▼
BFF SSE handler tees durableOutboundFromRelayEvent → ChatThreadStore.appendHistory
        ▼
useChatEvents applyChatEvent
  → upsert tool row on open assistant_turn.toolCalls
```

Fallback when Hermes emits emoji tool chrome **without** structured `portal_event`: relay heuristics (`detectToolProgress` / multi-line expand). Structured `portal_event: "tool_progress"` is preferred (single event per call; not re-expanded).

### History hydrate

```text
GET /api/chat/threads/:threadId/history
  → mergeChatHistoryEvents(BFF listHistory, relay fetchChatHistory)
  → de-dupe (type, message_id, tool_call_id, content)
  → sort by created_at
        ▼
web fetchChatHistory → historyEventsToTimelineItems
  → same applyChatEvent reducer as live SSE
```

Key files:

| Layer | Path |
| --- | --- |
| Relay hub | `portal/packages/relay/src/chat-delivery-hub.ts` |
| BFF store | `portal/packages/bff/src/chat-store.ts` (`durableOutboundFromRelayEvent`, `mergeChatHistoryEvents`) |
| BFF history route | `portal/packages/bff/src/app.ts` `GET …/history` + SSE tee |
| Relay client | `portal/packages/bff/src/relay-client.ts` `fetchChatHistory` |
| Web API | `portal/packages/web/src/api/chat.ts` `fetchChatHistory` |
| Web reduce | `portal/packages/web/src/hooks/useChatEvents.ts` |

### Durability reality

- **Within process / reload:** works (BFF tee + optional SQLite when `CHAT_STORE_PATH` set; relay ring fills gaps).
- **Process restart:** still weak unless BFF durable store is enabled and outbound was teed; see `portal/artifacts/chat-transcript-durability.md`.
- Durable event types: `user_message`, `message_send`, `message_edit`, `tool_progress`, `reasoning`, `mcq`. **`typing` is never durable.**

### Implications for document pane

- Agent file work today surfaces as **tool rows + optional citations**, not as a dedicated artifact/document protocol.
- Pane refresh on agent write needs a **new** artifact event contract (`lp-5q6.10`) or disciplined reuse of `tool_progress` + path conventions (`lp-5q6.11`). Do not invent a second SSE type without shared types in `packages/shared` / relay.
- History replay must reconstruct pane-relevant events the same way `historyEventsToTimelineItems` replays tools.

---

## 4. Brain RPC vault methods (current contract)

Normative catalog: `contracts/backend-runtime-v1/brain-rpc.schema.json`  
Narrative: `contracts/backend-runtime-v1/README.md`  
Conformance matrix: `contracts/backend-runtime-v1/conformance.md`

### Required v1 (implemented surface for browser vault)

| Method | Purpose | Caps / notes |
| --- | --- | --- |
| `vault.list` | Directory metadata, paginated | Default limit 200, max 500; path ACL; cursor |
| `vault.stat` | Single-path metadata | Path ACL; missing → `not_found` |
| `vault.read` | Single-file **content** | Default 1 MiB, hard 4 MiB; utf-8 \| base64; directories → `invalid_argument` |

Capabilities: `vault_read` / `vault_full` (methods list/stat/read).  
Portal UI feature `vault_browser` maps to those methods (`capabilities.schema.json`).

### Expansion / write path

| Method | Status | Today |
| --- | --- | --- |
| `vault.write` | Typed expansion (`lp-5q6.18`) | Schema: `params_vault_write` / `result_vault_write`. **Host:** Hermes-Lanyard implements inline plane (`lp-5q6.20`); see [`hermes-lanyard-vault-write.md`](../../architecture/hermes-lanyard-vault-write.md) |
| Capability | `vault_write` / feature `vault_editor` | Host advertises only when `HANDLERS` includes `vault.write`. **No** BFF write route yet (`lp-5q6.19`) |

Portal `VaultService` has **no** write method. Staging upload (`POST /api/staging/upload`) is a separate path for user uploads, not vault writeback.

### Auth layers (vault path methods)

Channel → tenant/instance → Portal session → stamped subject → host profile caps → **path ACL**. Fail-closed.

### Backend variance (conformance snapshot)

| Backend | list/stat/read RPC | vault.write |
| --- | --- | --- |
| Hermes-Lanyard | Live MVP handlers (list/stat/read) | **Implemented** on product pin (inline + CAS); advertise only when handler registered. `content_ref` fail-closed until BFF spool |
| Fake backend (portal tests) | Yes | Shape harness only unless tests simulate write |
| Lanyard Agent | Gaps per matrix | No (LA-EXP-02 still open) |

ONLYOFFICE production writeback still needs BFF capability gate (`lp-5q6.19`) + callback (`lp-5q6.23`) + staged `content_ref` for large Office bodies.

---

## 5. Implementation note — files to touch and gotchas

### Recommended first code surfaces (later beads; not this HOW)

| Concern | Primary touch points | Avoid |
| --- | --- | --- |
| Chat document pane shell | `ChatView.tsx`, `chatLayout.ts` / `chat.css`, new `features/documents/` (or `features/chat/DocumentPane*`) | Replacing Vault tab wholesale |
| Citation → pane (not Vault tab) | `PortalShell.tsx` `openVaultPath` / new `openDocumentPath`; `ChatMessageContent` / `ChatView` | Breaking Vault-tab deep-link for users who want full browser |
| Reuse preview in pane | Extract or wrap `VaultReader` + `fetchVaultContent` | Forking a second reader stack |
| Artifact / progress events | `packages/shared` types → relay `chat-delivery-hub` → `useChatEvents` → pane reducer | Parsing only in web without relay history |
| Binary download for Document Server | **New** BFF routes (signed GET stream) | Extending JSON `/api/vault/content` for multi‑MB Office |
| Writeback | Typed `vault.write` in contracts + backend-runtime + host; BFF callback | Writing through VaultReader or client base64 POST to content API |
| ONLYOFFICE config JWT | New BFF module; secrets from deploy | Embedding long-lived secrets in web |

### Gotchas checklist

1. **Size wall:** `vault.read` 1–4 MiB JSON/base64 will break real DOCX/XLSX/PPTX. Pane MVP can use preview for small files; Office edit needs binary transfer.
2. **No write path today:** any “save” UI will lie until `vault.write` is real and capability-gated.
3. **Citation UX today switches tabs:** pane must opt-in without regressing `VaultDeepLink` tests (`PortalShell.test.tsx`, `VaultView` deep-link, `ChatTimeline` citation tests).
4. **Path identity:** multi-root trees, project-relative citations, and `findVaultTreeFilePath` fallbacks — pane path resolution must share `vaultPaths.ts` helpers.
5. **ACL twice:** BFF RBAC prefixes and host Brain RPC ACL; signed download URLs must re-check ACL at issue and at fetch.
6. **Document Server reachability:** DS fetches BFF URL on its network; Brain RPC is not callable from DS. BFF is the only storage boundary DS may see (epic design).
7. **Revision / key:** agent vault rewrites while a human editor is open need a document-key policy (`lp-5q6.24`); preview-only open has no such key.
8. **History:** new artifact events must be durable types included in `durableOutboundFromRelayEvent` or pane state will vanish on reload.
9. **Self-improve / noise tools:** `useChatEvents` filters some tool rows from `ChatToolCalls`; artifact open logic should not treat every `tool_target` as a document.
10. **Search stays local:** vault search is not Brain RPC; do not block Office work on search.

### Smallest safe sequencing (from this grounding)

```text
1. Domain model + path open modes (shell vs pane)     lp-5q6.6 / .12 / .13
2. Route citations + file tool targets into pane        lp-5q6.14
3. Artifact events for agent file checkpoints           lp-5q6.10 / .11 / .16
4. Binary transfer contract (not vault.read JSON)       lp-5q6.17
5. Typed vault.write + BFF + host                       lp-5q6.18–.20
6. ONLYOFFICE lab bridge (download/callback/JWT)        lp-5q6.21–.28
```

Ship pane UX on **existing previews** first; treat ONLYOFFICE as the human editor once storage + license + topology beads clear.

---

## 6. Acceptance map (this bead)

| Criterion | Evidence in this note |
| --- | --- |
| Trace citation / tool target → ChatTimeline → PortalShell / pane | §1 end-to-end + file table |
| Trace vault preview web → BFF → Brain RPC / fixture | §2 |
| Trace tool_progress + durable history | §3 |
| Trace vault.list / stat / read + placeholder vault.write | §4 |
| Short implementation note: files + gotchas | §5 |

No product code migrated in this bead. No secrets.
