# Runbook: Portal compute staging apply + pin wiring (G8.3)

**Status:** Operator procedure — modules are **infra_ready**, not production-certified  
**Purpose:** Ordered apply for Portal static edge + thin BFF/relay/control-plane services once digest and static-web pins exist  
**Modules:**

| Module | Role |
|--------|------|
| `modules/platform-vpc` | Two-AZ public/private VPC foundation (NAT and/or VPC endpoints); **infra_ready** |
| `modules/portal-static-edge` | CloudFront OAC + private S3 static web |
| `modules/portal-bff-service` | Public BFF API edge (digest pin); `REDIS_URL` via secrets map |
| `modules/portal-relay-service` | Public relay WSS edge (digest pin); `REDIS_URL` via secrets map |
| `modules/portal-control-plane-service` | **Internal** control-plane only (G1) |
| `modules/control-plane-rds` | Optional private Postgres (G4.3) |
| `modules/portal-valkey` | Optional private Valkey shared state (G5/G6 store); Secrets Manager `REDIS_URL` |
| `modules/portal-dns-tls` | Optional Route53 aliases + ACM (us-east-1 CloudFront cert, regional BFF/relay certs); **infra_ready** |
| `modules/portal-waf` | Optional WAFv2 baseline (CloudFront us-east-1 + regional public BFF/relay ALBs; CommonRuleSet + KnownBadInputs + rate-based); **infra_ready** |
| `modules/product-artifact-infra` | S3/ECR landing zones (Phase 2) |
| `environments/platform-staging` | **Preferred private root compose** of the layers above (+ optional `portal-valkey` / `portal-dns-tls` / `portal-waf`); **infra_ready**, not auto-applied |

**Related:** `references/readiness-matrix.md`, `references/runbooks/pin-update.md`, `references/runbooks/staging-secrets-checklist.md`, `references/runbooks/production-security-gate.md`, `compatibility/pins.example.yaml`

---

## Honesty (read first)

| Claim | Truth |
|-------|--------|
| Modules validate offline | Yes (`terraform validate` + `scripts/smoke-portal-compute.sh`) |
| Auto-applied from this repo / CI | **No** — private operator roots only |
| Example tfvars are apply-ready | **No** — placeholders only |
| G8 production certified | **No** until staging evidence + G1/G2/G7 matrix rows clear |
| Control plane on public ALB | **Forbidden** — module hard-rejects |

Do **not** flip readiness-matrix G8 to **ready** from docs alone. Keep **infra_ready** until staging apply evidence is recorded. Production Portal/relay **security** remains **blocked** while G1/G2 are blocked — see `production-security-gate.md` and `bash scripts/validate-production-gates.sh`.

---

## Prerequisites

1. **Phase 2 release foundation** applied (or available): `environments/platform-staging` / `modules/product-artifact-infra` (ECR repos + `portal-web/` prefix). Procedure: `references/runbooks/product-artifact-staging-apply.md`; post-apply: `scripts/verify-product-artifact-staging.sh`.
1. **Platform staging compose** available: `environments/platform-staging` wires product-artifact-infra + platform-vpc + RDS + BFF/relay/CP + static edge (optional Valkey). Operators may still apply layers separately from private roots.
2. **Staging secrets** prepared per `references/runbooks/staging-secrets-checklist.md` (GitHub Actions publish vars, runtime SM/SSM, BFF/CP/relay env). Offline check: `bash scripts/check-staging-secrets-checklist.sh`.
3. **G7 pins** in a **private** compatibility file (never commit live digests to git):
   - `portal.web.url` / `version` / `sha256`
   - `portal.images.bff|relay|control-plane.repository` + `digest`
4. `bash scripts/validate-compatibility.sh /path/to/private-pins.yaml`
5. VPC with:
   - ≥2 **public** subnets (BFF + relay ALBs)
   - ≥2 **private** subnets (`map_public_ip_on_launch=false`) for tasks + internal CP ALB + optional RDS
   - Prefer `modules/platform-vpc` (infra_ready; operator-owned apply) for a validated two-AZ topology + NAT/VPC endpoints (ECR, Logs, Secrets Manager, SSM, S3)
6. Optional: ACM + DNS via `modules/portal-dns-tls` (CloudFront cert **us-east-1** via provider alias; regional ALB certs; prefer existing hosted zone / cert ARNs to avoid duplicates). Or pass pre-created ACM ARNs into static edge / BFF / relay.
7. Optional: baseline WAF via `modules/portal-waf` (CloudFront WebACL **us-east-1**; regional WebACL on public BFF/relay ALBs only — never the internal control plane). Or pass a pre-created CloudFront WebACL ARN into `portal-static-edge.web_acl_id`.
8. Operator AWS credentials and a **private** Terraform root (not committed).

---

## Pin inputs (map from private pins file)

| Pin field | Module variable |
|-----------|-----------------|
| `portal.web.url` | `portal-static-edge.static_web_artifact_url` |
| `portal.web.version` | `portal-static-edge.static_web_artifact_version` |
| `portal.web.sha256` | `portal-static-edge.static_web_artifact_sha256` |
| `portal.images.bff.repository` | `portal-bff-service.image_repository` |
| `portal.images.bff.digest` | `portal-bff-service.image_digest` |
| `portal.images.relay.repository` | `portal-relay-service.image_repository` |
| `portal.images.relay.digest` | `portal-relay-service.image_digest` |
| `portal.images.control-plane.repository` | `portal-control-plane-service.image_repository` |
| `portal.images.control-plane.digest` | `portal-control-plane-service.image_digest` |

Deploy authority for images is always **`repository@digest`**. Tags are hints only. Never deploy `:latest` alone.

Each compute module requires:

```hcl
acknowledge_not_auto_applied = true
```

BFF/relay default `desired_count = 1`. Do not scale beyond one without product G5/G6 and the module acknowledge flags.  
**Preferred composed root:** `environments/platform-staging` (or a private copy) wires product-artifact-infra, platform-vpc, RDS, BFF/relay/CP, static edge, and optional Valkey/DNS-TLS. Backend, secrets, full-root apply, and **rollback** for that compose: `references/runbooks/platform-staging-compose.md`. Status remains **infra_ready** — not production-applied from examples alone.

---

## Ordered apply steps

**Preferred:** one private root at `environments/platform-staging` (or a private copy) that composes all layers with relative module sources. Enable flags and SG auto-wiring are documented in `environments/platform-staging/INDEX.md`. Full apply/rollback contract: `references/runbooks/platform-staging-compose.md`.

Alternatively use multiple private roots with the same modules. Example skeleton (do not commit live values):

### 0. Full compose (recommended)

```bash
cd environments/platform-staging   # or private copy
# backend.tf + terraform.tfvars:
#   - unique artifact_bucket_name + static_origin_bucket_name
#   - real image digests from private pins
#   - acknowledge gates already true in root wiring
terraform init && terraform plan && terraform apply
```

Record outputs: ECR URLs, ALB DNS names, CloudFront domain, secret ARNs (not secret values).

End-to-end wiring (cbd-mta.1.3): with default `auto_wire_security_groups=true`, the root attaches BFF/relay → CP ALB, CP tasks → RDS, and (when enabled) BFF/relay → Valkey via **external** `aws_vpc_security_group_ingress_rule` resources plus label SGs on modules (avoids cycles). It also wires ECR repository URLs from product-artifact outputs, RDS/Valkey **secret ARNs** into tasks, private `CONTROL_PLANE_URL` into BFF/relay from the internal CP ALB DNS, and static-edge BFF origin from the BFF ALB DNS — so operators do not copy/paste non-secret outputs. Digests remain operator pins (compatibility `portal.images.*.digest`; never tag-only). For manual two-phase, set `auto_wire_security_groups=false` and pass explicit `*_allowed_*_security_group_ids`.

### 1. Product artifact infra only (if splitting roots)

```bash
cd environments/platform-staging   # or private copy with only product_artifacts enabled
# backend.tf + terraform.tfvars with real unique bucket name
# enable_platform_vpc=false and other layers off if applying artifacts alone
terraform init && terraform plan && terraform apply
```

Record ECR repository URLs for bff / relay / control-plane.

### 2. Control-plane RDS (optional but recommended for staging)

```hcl
module "control_plane_rds" {
  source                       = "../../modules/control-plane-rds"
  name_prefix                  = "lanyard-cp-staging"
  vpc_id                       = var.vpc_id
  subnet_ids                   = var.private_subnet_ids
  allowed_security_group_ids   = [] # fill after CP task SG exists, or apply in two passes
  acknowledge_not_auto_applied = true
}
```

Two-pass is normal: create RDS after control-plane task SG exists, or temporarily allow a private CIDR then tighten.

### 3. Private control-plane service (**before** exposing BFF to real users)

```hcl
module "portal_cp" {
  source               = "../../modules/portal-control-plane-service"
  name_prefix          = "lanyard-portal-staging"
  vpc_id               = var.vpc_id
  private_subnet_ids   = var.private_subnet_ids
  internal             = true
  image_repository     = var.cp_image_repository
  image_digest         = var.cp_image_digest
  allowed_ingress_security_group_ids = [
    # module.portal_bff.task_security_group_id,
    # module.portal_relay.task_security_group_id,
  ]
  database_url_secret_arn      = module.control_plane_rds.control_plane_database_url_secret_arn
  acknowledge_not_auto_applied = true
}
```

Verify:

- ALB `internal == true`
- `/health` healthy on target group
- No public listener / no public subnet attachment

### 4. Public BFF service

```hcl
module "portal_bff" {
  source               = "../../modules/portal-bff-service"
  name_prefix          = "lanyard-portal-staging"
  environment          = "staging"
  vpc_id               = var.vpc_id
  public_subnet_ids    = var.public_subnet_ids
  private_subnet_ids   = var.private_subnet_ids
  image_repository     = var.bff_image_repository
  image_digest         = var.bff_image_digest
  desired_count        = 1
  health_check_path    = "/health"
  environment_variables = {
    NODE_ENV            = "production"
    # GOOGLE_CLIENT_ID  = "REPLACE.apps.googleusercontent.com" # public id only
    # Prefer environments/platform-staging auto-wire:
    #   CONTROL_PLANE_URL = "http://${module.portal_cp.alb_dns_name}"
    # After Valkey (§4b): BFF_SESSION_BACKEND = "redis"
    # SESSION_TTL_SECONDS     = "604800"   # 7d sliding (product default)
    # SESSION_MAX_AGE_SECONDS = "2592000"  # 30d absolute
  }
  # OIDC + service token via secrets map (ARNs only) — never plain env:
  # secrets = {
  #   GOOGLE_CLIENT_SECRET = { value_from = "arn:aws:secretsmanager:…:secret:…/google-client-secret-…" }
  #   SESSION_SECRET       = { value_from = "arn:aws:ssm:…:parameter/…/session-secret" }
  #   CONTROL_PLANE_SERVICE_TOKEN = { value_from = "arn:aws:ssm:…:parameter/…/service-token" }
  # }
  # secrets.REDIS_URL after Valkey apply — see §4b (never plain environment_variables)
  acknowledge_not_auto_applied = true
}
```

In the composed root, BFF/relay task SGs reach the internal CP ALB via external SG rules (no broad private CIDRs), and `CONTROL_PLANE_URL` is injected from the internal ALB DNS. Split-root operators: wire task SGs into CP `allowed_ingress_security_group_ids` (or external rules) and set BFF `CONTROL_PLANE_URL` to the private ALB base URL.

### 4a. OIDC secrets + path-first callback URLs (cbd-mta.3.2)

Wire Google OIDC before human login proofs. **Names and shapes only** — never commit secret values.

| Item | Contract |
|------|----------|
| `GOOGLE_CLIENT_ID` | Plain env on BFF + CP (public) |
| `GOOGLE_CLIENT_SECRET` | ECS `secrets` map on BFF **and** CP (SM/SSM ARN) — rejected in plain env always |
| `SESSION_SECRET` | ECS `secrets` map on BFF |
| `CONTROL_PLANE_SERVICE_TOKEN` | ECS `secrets` map on BFF + CP (same value) |
| Path-first redirect URI | `https://app.withlanyard.com/<tenant_slug>/api/auth/google/callback` (staging: `https://<portal_web_hostname>/<tenant_slug>/api/auth/google/callback`) |
| Legacy subdomain redirect | `https://<tenant_slug>.withlanyard.com/api/auth/google/callback` |
| App logout | `POST /<tenant_slug>/api/auth/logout` (not a Google Console URI) |
| Memberships | Control-plane Postgres grants after verified `google_sub` — not Google Groups |

Register Authorized redirect URIs in Google Cloud Console for each tenant slug you serve. Full checklist: `references/runbooks/staging-secrets-checklist.md` § OIDC / path-first callbacks.

**Honesty:** Completing this wiring does **not** flip readiness-matrix **G1** or claim live OIDC proof ready — that remains **G1.4** / cbd-mta.6.2.

### 4b. Portal Valkey shared state (G5/G6 store — optional for single-task pilot)

**Canonical enable path + dual-BFF residual honesty:** [`portal-valkey-g5-enable.md`](./portal-valkey-g5-enable.md) (`lp-t7q.8`).

Apply after BFF/relay task SGs exist (two-pass is normal). **Pilot/mocklab default is Valkey off** — single-task staging may defer Valkey and keep `BFF_SESSION_BACKEND=memory` / `RELAY_CLUSTER_MODE=single`. Module **infra_ready** ≠ production certification and does **not** flip matrix **G5**.

```hcl
module "portal_valkey" {
  source     = "../../modules/portal-valkey"
  name_prefix = "lanyard-portal-staging"
  environment = "staging"
  vpc_id      = var.vpc_id
  subnet_ids  = var.private_subnet_ids
  # Prefer task SGs (not 0.0.0.0/0). Staging cost path: num_cache_clusters = 1, multi_az = false.
  allowed_security_group_ids = [
    module.portal_bff.task_security_group_id,
    module.portal_relay.task_security_group_id,
  ]
  acknowledge_not_auto_applied = true
}

# Re-apply BFF / relay with SM injection (ARNs only — never redis URL in tfvars/env/outputs):
#   secrets = {
#     REDIS_URL = {
#       value_from = "${module.portal_valkey.redis_url_secret_arn}:REDIS_URL::"
#     }
#   }
# BFF plain env when using redis backend:
#   BFF_SESSION_BACKEND = "redis"
# Relay stays RELAY_CLUSTER_MODE = "single" until product G6 bus is proven.
```

| Check | Truth |
|-------|--------|
| `REDIS_URL` in plain `environment_variables` | **Forbidden** on production-like `environment` labels (module check) |
| `REDIS_URL` in Terraform outputs | **No** — secret_names / secret ARN only |
| `desired_count > 1` | Still requires G5/G6 acknowledge flags + product proof |
| Matrix G5/G6 | Remain **blocked** until product multi-instance + **live** staging evidence |
| Dual-BFF live session/routing proof | **Deferred** with reason in `portal-valkey-g5-enable.md` (CI dual-instance substitute ≠ AWS multi-task) |
| Production cert from module alone | **No** |

Store outage: with redis/bus backends product must fail closed (no silent memory fallback that desyncs multi-task sessions or dual owner leases). See BFF/relay module READMEs.

### 5. Public relay service (separate from BFF)

```hcl
module "portal_relay" {
  source               = "../../modules/portal-relay-service"
  name_prefix          = "lanyard-portal-staging"
  environment          = "staging"
  vpc_id               = var.vpc_id
  public_subnet_ids    = var.public_subnet_ids
  private_subnet_ids   = var.private_subnet_ids
  image_repository     = var.relay_image_repository
  image_digest         = var.relay_image_digest
  desired_count        = 1
  health_check_path    = "/health"
  environment_variables = {
    NODE_ENV           = "production"
    RELAY_CLUSTER_MODE = "single" # "bus" only with REDIS_URL + G6 proof
  }
  # secrets.REDIS_URL after Valkey (§4b) for bus / jti / owner leases / revocation
  acknowledge_not_auto_applied = true
}
```

Record `wss://` URL for customer-gateway-relay / register path (`references/runbooks/relay-secret-lifecycle.md`). G2 production security still **blocked** until staging lifecycle E2E is recorded.

### 6. Static edge (+ dual BFF API path routing)

```hcl
module "portal_static" {
  source                       = "../../modules/portal-static-edge"
  name_prefix                  = "lanyard-portal-staging"
  origin_bucket_name           = var.origin_bucket_name # globally unique
  static_web_artifact_url      = var.web_url
  static_web_artifact_version  = var.web_version
  static_web_artifact_sha256   = var.web_sha256
  # Wire after BFF module is applied (ALB DNS). Empty string = static-only (no API behaviors).
  bff_origin_domain_name       = module.portal_bff.alb_dns_name
  # Dual defaults (keep both — do not replace path-first with bare only):
  # api_path_pattern      = "/*/api/*"  # preserves /<tenant_slug>/api/* on the wire
  # bare_api_path_pattern = "/api/*"    # apex public discovery (org resolve, etc.)
  acknowledge_not_auto_applied = true
}
```

**BFF origin wiring (P0) — dual ordered behaviors:**

| Setting | Contract |
|---------|----------|
| `bff_origin_domain_name` | BFF ALB DNS name (no scheme). When set, CloudFront adds custom origin `portal-bff` and **two** ordered behaviors → BFF (not S3). |
| Path-first pattern | `api_path_pattern` default `/*/api/*` — `/<tenant_slug>/api/*` tenant/platform APIs |
| Bare pattern | `bare_api_path_pattern` default `/api/*` — apex public discovery without a tenant segment (e.g. `POST /api/public/tenants/resolve`) |
| Cache | Managed **CachingDisabled** — API responses not cached across users/tenants |
| Origin request | Managed **AllViewerExceptHostHeader** — cookies, query strings, Authorization/CSRF headers forwarded; path not stripped |
| Methods | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE |
| Order | Both API behaviors sit **above** `/assets/*` and the SPA default |
| Fail-closed | Leave empty until BFF exists; static-only distribution still plans/validates |

Without bare `/api/*`, apex org-finder / public resolve falls through to S3 SPA HTML and staging proof fails closed.

**SPA `custom_error_response` risk:** when `enable_spa_error_routing = true` (default), distribution-wide 403/404 → SPA `index.html` (response 200) can rewrite **BFF** 404/403 bodies (e.g. unknown org) to HTML. After apply, verify unknown-org resolve returns **JSON** (or a non-HTML BFF error), not SPA markup. Prefer product errors as `401`/`422` where possible; treat 200 HTML on an API path as a routing/SPA-map failure.

Operator sync (module does **not** download at apply):

1. Download artifact from pin URL.
2. Verify SHA-256.
3. Extract/upload to origin bucket (optionally under version prefix + `origin_path`).
4. Invalidate CloudFront if replacing objects:  
   `aws cloudfront create-invalidation --distribution-id … --paths "/*"`

DNS: alias `app.withlanyard.com` (or staging hostname) → CloudFront. With `bff_origin_domain_name` set, **both** `/<tenant_slug>/api/*` and bare `/api/*` are routed by CloudFront ordered behaviors to the **BFF** origin — not the private S3 origin.

**CloudFront deploy wait (required after apply):** `terraform apply` returns before all edge POPs finish. Poll until the distribution is **Deployed** before verify curls (curls during `InProgress` can still hit the old behavior set):

```bash
DIST_ID=…   # portal-static-edge cloudfront_distribution_id from private root outputs
aws cloudfront wait distribution-deployed --id "$DIST_ID"
```

Focused ship handoff (dual-pattern summary + private tfvars apply + honesty gates): [`portal-bare-api-edge-routing.md`](./portal-bare-api-edge-routing.md) (**lp-b87**). Live staging is **not** fixed until that procedure is green.

**Staging verify curls** (replace `HOST`; expect BFF JSON/error shape, not SPA HTML):

```bash
HOST="${HOST:-app.withlanyard.com}"

# Bare /api/* — apex public discovery (must hit BFF, not S3 SPA)
curl -sS -D- -o /tmp/bare-resolve.body -X POST "https://${HOST}/api/public/tenants/resolve" \
  -H 'content-type: application/json' \
  -d '{"query":"__unknown_org_for_edge_check__"}'
# Fail if Content-Type is text/html or body starts with <!DOCTYPE / <html

# Path-first /*/api/* — tenant API still on BFF
curl -sS -D- -o /tmp/path-first.body "https://${HOST}/demo/api/health"
# Expect BFF response, not S3 403 XML / SPA HTML

# Non-API SPA still serves
curl -sS -o /dev/null -w '%{http_code}\n' "https://${HOST}/demo"
```

### 7. Portal DNS/TLS (ACM + Route53 — optional but required for custom hostnames)

Prefer **`environments/platform-staging`** with `enable_portal_dns_tls=true` (default **false** so offline examples stay placeholder-safe). The root declares **dual AWS providers** (`aws` + `aws.us_east_1`) because CloudFront certificates must be issued in **us-east-1**.

```hcl
# Standalone private root sketch (or set enable_portal_dns_tls on platform-staging)
provider "aws" {
  region = var.region
}
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

module "portal_dns_tls" {
  source = "../../modules/portal-dns-tls"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
  name_prefix         = "lanyard-portal-staging"
  portal_web_hostname = "app.example.com"    # bare FQDN — no https://
  bff_hostname        = "api.example.com"
  relay_hostname      = "relay.example.com"  # clients use wss://relay.example.com
  create_route53_zone = false
  route53_zone_id     = var.route53_zone_id  # prefer existing zone (no duplicates)
  # existing_cloudfront_certificate_arn / existing_regional_certificate_arn to reuse certs
  # create_dns_records = true when alias targets are constants; platform-staging uses false
  # and creates root aws_route53_record after CloudFront/ALBs exist (cycle-safe).
  acknowledge_not_auto_applied = true
}

# Wire certs into compute (platform-staging does this when enable_portal_dns_tls=true):
#   portal-static-edge: aliases = [portal_web_hostname], acm_certificate_arn = cloudfront_certificate_arn
#   portal-bff / portal-relay: enable_https = true, acm_certificate_arn = regional_certificate_arn
```

| Check | Truth |
|-------|--------|
| CloudFront ACM region | **us-east-1 only** (`aws.us_east_1` provider alias) |
| BFF/relay ACM region | Same region as ALBs (default provider) |
| HTTP→HTTPS | CloudFront `viewer_protocol_policy = redirect-to-https`; BFF/relay HTTP listeners **301 → HTTPS** when `enable_https=true` |
| Insecure websockets | Clients and pins must use **`wss://`**; `ws://` / `http://` rejected by hostname/URL validations |
| Existing zone/certs | Pass `route53_zone_id` / `existing_*_certificate_arn` — do not create duplicate zones or certs |
| Offline smoke | `bash scripts/smoke-portal-dns-tls.sh` |

Record FQDNs (not private keys): web → CloudFront, BFF → public ALB, relay → public ALB (`wss://` for customer-gateway-relay).

### 8. Portal WAF (baseline managed rules — optional, recommended for public edges)

Prefer **`environments/platform-staging`** with `enable_portal_waf=true` (default **false** so offline examples stay placeholder-safe). Uses the same dual-provider root (`aws` + `aws.us_east_1`) because **CLOUDFRONT-scope** WebACLs must be created in **us-east-1**.

```hcl
# Standalone private root sketch (or set enable_portal_waf on platform-staging)
module "portal_waf" {
  source = "../../modules/portal-waf"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
  name_prefix = "lanyard-portal-staging"

  enable_cloudfront_web_acl = true
  enable_regional_web_acl   = true
  enable_common_rule_set    = true
  enable_known_bad_inputs   = true
  enable_rate_based_rule    = true
  rate_limit                = 2000
  # First enable: managed_rule_override_action = "count" then flip to "none"

  # Public edges only — never control-plane internal ALB:
  associate_alb_arns = [
    module.portal_bff.alb_arn,
    module.portal_relay.alb_arn,
  ]

  acknowledge_not_auto_applied = true
}

# Wire CloudFront (platform-staging does this when enable_portal_waf=true):
#   portal-static-edge.web_acl_id = module.portal_waf.cloudfront_web_acl_arn
```

| Check | Truth |
|-------|--------|
| CloudFront WebACL region | **us-east-1 only** (`aws.us_east_1` provider alias, scope `CLOUDFRONT`) |
| Regional WebACL targets | Public **BFF** + **relay** ALBs via `aws_wafv2_web_acl_association` |
| Control plane | **Never** associated (internal ALB only; G1) |
| Managed rules baseline | `AWSManagedRulesCommonRuleSet` + `AWSManagedRulesKnownBadInputsRuleSet` |
| Rate-based | Optional (default on; 2000 req / 5 min / IP) |
| Offline smoke | `bash scripts/smoke-portal-waf.sh` |

After enablement, review WAF CloudWatch metrics / sampled requests before tightening `managed_rule_override_action` from `count` to `none` if you staged observe-only.

---

## Post-apply checks

```text
[ ] Static: bucket public access block all true; only OAC can GetObject
[ ] Static: HTTPS CloudFront; path /<tenant_slug> serves SPA
[ ] Static: bff_origin_domain_name set; dual ordered behaviors /*/api/* and /api/* target BFF (not S3); CachingDisabled
[ ] Static: bare POST /api/public/tenants/resolve reaches BFF JSON (not SPA HTML) — see §6 verify curls
[ ] Static: path-first /<tenant_slug>/api/* still reaches BFF; API POST/OPTIONS with session cookie not cached at edge
[ ] Static: unknown-org / BFF 404 is not SPA-mapped HTML (custom_error_response risk)
[ ] DNS/TLS (if applied): CloudFront cert is us-east-1 ISSUED; regional cert ISSUED for BFF/relay
[ ] DNS/TLS: Route53 aliases web→CloudFront, BFF→ALB, relay→ALB (correct zone IDs)
[ ] DNS/TLS: HTTP→HTTPS redirect on web + BFF/relay; relay clients use wss:// only (not ws://)
[ ] WAF (if applied): CloudFront distribution web_acl_id is CLOUDFRONT WebACL ARN (us-east-1)
[ ] WAF: regional WebACL associated to public BFF + relay ALBs only (not control-plane)
[ ] WAF: CommonRuleSet + KnownBadInputs enabled; rate-based metrics visible in CloudWatch
[ ] BFF: ALB target healthy on /health; digest matches private pin; HTTPS listener when custom hostname
[ ] Relay: ALB target healthy on /health; digest matches private pin; HTTPS listener when custom hostname
[ ] CP: ALB internal=true; not reachable from public internet
[ ] CP: BFF→CP private path works with service auth (G1.4 staging proof)
[ ] Valkey (if applied): private subnets; SG allows only BFF/relay task SGs; SM secret exists
[ ] REDIS_URL injected via secrets map (value_from secret ARN); absent from plain env/tfvars/outputs
[ ] BFF: BFF_SESSION_BACKEND matches deployment (memory single-task or redis with Valkey)
[ ] Relay: RELAY_CLUSTER_MODE=single until G6 bus proven
[ ] desired_count is 1 for BFF and relay (unless G5/G6 acknowledged)
[ ] bash scripts/validate-production-gates.sh still honest (G1/G2 blocked until evidence)
[ ] bash scripts/policy-as-code-security.sh passes
```

---

## Rollback notes

For the **composed platform root** (backend, secrets, destroy order, stop conditions), use **`references/runbooks/platform-staging-compose.md`**. Layer summary:

| Layer | Rollback |
|-------|----------|
| Static web | Re-upload previous versioned prefix objects; set `origin_path` back; CloudFront invalidation |
| BFF / relay / CP images | Re-apply previous `image_digest` from private pin history; ECS rolls tasks |
| Bad desired_count | Set `desired_count = 1` and re-apply |
| Network mistake (public CP) | **Never** set CP `internal=false` — module rejects; destroy public experiment if any |
| RDS | Prefer snapshot restore; do not skip final snapshot in real envs |
| Valkey / Redis | Fail closed at product for redis/bus backends; scale back to desired_count=1 + memory/single if store unhealthy |
| DNS/TLS | Prefer re-alias to previous cert/target; do not delete shared hosted zones used elsewhere |
| Full abort | Reverse destroy order on **empty** staging only — see platform-staging-compose runbook; respect Object Lock + deletion protection |

Pin history: keep prior private pin files immutable (`references/runbooks/pin-update.md`).

---

## Production security gate honesty

Staging apply of these modules **does not** clear:

- **G1** private control-plane production claim (needs recorded staging proof)
- **G2** relay credential lifecycle production claim
- **G5** BFF shared-state scale-out (Valkey module + wiring ≠ multi-instance product proof)
- **G6** relay bus / shared revocation scale-out (same)
- **G7** “published pins in git examples” (pins stay private)
- **PS-PT** pen-test / production-security-signoff (**NOT SIGNED**)

Links:

- `references/runbooks/production-security-gate.md`
- `references/runbooks/security-e2e-acceptance.md`
- `references/production-security-signoff.md`
- `bash scripts/validate-production-gates.sh`

---

## Offline validation (no apply)

```bash
bash scripts/smoke-portal-compute.sh
bash scripts/smoke-portal-valkey.sh
bash scripts/check-staging-secrets-checklist.sh
bash scripts/smoke-platform-staging-compose.sh
bash scripts/policy-as-code-security.sh
bash scripts/validate-production-gates.sh
for d in \
  modules/portal-static-edge \
  modules/portal-bff-service \
  modules/portal-relay-service \
  modules/portal-control-plane-service \
  modules/portal-valkey
  environments/platform-staging
do
  (cd "$d" && terraform init -backend=false -input=false && terraform validate)
done
```
