# 0015 — LA harness spawn_subagent (isolation none)

**Bead:** `lp-oop.38.14`  
**Epic:** `lp-oop.38` (plan 0015 / ADR 0012)  
**LA repo:** [LanyardBrain/lanyard-agent](https://github.com/LanyardBrain/lanyard-agent)

Cross-repo note: the live tools runner lives in `lanyard-agent`, not Portal. This file records the LA PR + SHA so platform close evidence stays in-tree.

Portal already maps `tool_kind=subagent` (`lp-oop.38.7`). This leaf registers the lifecycle tools instead of fail-closed unknown names.

## Placement

Nested agent-core sessions in the same Fargate Node process. Not a second service. Not a Daytona container. Child `bash` / `read` / `grep` / `find` / `ls` reuse the parent `ToolboxClient` and the turn's `sandbox_id`. Isolation is `none`. Worktree isolation is out of this bead.

Vault config (MockLab v1):

```yaml
subagents:
  enabled: true
  default_isolation: none
  max_depth: 1
```

When the block is omitted or `enabled` is not true, spawn names stay fail-closed. The MockLab harness start wrapper materializes this block on `$BACKEND_HOME/config.yaml` when it is omitted so live turns advertise `spawn_subagent` without waiting on kitchen-sink `lp-oop.38.18`. Explicit `subagents.enabled: false` is left alone.

The image bake pin is this SHA (`lanyard/harness:la-2477b22`). File/bash-only `ad0ef5a` has no spawn schemas; a tools runner from that pin replies `SPAWN_TOOL_MISSING` after `ls`. Config seed cannot advertise a tool the baked JS does not export.

## LA ship

| Field | Value |
|---|---|
| PR | https://github.com/LanyardBrain/lanyard-agent/pull/253 |
| SHA | `2477b22ec4d33161a6ff122cef6b01fe268d98de` |
| Branch | `beads/lp-oop.38.14-enable-spawn-subagent-on-the-harness-run` |
| Stacks on | LA #251 (`lp-oop.38.7`) |

## Proof

Offline: `pnpm --filter @lanyard-agent/adapters-portal test` including `test/harness-subagents.test.ts`.

- Spawn tools advertised only when `subagents.enabled` is true.
- Child bash execute uses the parent `sandbox_id`.
- Spawn result is not `SUBAGENTS_DISABLED` / `HARNESS_SUBAGENT_FAIL_CLOSED`.
- `tool_kind=subagent` rows emit. Nested child tools carry `parent_subagent_id`.

Live 2026-08-21: Fargate `:10` / `la-2477b22` boots `spawn_schemas=present`, `subagents=enabled`, `runner=tools`. MockLab thread `0f2b339d` called `spawn_subagent` for `qa-helper` (`sa-1c7d3c54`). Follow-up thread `ba85bef3` showed the 2-agents chip, `qa-helper` activity detail (`isolationEffective: none`), and reply `SUBAGENT_OK` / isolation none. Screenshots: `artifacts/ui/lp-oop.38.14/08-subagent-row.png`, `09-activity-detail.png`, `10-roster.png`. Not `SUBAGENTS_DISABLED`. Previous `:9` / `la-c64a598` was 38.7 file/bash only (`SPAWN_TOOL_MISSING`). Image bake `HARNESS_REQUIRE_SPAWN=1` refuses a file/bash-only dist. Guest snapshot stays tool-only. Kitchen-sink skills/MCP/workflow trees remain `lp-oop.38.18`.

## Forbidden

- Second Fargate service for children.
- Fat guest / baking `lanyard-agent/` into the Daytona snapshot.
- Worktree isolation in this bead.
