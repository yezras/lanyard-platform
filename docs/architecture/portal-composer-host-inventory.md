# Portal composer host inventory (skills / agents / workflows)

**Bead:** `lp-rt5.6` (phase 4 — composer host inventory)  
**Epic:** `lp-rt5` — Portal agent-backend parity  
**Plan:** [phase-4-composer-host-inventory.md](../plans/0005-portal-agent-backend-parity/phase-4-composer-host-inventory.md)  
**Grill:** Q4 — inventory is **host/capability-driven**; no fake stubs; no Portal-owned orchestration  
**Implementation:** `portal/packages/web/src/features/chat/chatComposerTriggers.ts`, wired from `ChatView.tsx`

## Purpose

Define how the chat composer `/`, `@`, `#`, and (when advertised) `$` menus are
populated, and the **pass-through token conventions** host authors must honor.
Portal does **not** implement skill runners, agent orchestration, or workflow
engines — it only surfaces inventory and stamps tokens into the user message.

## Source of truth

| Surface | Source today | Empty inventory behavior |
| --- | --- | --- |
| **Skills** (`/`) | `settings.snapshot.skills` (enabled only) via `skillsToSearchItems` | Omit `/` trigger — **no** hard-coded `summarize` fallback |
| **Agents / contexts** (`@`) | Host-advertised agents when present; optional product-local vault file paths from `vault.list` tree | Omit `@` trigger — **no** `researcher` / `writer` / `agent` stubs |
| **Tags** (`#`) | Product-local defaults (`DEFAULT_CHAT_TAGS`) until project tags exist | Always available (product-local allowed) |
| **Workflows** (`$`) | Host-advertised list only (capabilities / future list method) | Omit `$` — **no** Portal workflow runner UI |

Prefer reusing **settings snapshot** and **capabilities** before adding new Brain
RPC methods (`agents.list` / `workflows.list`). Contract expansion is optional
and only if snapshot is insufficient.

## Token conventions (for host authors)

Tokens are plain text in the user message. Portal serializes selection to these
shapes; the host interprets them on the agent turn.

| Trigger | Serialized form | Meaning |
| --- | --- | --- |
| `/` | `/skill-name` | Invoke or prefer the host skill whose **display name** is `skill-name` (label from snapshot). Skill **id** may differ; hosts should resolve by name or map known aliases. |
| `@` | `@agent-id` | Address a host-advertised agent/context by **id**. Vault path contexts use `@/path/to/file` style ids (path as id). |
| `#` | `#tag-id` | Product-local tag; not a host orchestration primitive. |
| `$` | `$workflow-id` | Host-advertised workflow by **id**. Portal only inserts the token; it does not schedule or run workflows. |

### Rules

1. **Pass-through only.** Portal does not expand tokens into multi-agent graphs.
2. **No inventing inventory.** If the host snapshot/list is empty, the menu is
   omitted (except product-local `#` tags).
3. **Do not branch UI on `backend_kind`.** Gate on capabilities / methods /
   snapshot fields.
4. **Subagent tool events** in the timeline remain **read-only telemetry**
   (existing). Seeing `researcher` in a tool call does not reintroduce stub
   entries in the composer menu.
5. **Host honor contract.** Sister agent track must surface skills (and
   agents/workflows if claimed) in snapshot or list methods and honor
   slash/mention/workflow tokens on the agent turn.

## Web wiring

```text
SettingsSnapshotProvider
  └─ settings.snapshot.skills → skillsToSearchItems → buildComposerTriggers({ skills })
ChatView
  └─ vault tree files → vaultPathsToSearchItems → buildComposerTriggers({ contexts })
  └─ (future) host agents/workflows → agentsToSearchItems / workflowsToSearchItems
```

`buildComposerTriggers`:

- Includes `/` only when `skills.length > 0`
- Includes `@` only when `contexts.length > 0`
- Always includes `#` (tags, with product defaults)
- Includes `$` only when `workflows.length > 0`

There is **no** `DEFAULT_AGENT_STUBS` production constant. Fake agent lists must
not reappear in the production path.

## Verification

**Static (this bead):**

- Unit: empty sources → only `#`; no `researcher` / `writer` / `summarize` /
  stub `agent` in menus
- Unit: fixture skills A,B → `/` search returns A,B
- Unit: host workflows non-empty → `$` present; empty → `$` absent

**Joint GO (phase 6, `lp-rt5.8`):**

- `composer.skills_from_host`
- `composer.no_default_agent_stubs`

## Non-claims

- Portal is not a workflow engine or multi-agent orchestrator
- Vault file paths under `@` are optional product context, not host “agents”
- Integrations (MCP / Gmail rows in settings) are **not** auto-promoted to `@`
  agents unless a future inventory field maps them explicitly
- No new Brain RPC methods required for phase 4 when snapshot skills suffice
