# New Client Onboarding

Standardized workflow for onboarding a new client into the Lanyard Obsidian CRM structure under `Clients/`.

## When to Use
- Adding a brand-new client after initial discovery, intro meetings, or proposal stage
- Converting a prospect into the formal folder + AGENTS.md + database-tracked structure
- Ensuring all prior meeting context is properly filed without direct Granola access

## Required Inputs (Collect from User)
Before creating any folders or files, gather the following (use `clarify` tool for structured collection when needed):

- **Company / Client Name** (exact folder name, e.g. "AcmeCo" or "AcmeCorp")
- **Pipeline Stage**: `Active | Discovery | Intro | Prospect | Graveyard`
- **Business Type** (Asset Management, Insurance, Credit Origination, Real Estate, etc.)
- **Key Contact(s)**: Name, email, role, and how the relationship was established
- **Next Steps** or open items from any prior conversations
- **Any existing meeting notes / Granola context** (use native mcp_granola tools to retrieve)
- Confirmation of the target bucket/folder path

## Step-by-Step Onboarding Procedure

### 1. Handle Existing Meeting Notes
- If any Granola transcripts, meeting notes, or CRM research exist: Use the native `mcp_granola_*` tools (e.g. `mcp_granola_query_granola_meetings`, `mcp_granola_get_meeting_transcript`, `mcp_granola_list_meetings`) directly to retrieve and process notes. These tools are built into Hermes.
- No delegation to Grok CLI or escalate-to-grok needed.
- Once retrieved, the notes will be ready for filing in the new `notes/` directory.

### 2. Create Bucket and Client Directory Structure
Use the pipeline stage to determine the bucket:

```bash
mkdir -p <VaultRoot>/Clients/<Bucket>/<ClientName>/notes
```

Examples:
- `Clients/Intro/AcmeCorp/notes`
- `Clients/Discovery/AcmeCo/notes`

### 3. Create and Populate AGENTS.md
- Copy the template from `references/AGENTS.md.template`
- Fill every field using the user-provided information collected above
- Place the completed file at the client root (not inside `notes/`):

  `<VaultRoot>/Clients/<Bucket>/<ClientName>/AGENTS.md`

### 3b. Create RECALL.md (MemPalace)
- If `RECALL.md` is missing at the client root, copy `references/RECALL.md.template` from this skill
- Set `client_slug`, wing `<slug>` (same as slug), and tailor queries (see `references/recall-playbook.md`)
- Ensure the **Recall (MemPalace)** block exists in `AGENTS.md` (included in `AGENTS.md.template`)

### 4. Insert into Client CRM Database
- Query the central `clients_crm.db` (or equivalent CRM index / Google Sheets) before and after setup
- Add a new record containing:
  - Company name / folder name
  - Bucket and pipeline stage
  - Key contacts and contact method
  - Full folder path
  - Business type and initial next steps
- **Phone numbers:** Store full digits from the user message (`tel:+1…` links or plain numbers). Do not copy Slack-redacted or masked placeholders into `contacts.phone`.
- Immediately update the new `AGENTS.md` to reference the database entry (see Agent Instructions section in template)
- Keep AGENTS.md in sync with the database at all times

### 5. File Initial Notes (if any)
- Place any provided meeting notes or context documents into:
  `<VaultRoot>/Clients/<Bucket>/<ClientName>/notes/`
- Use the strict naming convention: `YYYY-MM-DD-descriptive-kebab-case-title.md`
- Include required frontmatter (`date`, `from`, `subject`, `client`)

### 6. Update Root-Level Indexes (if needed)
- Review `Clients/INDEX.md` and the root `Clients/AGENTS.md`
- Add the new client to the appropriate bucket listing

### 7. Mandatory Vault Sync
After **every** Markdown file creation or modification in the Lanyard vault:

```bash
cd <VaultRoot> && ob sync
```

(Only skip if a git repo exists in the target subfolder **and** you are not on the master branch.)

## Splitting a Second Company from an Existing Client

When a principal (e.g. a CEO) runs **two or more separate companies** that are being tracked as separate CRM clients, follow the full onboarding procedure above **plus** these cross-referencing steps:

### Trigger
- A meeting note or AGENTS.md mentions a "second company" or "related venture" that was previously name-TBD.
- The user identifies the second company by name (e.g. "the MDS AI parsing software is called ExampleProduct").
- The second company has a distinct business model from the original client, even if the contact person is the same.

### Additional steps (after the standard onboarding procedure)

1. **Duplicate the contact in `contacts` table** — Insert a new contact row linked to the new `client_id`. Do **not** reuse the existing contact row (FK is per-client). Add a `notes` field cross-referencing the sibling client (e.g. *"Also CEO of ExamplePlatform (client_id=21)"*).
2. **Cross-reference in AGENTS.md** — In the new client's AGENTS.md key contacts section, note the sibling company and folder path. In the **existing** client's AGENTS.md, update the "name TBD" placeholder to the resolved name + folder path. Both files should mention each other.
3. **Cross-reference in RECALL.md** — Add a "Cross-reference (sibling client)" section in both RECALL.md files pointing to the other wing name and noting the shared contact.
4. **Update the existing client's DB record** — Update `next_step` on the original client to reflect the resolved name (e.g. change "Get the name of the second company" to "Second company identified as ExampleProduct").
5. **Update the existing client's AGENTS.md next steps** — Mark the "get the name" item as done with strikethrough and link to the new folder.
6. **INDEX.md** — Add the new client to the bucket tree.
7. **Original meeting note** — Do **not** move or duplicate the meeting note; it stays filed under the original client's `notes/` folder. Reference it from the new client's AGENTS.md Notes section with its full path.

### Example (ExamplePlatform → ExampleProduct, 2026-06-30)
- ExamplePlatform (`Clients/Discovery/ExamplePlatform/`) meeting on 2026-06-23 mentioned an unnamed "second company" for patient intake form automation.
- User identified it as **ExampleProduct** — created `Clients/Discovery/ExampleProduct/` with AGENTS.md, RECALL.md, `notes/` dir.
- Example Founder inserted as contact on **both** client records (ExamplePlatform client_id=21, ExampleProduct client_id=22).
- Both AGENTS.md files cross-reference each other; both RECALL.md files cross-reference the other's wing.
- Original meeting note stays at `Clients/Discovery/ExamplePlatform/notes/2026-06-23-meeting-with-example-founder.md` and is referenced from ExampleProduct's AGENTS.md.

## References
- `references/AGENTS.md.template` — required profile template
- `references/note-format.md` — note naming and frontmatter rules
- `references/ob-sync-rule.md` — mandatory sync step after any markdown change in the Lanyard vault
- `references/client-preferences.md` — storing client-specific rules
- Main skill: client-crm-organization
- Native tools: mcp_granola_*, gws-*, wacli

## Agent Reminders
- This onboarding action is the canonical entry point for all new clients.
- Always verify the folder does not already exist before creating.
- After onboarding, the client's `AGENTS.md` becomes the primary context file loaded for future work on that client.
- When a new client shares a principal with an existing client, follow the **Splitting** procedure above — do not skip cross-referencing.
