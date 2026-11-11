# Phase 7 — Toolbox bind

Back: [overview](./overview.md). Beads: `lp-oop.24`–`.28`.

## Goal

Harness tool calls exec on the user sandbox. Guest is a tool, not a host.

## Changes

- CP (or a small internal client) wraps Daytona `POST …/toolbox/{id}/process/execute`. Redact command lines in logs.
- Fake toolbox for tests.
- LA host adapter: file/bash tools call toolbox instead of local FS for the short-stack profile.
- Harness: `ensure_online(tenant, user)` then toolbox. Create env has no provider keys, no `GATEWAY_RELAY_SECRET`, and no MCP-named env keys.
- Vault stdio MCP (`lp-oop.38.19`) is a Daytona **process session** (create/attach/RPC/teardown), not `process/execute`. See [daytona-process-session-mcp.md](../../architecture/daytona-process-session-mcp.md).

## Data structures

`ToolboxExec { sandbox_id, argv, cwd, timeout_ms }` → `{ stdout, stderr, exit_code }`. Redaction at the log boundary.

## Verification

Fake toolbox tests. Invariant unit tests on create-env. No live Daytona in this phase.
