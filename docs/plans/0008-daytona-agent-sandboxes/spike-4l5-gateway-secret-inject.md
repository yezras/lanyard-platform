# Spike notes: `lp-4l5` — Inject gateway relay secret for in-process WSS

**Bead:** `lp-4l5`  
**Epic:** Phase 0 `lp-6tq` (parent under `lp-kng`)  
**Date:** 2026-08-04  
**Status:** **Complete** — create-time env inject proven for in-process `GATEWAY_RELAY_SECRET`; file-drop alternate proven; mock WSS handshake auth using secret proven; real Relay residual is DNS only (same staging hold as `lp-4dk`). Cleanup empty for this bead.

Related: WSS hold [`spike-4dk-wss-relay.md`](./spike-4dk-wss-relay.md) (`lp-4dk`), org/API [`spike-v2p-org-access.md`](./spike-v2p-org-access.md) (`lp-v2p`), env contract [`gateway-env-contract.md`](./gateway-env-contract.md), overview [overview.md](./overview.md).

---

## 1. Goal

Prove how **`GATEWAY_RELAY_SECRET`** (or a short-lived token) is available **inside** the Daytona sandbox **process** for WSS handshake use — not only as an opaque HTTPS placeholder. Document chosen path, rejected/unsafe paths, security notes, and residual Relay DNS.

---

## 2. Environment / constraints

| Item | Value |
|------|--------|
| Daytona org | `5b45bf51-5792-4f75-a54a-ffa6c4752d6e` (Tier **1**, region **US**) |
| API | `https://app.daytona.io/api` + toolbox `https://proxy.app.daytona.io/toolbox/{id}/…` |
| SM secret **name** only | `lanyard/staging/portal/daytona` (`AWS_PROFILE=lanyard-main`, `us-east-1`, account `123456789012`) |
| Preferred Relay | `wss://relay.withlanyard.com` |
| Lab secret | **Throwaway** `token_urlsafe(32)` generated for this spike only — **not** production CP register secret |
| Budget | Shared **$10** hard cap — one thrifty sandbox, stop/delete after proof |
| Isolation | **container** (Phase 0 AC1 waiver from `lp-z1u`) |
| Labels | `lanyard_spike=lp-4l5`, `purpose=gateway-secret-inject` |

**Redaction rule:** notes show **mechanism + fingerprint only**. Secret values never committed, never pasted into bead notes / PR bodies. Fingerprint used: `sha256:<first 12 hex of SHA-256(secret)>`.

---

## 3. Chosen injection path (product recommendation)

### 3.1 Primary: create-time sandbox `env` map

```http
POST https://app.daytona.io/api/sandbox
Authorization: Bearer <DAYTONA_API_KEY>
X-Daytona-Organization-ID: <DAYTONA_ORG_ID>
Content-Type: application/json

{
  "target": "us",
  "env": {
    "GATEWAY_RELAY_URL": "wss://relay.withlanyard.com",
    "GATEWAY_RELAY_ID": "<instance_id>",
    "GATEWAY_RELAY_INSTANCE_ID": "<instance_id>",
    "GATEWAY_RELAY_SECRET": "<from CP secret store — never snapshot>",
    "…"
  },
  "domainAllowList": "relay.withlanyard.com",
  "autoStopInterval": 10,
  "autoDeleteInterval": 0,
  "labels": { "lanyard_spike": "lp-4l5", "purpose": "gateway-secret-inject" }
}
```

**Why this is the product path**

| Reason | Detail |
|--------|--------|
| Parity with env contract | Same names as EC2 / [`gateway-env-contract.md`](./gateway-env-contract.md) Bucket C wake inject |
| Available at process start | Guest `os.environ["GATEWAY_RELAY_SECRET"]` without entrypoint file plumbing |
| Matches orchestrator model | CP resolves secret → Daytona create `env` → gateway dials Relay |
| Ephemeral with sandbox | Stop destroys compute + env (`autoDeleteInterval: 0`) |

### 3.2 Alternate (also proven): file drop mode `0600`

Useful if product prefers file-based secret materialization (closer to some EC2 `EnvironmentFile` patterns) or post-create rotation without recreate:

| Mechanism | Result |
|-----------|--------|
| Toolbox `POST /files/upload?path=/tmp/…` | HTTP **200** (body accepted) |
| Process write via toolbox execute | `FILE_DROP_OK` path `/tmp/lp4l5/gateway_relay_secret` **mode `0600`** size matches |
| Guest read | Fingerprint **matches** create-time env secret |

**Product note:** Prefer **env** for gateway process (matches EC2 parity names). File path is fine for entrypoint helpers that then `export` or pass into exec. Do **not** store Relay secrets under durable S3 vault (cross-tenant / backup risk).

---

## 4. Smoke evidence (timestamps UTC)

**sandbox_id:** `89f2a9d2-93a7-4708-9b03-5d3c6253a970`  
**class:** `container` · snapshot default · state `started` within ~1s  
**Lab secret fingerprint:** `sha256:00369a41bba7` · length **43** (throwaway; discarded after stop)

| Step | UTC | Result |
|------|-----|--------|
| Generate throwaway lab secret | 2026-08-04T17:24:54Z | fp `sha256:00369a41bba7` |
| `POST /sandbox` with `env` inject | 17:24:54Z | HTTP **200**, state `creating` → `started` |
| In-process env proof | 17:24:55Z | `INJECT_PROOF secret_present=true secret_len=43 secret_fp=sha256:00369a41bba7` + relay URL/id/instance_id set |
| Toolbox file upload probe | 17:24:55Z | `POST …/files/upload?path=…` **200** |
| File drop write + read | 17:24:56Z | mode `0600`; `FILE_PROOF` same fingerprint |
| Mock WSS server listen | 17:24:56Z | `127.0.0.1:8766` (stdlib; uses env secret) |
| Client `Authorization: Bearer <secret>` | 17:24:58Z | HTTP **101**, `GREETING_AUTH=ok`, `PONG_OK`, `CLIENT_OK` |
| Client `X-Gateway-Relay-Secret` | 17:24:58Z | HTTP **101**, authorized |
| Client missing / wrong token | 17:24:58Z | HTTP **401** Unauthorized |
| Real Relay DNS probe | 17:24:59Z | `REAL_DNS_FAIL gaierror`; CNAME→dead staging ELB; no A/AAAA |
| Stop | 17:24:59Z | HTTP **200** (ephemeral auto-delete) |
| Delete explicit | 17:25:03Z | HTTP **404** (already gone) |
| List filter `lp-4l5` | 17:25:04Z | **leftover=[]** (unrelated parallel sandbox left untouched) |

### 4.1 In-process inject proof (redacted structure)

```text
INJECT_PROOF {
  "secret_present": true,
  "secret_len": 43,
  "secret_fp": "sha256:00369a41bba7",
  "relay_url": "wss://relay.withlanyard.com",
  "relay_id": "lab-lp-4l5-instance",
  "relay_instance_id": "lab-lp-4l5-instance",
  "path": "create_env"
}
```

Fingerprint matched the operator-side hash of the throwaway secret. **Value never printed** in guest logs beyond length/fp.

### 4.2 Mock WSS using secret (optional AC path)

Because real Relay remains DNS-blocked (operator hold), a **loopback mock WSS** inside the same sandbox validated handshake use of the injected secret:

| Auth mode | HTTP | Notes |
|-----------|------|--------|
| `Authorization: Bearer <GATEWAY_RELAY_SECRET>` | **101** | Authorized; greeting `auth=ok` |
| `X-Gateway-Relay-Secret: <secret>` | **101** | Alternate header style (lab only) |
| Missing header | **401** | Rejected |
| Wrong bearer token | **401** | Rejected |

Server/client logs recorded only `secret_present`, `secret_len`, `secret_fp`, and auth ok/fail — **no secret values**. Host-side check confirmed lab secret string did not appear in retrieved logs.

This is **not** a substitute for product Relay protocol; it proves the guest can **read** the injected secret and **use it on a WSS upgrade**.

### 4.3 Real Relay residual (DNS)

Same residual as [`spike-4dk-wss-relay.md`](./spike-4dk-wss-relay.md):

| Query | Result |
|-------|--------|
| `getaddrinfo(relay.withlanyard.com)` | **FAIL** — Name or service not known |
| `dig +short … CNAME` | staging ELB name present |
| A / AAAA | **no usable address** (dead ELB under OPERATOR HOLD) |

Inject path does **not** depend on live Relay. Re-prove end-to-end WSS to product Relay after DNS/ALB restore (`lp-4dk` residual + this inject).

---

## 5. Rejected / unsafe paths

| Path | Status | Why reject or deprioritize |
|------|--------|----------------------------|
| **Bake secret into snapshot / image** | **Rejected** | Cross-tenant leak; rotation forces image rebuild; violates Bucket C wake inject ([gateway-env-contract.md](./gateway-env-contract.md) anti-patterns) |
| **Put secret in sandbox `labels`** | **Rejected** | Labels returned on GET/list; intended for routing/metadata, not secrets. This spike used only non-secret labels (`lanyard_spike`, `purpose`) — keys visible on GET |
| **Put secret in durable S3 vault prefix** | **Rejected** | Vault is tenant files; secrets need separate store + shorter TTL materialization; backups/listing risk |
| **Inject `DAYTONA_API_KEY` into guest** | **Rejected** | Platform-only; guest must stay host-agnostic |
| **Rely on HTTPS “opaque placeholder” without in-process secret** | **Rejected for handshake** | Gateway needs real secret/token material for Relay auth; placeholder alone is insufficient |
| **`PATCH /sandbox/{id}` with env** | **Does not work** | HTTP **404** `Cannot PATCH /api/sandbox/…` on this API surface |
| **Assume `POST /sandbox/{id}/start` mutates env of already-running sandbox** | **Not a rotation path** | Start returned 200 while already started; do **not** treat as secret rotation API. Prefer **recreate** or documented Daytona env-update if added later |
| **Log full secret in orchestrator / toolbox command lines** | **Unsafe** | Create response **echoes env values including `GATEWAY_RELAY_SECRET`** (see §6). Toolbox `execute` commands that embed secret text also risk log retention |

---

## 6. Security notes

### 6.1 What worked without leaking values in guest logs

- Guest proof scripts log only `secret_present`, `secret_len`, `secret_fp=sha256:…`.
- Mock server logs auth mode + ok/fail, never the token.
- Spike notes / PR / beads: SM **name** only; throwaway secret discarded with sandbox.

### 6.2 API surface risk (orchestrator must handle)

| Observation | Implication |
|-------------|-------------|
| Create **response** includes full `env` map **with secret values** | Orchestrator HTTP clients/logs must **redact** `GATEWAY_RELAY_SECRET` (and other secrets) before logging responses |
| GET sandbox may expose env keys/values depending on API version | Treat sandbox GET bodies as **sensitive**; never dump raw to CI |
| Toolbox process commands are operator-visible | Prefer create-time env over shell `export SECRET=…` in command strings |

### 6.3 Rotation approach (sketch)

| Step | Action |
|------|--------|
| 1 | CP rotates instance secret (show-once / secret store) — existing register/rotate path (`lp-9my` issues credentials) |
| 2 | Next **wake** (`ensure_online`): create/start sandbox with **new** `GATEWAY_RELAY_SECRET` in `env` |
| 3 | Old sandbox stop/delete; no need to patch live env |
| 4 | Optional short-lived **token** mint at wake instead of long-lived secret if Relay supports it — still inject under same env **name** for agent parity |
| 5 | Never bake rotated secret into snapshot; never commit to git |

Idle stop clears guest env; re-inject on every wake with current secret material.

### 6.4 Logging policy (normative for pilot)

- Log: env **keys present**, secret **length**, optional **fingerprint**, auth success/fail.
- Do **not** log: raw secret, Authorization header values, create-response env dumps.

---

## 7. Cleanup

| Step | UTC | HTTP | Notes |
|------|-----|------|--------|
| Stop `89f2a9d2-…` | 2026-08-04T17:24:59Z | **200** | `autoDeleteInterval=0` → destroy |
| Delete | 17:25:03Z | **404** | Already gone |
| List filter `lanyard_spike=lp-4l5` | 17:25:04Z | — | **empty** |

No `lp-4l5` sandboxes left. Unrelated parallel lab sandbox (other bead) was **not** touched. API key never committed (SM only). Throwaway lab secret exists only in destroyed sandbox memory.

---

## 8. Acceptance mapping

| Criterion | Met? | Evidence |
|-----------|------|----------|
| 1. Chosen injection path works for WSS handshake use of secret | **Yes** | Create-time `env` → in-process `secret_present` + mock WSS **101** with Bearer (§3–§4) |
| 2. Rejected paths documented | **Yes** | §5 |
| 3. Security notes (no log of secret; rotation sketched) | **Yes** | §6 |
| 4. Throwaway lab secret only; values redacted | **Yes** | fp only `sha256:00369a41bba7`; no real prod secret |
| 5. Real Relay NXDOMAIN: inject + read + attempt; DNS residual | **Yes** | §4.3; mock WSS optional path §4.2 |
| 6. Notes path + cleanup + no secrets in git | **Yes** | this file; cleanup §7 |

**Overall:** Inject path is **go** for Phase 0 / pilot design. End-to-end product Relay WSS still gated on live DNS/ALB + tier egress (`lp-4dk` residual). Credential issuance from CP register is follow-on `lp-9my`.

---

## 9. Residual risks / next

| Risk | Owner / next |
|------|----------------|
| Staging Relay DNS NXDOMAIN | Restore Relay / lab Relay; re-run real WSS with inject |
| Create API echoes secrets in response body | Orchestrator redaction; consider Daytona support for write-only env |
| No durable post-create env PATCH | Rotation = recreate sandbox on wake |
| CP register show-once not exercised (staging hold) | `lp-9my` when CP available |
| $10 cap | One short-lived sandbox; cleaned |

**Unblocks:** confidence that Bucket C wake inject via Daytona `env` makes `GATEWAY_RELAY_SECRET` available for gateway WSS; wire orchestrator create body accordingly.

---

## 10. Repro (operators — no secrets in history)

```bash
export AWS_PROFILE=lanyard-main AWS_DEFAULT_REGION=us-east-1
# Load DAYTONA_* from SM lanyard/staging/portal/daytona (do not echo key)
# Generate throwaway: python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
# Do not paste real production secrets

# POST /sandbox with env GATEWAY_RELAY_SECRET=<throwaway> + parity GATEWAY_RELAY_* names
# Toolbox: python3 -c 'import os,hashlib; s=os.environ["GATEWAY_RELAY_SECRET"]; print(bool(s), len(s), hashlib.sha256(s.encode()).hexdigest()[:12])'
# Optional: loopback mock WSS that checks Authorization: Bearer $GATEWAY_RELAY_SECRET
# Expect real Relay: REAL_DNS_FAIL while staging ELB NXDOMAIN

# POST /sandbox/{id}/stop  → ephemeral delete; confirm no lp-4l5 leftovers
```

Do **not** leave sandboxes running unattended under the $10 cap. Never commit secret values.
