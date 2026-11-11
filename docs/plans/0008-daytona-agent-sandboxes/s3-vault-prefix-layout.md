# S3 vault bucket layout and per-tenant prefix

**Beads:** `lp-kng.2.4` (offline layout lock) · **`lp-0fq`** (Phase 3 design: encryption + bucket policy sketch) · multi-scope dual prefixes **`lp-zoh.1`**  
**Parents:** `lp-kng.2` (Offline piping) · **`lp-eto`** (Phase 3: Vault on Lanyard S3 V1b) · multi-scope epic **`lp-zoh`** (plan 0010)  
**Depends on:** [identity-model.md](./identity-model.md) (`lp-707`), Phase 0 go/no-go `lp-ctu`  
**Follow-on (Phase 3):** `lp-t86` (IAM scoped credentials), `lp-jt5` (prefix create helper), **`lp-d26` pilot bucket ensure** → [pilot-lab-s3-vault-bucket.md](./pilot-lab-s3-vault-bucket.md), `lp-zmg` (retain vs GC), `lp-hjo` (orchestrator mount params)  
**Multi-scope:** [decision-identity-and-vault-scope.md](../0010-multi-scope-sandbox-vault/decision-identity-and-vault-scope.md) · [plan 0010 overview](../0010-multi-scope-sandbox-vault/overview.md) · migration `lp-zoh.10`  
**Related:** [overview.md](./overview.md) (V1b Mountpoint), [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md), [spike-3en-s3-vault-mount.md](./spike-3en-s3-vault-mount.md), `contracts/backend-runtime-v1/filesystem-layout.md` (`VAULT_ROOT`)

## Status

| Track | Scope |
|-------|--------|
| **Offline (`lp-kng.2.4`)** | Prefix shape + anti cross-tenant rules locked. No Terraform apply in that bead. |
| **Phase 3 design (`lp-0fq`)** | This document is the **canonical** layout + **encryption / bucket policy sketch** (no public ACL). Still **design** — apply lives in sibling beads under `lp-eto`. |
| **Phase 3 apply** | Bucket ensure (`lp-d26` → [pilot-lab-s3-vault-bucket.md](./pilot-lab-s3-vault-bucket.md)), IAM (`lp-t86`), prefix helper (`lp-jt5`), mount params (`lp-hjo`) — not this bead. |

This is the **normative** S3 vault layout for `runtime_kind=daytona` (overview locked decision: Vault = Lanyard S3 Mountpoint **V1b**). IAM drafts, provision helpers, and orchestrator mount params must follow these rules.

## Purpose

Define:

1. The durable **S3 key prefix** recorded as `s3_vault_prefix` in Control Plane  
2. **Object tree** expectations under that prefix (what Mountpoint exposes as `VAULT_ROOT`)  
3. **Seed / bootstrap** behavior at provision (still offline design)  
4. **Anti cross-tenant** isolation rules for layout, orchestrator, and IAM consumers  

Identity constraints (must hold — from `lp-707`):

- Prefix is **durable** across stop/start/recreate of sandboxes  
- Prefix is **not** derived from `sandbox_id`  
- Prefer stable keys from `tenant_id` (and only then `instance_id` for multi-vault exceptions)  
- Idle stop keeps `instance_id` + `s3_vault_prefix`; only `sandbox_id` is ephemeral  

## Final scheme (locked for offline design)

### Bucket

| Item | Design |
|------|--------|
| Ownership | **Lanyard platform AWS** (not tenant accounts) for V1 managed path |
| Naming (product) | Environment-specific platform bucket, e.g. `lanyard-vault-{env}` |
| Lab / pilot (proven) | `lanyard-mocklab-vault-123456789012` (account `123456789012`, region `us-east-1`) — already exists; Mountpoint R/W proven in [`spike-3en-s3-vault-mount.md`](./spike-3en-s3-vault-mount.md). **Do not destroy** (`lp-d26`). |
| Staging full env | Respect OPERATOR HOLD for full platform-staging; lab mocklab bucket is the pilot SoT until hold lifts |
| CP field | Stores **prefix only** (or full `s3://bucket/prefix` URI); bucket name lives in platform config (`vault.bucket`) |
| Public access | **Never.** See [Encryption and bucket policy](#encryption-and-bucket-policy-sketch-lp-0fq) |

One **shared** platform bucket per environment holds all tenants under `tenants/{tenant_id}/…`. Do **not** create one bucket per tenant for V1b (ops cost + IAM blast radius of bucket-level misconfig).

### Canonical prefix (default product path — plan 0008 / pre-migration)

**One primary vault root per tenant** (matches identity-model Phase-1 default: one primary instance / one vault root per tenant):

```text
tenants/{tenant_id}/vault/
```

Full object URI shape:

```text
s3://{lanyard_vault_bucket}/tenants/{tenant_id}/vault/{vault_relative_path}
```

**CP `s3_vault_prefix` value (normative storage form for single-root path):**

```text
tenants/{tenant_id}/vault/
```

Rules:

- Always **trailing slash** on the prefix string used for IAM and Mountpoint  
- `tenant_id` is the Control Plane tenant UUID/id (opaque; no path segments, no `..`, no `/`)  
- Prefix is assigned at **provision** for `runtime_kind=daytona` and **never** rewritten on wake/idle  
- **Not** derived from `sandbox_id`, snapshot pin, Relay session, or chat/thread id  

Illustrative (same as identity-model sketch, now final for this design):

```text
s3://<lanyard-vault-bucket>/tenants/<tenant_id>/vault/
```

### Multi-scope dual prefixes (plan 0010 / `lp-zoh.1`)

Product path for **tenant shared + per-user personal** vaults. Decision record:

→ **[decision-identity-and-vault-scope.md](../0010-multi-scope-sandbox-vault/decision-identity-and-vault-scope.md)**

**Normative key tree:**

```text
tenants/{tenant_id}/
  vault/
    shared/                         # shared vault root (product "Company vault")
  users/
    {user_id}/
      vault/                        # personal vault root (owner-only by default)
  _platform/                        # never guest-mounted (unchanged)
```

| Role | CP storage form (trailing slash) | Who mounts |
|------|----------------------------------|------------|
| Shared | `tenants/{tenant_id}/vault/shared/` | Tenant instance **and** user instances under the tenant |
| Personal | `tenants/{tenant_id}/users/{user_id}/vault/` | **Only** the user instance for that `user_id` |

**Mount policy (normative):**

| Instance `scope` | Mounted prefixes |
|------------------|------------------|
| `tenant` | Shared **only** |
| `user` | Shared + personal(`owner_user_id`) |

**Forbidden layouts / mounts under multi-scope:**

- Mounting every `users/*/vault/` into a tenant sandbox  
- Mounting another user's personal prefix into a user sandbox  
- Prefixes derived from `sandbox_id` or chat/thread id  
- Putting personal durable data only under shared without ACL + mount isolation (rejected as sole personal path)

**CP field intent** (formal schema in `lp-zoh.2`):

| Field | When set |
|-------|----------|
| `s3_shared_vault_prefix` | Always for multi-scope instances: `tenants/{tid}/vault/shared/` |
| `s3_personal_vault_prefix` | `scope=user` only: `tenants/{tid}/users/{uid}/vault/`; **null** for `scope=tenant` |
| Legacy `s3_vault_prefix` | Pre-migration single root; treat as shared-equivalent until `lp-zoh.10` |

**Migration from single root** (`lp-zoh.10`):

- Existing objects under `tenants/{tid}/vault/` (except reserved siblings) become **shared** content — rename into `vault/shared/` or alias `vault/` as shared until cutover complete.  
- New personal prefixes start empty (optional seed).  
- Do not invent a second tenant bucket.

**Validation shapes (multi-scope addition):**

| Check | Pass criterion |
|-------|----------------|
| Shared | `^tenants/[^/]+/vault/shared/$` |
| Personal | `^tenants/[^/]+/users/[^/]+/vault/$` |
| `user_id` segment | Single opaque segment; matches `owner_user_id` for personal mount |
| Legacy single-root | `^tenants/[^/]+/vault/$` still valid until migration completes |

### Optional multi-instance vault (exception path)

Default product path remains **tenant-scoped**. Only if a tenant needs **separate durable vaults per gateway instance** (rare multi-brain / isolation product decision):

```text
tenants/{tenant_id}/instances/{instance_id}/vault/
```

| Rule | Detail |
|------|--------|
| When | Explicit product flag / registry field — not default on register |
| Still forbidden | Any prefix containing `sandbox_id` or host-local paths |
| IAM | Still scoped to the exact prefix string stored on the instance row |
| Primary instance | Product still designates one primary for BFF routing; each instance mounts **only** its own prefix |

Until multi-instance vaults are a named product requirement, provision **must** use the tenant-scoped form.

### Rejected layouts

| Layout | Why rejected |
|--------|----------------|
| `{sandbox_id}/…` | Ephemeral; idle stop / recreate loses or forks vault |
| `{instance_id}/…` only (no tenant segment) | Harder ops inventory; weakens tenant-first ACL review |
| Flat bucket keys without tenant boundary | Cross-tenant list risk; IAM harder |
| Shared `shared/` or `global/` **bucket-level** (or cross-tenant) under agent-mounted prefix | Cross-tenant data plane leak via one sandbox role |
| Mixing `BACKEND_HOME` runtime state into the vault prefix | Secrets, oauth, logs must not be Mountpoint tenant vault content |
| Personal vault under chat/thread id | Sandbox-per-chat rejected; identity churn |
| All personal vaults under one tenant mount | Collapses personal isolation (`lp-zoh.1`) |

**Note:** Per-tenant key `tenants/{tid}/vault/shared/` is the **chosen** multi-scope shared root (not a cross-tenant `shared/`). The rejected row above is about **cross-tenant** shared/global mounts, not the in-tenant shared vault.

## What lives under the prefix

Mountpoint mounts `s3_vault_prefix` at the guest path that becomes **`VAULT_ROOT`** (see `contracts/backend-runtime-v1/filesystem-layout.md`). Vault-relative paths in Brain RPC are **relative to this root**, not absolute host paths and not full S3 keys.

### Expected content plane (product vault)

Mirrors **client-core** seed shape (live content is tenant data; seed is scaffold):

```text
{VAULT_ROOT}/                    ← mount of s3://…/tenants/{tenant_id}/vault/
  AGENTS.md
  INDEX.md
  index.yaml
  Knowledge/
  Clients/
  Projects/
  memory/
  skills/                        ← vault/client-core skills (not BACKEND_HOME/skills)
  … (tenant-created trees)
```

Platform does **not** invent a second parallel tree for Daytona. EC2 host disk vault and Daytona Mountpoint vault present the same logical `VAULT_ROOT` contract to the agent guest.

### Explicitly out of the vault prefix

| Material | Where instead |
|----------|----------------|
| Relay secret / `GATEWAY_RELAY_*` | Wake inject (Bucket C); not S3 vault objects |
| Daytona API credentials | Never on guest; orchestrator only |
| `BACKEND_HOME` (config, oauth, logs, sessions, workspace) | Ephemeral sandbox disk or separate non-tenant mount — **not** under `tenants/…/vault/` |
| Agent product binaries / CLIs | Snapshot image (Bucket A) |
| CP Postgres identity rows | Control Plane DB (prefix **ref** only) |

### Platform-only keys (optional, never on guest mount)

If ops needs markers or inventory objects, they must **not** sit under the mounted vault root. Reserved sibling under the tenant (not mounted by default):

```text
tenants/{tenant_id}/_platform/     # optional; never include in s3_vault_prefix
  bootstrap.json                   # e.g. seed version, provision timestamp
```

Guest IAM for the sandbox role must **deny** `_platform/` (or simply never grant it). Default `s3_vault_prefix` remains `tenants/{tenant_id}/vault/` only.

## Seed and bootstrap expectations

Offline: design only. No live `aws s3` or TF.

### When

| Event | Expectation |
|-------|-------------|
| **Provision** (`runtime_kind=daytona`) | Assign `s3_vault_prefix`; ensure prefix “exists” (see below); set presence `offline`; `sandbox_id = null` |
| **First `ensure_online`** | Mount existing prefix; do **not** reassign prefix |
| **Idle stop / recreate** | Same prefix remounted; vault bytes durable |
| **Offboard** | Access removal always; vault **retain** by default — [vault-s3-retain-vs-gc.md](./vault-s3-retain-vs-gc.md) (`lp-zmg`) |

### Ensure prefix exists

At provision (platform automation — **helper shipped in `lp-jt5`**):

1. Validate `tenant_id` is a single path segment (reject `/`, `..`, empty).  
2. Compute `s3_vault_prefix = tenants/{tenant_id}/vault/`.  
3. Persist on the gateway instance (and/or tenant) row.  
4. **Idempotent prefix marker (`lp-jt5`):** write platform-only  
   `tenants/{tenant_id}/_platform/vault-prefix-ensured.json` if missing  
   (never under the mounted vault root). Implementation:  
   `@lanyard/control-plane` → `ensureVaultPrefixForDaytonaProvision` /  
   `ensureTenantVaultPrefix` (inject `VaultObjectStore`; unit tests use  
   `FakeS3ObjectStore`). Safe to re-run; does not seed content.  
5. **Idempotent seed (`lp-9o6`, optional):** if a seed pack is supplied **and**  
   the vault is empty, install client-core seed scaffold (same semantics as  
   `client-core/scripts/seed-vault.sh`: non-destructive re-run; do not overwrite  
   existing `AGENTS.md` / tenant content). **Seed is optional** — omitting the  
   pack leaves an empty, still agent-usable vault (prefix marker only).  
   Implementation: `@lanyard/control-plane` → `bootstrapTenantVaultSeed` /  
   `bootstrapVaultForDaytonaProvision` (prefix ensure + optional seed).  
6. When seed applies: write `tenants/{tenant_id}/_platform/bootstrap.json` with  
   seed pin version (not mounted) plus in-vault `.seed/provenance.json`  
   (parity with seed-vault.sh).  

Empty-prefix detection for **seed**: absence of platform `bootstrap.json`  
**and** vault-root `AGENTS.md` under the vault prefix (either gates re-seed).  
Prefix **ensure** uses the platform `vault-prefix-ensured.json` marker only.

**No cross-tenant copy:** seed bytes come only from a caller-supplied pack  
(`VaultSeedObject[]`). The helper never lists/copies another tenant’s S3  
prefix; all puts resolve under `tenants/{tenant_id}/vault/` after path  
validation (reject `..`, absolute keys, `tenants/…` escapes).

### Bootstrap failure modes (design)

| Failure | Handling |
|---------|----------|
| Seed fails after prefix assigned | Instance remains provisioned with prefix; ops can re-run seed; do not mint a second prefix |
| Mount fails at wake | Presence → `error`; keep prefix; do not create alternate prefix |
| Wrong prefix injected | Treat as severe bug; never fall back to bucket root |

## Mount and path mapping

```text
s3://{bucket}/tenants/{tenant_id}/vault/   +   relative key "Knowledge/foo.md"
        │
        ▼  S3 Mountpoint (V1b)
{VAULT_ROOT}/Knowledge/foo.md
        │
        ▼  Brain RPC vault.*
path: "Knowledge/foo.md"   (vault-root-relative; L5 ACL on path_allowed)
```

| Rule | Detail |
|------|--------|
| Agent sees | Local filesystem under `VAULT_ROOT` only |
| Agent must not | Receive raw bucket name as a write target outside mount; call S3 APIs with broad keys |
| Orchestrator | Passes mount of **exactly** the instance’s `s3_vault_prefix` |
| Path traversal | Host `normalize_vault_path` rejects `..`; IAM still limits to prefix even if guest misbehaves |

## Anti cross-tenant access (normative)

These rules are the offline contract for layout + for IAM draft `lp-kng.2.5`.

### Layout-level

1. **Tenant segment is mandatory.** Every durable vault object key for product data starts with `tenants/{tenant_id}/`.  
2. **One sandbox = only authorized prefix set for that instance.** Single-root path: one prefix (`s3_vault_prefix`). Multi-scope: tenant instance → shared only; user instance → shared + own personal. **Never multi-tenant** mounts on one sandbox. **Never** all personal vaults on a tenant sandbox.  
3. **No cross-tenant shared product prefixes** under the guest mount (no `tenants/_all/`, no sibling tenant listing via relative paths). In-tenant `vault/shared/` is allowed and expected under plan 0010.  
4. **Prefix immutability.** Do not “move” a tenant’s vault by changing stored prefixes casually; migration is an explicit ops procedure (`lp-zoh.10` for single-root → dual-root).  
5. **Identity separation.** `sandbox_id` never appears in vault keys; `instance_id` appears only in the optional multi-instance exception path; chat/thread ids never appear in vault keys.

### Orchestrator / CP-level

1. Resolve prefix **only** from the CP row for the `instance_id` being woken — never from client-supplied S3 paths.  
2. On `ensure_online`, refuse wake if `s3_vault_prefix` is missing, empty, or fails validation (`tenants/{id}/vault/` shape).  
3. Log `tenant_id` + `instance_id` + prefix hash/ref; do not log vault object bodies.  
4. Webhooks map `sandbox_id` → instance row; they never recompute vault location from Daytona metadata alone.

### IAM-level (draft — detail in `lp-kng.2.5`)

Normative draft: **[iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md)** + JSON under [drafts/iam/](./drafts/iam/) (**not applied** offline).

1. Sandbox role credentials: `s3:ListBucket` conditioned on `s3:prefix = tenants/{tenant_id}/vault/*` (and exact prefix).  
2. Object actions (`GetObject`, `PutObject`, `DeleteObject`, multipart as needed) only on `arn:…:object/tenants/{tenant_id}/vault/*`.  
3. **Deny** list without prefix / list outside bound prefix; deny guest access to `_platform/`.  
4. Platform admin roles (backup, seed pipeline) are separate from sandbox guest roles.  
5. No long-lived guest credentials in the image; inject short-lived mount material at wake (Bucket C).

### Validation checklist (prefix string)

| Check | Pass criterion |
|-------|----------------|
| Shape (single-root / legacy) | `^tenants/[^/]+/vault/$` (default) or `^tenants/[^/]+/instances/[^/]+/vault/$` (exception) |
| Shape (multi-scope shared) | `^tenants/[^/]+/vault/shared/$` |
| Shape (multi-scope personal) | `^tenants/[^/]+/users/[^/]+/vault/$` |
| `tenant_id` segment | Matches CP tenant id; no `.`, `..`, empty, or encoded `/` |
| `user_id` segment (personal) | Matches instance `owner_user_id` when mounting personal |
| No sandbox id | String must not contain the current or historical `sandbox_id` as a segment |
| Trailing slash | Required for consistent IAM prefix matching |
| Bucket | From platform config only; guest never chooses bucket |

## Alignment with identity model (`lp-707`)

| Identity doc rule | This layout |
|-------------------|-------------|
| `s3_vault_prefix` durable until offboard | Prefix assigned at provision; kept across idle stop |
| Not derived from `sandbox_id` | Keys use `tenant_id` (+ optional `instance_id`) only |
| Tenant-scoped default | `tenants/{tenant_id}/vault/` |
| IAM scoped to prefix | Required; policy JSON in `lp-kng.2.5` |
| Vault bytes not in CP Postgres | CP stores prefix ref; objects live under prefix |
| Guest model | Agent mounts path; does not manage S3 layout or Daytona |
| EC2 vs Daytona | Same logical `VAULT_ROOT`; EC2 may use host disk while Daytona uses this prefix |

## Field and config sketch (for `lp-nye` / provision)

| Surface | Value |
|---------|--------|
| CP `s3_vault_prefix` | `tenants/{tenant_id}/vault/` |
| Platform config `vault.bucket` | Lab: `lanyard-mocklab-vault-123456789012`; product: `lanyard-vault-{env}` |
| Platform config `vault.region` | `us-east-1` (lab proven); match bucket region |
| Env at wake | `VAULT_ROOT=/mnt/vault` (entrypoint + orchestrator default); Mountpoint source = bucket + prefix |
| Seed pin | client-core pack/version recorded in bootstrap marker or provision audit |

Exact env names: gateway env contract `lp-vey`. Mount create/start params: **`lp-hjo`** — code `portal/packages/control-plane/src/sandbox-vault-mount.ts` (`buildSandboxVaultMountParams`): create request carries `mounts[{ s3Prefix, mountPath, s3Bucket? }]` with `mountPath === env.VAULT_ROOT` (default `/mnt/vault`), plus helper env `S3_VAULT_PREFIX` / optional `LANYARD_VAULT_BUCKET`. Fake/contract tests in `sandbox-vault-mount.test.ts`.

## Encryption and bucket policy sketch (`lp-0fq`)

Normative **bucket-level** controls for the platform vault bucket. Guest **IAM** remains in [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md) / `lp-t86`. Draft JSON: [drafts/s3/vault-bucket-policy.json](./drafts/s3/vault-bucket-policy.json).

### Encryption defaults

| Setting | Pilot / lab default | Production intent |
|---------|---------------------|-------------------|
| Server-side encryption | **SSE-S3** (`AES256`) bucket default | Prefer **SSE-KMS** with a **platform** CMK (`alias/lanyard-vault-{env}`) |
| Bucket default encryption | **Required** on create / ensure | Same |
| Bucket Key (SSE-KMS) | N/A for SSE-S3 | Enable S3 Bucket Key to reduce KMS cost |
| Tenant CMK / BYOC | **Out of scope** V1b | Phase 9 deferred |
| Client-side encryption | Not required | Not required for V1b Mountpoint path |
| Enforce SSE on PutObject | Optional deny if `s3:x-amz-server-side-encryption` missing | Recommended when using SSE-KMS so clients cannot omit SSE; SSE-S3 default encryption already covers untagged puts |

**Sandbox / Mountpoint implication:** with SSE-S3, mount sessions need only S3 object APIs (existing IAM draft). With SSE-KMS, sandbox session + seed roles also need `kms:Decrypt` / `kms:GenerateDataKey` on the platform vault key (see IAM doc § Optional KMS).

**No secrets in objects metadata beyond tenant data** — encryption protects at rest; access control remains prefix IAM + no public ACL.

### Public access: **forbidden**

| Control | Required value | Notes |
|---------|----------------|-------|
| S3 Block Public Access (account or bucket) | **All four** settings **ON** | BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets |
| Object Ownership | **BucketOwnerEnforced** | Disables object ACLs; owner is always bucket owner |
| Object / bucket ACLs | **None public** | Do not grant `AllUsers` / `AuthenticatedUsers`; prefer ACLs off entirely |
| Static website hosting | **Off** | Vault is not a public content origin |
| Bucket policy principals | Platform account principals only | No `"Principal": "*"` Allow |

Any apply that leaves Block Public Access off or attaches a public-read ACL/policy is a **failed** vault bucket ensure.

### Bucket policy sketch (resource policy)

Attach to the vault bucket (in addition to identity policies). Goals: TLS-only, deny public, optional SSE enforcement.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::${LANYARD_VAULT_BUCKET}",
        "arn:aws:s3:::${LANYARD_VAULT_BUCKET}/*"
      ],
      "Condition": {
        "Bool": { "aws:SecureTransport": "false" }
      }
    },
    {
      "Sid": "DenyPublicReadAcls",
      "Effect": "Deny",
      "Principal": "*",
      "Action": ["s3:PutObject", "s3:PutObjectAcl", "s3:PutBucketAcl"],
      "Resource": [
        "arn:aws:s3:::${LANYARD_VAULT_BUCKET}",
        "arn:aws:s3:::${LANYARD_VAULT_BUCKET}/*"
      ],
      "Condition": {
        "StringEquals": {
          "s3:x-amz-acl": [
            "public-read",
            "public-read-write",
            "authenticated-read"
          ]
        }
      }
    }
  ]
}
```

Optional (SSE-KMS prod): add `DenyIncorrectEncryptionHeader` / `DenyUnEncryptedObjectUploads` as in [drafts/s3/vault-bucket-policy.json](./drafts/s3/vault-bucket-policy.json).

**Note:** Bucket policy is **not** a substitute for per-tenant session policies. Cross-tenant isolation is still identity-policy prefix scope (`lp-t86`). Bucket policy hardens the shared bucket envelope.

### Other bucket settings (Phase 3 apply)

| Setting | Design |
|---------|--------|
| Versioning | **Optional** for pilot; enable if ops wants undelete. Product revision remains host content-hash CAS |
| Lifecycle / delete | Default **retain** on deprovision for pilot — normative policy: [vault-s3-retain-vs-gc.md](./vault-s3-retain-vs-gc.md) (`lp-zmg`); no auto-purge of tenant prefixes without explicit optional GC |
| Logging / metrics | Ops choice; server access logs to a separate non-vault log bucket (also private) |
| Replication | Ops choice; must not widen guest IAM |
| CORS | Not required for Mountpoint server-side access |
| Dual-run EC2↔Daytona | Preserve **same** prefix or explicit cutover; never invent sandbox-scoped forks |

### Lab bucket inventory (no secrets)

| Field | Value |
|-------|--------|
| Bucket | `lanyard-mocklab-vault-123456789012` |
| Account | `123456789012` |
| Region | `us-east-1` |
| Example prefix | `tenants/mocklab/vault/` |
| Evidence | [spike-3en-s3-vault-mount.md](./spike-3en-s3-vault-mount.md) — Mountpoint R/W; durability after sandbox stop |
| Ensure bead | **`lp-d26` closed** — [pilot-lab-s3-vault-bucket.md](./pilot-lab-s3-vault-bucket.md); do **not** destroy |

#### Lab envelope verified (`lp-d26`, 2026-08-05)

| Control | Observed |
|---------|----------|
| Default encryption | SSE-S3 `AES256`, `BucketKeyEnabled=true` |
| Block Public Access | All four ON |
| Object Ownership | `BucketOwnerEnforced` |
| Bucket policy | None attached (draft optional; not required for pilot ensure) |
| Operator access | `AWS_PROFILE=lanyard-main` / `lanyard-portal-terraform` HeadBucket + R/W under pilot prefix |
| Re-check | `deploy/scripts/smoke-pilot-lab-s3-vault-bucket.sh` (offline default; `SMOKE_PILOT_VAULT_LIVE=1` for live) |

Full ensure + access notes, OPERATOR HOLD constraints, and non-goals: **[pilot-lab-s3-vault-bucket.md](./pilot-lab-s3-vault-bucket.md)**.

## Lifecycle notes (pointers)

| Topic | Owner |
|-------|--------|
| Encryption + no public ACL | **This doc** (`lp-0fq`) |
| Pilot/lab bucket ensure + access | `lp-d26` → [pilot-lab-s3-vault-bucket.md](./pilot-lab-s3-vault-bucket.md) + `deploy/scripts/smoke-pilot-lab-s3-vault-bucket.sh` |
| Retain vs GC on deprovision | [vault-s3-retain-vs-gc.md](./vault-s3-retain-vs-gc.md) (`lp-zmg`; default retain for pilot) |
| Prefix ensure + seed | `lp-jt5` (`ensureVaultPrefixForDaytonaProvision`), optional seed `lp-9o6` (`bootstrapVaultForDaytonaProvision` / `bootstrapTenantVaultSeed` in control-plane) |
| IAM mount credentials | `lp-t86` + [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md) + `deploy/scripts/smoke-sandbox-vault-mount-iam.sh` |

## Out of scope (this bead)

- Terraform / AWS CLI apply (siblings under `lp-eto`)  
- IAM session/identity policy apply (`lp-t86` — drafts already exist offline)  
- ~~Idempotent prefix create helper + tests (`lp-jt5`)~~ → **shipped**:  
  `portal/packages/control-plane/src/vault-prefix.ts` + `fake-s3-object-store.ts`  
  + `test/vault-prefix.test.ts`  
- ~~Optional client-core seed bootstrap (`lp-9o6`)~~ → **shipped**:  
  `portal/packages/control-plane/src/vault-seed.ts` + `test/vault-seed.test.ts`  
- Orchestrator Mountpoint create/start params (`lp-hjo`)  
- Destroy or recreate lab mocklab bucket  
- Changing Brain RPC path ACLs (still vault-root-relative)  
- BYOC customer-owned buckets (Phase 9 deferred)

## Acceptance evidence

### `lp-kng.2.4` (offline — closed)

- [x] Doc under `docs/plans/0008-daytona-agent-sandboxes/` — this file  
- [x] Prefix rules + anti cross-tenant access notes — **Final scheme**, **Anti cross-tenant access**  
- [x] Aligns with identity doc `lp-707` — **Alignment with identity model**; default `tenants/{tenant_id}/vault/`  

### `lp-0fq` (Phase 3 design)

- [x] **Layout doc committed** — this file (refined under Phase 3 epic `lp-eto`)  
- [x] **Encryption and bucket policy sketch** — [Encryption and bucket policy sketch](#encryption-and-bucket-policy-sketch-lp-0fq) + [drafts/s3/vault-bucket-policy.json](./drafts/s3/vault-bucket-policy.json)  
- [x] **No public ACL** — Block Public Access all-on, BucketOwnerEnforced, deny public ACLs in bucket policy sketch; lab bucket inventory documented  

## References

- [identity-model.md](./identity-model.md) — §2.3 identifiers and lifetimes  
- [overview.md](./overview.md) — V1b, guest/prebake, deploy split  
- [offline-piping.md](./offline-piping.md) — offline track rules  
- [spike-3en-s3-vault-mount.md](./spike-3en-s3-vault-mount.md) — lab Mountpoint proof  
- `contracts/backend-runtime-v1/filesystem-layout.md` — `VAULT_ROOT`  
- `client-core/scripts/seed-vault.sh` — seed idempotency semantics  
- `portal/packages/control-plane/src/vault-seed.ts` — optional S3 seed bootstrap (`lp-9o6`)  
- [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md) — IAM scoped mount policy draft (`lp-kng.2.5` / `lp-t86`)  
- [drafts/s3/vault-bucket-policy.json](./drafts/s3/vault-bucket-policy.json) — bucket resource policy template  
- [pilot-lab-s3-vault-bucket.md](./pilot-lab-s3-vault-bucket.md) — lab bucket ensure + access (`lp-d26`)
