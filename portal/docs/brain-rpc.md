# Brain RPC vertical slice (G3.3)

Portal invokes **read-oriented customer-host operations** over the existing
egress-only Hermes relay WebSocket. No public inbound host port.

**Contract (authority):**
[company-brain-deploy `references/brain-rpc-contract.md`](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/brain-rpc-contract.md)

**Hermes handlers (G3.2):** `gateway/brain_rpc/` on `LanyardBrain/hermes-agent`
(Lanyard branch). This document covers the **Portal** call path only.

## Feature flag / readiness gate

| Env | Default | Effect |
|-----|---------|--------|
| `BRAIN_RPC_ENABLED` | **off** (`0` / unset) | `/api/brain/*` returns **503** (fail closed). `/api/context` reports `brain_rpc_enabled: false`. |

Enable with any of: `1`, `true`, `yes`, `on` (case-insensitive).

```bash
export BRAIN_RPC_ENABLED=1
```

### UI gating guidance

Until the flag is on **and** a host probe succeeds:

- Treat vault / settings / projects **host ops** as not production-ready.
- Prefer `GET /api/brain/health` (or `GET /api/brain/ping`) before opening host-backed UI.
- Local fixture / `VAULT_ROOT` providers remain for chat-only pilot and dev; they are **not** a production substitute for brain RPC.

`GET /api/context` includes:

```json
{ "brain_rpc_enabled": false }
```

## Path (vertical slice)

```text
Browser
  → BFF  GET /api/brain/ping | /api/brain/health
    → Relay  POST /internal/brain-rpc  (x-relay-internal-token)
      → WSS  brain_rpc_request  → Hermes host handlers
      ← WSS  brain_rpc_result
```

## Browser API

All routes require an authenticated Portal session and a mapped Hermes profile
(RBAC). Subject claims are **stamped by the BFF** from control-plane RBAC —
never trusted from the browser.

| Method | Path | Host method | Notes |
|--------|------|-------------|--------|
| `GET` | `/api/brain/ping` | `brain.ping` | Optional `?echo=` (≤64 chars). Liveness through the full path. |
| `GET` | `/api/brain/health` | `brain.health` | Structured readiness for pilot gates. |

### Success (200)

```json
{
  "ok": true,
  "method": "brain.ping",
  "instance_id": "inst_…",
  "request_id": "…",
  "result": { "pong": true, "echo": "optional", "contract_version": 1 },
  "meta": { "duration_ms": 12, "hermes_profile": "contributor" }
}
```

### Fail-closed errors

| Condition | HTTP | Notes |
|-----------|------|--------|
| Flag off | **503** | `Brain RPC is disabled…` |
| Not authenticated | **401** | Session required |
| No Hermes profile | **403** | RBAC missing |
| No primary instance / CP error | CP status | Control-plane lookup |
| Gateway not connected / handshake incomplete | **503** | Relay `not_connected` |
| Relay/socket closed mid-call | **502**/**503** | Transport failure |
| Host timeout | **504** | `timeout_ms` budget |
| Host `error.code` | mapped | Contract §5.2 (`forbidden`→403, `unavailable`→503, …) |

There is **no** silent fallback to local `VAULT_ROOT` / fixtures on this path.

## Relay internal API

Protected by `x-relay-internal-token` (`RELAY_INTERNAL_TOKEN`).

```http
POST /internal/brain-rpc
Content-Type: application/json

{
  "instance_id": "inst_…",
  "tenant_id": "ten_…",
  "request": { "type": "brain_rpc_request", "…": "…" }
}
```

- **200** `{ "ok": true, "result": <brain_rpc_result frame> }`
- **503** gateway not connected
- **504** host timeout
- **401** bad internal token

## Auth stamping (L3)

BFF builds `auth` on every request:

| Field | Source |
|-------|--------|
| `tenant_id` | Resolved tenant |
| `instance_id` | Control plane primary gateway instance |
| `subject.portal_user_id` | Session user |
| `subject.hermes_profile` | Control plane RBAC |
| `subject.roles` | Control plane role names |
| `subject.path_prefixes` | Control plane allowed path prefixes |
| `session_id` | Portal session cookie id |
| `issued_at` / `expires_at` | BFF clock; default TTL 5 minutes |

Hermes re-checks profile capabilities and path ACL (L4/L5).

## Tests (staging-proof substitute)

```bash
pnpm --filter @lanyard/shared test
pnpm --filter @lanyard/relay test
pnpm --filter @lanyard/bff test
```

Covered scenarios:

1. Flag off → 503 on `/api/brain/ping`
2. Flag on, gateway disconnected → 503
3. Flag on, mock Hermes answers `brain.ping` / `brain.health` → 200 with stamped subject
4. Host `unavailable` → 503
5. Relay `/internal/brain-rpc` round-trip + fail-closed without session

Integration tests live in:

- `packages/bff/test/brain-rpc.integration.test.ts`
- `packages/relay/test/relay.integration.test.ts`
- `packages/shared/src/relay/brain-rpc.test.ts`

## Non-goals (this slice)

- Full vault/settings/projects provider swap to brain RPC (follow-on)
- Vault writes / settings mutate
- Claiming G3 production-ready without staging E2E (G3.4)
- Public inbound HTTP on the customer host
