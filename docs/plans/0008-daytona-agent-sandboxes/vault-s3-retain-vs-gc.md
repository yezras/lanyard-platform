# Vault S3 retain vs GC on deprovision

**Bead:** `lp-zmg`  
**Parent:** `lp-eto` (Phase 3: Vault on Lanyard S3 V1b)  
**Depends on:** [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) (`lp-0fq`)  
**Unblocks:** `lp-e96` (Deprovision: revoke secret, stop sandbox, optional S3 GC)  
**Related:** [provision-runbook-daytona.md](./provision-runbook-daytona.md) §7, [identity-model.md](./identity-model.md), [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md)

## Status

| Item | Value |
|------|--------|
| Scope | **Policy / design only** — no live S3 delete automation in this bead |
| Pilot default | **Retain** tenant vault prefixes on deprovision |
| Apply code | Optional GC path is a later implementer (`lp-e96`); must default off |

## Purpose

Define what happens to **durable vault bytes** under `s3_vault_prefix` when compute or identity is torn down, so deprovision cannot silently destroy tenant knowledge data.

Goals:

1. Safe pilot default: **prefer retain**  
2. Clear separation of **always-on deprovision steps** vs **optional vault GC**  
3. Legal / hold notes so product and ops do not auto-purge under hold  
4. Normative contract for `lp-e96` and provision runbook

## Normative default (pilot)

| Decision | Value |
|----------|--------|
| **Default vault policy on deprovision** | **`retain`** |
| Auto-delete of `tenants/{tenant_id}/vault/*` on revoke/deprovision | **Forbidden** for pilot |
| Auto-delete of `tenants/{tenant_id}/_platform/*` on revoke/deprovision | **Forbidden** for pilot (markers/bootstrap stay for audit) |
| S3 Lifecycle rules that expire tenant vault prefixes | **Do not enable** for pilot without explicit product + legal sign-off |
| Re-provision same `tenant_id` | Mount **existing** prefix; do not invent a second prefix |

**Rationale:** Vault content is tenant knowledge (AGENTS.md, Knowledge/, memory/, etc.). Sandbox and Relay secrets are ephemeral; vault is durable by identity model. Pilot traffic is low cost relative to irrecoverable data loss. Layout already requires prefix durability across idle stop / recreate ([s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md)).

Until product explicitly chooses a purge product (offboard workflow with confirmation), implementations **must** leave S3 objects in place.

## Lifecycle events (what is deleted vs retained)

| Event | Sandbox / compute | Relay secret / mount creds | CP identity | Vault S3 objects (`s3_vault_prefix`) |
|-------|-------------------|----------------------------|-------------|--------------------------------------|
| **Idle stop** | Stop sandbox; may clear `sandbox_id` later per idle policy | Not rotated solely by idle | Keep `instance_id`, prefix | **Retain** (remount on next wake) |
| **Secret rotate** | Next wake injects new secret | New secret; old invalid | Same `instance_id` | **Retain** |
| **Instance revoke** | Stop/destroy sandbox if any; clear `sandbox_id` | Revoke / stop issuing | Soft-delete / `revoked_at` as CP defines | **Retain** (pilot default) |
| **Tenant deprovision** (platform offboard start) | Stop all sandboxes for tenant instances | Revoke all instance secrets | Soft-delete / mark deprovisioned | **Retain** (pilot default) |
| **Optional vault GC** (explicit) | N/A (already stopped) | N/A | Only after identity offboard path allows | **Delete only if** optional GC enabled + gates pass (see below) — **not pilot default** |
| **Lab spike cleanup** | Spike sandboxes deleted | Spike IAM roles deleted | N/A | Spike **test objects** only; never wipe whole tenant prefix in product path |

**Always safe / expected on deprovision (not vault GC):**

1. Stop or destroy Daytona sandbox(es) for the instance/tenant  
2. Revoke Relay / gateway secrets; refuse further wake inject for that instance  
3. Clear or null `sandbox_id`; mark presence offline/revoked  
4. Stop minting STS/session credentials for that prefix (guest can no longer mount)  
5. Leave CP `s3_vault_prefix` ref readable for audit until an explicit offboard archive step (ops may soft-hide from product UI)

**Never automatic on deprovision (pilot):**

1. Recursive `DeleteObject` / `DeleteObjects` under the tenant vault prefix  
2. Bucket-wide lifecycle expiration keyed only to “tenant deprovisioned”  
3. Deleting the shared vault **bucket** (`lp-d26`: pilot lab bucket must not be destroyed)  
4. Rewriting `s3_vault_prefix` to a new empty tree without a named migration procedure  

## Optional GC mode (non-default)

Optional garbage collection exists so `lp-e96` can implement a **gated** purge later. It is **off** unless product + ops explicitly enable it.

### Proposed control surface (design)

| Control | Design |
|---------|--------|
| Config key (sketch) | `vault.deprovision_gc_mode` ∈ { `retain` (default), `delete_after_hold`, `delete_immediate` } |
| Pilot / lab | Hard-code or config default: **`retain`** |
| Per-tenant override | Optional future; default inherits platform mode |
| API | If exposed: separate explicit action e.g. `POST …/vault/purge` with confirmation token — **not** implicit side-effect of `POST …/deprovision` |

### Gates before any delete (when mode ≠ retain)

All must pass:

1. **Mode enabled** — not pilot default  
2. **No legal / operator hold** — see [Legal and operator holds](#legal-and-operator-holds)  
3. **Identity offboard complete** — instance/tenant already revoked; no active sandbox mounting the prefix  
4. **Scope check** — delete only keys under the exact stored `s3_vault_prefix` (and optionally `_platform/` under same `tenant_id`); never `tenants/*` or bucket root  
5. **Audit** — log `tenant_id`, prefix hash/ref, actor, mode, object count (or delete job id); do **not** log object bodies  
6. **Idempotent job** — re-run safe; empty prefix is success  
7. **Human confirmation** for production tenants (runbook or dual-control) until product automates with legal sign-off  

### Recommended non-immediate path (`delete_after_hold`)

Prefer over `delete_immediate` if product ever wants automated purge:

1. Deprovision → vault remains **retain**  
2. Tag or write platform marker `tenants/{tenant_id}/_platform/pending-gc.json` with `eligible_after` timestamp  
3. After hold window (product-defined; not set for pilot), a separate sweeper deletes vault + platform markers  
4. Cancel path: remove marker → retain forever  

Pilot does **not** schedule this sweeper.

### What optional GC may delete (when enabled)

| Key space | When GC runs |
|-----------|----------------|
| `tenants/{tenant_id}/vault/**` | Yes — product vault content |
| `tenants/{tenant_id}/_platform/**` | Yes — after vault purge, for clean inventory |
| Other tenants | **Never** |
| Bucket policy / encryption / versioning config | **Never** (bucket is shared) |
| Unrelated prefixes / lab markers for other tenants | **Never** |

Versioned buckets: if versioning is on, GC must define whether to delete only current versions or all versions; pilot retain avoids the question.

## Legal and operator holds

| Hold type | Effect on vault GC |
|-----------|-------------------|
| **Legal hold / e-discovery / customer data request** | **Block all vault GC** for affected `tenant_id` (and multi-instance prefixes under that tenant). Retain objects; do not run lifecycle expire. Product/legal owns release of hold. |
| **OPERATOR HOLD (platform-staging localhost-only)** | Do not expand live staging infrastructure; lab mocklab vault bucket still **must not be destroyed**. Deprovision of pilot tenants still **retain** prefixes. |
| **Compliance retention period** | If a tenant contract requires N-day retention after offboard, mode must be `retain` or `delete_after_hold` with `eligible_after ≥ N`; never `delete_immediate`. |
| **Unknown / no legal input** | **Default retain** — do not invent purge deadlines in engineering alone. |

Engineering must treat “deprovision” as **access removal**, not **data destruction**, unless a named purge workflow with holds cleared is invoked.

**Note:** This document is not legal advice. Retention windows and hold procedures are product/legal decisions; engineering encodes **safe defaults** (retain) and **hard gates** before delete.

## Alignment with existing docs

| Source | This policy |
|--------|-------------|
| Layout: prefix durable across stop/start | Retain on idle and revoke preserves that contract |
| Layout: “Lifecycle / delete — default retain (`lp-zmg`)” | This doc is the normative detail |
| Identity: `s3_vault_prefix` durable until offboard | Offboard ≠ auto-delete in pilot; offboard = stop access; GC optional later |
| Provision runbook §7 | Revoke → prefix retained; tenant deprovision → soft retention (no TF destroy) |
| IAM sandbox role | Guest may `DeleteObject` **inside** vault while mounted (agent file delete ≠ platform GC). Platform GC is a **separate** privileged principal, never the guest session role for whole-prefix wipe via deprovision |
| Lab spikes (`lp-3en`, `lp-kx4`) | May delete **spike test objects** under a known lab path; product deprovision path must not copy “delete everything we wrote” for tenant trees |

## Implementation contract for `lp-e96`

Deprovision implementers **shall**:

1. Implement revoke/deprovision as: stop sandbox + revoke secrets + CP soft state — **without** S3 recursive delete by default.  
2. If an optional GC function exists, gate it on `vault.deprovision_gc_mode != retain` **and** the gates above; unit/fake tests must assert **default retain** (no `DeleteObject` calls on deprovision).  
3. Never call GC from the happy-path deprovision handler in pilot config.  
4. Document in runbook: “Vault retained; optional purge is separate.”  
5. Respect legal/operator hold flags when those fields exist; if absent, treat as hold = none but still mode = retain.

### Applied in code (`lp-e96`)

| Piece | Location |
|-------|----------|
| Teardown helpers | `portal/packages/control-plane/src/deprovision-daytona.ts` — `deprovisionDaytonaInstance`, `deprovisionDaytonaTenant`, `purgeVaultPrefix` |
| HTTP | `POST /tenants/:id/instances/:instanceId/revoke` and `POST /tenants/:id/deprovision` call helpers with **`runVaultGc: false`** |
| Store soft state | `revokeInstance` / `deprovisionTenant` set `revoked_at`, `sandbox_id = NULL`, `presence = offline` |
| GC mode env | `VAULT_DEPROVISION_GC_MODE` (default **`retain`**) |
| Fake tests | `portal/packages/control-plane/test/deprovision-daytona.test.ts` — archive + material delete + **no DeleteObject** on default path; gated purge unit tests |

Optional GC (`purgeVaultPrefix`) is available for a future explicit purge endpoint; it is **not** a side-effect of deprovision.

## Out of scope (this bead / `lp-zmg`)

- Enabling S3 Lifecycle expiration rules in Terraform  
- Destroying or recreating lab bucket `lanyard-mocklab-vault-123456789012`  
- Customer BYOC bucket offboard (Phase 9)  
- Changing guest IAM `s3:DeleteObject` for in-vault file ops  
- Product `POST …/vault/purge` HTTP surface (optional GC remains library + gates)

## Acceptance evidence (`lp-zmg`)

- [x] **Policy written** — this document under `docs/plans/0008-daytona-agent-sandboxes/`  
- [x] **Default is safe** — pilot default **`retain`**; optional GC off; auto-purge forbidden without explicit mode + gates; legal/operator hold blocks GC  
- [x] **`lp-e96` implementer** — code + real harness/FakeS3 tests assert retain default (see table above)  

## References

- [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) — prefix shape; lifecycle pointer  
- [provision-runbook-daytona.md](./provision-runbook-daytona.md) — revoke / deprovision table  
- [identity-model.md](./identity-model.md) — identifier lifetimes  
- [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md) — guest vs platform principals  
- [spike-3en-s3-vault-mount.md](./spike-3en-s3-vault-mount.md) — vault durable after sandbox stop  
