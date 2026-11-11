# Portal workflow author/save hook (agent tool contract)

**Bead:** `lp-khq.10` (platform pointer) · residual `lp-khq.11` (authoringDir ↔ registryScan)  
**Agent bead:** `lac-bwe` (implementation in **lanyard-agent**)  
**Unblocks:** `lp-khq.8` — Portal Workflow chat wizard  
**Epic:** `lp-khq` — Portal UX wave (composer attach, tools polish, file-ref tokens)

## Purpose

Portal’s workflow wizard must **create and persist** workflow definitions without
users pasting raw IR JSON. Authoring lives on the agent host via the existing
`workflow` chat tool (same name; extended `action` enum only — tools[] stability).

This document is the **cross-repo contract** for lp-khq.8 implementers. Code
changes ship in **lanyard-agent** (`lac-bwe`); Portal consumes them through the
chat tool path (and may later wrap Brain RPC if needed).

## Surface

| Item | Value |
| --- | --- |
| Tool name | `workflow` (unchanged) |
| New actions | `create`, `save`, `validate_definition` |
| Existing actions | `launch`, `status`, `list`, `pause`, `resume`, `stop` |
| Persistence | Host-owned IR under `{project\|vault}/.lanyard/workflows/{name}.json` |
| Launch after create | By **name** (registry refresh) or by returned **path** |

## Structured fields (no raw IR)

```ts
// action = create | save | validate_definition
{
  action: "create" | "save" | "validate_definition",
  name: string,              // kebab-case (free text is normalized when possible)
  description: string,       // one-line summary
  when_to_use?: string,
  stages: Array<{
    name: string,
    description?: string,
    agents?: Array<{
      prompt: string,        // required when agents[] entry present
      description?: string,
      role?: string,
      capability_mode?: "read-only" | "read-write" | "execute" | "all",
      isolation?: "none" | "worktree",
      label?: string,
    }>,
  }>,
}
```

### Stage → IR mapping (host-owned)

| Agents in stage | IR steps |
| --- | --- |
| 0 | `phase` (+ optional `log` from description) |
| 1 | `spawn_agent` |
| 2+ | `parallel` panel (≤ host `MAX_PARALLEL`) |
| (end) | `complete` with stage name list |

Default agent `capability_mode` is **`read-only`** when omitted.

### Action semantics

| Action | Write | Exists on disk |
| --- | --- | --- |
| `validate_definition` | No | N/A — structural only |
| `create` | Yes | **Fails** if `{name}.json` already exists |
| `save` | Yes | Create or overwrite |

Successful create/save returns JSON details including `name`, `path`, `stages[]`
summary (`agent_count`), and `created` / `updated`. Failure returns
`success: false` with `error` / `definition.errors[]`.

## Portal wizard call sequence (lp-khq.8 sketch)

1. Collect name → purpose → stages/agents via local MCQ (no IR editor).
2. Optional: `workflow({ action: "validate_definition", name, description, stages })`.
3. Persist: `workflow({ action: "create", … })` (or `save` when editing).
4. Optional first run: `workflow({ action: "launch", name, validate_only?: true })`.

Prefer **create** for blank “New workflow”; use **save** for re-edit.

## Portal create → inventory confirm (lp-khq.12.2)

After the wizard posts the structured create request into chat:

1. Portal leaves the wizard session on step **`creating`** (pending). It must
   **not** claim Tools → Workflows / `$` success yet.
2. Host runs `workflow` action=`create`|`save`, writes IR, and rescans the
   definition registry (lp-khq.11 / lac-bwe).
3. On terminal tool_progress for bare tool name **`workflow`** with
   action create/save (or aliases), Portal:
   - Treats the event as an inventory mutator (`SettingsSnapshotContext`)
   - Optimistically upserts `{id,name,path}` into the shared settings snapshot
   - Claims success in chat only after this confirmation
   - Calls `refreshSnapshot()` so Tools → Workflows and `$` typeahead match host
4. On tool failure (`success: false` / tool_status error), Portal restores the
   confirm MCQ and never claims inventory success.
5. **Empty-host clobber guard (lp-khq.13):** `refreshSnapshot` merges the
   fetched snapshot over local state via `mergeIncomingSettingsSnapshot`. An
   empty (or partial) host `workflows` list must **not** wipe recent optimistic
   upserts — Tools → Workflows and `$` stay populated until the host lists the
   new row or the sticky window (~2 min) expires. Debounced
   `scheduleInventoryRefresh` after create is covered by the same merge.

Failed create must not claim Settings / typeahead success. Launch-by-name after
create requires host registry rescan (agent residual lp-khq.11 / PR #237).

## Host wiring notes (agent)

- Gateway / CLI: authoring dir from `projectRoot` → else `vault_root` → else first
  `workflow.definition_roots` entry (writes `{root}/.lanyard/workflows/{name}.json`
  when using project/vault root; definition_roots entries are already workflow dirs).
- **`registryScan.projectRoot` must cover the same root as authoring** (lp-khq.11).
  Production gateway `agent-wiring` does not pass `projectRoot` — only config —
  so when authoring falls back to `vault_root`, that vault path is also the
  registry `projectRoot`. Without this, create succeeds on disk but launch-by-name
  fails until process restart.
- After write, host rescans the definition registry so **launch by name** works
  without process restart. Host-api also appends `authoringDir` to scan
  `definitionRoots` if it would otherwise be invisible (safety net).
- Builtins are never overwritten by authoring (first-wins scan order).

## Non-goals

- Dumping full IR schema into every completion `tools[]` prefix.
- Portal-owned workflow engine or inventory SoT.
- Requiring users to edit or paste IR JSON.

## Verification

**Agent (`lac-bwe` + residual `lp-khq.11`):**

- Unit: `packages/workflow/test/authoring.test.ts` (incl. incomplete scan safety net)
- Unit: `packages/agent-core/test/tools-workflow.test.ts` (create/save/validate_definition)
- Gateway: `apps/gateway/tests/workflow-authoring-registry.test.ts`
  (vault_root-only create → registry → launch-by-name; projectRoot precedence)
- Existing launch `validate_only` path unchanged

**Portal (`lp-khq.8`):**

- Wizard completable without JSON paste
- Host inventory / `$` token can resolve the new name after create (when host
  advertises workflows)

## Links

- Agent implementation: lanyard-agent bead `lac-bwe` · residual wiring `lp-khq.11`
- Platform epic: `lp-khq` · wizard: `lp-khq.8` · hook: `lp-khq.10` · residual: `lp-khq.11`
- Supersedes open drafts: platform PR #416 (docs pointer), agent PR #236 (authoring)
- Scheduled-task wizard parity pattern: `scheduledTaskChatWizard.ts`
