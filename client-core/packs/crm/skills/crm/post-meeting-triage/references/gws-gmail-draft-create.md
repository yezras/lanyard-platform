# gws: Create Gmail draft (follow-up emails)

Use this when **post-meeting-triage** Step 2 needs a draft via `gws` (no `gws-gmail` skill required).

## Required path parameter

`gws gmail users drafts create` **always** needs:

```bash
--params '{"userId":"me"}'
```

Without it: `Required path parameter userId is missing`.

Wrong subcommand: `gws gmail drafts create` → unrecognized. Always use **`gws gmail users drafts create`**.

## Message body format

Gmail API expects a **URL-safe base64** RFC 2822 message in `message.raw`. Build with Python `email.mime.text.MIMEText` (not a hand-typed string).

See **`templates/gws-draft-create.py`** — copy to `/tmp`, set `TO` / `SUBJECT` / `BODY`, run `python3`.

## Cron runner (scheduled post-meeting-triage)

- **`execute_code` is blocked** on cron — use `write_file` + `terminal` `python3` instead.
- Do not use multiline `python3 << 'HEREDOC'` in shell for Type B bodies; heredocs often truncate.

## List / inspect drafts and sent mail

```bash
gws gmail users drafts list --params '{"userId":"me","maxResults":15}'
gws gmail users messages list --params '{"userId":"me","q":"subject:(Next Steps) newer_than:3d","maxResults":10}'
gws gmail users messages get --params '{"userId":"me","id":"<messageId>","format":"metadata","metadataHeaders":["Subject","To"]}'
```

`labelIds`: **DRAFT** = open draft; **SENT** = skip creating a duplicate follow-up for the same meeting.

## Verification

- Response includes `"id": "r..."` and `message.labelIds` contains `DRAFT`.
- Record draft `id` in the client `AGENTS.md` Notes section.
- On `invalid_rapt` / reauth: `rm -f ~/.config/gws/token_cache.json ~/.config/gws/credentials.enc && gws auth` (see gws-shared / Lanyard memory).

## Recipient selection

- Prefer the contact with a known **email** for `To:` (e.g. Managing Partner when CEO has phone only).
- Mention other attendees in the body; add CC in `MIMEText` headers only when their emails are on file.

## ExamplePlatform-style reference (2026-06-25)

Successful draft: `--params '{"userId":"me"}'`, Type B paragraph template, `<Email>`, subject `Next Steps: ExamplePlatform Consulting & AI Agent Scoping`.