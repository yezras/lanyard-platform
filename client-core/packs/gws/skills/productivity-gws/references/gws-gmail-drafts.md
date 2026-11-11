# gws Gmail Drafts — Workflow Pattern (2026-07-02 session)

**Trigger**: User explicitly directed to create client email drafts via gws CLI (not local .md files) and remove any local artifact afterward.

**Preferred command sequence** (for new outbound or reply drafts):

1. Build RFC 2822 message (To:, Subject:, body) in a temp file.
2. Base64url-encode (no padding):
   ```bash
   python3 -c '
   import json, base64
   with open("/tmp/email.txt", "rb") as f:
       raw = base64.urlsafe_b64encode(f.read()).decode().rstrip("=")
   draft = {"message": {"raw": raw}}
   json.dump(draft, open("/tmp/draft.json", "w"))
   '
   ```
3. Create the draft:
   ```bash
   gws gmail users drafts create \
     --params '{"userId":"me"}' \
     --json "$(cat /tmp/draft.json)" \
     --format json
   ```
   Returns draft ID and message ID on success.

4. If the draft file lived under `Clients/.../notes/`, immediately `rm` it and run:
   ```bash
   cd <VaultRoot> && ob sync
   ```

**Why this over local files**:
- Keeps the authoritative copy in Gmail Drafts (user can review/edit/send natively).
- Avoids polluting the vault with transient email text.
- Matches explicit user preference for gws-native email actions in CRM flows.

**Related skills / commands**:
- `gws gmail users drafts list|get|send|delete|update` for post-creation management.
- Use the same pattern for any client-facing email (proposals, follow-ups, discovery replies).

**Pitfall to avoid**: Do not default to `write_file` + `ob sync` for email content when gws draft creation is available and user has directed its use.

This pattern was validated in the ExampleAI client email workflow.