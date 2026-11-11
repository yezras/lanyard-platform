---
name: gws
description: "Consolidated Google Workspace skill library. All gws-* and recipe-* skills live here, categorized for discoverability and agent use."
metadata:
  version: 0.1.0
  category: productivity
---

# GWS Skills Organization

All Google Workspace related skills (gws-* and recipe-*) have been consolidated under this umbrella.

## Bucket Structure
- `gmail/` — Gmail send, read, reply, filters, triage, watch, forward, label/archive
- `calendar/` — Calendar events, agenda, insert, events (incl. renew/subscribe), meet, tasks
- `drive/` — Core Drive + nested:
  - `sheets/` — Sheets read/append + recipe sheet ops
  - `slides/` — Slides creation
  - `docs/` — Docs + write
- `chat/` — Chat spaces and send
- `other/` — Admin reports, classroom, forms, keep, modelarmor, people, script, workflow, shared, and all cross-cutting recipes

## Usage Notes
- Prefer loading the specific sub-bucket skill when working in one domain.
- The `other/` bucket holds cross-service workflows and less frequently used admin capabilities.
- All skills require the base `gws` CLI and usually `gws-shared` patterns.

## Future Maintenance
When adding new gws or recipe skills, place them in the most specific bucket above. If a skill spans multiple buckets, default to `other/`.

## MCP Troubleshooting (Google Workspace Gmail/Calendar MCP servers)
The `googleworkspace-mcp` patterns for authentication, permission errors ("The caller does not have permission"), token inspection, scope mismatches, and SSH tunnel / redirect_port issues (e.g. 38080) are now documented here under the gws umbrella (even though originally categorized under mcp).

Common issues and diagnostics:
- Token file: `~/.hermes/mcp-tokens/googleworkspace_gmail.json` (check granted scopes vs config)
- Client reg: `~/.hermes/mcp-tokens/googleworkspace_gmail.client.json`
- Config: `~/.hermes/config.yaml` under `mcp_servers.googleworkspace_gmail`
- SSH OAuth redirect workaround: perform initial consent locally, not over SSH; use port forward for 38080 if needed.

See `references/googleworkspace-mcp-token-inspection.md` and `references/googleworkspace-mcp-ssh-tunnel-oauth.md` for the detailed recipes.

## References
- `references/organization-log.md` — initial reorganization session
- `references/googleworkspace-mcp-token-inspection.md`
- `references/googleworkspace-mcp-ssh-tunnel-oauth.md`
- `references/gws-drive-sheets-creation.md` — Drive folder + Sheets creation, parent move, tab addition (batchUpdate), and values population patterns (CLI quoting, addParents, sheetId vs title ranges)
