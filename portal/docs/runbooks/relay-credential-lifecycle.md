# Production runbook: relay credential lifecycle (G2.4)

| Field | Value |
|-------|--------|
| **Status** | Production path (lifecycle-first) |
| **Date** | 2026-07-12 |
| **Bead** | `cbd-hhj.3.4` (G2.4) |
| **Parent** | `cbd-hhj.3` — Relay credential lifecycle (register / rotate / revoke) |
| **Depends on** | G2.1 register · G2.2 rotate · G2.3 revoke (product APIs shipped) |

**Primary production model:** control-plane **register → rotate → revoke**, with host secret material in **SSM SecureString or Secrets Manager**, never long-lived paste into Terraform state or git.

Show-once plaintext appears **only** at register and rotate API responses so operators can write the secret store. That is an **API property**, not an ops process of “paste secrets forever in tickets.”

No live secrets, account IDs, or customer parameters in this document.

---

## Authority map

| Concern | Source of truth |
|---------|-----------------|
| Instance identity + secret **hashes** | Control plane (`gateway_instances`) |
| Plaintext secret at rest | AWS SSM SecureString or Secrets Manager (data plane) |
| Live WebSocket kill | Relay `POST /internal/instances/:id/revoke` → close **4401** |
| Host env | `GATEWAY_RELAY_SECRET` in `~/.hermes/.env` (mode `600`), fetched by instance role |
| Terraform | Non-secret refs only in production (`relay_instance_id`, `relay_wss_url`, SSM name / SM ARN) |

### Deploy runbooks (cross-links)

| Document | Role |
|----------|------|
| [company-brain-deploy — relay secret lifecycle](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/runbooks/relay-secret-lifecycle.md) | SSM/SM create, rotate overwrite, revoke delete, IAM, state hardening |
| [company-brain-deploy — provision runbook](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/provision-runbook.md) | End-to-end tenant provision → Terraform → bootstrap |
| [control-plane package README](../../packages/control-plane/README.md) | HTTP contracts, grace period, audit actions |
| [relay package README](../../packages/relay/README.md) | Force-revoke internal API + 4401 staging proof |

---

## Production path (required)

### 1. Register (create instance + first secret)

**Canonical API (prefer):**

```http
POST /tenants/:tenant_id/instances/register
```

**Compat alias** (same handler): `POST /tenants/:tenant_id/instances/provision`

Response **201** (capture `secret` once — control plane cannot re-show it):

```json
{
  "instance_id": "<uuid>",
  "tenant_id": "<uuid>",
  "secret": "<show-once-plaintext>",
  "relay_tier": "shared",
  "relay_wss_url": "wss://relay.withlanyard.com",
  "relay_close_code_on_revoke": 4401
}
```

**Operator steps:**

1. Call **register** from a private ops channel (not a public ticket body).
2. Immediately `aws ssm put-parameter` (SecureString) or Secrets Manager create — **outside Terraform**.  
   Name convention (deploy): `/company-brain/<slug>/gateway-relay-secret`
3. Put **only** non-secrets in tenant tfvars: `relay_instance_id`, `relay_wss_url`, `relay_secret_source=ssm`, `relay_secret_ssm_parameter_name`.  
   Leave `relay_instance_secret` **unset**.
4. `terraform apply` → instance role can `ssm:GetParameter`.
5. On host: fetch secret via instance role → write `GATEWAY_RELAY_SECRET` → restart gateway.
6. Confirm portal chat / gateway dial.

Detail: [deploy relay-secret-lifecycle §1](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/runbooks/relay-secret-lifecycle.md).

### 2. Rotate (new secret, same instance_id)

```http
POST /tenants/:tenant_id/instances/:instance_id/rotate
Content-Type: application/json

{ "grace_period_seconds": 900 }
```

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `grace_period_seconds` | `900` (15m) | Previous secret still validates until `previous_secret_accepted_until` |
| `0` | immediate | Old secret invalid as soon as rotate commits |

**Operator steps:**

1. Rotate; capture new `secret` once.
2. Overwrite **same** SSM parameter name (`PutParameter --overwrite`) or SM new version.
3. Host re-fetch + restart gateway before grace ends (or use grace `0` and restart immediately).
4. Optional: `POST /internal/instances/validate` with new secret.
5. Do **not** change `relay_instance_id` or Terraform secret **name** for a normal rotate.

Detail: [control-plane README — Rotate](../../packages/control-plane/README.md) and [deploy lifecycle §2](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/runbooks/relay-secret-lifecycle.md).

### 3. Revoke (kill credential + live sessions)

| Goal | Control plane | Relay follow-up |
|------|---------------|-----------------|
| One instance | `POST /tenants/:id/instances/:instanceId/revoke` | `POST {RELAY_URL}/internal/instances/:instanceId/revoke` + `x-relay-internal-token` |
| All instances for tenant | `POST /tenants/:id/deprovision` | Same relay revoke **per** `revoked_instance_id` |

- CP is credential SoT; it does **not** push to the relay.
- Relay force-close uses WebSocket code **4401**.
- Delete or disable cloud secret parameter after revoke; clear host env.

Detail: [relay README — Force-revoke](../../packages/relay/README.md) and [deploy lifecycle §3](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/runbooks/relay-secret-lifecycle.md).

### 4. Production checklist

```text
[ ] Used register (or provision alias) — not a hand-invented shared password
[ ] Secret stored in SSM/SM only; not in git, tfvars, or Terraform state
[ ] Host obtained secret via instance role (not laptop paste into production)
[ ] Rotate uses CP rotate + SSM overwrite + host restart (grace understood)
[ ] Revoke = CP revoke/deprovision + relay internal revoke (4401) + secret delete
[ ] Audit actions present (instance.provisioned / rotated / revoked) without secret plaintext
```

---

## Lab / local path (non-production only)

> **LAB / DEV ONLY — not for real tenants or production_intent deployments.**

Local and CI may use simplified secret handling so developers can run the stack without AWS:

| Lab practice | Allowed in lab? | Production? |
|--------------|-----------------|-------------|
| Inline `relay_instance_secret` in local tfvars / state | Yes, throwaway accounts only | **No** |
| `GATEWAY_RELAY_SECRET` exported in a personal shell | Yes | **No** (use instance role fetch) |
| Control-plane in-memory or local SQLite with re-provision | Yes | Prod uses durable CP + SSM/SM |
| Pasting show-once secret into a shared chat for “just this once” | Discouraged even in lab | **Forbidden** |
| docker-compose / `pnpm dev` with dev tokens | Yes | **No** |

Labels for docs and scripts:

- Prefix lab sections with **`[lab-only]`** or **`non-prod`**.
- Deploy modules that still accept inline secrets must keep `deployment_mode=production` fail-closed against sealing secrets into state (see customer-gateway-relay module doctrine).

If a procedure says “copy the secret into Terraform,” treat that sentence as **lab-only** unless it immediately stores the value in SSM/SM and clears it from tfvars.

---

## API quick reference

| Method | Path | Use |
|--------|------|-----|
| `POST` | `/tenants/:id/instances/register` | **Canonical** create |
| `POST` | `/tenants/:id/instances/provision` | Compat alias of register |
| `POST` | `/tenants/:id/instances/:instanceId/rotate` | New secret (show once) |
| `POST` | `/tenants/:id/instances/:instanceId/revoke` | Revoke one (G2.3) |
| `POST` | `/tenants/:id/deprovision` | Revoke all for tenant |
| `GET` | `/tenants/:id/gateway-instances` | List ids (no secrets) |
| `POST` | `/internal/instances/validate` | Relay/ops check |
| `POST` | `{RELAY}/internal/instances/:id/revoke` | Live session kill 4401 |

---

## Staging / test evidence (no secrets)

When a shared staging environment is unavailable, product tests are the accepted proof substitute:

```bash
pnpm --filter @lanyard/control-plane test
pnpm --filter @lanyard/relay test
```

Covered: register/rotate/revoke validation outcomes; live mock WS closed with **4401** on relay revoke.

---

## Relationship to “show-once”

| Phrase | Meaning in production |
|--------|------------------------|
| **Show-once API response** | Plaintext returned once at register/rotate so the operator can write SSM/SM. Expected. |
| **Show-once-only ops** | Treating ad-hoc secret paste **as the long-term lifecycle** (no rotate/revoke path, secrets in tickets/tf state). **Replaced by this runbook.** |

G2.4 is complete when operators follow **register / rotate / revoke** above and lab shortcuts stay labeled non-prod.
