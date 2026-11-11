# SSH Tunnel & OAuth Redirect Port Issues

## Symptom
```
channel 3: open failed: connect failed: Connection refused
channel 2: open failed: connect failed: Connection refused
```

## Cause
The `googleworkspace_gmail` MCP uses `redirect_port: 38080`. When the OAuth flow is triggered from an SSH session, the browser on the user's local machine attempts to reach `http://127.0.0.1:38080/callback` on the remote host. Without a working port forward, the connection is refused.

## When this appears
- First-time OAuth consent
- Token refresh that requires re-auth
- Any time the MCP server initiates a new authorization flow

## Recommended workaround
Perform the initial `hermes` OAuth consent flow from a terminal running directly on the target machine (not over SSH). Subsequent tool calls should then work over SSH.

## Config value that triggers it
In `~/.hermes/config.yaml`:
```yaml
googleworkspace_gmail:
  ...
  oauth:
    redirect_port: 38080
```
