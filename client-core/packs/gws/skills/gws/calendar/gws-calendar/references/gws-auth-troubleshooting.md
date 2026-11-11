# gws Auth Troubleshooting (invalid_rapt / reauth)

## Persistent Symptom
`token_error: reauth related error (invalid_rapt)` even after running `gws auth` the previous day. `token_valid: false` while `has_refresh_token: true`.

## Root Cause
Google server-side invalidation of the RAPT (re-authentication token). Common after:
- Running on a new host / network
- OAuth consent screen still in "testing" mode
- Scope or client_secret changes

## Fix (durable)
The user must run this themselves:
```bash
rm -f ~/.config/gws/token_cache.json ~/.config/gws/credentials.enc
gws auth
```

**Agent rule (user preference):** NEVER execute the token reset or `gws auth` commands on the user's behalf. Always instruct the user to perform the re-auth step themselves. The reset forces an immediate interactive login that breaks the current agent session.

Token files live at `~/.config/gws/`.

## Related Project
client_id / project_id usually appears as `lanyard-spark-agent` in the local config.

## Prevention
After any `gws auth` run, immediately test with a read-only command (e.g. `gws calendar +agenda --today`) before ending the session.