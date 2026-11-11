# Mocklab chat smoke — formal close (lp-t7q.5)

**Bead:** `lp-t7q.5` (migrated `cbd-mta.8.8.1`) · **Parent:** `lp-t7q`  
**URL:** `https://app.withlanyard.com/mocklab`  
**Status:** **PASS** — dated sanitized re-proof 2026-07-26 (post monorepo BFF/relay + host jti era)  
**Prior operator note:** 2026-07-22 login+chat stream OK (bead note); this file is the formal close pack.

## Honesty

| Claim | Allowed? |
|-------|----------|
| Login + chat stream + live Hermes path on mocklab | **Yes** — evidence below (no cookies/tokens/secrets) |
| Host-backed Directory / Vault / Settings panes | **No** — residual; see [§ Residual host panes](#residual-host-panes-not-claimed-done) |
| Omnibox Mode A live isolation table | **No** — `lp-t7q.6` |
| G1–G8 production certification | **No** |
| Multi-tenant edge E2E | **No** — other beads |

Evidence rules: cookie **names** only; no session values, passwords, or raw gateway secrets. UUIDs truncated or replaced with `…uuid…`. Host journal excerpts redact tokens.

---

## Acceptance checklist

| Criterion | Result | Evidence |
|-----------|--------|----------|
| Login OK | **PASS** | [§ Login](#1-login-ok) |
| Chat stream OK | **PASS** | [§ Chat stream](#2-chat-stream-ok) |
| Live Hermes path (host logs sanitized) | **PASS** | [§ Host path](#3-live-hermes-path-host-sanitized) |
| Residual host panes linked, not claimed done | **PASS** | [§ Residuals](#residual-host-panes-not-claimed-done) |

---

## Coordinates (non-secret)

| Field | Value |
|-------|--------|
| Tenant slug | `mocklab` |
| Portal edge | `https://app.withlanyard.com/mocklab` |
| Auth path | Password agent-dev (lab) + CSRF; Google OAuth still available |
| AWS profile (host SSM) | `lanyard-main` → account `123456789012` |
| EC2 | `i-08655012ee8702842` (`mocklab-brain-hermes`, private `10.0.10.36`) |
| Hermes install | `/opt/hermes-lanyard` · unit `hermes-gateway` |
| ExecStart | `/opt/hermes-lanyard/bin/hermes gateway` |
| Build pin (host `.seed/build.env`) | `version=v0.1.0-g7h4` · `product=hermes-lanyard` · `built_at=2026-07-22T02:35:59Z` · `git_sha=8e1b13b46090…` |
| Relay peer (ss) | hermes ESTAB → `54.86.129.56:443` (`relay.withlanyard.com` ALB class) |
| Context API | `GET …/mocklab/api/context` → `tenant_slug=mocklab`, `brain_rpc_enabled=false` (2026-07-26) |

---

## 1. Login OK

**Date (UTC):** 2026-07-26T03:49:55Z  
**Method:** BFF password login (agent-dev lab principal) — not Google this pass; Google start still returns 302 to accounts.google.com (probed same day).

| Step | HTTP | Notes |
|------|------|--------|
| `GET /mocklab/api/auth/csrf` | 200 | JSON `csrf_token`; cookie name `lanyard_csrf` |
| `POST /mocklab/api/auth/login` + `x-csrf-token` | 200 | JSON keys: `user_id`, `email`, `tenant_id` (values not committed) |
| Set-Cookie names | — | `lanyard_session`, `lanyard_csrf` (HttpOnly session; **values not recorded**) |
| `GET /mocklab/api/auth/me` | 200 | Same three keys present |
| SPA | 200 | `GET https://app.withlanyard.com/mocklab` returns Portal HTML |
| Google start | 302 | `GET …/api/auth/google` → Google OAuth (path-first redirect_uri under `/mocklab`) |

**Sanitized login shape:**

```json
{
  "user_id": "PRESENT",
  "email": "PRESENT",
  "tenant_id": "PRESENT"
}
```

Prior formal login proof (CF path + Google button): closed CBD `cbd-mta.8.11.6` (2026-07-17). This pass re-confirms **sessioned** API login after monorepo BFF deploy.

---

## 2. Chat stream OK

**Date (UTC):** 2026-07-26T03:49:55Z (turn A) and 2026-07-26T03:51:55Z (turn B)

| Step | HTTP / result | Notes |
|------|---------------|--------|
| `POST /mocklab/api/chat/threads` | **201** | Title `lp-t7q.5 smoke hello brain` / `lp-t7q.5 stream2` |
| `POST …/messages` | **200** | Body `{"ok":true,"thread_id":"…"}` |
| `GET …/events` (SSE) | stream open | `event: message_send` frames from Hermes |
| `GET …/history` | **200** | `user_message` + outbound `message_send` events |

### Turn A (prompt: “hello brain — lp-t7q.5 formal chat smoke…”)

SSE / history outbound content (sanitized):

1. Home-channel notice from Hermes (`Lanyard_Web` /sethome prompt) — proves live gateway product path, not a stub.
2. **Reply:** `ack — lp-t7q.5 chat live.`

### Turn B (prompt: “Say only: PONG-lp-t7q.5. No tools.”)

Outbound content:

1. Same home-channel notice.
2. **Reply:** `PONG-lp-t7q.5`

**Sanitized SSE shape (UUIDs redacted):**

```text
event: message_send
data: {"type":"message_send","chat_id":"…uuid…","message_id":"…uuid…",
       "content":"ack — lp-t7q.5 chat live.","metadata":{"notify":true,"user_id":"…uuid…"}}
```

**Verdict:** Chat inject is **not** 502 gateway-disconnected; Hermes returns a streamed `message_send` on the portal chat path.

Optional operator note (2026-07-22): login+stream OK before a later redeploy; this 2026-07-26 pass is the post-redeploy re-confirm requested on the bead.

---

## 3. Live Hermes path (host sanitized)

**Collected:** 2026-07-26 via AWS SSM RunShellScript on `i-08655012ee8702842` (no SSH, no secret dump).

| Check | Result |
|-------|--------|
| `systemctl is-active hermes-gateway` | **active** |
| ExecStart | `/opt/hermes-lanyard/bin/hermes gateway` |
| Process | hermes gateway (MainPID rotates on restart; observed ESTAB during smoke) |
| WSS TCP | **ESTAB** hermes → `54.86.129.56:443` |
| `GATEWAY_RELAY_*` key names | `URL`, `ID`, `INSTANCE_ID`, `PLATFORMS`, `SECRET` all **PRESENT** (values not printed) |
| Build | `v0.1.0-g7h4` / hermes-lanyard (`.seed/build.env`; full `provenance.env` absent on this host — build.env used) |
| Journal during smoke window | Prior tool_executor activity (terminal / execute_code consent timeouts) + relay disconnect/restart noise; **chat still completed** after reconnect |
| `brain_rpc_enabled` (edge context) | **false** — host Brain RPC UI not claimed |

**Sanitized host snippet:**

```text
UNIT=active
ExecStart=/opt/hermes-lanyard/bin/hermes gateway
ESTAB 10.0.10.36:… → 54.86.129.56:443 users:(("hermes",…))
version=v0.1.0-g7h4 product=hermes-lanyard built_at=2026-07-22T02:35:59Z
GATEWAY_RELAY_URL=PRESENT … SECRET=PRESENT
```

Gateway contract prove (WSS + jti history):  
`deploy/references/plans/lanyard-hermes-gateway-and-mocklab-vault/phase-4-prove-gateway.md`  
Relay dual-accept product path: `docs/runbooks/relay-jti-dual-accept.md` (`lp-t7q.9`).

---

## Residual host panes (not claimed done)

Chat smoke **does not** close host-backed UI work. Keep these open / separate:

| Residual | Bead | Status note |
|----------|------|-------------|
| Enable `BRAIN_RPC_ENABLED` + host Directory/Vault/Settings E2E | `lp-t7q.4` | Edge context still `brain_rpc_enabled=false` on 2026-07-26 |
| BFF projects/settings via Brain RPC | `lp-t7q.1` | Code landed; staging operator enable separate |
| Vault browser Brain RPC | `lp-t7q.2` | Code landed; staging operator enable separate |
| Honesty banners (fixture / off) | `lp-t7q.3` | Product honesty — not a substitute for host panes |
| Authenticated UI screenshot QA (`storage_state`) | `lp-t7q.10` | Browser pack separate from this API/operator close |
| Omnibox Mode A staging table | `lp-t7q.6` | Explicitly out of scope |
| Readiness matrix G* live flips | `lp-t7q.7` | Do not flip from chat alone |

Plan analysis (host content vs cloud UI honesty):  
company-brain-deploy `references/plans/mocklab-portal-host-backed-qa/` (source) and monorepo Brain RPC work under `lp-t7q`.

---

## Re-run procedure (operator; no secrets in git)

```bash
# From a machine with mocklab agent-dev env (gitignored), never commit the jar.
export MOCKLAB_BASE_URL=https://app.withlanyard.com/mocklab
# source private env with MOCKLAB_AGENT_EMAIL / MOCKLAB_AGENT_PASSWORD

# 1) csrf + login (cookie jar local only)
# 2) POST /api/chat/threads  → 201
# 3) open SSE GET /api/chat/threads/:id/events
# 4) POST /api/chat/threads/:id/messages {"text":"hello brain"} → 200 ok
# 5) observe SSE event:message_send with non-empty content

# Host path (SSM, names only):
# systemctl is-active hermes-gateway
# systemctl cat hermes-gateway | grep ExecStart
# ss -tnp state established | grep hermes
```

Offline guard for this formal close document:

```bash
bash deploy/scripts/smoke-mocklab-chat-smoke-close.sh
```

---

## Explicit non-claims

- Not G1/G2/G3/G8 **ready** matrix flips.
- Not host-backed Directory, Vault, or Settings as product-complete.
- Not Omnibox Mode A.
- Not multi-tenant two-slug edge E2E.
- Not a claim that CloudFront bare `/api/*` is fixed (path-first `/mocklab/api/*` is what this smoke used).

---

## Post-proof environment note (re-UIQA gate)

**Observed:** 2026-07-26T04:13–04:18Z (after the formal PASS above).

Live re-proof attempts after ship UIQA failure saw **edge API 500**, not a regression of
the formal close evidence. Root cause (ops coordinates only; no secrets):

| Layer | Observation |
|-------|-------------|
| BFF task | ECS `lanyard-platform-staging-bff` **RUNNING/HEALTHY** (1/1) |
| BFF logs | `Control plane tenant lookup failed (502\|503) for slug "mocklab"` on `/mocklab/api/*` |
| Control plane | ECS `lanyard-platform-staging-cp` **desired=0 running=0** (steady) — tenant resolve cannot succeed |
| Hermes host | EC2 `i-08655012ee8702842` (`mocklab-brain-hermes`) **stopped** — SSM RunShellScript invalid; gateway path not re-checkable until start |
| Portal static | `GET /mocklab` HTML **200** (S3/CloudFront) — SPA alone does not prove chat |

**Honesty:** The dated PASS in §§1–3 remains the formal close evidence for this bead.
It is **not** a claim that mocklab edge/host are healthy at every later wall-clock time.
Ship / browser UIQA should re-run only after:

1. Control plane service desired ≥ 1 and tenant slug `mocklab` resolves (BFF csrf/login 200).
2. Hermes host running + `hermes-gateway` active + relay ESTAB (same checks as §3).
3. Chat inject returns 200 and SSE `message_send` (same as §2).

Do not reopen this formal close pack solely for transient CP scale-to-zero or host stop;
record a new dated pass only if product path or coordinates change.

---

## Ready for review

**yes** — login + chat stream + host Hermes path closed for mocklab (dated 2026-07-26
sanitized pass); residuals linked only; re-UIQA blocked on CP+host health (see note above).
