# ADR: BFF shared session/state store (G5.1)

| Field | Value |
|-------|--------|
| **Status** | Accepted (design) |
| **Date** | 2026-07-12 |
| **Bead** | `cbd-hhj.8.1` (G5.1) |
| **Parent** | `cbd-hhj.8` — BFF shared state before desired count > 1 |
| **Follow-up** | `cbd-hhj.8.2` — implement + dual-instance staging test |
| **Owner** | Portal product (`@lanyard/bff`) |

## Context

Today the BFF keeps **process-local** maps:

| Store | Code | Scope |
|-------|------|--------|
| Browser sessions | `packages/bff/src/session.ts` → `SessionStore` | Cookie `lanyard_session` → in-memory `Map` |
| Chat threads + hydrate history | `packages/bff/src/chat-store.ts` → `ChatThreadStore` | In-memory `Map`s |
| CSRF | Cookie `lanyard_csrf` | Client cookie only (not in session map) |
| OAuth state | HMAC-signed state (`SESSION_SECRET`) | Stateless |

Horizontal scale (`desired count > 1` behind a load balancer) without sticky sessions **breaks login**: a session created on BFF-A is unknown to BFF-B → spurious 401s. Control-plane identity (users, roles, gateway instances) already uses SQLite and is out of scope for this ADR.

Related but **separate** decisions:

- Chat transcript durability across restart (`artifacts/chat-transcript-durability.md`, portal-c0q.*) — product/privacy choice for on-disk transcripts.
- Control-plane Postgres (G4) — different service and data domain.
- Relay routing bus / shared revocation (G6) — relay scale-out, not BFF sessions.

## Decision

### Store choice: **Amazon ElastiCache for Redis** (or compatible Valkey engine)

**Production backing store for shared BFF session state is Redis** via AWS ElastiCache (Redis OSS or Valkey), Multi-AZ with automatic failover, encryption in transit and at rest, auth token or IAM auth per platform standard.

| Option | Verdict | Rationale |
|--------|---------|-----------|
| **ElastiCache Redis / Valkey** | **Chosen** | Industry-standard session store; TTL-native; low latency; Multi-AZ failover without app-level quorum; fits ephemeral session semantics |
| Amazon MemoryDB | Rejected for v1 sessions | Strong multi-AZ durability and higher cost for data that is intentionally TTL-expiring; re-evaluate if durable shared caches beyond sessions are required |
| DynamoDB | Rejected for v1 | Possible (TTL attribute) but higher p99 latency and more complex session sliding TTL than Redis |
| Shared SQLite / EFS file | Rejected | Poor multi-writer semantics; not appropriate for hot session reads |
| Sticky sessions only | Rejected as sole fix | Hides the problem; task replacement still drops sessions; ops prefer stateless tasks |
| In-process `Map` | **Lab / single-task only** | Default today; allowed when `desired count = 1` (local `pnpm dev`, docker-compose smoke) |

Deploy may introduce a managed Redis module later when product wires the client; this ADR does **not** require MemoryDB or a custom data plane.

### What is shared (v1 scope)

**In scope for G5 shared store:**

1. **Portal browser sessions** (`SessionRecord`) — required for multi-task BFF.
2. Optional later (same Redis, separate key prefix): short-lived server-side rate-limit / login throttle counters if needed.

**Out of scope for G5.1 / not required to share before desired count > 1:**

| Data | Why out of scope |
|------|------------------|
| Chat threads / history | Product may keep process-local or move to BFF-owned SQLite (portal-c0q); multi-instance chat SoT is a follow-on if chat is sticky or externalized |
| Vault FS / Hermes projects | Host/local paths, not BFF cluster state |
| Control-plane tenants/users | Already durable in CP SQLite (G4 path for Postgres) |
| Relay WebSocket sessions | Relay domain (G6) |

**G5 readiness rule:** BFF **desired count may exceed 1 only when** session reads/writes go through the shared store (or an approved equivalent). Chat remaining process-local implies either sticky routing for chat-heavy paths or acceptance that threads are not multi-instance durable until a later bead.

### Session / data model

#### Cookie (unchanged contract)

| Cookie | Flags | Content |
|--------|-------|---------|
| `lanyard_session` | `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/` | Opaque `sessionId` (base64url, 24 random bytes) |
| `lanyard_csrf` | readable by JS, `SameSite=Lax`, `Secure` in prod | CSRF double-submit token (not stored in Redis) |

#### Redis key layout

```text
bff:v1:sess:{sessionId}  →  JSON SessionRecord
```

`SessionRecord` (matches `packages/bff/src/session.ts`):

```json
{
  "sessionId": "…",
  "userId": "…",
  "tenantId": "…",
  "email": "…",
  "createdAt": 1710000000000
}
```

| Concern | Policy |
|---------|--------|
| **Key** | `bff:v1:sess:` + sessionId (no PII in key beyond random id) |
| **Value** | Minimal identity for request auth; **no passwords, no tokens, no vault paths** |
| **TTL** | **Default 7 days** from last touch (sliding): `GET`/`SET` refreshes EXPIRE. Absolute max age **30 days** from `createdAt` (reject and delete if exceeded even if TTL remains) |
| **Logout** | `DEL` key + clear cookie |
| **Tenant binding** | `resolveSessionUser` continues to require `session.tenantId === request tenant` |
| **Serialization** | UTF-8 JSON; no compression in v1 |
| **Auth to Redis** | TLS + AUTH (or IAM); never put Redis password in git |

#### Interface shape (implementation target for G5.2)

Keep `SessionStore` semantics; swap backend:

```ts
interface SessionStore {
  create(input: { userId; tenantId; email }): SessionRecord | Promise<SessionRecord>;
  get(sessionId: string): SessionRecord | null | Promise<SessionRecord | null>;
  delete(sessionId: string): void | Promise<void>;
  clear(): void | Promise<void>; // test / lab only
}
```

Config (illustrative; names may land in G5.2):

| Env | Purpose |
|-----|---------|
| `BFF_SESSION_BACKEND` | `memory` (default local) \| `redis` (required when multi-task) |
| `REDIS_URL` / discrete host+port+TLS | Connection |
| `SESSION_TTL_SECONDS` | Sliding TTL (default `604800` = 7d) |
| `SESSION_MAX_AGE_SECONDS` | Absolute cap (default `2592000` = 30d) |
| `SESSION_SECRET` | Existing; OAuth state HMAC only (not Redis key material) |

### Failure and failover behavior

| Scenario | Behavior |
|----------|----------|
| **Redis healthy** | All BFFs share session view; any task can serve any cookie |
| **ElastiCache Multi-AZ failover** | Brief connection errors; client retries with backoff (e.g. 3 attempts, exp backoff ≤ 500ms). In-flight requests may 503 once; clients retry |
| **Redis unreachable after retries** | **Fail closed for authenticated routes**: treat missing/unreadable session as unauthenticated (401/redirect login). Do **not** fall back to empty in-memory map in production (`BFF_SESSION_BACKEND=redis`) — that would create split-brain sessions |
| **Partial cluster / wrong DB index** | Single logical DB index (e.g. `0`); document in deploy; misconfig is a ship-stopper in staging dual-instance test |
| **Key eviction under memory pressure** | Prefer `allkeys-lru` only if capacity is sized for sessions; **target: size so TTLs expire first**. Evicted session = user re-login (acceptable) |
| **Deploy rolling replace of BFF** | Safe: sessions live in Redis, not on task disk |
| **Logout / force session kill** | `DEL` key; optional future `bff:v1:user:{userId}:sessions` set for admin revoke-all (not required for G5.1) |
| **Clock skew** | TTL is Redis server-side; absolute max age uses BFF wall clock — NTP on tasks required |
| **Lab single process** | `memory` backend; fail-open to empty map on process restart (today’s behavior) |

#### Health / readiness

- Liveness (`/health`): process up; **does not** require Redis (avoid kill loops during brief blips).
- Readiness (when multi-task): optional `/ready` that **PING**s Redis; load balancer should not send traffic to tasks that cannot reach Redis when `BFF_SESSION_BACKEND=redis`.

#### Staging proof (G5.2 acceptance sketch)

1. Two BFF tasks, one Redis, no sticky sessions.
2. Login against task A (or via LB); subsequent API call must succeed on task B with the same cookie.
3. Kill task A; session still valid on task B.
4. Stop Redis; authenticated API fails closed (not silent memory fallback).

**Status (`lp-t7q.8` residual honesty):** Product CI covers the dual-instance sticky-less shape via `packages/bff/test/dual-instance-session.integration.test.ts` (ioredis-mock; optional real `REDIS_URL`). **Live dual-BFF staging** (ECS `desired_count ≥ 2` + managed Valkey + public-edge cookie continuity) remains **open / deferred** while pilots keep Valkey off and single-task BFF — deploy enable path + deferral reasons: `deploy/references/runbooks/portal-valkey-g5-enable.md`. Do **not** claim readiness-matrix **G5 ready** or production multi-instance from the CI substitute or Valkey module alone.

## Consequences

- **Positive:** BFF can scale horizontally for auth; session loss limited to TTL/eviction/logout; aligns with private control-plane boundary (BFF remains public API edge).
- **Negative:** New runtime dependency and secrets (`REDIS_URL`); local dual-instance tests need Redis or testcontainers; ops cost for Multi-AZ cache.
- **Neutral:** Chat multi-instance behavior remains an explicit follow-on; do not claim full sticky-free chat until chat store is shared or sticky is documented.

## Non-goals

- Implementing the Redis client (G5.2).
- Deploy Terraform module design (only if product requires managed infra — parent epic).
- Replacing control-plane SQLite or relay session maps.
- Long-term chat body retention (see G2b + chat durability docs).

## References

- `packages/bff/src/session.ts`, `packages/bff/src/index.ts`
- `artifacts/chat-transcript-durability.md`
- company-brain-deploy readiness: gate **G5** in `references/readiness-matrix.md`
- Related gates: G4 (CP Postgres), G6 (relay scale-out), G8 (thin compute)
