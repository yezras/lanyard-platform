# Wake failure → user-visible errors and retries (`lp-mrh`)

**Status:** BFF mapping implemented (fake-CP tests).  
**Bead:** `lp-mrh` (Phase 5 / `lp-mci`)  
**Code:** `portal/packages/bff/src/ensure-online-errors.ts`  
**Related:** [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md), [presence-state-machine.md](./presence-state-machine.md), [relay-connected-wait.md](./relay-connected-wait.md)

## Purpose

When `ensure_online` fails, the platform must **never silently accept** a user message and drop the agent reply. Failures map to:

1. **Stable error codes** (UI / metrics / support)
2. **HTTP status** consistent with CP
3. **User-visible message** (safe copy; no secrets)
4. **Retry guidance** (`retryable` + short `retry_guidance`)

Call sites: BFF chat send, Brain RPC invoker, channel-adapter deliver (Slack/email).

## CP → BFF mapping

Control Plane HTTP (see orchestrator API):

| CP HTTP | CP `code` | Typical cause |
|---------|-----------|---------------|
| **504** | `ENSURE_ONLINE_TIMEOUT` | `wait_timeout_ms` elapsed while still waking |
| **502** | `ENSURE_ONLINE_WAKE_FAILED` | Daytona create/start fail, vault mount fail closed, never-connect after recreate |
| **429** | `ENSURE_ONLINE_RATE_LIMITED` | Per-tenant or global wake rate limit (lp-rq1); joiners of in-flight wakes are not throttled |
| **403** | `DAYTONA_PATH_GATED` / revoked | Allowlist / `DAYTONA_ENABLED` off / instance revoked |
| **404** | — | Unknown `instance_id` |
| **501** | `ORCHESTRATOR_NOT_IMPLEMENTED` | Orchestrator not wired |
| **400** | — | Invalid ensure-online body |

BFF `ControlPlaneAuthClient.ensureOnline` / `getInstancePresence` preserve CP `code` on `ControlPlaneRequestError` when present.

### User-facing codes (`WakeFailureCode`)

| `code` | HTTP | `retryable` | When |
|--------|------|-------------|------|
| `wake_timeout` | 504 | **yes** | Timeout while waking |
| `daytona_unavailable` | 502/503 | **yes** | Daytona API down / network (message heuristics) |
| `vault_mount_failed` | 502 | **no** | Vault mount / `s3_vault_prefix` / `VAULT_ROOT` fail closed |
| `wake_failed` | 502 | **yes** | Other create/start/relay wake failure |
| `daytona_path_gated` | 403 | **no** | Path gated / not allowlisted |
| `instance_revoked` | 403 | **no** | Revoked instance |
| `not_found` | 404 | **no** | Missing instance |
| `not_implemented` | 501 | **no** | Orchestrator stub |
| `rate_limited` | 429 | **yes** | Throttle |
| `invalid_argument` | 400 | **no** | Bad request body |
| `unavailable` | other 5xx | **yes** | Fallback |

Heuristic split for **502** `ENSURE_ONLINE_WAKE_FAILED`:

- Message matches vault/prefix/mount → `vault_mount_failed` (not user-retryable; platform config)
- Message matches Daytona API down / connection refused → `daytona_unavailable`
- Else → `wake_failed` (user may retry send)

## Chat send response shape

`POST /api/chat/threads/:threadId/messages` when wake fails (flag on + daytona):

```json
{
  "error": "wake_timeout",
  "code": "wake_timeout",
  "message": "The agent is taking longer than expected to start. Your message was not delivered.",
  "retryable": true,
  "retry_guidance": "Wait a few seconds and send your message again. Cold start can take up to a minute.",
  "phase": "ensure_online",
  "cp_code": "ENSURE_ONLINE_TIMEOUT"
}
```

### No silent drop

On ensure_online failure the BFF:

1. If the CP error is already settled on the POST (instant 404/502/504), returns **non-2xx** with the body above
2. If the POST already returned **202** `agent_starting` (wake still in flight, or Relay handshake not-ready, lp-vqr0.8), publishes the same failure as an SSE `error` frame instead of holding CloudFront
3. Does **not** call Relay `deliver-inbound`
4. **Does** `appendHistory` for the user bubble before kickoff/deliver (`lp-v62i.11`). Wake fail still returns non-2xx / SSE error so the client can retry; the durable bubble is already painted.

The client keeps the draft / can re-send, or waits on SSE `agent_ready` / `error`. A 200 + empty agent stream for a lost wake is a bug. Instant 202 + queued deliver after `agent_ready` is the T4 path.

## Brain RPC

`controlPlaneEnsureOnlineToBackendError` uses the same mapper:

- `backendCode`: `timeout` | `unavailable` | `forbidden` | `not_found` | …
- `details.ensure_online: true`
- `details.wake_code`, `details.retry_guidance`, optional `details.cp_code`
- `retryable` from the wake table

Vault/settings/projects handlers already map `BackendRuntimeError` → HTTP.

## Channel adapters

`deliverChannelAdapterInbound` failure on ensure_online / resolve:

```ts
{
  ok: false,
  phase: "ensure_online",
  status: 504,
  error: "wake_timeout",
  code: "wake_timeout",
  message: "…",
  retryable: true,
  retry_guidance: "…",
  instanceId?: string,
}
```

Adapters must surface this to the channel (Slack ephemeral, email bounce path, etc.) — not ack-and-drop.

## Retry policy (product)

| Situation | Client action |
|-----------|----------------|
| `retryable: true` | Re-send the **same** user message after a short backoff (seconds; cold wake may need ~30–60s) |
| `retryable: false` | Show message + guidance; do not auto-retry loop |
| After success | Normal stream; history already has user text only after deliver |

CP singleflight: concurrent ensure_online for the same instance joins one wake — clients need not coalesce beyond normal UX.

## Tests

| Suite | Coverage |
|-------|----------|
| `portal/packages/bff/test/ensure-online-errors.test.ts` | Code mapping matrix (timeout, Daytona, vault, gated, …) |
| `portal/packages/bff/test/ensure-online-chat.test.ts` | Chat call site: wake fail → structured body; no deliver; no history append |
| `portal/packages/bff/test/ensure-online-brain-rpc-channel.test.ts` | BackendRuntimeError details include wake mapping |
| `portal/packages/bff/test/ensure-online-channel-adapter.test.ts` | Adapter phase ensure_online carries code/retryable |

Fake CP only — no live Daytona / AWS / secrets.

## UI follow-ups

- `lp-u7z`: BFF publishes `agent_starting` / `agent_ready` / wake `error` on chat events SSE
- `lp-6ty` (Portal web): show **Agent starting…** from `agent_starting`; on wake failure show error banner with `message` + `retry_guidance` (via `ChatSendError` / SSE error) — prefer those over raw CP strings
  - Helpers: `portal/packages/web/src/features/chat/agentStarting.ts`, `AgentStartingStatus.tsx`
  - SSE wiring: `useChatEvents` (`agentWakeStatus`); send path: `api/chat.ts` `ChatSendError`
