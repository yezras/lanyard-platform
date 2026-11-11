# GWS Token Cache Rule

**Never** delete or clear `~/.config/gws/token_cache.json` or `~/.config/gws/credentials.enc` without explicit user instruction.

Doing so forces a full re-authentication flow and breaks existing sessions. Always ask the user before attempting any token cache cleanup.