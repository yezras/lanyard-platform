# Relay secret lifecycle (register / rotate / revoke)

**Status:** Production operator runbook — **lifecycle-first**.  
**Product APIs:** Portal control plane (`register` / `rotate` / per-instance `revoke` / tenant `deprovision`).  
**Deploy surface:** SSM/Secrets Manager storage + host fetch (`modules/customer-gateway-relay/`).  
**No live secrets, account IDs, or customer parameters in this repo.**

Staging env inventory (GitHub + SM/SSM + Portal runtime names): `references/runbooks/staging-secrets-checklist.md`.

Show-once secret material still appears **at register and rotate responses only**. That is a **transport property** of the API, not a license to treat ad-hoc secret paste as the production process. Production ops use **register → store → rotate → revoke** as first-class steps.

---

## Goals

- Prefer **control-plane register / rotate / revoke** over one-time provision paste as the long-term model.
- Keep plaintext secret **out of** Terraform variables, state, plans, user_data, local_file trees, and git.
- Store secret as **SSM Parameter Store SecureString** (default) or **Secrets Manager**.
- Host retrieves via **EC2 instance role** and writes `GATEWAY_RELAY_SECRET` only on the host (`~/.hermes/.env`, mode `600`).
- Label **lab inline** secrets as **non-production only**.

Module: `modules/customer-gateway-relay/` (`relay_secret_source`, `deployment_mode`).

---

## Production path overview

```text
POST .../instances/register   →  instance_id + secret (once)
        ↓
SSM SecureString / Secrets Manager  (outside Terraform)
        ↓
tfvars: relay_instance_id + secret ref only  →  terraform apply
        ↓
host role fetch → GATEWAY_RELAY_SECRET  →  hermes-gateway

Rotate:  POST .../instances/:id/rotate  →  overwrite same SSM name  →  host refresh
Revoke:  POST .../instances/:id/revoke  and/or  POST .../deprovision  →  expect WS 4401
```

Canonical product docs: Portal `@lanyard/control-plane` README (register / rotate / revoke contracts). Deploy runbook below is the **data-plane** half.

---

## 1. Register (first production path)

Canonical control-plane call (prefer **register** over legacy **provision** alias):

```http
POST /tenants/:tenant_id/instances/register
→ {
    "instance_id": "...",
    "tenant_id": "...",
    "secret": "...",                    // show once — capture immediately
    "relay_tier": "shared",
    "relay_wss_url": "wss://…",
    "relay_close_code_on_revoke": 4401
  }
```

`POST /tenants/:tenant_id/instances/provision` is a **compat alias** of register (same handler/body). New automation should call **register**.

1. Capture `secret` **once**; do not paste into chat logs, tickets, or git.
2. Put secret in AWS **outside Terraform** (SSM SecureString):
   ```bash
   TENANT_SLUG="<slug>"
   PARAM="/company-brain/${TENANT_SLUG}/gateway-relay-secret"
   # Read secret from a local secure prompt or sealed store — never commit it.
   read -r -s RELAY_SECRET
   aws ssm put-parameter \
     --name "$PARAM" \
     --type SecureString \
     --value "$RELAY_SECRET" \
     --overwrite
   unset RELAY_SECRET
   ```

   Secrets Manager alternative:
   ```bash
   aws secretsmanager create-secret \
     --name "company-brain/${TENANT_SLUG}/gateway-relay-secret" \
     --secret-string "$RELAY_SECRET"
   # Record the returned ARN for terraform.tfvars
   ```

3. Tenant `terraform.tfvars` (private working tree only) — **non-secret fields only**:
   ```hcl
   deployment_mode                 = "production"
   relay_secret_source             = "ssm"
   relay_instance_id               = "<instance_id>"
   relay_wss_url                   = "wss://…"
   relay_secret_ssm_parameter_name = "/company-brain/<slug>/gateway-relay-secret"
   # relay_instance_secret  — leave unset / empty
   ```

4. `terraform apply`. Instance role receives `ssm:GetParameter` (and conditional `kms:Decrypt`) via tenant `aws_iam_role_policy.portal_relay_secret_read` when `attach_relay_secret_iam = true`.

5. On host (after bootstrap):
   ```bash
   # terraform output -raw host_secret_fetch_command
   SECRET=$(aws ssm get-parameter --name "$PARAM" --with-decryption --query Parameter.Value --output text)
   # Merge GATEWAY_RELAY_* public keys + GATEWAY_RELAY_SECRET into ~/.hermes/.env (600)
   # Restart hermes-gateway
   unset SECRET
   ```

---

## 2. Rotate (production)

Product API issues a **new** secret for the **same** `instance_id` (default dual-accept grace ≈ 15 minutes so host refresh is not a hard cutover).

```http
POST /tenants/:tenant_id/instances/:instance_id/rotate
Content-Type: application/json

{ "grace_period_seconds": 900 }
```

Empty body uses the product default grace. `grace_period_seconds: 0` = immediate invalidation of the previous secret.

Response includes a **show-once** `secret` plus `previous_secret_accepted_until` when grace &gt; 0. `instance_id` is **unchanged**.

### Operator steps (SSM)

1. Identify active instance: `GET /tenants/:tenant_id/gateway-instances` (metadata only — no secret).
2. Call rotate; capture new `secret` once.
3. Overwrite the **same** SSM parameter name (new SecureString version; IAM ARNs stay stable):
   ```bash
   aws ssm put-parameter \
     --name "$PARAM" \
     --type SecureString \
     --value "$NEW_SECRET" \
     --overwrite
   unset NEW_SECRET
   ```
   Secrets Manager: `put-secret-value` on the same ARN.
4. On host: re-fetch → update `~/.hermes/.env` → restart gateway.
5. Confirm portal chat / dial with the new secret. After grace expires (or with `grace_period_seconds: 0`), the previous secret must fail validation.
6. **Do not** put the new secret into Terraform or re-apply with `relay_instance_secret`. **Do not** change `relay_instance_id` for a normal rotate.

Immediate cutover: rotate with `grace_period_seconds: 0` → overwrite SSM → restart host ASAP.

---

## 3. Revoke (production)

### 3a. Per-instance revoke (G2.3)

```http
POST /tenants/:tenant_id/instances/:instance_id/revoke
```

Control plane sets `revoked_at` on that instance (idempotent if already revoked). Validation returns `reason: "revoked"`.

**Relay kill-switch (product):** also invoke the relay internal revoke so live sessions close:

```http
POST {RELAY_URL}/internal/instances/{instance_id}/revoke
```

Expect gateway WebSocket close **4401**. CP responses may include a `relay_revoke_hint` for automation.

### 3b. Tenant deprovision (all instances)

```http
POST /tenants/:id/deprovision
```

Revokes **all** active instance secrets for the tenant. Follow with relay internal revoke per `revoked_instance_ids` when present.

### 3c. Cloud secret cleanup

```bash
# SSM — delete parameter (or overwrite with random and deny GetParameter)
aws ssm delete-parameter --name "$PARAM"

# Secrets Manager
aws secretsmanager delete-secret --secret-id "$ARN" --recovery-window-in-days 7
```

On host: remove `GATEWAY_RELAY_SECRET` from `~/.hermes/.env` (or destroy instance).  
Terraform destroy when contract ends; state should never have held the secret value if the production path was used.

---

## 4. IAM permissions (instance role)

Production SSM policy shape (module output `relay_secret_iam_policy_json`):

| Action | Resource |
|--------|----------|
| `ssm:GetParameter`, `ssm:GetParameters` | Single parameter ARN |
| `kms:Decrypt` (when CMK-backed SecureString) | Via `kms:ViaService=ssm.*.amazonaws.com` |

Secrets Manager:

| Action | Resource |
|--------|----------|
| `secretsmanager:GetSecretValue` | Secret ARN |
| `kms:Decrypt` | Via `kms:ViaService=secretsmanager.*.amazonaws.com` |

Operator/laptop roles used to **register/rotate** need `ssm:PutParameter` / `secretsmanager:PutSecretValue` (or Console equivalent)—separate from the instance role.

---

## 5. State backend hardening checklist

Use remote state for every real tenant (`templates/tenant/backend.tf.example`).

| Control | Requirement |
|---------|-------------|
| Encryption at rest | `encrypt = true` (SSE-S3 or SSE-KMS) |
| Locking | DynamoDB lock table or S3 native lock; no concurrent apply without lock |
| Public access | S3 Block Public Access **all four** ON; no public bucket policy/ACL |
| Principals | Bucket policy least-privilege: CI/deploy roles + break-glass only |
| Transport | Deny `aws:SecureTransport=false` |
| Versioning | ON for state bucket |
| Logging | Access logs or CloudTrail data events for state bucket |
| Secrets in state | **None** for relay secret: `deployment_mode=production` + `relay_secret_source=ssm\|secretsmanager` |
| Local state | Forbidden for production tenants |
| Plans/artifacts | Do not commit `*.tfplan`, `tfplan`, crash logs, or `terraform.tfvars` |

Even with hardened state, **prefer zero secret material in state** so a state read cannot exfiltrate relay credentials.

---

## 6. CI / scan guidance

Keep secrets out of:

| Surface | Guidance |
|---------|----------|
| **git** | `.gitignore` covers `terraform.tfvars`, `*.tfstate*`, `*.tfplan`; never force-add. Examples use placeholders only (`REPLACE_*`, RFC 5737 IPs). |
| **plans** | `terraform plan` should not show `GATEWAY_RELAY_SECRET` values in production (secret not a TF input). Avoid `-out` plan files with lab inline secrets in shared disks. |
| **user_data** | Must not embed relay secrets; artifact pins only. |
| **logs** | Do not `echo` secrets; unset after use; CI masks for `RELAY_SECRET` / `GATEWAY_RELAY_SECRET` if ever needed for lab. |
| **local_file** | `write_hermes_env_file` default false; production writes reference-only fragments. |
| **module outputs** | Use `hermes_env_vars_public` / `relay_secret_ref` in automation; avoid printing sensitive outputs in CI. |

Suggested offline checks:

```bash
# Fail if example tfvars still require a live-looking secret assignment without SSM path
rg -n 'relay_instance_secret\s*=\s*"[^R]' templates/tenant/terraform.tfvars.example && exit 1 || true
# Fail if committed files look like tfstate or tfvars with secrets
rg -n 'GATEWAY_RELAY_SECRET\s*=' --glob '!**/*.md' --glob '!**/templates/**/*.tpl' . && exit 1 || true
```

---

## 7. Lab-only inline path (**non-production**)

For throwaway sandboxes **only**:

```hcl
deployment_mode       = "lab"
relay_secret_source   = "inline"
relay_instance_secret = "<from register/provision show-once response>"
```

This **puts the secret in Terraform state**. **Never** use for real tenants. Prefer deleting lab state after use.

| Production | Lab (non-prod only) |
|------------|---------------------|
| `register` / `rotate` / `revoke` APIs | Same APIs OK for local demos |
| SSM/SM secret store | Inline `relay_instance_secret` allowed |
| `deployment_mode=production` | `deployment_mode=lab` |
| Secret never in TF state | Secret **will** appear in TF state |

Do **not** describe lab inline paste as the production relay security model. Production security gate: `references/runbooks/production-security-gate.md` (G2 still product-gated for full production claim until readiness matrix flips).

---

## Related

- Module README: `modules/customer-gateway-relay/README.md`
- Provision (lifecycle-first): `references/provision-runbook.md`
- Tenant template: `templates/tenant/`
- Production security gate: `references/runbooks/production-security-gate.md`
- Portal control-plane product README (`@lanyard/control-plane`) — API authority for register/rotate/revoke
