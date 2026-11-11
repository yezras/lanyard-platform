# Granola MCP Connectivity & Diagnostics

**Purpose**: Ensure the native `mcp_granola_*` tools are available and correctly connected for all post-meeting triage workflows (interactive and cron).

## Configuration (Authoritative)

The Granola MCP server is defined in `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  granola:
    url: https://mcp.granola.ai/mcp
```

- Transport: HTTP
- Tools registered with prefix: `mcp_granola_*`
- Available tools: `mcp_granola_list_meetings`, `mcp_granola_query_granola_meetings`, `mcp_granola_get_meetings`, `mcp_granola_get_meeting_transcript`, `mcp_granola_get_account_info`, `mcp_granola_list_meeting_folders`

## Verification Commands

Always run these before relying on Granola data in a session:

```bash
hermes mcp list
hermes mcp test granola
```

Expected output:
- Server shows ✓ enabled
- "Tools discovered: 6" (or current count)
- "✓ Connected"

## Common Issues & Fixes

### Tools not present in current toolset (TUI session)

**Symptom**: `mcp_granola_*` tools do not appear even though the server is enabled in config.yaml.

**Root cause**: MCP tools are registered at **session start**. If the MCP server was enabled or the session was started before the config change, tools may not be injected.

**Fix**:
1. Start a **fresh session** (`/new` or new terminal UI instance).
2. Re-invoke the `post-meeting-triage` skill.
3. Re-run `hermes mcp test granola` to confirm.

**Never** fall back to delegating Granola work to `grok`, `escalate-to-grok`, or Codex. This violates the native-tools-policy.md.

### Invalid or stale connection

- Re-run `hermes mcp test granola`.
- If authentication or connection fails, check the Granola account via `mcp_granola_get_account_info`.
- The server may require re-auth in Granola app; the MCP endpoint handles it.

### Cron / scheduled runs

Cron jobs (e.g. daily-client-task-update, post-meeting-triage-cron) run in isolated sessions. The MCP tools are available if the server is configured at the Hermes process level. The skill prompt must **not** include `mcp_granola` in the `--skills` list — Granola access is via the built-in prefixed tools only.

See `references/native-tools-policy.md` and `client-crm-organization/references/crm-cron-and-model-defaults.md` for model and skill pinning rules.

## Integration with post-meeting-triage

- **Step 1** of the workflow (see `retrieval.md`) **must** use these native tools exclusively.
- Always call `mcp_granola_get_account_info` first if identity is uncertain.
- Present review list of findings before any CRM writes.

## Related Skills

- `native-mcp` — General MCP client documentation and config reference.
- `client-crm-organization` — CRM filing rules that follow Granola retrieval.

After any config change to `mcp_servers.granola`, restart Hermes Agent (or start fresh session) for tools to register.
