# Portal UI polish — implementation plan (14 items)

## Context

The React + Astryx shell already has Chat, Vault, Settings, collapsible chat history, reasoning SSE, and Hermes settings discovery. Remaining gaps match user requests 1–14: collapsed rail chrome, projects/directories, delete chats, **tab keep-alive**, continuous CoT + tool calls, tokenized composer, profile hover, vault FS live tree, greeting, skills/cron toggles, models grouping, message metadata/ghost/citations.

Prior art: `artifacts/portal-ux-polish-plan.md` (partially shipped). This plan is the next epic on branch `portal-hq7-ux-polish`.

**Tracking (created):** epic **`portal-qk3`** + 4 slices + 13 subtasks. Claim with `bd update <id> --claim`. Conservative profile — no commit/push unless asked.

| Bead | Scope |
|------|--------|
| `portal-qk3` | Epic — all 14 items |
| `portal-qk3.1` | Slice A (items 1,2,3,6,8) — ready first |
| `portal-qk3.1.1`–`.1.5` | A1 collapse · A2 projects/delete · A3 tab keep-alive · A4 HoverCard · A5 greeting |
| `portal-qk3.2` | Slice B (4,5,12,13,14) — depends on A |
| `portal-qk3.2.1`–`.2.4` | B1 CoT/tools · B2 tokens · B3 metadata · B4 ghost+citations |
| `portal-qk3.3` / `.3.1` | Slice C vault (7) — depends on A |
| `portal-qk3.4` / `.4.1`–`.4.3` | Slice D settings (9,10,11) — depends on A |

---

## Root causes (today)

| # | Issue | Why |
|---|--------|-----|
| 1 | Collapsed rail shows crushed text | Astryx `SideNavItem` already hides labels when `isCollapsed`; **custom chrome does not** — `topContent` uses full `Button label="New chat"`, Settings header is plain `Heading`/`Text`, Vault SideNav has **no** `collapsible` |
| 2 | No new project / directory switch / delete | Web only `fetchProjects`; BFF has `POST/DELETE /api/projects` but no create UI. No `DELETE /api/chat/threads/:id` or store `delete` |
| 3 | Chat empty after tab switch | `PortalShell` **unmounts** `ChatView` when `activeView !== "chat"`; `useChatEvents` state dies |
| 4 | CoT/tool stream incomplete | Reasoning is separate collapsible; `tool_progress` is **ephemeral** (`toolProgress` string cleared on next event), not a durable timeline `ChatToolCalls` list |
| 5 | No `/` `@` tokens | `ChatComposerInput` has no `triggers` |
| 6 | No profile menu | `UserChip` is static; BFF already has `POST /api/auth/logout` |
| 7 | Vault empty / no collapse / no live | Vault SideNav not collapsible; tree empty without `VAULT_ROOT` + ACL; no poll for new files |
| 8 | Placeholder "Message your brain…" | Hardcoded in `ChatView` |
| 9–10 | Skills/crons path + static badges | Read-only snapshot; no toggle API; cron raw schedule, no last/next |
| 11 | Flat models table | No active highlight, provider groups, or connectivity |
| 12–14 | Metadata / ghost / citations | Partial ghost already; no `ChatMessageMetadata`, no citation protocol or vault deep-link |

---

## Recommended approach

Ship **four vertical PR slices**. Prefer Astryx primitives named by the user. Keep views mounted for tab switches (CSS hide), not remount.

### Assumptions (defaults)

1. **Directory switcher** = project / working vault folder (`Project.vault_path`), not raw OS path picker.
2. **Display name** for greeting: local-part of email (`dev@demo.local` → `dev`); no separate profile name field today.
3. **Switch account** = logout → unauthenticated `AuthView` (no multi-session account picker).
4. **Skill/cron toggle** = BFF writes Hermes config when `HERMES_HOME` is real; fixture mode optimistically toggles in-memory / returns 501 with UI toast if not writable.
5. **Citations** = gateway metadata `portal_event: "citation"` or `metadata.citations: [{path,title}]` on final message; UI falls back to empty if absent.
6. **Tool calls** = upgrade `tool_progress` into durable timeline items + map richer metadata (`tool_name`, `status`, `target`) when present; else label-only `ChatToolCalls`.

---

## Slice A — Shell: collapse, projects, delete, tabs, profile, greeting

**Items:** 1, 2, 3, 6, 8

### Critical files

| File | Change |
|------|--------|
| `packages/web/src/layout/PortalShell.tsx` | Keep-alive views; `UserProfileHover` in `endContent`; pass `user` into chat for greeting |
| `packages/web/src/features/projects/ChatHistorySideNav.tsx` | Collapse-aware New chat / New project; directory `Selector` or `DropdownMenu`; thread `MoreMenu` delete; icons only when collapsed |
| `packages/web/src/features/projects/ChatThreadContext.tsx` | `createProject`, `deleteThread`, directory selection |
| `packages/web/src/api/projects.ts` | `createProject({ name, vault_path, parent_project_id? })` |
| `packages/web/src/api/chat.ts` | `deleteChatThread(threadId)` |
| `packages/bff/src/chat-store.ts` + `app.ts` | `delete(threadId)` + `DELETE /api/chat/threads/:threadId` (owner only) |
| `packages/web/src/features/chat/ChatView.tsx` | Placeholder `Hello, {displayName}.` |
| `packages/web/src/features/settings/SettingsView.tsx` | Collapse-aware header (icon-only when collapsed) |
| `packages/web/src/features/vault/VaultView.tsx` | `collapsible` on SideNav (pair with Slice C) |

### Implementation notes

**1 — Icon-only collapsed rails**

- Chat: control collapse with `collapsible={{ isCollapsed, onCollapsedChange }}` **or** read `useSideNavCollapse()` inside a child of `SideNav` for `topContent`.
- When collapsed: `Button isIconOnly tooltip="New chat" icon={PlusIcon}`; hide directory selector text (icon-only or hide until expand); thread/project rows already icon-only via Astryx if `icon` is set.
- Settings: when collapsed, omit `Heading`/`Text` header or replace with icon-only section markers (items already have icons).
- Vault: enable `collapsible` + same pattern for search (hide search field when collapsed; show icon that expands or opens search).

**2 — Projects, directories, delete**

```
SideNav topContent (expanded):
  [Directory Selector ▼]   // projects by vault_path / name
  [+ New chat] [+ New project]
SideNav items:
  project groups → threads
  thread endContent: MoreMenu → Delete
```

- **New project:** Dialog (`Dialog` + name + vault_path, default path under agent vault root like `/{Name}` or `{selected.primary_path}/{Name}` — not a forced `/Projects/{slug}` namespace) → `POST /api/agent/projects` → refresh `useProjects` / context.
- **Directory dropdown:** sets `selectedProjectId` (reuse `projectSelectOptions` without path noise in label if desired: name primary, path as description).
- **Delete chat:** `MoreMenu` on `SideNavItem.endContent` (see Astryx `SideNavEndContent` template); confirm destructive item; call DELETE; if active thread deleted, select next or create new.

**3 — Persist chat across tabs**

```tsx
// PortalShell — mount all migrated views; hide inactive
<div hidden={activeView !== "chat"} style={{ display: activeView === "chat" ? "contents" : "none", height: "100%" }}>
  <ChatView user={user} />
</div>
// same for vault / settings
```

- Keep `sideNav` for chat history when on chat; optionally keep history rail on all tabs or only chat (current: chat-only — **keep**).
- Do **not** reset `useChatEvents` when view changes; only on `threadId` change (existing).

**6 — Profile HoverCard**

```tsx
import { HoverCard } from "@astryxdesign/core/HoverCard";
// trigger: UserChip
// content: email, Logout, Switch account (both → POST /api/auth/logout + session refresh)
```

- Wire `useSession().refresh` after logout so `App` shows `AuthView`.
- Prefer `HoverCard` as requested; if actions feel flaky on hover, fall back to `Popover` with same content (note in implementation if needed).

**8 — Greeting**

```ts
function displayNameFromEmail(email: string): string {
  return email.split("@")[0] || email;
}
// placeholder: `Hello, ${displayName}.`
```

### Tests

- PortalShell: switch Chat → Vault → Chat keeps timeline text (mock keep-alive).
- ChatHistorySideNav: collapsed New chat is icon-only; MoreMenu delete calls API.
- projects API client + BFF DELETE thread integration.
- ChatView placeholder includes `Hello, dev.` for `dev@demo.local`.

---

## Slice B — Chat stream: CoT, tools, tokens, metadata, ghost, citations

**Items:** 4, 5, 12, 13, 14

### Critical files

| File | Change |
|------|--------|
| `packages/web/src/hooks/useChatEvents.ts` | Durable tool-call items; richer assistant group; optional citations; message status/timestamps/model |
| `packages/web/src/features/chat/ChatTimeline.tsx` | Continuous assistant block: reasoning + `ChatToolCalls` + answer; ghost bubbles; `ChatMessageMetadata`; `Citation` |
| `packages/web/src/features/chat/ChatMessageContent.tsx` | Optional `ChatTokenizedText` for user text; pass through citations |
| `packages/web/src/features/chat/ChatView.tsx` | Composer triggers (`/`, `@`, `#`); wire tokens into submit |
| `packages/web/src/api/types.ts` | Extend `ChatEvent` with tool fields, citations, model, status |
| `packages/relay/src/chat-delivery-hub.ts` | Map tool/citation metadata when present |
| `packages/web/src/layout/PortalShell.tsx` | Citation click → set vault path + switch to Vault (context or callback) |

### Implementation notes

**4 — Continuous CoT + tool calls**

Timeline model (recommended):

```ts
type AssistantTurn = {
  type: "assistant_turn";
  id: string;
  reasoning?: { content: string; isStreaming: boolean };
  toolCalls: ChatToolCallItem[]; // accumulates, not replaced
  content: string;
  isStreaming?: boolean;
  citations?: CitationRef[];
  model?: string;
  createdAt?: string;
  status?: "sending" | "sent" | "error";
};
```

- On `reasoning`: upsert into open turn (expand while streaming).
- On `tool_progress`: **append/update** `toolCalls` with `status: "running" | "complete"` via `ChatToolCalls` (`import { ChatToolCalls } from "@astryxdesign/core/Chat"`).
- On `message_send`/`edit`: set final content; mark tools complete; collapse reasoning by default after answer (keep visible in stream order: reasoning → tools → answer).
- Remove single ephemeral `toolProgress` footer **or** keep only for unknown in-flight without message_id.

**5 — Tokenized composer**

```tsx
import { ChatComposerInput, ChatTokenizedText } from "@astryxdesign/core/Chat";
import { createStaticSource } from "@astryxdesign/core/Typeahead";
```

- `/` → skills from settings snapshot (fetch once / cache): labels = skill names.
- `@` → contexts: vault file paths (from tree cache) + fixed sub-agent stubs (`@agent`, future list).
- `#` → tags/hashtags (static or project tags if available; minimal static set OK).
- Render user bubbles with `ChatTokenizedText` using the same token defs.

**12 — ChatMessageMetadata**

```tsx
import { ChatMessageMetadata } from "@astryxdesign/core/Chat";
// metadata on bubble: timestamp, footer = model, status = sending|sent|error
```

- User message: `sending` on append → `sent` after POST ok → `error` on fail.
- Assistant: timestamp when finalized; model from event metadata or settings active model.

**13 — Ghost**

- Assistant/reasoning/tool containers already use `variant="ghost"` in places; standardize **all** assistant content on `ChatMessageBubble variant="ghost"` per `ChatMessageGhost` template; user stays `filled`.

**14 — Citations → Vault**

```tsx
import { Citation } from "@astryxdesign/core/Citation";
// source: { title, url?: vault-path scheme }
// onClick: navigate to vault + openFile(path)
```

- Portal shell holds `vaultDeepLinkPath` state + `setActiveView("vault")`.
- VaultView accepts initial path prop/context and opens reader.

### Tests

- `useChatEvents`: tool calls accumulate; reasoning streams with answer; citations attach.
- Timeline RTL: `ChatToolCalls` + metadata status + ghost assistant.
- Composer triggers unit (source filters).

---

## Slice C — Vault: collapse, FS mirror, live updates, deep-link

**Item:** 7 (+ citation deep-link from B)

### Critical files

| File | Change |
|------|--------|
| `packages/web/src/features/vault/VaultView.tsx` | `collapsible` SideNav; poll `refreshTree` (~5–10s or focus); deep-link open |
| `packages/web/src/features/vault/vaultTree.tsx` | Ensure expand depth + icons (already mostly done) |
| `packages/bff/src/index.ts` / `config` | Document `VAULT_ROOT`; already wires `createFsVaultContentProvider` |
| `testing.md` | How to set `VAULT_ROOT` to workspace for local mirror |

### Implementation notes

- If tree empty: EmptyState with hint “Set `VAULT_ROOT` or check role path_prefixes” (dev-friendly, not noisy).
- Poll + optional manual refresh control; when new files appear, tree updates without full page reload.
- Click file → `VaultReader` (existing).
- Collapse behavior matches Slice A.

### Tests

- VaultView: collapsible prop present; poll calls `fetchVaultTree`.
- Existing `vault-fs-provider` BFF tests remain green.
- Deep-link: path prop opens reader.

---

## Slice D — Settings: skills, crons, models

**Items:** 9, 10, 11

### Critical files

| File | Change |
|------|--------|
| `packages/web/src/features/settings/SettingsView.tsx` | Column/layout changes; toggles; grouped models |
| `packages/web/src/api/settings.ts` + `types.ts` | Toggle APIs; cron last/next; model `active` / `connected` |
| `packages/bff/src/settings-discover.ts` | Expose last/next/active/connected when available |
| `packages/bff/src/app.ts` | `PATCH /api/settings/skills/:id`, `PATCH /api/settings/crons/:id` (or batch) |
| `packages/bff/src/settings-snapshot.ts` | Apply patches to Hermes config / jobs.json when not fixture |

### Implementation notes

**9 — Skills**

- Columns: Name | Enabled (interactive).
- Drop Path.
- Enabled cell: `Badge`/`Button` with tooltip “Click to enable/disable”; toggle → PATCH → refresh row optimistically.

**10 — Crons**

- Columns: Name | Schedule (humanized) | Last run | Next run | Enabled (toggle).
- Drop Path.
- Humanize: use `schedule_display` if present; else parse 5-field cron to English (small util or `cronstrue` if acceptable dependency; prefer tiny local helper for common patterns + fallback to raw).
- Last/next: read from jobs.json fields if Hermes provides (`last_run_at`, `next_run_at`); else compute next from expression client- or server-side; last = `—` when unknown.

**11 — Models**

- Group by `provider` with expandable rows (`Collapsible` or nested `Table` / list).
- Highlight active model row (`config.model.default` / discover flag `is_active`).
- Hover connectivity: Tooltip/HoverCard “Connected” / “Disconnected” from `readConnectedProviders` + optional gateway health.
- Do not dump 40 models expanded by default — providers collapsed except the one containing active model.

### Tests

- Settings columns snapshots; toggle calls API.
- Discover maps last/next when fixture includes them.
- Models group + active class.

---

## Existing utilities to reuse

| Utility | Path |
|---------|------|
| Thread grouping | `features/projects/threadGroups.ts` |
| Project options | `features/projects/projectOptions.ts` |
| Chat SSE hook | `hooks/useChatEvents.ts` |
| Thread context | `features/projects/ChatThreadContext.tsx` |
| Vault tree map | `features/vault/vaultTree.tsx` |
| FS vault provider | `packages/bff/src/vault/fs-provider.ts` |
| Logout | `POST /api/auth/logout` in `packages/bff/src/app.ts` |
| Create project | `POST /api/projects` in BFF |
| Reasoning/tool detect | `packages/relay/src/chat-delivery-hub.ts` |
| Astryx templates | `packages/web/src/app/ai-chat/page.tsx`, `--skeleton/*` |

---

## Execution order

1. **Slice A** first (tab keep-alive + shell) — highest user-visible pain, unblocks testing other slices.
2. **Slice B** chat richness (depends on keep-alive for manual QA).
3. **Slice C** vault (can parallel B after A).
4. **Slice D** settings (independent after A collapse fix for settings nav).

Create beads:

```text
portal-ux: epic Portal UI polish HQ7
  ├─ shell-collapse-projects-tabs-profile
  ├─ chat-stream-tools-tokens-metadata-citations
  ├─ vault-collapse-live-mirror
  └─ settings-skills-crons-models
```

---

## Verification (end-to-end)

```bash
pnpm --filter @lanyard/web test
pnpm --filter @lanyard/web build
pnpm --filter @lanyard/web astryx:doctor
pnpm --filter @lanyard/bff test   # when BFF routes change
```

Manual (`testing.md` + local):

1. Collapse chat/settings/vault rails → icons only, tooltips work; New chat = plus.
2. Create project, switch directory, new chat under project, delete chat via ⋯.
3. Chat messages → Vault → Chat: messages still visible.
4. Stream with reasoning + tools → continuous CoT + `ChatToolCalls`.
5. Type `/` and `@` in composer → typeahead; tokens in sent message.
6. Hover profile → Logout / Switch account.
7. Vault with `VAULT_ROOT` shows real tree; new file appears after poll; citation opens file.
8. Greeting `Hello, dev.` for `dev@demo.local`.
9–11. Settings skills/crons toggles; cron schedule readable; models grouped + active highlighted + connectivity hover.

---

## Out of scope / follow-ups

- Full multi-account session switcher (OAuth account picker).
- Durable chat history reload after full page refresh (no message store API yet) — tab keep-alive only.
- Writing skills/crons when only fixture snapshot is configured (document limitation).
- LLM auto-titles for chats (already first-message truncation).
