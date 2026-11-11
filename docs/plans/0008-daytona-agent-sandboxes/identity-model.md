# Identity model: `instance_id` vs `sandbox_id` vs S3 vault prefix

**Plan section:** §2.3 (normative for Phase 1 contracts)  
**Bead:** `lp-707`  
**Parent:** `lp-e0j` (Phase 1) under offline piping `lp-kng.2`  
**Related:** [overview.md](./overview.md) (§4.3 guest/prebake, §4.11 deploy split), [offline-piping.md](./offline-piping.md)  
**Follow-ons:** `lp-nye` (CP fields), [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) (`lp-kng.2.4`), `lp-vey` (gateway env contract)  
**Multi-scope extension:** plan [0010](../0010-multi-scope-sandbox-vault/overview.md) · decision [`lp-zoh.1`](../0010-multi-scope-sandbox-vault/decision-identity-and-vault-scope.md) · epic `lp-zoh`

## Purpose

Three different identifiers appear when agent compute moves from always-on EC2 to on-demand Daytona sandboxes. They must **not** be conflated:

1. **Permanent product identity** used for Relay auth and Brain RPC routing (`instance_id`)
2. **Ephemeral compute handle** owned by Daytona and tracked by the CP orchestrator (`sandbox_id`)
3. **Durable vault storage location** outside the image (`s3_vault_prefix` / S3 Mountpoint path)

This doc is the offline design anchor for model fields, provision, wake, and IAM layout. No live AWS or Daytona resources are required to accept this document.

## One-line rules

| Identifier | One-line rule |
|------------|---------------|
| `instance_id` | Permanent gateway credential identity in Control Plane; **survives** stop/start/recreate of compute. |
| `sandbox_id` | Ephemeral Daytona sandbox/VM handle for **this** wake cycle; may be null when offline; **never** used as Relay identity. |
| `s3_vault_prefix` | Durable tenant vault root in Lanyard S3 (V1b); **survives** sandbox lifecycle; layout: [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md). |

## Lifetimes and ownership

| Identifier | Owner (authority) | Lifetime | Who mints / binds | Who may use it | Cleared when |
|------------|-------------------|----------|-------------------|----------------|--------------|
| `tenant_id` | Control Plane | Tenant lifetime | Platform `POST /tenants` | Platform + tenant-scoped APIs | Hard tenant delete (rare; not product offboard) |
| **`instance_id`** | Control Plane (`gateway_instances`) | From register until revoke / deprovision | CP `POST …/instances/register` | Relay hello, BFF deliver-inbound, Brain RPC `auth.instance_id`, agent `GATEWAY_RELAY_*` | Soft revoke (`revoked_at`); secret rotate **keeps** same `instance_id` |
| **Relay secret** (hash in CP; plaintext show-once) | Control Plane + secret store (SSM/SM ARN ref) | Until rotate or revoke | CP register / rotate | Agent env inject only; never re-read from CP after issue | Rotate (new secret, same `instance_id`); revoke |
| **`sandbox_id`** | Daytona managed CP; **tracked** by Lanyard Instance Orchestrator | From create/start until stop/destroy (or map clear) | Orchestrator via Daytona API (usually lazy on first `ensure_online`) | Orchestrator only (start/stop/status/webhooks); **not** agent guest; **not** Relay auth | Idle stop, explicit stop, destroy, or failed wake cleanup; may be replaced on next create |
| **`s3_vault_prefix`** | Platform AWS (Lanyard-hosted S3); **recorded** in CP per instance/tenant | From provision until offboard | Provision path (CP-first for `runtime_kind=daytona`; no company-brain EC2) | Mount inject at wake; IAM scoped to prefix; Brain RPC vault ops via mounted path | Tenant/instance offboard (Phase 3 apply later — doc only offline) |
| `agent_snapshot_id` (pin) | Platform release process | Per agent image/snapshot release | Snapshot pipeline (Phase 2 live `lp-4xa`/`lp-1wa`; convention offline [agent-snapshot-pin.md](./agent-snapshot-pin.md) `lp-kng.2.7`) | Orchestrator create-from-snapshot | Superseded by newer pin; not tenant-unique |
| `ec2_instance_id` (EC2 path only) | AWS; metadata in CP registry | EC2 host lifetime | Tenant TF / bootstrap | Ops inventory only — **never** auth | TF destroy / host replace |

### Normative ownership notes

- **Product CLIs / agent process do not own sandbox lifecycle** (overview §4.3). The agent is a **guest**: it receives env + mount and dials Relay. It must not call Daytona APIs or treat `sandbox_id` as its identity.
- **Tenants never receive Daytona API keys** and never deploy sandboxes (overview §4.11).
- **Vault bytes are not in CP Postgres.** CP stores identity metadata and prefix **refs**; canonical content lives under the S3 vault prefix (or host disk for `runtime_kind=ec2`).

## Relationship diagram

```text
tenant_id
  └── gateway instance (row in gateway_instances)
        ├── instance_id          [PERMANENT]  Relay + Brain RPC + BFF routing
        ├── secret_hash / ARN    [ROTATABLE]  show-once plaintext at register/rotate
        ├── runtime_kind         ec2 | daytona
        ├── s3_vault_prefix      [DURABLE]    S3 Mountpoint root for vault (daytona)
        │                         # plan 0008 single-root default; multi-scope uses dual prefixes (below)
        ├── agent_snapshot_id    [PIN]        image/snapshot for wake (daytona)
        ├── sandbox_id?          [EPHEMERAL]  current Daytona handle when known
        ├── presence             offline | waking | online | error  (lp-eya)
        ├── last_activity_at?    [IDLE CLOCK] ISO; null until activity/wake (lp-omt)
        └── ec2_instance_id?     [EC2 only]   ops metadata, not auth
```

### Multi-scope extension (`lp-zoh.1` / plan 0010)

Phase-1 default remains **one primary instance / one vault root per tenant**. Product path **0010** adds optional **user-scoped** instances and **dual durable vault prefixes** without changing the three-id rules above.

Normative decision: **[decision-identity-and-vault-scope.md](../0010-multi-scope-sandbox-vault/decision-identity-and-vault-scope.md)**.

```text
tenant_id
  ├── shared vault          tenants/{tid}/vault/shared/          [DURABLE]
  ├── users/{user_id}
  │     └── personal vault  tenants/{tid}/users/{uid}/vault/     [DURABLE]
  └── gateway_instances[]
        ├── scope=tenant, owner_user_id=null
        │     mounts: shared only
        │     instance_id [PERMANENT] · sandbox_id? [EPHEMERAL]
        └── scope=user, owner_user_id={uid}
              mounts: shared + personal(uid)
              instance_id [PERMANENT] · sandbox_id? [EPHEMERAL]
```

| Rule | Detail |
|------|--------|
| `scope` | `tenant` \| `user` (v1); legacy rows without scope ≡ `tenant` |
| `owner_user_id` | **Required** for `scope=user`; **null** for `scope=tenant` |
| Mounts | Tenant instance → **shared only**; user instance → **shared + that user's personal** |
| Chat cardinality | Many chats → one instance; **never** one sandbox per chat |
| Routing (v1) | User instance if exists for `(tenant, user)` else tenant primary else fail closed |
| Relay identity | Still **`instance_id`** per instance row (not `user_id`) |
| Uniques (intent) | ≤1 tenant primary per tenant; ≤1 user instance per `(tenant_id, owner_user_id)` — CP: `lp-zoh.2` |

**Still true:** `sandbox_id` is never Relay auth; vault prefixes are never derived from `sandbox_id`; idle stop keeps identity + prefixes.

Wake path (conceptual):

```text
BFF / adapter  →  CP ensure_online(instance_id)
                     │
                     ├─ if online + relay session → return
                     ├─ if waking (singleflight) → wait
                     └─ else orchestrator:
                          resolve s3_vault_prefix + snapshot pin + relay inject material
                          Daytona create/start → sandbox_id
                          mount prefix + inject GATEWAY_RELAY_* (instance_id permanent)
                          agent dials Relay as instance_id
                          presence → online
```

Idle path: last activity + 30 min grace → stop sandbox → clear or mark `sandbox_id` stopped; **keep** `instance_id` + `s3_vault_prefix`.

## Why the three must stay distinct

| Mistake | Failure mode |
|---------|----------------|
| Use `sandbox_id` as Relay / Brain RPC identity | Every stop/recreate breaks routing; secret rotation and audit lose continuity |
| Use `instance_id` as S3 prefix alone without a stable vault key | Prefix churn on re-register destroys durable vault binding; dual-run EC2↔Daytona harder |
| Put vault under sandbox-local disk only | Idle stop loses Company Brain data (violates vault-durable-across-stop acceptance) |
| Agent creates/stops sandboxes | Breaks guest model; tenants would need Daytona keys; dual-run and singleflight wake fail |
| Reuse one sandbox across tenants | Cross-tenant isolation failure (Linux VM is isolation boundary; prefix + IAM still required) |

## EC2 vs Daytona mapping

| Concern | `runtime_kind=ec2` (today) | `runtime_kind=daytona` (target) |
|---------|----------------------------|----------------------------------|
| Permanent gateway id | `instance_id` | **Same** `instance_id` |
| Compute handle | `ec2_instance_id` (sticky host) | `sandbox_id` (ephemeral VM) |
| Vault root | Host path e.g. `/opt/company-brain` | Mount of **`s3_vault_prefix`** (V1b Mountpoint) |
| Provision creates compute? | Yes (tenant TF EC2) | **No** — CP register + prefix only; sandbox **lazy** on `ensure_online` |
| Idle stop | Host stays up (always-on) | Sandbox stops after 30 min idle |
| Agent env identity | `GATEWAY_RELAY_INSTANCE_ID=instance_id` | **Same names** (parity; `lp-vey`) |

## Field sketch for CP (implementation in `lp-nye`)

Normative **meanings**. Types + migrations: `portal/packages/control-plane`
(`types.ts` / `migrate.ts` / registry update) — bead `lp-nye`.

| Field | Required for daytona | Nullability | Notes |
|-------|----------------------|-------------|-------|
| `instance_id` | yes | PK | Existing |
| `tenant_id` | yes | not null | Existing |
| `runtime_kind` | yes | not null default `ec2` | `ec2` \| `daytona` |
| `s3_vault_prefix` | yes when daytona | null on pure EC2 host-disk path | Opaque string; layout rules in [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) |
| `sandbox_id` | no at provision | null when offline / unknown | Set/cleared by orchestrator only |
| `agent_snapshot_id` | yes when daytona (or platform default) | may inherit org default | Pin convention [agent-snapshot-pin.md](./agent-snapshot-pin.md) (`lp-kng.2.7`); offline placeholder ok |
| `presence` | yes when daytona | default `offline` | Field enum here; transitions **[presence-state-machine.md](./presence-state-machine.md)** (`lp-eya`) |
| `ec2_instance_id` | EC2 only | null on daytona | Existing registry metadata |

**Provision (`runtime_kind=daytona`):** mint `instance_id` + secret, assign `s3_vault_prefix`, set presence `offline`, **`sandbox_id = null`**. Do not call Daytona create at provision (`lp-6jx` / §4.11). Operator sequence: [provision-runbook-daytona.md](./provision-runbook-daytona.md) (`lp-kng.2.10`).

**`ensure_online`:** only path that should create/start a sandbox and bind `sandbox_id` for that instance.

## S3 vault prefix (summary)

Full prefix layout, seed/bootstrap, and anti-cross-tenant notes:

→ **[s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md)** (`lp-kng.2.4`, design only — not applied)  
→ Multi-scope dual prefixes: same layout doc § multi-scope + [decision `lp-zoh.1`](../0010-multi-scope-sandbox-vault/decision-identity-and-vault-scope.md)

Identity constraints (normative here; layout detail there):

- Prefix is **durable** and **tenant-scoped** (optionally instance-scoped if multi-instance tenants need separate vaults; default product path is one primary instance / one vault root per tenant).
- Prefix is **not** derived from `sandbox_id`.
- Prefer stable keys from `tenant_id` (and/or `instance_id` if multi-instance vaults) so re-wake remounts the same data.
- IAM mount credentials must be scoped to the **mounted** prefix set; never broad-bucket access for a sandbox role.

**Locked default shape** (`lp-kng.2.4` — single-root / legacy + pre-migration Daytona path):

```text
s3://<lanyard-vault-bucket>/tenants/<tenant_id>/vault/
```

CP stores `s3_vault_prefix = tenants/{tenant_id}/vault/` (trailing slash). Optional multi-instance exception: `tenants/{tenant_id}/instances/{instance_id}/vault/`.

**Multi-scope dual-root shape** (`lp-zoh.1` / plan 0010 — target product path):

```text
s3://…/tenants/{tenant_id}/vault/shared/
s3://…/tenants/{tenant_id}/users/{user_id}/vault/
```

Tenant instances mount shared only; user instances mount shared + personal. Legacy single prefix migrates to shared (`lp-zoh.10`).

## Auth and routing checklist

| Path | Identifier used |
|------|-----------------|
| Relay WebSocket hello / owner map | `instance_id` (+ secret) |
| BFF deliver-inbound / Brain RPC | `instance_id` (primary gateway) |
| Daytona API start/stop/status | `sandbox_id` |
| Presence webhooks → CP | Map Daytona payload → `sandbox_id` → row keyed by `instance_id` |
| S3 Mountpoint / vault I/O | `s3_vault_prefix` → local `VAULT_ROOT` |
| Audit / logs | Prefer `tenant_id` + `instance_id`; include `sandbox_id` only as ops metadata |

## Out of scope here

- Exact S3 key tree, seed/bootstrap, anti-cross-tenant layout (→ [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) / `lp-kng.2.4`; lifecycle/encryption apply in Phase 3 `lp-eto`)
- IAM policy JSON (→ [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md) / `lp-kng.2.5`, draft not applied)
- CP schema migration / types (→ `lp-nye`)
- Gateway env var full contract (→ **[gateway-env-contract.md](./gateway-env-contract.md)** / `lp-vey`)
- Real Daytona create or Terraform apply (forbidden on offline track)

## Acceptance evidence (`lp-707`)

- [x] Doc section in plan: this file = plan **§2.3**; linked from [overview.md](./overview.md)
- [x] Table of lifetimes and who owns each id: see **Lifetimes and ownership** above

### Multi-scope extension evidence (`lp-zoh.1`)

- [x] Multi-scope section + diagram above; decision record linked
- [x] `scope` / `owner_user_id` / dual prefixes / mount rules / no sandbox-per-chat / routing preference locked in decision doc
