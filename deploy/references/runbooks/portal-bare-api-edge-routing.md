# Runbook: Bare `/api/*` → BFF on portal-static-edge (lp-b87)

**Status:** Monorepo module + docs **merged** (infra_ready). Live edge **not** fixed until an operator applies.  
**Epic:** [lp-b87](https://github.com/LanyardBrain/lanyard-platform) — Bare `/api/*` → BFF on portal-static-edge (unblock apex org finder)  
**SoT:** `lanyard-platform/deploy/` only — never the legacy `company-brain-deploy` checkout.  
**Module:** `modules/portal-static-edge`  
**Compose root:** `environments/platform-staging` (or private copy with real backend/tfvars)

## Honesty

| Claim | Truth |
|-------|--------|
| Module encodes dual CF API behaviors | **Yes** (on `main` via lp-b87.1–.3) |
| Offline `terraform validate` / portal-compute smoke | **Yes** (no credentials / no apply) |
| Auto-applied from CI or this PR | **No** — private operator roots only |
| Live staging (`app.withlanyard.com`) fixed | **No** until operator apply + CF deploy wait + verify curls |
| Portal product org-finder proof (`portal-8rk.12`) | **Blocked** until edge proof above is green |

Do **not** claim staging is fixed, or re-run product staging proof as pass, until the post-apply curls below return BFF JSON (not SPA HTML).

## Dual API path patterns (summary)

When `bff_origin_domain_name` is set, CloudFront has **two** ordered cache behaviors → same BFF origin (CachingDisabled + AllViewerExceptHostHeader; methods include POST):

| Pattern | Default var | Purpose |
|---------|-------------|---------|
| Path-first | `api_path_pattern` = `/*/api/*` | `/<tenant_slug>/api/*` tenant/platform APIs |
| Bare | `bare_api_path_pattern` = `/api/*` | Apex public discovery without a tenant segment (e.g. `POST /api/public/tenants/resolve`) |

Both sit **above** `/assets/*` and the SPA default. **Do not** replace path-first with bare-only — that would break tenant APIs.

Without bare `/api/*`, apex discovery falls through to the S3 SPA default and returns HTML instead of BFF JSON.

Related: full G8 apply ordering in [`portal-compute-staging-apply.md`](./portal-compute-staging-apply.md) §6; module README `modules/portal-static-edge/README.md`.

## Operator apply (private tfvars + CF deploy wait)

### Prerequisites

1. Private Terraform root based on `environments/platform-staging` (or private multi-root) with real backend, unique bucket names, and digest/static pins — **never** commit live tfvars/digests.
2. BFF ALB already applied so `bff_origin_domain_name` can be wired (compose does this when BFF is on).
3. Operator AWS credentials; module flag `acknowledge_not_auto_applied = true` (already true in compose wiring).

No required tfvars change for bare `/api/*` — module defaults already include both patterns after lp-b87.1. Plan should show a **second** CloudFront ordered behavior for `/api/*` if staging was applied before that change.

### Steps

```bash
# 1) From the private root (example: private copy of platform-staging)
cd /path/to/private/platform-staging   # NOT the public example alone
terraform init
terraform plan -out=tfplan
# Confirm: aws_cloudfront_distribution (or portal-static-edge) adds/keeps
#   ordered_cache_behavior path_pattern = "/api/*" → origin portal-bff
#   and preserves path_pattern = "/*/api/*"
terraform apply tfplan
```

```bash
# 2) Wait for CloudFront distribution deployment (apply returns before all
#    edge POPs finish; curls during InProgress can still hit old config).
DIST_ID="$(terraform output -raw portal_static_cloudfront_distribution_id 2>/dev/null \
  || terraform output -raw cloudfront_distribution_id)"
# Adjust output name to your private root's portal-static-edge outputs.

aws cloudfront wait distribution-deployed --id "$DIST_ID"
# Equivalent poll:
# aws cloudfront get-distribution --id "$DIST_ID" \
#   --query 'Distribution.Status' --output text
# Expect: Deployed (not InProgress)
```

```bash
# 3) Staging verify curls — expect BFF JSON/error shape, NOT SPA HTML
HOST="${HOST:-app.withlanyard.com}"

curl -sS -D- -o /tmp/bare-resolve.body -X POST \
  "https://${HOST}/api/public/tenants/resolve" \
  -H 'content-type: application/json' \
  -d '{"query":"__unknown_org_for_edge_check__"}'
# Fail if Content-Type is text/html or body starts with <!DOCTYPE / <html

curl -sS -D- -o /tmp/path-first.body \
  "https://${HOST}/demo/api/health"
# Expect BFF response (not S3 403 XML / SPA HTML)

curl -sS -o /dev/null -w '%{http_code}\n' "https://${HOST}/demo"
```

### After green curls (operator / Portal product — not this ship doc alone)

1. Record evidence (headers + truncated body, no secrets) in the epic/operator notes.
2. Re-run Portal staging proof **portal-8rk.12** (product beads).
3. Keep readiness matrix G8 as **infra_ready** until full staging evidence policy is satisfied.

## SPA custom_error_response risk

With `enable_spa_error_routing = true` (default), distribution-wide 403/404 → SPA `index.html` (200) can rewrite **BFF** 404/403 to HTML. Treat 200 HTML on an API path as a routing/SPA-map failure. Prefer product errors as `401`/`422` where allowed; verify Content-Type after apply.

## Offline checks (no apply)

```bash
cd modules/portal-static-edge
terraform init -backend=false -input=false
terraform validate

cd ../..   # deploy/
bash scripts/smoke-portal-compute.sh
bash scripts/smoke-platform-staging-compose.sh
```

## Monorepo landing (already on main)

| Bead | PR | Role |
|------|-----|------|
| lp-b87.1 | #120 | Second CF ordered behavior `/api/*` → BFF |
| lp-b87.3 | #121 | Offline validate / portal-static-edge smoke |
| lp-b87.2 | #122 | Dual-pattern docs + runbook §6 + verify curls |
| lp-b87.4 | this PR | Ship handoff: epic link, dual summary, operator apply + CF wait |

## Out of scope

- Live AWS apply from CI
- Claiming `app.withlanyard.com` is fixed without operator evidence
- Replacing `/*/api/*` with bare-only `/api/*`
- Portal SPA/BFF product code (already on main for org finder)
