# Cron post-meeting-triage checklist

Autonomous scheduled run — no user present. Deliverable is the report; CRM writes wait for **YES** in Slack on the next interactive turn.

## Per meeting (this week / last_30_days)

1. `mcp_granola_get_meetings` for title, participants, summary, next steps.
2. **Map to client:** Query `clients_crm.db` contacts by attendee email before proposing a new folder (e.g. `<Email>` → existing **ExampleBilling** contact, not a new ExampleVendor bucket).
3. **Dedup:**
   - Vault: `find Clients -path '*/notes/*' -name 'YYYY-MM-DD-*.md'` for meeting date.
   - DB: `communications` row with meeting timestamp/summary.
   - Gmail: sent or draft for primary contact (`gws-gmail-draft-create.md` § List / inspect).
4. Classify: **already handled** | **needs CRM note only** | **needs new Gmail draft**.

## Email drafts in cron

- May create **drafts** without YES (no vault/db writes).
- Type B default when Granola lists scoped deliverables; Type A when only scheduling next call.
- Start deliverable with `⚠️ Skill(s) not found` if job lists `gws-gmail` but skill is missing — still use `references/gws-gmail-draft-create.md`.

## Deliverable sections

1. Granola account + meeting list
2. Table: meeting → client → vault/email status
3. **New this run** (draft ids created)
4. **Proposed CRM writes** (bullet list paths + DB fields) — explicit “Reply YES to apply”
5. Gmail triage snapshot if relevant (`gws gmail +triage` optional)

## After user YES (interactive only)

- Apply review list, `ob sync`, `mempalace mine --wing <slug>` per client touched.