# Provision runbook: `runtime_kind=daytona` branch

**Offline design bead:** `lp-kng.2.10`  
**Phase 6 product path:** `lp-6jx` (under epic `lp-w9a`)  
**Parent offline epic:** `lp-kng.2` (Offline piping)  
**Plan section:** overview **§4.11** (deploy split)  
**Depends on:** [identity-model.md](./identity-model.md) (`lp-707`), CP model fields (`lp-nye`)  
**Related:** [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md), [gateway-env-contract.md](./gateway-env-contract.md), [cp-daytona-config.md](./cp-daytona-config.md), [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md), [offline-piping.md](./offline-piping.md)  
**EC2 path (contrast):** [`deploy/references/provision-runbook.md`](../../../deploy/references/provision-runbook.md)  
**Second tenant in prod (short stack, non-MockLab):** [`docs/runbooks/provision-prod-tenant.md`](../../runbooks/provision-prod-tenant.md) (`lp-oop.37.9`) — MockLab is UAT; shared ECS/bucket, per-tenant CP + prefix.

## Status

| Track | Scope |
|-------|--------|
| **Offline (`lp-kng.2` / `lp-kng.2.10`)** | Design runbook. Documents the Daytona provision **branch**. No live AWS, no tenant EC2 Terraform, no real Daytona sandbox create, no ECR push. |
| **Phase 3 (`lp-eto`)** | Real S3 vault bucket / prefix ensure / seed apply. |
| **Phase 6 (`lp-w9a` / `lp-6jx`)** | **Implemented** product register path: CP accepts `runtime_kind=daytona`, assigns `s3_vault_prefix`, leaves `sandbox_id` null — no EC2 TF, no Daytona create at provision. See [API surface (lp-6jx)](#api-surface-lp-6jx) below. |
| **Human gate (`lp-kng.1`)** | Required before any live Phase 0+ work. |

### Phase 6 implementation note (`lp-6jx`)

CP-first durable provision is live in `@lanyard/control-plane`:

| Layer | Symbol / route | Behavior |
|-------|----------------|----------|
| Pure fields | `buildGatewayInstanceProvisionFields` / `buildDaytonaProvisionFields` | Resolve `runtime_kind`, `s3_vault_prefix`, `presence=offline`, `sandbox_id=null`, `ec2_instance_id=null` — no network |
| Store | `ControlPlaneStore.provisionInstance({ runtime_kind: "daytona" })` | Persists dual-run fields + show-once secret |
| Store helper | `ControlPlaneStore.provisionDaytonaInstance(…)` | Forces daytona path |
| HTTP | `POST /tenants/:id/instances/register` (and `…/provision` alias) | Optional JSON body `{ "runtime_kind": "daytona", "agent_snapshot_id"?, "s3_vault_prefix"? }` |
| Response | 201 | Includes `runtime_kind`, `s3_vault_prefix`, `sandbox_id: null`, `presence: "offline"`, `ec2_instance_id: null` (+ secret once) |

**Still not done at provision (by design):** Daytona create/start, company-brain EC2 TF, real S3 ensure (call `ensureVaultPrefixForDaytonaProvision` / `bootstrapVaultForDaytonaProvision` separately when vault bucket is wired — Phase 3).

### Offline hard rules (must not skip)

| Do | Do not |
|----|--------|
| Document CP register + prefix assignment | `terraform apply` for company-brain EC2 or tenant compute |
| Document lazy sandbox on first `ensure_online` | Create a real Daytona sandbox at provision time |
| Keep `runtime_kind=ec2` as default path | Flip shared staging/prod tenants to daytona offline |
| Reference fake client / unit-tested orchestrator | Call paid Daytona APIs with org key |
| Call `ensureVaultPrefixForDaytonaProvision` (fake S3 offline) | Create real vault buckets or seed live objects without lab gates |

**Explicit:** **No Terraform apply in offline mode.** This runbook is not an apply checklist for lab AWS. EC2 TF remains the **EC2 branch only** ([`deploy/references/provision-runbook.md`](../../../deploy/references/provision-runbook.md) §2).

## Purpose

Document the **§4.11 deploy-split provision path** for on-demand Daytona agent sandboxes:

1. Control Plane **registers** a gateway instance with `runtime_kind=daytona`
2. Assign / record durable **`s3_vault_prefix`** (layout offline; **ensure/seed later**)
3. **Skip** company-brain **EC2 Terraform** and host bootstrap
4. Leave compute **lazy**: `sandbox_id = null` until first `ensure_online`
5. Never hand tenants Daytona API keys

This is the operator-facing mirror of identity-model provision rules and overview §4.11 — not a replacement for the live Phase 6 implementation.

## Deploy split reminder (§4.11)

| Layer | Who owns it | Daytona tenant provision? |
|-------|-------------|---------------------------|
| **Platform** (Portal / BFF / CP / Relay) | Always-on Terraform / platform deploy | Unchanged — still TF, always on |
| **Tenant durable** | CP register + S3 prefix ref (+ future prefix ensure) | **Yes** — this path |
| **Tenant compute** | Instance Orchestrator → Daytona API | **No at provision** — lazy on `ensure_online` |
| **Tenant keys** | Never Daytona org keys | Tenants never deploy sandboxes |

## Contrast: EC2 path vs Daytona path

| Step | `runtime_kind=ec2` (today) | `runtime_kind=daytona` (this branch) |
|------|----------------------------|--------------------------------------|
| 1. Tenant create | `POST /tenants` | **Same** |
| 2. Instance identity | `POST …/instances/register` → `instance_id` + secret | **Same** register surface; set **`runtime_kind=daytona`** on the row |
| 3. Secret store | SSM/SM outside TF; host fetches with instance role | SSM/SM (or platform secret store) for **wake inject** — not host user_data |
| 4. Compute | Monorepo `deploy/` tenant **Terraform apply** → EC2 | **No company-brain EC2 TF.** No `templates/tenant` apply for compute. |
| 5. Vault | Host disk under seed/bootstrap (`/opt/company-brain`, …) | Durable **`s3_vault_prefix`** (default `tenants/{tenant_id}/vault/`); Mountpoint at wake |
| 6. Bootstrap | `bootstrap-host.sh` on EC2; pins; systemd gateway | **No host bootstrap.** Snapshot image (Bucket A) + vault (B) + wake inject (C) |
| 7. Compute ready | After TF + bootstrap + `systemctl enable --now` | After first successful **`ensure_online`** (lazy sandbox) |
| 8. Presence at provision | Implicit “host exists” | **`offline`**, `sandbox_id = null` |
| 9. Idle | Host stays up | Sandbox stops after idle grace; **keep** `instance_id` + prefix |
| 10. Offboard | Revoke + TF destroy when contract ends | Revoke CP + stop sandbox if any; **no** tenant EC2 destroy; prefix retention per Phase 3 policy |

Canonical EC2 steps remain in [`deploy/references/provision-runbook.md`](../../../deploy/references/provision-runbook.md). **Do not** run that document’s §2–§3 (Terraform + host bootstrap) for a pure Daytona instance.

## Conceptual sequence (Daytona provision)

```text
1. POST /tenants  (if new tenant)
2. POST /tenants/:id/instances/register
     → instance_id + show-once secret
     → runtime_kind = daytona
     → s3_vault_prefix assigned (string; layout doc)
     → presence = offline
     → sandbox_id = null
     → agent_snapshot_id = pin or platform default (lp-kng.2.7)
3. Store relay secret in platform secret store (not git, not tfvars)
4. Ensure S3 prefix (+ optional seed) (`lp-jt5` / `lp-9o6`): either
   - `ensureVaultPrefixForDaytonaProvision({ tenantId, runtimeKind: "daytona",
     bucket, store })` then optional `bootstrapTenantVaultSeed({…})`, or
   - one-shot `bootstrapVaultForDaytonaProvision({ tenantId, runtimeKind:
     "daytona", bucket, store, seedObjects? })` from `@lanyard/control-plane`.
   Prefix ensure writes platform marker
   `tenants/{tenant_id}/_platform/vault-prefix-ensured.json` if missing.
   Seed is **optional** (omit `seedObjects` for empty vault); when provided,
   non-destructive (skip if `AGENTS.md` or `_platform/bootstrap.json` exists).
   Inject real S3 via `VaultObjectStore` (unit tests: `FakeS3ObjectStore`).
5. STOP — do not terraform apply company-brain EC2
6. STOP — do not Daytona create/start at provision
7. Later: BFF/adapter → ensure_online(instance_id) creates/starts sandbox (lazy)
```

## 1. Control plane — tenant + register (daytona)

Same lifecycle-first model as EC2: **register**, not ad-hoc secret paste forever. Full secret lifecycle still: `deploy/references/runbooks/relay-secret-lifecycle.md`.

### 1a. Create tenant (unchanged)

```http
POST /tenants
{
  "tenant_slug": "<slug>",
  "display_name": "<Name>",
  "hosting_track": "lanyard_hosted"
}
```

### 1b. Register instance with Daytona runtime

<a id="api-surface-lp-6jx"></a>

**API surface (lp-6jx — implemented):** field meanings from `lp-707` / `lp-nye`; product path in control-plane.

```http
POST /tenants/:tenant_id/instances/register
Content-Type: application/json

{
  "runtime_kind": "daytona",
  "agent_snapshot_id": "optional-pin-or-omit",
  "s3_vault_prefix": "optional-override-or-omit-for-default"
}
```

Empty body keeps default **`runtime_kind=ec2`** (unchanged deploy tooling).

**Response (201):**

```json
{
  "instance_id": "...",
  "tenant_id": "...",
  "secret": "...",
  "runtime_kind": "daytona",
  "s3_vault_prefix": "tenants/<tenant_id>/vault/",
  "sandbox_id": null,
  "presence": "offline",
  "agent_snapshot_id": null,
  "ec2_instance_id": null,
  "relay_tier": "shared",
  "relay_wss_url": "wss://relay.withlanyard.com",
  "relay_close_code_on_revoke": 4401
}
```

| Field at provision | Rule |
|--------------------|------|
| `instance_id` | Minted permanent Relay / Brain RPC identity |
| `secret` | Show once; store in secret store immediately; never commit |
| `runtime_kind` | **`daytona`** when requested (default product path remains `ec2` until cutover) |
| `s3_vault_prefix` | Assigned now; durable; **not** from `sandbox_id` — see [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) |
| `sandbox_id` | **`null`** — no compute yet |
| `presence` | **`offline`** |
| `agent_snapshot_id` | Optional body pin; else null and inherit `DAYTONA_DEFAULT_SNAPSHOT` at wake ([cp-daytona-config.md](./cp-daytona-config.md)) |
| `ec2_instance_id` | **null** (no company-brain EC2 for daytona) |

**Code entry points** (`portal/packages/control-plane`):

- `buildDaytonaProvisionFields` / `buildGatewayInstanceProvisionFields` — pure field plan
- `ControlPlaneStore.provisionInstance({ runtime_kind: "daytona" })`
- `ControlPlaneStore.provisionDaytonaInstance({ tenant_id, … })` — dedicated helper
- Unit tests: `test/provision-daytona.test.ts` (fake S3 only; no live Daytona/AWS)

`POST …/instances/provision` remains a **compat alias** of register; new automation should call **register** and pass `runtime_kind`.

### 1c. What register must not do

| Forbidden at provision | Why |
|------------------------|-----|
| Daytona create/start | Lazy wake only; avoid idle billing and orphan sandboxes |
| Tenant EC2 `terraform apply` | §4.11 — no company-brain EC2 for daytona |
| Write `DAYTONA_API_KEY` to tenant/agent | Platform CP only; guest model §4.3 |
| Derive vault prefix from sandbox | Sandbox does not exist yet; would churn on every wake |
| Set presence `online` | Nothing is running |

## 2. Relay secret storage (no host TF)

Same production rule as EC2: secret **outside** Terraform state/tfvars.

```bash
# Illustrative — name may gain a daytona-specific convention later; pattern matches EC2
aws ssm put-parameter \
  --name "/company-brain/<slug>/gateway-relay-secret" \
  --type SecureString \
  --value '<secret from register>' \
  --overwrite
```

Differences vs EC2:

| Concern | EC2 | Daytona |
|---------|-----|---------|
| Who reads secret | EC2 instance role on host | Orchestrator / wake inject (Bucket C) into sandbox env |
| When | Bootstrap + gateway start | Each `ensure_online` inject (or cached material per design) |
| Agent env name | `GATEWAY_RELAY_SECRET` | **Same name** ([gateway-env-contract.md](./gateway-env-contract.md)) |

### 2a. CP material store → orchestrator inject (`lp-9my`)

Register/rotate still return the show-once `secret` + `relay_wss_url` / `relay_tier` (same surface as EC2). CP Postgres stores **hashes only**.

| Layer | Behavior |
|-------|----------|
| `ControlPlaneStore` + `secretMaterial` | On provision/rotate, put plaintext into `InstanceSecretMaterialStore` (not audit, not Postgres) |
| Server boot | `resolveInstanceSecretMaterialStore`: memory (lab), encrypted file (`PATH`+`KEY`), or Secrets Manager (`SM_SECRET_ID`+`KEY`, lp-oop.37.6). One store shared with orchestrator. `/tmp` PATH is ephemeral on Fargate. |
| Orchestrator cold create | Resolves material by `instance_id` → create `env`: `GATEWAY_RELAY_URL`, `GATEWAY_RELAY_ID`, `GATEWAY_RELAY_INSTANCE_ID`, `GATEWAY_RELAY_SECRET` (spike-4l5 path) |
| Rotate | Overwrite material; next **cold** wake injects new secret (no post-create env PATCH) |
| Revoke / deprovision | Delete material so wake cannot re-inject |

Production CP uses the same port (`InstanceSecretMaterialStore`) with the SM adapter (`lp-oop.37.6`) — same AES envelope as the file store, no EFS. Live cutover: [instance-secret-material.md](../../runbooks/instance-secret-material.md). Never log secret values.

Offline: do **not** create SSM parameters as part of accepting this doc.

## 3. S3 vault prefix — assign now; ensure later

### 3a. Assign (provision-time, CP metadata)

Record on the instance row:

```text
s3_vault_prefix = tenants/{tenant_id}/vault/
```

Rules (from layout doc): trailing slash; not derived from `sandbox_id`; never rewritten on wake/idle.

### 3b. Ensure / seed (Phase 3 `lp-eto`)

**Lab pilot bucket (`lp-d26`):** already exists — do **not** destroy.

| Field | Lab value |
|-------|-----------|
| Bucket | `lanyard-mocklab-vault-123456789012` |
| Region | `us-east-1` |
| Access notes | [pilot-lab-s3-vault-bucket.md](./pilot-lab-s3-vault-bucket.md) |
| Re-check | `bash deploy/scripts/smoke-pilot-lab-s3-vault-bucket.sh` (live: `SMOKE_PILOT_VAULT_LIVE=1 AWS_PROFILE=lanyard-main`) |

While [OPERATOR HOLD](../../../deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md) applies, **do not** provision a full platform-staging vault stack via TF. Use the lab mocklab bucket above.

When live for a tenant row:

1. Ensure platform vault bucket exists (lab: reuse mocklab; product env: platform TF later — **not** per-tenant company-brain EC2).
2. Ensure prefix “exists” via `ensureVaultPrefixForDaytonaProvision` (`lp-jt5` / control-plane).
3. **Optional seed** (`lp-9o6`): call `bootstrapVaultForDaytonaProvision` with a  
   `seedObjects` pack (client-core release or `minimalClientCoreSeedFixture` for  
   tests), **or** call `bootstrapTenantVaultSeed` after step 2.  
   - Omitting `seedObjects` → empty vault (still agent-usable once mounted).  
   - Gate: existing vault-root `AGENTS.md` or `_platform/bootstrap.json` → skip  
     (seed-vault.sh parity; never overwrite live tenant content).  
   - Writes stay under `tenants/{tenant_id}/vault/`; no cross-tenant S3 copy.  
4. Failures after prefix assigned: re-run seed; **do not** mint a second prefix.

| Offline | Lab pilot | Product env later |
|---------|-----------|-------------------|
| Document prefix string + ownership | Reuse `lanyard-mocklab-vault-*`; see `lp-d26` doc | `terraform apply` / AWS APIs when hold lifts |
| Unit tests may fake “prefix ready” | Live smoke + Mountpoint spikes | Phase 3 product apply + verification |

## 4. No EC2 Terraform for daytona tenants (`lp-4nf`)

**Skip entirely** for pure `runtime_kind=daytona` instances:

- `cp -a deploy/templates/tenant deploy/deployments/<slug>`
- `terraform init/plan/apply` under tenant deployment
- `modules/company-brain-ec2` (any root that creates the host)
- `bootstrap-host.sh` / SSM Session Manager to the company-brain host
- `systemctl enable --now hermes-gateway` on EC2

### Fail-closed guard (deploy template)

| Guard | Location | Behavior |
|-------|----------|----------|
| Variable `runtime_kind` | `deploy/templates/tenant/variables.tf` | `ec2` (default) \| `daytona`; documents EC2-only template |
| Check `runtime_kind validation (ec2 only) + check daytona_forbids_company_brain_ec2_template` | `deploy/templates/tenant/main.tf` | **Fails** plan/apply if `runtime_kind=daytona` |
| Module skip marker | `deploy/modules/company-brain-ec2/INDEX.md` + `AGENTS.md` | Explicit: do not apply for daytona tenants |
| Operator branch table | [`deploy/references/provision-runbook.md`](../../../deploy/references/provision-runbook.md) | EC2 runbook vs this document |

```text
# WRONG for daytona — will fail closed:
runtime_kind = "daytona"   # in deploy/templates/tenant (or copy under deployments/)
terraform plan             # → check daytona_forbids_company_brain_ec2_template

# RIGHT for daytona:
# 1) CP register with runtime_kind=daytona (§1)
# 2) S3 vault prefix assign/ensure (§3)
# 3) STOP — no templates/tenant apply, no company-brain-ec2
```

Platform stacks (Portal, Relay, shared infra) **remain** TF-managed and are **out of band** for per-tenant daytona provision.

If a tenant is dual-run (Phase 7 `lp-0pr` / `lp-gu2`): EC2 TF may still exist for the **EC2** instance row (`runtime_kind=ec2` on that stack only); the **daytona** instance row still follows this branch and must not reuse EC2 `ec2_instance_id` as auth or as vault key. Dual-run is the **per-instance** `runtime_kind` field (set at register or via registry PATCH) — not a global platform flip. Operator note: [dual-run-runtime-kind.md](./dual-run-runtime-kind.md).

## 5. Lazy sandbox — first `ensure_online` (not provision)

**Product proof (`lp-3up`):** Provision never creates a sandbox. First `ensure_online` cold-creates from snapshot, mounts the durable tenant S3 vault prefix at `VAULT_ROOT` (`/mnt/vault`), and binds `sandbox_id`. A second `ensure_online` while online is `already_online` (no second create). Tenants never receive Daytona keys and never run Terraform for compute.

**Offline tests:** `portal/packages/control-plane/test/lazy-sandbox-ensure-online.test.ts` (real harness; provision helpers → store seed → ensure chain). Related: `provision-daytona.test.ts` (lp-6jx fields), `ensure-online.test.ts` (singleflight / mount env).

Compute is created by the Instance Orchestrator, usually on first:

```http
POST /internal/orchestrator/instances/:instance_id/ensure-online
```

(See [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md).)

Conceptual wake (orchestrator only; agent is guest):

```text
ensure_online(instance_id)
  → if online + healthy → return
  → resolve s3_vault_prefix + agent_snapshot_id + relay inject material
  → Daytona create/start from snapshot → sandbox_id
  → mount prefix + inject GATEWAY_RELAY_* (instance_id permanent)
  → agent dials Relay as instance_id
  → presence → online
```

| At provision | At first ensure_online |
|--------------|------------------------|
| `sandbox_id = null` | Bound to current Daytona handle |
| `presence = offline` | `waking` → `online` (or `error`) |
| No Daytona API call | Daytona API (live) or **fake** (offline tests) |

**Offline track:** use `real Daytona client (via harness-local)` + unit tests (`lp-3up`, `lp-kng.2.1`, `lp-7v5`). Feature flags that call ensure_online (e.g. `ENSURE_ONLINE_ON_CHAT`) default **off**. Do not enable against shared staging/prod until live phases + `lp-kng.1`.
## 6. Portal smoke (post-wake — live only)

After a **live** environment can wake sandboxes (not offline acceptance):

1. Open Portal for tenant slug  
2. Sign in as tenant admin  
3. Trigger a path that runs `ensure_online` (chat send when flag on, or explicit ops tool)  
4. Confirm streaming reply / presence online  

Offline acceptance of **this** bead does **not** require Portal smoke or real wake.

## 7. Revoke / deprovision (daytona branch)

| Action | Control plane | Compute follow-up | Vault |
|--------|---------------|-------------------|-------|
| **Rotate secret** | `POST …/rotate` | Next wake injects new secret; **same** `instance_id` | Unchanged |
| **Revoke instance** | `POST …/revoke` | Orchestrator stop/destroy sandbox if any; clear `sandbox_id` | **Retain** vault prefix (pilot default) — [vault-s3-retain-vs-gc.md](./vault-s3-retain-vs-gc.md) |
| **Tenant deprovision** | `POST …/deprovision` | Stop all sandboxes for tenant instances | Soft-delete identity; vault **retain** by default (optional GC later, not pilot) — **no** tenant EC2 TF destroy; **no** auto S3 purge |

Expect Relay close **4401** on revoke (same as EC2). There is **no** `terraform destroy` of company-brain EC2 for pure daytona tenants.

### 7.1 Implemented teardown (`lp-e96`)

Control-plane module: `portal/packages/control-plane/src/deprovision-daytona.ts`.

Happy-path `POST …/revoke` and `POST …/deprovision` always:

1. **Archive** bound Daytona sandbox when `sandbox_id` is set (real harness / SDK `archive`; best-effort if already gone)
2. **Revoke** gateway secret (CP SoT hashes) — refuse re-auth; operators still call Relay `POST …/internal/instances/:id/revoke` for live **4401**
3. Clear **`sandbox_id`**, set **presence = offline** (store SQL + orchestrator presence store)
4. Drop optional wake-inject **material** store entry when injected (lp-9my port)
5. **Retain** vault under `s3_vault_prefix` — `vault_gc_deleted_count: 0`, `vault_retained: true`

**Vault retained; optional purge is separate.** Optional GC (`purgeVaultPrefix`) is gated (`VAULT_DEPROVISION_GC_MODE` / `vault.deprovision_gc_mode` ∈ `retain` | `delete_after_hold` | `delete_immediate`) and is **not** invoked from the happy-path handlers (`runVaultGc: false`). See [vault-s3-retain-vs-gc.md](./vault-s3-retain-vs-gc.md).

## 8. Operator checklist (offline vs live)

### Offline / design acceptance (`lp-kng.2.10`)

- [x] This runbook exists under `docs/plans/0008-daytona-agent-sandboxes/`
- [x] EC2 contrast table present
- [x] Explicit **no TF apply** / no live Daytona create in offline mode
- [ ] No `terraform apply` run as part of this bead
- [ ] No real sandbox create as part of this bead

### EC2 skip guard acceptance (`lp-4nf`)

- [x] Branch table: EC2 runbook vs this document (plan §4.11)
- [x] Tenant template `runtime_kind` validation hard-requires `ec2` (plan fails for `daytona`)
- [x] `company-brain-ec2` INDEX/AGENTS skip markers for daytona
- [x] §4 documents forbidden TF steps + correct CP/S3-only path

### Live cutover (`lp-w9a` + gates)


- [ ] `lp-kng.1` human prerequisites filled  
- [ ] Platform vault + IAM applied (Phase 3)  
- [ ] Snapshot pin registered (Phase 2)  
- [x] CP register accepts `runtime_kind=daytona` end-to-end (`lp-6jx` — product path + unit tests)  
- [ ] ensure_online live SDK path green on allowlisted lab tenant  
- [ ] `DAYTONA_ENABLED` and secrets only in env/secret store  

## Related documents

| Doc | Role |
|-----|------|
| [overview.md](./overview.md) | §4.11 deploy split; locked decisions |
| [identity-model.md](./identity-model.md) | `instance_id` / `sandbox_id` / prefix lifetimes |
| [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) | Prefix shape + seed design |
| [vault-s3-retain-vs-gc.md](./vault-s3-retain-vs-gc.md) | Retain vs optional GC on deprovision (`lp-zmg`) |
| [gateway-env-contract.md](./gateway-env-contract.md) | Env name parity EC2 ↔ Daytona |
| [cp-daytona-config.md](./cp-daytona-config.md) | Platform Daytona keys; fail-closed |
| [cp-internal-orchestrator-api.md](./cp-internal-orchestrator-api.md) | ensure-online / presence / stop |
| [presence-state-machine.md](./presence-state-machine.md) | `offline` default at provision |
| [offline-piping.md](./offline-piping.md) | Offline track rules |
| [`deploy/references/provision-runbook.md`](../../../deploy/references/provision-runbook.md) | **EC2** semi-auto provision |
| [`docs/runbooks/provision-prod-tenant.md`](../../runbooks/provision-prod-tenant.md) | **Second tenant in prod** (short stack; MockLab is UAT) |

## Out of scope (this bead)

- Implementing register API body fields in code (unless already present from `lp-nye`)  
- Terraform modules for vault bucket apply  
- Live Daytona SDK or real sandbox create  
- Dual-run migration procedure detail (Phase 7)  
- BYOC / customer-owned Daytona (Phase 9 deferred)  

## Acceptance evidence (`lp-kng.2.10`)

- [x] Runbook or plan section updated — **this file** + link from EC2 provision runbook and offline plan index  
- [x] Contrast with EC2 path — **Contrast: EC2 path vs Daytona path**  
- [x] Explicit no TF apply in offline mode — **Status / Offline hard rules** and **§4 No EC2 Terraform**  
