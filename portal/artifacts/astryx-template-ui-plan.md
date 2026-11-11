# Plan: Astryx page templates for Chat, Vault, Settings, and Login

**Status:** Approved (2026-03-08). Implementation branch: `feat/astryx-template-ui`.

Canonical design for template adoption alongside `artifacts/astryx-frontend-migration-plan.md`.

## Context

`@lanyard/web` already has React feature views (`ChatView`, `VaultView`, `SettingsView`, `AuthView`) wired through `PortalShell` tab chrome (`packages/web/src/layout/PortalShell.tsx`). They use Astryx primitives but **not** the official CLI page templates. You want those scaffolds as the UI baseline:

| Area | Template | Scaffold path (run from `packages/web`) |
|------|----------|-------------------------------------------|
| Chat | `ai-chat` | `pnpm astryx template ai-chat ./src/app/ai-chat` → `src/app/ai-chat/page.tsx` |
| Vault | `shell-nav` | `pnpm astryx template shell-nav ./src/app/shell-nav` → `src/app/shell-nav/page.tsx` |
| Settings | `settings-sidebar` | `pnpm astryx template settings-sidebar ./src/app/settings-sidebar` → `src/app/settings-sidebar/page.tsx` |
| Login | `login-card` | `pnpm astryx template login-card ./src/app/login-card` → `src/app/login-card/page.tsx` |

**Settings constraint:** Replace the current snapshot/health **JSON `CodeBlock` dump** (`packages/web/src/features/settings/SettingsView.tsx`) with a **settings-sidebar** layout: sidebar sections and structured rows (especially **skills** as name / path / enabled — not inline JSON lists).

**Architecture constraints (unchanged):** In-memory tabs only (no `react-router`); `PortalShell` keeps top nav + Chat / Vault / Settings tabs; login-only auth + Google / local stub (`artifacts/astryx-frontend-migration-plan.md` **Locked decisions**).

**Note on “3 epics”:** You listed four templates; this plan defines **three feature epics** (Chat, Vault, Settings) plus a **fourth login epic** (small). If you want exactly three epics, fold login subtasks under the existing “Migrate Auth view” bead instead of a separate epic.

---

## Recommended approach

### 1. Scaffold once, then extract — do not mount raw `page.tsx`

Each template is a ~full-page demo with placeholder data and often its own `AppShell`. **Do not** render `page.tsx` directly from `App.tsx`.

1. Run the four `pnpm astryx template …` commands from `packages/web`.
2. Treat each `page.tsx` as a **layout reference**.
3. Refactor into production modules under `packages/web/src/features/<area>/` (keep existing hooks/API):
   - **Chat:** `features/chat/` — preserve `useChatEvents`, `ChatThreadContext`, `api/chat.ts`, MCQ + upload behavior.
   - **Vault:** `features/vault/` — preserve `fetchVaultTree`, `fetchVaultContent`, `searchVaultIndex`, `VaultReader`, `vaultTree.ts`.
   - **Settings:** `features/settings/` — typed snapshot from `GET /api/settings/snapshot` (shape in `packages/bff/src/settings-snapshot.ts`).
   - **Login:** `features/auth/` — preserve `useAuthOptions`, `apiFetch` login, Google redirect, dev stub.

4. Delete or shrink bespoke CSS (`features/chat/chat.css`, `features/vault/vault.css`) where the template layout makes them redundant.

### 2. Chat — `ai-chat` template

- **Reuse:** `useChatEvents` (`hooks/useChatEvents.ts`), `ChatMessageContent`, `sendChatMessage` / `sendMcqSelection` / `uploadStagingFile`, `ProjectsToolbar` stays in `PortalShell` top nav.
- **Integrate:** Map template regions to:
  - Message list / tool-call UI → existing timeline + `toolProgress` from hook.
  - Composer + attachments → current send/upload flow.
  - Optional artifact/preview panel → vault path preview or tool output if template provides a panel (wire only if parity with today’s UX; otherwise hide demo panel).
- **Entry:** `ChatView.tsx` composes extracted ai-chat layout; `PortalShell` still renders `<ChatView />` for `activeView === "chat"`.

### 3. Vault — `shell-nav` template

- **Scope:** Apply **inside the Vault tab only** — do not replace `PortalShell` global chrome (tabs stay in `TopNav`).
- **Reuse:** `vaultNodesToTreeItems`, `TreeList` / search list behavior from current `VaultView.tsx`, `VaultReader`.
- **Integrate:** Repurpose template **side navigation** for:
  - Live vault tree (primary nav).
  - Search index results (secondary list or nav section).
  - Main content pane → `VaultReader`.
- Strip template demo nav items and duplicate top-level `AppShell` from scaffold.

### 4. Settings — `settings-sidebar` template

- **Reuse:** `loadSnapshot` / `refreshHealth` API calls from current `SettingsView.tsx`.
- **UI model:** Sidebar sections (suggested ids):
  - **Overview** — `exported_at`, status line.
  - **Skills** — `Table` or `List` rows: name, optional path, enabled `Badge`/`Switch` (read-only display of `enabled` unless product asks for toggles).
  - **Crons** — name, schedule, enabled.
  - **MCP servers** — name, transport, command (no secrets).
  - **Models** — provider, model.
  - **Integrations** — name, type; **Health** section with structured pass/fail per integration after `POST /api/settings/health-check` (not a single JSON block).
- **Explicit non-goals:** No default view that shows full snapshot as JSON; optional collapsible “Raw snapshot” for support/debug only if needed.

### 5. Login — `login-card` template

- **Reuse:** All logic in `AuthView.tsx` (form submit, `useAuthOptions`, Google / stub buttons).
- **Integrate:** Replace hand-built `Card` + `FormLayout` with login-card layout; keep Lanyard icon, light theme, login-only copy.
- **Entry:** `App.tsx` continues `<AuthView onAuthenticated={…} />` when unauthenticated.

### 6. Critical files

| Action | Paths |
|--------|--------|
| Scaffold (new) | `packages/web/src/app/ai-chat/page.tsx`, `shell-nav/page.tsx`, `settings-sidebar/page.tsx`, `login-card/page.tsx` |
| Refactor | `features/chat/ChatView.tsx`, `ChatTimeline.tsx`; `features/vault/VaultView.tsx`; `features/settings/SettingsView.tsx` (+ new section components); `features/auth/AuthView.tsx` |
| Types | `packages/web/src/api/types.ts` — add `SettingsSnapshot` types aligned with BFF redacted shape (or import shared type if already exposed) |
| Shell wiring | `layout/PortalShell.tsx` — likely unchanged imports; verify layout height/fill after template |
| Tests | `features/auth/AuthView.test.tsx`, `app/App.test.tsx`, `layout/PortalShell.test.tsx`; add `SettingsView.test.tsx` for skills table smoke |

---

## Beads: epics and subtasks

**Created in Dolt** (branch `feat/astryx-template-ui`). Re-run script only on fresh DB: `artifacts/beads/astryx-template-ui-graph.sh`.

| ID | Title |
|----|--------|
| `portal-6rr` | Decision: Astryx template UI plan (canonical) |
| `portal-dg0` | Epic: ai-chat template for Portal Chat |
| `portal-zic` | Epic: shell-nav template for Portal Vault |
| `portal-8m1` | Epic: settings-sidebar template (clean skills UI) |
| `portal-07u` | Epic: login-card template for Portal login |
| `portal-2pm` … `portal-pbk` | Chat subtasks (scaffold → extract → wire → tests) |
| `portal-571` … `portal-3a3` | Vault subtasks |
| `portal-ebt` … `portal-bv3` | Settings subtasks |
| `portal-4mc` … `portal-0v1` | Login subtasks |

Link to parent migration epic **“Astryx frontend migration for @lanyard/web”** when present:  
`bd dep add portal-dg0 <migration-epic-id> --type parent-child` (repeat for `portal-zic`, `portal-8m1`, `portal-07u`).

### Epic detail (titles)

### Epic 1 — Astryx `ai-chat` template for Portal Chat

| Subtask | Title | Acceptance (summary) |
|---------|--------|----------------------|
| 1.1 | Scaffold `ai-chat` under `src/app/ai-chat` | `page.tsx` committed; `astryx doctor` passes |
| 1.2 | Extract chat layout from scaffold into `ChatView` | No duplicate `AppShell` under `PortalShell`; demo data removed |
| 1.3 | Wire SSE timeline, MCQ, upload, tool progress | Parity with `useChatEvents` + `testing.md` chat flows |
| 1.4 | Update Chat RTL/tests | Existing `useChatEvents.test.ts` green; manual mock-gateway check |

### Epic 2 — Astryx `shell-nav` template for Portal Vault

| Subtask | Title | Acceptance (summary) |
|---------|--------|----------------------|
| 2.1 | Scaffold `shell-nav` under `src/app/shell-nav` | `page.tsx` committed |
| 2.2 | Extract side-nav + main layout into `VaultView` | Tree + search + reader behavior unchanged |
| 2.3 | Remove redundant vault layout CSS | Visual parity on tree open, PDF/markdown reader, search |
| 2.4 | Vault manual verification | `testing.md` vault paths |

### Epic 3 — Astryx `settings-sidebar` template (clean skills UI)

| Subtask | Title | Acceptance (summary) |
|---------|--------|----------------------|
| 3.1 | Scaffold `settings-sidebar` under `src/app/settings-sidebar` | `page.tsx` committed |
| 3.2 | Add snapshot types + fetch layer in web | Typed `skills`, `crons`, `mcp_servers`, `models`, `integrations` |
| 3.3 | Build sidebar sections + skills table/list | **No** primary JSON list of skills; structured rows only |
| 3.4 | Health check structured UI | Integration status readable without raw JSON wall |
| 3.5 | Settings RTL smoke test | Loads snapshot mock; skills section renders rows |

### Epic 4 — Astryx `login-card` template for Portal login

| Subtask | Title | Acceptance (summary) |
|---------|--------|----------------------|
| 4.1 | Scaffold `login-card` under `src/app/login-card` | `page.tsx` committed |
| 4.2 | Port `AuthView` onto login-card layout | Email/password + Google + dev stub unchanged |
| 4.3 | Update `AuthView.test.tsx` | All existing auth tests pass |

---

## Verification

1. **Build / doctor:** `pnpm --filter @lanyard/web build` and `pnpm --filter @lanyard/web astryx:doctor`
2. **Unit tests:** `pnpm --filter @lanyard/web test`
3. **Manual (`testing.md`):** login, chat, vault, settings flows per above.
4. **Regression:** `PortalShell` tabs and `ProjectsToolbar` still work on Chat tab.

---

## Execution order

1. Create beads (four epics + subtasks, link to parent migration epic).
2. Scaffold all four templates in one PR or epic-ordered PRs.
3. **Login** and **Settings** can proceed in parallel with **Vault**; **Chat** is largest — claim epic 1 after scaffold lands.
4. Close each subtask with tests + manual slice; `bd dolt push` when beads change.