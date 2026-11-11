# Decision: Multi-scope instances + dual vault prefixes

**Bead:** `lp-zoh.1`  
**Epic:** `lp-zoh` — Multi-scope sandboxes: tenant + per-user compute with shared + personal vaults  
**Plan:** [overview.md](./overview.md) (plan **0010**)  
**Date:** 2026-08-07  
**Status:** **Decision drafted** — awaiting human product/ops acceptance before production provision of user-scope instances  
**Needs human:** **yes** — confirm product flags defaults, mount policy, and migration of legacy `tenants/{tid}/vault/` before unblocking production attach  
**No secrets** in this file.

Related sources:

| Source | Role |
|--------|------|
| [overview.md](./overview.md) | Plan 0010 product model and phase map |
| [identity-model.md](../0008-daytona-agent-sandboxes/identity-model.md) (`lp-707`) | Permanent `instance_id` vs ephemeral `sandbox_id` vs durable vault prefix |
| [s3-vault-prefix-layout.md](../0008-daytona-agent-sandboxes/s3-vault-prefix-layout.md) (`lp-kng.2.4`) | Normative S3 vault key layout + anti cross-tenant rules |
| [0008 overview](../0008-daytona-agent-sandboxes/overview.md) | Daytona platform epic (`lp-kng`) context |
| Epic `lp-zoh` | Implementation beads (CP schema → live 2-user proof) |

---

## 1. Executive decision (normative for plan 0010)

| Topic | Decision |
|-------|----------|
| **Instance scope** | `gateway_instances.scope ∈ { tenant, user }` (extensible enum; only these two in v1) |
| **Owner** | `owner_user_id` **required** when `scope=user`; **null** when `scope=tenant` |
| **Shared vault prefix** | `tenants/{tenant_id}/vault/shared/` (product “Company vault”) |
| **Personal vault prefix** | `tenants/{tenant_id}/users/{user_id}/vault/` (owner-only by default) |
| **Tenant instance mounts** | **Shared only** — never all personal vaults, never other users’ personal |
| **User instance mounts** | **Shared + that user’s personal** only |
| **Chat → sandbox cardinality** | **Never** one sandbox per chat stream; many chats multiplex onto one instance |
| **Routing preference (v1)** | If user instance exists for `(tenant, user)` → that instance; else tenant primary; else fail closed |
| **Relay identity** | Still **`instance_id`** (not `user_id`, not `sandbox_id`) — one Relay identity per instance row |

**One-line:** Compute is scoped to **tenant** or **user** instances; data isolation is **dual durable S3 prefixes** with mount rules that keep personal vaults off the team sandbox.

This document **locks** the domain model for implementation beads `lp-zoh.2`–`lp-zoh.11`. It does **not** implement CP schema, provision, or orchestrator code (those are sibling beads).

---

## 2. Context

Today (plan **0008** / Daytona path):

- One **primary gateway instance per tenant** is the product default.
- One durable vault root: `tenants/{tenant_id}/vault/`.
- Many portal users share that instance and vault (ACL profiles).
- Sandboxes are **not** per chat — correct and retained.

Product direction (plan **0010** / epic `lp-zoh`):

1. Optional **tenant sandbox** — designated shared compute (team brain).
2. Optional **per-user sandbox** — designated personal compute under the tenant.
3. **Shared vault** per tenant — default access for all tenant users.
4. **Personal vault** per user — not shared with other users.
5. Explicitly **not** one sandbox per chat stream.

Identity foundations from `lp-707` remain:

| Identifier | Rule (unchanged) |
|------------|------------------|
| `instance_id` | Permanent product / Relay / Brain RPC identity |
| `sandbox_id` | Ephemeral Daytona handle for this wake cycle |
| Vault prefix(es) | Durable in Lanyard S3; not derived from `sandbox_id` |

What **changes** is cardinality and vault geometry: more than one instance per tenant is a first-class product path, and vault durability splits into **shared** + **personal** prefixes.

---

## 3. Locked rules

### 3.1 Instance scope and ownership

| Field | Rule |
|-------|------|
| `scope` | Required for multi-scope product path: `tenant` \| `user` |
| `owner_user_id` | **Required** if `scope=user`; **must be null** if `scope=tenant` |
| Uniqueness (intent) | At most one `scope=tenant` **primary** per tenant (`is_primary=true`); at most one `scope=user` instance per `(tenant_id, owner_user_id)` — formalized in `lp-zoh.2` |
| `instance_id` | Still permanent; user and tenant instances each have their own `instance_id` and Relay secret material |
| `sandbox_id` | Still ephemeral per instance; idle reaper is **per instance** (`lp-zoh.9`) |

Legacy rows without `scope` are treated as **`scope=tenant`** primary until migration/backfill (`lp-zoh.2` / `lp-zoh.10`).

### 3.2 Dual vault prefixes (normative)

```text
tenants/{tenant_id}/
  vault/
    shared/                         # shared vault root
  users/
    {user_id}/
      vault/                        # personal vault root for that user
  _platform/                        # never guest-mounted (existing 0008 rule)
```

| Prefix role | CP storage form (trailing slash) | Product name |
|-------------|----------------------------------|--------------|
| Shared | `tenants/{tenant_id}/vault/shared/` | Company / team vault |
| Personal | `tenants/{tenant_id}/users/{user_id}/vault/` | Personal vault |

Rules:

- Prefixes are **durable** and assigned at provision; never rewritten on wake/idle.
- Prefixes are **not** derived from `sandbox_id` or chat/thread ids.
- `tenant_id` and `user_id` segments are single opaque path segments (no `/`, `..`, empty).
- Platform-only keys remain under `tenants/{tenant_id}/_platform/` (not mounted).

**Legacy single prefix** `tenants/{tenant_id}/vault/` (plan 0008 default) is the **migration source**: treat existing tree as shared content — rename/alias into `vault/shared/` (`lp-zoh.10`). Until migration completes, readers may accept legacy `vault/` as shared-equivalent; new dual-mount product path targets the shapes above.

### 3.3 Mount policy by instance scope

| Instance `scope` | Mounts at wake | Guest defaults (sketch) |
|------------------|----------------|-------------------------|
| `tenant` | **Shared only** | `VAULT_ROOT` → shared mount; no personal prefix in IAM session |
| `user` | **Shared + personal(`owner_user_id`)** | `VAULT_ROOT` → personal (working root); multi-root lists shared + personal |

**Forbidden:**

- Mounting **all** personal vaults into a tenant sandbox.
- Mounting another user’s personal vault into a user sandbox.
- Mounting vault prefixes for a different `tenant_id`.
- Deriving mounts from chat/thread id.

**Why tenant does not mount all personal vaults:** any tool path under a broad mount collapses isolation. Shared work lives under `vault/shared/`; personal work stays on user instances.

IAM session policy for a sandbox must grant **only** the mounted prefix set (orchestrator dual-mount: `lp-zoh.4`; IAM follow-ons under plan 0008).

### 3.4 Never sandbox-per-chat

| Cardinality | Allowed? |
|-------------|----------|
| Many chat threads → one tenant instance | **Yes** (today) |
| Many chat threads → one user instance | **Yes** |
| One chat thread → one dedicated sandbox | **No** (rejected) |
| One live sandbox per **instance** | **Yes** (at most one; idle stop clears compute, not identity) |

Chat multiplexing onto a stable instance preserves memory, cost, and Relay identity continuity. Per-chat sandboxes explode cost and destroy shared working memory.

### 3.5 Routing preference (BFF → instance)

When a portal user sends chat / brain RPC (v1):

```text
if user_instances_enabled and user_instance exists for (tenant_id, user_id):
  ensure_online(user_instance.instance_id)
else if tenant_instance_enabled and tenant primary exists:
  ensure_online(tenant_primary.instance_id)
else:
  fail closed (provision required)
```

| Flag (product intent) | Default intent |
|-----------------------|----------------|
| `tenant_instance_enabled` | **On** for current tenants (preserve team brain) |
| `user_instances_enabled` | **Off** until product opt-in / provision |

Later: optional user setting (“use personal agent” vs “use team agent”). **v1** is feature flags + existence only (`lp-zoh.5`).

### 3.6 ACL defaults (data plane intent)

| Subject | Shared | Personal (self) | Personal (other) |
|---------|--------|-----------------|------------------|
| Tenant user (default) | access (start R/W) | full | **deny** |
| Tenant admin | full | self only unless break-glass | deny unless break-glass |
| Platform ops | break-glass only | break-glass only | break-glass only |

Brain RPC path prefixes and Portal multi-root honesty: `lp-zoh.6`, `lp-zoh.8`. This decision only locks isolation intent.

### 3.7 What does **not** change

| Concern | Still true |
|---------|------------|
| Relay auth identity | `instance_id` (+ secret), not `user_id` |
| Agent guest model | No Daytona API from guest; mounts + env at wake |
| Vault durability | S3 Mountpoint V1b (plan 0008 locked) |
| Idle stop | Stops sandbox; keeps `instance_id` + vault prefixes |
| Cross-tenant sharing | Forbidden |

---

## 4. Rejected alternatives

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **A.** One sandbox per tenant only; “personal” dirs inside shared vault with ACL only | Simple compute | Weak FS isolation; tool path escapes harder to reason; ACL bugs become data leaks | **Rejected** as sole personal isolation |
| **B.** One sandbox per user only; no tenant sandbox | Strong isolation | No shared “team brain” compute; breaks current multi-user primary model | **Rejected** as sole mode (optional user mode is allowed *with* tenant) |
| **C.** Tenant + optional user sandboxes; dual vault prefixes | Matches product; isolation + sharing | More CP / orchestrator / BFF work | **Chosen** |
| **D.** Sandbox per chat / thread | Apparent session isolation | Cost explosion; no durable shared agent memory; breaks Relay-instance model | **Rejected** |
| **E.** Tenant sandbox mounts all personal prefixes read-only | “Admin sees everything” convenience | Collapses personal isolation at FS layer; IAM blast radius | **Rejected** |
| **F.** Personal vault as only `instances/{instance_id}/vault/` without user key | Fits rare multi-brain exception | User offboard / re-provision identity churn; harder “user owns vault” product story | **Rejected** for personal product path (instance-scoped vault remains 0008 multi-brain **exception** only) |
| **G.** Change Relay identity to `user_id` | Aligns auth with human | Breaks multi-instance tenants, agent guest secrets, audit continuity | **Rejected** — `instance_id` remains Relay identity |

---

## 5. Implications by surface

| Surface | Action (downstream bead) |
|---------|---------------------------|
| **CP schema** | Add `scope`, `owner_user_id`, shared/personal prefix fields, uniques (`lp-zoh.2`) |
| **Provision** | Tenant primary + optional user instance APIs (`lp-zoh.3`) |
| **Orchestrator wake** | Dual-mount shared+personal for user; shared-only for tenant (`lp-zoh.4`) |
| **BFF routing** | User instance if exists else tenant primary (`lp-zoh.5`) |
| **Brain RPC ACL** | path_prefixes for shared + personal; deny other personal (`lp-zoh.6`) |
| **Agent config** | Multi-root vault env (`lp-zoh.7`) |
| **Portal vault UI** | Shared + Personal trees (`lp-zoh.8`) |
| **Idle reaper** | Independent per instance (`lp-zoh.9`) |
| **Migration** | Legacy `tenants/{tid}/vault/` → shared layout (`lp-zoh.10`) |
| **Proof** | Two users, shared visible, personal isolated, separate sandboxes (`lp-zoh.11`) |
| **identity-model.md / s3-vault-prefix-layout.md** | Extended by this bead to cite multi-scope rules without rewriting 0008 offline history |

---

## 6. Human gate

**Needs human acceptance** before production unblocks user-scope provision and dual-mount attach:

1. Confirm **Chosen** approach **C** (tenant + optional user; dual prefixes).  
2. Confirm mount policy: tenant = shared only; user = shared + own personal.  
3. Confirm routing: user instance if exists else tenant primary (v1 flags).  
4. Confirm migration posture for existing `tenants/{tid}/vault/` → `vault/shared/` (`lp-zoh.10`).  
5. Confirm `user_instances_enabled` default **off** until explicit product opt-in.

Until accepted: design docs and follow-on beads may proceed offline; **do not** claim production multi-scope attach complete.

---

## 7. Acceptance evidence (`lp-zoh.1`)

- [x] Decision record written (this file) with linked sources  
- [x] Locked rules: `scope`, `owner_user_id`, shared/personal prefixes, mount rules, no sandbox-per-chat, routing preference  
- [x] Rejected alternatives listed (table §4)  
- [x] [identity-model.md](../0008-daytona-agent-sandboxes/identity-model.md) extended for multi-scope  
- [x] [s3-vault-prefix-layout.md](../0008-daytona-agent-sandboxes/s3-vault-prefix-layout.md) extended for dual prefixes  
- [x] Plan [overview.md](./overview.md) present as plan 0010 anchor  
- [ ] Human acceptance recorded (status → Accepted; `needs_human` cleared on bead)

**No product code** required for this bead.
