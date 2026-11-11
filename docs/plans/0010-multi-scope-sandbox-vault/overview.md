# Multi-scope sandboxes + dual vault (tenant shared + per-user personal)

**Status:** Plan / design (implementation via Beads epic)  
**Date:** 2026-08-07  
**Decision (`lp-zoh.1`):** [decision-identity-and-vault-scope.md](./decision-identity-and-vault-scope.md) — **drafted; needs human acceptance**  
**Related:** [0008 identity model](../0008-daytona-agent-sandboxes/identity-model.md), [S3 vault prefix layout](../0008-daytona-agent-sandboxes/s3-vault-prefix-layout.md), Daytona epic `lp-kng`

## Context

Today the product path is **one primary gateway instance per tenant** and **one vault root** (`tenants/{tenant_id}/vault/`). Many portal users share that single brain and vault via ACL profiles. Chat threads are multiplexed onto the same instance; sandboxes are **not** per chat (correct).

Product direction:

1. **Optional tenant sandbox** — designated shared compute for the tenant (team brain).
2. **Optional per-user sandbox** — designated personal compute for each user under the tenant.
3. **Shared vault** (per tenant) — every user under the tenant can access it by default.
4. **Personal vault** (per user) — not shared with other users.
5. **Not** one sandbox per chat stream.

## Scope

### In

- Instance scope model: `tenant` | `user` (extensible).
- Provision / ensure-online routing for tenant vs user instances.
- Dual durable S3 vault prefixes and dual guest mounts (or multi-root virtual FS).
- Default ACLs: user can read/write personal + access shared; other users cannot see personal.
- Idle reaper / retain-on-stop still per **instance** (each user instance independent).
- Docs, contracts, CP fields, BFF routing, Brain RPC path prefixes, Portal vault tree honesty.

### Out (this plan)

- Per-chat sandboxes (explicitly rejected).
- Training chat corpus (see plan **0011**).
- Cross-tenant vault sharing.
- Full multiplayer ledger rewrite (plan `lp-ye4` remains separate).
- Changing Relay identity to user_id (instance_id remains Relay identity).

## Domain model (foundational)

```text
tenant_id
  ├── shared_vault_prefix     tenants/{tid}/vault/shared/
  ├── users/{user_id}
  │     └── personal_vault    tenants/{tid}/users/{uid}/vault/
  └── gateway_instances[]
        ├── scope=tenant, owner_user_id=null, sandbox_id?, presence
        │     mounts: shared (required) [+ optional personal of acting user? NO]
        └── scope=user, owner_user_id={uid}, sandbox_id?, presence
              mounts: shared + personal(uid)
```

**Rules**

| Rule | Detail |
|------|--------|
| Sandbox cardinality | At most one live sandbox per **instance**; instances are tenant-scoped or user-scoped; never chat-scoped |
| Chat multiplexing | Many chat threads may share one instance (same as today) |
| Tenant instance | Optional flag `tenant_instance_enabled` (default on for current tenants) |
| User instance | Optional flag `user_instances_enabled` (default off until provisioned; opt-in product) |
| Shared vault | One prefix per tenant; durable; all tenant users get path access by default |
| Personal vault | One prefix per user; durable; only that user (and platform break-glass) |
| Tenant sandbox vaults | Mounts **shared only** (team brain does not mount all personal vaults) |
| User sandbox vaults | Mounts **shared + that user's personal** |
| Isolation | Sandbox = compute isolation; vault ACL = data isolation; IAM mount role scoped to mounted prefixes only |

### Why tenant sandbox does not mount all personal vaults

Mounting every personal prefix into the tenant sandbox would collapse isolation (any tool path under the mount would be readable). Personal data stays on user instances. Shared work lives under `vault/shared/`.

### Routing (BFF → instance)

When a user sends chat / brain RPC:

```text
if user_instances_enabled and user_instance exists for (tenant, user):
  ensure_online(user_instance_id)
else if tenant_instance_enabled and tenant primary exists:
  ensure_online(tenant_instance_id)
else:
  fail closed (provision required)
```

Preference may later become user setting (“use personal agent” vs “use team agent”). v1: feature flags + existence.

### S3 layout (normative)

```text
tenants/{tenant_id}/
  vault/
    shared/                 # shared vault root (product "Company vault")
  users/
    {user_id}/
      vault/                # personal vault root
```

**Migration from current single prefix** `tenants/{tid}/vault/`:

- Treat existing tree as **shared** content: either rename objects to `vault/shared/` or alias `vault/` as shared until migration complete.
- New personal prefixes start empty (optional seed AGENTS.md).

### CP fields (sketch)

```text
gateway_instances:
  instance_id            PK
  tenant_id
  scope                  'tenant' | 'user'
  owner_user_id          null if scope=tenant; required if scope=user
  is_primary             bool  # tenant primary for routing fallback
  runtime_kind           ec2 | daytona
  sandbox_id?
  presence
  s3_shared_vault_prefix # tenants/{tid}/vault/shared/
  s3_personal_vault_prefix?  # set for scope=user; null for tenant scope
  agent_snapshot_id?
  last_activity_at?
  mid_turn?
```

Unique constraints:

- At most one `scope=tenant` primary per tenant (`is_primary=true`).
- At most one `scope=user` instance per `(tenant_id, owner_user_id)`.

### Guest mounts / agent config

Wake inject (user instance example):

```text
VAULT_SHARED_ROOT=/mnt/vault-shared
VAULT_PERSONAL_ROOT=/mnt/vault-personal
VAULT_ROOT=/mnt/vault-personal          # default cwd / project materialization
# multi-root for Brain RPC vault.list:
LANYARD_VAULT_ROOTS=shared:/mnt/vault-shared,personal:/mnt/vault-personal
```

Agent `vault_root` remains the primary working root (personal for user instances, shared for tenant instances). Multi-root listing uses Brain RPC roots / path prefixes already present in Portal multi-root FS provider.

### ACL defaults

| Subject | Shared | Personal (self) | Personal (other) |
|---------|--------|-----------------|------------------|
| Tenant user (default) | access (read/write per product; start R/W) | full | deny |
| Tenant admin | full | self only unless break-glass | deny (unless break-glass) |
| Platform ops | break-glass only | break-glass only | break-glass only |

## Alternatives considered

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| A. One sandbox per tenant only; personal dirs inside shared vault with ACL | Simple compute | Weak FS isolation; tool escapes harder to reason | Reject for personal |
| B. One sandbox per user only; no tenant sandbox | Strong isolation | No shared “team brain” compute | Optional mode, not sole |
| C. Tenant + optional user sandboxes; dual vault prefixes | Matches product; isolation + sharing | More CP/orchestrator work | **Chosen** |
| D. Sandbox per chat | — | Cost explosion; no shared memory | **Rejected** |

## Beads

| Id | Title |
|----|--------|
| **lp-zoh** | Epic: Multi-scope sandboxes + dual vault |
<<<<<<< HEAD
| lp-zoh.1 | Decision + identity model |
=======
| lp-zoh.1 | Decision + identity model → [decision-identity-and-vault-scope.md](./decision-identity-and-vault-scope.md) |
>>>>>>> 1ba95663 (lp-zoh.1: decision + identity model for multi-scope sandboxes and dual vault)
| lp-zoh.2 | CP schema |
| lp-zoh.3 | Provision APIs |
| lp-zoh.4 | Orchestrator dual-mount |
| lp-zoh.5 | BFF routing |
| lp-zoh.6 | Brain RPC ACL |
| lp-zoh.7 | Agent multi-root config |
| lp-zoh.8 | Portal vault UI |
| lp-zoh.9 | Idle reaper independence |
| lp-zoh.10 | Migration legacy vault prefix |
| lp-zoh.11 | Live 2-user proof |

Related: `lp-kng` (Daytona platform). Start ready leaf: `bd show lp-zoh.1`.

## Verification

- Unit: CP unique constraints, prefix shape validation, routing pure functions.  
- Integration: fake Daytona dual-mount create body.  
- Live (when hold allows): two users, shared file visible to both, personal file only to owner, separate sandbox_ids when both online.  

## Principles applied

- **Model the domain:** scope + dual prefixes as first-class fields, not path heuristics.  
- **Foundational thinking:** identity/layout before BFF UX.  
- **Boundary discipline:** validate prefix shape and owner_user_id at provision/wake edges.  
- **Make operations idempotent:** ensure_online and provision user instance are re-entrant.  
- **Separate before serializing shared state:** personal vaults never co-mounted on tenant sandbox.  
- **Sequence verifiable units:** small phases with proofs.  
- **Redesign from first principles:** dual vault as day-one layout, not nested ACL hacks.  
