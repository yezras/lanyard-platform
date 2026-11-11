# Detailed Project Next Steps (Type B)

**Description**: Use this email type when the meeting was about launching or advancing a specific project or engagement. The email provides a detailed recap of what was discussed and important next steps, written in paragraph form (not bulleted lists), while clearly requesting a very specific time for a follow-up workshop or meeting (in-person or Zoom).

**Key Change from previous version**: This version uses a narrative paragraph style for both the recap and the next-steps request. It avoids "Here’s what I need from you" lists and instead suggests a concrete time for an in-person or Zoom workshop, then states what the sender will deliver.

**When to Choose**: When the meeting produced clear project scope, mutual deliverables, and forward momentum that benefits from a more substantial follow-up with a specific scheduling request.

**Tone Requirements**: Formal, brief, actionable, and to the point. Use short paragraphs. The email can be moderately longer than previous versions when the meeting warrants more detail.

**Template** (use this structure with project-specific details pulled from the approved Granola notes):

```
Subject: Next Steps: [Project Name]

Hi [FirstName],

It was great to meet [you / the team / others today / yesterday / last week]. I wanted to capture what we discussed and lay out the immediate next steps on both sides.

We spoke about [detailed 4–7 sentence recap of the key discussion points, goals, architecture, workflows, and decisions from the meeting, written in paragraph form].

Does [specific day/time, e.g. Wednesday or Thursday afternoon next week] work to come into the office / for a Zoom call for [workshop / follow-up meeting]?

Through the [workshop / follow-up] we can generate concrete ideas for [key goal from meeting, e.g. implementing an AI knowledge base that notifies the team on all matters across deals and gives everyone a way to interact with AI directly in Outlook, Slack, or a private chat interface, with the flexibility to extend to additional use cases over time].

I will send over [workshop materials / demo / scoping document] once we lock in timing, followed by [additional deliverable the user will create and send later].

<LanyardOperator>
```

**How to Draft**:
- [Project Name]: Short, clear name for the engagement.
- **Greeting**: Always start with “Hi [FirstName],” using only the first name of the primary recipient.
- **Opening line**: Use “It was great to meet [you / the team / others today / yesterday / last week]”.
- **What we spoke about**: Write a concise but detailed paragraph (4–7 sentences) summarizing the main discussion points, goals, and decisions.
- **Time request**: Directly ask “Does [specific day/time] work to come into the office / for a Zoom call for [workshop / follow-up meeting]?” — be very specific about the proposed time.
- **Next steps in paragraph form**: After the time request, continue in paragraph form describing how the workshop or follow-up will achieve the key goals (e.g. generating ideas for the knowledge base, notifications, multi-channel AI interaction, future extensibility).
- **What I’m sending you**: State what you will send once timing is confirmed.
- Do not use “Here’s what I need from you to move forward” or bulleted action lists.
- Signature must be exactly “<LanyardOperator>” (capital J) on its own line. No “Best,” or other closing.
- Use the gws draft creation command pattern, base64-encoding the full email_content.
- Fill placeholders from the approved review list and client-crm-organization data.

**Verification**:
- Draft appears in Gmail (DRAFT label).
- Confirm the recap accurately reflects the Granola notes.
- Confirm greeting uses first name only and signature is exactly “<LanyardOperator>”.
- Optionally record the draft ID in the client’s AGENTS.md under “Next steps”.
- Run `cd <VaultRoot> && ob sync` after any related markdown updates.

**Example (AcmeCo Legal Team style)**:
- Project Name: AcmeCo Legal Team AI Workshop
- Opening: “It was great to meet you and the team yesterday.”
- What we spoke about: Paragraph on Claude Pro usage, workflow challenges, knowledge base interest, and Outlook integration.
- Time request: “Does Wednesday or Thursday afternoon work to come into the office for an AI workshop with the rest of the legal team?”
- Next steps paragraph: “Through the workshop we can generate concrete ideas for implementing an AI knowledge base that notifies the team on all matters across deals and gives everyone a way to interact with AI directly in Outlook, Slack, or a private chat interface, with the flexibility to extend to additional use cases over time.”
- What I’m sending: “I will send over workshop materials and a proposed agenda once we lock in timing, followed by a demo of the knowledge base concept.”
- Signature: <LanyardOperator>
