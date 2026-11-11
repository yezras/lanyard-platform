# Native Tools Policy for CRM / Granola / Email Follow-up

**Effective rule:** All Granola meeting retrieval, CRM updates, client folder maintenance, contacts, `clients_crm.db`, AGENTS.md, and post-meeting email draft creation must use native Hermes tools only.

- `mcp_granola_*` family for meeting discovery, transcripts, and queries (list_meetings, query_granola_meetings, get_meeting_transcript, get_meetings, get_account_info).
- `gws-*` and gws CLI for all Gmail/Calendar/Drive actions.
- `wacli` for WhatsApp client activity.
- `client-crm-organization` for folder structure, AGENTS.md population, and db sync rules.

**Never** delegate this class of work to `grok` CLI, `escalate-to-grok`, or Codex.

**Canonical cron + model registry:** client-crm-organization `references/crm-cron-and-model-defaults.md`.

**Mandatory gate:** Present a review list of all proposed changes before any write_file, patch, or DB modification.

This policy was established because the required MCP connectors and gws/wacli tooling are now built directly into Hermes. Older delegation references in SKILL.md files, AGENTS.md templates, and cron prompts have been removed.