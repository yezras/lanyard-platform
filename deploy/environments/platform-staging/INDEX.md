# environments/platform-staging

Platform **staging** root that composes central platform layers for Lanyard Portal / product release.

**Status:** `infra_ready` — validates offline; **not** production-applied or G8-certified from examples alone.

**OPERATOR HOLD (ACTIVE):** localhost-only cost teardown — do **not** `terraform apply` re-enabling fixed network/compute without a human lift. See **[OPERATOR-HOLD-LOCALHOST-ONLY.md](./OPERATOR-HOLD-LOCALHOST-ONLY.md)**. Relay DNS residual: [`docs/plans/0008-daytona-agent-sandboxes/residual-kng.3-relay-dns.md`](../../../docs/plans/0008-daytona-agent-sandboxes/residual-kng.3-relay-dns.md).

| Path | Purpose |
|------|---------|
| `OPERATOR-HOLD-LOCALHOST-ONLY.md` | Active cost hold: no re-enable of staging VPC/ALB/ECS/RDS without human approval |
| `main.tf` | Relative modules: product-artifact-infra, platform-vpc, control-plane-rds, portal-valkey (optional), portal-control-plane (internal), portal-bff/relay, portal-static-edge, portal-dns-tls (optional) |
| `variables.tf` / `outputs.tf` / `versions.tf` | Root inputs (layer toggles, pins), non-secret outputs, dual providers when DNS/TLS on |
| `main.tf` | Relative modules: product-artifact-infra, platform-vpc, control-plane-rds, portal-valkey (optional), portal-control-plane (internal), portal-bff/relay, portal-static-edge, optional portal-dns-tls + portal-waf |
| `variables.tf` / `outputs.tf` / `versions.tf` | Root inputs (layer toggles, pins), non-secret outputs, provider |
| `backend.tf.example` | Remote state sketch (copy → `backend.tf`, never commit) |
| `terraform.tfvars.example` | Placeholder-safe inputs (copy → `terraform.tfvars`, never commit) |

## Layers

| Layer | Module | Default | Notes |
|-------|--------|---------|-------|
| Product artifacts | `modules/product-artifact-infra` | on | S3 Object Lock + Portal ECR |
| Platform VPC | `modules/platform-vpc` | on | Two-AZ public/private + NAT/endpoints |
| Control-plane RDS | `modules/control-plane-rds` | on | Private, encrypted; SM `CONTROL_PLANE_DATABASE_URL` |
| Portal Valkey | `modules/portal-valkey` | **off** | Optional shared state; SM `REDIS_URL`. If enabled, compose defaults are **staging cost path** (1 node, multi-AZ/failover off) — see module README Topology |
| Control plane | `modules/portal-control-plane-service` | on | **Internal** ALB only (G1) |
| BFF | `modules/portal-bff-service` | on | **Public** ALB; digest pin; private `CONTROL_PLANE_URL` |
| Relay | `modules/portal-relay-service` | on | **Public** ALB (separate); digest pin; private `CONTROL_PLANE_URL` |
| Static edge | `modules/portal-static-edge` | on | Private S3 + CloudFront OAC; BFF origin when BFF on |
| DNS/TLS | `modules/portal-dns-tls` | **off** | ACM (us-east-1 CloudFront + regional ALB) + optional Route53 aliases |
| DNS/TLS | `modules/portal-dns-tls` | **off** | Optional ACM (us-east-1 CF + regional ALB) + Route53 aliases |
| WAF | `modules/portal-waf` | **off** | Optional WAFv2 baseline on CF + public BFF/relay ALBs |
| Staging Document Server | `modules/staging-document-server` | **off** | `staging-platform-shared-ds` (lp-5q6.34); SM JWT; Community free-track image |

## End-to-end wiring (no manual copy/paste of non-secret outputs)

| Wire | How |
|------|-----|
| ECR repository → tasks | `product_artifacts.ecr_repository_urls[bff\|relay\|control-plane]` → `image_repository` (override vars optional) |
| Image digest pins | Operator `*_image_digest` (compatibility `portal.images.*.digest`); modules reject tag-only / `:latest` |
| BFF/relay → CP ALB | Label SG on CP module + external `aws_vpc_security_group_ingress_rule` (task SGs) |
| CP tasks → RDS | Label SG on RDS + external rule from CP task SG |
| BFF/relay → Valkey | Label SG on Valkey + external rules (when valkey on) |
| RDS secret → CP | `database_url_secret_arn` → `CONTROL_PLANE_DATABASE_URL` (ARN only) |
| Valkey secret → BFF/relay | `REDIS_URL` secrets map from `redis_url_secret_arn` when valkey on |
| Internal CP URL → BFF/relay | `CONTROL_PLANE_URL=http://<internal-alb-dns>` (non-secret plain env) |
| Static edge BFF origin | `bff_origin_domain_name` from BFF ALB DNS |
| DNS/TLS certs → edge/ALBs | When `enable_portal_dns_tls=true`, CloudFront/regional cert ARNs wire into static edge / BFF / relay |
| OIDC / runtime secrets | Optional operator `bff_secrets` / `control_plane_secrets` (SM/SSM ARNs); `GOOGLE_CLIENT_ID` plain env only |
| Harness exec IAM residual | Optional `bff_execution_extra_secret_arns` (IAM-only GetSecretValue for `harness-litellm` + `daytona` while harness reuses BFF exec; `lp-oop.38.20`). Prefer `modules/harness-exec-iam`. Do not apply from that bead. |
| WAF → CloudFront | `portal_waf.cloudfront_web_acl_arn` → `portal-static-edge.web_acl_id` when `enable_portal_waf` |
| WAF → public ALBs | Regional WebACL association to BFF/relay (+ staging Docs when enabled) ALB ARNs only (never control plane) |
| Staging DS JWT → BFF | When `enable_staging_document_server`, SM JWT ARN → BFF `BFF_OFFICE_JWT_SECRET`; plain env `BFF_OFFICE_PUBLIC_BASE_URL` + `BFF_OFFICE_DOCUMENT_SERVER_HOSTS` |
| Browser → Docs | Public Docs ALB DNS or `document_server_public_hostname` Route53 alias |

- **Explicit overrides:** `rds_allowed_security_group_ids`, `control_plane_allowed_ingress_security_group_ids`, `valkey_allowed_security_group_ids` (win when non-empty).
- **Never** `0.0.0.0/0` for data-plane or control-plane ingress.
- **Never** passwords/tokens in outputs (secret **ARNs** and private DNS only).
- **OIDC client secrets** never in plain env / tfvars values — see `terraform.tfvars.example` optional secrets maps and `references/runbooks/staging-secrets-checklist.md` § OIDC (path-first callback URL shapes). Live OIDC proof not claimed from compose alone.

## Pilot cost profile

Compose defaults target a **1–3 client chat-first pilot** (not production HA). Chat/vault remain on client Hermes EBS; CP RDS is metadata only.

| Knob | Pilot default | Notes |
|------|---------------|-------|
| `enable_portal_valkey` / `enable_portal_waf` / `enable_portal_dns_tls` / `enable_oidc_publishers` / `enable_staging_document_server` | **false** | Keep off until needed |
| `rds_instance_class` | `db.t4g.small` | micro also acceptable |
| `rds_allocated_storage` | `20` | Module floor |
| `rds_multi_az` | **false** | Single-AZ |
| Valkey *if* enabled | `num_cache_clusters=1`, multi-AZ/failover **false** | Staging cost path |

**Indicative monthly AWS (planning only, not measured Cost Explorer):** shared platform ~$135–220; per-client host ~$50–85; combined ~$200–300 (1 client) / ~$300–450 (3 clients). Model API spend is outside this profile.

**HA re-enable** (prod-like staging; private tfvars — not a readiness claim):

```hcl
rds_instance_class    = "db.t4g.medium"
rds_allocated_storage = 50
rds_multi_az          = true
# When G5/G6 need shared state:
# enable_portal_valkey              = true
# valkey_num_cache_clusters         = 2
# valkey_multi_az_enabled           = true
# valkey_automatic_failover_enabled = true
```

Regression lock: `bash scripts/smoke-pilot-cost-profile.sh` fails if defaults drift to medium Multi-AZ or optional layers default on. See `references/runbooks/platform-staging-compose.md` § Pilot cost profile. **NAT cost note:** pilot keeps `single_nat_gateway=true` with endpoints on; do not flip `enable_nat_gateway` default off without endpoints-only proof — runbook § NAT vs interface endpoints.

## Validate (no credentials)

```bash
cd environments/platform-staging
terraform init -backend=false -input=false
terraform validate
bash ../../scripts/smoke-platform-staging-compose.sh
bash ../../scripts/smoke-pilot-cost-profile.sh
```

CI runs the same offline path (fmt, compose smoke, per-module validate). CI does **not** apply.

## Backend and secrets

| Item | Rule |
|------|------|
| Backend | Copy `backend.tf.example` → private `backend.tf`; never commit state or backend config |
| Tfvars | Copy `terraform.tfvars.example` → private `terraform.tfvars`; keep `REPLACE` out of live names |
| Secrets | SM/SSM **ARNs** only in Terraform; names checklist in `references/runbooks/staging-secrets-checklist.md` |
| Pins | Private compatibility file → digests; never commit live production digests |

## Apply gates (all required)

1. Confirm AWS caller is the **Lanyard platform staging** account (`aws sts get-caller-identity`) — never apply from a customer or unrelated product account
2. Replace `artifact_bucket_name` and `static_origin_bucket_name` REPLACE suffixes
3. Configure `backend.tf` from the example (gitignored; never commit)
4. Set real image digests from a **private** compatibility pin file (repositories auto from ECR)
5. Optionally enable OIDC with an **existing** provider ARN (create the GitHub OIDC provider **once** outside this module if none exists — never a second provider)
6. Optionally `enable_portal_valkey=true` when G5/G6 consumers exist
7. Optionally `enable_portal_dns_tls=true` with real hostnames / zone strategy
5. Optionally enable **GitHub Actions** OIDC publishers with an **existing** provider ARN (create the GitHub OIDC provider **once** outside this module if none exists — never a second provider)
6. Optionally wire **Google OIDC** runtime secrets via `bff_secrets` / `control_plane_secrets` (ARNs only; register path-first redirect URIs per staging-secrets-checklist)
7. Optionally `enable_portal_valkey=true` when G5/G6 consumers exist
7. Optionally `enable_portal_dns_tls=true` / `enable_portal_waf=true` with real hostnames / edge attach in private tfvars
8. Operator AWS credentials — apply remains operator-owned

**Operator procedures:**

- **Composed root apply + rollback:** `references/runbooks/platform-staging-compose.md`
- Product artifacts: `references/runbooks/product-artifact-staging-apply.md`
- Portal compute pins/order: `references/runbooks/portal-compute-staging-apply.md`
- Live verify (post-apply artifacts): `scripts/verify-product-artifact-staging.sh` (env-driven; no live IDs in git)
- Portal compute: `references/runbooks/portal-compute-staging-apply.md`
- Staging secrets (OIDC names + path-first callbacks + Office JWT): `references/runbooks/staging-secrets-checklist.md`
- Staging Document Server (`staging-platform-shared-ds`): `references/runbooks/staging-document-server.md`
- Live verify (post-apply): `scripts/verify-product-artifact-staging.sh` (env-driven; no live IDs in git)
- Offline IAM contract: `scripts/smoke-product-artifact-iam.sh`

## Outputs

Non-secret endpoints, resource IDs, secret **ARNs**, private `control_plane_url`, and `end_to_end_wiring` evidence. No passwords, tokens, or live secret values.

## Honesty

| Claim | Truth |
|-------|--------|
| Offline validate | Yes |
| Auto-applied from git/CI | **No** |
| Example tfvars apply-ready | **No** |
| G8 / G1 / G2 production certified | **No** until staging evidence |
