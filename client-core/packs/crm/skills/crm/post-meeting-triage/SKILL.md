---
name: post-meeting-triage
description: "End-to-end post-meeting triage skill: use native mcp_granola tools (via mcp-granola/ subfolder instructions) for Granola/CRM updates (notes, contacts, client folders, db), then prompt user for email type and create formal brief actionable follow-up email draft in Gmail via gws CLI. Enforces review-list approval, ob sync, and tone rules. Supports multiple email types via email-type/ folder and MCP connectivity via mcp-granola/. Type B uses paragraph narrative—see email-type/detailed-project-next-steps.md and references/gws-gmail-draft-create.md."
version: 1.4.0
author: Hermes Agent
tags: [crm, gmail, meeting, triage, gws, granola, mcp, client-crm-organization, email-type]
category: crm
---

# Post-Meeting Triage

Standardized workflow after any client meeting (Zoom, in-person, etc.) to file notes, maintain CRM, and generate a follow-up email draft.

## When to Use
- Immediately after a client meeting where Granola notes were taken or new contacts were identified.
- For new or existing clients in the Lanyard vault.
- Always before sending any follow-up.

## Skill Directory Structure (Instruction Paths)

This skill is broken down into dedicated subfolders for different instruction paths referenced throughout the workflow:

- **`mcp-granola/`** — MCP connectivity diagnostics + Granola meeting retrieval instructions (Step 1)
  - `connectivity.md` — Verify `mcp_granola_*` tools, troubleshoot session loading issues
  - `retrieval.md` — Exact sequence for listing, querying, and fetching meeting data/transcripts
- **`email-type/`** — Templates and drafting rules for different follow-up email types (Step 1.5 + Step 2)
  - `index.md` — Overview and decision guide
  - `schedule-next-steps-call.md` — Type A template
  - `detailed-project-next-steps.md` — Type B paragraph-narrative template
- **`references/`** — Supporting recipes, policies, and gws templates
  - `gws-gmail-draft-create.md` — gws CLI draft creation (interactive + cron)
  - `cron-triage-checklist.md` — scheduled-run dedup and deliverable shape
  - `templates/gws-draft-create.py` — copy/edit/run for cron drafts
  - `native-tools-policy.md` — Authoritative native-only rule
  - `delegation-policy.md`, `grok-connector-delegation.md`, etc.

All paths are self-contained so the main workflow can delegate to the appropriate subfolder without duplicating instructions.

## Core Rules (Non-Negotiable)
- **Granola / CRM updates**: Use native Hermes `mcp_granola_*` tools via `./mcp-granola/retrieval.md` and `./mcp-granola/connectivity.md`. Then apply client-crm-organization rules for filing. Always present review list before any writes to folders/db/AGENTS.md.
- **Email tone & format (Type B)**: Formal, brief, actionable. Type B uses **paragraph narrative** (recap + specific scheduling ask + workshop outcome paragraph + what <LanyardOperator> will send)—no bulleted action lists, no owner/due-date tables, no "Here's what I need from you" lists. Signature line is exactly `<LanyardOperator>`. See `email-type/detailed-project-next-steps.md` for the template.
- **ob sync**: Run `cd <VaultRoot> && ob sync` after every markdown change (git on master = required).
- **gws only**: Use gws CLI for all Gmail actions. Auth reset if invalid_rapt errors.
- **wacli**: Use for WhatsApp client activity when relevant.

## Workflow

### Step 1: Retrieve Meeting Data (MCP Path)
**Load and follow `./mcp-granola/retrieval.md`** for the complete native-tool sequence.

Key points (summary):
- Use `mcp_granola_list_meetings`, `mcp_granola_query_granola_meetings`, `mcp_granola_get_meetings`, `mcp_granola_get_meeting_transcript`.
- If tools are missing from the session toolset, first consult `./mcp-granola/connectivity.md`.
- Always produce a review list of proposed CRM changes for explicit approval before any writes.
- After approval: perform writes, then `ob sync`.

### Step 1.5: Suggest Email Type Based on Notes
After Step 1 approval, review the approved Granola notes and meeting summary. Suggest the most appropriate follow-up email type:

- Concrete project scope, setups, deliverables, or multiple forward-looking action items → **Type B**.
- General discussion or primarily scheduling the next conversation → **Type A**.

Present the suggestion in the standard format and load the chosen template from `email-type/`.

### Step 2: Create Follow-up Email Draft (gws)
Tone: formal, brief, actionable, shorter and to the point.

Use the exact template from the selected file in `email-type/`. Create the draft with gws per `references/gws-gmail-draft-create.md`.

This creates the draft directly in Gmail (DRAFT label). Open in Gmail to review/send.

### Step 3: Verification & Logging
- Confirm draft appears in Gmail.
- Verify new note and folder in `Clients/<Bucket>/<Client>/notes/`.
- Check `clients_crm.db` for new contacts/comms.
- Run `ob sync` again if any manual md edits.
- Optionally add the draft ID to the client's AGENTS.md under Next steps.

## Email Types
See the dedicated index and templates in the `email-type/` folder:
- `email-type/index.md` — Overview of all follow-up email types and how to choose between them.
- `email-type/schedule-next-steps-call.md` — Type A.
- `email-type/detailed-project-next-steps.md` — Type B paragraph template.

The workflow branches at Step 1.5 to the appropriate file in this folder.

## Example Full Run (Example Org case)
1. Use instructions in `mcp-granola/retrieval.md` (or query_granola_meetings) to find meeting with Example Org, get transcript.
2. Review list of proposed CRM changes approved.
3. Create Discovery/ExampleOrg/ + note + db entries + ob sync using client-crm-organization.
4. User selects email type (A or B) → load from `email-type/`.
5. gws draft created using the template + `references/gws-gmail-draft-create.md`.

## References
- `client-crm-organization` (folder structure, AGENTS.md.template, note-format, ob-sync-rule)
- `mcp-granola/` (connectivity + retrieval)
- `gws-gmail` (drafts.create, send)
- Lanyard memory rules for sync and gws auth reset
- `email-type/` (index.md, schedule-next-steps-call.md, detailed-project-next-steps.md)
- `wacli` for WhatsApp if needed
- `references/native-tools-policy.md` — authoritative native-tools-first rule
- `client-crm-organization/references/crm-cron-and-model-defaults.md` — cron model pin and registered job skill lists
- `references/rfp-xlsx-workbook-extract.md` — xlsx RFP attachments, etc.

## Pitfalls
(Kept from previous version; main changes moved to `mcp-granola/connectivity.md` and `references/native-tools-policy.md`)

- **Runner vs delegation:** Cron jobs run on Grok via xai-oauth; they still must call `mcp_granola_*` / gws / wacli directly — never `grok -p` or `escalate-to-grok` for connector access.
- **Cron skills array:** Do not include `codex`, `grok`, `escalate-to-grok`, or `mcp_granola` as skill names.
- **Review list:** Cron runs are autonomous — compile proposed CRM writes in the deliverable and only write after explicit user approval in interactive runs.
- **YES after cron:** A user **YES** on the cron summary in Slack authorizes the proposed CRM writes in the **next interactive turn**.
- **Missing `gws-gmail` skill:** Still create drafts using `references/gws-gmail-draft-create.md` + gws CLI directly.
- **After approved writes:** Run `mempalace mine` on the client folder when new markdown artifacts were added.
- **gws drafts:** Omitting `--params '{"userId":"me"}'` fails validation. Use **`gws gmail users drafts create`** / **`users drafts list`** — not `gws gmail drafts` (unrecognized subcommand).
- **`execute_code` in cron:** Blocked on scheduled jobs. Create drafts via **`write_file` + `terminal` `python3`** using `templates/gws-draft-create.py` (avoid multiline shell heredocs).
- **Cron dedup:** Before a new follow-up draft, check vault notes, `communications` in DB, and Gmail `labelIds` (SENT vs DRAFT). See `references/cron-triage-checklist.md`.
- **`mcp_granola_*` tools missing from the session:** See `./mcp-granola/connectivity.md` for diagnosis and the fresh-session (`/new`) fix. Never record it as "Granola doesn't work."
- **Stale per-client delegation rules:** When encountered, patch client AGENTS.md to require native `mcp_granola_*` tools and `ob sync`.

## Scheduling as Cron Job
The triage workflow is designed to be run on a schedule (e.g. weekdays at 12pm and 5pm).

Use the exact `/cron add` format shown in the previous version of this skill (or consult the latest in client-crm-organization references).

When creating/updating via `cronjob` tool, pin model and skills per `client-crm-organization/references/crm-cron-and-model-defaults.md`. Autonomous runs: **`references/cron-triage-checklist.md`**.

Note: Granola access uses built-in `mcp_granola_*` tools (no separate skill name in the skills array).

## Notes
- Always present review list before db/folder writes.
- Update this skill if gws CLI, mcp_granola tools, or email-type templates change.
- After creating or modifying any file in `email-type/` or `mcp-granola/`, follow project conventions for sync if applicable.
- [Skill directory: <HermesRoot>/skills/crm/post-meeting-triage]
- Resolve any relative paths in this skill against that directory.

After any update to this SKILL.md or files in subfolders, remember to run: `cd <VaultRoot> && ob sync` (if on master branch) where relevant.
