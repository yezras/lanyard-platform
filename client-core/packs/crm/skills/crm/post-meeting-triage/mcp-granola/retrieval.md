# Granola Meeting Retrieval (Native MCP Tools)

**This is the authoritative instruction path for Step 1 of post-meeting-triage.**

Use **only** the native `mcp_granola_*` tools (no delegation).

## Available Tools

- `mcp_granola_list_meetings` (time_range: this_week | last_week | last_30_days)
- `mcp_granola_query_granola_meetings` (natural language query, optional document_ids)
- `mcp_granola_get_meetings` (array of meeting_ids for metadata + summary)
- `mcp_granola_get_meeting_transcript` (full verbatim transcript by meeting_id)
- `mcp_granola_get_account_info` (current Granola account/email/workspace)
- `mcp_granola_list_meeting_folders` (folder structure)

## Recommended Sequence

1. **Confirm identity** (optional but recommended):
   ```bash
   mcp_granola_get_account_info
   ```

2. **List recent meetings**:
   - Use `mcp_granola_list_meetings` with `time_range="last_30_days"` (or shorter).
   - Identify the target meeting by title, date, and participants.

3. **Query for specific client** (if known):
   - `mcp_granola_query_granola_meetings` with query like `"most recent meeting with AcmeCo"` or `"AI Workshop Content Plan"`.

4. **Fetch details**:
   - For the chosen `meeting_id`:
     - `mcp_granola_get_meetings` → summary, participants, metadata
     - `mcp_granola_get_meeting_transcript` → full verbatim content (use when exact quotes or detailed action items are needed)

5. **Extract key information** for CRM:
   - Client name / bucket
   - New or updated contacts (name, email, role, company)
   - Meeting date/time
   - Key discussion points, decisions, next steps
   - Any action items for <LanyardOperator> or client

## Post-Retrieval Rules

- **Always** compile a clear **review list** of proposed changes before any writes:
  - New/existing client folder path
  - Contacts to add/update in AGENTS.md or db
  - Note file to create in `notes/`
  - DB entries for `clients_crm.db`
  - Updates to INDEX.md or other indexes

- Obtain explicit user approval on the review list **before** using `write_file`, `patch`, `terminal` for folder creation, or any DB operations.

- After approved writes: run `cd <VaultRoot> && ob sync`

- If new markdown artifacts were created, consider `mempalace mine` on the client wing (per client AGENTS.md RECALL section).

## Error Handling & Edge Cases

- If no recent meetings match the client, fall back to broader `last_30_days` list or ask user for meeting ID.
- If Granola tools are missing from the toolset, see `connectivity.md` for diagnostics and fresh-session fix.
- For cron runs: the prompt must explicitly instruct use of native `mcp_granola_*` tools; do not include a separate "mcp_granola" skill name.

## Next Step in Workflow

After retrieval + approval → proceed to **Step 1.5: Suggest Email Type** (see main SKILL.md) and then the chosen template in `email-type/`.

## References

- `connectivity.md` (this folder) — MCP server setup and troubleshooting
- `references/native-tools-policy.md`
- `client-crm-organization` skill for filing rules
- `email-type/index.md` for email type decision
