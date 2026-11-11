# portal-waf

Reusable Terraform module for **baseline AWS WAFv2** protections on Portal public edges:

| Resource | Scope | Region | Attaches to |
|----------|-------|--------|-------------|
| WebACL (CloudFront) | `CLOUDFRONT` | **us-east-1** | `portal-static-edge.web_acl_id` |
| WebACL (regional) | `REGIONAL` | default provider | Public BFF + relay ALBs via `aws_wafv2_web_acl_association` |

## Baseline rules

| Rule | Default | Action |
|------|---------|--------|
| `AWSManagedRulesCommonRuleSet` | on | enforce (`override_action = none`) |
| `AWSManagedRulesKnownBadInputsRuleSet` | on | enforce |
| Rate-based per IP | on (`rate_limit=2000` / 5 min) | block |
| Default action | `allow` | managed rules handle blocks |

Optional: set `managed_rule_override_action = "count"` for observe-only rollout, or `enable_rate_based_rule = false`.

## Status

| Claim | Truth |
|-------|--------|
| Module is real Terraform | **Yes** — validates with dual provider (`aws` + `aws.us_east_1`) |
| Applied from git/CI examples | **No** — operator-owned private roots only |
| Example tfvars apply-ready | **No** — placeholders / optional enable in platform-staging |
| Production WAF certified | **No** until staging apply + metric review |

Readiness: **infra_ready** (not production certified). See `references/runbooks/portal-compute-staging-apply.md`.

## Provider aliases (required)

CloudFront-scope WebACLs **must** live in **us-east-1**. Callers must pass:

```hcl
provider "aws" {
  region = var.region
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

module "portal_waf" {
  source = "../../modules/portal-waf"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name_prefix = "lanyard-portal-staging"
  environment = "staging"

  enable_cloudfront_web_acl = true
  enable_regional_web_acl   = true

  # Associate after public ALBs exist (never control-plane ALB):
  associate_alb_arns = [
    module.portal_bff.alb_arn,
    module.portal_relay.alb_arn,
  ]

  acknowledge_not_auto_applied = true
}

module "portal_static_edge" {
  source = "../../modules/portal-static-edge"
  # ...
  web_acl_id = module.portal_waf.cloudfront_web_acl_arn
}
```

## Wire into platform-staging

`environments/platform-staging` can enable this layer with `enable_portal_waf=true` (default **false** so offline examples stay placeholder-safe). When enabled:

- Creates CloudFront + regional WebACLs
- Associates regional ACL to BFF/relay ALB ARNs when those layers are on
- Passes `cloudfront_web_acl_arn` into `portal-static-edge.web_acl_id`

## Fail-closed / honesty

- `acknowledge_not_auto_applied=true` required
- CloudFront WebACL only in us-east-1 via `aws.us_east_1`
- Associations only for application load balancer ARNs (no inventing account IDs in examples)
- **Never** attach to the internal control-plane ALB
- No secrets or live account IDs in examples

## Validate (no credentials)

`configuration_aliases = [aws.us_east_1]` requires a **parent** root that passes both providers. Do not expect `terraform validate` inside the module directory alone.

```bash
bash scripts/smoke-portal-waf.sh
# (creates a temporary dual-provider wrapper, init -backend=false, validate)
```

Offline smoke: `scripts/smoke-portal-waf.sh` (also run from CI).
