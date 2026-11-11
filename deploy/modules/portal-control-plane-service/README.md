# portal-control-plane-service

Thin **private control-plane** service on ECS Fargate + **internal** ALB only (G1).

| Resource | Purpose |
|----------|---------|
| **Internal** ALB | VPC-only; `internal = true` hardcoded |
| Target group | Health checks on `/health` |
| ECS Fargate service | Private subnets; `assign_public_ip = false` |
| Task definition | Image pinned by **repository + digest** |
| Secrets | Generic `secrets` map (SM/SSM) + legacy `database_url_secret_arn` → `CONTROL_PLANE_DATABASE_URL` **and** `DATABASE_URL` (JSON key form by default) |

## Status

| Claim | Truth |
|-------|--------|
| Module is real Terraform | **Yes** |
| Public ALB supported | **No** — rejected fail-closed |
| Production control-plane security | Still requires **G1 staging proof** |

**infra_ready** until applied with real digests + private VPC wiring.

## Fail-closed posture

- `internal` **must** be `true` (variable validation + resource hardcode).
- Private subnets only; plan-time check requires `map_public_ip_on_launch=false`.
- Ingress allow-lists reject `0.0.0.0/0` / `::/0`.
- At least one allowed SG or private CIDR required.
- Digest pin required; never tag-only / `:latest`.
- `acknowledge_not_auto_applied=true` required.
- Secrets via `var.secrets` and/or `database_url_secret_arn`. Production-like / **staging** `environment` rejects known secret names in `environment_variables`.
- **OIDC client secrets** (`GOOGLE_CLIENT_SECRET`, `OIDC_CLIENT_SECRET`, `*_CLIENT_SECRET`) are rejected in plain env in **every** environment label — always use the secrets map.
- Execution role: `GetSecretValue` / `GetParameters` / `kms:Decrypt` only for declared ARNs/keys (no `Resource="*"`).
- Instance secret material (lp-oop.37.6): optional `instance_secret_material_sm_secret_arn` → task-role Get/Put on that ARN + env `INSTANCE_SECRET_MATERIAL_SM_SECRET_ID`. `INSTANCE_SECRET_MATERIAL_KEY` stays in the secrets map. Do not also set `INSTANCE_SECRET_MATERIAL_PATH` (`/tmp` is wiped on Fargate recycle). Runbook: [instance-secret-material.md](../../../docs/runbooks/instance-secret-material.md).

## Product wiring

- BFF/relay task security groups → `allowed_ingress_security_group_ids`
- RDS: pass this module’s `task_security_group_id` into `modules/control-plane-rds` `allowed_security_group_ids`
- Database URL (G4.3 compatible): `database_url_secret_arn` from control-plane-rds → injects **both** `CONTROL_PLANE_DATABASE_URL` and `DATABASE_URL` via ECS JSON-key `valueFrom` (`arn:…:secret:name:KEY::`). Default `database_url_secret_format = "json_keys"` matches the control-plane-rds JSON payload. Use `"plain"` only when the SM secret string is a bare `postgresql://…` URL.
- **Do not** pass a bare SM ARN of a JSON secret as `secrets["CONTROL_PLANE_DATABASE_URL"].value_from` without the `:CONTROL_PLANE_DATABASE_URL::` suffix — that injects the whole JSON blob and breaks Postgres URL parsing (SQLite residual on older images).
- Other runtime secrets (OIDC client secret, service token, ops token): `secrets` map with SM/SSM ARNs only

## OIDC + tenant membership (deploy contract)

Browsers never call the control plane directly (G1). Google OAuth starts on the **public BFF**; BFF exchanges the code with CP over the private network using `CONTROL_PLANE_SERVICE_TOKEN`.

| Env name | Source | Notes |
|----------|--------|--------|
| `CONTROL_PLANE_AUTH_MODE` | plain env | `production` for staging/prod |
| `GOOGLE_CLIENT_ID` | plain env (or secret) | Public OAuth client id — same app as BFF |
| `GOOGLE_CLIENT_SECRET` | **`secrets` map** only | Code exchange with Google; never plain env / tfvars |
| `CONTROL_PLANE_SERVICE_TOKEN` | **`secrets` map** | Identical value on BFF |
| `INTERNAL_OPS_TOKEN` | **`secrets` map** | Ops elevation |
| `CONTROL_PLANE_DATABASE_URL` | SM via `database_url_secret_arn` or secrets map | Users, OIDC subjects, memberships (preferred product key) |
| `DATABASE_URL` | Same SM secret (twin inject) | Alias accepted by product G4.1 |

**Membership claims:** CP stores `google_sub` → user and explicit `user_roles` / path-prefix grants per tenant. Google does **not** supply tenant membership; operators grant memberships in CP after first verified login (or seed via ops). Deploy does **not** claim live OIDC / membership proof ready — G1.4 / G1a staging evidence remains open.

```hcl
environment_variables = {
  NODE_ENV                = "production"
  CONTROL_PLANE_AUTH_MODE = "production"
  GOOGLE_CLIENT_ID        = "REPLACE.apps.googleusercontent.com"
}
secrets = {
  GOOGLE_CLIENT_SECRET = {
    value_from = "arn:aws:secretsmanager:…:secret:lanyard/staging/google-client-secret-…"
  }
  CONTROL_PLANE_SERVICE_TOKEN = {
    value_from = "arn:aws:ssm:…:parameter/lanyard/staging/portal/service-token"
  }
  INTERNAL_OPS_TOKEN = {
    value_from = "arn:aws:ssm:…:parameter/lanyard/staging/portal/internal-ops-token"
  }
}
# JSON secret from modules/control-plane-rds (default format = "json_keys"):
# database_url_secret_arn    = module.control_plane_rds.control_plane_database_url_secret_arn
# database_url_secret_format = "json_keys"  # → valueFrom …:CONTROL_PLANE_DATABASE_URL:: and …:DATABASE_URL::
#
# Or via secrets map (must include JSON key suffix for JSON secrets):
# secrets = {
#   CONTROL_PLANE_DATABASE_URL = {
#     value_from = "${module.control_plane_rds.control_plane_database_url_secret_arn}:CONTROL_PLANE_DATABASE_URL::"
#   }
#   DATABASE_URL = {
#     value_from = "${module.control_plane_rds.control_plane_database_url_secret_arn}:DATABASE_URL::"
#   }
# }
```

Callback/logout URL shapes for Google Console live on the **BFF/path-first edge** — see `modules/portal-bff-service/README.md` and `references/runbooks/staging-secrets-checklist.md`.

## Validate

```bash
cd modules/portal-control-plane-service
terraform init -backend=false -input=false && terraform validate
bash scripts/smoke-portal-compute.sh
```

## What this does **not** do

| Non-goal | Why |
|----------|-----|
| Public ALB / public subnets | G1 forbidden |
| Clear G1 production claim | Staging proof still required |
| Auto-apply from examples | Operator-owned |

## Files

See [INDEX.md](./INDEX.md).
