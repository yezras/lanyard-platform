# @lanyard/relay

WebSocket relay service implementing Hermes relay v1 (`RelaySessionServer`).

Gateway auth, handshake, inbound/outbound frames, chat delivery hub, **force-revocation of live sessions** (G2.3), **replay-resistant upgrade tokens** (G2a), and **multi-relay routing bus + shared revocation** (G6.2).

**Design (accepted):**

- [G2a.1 — Replay resistance](../../docs/adr/g2a-relay-replay-resistance.md) (single-use upgrade jti + session exclusivity)
- [G6.1 — Routing bus + shared revocation](../../docs/adr/g6-relay-routing-bus.md) (required before relay desired count > 1)

## Contract

Wire types and conformance tests live in `@lanyard/shared`:

- `packages/shared/src/relay/` — `CapabilityDescriptor`, frame envelopes, serialization, `RELAY_UNAUTHORIZED_CLOSE_CODE` (**4401**)
- Hermes source: private `LanyardBrain/hermes-lanyard` (`gateway/relay/auth.py`); upstream Nous docs for wire frames
- Design ADR: G6.1 routing bus (`docs/adr/g6-relay-routing-bus.md`); G2a.1 replay ADR (`docs/adr/g2a-relay-replay-resistance.md`)

## Layout

```
packages/relay/
  src/
server.ts               # HTTP + WebSocket listener at /relay
    auth.ts                 # Upgrade token mint/verify (jti + legacy dual-accept)
    jti-store.ts            # Single-use jti store (memory; Redis adapter for G6)
    relay-auth-policy.ts    # Fail-closed production defaults
    relay-session-server.ts # Session map, exclusivity, revokeInstance → close 4401
    internal-http.ts        # BFF/ops internal routes (token-gated)
    secret-store.ts         # In-memory / dev secret material
    chat-delivery-hub.ts    # Portal chat SSE + history
    cluster/                # G6 multi-relay: owner lease + pub/sub bus
```

Customer gateway Terraform wiring remains in [LanyardBrain/Core `infra/portal/`](https://github.com/LanyardBrain/Core/tree/main/infra/portal).

**Production credential lifecycle (register / rotate / revoke):** [docs/runbooks/relay-credential-lifecycle.md](../../docs/runbooks/relay-credential-lifecycle.md) (G2.4).  
**Log retention / access policy:** [docs/policies/log-retention-and-access.md](../../docs/policies/log-retention-and-access.md) (G2b.1).

## Logging (G2b.2)

Structured logs via `@lanyard/shared` `createLogger`. **Default: no chat/tool/vault payloads** on shared sinks. Secrets always redacted.

| Env | Default | Meaning |
|-----|---------|---------|
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `PORTAL_DEBUG_PAYLOADS` | off | When `true`/`1`, allow non-secret payload fields in log lines (local/support only) |

See [docs/policies/log-redaction.md](../../docs/policies/log-redaction.md).

## Upgrade auth / replay resistance (G2a)

Gateway WebSocket upgrade uses a short-lived HMAC bearer:

| Format | Wire | Notes |
|--------|------|--------|
| **v1j (default mint)** | `base64url(gatewayId:exp:jti:sig)` | `sig = HMAC_SHA256(gatewayId:exp:jti, secret).hex`; jti ≥128-bit random; **stock Hermes g7h3+** |
| **v1 legacy** | `base64url(gatewayId:exp:sig)` | Dual-accept in development; production only with `RELAY_ALLOW_LEGACY_UPGRADE_TOKEN=1` |

**Controls:**

1. **Single-use jti** — successful upgrade consumes the jti; identical bearer → **401** (`upgrade_replay_rejected` metric).
2. **Session exclusivity** — at most one live WS per `instance_id`; new auth closes the prior socket with **4401** / reason `replaced`.
3. **Production fail-closed** (`NODE_ENV=production` or `RELAY_AUTH_MODE=production`):
   - **accept jti** (stock pin path — no host venv patch required)
   - reject `exp=0` (non-expiring)
   - reject remaining TTL &gt; 300s (override with `RELAY_MAX_UPGRADE_TTL_SECONDS`)
   - legacy tokens rejected unless `RELAY_ALLOW_LEGACY_UPGRADE_TOKEN=1`
4. **Dual-accept** — development (default) or production with `RELAY_ALLOW_LEGACY_UPGRADE_TOKEN=1` accepts **both** claim shapes; jti remains single-use.
5. **Metrics (metadata only):** `upgrade_jti_accepted`, `upgrade_legacy_accepted`, `upgrade_replay_rejected`, `upgrade_auth_failed`.

| Env | Default | Purpose |
|-----|---------|---------|
| `RELAY_AUTH_MODE` | from `NODE_ENV` | `production` \| `development` |
| `RELAY_ALLOW_LEGACY_UPGRADE_TOKEN` | on in dev / off in prod | Dual-accept pre-jti gateways / migration window |
| `RELAY_REQUIRE_UPGRADE_JTI` | (derived) | Force jti even when legacy allow is set |
| `RELAY_ALLOW_QUERY_TOKEN` | off | Lab `?token=` (increases log leakage risk) |
| `RELAY_MAX_UPGRADE_TTL_SECONDS` | `300` | Max accepted remaining TTL |

jti store is **in-process** by default. Multi-relay shared Redis (`relay:v1:jti:{jti}`) is G6 — inject `RedisJtiStore`.

Stolen **long-lived** secrets still need G2 rotate/revoke + G2.3 force **4401**; G2a only makes each minted token single-use.

**Operator runbook (staging probe + rollback):** monorepo
[docs/runbooks/relay-jti-dual-accept.md](../../../docs/runbooks/relay-jti-dual-accept.md)
(`lp-t7q.9`). Do not use ephemeral host `legacy=True` venv patches after the
relay image with this path is deployed.

## Internal HTTP (ops / BFF)

Protected by header `x-relay-internal-token` (`RELAY_INTERNAL_TOKEN`).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/internal/deliver-inbound` | Portal → gateway inbound frame (local or bus hop) |
| `POST` | `/internal/interrupt-inbound` | Mid-turn stop (local or bus hop) |
| `POST` | `/internal/brain-rpc` | **G3.3** brain RPC request/response over live gateway WS |
| `GET` | `/internal/chat/:chatId/events` | SSE outbound stream (owner-local hub) |
| `GET` | `/internal/chat/:chatId/history` | Durable outbound hydrate |
| `GET` | `/internal/instances/:id/owner` | **G6** owner registry lookup (`advertise_url`) |
| `POST` | `/internal/instances/:id/revoke` | **G2.3/G6** shared revoke + close live WS with **4401** |
| `GET` | `/health` | Liveness (no Redis required) |
| `GET` | `/ready` | Readiness (`bus` mode PING Redis; fail-closed) |

## Multi-relay routing bus (G6.2)

Default is **single-node** process-local maps (docker-compose / desired count = 1). Horizontal scale requires:

| Env | Purpose |
|-----|---------|
| `RELAY_CLUSTER_MODE=bus` | Enable Redis owner lease + pub/sub bus |
| `REDIS_URL` | ElastiCache Redis/Valkey URL (**GitHub Secret / SSM name only** — never commit credentials) |
| `RELAY_ADVERTISE_URL` | Internal base URL other tasks/BFF use for SSE/history stickiness |
| `RELAY_NODE_ID` | Optional stable node id (default random UUID / task ARN) |
| `RELAY_OWNER_LEASE_SECONDS` | Owner key TTL (default 30) |
| `RELAY_OWNER_HEARTBEAT_MS` | Lease refresh interval (default 10000) |
| `RELAY_REVOKE_RETENTION_SECONDS` | Shared revoke marker TTL (default 7d) |
| `RELAY_BUS_ACK_TIMEOUT_MS` | Cross-node deliver/interrupt ack wait (default 2000) |

Redis key layout (distinct from BFF G5 `bff:v1:sess:`):

- `relay:v1:owner:{instance_id}` — owner lease JSON
- `relay:v1:revoked:{instance_id}` — shared revoke marker
- Channels: `relay:v1:bus:deliver` / `interrupt` / `revoke` / `owner_changed`

BFF keeps `deliver-inbound` / interrupt against the cluster service URL (any task). Chat SSE/history resolve owner via `GET /internal/instances/:id/owner` and stick to `advertise_url`.

### Brain RPC (G3.3)

Portal BFF invokes customer-host methods (`brain.ping`, …) by posting a full
`brain_rpc_request` envelope. The relay delivers it on the authenticated
Hermes session and waits for a matching `brain_rpc_result` (by `request_id`).

```http
POST /internal/brain-rpc
x-relay-internal-token: <RELAY_INTERNAL_TOKEN>
Content-Type: application/json

{
  "instance_id": "inst_…",
  "tenant_id": "ten_…",
  "request": { "type": "brain_rpc_request", "request_id": "…", "method": "brain.ping", "…": "…" }
}
```

- **200** — `{ ok: true, result: <brain_rpc_result> }`
- **503** — gateway not connected / handshake incomplete (fail closed)
- **504** — host exceeded `timeout_ms`
- **401** — missing/wrong internal token

Browser-facing flag, auth stamp, and readiness gate: **[docs/brain-rpc.md](../../docs/brain-rpc.md)**.

### Force-revoke live access (G2.3)

Connect-time validation alone does **not** kill already-connected sockets. After control plane deprovision or per-instance revoke, operators (or automation) must call the relay:

```http
POST /internal/instances/{instance_id}/revoke
x-relay-internal-token: <RELAY_INTERNAL_TOKEN>
```

Response **200**:

```json
{
  "ok": true,
  "instance_id": "…",
  "secret_revoked": true,
  "sessions_closed": 1,
  "close_code": 4401,
  "relay_behavior": "Live gateway WebSocket sessions for this instance are closed with code 4401; subsequent upgrades are rejected."
}
```

- **404** if the instance is unknown to this relay process and no session is open
- **401** if the internal token is missing/wrong
- **503** if `RELAY_INTERNAL_TOKEN` is not configured

## Staging demonstration (G2.3) — automated substitute

No dedicated shared staging env is required for this track. The integration suite is the **staging-proof substitute**:

```bash
pnpm --filter @lanyard/relay test
```

Covered scenarios (see `test/relay.integration.test.ts`):

1. Mock gateway connects + completes `hello` handshake
2. `sessionServer.revokeInstance(instanceId)` **or** `POST /internal/instances/:id/revoke` closes the socket with **4401** / reason `revoked`
3. Subsequent WebSocket upgrade with the same secret is rejected
4. Internal token required; unknown instance → 404
5. **G2a:** same upgrade bearer twice → second **401**; fresh jti reconnects; exclusivity **4401** `replaced`; production rejects legacy / `exp=0`

### Manual staging procedure (when live env is available)

1. Register instance on control plane (`POST /tenants/:id/instances/register`) and seed relay secret / connect a gateway.
2. Confirm gateway is connected (chat or relay session metrics).
3. **CP revoke** (pick one):
   - Tenant-wide: `POST /tenants/:id/deprovision` → note `revoked_instance_ids`
   - Single instance: `POST /tenants/:id/instances/:instanceId/revoke`
4. **Relay kill-switch** (required for live sessions):
   ```bash
   curl -sS -X POST "$RELAY_URL/internal/instances/$INSTANCE_ID/revoke" \
     -H "x-relay-internal-token: $RELAY_INTERNAL_TOKEN"
   ```
5. Observe gateway WebSocket close **4401**; new dials with the old secret fail validation / upgrade.
6. Optional: `POST $CONTROL_PLANE_URL/internal/instances/validate` with the old secret → `valid: false`, `reason: "revoked"`.

Operator runbook (register, rotate, revoke, SSM/Secrets Manager):

- **[company-brain-deploy: relay secret lifecycle](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/runbooks/relay-secret-lifecycle.md)**

Control plane contract and deprovision notes: [`packages/control-plane/README.md`](../control-plane/README.md).

## Docker

Build from monorepo root:

```bash
docker build -f packages/relay/Dockerfile -t lanyard/relay:local .
docker run --rm -p 8787:8787 lanyard/relay:local
curl -sf http://127.0.0.1:8787/health
```

Local tags are smoke/build artifacts. Production pins ECR digests (not `:latest`); see root README and G7.P3.
`bash scripts/docker-smoke.sh` builds bff + relay + control-plane and checks `/health`.
