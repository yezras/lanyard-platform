# lp-86d handoff — live mocklab stack state

**Recorded:** 2026-08-13T13:01:39Z  
**Bead:** `lp-86d.14`  
**Purpose:** Leave stack state documented so the next operator/agent can continue without rediscovering process ownership.

## Stack left **UP** (do not assume torn down)

| Service | Endpoint | Process note (at record time) |
|---------|----------|-------------------------------|
| Portal web | `http://demo.localhost:3010` (HTTP 200) | pid `92817` listening `0.0.0.0:3010` |
| Portal BFF | `:4000` | pid `92860` |
| Control plane | `:3100` | pid `3998904` |
| Gateway relay | `:8787` | pid `1648362` |
| **Lanyard Agent gateway** | `http://127.0.0.1:9100` | pid **`660648`** (`node apps/gateway/dist/main.js`); also in `~/.lanyard-agent/gateway.pid` |

### LA health (sample)

- `GET /health` → `{"ok":true,"status":"ok","service":"lanyard-agent-gateway"}`
- `GET /ready` → `ok`, `channels: [{ channel: "portal", ok: true, detail: "connected platform=lanyard_web" }]`, `cron.enabled: true`

### Portal tmux

- Session name: **`lanyard-portal`** (2 windows; created 2026-08-11)
- Other unrelated tmux sessions may exist (`hermes-desktop`, `buildingpages`, …) — **not** the mocklab portal owner for this epic

### Login (local demo)

- URL: `http://demo.localhost:3010`
- User: `dev@demo.local` / local demo password (see gitignored demo env — never commit)

## What was **not** torn down

- Portal `dev:tmux` stack (`lanyard-portal`)
- LA gateway process / `~/.lanyard-agent/gateway.pid`
- Postgres / other long-lived services if already running for portal

## What **was** cleaned

| Action | Result |
|--------|--------|
| Playwright browsers | No active Playwright Chromium drivers at close-out |
| `secure-local-secrets` | Live monorepo: fix + check on `portal/.data` + `artifacts/ui/.auth` |

## Hermes / mock note

- A Hermes dashboard process may still run on this host (unrelated desktop session).
- For **this** epic, chat ownership is **LA portal channel connected** — do not re-point Portal at Hermes/mock without an explicit env bead.

## Restart / attach (if needed later)

```bash
# Portal (if session missing)
export PORTAL_TMUX_NO_ATTACH=1
pnpm -C portal dev:tmux
# attach: tmux attach -t lanyard-portal

# LA gateway (from pilot home; do not commit secrets)
# typical: start from ~/.lanyard-agent with existing env/config
# pid file: ~/.lanyard-agent/gateway.pid
curl -sS http://127.0.0.1:9100/health
curl -sS http://127.0.0.1:9100/ready

# Secret hygiene after any UI QA
bash portal/scripts/secure-local-secrets.sh
bash portal/scripts/secure-local-secrets.sh --check
```

## Residual work for next owner

1. **`lp-vw3`** — LA MCP product surface (only open product gap from this epic).  
2. Optional: merge open QA evidence PRs `#396` `#398` `#400` `#401` `#402` `#403`.  
3. Optional: close `lp-86d.3` / `lp-86d.6` after merge (verdicts already PASS).  
4. Epic shell `lp-86d` can close when operators accept the [CLOSEOUT.md](./CLOSEOUT.md) matrix.

## Canonical evidence

See [CLOSEOUT.md](./CLOSEOUT.md) and [REPORT.json](./REPORT.json) under `artifacts/ui/lp-86d/`.
