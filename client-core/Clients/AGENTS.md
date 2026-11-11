# AGENTS.md — Clients scaffold

The `Clients/` folder is an optional CRM and account workspace scaffold for this Company Brain.

## Source of truth

- Structured CRM data lives in the local SQLite database created from `Clients/schema.sql`.
- The database file `Clients/clients_crm.db` is local runtime state and must not be committed.
- Human-readable summaries live in each account folder's `AGENTS.md`.

## Buckets

- `Active/`
- `Discovery/`
- `Prospect/`
- `Graveyard/`

Update `Clients/INDEX.md` if the org uses different pipeline stages after Discover.

## New account folder

Create:

- `Clients/<Bucket>/<AccountName>/AGENTS.md`
- `Clients/<Bucket>/<AccountName>/RECALL.md`
- `Clients/<Bucket>/<AccountName>/notes/`
- `Materials/` and `Projects/` when needed

Use templates from `templates/clients/`.

## Rules

- Query the CRM database before and after account-touchpoint work when CRM is in use.
- Keep account `AGENTS.md` aligned with structured CRM fields.
- Keep `Clients/INDEX.md` aligned with folder moves.
- Never commit real notes, transcripts, contacts, proposals, or CRM rows to the seed git remote.
