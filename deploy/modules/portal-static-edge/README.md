# portal-static-edge

Reusable Terraform module for the Portal **static web edge** (and optional dual API hop to BFF):

| Resource | Purpose |
|----------|---------|
| Private S3 origin | Versioned, encrypted, public-access blocked |
| CloudFront OAC | SigV4-only origin access (no public bucket) |
| CloudFront distribution | HTTPS edge for path-first SPA (`/<tenant_slug>`) |
| Optional BFF custom origin | Routes **both** `/*/api/*` and bare `/api/*` to BFF ALB (not S3) |
| Bucket policy | CloudFront GetObject + SecureTransport deny |

## Status

| Claim | Truth |
|-------|--------|
| Module is real Terraform | **Yes** — validates with `terraform init -backend=false && terraform validate` |
| Applied in platform staging from this repo | **No** — operator-owned private root |
| Production Portal edge | Still needs G7 published pins + staging evidence; G8 is **infra_ready** not production-certified |

Readiness: **infra_ready** until an operator applies, syncs a pinned static artifact, and records staging evidence. See `references/readiness-matrix.md` and `references/runbooks/portal-compute-staging-apply.md`.

## Fail-closed posture

- S3 origin is **never public** (`block_public_*` all true; OAC-only read).
- TLS-only bucket policy (`aws:SecureTransport` deny).
- Static artifact URL rejects `http://` / `ws://` when provided.
- Artifact version rejects floating git refs (`main` / `master` / `HEAD` / `latest`).
- BFF origin protocol rejects `http-only`.
- `acknowledge_not_auto_applied=true` required.
- BFF origin is **optional**: empty `bff_origin_domain_name` omits BFF origin and **both** API ordered behaviors so examples still validate without live ALB DNS.

### Content-Security-Policy (ONLYOFFICE — lp-p37.3)

When enabling browser DocsAPI, attach a CSP so `script-src` / `frame-src` / `connect-src` only allow **approved Document Server origins** (HTTPS). Two operator knobs:

| Variable | Effect |
|----------|--------|
| `content_security_policy` | Full CSP string (preferred when product already has a CSP) |
| `onlyoffice_document_server_origins` | List of `https://host[:port]` origins; module synthesizes a baseline CSP when `content_security_policy` is empty |

Empty both → no response headers policy (backward compatible). When either is set, a CloudFront response headers policy is attached to the SPA default behavior and `/assets/*`.

Web app build must use the **same** origins via `VITE_ONLYOFFICE_DS_URL` / `VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS`. Production builds reject query-string DS URL overrides.

## Path-first topology (G0) + dual API behaviors

- Canonical entry: `https://app.withlanyard.com/<tenant_slug>`
- Ops console: `https://app.withlanyard.com/admin` is the same `@lanyard/web` tarball. CloudFront ordered behavior `/admin*` targets S3 (never BFF). Admin APIs are bare `/api/admin/*` (existing `/api/*` → BFF). `admin` is a reserved slug, not a tenant. `/_platform` is an S3 vault prefix, not a CloudFront path. See [dual-auth-credential-planes.md](../../../docs/architecture/dual-auth-credential-planes.md).
- SPA error routing (optional) maps origin 403/404 → `index.html` so client routes work.
- **API:** set `bff_origin_domain_name` to the BFF ALB DNS name. CloudFront then adds:
  - Custom origin `portal-bff` (HTTPS to ALB; protocol policy configurable)
  - **Two** ordered cache behaviors (both above `/assets/*`, both → **BFF only**, never S3):
    | Pattern var | Default | Use |
    |-------------|---------|-----|
    | `api_path_pattern` | `/*/api/*` | Path-first tenant/platform APIs under `/<tenant_slug>/api/*` |
    | `bare_api_path_pattern` | `/api/*` | Apex public discovery without a tenant segment (e.g. `POST /api/public/tenants/resolve`) |
  - Managed **CachingDisabled** cache policy (no cross-user/tenant API cache)
  - Managed **AllViewerExceptHostHeader** origin request policy (cookies, query strings, Authorization/CSRF headers forwarded; Host set to origin domain)
  - Allowed methods: `DELETE`, `GET`, `HEAD`, `OPTIONS`, `PATCH`, `POST`, `PUT`
  - Full path preserved (tenant slug not stripped on path-first)
- **Do not** replace path-first with bare-only — that would break `/<tenant_slug>/api/*` tenant APIs.
- Control plane must never attach to a public ALB (see `modules/portal-control-plane-service`).

Without the bare `/api/*` behavior, apex discovery falls through to the S3 SPA default and returns HTML instead of BFF JSON (blocks portal org-finder staging proof).

### SPA custom errors vs API (operator risk)

Distribution-level `custom_error_response` (403/404 → SPA `index.html` with response code 200 when `enable_spa_error_routing = true`) is **distribution-wide**. A BFF **404** (e.g. unknown org on resolve) or **403** can be rewritten to SPA HTML, so clients see `text/html` instead of JSON.

| Risk | Mitigation |
|------|------------|
| BFF 404/403 HTML-mapped | Prefer BFF auth/API errors as `401`/`422`/etc. where product allows |
| Unknown-org / missing route checks | After apply, **verify Content-Type is JSON** (or at least not SPA HTML) for unknown-org curls — see runbook verify curls |
| Long-term SPA deep links | Set `enable_spa_error_routing = false` once edge functions or other SPA routing land |

Operators should treat a 200 HTML body on an API path as a **routing/SPA-map failure**, not a successful BFF response.

**OnlyOffice mint (`lp-zuh.10.3`):** `POST /<tenant>/api/office/sessions` returning SPA HTML was observed when BFF answered **404** `missing_file` (no vault docx). Prefer BFF **422** for missing Office files so mint JSON is not rewritten. Verify after apply:

```bash
# Expect application/json (401/422/4xx/201) — never SPA index.html for authed mint
curl -sS -D- -o /tmp/oo-mint.body -X POST "https://${HOST}/${TENANT:-mocklab}/api/office/sessions" \
  -H 'content-type: application/json' -H "cookie: …" -H "x-csrf-token: …" \
  -d '{"path":"/workflows/probe.docx","mode":"view"}'
```

## Pin contract

| Pin field | Variable |
|-----------|----------|
| `portal.web.url` | `static_web_artifact_url` |
| `portal.web.version` | `static_web_artifact_version` |
| `portal.web.sha256` | `static_web_artifact_sha256` |

The module **does not** download or extract the artifact at apply time. Operators verify SHA-256 and sync objects into the origin bucket (runbook).

## BFF wiring (operator)

```hcl
module "portal_static" {
  source                       = "../../modules/portal-static-edge"
  name_prefix                  = "lanyard-portal-staging"
  origin_bucket_name           = var.origin_bucket_name
  bff_origin_domain_name       = module.portal_bff.alb_dns_name # private root
  acknowledge_not_auto_applied = true
  # Dual defaults (override only if product path layout changes):
  # api_path_pattern      = "/*/api/*"   # path-first
  # bare_api_path_pattern = "/api/*"     # apex public discovery
}
```

Leave `bff_origin_domain_name = ""` for static-only plans (examples / empty origin bootstrap). Staging compose (`environments/platform-staging`) keeps the dual defaults; no required tfvars change for bare `/api/*`.

### Staging verify curls (after operator apply)

Replace `HOST` with the portal web hostname (e.g. staging CloudFront alias or `app.withlanyard.com`). Expect **BFF JSON** (or BFF error shape), **not** SPA `index.html`.

```bash
HOST="${HOST:-app.withlanyard.com}"

# 1) Bare /api/* — apex public discovery (must NOT fall through to S3 SPA)
curl -sS -D- -o /tmp/bare-resolve.body -X POST "https://${HOST}/api/public/tenants/resolve" \
  -H 'content-type: application/json' \
  -d '{"query":"__unknown_org_for_edge_check__"}'
# Expect: JSON body (even 404/4xx from BFF). Fail if Content-Type is text/html
# or body starts with <!DOCTYPE / <html (SPA custom_error_response risk).

# 2) Path-first /*/api/* — tenant API still on BFF (health or unauthenticated probe)
curl -sS -D- -o /tmp/path-first.body \
  "https://${HOST}/demo/api/health"   # or a known staging tenant slug
# Expect: reaches BFF (JSON or BFF plain text), not CloudFront S3 403 XML / SPA HTML.

# 3) Optional: confirm SPA still serves for non-API paths
curl -sS -o /dev/null -w '%{http_code}\n' "https://${HOST}/demo"

# 4) Ops SPA /admin (same tarball, S3). Must be HTML, not BFF JSON.
curl -sS -D- -o /tmp/admin-spa.body "https://${HOST}/admin"
# Expect: 200 text/html (SPA index). Fail if application/json from BFF.

# 5) Ops API /api/admin (BFF). Must not be SPA HTML.
curl -sS -D- -o /tmp/admin-api.body "https://${HOST}/api/admin/auth/me"
# Expect: JSON (401 without ops cookie). Fail if Content-Type is text/html.
```

Full post-apply checklist: `references/runbooks/portal-compute-staging-apply.md`.  
Ship handoff (private apply + **CloudFront deploy wait** + honesty): `references/runbooks/portal-bare-api-edge-routing.md` (**lp-b87**). Live staging is not fixed until that procedure is green.

## Validate (no credentials / no apply)

```bash
cd modules/portal-static-edge
terraform init -backend=false -input=false
terraform validate
```

Offline smoke (repo root):

```bash
bash scripts/smoke-portal-compute.sh
```

## What this does **not** do

| Non-goal | Why |
|----------|-----|
| Publish `@lanyard/web` | Product release workflows (G7) |
| Public S3 website hosting | OAC private origin only |
| Deploy BFF/control-plane compute | Separate service modules (`portal-bff-service`, …) |
| Auto-apply from CI examples | Operator-owned |
| Strip `/<tenant_slug>` before BFF | Path-first product semantics preserve the slug |
| Replace path-first with bare-only `/api/*` | Would break `/<tenant_slug>/api/*` tenant APIs |

## Files

See [INDEX.md](./INDEX.md).
