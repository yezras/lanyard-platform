# portal-bff-service

Thin **public BFF** edge on ECS Fargate + application load balancer.

| Resource | Purpose |
|----------|---------|
| Internet-facing ALB | Public API edge for `/<tenant_slug>/api/*` |
| Target group | HTTP health checks on `/health` |
| ECS Fargate service | Desired count default **1** (G5 gate for scale-out) |
| Task definition | Image pinned by **repository + digest** only |
| Secrets | Generic `secrets` map → ECS `secrets` (SM/SSM `value_from`); IAM scoped to declared ARNs/KMS |

## Status

| Claim | Truth |
|-------|--------|
| Module is real Terraform | **Yes** |
| Auto-applied from examples | **No** |
| Production Portal security | Still needs G1 staging proof + G7 digests |
| Managed Redis/Valkey wired in product | Deploy-side contract ready; G5 matrix remains **blocked** until product multi-instance + **live** dual-BFF staging proof |
| Live dual-BFF staging session proof | **Deferred** — see `references/runbooks/portal-valkey-g5-enable.md` (`lp-t7q.8`); CI dual-instance test is substitute only |

**infra_ready** until applied with real digest pins. Valkey module **infra_ready** ≠ production certification. See `references/runbooks/portal-compute-staging-apply.md` and G5 enable residual `references/runbooks/portal-valkey-g5-enable.md`.

## Fail-closed posture

- Deploy authority is `image_repository@image_digest` (`sha256:` + 64 hex). Tag alone is rejected.
- `desired_count > 1` requires `acknowledge_g5_scale_beyond_one=true` (product G5 still open).
- This module is the **public BFF API edge** only. Private backend placement is a separate module (`modules/portal-control-plane-service`).
- Secrets via `var.secrets` (`value_from` ARNs only). Production-like / **staging** `environment` rejects known secret names (including **`REDIS_URL`**, service tokens) in `environment_variables`.
- **OIDC client secrets** (`GOOGLE_CLIENT_SECRET`, `OIDC_CLIENT_SECRET`, `*_CLIENT_SECRET`) are rejected in plain env in **every** environment label — always use the secrets map.
- Execution role: `GetSecretValue` / `GetParameters` / `kms:Decrypt` only for declared ARNs/keys (no `Resource="*"`).
- `execution_extra_secret_arns`: IAM-only GetSecretValue for SM ARNs **not** injected into the BFF container. Live residual while the harness family reuses this exec role (`lp-oop.38.20`: `harness-litellm` + `daytona`). Prefer `modules/harness-exec-iam`.
- Outputs expose `secret_names` only — never `REDIS_URL` values, OIDC secrets, or rediss URLs.

## OIDC / Google sign-in (deploy contract)

Public **client id** may be plain env; **client secret** and **session signing secret** must use the generic ECS secrets map.

| Env name | Source | Notes |
|----------|--------|--------|
| `GOOGLE_CLIENT_ID` | plain env (or secret) | Public OAuth client id — not a secret |
| `GOOGLE_CLIENT_SECRET` | **`secrets` map** only | Same Google Web client as control plane |
| `SESSION_SECRET` | **`secrets` map** | Signs OAuth state + session cookies |
| `CONTROL_PLANE_SERVICE_TOKEN` | **`secrets` map** | Shared with CP; suffix pattern reject in plain env |
| `GOOGLE_REDIRECT_PATH` | plain env | Default product path segment `/api/auth/google/callback` (relative) |

### Callback / logout URLs (path-first hosts)

Canonical production entry is path-first (`https://app.withlanyard.com/<tenant_slug>`). Register **Authorized redirect URIs** in Google Cloud Console for every host you serve:

| Host style | Google Authorized redirect URI (shape only) |
|------------|-----------------------------------------------|
| **Path-first (MVP)** | `https://app.withlanyard.com/<tenant_slug>/api/auth/google/callback` |
| **Legacy subdomain** | `https://<tenant_slug>.withlanyard.com/api/auth/google/callback` |
| Staging path-first | `https://<portal_web_hostname>/<tenant_slug>/api/auth/google/callback` |
| Staging subdomain | `https://<tenant_slug>.<staging-apex>/api/auth/google/callback` |

Related app routes (not Google Console entries):

| Route | Method | Purpose |
|-------|--------|---------|
| `/<tenant_slug>/api/auth/google` | GET | Start OAuth (path-first) |
| `/api/auth/google` | GET | Start OAuth (legacy subdomain host) |
| `/…/api/auth/google/callback` | GET | Code exchange → BFF → private CP |
| `/…/api/auth/logout` | POST | Clear Portal session cookie (app logout; not Google end-session) |

**Membership claims:** Google OIDC proves identity (`sub` + email). Tenant **memberships/roles** are control-plane DB rows (explicit grants), not Google Workspace groups. Deploy wires secrets only; live membership proof is product + G1a/G1.4 staging evidence — this module does **not** claim OIDC production-ready from wiring alone.

### Secrets map example (OIDC + shared service token)

```hcl
environment_variables = {
  NODE_ENV                 = "production"
  GOOGLE_CLIENT_ID         = "REPLACE.apps.googleusercontent.com" # public id OK
  # GOOGLE_REDIRECT_PATH  = "/api/auth/google/callback"          # product default
}
secrets = {
  GOOGLE_CLIENT_SECRET = {
    value_from = "arn:aws:secretsmanager:…:secret:lanyard/staging/google-client-secret-…"
  }
  SESSION_SECRET = {
    value_from = "arn:aws:ssm:…:parameter/lanyard/staging/portal/session-secret"
  }
  CONTROL_PLANE_SERVICE_TOKEN = {
    value_from = "arn:aws:ssm:…:parameter/lanyard/staging/portal/service-token"
  }
  # REDIS_URL = { value_from = "${module.portal_valkey.redis_url_secret_arn}:REDIS_URL::" }
}
```

See `references/runbooks/staging-secrets-checklist.md` § OIDC / path-first callbacks.

## Shared session state (G5) — Valkey / Redis

BFF multi-task sessions require managed Redis-compatible store from `modules/portal-valkey`:

| Concern | Contract |
|---------|----------|
| Product env key | **`REDIS_URL`** (`rediss://…` TLS) |
| Source | `module.portal_valkey.redis_url_secret_arn` (Secrets Manager JSON) |
| Injection | `secrets["REDIS_URL"].value_from = "${module.portal_valkey.redis_url_secret_arn}:REDIS_URL::"` |
| Non-secret flags | `BFF_SESSION_BACKEND=redis`, `BFF_MULTI_INSTANCE=true` (plain `environment_variables`) |
| Single-task default | `desired_count = 1`; backend may stay `memory` until Valkey is applied and product enables redis |

### Documented session TTLs (product defaults; non-secret env)

| Env | Default | Meaning |
|-----|---------|---------|
| `SESSION_TTL_SECONDS` | `604800` (7d) | Sliding idle TTL for session records in Redis |
| `SESSION_MAX_AGE_SECONDS` | `2592000` (30d) | Absolute max age from issue |

Set only as plain env when overriding product defaults. **Never** put auth tokens or full `REDIS_URL` in plain env.

### Store outage behavior (product-side; deploy documents only)

| Mode | When store is down / unreachable |
|------|----------------------------------|
| Single-task + `memory` | In-process sessions continue on that task only; no cross-task sharing (default pilot path) |
| `BFF_SESSION_BACKEND=redis` | Product must **fail closed** on session read/write (no silent fall-back to memory that would desync multi-task auth). Exact HTTP status / retry is Portal product ADR territory — operators treat Valkey outage as BFF auth degradation until cache recovers |
| Scale-out (`desired_count > 1`) | Forbidden in this module without `acknowledge_g5_scale_beyond_one` **and** product G5 proof |

Deploy does **not** flip readiness-matrix **G5** to ready from wiring docs alone. Pilot often keeps Valkey off and `desired_count=1` (memory sessions). Dual-BFF live proof residual: `references/runbooks/portal-valkey-g5-enable.md`.

### Composition example (operator private root)

```hcl
module "portal_valkey" {
  source                       = "../../modules/portal-valkey"
  name_prefix                  = "lanyard-portal-staging"
  environment                  = "staging"
  vpc_id                       = var.vpc_id
  subnet_ids                   = var.private_subnet_ids
  allowed_security_group_ids   = [module.portal_bff.task_security_group_id]
  acknowledge_not_auto_applied = true
}

module "portal_bff" {
  source             = "../../modules/portal-bff-service"
  # … network + image_repository@image_digest …
  desired_count      = 1
  environment_variables = {
    NODE_ENV             = "production"
    BFF_SESSION_BACKEND  = "redis"   # only after Valkey is healthy
    # BFF_MULTI_INSTANCE = "true"   # only with desired_count > 1 + G5 ack
    # SESSION_TTL_SECONDS     = "604800"
    # SESSION_MAX_AGE_SECONDS = "2592000"
  }
  secrets = {
    REDIS_URL = {
      # JSON key REDIS_URL from portal-valkey SM payload (never commit the rediss URL).
      value_from = "${module.portal_valkey.redis_url_secret_arn}:REDIS_URL::"
    }
    # GOOGLE_CLIENT_SECRET = { value_from = "arn:aws:secretsmanager:…:secret:…" }
  }
  acknowledge_not_auto_applied = true
}
```

Two-pass SG wiring is normal: create BFF first (empty Valkey allow-list or temporary private CIDR), then re-apply Valkey with `task_security_group_id`.

`environments/platform-staging` remains **artifact infra only** — Valkey + BFF composition lives in operator-owned private roots (same as RDS/CP).

## Validate

```bash
cd modules/portal-bff-service
terraform init -backend=false -input=false && terraform validate
bash scripts/smoke-portal-compute.sh
bash scripts/smoke-portal-valkey.sh
```

## Files

See [INDEX.md](./INDEX.md).
