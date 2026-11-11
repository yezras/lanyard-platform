# Daytona process-session bind for vault stdio MCP

Bead `lp-oop.38.19`. Follow-on from `lp-oop.38.17` (harness HTTP/stdio MCP; vault stdio was fail-closed).

stdio MCP that must see `/mnt/vault` is a JSON-RPC session, not one argv. Do not ship it as toolbox `process/execute`.

## Placement

| Transport | Where | How |
|---|---|---|
| HTTP / SSE MCP | Harness `fetch` | Existing `McpHttpClient` |
| stdio, no vault | Harness child | Existing `McpStdioClient` |
| stdio, needs `/mnt/vault` | Daytona process session | This doc. `use_tool` binds the session, never `process/execute` |

Guest `tool_only` create-env still has no MCP secrets (predicate: env key name contains `MCP`), no provider keys, no `GATEWAY_RELAY_SECRET`. Session exec may pass argv/cwd for the server binary on the snapshot or under `/mnt/vault`. Auth tokens stay on the Fargate harness.

## Session API

Default toolbox host: `https://proxy.app.daytona.io`.

Domain port: `ToolboxProcessSessionClient` in `@lanyard/shared`. HTTP adapter: `DaytonaToolboxSessionClient` in `@lanyard/control-plane`. JSON-RPC bind: `bindVaultMcpStdioSession`.

Session id: `lanyard-mcp-{server}` (slug of the MCP server name). One session per server per sandbox. Attach is idempotent: GET, create on 404, reuse a running `command_id`.

### create

```http
POST /toolbox/{sandbox_id}/process/session
{ "sessionId": "lanyard-mcp-vault-fs" }
```

### attach

```http
GET /toolbox/{sandbox_id}/process/session/{session_id}
```

404 → create. 200 with a command whose `exitCode` is null → reuse that `command_id` (do not exec or `initialize` again). JSON-RPC request ids continue from the max id already on stdout so `tools/list` does not match a leftover `initialize` response.

### exec (start the MCP process)

```http
POST /toolbox/{sandbox_id}/process/session/{session_id}/exec
{ "command": "python3 /mnt/vault/mcp/server.py", "cwd": "/mnt/vault", "runAsync": true }
```

`runAsync` is required. Response `cmdId` is the stdin/stdout handle. Argv is joined the same way as toolbox execute, but the path is `process/session/.../exec`, not `process/execute`.

### RPC (JSON-RPC 2.0, newline-delimited)

Write one request line:

```http
POST /toolbox/{sandbox_id}/process/session/{session_id}/command/{command_id}/input
{ "data": "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{...}}\n" }
```

Read accumulated stdout and pick the line whose `id` matches:

```http
GET /toolbox/{sandbox_id}/process/session/{session_id}/command/{command_id}/logs
{ "stdout": "...", "stderr": "..." }
```

Handshake on a fresh command: `initialize` then `notifications/initialized`. `tools/list` and `tools/call` follow. Logs may include non-JSON lines; ignore those.

### teardown

```http
DELETE /toolbox/{sandbox_id}/process/session/{session_id}
```

204 / 404 are success. Harness closes the bind at the end of the turn.

## Why not process/execute

`POST …/process/execute` is one argv → `{ stdout, stderr, exit_code }`. MCP needs a live stdin/stdout session across `initialize`, `tools/list`, and many `tools/call`s. Faking that with execute (write a request file, exec a helper, read a response file) is forbidden.

## Why not an HTTP MCP sidecar

A guest HTTP MCP in front of the vault would also see `/mnt/vault`. It needs a snapshot binary plus a preview URL from Fargate to the sandbox. Daytona already has process-session stdin and logs. Use that.

## Catalog (why live Tools was empty)

Tools snapshot is harness `BACKEND_HOME/config.yaml` (`source=harness`). A session client without a vault-required row is unused: `mcp_count=0` / `has_vault_stdio=false`, and the model falls back to bash `ls`/`find`.

Start wrapper fill-missing-merges secret-free `vault_fs` (cwd `/mnt/vault`, `requires_vault: true`, argv `/mnt/vault/mcp/vault_fs_server.py`) **before** the tools factory binds `BACKEND_HOME`. That is the catalog `use_tool` reads. BFF `SETTINGS_SEED_LAB_MCP` does not.

The Tools Command column is `command` (argv[0], not a secret). Snapshot collectors include it; env/headers stay off the snapshot.

The stdio binary is not on Fargate. Vault seed `mcp/vault_fs_server.py` is fill-missing-put onto `/mnt/vault` even when `AGENTS.md` skips a full re-seed, so Daytona process-session exec can see it. Guest create-env still strips MCP-named keys.

Local kitchen-sink BFF (no `HARNESS_URL`) binds `real harness (via harness-local)` to the same session port: catalog has `vault_fs` + `command: python3`, a chat turn emits `search_tool` / `use_tool` pills, `bindVaultMcpStdioSession` runs against `FakeToolboxProcessSession`, reply is the tool result (not `echo:`). Live MockLab catalog stays empty until the harness image is rolled.

## use_tool

Harness `createHarnessMcpInvoker` classifies vault-required stdio as `vault_session`. When `sandbox_id` and a `ToolboxProcessSessionClient` are bound, `use_tool` calls `bindVaultMcpStdioSession`. It does not call `ToolboxClient.execute`. Missing sandbox or session client still fail-closes honestly.

Start wrapper: LiteLLM tools factory first (`runner=tools`). If that returns null, LiteLLM no-tools (`runner=litellm`). If that is also missing, `createToolsTurnRunner` with a lab complete that calls `search_tool` then `use_tool` on `mcp__vault_fs__list_vault` (`runner=tools-lab`) so local UI QA is not `echo:`. Echo remains only when the lab bind is absent.

Companion: Lanyard Agent `lp-oop.38.19` on the harness runner.

## Tests

Offline only. Fake session + fake fetch.

```bash
pnpm --filter @lanyard/shared test src/toolbox/session.test.ts src/harness/vault-fs-turn.test.ts
pnpm --filter @lanyard/control-plane test test/daytona-toolbox-session-client.test.ts test/short-stack-create-env.test.ts
node --test deploy/dev/mocklab-short-stack-harness/merge-vault-fs-mcp.test.mjs
bash deploy/scripts/smoke-seed-mocklab-s3-vault.sh
bash deploy/scripts/smoke-mocklab-replace-echo-harness-la.sh
```
