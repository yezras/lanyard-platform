# customer-gateway-relay

Terraform module for wiring a **customer EC2 Hermes gateway** to the Lanyard relay. Injects relay URL + **register** output **references** without inbound portal ports on the customer host.

Part of **company-brain-deploy** (canonical client deployment). Portal application/control-plane source stays in the Portal repo; this module only maps **register/provision outputs** to Hermes env.

**Scope honesty:** This module is **wiring-only**. It is **not** production relay/control-plane security by itself. Product owns credential lifecycle APIs; deploy owns SSM/SM storage + host fetch. Operator path is **register / rotate / revoke** — see `references/runbooks/relay-secret-lifecycle.md`, `references/readiness-matrix.md`, `references/runbooks/production-security-gate.md`.

**Hermes contract:** [relay-connector-contract v1](https://github.com/NousResearch/hermes-agent/blob/main/docs/relay-connector-contract.md)

> Live `terraform.tfvars`, SSM parameters, and customer AWS state belong in private deployment working trees—not in git.
>
> **Production rule:** the per-instance relay secret must **not** be a Terraform variable value. Store it in **SSM SecureString** or **Secrets Manager**; Terraform holds only the parameter name / secret ARN. The host loads `GATEWAY_RELAY_SECRET` via the instance role. See `references/runbooks/relay-secret-lifecycle.md`.

## Register flow (production)

1. Lanyard ops creates tenant → portal path `https://app.withlanyard.com/<tenant_slug>`.
2. Control plane **registers** gateway credentials (canonical; `provision` is a compat alias):
   ```http
   POST /tenants/:tenant_id/instances/register
   → {
       "instance_id": "<relay_instance_id>",
       "secret": "<one-time secret>",
       "relay_tier": "shared|dedicated",
       "relay_wss_url": "wss://…",
       "relay_close_code_on_revoke": 4401
     }
   ```
   The plaintext `secret` is shown **once** at register (and again only at **rotate**).
3. **Store the secret outside Terraform (production):**
   ```bash
   aws ssm put-parameter \
     --name "/company-brain/<tenant_slug>/gateway-relay-secret" \
     --type SecureString \
     --value '<secret from register>' \
     --overwrite
   ```
   Do **not** put the secret into `terraform.tfvars` or module inputs for production.
4. Relay pool assignment:
   - **Tier 1/2** — `shared` → global pool (`wss://relay.withlanyard.com`)
   - **Tier 3** — `dedicated` → per-tenant host (`modules/tier3-dedicated-relay/`)
5. Apply this module with `relay_secret_source = "ssm"` (default) and the parameter name.
6. On the host, fetch secret with instance role → write `GATEWAY_RELAY_SECRET` into `~/.hermes/.env` (mode 600) → restart Hermes gateway (egress-only `wss://…/relay`).

### Rotate / revoke (lifecycle)

| Action | Control plane | Deploy follow-up |
|--------|---------------|------------------|
| **Rotate** | `POST .../instances/:id/rotate` | Overwrite same SSM/SM name; host re-fetch; restart gateway |
| **Revoke one** | `POST .../instances/:id/revoke` (+ relay internal revoke) | Expect WS **4401**; delete cloud secret when done |
| **Revoke all** | `POST .../deprovision` | Same + optional TF destroy |

Full procedure: `references/runbooks/relay-secret-lifecycle.md`.

### Field mapping

| Control plane / Terraform | Hermes env | `config.yaml` (`gateway.*`) |
|---------------------------|------------|-------------------------------|
| `relay_wss_url` | `GATEWAY_RELAY_URL` | `relay_url` |
| `relay_instance_id` | `GATEWAY_RELAY_ID`, `GATEWAY_RELAY_INSTANCE_ID` | `relay_id`, `relay_instance_id` |
| SSM/SM secret (production) or `relay_instance_secret` (lab inline) | `GATEWAY_RELAY_SECRET` (host-only) | `relay_secret` (prefer env) |
| `relay_platform` (default `lanyard_web`) | `GATEWAY_RELAY_PLATFORMS` | — |

Hermes precedence: **env vars override** `gateway.*` in `config.yaml`.

### Secret source modes

| `relay_secret_source` | `deployment_mode` | Secret in TF state? | Notes |
|-----------------------|-------------------|---------------------|--------|
| `ssm` (default) | `production` | **No** | Requires `relay_secret_ssm_parameter_name` |
| `secretsmanager` | `production` | **No** | Requires `relay_secret_secretsmanager_secret_arn` |
| `inline` | `lab` only | **Yes** | Requires `relay_instance_secret`; rejected in production |

Checks enforce:

- production + `inline` → fail
- production + non-empty `relay_instance_secret` → fail
- production + `write_hermes_env_file` + inline → fail
- `write_hermes_env_file` default **false**; when true under ssm/sm, file holds **references only**

## Egress-only security group (required)

Portal chat uses **outbound WebSocket** from customer → Lanyard relay. Customer EC2 must **not** open inbound ports for portal users.

| Direction | Rule | Purpose |
|-----------|------|---------|
| **Egress** | TCP 443 to Lanyard relay endpoint (and provider APIs Hermes uses) | Relay dial + model/tool egress |
| **Egress** | TCP 443 to AWS APIs (S3 artifacts, SSM, Secrets Manager, etc.) | Bootstrap + secret fetch + ops |
| **Ingress** | **None** for portal chat | Users reach the portal, not customer public IP |
| **Ingress** | Optional: Tailscale UDP, SSH from bastion/operator CIDR | Break-glass only |

Reference (copy into tenant stack if tightening beyond company-brain-ec2 defaults):

```hcl
resource "aws_security_group" "company_brain_egress_only" {
  name        = "company-brain-egress-only"
  description = "Hermes gateway dials out to Lanyard relay; no inbound portal surface"

  egress {
    description = "HTTPS/WSS to Lanyard relay and provider APIs"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

## Module usage (production)

```hcl
module "customer_gateway_relay" {
  source = "../../modules/customer-gateway-relay"

  tenant_slug           = var.tenant_slug
  deployment_mode       = "production"
  relay_wss_url         = var.relay_wss_url
  relay_instance_id     = var.relay_instance_id
  relay_secret_source   = "ssm"
  relay_secret_ssm_parameter_name = var.relay_secret_ssm_parameter_name
  # relay_instance_secret intentionally omitted / empty

  hermes_profile_hints = {
    admin       = { description = "Tenant administrators" }
    contributor = { description = "Day-to-day authors" }
  }
}

# Attach host read policy to the Hermes instance role (tenant root):
resource "aws_iam_role_policy" "portal_relay_secret_read" {
  name   = "portal-relay-secret-read"
  role   = element(split("/", module.company_brain.instance_role_arn), 1)
  policy = module.customer_gateway_relay.relay_secret_iam_policy_json
}
```

Pin external sources to a tag/commit — **never** `ref=main`.

### Outputs for operators

| Output | Purpose |
|--------|---------|
| `hermes_env_vars_public` | Safe non-secret env map for notes/CI |
| `relay_secret_ref` | Parameter name / secret ARN reference |
| `relay_secret_iam_policy_json` | Instance-role policy for GetParameter / GetSecretValue |
| `host_secret_fetch_command` | On-host one-liner to fetch the secret |
| `host_env_merge_hint` | Merge public env + host-fetched secret into `~/.hermes/.env` |
| `hermes_env_vars` | Full map (sensitive); production includes ref keys, not the secret value |

## Host: load secret into Hermes

```bash
# After SSH (instance role has ssm:GetParameter on the parameter ARN):
set -euo pipefail
PARAM="/company-brain/<tenant_slug>/gateway-relay-secret"
SECRET=$(aws ssm get-parameter --name "$PARAM" --with-decryption --query Parameter.Value --output text)
ENV_FILE="${HOME}/.hermes/.env"
umask 077
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
# Merge non-secret keys from terraform output -json hermes_env_vars_public, then:
grep -v '^GATEWAY_RELAY_SECRET=' "$ENV_FILE" > "${ENV_FILE}.tmp" || true
{
  cat "${ENV_FILE}.tmp" 2>/dev/null || true
  echo "GATEWAY_RELAY_SECRET=${SECRET}"
} > "$ENV_FILE"
rm -f "${ENV_FILE}.tmp"
unset SECRET
sudo systemctl restart hermes-gateway   # unit name varies per deployment
```

## Manual runbook (lab / break-glass — not production)

```bash
# ~/.hermes/.env (permissions 600) — lab only
cat >> ~/.hermes/.env <<'EOF'
GATEWAY_RELAY_URL=wss://relay.withlanyard.com
GATEWAY_RELAY_ID=<instance_id from provision>
GATEWAY_RELAY_INSTANCE_ID=<instance_id from provision>
GATEWAY_RELAY_SECRET=<secret from provision>
GATEWAY_RELAY_PLATFORMS=lanyard_web
EOF
chmod 600 ~/.hermes/.env

sudo systemctl restart hermes-gateway
```

## Hermes profiles (hints ≠ enforcement)

Default `hermes_profile_hints`: **admin** and **contributor**.

**These hints are documentation only.** This module does **not** create Hermes profiles, write capability seeds, or block role elevation. Treating `hermes_profile_hints` as a security control is incorrect.

**Enforce path (host bootstrap):**

- `scripts/bootstrap-host.sh` → `ensure_hermes_profiles` after Hermes install
- `scripts/ensure-hermes-profiles.sh` (operator repair / `--require`)
- Seed matrix: `scripts/hermes-profiles/{admin,contributor}.json`
- Doctrine + acceptance: `references/hermes-profile-rbac.md`
- Offline smoke: `bash scripts/smoke-hermes-profiles.sh`

Relay URL inputs require **https://** or **wss://** only (`http://` and `ws://` are rejected by Terraform validation).

## Deprovision / revoke

Prefer lifecycle APIs: per-instance **revoke** and tenant **deprovision**. Connected gateways receive WebSocket close **4401**. Also delete or disable the SSM parameter / Secrets Manager secret. Full procedure: `references/runbooks/relay-secret-lifecycle.md`.

## Tenant wiring patch (if concurrent edits)

If `templates/tenant` is mid-edit by another agent, wire at least:

```hcl
# variables
variable "relay_secret_source" { type = string; default = "ssm" }
variable "deployment_mode" { type = string; default = "production" }
variable "relay_secret_ssm_parameter_name" { type = string; default = "" }
variable "relay_instance_secret" { type = string; default = ""; sensitive = true }

# module
module "portal_relay" {
  source                          = "../../modules/customer-gateway-relay"
  relay_wss_url                   = var.relay_wss_url
  relay_instance_id               = var.relay_instance_id
  relay_secret_source             = var.relay_secret_source
  deployment_mode                 = var.deployment_mode
  relay_secret_ssm_parameter_name = var.relay_secret_ssm_parameter_name
  relay_instance_secret           = var.relay_instance_secret
  tenant_slug                     = var.tenant_slug
  hermes_home                     = "/home/ec2-user/.hermes"
  write_hermes_env_file           = false
}
```

## Validate

```bash
cd modules/customer-gateway-relay
terraform init -backend=false
terraform validate
```

## Related

- Secret lifecycle (create / rotate / revoke / state backend / CI): `references/runbooks/relay-secret-lifecycle.md`
- Smoke tests: `references/provision-runbook.md`
- Host module: `modules/company-brain-ec2/`
- Tier 3 dedicated relay (infra_ready): `modules/tier3-dedicated-relay/` — apply runbook `references/runbooks/tier3-dedicated-relay-apply.md`
