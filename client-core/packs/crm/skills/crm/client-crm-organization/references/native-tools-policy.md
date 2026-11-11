# Native Tools Policy for Client CRM Organization

**Effective rule:** All client folder creation, AGENTS.md maintenance, note filing, `clients_crm.db` updates, and incorporation of meeting/Granola context must use native Hermes tools only.

- `mcp_granola_*` tools for retrieving meeting data (never delegate to grok CLI or escalate-to-grok).
- Direct use of `write_file`, `patch`, `terminal` (sqlite3, mkdir, etc.) + `client-crm-organization` actions.
- gws and wacli where relevant for contact or communication data.

**Never** route Granola/CRM organization work through external Grok delegation (`grok` CLI, `escalate-to-grok`, or Codex for connector access).

**Cron runner:** Scheduled CRM jobs still pin **`grok-composer-2.5-fast`** / **`xai-oauth`** as the executing model. That is independent of this policy — see `references/crm-cron-and-model-defaults.md`.

**Mandatory gate:** Always produce a review list before any DB writes or filesystem changes to client folders.

This replaces all prior Codex/Grok delegation language in new-client-onboarding.md, note-format.md, and AGENTS.md.template.