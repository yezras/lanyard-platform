# Runbook: staging Document Server (`staging-platform-shared-ds`)

**Status:** Operator procedure — **infra_ready**, not auto-applied  
**Bead:** `lp-5q6.34`  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Topology:** `staging-platform-shared-ds` ([ADR 0006](../../../docs/adr/0006-document-server-topology-and-data-residency.md))  
**Module:** `deploy/modules/staging-document-server/`  
**Compose root:** `deploy/environments/platform-staging/` (`enable_staging_document_server`)  
**License track:** free Community image only ([decision-license-path](../../../docs/plans/0004-portal-onlyoffice-integration/decision-license-path.md))

**Honesty:** This runbook is not production Document Server enablement. It does not claim G8 certification or live staging apply from git examples. Production DS remains blocked by free-track license re-open + security gates + `prod-per-tenant-ds`.

Related:

| Doc / path | Use |
|------------|-----|
| [portal-document-server-topology.md](../../../docs/architecture/portal-document-server-topology.md) | Named topologies + staging residual |
| [lab-onlyoffice-document-server.md](lab-onlyoffice-document-server.md) | Lab compose (`lab-shared-compose-ds`) — not this stack |
| [staging-secrets-checklist.md](staging-secrets-checklist.md) | SM/SSM names; Office JWT ARN |
| [platform-staging-compose.md](platform-staging-compose.md) | Root apply order + rollback |
| Portal web | `onlyoffice_editor` feature flag (default off) — previews without DS |
| [operate-onlyoffice-document-server.md](operate-onlyoffice-document-server.md) | Day-2 start/stop/upgrade, JWT rotate, forgotten-file purge (`lp-5q6.36`) |

---

## 1. Topology match (acceptance)

| Requirement | Staging implementation |
|-------------|------------------------|
| Named topology | `staging-platform-shared-ds` |
| Deploy form | Public Docs ALB + Fargate ONLYOFFICE Community in **staging** VPC |
| Instances | One shared staging Document Server (desired_count default 1) |
| Audience | Staging tenants / dogfood only |
| Secrets | JWT (and optional license shell) in **AWS Secrets Manager** — never git |
| Browser → DS | ALB DNS or `document_server_public_hostname` Route53 alias |
| DS → BFF | Private tasks with egress; `BFF_OFFICE_PUBLIC_BASE_URL` must be absolute and reachable |
| Production vault | **Forbidden** on this stack |

---

## 2. Resources (planning)

| Resource | Pilot staging default | Notes |
|----------|----------------------|--------|
| CPU | 2048 (2 vCPU) | Raise if conversion OOMs |
| RAM | 4096 MiB | Module floor |
| Disk | Ephemeral task storage | Forgotten-file purge: task recycle + future `lp-5q6.36` |
| Network | Private subnets + NAT/endpoints | Image pull + outbound HTTPS to BFF |
| Edge | Public ALB `/healthcheck` | Optional HTTPS + ACM / DNS-TLS |

---

## 3. Secrets (never commit values)

| Name / env | Store | Consumer |
|------------|-------|----------|
| JWT secret | SM (module creates `…/portal/office-jwt` by default) | DS `JWT_SECRET`; BFF `BFF_OFFICE_JWT_SECRET` (same ARN) |
| Optional license | SM shell only if `create_license_secret_shell` | Free track: leave empty / disabled |
| SSM pointer | `/company-brain/<prefix>/portal-office-jwt-secret-arn` | ARN only |

**Rules:**

- Never put JWT or license material in `terraform.tfvars`, plain `environment_variables`, git, or logs.
- BFF module rejects `BFF_OFFICE_JWT_SECRET` / `JWT_SECRET` in plain env for staging/production-like labels.
- Rotate: full procedure in [operate-onlyoffice-document-server.md](operate-onlyoffice-document-server.md) §6 (SM `put-secret-value` → force-new-deployment on DS **and** BFF). Short form: update SM secret value → redeploy DS service + BFF service so tasks re-fetch the secret.

Checklist cross-link: [staging-secrets-checklist.md](staging-secrets-checklist.md) § Office / ONLYOFFICE.

---

## 4. Enable path (operator-owned apply)

Prerequisites:

1. Lab round-trip evidence acceptable (`lp-5q6.28`).
2. Security residual for **staging shared** DS accepted (`acknowledge_staging_shared_residual=true`).
3. Platform staging VPC + BFF already applied (or apply in same root).
4. Private image **digest** for `onlyoffice/documentserver` (not `:latest` alone).
5. A DS-reachable BFF base URL: set `bff_office_public_base_url` **or** `bff_hostname` with HTTPS.

Private `terraform.tfvars` (never commit):

```hcl
enable_staging_document_server        = true
acknowledge_staging_shared_residual   = true
document_server_image_digest          = "sha256:…"   # private pin
document_server_public_hostname       = "docs.staging.example.com"
document_server_enable_https          = true
# acm via document_server_acm_certificate_arn or portal-dns-tls regional cert
bff_office_public_base_url            = "https://bff.staging.example.com"
inject_office_jwt_into_bff            = true
inject_office_env_into_bff            = true
# Lab / MockLab writeback (lp-zuh.10.3): set true only for dogfood Office Edit.
# Production customer edit stays fail-closed (free-track license). Default omit/false.
# bff_environment_variables = { BFF_OFFICE_VAULT_EDIT = "true" }
```

```bash
cd deploy/environments/platform-staging
terraform init
terraform plan
# operator: terraform apply
```

Post-apply checks:

```bash
# Health (browser/edge)
curl -sf "https://<docs-host>/healthcheck"
# api.js (browser loader)
curl -sf "https://<docs-host>/web-apps/apps/api/documents/api.js" | head -c 200
echo
# Outputs (ARNs/DNS only)
terraform output document_server_alb_dns_name
terraform output document_server_jwt_secret_arn
terraform output bff_office_public_base_url
```

### Reachability matrix

| Path | How to verify |
|------|----------------|
| **Browser → Document Server** | Load `api.js` from Docs hostname; ALB target healthy |
| **Document Server → BFF download** | From a DS task or operator jump host: `curl -sfI "$BFF_OFFICE_PUBLIC_BASE_URL/health"` (Office download path requires session token in real flows) |
| **Document Server → BFF callback** | Same base URL; callback route under BFF Office API (`lp-5q6.23`) |
| **BFF JWT matches DS** | Same SM ARN injected as DS `JWT_SECRET` and BFF `BFF_OFFICE_JWT_SECRET` |

---

## 5. Health checks and smoke

| Check | Command / surface |
|-------|-------------------|
| Offline module + compose smoke | `bash deploy/scripts/smoke-staging-document-server.sh` |
| Platform compose smoke | `bash deploy/scripts/smoke-platform-staging-compose.sh` |
| ALB / container | Path `/healthcheck`, matcher `200`, long grace (~300s first boot) |
| Live api.js | `curl` Docs host as above (operator post-apply) |

---

## 6. MockLab HTTPS Document Server (`lp-zuh.12.2` / `lp-zuh.12.9`)

Production SPA rejects non-loopback `http://` Document Server origins (`https_required` in `onlyOfficeFeatureFlag.ts`). MockLab editor host therefore needs a **browser-reachable HTTPS Docs origin**.

### Live status (2026-08-19 — `lp-zuh.12.9`)

| Check | Result |
|-------|--------|
| HTTP `/healthcheck` + `api.js` on staging Docs ALB | **200** (always-on) |
| HTTPS via CloudFront → HTTP ALB | **GO** — `https://d3sqcebajd6ueb.cloudfront.net` (`E1OQ5SAD1WR60T`) |
| HTTPS `:443` on raw ALB DNS | Still no listener (expected; CF is the HTTPS edge) |
| Custom Docs hostname (`docs*.withlanyard.com`) | **Unresolved** (Squarespace DNS; no Route53 zone in staging account) |
| SPA pin | `v0.1.9-mocklab-oo-zuh129-20260819` — `VITE_ONLYOFFICE_DS_URL=https://d3sqcebajd6ueb.cloudfront.net` |
| BFF allowlist | `d3sqcebajd6ueb.cloudfront.net,<alb-dns>` (task def `:35`) |
| Full DocsAPI iframe / Playwright | **PASS** (`lp-zuh.13.2`) — see `artifacts/mocklab/live-qa/lp-zuh.13.2-docsapi-iframe/` |

Evidence (no secrets): [`artifacts/mocklab/live-qa/lp-zuh.12.9-ds-https/`](../../../artifacts/mocklab/live-qa/lp-zuh.12.9-ds-https/) (prior residual: [`lp-zuh.12.2-ds-https/`](../../../artifacts/mocklab/live-qa/lp-zuh.12.2-ds-https/)).

Current BFF allowlist hosts (callback URL host, no scheme):

```text
BFF_OFFICE_DOCUMENT_SERVER_HOSTS=d3sqcebajd6ueb.cloudfront.net,lanyard-platform-staging-docs-al-238458258.us-east-1.elb.amazonaws.com
```

### Option B enable path (live MockLab — CloudFront HTTPS→HTTP ALB)

Use when Route53/ACM for a custom `docs.*` hostname is blocked (staging uses Squarespace CNAMEs; `enable_portal_dns_tls=false`).

1. Private `terraform.tfvars` (never commit secrets / live digests):

```hcl
enable_staging_document_server          = true
acknowledge_staging_shared_residual     = true
document_server_enable_cloudfront_https = true
inject_office_env_into_bff              = true
```

2. If the distribution already exists (bootstrap CLI / prior apply), import before plan:

```bash
cd deploy/environments/platform-staging
terraform import 'module.staging_document_server[0].aws_cloudfront_distribution.docs[0]' E1OQ5SAD1WR60T
```

3. Apply. Compose injects `BFF_OFFICE_DOCUMENT_SERVER_HOSTS=<cf-domain>,<alb-dns>`.
4. Verify (no JWT / session secrets):

```bash
bash deploy/scripts/probe-staging-document-server-https.sh \
  --host d3sqcebajd6ueb.cloudfront.net --scheme https
# Expect: HTTPS /healthcheck 200 and api.js 200
```

5. SPA bake + promote: `portal/scripts/pack-web-mocklab-oo.env.example` → `VITE_ONLYOFFICE_DS_URL=https://<cf-domain>` (+ allowlist). Edge CSP when enabled: `onlyoffice_document_server_origins=["https://<cf-domain>"]`.

### Option A enable path (custom hostname + Docs ALB :443)

1. Choose a Docs hostname you control, e.g. `docs.staging.withlanyard.com` (requires DNS you can update — not available via Route53 in this staging account today).
2. Ensure regional ACM covers that name:
   - Prefer `enable_portal_dns_tls=true` with `document_server_public_hostname` set — compose passes it into `portal-dns-tls.document_server_hostname` so it is a **regional SAN**.
   - Or pass a dedicated `document_server_acm_certificate_arn` that already includes the Docs hostname.
3. Private `terraform.tfvars`:

```hcl
enable_staging_document_server      = true
acknowledge_staging_shared_residual = true
document_server_public_hostname     = "docs.staging.withlanyard.com"
document_server_enable_https        = true
# document_server_acm_certificate_arn = "arn:aws:acm:…"  # if not reusing dns-tls regional
enable_portal_dns_tls               = true
dns_create_alias_records            = true
inject_office_env_into_bff          = true
```

4. Apply → Docs ALB `:443`, Route53 alias when DNS/TLS on, dual BFF allowlist.
5. Probe + SPA bake against `https://<docs-host>`.

### Alternatives summary

| Option | When to use | Notes |
|--------|-------------|--------|
| **A. Docs ALB + ACM** | Staging has Route53 + regional ACM for docs host | Preferred long-term custom hostname |
| **B. CloudFront HTTPS → HTTP Docs ALB** | No docs.* ACM / Squarespace DNS | **Live MockLab path (`lp-zuh.12.9`)** |
| **C. Lab tunnel / localhost exception** | Dev-only browser on loopback | SPA allows `http://127.0.0.1` / localhost only when `allowLocalhost`; **not** a MockLab `app.withlanyard.com` GO |

### Honesty

- HTTPS health + `api.js` **200** on public CF origin: **GO** (`lp-zuh.12.9`)
- DocsAPI iframe Playwright mount: **PASS** (`lp-zuh.13.2`)
- Document body / no mixed-content `http://…/cache/files`: **PASS** (`lp-zuh.13.3`) — live CF uses origin request policy **Managed-AllViewerAndCloudFrontHeaders-2022-06** so OnlyOffice nginx sees `CloudFront-Forwarded-Proto: https` and emits `https://` cache URLs. Do **not** rely on CF origin custom_header `X-Forwarded-Proto` alone (CloudFront strips that sensitive header; HTTP ALB would also set `X-Forwarded-Proto=http`).
- HTTP ALB remains valid for DS→BFF callback allowlisting and operator curls
- Keep `document_server_enable_cloudfront_https=true` in private tfvars and import CF into state so future applies do not recreate the edge
## 7. MockLab / lab writeback (`BFF_OFFICE_VAULT_EDIT`) — `lp-zuh.10.3` / `lp-zuh.12.5`

| Env | Meaning |
|-----|---------|
| `BFF_OFFICE_VAULT_EDIT=false` (default) | `ui.can.vault_edit=false`; mint `mode=edit` denied; callback write fail-closed |
| `BFF_OFFICE_VAULT_EDIT=true` | Lab/dogfood **only**: exposes `ui.can.vault_edit` and allows edit mint + writeback when ACL + vault path work |

**Plain env vs Secrets Manager**

| Knob | Store | Notes |
|------|-------|-------|
| `BFF_OFFICE_VAULT_EDIT` | **Plain** ECS / `bff_environment_variables` | Non-secret ops toggle. Default omit/`false` everywhere except intentional MockLab dogfood. |
| `BFF_OFFICE_JWT_SECRET` | **Secrets Manager** (same ARN as DS `JWT_SECRET`) | Never commit; never put in plain `environment_variables` on staging/production-like labels. |
| `BFF_OFFICE_PUBLIC_BASE_URL` / `BFF_OFFICE_DOCUMENT_SERVER_HOSTS` | Plain env | Reachability + callback SSRF allowlist (non-secret). |

**When to set true:** MockLab kitchen-sink OnlyOffice GO after vault mount/seed (`lp-zuh.9`) and JWT/DS wiring.  
**When to keep false:** any production-like tenant, free-track customer claim, or incident rollback.

Also required for a green editor host (orthogonal flags):

1. SPA rebuild with `VITE_ONLYOFFICE_EDITOR=true` + HTTPS `VITE_ONLYOFFICE_DS_URL` + allowlist (see [onlyoffice-mocklab-go-path.md](../../../docs/plans/0008-daytona-agent-sandboxes/onlyoffice-mocklab-go-path.md)).
2. Edge routes `POST /<tenant>/api/office/sessions` to BFF; mint errors must not be SPA-masked (BFF uses **422** for missing vault file — not 404).
3. Staging DS healthy + matching `BFF_OFFICE_JWT_SECRET`.

**Lab writeback (`lp-zuh.12.5` / `lp-zuh.12.7` / `lp-zuh.13.1`):** With `BFF_OFFICE_VAULT_EDIT=true`, edit mint + callback route are GO. Short-stack durable write uses CP `PUT …/vault/put` (etag/content_hash CAS) and BFF `createCpS3OfficeCallbackVaultWriter` when `VAULT_PLANE=cp_s3` — no `@aws-sdk` in BFF, no Brain RPC `vault.write`. Fail-closed when the flag is omit/`false`. Live MockLab: CP+BFF force-redeployed; status 2 → **200** `saved` with new content-hash revision (`lp-zuh.13.1`). Evidence: [`onlyoffice-callback-writeback-live/`](../../../artifacts/mocklab/live-qa/onlyoffice-callback-writeback-live/) (live), [`onlyoffice-callback-writeback-cp-s3/`](../../../artifacts/mocklab/live-qa/onlyoffice-callback-writeback-cp-s3/) (local CAS), [`onlyoffice-edit-writeback/`](../../../artifacts/mocklab/live-qa/onlyoffice-edit-writeback/) (flag/route).

## 8. Rollback — disable Office editing without breaking previews

Chat document **previews** do not require Document Server. Keep them working:

1. **Web feature flag off:** `onlyoffice_editor=false` / omit `VITE_ONLYOFFICE_EDITOR` (product default off). Pane falls back to preview hosts.
2. **BFF write fail-closed:** `BFF_OFFICE_VAULT_EDIT=false` (default).
3. **Pause DS tasks (soft):** `document_server_desired_count = 0` then apply — ALB remains but no healthy targets; editor fails closed.
4. **Disable layer (harder):** `enable_staging_document_server = false` then apply — removes DS resources; BFF loses auto Office JWT/env injection (operator may clear leftover secrets map keys).
5. **Do not** remove vault preview routes, chat pane, or static edge.

Order for incident: flags first (instant), then desired_count=0, then full disable if needed.

---

## 9. Purge / residual (staging only)

- Staging accepts **shared multi-tenant residual** on one DS (JWT + document keys + ACL mitigate; not account isolation).
- Ephemeral task storage: recycling tasks drops local cache.
- **Day-2 purge, retention, and evidence:** [operate-onlyoffice-document-server.md](operate-onlyoffice-document-server.md) §8 (`lp-5q6.36`). Staging default: force new deployment or scale 0→1 at least daily, and after incidents.
- Never point production vault hosts at this Document Server.
- Logs: no file bodies (see portal Office observability / redaction).

---

## 10. Production boundary

| Item | Staging (this runbook) | Production |
|------|------------------------|------------|
| Topology | `staging-platform-shared-ds` | `prod-per-tenant-ds` (default) |
| Shared DS | Yes (staging residual) | No without opt-in |
| License | Free Community | Paid or counsel path before enable |
| Module | `staging-document-server` | Future per-tenant deploy (not this module as default) |

---

## 11. Acceptance checklist (`lp-5q6.34`)

- [x] Staging deploy matches topology decision (`staging-platform-shared-ds` module + compose toggle)
- [x] JWT secret and license material from secret store, not git (SM JWT; optional license shell)
- [x] Browser can reach Document Server through intended domain (public ALB + optional hostname/DNS)
- [x] Document Server can reach BFF download and callback URLs (`BFF_OFFICE_PUBLIC_BASE_URL` + private egress)
- [x] Health checks and smoke tests exist (`/healthcheck`, offline smokes)
- [x] Rollback disables Office editing without breaking chat previews (flag + desired_count=0 + layer off)

Live AWS apply remains **operator-owned** evidence for staging E2E (`lp-5q6.38`), not claimed by this bead alone.
