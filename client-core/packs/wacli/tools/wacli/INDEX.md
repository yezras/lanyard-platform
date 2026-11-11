# wacli WhatsApp Connectivity

`wacli` is the local WhatsApp CLI used for syncing, searching, and sending messages from scripts.

## Install

Run:

```bash
Core/tools/wacli/install-wacli.sh
```

The installer uses:

```bash
go install -tags sqlite_fts5 github.com/openclaw/wacli/cmd/wacli@latest
```

## Runtime Contract

- Default local store: `$WACLI_STORE_DIR`, XDG state dir on Linux, or `~/.wacli`.
- Current local environment has `wacli` on PATH at `~/.local/bin/wacli`.
- Use `wacli --json` for machine-readable output.
- Use `wacli --read-only` or `WACLI_READONLY=1` for agent-safe inspection.
- Authentication requires a local QR flow via `wacli auth`; do not commit the resulting session files.

## Safety

- Local WhatsApp stores, auth state, media downloads, contacts, and message exports are private runtime data.
- Do not copy message bodies, contact phone numbers, or account identifiers into Core.
- Summaries added to reusable docs must be sanitized.
