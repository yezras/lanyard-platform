# RECALL.md guidelines (Lanyard clients)

Full policy lives in `<VaultRoot>/AGENTS.md`. This reference is for the `client-crm-organization` skill.

## When to create

- New client onboarding (step after `AGENTS.md`)
- Any agent session that finds a client folder without `RECALL.md`
- User asks to enable MemPalace recall for a client

## Slug rules

| Folder name | `client_slug` | Wing |
|-------------|---------------|------|
| `AcmeCo` | `acmeco` | `acmeco` |
| `AcmePartners` | `acme-partners` | `acme-partners` |

Rule: lowercase; replace `_` with `-`. **Wing name = slug** (one MemPalace wing per client).

## File location

```
Clients/<Bucket>/<ClientName>/RECALL.md
```

Same directory as `AGENTS.md`, not inside `notes/`.

## Template

Copy `references/RECALL.md.template` and replace:

- `{{ClientName}}` — display name
- `{{Bucket}}` — Active | Discovery | Prospect | etc.
- `{{client_slug}}` — per table above
- `{{primary_contact_name}}` — from onboarding / DB

Tailor **By intent** queries to business type (legal dept vs PE vs asset manager).

## AGENTS.md block

Append to client `AGENTS.md` (see template in `references/AGENTS.md.template`):

```markdown
## Recall (MemPalace)
- Playbook: `./RECALL.md`
- Wing: `<slug>`
- Before substantive client answers: load skill `mempalace` and run RECALL.md queries.
```

## First mine

```bash
mempalace mine "<VaultRoot>/Clients/<Bucket>/<ClientName>" \
  --wing "<slug>" --mode projects
```

## Optional: company-wide mine (not per client)

Run from vault root policy once, or use bulk script for all client roots:

```bash
~/.hermes/scripts/mempalace-mine-all-clients.sh
```

## Do not

- Put CRM stage or phone numbers only in RECALL — keep those in DB + AGENTS.md
- Use MemPalace as sole source for legal/client commitments without vault note backup