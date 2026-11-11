# Control Plane internal orchestrator API stubs (`lp-biq`)

**Status:** Routes + request/response shapes declared (offline).  
**Bead:** `lp-biq`  
**Code:** `portal/packages/control-plane/src/orchestrator-api.ts` (+ routes in `app.ts`)  
**BFF client stubs:** `portal/packages/bff/src/control-plane-client.ts`  
**Related:** [presence-state-machine.md](./presence-state-machine.md), [identity-model.md](./identity-model.md), [offline-piping.md](./offline-piping.md), [cp-daytona-config.md](./cp-daytona-config.md)

## Purpose

Define the **internal HTTP surface** that the Instance Orchestrator exposes to BFF / adapters for on-demand Daytona sandboxes:

| Operation | Method + path | Purpose |
|-----------|---------------|---------|
| **ensure-online** | `POST /internal/instances/:instanceId/ensure-online` | Wake path: offline\|error → waking → online (singleflight) |
| **ensure-online by user** | `POST /internal/tenants/:tenantId/users/:userId/ensure-online` | Resolve user-scope else tenant primary, then same wake (`lp-oop.19`) |
| **presence** | `GET /internal/instances/:instanceId/presence` | Read current presence + dual-run fields |
| **signal-activity** | `POST /internal/instances/:instanceId/signal-activity` | Bump `last_activity_at` for idle grace |
| **stop** | `POST /internal/instances/:instanceId/stop` | Explicit or idle stop → presence `offline` |

Auth: same as other `/internal/*` routes — `x-control-plane-service-token` (BFF) or `x-internal-ops-token` (ops). Not public.

**ensure-online (`lp-nus`):** wired to `InstanceOrchestrator.ensureOnline` when CP boots with Daytona enabled+ready (or tests inject real harness). Singleflight per `instance_id`; online short-circuit; offline|error → create/start; `wait_timeout_ms` → **504** + presence `error`. Without orchestrator → **501**. Presence GET and signal-activity write are implemented against the presence store (`lp-omt` / `lp-84f`). **stop (`lp-cbv`):** wired to `InstanceOrchestrator.stop` when the same orchestrator is injected; without orchestrator → **501**. BFF call sites stay behind feature flag default **off** (`lp-kng.2.8`). Full fake lifecycle: [fake-daytona-wake-stop-rewake.md](./fake-daytona-wake-stop-rewake.md).

## Path constants

Exported from `@lanyard/control-plane`:

```ts
ORCHESTRATOR_ROUTE_TEMPLATES  // Hono templates with :instanceId
ORCHESTRATOR_API_PATHS        // builders: (instanceId) => concrete path
```

BFF client uses the same concrete path strings (self-contained; package does not depend on CP).

## Request / response shapes

### `POST …/ensure-online`

**Request** (optional JSON body; empty `{}` ok):

```ts
type EnsureOnlineRequest = {
  wait_timeout_ms?: number; // 0..600_000; wait on singleflight / wake
};
```

**Response 200** (when implemented):

```ts
type EnsureOnlineResponse = {
  instance_id: string;
  tenant_id: string;
  presence: "offline" | "waking" | "online" | "error";
  sandbox_id: string | null;
  runtime_kind: "ec2" | "daytona";
  already_online: boolean; // presence was already online
  wake_joined: boolean;    // joined singleflight wait
  agent_ready: boolean;    // presence === "online" (Relay/harness). lp-vqr0.4
  vault_writable: boolean; // Mountpoint write probe. Independent of presence.
};
```

**501** when orchestrator not injected (Daytona not ready):

```json
{
  "error": "not_implemented",
  "code": "ORCHESTRATOR_NOT_IMPLEMENTED",
  "operation": "ensure_online",
  "instance_id": "<uuid>",
  "message": "…"
}
```

**504** — `wait_timeout_ms` elapsed while still waking (`ENSURE_ONLINE_TIMEOUT`).  
**502** — create/start failed (`ENSURE_ONLINE_WAKE_FAILED`).  
**429** — new wake start rate limited (`ENSURE_ONLINE_RATE_LIMITED`, lp-rq1); singleflight joiners are not throttled.  
**403** — revoked instance or Daytona path gated.  
**404** — unknown `instance_id`.  
**400** — invalid body (extra keys / bad types).

### `POST /internal/tenants/:tenantId/users/:userId/ensure-online` (`lp-oop.19`)

Resolves `instance_id` via `resolveInstanceIdForUser` (user-scope wins; else tenant primary from `getPrimaryActiveInstance`; else **404** `no_instance`). Then calls the same `ensureOnline(instanceId)` wake. Optional 0010 fixtures are injected at the HTTP edge — no `gateway_instances` schema change.

Same request body as instance-scoped ensure-online. **200** is `EnsureOnlineResponse` plus `user_id` and `source` (`user` | `tenant_primary`). **400** empty path ids. **404** neither instance exists. Wake errors reuse 403/429/502/504/501 from the instance-id route.

Semantics (`lp-kng.2.1` + `lp-nus` + `lp-rr5`): match [presence-state-machine.md](./presence-state-machine.md) ensure_online path (singleflight per instance_id). EC2 `runtime_kind` short-circuits to already-online without Daytona. Never uses `sandbox_id` as Relay identity. When Relay presence is injected, **does not** mark online on sandbox Started alone — waits for gateway WSS connected; never-connect kills/recreates once then fails. Policy: [relay-connected-wait.md](./relay-connected-wait.md) (`lp-rr5`).

### `GET …/presence`

**Response 200** (implemented as field read):

```ts
type InstancePresenceResponse = {
  instance_id: string;
  tenant_id: string;
  presence: InstancePresence;
  sandbox_id: string | null;
  runtime_kind: RuntimeKind;
  agent_snapshot_id: string | null;
  s3_vault_prefix: string | null;
  last_activity_at: string | null; // durable on gateway_instances (lp-omt); null until activity/wake
  revoked_at: string | null;
  agent_ready: boolean;    // presence === "online" (lp-vqr0.4)
  vault_writable: boolean; // Mountpoint write probe; file tools may wait
};
```

No secrets. **404** when instance missing.

### `POST …/signal-activity`

**Request** (optional):

```ts
type SignalActivityRequest = {
  at?: string; // ISO datetime; default server now when implemented
  mid_turn?: boolean; // lp-053: arm (true) / clear (false) mid-turn lock; omit = no lock change
};
```

**Response 200** (when implemented):

```ts
type SignalActivityResponse = {
  instance_id: string;
  tenant_id: string;
  presence: InstancePresence;
  last_activity_at: string; // ISO
  mid_turn?: boolean; // lp-053
  mid_turn_until?: string | null; // ISO expiry or null when inactive
};
```

**Implemented (`lp-84f` / `lp-053`):** bumps durable `last_activity_at` via the presence store (no Daytona call). Optional `at` ISO; default server now. Optional `mid_turn` arms/clears the mid-turn lock that blocks idle reaper stop while agent turn/tools are active (default max hold 45 min; see [mid-turn-protection.md](./mid-turn-protection.md)). **404** unknown instance; **403** revoked; **401** without service/ops token when gate configured; **400** invalid body. Used by chat/activity path and idle reaper (`lp-kng.2.2` / `lp-0y3` / `lp-053`).

### `POST …/stop`

**Request** (optional):

```ts
type StopInstanceRequest = {
  reason?: "explicit_stop" | "idle_stop";
};
```

**Response 200** (when implemented):

```ts
type StopInstanceResponse = {
  instance_id: string;
  tenant_id: string;
  presence: InstancePresence; // expected offline
  sandbox_id: string | null;  // retained after stop by default (lp-6bg); null if retain off or sandbox gone
  stopped: boolean;
};
```

**Implemented (`lp-cbv`):** when `instanceOrchestrator` is injected, delegates to `orch.stop` (real harness or live SDK). **404** unknown instance; **403** revoked; without orchestrator → **501** `operation: "stop"`. Idle reaper also calls `orch.stop({ reason: "idle_stop" })` in-process (no HTTP).

Stop clears **ephemeral live compute** only: Daytona stop + presence → `offline`. By default (`lp-6bg`) **retains** `sandbox_id` for start-from-stopped re-wake. Keeps permanent `instance_id` + `s3_vault_prefix` ([identity-model.md](./identity-model.md)). See [warm-pool-snapshot-wake.md](./warm-pool-snapshot-wake.md).

## Service interface (RPC-style)

```ts
type InstanceOrchestratorService = {
  ensureOnline(instanceId, request?): Promise<EnsureOnlineResponse>;
  getPresence(instanceId): Promise<InstancePresenceResponse>;
  signalActivity(instanceId, request?): Promise<SignalActivityResponse>;
  stop(instanceId, request?): Promise<StopInstanceResponse>;
};
```

`createNotImplementedOrchestrator()` throws `OrchestratorNotImplementedError` (maps to 501). Real/fake impls plug in later without changing route paths.

## BFF client stubs

`ControlPlaneAuthClient` methods (compile-time surface for `lp-kng.2.8`):

| Method | HTTP |
|--------|------|
| `ensureOnline(instanceId, body?)` | POST ensure-online |
| `getInstancePresence(instanceId)` | GET presence |
| `signalActivity(instanceId, body?)` | POST signal-activity |
| `stopInstance(instanceId, body?)` | POST stop |

On 501, client throws `ControlPlaneRequestError` with status 501 (callers treat as not-ready / flag off). Types mirror this document.

## BFF chat call site (`lp-y3j` / Phase 5; offline stub `lp-kng.2.8`)

| Item | Value |
|------|--------|
| Route | `POST /api/chat/threads/:threadId/messages` |
| Order | **Before** relay `deliver-inbound` |
| Helper | `portal/packages/bff/src/ensure-online-chat.ts` → `ensureOnlineBeforeChatDeliver` → shared `ensureOnlineIfNeeded` |
| Env flag | `ENSURE_ONLINE_ON_CHAT` — default **off** (`parseEnvFlag`; same truthy forms as `BRAIN_RPC_ENABLED`) |
| Binding | `BffBindings.ensureOnlineOnChat` (tests inject) |
| CP dep | `lp-nus` — singleflight ensure-online with timeout |

**Gates / wake rules (when flag on):**

1. Flag on (`ENSURE_ONLINE_ON_CHAT=1` / binding true).
2. `GET …/presence` returns `runtime_kind === "daytona"` (else presence probe only; no wake).
3. Presence already **`online`** → **skip wake** (no POST ensure-online; proceed to deliver-inbound).
4. Presence **`offline` | `waking` | `error`** → POST ensure-online (cold/warm wake or singleflight join), then deliver-inbound.

If flag off → **no CP calls**. Failures from presence/ensure-online map to **user-visible structured errors** (lp-mrh) — not bare status-only drops.

### Wake failure mapping (`lp-mrh`)

| Item | Value |
|------|--------|
| Doc | **[wake-failure-errors.md](./wake-failure-errors.md)** |
| Mapper | `portal/packages/bff/src/ensure-online-errors.ts` → `mapControlPlaneWakeFailure` |
| Chat body | `{ error, code, message, retryable, retry_guidance, phase: "ensure_online", cp_code? }` |
| No silent drop | On wake fail: **no** `deliver-inbound`; user bubble **is** `appendHistory`'d before kickoff (`lp-v62i.11`); non-2xx so client can retry |
| Codes | `wake_timeout` (504), `daytona_unavailable`, `vault_mount_failed`, `wake_failed` (502), gated/revoked (403), … |

**Offline / offline-piping track:** leave flag **off**. Unit tests use a fake `EnsureOnlineChatClient` (no network, no real Daytona) — `portal/packages/bff/test/ensure-online-chat.test.ts` + `ensure-online-errors.test.ts`.

### Agent starting SSE (`lp-u7z`)

While ensure_online is in flight on chat send, the BFF publishes **live events** on the same SSE connection clients already use for chat (`GET /api/chat/threads/:threadId/events`). Portal UI (`lp-6ty`) shows “Agent starting…” from these frames without looking stuck.

| Item | Value |
|------|--------|
| Publish site | `POST …/messages` during `ensureOnlineBeforeChatDeliverKickoff` (onStarting / ensured / waking / catch) |
| Fan-out | In-process `ThreadLiveEventsHub` (`portal/packages/bff/src/thread-live-events.ts`) |
| Event builders | `portal/packages/bff/src/agent-starting-events.ts` |
| Subscribe site | `GET …/events` — write BFF frames, then proxy normal relay stream |

**Event shapes (SSE `event` name = `type`):**

| `type` | When | Notes |
|--------|------|--------|
| `agent_starting` | Presence offline\|waking\|error and wake POST about to run | `message: "Agent starting…"`, `instance_id`, `thread_id`, `presence` |
| `agent_ready` | ensure_online returned online | Then SSE **transitions to normal relay proxy** (chat tool/message frames) |
| `error` | ensure_online failed | `code`: `ENSURE_ONLINE_TIMEOUT` (HTTP 504), `ENSURE_ONLINE_WAKE_FAILED` (502), or `ENSURE_ONLINE_ERROR`; `status` when known |

**Cold wake:** if the relay event stream is unreachable while `ENSURE_ONLINE_ON_CHAT` is on, the BFF holds the SSE open, surfaces `agent_starting`, waits for `agent_ready` (or `error`), then re-opens the relay proxy.

Chat POST does not wait `wait_timeout_ms` (lp-vqr0.8 / T4, CloudFront origin is 60s). A wake still in flight returns **HTTP 202** `{ status: "agent_starting" }` and finishes ensure_online + deliver on the singleflight. Relay **502/503** `Gateway not connected or handshake incomplete` is the same not-ready state: 202 + retry deliver, not a hard Send failure (even when `ENSURE_ONLINE_ON_CHAT` is off). Instant failures (presence 404, ensure that already rejected, vault mount) still map on the POST (`lp-mrh`). Timeout after detach is an **`error` SSE frame**, not a CloudFront 504 on Send.

**Tests (fake CP + fake relay):** `portal/packages/bff/test/agent-starting-events.test.ts`.

## Brain RPC call site (`lp-kng.2.9` / Phase 5 `lp-7bk`)

| Item | Value |
|------|--------|
| Paths | Production `createRelayBrainRpcInvoker` (vault/settings/projects); `GET /api/brain/ping`; `GET /api/brain/health` |
| Order | **Before** relay `invokeBrainRpc` |
| Helper | `portal/packages/bff/src/ensure-online-brain-rpc.ts` → `ensureOnlineBeforeBrainRpc` (shared core: `ensure-online-hook.ts`) |
| Env flag | `ENSURE_ONLINE_ON_BRAIN_RPC` — default **off** |
| Binding | `BffBindings.ensureOnlineOnBrainRpc` |
| Failure surface (`lp-7bk` / `lp-mrh`) | CP errors are **not** swallowed. Direct routes (`/api/brain/ping`, `/health`) map `ControlPlaneRequestError.status` → HTTP. Production invoker maps via `controlPlaneEnsureOnlineToBackendError` → shared wake table (504→`timeout`, 502 vault/Daytona/wake→`unavailable` + `details.wake_code`, 403→`forbidden`, 404→`not_found`) so vault/settings/projects handlers return JSON errors; invoke never runs after wake fail. |

**Gates:** same as chat (flag + `runtime_kind === "daytona"`). Offline: leave off.

## Channel adapter inbound (`lp-kng.2.9` stub + `lp-e23` deliver path)

| Item | Value |
|------|--------|
| Path | Channel adapter inbound → agent (representative: **Slack** + **email**; same helper for Telegram/etc.) |
| Ensure helper | `portal/packages/bff/src/ensure-online-channel-adapter.ts` → `ensureOnlineBeforeChannelInbound` |
| Deliver compose | `portal/packages/bff/src/channel-adapter-deliver.ts` → `deliverChannelAdapterInbound` |
| Env flag | `ENSURE_ONLINE_ON_CHANNEL_ADAPTER` — default **off** |
| Binding | `BffBindings.ensureOnlineOnChannelAdapter` |
| Order | **resolve tenant primary `instance_id`** → ensure_online (when flag + daytona) → Relay `deliver-inbound` |

**Gates:** same as chat (flag + `runtime_kind === "daytona"`). Offline: leave off. No live Daytona when flag off.

### Identity: no per-channel gateway (`lp-e23`)

Non-Portal channels share the **same** permanent gateway as Portal chat:

| Rule | Detail |
|------|--------|
| One agent per tenant | Adapters resolve `getPrimaryGatewayInstance(tenant_id)` |
| No per-channel identity | Adapter kind (`slack` \| `email` \| …) is **not** used to select compute or Relay auth |
| `instance_id` only | Relay deliver uses that permanent id; never `sandbox_id` as identity ([identity-model.md](./identity-model.md)) |
| Adapter runtime boundary | Full Slack OAuth / email MIME may live outside BFF; they **must** call `deliverChannelAdapterInbound` (or the same order) so cold sandboxes wake before deliver |

```text
Slack webhook / email ingress
        │
        ▼
deliverChannelAdapterInbound(adapter=slack|email, tenant_id, event)
        │
        ├─ CP primary-instance(tenant_id) → instance_id   (same as chat)
        ├─ ensure_online(instance_id) when flag + daytona
        └─ Relay deliver-inbound(instance_id, event)
```

**Tests:** `portal/packages/bff/test/ensure-online-channel-adapter.test.ts` (fake CP + fake relay). Staging/lab proof of a real webhook: `lp-05g`.

## BFF activity signals (`lp-96v`)

Refresh the idle timer from **real platform activity** so sandboxes stay online while the user/agent is busy. Uses CP `POST …/signal-activity` only (presence store write — **no Daytona API**).

| Item | Value |
|------|--------|
| Helper | `portal/packages/bff/src/signal-activity.ts` → `signalActivityIfNeeded` / `signalActivityBestEffort` |
| Env flag | `SIGNAL_ACTIVITY_ENABLED` — default **off** |
| Binding | `BffBindings.signalActivityEnabled` |
| Failures | Best-effort — never fail chat / Brain RPC / SSE if signal-activity errors |

### Listed events

| Source | Call site | Body | Notes |
|--------|-----------|------|--------|
| **message** | `POST /api/chat/threads/:threadId/messages` and spine `sandbox_need=none` before `startTurn` | `{ mid_turn: true }` | Always-arm (lp-k5c4.7); not gated by `SIGNAL_ACTIVITY_ENABLED` |
| **toolbox** | Spine `sandbox_need=toolbox` before `startTurn` | `{ mid_turn: true }` | Always-arm (lp-k5c4.7); not gated by the flag |
| **tool_progress** | `GET …/events` SSE loop when relay event type is `tool_progress` | `{ mid_turn: true }` | **Debounced** (default 30s / instance); flag-gated |
| **brain_rpc** | Production invoker + `/api/brain/ping` + `/health` | `{}` (activity only) | After ensure_online when that flag is also on |

### Not signaled (acceptance: no per-token Daytona/CP storm)

- Streaming **`message_send`** SSE token chunks — do **not** call signal-activity per token.
- Typing / other ephemeral frames.

CP `signal-activity` itself never calls Daytona (`lp-84f`); BFF only POSTs the internal CP route.

**Tests:** `portal/packages/bff/test/signal-activity.test.ts` (fake CP + fake relay).

## Out of scope (later beads)

| Work | Bead |
|------|------|
| ensure_online + singleflight on fake Daytona | `lp-kng.2.1` |
| presence store + activity + idle reaper | `lp-omt`, `lp-kng.2.2`, `lp-0y3` ([idle-reaper.md](./idle-reaper.md)) |
| BFF chat hook behind feature flag | `lp-kng.2.8` |
| brain_rpc + channel adapter stubs behind flag | `lp-kng.2.9` |
| Channel adapter ensure_online + deliver compose | `lp-e23` (this section) |
| Agent starting SSE during wake | `lp-u7z` (this document § Agent starting SSE) |
| Web UI “Agent starting…” | `lp-6ty` |
| Live webhook proof (Slack path or simulated) | `lp-05g` |
| Live Daytona SDK | Phase 4 / `lp-pec` after `lp-kng.1` |

## Acceptance (`lp-biq`)

- [x] Routes or service methods declared (`ORCHESTRATOR_ROUTE_TEMPLATES` + `InstanceOrchestratorService`)
- [x] Request/response shapes documented (this file + zod schemas)
- [x] BFF can compile against client stubs (`ControlPlaneAuthClient` methods)
