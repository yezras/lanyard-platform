# Client Note Format (Lanyard)

## Standard Note Filename
`YYYY-MM-DD-descriptive-kebab-case-title.md`

## Required Frontmatter
```yaml
---
date: YYYY-MM-DD
from: 
subject: 
client: 
email_id:          # when applicable
---
```

## Location
Always place notes inside the correct client’s `notes/` folder:
`<VaultRoot>/Clients/<ClientName>/notes/`

## Delegation Rule
When the task involves meeting notes or Granola:
- Use native `mcp_granola_*` tools (list_meetings, query_granola_meetings, get_meeting_transcript, get_meetings, get_account_info) directly — these are built into Hermes natively.
- No delegation to Grok or Codex required.

## Sync Rule
After creating/modifying Markdown assets:
1. Check `git -C "Clients/AcmeCo/Projects/Building Pages/build" branch --show-current`
2. Only run `ob sync --path /Lanyard` if the branch is `main`
```