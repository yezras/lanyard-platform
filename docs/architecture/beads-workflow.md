# Beads workflow for monorepo migration

Bead: `lp-k7g.5.5` (phase 1 repository foundation).

This document defines how agents claim, update, close, and link migration Beads in this repository. Use **`bd` only** for task tracking — not markdown TODOs or ad hoc issue trackers.

Agent entry points: [AGENTS.md](../../AGENTS.md) and [CLAUDE.md](../../CLAUDE.md). Full CLI context: `bd prime`.

## Find and claim work

Start every migration session the same way:

```bash
bd ready              # Issues with no open blockers
bd show <id>          # Description, acceptance, deps, parent
bd update <id> --claim
```

| Command | When to use |
| --- | --- |
| `bd ready` | Discover unblocked work for this monorepo |
| `bd show <id>` | Read acceptance criteria, parent epic, and dependencies before editing |
| `bd update <id> --claim` | Mark the issue in progress and assign yourself |
| `bd list --status=open` | Broader backlog view |
| `bd list --status=in_progress` | Active claims |
| `bd blocked` | See what is waiting on other issues |
| `bd search <query>` | Keyword search across titles and descriptions |

Do **not** start implementation until `bd show` confirms the acceptance criteria and parent phase. Do **not** migrate product code unless a Bead explicitly asks for that import or product change.

## Update while working

Keep the Bead the source of truth for status and context:

```bash
bd update <id> --notes="..."      # Progress, links, blockers
bd update <id> --design="..."     # Design decisions worth retaining
bd update <id> --title="..."      # Only if the work scope truly changed
bd show <id>                      # Re-read after updates or handoff
```

- Prefer `--notes` for running commentary (PR draft URL, validation output paths, follow-ups).
- Prefer `--design` for durable technical choices that should survive the Bead.
- Create follow-up Beads with `bd create` rather than expanding scope silently.
- Link dependencies with `bd dep add <issue> <depends-on>` when work must wait on another issue.

Commit message convention for migration Beads:

```text
<id>: <short imperative summary>
```

Example: `lp-k7g.5.5: define Beads workflow for migration`.

## Close with completion evidence

When acceptance criteria are met, close with a reason that a reviewer can audit without replaying the session:

```bash
bd close <id> --reason="..."
```

### Required evidence in the close reason (and handoff summary)

| Evidence | Expectation |
| --- | --- |
| **Reason** | One or two sentences: what landed and why the Bead is done |
| **Acceptance checklist** | Each criterion from `bd show` marked met (or explicitly waived with justification) |
| **PR URL** | Link to the pull request when code/docs were proposed for merge (omit only if the orchestrator forbade push/PR) |
| **Test / validation evidence** | Commands run and pass/fail outcome (e.g. `bash scripts/validate.sh`, product tests after import) |
| **Changed paths** | High-level list of files or trees touched |

Example close reason:

```text
Beads workflow doc + AGENTS/phase-1 links. Acceptance: AGENTS points to bd ready/show; phase epics discoverable; completion evidence documented. PR: https://github.com/org/repo/pull/N. validate.sh: PASS.
```

### Handoff checklist (before declaring done)

1. Acceptance criteria from `bd show <id>` are satisfied or filed as follow-up Beads.
2. Quality gates for this phase pass (`bash scripts/validate.sh` for planning-shell work; product gates after import).
3. `bd close <id> --reason="..."` includes the evidence table items above (unless the orchestrator said **not** to close).
4. Remaining work is filed (`bd create`) and linked with deps when needed.
5. Git/sync follows the active agent profile: **minimal/conservative** reports status and proposed commands; do not push or close unless authorized.

Profile rules and session protocol live in the managed Beads blocks in [AGENTS.md](../../AGENTS.md) / [CLAUDE.md](../../CLAUDE.md). Orchestrator instructions always win.

## Discover phase epics

Main migration epic:

| ID | Role |
| --- | --- |
| `lp-k7g` | Migrate to Lanyard Platform monorepo (root epic) |

Phase epics (children of `lp-k7g`):

| Phase | Epic ID | Title | Plan doc |
| --- | --- | --- | --- |
| 1 | `lp-k7g.5` | Repository foundation | [phase-1-repository-foundation.md](../plans/0001-platform-monorepo-migration/phase-1-repository-foundation.md) |
| 2 | `lp-k7g.6` | Backend runtime contract | [phase-2-backend-runtime-contract.md](../plans/0001-platform-monorepo-migration/phase-2-backend-runtime-contract.md) |
| 3 | `lp-k7g.7` | Artifact and deploy generalization | [phase-3-artifact-deploy-generalization.md](../plans/0001-platform-monorepo-migration/phase-3-artifact-deploy-generalization.md) |
| 4 | `lp-k7g.8` | Portal backend abstraction | [phase-4-portal-backend-abstraction.md](../plans/0001-platform-monorepo-migration/phase-4-portal-backend-abstraction.md) |
| 5 | `lp-k7g.9` | Client-core migration | [phase-5-client-core-migration.md](../plans/0001-platform-monorepo-migration/phase-5-client-core-migration.md) |
| 6 | `lp-k7g.10` | Deploy migration | [phase-6-deploy-migration.md](../plans/0001-platform-monorepo-migration/phase-6-deploy-migration.md) |
| 7 | `lp-k7g.11` | Backend conformance and external readiness | [phase-7-backend-conformance.md](../plans/0001-platform-monorepo-migration/phase-7-backend-conformance.md) |
| 8 | `lp-k7g.12` | Cutover and repository archival | [phase-8-cutover.md](../plans/0001-platform-monorepo-migration/phase-8-cutover.md) |

Full task list under each phase: [issue-map.md](../plans/0001-platform-monorepo-migration/issue-map.md). Narrative plan: [overview.md](../plans/0001-platform-monorepo-migration/overview.md).

### CLI discovery

```bash
bd show lp-k7g          # Root epic + child phase epics
bd show lp-k7g.5        # Phase 1 epic + children (e.g. lp-k7g.5.1 …)
bd show lp-k7g.6        # Phase 2, etc.
bd ready                # Only unblocked leaf work
```

IDs are hierarchical: `lp-k7g.<phase>.<task>` under the phase epic. Planning records `lp-k7g.1`–`lp-k7g.4` are closed historical steps, not active phase epics.

## Link Beads to plans and code

| Artifact | How it relates to Beads |
| --- | --- |
| Plan phase docs | State the phase epic ID near the top (e.g. Bead: `lp-k7g.5`) |
| Issue map | Canonical static index of epic and task IDs |
| ADRs / architecture docs | Reference the Bead that introduced or supersedes them when useful |
| Commits | Prefix with Bead ID |
| PRs | Title or body includes Bead ID; close reason includes PR URL |
| Dependencies | `bd dep add <blocked> <blocker>` so `bd ready` stays accurate |

When creating new migration work:

```bash
bd create --title="..." --description="..." --type=task --priority=2 --parent=lp-k7g.5
# then, if needed:
bd dep add <new-id> <blocker-id>
```

Prefer `--parent=<phase-epic>` so children appear under the right phase in `bd show`.

## Offline validation of Beads export

Planning-shell validation includes Beads export health (no network, no `bd sync`):

```bash
bash scripts/validate.sh
```

Details: [validation-plan.md](validation-plan.md). Use this as default test evidence for docs/contracts/compatibility work in phase 1.

## Out of scope for this workflow

- Replacing `bd` with GitHub Issues as the primary tracker
- Committing or pushing without profile/orchestrator authority
- Migrating Portal, client-core, or deploy source without an explicit import Bead
- Storing secrets or live customer config in Bead notes
