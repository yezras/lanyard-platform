# Chat transcript durability across process restart

**Bead:** `portal-c0q.3`  
**Status:** Decision recorded — **do not implement in this PR**  
**Date:** 2026-07-10

## Problem

Portal chat transcript hydrate (`GET /api/chat/threads/:threadId/history`) is only **process-lifetime durable**:

| Store | Package | What it holds | Lifetime |
| --- | --- | --- | --- |
| `ChatThreadStore` threads + history | `packages/bff` | Thread metadata; `user_message` events (and, after tee / portal-c0q.1, outbound teed from SSE) | In-memory `Map`s — lost on BFF restart |
| `ChatDeliveryHub` history | `packages/relay` | Outbound events (`message_send`, tools, reasoning, mcq; no typing) | In-memory `Map` — lost on relay restart |
| Sessions | `packages/bff` `SessionStore` | Cookie sessions | In-memory — orthogonal |
| Control plane | `packages/control-plane` | Tenants, users, RBAC, projects, session shares | **SQLite** (`better-sqlite3`) — durable |

Acceptance for a full fix:

> Same thread survives **BFF + relay** restart with **full user + assistant** history.

Reload-within-process already works via portal-wak.1 (in-memory history + merge). Restart does not.

## Current data path (as of this worktree)

1. **Create thread** → `ChatThreadStore.create` (BFF memory only).
2. **POST message** → relay inbound; BFF `appendHistory(user_message)`.
3. **SSE proxy** → live outbound from relay; history merge on GET still pulls **relay** `/internal/chat/:id/history` for assistant/tool rows.
4. **GET history** → merge BFF `listHistory` + relay `fetchChatHistory`, sort by `created_at`.

So today:

- BFF restart alone → threads vanish (404); user rows gone even if relay still has outbound.
- Relay restart alone → assistant/tool rows gone; user rows may still hydrate if BFF stayed up.
- Both restart → empty.

`testing.md` already notes: BFF `ChatThreadStore` is in-memory; restarting the bff tmux window clears threads while users/roles in control-plane SQLite persist.

## Existing persistence patterns in the monorepo

| Pattern | Where | Fit for chat? |
| --- | --- | --- |
| **SQLite WAL (`better-sqlite3`)** | Control plane `ControlPlaneStore` | Strong model: schema migrate, indexes, sync writes. Chat is **not** control-plane domain (per-tenant ops DB vs portal BFF process state). |
| **`node:sqlite` (`DatabaseSync`)** | BFF Hermes `projects.db` read + test fixtures | Built-in; no new dep. Good for a **local BFF-owned** DB file if we want zero native addons. |
| **YAML/JSON files** | Settings snapshot / Hermes config under hermes home | Fine for small config; poor for append-heavy multi-thread transcripts (rewrite, concurrency). |
| **Vault / staging FS providers** | User documents, uploads | Wrong domain (user files, not portal chat timeline). |
| **Relay retention gate** | `shouldPersistInteraction` | Explicit **default off** for long-term Lanyard interaction export. Process-local hydrate is a different product surface than ops export. |
| **Beads / Dolt** | Issue tracking only | Not an application store. |

There is **no** existing BFF path like `CHAT_STORE_PATH` / `.data/chat.db`. Config today covers control plane URL, relay, session secret, vault root, settings snapshot path — not chat durability.

## Decision

**Document only for `portal-c0q.3` — do not implement durable storage in this change.**

### Why not implement now

1. **Prerequisite / parallel work:** Full user+assistant survival after dual restart requires **outbound events in the same durable store as user rows**, or dual persistence. Outbound tee into BFF history is **portal-c0q.1** (owned elsewhere). Implementing file/SQLite for **user_message-only** BFF history would not meet the acceptance criterion and risks conflicting edits to `chat-store.ts` / `app.ts` history merge.
2. **Scope vs “small PR”:** A correct minimal store must persist **threads + history events** (title/project/delete), load on boot, cap ring buffers, and wire config/env — plus tests for restart simulation. That is more than a drop-in Map swap once product/privacy flags are considered.
3. **Privacy posture:** Relay retention defaults to **not** long-term body storage. Portal hydrate today is intentionally process-lifetime (portal-wak.1). Crossing into on-disk transcripts should be an explicit, env-gated product choice with a documented data path — not a silent side effect of a small PR.
4. **Single source of truth:** Prefer **one durable owner (BFF)** after tee, not BFF file store *and* durable relay history (duplicate bodies, harder delete/TTL, dual restart races).

### Recommendation (future implement bead)

**BFF-owned SQLite (or `node:sqlite`) chat store**, optional via env, default off or default on only for local `.data/` in dev — product call.

#### Target architecture

```
POST /messages  ──► append user_message ──► ChatThreadStore (memory + disk)
SSE proxy tee   ──► append outbound*    ──► same store   (* portal-c0q.1)
GET /history    ──► listHistory from BFF only when durable/full;
                    optional relay merge only for live tail / pre-tee compat
Relay hub       ──► remains process-lifetime pub/sub + short buffer (not SoT)
```

#### Schema sketch

```sql
CREATE TABLE chat_threads (
  thread_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  project_id TEXT,
  project_vault_path TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_chat_threads_owner
  ON chat_threads(tenant_id, user_id, created_at DESC);

CREATE TABLE chat_history_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES chat_threads(thread_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  event_json TEXT NOT NULL  -- ChatHistoryEvent as JSON
);
CREATE INDEX idx_chat_history_thread
  ON chat_history_events(thread_id, id);
```

Cap: keep last `MAX_HISTORY_EVENTS` (2000) per thread on append (delete oldest by `id`).

#### API surface (keep additive)

Leave public methods on `ChatThreadStore` stable:

- `create` / `get` / `getInTenant` / `listForOwner` / `getForUser` / `updateTitle` / `delete`
- `appendHistory` / `listHistory` / `clearHistory`

Implementation options:

1. **Preferred:** constructor `options?: { dbPath?: string }` — if set, open SQLite, load threads into memory (or query-through), sync write on mutate; if unset, current pure memory (tests unchanged).
2. Mirror control plane: `better-sqlite3` + WAL for multi-writer safety within one process; **or** `node:sqlite` `DatabaseSync` to avoid native deps (align with Hermes projects helper).

Wire in `packages/bff/src/index.ts` + `config.ts`:

- `CHAT_STORE_PATH` → e.g. `.data/chat.db` (gitignore `.data/` already used for demo env).

#### History GET behavior after durability

| Phase | Behavior |
| --- | --- |
| Pre-tee (today) | Merge BFF user + relay outbound |
| Post-tee, memory only | BFF may hold full timeline; merge still works |
| Post-tee + durable BFF | **Prefer BFF `listHistory` as SoT**; still optionally union relay for events not yet teed if any race |
| Durable BFF only, no durable relay | Dual process restart satisfied **if tee is complete** |

Do **not** make control plane the chat transcript DB (wrong lifecycle, multi-tenant ops DB bloat, couples auth service to chat volume).

Do **not** persist relay hub history as the primary store (relay is multi-tenant edge; secrets/session model differs; BFF already owns thread ACL and user rows).

#### Retention / privacy

- Portal disk hydrate ≠ control-plane `interaction_export_enabled`.
- Document that `CHAT_STORE_PATH` stores message bodies on the BFF host.
- Future: TTL job, per-tenant disable, or wipe on logout are out of scope for the first implement bead.
- Align with ops retention only if product requires export parity later.

#### Tests (implement bead acceptance)

1. Unit: `ChatThreadStore` with temp SQLite — create thread, append user + outbound-shaped events, construct **new** store on same path → `listForOwner` + `listHistory` intact; delete removes history.
2. Integration: POST message → (with tee) wait for assistant → restart store (or new app bindings with same path) → GET history has user + assistant; thread still in list.
3. Default memory path: existing chat integration tests remain green with `new ChatThreadStore()`.

#### Non-goals (first implement bead)

- Multi-instance BFF shared store / Redis.
- Encrypting DB at rest.
- Persisting sessions (still cookie memory).
- Durable relay history.
- Migrating control-plane retention export into chat.db.

## Dependency order

```
portal-c0q.1  BFF tee of outbound into ChatThreadStore history
      │
      ▼
portal-c0q.3-implement  (new)  Optional SQLite/file backing for ChatThreadStore
      │
      ▼
Acceptance: dual restart → full transcript
```

If tee lands first with memory-only store, reload-after-refresh without process death improves when relay is down mid-session; **restart** still needs this implement work.

## Acceptance criteria (future implement)

- [ ] With `CHAT_STORE_PATH` set, create thread + exchange messages (user + assistant after tee).
- [ ] Kill/restart BFF **and** relay; same `thread_id` still listed for owner.
- [ ] `GET /api/chat/threads/:threadId/history` returns full user + assistant (+ tools if teed) for that thread.
- [ ] With path unset, behavior matches today (memory-only); unit/integration suite green.
- [ ] Thread delete removes durable history rows.
- [ ] Cap still enforced (≤ ~2000 events/thread).
- [ ] No requirement to persist relay hub history for the acceptance path.
- [ ] Design/notes updated if default path or privacy defaults change.

## Files to touch (implement bead only)

| File | Change |
| --- | --- |
| `packages/bff/src/chat-store.ts` | Optional SQLite backing; keep in-memory API |
| `packages/bff/src/config.ts` | `chatStorePath` from `CHAT_STORE_PATH` |
| `packages/bff/src/index.ts` | `new ChatThreadStore({ dbPath })` |
| `packages/bff/package.json` | Only if choosing `better-sqlite3` |
| `packages/bff/test/chat-store.persistence.test.ts` (new) | Restart simulation |
| `README.md` / `testing.md` | Env var + note replacing “in-memory only” |
| `packages/bff/src/app.ts` | Prefer **minimal** change; history merge may simplify to BFF-first after tee — coordinate with portal-c0q.1 |

## Explicit non-change for this bead

- No code implementation of durable chat storage.
- No edits to SSE tee / history merge (portal-c0q.1).
- No relay persistence changes.

## Summary

| Question | Answer |
| --- | --- |
| Implement now? | **No** — document decision |
| Why? | Full dual-restart acceptance needs tee (c0q.1) + durable BFF store; privacy/env gating; avoid parallel conflict; not a clean one-file PR yet |
| Recommended design | BFF SQLite/`node:sqlite` for threads + `ChatHistoryEvent` JSON rows; env path; BFF becomes SoT after tee |
| Next bead | Implement store after or with c0q.1; tests simulate process restart via new store instance on same path |
