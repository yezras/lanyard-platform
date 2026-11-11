# lp-zuh.11.4 — Playwright zero-waiver: MemPalace search live

**Parent:** `lp-zuh.11`  
**When (UTC):** 2026-08-14T23:24Z–23:26Z  
**Base URL:** `https://app.withlanyard.com/mocklab`  
**Tenant / instance labels:** `319d3808-…` / `452b1348-…`  
**Sandbox:** `c5306e38-fe05-445d-9ec0-ba3b3f7d94fd`  
**Snapshot pin:** `lanyard-la-main-9bcada6780d2-seed-zuh111-20260814`  
**Overall verdict:** **GO**

Clears the MemPalace waiver from `lp-zuh.10.8` kitchen-sink (`binary_missing` on ready).  
No secrets in this package.

---

## Acceptance

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Guest ready: `mempalace.enabled` + `ok` (binary on PATH) | **GO** | `/ready` → `mempalace.ok=true`, `reason=ok`, `binaryPath=/usr/local/bin/mempalace`, `version=MemPalace 3.7.0` |
| 2 | Search empty-or-hits **without** `binary_missing` | **GO** | Empty palace: exit 1 + “no chroma.sqlite3” (not binary missing); after mine: search hits for “MockLab zero-waiver” (`SEARCH2_EXIT=0`, `NO_BINARY_MISSING`) |
| 3 | Config `path` under vault | **GO** | `mempalace.path: /mnt/vault/mempalace`; dir exists |
| 4 | Screenshots / log evidence | **GO** | `logs/`, `screenshots/01-home`…`04-vault` |

---

## Root cause (why ready said `binary_missing` despite bake)

Image pin **already** includes MemPalace **3.7.0** at `/usr/local/bin/mempalace` (`lp-zuh.10.2` + `lp-zuh.11.1` bake).

Lanyard Agent `@lanyard-agent/memory` `defaultWhich` resolves binaries via:

```js
spawn("command", ["-v", name])  // no shell
```

On Linux `command` is a **shell builtin** → Node `spawn` returns **ENOENT** → ready reports:

`reason=binary_missing` / “not on PATH”

even though `command -v mempalace` works in bash and PATH includes `/usr/local/bin`.

### Clearance on live pin (this bead)

1. Install real executable **`command` shim** first on guest PATH  
   (`/opt/company-brain-backend/current/bin/command` — brain-owned; precedes `/usr/local/bin`).
2. Ensure palace dir `/mnt/vault/mempalace` exists.
3. (Re)start gateway with shim on PATH → `/ready` re-probes → **ok**.
4. CLI search + optional mine for hit proof.

### Durable platform fix (this PR — next image bake)

| Surface | Change |
|---------|--------|
| `deploy/daytona/agent-gateway/install-mempalace.sh` | Bake `/usr/local/lib/lanyard/bin/command` + link `/usr/local/bin/command` |
| `deploy/daytona/agent-gateway/entrypoint.sh` | `ensure_mempalace_runtime`: export `MEMPALACE_BIN`, guest-local shim fallback under `$BACKEND_HOME/bin` |
| `smoke-entrypoint.sh` | Asserts shim + entrypoint helpers |

Until the next agent-gateway re-pin, operators can apply the same PATH shim + gateway restart (see re-run). Product fix in LA should eventually use `which` / `bash -lc 'command -v'` instead of bare `spawn("command",…)`.

---

## Ready snapshot (sanitized)

```json
{
  "ok": true,
  "status": "ready",
  "mempalace": {
    "enabled": true,
    "ok": true,
    "detail": "MemPalace available: MemPalace 3.7.0 (/usr/local/bin/mempalace); path=/mnt/vault/mempalace; wing=mocklab",
    "reason": "ok",
    "binaryPath": "/usr/local/bin/mempalace",
    "version": "MemPalace 3.7.0",
    "path": "/mnt/vault/mempalace",
    "wing": "mocklab"
  }
}
```

Log: [logs/03-ready.json](./logs/03-ready.json), [logs/03-guest-mempalace.txt](./logs/03-guest-mempalace.txt).

---

## Search proof

| Step | Result |
|------|--------|
| Pre-mine search | Exit 1 — palace exists, no `chroma.sqlite3` yet (**not** binary missing) |
| Mine | `mempalace mine /mnt/vault/mempalace --wing mocklab` — 1 file filed |
| Post-mine search `"MockLab zero-waiver"` | Exit 0 — hit `mocklab/general` source `lp-zuh114-probe.md` |
| Binary missing strings | **None** (`NO_BINARY_MISSING`) |

---

## Screenshots

- `screenshots/01-home.png`
- `screenshots/02-agents.png`
- `screenshots/03-tools.png`
- `screenshots/04-vault.png`

Portal chat memory turn is optional when guest CLI + ready already clear the waiver; shell screenshots prove authenticated MockLab UI.

---

## Checklist alignment

`NEW-TENANT-CHECKLIST.md` row **1.9 MemPalace CLI** → **GO** on live pin with shim / next bake.

---

## Re-run (ops)

```bash
set -a; source .env.mocklab-agent-dev; set +a
# DAYTONA_API_KEY + DAYTONA_ORG_ID from SM lanyard/staging/portal/daytona (never commit)
eval "$(aws secretsmanager get-secret-value --profile lanyard-main --region us-east-1 \
  --secret-id lanyard/staging/portal/daytona --query SecretString --output text | python3 -c '
import json,sys,shlex
d=json.loads(sys.stdin.read())
for k in ("DAYTONA_API_KEY","DAYTONA_ORG_ID"):
  print(f"export {k}={shlex.quote(str(d[k]))}")
')"

source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
# Prefer guest PATH shim + gateway start (avoid sandbox stop which drops mount):
python artifacts/mocklab/live-qa/zero-waiver-go/mempalace/run_zero_waiver_mempalace_probe.py
```

---

## Secret hygiene

No passwords, JWT, SM payloads, Relay secrets, AWS keys, or `.env.mocklab-agent-dev` contents.
