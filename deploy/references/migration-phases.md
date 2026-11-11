# Migration phases

This repository is the **canonical client deployment surface**. Assets below migrated from historical employee-vault `infra/` trees. The authoritative employee vault for operators is `/home/operator/Lanyard`, but **deployment must have zero employee-vault dependency**.

## Milestone 1 (client data-plane baseline) — complete

| Deliverable | Location |
|-------------|----------|
| company-brain-ec2 module | `modules/company-brain-ec2/` |
| customer-gateway-relay module | `modules/customer-gateway-relay/` |
| tier3-dedicated-relay naming/WSS contract (Milestone 1 sketch; later promoted) | `modules/tier3-dedicated-relay/` (now **infra_ready** ALB/ECS — see below) |
| Tenant template (relative sources) | `templates/tenant/` |
| Artifact bootstrap + smoke | `scripts/bootstrap-host.sh`, `scripts/smoke-bootstrap-extract.sh`, `scripts/smoke-bootstrap-inject.sh` |
| Compatibility pins + validator | `compatibility/`, `scripts/validate-compatibility.sh` |
| CI | `.github/workflows/ci.yml` |
| Runbook skeletons | `references/runbooks/` |

## Phase 2 (product release foundation) — this milestone

Deployment-owned **release landing zones** that remain valid even while product publishing is blocked. Does **not** claim RDS, Portal compute, or live product artifacts.

| Deliverable | Location |
|-------------|----------|
| Product artifact infra module (S3 + ECR + optional OIDC roles) | `modules/product-artifact-infra/` |
| Platform staging root (composed VPC/RDS/Portal + optional Valkey/DNS; relative sources; examples only) | `environments/platform-staging/` |
| Staging apply runbooks + live verify (operator-owned apply; not CI) | `references/runbooks/product-artifact-staging-apply.md`, `references/runbooks/platform-staging-compose.md`, `references/runbooks/portal-compute-staging-apply.md`, `scripts/verify-product-artifact-staging.sh` |
| Compose CI + offline smoke (fmt/validate/wiring; no apply) | `.github/workflows/ci.yml`, `scripts/smoke-platform-staging-compose.sh` |
| Release contract + readiness matrix | `references/product-artifact-release-contract.md`, `references/readiness-matrix.md` |
| Offline IAM trust/prefix smoke | `scripts/smoke-product-artifact-iam.sh` |
| Compatibility example + first real Hermes/client-core pins | `compatibility/pins.example.yaml`, `compatibility/pins.real-releases.yaml` |

### Phase 2 explicit non-claims

| Not done | Why |
|----------|-----|
| Portal static web + backend **published pins** | Product Dockerfiles + release workflows exist on Portal main; **no successful published digests/SHAs pinned yet** |
| Hermes Lanyard runtime **published** artifact | **Private GH release pin ready** (`v0.1.0-g7h2` in `pins.real-releases.yaml`); platform S3 mirror still optional next step; upstream docker.yml is NousResearch-only |
| client-core **published** tarball pin | **Private GH release pin ready** (`v0.1.0-g7c2` in `pins.real-releases.yaml`); platform S3 mirror still optional next step |
| Control-plane RDS **applied** in staging/prod | G4.1/G4.2 product done; G4.3 module **infra_ready** (`modules/control-plane-rds/`) but **not auto-applied** — operator private root + G1 still required |
| Portal CloudFront/ECS/ALB/services **applied**/production-certified | G8 modules **infra_ready** (`modules/portal-*`); apply operator-owned; needs pins + G1/G2 staging evidence |
| Production relay/control-plane **security** (G1/G2) | G1/G2 matrix rows still **blocked** (staging proof required; product code/runbooks alone insufficient); customer-gateway-relay is wiring only |
| Tier 3 dedicated relay **production-certified apply** | `modules/tier3-dedicated-relay/` is **infra_ready** (ALB/ECS/digest pin via portal-relay-service; optional DNS/WAF); not auto-applied; not production-certified until operator staging proof + G2 |
| Multi-account factory / live SCP **apply** | Contract module `modules/account-factory/` (**infra_ready**) + SCP JSON + runbook; live CT/AFT/Organizations apply stays ops-owned |

### Phase 2 security / isolation honesty (this milestone)

| Deliverable | Location |
|-------------|----------|
| Production security gates (fail-closed checklist) | `references/readiness-matrix.md`, `references/runbooks/production-security-gate.md` |
| Offline production-gate validator | `scripts/validate-production-gates.sh` |
| Tenant isolation decision (accounts/VPC/KMS/logs/backups) | `references/tenant-isolation-decision.md` |
| Isolation onboarding runbook | `references/runbooks/tenant-isolation.md` |
| Tenant template `production_intent` / isolation vars | `templates/tenant/` |

## Later phases (not fabricated here)

| Phase | Content | Expected home | Gate |
|-------|---------|---------------|------|
| **3 — Portal static edge and thin compute** | CloudFront/S3 for static web plus ALB/ECS for BFF/private control-plane/relay consuming immutable pins | `modules/portal-static-edge`, `portal-bff-service`, `portal-relay-service`, `portal-control-plane-service` (**infra_ready**; apply operator-owned) | Static web artifact + backend digests (G7), **G1** control-plane security, **G2** relay credentials for production claim; staging runbook: `references/runbooks/portal-compute-staging-apply.md` |
| **4 — Control-plane data stores** | RDS/Postgres for multi-tenant control plane | `modules/control-plane-rds/` (**infra_ready**; apply operator-owned) | Product Postgres (G4.1/G4.2) done; private VPC + G1 for production claim |
| **5 — Shared runtime state** | BFF shared sessions/state and relay routing bus backing services | Portal / deploy modules after product consumers exist | G5 for BFF scale, G6 for relay scale |
| **6 — Track B IAM** | Customer-account assume-role modules, cross-account artifact read | `modules/` future | Track B tenants; isolation model already decided in `tenant-isolation-decision.md` |
| **6b — Lanyard account factory** | Account-per-tenant / OU automation for `lanyard_hosted` production target | `modules/account-factory/` (**infra_ready** contract + optional in-account baseline; live CT/AFT ops-owned) | Production multi-client scale; runbook `references/runbooks/account-factory.md` |
| **7 — Full E2E automation** | API + SSH harness for Track A/B | `scripts/` / CI later | Stable pins + staging env |

## Product publishing (outside this repo; required for real pins)

These gates clear in **product** repositories, not by inventing deploy Terraform:

1. **Portal** — run existing static web + image-release workflows → private pin coordinates (URL/version/SHA + ECR digests); do not invent digests in deploy
2. **Hermes Lanyard** — first private GH pin **done** (`v0.1.0-g7h2`); prefer OIDC mirror to `s3://…/hermes/<version>/…` for instance-role bootstrap
3. **client-core** — first private GH pin **done** (`v0.1.0-g7c2`); prefer OIDC mirror to `s3://…/client-core/<version>/…`

Infra roles/prefixes for those publishers: Phase 2 OIDC contract (`modules/product-artifact-infra`).

## Explicit non-goals

- Reintroducing an employee-vault as a module source, bootstrap clone, or required repo URL
- Committing live account IDs, tfvars, tfstate, or customer vault content
- Floating `ref=main` module sources
- Claiming RDS is **production-applied** from example tfvars alone (module is infra_ready; apply is operator-owned)
- Claiming Portal services are **production-certified** from module presence alone (G8 is infra_ready; staging + G1/G2/G7 still required)
- Claiming production Portal/relay **security** ready while G1/G2 are blocked
- Onboarding production Lanyard-hosted clients into an unpartitioned shared account

## G0 topology freeze

Canonical production entry is `https://app.withlanyard.com/<tenant_slug>` with API traffic under `/<tenant_slug>/api/*`. Tenant subdomains are legacy compatibility only.

The Portal production target is:

- static `@lanyard/web` artifact served from private S3 through CloudFront OAC;
- public BFF for browser API traffic;
- private control-plane boundary, never directly on a public ALB;
- separate relay preserving customer-host outbound WSS;
- brain RPC for vault/settings/projects execution on the customer EC2 (contract: `references/brain-rpc-contract.md`; Hermes handlers + Portal slice in product; **G3.4 staging E2E** still required before production enablement).

Thin pilot mode may use one BFF, one private/merged control-plane boundary, one relay task, and chat only. Vault/settings/projects remain disabled unless brain RPC **handlers + vertical slice + staging E2E** pass (contract/tests alone are not enough). Production mode requires PostgreSQL (product G4.1/G4.2 done; G4.3 RDS module **infra_ready**, apply operator-owned), BFF shared state before BFF horizontal scaling, and relay bus/shared revocation before relay horizontal scaling.


## Track B customer-account access

Contract module: `modules/customer-account-access/`. Runbook: `references/runbooks/track-b-customer-account-access.md`.  
Tenant template wiring (provider assume_role + ExternalId + customer backend + artifact modes): `templates/tenant` + `bash scripts/smoke-tenant-template-wiring.sh`.

## Track A account factory (phase 6b)

Contract module: `modules/account-factory/`. Runbook: `references/runbooks/account-factory.md`. Offline smoke: `bash scripts/smoke-account-factory.sh`. Live Organizations/CT/AFT mutation is **not** claimed from examples.  
Tenant template wiring (deploy_role, KMS, state backend): `templates/tenant` + `bash scripts/smoke-tenant-template-wiring.sh`.
