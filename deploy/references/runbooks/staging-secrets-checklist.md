# Runbook: Staging environment secrets checklist

**Status:** Operator procedure — **no live secret values in this file**  
**Purpose:** Single checklist for GitHub Actions secrets/vars, AWS Secrets Manager / SSM, and Portal task runtime env before staging apply and G1.4 / G2 S4 / G3.4 proofs  
**Related:**

| Doc | Use |
|-----|-----|
| `references/runbooks/product-artifact-staging-apply.md` | Phase 2 S3/ECR/OIDC staging apply + verify |
| `references/runbooks/portal-compute-staging-apply.md` | G8 ordered apply + pin map |
| `references/runbooks/relay-secret-lifecycle.md` | Register / rotate / revoke + SSM |
| `references/runbooks/pin-update.md` | Private pins after product publish |
| `references/runbooks/security-e2e-acceptance.md` | LOCAL vs STAGING proof matrix |
| `compatibility/pins.real-releases.yaml` | First private release pin coordinates (Hermes / client-core / portal-web) |
| Portal product | OIDC, service auth, Postgres, Redis, brain RPC, relay jti/bus |

**Honesty:** Filling secrets does **not** flip readiness-matrix G1/G2/G3/G7/G8 to **ready**. Live staging evidence still required. Never commit secret material, PATs, or full DB URLs to git.

---

## Where secrets live

| Store | Use for |
|-------|---------|
| **GitHub Actions secrets / variables** | CI release workflows (OIDC role, bucket names) |
| **GitHub Environment `staging`** (recommended) | Optional: same names scoped to staging deploy workflows |
| **AWS Secrets Manager** | `CONTROL_PLANE_DATABASE_URL` (G4.3), `REDIS_URL` (portal-valkey), optional shared tokens |
| **AWS SSM Parameter Store SecureString** | Relay instance secrets, optional bootstrap `GITHUB_TOKEN`; optional pointer to Valkey secret ARN |
| **ECS task definition `secrets` / env** | Inject SM/SSM into BFF, relay, control-plane tasks via module `secrets` map |
| **Customer host env / SSM** | `GATEWAY_RELAY_SECRET`, optional `GITHUB_TOKEN` for private GH artifact pins |

Do **not** put production secrets in Terraform `tfvars` or module `environment_variables` (non-secret only).

### Portal ECS `secrets` map (modules)

All three compute modules share one contract:

```hcl
secrets = {
  ENV_NAME = {
    value_from  = "arn:aws:secretsmanager:…:secret:…"   # or ssm parameter ARN
    kms_key_arn = "arn:aws:kms:…:key/…"                 # optional CMK
  }
}
```

| Module | Path |
|--------|------|
| BFF | `modules/portal-bff-service` `var.secrets` (incl. `REDIS_URL` from Valkey; `BFF_OFFICE_JWT_SECRET` from staging DS) |
| Relay | `modules/portal-relay-service` `var.secrets` (incl. `REDIS_URL` from Valkey) |
| Control plane | `modules/portal-control-plane-service` `var.secrets` + legacy `database_url_secret_arn` |
| Valkey store | `modules/portal-valkey` → `redis_url_secret_arn` (not an ECS service) |
| Staging Document Server | `modules/staging-document-server` → JWT SM (`JWT_SECRET`); optional license shell; BFF shares JWT ARN |

- Renders ECS task definition **`secrets`** blocks (`name` + `valueFrom`) — not plain env values.
- Task **execution** role gets `secretsmanager:GetSecretValue` / `ssm:GetParameters` / `kms:Decrypt` only for **declared** ARNs/keys.
- Production-like / **staging** `environment` (`production`, `prod`, `production-like`, `prod-like`, `staging`) rejects known secret names in `environment_variables` (including **`REDIS_URL`**, service tokens).
- **OIDC client secrets** (`GOOGLE_CLIENT_SECRET`, `OIDC_CLIENT_SECRET`, any `*_CLIENT_SECRET`) are rejected in plain env for **every** environment label — always use the secrets map.
- Outputs expose `secret_names` only (never secret values, OIDC secrets, or full rediss URLs).

---

## OIDC / path-first callbacks (names + URL shapes only)

**Honesty:** Wiring secrets and documenting redirect URIs does **not** flip readiness-matrix **G1** to ready. Live OIDC login / membership proof remains **G1.4** / **cbd-mta.6.2** (not claimed here).

### Google OAuth Web client (names only)

| Name | Kind | Where | Notes |
|------|------|-------|--------|
| `GOOGLE_CLIENT_ID` | plain env (public) | BFF + CP | Same Web client for both |
| `GOOGLE_CLIENT_SECRET` | **SM/SSM → ECS secrets map** | BFF + CP | **Never** tfvars / plain env / logs |
| `SESSION_SECRET` | **SM/SSM → ECS secrets map** | BFF | OAuth state + session cookie signing |
| `GOOGLE_REDIRECT_PATH` | plain env | BFF | Default product segment `/api/auth/google/callback` |
| `CONTROL_PLANE_AUTH_MODE` | plain env | CP | `production` for staging/prod |
| `CONTROL_PLANE_SERVICE_TOKEN` | **secret** | BFF + CP | Service auth; same value both sides |
| `INTERNAL_OPS_TOKEN` | **secret** | CP | Ops elevation |

### Authorized redirect URIs (Google Cloud Console)

Path-first is canonical (`https://app.withlanyard.com/<tenant_slug>`). Register exact redirect URIs for each tenant slug (and staging host) you serve:

| Host style | Authorized redirect URI shape |
|------------|-------------------------------|
| Production path-first | `https://app.withlanyard.com/<tenant_slug>/api/auth/google/callback` |
| Production legacy subdomain | `https://<tenant_slug>.withlanyard.com/api/auth/google/callback` |
| Staging path-first | `https://<portal_web_hostname>/<tenant_slug>/api/auth/google/callback` |
| Staging subdomain (if used) | `https://<tenant_slug>.<staging-apex>/api/auth/google/callback` |

Related **app** routes (not Google Console “Authorized redirect URIs”):

| Route | Method | Purpose |
|-------|--------|---------|
| `/<tenant_slug>/api/auth/google` | GET | Start OAuth (path-first) |
| `/api/auth/google` | GET | Start OAuth (legacy subdomain host) |
| `/…/api/auth/google/callback` | GET | Code → BFF → private CP |
| `/…/api/auth/logout` | POST | Clear Portal session (app logout; **not** Google OIDC end-session) |

Optional Google “Authorized JavaScript origins” (host only, no path): `https://app.withlanyard.com`, staging `https://<portal_web_hostname>`.

### Tenant membership claims

| Concern | Where it lives | Secret? |
|---------|----------------|---------|
| Google identity (`sub`, email) | OIDC id_token / code exchange | Client **secret** is secret; claims are not |
| Portal user row | Control-plane Postgres (`users`) | Via `CONTROL_PLANE_DATABASE_URL` secret |
| Tenant membership / roles / path prefixes | Control-plane tables (`user_roles`, …) | Explicit CP grants — **not** Google Groups |

Google does **not** assert which tenant a user may access. After first verified login, operators (or seed jobs) grant memberships in CP. Cross-tenant negatives are product G1a; live proof is still open.

### ECS secrets map sketch (ARNs only — private tfvars)

```hcl
# BFF (modules/portal-bff-service or platform-staging bff_secrets)
environment_variables = {
  NODE_ENV         = "production"
  GOOGLE_CLIENT_ID = "REPLACE.apps.googleusercontent.com"
}
secrets = {
  GOOGLE_CLIENT_SECRET = {
    value_from = "arn:aws:secretsmanager:REGION:ACCOUNT:secret:…/google-client-secret-…"
  }
  SESSION_SECRET = {
    value_from = "arn:aws:ssm:REGION:ACCOUNT:parameter/…/session-secret"
  }
  CONTROL_PLANE_SERVICE_TOKEN = {
    value_from = "arn:aws:ssm:REGION:ACCOUNT:parameter/…/service-token"
  }
}

# Control plane (control_plane_secrets + database_url_secret_arn)
environment_variables = {
  NODE_ENV                = "production"
  CONTROL_PLANE_AUTH_MODE = "production"
  GOOGLE_CLIENT_ID        = "REPLACE.apps.googleusercontent.com"
}
secrets = {
  GOOGLE_CLIENT_SECRET = {
    value_from = "arn:aws:secretsmanager:REGION:ACCOUNT:secret:…/google-client-secret-…"
  }
  CONTROL_PLANE_SERVICE_TOKEN = {
    value_from = "arn:aws:ssm:REGION:ACCOUNT:parameter/…/service-token"
  }
  INTERNAL_OPS_TOKEN = {
    value_from = "arn:aws:ssm:REGION:ACCOUNT:parameter/…/internal-ops-token"
  }
}
```

`environments/platform-staging` accepts optional `bff_secrets` / `control_plane_secrets` maps (same shape). Leave empty until SM/SSM ARNs exist in the operator account.

### Office / ONLYOFFICE (staging-platform-shared-ds, lp-5q6.34)

| Name | Kind | Where | Notes |
|------|------|-------|--------|
| JWT secret | **SM only** | DS task `JWT_SECRET` + BFF `BFF_OFFICE_JWT_SECRET` | Same secret ARN; module creates `…/portal/office-jwt` by default |
| License material | optional SM shell | Free track: unused | Never commit license files |
| `BFF_OFFICE_PUBLIC_BASE_URL` | plain env | BFF | Absolute URL DS uses for download/callback (not a secret) |
| `BFF_OFFICE_DOCUMENT_SERVER_HOSTS` | plain env | BFF | Docs ALB/hostname allowlist (not a secret) |
| SSM pointer | String param | `/company-brain/<prefix>/portal-office-jwt-secret-arn` | ARN only |

Never put `BFF_OFFICE_JWT_SECRET` / `JWT_SECRET` in plain `environment_variables` (BFF production-like check rejects them). Operator procedure: [staging-document-server.md](staging-document-server.md). JWT rotation + purge: [operate-onlyoffice-document-server.md](operate-onlyoffice-document-server.md) (`lp-5q6.36`).

### Short-stack harness (lp-oop.30)

Always-on Lanyard Agent HTTP turn server. **Not** a new AWS product. Live form is another Fargate task on the **existing** `lanyard-platform-staging-portal-cp` cluster. Guest `CHAT_DELIVERY` stays **relay**. Operator procedure: [mocklab-short-stack-harness.md](mocklab-short-stack-harness.md). Echo → LA residual: [mocklab-replace-echo-harness-la.md](mocklab-replace-echo-harness-la.md) (`lp-oop.37.4`; PR 242 MERGED / live `:3`; reply still echo until runner bind).

| Name | Kind | Where | Notes |
|------|------|-------|--------|
| `HARNESS_URL` | plain env | BFF | Private base (`http://<internal-cp-alb>:8080`). Not a secret. Unset is fine while delivery is relay |
| `HARNESS_SERVICE_TOKEN` | **SM/SSM → ECS secrets map** | BFF + harness task | Same value both sides. Production rejects `placeholder-harness-service-token` when delivery is harness |
| `LANYARD_HARNESS_SERVICE_TOKEN` | same secret (optional alias) | harness task | LA `createHarnessTurnServer` option |
| `CHAT_DELIVERY` | plain env | BFF | **Unset / `relay`.** Do not set `harness` globally; flip MockLab via persisted tenant/instance `chat_delivery` |
| `lanyard/staging/portal/harness-litellm` | **SM → ECS secrets map** | harness task | LiteLLM keys (`LITELLM_API_KEY` / `LITELLM_MASTER_KEY` JSON keys). Exec role `GetSecretValue` (`lp-oop.38.20`) |
| `lanyard/staging/portal/daytona` | **SM → ECS secrets map** | harness task (toolbox) + CP | `DAYTONA_API_KEY` JSON keys. Guest never. Exec role `GetSecretValue` (`lp-oop.38.20`) |
| harness exec role | IAM | `modules/harness-exec-iam` or BFF `execution_extra_secret_arns` | Dedicated `…-harness-exec` preferred. While live reuses `…-bff-exec`, extra ARNs must keep `harness-litellm` + `daytona` or a new revision cannot place. Does **not** apply Terraform from that bead. |

Never put `HARNESS_SERVICE_TOKEN` in plain `environment_variables` or tfvars. Do not copy `.env.mocklab-agent-dev` into the task definition.

---

## 0. Generate strong values (local; do not commit)

```bash
# Shared BFF ↔ control-plane service token (same value on both services)
openssl rand -base64 48

# Ops elevation token (control-plane INTERNAL_OPS_TOKEN)
openssl rand -base64 48

# BFF session / OAuth state signing secret (SESSION_SECRET)
openssl rand -base64 48

# Relay internal HTTP token
openssl rand -base64 48
```

`GOOGLE_CLIENT_SECRET` is issued by Google Cloud Console (OAuth Web client) — do not invent it; store the Console value in SM/SSM only.

Relay **instance** secrets come from control-plane **register/rotate** (see relay-secret-lifecycle) — do not invent a long-lived paste-only secret as the production model.

---

## 1. GitHub — product release (Actions)

Add under each repo: **Settings → Secrets and variables → Actions**.  
Prefer **Variables** for non-secret ARNs/names; **Secrets** for credentials.

### 1a. `LanyardBrain/Portal` (required for S3/ECR publish)

| Name | Kind | Required for staging? | Notes |
|------|------|----------------------|--------|
| `AWS_ROLE_ARN` | secret or var | **Yes** (if publishing) | OIDC publisher role from `modules/product-artifact-infra` (apply: `product-artifact-staging-apply.md`) |
| `ARTIFACT_BUCKET` | secret or var | **Yes** (if publishing) | Private artifact bucket name (staging apply output; never commit as live pin) |
| `AWS_REGION` | var | Recommended | Default `us-east-1` if unset in workflow |
| `ECR_NAME_PREFIX` | var | **Yes** (image release) | Prefix for portal ECR repos (`name_prefix` from staging apply) |

```bash
# Values you supply interactively — never echo real secrets into shell history logs
gh variable set AWS_REGION -R LanyardBrain/Portal --body "us-east-1"
gh variable set ECR_NAME_PREFIX -R LanyardBrain/Portal --body "REPLACE_PREFIX"
gh variable set ARTIFACT_BUCKET -R LanyardBrain/Portal --body "REPLACE_BUCKET"
gh secret set AWS_ROLE_ARN -R LanyardBrain/Portal   # paste arn:aws:iam::…:role/…
```

### 1b. `LanyardBrain/hermes-lanyard` (private only)

| Name | Kind | Required for staging? | Notes |
|------|------|----------------------|--------|
| `AWS_ROLE_ARN` | secret or var | Optional if using GH releases only | S3 publish path |
| `ARTIFACT_BUCKET` | secret or var | Optional | S3 `hermes/<version>/` |
| `AWS_REGION` | var | Optional | |

**Do not** configure release credentials on public `hermes-agent`.

### 1c. `LanyardBrain/client-core`

| Name | Kind | Required for staging? | Notes |
|------|------|----------------------|--------|
| `AWS_ROLE_ARN` | var | Optional if GH releases only | OIDC publish |
| `ARTIFACT_BUCKET` | var | Optional | S3 `client-core/<version>/` |
| `AWS_REGION` | var | Optional | |

### 1d. Built-in (do not create)

| Name | Notes |
|------|--------|
| `GITHUB_TOKEN` | Provided automatically by Actions for same-repo operations |

### 1e. Optional / non-Lanyard defaults (ignore unless you use those workflows)

| Name | Repo | Notes |
|------|------|--------|
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | hermes-lanyard | Upstream Docker Hub image workflow |
| `VERCEL_DEPLOY_HOOK` | hermes-lanyard | Upstream site deploy |

---

## 2. GitHub Environment `staging` (recommended)

Create environment **`staging`** on `LanyardBrain/Portal` (and deploy workflows if any):

1. Repo → **Settings → Environments → New environment → `staging`**
2. Optional protection: required reviewers, wait timer
3. Add the **runtime** secrets below as **Environment secrets** (preferred over repo-wide for deploys)

CLI pattern:

```bash
# Create environment once in UI, then:
gh secret set CONTROL_PLANE_SERVICE_TOKEN -R LanyardBrain/Portal --env staging
gh secret set GOOGLE_CLIENT_SECRET -R LanyardBrain/Portal --env staging
# …
```

`gh secret list -R LanyardBrain/Portal --env staging` lists **names only**.

---

## 3. Portal runtime secrets (staging tasks)

Inject via ECS task `secrets` from Secrets Manager/SSM, or environment secret maps. **Same token** where noted.

### 3a. Control plane (private / internal ALB only)

| Env name | Source | Required | Notes |
|----------|--------|----------|--------|
| `CONTROL_PLANE_AUTH_MODE` | plain env | **Yes** | `production` |
| `NODE_ENV` | plain env | **Yes** | `production` |
| `GOOGLE_CLIENT_ID` | plain (public) | **Yes** | Public OAuth client id |
| `GOOGLE_CLIENT_SECRET` | **ECS secrets map** | **Yes** | SM/SSM ARN only — never plain env |
| `CONTROL_PLANE_SERVICE_TOKEN` | **ECS secrets map** | **Yes** | Shared with BFF; reject dev placeholder |
| `INTERNAL_OPS_TOKEN` | **ECS secrets map** | **Yes** | Ops elevation |
| `CONTROL_PLANE_DATABASE_URL` | **SM** (G4.3) | **Yes** | From `modules/control-plane-rds` secret ARN; CP module injects JSON key `CONTROL_PLANE_DATABASE_URL` via `…:CONTROL_PLANE_DATABASE_URL::` |
| `DATABASE_URL` | **SM** (G4.3 twin) | **Yes** | Same secret; twin-injected as `…:DATABASE_URL::` (product accepts either env name) |
| `CONTROL_PLANE_PORT` | plain | Optional | Default `3100` |

**Never** put control plane on a public ALB (G1).

### 3b. BFF (public API edge)

| Env name | Source | Required | Notes |
|----------|--------|----------|--------|
| `NODE_ENV` | plain | **Yes** | `production` |
| `GOOGLE_CLIENT_ID` | plain (public) | **Yes** | Same OIDC app as CP |
| `GOOGLE_CLIENT_SECRET` | **ECS secrets map** | **Yes** | Same as CP — never plain env |
| `SESSION_SECRET` | **ECS secrets map** | **Yes** (prod/staging) | OAuth state + session cookies |
| `GOOGLE_REDIRECT_PATH` | plain | Optional | Default `/api/auth/google/callback` (path segment; path-first prefix is product/host) |
| `CONTROL_PLANE_URL` | plain | **Yes** | **Private** base URL (internal ALB / service discovery) — not public internet |
| `CONTROL_PLANE_SERVICE_TOKEN` | **ECS secrets map** | **Yes** | **Identical** to control-plane |
| `BFF_SESSION_BACKEND` | plain | **Yes** if multi-task | `memory` (single-task default) or `redis` when sharing state |
| `REDIS_URL` | **SM** (portal-valkey) | **Yes** if redis | Inject via `secrets["REDIS_URL"].value_from = module.portal_valkey.redis_url_secret_arn` + `:REDIS_URL::` JSON key — never plain env |
| `BFF_MULTI_INSTANCE` | plain | If multi-task | `true` requires redis backend + G5 ack on `desired_count > 1` |
| `BRAIN_RPC_ENABLED` | plain | For G3 proofs | `1` / `true` when exercising brain RPC |
| `SESSION_TTL_SECONDS` | plain | Optional | Default **604800** (7d sliding) — product session idle TTL |
| `SESSION_MAX_AGE_SECONDS` | plain | Optional | Default **2592000** (30d absolute) — product session max age |
| `PORTAL_DEBUG_PAYLOADS` | plain | **Off** | Must be unset/`0` in staging (G2b.2) |

### 3c. Relay (public WSS edge)

| Env name | Source | Required | Notes |
|----------|--------|----------|--------|
| `NODE_ENV` | plain | **Yes** | `production` |
| `RELAY_INTERNAL_TOKEN` | **secret** | **Yes** | Internal HTTP (brain RPC / cluster) |
| `RELAY_GATEWAY_SECRET` / instance secret | **SSM** via host or task | **Yes** | Prefer lifecycle-stored secret; production path = register→SSM |
| `RELAY_CLUSTER_MODE` | plain | Optional | `single` (default, fail-closed scale) or `bus` |
| `REDIS_URL` | **SM** (portal-valkey) | If `bus` | Shared jti / owner lease / revoke bus — same `secrets` map pattern as BFF |
| `RELAY_ADVERTISE_URL` | plain | If `bus` | This node's reachable base URL |
| `RELAY_NODE_ID` | plain | If `bus` | Stable unique node id |
| G2a production policy | plain | **Yes** | Fail-closed jti / TTL (product defaults in `production`) |

---

## 4. AWS Secrets Manager / SSM (staging account)

| Secret / parameter | Maps to | Created by |
|--------------------|---------|------------|
| RDS module secret (ARN from TF output) | `CONTROL_PLANE_DATABASE_URL` on CP task | `modules/control-plane-rds` |
| Optional SSM pointer to secret ARN | Ops discovery | RDS module optional |
| Valkey module secret (ARN from TF output) | `REDIS_URL` on BFF + relay tasks | `modules/portal-valkey` |
| Optional SSM pointer to Valkey secret ARN | Ops discovery (ARN only, not auth token) | Valkey module optional |
| `/lanyard/staging/relay/<instance_id>/secret` (example path) | Host `GATEWAY_RELAY_SECRET` | Operator after CP register |
| `/lanyard/staging/portal/control-plane-service-token` | BFF + CP `CONTROL_PLANE_SERVICE_TOKEN` | Operator |
| `/lanyard/staging/portal/google-client-secret` | BFF + CP `GOOGLE_CLIENT_SECRET` | Operator (from Google Console) |
| `/lanyard/staging/portal/session-secret` | BFF `SESSION_SECRET` | Operator |
| `/lanyard/staging/portal/internal-ops-token` | CP `INTERNAL_OPS_TOKEN` | Operator |
| Optional `/lanyard/staging/github/token` | Host bootstrap private GH pins | Operator PAT (`repo` or fine-grained release read) |

Naming is **example only** — choose a path prefix consistent with your account; keep names out of public docs if sensitive.

### RDS wiring (G4.3)

```text
terraform output -raw control_plane_database_url_secret_arn
→ portal-control-plane-service.database_url_secret_arn   # legacy (still supported)
   default database_url_secret_format = "json_keys"
→ task secrets (JSON key form — required for control-plane-rds JSON payload):
     CONTROL_PLANE_DATABASE_URL  valueFrom = <arn>:CONTROL_PLANE_DATABASE_URL::
     DATABASE_URL                valueFrom = <arn>:DATABASE_URL::

# Generic secrets map alternative (must include :KEY:: for JSON secrets):
secrets["CONTROL_PLANE_DATABASE_URL"].value_from = "<arn>:CONTROL_PLANE_DATABASE_URL::"
secrets["DATABASE_URL"].value_from               = "<arn>:DATABASE_URL::"
```

**Do not** use a bare SM ARN of the control-plane-rds JSON secret as `valueFrom` — ECS would inject the whole JSON blob into the env var, Postgres URL parsing fails, and older images fall back to SQLite (`db=/data/control-plane.db`). Use `database_url_secret_format = "plain"` only when the secret string is a bare `postgresql://…` URL.

Do not put the password in tfvars. See module `terraform.tfvars.example` for SM + SSM shapes.

### Valkey / Redis wiring (G5 BFF sessions + G6 relay bus)

**Enable path + residual honesty:** `references/runbooks/portal-valkey-g5-enable.md` (`lp-t7q.8`). Pilot often leaves Valkey off. Module **infra_ready** ≠ production cert; live dual-BFF staging proof is deferred there.

```text
terraform output -raw redis_url_secret_arn   # from modules/portal-valkey
→ portal-bff-service / portal-relay-service:
    secrets["REDIS_URL"].value_from = "${module.portal_valkey.redis_url_secret_arn}:REDIS_URL::"
→ task secret: REDIS_URL=rediss://…  (injected by ECS; never in plain env or TF outputs)
```

| Mode | Secrets / flags |
|------|-----------------|
| Single-task pilot | No Valkey required; BFF `memory`; relay `RELAY_CLUSTER_MODE=single`; `desired_count=1` (common default) |
| Shared sessions (still 1 task OK) | Valkey + `BFF_SESSION_BACKEND=redis` + `REDIS_URL` secret |
| BFF scale-out | Above + product G5 + `acknowledge_g5_scale_beyond_one` + `BFF_MULTI_INSTANCE=true` + **recorded** dual-BFF staging proof |
| Relay bus scale-out | Valkey + `RELAY_CLUSTER_MODE=bus` + `REDIS_URL` + G6 ack |

**Session TTLs (product defaults, plain env):** `SESSION_TTL_SECONDS=604800` (7d sliding), `SESSION_MAX_AGE_SECONDS=2592000` (30d absolute).

**Store outage (product-owned):** redis/bus backends must fail closed on store unavailability (no silent memory fallback that desyncs multi-task sessions or dual owner leases). Document exact HTTP/WSS codes in Portal ADRs; deploy keeps `desired_count=1` until G5/G6 proven.

Do not put auth tokens or full rediss URLs in tfvars. See `portal-compute-staging-apply.md` §4b.

### Relay wiring

Follow `relay-secret-lifecycle.md`:

1. `POST …/instances/register` → store secret in SSM SecureString  
2. Terraform: instance id + SSM **name/ARN** only  
3. Host role `GetParameter` → `GATEWAY_RELAY_SECRET`

---

## 5. Customer brain host (bootstrap)

When pins use **private GitHub release** URLs (`compatibility/pins.real-releases.yaml`):

| Env | Required | Notes |
|-----|----------|--------|
| `GITHUB_TOKEN` or `GH_TOKEN` | **Yes** for private GH assets | Instance env or SSM→file; **never** git |
| S3 instance role | Preferred long-term | When pins move to `s3://` + artifact infra |

Bootstrap rejects missing token for private GitHub downloads (fail-closed).

---

## 6. Minimum path to first staging Portal stack

Check off in order:

- [ ] **GitHub Portal:** `AWS_ROLE_ARN`, `ARTIFACT_BUCKET`, `ECR_NAME_PREFIX`, `AWS_REGION` (if publishing images/static)  
- [ ] **Google OAuth** staging client: `GOOGLE_CLIENT_ID` (plain) + `GOOGLE_CLIENT_SECRET` (SM/SSM → ECS secrets map on BFF **and** CP)  
- [ ] **Google Console redirect URIs** for path-first hosts (`…/<tenant_slug>/api/auth/google/callback`) and any legacy subdomain hosts  
- [ ] **Session secret:** `SESSION_SECRET` on BFF via secrets map  
- [ ] **Service token:** `CONTROL_PLANE_SERVICE_TOKEN` on **both** BFF and CP via secrets map  
- [ ] **Ops token:** `INTERNAL_OPS_TOKEN` on CP via secrets map  
- [ ] **Postgres:** apply G4.3 → wire SM secret → `CONTROL_PLANE_DATABASE_URL`  
- [ ] **Valkey/Redis:** if multi-BFF, redis session backend, or relay `bus` → apply `portal-valkey` → wire `REDIS_URL` via secrets map (`redis_url_secret_arn`)  
- [ ] **Relay:** register instance → SSM secret → host/task  
- [ ] **CP private:** internal ALB only; BFF uses private `CONTROL_PLANE_URL`  
- [ ] **Pins:** private pin file validated; digests for images when ECR push done  
- [ ] **Host bootstrap token** if still on private GH release pins  

Then run proofs (do not invent evidence):

```bash
# From Portal repo (fail-closed without env):
export STAGING_BASE_URL=https://…
export STAGING_CP_PRIVATE_URL=…          # not public
export CONTROL_PLANE_SERVICE_TOKEN=…     # from secret store
export STAGING_EXPECT_SERVICE_AUTH=1
bash scripts/staging-g1-cp-boundary-proof.sh

export STAGING_SESSION_COOKIE='…'
export STAGING_EXPECT_BRAIN_RPC=1
bash scripts/staging-g3-brain-rpc-proof.sh
```

See `security-e2e-acceptance.md` S4 / S9 / S10.

---

## 7. Verification (names only — safe)

### Offline (this monorepo)

```bash
bash scripts/check-staging-secrets-checklist.sh
```

### GitHub (lists names, not values)

```bash
gh secret list -R LanyardBrain/Portal
gh variable list -R LanyardBrain/Portal
gh secret list -R LanyardBrain/Portal --env staging   # if environment exists
gh secret list -R LanyardBrain/hermes-lanyard
gh variable list -R LanyardBrain/client-core
```

### AWS (operator account)

```bash
# After RDS module apply — confirms secret exists (no value printed if using describe)
aws secretsmanager describe-secret --secret-id "$SECRET_ARN" --query 'Name' --output text
```

---

## 8. Explicit non-secrets (config flags)

Set as plain task env / Terraform non-secret maps:

| Name | Staging value |
|------|----------------|
| `CONTROL_PLANE_AUTH_MODE` | `production` |
| `NODE_ENV` | `production` |
| `BRAIN_RPC_ENABLED` | `1` when testing G3 |
| `BFF_SESSION_BACKEND` | `memory` (single task) or `redis` (with Valkey) |
| `BFF_MULTI_INSTANCE` | `true` only with redis + G5 |
| `SESSION_TTL_SECONDS` | Optional override (default 7d sliding) |
| `SESSION_MAX_AGE_SECONDS` | Optional override (default 30d absolute) |
| `RELAY_CLUSTER_MODE` | `single` (default) or `bus` (with Valkey + G6) |
| `PORTAL_DEBUG_PAYLOADS` | unset / `0` |
| `desired_count` (BFF/relay TF) | `1` until G5/G6 proven |

---

## 9. Rotation cheat sheet

| Material | Rotate how |
|----------|------------|
| `CONTROL_PLANE_SERVICE_TOKEN` | Generate new → update SM/SSM → rolling restart BFF **and** CP |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → update SM/SSM → rolling restart BFF **and** CP |
| `SESSION_SECRET` | Generate new → update SM/SSM → rolling restart BFF (invalidates existing sessions) |
| `CONTROL_PLANE_DATABASE_URL` | RDS master rotate / SM rotation → task restart |
| `REDIS_URL` | portal-valkey auth token rotate / SM version → restart BFF/relay |
| Relay instance secret | Control-plane **rotate** API → overwrite SSM → host refresh |
| GitHub PAT for bootstrap | Revoke old PAT → new fine-grained → SSM → host |

---

## 10. Checklist summary (print / ticket)

```
Staging secrets — operator ticket

GitHub Actions (publish):
[ ] Portal AWS_ROLE_ARN
[ ] Portal ARTIFACT_BUCKET
[ ] Portal ECR_NAME_PREFIX
[ ] Portal AWS_REGION
[ ] hermes-lanyard / client-core publish vars (if S3 path)

Portal runtime (OIDC + memberships):
[ ] GOOGLE_CLIENT_ID (plain)
[ ] GOOGLE_CLIENT_SECRET via SM/SSM → secrets map (BFF + CP) — never plain env
[ ] SESSION_SECRET via secrets map (BFF)
[ ] Google Authorized redirect URIs for path-first (+ legacy if used)
[ ] CONTROL_PLANE_SERVICE_TOKEN (BFF + CP same) via secrets map
[ ] INTERNAL_OPS_TOKEN via secrets map
[ ] CONTROL_PLANE_DATABASE_URL (via SM ARN) — users/memberships live here
[ ] CONTROL_PLANE_URL private on BFF
[ ] REDIS_URL via SM ARN (portal-valkey) if redis backend or relay bus
[ ] RELAY_INTERNAL_TOKEN
[ ] Relay instance secret via register → SSM

Host:
[ ] GITHUB_TOKEN/GH_TOKEN only if private GH pins
[ ] GATEWAY_RELAY_SECRET via instance role

Done means secrets exist in SM/SSM/GH — not that readiness-matrix G1/OIDC live proof is ready.
```
