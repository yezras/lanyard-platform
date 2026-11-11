# Granola MCP For Hermes

This component documents the reusable Hermes MCP connection for Granola meeting notes and transcripts.

## Server

```yaml
mcp_servers:
  granola:
    auth: oauth
    enabled: true
    url: https://mcp.granola.ai/mcp
```

## Usage Contract

- Use Hermes-native Granola MCP tools for meeting-note queries, meeting detail retrieval, and transcript retrieval.
- Keep OAuth credentials in the local Hermes config and auth store only.
- Do not copy transcripts, private meeting notes, or attendee data into Core.
- Summaries added to reusable docs must be sanitized and stripped of client or employee-private details.

## Verification

In a Hermes environment, verify the server appears in MCP discovery and that the Granola tools are callable after OAuth authorization. If auth is missing, complete the OAuth flow from Hermes rather than adding tokens to this repo.
