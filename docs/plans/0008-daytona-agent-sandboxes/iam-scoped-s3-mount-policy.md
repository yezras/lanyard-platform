# IAM scoped S3 mount policy (per-tenant sandbox credentials)

**Beads:** `lp-kng.2.5` (offline draft) · **`lp-t86`** (Phase 3: policy template + lifetime/rotation + cross-tenant review)  
**Parents:** `lp-kng.2` (Offline piping) · **`lp-eto`** (Phase 3: Vault on Lanyard S3 V1b)  
**Depends on:** [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) (`lp-kng.2.4` / `lp-0fq`), [identity-model.md](./identity-model.md) (`lp-707`)  
**Follow-on:** `lp-hjo` (orchestrator mount params), `lp-jt5` (prefix create), `lp-m2z` (security review), live apply after human gates  
**Related:** [offline-piping.md](./offline-piping.md), [gateway-env-contract.md](./gateway-env-contract.md) (Bucket C wake inject), [overview.md](./overview.md) (V1b Mountpoint), [spike-3en-s3-vault-mount.md](./spike-3en-s3-vault-mount.md)

## Status

| Track | Scope |
|-------|--------|
| **Offline (`lp-kng.2.5`)** | First draft of this document + JSON under `drafts/iam/`. |
| **Phase 3 template (`lp-t86`)** | **Canonical policy templates** for per-tenant prefix scope; credential lifetime/rotation notes; offline cross-tenant isolation review + smoke. Still **do not** auto-apply from CI. |
| **TF apply (`lp-zuh.9.1`)** | Module `deploy/modules/sandbox-vault-mount-iam` creates shared base role `lanyard-sandbox-vault-mount` (trust: CP task role only), upper-bound identity on vault bucket, CP task `sts:AssumeRole` grant, session policy template. Lab root: `deploy/deployments/lab-sandbox-vault-mount-iam/`. No long-lived keys. |
| **Live apply** | Lab: apply lab root with `AWS_PROFILE=lanyard-main`. Full staging compose remains subject to OPERATOR HOLD. CP mint/inject is `lp-zuh.9.2` (`sandbox-vault-mount-sts.ts` + orchestrator `buildCreateParams`). Never commit keys. |

> **No secrets in git.** Templates use placeholders only. Do not paste access keys, session tokens, or secret ARNs into this repo, bead notes, or PR bodies.

## Purpose

Define the **minimum IAM** that a Daytona sandbox (or its Mountpoint helper) needs to read/write **one tenant vault prefix** and nothing else:

1. Match the locked layout from `lp-0fq` / `lp-kng.2.4`: `tenants/{tenant_id}/vault/`  
2. Prefer **short-lived** credentials injected at wake (Bucket C) — not long-lived keys in the agent image  
3. Separate **sandbox mount** principal from **platform seed/admin** principal  
4. Provide copy-paste JSON templates for later Terraform / STS issuance (`lp-hjo` consumes the contract)

## Layout binding (normative — from `lp-0fq`)

| Item | Value |
|------|--------|
| Bucket | Platform-owned; product `lanyard-vault-{env}`; lab pilot `lanyard-mocklab-vault-123456789012` |
| Default prefix | `tenants/{tenant_id}/vault/` (trailing slash) |
| Optional multi-instance | `tenants/{tenant_id}/instances/{instance_id}/vault/` |
| Never in guest grant | `tenants/{tenant_id}/_platform/`, other tenants, bucket root list without prefix condition |
| CP field | `s3_vault_prefix` — **source of truth** for the policy resource path |

Full object URI shape:

```text
s3://{lanyard_vault_bucket}/tenants/{tenant_id}/vault/{vault_relative_path}
```

IAM object ARNs use the S3 object key **without** a leading slash and typically **with** a trailing `*` for tree access:

```text
arn:aws:s3:::${LANYARD_VAULT_BUCKET}/tenants/${TENANT_ID}/vault/*
```

ListBucket uses the **bucket ARN** plus a `s3:prefix` condition (not the object ARN).

## Recommended delivery model (wake inject)

| Pattern | When | Notes |
|---------|------|--------|
| **A. STS AssumeRole + session policy** (recommended) | Default V1b | Platform orchestrator (or a tightly scoped issuer) assumes a base sandbox-mount role and attaches a **session policy** locking the session to one `s3_vault_prefix`. Creds injected at `ensure_online` (Bucket C). TTL short; re-issue on wake. |
| **B. Per-tenant IAM role** | If product wants durable role ARNs per tenant | Same permission document as session policy, baked into a role named per tenant. Still inject temporary keys or instance-profile-style material at wake — **never** bake long-lived access keys into the snapshot. |
| **C. Shared broad role** | **Rejected** | Any role that can list/read `tenants/*` for all tenants fails isolation. |

Sandbox guest process default: use Mountpoint with injected creds so the **agent binary never holds raw S3 SDK credentials** if avoidable (gateway uses local `VAULT_ROOT` only). See [gateway-env-contract.md](./gateway-env-contract.md).

## Placeholders (templates)

| Placeholder | Meaning |
|-------------|---------| 
| `${AWS_ACCOUNT_ID}` | Platform AWS account |
| `${AWS_REGION}` | Region of the vault bucket |
| `${LANYARD_VAULT_BUCKET}` | e.g. `lanyard-vault-staging` or lab `lanyard-mocklab-vault-123456789012` |
| `${TENANT_ID}` | CP tenant id (single path segment; no `/`, `..`) |
| `${INSTANCE_ID}` | Only for multi-instance exception prefix |
| `${S3_VAULT_PREFIX}` | Exact CP string, e.g. `tenants/abc-123/vault/` |
| `${ORCHESTRATOR_ROLE_ARN}` | Role that may call `sts:AssumeRole` to mint mount sessions |
| `${SANDBOX_MOUNT_ROLE_NAME}` | e.g. `lanyard-sandbox-vault-mount` (shared base) or per-tenant name |
| `${OPTIONAL_EXTERNAL_ID}` | Optional AssumeRole ExternalId shared only with orchestrator |

## Sandbox mount permission set (allow)

Minimum actions for S3 Mountpoint V1b (read/write vault files):

| Action | Resource | Condition |
|--------|----------|-----------|
| `s3:ListBucket` | `arn:aws:s3:::${LANYARD_VAULT_BUCKET}` | `s3:prefix` ∈ { `${S3_VAULT_PREFIX}`, `${S3_VAULT_PREFIX}*` } (prefix string always trailing slash) |
| `s3:GetBucketLocation` | bucket ARN | Optional; some mount helpers need it |
| `s3:GetObject` | `…/tenants/${TENANT_ID}/vault/*` | — |
| `s3:PutObject` | same object ARN pattern | — |
| `s3:DeleteObject` | same | — |
| `s3:AbortMultipartUpload` | same | Mountpoint / large files |
| `s3:ListMultipartUploadParts` | same | — |
| `s3:ListBucketMultipartUploads` | bucket ARN | Prefix condition if supported; else omit until Phase 3 proves need |

**Not granted to sandbox:**

- `s3:ListBucket` without prefix condition  
- Any key under `tenants/${OTHER_TENANT_ID}/`  
- `tenants/${TENANT_ID}/_platform/*`  
- Bucket-level `s3:PutBucket*`, ACL, policy, lifecycle, replication  
- `s3:GetObject` on artifact / other platform buckets  
- Broad `s3:*`  

### Optional KMS (if SSE-KMS)

If the vault bucket uses a platform CMK ([s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) encryption sketch):

```text
kms:Decrypt, kms:Encrypt, kms:GenerateDataKey
  resource: platform vault key ARN
  condition: via service s3.${region}.amazonaws.com / encryption context as apply defines
```

Pilot lab default is **SSE-S3** — no KMS grant required for Mountpoint. Do **not** grant kms on customer CMKs for V1 managed path unless product requires it later.

## Explicit deny (defense in depth)

Even when allows are tight, attach denies so a policy merge bug cannot widen access:

1. Deny `s3:*` on `arn:aws:s3:::${LANYARD_VAULT_BUCKET}/tenants/*` when the key is **not** under the bound vault prefix.  
2. Deny any access to `…/tenants/${TENANT_ID}/_platform/*`.  
3. Deny `s3:ListBucket` when `s3:prefix` is missing or not under the bound prefix (IAM condition operators; see JSON).  
4. Deny credentials that attempt cross-account vault access (optional `aws:ResourceAccount`).

## Platform seed / admin (separate principal)

| Principal | Purpose | Scope |
|-----------|---------|--------|
| **Sandbox mount** (this template) | Guest Mountpoint I/O for one vault | Exactly one `s3_vault_prefix` |
| **Platform seed / provision** | Idempotent seed, `_platform/bootstrap.json`, inventory | Write `tenants/{id}/vault/*` **and** optional `tenants/{id}/_platform/*`; may List with tenant prefix; still not whole-bucket anonymous |
| **Platform backup / DR** | Replication, restore drills | Separate role; never injected into sandbox |

Seed role is **not** injected into the guest. Orchestrator/CI uses it during provision (`lp-jt5` / `lp-9o6`).

## Policy templates (deploy or docs)

Canonical location (planning shell — copy into Terraform `aws_iam_*` documents at apply time):

| File | Role |
|------|------|
| [drafts/iam/sandbox-vault-mount-session-policy.json](./drafts/iam/sandbox-vault-mount-session-policy.json) | **Session policy** template for STS (recommended path A) |
| [drafts/iam/sandbox-vault-mount-identity-policy.json](./drafts/iam/sandbox-vault-mount-identity-policy.json) | Identity/managed policy body (same allows + denies) for per-tenant or base role |
| [drafts/iam/sandbox-vault-mount-trust-policy.json](./drafts/iam/sandbox-vault-mount-trust-policy.json) | Trust: only orchestrator role may AssumeRole |
| [drafts/iam/platform-vault-seed-policy.json](./drafts/iam/platform-vault-seed-policy.json) | Platform seed/admin (**not** guest) |

Offline isolation smoke (no AWS):

```bash
bash deploy/scripts/smoke-sandbox-vault-mount-iam.sh
```

All files use string placeholders. Substituting values still **does not** apply them.

## Inline session policy (canonical example)

Default product path: `S3_VAULT_PREFIX = tenants/${TENANT_ID}/vault/`.

Canonical copy lives in `drafts/iam/sandbox-vault-mount-session-policy.json`. Summary of controls:

| Statement | Effect |
|-----------|--------|
| `ListOnlyBoundVaultPrefix` | Allow ListBucket / GetBucketLocation only when `s3:prefix` is under `tenants/${TENANT_ID}/vault/` |
| `ObjectRWBoundVaultPrefix` | Allow Get/Put/Delete + multipart on `…/tenants/${TENANT_ID}/vault/*` only |
| `DenyListBucketWithoutPrefix` | Deny ListBucket when `s3:prefix` is null (no whole-bucket list) |
| `DenyListBucketOutsideBoundVaultPrefix` | Deny ListBucket for any other prefix |
| `DenyPlatformSiblingUnderTenant` | Deny all S3 on `tenants/${TENANT_ID}/_platform/*` |

**Primary isolation** is tight Allow (no broader resource ARNs). Deny statements are defense in depth. Validate with `iam simulate-principal-policy` before any live attach; offline: run the smoke script above.

### Multi-instance exception

When CP stores `s3_vault_prefix = tenants/${TENANT_ID}/instances/${INSTANCE_ID}/vault/`, substitute that full prefix in ListBucket `s3:prefix` and object Resource ARNs. Still never include `sandbox_id`.

## Trust policy sketch (base mount role)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OrchestratorAssumeOnly",
      "Effect": "Allow",
      "Principal": {
        "AWS": "${ORCHESTRATOR_ROLE_ARN}"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "${OPTIONAL_EXTERNAL_ID}"
        }
      }
    }
  ]
}
```

Wake path (design — issuance from CP / orchestrator):

1. CP resolves `instance_id` → `tenant_id` + `s3_vault_prefix` (never client-supplied S3 paths).  
2. Orchestrator validates prefix shape (`^tenants/[^/]+/vault/$` or multi-instance form).  
3. Orchestrator assumes `${SANDBOX_MOUNT_ROLE_NAME}` with **session policy** rendered from that prefix only.  
4. Inject temporary keys + region + bucket + mount path into sandbox (Bucket C).  
5. Entrypoint waits for Mountpoint → starts gateway.  
6. On idle stop, drop credentials with the sandbox; next wake mints a **new** session.

---

## Credential lifetime and rotation (`lp-t86`)

Normative guidance for product and ops. No long-lived guest AWS keys.

### Session credentials (path A — default)

| Parameter | Pilot / product default | Rationale |
|-----------|-------------------------|-----------|
| **STS `DurationSeconds`** | **900–3600** (15m–1h); pilot start **3600** | Matches lab spikes (`lp-3en` ~30m); long enough for a chat wake + idle grace; short enough to bound leak blast radius |
| **Minimum** | 900 (STS floor for AssumeRole) | Do not request longer than needed |
| **Maximum product** | 3600 unless a measured wake exceeds TTL | If Mountpoint needs longer continuous I/O, re-assume before expiry rather than multi-hour sessions |
| **Session name** | `lanyard-vault-{tenant_id_short}-{instance_id_short}-{wake_id}` (AWS 64-char limit) | Audit correlation; no secrets in the name |
| **Session policy** | Rendered per wake from CP `s3_vault_prefix` | Isolation boundary; never reuse another tenant’s policy document |
| **Where stored** | Sandbox process env / tmp only (Bucket C inject) | **Never** snapshot image, git, CP Postgres plaintext, or chat logs |
| **On idle stop** | Credentials discarded with sandbox FS | Next `ensure_online` mints new STS |
| **On wake failure** | Do not leave half-injected keys in a reusable sandbox | Fail closed → presence `error`; retry issues new session |

**Re-issue / rotation of sessions:**

1. **Every wake** (`ensure_online` cold create or start-from-stopped): mint new STS. Do not cache guest keys across stops.  
2. **TTL expiry while online:** orchestrator may re-assume and re-inject only if product adds a refresh path; V1 pilot may treat expiry as mount failure → error + next wake. Prefer TTL ≥ expected continuous online window (idle reaper + chat).  
3. **Compromise / leak suspicion:** invalidate by (a) stopping sandboxes for the tenant, (b) rotating optional ExternalId / orchestrator role trust, (c) denying the base mount role until reviewed. Session keys cannot be “revoked” individually beyond expiry + role policy change.

### Base mount role (shared or per-tenant)

| Concern | Policy |
|---------|--------|
| **Shared base role** (`lanyard-sandbox-vault-mount`) | Identity policy may be a **union upper bound** only if session policy is **always** attached and is the real scope; prefer base role with **no S3 access** and all S3 power only in session policy (strictest). If base has S3 allows, they must still be non-broad (or empty) so a missing session policy cannot open `tenants/*`. |
| **Per-tenant role** (path B) | Role name embeds tenant id; identity policy = bound prefix. Still issue **temporary** credentials at wake (AssumeRole or equivalent); do not ship static AKIA keys. |
| **Trust** | Only `${ORCHESTRATOR_ROLE_ARN}` (+ optional ExternalId). No `Principal: *`, no GitHub OIDC for guest mount minting. |
| **Role credential rotation** | Rotate orchestrator role keys/roles per platform IAM hygiene; rotate ExternalId on incident; update trust policy. Tenant vault **data** rotation is out of band (content), not IAM. |

### What must never be long-lived in the guest

| Material | Lifetime |
|----------|----------|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` for vault mount | STS session only; wake → stop |
| Relay `GATEWAY_RELAY_SECRET` | Instance lifetime (separate product secret; rotate via CP) — **not** S3 mount |
| Snapshot / ECR image | **No** AWS vault keys baked in |
| Daytona API key | Orchestrator only; never guest |

### Operator rotation checklist (no secrets)

1. Confirm templates still match [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md).  
2. Run `bash deploy/scripts/smoke-sandbox-vault-mount-iam.sh`.  
3. Before attach: `aws iam simulate-principal-policy` allow bound key / deny other tenant / deny `_platform`.  
4. After attach: mint one lab session; prove AccessDenied on foreign prefix (as in `lp-3en`).  
5. Document role ARN names in platform config — not in agent env beyond temporary session fields.

---

## Cannot read other tenant prefixes (review)

### Normative isolation rules

| Rule | Enforcement in templates |
|------|---------------------------|
| One mount = one prefix | Object Allow Resource = `…/tenants/${TENANT_ID}/vault/*` only |
| No whole-bucket list | Deny ListBucket when `s3:prefix` is null |
| No foreign prefix list | Deny ListBucket when prefix not under bound vault |
| No `_platform` for guest | Explicit Deny on `…/tenants/${TENANT_ID}/_platform/*` |
| No shared multi-tenant role without session policy | Pattern C rejected; trust only orchestrator |
| Prefix from CP only | Issuance path refuses client-supplied S3 paths; validate shape before render |
| Seed ≠ guest | `platform-vault-seed-policy.json` never injected into sandbox |

### Offline review evidence (`lp-t86`)

| Check | Result |
|-------|--------|
| Session + identity JSON bind `${TENANT_ID}` vault tree only | Required SIDs + smoke |
| Substituting `tenant-alpha` vs `tenant-beta` changes ARNs; no cross leakage | `smoke-sandbox-vault-mount-iam.sh` |
| Allow never grants `tenants/*` or whole-bucket `…/*` | Smoke |
| Trust is `sts:AssumeRole` from orchestrator only | Smoke |
| Seed policy remains tenant-scoped and separate | Smoke |
| Live lab negative (prior) | `lp-3en`: session AccessDenied on bucket root list without bound prefix |

### Manual review matrix (for human / `lp-m2z`)

| Action | Bound prefix | Other tenant prefix | `_platform` | Bucket root list |
|--------|--------------|---------------------|-------------|------------------|
| `s3:GetObject` | Allow | Implicit deny | Deny | N/A |
| `s3:PutObject` | Allow | Implicit deny | Deny | N/A |
| `s3:ListBucket` + bound prefix | Allow | Deny (outside) | N/A | Deny (null prefix) |

Primary isolation = tight Allow. Denies catch condition bypass / policy merge mistakes.

### Anti cross-tenant checklist (IAM consumers)

Aligned with [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) § Anti cross-tenant:

| Rule | IAM consequence |
|------|-----------------|
| One mount = one prefix | Session/identity policy resources = exactly that prefix tree |
| Prefix from CP only | Policy render inputs only from CP row; refuse if prefix fails `^tenants/[^/]+/vault/$` (or multi-instance shape) |
| No shared product prefixes | No Allow on `tenants/_all/` or bare `tenants/` |
| Deny `_platform/` for guest | Explicit Deny or omit Allow |
| Platform admin separate | Seed/backup roles never session-injected into guest |
| No long-lived guest keys | Snapshot has no AWS keys; only wake-injected short TTL |

## Validation before any future apply

1. Offline: `bash deploy/scripts/smoke-sandbox-vault-mount-iam.sh`.  
2. Substitute a lab tenant id; run `aws iam simulate-principal-policy` (or equivalent) for:  
   - Allow: Get/Put under `tenants/T/vault/foo`  
   - Deny/implicit deny: `tenants/OTHER/vault/foo`, `tenants/T/_platform/bootstrap.json`, `tenants/` list without prefix  
3. Confirm Mountpoint can cold-start with only the session policy (no extra Allow needed).  
4. Confirm agent process does not receive keys broader than Mountpoint helper if keys are shared in the guest.  
5. Human review: security path (`lp-m2z` / production sign-off) still applies before prod attach.

## Out of scope (this document / earlier beads)

- BYOC customer-owned buckets (Phase 9)  
- Changing Brain RPC path ACLs  
- Destroying or widening lab mocklab bucket access  
- Live cold `ensure_online` R/W proof (`lp-zuh.9.4`)  

## Acceptance evidence

### `lp-zuh.9.2` (CP STS mint + inject)

- [x] **Module** — `portal/packages/control-plane/src/sandbox-vault-mount-sts.ts` (session policy render, fake + AWS SDK issuer, env builders)  
- [x] **Orchestrator** — `buildCreateParams` mints when `s3_vault_prefix` + `vaultBucket` + `vaultMountSts`; fail closed on AssumeRole failure  
- [x] **Server wire** — `SANDBOX_VAULT_MOUNT_ROLE_ARN` / duration / region via `resolveSandboxVaultMountStsFromEnv`; also passes `S3_VAULT_BUCKET` to orchestrator  
- [x] **TTL** — default `DurationSeconds` 3600 (clamp 900–3600); re-issue every cold create  
- [x] **Redaction** — unit tests assert env summary has key names / fingerprints, not secret values  
- [x] **Env contract** — [gateway-env-contract.md](./gateway-env-contract.md) § Vault Mountpoint STS env  

### `lp-kng.2.5` (offline — closed)

- [x] Policy draft file in plan docs — this file + `drafts/iam/*.json`  
- [x] Explicitly said not applied on offline track  
- [x] Matches layout `tenants/{tenant_id}/vault/`; deny `_platform/`; no `sandbox_id`  

### `lp-t86` (Phase 3 template)

- [x] **Policy template in deploy or docs** — `drafts/iam/*.json` + this document; offline smoke at `deploy/scripts/smoke-sandbox-vault-mount-iam.sh`  
- [x] **Cannot read other tenant prefixes (review + optional test)** — [Cannot read other tenant prefixes](#cannot-read-other-tenant-prefixes-review); smoke substitutes alpha/beta and asserts no Allow leakage; deny SIDs required  
- [x] **Credential lifetime/rotation notes** — [Credential lifetime and rotation](#credential-lifetime-and-rotation-lp-t86) (`DurationSeconds` 900–3600, re-issue every wake, discard on stop, base role / ExternalId rotation)  

### `lp-zuh.9.1` (TF shared base role + CP AssumeRole)

- [x] **TF creates shared base role** — `deploy/modules/sandbox-vault-mount-iam` → `lanyard-sandbox-vault-mount` (or `role_name`); trust = `orchestrator_principal_arns` (CP task role only)  
- [x] **Session policy template enforces single tenant prefix** — module `templates/session-policy.json` + drafts; ListBucket conditioned + object R/W; smoke  
- [x] **CP task role has `sts:AssumeRole`** — `attach_orchestrator_assume_policy` inline on CP task role  
- [x] **No long-lived access keys; no secrets in git** — module creates no `aws_iam_user` / `aws_iam_access_key`  
- [x] **Smoke** — `bash deploy/scripts/smoke-sandbox-vault-mount-iam.sh` offline; live with `SMOKE_SANDBOX_VAULT_MOUNT_IAM_LIVE=1` (role trust, CP grant, simulate-custom-policy, redacted assume / AccessDenied)  

## References

- [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) — locked prefix + encryption / no public ACL  
- [identity-model.md](./identity-model.md) — durable prefix vs ephemeral `sandbox_id`  
- [gateway-env-contract.md](./gateway-env-contract.md) — Bucket C mount material  
- [spike-3en-s3-vault-mount.md](./spike-3en-s3-vault-mount.md) — lab Mountpoint + scoped STS proof  
- [offline-piping.md](./offline-piping.md) — offline hard rules  
- `lp-eto` — Phase 3 epic; `lp-hjo` — orchestrator mount params  
