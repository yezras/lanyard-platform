# Token Inspection Commands (used in May 2026 session)

## Primary token file
```bash
cat ~/.hermes/mcp-tokens/googleworkspace_gmail.json
```

Contains the live `access_token`, granted `scope` list, and `expires_at`.

## Client registration
```bash
cat ~/.hermes/mcp-tokens/googleworkspace_gmail.client.json
```

Shows the originally requested scopes and redirect URI.

## Meta / discovery
```bash
cat ~/.hermes/mcp-tokens/googleworkspace_gmail.meta.json
```

## Other related tokens in the same directory
- `googleworkspace_calendar.*.json`
- `gmail.*.json` (the disabled entry)
- `calendar.*.json`

## Quick diff of requested vs granted scopes
The client file usually shows only `gmail.readonly` + `gmail.compose`, while the token file often shows the much broader set including `gmail.labels`, `gmail.modify`, and `https://mail.google.com/`.
