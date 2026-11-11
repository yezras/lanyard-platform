# Relay connected wait after sandbox start (`lp-rr5`)

**Bead:** `lp-rr5`  
**Parent:** `lp-pec` (Phase 4 Instance Orchestrator)  
**Depends on:** `lp-nus` (ensure_online singleflight + timeout)  
**Code:** `portal/packages/control-plane/src/relay-presence.ts`, `instance-orchestrator.ts`  
**Tests:** `portal/packages/control-plane/test/ensure-online-relay.test.ts`  
**Related:** [presence-state-machine.md](./presence-state-machine.md), [identity-model.md](./identity-model.md), [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md)

## Purpose

`ensure_online` must not treat **Daytona sandbox `started`** as product **online**.

Product online means the gateway process for permanent `instance_id` has dialed Relay and completed WSS handshake, so BFF/adapters can deliver chat / Brain RPC without immediate 502/503.

Sandbox start alone is insufficient: vault mount, gateway boot, or Relay dial can still fail after Daytona reports Started.

## Wake sequence (daytona path)

```text
offline|error
  → presence waking (singleflight)
  → Daytona create (cold) or start (warm bound sandbox_id)
  → sandbox state Started
  → wait Relay isConnected(instance_id)     ← lp-rr5
  → presence online + bind sandbox_id + last_activity_at
```

Identity rules unchanged:

- Relay identity = **`instance_id`** (never `sandbox_id`)
- `sandbox_id` is ephemeral compute handle only

EC2 `runtime_kind` still short-circuits without Daytona or Relay wait.

## Relay presence port

| Export | Role |
|--------|------|
| `RelayPresence` | `{ isConnected(instanceId): Promise<boolean> }` |
| `FakeRelayPresence` | Unit tests; mark connect / connectAfterMs / connectAfterPolls |
| `createHttpRelayPresence` | Live: `GET {RELAY}/internal/instances/:id/owner` → `connected` |
| `waitForRelayConnected` | Poll until true or per-attempt timeout |

Live owner endpoint is the same surface BFF uses for stickiness (`portal/packages/relay` internal HTTP). No secrets in the response; CP sends `x-relay-internal-token` only.

### Orchestrator deps

| Dep | Default | Notes |
|-----|---------|--------|
| `relayPresence` | `null` (skip wait) | **Production pilot:** inject HTTP adapter. Pure real harness unit tests may omit. |
| `relayConnectTimeoutMs` | `45_000` | Per connect-wait attempt after Started |
| `relayConnectPollIntervalMs` | `250` | Poll interval |

Overall caller bound remains `wait_timeout_ms` / `DEFAULT_ENSURE_ONLINE_WAIT_TIMEOUT_MS` (outer singleflight race → `EnsureOnlineTimeoutError` + presence `error`).

## Timeout policy: kill / recreate once then fail

**Normative policy for never-connect after Started:**

1. **First wait** — poll Relay up to `relayConnectTimeoutMs`.
2. If **connected** → promote presence `online` (CAS waking→online).
3. If **not connected** (or hard poll errors exhausted):
   - **Kill** current sandbox (best-effort Daytona `stop`).
   - **Recreate once** — cold create + start (new `sandbox_id`; do not warm-start the failed handle).
   - **Second wait** — poll again up to `relayConnectTimeoutMs`.
4. If **connected** on second wait → online with the new sandbox.
5. If **still not connected** → presence `error` (`wake_failed`), throw `EnsureOnlineWakeError` with message indicating never-connect after recreate.

Constants:

- `RELAY_CONNECT_RECREATE_ATTEMPTS = 1` (one recreate; two wait attempts total)
- Do **not** loop forever; do **not** recreate more than once per wake leader

Rationale:

- A single bad guest boot / hung process is common; one recreate is cheap relative to leaving a zombie Started sandbox.
- Repeated recreate burns Daytona quota and can mask permanent misconfig (bad secret inject, Relay DNS, snapshot entrypoint).
- Outer `wait_timeout_ms` still protects the BFF/caller from hanging; singleflight detach-on-timeout behavior from `lp-nus` is unchanged.

### Interaction with outer `wait_timeout_ms`

| Event | Behavior |
|-------|----------|
| Caller `wait_timeout_ms` elapses while still waking | `EnsureOnlineTimeoutError`; CAS waking→error; inflight detached |
| Never-connect policy completes before outer timeout | `EnsureOnlineWakeError`; presence error |
| Relay blip on one poll | Soft-fail; continue polling until attempt deadline |

## Injection (CP server)

When managed Daytona is enabled+ready, inject `createHttpRelayPresence` when:

- `RELAY_INTERNAL_URL` (HTTP base, e.g. `http://relay:8787`) and
- `RELAY_INTERNAL_TOKEN`

are set. If unset, orchestrator still wakes sandboxes but **skips** Relay wait (same as omit `relayPresence`) — log-safe note at boot; dual-run / chat prove should set both.

WSS URL for the **guest** remains `GATEWAY_RELAY_URL` / shared pool (`SHARED_RELAY_WSS_URL`); that is not the CP poll URL.

## Out of scope

- Injecting `GATEWAY_RELAY_SECRET` into create env (separate wake-inject beads)
- Live Relay DNS restore (`lp-kng.3`)
- ~~Metrics for wake latency / connect fail counts (`lp-77d`)~~ — [sandbox-orchestrator-metrics.md](./sandbox-orchestrator-metrics.md)
- ~~Full failure-mode matrix suite (`lp-2tz`)~~ — `portal/packages/control-plane/test/ensure-online-failure-modes.test.ts` (API down, start timeout, never-connect, concurrent wake, vault mount fail closed)

## Acceptance (`lp-rr5`)

- [x] Does not mark online on sandbox start alone (when `relayPresence` injected)
- [x] Timeout path kills/recreates once then fails (policy documented here + unit tests)
- [x] Tests with fake relay (`ensure-online-relay.test.ts`)
