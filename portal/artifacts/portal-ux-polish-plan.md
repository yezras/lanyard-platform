# Portal UX polish plan (Chat · Shell · Vault · Settings · Astryx)

## Context

The `@lanyard/web` React + Astryx migration already ships Chat, Vault, and Settings views, but several UX gaps remain:

| Area | Current state | Desired |
|------|---------------|---------|
| Chat markdown | `marked` + `dangerouslySetInnerHTML` (no table styles) | Astryx `Markdown` (GFM tables, code, lists) |
| Chain-of-thought | No `reasoning` SSE type; only `tool_progress` | Show collapsible reasoning in the timeline |
| Composer chrome | Status lines under box; text "Attach" button | No helper text; paperclip icon bottom-left |
| Top nav | Project selector + New chat + email crammed in `endContent` | User identity only; history in left panel |
| Chat history | Threads exist (`GET /api/chat/threads`) but unused in UI | Collapsible left SideNav: projects → chats |
| Vault | Fixture tree + noisy labels; tree may look empty | Clean file explorer mirror; click opens reader |
| Settings | Fixture JSON mock; nav panel compressed, not collapsible | Real Hermes paths + models/CLIs; collapsible nav |
| Astryx | Mostly Astryx, still some raw HTML / bespoke chrome | Prefer library primitives end-to-end |

Canonical Astryx catalog: [astryx.atmeta.com/components](https://astryx.atmeta.com/components). Local discovery: `pnpm astryx search|component|template`.

**Locked migration constraints** (do not reopen): React-only shell, tabs (no react-router) through Phase 3, light Lanyard theme, login-only auth UI. See `artifacts/astryx-frontend-migration-plan.md`.

**Tracking:** Create one epic + child beads via `bd`; claim before coding. Do not use markdown TODOs for execution.

---

## Recommended approach

Ship as **four vertical PR slices** (each independently reviewable), then a thin Astryx/layout hardening pass. Prefer Astryx templates already vendored under `packages/web/src/app/*` and CLI templates (`ai-chat`, `shell-side-nav`, `settings-sidebar`) over inventing new layout systems.

### Assumptions (defaults if not overridden)

1. **Reasoning protocol** (mirror `tool_progress`): gateway/agent sets `metadata.portal_event: "reasoning"` (+ optional `metadata.reasoning` / content body). Portal relay → SSE `reasoning` → collapsible UI. If Hermes already streams reasoning under another key, map it in `outboundActionToChatEvent` without changing the Hermes wire contract beyond metadata.
2. **Chat titles:** v1 = first user message truncated (~48 chars) via `PATCH /api/chat/threads/:id` (or set on first `POST .../messages`). LLM summaries are a follow-up bead.
3. **Vault FS mirror:** add optional **filesystem vault provider** when `VAULT_ROOT` (or project `vault_path` root) is set; keep fixture provider for CI. ACL still applies via existing `path_prefixes`.
4. **Hermes settings root:** `HERMES_HOME` env (default `~/.hermes`). Sections link/list:
   - Skills → `$HERMES_HOME/skills` (or documented skills path)
   - Crons → cron/jobs folder
   - MCP → MCP config/servers folder
   - Models → discovered/configured models (no secrets)
   - Integrations → available CLIs on `PATH` / configured tool binaries (keep section name **Integrations**)
5. **Composer attach placement:** paperclip on **bottom-left** via `ChatComposer` `footerActions` (left-aligned slot). Astryx docs often put attach in `headerActions`; we honor user request with `footerActions` + `isIconOnly` + `PaperClipIcon`.

---

## Slice 1 — Chat content & composer cleanup

**Goals:** CoT, tables, no status noise, paperclip attach.

### Critical files

| File | Change |
|------|--------|
| `packages/web/src/features/chat/ChatMessageContent.tsx` | Replace `marked` with Astryx `Markdown` (`autolink="gfm"`); drop raw HTML |
| `packages/web/src/features/chat/chat.css` | Keep only MCQ layout if still needed; remove markdown hacks if unused |
| `packages/web/src/features/chat/ChatTimeline.tsx` | Render reasoning items as collapsible block (Astryx `Collapsible` or dedicated reasoning row above bubble) |
| `packages/web/src/features/chat/ChatView.tsx` | Remove `statusLine` / default "Connected…" / upload status under composer; paperclip attach; errors via `Toast`/`useToast` or composer `status` only on failure |
| `packages/web/src/hooks/useChatEvents.ts` | Handle `reasoning` events (stream/upsert like assistant content) |
| `packages/web/src/api/types.ts` | Extend `ChatEvent.type` with `"reasoning"` |
| `packages/bff/src/relay-client.ts` | Same event type union |
| `packages/relay/src/chat-delivery-hub.ts` | `detectReasoning` + map to `reasoning` events |
| `packages/web/package.json` | Add `@heroicons/react` (used by Astryx templates); remove `marked` if unused |

### Implementation notes

**Tables / markdown**

```tsx
import { Markdown } from "@astryxdesign/core/Markdown";

export function ChatMessageContent({ content, isStreaming }: Props) {
  return (
    <Markdown headingLevelStart={3} isStreaming={isStreaming} autolink="gfm">
      {content}
    </Markdown>
  );
}
```

**Chain-of-thought UI**

- New timeline item: `{ type: "reasoning", id, content }` (or attach `reasoning` string on assistant item).
- While streaming: show expanded/running state; when final answer arrives, collapse by default with trigger e.g. "Thought process".
- Reuse patterns from `ChatToolCalls` (status + expand) or `Collapsible` — pick the one that matches density of assistant messages in `ai-chat` template.

**Composer**

- `footerActions`: `Button` or `IconButton` with `PaperClipIcon`, `label="Attach file"`, `tooltip="Attach"`, `isIconOnly` (match `ai-chat` template).
- Hidden `<input type="file">` retained.
- Attachment tokens stay in `ChatComposerDrawer`.
- Do **not** render connection/upload prose under the box. Transient upload feedback: `Token` count in drawer + optional toast.

### Tests

- `useChatEvents.test.ts`: reasoning upsert + clear on final message if designed that way.
- `ChatTimeline.test.tsx`: table markdown present; reasoning collapsible; no "Connected" string.
- Relay unit: `portal_event: "reasoning"` → SSE type.

---

## Slice 2 — Shell: user chip + chat history SideNav

**Goals:** Declutter top-right; left collapsible panel with projects → chats.

### Critical files

| File | Change |
|------|--------|
| `packages/web/src/layout/PortalShell.tsx` | `AppShell` `sideNav` slot; `endContent` = user only |
| `packages/web/src/features/projects/ProjectsToolbar.tsx` | Deprecate/remove from top nav; logic moves into side nav |
| `packages/web/src/features/projects/ChatThreadContext.tsx` | List threads, select thread, new chat, refresh titles, project grouping |
| `packages/web/src/features/projects/ChatHistorySideNav.tsx` | **New** — Astryx `SideNav` + nested items / `Collapsible` per project |
| `packages/web/src/api/chat.ts` / `types.ts` | `listChatThreads`, optional `updateChatThreadTitle` |
| `packages/bff/src/app.ts` + `chat-store.ts` | `PATCH` title if missing; ensure list returns `project_id`, `title` |

### Layout design

```
AppShell
├── TopNav
│   ├── heading: logo + Lanyard Portal
│   ├── center: Chat | Vault | Settings tabs
│   └── end: UserChip (bordered) — email / initials; optional logout menu later
└── sideNav (visible especially on Chat; can stay global)
    └── SideNav collapsible + resizable
        ├── topContent: "New chat" button
        └── children: project groups (expand/collapse)
              └── chat items (title = summary; select → set threadId)
```

**Astryx building blocks**

- `AppShell` + `SideNav` (`collapsible`, optional `resizable` via SideNav API)
- `SideNavItem` / nested items or `Collapsible` + `List`/`ListItem` for chat rows
- `MobileNav` / `MobileNavToggle` for narrow viewports (AppShell auto pattern)
- User chip: `HStack` + `Avatar` + `Text` inside `Card` or bordered container using tokens (`var(--color-border)`, `var(--radius-*)`, padding tokens) — no custom layout framework

**Project grouping**

- Groups = `projects[]` (`project_id`, `name`, `vault_path` = working directory).
- Threads with `project_id === null` under "General" (or "Unscoped").
- Expand/collapse per project; remember open state in component state (localStorage optional).

**Thread naming**

- On first successful user message: update title to truncated text (server + context state).
- Side nav shows `thread.title` (`maxLines={1}` via Astryx `Text`).

### Tests

- Context: group threads by project; select thread swaps `threadId` and SSE reconnects (existing `useChatEvents` effect).
- PortalShell RTL: top nav has no "New chat" / Project selector; user email visible; side nav has New chat.

---

## Slice 3 — Vault cleanup + reliable tree + document reader

**Goals:** Quiet UI; visible folder/file tree; click opens document.

### Critical files

| File | Change |
|------|--------|
| `packages/web/src/features/vault/VaultView.tsx` | Strip "Search index" label noise, "Live tree" header, status spam, index staleness line; compact search + tree only |
| `packages/web/src/features/vault/vaultTree.ts` | Folder/file icons (`FolderIcon`/`DocumentTextIcon` via Astryx `Icon`); expand roots by default; labels via `Text maxLines={1}` |
| `packages/web/src/features/vault/VaultReader.tsx` | Minimal chrome (filename optional; drop redundant full path if cluttery); keep `Markdown` / image / PDF; empty state via Astryx `EmptyState` without verbose copy |
| `packages/bff/src/vault/*` | Optional `createFsVaultContentProvider(root)`; wire in local-dev bindings when `VAULT_ROOT` set |
| `packages/bff/src/types.ts` / entry bootstrap | Select fixture vs FS provider |

### Tree reliability

Likely empty-tree causes today:

1. RBAC `path_prefixes` yield ACL roots with empty children when fixture paths don't match role.
2. Tree items lack icons/labels styling so hierarchy is hard to scan.
3. Only `/Projects/A` and `/Projects/B` force-expanded in `DEFAULT_EXPANDED_PATHS`.

Fixes:

- Expand all root directories by default (`isExpanded: true` for `kind === "directory"` at depth 0–1).
- Surface a single quiet empty state only when `roots.length === 0` (e.g. "No files available") — not permanent status under search.
- Ensure click on files calls `openFile`; directories only expand (TreeList default).
- For real workspace mirror: FS provider walks `VAULT_ROOT` with depth limits + ACL filter; document env in `testing.md`.

### Tests

- `vaultTree.test.ts`: icons/expansion; onOpenFile for files only.
- Vault view tests: no "Live tree" / "Search indexed vault corpus" strings.
- BFF vault integration: FS provider listing (if added) + fixture still passes CI.

---

## Slice 4 — Settings nav layout + live Hermes-backed data

**Goals:** Collapsible non-crushed left nav; real settings content instead of fixture mock.

### Critical files

| File | Change |
|------|--------|
| `packages/web/src/features/settings/SettingsView.tsx` | Replace compressed `LayoutPanel`+`List` with `SideNav` `collapsible` + adequate `minWidth` / padding tokens; section content cleaner |
| `packages/web/src/features/settings/IntegrationsSection.tsx` | Render CLIs (name, path/bin, health) still labeled Integrations |
| `packages/bff/src/settings-snapshot.ts` | Prefer live discovery over static JSON when Hermes root present |
| `packages/bff/src/settings-health.ts` | Health for CLI/MCP where feasible |
| `packages/bff/fixtures/settings-snapshot.json` | Keep as CI fallback only |
| New: `packages/bff/src/settings-discover.ts` (or similar) | Scan Hermes folders + PATH CLIs + models config |

### Nav layout fix

Pattern from Astryx settings templates + Vault:

```tsx
<Layout
  height="fill"
  start={
    !isNarrow ? (
      <LayoutPanel hasDivider padding={0} /* min width via SideNav resizable */>
        <SideNav collapsible resizable={{ defaultWidth: 240, minWidth: 200, maxWidth: 360 }}>
          {/* ListItems / SideNavItems with full label visibility */}
        </SideNav>
      </LayoutPanel>
    ) : undefined
  }
  content={...}
/>
```

- Avoid squeezing `ListItem` labels: set panel min width, `white-space` via component defaults, no nested flex shrink without `minWidth: 0` on the **content** side only.
- Mobile: existing nav/detail flip stays.

### Section content model

| Section | UI | Data source |
|---------|----|-------------|
| Overview | Counts + Hermes home path (read-only) | Discovery meta |
| Skills | Table: name, relative path, enabled; path links/copy | `$HERMES_HOME/skills/**` |
| Crons | Table: name, schedule file path, enabled | cron folder / jobs |
| MCP | Table: name, transport, command (redacted secrets) | MCP config |
| Models | Table: provider, model id (no API keys) | models config / connected list |
| Integrations | Table: CLI name, binary path, optional health | `which`-style discovery + configured tools |

Secrets: keep existing `redactSettingsSnapshot` / `assertNoSecrets`.

### Tests

- Snapshot loader: fixture path still works when Hermes absent.
- Discovery unit tests with temp dirs.
- Settings RTL: section labels fully visible; SideNav collapse toggle present.

---

## Cross-cutting: Astryx-only UI + responsive layout

Apply continuously in each slice (not a separate big-bang rewrite).

**Rules**

1. Prefer components from [Astryx catalog](https://astryx.atmeta.com/components) over raw `<div>`/`<button>`/`marked`.
2. Layout: `AppShell` → `Layout` / `HStack`/`VStack`/`Stack` → content. Use `height="fill"`, `minHeight: 0`, `minWidth: 0` on flex children so desktop and mobile scroll correctly.
3. Spacing/color: `var(--color-*)`, `var(--spacing-*)`, `var(--radius-*)` only (Lanyard overrides stay in `lanyard-theme.css`).
4. Icons: Astryx `Icon` + `@heroicons/react/24/outline`.
5. Responsive: `useMediaQuery` for settings/chat side panels; AppShell `mobileNav` for history on small screens.
6. After each slice: `pnpm --filter @lanyard/web astryx:doctor` and `pnpm --filter @lanyard/web build`.

**Known raw spots to replace**

- `ChatMessageContent` HTML injection → `Markdown`
- Composer text Button → icon `Button`/`IconButton`
- Top-nav bare email `Text` → bordered user chip
- Vault status `Text` noise → `EmptyState` / silence
- Settings left rail → `SideNav`

---

## Suggested bead graph

```
epic: Portal UX polish (chat CoT/tables, shell history, vault, settings, Astryx)
├── portal-ux-chat      Slice 1 (may split: web UI vs relay reasoning protocol)
├── portal-ux-shell     Slice 2
├── portal-ux-vault     Slice 3
└── portal-ux-settings  Slice 4
```

Order: **1 → 2** in parallel with **3/4** after 1 starts (shell history depends on chat context; vault/settings independent). Reasoning protocol (relay) can land with or slightly before web CoT UI.

Create with `bd create` + deps; claim with `bd update <id> --claim`.

---

## Existing utilities to reuse

| Utility | Path |
|---------|------|
| SSE chat hook | `packages/web/src/hooks/useChatEvents.ts` |
| Thread/project context | `packages/web/src/features/projects/ChatThreadContext.tsx` |
| Projects fetch | `packages/web/src/hooks/useProjects.ts`, `api/projects.ts` |
| Thread list API | `GET /api/chat/threads` in `packages/bff/src/app.ts` |
| Tool progress detection pattern | `packages/relay/src/chat-delivery-hub.ts` (`detectToolProgress`) |
| Vault tree map | `packages/web/src/features/vault/vaultTree.ts` |
| Vault service + ACL | `packages/bff/src/vault/service.ts`, `acl-filter.ts` |
| Settings redact | `packages/bff/src/settings-snapshot.ts` |
| Chat layout tokens | `packages/web/src/features/chat/chatLayout.ts` |
| Astryx reference pages | `packages/web/src/app/ai-chat`, `shell-nav`, `settings-sidebar` |
| CLI templates | `@astryxdesign/cli` `ai-chat`, `shell-side-nav`, `settings-sidebar` |

---

## Verification

Per slice:

```bash
pnpm --filter @lanyard/web test
pnpm --filter @lanyard/web build
pnpm --filter @lanyard/web astryx:doctor
pnpm test   # monorepo / BFF / relay as touched
```

Manual (`testing.md` flows + additions):

1. **Chat:** send message with markdown table → rendered grid; if agent emits reasoning metadata → collapsible CoT; no text under composer; paperclip attaches file.
2. **Shell:** top-right only user chip; left panel groups chats by project; New chat; collapse side nav; mobile drawer.
3. **Vault:** tree shows folders/files; open md/pdf/image; no label spam.
4. **Settings:** left nav collapses and shows full labels; skills/crons/mcp paths point at Hermes dirs when configured; models list non-secret; integrations list CLIs.
5. **Responsive:** resize desktop + narrow mobile breakpoints for shell, chat, vault split, settings.

---

## Out of scope / follow-ups

- LLM-generated chat titles
- Full react-router deep links
- Live edit of Hermes skill files from Settings (read/link only in this plan)
- Production remote vault gateway (FS provider is local/dev-oriented; fixture remains CI)
- Dark mode / Mackinac webfonts (already deferred in migration plan)

---

## Execution order (when implementing)

1. Create epic + beads; claim Slice 1.
2. Relay/types reasoning + web Markdown/tables/composer cleanup.
3. Shell SideNav history + user chip.
4. Vault quiet UI + tree + optional FS provider.
5. Settings SideNav + Hermes discovery.
6. Close beads; report `git status` (no commit/push unless asked — conservative profile).
