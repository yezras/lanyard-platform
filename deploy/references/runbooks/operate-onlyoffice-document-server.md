# Runbook: operate ONLYOFFICE Document Server (day-2)

**Status:** Operator lifecycle for lab, staging, and production topologies  
**Bead:** `lp-5q6.36`  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**ADR:** [0006-document-server-topology-and-data-residency.md](../../../docs/adr/0006-document-server-topology-and-data-residency.md)  
**Threat notes:** [portal-office-document-bridge-threat-notes.md](../../../docs/architecture/portal-office-document-bridge-threat-notes.md) §5.3, §5.10  
**License track:** free Community / Developer Development Server only ([decision-license-path](../../../docs/plans/0004-portal-onlyoffice-integration/decision-license-path.md)). Production customer edit stays blocked until a paid (or counsel Community) path plus security gates.

Environment-specific deploy procedures:

| Topology | Deploy / first-start | This runbook |
|----------|----------------------|--------------|
| `lab-shared-compose-ds` | [lab-onlyoffice-document-server.md](lab-onlyoffice-document-server.md) | Start/stop, JWT rotate, purge, failures |
| `staging-platform-shared-ds` | [staging-document-server.md](staging-document-server.md) | Scale, upgrade, JWT rotate, purge, failures |
| `prod-per-tenant-ds` | Future per-tenant deploy (not the staging module as default) | Same operator shapes; residency stricter |
| `prod-shared-ds-opt-in` | Explicit commercial/security opt-in only | Requires purge evidence + written opt-in |

**Never** put JWT values, license files, vault paths, or document bodies in git, PR bodies, bead notes, or this file. Evidence is command names, ARNs, health codes, and IDs only.

---

## 1. Topology matrix (read first)

| | Lab `lab-shared-compose-ds` | Staging `staging-platform-shared-ds` | Production `prod-per-tenant-ds` (default) |
|--|-----------------------------|--------------------------------------|-------------------------------------------|
| Form | Docker Compose on a workstation | One Fargate DS + public Docs ALB in staging VPC | One DS per tenant inside that tenant’s account/VPC |
| Vault | Fixture / lab only | Staging data only | Customer vault; bytes stay in tenant partition |
| JWT store | Compose `.env` (`JWT_SECRET`) | AWS Secrets Manager; same ARN → DS + BFF | Per-tenant (or per-env) SM/SSM; never git |
| Shared multi-tenant residual | Fixture-level only | **Accepted for staging** | **No** (dedicated DS) |
| Browser → DS | `http://127.0.0.1:8080` (default) | Docs ALB / `document_server_public_hostname` | Tenant Docs edge only |
| DS → BFF | `host.docker.internal` lab base | `BFF_OFFICE_PUBLIC_BASE_URL` HTTPS | Product BFF HTTPS from tenant DS |
| Feature flag | `onlyoffice_editor` / `VITE_ONLYOFFICE_EDITOR` (default off) | Same | Same |
| Production customer edit | Forbidden | Forbidden | Still gated (license + security) |

Hard boundary in every topology: Document Server talks only to Portal BFF Office HTTP endpoints. No Brain RPC, no relay, no direct `VAULT_ROOT`.

### 1.1 Browser DS origin trust (lp-p37.3)

The portal web app **must not** take Document Server origin or editor enablement from the **URL query string in production builds**. Attackers previously could use `?onlyoffice_editor=1&onlyoffice_ds_url=https://evil.example` to inject a hostile `api.js` into the portal origin.

| Control | Rule |
|---------|------|
| Enablement (prod) | `VITE_ONLYOFFICE_EDITOR` / `VITE_FEATURE_ONLYOFFICE_EDITOR` only (plus optional `window.__LANYARD_FEATURE_FLAGS__.onlyoffice_editor` for staged flips). **No** `?onlyoffice_editor=` / `?onlyoffice=` |
| DS origin (prod) | `VITE_ONLYOFFICE_DS_URL` / `VITE_ONLYOFFICE_DOCUMENT_SERVER_URL` only. Optional extra allowlist: `VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS` (comma-separated origins). **No** `?onlyoffice_ds_url=` / runtime DS URL override |
| Validation | Origin parsed as absolute http(s); remote requires **HTTPS**; loopback HTTP only for lab/dev; membership on the trusted allowlist before script injection |
| CSP (edge) | `modules/portal-static-edge` `content_security_policy` **or** `onlyoffice_document_server_origins` so CloudFront `script-src` (and frame/connect) includes only approved DS origins |

Lab/story may still use query params and `http://127.0.0.1:8080` in **non-production** builds; production artifacts ignore those inputs.

---

## 2. Start

### 2.1 Lab

```bash
cd deploy/dev/lab-shared-compose-ds
cp -n .env.example .env
docker compose up -d
docker compose ps
```

First boot after image pull often takes 60–180s before `/healthcheck` is true.

### 2.2 Staging

Enable is operator-owned Terraform (module default off). Full plan/apply steps live in [staging-document-server.md](staging-document-server.md) §4.

Soft start after the layer already exists but was scaled to zero:

```bash
# Private tfvars — set document_server_desired_count = 1 (or module desired_count)
cd deploy/environments/platform-staging
terraform plan
# operator: terraform apply

# Or scale the existing ECS service without a full root re-plan.
# Cluster/service names come from module outputs ecs_cluster_name / ecs_service_name
# (not currently re-exported on the platform-staging root; read from state or console).
aws ecs update-service --cluster "$DS_CLUSTER" --service "$DS_SERVICE" --desired-count 1
```

Confirm ALB target health and browser edge after start (see [Health check](#4-health-check)). Root outputs useful for health: `document_server_alb_dns_name`, `document_server_public_base_url`, `document_server_jwt_secret_arn` (ARN only).

### 2.3 Production (`prod-per-tenant-ds`)

Production Document Server enablement is **blocked** on free-track license re-open + security. When a future per-tenant module exists, start means bring the tenant-scoped service to desired count ≥ 1 inside that tenant’s isolation boundary, then prove browser → tenant Docs edge and DS → product BFF. Do not reuse `staging-document-server` as the production default topology.

---

## 3. Stop

Stop does not delete secrets. It only stops the editing service. Chat document **previews** must keep working (see [Feature flag disable and rollback](#7-feature-flag-disable-and-rollback)).

### 3.1 Lab

```bash
cd deploy/dev/lab-shared-compose-ds
docker compose stop
# Or full down without volume wipe:
docker compose down
```

### 3.2 Staging

Incident order (fastest first):

1. Turn off `onlyoffice_editor` (web) and keep `BFF_OFFICE_VAULT_EDIT=false`.
2. Scale DS to zero: `document_server_desired_count = 0` then apply, or  
   `aws ecs update-service --cluster … --service … --desired-count 0`.
3. Harder: `enable_staging_document_server = false` then apply (removes DS resources).

### 3.3 Production

Same order: flags first, then scale tenant DS to zero, then decommission the tenant Docs edge only after purge and offboarding policy (see [Purge](#8-forgotten-files-cache-purge-and-retention)).

---

## 4. Health check

| Check | Lab | Staging / prod-shaped |
|-------|-----|------------------------|
| Process ready | `curl -sf "http://127.0.0.1:${DS_HOST_PORT:-8080}/healthcheck"` | `curl -sf "https://<docs-host>/healthcheck"` |
| Docs API loader | `curl -sf "…/web-apps/apps/api/documents/api.js" \| head -c 200` | Same path on Docs host |
| Offline structure | `bash deploy/scripts/smoke-lab-onlyoffice-compose.sh` | `bash deploy/scripts/smoke-staging-document-server.sh` |
| Day-2 docs coverage | `bash deploy/scripts/smoke-operate-onlyoffice-runbook.sh` | Same |
| Lab open/edit/save | `bash deploy/scripts/prove-lab-onlyoffice-roundtrip.sh` | Staging E2E is operator-owned (`lp-5q6.38`) |
| ALB / ECS | n/a | Target group healthy; ECS service running count matches desired |
| DS → BFF reachability | `docker exec lab-onlyoffice-ds curl -sS -o /dev/null -w "%{http_code}\n" --connect-timeout 3 "http://host.docker.internal:4000/health"` | From a task or jump host: `curl -sfI "$BFF_OFFICE_PUBLIC_BASE_URL/health"` |

JWT does **not** create network reachability. If download/callback fail with connection errors, fix DNS/SG/egress before rotating secrets.

---

## 5. Upgrade

### 5.1 Lab

```bash
cd deploy/dev/lab-shared-compose-ds
# Optional pin: ONLYOFFICE_DS_TAG=<tag> in .env
docker compose pull
docker compose up -d
# Wait for healthcheck; re-run api.js curl
```

### 5.2 Staging

Image is **digest-pinned** (`image_digest = "sha256:…"`). Never deploy by `:latest` alone.

1. Resolve a new Community `onlyoffice/documentserver` digest offline (operator registry pull + `docker image inspect … --format '{{.RepoDigests}}'`).
2. Put the new digest in private `terraform.tfvars` (not git).
3. `terraform plan` / `apply` so the task definition rolls.
4. Wait for ALB health + `api.js`.
5. Spot-check one Office open (or staging E2E harness when available).

Rollback image: set `image_digest` back to the previous pin and apply (see [Rollback](#7-feature-flag-disable-and-rollback)).

### 5.3 Production

Same digest-pin rule per tenant. Roll one tenant at a time. Do not mass-upgrade all tenants without a canary.

---

## 6. JWT rotation (BFF + Document Server)

Document Server and BFF must share the **same** JWT secret string. Mismatch surfaces as token/security errors on editor open or callback.

| Environment | DS secret name | BFF secret name | Store |
|-------------|----------------|-----------------|-------|
| Lab | `JWT_SECRET` | `BFF_OFFICE_JWT_SECRET` / `ONLYOFFICE_JWT_SECRET` / `JWT_SECRET` (see `loadOfficeJwtSecret`) | Compose `.env` + local BFF env |
| Staging | `JWT_SECRET` (ECS secrets map) | `BFF_OFFICE_JWT_SECRET` (same SM ARN) | Secrets Manager `…/portal/office-jwt` (default) |
| Production | Per-tenant DS `JWT_SECRET` | BFF `BFF_OFFICE_JWT_SECRET` for that plane | SM/SSM; never git |

BFF resolution order (`portal/packages/bff/src/office/editor-config.ts`):

1. `BFF_OFFICE_JWT_SECRET` (preferred)
2. `ONLYOFFICE_JWT_SECRET`
3. `JWT_SECRET` (lab compose shared name)

Production rejects missing secrets and the lab placeholder. Staging/production-like BFF modules reject putting these names in plain `environment_variables`.

### 6.1 Lab rotation

```bash
# 1. Generate a new lab secret (do not commit)
openssl rand -base64 48

# 2. Update lab DS
#    deploy/dev/lab-shared-compose-ds/.env  → JWT_SECRET=<new>
# 3. Update local BFF env to the same value (BFF_OFFICE_JWT_SECRET or JWT_SECRET)
# 4. Recreate DS so the new env is loaded
cd deploy/dev/lab-shared-compose-ds
docker compose up -d --force-recreate
# 5. Restart local BFF process / compose service
# 6. Health + open a fixture editor session
```

Old JWTs stop verifying immediately after recreate. Active editor tabs need a refresh (new mint).

### 6.2 Staging rotation

Both sides must cut over. Prefer a short maintenance window or accept failed mints until both task fleets restart.

```bash
# 1. New value (local only; never paste into chat/git)
NEW_JWT="$(openssl rand -base64 48)"
SECRET_ID="<name or ARN of …/portal/office-jwt>"   # terraform output document_server_jwt_secret_arn

# 2. Put new string into Secrets Manager (raw SecretString = JWT secret)
aws secretsmanager put-secret-value \
  --secret-id "$SECRET_ID" \
  --secret-string "$NEW_JWT"
unset NEW_JWT

# 3. Force new deployments so tasks re-fetch the secret
# Document Server
aws ecs update-service --cluster "$DS_CLUSTER" --service "$DS_SERVICE" --force-new-deployment
# BFF (portal BFF service name from platform-staging outputs)
aws ecs update-service --cluster "$BFF_CLUSTER" --service "$BFF_SERVICE" --force-new-deployment

# 4. Wait for stable services + healthy Docs ALB
# 5. curl /healthcheck and api.js; mint a staging Office session
```

Rules:

- Do **not** put the new value in `terraform.tfvars` or plain env.
- Terraform `random_password` for first create does not re-rotate on every apply; rotation is this SM put + redeploy path.
- Lab, staging, and production secrets must stay **distinct**.
- After rotation, record **when** and **who**, never the value.

### 6.3 Production rotation

Same SM put + force-new-deployment shape, scoped to the **tenant** JWT secret and that tenant’s DS + the product BFF that mints for them. If multiple BFF tasks share one secret, redeploy the whole BFF service so no task keeps the old value.

---

## 7. Feature flag disable and rollback

Chat document **previews** do not need Document Server. Keep them when Office edit is off.

| Layer | Control | Effect |
|-------|---------|--------|
| Web | `onlyoffice_editor=false` or omit `VITE_ONLYOFFICE_EDITOR` | Editor host stays dark; pane uses preview |
| Web runtime | `window.__LANYARD_FEATURE_FLAGS__.onlyoffice_editor = false` | Same, without rebuild (lab/staging override) |
| BFF write | `BFF_OFFICE_VAULT_EDIT=false` (default) | Callback writeback fail-closed. **MockLab lab writeback:** set `true` only for dogfood (`lp-zuh.10.3` / `lp-zuh.12.5` / `lp-zuh.12.7` / `lp-zuh.13.1`); plain ECS env (not SM). Short-stack durable save: CP `vault/put` + BFF `cp_s3` callback writer when `VAULT_PLANE=cp_s3` — live status-2 `saved` proven after CP+BFF redeploy (`lp-zuh.13.1`). Never a production customer claim |
| DS soft | `desired_count = 0` / compose stop | No healthy DS targets; editor fails closed |
| DS hard | `enable_staging_document_server = false` / compose `down` | Remove DS layer |
| Image | Revert `image_digest` / compose tag | Roll back upgrade |

**Incident order:** flags first (instant), then scale DS to zero, then full disable or image revert.

Do **not** remove vault preview routes, chat pane, or static edge when disabling Office edit.

---

## 8. Forgotten files, cache purge, and retention

Document Server keeps a **transient working copy** of document bytes (cache / “forgotten files”) after the browser closes. ADR 0006 requires a documented purge before any production claim. Shared staging accepts residual co-residency; production default confines residual to one tenant’s DS.

### 8.1 What to purge

| Surface | Path / store (Community image) | Contains |
|---------|--------------------------------|----------|
| Cache + forgotten files | `/var/lib/onlyoffice` (lab volume `lab_onlyoffice_lib`) | Converted/assembled files, session cache |
| App data | `/var/www/onlyoffice/Data` (`lab_onlyoffice_data`) | DS app data |
| Logs | `/var/log/onlyoffice` (`lab_onlyoffice_logs`) | Ops logs (should not ship bodies) |
| Embedded DB | `/var/lib/postgresql` (`lab_onlyoffice_db`) | DS internal state |
| Staging Fargate | Task ephemeral storage | Same tree; gone when the task is replaced |
| BFF session store | BFF Office session rows | Not DS disk; expire via session TTL |

Never log file bodies while inspecting these paths ([observability](../../../docs/architecture/portal-office-observability.md)).

### 8.2 Retention defaults (product policy)

| Control | Guidance |
|---------|----------|
| Editor JWT / session | Short-lived; align with session `expires_at`; re-mint, do not extend forever |
| Signed download URL | Short TTL; fail closed after expiry |
| Callback nonce / save generation | One-shot or idempotent; no indefinite replay |
| Document key | Includes tenant + path identity + content revision; new revision ⇒ new key |
| DS cache / forgotten files | **Lab:** wipe volumes on teardown. **Staging:** purge at least every **24h** or on recycle. **Production:** purge SLO required before claim (recommend ≤ 24h idle + always on tenant offboard) |
| CloudWatch DS logs | Module `log_retention_days` (default in module vars); no body content |

### 8.3 Lab purge

Routine (after edit spikes or shared lab host handoff):

```bash
cd deploy/dev/lab-shared-compose-ds

# Preferred: stop and remove named volumes (full cache wipe)
docker compose down -v

# Confirm volumes gone
docker volume ls | grep lab_onlyoffice || true
```

In-place wipe without removing the stack (active editors will break):

```bash
# Stop first so files are not mid-write
docker compose stop
docker run --rm \
  -v lab_onlyoffice_lib:/libdata \
  -v lab_onlyoffice_data:/data \
  alpine:3.20 sh -c 'rm -rf /libdata/* /data/*'
docker compose start
# Wait for /healthcheck
```

If the lab JWT may have leaked during a shared session, rotate it after purge (§6.1).

### 8.4 Staging purge

Fargate tasks use **ephemeral** storage. Recycling the task drops local cache.

```bash
# Soft purge: new tasks, empty local disk
aws ecs update-service \
  --cluster "$DS_CLUSTER" \
  --service "$DS_SERVICE" \
  --force-new-deployment

# Harder residual reduction: scale to zero, wait for tasks stopped, scale back
aws ecs update-service --cluster "$DS_CLUSTER" --service "$DS_SERVICE" --desired-count 0
# wait until runningCount == 0
aws ecs update-service --cluster "$DS_CLUSTER" --service "$DS_SERVICE" --desired-count 1
```

Schedule (operator-owned until automation exists):

| Cadence | Action |
|---------|--------|
| Daily (staging shared) | Force new deployment **or** document why residual is acceptable until next recycle |
| After security incident | Scale to 0 → wait → scale to 1; rotate JWT (§6.2) |
| Before claiming “staging clean” for a demo | Force new deployment + confirm no customer prod vault pointed at DS |

Staging shared residual remains **accepted** for staging data only. Purge mitigates forgotten-file risk; it does not equal account isolation.

### 8.5 Production purge

| Event | Required action |
|-------|-----------------|
| Session end | Force-save / callback completes or fails closed; BFF marks session terminal |
| Idle forgotten files | Purge or recycle tenant DS on the agreed SLO (document interval before production claim) |
| JWT leak suspicion | Rotate tenant JWT + recycle DS |
| Tenant offboarding | Wipe DS volumes / destroy tenant DS with the same lifecycle as Company Brain vault host |
| `prod-shared-ds-opt-in` | Measured purge evidence required (ADR 0006); without it shared prod DS stays rejected |

Record purge evidence as timestamps, service events, and ticket IDs. Do not attach file lists with customer pathnames if policy forbids them.

---

## 9. Common failure modes and logs

### 9.1 Where to look

| Plane | Lab | Staging |
|-------|-----|---------|
| Document Server stdout | `docker compose logs -f --tail=200 onlyoffice-documentserver` | CloudWatch log group for the Docs service (`aws logs tail … --follow`); group name from module / TF state |
| DS files | volumes under `/var/log/onlyoffice` | Ephemeral; prefer CloudWatch |
| BFF Office | Local BFF process logs | BFF ECS log group; filter `event=office_*` |
| Web editor | Browser console (no JWT paste into tickets) | Same |
| Metrics | In-process `officeMetrics` / editor metrics | Exported series when wired (`lp-5q6.33`) |

Safe BFF log fields: `request_id`, `tenant_id`, `office_session_id`, `outcome`, `error_code`, `onlyoffice_status`, `latency_ms`, `size_bucket`. **Never** paste JWT, download tokens, callback nonces, or file bodies into tickets.

### 9.2 Cheat sheet

| Symptom | Likely cause | What to inspect | Fix |
|---------|--------------|-----------------|-----|
| `/healthcheck` never true | Slow first boot, OOM, full disk | DS logs; task stopped reason; lab `docker stats` | Wait 3 min; raise memory (≥ 4 GiB staging floor); free disk |
| `api.js` connection refused / 502 | DS down or wrong host/port | Compose `ps` / ALB targets | Start DS; fix Docs hostname / `DS_HOST_PORT` |
| Editor: download failed | DS cannot reach BFF URL | From DS: curl BFF health; SG/NAT/egress | Absolute DS-visible BFF base (`host.docker.internal` lab; HTTPS staging). Not browser `localhost` |
| JWT / security token error | Secret mismatch or JWT disabled | Confirm `JWT_ENABLED=true`; both sides same secret after rotate | Align secrets; recreate/redeploy DS **and** BFF |
| Callback save failed | Nonce, ACL, CAS conflict, SSRF allowlist | BFF `office_callback` logs (`error_code`, `onlyoffice_status`) | User-facing copy via `officeSaveUserErrors`; fix allowlist host or revision conflict |
| Mixed content | HTTPS portal page loads HTTP DS | Browser console | Same-scheme edge (staging HTTPS Docs) |
| Open works, save never lands | Callback URL wrong; BFF_OFFICE_VAULT_EDIT false | BFF callback route hits; flag | Fix `callbackUrl` base; enable vault edit only when write path ready |
| Wrong document content | Stale `document.key` | Key must include tenant + path + revision | Invalidate key on new revision (`lp-5q6` key policy) |
| Cross-tenant suspicion (staging shared) | Residual cache on shared DS | Incident: scale 0 → 1; rotate JWT | Production default is per-tenant DS |

Operator error classes for BFF/web copy: [portal-office-observability.md](../../../docs/architecture/portal-office-observability.md) §3.

---

## 10. Honesty gates

| Claim | Truth |
|-------|--------|
| Day-2 start/stop/upgrade/health/rollback documented | Yes (this runbook) |
| JWT rotation across BFF + DS | Yes (§6) |
| Forgotten-file / cache purge + retention | Yes (§8) |
| Lab vs staging vs production distinguished | Yes (§1) |
| Live staging/prod apply from this PR | **No** — operator-owned |
| Production customer Office edit unlocked | **No** — license + security + `prod-per-tenant-ds` |
| Staging shared residual eliminated by purge | **No** — purge reduces residual; isolation is logical for staging |

---

## 11. Related artifacts

| Path | Role |
|------|------|
| [lab-onlyoffice-document-server.md](lab-onlyoffice-document-server.md) | Lab first-start, compose, lab round-trip |
| [staging-document-server.md](staging-document-server.md) | Staging TF enable, secrets wiring, rollback summary |
| [staging-secrets-checklist.md](staging-secrets-checklist.md) | SM names for Office JWT |
| `deploy/modules/staging-document-server/` | Staging Terraform module |
| `deploy/dev/lab-shared-compose-ds/` | Lab Compose tree |
| `deploy/scripts/smoke-operate-onlyoffice-runbook.sh` | Offline coverage smoke for this runbook |
| [portal-document-server-topology.md](../../../docs/architecture/portal-document-server-topology.md) | Named topologies |
| [portal-office-document-bridge-threat-notes.md](../../../docs/architecture/portal-office-document-bridge-threat-notes.md) | JWT / purge threat controls |

---

## 12. Acceptance checklist (`lp-5q6.36`)

- [x] Start, stop, upgrade, health check, rollback, and feature flag disable
- [x] JWT rotation across BFF and Document Server (lab + staging + production-shaped)
- [x] Forgotten files, cache purge, and retention settings
- [x] Common failure modes and where to inspect logs
- [x] Lab, staging, and production topologies distinguished

Offline evidence:

```bash
bash deploy/scripts/smoke-operate-onlyoffice-runbook.sh
```
