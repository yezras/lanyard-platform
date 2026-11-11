# Source-of-truth readiness matrix

**Purpose:** Record exact product and deploy blockers so Phase 2 release *infrastructure* is not mistaken for end-to-end product publishing or platform compute.

**Last verified (operator truth):** 2026-07-26 — private GitHub release pins for Hermes (`v0.1.0-g7h2`), client-core (`v0.1.0-g7c2`), and Portal static web (`v0.1.0-g7p`) in `compatibility/pins.real-releases.yaml`. Portal backend digests are **real local Docker image Ids** (ECR push pending; repositories still `example.ecr` placeholders). Platform S3 mirrors and **G1.4 / G1a / G2 / G3.4 live staging proofs remain fail-closed** until operator-recorded evidence (`references/runbooks/readiness-live-proofs-residual.md`, `lp-t7q.7` / migrated `cbd-mta.6.*`). Monorepo code and offline smokes do **not** flip these rows to **ready**. **Do not claim G7 production-ready.**

**Backend kind / contract compatibility (Hermes-Lanyard, Hermes upstream, Lanyard Agent):** see the published platform matrix
[`docs/architecture/backend-compatibility-matrix.md`](../../docs/architecture/backend-compatibility-matrix.md)
(`lp-k7g.11.7`) — kind, version, contract majors, capabilities, conformance result, and **backend deploy readiness**. That matrix is orthogonal to the G* production-security rows below (backend readiness ≠ G1/G2/G3 cleared).

Legend:

| Status | Meaning |
|--------|---------|
| **ready** | Present and usable for the stated purpose |
| **infra_ready** | Deploy-owned AWS/Terraform foundation exists; product still blocked |
| **blocked** | Not ready; explicit gate listed |
| **out_of_scope** | Deliberately not claimed by this phase |

**Fail-closed production rule:** No operator, doc, or CI path may claim **production Portal control-plane** or **production relay security** ready while G1/G2 items below are **blocked**. Customer data-plane **wiring** readiness is not production security readiness. Validate with `bash scripts/validate-production-gates.sh`.

---

## Deploy surface (this repository)

| Capability | Status | Evidence / location |
|------------|--------|---------------------|
| Company Brain EC2 + EBS + DLM | **ready** | `modules/company-brain-ec2/` |
| Customer gateway relay **wiring** (env injection from provision) | **ready** (wiring only) | `modules/customer-gateway-relay/` — maps `GATEWAY_RELAY_*`; **not** production relay security |
| Relay / control-plane **production security** | **blocked** | G1 + G2 below; product-owned lifecycle and private boundary |
| Tier 3 dedicated relay | **infra_ready** | `modules/tier3-dedicated-relay/` — per-tenant public ALB + private Fargate (composes `portal-relay-service`), digest pin, secrets map, optional Route53/WAF; **not auto-applied**; not production-certified until operator apply + G2 evidence (`claim_production_ready` hard-false) |
| Tenant template + artifact bootstrap | **ready** | `templates/tenant/`, `scripts/bootstrap-host.sh` |
| Tenant isolation decision + template gates | **ready** (decision + validations) | `references/tenant-isolation-decision.md`, tenant `production_intent` checks |
| Compatibility pins (digests + version/SHA/URL) | **ready** (schema + example + real private GH pins) | `compatibility/pins.example.yaml` (placeholder), `compatibility/pins.real-releases.yaml` (Hermes/client-core/Portal web private GH; local image Ids for bff/relay/control-plane; ECR re-pin pending), `scripts/validate-compatibility.sh` (+ optional `portal.web`), `references/runbooks/pin-update.md` |
| Product artifact S3 (versioning + Object Lock) + Portal ECR + OIDC role skeleton | **infra_ready** | `modules/product-artifact-infra/`, composed in `environments/platform-staging/` — **not auto-applied**; operator procedure `references/runbooks/product-artifact-staging-apply.md`; live verify `scripts/verify-product-artifact-staging.sh`. Do not claim staging-applied from module presence alone. |
| Platform staging composed root (VPC + artifacts + RDS + Portal + optional Valkey/DNS) | **infra_ready** | `environments/platform-staging/` — offline CI/smoke (`scripts/smoke-platform-staging-compose.sh`, `.github/workflows/ci.yml`); apply/rollback `references/runbooks/platform-staging-compose.md`; **not production-applied**; example tfvars not apply-ready |
| Portal production topology / G0 | **ready** (documented target) | Path-first static-web target; compute still gated |
| Platform compute (Portal CloudFront/ECS/ALB/services) | **infra_ready** | G8 modules: `portal-static-edge`, `portal-bff-service`, `portal-relay-service`, `portal-control-plane-service` (digest pins, `/health`, private CP); composed in platform-staging; **not auto-applied**; not production-certified without staging evidence + G1/G2/G7 |
| Control-plane RDS / Postgres Terraform | **infra_ready** | `modules/control-plane-rds/` — private subnets, encryption, Secrets Manager `CONTROL_PLANE_DATABASE_URL`; composed in platform-staging examples; **not auto-applied** from placeholders; production use still needs operator apply + G1 private CP boundary |
| Portal Valkey / Redis shared state | **infra_ready** | `modules/portal-valkey/` — private TLS ElastiCache Valkey, Secrets Manager `REDIS_URL`; BFF/relay consume via `secrets` map (`redis_url_secret_arn`); optional on platform-staging (`enable_portal_valkey` default **off** — pilot/mocklab often leave off); **not auto-applied**; **not production certified from module alone**; enable path + dual-BFF residual: `references/runbooks/portal-valkey-g5-enable.md` (`lp-t7q.8`); G5/G6 still product/staging gated |
| Live product publishing from this repo | **out_of_scope** | Product repos own build/publish workflows |

---

## Production security gates (private-by-default)

**Production Portal/relay security status: BLOCKED** until every G1 and G2 row is **ready**.  
Deploy-owned data-plane hosts may still be provisioned for pilots; that does **not** clear production security sign-off.

**Production private-by-default claim status: BLOCKED** pending independent pen-test (or written residual-risk acceptance) and a signed record in `references/production-security-signoff.md` (current status: **NOT SIGNED**). Offline CI policy-as-code (`scripts/policy-as-code-security.sh`, `scripts/security-acceptance-checklist.sh`) is **not** a penetration test and must **not** be described as pen-test complete.

Operator checklist (procedure): `references/runbooks/production-security-gate.md`  
Automated honesty check: `scripts/validate-production-gates.sh`  
Threat model: `references/threat-model-private-by-default.md`  
Pen-test process: `references/runbooks/penetration-test-and-signoff.md`  
E2E LOCAL vs STAGING: `references/runbooks/security-e2e-acceptance.md`

### Gate table (must stay honest)

| Gate ID | Item | Status | Owner | Blocker / evidence |
|---------|------|--------|-------|--------------------|
| **G0** | Path-first production topology freeze | **ready** (documented) | Product + deploy docs | Canonical URL `https://app.withlanyard.com/<tenant_slug>`; compute still gated |
| **G1** | Authenticated **private control-plane boundary** | **blocked** | Portal product | Product progress: G1.1 OIDC merged (Portal **#11**); G1.2/G1.3 service auth + private topology (Portal **#13**). Deploy: OIDC client secret via ECS secrets map + path-first callback URL docs (cbd-mta.3.2) — **does not** clear live proof. **G1.4 staging proof not executed** — keep **blocked** (live note: `references/runbooks/readiness-live-proofs-residual.md`, `lp-t7q.7`). Harness: CP tests + compose loopback + `portal/scripts/staging-g1-cp-boundary-proof.sh` (exit 2 without `STAGING_*`); operator path `security-e2e-acceptance.md` + Portal CP README + `staging-secrets-checklist.md` § OIDC. Never public ALB. |
| **G1a** | Per-tenant authorization / isolation (control plane) | **ready** (product) / **blocked** (live proof) | Portal product | Product: G1a.1 tenant-scoped path authz + cross-tenant negatives (Portal **#21**); schema ownership/FKs/triggers + inventory (cbd-mta.3.1, Portal `docs/control-plane-schema-boundary.md`). Data-plane isolation separate (`tenant-isolation-decision.md`). **Live G1a staging proof open** (cbd-mta.6.2 / `lp-t7q.7` residual) — do not claim production multi-tenant isolation from unit tests alone. |
| **G2** | Relay **credential lifecycle** (register / rotate / revoke) | **blocked** | Portal product | Product APIs landed: register/rotate/revoke (Portal **#7**, **#9**, **#10**). Lifecycle runbooks: Portal **#12**, deploy **#6**. **Still blocked** for production security claim until live staging revoke/register E2E is recorded (S4 / G2.3 manual path; live note: `readiness-live-proofs-residual.md`). Validator remains fail-closed. |
| **G2a** | Replay resistance for relay auth material | **ready** (product) | Portal product | Single-use jti upgrade tokens + session exclusivity + prod fail-closed (`@lanyard/relay` G2a.2; Hermes mint in private `hermes-lanyard`). Multi-relay shared jti store is G6. |
| **G2b** | Payload log / retention controls (relay + control plane) | **blocked** | Portal product + ops policy | Policy draft in Portal **#12** (`docs/policies/log-retention-and-access.md`); enforcement incomplete for production claim |
| **PS-NET** | Private-by-default network posture (data plane SSH / no portal ingress) | **ready** (partial, deploy-owned) | Deploy | `operator_ssh_cidrs` rejects `0.0.0.0/0`; egress-only portal doctrine documented; open egress to `0.0.0.0/0:443` still typical for MVP Hermes |
| **PS-PROC** | Approved data processors + per-client data-handling policy | **ready** (catalog + template + tenant vars) | Deploy + ops | `references/approved-data-processors.md`; policy template; `approved_processor_ids` / `require_data_handling_policy`; L7 domain deny still needs Network Firewall/proxy |
| **PS-SEC** | Secrets not in git / no secrets-in-tf sources | **ready** (process) | Deploy + ops | tfvars/state gitignored; examples use placeholders only |
| **PS-ISO** | Separate-tenant isolation model | **ready** (decision + template validations) | Deploy | `references/tenant-isolation-decision.md`; account-per-tenant target; interim VPC+KMS+logs+DLM |
| **PS-CI** | Offline policy-as-code + security acceptance suite | **ready** (CI) | Deploy | `scripts/policy-as-code-security.sh`, `scripts/security-acceptance-checklist.sh`, `references/runbooks/security-e2e-acceptance.md` — LOCAL only; not live pen-test |
| **PS-PT** | Independent threat model + pen-test + production sign-off | **blocked** | Security + leadership | Threat model + process templates exist; **pen-test not completed**; sign-off **NOT SIGNED** (`references/production-security-signoff.md`) |
| **G3** | Brain RPC for customer-host operations | **blocked** | Portal + Hermes | Contract (G3.1: `references/brain-rpc-contract.md`); Hermes handlers (G3.2: hermes-agent **#2**); Portal vertical slice (G3.3: Portal **#14** / monorepo Brain RPC composition). **G3.4 staging E2E not executed** — keep **blocked** (live note: `readiness-live-proofs-residual.md`, harness `portal/scripts/staging-g3-brain-rpc-proof.sh` exit 2 without env). Do not enable production vault/settings/projects from monorepo code alone |
| **G4** | Control-plane Postgres (product) + deploy RDS module | **ready** (product) / **infra_ready** (RDS module) | Portal product + deploy | Product: G4.1 Portal **#15** (`CONTROL_PLANE_DATABASE_URL` / `DATABASE_URL`; left better-sqlite3 / `CONTROL_PLANE_DB_PATH`); G4.2 Portal **#19** migration/rollback; **schema boundary** cbd-mta.3.1 (tenant FKs/uniqueness/triggers; no vault file bodies; RLS **deferred** with compensating controls); **deployment/resource registry + audit boundary** cbd-mta.3.3 (`references/deployment-resource-registry.md` — not tfstate; not vault bodies). Deploy: G4.3 `modules/control-plane-rds/` **infra_ready** — **not applied** from examples; do not claim production RDS live until operator apply + G1 |
| **G5** | BFF shared state before desired count &gt; 1 | **blocked** | Portal product + deploy | Deploy: `modules/portal-valkey` + BFF `secrets.REDIS_URL` from `redis_url_secret_arn` (**infra_ready** wiring only — **not** production cert). Product: redis session backend, multi-instance flags, documented TTLs (7d/30d), fail-closed store outage; CI dual-instance substitute `portal/packages/bff/test/dual-instance-session.integration.test.ts`. Pilot often Valkey **off** (`enable_portal_valkey` default false; `desired_count=1` + memory sessions). Module `desired_count>1` still requires `acknowledge_g5_scale_beyond_one`. **Live dual-BFF staging session/routing proof deferred** (`lp-t7q.8` / `references/runbooks/portal-valkey-g5-enable.md`) — no multi-instance AWS campaign in residual; **do not flip ready** without product multi-instance + **recorded** dual-BFF staging evidence. |
| **G6** | Relay routing bus / shared revocation before scale-out | **blocked** | Portal product + deploy | Deploy: same Valkey store; relay `secrets.REDIS_URL` for owner leases / bus / jti / revocation. Product: `RELAY_CLUSTER_MODE=bus`, fail-closed outage. Module `desired_count>1` requires `acknowledge_g6_scale_beyond_one`. **Do not flip ready** without multi-relay + staging proof. |
| **G7** | Immutable product releases (static web, images, Hermes, client-core) | **blocked** (partial) | Product repos | Private GH: Hermes + client-core + Portal static web pinned; backend image digests = real local docker Ids (ECR push + S3 mirrors still open) — see product release gates below |
| **G8** | Thin staging / production Portal compute | **infra_ready** | Deploy | Modules exist (static OAC edge + BFF/relay/CP digest services + staging runbook); **not production-certified** without staging apply evidence; still requires G1/G2/G7 for production Portal claim |

### Production security checklist (explicit)

For production sign-off, **all** of the following must be true. While any is false, status remains **blocked** (fail-closed).

1. **Authenticated private control-plane boundary** — no public control-plane listener; BFF is the public API edge; service auth verified.
2. **Per-tenant authorization / isolation** — product authz for control plane; data-plane isolation per `tenant-isolation-decision.md` with `production_intent` validations.
3. **Replay resistance** — relay credential/session design resists replay (product).
4. **Credential lifecycle** — register, rotate, and revoke implemented and runbooked (not permanent manual secret paste alone).
5. **Payload log / retention controls** — defined TTL and access for relay/control-plane logs; vault content not dumped to shared debug sinks by default.
6. **Deploy network defaults** — no public SSH (`0.0.0.0/0`); no inbound portal ports on brain hosts.
7. **No secrets-in-tf in git** — live secrets only in private tfvars/SSM.
8. **G1 and G2 rows above marked ready only after product evidence** — never flip to ready to “unblock” docs without product proof.
9. **Data processors / data-handling (PS-PROC)** — per-client policy filled; `approved_processor_ids` from catalog; model/email retention and domain allowlists documented when vault-derived data leaves the host (`references/approved-data-processors.md`).
10. **Independent pen-test / sign-off (PS-PT)** — `references/production-security-signoff.md` remains **NOT SIGNED** until external test (or written residual-risk acceptance); do **not** claim pen-test complete from offline CI alone.
11. **Private-by-default production claim** — remains **blocked** until PS-PT sign-off (and still does not clear G1/G2 Portal/relay production security).

### What customer-gateway-relay is (and is not)

| Is | Is not |
|----|--------|
| Terraform mapping of **register**/provision outputs → Hermes `GATEWAY_RELAY_*` | Full production relay security claim while G2 matrix row is still **blocked** (product APIs ≠ staging proof) |
| Egress-only doctrine documentation | Shared multi-tenant relay isolation proof |
| Deploy operator path for SSM/SM **register / rotate / revoke** (`references/runbooks/relay-secret-lifecycle.md`; deploy **#6** + Portal **#12**) | Lab inline `relay_instance_secret` (non-prod only) as the production model |
| Compatible with Tier 1/2 shared or Tier 3 URL from register | Proof that shared pool isolation is complete |

**Tier 3** (`modules/tier3-dedicated-relay/`): **infra_ready** deployable dedicated-relay topology (composes `portal-relay-service` for public ALB + private Fargate; per-tenant `relay_hostname` / `relay_wss_url`; optional Route53 alias + WAFv2 association; secrets via SM/SSM). Callers must set `acknowledge_not_auto_applied=true`; `claim_production_ready` remains hard-false. Do **not** claim Tier 3 production-complete or production-certified from module presence alone — operator apply + G2 staging evidence required. Runbook: `references/runbooks/tier3-dedicated-relay-apply.md`. Honesty enforced by `scripts/validate-production-gates.sh` + `scripts/smoke-tier3-dedicated-relay.sh`.

### Staging proof harness (product-owned; operator-executed)

Product PRs ship **automated substitutes** (integration tests) and **manual staging procedures**. Deploy does **not** flip G1/G2/G3 to **ready** from docs or CI alone — live staging execution remains **operator-owned** and must be recorded before a matrix flip. Offline honesty: `bash scripts/validate-production-gates.sh` and `bash scripts/smoke-readiness-live-proofs-residual.sh` (G1/G2/G3 stay **blocked** until intentionally cleared with evidence).

**Live residual ledger (pass/fail/blocked notes):** `references/runbooks/readiness-live-proofs-residual.md` (`lp-t7q.7`, migrated `cbd-mta.6.*`). Each live gate has an explicit **blocked** note until operator-recorded staging evidence. Monorepo smokes must never claim ready without that evidence.

**Staging secrets (before live apply/proofs):** complete `references/runbooks/staging-secrets-checklist.md` (GitHub Actions vars, SM/SSM, BFF/CP/relay runtime). Offline wiring check: `bash scripts/check-staging-secrets-checklist.sh`. Filling secrets does **not** clear matrix gates.

| Gate | Product harness / evidence (links) | Deploy / operator staging | Matrix flip rule |
|------|------------------------------------|---------------------------|------------------|
| **G1** | Portal **#11** (OIDC); Portal **#13** (service auth + private topology). Tests: `packages/control-plane/test/oidc-production.integration.test.ts`, `service-auth.integration.test.ts`, `private-topology.test.ts`. Topology ADR: Portal `artifacts/portal-production-topology.md`. Harness: `portal/scripts/staging-g1-cp-boundary-proof.sh` (exit **2** without `STAGING_*`). | `references/runbooks/security-e2e-acceptance.md` (G1 private CP); residual **G1.4 blocked** in `readiness-live-proofs-residual.md`. Never public ALB. | Flip only after staging proof: public cannot reach CP; BFF path with service auth works + residual row → **pass** |
| **G1a** | Portal **#21** tenant path authz; cbd-mta.3.1 schema boundary (`docs/control-plane-schema-boundary.md`, `test/schema-boundary.integration.test.ts`, `test/tenant-authz.integration.test.ts`). | Live two-tenant elevation/isolation proof (cbd-mta.6.2 / residual G1a **blocked**). Data-plane isolation: `tenant-isolation-decision.md`. | Product **ready**; production isolation claim stays **blocked** until live proof recorded |
| **G2** | Portal **#7** register, **#9** rotate, **#10** revoke (4401). Runbooks: Portal **#12** `docs/runbooks/relay-credential-lifecycle.md` + deploy **#6** `references/runbooks/relay-secret-lifecycle.md`. Automated substitute: `pnpm --filter @lanyard/control-plane test` + `pnpm --filter @lanyard/relay test` (G2.3 staging demo in product READMEs). | S4 in `security-e2e-acceptance.md` (SSM secret + live revoke → 4401); residual G2 **blocked**. | Stay **blocked** until live staging lifecycle E2E recorded; G2a/G2b still separate production blockers |
| **G3** | Contract: `references/brain-rpc-contract.md` (§1.1 CP DB ≠ vault store). Hermes handlers: hermes-agent **#2**. Portal slice: Portal **#14** + monorepo Brain RPC + `portal/docs/staging-proofs.md` (tests/harness as staging-proof **substitute** only). Harness: `portal/scripts/staging-g3-brain-rpc-proof.sh` (exit **2** without env). | Residual **G3.4 blocked**; real pins when available (`track-a-b-e2e.md` later); sibling enable path `lp-t7q.4`. | Flip only after customer-host op E2E; do not enable vault/settings/projects on docs alone |

---

## Product release gates (exact blockers)

### 1. Portal release (static web + backend images)

| Item | Status | Blocker detail |
|------|--------|----------------|
| Portal monorepo (web / BFF / relay / control-plane) | **ready** (source) | pnpm monorepo exists |
| `/health` on relay and BFF | **ready** | Present in product |
| Static web packaging + publish workflow for `@lanyard/web` | **ready** (private GH release) | Portal pack-web + **v0.1.0-g7p** private release; pin `portal.web.*` in `pins.real-releases.yaml` (SHA `b1d00daf…`); S3 mirror optional |
| Dockerfiles for bff, relay, control-plane | **ready** (product) | Dockerfiles on Portal main; local `docker-smoke.sh` / `docker compose build` |
| Image-release workflow (build → push digest to ECR) | **infra_ready** (product workflow) | Portal `release-images.yml` on main; **local image Ids recorded** for v0.1.0-g7p; **ECR push still pending** (no registry RepoDigest yet) |
| Deploy-owned release landing zones | **infra_ready** (Hermes/client-core/portal-web S3 + Portal ECR/OIDC) | Module has `hermes/`, `client-core/`, and `portal-web/` prefixes; Portal OIDC role may write `portal-web/` and push ECR |
| OIDC push role for `LanyardBrain/Portal` | **infra_ready** | Optional; requires existing GitHub OIDC provider ARN |
| Compatibility pins with real static web SHA + backend digests | **ready** (partial honesty) | `portal.web` real private GH pin; `portal.images.{bff,relay,control-plane}` real **local** digests + `example.ecr` repos; **not** production ECR pins. Example file stays placeholder-safe |

**Next gate — Portal release:** Push images via product ECR release workflow; re-pin registry digests (replace local image Ids + example.ecr hosts); optional S3 mirror of portal-web under `portal-web/<version>/portal-web.tar.gz`. Never invent digests.

### 1a. Portal production topology and security gates (summary)

| Item | Status | Blocker detail |
|------|--------|----------------|
| Path-first canonical URL (`https://app.withlanyard.com/<slug>`) | **ready** (documented) | Product and Terraform implementation still need follow-up work |
| Static web deployment model | **infra_ready** (module) | `modules/portal-static-edge` (CloudFront OAC + private S3); product pins still unpublished; apply operator-owned |
| Private control-plane boundary (**G1**) | **blocked** | Product OIDC merged; service auth/private topology PR open; **staging proof (G1.4) missing** |
| Relay credential lifecycle (**G2**) | **blocked** | Product register/rotate/revoke + runbooks (Portal **#12**, deploy **#6**); **live staging E2E not recorded** — fail-closed |
| Brain RPC (**G3**) | **blocked** | Contract + Hermes handlers landed; Portal vertical slice open; **G3.4 staging E2E missing** |
| BFF shared state (**G5**) | **blocked** | Valkey module + ECS secrets wiring **infra_ready** (not production-certified alone); pilot often Valkey off; product CI dual-instance substitute only; **live dual-BFF staging proof deferred** — see `references/runbooks/portal-valkey-g5-enable.md` (`lp-t7q.8`); do not set BFF `desired_count > 1` until recorded staging evidence |
| Relay routing bus/shared revocation (**G6**) | **blocked** | Same store wiring **infra_ready**; product bus/jti/lease + staging evidence still required before relay `desired_count > 1` |

**Next gate — G0/G1/G2/G3:** Keep compute Terraform gated until product boundaries and immutable releases exist. Do not expose the control plane publicly. **Do not claim production ready** for relay/control-plane security while G1/G2 are **blocked**.

### 2. Hermes Lanyard release (runtime tarball)

| Item | Status | Blocker detail |
|------|--------|----------------|
| Upstream Hermes Dockerfile | **ready** (upstream) | Exists in hermes-agent |
| Lanyard custom work branch | **ready** (branch) | `origin/lanyard/portal-integration` |
| Upstream `docker.yml` for Lanyard | **blocked** | Upstream docker.yml runs only for **NousResearch/hermes-agent** |
| Lanyard runtime release workflow | **infra_ready** (workflow in product repo) | `LanyardBrain/hermes-lanyard` `.github/workflows/release-lanyard-artifact.yml` present |
| Lanyard runtime release artifact (versioned tarball + SHA-256 published) | **ready** (private GH release) | **v0.1.0-g7h2** — pin in `compatibility/pins.real-releases.yaml` (`hermes.version` / `sha256` / HTTPS release URL). Bootstrap needs `GITHUB_TOKEN`/`GH_TOKEN` for private download (never commit tokens) |
| Platform S3 object under `hermes/<version>/` | **blocked** (optional mirror) | Preferred production path via OIDC → product-artifact bucket; dual-path bootstrap already supports `s3://` |
| Deploy-owned S3 prefix `hermes/` | **infra_ready** | Product artifact bucket module |
| OIDC publish role for **private** `LanyardBrain/hermes-lanyard` | **infra_ready** | S3 write scoped to `hermes/` only |

**Next gate — Hermes Lanyard release:** Prefer mirroring the published tarball to `s3://…/hermes/<version>/…` for instance-role bootstrap; keep pin SHA identical. Pin procedure: `references/runbooks/pin-update.md`.

### 3. client-core release (seed tarball)

| Item | Status | Blocker detail |
|------|--------|----------------|
| client-core v0.1.0 content | **ready** (tag/version) | Exists as product version |
| Artifact release workflow (tar + SHA + upload) | **infra_ready** (workflow in product repo) | `LanyardBrain/client-core` `.github/workflows/release-artifact.yml` present |
| Published client-core tarball + SHA pin coordinates | **ready** (private GH release) | **v0.1.0-g7c2** — pin in `compatibility/pins.real-releases.yaml`. Private download needs `GITHUB_TOKEN`/`GH_TOKEN` (never commit tokens) |
| Platform S3 object under `client-core/<version>/` | **blocked** (optional mirror) | Preferred production path via OIDC → product-artifact bucket |
| Deploy-owned S3 prefix `client-core/` | **infra_ready** | Product artifact bucket module |
| OIDC publish role for `LanyardBrain/client-core` | **infra_ready** | S3 write scoped to `client-core/` only |

**Next gate — client-core release:** Prefer S3 mirror under `client-core/<version>/` for instance-role bootstrap; keep pin SHA identical. Pin procedure: `references/runbooks/pin-update.md`.

### 4. Control-plane Postgres

| Item | Status | Blocker detail |
|------|--------|----------------|
| Control plane app | **ready** (source) | In Portal monorepo |
| Persistence product path (G4.1) | **ready** (product) | Portal **#15**: Postgres via `CONTROL_PLANE_DATABASE_URL` / `DATABASE_URL` (historical better-sqlite3 / `CONTROL_PLANE_DB_PATH` retired for cloud mode) |
| Data migration / rollback (G4.2) | **ready** (product docs/tooling) | Portal **#19**: migration/rollback/backup story; offline proof `scripts/test-migrate-sqlite-to-postgres.sh` |
| Tenant-scoped schema boundary (cbd-mta.3.1) | **ready** (product audit) | Portal `docs/control-plane-schema-boundary.md` + `migrate.ts`: every entity has tenant/global ownership; FKs + uniqueness + same-tenant triggers; **no** canonical vault/file-body tables; cross-tenant store/API tests; **RLS deferred** (app path authz + triggers + private CP as compensating controls) |
| Deployment/resource registry + audit boundary (cbd-mta.3.3) | **ready** (product schema/API) / **not live** | Deploy contract `references/deployment-resource-registry.md`; Portal `tenant_deployments` / `tenant_resource_refs` + instance registry fields + audit (`actor`, `tenant`, `instance`, `action`, `result`, `request_id`); tests `deployment-registry.integration.test.ts`. **Not** Terraform state; secret fields are ARN refs + hashes only. Does **not** claim staging registry writes or production isolation |
| Brain RPC content boundary | **ready** (contract) | Canonical Company Brain bodies stay on customer host via Brain RPC — not in CP DB (`references/brain-rpc-contract.md` §1 / §10); registry explicitly defers content to Brain RPC |
| RDS / Postgres Terraform in this repo (G4.3) | **infra_ready** | `modules/control-plane-rds/` — private subnets only, encryption, backups, Secrets Manager URL secret ARN outputs; composed in `environments/platform-staging` examples; **not operator-applied** from placeholders; production claim still needs operator apply + **G1** |

**Next gate — control-plane Postgres:** Product Postgres + G4.2 + schema boundary + deployment registry (cbd-mta.3.3) product surfaces are done. Operators may apply `modules/control-plane-rds` from a **private** root with real VPC/subnet/SG IDs. Keep matrix at **infra_ready** until applied; never mark RDS Terraform **ready** as a substitute for live private apply + G1. Do not claim G1/G1a **live** isolation complete from schema docs alone.

### 5. Platform compute (Portal runtime on AWS)

| Item | Status | Blocker detail |
|------|--------|----------------|
| Static web URL/version/SHA and backend image digests available | **partial** | `portal.web` private GH pin ready; backend digests local-only until ECR push; modules accept pins as variables |
| CloudFront/S3, ECS/ALB/service modules | **infra_ready** | `modules/portal-static-edge`, `portal-bff-service`, `portal-relay-service`, `portal-control-plane-service` — real Terraform, **not auto-applied**, not production-certified |
| Health checks wired to ALB | **infra_ready** (module) | Target groups default `/health`; live healthy targets need operator apply + images |
| Staging apply runbook | **ready** (docs) | `references/runbooks/portal-compute-staging-apply.md` |
| G8 production certified | **blocked** | Needs staging apply evidence + G1/G2/G7 matrix clearance |

**Next gate — platform compute:** Publish real pins (G7); apply from private roots per staging runbook; record G1.4/G2 staging proof before any production Portal claim. Keep desired counts at **1** until G5/G6. Control plane stays on **internal** ALB only.

### 6. Tenant isolation (data plane)

| Item | Status | Blocker detail |
|------|--------|----------------|
| Written isolation decision (tracks + tradeoffs) | **ready** | `references/tenant-isolation-decision.md` |
| `customer_account` full account boundary | **ready** (model) | Track B; customer account is hard boundary |
| `lanyard_hosted` account-per-tenant production target | **ready** (decision) | Target model documented; live vend via CT/AFT is ops-owned |
| Interim VPC + per-tenant KMS + logs + DLM | **ready** (template contract) | `production_intent` validations on tenant template |
| Multi-account factory Terraform | **infra_ready** (contract) | `modules/account-factory/` — request contract, SCP JSON, optional in-account baseline; **not** live Organizations apply; runbook `references/runbooks/account-factory.md` |
| Shared unpartitioned multi-tenant production account | **blocked** (forbidden) | Rejected by decision |

---

## Phase 2 deliverables vs non-claims

| Delivered in Phase 2 (this repo) | Must **not** be claimed done |
|----------------------------------|------------------------------|
| `modules/product-artifact-infra` | Product images published |
| `environments/platform-staging` | Hermes Lanyard tarball published |
| OIDC role **contracts** (optional create) | client-core release workflow live |
| Compatibility/docs/CI for pins + IAM smoke | RDS production-applied from examples (module is **infra_ready** only) |
| Readiness matrix (this file) | Portal CloudFront/ECS/service **production-certified** live (modules may be infra_ready) |
| Production security gate docs + `validate-production-gates.sh` | Production relay/control-plane **security** ready (G1/G2 blocked) |
| Policy-as-code + security acceptance offline suite (PS-CI) | Independent pen-test complete / production private-by-default **certified** (PS-PT **blocked**, sign-off **NOT SIGNED**) |
| Threat model + pen-test process + sign-off **template** | Signed production security sign-off or executed third-party pen test |
| Tenant isolation decision + template variables | Live CT/AFT/Organizations apply or multi-account production certification from examples alone (`modules/account-factory` is **infra_ready** contract only) |

---

## Operator sequence (when gates clear)

1. Apply `environments/platform-staging` (unique bucket name, backend, optional OIDC; full compose per `references/runbooks/platform-staging-compose.md`, or artifacts-only per `product-artifact-staging-apply.md`) — only in the **Lanyard platform staging** account; then `scripts/verify-product-artifact-staging.sh`. Keep private backend/tfvars/outputs out of git. CI validates offline only and does **not** apply.
2. Product repos publish using OIDC roles → S3 prefixes / ECR repos.
3. Record pins in a **private** compatibility file (never replace `compatibility/pins.example.yaml` with live digests) + tenant `terraform.tfvars` — procedure: `references/runbooks/pin-update.md`.
4. `bash scripts/validate-compatibility.sh` on the private pin file.
5. `bash scripts/validate-production-gates.sh` and `bash scripts/policy-as-code-security.sh` (must pass; G1/G2 remain **blocked** until **staging** evidence updates this matrix — product PRs alone are not enough; G1.3 rejects public control-plane ALB patterns).
6. Control-plane **register** → SSM/SM store secret → tenant apply with isolation vars per `tenant-isolation-decision.md` → `sudo /usr/local/sbin/company-brain-bootstrap`. Relay **rotate/revoke**: `references/runbooks/relay-secret-lifecycle.md` (deploy **#6** / Portal **#12**).
7. Execute staging proof harness rows (G1.4 / G2 S4 / G3.4) and attach evidence before any G1/G2/G3 **ready** flip.
8. Portal static edge/API/relay modules are **infra_ready** (`modules/portal-*`); apply from a private operator root per `references/runbooks/portal-compute-staging-apply.md` after pins exist. Control-plane data store module is **infra_ready** (`modules/control-plane-rds/`). Control plane stays **private** (never public ALB). Do not mark G8 **ready**/production-certified without staging evidence + G1/G2/G7.
