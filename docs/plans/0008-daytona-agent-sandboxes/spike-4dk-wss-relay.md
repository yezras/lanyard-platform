# Spike notes: `lp-4dk` — Long-lived WSS from sandbox gateway to test Relay

**Bead:** `lp-4dk`  
**Epic:** Phase 0 `lp-6tq` (parent under `lp-kng`)  
**Date:** 2026-08-04  
**Status:** Complete with **mock fallback** for ≥5 min hold + reconnect; **real Relay path blocked** by staging DNS (operator hold ELB gone) before Tier 1 TCP/TLS could be fully judged. Notes + cleanup below (no secrets).

Related: org/API smoke [`spike-v2p-org-access.md`](./spike-v2p-org-access.md) (`lp-v2p`), Linux VM / container path [`spike-z1u-linux-vm-sandbox.md`](./spike-z1u-linux-vm-sandbox.md) (`lp-z1u`), gateway env [`gateway-env-contract.md`](./gateway-env-contract.md), overview [overview.md](./overview.md).

---

## 1. Goal

Run a minimal process **inside** a Daytona sandbox that opens and holds **WSS** toward the preferred test Relay (`wss://relay.withlanyard.com`), with instance-like credentials if staging CP register is available; otherwise document the auth gap and prove TCP/TLS/WSS as far as possible. Document reconnect, `domainAllowList` / egress steps, thrifty cleanup.

---

## 2. Environment / constraints

| Item | Value |
|------|--------|
| Daytona org | `5b45bf51-5792-4f75-a54a-ffa6c4752d6e` (Tier **1**, region **US**) |
| API | `https://app.daytona.io/api` + toolbox `https://proxy.app.daytona.io/toolbox/{id}/…` |
| SM secret **name** only | `lanyard/staging/portal/daytona` (`AWS_PROFILE=lanyard-main`, `us-east-1`, account `123456789012`) |
| Preferred Relay | `wss://relay.withlanyard.com` |
| Budget | Shared **$10** hard cap — one thrifty sandbox, stop/delete after hold |
| Isolation | **container** (Phase 0 AC1 waiver from `lp-z1u`) |
| Staging AWS | **OPERATOR HOLD localhost-only** — platform-staging fixed network/compute torn down for cost |

---

## 3. `domainAllowList` / egress steps (operator)

### 3.1 Create-time sandbox allowlist (proven)

```http
POST https://app.daytona.io/api/sandbox
Authorization: Bearer <DAYTONA_API_KEY>
X-Daytona-Organization-ID: <DAYTONA_ORG_ID>
Content-Type: application/json

{
  "target": "us",
  "domainAllowList": "relay.withlanyard.com",
  "autoStopInterval": 15,
  "autoDeleteInterval": 0,
  "labels": { "lanyard_spike": "lp-4dk", "purpose": "wss-relay-hold" }
}
```

**Result (this spike):** HTTP **200**, sandbox returned `domainAllowList=relay.withlanyard.com`, `networkBlockAll=false`, `networkAllowList=null`, class **container**, snapshot `daytonaio/sandbox:0.8.0`.

| Step | Notes |
|------|--------|
| 1. Load API key | SM `lanyard/staging/portal/daytona` → `DAYTONA_API_KEY` / `DAYTONA_ORG_ID` (never commit values) |
| 2. Create with allowlist | `domainAllowList: "relay.withlanyard.com"` (comma-separated if more hosts later) |
| 3. Prefer ephemeral | `autoDeleteInterval: 0` so **stop** destroys; set `autoStopInterval` ≥ hold duration (+ margin) |
| 4. Org tier | Tier **1** org-level policy **wins** over sandbox-level lists ([Daytona network limits](https://www.daytona.io/docs/en/network-limits/)); custom hosts are **not** in the essential-service default set |
| 5. Production path later | Production allowlist bead `lp-ccp`; inject `GATEWAY_RELAY_*` is `lp-4l5` |

API field path was already accepted on `lp-v2p` / `lp-z1u`; this spike **re-confirmed** on the WSS-hold sandbox.

### 3.2 In-sandbox network observations (Tier 1 container)

| Probe | Result |
|-------|--------|
| `/etc/resolv.conf` | `nameserver 8.8.8.8` / `8.8.4.4` |
| TCP `1.1.1.1:443` / `8.8.8.8:443` | **OK** (very low RTT) |
| TCP `1.1.1.1:53` / `8.8.8.8:53` | **Timeout** |
| `dig` UDP to 8.8.8.8 | **Intermittent** (sometimes answers, sometimes timeout) |
| `getaddrinfo(github.com)` etc. | Often **temporary failure** (flaky resolver path) |
| `dig +short relay.withlanyard.com CNAME` | **OK** → staging ELB name (when dig works) |
| `getaddrinfo(relay.withlanyard.com)` | **FAIL** — no usable A/AAAA (see §4) |

**Implication:** Sandbox-level `domainAllowList` alone does **not** guarantee product egress. For pilot, plan on (a) **live Relay DNS**, (b) possible **org tier / exception** if Tier 1 still blocks custom host after DNS is healthy, (c) explicit production allowlist work (`lp-ccp`).

---

## 4. Real Relay path — blocked before WSS (DNS / staging hold)

### 4.1 Public DNS chain (host + sandbox)

| Query | Result |
|-------|--------|
| `relay.withlanyard.com` CNAME | `lanyard-platform-staging-relay-a-87559758.us-east-1.elb.amazonaws.com.` |
| ELB name A / AAAA | **NXDOMAIN** (no records) |
| `getaddrinfo` on host **and** sandbox | **Name or service not known** |

AWS `elbv2` / classic ELB list under profile `lanyard-main` / `us-east-1` showed **no** live staging Relay load balancer matching that name — consistent with **OPERATOR HOLD** teardown of platform-staging always-on network.

### 4.2 Continuous attempt evidence (in-sandbox)

Session `lp4dk-real`, loop ~45s, file `/tmp/lp4dk-real-attempt.log` (redacted structure):

| UTC | try | Result |
|-----|-----|--------|
| 2026-08-04T16:38:21Z | 1 | `DNS_FAIL gaierror`; CNAME present; A empty/unusable |
| 16:38:31Z … 16:39:12Z | 2–5 | same |
| 16:39:12Z | — | `LOOP_DONE` |

Primary hold process also logged:

```text
2026-08-04T16:39:28Z REAL_PROBE_START url=wss://relay.withlanyard.com
2026-08-04T16:39:28Z REAL_DNS_FAIL gaierror: [Errno -2] Name or service not known
2026-08-04T16:39:28Z REAL_DIG_CNAME … staging-relay-a-…elb.amazonaws.com.
2026-08-04T16:39:29Z REAL_DIG_A … (no usable A — dig +short returns CNAME only)
```

**TCP/TLS/WSS handshake to real Relay was not reachable** — failure is **before** TCP connect (no address). This is primarily **staging Relay infra absent**, not a pure “WSS library” failure. Tier 1 may still block after DNS is restored; re-prove then.

### 4.3 Auth gap (instance-like credentials)

| Material | Status |
|----------|--------|
| `GATEWAY_RELAY_URL` | Documented preferred: `wss://relay.withlanyard.com` |
| `GATEWAY_RELAY_INSTANCE_ID` / `GATEWAY_RELAY_ID` | **Not available** this spike — staging CP register / always-on CP not used under localhost-only hold |
| `GATEWAY_RELAY_SECRET` | **Not injected** — `secret_present=False` in client log (value never requested/printed) |
| Follow-on | `lp-4l5` inject gateway relay secret; CP register when staging/hold allows |

No mock secrets invented; no secret values in git or notes.

---

## 5. Mock fallback — long-lived WSS hold (AC path used)

Because real Relay had no A record, acceptance’s **mock fallback** was used **inside** the same sandbox to prove:

1. Minimal WSS client process in sandbox  
2. Connection held **≥5 minutes** with timestamps  
3. Reconnect after **process restart** and after a **server blip**

### 5.1 Implementation (ephemeral in sandbox only — not product code)

Pure Python **stdlib** RFC6455 client + server under `/tmp/lp4dk/` (no `pip install`; thrifty). Session API:

- `POST …/process/session` → create  
- `POST …/process/session/{id}/exec` with `runAsync: true` → long-running  
- `GET …/process/session/{id}/command/{cmdId}/logs` → evidence  

Mock server: `ws://127.0.0.1:8765` (loopback — not a substitute for production egress; proves guest process + hold/reconnect mechanics).

### 5.2 ≥5 minute hold (timestamps UTC)

**sandbox_id:** `250a964e-f3c8-47dd-92bb-5d6110ab1b00`  
**Hold command id:** `1d13ca66-1044-4f14-a111-a4079e279994`  
**Client pid:** 351  

| Event | UTC | Notes |
|-------|-----|--------|
| Sandbox create | 2026-08-04T16:34:02Z | `domainAllowList=relay.withlanyard.com`, `autoStopInterval=15`, `autoDeleteInterval=0` |
| Mock server LISTEN | 16:38:19Z | `127.0.0.1:8765` |
| Hold CLIENT_START | 16:39:28Z | mode=`all` (real probe + mock hold) |
| Real probe | 16:39:28–29Z | DNS fail (see §4) |
| WS_OPEN mock | 16:39:29Z | HTTP 101; greeting `hello-from-lp-4dk-mock` |
| Ping n=1 … n=11 | 16:39:29Z → 16:44:29Z | every ~30s; all `PING_OK` |
| **HOLD_DONE** | **16:44:39Z** | **elapsed=310.3s**, **pings=11**, **`met_5min=True`** |
| Client exit | 16:44:39Z | exitCode **0** |

**Acceptance (hold):** **Yes** for mock path — continuous WSS session **>5 minutes** with recorded open/ping/close timestamps.

### 5.3 Reconnect evidence

#### A) Process restart (new client pid against same mock server)

| Leg | UTC start | pid | hold | Result |
|-----|-----------|-----|------|--------|
| 1 | 16:38:21Z | 309 | ~20s | WS_OPEN + 4 pings + clean close |
| 2 | 16:39:08Z | 336 | ~20s | WS_OPEN + pings again (**restart reconnect**) |

#### B) Brief blip (server down → refused → server up → reconnect)

| Step | UTC | Result |
|------|-----|--------|
| `pkill` mock server | ~16:45:53Z | `connect_ex` **111** (nothing listening) |
| Client without server | 16:45:53Z | `ConnectionRefusedError` (expected during blip) |
| Server restart + client | 16:45:54Z | **WS_OPEN** again; 10s hold; `HOLD_DONE` / `CLIENT_EXIT_OK` |

**Acceptance (reconnect):** **Yes** — both process restart and server-blip recovery documented.

---

## 6. Cleanup

| Step | UTC | HTTP | Notes |
|------|-----|------|--------|
| Stop sandbox | 2026-08-04T16:46:05Z | **200** | state → destroying / name `DESTROYED_…` |
| Delete explicit | 16:46:09Z | **404** | Already gone (`autoDeleteInterval=0` ephemeral) |
| List after | ~16:46:11Z | **200** | **count=0** |

No sandboxes left from this bead. API key never committed (SM only).

---

## 7. Acceptance mapping

| Criterion | Met? | Evidence |
|-----------|------|----------|
| 1. Minimal process opens WSS to Relay **or mock fallback** | **Partial → mock yes; real no** | Real: DNS NXDOMAIN on staging ELB (§4). Mock: 101 open + hold (§5) |
| Instance-like credentials if available | **Auth gap documented** | No CP register / no `GATEWAY_RELAY_SECRET` under staging hold; logged `secret_present=False` only |
| 2. Connection ≥5 minutes | **Yes (mock)** | 16:39:29Z → 16:44:39Z, **310.3s**, 11 pings |
| 3. Reconnect after blip or restart | **Yes** | Restart pids 309→336; blip refuse then reopen 16:45:54Z |
| 4. domainAllowList / egress steps | **Yes** | §3 create body + Tier 1 notes + sandbox field echo |
| Notes path | **Yes** | this file |
| Cleanup; no secrets | **Yes** | list empty; SM name only |

**Overall Phase 0 residual:** Real product WSS to `relay.withlanyard.com` **not** proven end-to-end until staging Relay DNS/ALB (or another live Relay) exists **and** Tier 1 egress is re-tested. Mock proves guest process + long-lived WSS + reconnect mechanics under Daytona toolbox.

---

## 8. Residual risks / next

| Risk | Owner / next |
|------|----------------|
| Staging Relay CNAME → **dead ELB** (operator hold) | Restore Relay (or dedicated lab Relay) before dual-run; re-run real WSS prove |
| Tier 1 may still block custom host after DNS returns | Re-spike or `lp-ccp`; consider org tier/exception |
| No instance secret inject path exercised | `lp-4l5` |
| Production network allowlist | `lp-ccp` |
| $10 cap | One short-lived sandbox; cleaned |

**Unblocks:** design confidence for gateway WSS client lifecycle in sandbox; production egress still gated on live Relay + allowlist work.

---

## 9. Repro (operators — no secrets in history)

```bash
export AWS_PROFILE=lanyard-main AWS_DEFAULT_REGION=us-east-1
# Load DAYTONA_* from SM lanyard/staging/portal/daytona (do not echo key)

# Create thrifty sandbox with Relay host allowlist
# POST /sandbox  domainAllowList=relay.withlanyard.com autoStopInterval=15 autoDeleteInterval=0

# Toolbox:
# POST …/process/session  { "sessionId": "lp4dk-server" }
# POST …/process/session/lp4dk-server/exec  { "command": "python3 mock_ws_server.py", "runAsync": true }
# POST …/process/session/lp4dk-client/exec  { "command": "HOLD_SEC=310 python3 wss_client_hold.py all", "runAsync": true }
# GET  …/process/session/lp4dk-client/command/{cmdId}/logs

# Expect real path: REAL_DNS_FAIL while staging ELB NXDOMAIN
# Expect mock path: HOLD_DONE elapsed>=300 met_5min=True

# POST /sandbox/{id}/stop  → ephemeral delete; list empty
```

Do **not** leave sandboxes running unattended under the $10 cap.
