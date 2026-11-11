---
name: daily-client-task-update
description: "Daily client task update: Calendar + Gmail + WhatsApp → outstanding items summary sent to Slack CRM channel."
version: 1.0.2
author: Hermes Agent
license: MIT
tags: [crm, daily, client-pipeline, gws, whatsapp, slack]
related_skills: [gws-calendar, gws-gmail, wacli, gws-chat-send, client-crm-organization]
category: crm
---

# daily-client-task-update

Daily client task update for the Lanyard CRM portfolio. Produces a summary of outstanding items and sends to Slack.

## When to Use
- Runs daily at 8 AM on weekdays (Mon-Fri)
- Scans calendar, Gmail, and WhatsApp for action items
- Identifies emails sent without responses and pending client requests
- Delivers summary to `<SlackTarget>`

## Prerequisites
- gws CLI authenticated (Gmail + Calendar)
- wacli / WhatsApp linked device available
- Access to `<VaultRoot>/Clients`
- Send message tool configured for Slack

## Workflow (Cron/Automated Mode)

1. **Check today's calendar events**
   ```bash
   gws calendar +agenda --today --format json
   ```

2. **Scan Gmail for outstanding items**
   ```bash
   # Unread emails
   gws gmail +triage --format json
   
   # Emails sent that haven't been replied to
   gws gmail users messages list --params '{"userId": "me", "q": "from:me newer_than:3d"}' --format json

   # Check for replies to our sent emails
   gws gmail users messages list --params '{"userId": "me", "q": "subject:re newer_than:3d"}' --format json
   ```

3. **Check WhatsApp client activity**
   ```bash
   # Note: wacli last_sync_at often stale - treat as lower confidence
   wacli --account me messages list --read-only --json --limit 50
   ```

4. **Compile structured report** with:
   - Today's meetings and follow-up needs
   - Pending email responses (emails I've sent that haven't been replied to)
   - Unread emails needing attention
   - Calendar invites awaiting my response
   - Outstanding client action items (prioritized)

5. **Deliver to Slack**
   Use `send_message(target='<SlackTarget>', message=...)` with the formatted report

## Output Format

```markdown
# Daily Client Task Update — {DATE}

## Today's Meetings (Follow-up Required)
| Time | Event | Attendees | Action Items |
|------|-------|-----------|--------------|
| {details} |

## Pending Email Responses (Sent, Awaiting Reply)
| Sent Date | To | Subject | Needs Follow-up? |
|-----------|-----|---------|------------------|
| {details} |

## Unread Emails Needing Attention
| From | Subject | Received |
|------|---------|----------|
| {details} |

## Calendar Invites Awaiting Response
| Event | Date/Time | Organizer |
|-------|-----------|-----------|
| {details} |

## Outstanding Client Action Items (Prioritized)
1. **[HIGH]** {Client} - {Action} - {Due}
2. **[MED]** {Client} - {Action} - {Due}
3. **[LOW]** {Client} - {Action} - {Due}

---
*Note: WhatsApp sync may be stale; check wacli doctor for last_sync_at*
```

## Cron Configuration Requirements
- **Schedule**: `0 8 * * 1-5` (8 AM Mon-Fri)
- **Skills**: `daily-client-task-update` (see client-crm-organization `references/crm-cron-and-model-defaults.md` for full registry)
- **Toolsets**: `terminal`, `search`, `skills` for processing
- **Model**: `grok-composer-2.5-fast` via **`xai-oauth`** (pin on cron create/update)
