---
name: weekly-client-refresh
description: "Weekly client pipeline refresh: Gmail + Calendar + WhatsApp activity → structured follow-up report + prioritized to-dos. Uses native gws, wacli, and mcp_granola tools for client data work."
version: 1.3.0
author: Hermes Agent
license: MIT
tags: [crm, weekly, client-pipeline, gws, whatsapp]
related_skills: [client-crm-organization, gws-workflow-weekly-digest, persona-exec-assistant, gws-gmail, gws-calendar, wacli]
category: crm
---

# weekly-client-refresh

Weekly client activity briefing for the Lanyard CRM portfolio.

## When to Use
- User requests a "weekly refresh", "full refresh on the past week", "client activity report", or "what happened this week + next week"
- Combines Gmail, Calendar, WhatsApp, and Lanyard client notes into one prioritized briefing
- Use native tools: gws CLI/skills, wacli, mcp_granola_* for data retrieval

## Prerequisites
- gws CLI authenticated (Gmail + Calendar)
- wacli / WhatsApp linked device available
- Access to `<VaultRoot>/Clients`
- mcp_granola tools available for meeting notes

## Workflow

1. **Retrieve data using native tools**:
   - Pull past week's Gmail using gws-gmail or gws CLI (gws gmail users messages list, triage, etc.)
   - Pull past + upcoming Calendar events using gws-calendar-agenda, gws-calendar
   - Pull WhatsApp client activity using wacli (note: last_sync_at often stale — treat message completeness as lower confidence)
   - Review recent Granola notes using mcp_granola_list_meetings / mcp_granola_query_granola_meetings / mcp_granola_get_meeting_transcript
   - Identify follow-ups and create a prioritized to-do list
   - **Never write to Lanyard without first presenting a review list** for approval

2. **Output Format** (standard structure)
   - **Key Activities from the Past Week**
   - **Follow-Ups Needing Attention** (with client + specific action)
   - **Coming Week To-Dos** (prioritized, with dates/times where known)
   - Any CRM hygiene issues (e.g. inconsistent stages in clients_crm.db)
   - WhatsApp sync confidence note (wacli last_sync_at often stale)

3. **After data collection**
   - Review the generated report
   - If user approves changes to Lanyard, proceed with writes using client-crm-organization + ob sync
   - **YES to CRM hygiene:** execute `client-crm-organization` → `references/crm-pipeline-hygiene.md` (DB stages, folder moves, INDEX, `scripts/bulk-fix-granola-agents-md.py`) without re-prompting per line item
   - Run `cd <VaultRoot> && ob sync` after markdown writes (one run is enough; concurrent-instance message on a second run is usually harmless)

## Data Retrieval Prompt / Commands (Native)
Use gws, wacli, and mcp_granola tools directly (no escalation).

Example commands:
- gws gmail +triage --format json
- gws calendar +agenda --today --format json
- wacli --account me messages list --read-only --json --limit 50
- mcp_granola_query_granola_meetings with query for recent client meetings

## Rules
- Always use native tools for client pipeline / WhatsApp / CRM / Granola work
- Never write directly to `<VaultRoot>/Clients` without a review list first
- Run `cd <VaultRoot> && ob sync` after any markdown changes

## Cron Job Configuration Requirements

See **client-crm-organization** `references/crm-cron-and-model-defaults.md` for model pin and job registry. Summary:

- **Skills**: `weekly-client-refresh`, `client-crm-organization`, `gws-gmail`, `gws-calendar`, `wacli` (Granola via built-in `mcp_granola_*` tools — not a skill name)
- **Model**: `grok-composer-2.5-fast` via **`xai-oauth`**
- **Delivery**: Target appropriate Slack channel for output
- **Debugging**: `references/cron-debugging.md`
