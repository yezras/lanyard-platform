# Structural design: Astryx for Lanyard Portal frontend

Canonical design artifact for the `@lanyard/web` → React + Astryx migration. Implementation tasks are tracked in **bd (Beads)**; see the **Work tracking** section below.

**Status:** Open design choices were resolved in a grill session (2026-03-08). See **Locked decisions** — treat that section as authoritative for implementation.

## Context

`@lanyard/web` is a **Vite 6 + vanilla TypeScript** SPA: a single `main.ts` (~800 lines) injects HTML via template strings, ~250 lines of bespoke CSS, and imperative DOM updates. `vault-browser.ts` uses a **mount(host elements)** pattern. There is **no React** today.

[Astryx](https://github.com/facebook/astryx) is a **React** design system (150+ components, pre-built CSS, no StyleX required for consumers). It ships **`@astryxdesign/cli`** for component docs, templates, `doctor`, and agent-friendly `--json` APIs. Adopting Astryx for "all frontend features" implies a **framework migration to React** plus a **feature-oriented package layout**, not a drop-in CSS swap.

BFF integration stays unchanged: Vite proxy to `/api` (`packages/web/vite.config.ts`), cookie session + CSRF (`apiFetch` in `main.ts`).

**Terminology:** Elsewhere in this monorepo, "beads" can mean customer **ingest / vault-writer workflow units** (see `packages/bff/src/staging/`). This plan uses **[bd (Beads)](https://github.com/gastownhall/beads)** — the graph issue tracker for agents — for **tracking the Astryx migration work** in `LanyardBrain/Portal`.

## Locked decisions

These are **non-negotiable** for the initial migration epic unless explicitly reopened via a new decision bead.

| Area | Decision |
|------|----------|
| **Cutover** | **React-only shell** after Phase 1 (#3). No parallel legacy `main.ts` DOM. Unmigrated tabs use **Astryx empty state** per tab; track readiness with e.g. `MIGRATED_VIEWS` in `PortalShell`. |
| **Pace** | **Shell-first** phased migration (not vertical slices, not big-bang). |
| **Node** | **Node ≥ 22** monorepo-wide (`engines`, local dev, CI). |
| **CI (from Phase 0)** | `pnpm --filter @lanyard/web build` + `astryx doctor` on every CI run; keep root `pnpm test`. **From Phase 3:** add `pnpm --filter @lanyard/web test`. |
| **SPA routing** | **In-memory tabs only** through Phase 3 (`chat \| vault \| settings`). **No `react-router`** in this epic; deep links are a follow-up bead. |
| **Chrome theme** | **Light default** (shift from today's dark `main.ts`). Lanyard brand colors from **[LanyardBrain/Core `dev/design/`](https://github.com/LanyardBrain/Core/tree/main/dev/design)** (`colors.md`: `#0047ab`, `#000080`, `#4f81bd`). Map into Astryx via **neutral base + Lanyard token overrides** or `defineTheme` / `lanyard-theme.css` — not stock neutral alone. |
| **Brand assets** | **Icon only** in app chrome (no full lockups). Copy `Lanyard_Icon_*.svg` into `packages/web/public/brand/`; Core `dev/design/` stays **canonical** (re-copy when design changes; optional sync script). Header uses **`Lanyard_Icon_blue.svg`** on light chrome. |
| **Typography** | Brand font is **P22 Mackinac Pro** (`font.md`). Ship **system-ui fallback** until licensed **webfonts** are added under Core `dev/design` and copied into the portal; follow-up bead for Mackinac. |
| **Local dev auth** | **A + C:** (A) **Auto-assign** demo `member` role on `POST /api/auth/register` when local dev tenant mode is active (`DEV_TENANT_SLUG` / equivalent). (C) **Seeded dev user** created in `seed-demo-tenant.sh` (or companion) with `member` pre-assigned; **email + password documented in `testing.md` only** (local-only constants, e.g. `dev@demo.local`). Hermes profile remains **`default`** with `path_prefixes: ["/"]` unless prod naming dictates otherwise. |
| **Auth UI** | **Login-only** in React (no register form, **no register-on-401**). New accounts: seeded user or `POST /api/auth/register` via curl. |
| **Google sign-in** | **In epic** (Auth bead #4): real **`GET /api/auth/google`** when `GOOGLE_CLIENT_ID` is set. When unset, show **"Sign in with Google (dev stub)"** → **`POST /api/auth/google/stub`** with documented stub identity — **local dev only** (same gating as `DEV_TENANT_SLUG`). Production: no stub in UI; BFF must **fail closed** (404) on stub outside local dev. |
| **Frontend tests (Phase 3)** | Vitest + RTL: auth/shell smoke, **plus unit tests for `api/client.ts`**, **plus Chat hook** (e.g. `useChatEvents` / SSE parsing with mocked `EventSource`). Chat E2E remains **`testing.md` + mock-gateway**, not RTL. |

**Record in bd at kickoff** (`bd remember`): React-only shell, Node 22, light + Lanyard colors, icon-only brand, Mackinac fallback, tabs-no-router through Phase 3, login-only + Google stub local-only.

**Follow-up beads (out of initial epic):** Mackinac webfonts; `react-router` + `LinkProvider`; optional dark mode / theme toggle.

## Work tracking: bd (Beads) in this repo

The Astryx migration is too large for a single PR or ad-hoc markdown checklists. **All implementation work should be tracked with `bd`**, committed with the repo, and picked up via `bd ready` (dependency-aware, unblocked tasks).

### Repo setup (first execution step)

Run at **monorepo root** (`/home/operator/portal`, remote `LanyardBrain/Portal`):

```bash
# One-time: install CLI (pick one)
curl -fsSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash
# or: npm install -g @beads/bd

cd /home/operator/portal
bd init                    # creates .beads/, updates AGENTS.md, git hooks
bd hooks install           # if not done by init
bd setup --list            # pick integration if available (e.g. cursor, factory)
```

**Commit policy:** Use normal `bd init` (not `--stealth`) so `.beads/issues.jsonl` (export for review/interop) and **AGENTS.md** beads section are versioned. Source of truth is the Dolt DB under `.beads/`; sync across machines with `bd dolt push` / `bd dolt pull` when configured.

**Do not** track this migration with markdown TODO lists or GitHub issues alone — beads is the canonical plan; optional GitHub epic can mirror for humans later.

### Agent / developer workflow

Document in root **AGENTS.md** (from `bd init` + additions):

```bash
bd prime                              # workflow + project memory
bd ready --json                       # next unblocked tasks
bd show <id> --json                   # acceptance criteria, deps
bd update <id> --claim                # atomic claim before coding
bd close <id> --reason "…" --json     # when acceptance met
bd dep add <child> <parent>           # child blocked by parent (see bd help for edge types)
```

Commit messages should end with bead id: `Add React providers (bd-xxxx)`.

**Pair with Astryx:** AGENTS.md should also reference `pnpm astryx search` / `astryx component` (see CLI section below). Use `bd remember "…"` for durable decisions (see **Locked decisions**).

### Proposed bead graph (create at kickoff)

Create one **epic** then child tasks: **parent-child** links from each task to the epic (`bd dep add <task> <epic> --type parent-child`), and **blocks** between tasks (`bd dep add <blocked> <blocker>`). Seed script: `artifacts/beads/astryx-migration-graph.sh` + `artifacts/beads/astryx-migration-deps.jsonl`. Suggested titles and order:

| Order | Type | Title | Blocks / notes |
|-------|------|--------|----------------|
| 0 | task | Initialize bd + AGENTS.md in Portal repo | None; do first |
| 1 | epic | Astryx frontend migration for @lanyard/web | Parent for all below |
| 2 | task | Phase 0: React + Astryx deps, Node 22, globals.css + Lanyard theme, brand icons, api/client extract, astryx CLI scripts | Epic |
| 2b | task | Local dev: seeded user + auto-assign member on register; Google stub gate on BFF | #2 |
| 3 | task | Phase 1: PortalShell + App auth gate (Astryx light shell, empty states) | #2, **#2b** |
| 4 | task | Migrate Auth view to Astryx (login-only, Google + local stub) | #3 |
| 5 | task | Migrate Projects toolbar (select, new thread) | #3 |
| 6 | task | Migrate Chat (SSE, MCQ, upload) to React + Astryx | #4, #5 |
| 7 | task | Migrate Vault (tree, reader, search) | #3 |
| 8 | task | Migrate Settings launchpad | #3 |
| 9 | task | Phase 3: Remove main.ts monolith, vault-browser.ts; Vitest RTL + api client + Chat hook tests | #6, #7, #8 |
| 10 | task | CI: Node 22, web build + astryx doctor (Phase 0+); web test (Phase 3+) | #2; extend acceptance when #9 lands |

**Acceptance criteria** for each bead: copy the relevant bullets from **Verification**, **Migration strategy**, **Local dev auth**, and **Locked decisions** into `bd create …` descriptions (`--body-file` or `--stdin` for long text).

**Optional:** One **decision** bead (type/doc) linking to `artifacts/astryx-frontend-migration-plan.md`; child tasks `relates_to` that bead.

### Execution discipline

- Before starting a slice: `bd update <id> --claim`.
- One bead ≈ one reviewable PR branch when possible.
- Close bead only when manual `testing.md` checks for that slice pass.
- File new beads for discovered follow-ups; do not expand scope silently.

## Local dev auth and Hermes profile

Production RBAC is **fail closed**: chat inject and vault need a control-plane role with `hermes_profile`. Local `dev:tmux` already seeds demo `member` (`hermes_profile: default`, `path_prefixes: ["/"]`) and runs **mock-gateway** for chat.

**This epic adds:**

1. **Seeded user (C)** — Idempotent create in seed script; credentials in **`testing.md`** only. Use for Phase 1–2 UI work without register-then-assign.
2. **Auto-assign (A)** — On register in local dev, assign `PORTAL_DEMO_MEMBER_ROLE_ID` automatically. `assign-demo-member-roles.sh` remains useful for users created before auto-assign lands or via curl.
3. **Optional:** mock-gateway logs inbound `source.profile` for debugging inject parity.

Confirm after login: `GET /api/context` → `hermes_profile: "default"`, then thread create + chat per **`testing.md`**.

## Current feature map (preserve behavior)

| Area | Today | Target (epic) | Key APIs / realtime |
|------|--------|-----------------|---------------------|
| Auth | Login form, dev register-on-401 | Login-only + Google OAuth + local stub | `/api/auth/*`, CSRF |
| Workspace chrome | Tabs: Chat / Vault / Settings | Same; empty state until migrated | Client-side tab state |
| Chat | SSE events, MCQ, tool progress, staging upload | Unchanged behavior | `/api/chat/*`, `EventSource` |
| Vault | Tree, reader (markdown/PDF), search | Unchanged behavior | `/api/vault/*` |
| Settings | Snapshot + health JSON | Unchanged behavior | `/api/settings/*` |
| Projects | Select + new thread | Unchanged behavior | `/api/projects`, thread create |

## Recommended target architecture

```
packages/web/
  index.html
  vite.config.ts
  astryx.config.mjs          # optional CLI config (issues URL, template.get)
  package.json               # astryx script + React peers
  public/
    brand/                   # copied from Core dev/design (icons only)
  src/
    main.tsx                 # createRoot, strict mode
    styles/
      globals.css            # @import reset + astryx + theme + lanyard overrides
      lanyard-theme.css      # optional: token map to Core colors
    app/
      App.tsx                # Theme + providers, auth gate
      providers.tsx          # Theme (+ LinkProvider post-epic only)
    api/
      client.ts              # extract apiFetch + CSRF from main.ts
      types.ts               # AuthUser, Project, ChatEvent, vault types
    features/
      auth/
      chat/
      vault/
      settings/
      projects/
    layout/
      PortalShell.tsx        # AppShell / TopNav / tabs; MIGRATED_VIEWS
    hooks/                   # useSession, useProjects, useChatEvents, …
```

**Separation of concerns**

- **`api/`** — side-effectful HTTP only (reuse logic from `main.ts` `apiFetch`, staging upload).
- **`features/*`** — UI + feature state; no cross-feature imports except via hooks/context.
- **`layout/`** — Astryx shell, navigation, project picker toolbar, per-tab empty states.
- **No business logic in `main.tsx`** beyond bootstrap.

**Navigation (this epic)** — **Tab state** (`chat | vault | settings`) inside `PortalShell` only. **Do not** add `react-router` until a post-epic bead.

## Astryx integration (Vite)

Per [@astryxdesign/core README](https://github.com/facebook/astryx/blob/main/packages/core/README.md#vite):

1. **Dependencies** (in `packages/web`):
   - `@astryxdesign/core`
   - `@astryxdesign/theme-neutral` (base; overridden by Lanyard tokens)
   - `react`, `react-dom` (peers; align with Astryx's supported React 19)
   - **Dev:** `@astryxdesign/cli`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `vitest`, `@testing-library/react` (Phase 3)

2. **`src/styles/globals.css`** (import order matters):
   ```css
   @import '@astryxdesign/core/reset.css';
   @import '@astryxdesign/core/astryx.css';
   @import '@astryxdesign/theme-neutral/theme.css';
   /* Lanyard: Core dev/design colors + light chrome; Mackinac fallback font stack */
   @import './lanyard-theme.css';
   ```

3. **`providers.tsx`** — wrap app with `Theme` + built theme object or neutral + CSS overrides per **Locked decisions**.

4. **`vite.config.ts`** — add `@vitejs/plugin-react`; keep existing `/api` proxy.

5. **Entry** — `index.html` → `/src/main.tsx` (Phase 1 cutover retires `main.ts` entry).

## CLI installation and "components easily accessible"

Goal: humans and agents discover and use components without spelunking `node_modules`.

| Layer | What to add |
|-------|-------------|
| **Package scripts** (`packages/web/package.json`) | `"astryx": "node node_modules/@astryxdesign/cli/bin/astryx.mjs"` and convenience: `"astryx:doctor": "pnpm astryx doctor"`, `"astryx:components": "pnpm astryx component --list --detail compact"` |
| **Monorepo root** (optional) | `"astryx": "pnpm --filter @lanyard/web astryx --"` so `pnpm astryx search tree` works from repo root |
| **Init** | Run `pnpm astryx init` (in `packages/web`) with `--features agents` to inject **AGENTS.md / CLAUDE.md** section documenting `pnpm astryx search`, `component`, `template`, `manifest --json` |
| **CI** | From Phase 0: `pnpm --filter @lanyard/web build` + `astryx doctor`; from Phase 3: + `pnpm --filter @lanyard/web test` |
| **Repo docs** | Short `packages/web/README.md` — "UI stack: Astryx"; link to Storybook https://facebook.github.io/astryx/ |

**Agent workflow** (document in AGENTS.md):

```bash
pnpm astryx search "tree navigation"
pnpm astryx component Tree --props --json
pnpm astryx template --list
pnpm astryx manifest --json
```

Core also exposes: `node node_modules/@astryxdesign/core/docs.mjs Button` — secondary to CLI.

**Version alignment** — Pin `@astryxdesign/core` and `@astryxdesign/cli` to the **same release** (e.g. `0.1.4`); `astryx doctor` checks this.

**Node engines** — **Locked:** `engines.node` **`>=22`** at monorepo root and in CI (`.github/workflows/ci.yml`).

## Astryx patterns → portal features

Use CLI `template` and `component` to pick concrete building blocks during implementation (names may vary; verify with `pnpm astryx search <keyword>`).

| Portal UI | Astryx direction | Notes |
|-----------|------------------|--------|
| App chrome | **AppShell**, **TopNav** | Lanyard **blue icon** in nav; light theme |
| Auth panel | **TextField**, **Button** | Login-only; Google link or dev stub button |
| Workspace tabs | **TabBar** / segmented control | Empty state if tab not in `MIGRATED_VIEWS` |
| Project picker | **Select** / **Combobox** | Projects from `loadProjects` |
| Chat transcript | **Layout** + scroll region; message rows custom or **Card** | `useChatEvents` + unit tests |
| Composer | **TextArea**, **Button**, file upload pattern | Staging upload unchanged |
| MCQ | **ButtonGroup** / **Chip** choices | Port `renderMcqPrompt` |
| Tool progress | **ProgressIndicator** / **Banner** | `showToolProgress` |
| Vault tree | **Tree** (or list + indent) | Refactor `vault-browser.ts` to React |
| Vault reader | **Layout** detail panel; markdown via `marked` in component | PDF iframe unchanged |
| Vault search | **SearchField**, results list | Existing `/api/vault/search` |
| Settings | **settings** page template skeleton | JSON in **CodeBlock** / monospace **Text** |

**Swizzle** only when a component needs owned source (e.g. highly custom chat bubbles); default to stock components + `className` / theme tokens.

## Theming and brand

**Locked approach:**

- **Light** Astryx neutral base + **Lanyard token overrides** mapping to Core `dev/design/colors.md`.
- **Icons:** `packages/web/public/brand/` (from `Lanyard_Icon_blue.svg`, `Lanyard_Icon_white.svg` as needed); do not use full lockups in-app.
- **Font:** `font-family` stack with **P22 Mackinac Pro** first when available, else **system-ui** until webfonts ship in Core.

Visual change from today's dark vanilla UI is **expected**; functional checks in `testing.md` are unchanged.

## Migration strategy (shell first, React-only)

Phased to keep `pnpm dev:tmux` usable; **no dual-stack UI** after Phase 1 lands.

### Phase 0 — Foundation

- **Beads:** `bd init` at repo root; create epic + Phase 0 + **#2b** beads; claim before work.
- Bump **Node 22** (`package.json`, CI).
- Add React, Astryx packages, CLI, plugin-react, `globals.css`, Lanyard theme CSS, copy brand icons.
- Extract `api/client.ts` + `api/types.ts` from `main.ts`.
- Add `pnpm astryx` scripts + `astryx init --features agents` (merge into AGENTS.md alongside bd section).
- **CI:** web `build` + `astryx doctor` (bead #10 can land with Phase 0 or immediately after).
- `astryx doctor` clean on Node 22.

### Phase 0b — Local dev auth (#2b)

- Seeded dev user + **`testing.md`** credentials.
- Auto-assign `member` on register when local dev tenant mode is on.
- Harden **Google stub** route for non-local / production fail-closed.

### Phase 1 — React shell (#3)

- **`#app` is React only** — retire vanilla entry when this merges (not parallel mount).
- `App.tsx` + `PortalShell` (light Astryx layout, Lanyard icon).
- Auth gate: unauthenticated → `AuthView` shell route or dedicated auth layout; authenticated → tabs with **empty states** for unmigrated features.
- Expand `MIGRATED_VIEWS` as feature beads complete.

### Phase 2 — Feature migration (order)

1. **Auth (#4)** — email/password login, Google OAuth, local dev stub; tests in #9.
2. **Projects toolbar (#5)** — select + new thread.
3. **Chat (#6)** — SSE, MCQ, upload; highest complexity.
4. **Vault (#7)** — `VaultView` + hooks.
5. **Settings (#8)** — snapshot/health layout.

### Phase 3 — Cleanup (#9)

- Delete `main.ts` monolith and inline CSS (if any remnant).
- Delete `vault-browser.ts` after vault feature ships.
- **Vitest:** RTL auth/shell; **unit tests** for `api/client.ts` and **Chat hook** (mocked `EventSource`).
- **CI:** add `@lanyard/web test`.

**Not in initial scope:** SSR, Next.js move, BFF contract redesign, `react-router`, theme toggle, Mackinac webfonts (follow-up beads).

## Critical files to touch

| File | Role |
|------|------|
| `packages/web/package.json` | deps, astryx + test scripts |
| `packages/web/vite.config.ts` | React plugin |
| `packages/web/index.html` | entry `main.tsx` |
| `packages/web/public/brand/` | Lanyard icons (from Core) |
| `packages/web/src/main.ts` | **Retire** after migration |
| `packages/web/src/vault-browser.ts` | **Retire** → `features/vault/` |
| `package.json` (root) | `engines` Node 22, optional `astryx` wrapper |
| `.github/workflows/ci.yml` | Node 22, web build, doctor, test |
| `scripts/seed-demo-tenant.sh` | Seeded dev user |
| `packages/bff/src/app.ts` | Auto-assign on register (local); stub gate |
| `testing.md` | Seeded credentials, Google stub, login-only flow |
| `.beads/`, `.beads/issues.jsonl` | bd database + export (after `bd init`) |
| `AGENTS.md` (root) | `bd prime` workflow + Astryx CLI (`bd init` + `astryx init`) |

## Reuse from existing code

- `apiFetch` + CSRF flow — `packages/web/src/main.ts` (~421–435)
- Chat SSE / MCQ / thread lifecycle — same file (~538–790)
- Vault types and fetch/render logic — `packages/web/src/vault-browser.ts`
- Vite BFF proxy — `packages/web/vite.config.ts` (unchanged)
- BFF Google routes — `GET /api/auth/google`, callback, `POST /api/auth/google/stub`

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Astryx **beta** (v0.1.x) | Pin versions; `astryx upgrade --list` before bumps |
| React migration regressions | React-only shell; empty states; manual `testing.md` after each feature |
| Phase 1 **regression window** | Seeded user + mock-gateway; prioritize Chat (#6) after Auth/Projects |
| Google stub in prod | BFF fail-closed; stub UI gated on local dev only |
| Component name drift | Always `pnpm astryx search` before implementing |
| Brand asset drift | Document Core `dev/design` as canonical; re-copy icons on change |

## Verification

1. **Tooling:** `pnpm --filter @lanyard/web astryx doctor` → no failures (Node 22).
2. **Build:** `pnpm --filter @lanyard/web build` succeeds (CI from Phase 0).
3. **Unit tests:** `pnpm --filter @lanyard/web test` — api client, Chat hook, auth/shell RTL (Phase 3+).
4. **E2E manual** (from `testing.md` / `dev:tmux`):
   - Login with **seeded dev user** (documented credentials)
   - **Google stub** (local dev) or real Google when `GOOGLE_CLIENT_ID` set
   - Chat: send message, see SSE reply, MCQ if triggered, file upload
   - Vault: expand tree, open markdown/PDF, search
   - Settings: load snapshot, refresh health
   - Project switch + new thread
   - `GET /api/context` → `hermes_profile: "default"`
5. **Regression:** Existing BFF integration tests unchanged (`pnpm test` at root).

## Execution note

**Kickoff sequence:** (1) `bd init` + seed bead graph (including **#2b**), (2) claim Phase 0 bead, (3) Node 22 + Astryx + brand + CI web build/doctor, (4) claim **#2b**, (5) claim Phase 1 bead, etc.

After Phase 0, run `pnpm astryx template --list` / `component --list` and attach findings to the relevant beads (`bd update <id> --notes`).