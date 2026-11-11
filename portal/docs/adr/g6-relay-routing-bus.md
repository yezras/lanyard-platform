# ADR: Relay routing bus and shared revocation (G6.1)

| Field | Value |
|-------|--------|
| **Status** | Accepted (design) |
| **Date** | 2026-07-12 |
| **Bead** | `cbd-hhj.9.1` (G6.1) |
| **Parent** | `cbd-hhj.9` — G6: Relay routing bus / shared revocation before scale-out |
| **Follow-up** | `cbd-hhj.9.2` — implement multi-relay routing + shared revocation |
| **Owner** | Portal product (`@lanyard/relay`, `@lanyard/bff`) |

## Context

Today Portal chat and brain delivery assume **one relay process**:

| Path | Behavior |
|------|----------|
| Gateway dial | Customer Hermes dials a single `relay_wss_url` (shared `wss://relay.withlanyard.com` or dedicated host) |
| Session map | Process-local `sessionsByInstance: Map<instanceId, RelaySession>` |
| BFF → relay | Single `RELAY_URL` + `RELAY_INTERNAL_TOKEN` for `deliver-inbound`, interrupt, chat SSE/history, revoke |
| Revoke | `POST /internal/instances/:id/revoke` on **that** process only; marks local `SecretStore` + closes local WS **4401** |
| Secrets | Dev env / in-memory store; production validation path toward control plane (G2) |

**Scale-out problem:** if relay `desired count > 1` behind a load balancer without sticky ownership:

1. Gateway may connect to **relay-A** while BFF `deliver-inbound` hits **relay-B** → **502** “Gateway not connected”.
2. CP revoke + ops call revoke on one task leaves the live socket on another task **alive**.
3. G2a jti replay store and revoked flags stay process-local → **split-brain security**.

Hermes relay contract already describes a connector-side **relay bus** (Redis pub/sub) for multi-instance routing of inbound to the process holding the gateway socket. Portal’s `@lanyard/relay` is the Lanyard connector implementation for `lanyard_web` and must adopt an equivalent product design before multi-task relay is claimed production-ready.

Related:

- **G2** credential lifecycle and G2.3 local force-revoke (prerequisite).
- **G2a** single-use upgrade jti — jti store must be **shared** when multi-relay.
- **G5** BFF Redis sessions — separate key prefix; **same ElastiCache family is preferred** for ops simplicity, not a hard coupling of data models.
- **Relay tier** (`shared` \| `dedicated`) — tenant WSS URL selection already exists in control plane; dedicated may still be multi-task **within** one hostname.

No secrets, account IDs, or customer parameters appear in this document.

## Goals

1. **Correct routing:** BFF (and internal) deliveries reach the relay process that holds the gateway WebSocket for `instance_id`.
2. **Shared revocation:** A revoke decision is visible to **all** relay tasks; live sessions close with **4401** everywhere the instance might be connected.
3. **Honest scale rule:** Relay **desired count may exceed 1 only when** routing bus + shared revoke (+ shared jti if G2a enforced) are enabled.
4. **Preserve single-task lab:** `desired count = 1` / docker-compose keep process-local maps without Redis.

## Non-goals

- Implementing Redis clients or bus code (**G6.2**).
- Changing Hermes frame types for inbound/outbound (routing is connector-internal).
- Multi-region active-active relay (v1 is single-region Multi-AZ).
- Replacing control-plane as credential SoT.
- BFF browser session store (G5) or CP Postgres (G4).

## Decision

### Architecture overview

```text
                    ┌──────────── Control plane ────────────┐
                    │  instance secrets (hash), revoke SoT  │
                    └───────────────┬───────────────────────┘
                                    │ validate / audit
         customer gateway           │
              │ WSS upgrade         │
              ▼                     │
     ┌────────────────┐    ┌───────▼────────┐    ┌────────────────┐
     │  Relay task A  │◄──►│  Redis bus +   │◄──►│  Relay task B  │
     │  (holds WS for │    │  registry +    │    │  (no local WS  │
     │   instance X)  │    │  revoke/jti    │    │   for X)       │
     └───────▲────────┘    └───────▲────────┘    └────────────────┘
             │                     │
             │         pub/sub + keyspace
             │                     │
     ┌───────┴─────────────────────┴────────┐
     │  BFF (N tasks)  RELAY_URL = internal │
     │  LB or service discovery → any relay │
     │  deliver-inbound / interrupt / SSE     │
     └──────────────────────────────────────┘
```

**Chosen backbone: Amazon ElastiCache for Redis** (Redis OSS or Valkey), Multi-AZ, TLS + AUTH/IAM — same platform preference as G5.1.

| Option | Verdict | Rationale |
|--------|---------|-----------|
| **Redis pub/sub + key registry** | **Chosen** | Matches Hermes contract mental model; low-latency fan-out; TTL leases; shared revoke/jti sets |
| Sticky LB only | Rejected as sole fix | Task replacement drops affinity; revoke still must fan out; BFF would need stickiness too |
| Always HTTP hop via service mesh sticky | Rejected as sole fix | Needs ownership registry anyway; mesh alone does not close remote sockets on revoke |
| DynamoDB streams / SQS only | Rejected for v1 hot path | Higher latency for chat deliver; fine as future audit sink |
| Process-local only | **Lab / single-task only** | Default today |

### Identity of a relay node

Each relay task boots with:

| Field | Source |
|-------|--------|
| `relay_node_id` | Stable for process lifetime (UUID or `TASK_ARN` hash) |
| `relay_advertise_url` | Internal base URL other tasks/BFF can HTTP-call (service discovery DNS + port) |
| `RELAY_CLUSTER_MODE` | `single` (default) \| `bus` (required when desired count > 1) |

### 1. How requests route to the correct relay / tenant

#### Tenant → WSS (unchanged product rule)

| Tenant `relay_tier` | Gateway dial URL |
|---------------------|------------------|
| `shared` | Platform shared hostname (e.g. `wss://relay.withlanyard.com/relay`) → NLB → **any** shared relay task |
| `dedicated` | Per-tenant hostname (`wss://relay-<slug>.…`) → that tenant’s relay service (may still be multi-task **within** the dedicated service) |

Control plane continues to return `relay_wss_url` at register time. **Routing bus does not change gateway dial URLs**; it fixes **which process** owns the session after connect.

#### Instance ownership registry (Redis)

On successful `hello` / handshake complete for `instance_id`:

```text
SET relay:v1:owner:{instance_id}  { "node_id","advertise_url","tenant_id","connected_at" }
    EX <lease_seconds>            # e.g. 30s
```

- Owning task **refreshes lease** on a heartbeat interval (e.g. every 10s) while the WS is up.
- On clean close: `DEL` owner key if value still this `node_id` (compare-and-delete).
- On crash: lease expires → instance appears offline until gateway redials (normal reconnect).

Optional secondary index for ops:

```text
SADD relay:v1:node:{node_id}:instances  {instance_id}
```

#### BFF / internal deliver path

BFF may continue to call a **single logical** `RELAY_URL` (service name load-balanced across tasks). Any task receiving `POST /internal/deliver-inbound` (or interrupt):

1. Look up local session for `instance_id`.
2. **If local hit** → deliver on WS (today’s path).
3. **If local miss** → `GET` Redis owner key:
   - **Owner is this node but no session** → treat as not connected (race); **502**.
   - **Owner is another node** → either:
     - **Preferred v1:** publish on **routing bus** channel (below), **or**
     - **Alternative v1:** HTTP forward to `advertise_url` `/internal/deliver-inbound` with internal token + hop header `x-relay-forwarded: 1` (prevent loops).
   - **No owner** → **502** gateway not connected.

**Chosen v1 delivery mechanism: Redis pub/sub bus** (HTTP forward optional optimization later).

##### Bus channels

| Channel | Payload (metadata; no vault bodies in logs) | Consumers |
|---------|-----------------------------------------------|-----------|
| `relay:v1:bus:deliver` | `{ instance_id, tenant_id, event, buffer_id?, reply_to? }` | All relay tasks; only owner delivers |
| `relay:v1:bus:interrupt` | `{ instance_id, session_key, chat_id }` | Same |
| `relay:v1:bus:revoke` | `{ instance_id, reason, at }` | All tasks close local session + mark revoked |

Publisher is the relay task that accepted the BFF HTTP call (or the BFF itself only if we later give BFF bus credentials — **v1: BFF stays HTTP-only to relay** to avoid expanding Redis IAM to BFF for chat hot path).

##### Chat SSE / history

Outbound chat events are produced on the **owner** task’s `ChatDeliveryHub`. For multi-task BFF reading SSE:

| Approach | Verdict |
|----------|---------|
| **A. SSE only on owner; BFF discovers owner via Redis and dials that `advertise_url`** | **Chosen for v1** — minimal change to hub (still process-local ring buffer) |
| B. Replicate all outbound events on bus to every task | Rejected for v1 — bandwidth + complexity |
| C. Move chat hub to Redis streams | Future; not required to clear G6 gate if A works |

BFF changes (G6.2 sketch):

1. Resolve `instance_id` (existing primary-instance CP call).
2. For **deliver/interrupt**: HTTP to cluster service URL (any task) — receiver uses bus/local.
3. For **SSE/history**: `GET` owner from relay helper endpoint or Redis-through-relay:
   - e.g. `GET /internal/instances/:id/owner` on any task → `{ node_id, advertise_url | null }`
   - Open SSE against `advertise_url` when non-null; if null, empty/reconnect.

#### Tenant isolation

- Bus payloads always carry `tenant_id` + `instance_id`.
- Owner registry values include `tenant_id`; deliver path rejects mismatch if BFF supplies tenant (defense in depth).
- Dedicated tier isolation remains **network/hostname** isolation; shared tier relies on instance credentials + tenant checks (G1a).

### 2. How revoke propagates to all instances

Revoke remains **control-plane authoritative** for credential validity. Live socket kill must reach every relay task.

#### Sequence (production)

```text
1. Operator/automation: POST CP /tenants/:id/instances/:instanceId/revoke
   (or deprovision → all instance ids)
2. Automation: ensure shared revoke marker (below) + bus fan-out
3. Every relay task: mark secret revoked locally + close WS 4401
4. Delete/disable host secret in SSM/SM (deploy runbook)
```

#### Shared revoke marker (Redis)

```text
SET relay:v1:revoked:{instance_id}  { "revoked_at", "reason" }  EX <retention>
# e.g. retention 7d — long enough for delayed reconnects; CP remains SoT
```

| Reader | Behavior |
|--------|----------|
| **Upgrade auth** | If revoked key present → reject upgrade (even if local secret cache stale) |
| **Validate path** | Still prefer CP validate when configured; revoked key is a fast fail-closed cache |
| **revokeInstance** | Sets revoked key + `PUBLISH relay:v1:bus:revoke` + local close |

#### Fan-out

1. **Pub/sub `revoke` message** — low-latency close of live sockets on all nodes (including owner).
2. **Redis key** — durability across brief pub/sub misses and for nodes that start after revoke.
3. **Idempotent local close** — multiple revoke messages safe; `sessions_closed` may be 0 on non-owners.

#### Who writes the revoke marker?

| Writer | v1 recommendation |
|--------|-------------------|
| Relay internal revoke handler | **Yes** — same API as today (`POST /internal/instances/:id/revoke`); handler writes Redis + publish + local close |
| Control plane direct to Redis | **No** for v1 — keeps Redis credentials off CP; CP stays credential SoT only |
| BFF | May call relay revoke API after CP (automation); does not speak Redis |

Ops may hit **any** relay task’s revoke endpoint; that task is responsible for cluster-wide effect.

#### Interaction with G2a jti

```text
relay:v1:jti:{jti}   # shared when RELAY_CLUSTER_MODE=bus
```

Same Redis; different prefix. Documented in [g2a-relay-replay-resistance.md](./g2a-relay-replay-resistance.md).

### 3. Consistency model

| Data | Model | Notes |
|------|-------|-------|
| **Credential validity (CP)** | Strong SoT (SQLite/Postgres) | Register/rotate/revoke transactions |
| **Revoke marker (Redis)** | **Write-through on revoke path**; eventual w.r.t. CP if automation skips relay call | Production checklist: CP revoke **and** relay revoke (existing G2.4 doctrine) |
| **Owner lease** | **Ephemeral, soft state**, TTL ~30s with refresh | After crash, instance “offline” until reconnect; no split owners if `SET` includes node fencing (see below) |
| **Bus deliver** | **At-most-once** for v1 (or at-least-once with gateway/BFF retry) | Chat already tolerates retry at BFF; do not require full exactly-once bus |
| **jti single-use** | **Strong within Redis** via `SET NX` | Concurrent replay → one winner |
| **Chat hub history** | **Owner-local** until moved | History/SSE stick to owner URL |

#### Ownership fencing

When registering owner:

```text
SET relay:v1:owner:{id} <json> EX 30
# optional: use Lua to only overwrite if missing or same node_id or lease expired
```

If two gateways connect with the same instance secret (should not happen after G2a exclusivity):

1. New upgrade on node B succeeds only if jti is fresh and secret valid.
2. Session exclusivity: node B claims owner key; publishes `revoke/replaced` for prior; node A closes local socket when it sees lost ownership or receives replaced event.
3. **Last successful upgrade wins**; CP revoke still kills both.

#### Failure modes

| Scenario | Behavior |
|----------|----------|
| Redis healthy | Owner lookup + bus + revoke shared |
| Redis blip | Local deliver still works for sessions on the HTTP-hit node; cross-node deliver may 503; retries |
| Redis down, `RELAY_CLUSTER_MODE=bus` | **Fail closed for cross-node operations**; readiness fails; do **not** silently pretend single-node global view |
| Redis down, `single` mode | Process-local only (today) |
| Pub/sub message lost | Revoke **key** still blocks reconnect; live socket might linger until lease/heartbeat or repeat revoke — mitigate with periodic owner/revoked reconcile loop (e.g. every 5s scan local sessions vs revoked keys) |
| Split brain two owners | Prevent via atomic owner set + exclusivity events; accept rare race window bounded by lease TTL |
| BFF scales independently | OK — BFF is stateless w.r.t. gateway WS; uses HTTP + owner lookup for SSE |

#### Health / readiness

| Endpoint | `single` | `bus` |
|----------|----------|-------|
| `GET /health` liveness | Process up | Process up (no Redis required) |
| `GET /ready` readiness | Always ready if listening | **PING Redis** required; fail if bus mode cannot reach Redis |

Load balancer should not send gateway upgrades or internal traffic to unready tasks.

### Staging multi-relay proof (G6.2 acceptance sketch)

1. Two relay tasks, one Redis, one BFF (or two), **no** sticky requirement for deliver.
2. Gateway connects (lands on task A). BFF `deliver-inbound` via LB hits task B → message still delivered on A’s WS.
3. Interrupt and chat SSE work (SSE via owner advertise URL).
4. Revoke via task B while session on A → socket on A closes **4401**; reconnect rejected; both tasks show revoked.
5. Kill task A → owner lease expires; gateway reconnects to task B; deliver works again.
6. (With G2a) Replay upgrade token on the other task after first use → rejected.

## Consequences

### Positive

- Unblocks relay horizontal scale for shared and dedicated services.
- Shared revoke closes the G2.3 gap in multi-task deployments.
- Aligns Portal with Hermes contract “relay bus” language.
- Reuses platform Redis investment from G5 (ops familiarity).

### Negative

- New hard dependency for multi-task relay (Redis).
- BFF SSE path becomes slightly smarter (owner lookup).
- More failure modes to document and test.
- Cross-node deliver adds hop latency (usually sub-ms in AZ + Redis).

### Neutral

- Single-task docker-compose unchanged.
- Dedicated per-tenant hostnames remain a **placement** control, not a substitute for in-service bus when that service scales.

## Implementation sketch (G6.2)

1. Introduce `RelayCluster` module: owner registry, bus publish/subscribe, revoked set, shared jti adapter.
2. Wire `RelaySessionServer` connect/close/revoke/deliver through cluster hooks.
3. Add `GET /internal/instances/:id/owner` and readiness `/ready`.
4. BFF: owner-aware SSE/history base URL; keep deliver against service URL.
5. Config: `RELAY_CLUSTER_MODE`, `REDIS_URL`, `RELAY_NODE_ID`, `RELAY_ADVERTISE_URL`, lease TTLs.
6. Integration tests with Redis testcontainer or miniredis: two logical nodes in one process test harness.

## References

- `packages/relay/src/relay-session-server.ts`, `internal-http.ts`, `secret-store.ts`
- `packages/bff/src/relay-client.ts`, `packages/bff/src/config.ts` (`RELAY_URL`)
- `packages/control-plane/src/relay-tier.ts` — tenant WSS resolution
- Hermes contract multi-instance routing note: `docs/relay-connector-contract.md` (inbound transport / relay bus)
- G2a ADR: [`g2a-relay-replay-resistance.md`](./g2a-relay-replay-resistance.md)
- G5 ADR: `docs/adr/g5-bff-shared-state.md` (when merged) — Redis platform choice
- G2.3/G2.4: force-revoke 4401 + credential lifecycle runbook
- company-brain-deploy readiness matrix gate **G6**
