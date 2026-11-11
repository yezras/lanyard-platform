# ADR: Relay auth replay resistance (G2a.1)

| Field | Value |
|-------|--------|
| **Status** | Accepted (design) |
| **Date** | 2026-07-12 |
| **Bead** | `cbd-hhj.4.1` (G2a.1) |
| **Parent** | `cbd-hhj.4` — G2a: Replay resistance for relay auth material |
| **Follow-up** | `cbd-hhj.4.2` — implement + test replay rejection |
| **Owner** | Portal product (`@lanyard/relay` + Hermes gateway dialer) |

## Context

Customer Hermes gateways dial **out** to the Portal relay WebSocket (`/relay`) and present an upgrade bearer derived from a **long-lived per-instance secret** (G2 register / rotate / revoke). Today:

| Layer | Behavior | Code |
|-------|----------|------|
| Token mint | `base64url(gatewayId:exp:sig)` with `sig = HMAC_SHA256(gatewayId:exp, secret).hex`, default `exp` = now+**300s** | `packages/relay/src/auth.ts` · Hermes `gateway/relay/auth.py` |
| Upgrade check | Peek `gatewayId` → load secrets → verify HMAC + expiry | `relay-session-server.ts` `authenticateUpgrade` |
| Live kill | Process-local `revokeInstance` → close **4401** | G2.3 `POST /internal/instances/:id/revoke` |
| Long-lived secret SoT | Control plane hashes only; host holds plaintext (SSM/SM) | G2.1–G2.4 |

**What is already true:**

1. Tokens are **short-lived** (default 5 minutes) when gateways mint with the default TTL.
2. Revoked secrets and force-close of live sockets are covered by **G2** lifecycle + G2.3.
3. Inbound frames ride the already-authenticated socket (no per-message WS signature).

**What is not true today:**

1. A captured **valid** upgrade bearer can be **replayed** for a second (or Nth) WebSocket upgrade until `exp`.
2. There is no **jti/nonce** or single-use semantics on the token.
3. Opening a second connection for the same `instance_id` does **not** force-close the first socket (the session map is overwritten; the prior WS may linger).
4. Multi-relay (G6) would make process-local “seen token” sets insufficient unless shared.

Related decisions (out of scope for this ADR’s implementation):

- **G2** credential lifecycle — stolen **long-lived secret** (not just a token).
- **G6** multi-relay routing / shared revocation — scale-out of session ownership and revoke fan-out; **shared jti cache** when `desired count > 1`.
- **G5** BFF Redis sessions — different service domain; may share the same ElastiCache cluster with a distinct key prefix.

No secrets, account IDs, or customer parameters appear in this document.

## Threat model

### Assets

| Asset | Sensitivity |
|-------|-------------|
| Long-lived instance secret (`GATEWAY_RELAY_SECRET`) | Critical — mints unlimited upgrade tokens until rotated/revoked |
| Upgrade bearer token | High — grants a new gateway WS as that `gatewayId` until expiry |
| Live authenticated WS | High — receives inbound chat/brain frames for the bound instance |
| `RELAY_INTERNAL_TOKEN` | Critical for ops path; **not** customer gateway auth (separate threat) |

### Adversaries and threats

| ID | Threat | Preconditions | Impact without G2a control |
|----|--------|---------------|----------------------------|
| **T1** | **Replay stolen upgrade token** | Attacker sniffs `Authorization: Bearer` (proxy log, compromised edge, mis-set query `?token=` in lab) within TTL | Open second gateway session; race or shadow the legitimate gateway; receive/steal inbound deliveries if routing prefers the attacker’s socket |
| **T2** | **Reuse same token after reconnect** | Legitimate or attacker reconnects with the exact same bearer | Multiple concurrent upgrades from one mint; weak audit attribution |
| **T3** | **Stolen long-lived secret** | Host compromise, SSM read by wrong principal, show-once leak | Attacker mints **fresh** tokens forever until G2 rotate/revoke — **not fully solved by G2a** |
| **T4** | **Token with `exp=0` (non-expiring)** | Misconfigured mint with `ttlSeconds=0` | Indefinite replay window if accepted |
| **T5** | **Cross-relay replay (scale-out)** | Multi-task relay; jti store process-local only | Replay to another task that has not seen the jti |

### Explicit non-threats (this ADR)

- Browser session cookie theft → **G5 / BFF auth**, not relay upgrade.
- Forging tokens without secret or valid HMAC → already rejected.
- Post-revoke live sockets without G2.3 call → **G2.3 / G6 shared revoke**, not G2a.
- Vault / chat body confidentiality at rest → **G2b**.

### Security goals

1. **Replay rejection:** A given upgrade token succeeds at most **once** (cluster-wide when multi-relay).
2. **Bounded window:** Even without replay cache hit, tokens expire quickly; non-expiring upgrade tokens are **rejected in production**.
3. **Session exclusivity:** At most one **live** gateway WS per `instance_id` on the ownership plane (new auth wins → old closed **4401**).
4. **Honest layering:** Stolen long-lived secret still requires **G2 rotate + revoke + 4401**; G2a does not replace lifecycle.
5. **Hermes wire compatibility path:** Additive token field with versioned verify; dual-accept during rollout.

## Options considered

| Option | Summary | Verdict |
|--------|---------|---------|
| **A. Short-lived tokens only (status quo)** | Keep 300s TTL; no jti | **Insufficient** — T1/T2 remain for full TTL |
| **B. Single-use jti/nonce in upgrade token** | Embed random `jti`; relay stores used jtis until `exp` | **Chosen (primary)** |
| **C. Session exclusivity only** | One WS per instance; no jti | Useful complement; alone does not stop attacker replacing the legit session with a replayed token |
| **D. Challenge–response after TCP/WS** | Relay sends nonce; gateway signs | Strong; more RTT + larger Hermes change; defer as optional hard mode |
| **E. mTLS (gateway client certs)** | Identity = cert; short or no HMAC bearer | High ops cost (issuance, rotation, customer hosts); not v1 primary |
| **F. Completely short-lived secret (OAuth-style refresh)** | No long-lived host secret | Larger product/deploy change; overlaps G2; not required for G2a gate |

## Decision

### Primary control: **single-use upgrade tokens (jti / nonce) + mandatory short TTL**

**Chosen control for G2a:** bind each WebSocket upgrade attempt to a **cryptographically random jti** included in the signed token material. The relay (and shared store when multi-relay) records jtis that have successfully authenticated and **rejects any second use** until natural expiry.

#### Token format (target wire)

Current (v1):

```text
token = base64url( `${gatewayId}:${exp}:${sig}` )
sig   = HMAC_SHA256( `${gatewayId}:${exp}`, secret ).hex
```

Target (v1j — additive, still contract family v1 with capability flag):

```text
token = base64url( `${gatewayId}:${exp}:${jti}:${sig}` )
sig   = HMAC_SHA256( `${gatewayId}:${exp}:${jti}`, secret ).hex
jti   = base64url( 16+ random bytes )   # ≥128 bits entropy
exp   = unix seconds, required, 0 < (exp - now) ≤ MAX_UPGRADE_TTL
```

| Rule | Value |
|------|--------|
| **Default TTL** | **60s** recommended for production mint (Hermes default may stay 300s during dual-accept; relay max accept **300s**) |
| **Max accepted TTL** | **300s** (`exp - now` clamped; reject if `exp == 0` in production) |
| **jti uniqueness** | Gateway MUST mint a fresh jti per dial/reconnect |
| **Replay store TTL** | Retain jti until `exp` (+ small skew, e.g. 30s) then drop |
| **Production `exp=0`** | **Reject** (fail closed) |
| **Lab** | May allow legacy tokens without jti when `RELAY_ALLOW_LEGACY_UPGRADE_TOKEN=1` (default on for local/dev only) |

#### Verify algorithm (relay)

1. Decode bearer; parse `gatewayId`, `exp`, optional `jti`, `sig`.
2. Reject if expired, `exp==0` (prod), or TTL > max.
3. Resolve secret list for `gatewayId` (primary + rotation grace secrets); reject if missing/revoked.
4. Verify HMAC over the signed material matching the token shape (with-jti or legacy if allowed).
5. **If jti present (required in prod):** `SET jti key NX` with TTL → if key exists, **replay → reject** (401 upgrade / no accept).
6. On success: accept WS; apply **session exclusivity** (below).

#### jti store

| Mode | Backend | Key layout |
|------|---------|------------|
| Single-task / lab | In-process `Map` + timer or lazy expiry | `jti → exp` |
| Multi-relay (G6) | **Shared Redis** (same cluster family as G5 is fine) | `relay:v1:jti:{jti}` → `1` with `EXAT`/`EX` to `exp` |

**Atomicity:** use `SET key value NX EX …` (or equivalent) so two concurrent upgrades with the same token cannot both succeed.

### Complementary control: **session exclusivity (connection binding)**

On successful upgrade for `instance_id`:

1. If a live session already exists for that `instance_id` on this process (or is owned here per G6 registry), **close the previous socket with 4401** reason `replaced` (or `revoked` if revoke path).
2. Register the new session as the sole owner for inbound delivery.

This is **session binding** in the sense that the authenticated channel is bound to one live connection identity; it does **not** replace jti (an attacker with a replayed token could still **steal** the slot — jti stops the second use of that token; exclusivity limits concurrency from multiple mints).

### Explicitly not chosen as primary (v1)

| Control | Why not primary |
|---------|-----------------|
| mTLS | Customer host PKI and rotation burden; deploy-heavy; can layer later for Tier-3 dedicated relays |
| Challenge–response | Extra handshake frame; larger Hermes delta; jti on existing bearer is smaller change |
| Short TTL alone | Does not meet “replay resistance” acceptance while token remains valid |

### Layering with G2 (stolen secret)

| Scenario | Controls |
|----------|----------|
| Stolen **token** only | **G2a** jti single-use + short TTL + exclusivity |
| Stolen **long-lived secret** | **G2** rotate (grace) / revoke + **G2.3/G6** force 4401 + SSM delete; G2a only limits each minted token to one use |
| Compromised host still online | Operator revoke + replace secret; consider network allowlists (deploy) as defense-in-depth |

## Rollout (implementation sketch for G2a.2)

1. **Relay accept path:** parse optional jti; enforce prod rules; pluggable `JtiStore` (`memory` \| `redis`).
2. **Hermes `make_upgrade_token`:** add jti to signed material (Lanyard fork + upstream coordination).
3. **Dual-accept window:** relay accepts legacy (no jti) **only** when env allows; staging/prod disable legacy after gateways upgraded.
4. **Tests:** unit + integration — same token twice → second rejected; expired rejected; `exp=0` rejected in prod mode; concurrent double-use only one wins.
5. **Metrics/audit (metadata only):** counters for `upgrade_replay_rejected`, `upgrade_legacy_accepted`; no token/secret plaintext in logs (G2b).

### Staging / proof (G2a.2 acceptance sketch)

1. Mint token with jti; first WS upgrade succeeds; second upgrade with **identical** bearer fails.
2. Two different jtis under same secret both succeed sequentially (with exclusivity closing the first).
3. After CP revoke + relay revoke, upgrades fail and live socket gets **4401** (existing G2.3).
4. (G6) Two relay tasks sharing Redis jti store: replay on task B after success on task A fails.

## Consequences

### Positive

- Clear product answer for readiness gate **G2a**: replay of captured upgrade material is rejected.
- Minimal conceptual change to existing HMAC scheme; aligns with industry “jti” practice (JWT-like).
- Composes with G6 shared Redis without inventing a second cache product.
- Complements G2 lifecycle instead of pretending tokens replace secret management.

### Negative

- **Wire change** requires Hermes gateway mint update and staged dual-accept.
- jti store memory/Redis cost (small; TTL-bound).
- Attackers with the **long-lived secret** still mint new single-use tokens until revoke — operators must keep G2 runbooks sharp.

### Neutral / follow-ons

- Optional challenge–response or mTLS for high-assurance tiers remains open.
- Query-string `?token=` remains **lab-only** (`allowQueryToken`); production should header-only (tokens in URLs increase T1 risk via logs).

## Non-goals

- Implementing the jti store or Hermes mint change (**G2a.2**).
- Multi-relay bus design (**G6.1** / this repo sibling ADR).
- Changing control-plane secret hashing or show-once register API.
- mTLS issuance in company-brain-deploy.

## References

- `packages/relay/src/auth.ts`, `packages/relay/src/relay-session-server.ts`
- Hermes: `gateway/relay/auth.py`, `docs/relay-connector-contract.md` §6.1
- G2 runbook: `docs/runbooks/relay-credential-lifecycle.md` (when merged) / control-plane + relay package READMEs
- G6 design: [`g6-relay-routing-bus.md`](./g6-relay-routing-bus.md)
- company-brain-deploy readiness matrix gate **G2a**
