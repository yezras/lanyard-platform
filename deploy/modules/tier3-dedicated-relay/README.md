# tier3-dedicated-relay

Deployable **per-tenant dedicated relay** for Tier 3 / compliance customers. Customer gateways dial this isolated host instead of the global relay pool.

Composes [`modules/portal-relay-service`](../portal-relay-service/) (public ALB + private Fargate, digest pin, secrets injection) and adds:

| Concern | Contract |
|---------|----------|
| Per-tenant hostname | `relay-<slug>.[env.]withlanyard.com` or `relay_hostname_override` |
| Customer WSS URL | `wss://<relay_hostname>` → `customer-gateway-relay` / provision |
| Optional DNS | Route53 alias A → dedicated ALB (`create_dns_record` + `route53_zone_id`) |
| Optional WAF | Associate existing WAFv2 Web ACL (`web_acl_arn`) — no rule authoring |
| Secrets | Same generic `secrets` map as portal-relay-service (SM/SSM `value_from`) |
| TLS | `enable_https` + `acm_certificate_arn` (prefer `modules/portal-dns-tls` regional cert) |

| Fact | Value |
|------|--------|
| Creates AWS resources | **Yes** (via composed portal-relay-service + optional DNS/WAF) |
| Production-ready dedicated relay | **No** — **infra_ready** until operator staging apply + G2 evidence |
| Readiness matrix | `references/readiness-matrix.md` → Tier 3 **infra_ready** |
| Honesty outputs | `module_status=infra_ready`, `production_ready=false`, `creates_aws_resources=true` |

**Customer wiring:** `modules/customer-gateway-relay/` — set `relay_wss_url` from control-plane provision output (or this module’s `relay_wss_url` when ops aligns names first).

> **Fail-closed:** Do **not** claim Tier 3 dedicated relay is production-complete from module presence alone. Production relay/control-plane **security** remains gated on G1/G2 (`references/readiness-matrix.md`). G6 scale-out still requires `acknowledge_g6_scale_beyond_one`. Not auto-applied from git examples.

## Fail-closed variables

| Variable | Default | Behavior |
|----------|---------|----------|
| `acknowledge_not_auto_applied` | `false` | Must be `true` to plan/apply. Confirms infra_ready, not auto-applied. |
| `claim_production_ready` | `false` | Must stay `false`; validation + check reject `true`. |
| `image_digest` | (required) | Full `sha256:` + 64 hex pin (never tag/latest alone). |
| `desired_count > 1` | n/a | Requires `acknowledge_g6_scale_beyond_one=true` (G6 product gate). |

## SOW language (Tier 3)

- **Dedicated relay endpoint:** Customer gateway traffic terminates on an isolated Lanyard relay host (`wss://relay-<tenant_slug>.withlanyard.com` or ops-assigned hostname). Traffic is not co-mingled with standard Tier 1/2 tenants on the global relay pool.
- **Portal unchanged:** Users still reach `https://app.withlanyard.com/<tenant_slug>`; only the **gateway outbound dial target** differs.
- **Egress tightening:** Customer EC2 security groups may restrict HTTPS egress to the published dedicated relay IP/CNAME.

## Control plane routing

1. Ops sets tenant `relay_tier` to `dedicated` (internal API).
2. Apply this module (private operator root) with real VPC/subnets + digest pin + secrets ARNs.
3. Optional: enable HTTPS with ACM covering the dedicated hostname; create DNS alias or use `modules/portal-dns-tls`.
4. Provision returns tenant-specific relay host for customer Terraform.
5. Apply `modules/customer-gateway-relay` with `relay_wss_url` from provision output (or `module.tier3.relay_wss_url`).

## Composition example (operator private root)

```hcl
module "tier3_relay" {
  source = "../../modules/tier3-dedicated-relay"

  tenant_slug  = "compliance-co"
  environment  = "staging"

  vpc_id             = module.platform_vpc.vpc_id
  public_subnet_ids  = module.platform_vpc.public_subnet_ids
  private_subnet_ids = module.platform_vpc.private_subnet_ids

  image_repository = module.product_artifacts.ecr_repository_urls["relay"]
  image_digest     = var.relay_image_digest # real sha256 pin

  enable_https        = true
  acm_certificate_arn = module.portal_dns_tls.regional_certificate_arn

  create_dns_record = true
  route53_zone_id   = var.route53_zone_id

  # web_acl_arn = var.tier3_web_acl_arn  # optional existing WAFv2 ACL

  secrets = {
    RELAY_INTERNAL_TOKEN = {
      value_from = "arn:aws:ssm:us-east-1:000000000000:parameter/lanyard/staging/portal/relay-internal-token"
    }
  }

  acknowledge_not_auto_applied = true
  # claim_production_ready = false  # required
}

# Customer host wiring (separate tenant root):
# module "gateway" {
#   source        = "../../modules/customer-gateway-relay"
#   relay_wss_url = module.tier3_relay.relay_wss_url
#   ...
# }
```

`environments/platform-staging` does **not** compose Tier 3 dedicated relays — per-tenant operator private root only (shared pool relay remains in platform-staging).

## Module outputs

| Output | Purpose |
|--------|---------|
| `relay_wss_url` | Customer `GATEWAY_RELAY_URL` / Terraform `relay_wss_url` |
| `relay_hostname` | DNS target name for dedicated pool |
| `alb_dns_name` / `alb_arn` / `alb_zone_id` | Edge handles for DNS/WAF / portal-dns-tls |
| `task_security_group_id` | Private task SG (Valkey / CP ingress wiring) |
| `image_pin` | repository + digest deploy authority |
| `secret_names` | Injected env names only (never values) |
| `module_status` | Honesty object (`infra_ready`, `production_ready=false`) |
| `production_ready` | Always `false` |
| `creates_aws_resources` | Always `true` |
| `readiness_status` | `infra_ready` |

## Validate

```bash
cd modules/tier3-dedicated-relay
terraform init -backend=false -input=false && terraform validate
bash scripts/smoke-tier3-dedicated-relay.sh
bash scripts/policy-as-code-security.sh
bash scripts/validate-production-gates.sh
```

## Related

- Shared pool (Tier 1/2): `modules/portal-relay-service/`, `wss://relay.withlanyard.com`
- Customer wiring: `modules/customer-gateway-relay/`
- DNS/TLS helper: `modules/portal-dns-tls/`
- Secrets lifecycle: `references/runbooks/relay-secret-lifecycle.md`
- Tier 3 apply runbook: `references/runbooks/tier3-dedicated-relay-apply.md`
- Readiness: `references/readiness-matrix.md` (Tier 3 **infra_ready**)
- Migration phases: `references/migration-phases.md`
