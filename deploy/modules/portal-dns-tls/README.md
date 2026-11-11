# portal-dns-tls

Reusable Terraform module for **Route53 aliases** and **ACM certificates** that front Portal static edge (CloudFront) and public BFF/relay ALBs.

| Resource | Purpose |
|----------|---------|
| Optional public hosted zone | Create only when no existing zone; prefer `route53_zone_id` to avoid duplicates |
| ACM cert (us-east-1) | CloudFront viewer certificate for `portal_web_hostname` |
| ACM cert (regional) | Shared SAN cert for `bff_hostname`, `relay_hostname`, and/or `document_server_hostname` ALB HTTPS |
| DNS validation records | Route53 CNAMEs for ACM validation when this module issues certs |
| Alias A/AAAA | `portal_web` → CloudFront; `bff` / `relay` → ALBs (Docs alias owned by platform-staging) |

## Status

| Claim | Truth |
|-------|--------|
| Module is real Terraform | **Yes** — validates with dual provider (`aws` + `aws.us_east_1`) |
| Applied from git/CI examples | **No** — operator-owned private roots only |
| Example tfvars apply-ready | **No** — placeholders / optional enable in platform-staging |
| Production DNS/TLS certified | **No** until staging apply evidence + owned zone |

Readiness: **infra_ready** (not production certified). See `references/runbooks/portal-compute-staging-apply.md`.

## Provider aliases (required)

CloudFront ACM certificates **must** live in **us-east-1**. Callers must pass:

```hcl
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

  name_prefix          = "lanyard-portal-staging"
  portal_web_hostname      = "app.example.com"
  bff_hostname             = "api.example.com"
  relay_hostname           = "relay.example.com"
  document_server_hostname = "docs.staging.example.com" # lp-zuh.12.2 regional SAN for Docs ALB HTTPS
  route53_zone_id          = "ZXXXXXXXXXXXX" # existing zone — preferred
  create_route53_zone      = false

  # After compute exists (or second apply):
  cloudfront_domain_name     = module.portal_static_edge.cloudfront_domain_name
  cloudfront_hosted_zone_id  = module.portal_static_edge.cloudfront_hosted_zone_id
  bff_alb_dns_name           = module.portal_bff.alb_dns_name
  bff_alb_zone_id            = module.portal_bff.alb_zone_id
  relay_alb_dns_name         = module.portal_relay.alb_dns_name
  relay_alb_zone_id          = module.portal_relay.alb_zone_id

  acknowledge_not_auto_applied = true
}
```

## Consume existing zone / certs (no duplicates)

| Goal | Inputs |
|------|--------|
| Use existing hosted zone | `create_route53_zone=false`, set `route53_zone_id` |
| Create zone once | `create_route53_zone=true`, set `route53_zone_name` (avoid if zone already exists) |
| Use existing CloudFront cert | `existing_cloudfront_certificate_arn` (must be **us-east-1**) |
| Use existing regional cert | `existing_regional_certificate_arn` (same region as ALBs) |
| Certs only (no aliases yet) | Leave alias targets empty; still issues validated certs when hostnames + zone set |
| Aliases only | Pass existing cert ARNs + hostnames + targets |

## Wire into Portal compute

| Output / value | Consumer |
|----------------|----------|
| `cloudfront_certificate_arn` + `[portal_web_hostname]` | `portal-static-edge.acm_certificate_arn` + `aliases` |
| `regional_certificate_arn` | `portal-bff-service`, `portal-relay-service`, and `staging-document-server` `acm_certificate_arn` |
| set `enable_https = true` | BFF + relay + Docs when regional cert ARN is non-null and Docs hostname is set |

`environments/platform-staging` can enable this layer with `enable_portal_dns_tls=true` and auto-wires certs into static edge / BFF / relay / Docs when hostnames are set. Pass `document_server_public_hostname` so the Docs name is a regional SAN before enabling Docs ALB HTTPS (`lp-zuh.12.2`).

## TLS posture (HTTP→HTTPS / no insecure websockets)

| Control | Where enforced |
|---------|----------------|
| CloudFront `viewer_protocol_policy = redirect-to-https` | `modules/portal-static-edge` |
| ALB HTTP listener → HTTPS 301 when `enable_https=true` | `modules/portal-bff-service`, `modules/portal-relay-service` |
| Relay client URL scheme **wss://** only | customer-gateway-relay + pin/URL validators reject `ws://` / `http://` |
| Hostname inputs reject schemes | This module variable validations |

This module documents the posture in `tls_posture` / `consumer_wiring` outputs and supplies the certificates that make HTTPS listeners possible. It does not terminate application traffic itself.

## Fail-closed / honesty

- `acknowledge_not_auto_applied=true` required
- CloudFront existing cert ARN must be `us-east-1`
- Hostnames are bare FQDNs (no `https://`, `http://`, `wss://`, `ws://`)
- Prefer existing zone and existing certs to avoid duplicate Route53 zones / ACM certs
- No secrets, private keys, or live account IDs in examples

## Validate (no credentials)

`configuration_aliases = [aws.us_east_1]` requires a **parent** root that passes both providers. Do not expect `terraform validate` inside the module directory alone.

```bash
bash scripts/smoke-portal-dns-tls.sh
# (creates a temporary dual-provider wrapper, init -backend=false, validate)
```

Offline smoke: `scripts/smoke-portal-dns-tls.sh` (also run from CI).
