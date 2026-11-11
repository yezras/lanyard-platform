# Follow-up Email Types

This folder contains templates, drafting instructions, and guidelines for different types of post-meeting follow-up emails used in the post-meeting-triage workflow.

## When to Use Each Type

After the Granola/CRM retrieval and filing step completes and the review list is approved, the user will be prompted to choose the follow-up email type:

- **A. Schedule next steps call** — Use the standard short thank-you + request for meeting times. Ideal for initial or routine check-ins.
- **B. Lay out detailed next steps for a project** — Use when the meeting focused on a specific project or body of work. This email includes a recap of topics discussed, setups needed to begin, and a list of items the user will deliver to the client. It uses a simple topical list (no structured owner/due dates per action item).

## Files in This Folder

- `schedule-next-steps-call.md` — Full template and instructions for type A.
- `detailed-project-next-steps.md` — Full template and instructions for type B (updated format).

## Workflow Integration

1. Complete Step 1 (native mcp_granola retrieval + client-crm-organization filing with review list approval).
2. Ask the user: "What type of follow-up email would you like to draft? (A) Schedule next steps call or (B) Detailed project next steps?"
3. Load the corresponding file from this folder and follow its drafting instructions.
4. Use the gws gmail users drafts create command (adapted from the template) to create the draft.
5. Always maintain formal, brief, actionable, shorter-and-to-the-point tone. Run ob sync after any related markdown changes.

## Notes

- All templates assume the short formal tone preference.
- Placeholders like [FirstName], [Project Name] should be filled from the approved Granola notes and client-crm-organization data.
- After creating the draft, verify it appears in Gmail and optionally log the draft ID in the client's AGENTS.md.
- Type B no longer uses a rigid action-item table with owners and deadlines; it focuses on topical reminders and clear deliverables/setup lists instead.
