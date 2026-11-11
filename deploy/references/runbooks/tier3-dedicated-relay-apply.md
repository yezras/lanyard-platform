# Tier 3 dedicated relay — operator apply runbook

**Status:** module **infra_ready**; live apply is **operator-owned**.  
**Not** production-certified from module presence or this runbook alone. G2 relay credential lifecycle and staging proof remain separate gates (`references/readiness-matrix.md`).

Module: `modules/tier3-dedicated-relay/`  
Compose: `modules/portal-relay-service/` (public ALB + private Fargate, digest pin, secrets map)  
Offline smoke: `bash scripts/smoke-tier3-dedicated-relay.sh`

---

## When to use

| Tenant class | Relay |
|--------------|--------|
| Tier 1 / 2 (standard) | Shared pool: platform `portal-relay-service` / `wss://relay.withlanyard.com` |
| Tier 3 (compliance / isolation SOW) | **This module** — per-tenant ALB/ECS + hostname (`wss://relay-<slug>…`) |

Portal path stays `https://app.withlanyard.com/<tenant_slug>`; only the **gateway outbound dial target** differs.

---

## Preconditions

1. Platform VPC (or equivalent) with **≥2 public** and **≥2 private** subnets; NAT or endpoints so Fargate can pull ECR without `assign_public_ip=true`.
2. Portal **relay** image published to ECR; operator holds real **repository + sha256 digest** pin (never `:latest`).
3. Relay secrets material exist in SSM/SM (names only in docs): e.g. `RELAY_INTERNAL_TOKEN`; optional `REDIS_URL` from `modules/portal-valkey` when G6 bus is intended.
4. Control plane can set tenant `relay_tier=dedicated` and return the dedicated WSS URL at provision.
5. Optional: ACM cert covering the dedicated hostname (`modules/portal-dns-tls` regional cert or existing ARN); Route53 zone for alias; existing WAFv2 Web ACL ARN if required by SOW.

Do **not** commit live account IDs, zone IDs, or secret values. Private operator root only.

---

## Apply order (per compliance tenant)

```text
1. Confirm pins + secrets ARNs in private tfvars (copy from terraform.tfvars.example shape)
2. terraform init (private backend; never commit state)
3. terraform plan  -var-file=…  # review ALB public edge + private tasks
4. terraform apply
5. Optional: enable_https + create_dns_record (or wire portal-dns-tls externally)
6. Optional: set web_acl_arn for WAFv2 association
7. Control plane: relay_tier=dedicated; provision returns relay_wss_url
8. Customer root: modules/customer-gateway-relay with relay_wss_url = module output / provision
9. Smoke: customer host dials wss://… ; /health on ALB; logs in CloudWatch
```

### Minimal module block (private root)

```hcl
module "tier3_relay" {
  source = "../../modules/tier3-dedicated-relay"

  tenant_slug  = var.tenant_slug
  environment  = "staging" # or prod

  vpc_id             = var.vpc_id
  public_subnet_ids  = var.public_subnet_ids
  private_subnet_ids = var.private_subnet_ids

  image_repository = var.relay_image_repository
  image_digest     = var.relay_image_digest

  enable_https        = true
  acm_certificate_arn = var.regional_acm_certificate_arn
  create_dns_record   = true
  route53_zone_id     = var.route53_zone_id
  # web_acl_arn       = var.tier3_web_acl_arn

  secrets = {
    RELAY_INTERNAL_TOKEN = { value_from = var.relay_internal_token_ssm_arn }
  }

  acknowledge_not_auto_applied = true
  # claim_production_ready = false  # required
}
```

Outputs of record for customer wiring:

| Output | Use |
|--------|-----|
| `relay_wss_url` | `customer-gateway-relay.relay_wss_url` / provision |
| `relay_hostname` | DNS / SOW |
| `alb_dns_name` / `alb_zone_id` | External DNS if not using `create_dns_record` |
| `task_security_group_id` | Valkey / internal path rules |

---

## Honesty / non-claims

| May claim after successful apply | Must not claim |
|----------------------------------|----------------|
| Dedicated ALB/ECS exist for this tenant | Production Portal/relay **security** ready (G1/G2) |
| Customer dials isolated hostname | G6 multi-relay bus proven |
| Module is **infra_ready** | Matrix **ready** / production-certified Tier 3 from examples alone |

`claim_production_ready` is hard-false in Terraform. Staging revoke/register E2E remains operator + product evidence before production security sign-off.

---

## Rollback

1. Customer: point `relay_wss_url` back to shared pool (if SOW allows) or freeze dials.
2. `terraform destroy` on the Tier 3 root (or scale `desired_count=0` first).
3. Remove/disable control-plane `relay_tier=dedicated` mapping.
4. DNS: remove alias or TTL-wait before ALB deletion.

---

## Validation (offline)

```bash
bash scripts/smoke-tier3-dedicated-relay.sh
bash scripts/policy-as-code-security.sh
bash scripts/validate-production-gates.sh
cd modules/tier3-dedicated-relay && terraform init -backend=false && terraform validate
```

## Related

- Module README: `modules/tier3-dedicated-relay/README.md`
- Shared relay: `modules/portal-relay-service/`, `references/runbooks/portal-compute-staging-apply.md`
- Secrets: `references/runbooks/relay-secret-lifecycle.md`
- Customer wiring: `modules/customer-gateway-relay/`
- Readiness: `references/readiness-matrix.md`
