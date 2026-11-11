# Schedule Next Steps Call (Type A)

**Description**: This is the default short formal follow-up email. It thanks the client for the meeting and requests availability for a follow-up call to discuss next steps. This type is already implemented in the main workflow.

**When to Choose**: For most initial or routine client meetings where the primary goal is to schedule the next conversation.

**Tone Requirements**: Formal, brief, actionable. Maximum 2-3 bullet points. Keep the entire email under 150 words.

**Template** (use exactly this structure):

```
Subject: Follow-up: [Topic e.g. AI education session for marketing team]

Hi [FirstName],

Thanks for the meeting today. Following up on the [key topic e.g. AI session for the marketing team with Zevi] — covering [2-3 bullets max].

Can you share a couple times that work for you and [other contact] next week?

Best,  
<SenderEmail>
```

**How to Draft**:
- Replace [Topic] with a short 3-6 word description of the meeting focus.
- Replace [FirstName] and [other contact] using the approved contacts from client-crm-organization.
- Fill [key topic] and the 2-3 bullets directly from the Granola notes (keep very concise).
- Do not add extra paragraphs or pleasantries.
- Use the gws command below (fill variables first):

```bash
email_content="To: [email]
From: <SenderEmail>
Subject: Follow-up: [short topic]

Hi [FirstName],

Thanks for the meeting today. Following up on the [key topic] — covering [brief points].

Can you share a couple times that work for you and [name] next week?

Best,  
<SenderEmail>"
raw=$(echo -n "$email_content" | base64 -w 0)
gws gmail users drafts create --params '{"userId":"me"}' --json "{\"message\":{\"raw\":\"$raw\"}}" --format json
```

**Verification**:
- Draft appears in Gmail (DRAFT label).
- Optionally add draft ID to client's AGENTS.md under "Next steps".
- Run `cd <VaultRoot> && ob sync` after any related note updates.