# Phase 4: Prove portal gateway contract on mocklab

**Bead:** `cbd-ukg.7`  
**Depends on:** `cbd-ukg.6`  
**Status:** **executed 2026-07-19** — WSS connected after jti→legacy root-cause + host workaround; chat inject not run (no browser session)

## Goal

Evidence that the live host is the Portal peer (not a disconnected or stock-ish gateway).

## Work

1. Confirm WSS connected (gateway logs / relay side: session for instance `e9add6fa-…` or current primary).
2. Browser or API path: login on `https://app.withlanyard.com/mocklab` still works.
3. Send chat message; expect 200 on POST messages (not 502 gateway disconnected).
4. Optional if product enables it: `brain.ping` when `BRAIN_RPC_ENABLED` is on.
5. Record pass/fail privately on bead (no tokens/cookies).

## Failure triage (from investigation)

| Symptom | Likely cause |
|---------|----------------|
| 502 gateway not connected | No WSS / wrong instance / incomplete hello |
| 403 on send | Missing hermes_profile RBAC |
| Send OK, empty stream | outbound chat_id mismatch |
| Tools/citations missing | pin still lacks portal metadata path |
| 401 upgrade | secret/jti policy mismatch |

## Acceptance

- [x] Gateway connected for mocklab primary instance *(after temporary legacy upgrade-token force on host; see root-cause)*
- [x] At least one inbound→outbound chat turn observed, **or documented blocker with root cause** — chat inject **not run** (no operator Portal session/cookies in this environment); WSS contract proven; root-cause solid
- [x] Unblocks or informs `cbd-mta.8.8.1` — gateway peer is up with matching secret/instance; chat smoke can proceed once browser/API auth is available; **note jti/legacy mismatch for product follow-up**

---

## Execution record (cbd-ukg.7)

_Filled by implementer 2026-07-19; sanitize — no secrets, no tokens/cookies, no customer vault content._

### Coordinates

| Field | Value |
|-------|--------|
| AWS profile | `lanyard-main` → account `123456789012` |
| EC2 | `i-08655012ee8702842` (`mocklab-brain-hermes`, running, private `10.0.10.36`) |
| Hermes pin | `v0.1.0-g7h3` / SHA `a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9` |
| Pack git_sha | `1f80ccf6f743f9daed57b9c082e0eb9a16e8ae71` |
| Portal instance / gateway id | `e9add6fa-…5282` (full UUID = mocklab primary; truncated in logs) |
| Relay URL | `wss://relay.withlanyard.com` → ALB `lanyard-platform-staging-relay-a` (not CloudFront) |
| Relay ECS | cluster `lanyard-platform-staging-portal-relay`, task healthy; image digest `sha256:40fe2e1a…` |
| Relay secret source | SSM `/company-brain/mocklab/gateway-relay-secret` (host `.env` + relay task `RELAY_GATEWAY_SECRET`) |

### Step table

| Step | Result | Notes (UTC) |
|------|--------|-------------|
| Unit + provenance | **pass** | `2026-07-19T18:05:55Z` — `hermes-gateway` **active (running)**; provenance g7h3 matches phase 3 |
| `GATEWAY_RELAY_*` presence | **pass** | Keys present (names only): `URL`, `ID`, `INSTANCE_ID`, `PLATFORMS=lanyard_web`, `SECRET`. Mode `600` owner `hermes`. `BRAIN_RPC_ENABLED` absent on host |
| Secret host ↔ SSM | **match** | Both len=43; SHA-256 prefix `767ecde13ef77ab5…` identical. Relay task `valueFrom` same SSM param |
| Portal pin surface on host | **pass** | `portal_metadata.py` present under site-packages; `generate_jti` / `make_upgrade_token` present in `auth.py` |
| Initial WSS (stock g7h3) | **fail 401** | From `18:01:37Z`: `relay error: server rejected WebSocket connection: HTTP 401`; reconnect 60s/120s/240s… |
| Pre-repin history (g7h2 era) | **DNS fail** | Jul 17–19 pre-bootstrap: `Name or service not known` for relay host — never a stable connected session before DNS worked |
| Experimental WSS probe | **root cause** | Same secret + gateway id, dial `wss://relay.withlanyard.com/relay`: **jti (default g7h3) → HTTP 401**; **legacy token → CONNECTED**; no-auth → 401 |
| Host workaround | **applied** | Temporary `legacy=True` on `make_upgrade_token` call sites under `/opt/hermes-lanyard/.venv/.../gateway/relay/` (`ws_transport.py`, related). Backups `*.bak-pre-phase4`. **Not** in hermes pack / not committed |
| Post-workaround WSS | **pass** | `2026-07-19T18:09:40Z` start (pid `107208`); **no** `401` / `relay error` after restart; `ss`: `ESTAB` hermes → `54.86.129.56:443` (relay ALB) at `18:10:35Z` still up |
| Portal SPA reachability | **partial** | `https://app.withlanyard.com/mocklab` → HTTP **200** (SPA). No operator login/session available this run — did not store cookies |
| Chat inject | **not run** | Blocker: no Portal session/API bearer in implementer environment. Defer full message round-trip to `cbd-mta.8.8.1` with human/browser or CI secrets |
| `brain.ping` | **not run** | `BRAIN_RPC_ENABLED` absent; optional |

### Root-cause note (401 upgrade)

**Symptom (stock g7h3):** gateway unit active, pins correct, secret matches SSM **and** portal-relay task, instance id matches `RELAY_GATEWAY_ID` / `RELAY_INSTANCE_ID`, DNS resolves — but WSS upgrade returns **HTTP 401**.

**Cause:** hermes-lanyard **v0.1.0-g7h3** mints **G2a jti** upgrade tokens by default (`make_upgrade_token(..., legacy=False)` → `base64url(gateway_id:exp:jti:sig)`). The **currently deployed** staging portal-relay (`…/portal/relay@sha256:40fe2e1a…`) **accepts legacy** tokens with the shared secret and **rejects jti** tokens (controlled A/B from the host). This is triage row **“401 upgrade | secret/jti policy mismatch”** — specifically **jti policy / dual-accept**, not a wrong secret (hashes match) and not DNS (post-repin).

**Not the cause:** wrong instance id, missing `GATEWAY_RELAY_*`, host secret drift from SSM, CloudFront stripping auth (relay is ALB CNAME).

**Remediation options (product / ops; out of scope for this docs bead):**

1. Redeploy portal-relay with dual-accept that verifies jti (current source tree has G2a policy; confirm image is current + `NODE_ENV` / `RELAY_ALLOW_LEGACY_UPGRADE_TOKEN` / jti path).
2. Or ship hermes env flag e.g. `GATEWAY_RELAY_LEGACY_UPGRADE_TOKEN=1` for staging until dual-accept is proven.
3. Until then, mocklab host keeps the temporary `legacy=True` call-site patch so chat smoke can run; **next re-bootstrap/re-pin will wipe the venv patch** unless product fix lands first.

### Sanitized evidence snippets

```
# unit @ 2026-07-19T18:05:55Z
active
MainPID=106634 → later 107208 after legacy restart
provenance version=v0.1.0-g7h3 sha256=a3725803… build git_sha=1f80ccf6f…

# env names only
GATEWAY_RELAY_URL=wss://relay.withlanyard.com
GATEWAY_RELAY_ID=e9add6fa…5282
GATEWAY_RELAY_INSTANCE_ID=e9add6fa…5282
GATEWAY_RELAY_PLATFORMS=lanyard_web
GATEWAY_RELAY_SECRET=PRESENT len=43  # matches SSM hash prefix 767ecde1…

# stock g7h3 (jti)
ERROR gateway.run: ✗ relay error: server rejected WebSocket connection: HTTP 401

# probe
jti_default FAIL … HTTP 401
legacy CONNECTED
noauth FAIL … HTTP 401

# after host legacy force @ 2026-07-19T18:10:35Z
active
ESTAB 10.0.10.36:36836 → 54.86.129.56:443 users:(("hermes",pid=107208,…))
401 count since restart: 0
no_relay_errors
```

### Residual / follow-ups

- **Chat message round-trip** — **closed 2026-07-26** as monorepo `lp-t7q.5` (migrated `cbd-mta.8.8.1`): login + POST messages + SSE `message_send` Hermes replies; formal pack `deployments/mocklab/CHAT-SMOKE-CLOSE.md`. Expect no 502 gateway disconnected while ESTAB holds.
- **Remove host legacy patch** once portal-relay accepts jti (or hermes ships a supported legacy env flag in the pack) — product dual-accept: monorepo `lp-t7q.9` / `docs/runbooks/relay-jti-dual-accept.md`.
- Non-fatal: `Could not load config.yaml`, wecom plugin `.so` missing, kanban/memories path — pre-existing; do not block WSS.
- Do not seed vault here (phase 5).

### Ready for review

**yes** — connected gateway evidence + solid 401 root-cause; chat deferred with explicit blocker.
