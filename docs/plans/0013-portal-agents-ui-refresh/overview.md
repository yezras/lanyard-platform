# 0013 — Portal Agents UI refresh

**Umbrella epic:** created as beads under this plan (see Beads section after create).  
**Surfaces:** product Portal web (`@lanyard/web` @ `demo.localhost:3010`) + marketing demo mock (`lanyard-site` mock-portal @ `:3000`).  
**Related:** scheduled tasks epic `lp-jzl` / plan [0012-scheduled-tasks](../0012-scheduled-tasks/overview.md); dither subagent roster already in chat timeline.

## Context

Product feedback: the chat Directory still feels like a generic chat app (New chat / New project side-by-side, bubble icons, “Scoped to {project}” chrome, Settings Overview). We want an **Agents** mental model: named agents with dither avatars, a single create affordance, Tools instead of Settings, and a perpetual **Scheduled Tasks** stream per job.

## Live evidence (2026-08-11)

| Surface | URL | Observed |
|---------|-----|----------|
| Local product | `http://demo.localhost:3010` login `dev@demo.local` | Top tabs **Chat / Vault / Settings**; sidebar **New chat** + **New project**; folder projects; chat-bubble thread rows with ellipsis titles; composer **Scoped to Clients** |
| Marketing demo | `http://127.0.0.1:3000` mock-portal | Same IA: **Chat** tab, **New chat**, folder + bubble icons; Settings left rail **Snapshots / Skills / Workflows / Crons / …** (not yet “Scheduled tasks” label in mock) |
| Artifacts | `artifacts/ui/portal-refresh/` | Playwright shots: `21-after-login.png`, `04-mock-portal-chat.png`, `02-settings.png`, etc. |

## Scope

### In

1. Remove composer “Scoped to …” hint (project chip remains).
2. Single **+** control (dark affordance) → dropdown **New Chat**, **New Project**, **New Scheduled Task**.
3. Top tab / mobile header **Chat(s) → Agents**; product language: list items remain *chats*, selector is *Agents*.
4. Per agent/chat: random dither avatar (reuse procedural dither), LLM-assigned name after create, double-click rename (sidebar + chat chrome).
5. Two-line agent row: line 1 = agent name; line 2 = subtitle with ellipsis (preserve truncation behavior).
6. **New Scheduled Task** opens new chat with scheduled-task wizard (wire existing pure wizard + Settings form path).
7. Top tab **Settings → Tools**; remove **Overview** section; Tools page shows only type selectors (no redundant Settings/Agents/Tools chrome).
8. Perpetual **Scheduled Tasks** folder under Agents (calendar icon, not folder); one chat per job named after the job; every run appends to that chat stream (no new chat per fire).

### Out (for this epic)

- Renaming Vault tab or full shell redesign beyond Agents/Tools.
- Building a third avatar asset library (reuse existing dither pattern system).
- Live Daytona fire proof (still `lp-jzl.8` / OPERATOR HOLD); this epic owns **Portal stream binding + UX** that fire can deliver into.
- Full marketing-site copy rewrite outside mock-portal parity.

## Domain model (foundational)

```text
AgentChat (thread)
  thread_id
  title                    // display name (LLM or user)
  title_source             // "default" | "llm" | "user" | "job"
  avatar_seed              // stable random at create; dither from seed
  project_id?              // vault project folder (null = General)
  kind                     // "interactive" | "scheduled_task"
  scheduled_job_id?        // when kind=scheduled_task

ProjectFolder              // existing agent projects (Directory)
ScheduledTasksFolder       // synthetic perpetual group (not a vault project)

Job → AgentChat            // 1:1 durable; fire always posts into that thread
```

## Phases (delivery order)

| Phase | Goal | Depends |
|-------|------|---------|
| **A** Subtract chrome | Drop scope hint; drop Settings Overview; rename Chat→Agents, Settings→Tools; simplify Tools header | — |
| **B** Plus menu | Unified + dropdown: New Chat, New Project, New Scheduled Task | A (label IA) optional |
| **C** Agent identity | avatar_seed + dither row; LLM name; double-click rename; 2-line SideNav row | B optional parallel after types |
| **D** Wizard entry | Plus → New Scheduled Task starts chat wizard (ChatView wire) | B |
| **E** Scheduled streams | Perpetual folder, job↔thread binding, fire append to same chat | D + `lp-jzl` fire path |
| **F** Demo mock parity | `lanyard-site` mock-portal mirrors IA for marketing demo | A–D UI can parallel; E mocked |
| **G** Verify | Playwright ui-testing + unit tests on both surfaces | phases |

## Principles that shape the plan

- **Experience first:** Agents naming and single + menu over preserving old two-button chrome.
- **Subtract before you add:** remove Overview + scope hint before new folder kinds.
- **Foundational thinking / model the domain:** job↔thread and avatar_seed land before visual polish.
- **Redesign from first principles:** Scheduled Tasks is a first-class Agent group, not a Settings-only inventory.
- **Sequence verifiable units:** each phase has unit tests + one Playwright proof.
- **Make operations idempotent:** ensuring a job’s stream chat is ensure-or-create, not create-on-every-fire.
- **Prove it works:** local `demo.localhost:3010` + site mock screenshots under `artifacts/ui/`.

## Alternatives considered

| Approach | Verdict |
|----------|---------|
| Label-only rename (Chat→Agents) without identity model | Rejected: avatars/names need durable fields |
| Reuse Settings cron list as “folder” (no threads) | Rejected: user wants run output as chat stream |
| New chat per cron fire | Rejected explicitly; one stream per job |
| Hash avatar from title only | Acceptable fallback; prefer random seed at create so rename does not re-skin the agent |

## Implementation repos

| Repo | Owns |
|------|------|
| `lanyard-platform/portal/packages/web` | Product UI |
| `lanyard-platform/portal/packages/bff` (+ CP if job binding lives platform-side) | Thread metadata, job→thread, fire delivery into chat |
| `lanyard-agent` (optional) | LLM auto-name turn; cron deliver path into Portal thread |
| `lanyard-site` | Marketing mock-portal parity |

## Verification

See **[testing.md](./testing.md)** for selector map, BASE_URL, and artifact paths.

```bash
# Product unit
pnpm -C portal/packages/web test

# Product live (stack up) — lp-fn5.7.1
export BASE_URL=http://demo.localhost:3010
export UI_ARTIFACTS=../../../../artifacts/ui/portal-agents-refresh
cd portal/packages/web/ui-testing
pytest -v test_portal_agents_refresh.py
bash "$HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.sh"

# Demo mock
# npm run dev in lanyard-site; Playwright against :3000 mock-portal selectors
```

## Beads

**Umbrella:** `lp-fn5` — Portal UI refresh: Agents IA, Tools, scheduled-task streams

| Sub-epic | ID | Leaf tasks |
|----------|-----|------------|
| A Subtract chrome + rename | `lp-fn5.1` | `.1.1` scope hint · `.1.2` Agents tab · `.1.3` Tools tab · `.1.4` drop Overview |
| B Unified + menu | `lp-fn5.2` | `.2.1` dark + menu · `.2.2` New Scheduled Task stub |
| C Agent identity | `lp-fn5.3` | `.3.1` metadata · `.3.2` dither row · `.3.3` double-click rename · `.3.4` LLM name |
| D Chat wizard entry | `lp-fn5.4` | `.4.1` wire wizard · `.4.2` Plus starts wizard |
| E Scheduled streams | `lp-fn5.5` | `.5.1` job↔thread · `.5.2` calendar folder · `.5.3` fire append |
| F Demo mock parity | `lp-fn5.6` | `.6.1` site mock-portal |
| G Verification | `lp-fn5.7` | `.7.1` Playwright selectors/tests |

**Deps:** B blocks on A · D on B · E on D · F on A · G on E. C is parallel-ready after types land (no hard block on A).

**Done (merged):** Sub-epics A–F (`lp-fn5.1`–`lp-fn5.6`) — product + mock-portal on `main`.  
**G Verification:** `lp-fn5.7.1` — Playwright selectors + `test_portal_agents_refresh.py` (this plan’s testing.md).

### Wave drain launch (canonical)

```bash
# From lanyard-platform. Prefer model-launched workflow with high budget.
# ALWAYS auto_merge=true for this epic (human authorized 2026-08-11).
# /workflow beads-wave-drain  with args:
#   {"epic_id":"lp-fn5","concurrency":3,"max_waves":10,"auto_merge":true,"base_branch":"main","repo_root":"/home/operator/Lanyard-Dev/lanyard-platform"}
```

```bash
cd /home/operator/Lanyard-Dev/lanyard-platform
bd show lp-fn5
bd ready --parent=lp-fn5
```
