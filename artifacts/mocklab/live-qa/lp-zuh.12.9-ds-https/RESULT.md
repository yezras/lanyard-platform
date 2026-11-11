# lp-zuh.12.9 — DocsAPI iframe HTTPS Document Server edge (CloudFront)

**Bead:** `lp-zuh.12.9`  
**Parent epic:** `lp-zuh.12` — OnlyOffice MockLab/staging editor GO  
**When (UTC):** 2026-08-19  
**Verdict:** **`HTTPS_GO`** (health + `api.js` over HTTPS) — full Playwright DocsAPI iframe is **`lp-zuh.13.2`** (not claimed here)

No secrets in this package (no JWT, passwords, CSRF, session tokens, SM values).

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Staging DS browser-reachable over **HTTPS** (ALB 443+ACM and/or CloudFront / docs hostname) | **GO** — CloudFront Option B: `https://d3sqcebajd6ueb.cloudfront.net` → HTTP Docs ALB. Custom `docs.*` ACM/Route53 still unavailable (Squarespace DNS). |
| 2 | `GET https://<docs-origin>/healthcheck` and `/web-apps/apps/api/documents/api.js` → 200 | **GO** — health **200**; api.js **200**, 65363 bytes, `application/javascript` |
| 3 | Update MockLab web pin `VITE_ONLYOFFICE_DS_URL` + allowlist and `BFF_OFFICE_DOCUMENT_SERVER_HOSTS` | **GO** — pin `v0.1.9-mocklab-oo-zuh129-20260819` promoted; BFF task def `:35` allowlist `cf-domain,alb-dns` |
| 4 | Evidence package (curl proofs, no JWT secrets) | This directory |
| 5 | Live apply smallest change; do not tear down unrelated staging | **GO** — new CF dist only + BFF env bump + SPA pin sync/invalidate |
| 6 | Prove HTTPS api.js works; full Playwright is lp-zuh.13.2 | **GO** for api.js; Playwright **not** claimed |

---

## Live edge

| Signal | Value |
|--------|-------|
| CloudFront ID | `E1OQ5SAD1WR60T` |
| HTTPS Docs origin | `https://d3sqcebajd6ueb.cloudfront.net` |
| Origin | `http://lanyard-platform-staging-docs-al-238458258.us-east-1.elb.amazonaws.com` (http-only) |
| Viewer cert | CloudFront default (`*.cloudfront.net`) |
| Cache / origin request | Managed-CachingDisabled + Managed-AllViewer |
| `GET https://…/healthcheck` | **200** |
| `GET https://…/web-apps/apps/api/documents/api.js` | **200** (65363 bytes) |
| Raw ALB `:443` | Still timeout (expected; CF is HTTPS edge) |
| `docs*.withlanyard.com` | NXDOMAIN (Squarespace; no Route53 zone in account) |

Re-run:

```bash
bash deploy/scripts/probe-staging-document-server-https.sh \
  --host d3sqcebajd6ueb.cloudfront.net --scheme https \
  --out artifacts/mocklab/live-qa/lp-zuh.12.9-ds-https/logs/curl-probe-cf-https.json
```

---

## Config notes (no secrets)

| Item | Value / action |
|------|----------------|
| BFF allowlist (live `:35`) | `d3sqcebajd6ueb.cloudfront.net,lanyard-platform-staging-docs-al-238458258.us-east-1.elb.amazonaws.com` |
| SPA pin | `v0.1.9-mocklab-oo-zuh129-20260819` / sha256 `c1a3d146a9d8e01a2dc14163071843c442ab0a5b3dbfc2bce798b2f4b5590e98` |
| `VITE_ONLYOFFICE_DS_URL` | `https://d3sqcebajd6ueb.cloudfront.net` |
| `VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS` | CF origin + `https://app.withlanyard.com` |
| App CF invalidation | `IDO3VOPNAL7Z0L2D4ILXLH0P5U` |
| TF | `document_server_enable_cloudfront_https` on module + platform-staging compose |
| TF import (operator private state) | `terraform import 'module.staging_document_server[0].aws_cloudfront_distribution.docs[0]' E1OQ5SAD1WR60T` |
| Private tfvars (not committed) | set `document_server_enable_cloudfront_https = true` before next apply |

---

## Repo changes

1. `staging-document-server`: optional `aws_cloudfront_distribution.docs` + outputs.
2. `platform-staging`: `document_server_enable_cloudfront_https` wiring + dual allowlist with CF domain.
3. Runbook §6 updated to **HTTPS_GO** (Option B live).
4. Probe default host → CF domain; smoke asserts CF contract.
5. `pack-web-mocklab-oo.env.example` + `pins.real-releases.yaml` pin bump.
6. This evidence package.

---

## Operator follow-ups (not blocking HTTPS api.js)

1. Import CF into platform-staging Terraform state (command above) and set private tfvars flag so future applies manage the edge.
2. Optional: bump private `static_web_artifact_*` to `v0.1.9-mocklab-oo-zuh129-20260819` (origin already synced live).
3. Optional later: Option A custom `docs.*` hostname when Squarespace/ACM available.
4. Full DocsAPI iframe Playwright: **`lp-zuh.13.2`**.

---

## Secret hygiene

- No passwords, JWT, CSRF, or session values.
- Probe records status codes / byte sizes / content-types only.
- BFF snapshot includes only `BFF_OFFICE_DOCUMENT_SERVER_HOSTS` (hostname allowlist).
