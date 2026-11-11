# Granola Access — Deprecated Grok Connector Path

**This path is deprecated.** 

Native `mcp_granola_*` tools are now available directly in Hermes (via native-mcp skill and config.yaml MCP servers). Use those instead of any Grok CLI or escalate-to-grok for Granola access.

## Current Recommended Path
- `mcp_granola_list_meetings`
- `mcp_granola_query_granola_meetings`
- `mcp_granola_get_meeting_transcript`
- etc.

See delegation-policy.md for the updated native-first policy.

If the Granola MCP server is not yet configured in `~/.hermes/config.yaml`, add an entry for the Granola MCP endpoint.

Older Grok CLI invocation patterns are no longer required or recommended for CRM/Granola work.