# Runbook: provision a real (non-MockLab) production tenant

**Status:** Operator procedure. Short-stack / Daytona product path.  
**Bead:** `lp-oop.37.9` · **Epic:** `lp-oop.37`  
**Audience:** operators creating the **second** tenant in a live env (first paying / real tenant).

**MockLab is UAT.** Tenant `319d3808-e533-44db-bfdf-7b6ef8caaae1` slug `mocklab` is the lab SOE, not a customer. Do **not** copy its rows, secrets, or S3 objects from chat memory. This file is how a second tenant is created in prod (or a staging-like env that already has the shared stack).

This is **not** the EC2 host path and **not** a MockLab kitchen-sink clone.

| Path | Use |
|------|-----|
| **This file** | Shared-platform + Daytona + short-stack **second tenant** |
| [provision-runbook.md](../../deploy/references/provision-runbook.md) | `runtime_kind=ec2` only (tenant TF + host bootstrap) |
| [provision-runbook-daytona.md](../plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md) | Daytona field contract + lazy wake |
| [s3-vault-prefix-layout.md](../plans/0008-daytona-agent-sandboxes/s3-vault-prefix-layout.md) | Prefix shape (do not invent another) |
| [mocklab-short-stack-harness.md](../../deploy/references/runbooks/mocklab-short-stack-harness.md) | Shared harness task (already exists; do not clone) |

**Do not** `terraform apply` a tenant template. **Do not** create ECS clusters, ALBs, vault buckets, or Daytona orgs per tenant. **Do not** put secret values in git, tickets, or this file.

---

## 1. Shared vs per-tenant

Isolation is `tenant_id` + prefix + RBAC. Not a second cluster.

### Shared (reuse — one per environment)

| Resource | Notes |
|----------|--------|
| ECS clusters | Existing portal + CP clusters (lab names: `lanyard-platform-staging-portal`, `lanyard-platform-staging-portal-cp`) |
| Fargate services | BFF, CP, Relay, harness, Document Server |
| VPC / private subnets | Same as CP / BFF tasks. `assignPublicIp=DISABLED` |
| Internal ALB | CP + harness listener (lab: `lanyard-platform-staging-cp-alb`). No public harness ALB |
| `CONTROL_PLANE_URL` | Internal ALB DNS. Browser never calls CP |
| `CONTROL_PLANE_SERVICE_TOKEN` | Shared BFF↔CP. Header `x-control-plane-service-token` |
| `INTERNAL_OPS_TOKEN` | Shared ops elevation. Header `x-internal-ops-token` |
| `HARNESS_URL` + `HARNESS_SERVICE_TOKEN` | One harness task. Same token on BFF + harness. Do not mint a second token per tenant |
| Daytona org / API | `DAYTONA_API_KEY`, `DAYTONA_ORG_ID`, `DAYTONA_REGION` on **CP only**. Never on BFF, harness, guest, or tenant |
| `DAYTONA_DEFAULT_SNAPSHOT` | Platform pin. Instance may override `agent_snapshot_id` |
| `DAYTONA_DOMAIN_ALLOWLIST` | Shared egress catalog ([production-network-allowlist.md](../plans/0008-daytona-agent-sandboxes/production-network-allowlist.md)) |
| Vault **bucket** | One per env. Lab (already in repo): `lanyard-mocklab-vault-123456789012`. Product: `lanyard-vault-{env}`. CP env `S3_VAULT_BUCKET` |
| Sandbox mount IAM | Shared base role `lanyard-sandbox-vault-mount` (`SANDBOX_VAULT_MOUNT_ROLE_ARN`). Session policy binds **one** prefix at wake |
| CloudFront / `app.withlanyard.com` | Path `/{slug}` + host `{slug}.withlanyard.com`. No new distribution |

### Per tenant (create these)

| Item | Shape |
|------|--------|
| CP tenant row | `POST /tenants` `{ "slug", "display_name" }` → `tenant_id` (UUID) |
| Hosts | `{slug}.withlanyard.com` · portal `https://app.withlanyard.com/{slug}` |
| Gateway instance | `POST /tenants/:id/instances/register` `{ "runtime_kind": "daytona" }` — one **tenant primary** now |
| `s3_vault_prefix` | **`tenants/{tenant_id}/vault/`** (trailing slash). Not slug. Not `sandbox_id`. Not MockLab’s prefix |
| Prefix marker | `tenants/{tenant_id}/_platform/vault-prefix-ensured.json` (never mounted) |
| RBAC | `POST /tenants/:id/roles` + `PUT /tenants/:id/users/:userId/roles` |
| Users | `POST /tenants/:id/users/register` (or IdP). Memberships same-tenant only |
| `chat_delivery` persist | Tenant and/or instance. Default **NULL** → inherit BFF `CHAT_DELIVERY` (default `relay`) |
| `vault_plane` | **No persist today.** BFF env `VAULT_PLANE=fs\|brain_rpc\|cp_s3`. Shared process. Live short-stack BFF is `cp_s3`. Do not invent a tenant column |
| Secrets / material | New SSM/SM names under this slug. New show-once register secret. New backend-runtime envelope if models are enabled |
| Daytona tenant allowlist | Append this `tenant_id` to shared CP `DAYTONA_TENANT_ALLOWLIST` (empty = deny all) |
| 0010 user instances | **Later.** `ensure_online(tenant, user)` uses a user-scope instance if one exists, else tenant primary. Do not pre-create user instances |

---

## 2. Isolation (must hold)

| Rule | How |
|------|-----|
| `tenant_id` on every BFF → CP → S3 / Daytona call | Vault HTTP is `/internal/tenants/:tenantId/vault/{list,stat,get}`. Wake is `POST /internal/tenants/:tenantId/users/:userId/ensure-online` (resolver) or `…/instances/:instanceId/ensure-online` |
| No cross-tenant list/get | CP binds keys to `tenants/{that tenant_id}/vault/`. Outside prefix → `VAULT_CROSS_TENANT` (403) |
| Prefix immutable | Do not rewrite `s3_vault_prefix` on wake/idle. Do not copy another tenant’s objects |
| Sandbox IAM prefix-bound | STS session policy: `s3:prefix = tenants/{tenant_id}/vault/*`. Deny `_platform/` and sibling tenants. No shared `tenants/*` guest role |
| One mount = one prefix | Sandbox mounts only this instance’s prefix |
| No Daytona keys on tenant/guest | Orchestrator only |
| Short-stack create env | Harness / `tool_only` create omits provider keys and `GATEWAY_RELAY_SECRET` |
| Browser | Cookies on BFF only. Never harness or Daytona tokens |

---

## 3. Flags

| Flag | Where | Default | Second-tenant rule |
|------|--------|---------|---------------------|
| `CHAT_DELIVERY` | BFF env | `relay` | **Leave unset / relay.** Do not set global `harness` |
| `tenants.chat_delivery` | Persist | `NULL` (inherit) | Flip **this** tenant only after harness is healthy: `PATCH /internal/tenants/:id/chat-delivery` `{ "chat_delivery": "harness" }` |
| `gateway_instances.chat_delivery` | Persist | `NULL` (inherit tenant then env) | Optional instance override. Resolve: instance > tenant > env > `relay` |
| `VAULT_PLANE` | BFF env | implicit `fs` (or `brain_rpc` if `BRAIN_RPC_ENABLED`) | Shared. Live short-stack uses `cp_s3`. No per-tenant persist — do not add one in this procedure |
| `ENSURE_ONLINE_ON_CHAT` | BFF env | off | Shared. Needed for guest/Relay wake; harness path uses `ensure_online(tenant, user)` itself |
| `ENSURE_ONLINE_ON_BRAIN_RPC` | BFF env | off | Keep off when `VAULT_PLANE=cp_s3` (Directory must not wake) |
| `DAYTONA_ENABLED` | CP env | off | Shared. Already on if MockLab wakes |
| `DAYTONA_TENANT_ALLOWLIST` | CP env | empty = deny | **Add the new `tenant_id`.** Do not replace MockLab’s id |
| `runtime_kind` | Instance | `ec2` if body omitted | Must send **`daytona`** |

Clear persist with `chat_delivery: null`.

---

## 4. Private worksheet (fill; never commit)

```text
ENV                  = prod | staging-like
CP_BASE              = http://<internal-cp-alb-dns>     # from a BFF task / VPC jump
SLUG                 = <lowercase [a-z0-9-]; not mocklab>
DISPLAY_NAME         = <customer name>
TENANT_ID            = <from POST /tenants>
INSTANCE_ID          = <from register>
S3_VAULT_PREFIX      = tenants/<TENANT_ID>/vault/
VAULT_BUCKET         = <existing env bucket; lab: lanyard-mocklab-vault-123456789012>
SSM_RELAY_SECRET     = /company-brain/<SLUG>/gateway-relay-secret
SM_BACKEND_SECRETS   = /company-brain/<SLUG>/backend-runtime-secrets
ADMIN_EMAIL          = <operator-held>
```

Auth (values from SM/SSM; never paste into tickets):

```bash
# From a BFF task or VPC jump (not the public internet):
CP_BASE="${CONTROL_PLANE_URL}"   # already on BFF
AUTH=(-H "x-control-plane-service-token: ${CONTROL_PLANE_SERVICE_TOKEN}")
OPS=(-H "x-internal-ops-token: ${INTERNAL_OPS_TOKEN}")
```

---

## 5. Numbered checklist

Stop after **5.9** for a **dry-run** tenant (identity + prefix string + RBAC; no allowlist, no wake, no customer secrets). Continue **5.10–5.13** only with live approval.

### 5.0 Preconditions

1. Shared stack already serves MockLab. Do not apply `environments/platform-staging` or re-enable torn-down staging AWS ([OPERATOR HOLD](../../deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md)).
2. Harness task exists on the **existing** CP cluster ([mocklab-short-stack-harness.md](../../deploy/references/runbooks/mocklab-short-stack-harness.md) §4). Do not create a second harness.
3. Vault bucket + `SANDBOX_VAULT_MOUNT_ROLE_ARN` already on CP. Do not create a bucket.
4. Slug is not `mocklab`. Slug regex: `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`.
5. Confirm MockLab still exists and will stay UAT:

```bash
curl -sS "${AUTH[@]}" "$CP_BASE/tenants/by-slug/mocklab"
# expect tenant_id 319d3808-e533-44db-bfdf-7b6ef8caaae1
```

### 5.1 Create tenant

```bash
TENANT_JSON="$(curl -sS "${AUTH[@]}" -X POST "$CP_BASE/tenants" \
  -H 'content-type: application/json' \
  -d "{\"slug\":\"$SLUG\",\"display_name\":\"$DISPLAY_NAME\"}")"
TENANT_ID="$(printf '%s' "$TENANT_JSON" | jq -r .tenant_id)"
```

Expect **201**. Host is `{slug}.withlanyard.com`. **409** = slug taken — pick another.

`GET $CP_BASE/tenants/$TENANT_ID` → `chat_delivery` is `null`.

### 5.2 Register tenant-primary instance (Daytona)

```bash
REG_JSON="$(curl -sS "${AUTH[@]}" -X POST "$CP_BASE/tenants/$TENANT_ID/instances/register" \
  -H 'content-type: application/json' \
  -d '{"runtime_kind":"daytona"}')"
INSTANCE_ID="$(printf '%s' "$REG_JSON" | jq -r .instance_id)"
```

Expect **201**. Register does **not** return `chat_delivery`. Persist stays `NULL`; assert via tenant GET (5.1) and `GET $CP_BASE/tenants/$TENANT_ID/gateway-instances` (instance `chat_delivery` is `null`).

| Field | Must be |
|-------|---------|
| `runtime_kind` | `daytona` |
| `s3_vault_prefix` | `tenants/<TENANT_ID>/vault/` |
| `sandbox_id` | `null` |
| `presence` | `offline` |
| `ec2_instance_id` | `null` |
| `secret` | show once — store immediately (worksheet; skip 5.3 on dry-run) |

Empty body defaults to **`ec2`** — wrong for this path. Do not apply `deploy/templates/tenant`.

Optional: `"agent_snapshot_id": "<pin>"` to pin; else inherit `DAYTONA_DEFAULT_SNAPSHOT`. Do not copy MockLab’s snapshot id unless a human pin says so (`lp-oop.37.5`).

Do **not** Daytona create/start. Lazy on first `ensure_online`.

### 5.3 Store the show-once secret

**Dry-run:** skip this SSM put. Keep `secret` on the operator worksheet only (do not commit).

```bash
# Live only. Add --region / AWS_PROFILE for the env.
aws ssm put-parameter \
  --name "/company-brain/${SLUG}/gateway-relay-secret" \
  --type SecureString \
  --value '<secret from register>' \
  --overwrite
```

Optional: `PATCH /tenants/$TENANT_ID/instances/$INSTANCE_ID/registry` `{ "secret_param_arn": "arn:aws:ssm:…:parameter/company-brain/<SLUG>/gateway-relay-secret" }` (ARN only).

CP Postgres keeps hashes. Multi-process CP needs durable `InstanceSecretMaterialStore` (SSM/SM), not `/tmp` (`lp-oop.37.6`).

### 5.4 Confirm prefix (do not invent a second layout)

```text
s3_vault_prefix = tenants/{tenant_id}/vault/
full URI        = s3://{VAULT_BUCKET}/tenants/{tenant_id}/vault/{relative}
IAM object ARN  = arn:aws:s3:::{VAULT_BUCKET}/tenants/{tenant_id}/vault/*
```

Reject `/`, `..`, or slug-as-id. **Forbidden:** MockLab prefix, `tenants/mocklab/vault/`, any key containing `sandbox_id`.

### 5.5 Ensure prefix (optional seed)

When live `VaultObjectStore` is wired on CP (`S3_VAULT_BUCKET` + real store; residual `lp-oop.37.1`):

1. `ensureVaultPrefixForDaytonaProvision({ tenantId, runtimeKind: "daytona", bucket, store })` — writes `tenants/{tenant_id}/_platform/vault-prefix-ensured.json` if missing.
2. Optional seed: `bootstrapVaultForDaytonaProvision` / `bootstrapTenantVaultSeed` with a **caller-supplied** pack. Skip if `AGENTS.md` or `_platform/bootstrap.json` exists.

**Dry-run:** skip live puts. Record the prefix string only.

**Do not:**

- Copy `s3://lanyard-mocklab-vault-123456789012/tenants/319d3808-…/vault/` or `…/tenants/mocklab/vault/`
- Run `seed-mocklab-s3-vault.sh --use-mocklab-default` or `seed-demo-vault.sh` on a customer prefix
- Create a second bucket or a second prefix if seed fails — re-run seed

### 5.6 RBAC

```bash
# Admin — full vault
ADMIN_ROLE_JSON="$(curl -sS "${AUTH[@]}" -X POST "$CP_BASE/tenants/$TENANT_ID/roles" \
  -H 'content-type: application/json' \
  -d '{"name":"admin","hermes_profile":"admin","path_prefixes":["/"]}')"
ADMIN_ROLE_ID="$(printf '%s' "$ADMIN_ROLE_JSON" | jq -r .role_id)"

# Contributor — constrain prefixes per SOW (example)
curl -sS "${AUTH[@]}" -X POST "$CP_BASE/tenants/$TENANT_ID/roles" \
  -H 'content-type: application/json' \
  -d '{"name":"contributor","hermes_profile":"contributor","path_prefixes":["/Projects","/Knowledge"]}'
```

`hermes_profile` must be a host-known profile (`admin` / `contributor`). Wire field is still `hermes_profile`.

Register the first admin (password min 8; never committed):

```bash
USER_JSON="$(curl -sS "${AUTH[@]}" -X POST "$CP_BASE/tenants/$TENANT_ID/users/register" \
  -H 'content-type: application/json' \
  -d '{"email":"<admin@customer>","password":"<operator-held>"}')"
USER_ID="$(printf '%s' "$USER_JSON" | jq -r .user_id)"

curl -sS "${AUTH[@]}" -X PUT "$CP_BASE/tenants/$TENANT_ID/users/$USER_ID/roles" \
  -H 'content-type: application/json' \
  -d "{\"role_ids\":[\"$ADMIN_ROLE_ID\"]}"
```

Chat / vault fail closed without a role. Do not assign MockLab user ids.

### 5.7 `chat_delivery` (leave inherit unless flipping this tenant)

Default: **do nothing** (`NULL` → BFF env → `relay`). Guest/Relay stays available.

To flip **only this tenant** to harness (after shared harness is healthy):

```bash
curl -sS "${OPS[@]}" -X PATCH "$CP_BASE/internal/tenants/$TENANT_ID/chat-delivery" \
  -H 'content-type: application/json' \
  -d '{"chat_delivery":"harness"}'
```

Or `PATCH /tenants/$TENANT_ID/instances/$INSTANCE_ID/registry` `{ "chat_delivery": "harness" }`.

Do **not** set BFF `CHAT_DELIVERY=harness`. MockLab’s persist (if any) stays on MockLab.

### 5.8 `vault_plane`

No tenant PATCH. Shared BFF `VAULT_PLANE`:

| Value | Effect |
|-------|--------|
| `cp_s3` | Directory / Office via CP S3. `GET /api/vault/tree` must **not** call `ensure_online` |
| unset + `BRAIN_RPC_ENABLED` | today’s guest Brain RPC |
| unset | `fs` |

Live short-stack BFF already uses `cp_s3` for the env. A second tenant inherits that. If persist is added later, treat it like `chat_delivery` (instance > tenant > env) — it does not exist as of this bead.

### 5.9 Isolation dry-run (required before go-live)

```bash
# Prefix shape
echo "tenants/${TENANT_ID}/vault/"   # must match register response

# This tenant vault list (own prefix). Empty vault → 200 + entries: [].
# If VaultObjectStore is not wired (5.5 / lp-oop.37.1 residual) → 501
# VAULT_OBJECT_STORE_NOT_CONFIGURED on both list calls below (deps check
# runs first). Cross-tenant 403 is only when the store is wired.
curl -sS "${AUTH[@]}" \
  "$CP_BASE/internal/tenants/$TENANT_ID/vault/list?path=/"

# Cross-tenant: CP does not ignore a foreign prefix — it 403s.
curl -sS "${AUTH[@]}" \
  "$CP_BASE/internal/tenants/$TENANT_ID/vault/list?path=/&prefix=tenants/319d3808-e533-44db-bfdf-7b6ef8caaae1/vault/"
# expect 403, code VAULT_CROSS_TENANT — never MockLab keys
# (501 VAULT_OBJECT_STORE_NOT_CONFIGURED if store not wired)

# Primary instance is this tenant’s
curl -sS "${AUTH[@]}" "$CP_BASE/internal/tenants/$TENANT_ID/primary-instance"

# Roles scoped to this tenant
curl -sS "${AUTH[@]}" "$CP_BASE/tenants/$TENANT_ID/roles"
```

Pass:

- [ ] `s3_vault_prefix` matches `^tenants/<this-uuid>/vault/$`
- [ ] Prefix does not contain MockLab’s id or `mocklab`
- [ ] Foreign-prefix list is **403** `VAULT_CROSS_TENANT` (or **501** `VAULT_OBJECT_STORE_NOT_CONFIGURED` if store not wired)
- [ ] `GET …/primary-instance` ≠ MockLab instance
- [ ] Role `tenant_id` = this tenant
- [ ] No `terraform apply` under `deploy/templates/tenant`

**Dry-run stop.** Tear down with §6 if this was only a drill.

### 5.10 Allowlist + secrets (live only)

1. Append `TENANT_ID` to CP task `DAYTONA_TENANT_ALLOWLIST` (comma-separated). Redeploy CP or update the task env. Keep MockLab’s id.
2. Create **new** backend-runtime envelope at `/company-brain/<SLUG>/backend-runtime-secrets` ([backend-runtime-secrets.md](backend-runtime-secrets.md)). Omit unused slots. Never clone MockLab SM JSON.
3. Confirm CP `S3_VAULT_BUCKET` + `SANDBOX_VAULT_MOUNT_ROLE_ARN` unchanged (shared).
4. Do not add Daytona API keys, harness token, or `GATEWAY_RELAY_SECRET` to the guest image.

### 5.11 First wake (live only)

Do **not** wake as part of dry-run.

```bash
# Resolver: user instance if 0010 exists, else tenant primary
curl -sS "${AUTH[@]}" -X POST \
  "$CP_BASE/internal/tenants/$TENANT_ID/users/$USER_ID/ensure-online" \
  -H 'content-type: application/json' -d '{}'
```

Expect `instance_id` = this primary (until 0010). Presence `online`. `sandbox_id` set. Prefix unchanged.

IAM: wake STS session is bound to `tenants/{tenant_id}/vault/*` only.

### 5.12 Portal smoke (live only)

1. Open `https://app.withlanyard.com/<SLUG>` (or `https://<SLUG>.withlanyard.com`).
2. Sign in as the tenant admin.
3. Send a chat. Confirm stream.
4. `GET /api/vault/tree` is 200 and does **not** wake when `VAULT_PLANE=cp_s3`.
5. Confirm MockLab (`/mocklab`) still works and still has its own prefix.

### 5.13 Record (no secrets)

Ticket / bead note: `tenant_id`, `slug`, `instance_id`, `s3_vault_prefix`, `chat_delivery`, allowlist **updated** (yes/no), seed **yes/no**. No secret values, no SM JSON.

---

## 6. Rollback

| Step already done | Undo |
|-------------------|------|
| `chat_delivery=harness` | `PATCH …/chat-delivery` `{ "chat_delivery": null }` (or `"relay"`) |
| Daytona allowlist | Remove this `tenant_id` from `DAYTONA_TENANT_ALLOWLIST`. Leave MockLab |
| Sandbox online | `POST /internal/instances/:instanceId/stop` (or wait idle reaper). Prefix stays |
| Instance registered | `POST /tenants/:id/instances/:instanceId/revoke` — archive sandbox if any; delete material; Relay 4401 |
| Tenant created | `POST /tenants/:id/deprovision` — revoke all instances; **retain** vault (default) |
| SSM/SM created | Delete or disable `/company-brain/<SLUG>/gateway-relay-secret` and backend-runtime envelope |
| Prefix ensured | **Keep objects** unless legal/ops signs optional GC (`VAULT_DEPROVISION_GC_MODE`; default retain) |

Do **not** destroy the shared vault bucket, ECS services, harness, Daytona org, or MockLab rows.

```bash
# Instance
curl -sS "${AUTH[@]}" -X POST \
  "$CP_BASE/tenants/$TENANT_ID/instances/$INSTANCE_ID/revoke"

# Tenant (all instances)
curl -sS "${AUTH[@]}" -X POST "$CP_BASE/tenants/$TENANT_ID/deprovision"
```

Expect `vault_retained: true`, `vault_gc_deleted_count: 0`.

---

## 7. Forbidden

| Action | Why |
|--------|-----|
| Clone MockLab’s `tenant_id` / instance / prefix / SM JSON | Cross-tenant leak; UAT ≠ prod |
| Second ECS cluster / public ALB / vault bucket | Isolation is prefix + IAM, not new AWS products |
| `templates/tenant` TF for `runtime_kind=daytona` | Fail-closed (`daytona_forbids_company_brain_ec2_template`) |
| Daytona create at provision | Lazy wake only |
| Global `CHAT_DELIVERY=harness` | Flips every tenant |
| Guest / harness Daytona or provider keys | Boundary |
| Broad sandbox role on `tenants/*` | Cross-tenant S3 |
| Demo / MockLab vault seed on a customer prefix | Lab content in prod |

---

## 8. Offline checks (no AWS apply)

```bash
bash scripts/validate.sh
# Contract + layout still SoT:
#   docs/plans/0008-daytona-agent-sandboxes/s3-vault-prefix-layout.md
#   docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md
```

---

## Related

- Layout: [s3-vault-prefix-layout.md](../plans/0008-daytona-agent-sandboxes/s3-vault-prefix-layout.md)
- IAM: [iam-scoped-s3-mount-policy.md](../plans/0008-daytona-agent-sandboxes/iam-scoped-s3-mount-policy.md)
- Retain vs GC: [vault-s3-retain-vs-gc.md](../plans/0008-daytona-agent-sandboxes/vault-s3-retain-vs-gc.md)
- Dual-run chat: [phase-8-dual-run-proof.md](../plans/0015-short-stack/phase-8-dual-run-proof.md)
- Relay secret lifecycle: [relay-secret-lifecycle.md](../../deploy/references/runbooks/relay-secret-lifecycle.md)
- Backend secrets: [backend-runtime-secrets.md](backend-runtime-secrets.md)
- MockLab INDEX (UAT only): [deploy/deployments/mocklab/INDEX.md](../../deploy/deployments/mocklab/INDEX.md)
- Kitchen-sink SOE (lab parity, not this procedure): [NEW-TENANT-CHECKLIST.md](../../artifacts/mocklab/live-qa/NEW-TENANT-CHECKLIST.md)
