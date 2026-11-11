# Security review: VM isolation, secrets, egress, cross-tenant S3

**Bead:** `lp-m2z`  
**Parent epic:** `lp-3a1` (Phase 8: Hardening and cost)  
**Depends on (closed):** `lp-t86` (IAM prefix scope), `lp-04r` (webhook HMAC), `lp-y3j` (BFF ensure_online)  
**Date:** 2026-08-05  
**Scope:** Code- and plan-backed review of Daytona sandbox isolation controls. **Evidence only** — claims cite paths in this monorepo or closed Phase 0 spikes. No live AWS/Daytona re-prove in this bead (OPERATOR HOLD / thrift).

**Related plan docs:**

| Topic | Doc |
|-------|-----|
| Overview / isolation waiver | [overview.md](./overview.md), [spike-ctu-go-no-go.md](./spike-ctu-go-no-go.md), [spike-z1u-linux-vm-sandbox.md](./spike-z1u-linux-vm-sandbox.md) |
| IAM + templates | [iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md), [drafts/iam/](./drafts/iam/) |
| Layout + anti cross-tenant | [s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) |
| Secrets / inject | [gateway-env-contract.md](./gateway-env-contract.md), [spike-4l5-gateway-secret-inject.md](./spike-4l5-gateway-secret-inject.md) |
| Redaction | [daytona-response-redaction.md](./daytona-response-redaction.md) |
| Mid-turn | [mid-turn-protection.md](./mid-turn-protection.md), [daytona-autostop-safety-net.md](./daytona-autostop-safety-net.md) |
| Dual-run | [provision-runbook-daytona.md](./provision-runbook-daytona.md), [cp-daytona-config.md](./cp-daytona-config.md) |
| Egress spike | [spike-v2p-org-access.md](./spike-v2p-org-access.md) |
| Production allowlist (open) | Phase 8 leaf `lp-ccp` |

---

## 1. Executive summary

| Control | Pilot posture | Cross-tenant vault risk |
|---------|---------------|-------------------------|
| **VM isolation** | Managed Daytona **container** accepted for pilot (linux-vm optional; `lp-kng.4`) | Shared-kernel residual is host escape, not S3 path — separate from vault IAM |
| **S3 vault IAM** | Per-tenant prefix templates + offline smoke (`lp-t86`); **not** auto-applied from CI | When session policy is rendered from CP prefix for **one** tenant tree, other tenants are Allow-free; smoke proves alpha≠beta ARNs |
| **Prefix assignment** | Default `tenants/{tenant_id}/vault/` from CP `tenant_id` | **No guest-facing path** to mount another tenant’s prefix when default provision is used |
| **Secrets** | Postgres holds scrypt **hashes** only; plaintext in material store → create-time inject; redaction on Daytona responses | Instance secret is per-`instance_id`; inject keys by instance, not by tenant list |
| **Webhook** | HMAC-SHA256 on raw body; timing-safe verify; reverse map `sandbox_id` → instance | Does not recompute vault location; presence only |
| **Egress** | Spike proved `domainAllowList` API field; product wiring residual tracked by `lp-ccp` | N/A to vault bytes; bounds outbound network |
| **Dual-run** | `runtime_kind` never flipped by ensure/stop; Daytona gated by enable + tenant allowlist | EC2 path does not call Daytona or mount S3 vault prefix |
| **Mid-turn** | Reaper skips active mid-turn; 45m max hold; vendor autoStop 90m | Availability/cost, not cross-tenant |

### Acceptance (`lp-m2z`)

| Criterion | Result |
|-----------|--------|
| Written review notes | **This document** |
| Findings filed as beads if any | **One residual** — `lp-3a1.1` (`s3_vault_prefix` override not bound to `tenant_id` / ensure_online shape check; see §11). Egress production allowlist already tracked as `lp-ccp`. |
| No known cross-tenant vault access path | **Pass for product guest path** under default provision + designed IAM session scope. Residual: privileged register body can set a foreign-looking prefix string without code rejection (service-token surface only; not end-user). STS mint productization still design+lab, not CP wake inject code. |

---

## 2. Threat model (Daytona pilot slice)

| Asset | Attacker / failure | Desired control |
|-------|--------------------|-----------------|
| Tenant vault objects under `tenants/{id}/vault/` | Other tenant sandbox, leaked mount keys, broad IAM | Prefix-scoped STS + CP-sourced prefix only |
| `GATEWAY_RELAY_SECRET` | Logs, create/GET dump, git, wrong sandbox | Material store + redaction + show-once hash in DB |
| Daytona org API key / webhook secret | Guest, logs, PR notes | Platform env only; never guest inject |
| Presence / stop | Forged webhook | HMAC + private network (G1.3) |
| Outbound from sandbox | Data exfil, SSRF-ish | Tier + `domainAllowList` (pilot: Relay host) |
| Idle cost / kill mid-turn | Reaper during tools | Mid-turn lock + vendor autoStop above hold |

Out of scope for this review: Brain RPC path ACLs inside vault (separate agent/profile work), BYOC customer buckets (Phase 9), full production security sign-off matrix.

---

## 3. VM / compute isolation

### Evidence

- Human decision (Beads memory / go-no-go): **container isolation is acceptable for managed Daytona pilot**; linux-vm is optional hardening, not a pilot gate (`lp-kng.4`, [spike-z1u](./spike-z1u-linux-vm-sandbox.md), [spike-ctu](./spike-ctu-go-no-go.md)).
- Sandboxes are **ephemeral** (`sandbox_id`); permanent identity is `instance_id` ([identity-model.md](./identity-model.md)).
- Labels on create carry `instance_id` + `tenant_id` for ops correlation only — **not** auth material:

```639:645:portal/packages/control-plane/src/instance-orchestrator.ts
    let createParams: CreateSandboxParams = {
      snapshotId,
      region: defaultRegion,
      labels: {
        instance_id: rec.instance_id,
        tenant_id: rec.tenant_id,
      },
    };
```

### Residual

| Residual | Severity | Tracking |
|----------|----------|----------|
| Shared-kernel container escape | Pilot-accepted | `lp-kng.4` optional re-prove when linux-vm runners available |
| Multi-tenant on one sandbox | **Forbidden by design** | Layout rule “one mount = one prefix” ([s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md) § Anti cross-tenant) |

**Verdict:** Compute isolation is **acceptable for pilot** with explicit waiver. Does not by itself grant cross-tenant S3; S3 isolation is IAM + prefix assignment.

---

## 4. Cross-tenant S3 / vault prefix (core)

### 4.1 Layout and CP assignment

**Normative prefix:** `tenants/{tenant_id}/vault/` ([s3-vault-prefix-layout.md](./s3-vault-prefix-layout.md), `vault-prefix.ts`).

| Code | Behavior |
|------|----------|
| `assertValidTenantIdForVaultPrefix` | Single segment; reject `/`, `..`, control-ish ids |
| `buildS3VaultPrefix(tenantId)` | Always `tenants/{id}/vault/` |
| `assignS3VaultPrefixForProvision` | daytona → build; ec2 → null |
| `ensureTenantVaultPrefix` | Platform marker under `tenants/{id}/_platform/` (**not** on guest mount) |

Default provision path (`buildGatewayInstanceProvisionFields` without override) binds prefix to the register path’s `tenant_id`.

### 4.2 IAM prefix scope (`lp-t86`)

Templates under [drafts/iam/sandbox-vault-mount-session-policy.json](./drafts/iam/sandbox-vault-mount-session-policy.json):

- **Allow** ListBucket only when `s3:prefix` under `tenants/${TENANT_ID}/vault/`
- **Allow** object R/W only on `…/tenants/${TENANT_ID}/vault/*`
- **Deny** ListBucket with null prefix; **Deny** list outside bound prefix; **Deny** `…/_platform/*`

Offline smoke (executed this review):

```bash
bash deploy/scripts/smoke-sandbox-vault-mount-iam.sh
# ALL CHECKS PASSED (offline, no AWS apply)
# includes: cross-tenant substitution tenant-alpha vs tenant-beta isolated
```

Lab negative (prior spike, not re-run here): [spike-3en](./spike-3en-s3-vault-mount.md) — STS session **AccessDenied** on bucket root list without bound prefix.

Credential lifetime notes: STS 900–3600s; re-issue every wake; discard on idle stop ([iam-scoped-s3-mount-policy.md](./iam-scoped-s3-mount-policy.md) § Credential lifetime).

### 4.3 Orchestrator mount params (`lp-hjo`)

Wake maps **CP row** `s3_vault_prefix` → guest `VAULT_ROOT` / env (`sandbox-vault-mount.ts`):

- Rejects absolute key prefixes starting with `/` and `..` traversal
- Does **not** accept client-supplied S3 paths on ensure_online — only stored instance field
- Mount env has **no** secret AWS keys in this fragment (non-secret path/bucket/prefix only)

```646:652:portal/packages/control-plane/src/instance-orchestrator.ts
    if (rec.s3_vault_prefix) {
      const vaultMount = buildSandboxVaultMountParams({
        s3VaultPrefix: rec.s3_vault_prefix,
        vaultRoot: vaultMountPath,
        vaultBucket,
      });
      createParams = applyVaultMountToCreateParams(createParams, vaultMount);
    }
```

### 4.4 Product STS mint status

| Layer | Status |
|-------|--------|
| IAM JSON templates + offline isolation smoke | **Shipped** (`lp-t86`) |
| Lab AssumeRole + Mountpoint proof | **Done** (spike-3en) |
| CP orchestrator code that mints STS + injects `AWS_*` at create | **Not present** in `portal/packages/control-plane/src` (no AssumeRole client) |

Implication: product wake currently injects **prefix/path metadata** + Relay secret; **scoped AWS session inject is still the designed path**, not live CP code. Until productized, operators must not ship broad guest AWS credentials in the snapshot. Isolation claim for production attach remains: **session policy bound to CP prefix + short TTL** as in `lp-t86` / lab.

### 4.5 Cross-tenant vault access path analysis

| Path | Guest / untrusted can exploit? | Evidence |
|------|--------------------------------|----------|
| Mount another tenant via relative FS | No (Mountpoint tree = one prefix) | Layout + spike-3en |
| IAM Allow on `tenants/*` | No in templates | smoke-sandbox-vault-mount-iam.sh |
| derive prefix from `sandbox_id` | No | identity-model; provision sets prefix without sandbox |
| Client HTTP supplies S3 path on ensure_online | No | Orchestrator reads CP row only |
| Register body `s3_vault_prefix` override to foreign tenant | **Service-token / ops only** — **not rejected by code** if string is non-empty | `provision-daytona.ts` `normalizeOptionalS3VaultPrefix` + test allows `tenants/custom/vault` for unrelated `tenantId` |
| Webhook forges presence to remount | No vault remount from webhook; HMAC required | `daytona-webhook.ts` |
| Vault GC wipe whole bucket | Guarded | `assertSafeVaultGcPrefix` requires `tenants/…` subtree |

**Conclusion:** There is **no known guest-reachable cross-tenant vault access path** under default provision and designed per-tenant session IAM. The residual is **privileged mis-provision** of `s3_vault_prefix` (and missing ensure_online re-validation of shape/tenant segment), filed in §9.

---

## 5. Secrets material store + inject

### 5.1 Durable store (Postgres)

| Property | Implementation |
|----------|----------------|
| Register/rotate mint | `generateInstanceSecret()` — 32 bytes base64url (`crypto.ts`) |
| At rest in DB | `secret_hash` + `secret_salt` via **scrypt**; plaintext never in Postgres |
| Verify | `verifyInstanceSecret` with `timingSafeEqual` |
| Rotate | Dual-accept window optional (`previous_secret_*`) |
| Revoke / deprovision | Hash invalidation + material delete (`deprovision-daytona.ts`, `store.ts`) |

### 5.2 Plaintext material port (wake inject, `lp-9my`)

| Property | Implementation |
|----------|----------------|
| Port | `InstanceSecretMaterialStore` (`gateway-relay-env.ts`) |
| Lab / single-process | `createInMemoryInstanceSecretMaterialStore()` when durable env unset |
| Encrypted file | `PATH` + `KEY` (`lp-3a1.2`). Fargate `/tmp` is ephemeral. |
| Secrets Manager | `SM_SECRET_ID` + `KEY` (`lp-oop.37.6`) — same AES-256-GCM envelope |
| Contents | `instance_id`, `tenant_id`, secret, `relay_wss_url`, tier, `issued_at` |
| Put | Register/rotate (`store.putSecretMaterial` → material store) |
| Get | Orchestrator cold create by **`instance_id` only** |
| Delete | Revoke / deprovision best-effort |
| Fail closed | Missing material → `MissingInstanceSecretMaterialError` (no empty secret inject) |

```654:666:portal/packages/control-plane/src/instance-orchestrator.ts
    // Bucket C: Relay credentials from platform material store (not Postgres).
    if (secretMaterial) {
      const material = await secretMaterial.get(rec.instance_id);
      if (!material?.secret) {
        throw new MissingInstanceSecretMaterialError(rec.instance_id);
      }
      const relayEnv = buildGatewayRelayEnv({
        instanceId: rec.instance_id,
        relayWssUrl: material.relay_wss_url,
        secret: material.secret,
      });
      createParams = applyGatewayRelayEnvToCreateParams(createParams, relayEnv);
    }
```

**Identity rule:** `GATEWAY_RELAY_ID` / `GATEWAY_RELAY_INSTANCE_ID` = permanent `instance_id`, **never** `sandbox_id` (`buildGatewayRelayEnv`).

### 5.3 Residuals (secrets)

| Residual | Severity | Notes |
|----------|----------|-------|
| Live SM envelope not yet proven across CP force-new-deployment | Ops | Adapter + runbook landed (`lp-oop.37.6`); live prove pending |
| Material `tenant_id` not re-checked against `rec.tenant_id` on inject | Low | Keyed by instance_id; mismatch would require store corruption / wrong put |
| Daytona create response may echo env | Mitigated | Redaction module + SDK parse path (§7) |

---

## 6. Webhook HMAC (`lp-04r`)

| Control | Code |
|---------|------|
| Path | `POST /webhooks/daytona` (`DAYTONA_WEBHOOK_PATH`) — **no** service-token gate |
| Secret | `DAYTONA_WEBHOOK_SECRET` — fail closed (503) when unset at receiver |
| Header | `x-daytona-signature` = `sha256=<hex>` or raw hex |
| Algorithm | HMAC-SHA256 over **raw body** |
| Compare | `timingSafeEqual` on digests (`verifyDaytonaWebhookHmac`) |
| Event applied | `sandbox.state.updated` only (parse strict) |
| Identity | `findInstancesBySandboxId` → presence patch; **no vault path mutation** |
| Unknown sandbox | 200 ACK (replay-safe; no retry storm) without store write |
| Auth layering | HMAC app-layer + CP private network (G1.3) |

Tests: `portal/packages/control-plane/test/daytona-webhook.test.ts` (invalid HMAC → reject).

**Residual:** Vendor may use Svix-style schemes; comment in `daytona-webhook.ts` notes adapt if managed product differs. Not a cross-tenant vault path.

---

## 7. Response redaction (`lp-pec.1`)

| Export | Role |
|--------|------|
| `isDaytonaSecretEnvKey` | Catalog + pattern (`GATEWAY_RELAY_SECRET`, `AWS_*`, `*_API_KEY`, …) |
| `redactDaytonaEnvMap` | Secret values → redaction marker |
| `daytonaEnvLogSummary` | keys + length + `sha256:` fingerprint only |
| `parseDaytonaSandboxApiBody` | SDK parse path: memory env + log-safe views |
| `DaytonaSdkClient` | create/GET through parse; public sandbox record **no** env |

Server wiring logs only safe fields:

```79:90:portal/packages/control-plane/src/server.ts
    logSafe: (event) => {
      log.info("daytona_sdk", {
        op: event.op,
        // ...
        // envSummary is already redacted (lp-pec.1); never raw env secrets.
        env_keys: event.envSummary?.keys,
      });
    },
```

Defense-in-depth: shared `redactForLog` still treats top-level `env` as secret-shaped.

---

## 8. `runtime_kind` dual-run

| Rule | Code |
|------|------|
| Branch ensure_online | `decideEnsureOnlinePath` — ec2 short-circuit; daytona wake or deny |
| Never flip kind | `assertRuntimeKindUnchanged` on ensure/stop paths |
| Gate daytona | `DAYTONA_ENABLED` + `DAYTONA_TENANT_ALLOWLIST` (empty allowlist = deny all when config present) |
| Stop | ec2 no-op host; daytona stop/clear `sandbox_id` only; keep `instance_id` + `s3_vault_prefix` |
| Provision default | `ec2` unless explicit `runtime_kind=daytona` |
| TF skip | `runtime_kind=daytona` forbids company-brain EC2 template (`lp-4nf`) |

**Isolation effect:** Non-allowlisted daytona tenants fail closed without create. EC2 tenants never receive Daytona mounts or org API side effects from ensure_online.

---

## 9. Domain allowlist / egress

### Spike evidence (`lp-v2p`)

- Create-time `domainAllowList: "relay.withlanyard.com"` accepted by managed API.
- Proves **API field path**, not full org Tier-1 policy matrix.

### Product code

| Surface | Status |
|---------|--------|
| `DaytonaSdkClientOptions.domainAllowList` | Optional; set on create body when provided (`daytona-sdk-client.ts`) |
| `server.ts` production construct | **Does not pass** `domainAllowList` today — only config + autoStop + logSafe |
| Phase 8 | Open leaf **`lp-ccp`** — Production network allowlist: Relay, model APIs, registries |

**Verdict:** Egress allowlist is **designed and spike-proven**; production wiring/completeness is **tracked residual** (`lp-ccp`), not re-filed here.

---

## 10. Mid-turn protection (`lp-053`)

| Control | Default | Code |
|---------|---------|------|
| Max mid-turn hold | 45 min | `DEFAULT_MID_TURN_MAX_HOLD_MS` |
| Idle grace | 30 min | reaper |
| Vendor autoStop | 90 min | `DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES` / lp-4f2 |
| Arm/clear | `signal-activity` `mid_turn` true/false | orchestrator + BFF (`lp-96v`) |
| Timeout safety | Clear expired lock then apply idle | `reapIdle` |
| Auth | Service/ops token on signal-activity | unchanged |

**Security relevance:** Prevents idle-stop races mid-tool; timeout prevents permanent lock / cost run-away. Not a vault isolation control.

---

## 11. Findings and residual beads

### Closed / accepted (no new bead)

| Item | Disposition |
|------|-------------|
| Container vs linux-vm | Pilot waiver; optional `lp-kng.4` |
| IAM template cross-tenant isolation | Offline smoke pass (`lp-t86`) |
| Webhook HMAC | Implemented + tested (`lp-04r`) |
| Secret hash-at-rest + material inject | Implemented (`crypto.ts`, `gateway-relay-env.ts`, `store.ts`) |
| Env redaction | Implemented (`daytona-env-redact.ts`, SDK) |
| Dual-run no flip + allowlist gate | Implemented (`runtime-path.ts`) |
| Production egress allowlist completeness | **Already** `lp-ccp` |
| Product STS AssumeRole inject at wake | Documented design + lab; not a guest cross-tenant path today if no broad keys in image — track under vault Phase 3 ops apply / follow-on when productizing STS (do not invent dual tracking if already under `lp-eto` apply work) |

### New residual filed from this review

| Finding | Severity | Why real | Bead |
|---------|----------|----------|------|
| **Provision `s3_vault_prefix` override not bound to `tenant_id`; ensure_online does not re-validate prefix shape / tenant segment** | P2 | Normative layout requires `^tenants/{tenant_id}/vault/$` (or multi-instance form) and “prefix from CP only” with shape validation on wake. Code accepts arbitrary non-empty override (test: `tenants/custom/vault` for unrelated tenant). Service-token register could point an instance at another tenant’s tree; IAM session policy rendered from that field would then **intentionally** allow that foreign tree. Defense-in-depth missing. | **`lp-3a1.1`** |

### Explicit non-findings

- No code path found where **unauthenticated** clients set vault prefix or mount another tenant.
- Webhook cannot rewrite `s3_vault_prefix`.
- Guest does not receive `DAYTONA_API_KEY` (platform config only; `daytona-config.ts`).

---

## 12. Review checklist (evidence matrix)

| Check | Result | Evidence |
|-------|--------|----------|
| IAM guest cannot Allow other tenant prefixes (template) | Pass | drafts/iam + smoke script |
| Default provision prefix = tenant tree | Pass | `buildS3VaultPrefix` / provision fields |
| ensure_online uses CP prefix only | Pass | `instance-orchestrator` buildCreateParams |
| Prefix override tenant-bound | **Fail (residual)** | `normalizeOptionalS3VaultPrefix` no tenant segment check |
| Postgres no plaintext relay secret | Pass | scrypt hash in `store.ts` / `crypto.ts` |
| Material inject fail-closed | Pass | `MissingInstanceSecretMaterialError` |
| Webhook HMAC timing-safe | Pass | `verifyDaytonaWebhookHmac` |
| Create/GET env not logged raw | Pass | `daytona-env-redact` + server logSafe |
| runtime_kind immutable on wake/stop | Pass | `assertRuntimeKindUnchanged` |
| Daytona tenant allowlist fail-closed | Pass | empty list denies when config enforced |
| domainAllowList product default | Residual → `lp-ccp` | server.ts omit |
| Mid-turn blocks reaper | Pass | `isMidTurnLockActive` / reapIdle |
| Mid-turn timeout safety | Pass | clear stale then idle |
| `_platform` denied to guest IAM | Pass | session policy Deny SID |
| No cross-tenant vault path (guest) | **Pass** | §4.5 |

---

## 13. Commands re-run for this bead

```bash
bash deploy/scripts/smoke-sandbox-vault-mount-iam.sh
# Expected: ALL CHECKS PASSED (offline, no AWS apply)
```

No live Daytona/AWS in this review (OPERATOR HOLD / thrift). Prior live isolation evidence remains in Phase 0 spikes (`lp-3en`, `lp-v2p`, `lp-4l5`, `lp-ctu`).

---

## 14. Sign-off language (for Phase 8 / pilot)

> For the **managed Daytona pilot** under default provision (`s3_vault_prefix = tenants/{tenant_id}/vault/`), with per-tenant IAM session policies as templated in `lp-t86` and Relay secrets handled via hash-at-rest + material inject + response redaction, **review finds no known guest-reachable cross-tenant vault access path**. Container isolation is an accepted pilot residual. Production network allowlist and privileged prefix-override binding remain tracked residuals before broader multi-tenant production attach.
