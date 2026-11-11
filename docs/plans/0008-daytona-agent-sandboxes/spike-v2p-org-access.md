# Spike notes: `lp-v2p` — Daytona org, API key, tier, and egress

**Bead:** `lp-v2p`  
**Epic:** Phase 0 `lp-6tq` (parent of live Daytona track under `lp-kng`)  
**Date:** 2026-08-04  
**Status:** Complete — API key smoke proven; notes below (no secret values).

Related: human gate [`lp-kng.1`](./issue-map.md) (closed), config schema [cp-daytona-config.md](./cp-daytona-config.md), overview [overview.md](./overview.md).

---

## 1. Org identity (public UUID OK)

| Field | Value |
|-------|--------|
| **Daytona org id** | `5b45bf51-5792-4f75-a54a-ffa6c4752d6e` |
| **Region preference** | US (`DAYTONA_REGION=US`; create `target: "us"`) |
| **Org tier** | **Tier 1** (human-confirmed on `lp-kng.1`) |
| **Billing / budget** | Hard cap **$10 prepaid** — thrifty throwaways only; do not top up without human OK |

Org id also lives in AWS Secrets Manager JSON as `DAYTONA_ORG_ID` (see §3). Do **not** treat org id as a secret; it may appear in dashboard URLs and API headers (`X-Daytona-Organization-ID`).

---

## 2. API surface used for smoke

| Item | Value |
|------|--------|
| **API base** | `https://app.daytona.io/api` |
| **Auth** | `Authorization: Bearer <DAYTONA_API_KEY>` |
| **Org header** | `X-Daytona-Organization-ID: <DAYTONA_ORG_ID>` (sent on smoke; key is org-scoped) |
| **List** | `GET /sandbox` |
| **Create** | `POST /sandbox` |
| **Get** | `GET /sandbox/{id}` |
| **Stop** | `POST /sandbox/{id}/stop` |
| **Delete** | `DELETE /sandbox/{id}` |

Docs: [Sandboxes](https://www.daytona.io/docs/en/sandboxes), [Network limits](https://www.daytona.io/docs/en/network-limits/).

Phase 0 path: **default snapshot** (no custom product image). Create used Daytona default; response snapshot was `daytonaio/sandbox:0.8.0`, class `container`. Product Linux VM / agent image remains Phase 2 (`lp-4xa` / default-snapshot pin docs).

---

## 3. API key storage (name only — never commit values)

| Item | Value |
|------|--------|
| **AWS account** | `123456789012` |
| **Profile / region** | `AWS_PROFILE=lanyard-main`, `us-east-1` |
| **Secrets Manager secret name** | `lanyard/staging/portal/daytona` |
| **ARN shape** | `arn:aws:secretsmanager:us-east-1:123456789012:secret:lanyard/staging/portal/daytona-…` |
| **JSON keys** | `DAYTONA_API_KEY`, `DAYTONA_ORG_ID`, `DAYTONA_REGION` |
| **Audience** | Platform Control Plane / staging secrets only — **never** inject into agent guest or tenant paths |

Key material must never appear in git, bead notes beyond “stored in SM”, PR bodies, or CI logs. Platform convention: [cp-daytona-config.md](./cp-daytona-config.md).

---

## 4. Tier 1 egress / `domainAllowList`

### Documented policy (Daytona)

From [Network limits](https://www.daytona.io/docs/en/network-limits/):

- **Tier 1 & 2:** outbound access is **restricted**; **org-level** policy wins over sandbox-level settings.
- Sandbox-level `domainAllowList` / `networkAllowList` / `networkBlockAll` are set on create/update, **not** via a separate “paste host” dashboard page for custom Relay.
- **Tier 3 & 4:** full internet by default + custom network settings.
- **Essential services** (package registries, git, CDNs, etc.) are available on all tiers; custom hosts such as Relay are **not** in that default set.

### Pilot intent

| Intent | Detail |
|--------|--------|
| Preferred Relay host | `relay.withlanyard.com` (WSS: `wss://relay.withlanyard.com`) |
| Create-time allowlist | `domainAllowList: "relay.withlanyard.com"` on throwaway create |
| Phase 0 decision | Prove sandbox **lifecycle** first; WSS reachability is **`lp-4dk`** (fail-open on basics if Tier 1 still blocks custom host) |

### Smoke observation

Create accepted `domainAllowList: "relay.withlanyard.com"` and returned it on the sandbox object (`networkBlockAll: false`, `networkAllowList: null`). That proves the **API field path** works. It does **not** prove outbound TCP/WSS to Relay under Tier 1 org policy — that remains for the WSS spike.

---

## 5. Smoke evidence (timestamps UTC)

Operator: agent spike for `lp-v2p` against staging SM + Daytona managed API.  
**No long-running sandboxes left unattended.**

| Step | UTC timestamp | HTTP | Notes |
|------|---------------|------|--------|
| List sandboxes | 2026-08-04T13:23:41Z | **200** | Empty list (`count=0`) |
| Create throwaway | 2026-08-04T13:24:04Z | **200** | `target=us`, labels `lanyard_spike=lp-v2p`, `domainAllowList=relay.withlanyard.com`, `autoStopInterval=1`, `autoDeleteInterval=0` |
| Sandbox id | — | — | `086945f1-dadd-4107-9315-a3275cd24614` |
| Create state | — | — | `started`; org id matched SM; snapshot `daytonaio/sandbox:0.8.0`; class `container` |
| Get sandbox | 2026-08-04T13:24:06Z | **200** | Confirmed allowlist + state |
| Stop | 2026-08-04T13:24:06Z | **200** | Ephemeral (`autoDeleteInterval=0`) → auto-delete on stop |
| Delete (explicit) | 2026-08-04T13:24:09Z | **404** | Already gone after stop (expected for ephemeral) |
| List after cleanup | 2026-08-04T13:24:09Z | **200** | `count=0`, id not present |

**Acceptance mapping**

1. **API key works for list/create (+ cleanup):** yes — list 200, create 200, stop 200 / ephemeral delete, final list empty.  
2. **Written notes (this file):** org id, region, Tier 1, egress/`domainAllowList` path, SM **name**, smoke timestamps.  
3. **API key not in git:** verified before commit (`rg` for key material / `dtn_` prefixes in worktree).

---

## 6. Adjacent lab context (not exercised by this bead)

Documented on `lp-kng.1` for later Phase 0 leaves; **not** required for `lp-v2p` acceptance:

| Item | Value |
|------|--------|
| Lab vault URI | `s3://lanyard-mocklab-vault-123456789012/tenants/mocklab/vault/` |
| Relay preferred | `wss://relay.withlanyard.com` (proof: `lp-4dk`) |
| Tenant slug | `mocklab` |
| Product image / custom snapshot | Phase 2 (`lp-4xa`); Phase 0 default snapshot OK |

---

## 7. Residual risks / next

| Risk | Owner / next bead |
|------|-------------------|
| Tier 1 may still block egress to `relay.withlanyard.com` despite sandbox `domainAllowList` | `lp-4dk` WSS proof; escalate tier or org exception if needed |
| Default create used **container** class, not Linux VM | Acceptable for API/org smoke; VM path when product isolation requires it |
| $10 hard cap | Keep spikes thrifty; delete/stop immediately |
| Staging AWS localhost-only hold | Does not block managed Daytona API; blocks re-enabling staging ECS/ALB stacks |

**Unblocks:** `lp-z1u` (image/sandbox class spike) and remaining Phase 0 leaves under `lp-6tq`.

---

## 8. Repro (operators only — no secrets in shell history if avoidable)

```bash
export AWS_PROFILE=lanyard-main AWS_DEFAULT_REGION=us-east-1
# Load DAYTONA_* from SM lanyard/staging/portal/daytona (do not echo key)
# GET  https://app.daytona.io/api/sandbox
# POST https://app.daytona.io/api/sandbox  with target=us + domainAllowList=relay.withlanyard.com
# POST …/sandbox/{id}/stop  and/or DELETE …/sandbox/{id}
```

Prefer ephemeral create (`autoDeleteInterval: 0`) so stop cleans up if delete is skipped.
