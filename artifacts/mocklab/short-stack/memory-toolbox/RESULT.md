# lp-oop.38.13 — Bind memory_read/write via toolbox MemPalace CLI

**Status:** PASS (offline + live MockLab turn). Live Fargate is family `lanyard-platform-staging-harness:11` / `LP_IMAGE_TAG=la-c41aca0` digest `sha256:3e425686` (LA PR 252 stacked on spawn `2477b22`). Boot logs `memory_read=present spawn_schemas=present runner=tools`. Turn `turn_3` (`thread_id=lp-oop-38-13-mem2`) called `memory_read`; result `No memory hits.` (unmined palace), not `BINARY_MISSING`, not `TOOL_NOT_AVAILABLE`. `apply_to_live` stays false (this pin is not a terraform apply).

## Root cause (UI QA FAIL)

Live MockLab advertised file tools only. The model listed tools, used `ls`, then replied `TOOL_NOT_AVAILABLE`. Vault `mempalace/` exists on kitchen-sink guests. Not `BINARY_MISSING`.

`loadHarnessMempalaceConfig` treated missing Fargate `$BACKEND_HOME/config.yaml` as `enabled: false`. Kitchen-sink `mempalace.enabled: true` lives on guest `$BACKEND_HOME` (ephemeral Daytona disk). Fargate does not have that file. Image roll of `59e235c` would still omit `memory_read`.

Fix: short-stack default is search-only `memory_read` against `/mnt/vault/mempalace`. Explicit `mempalace.enabled: false` or `HARNESS_MEMPALACE_ENABLED=0` omit it. `write_policy` still gates `memory_write`. Image bake sets `HARNESS_REQUIRE_MEMORY=1` so a spawn-only dist fails boot.

## Placement

Toolbox CLI. `MemoryClient` spawn = `ToolboxClient.execute`. Not a memory HTTP API. Not `mempalace` on Fargate.

- Binary: `/usr/local/bin/mempalace` (tool-only snapshot)
- Palace: `/mnt/vault/mempalace`
- cwd: `/mnt/vault`
- argv: `[/usr/local/bin/mempalace, --palace, /mnt/vault/mempalace, search, <query>, …]`
- Missing `sandbox_id`: fail-closed (not `MEMPALACE_BINARY_MISSING`)
- `write_policy` disabled: `memory_write` not registered

Companion LA: https://github.com/LanyardBrain/lanyard-agent/pull/252 (`c41aca0`, stacked on `2477b22`, `packages/adapters-portal/src/harness/mempalace.ts`). Platform bake stacks the 38.14 start wrapper so `HARNESS_REQUIRE_SPAWN=1` survives the memory SHA.

## Evidence

| Check | Result |
| --- | --- |
| `memory_read` registered when `mempalace.enabled` | PASS (`harness-mempalace-toolbox.test.ts`) |
| `memory_read` registered when Fargate has no `config.yaml` | PASS (`loadHarnessMempalaceConfig(undefined)` + runner without `backendHome`) |
| Execute is toolbox argv against `/mnt/vault/mempalace` | PASS (FakeToolbox lastExec + live turn_3) |
| Missing `sandbox_id` fail-closes | PASS; toolbox exec count 0 |
| Honest empty / unmined palace is not `BINARY_MISSING` | PASS (offline chroma.sqlite3 map + live `No memory hits.`) |
| `write_policy` disabled does not register `memory_write` | PASS |
| Explicit `enabled: false` / `HARNESS_MEMPALACE_ENABLED=0` omit | PASS |
| Live MockLab chat turn | PASS. 2026-08-21T02:56:49Z family `:11` / `la-c41aca0` digest `sha256:3e425686`. Boot `memory_read=present`. Turn `turn_3` tool `memory_read` completed with `No memory hits.` Not `BINARY_MISSING`. Not `TOOL_NOT_AVAILABLE`. `memory_write` not called. |
| `HARNESS_REQUIRE_MEMORY=1` fail-boot | PASS (smoke-mocklab spawn-only module exits 1) |
| `scripts/validate.sh` check 34 | PASS (wires `smoke-harness-mempalace-placement.sh`; pin SHA + no CLI on Fargate) |

Rerun:

```bash
# LA checkout at the companion SHA
pnpm --filter @lanyard-agent/memory test
pnpm --filter @lanyard-agent/adapters-portal test -- test/harness-mempalace-toolbox.test.ts test/harness-tools-runner.test.ts

# this repo
bash deploy/scripts/smoke-harness-mempalace-placement.sh
bash scripts/validate.sh
```
