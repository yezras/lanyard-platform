# Lanyard Platform

Monorepo for the Lanyard operator platform: portal frontend, platform control plane, deployment pipeline, agent sandbox infrastructure, shared contracts, and seed vault content. Backend agent products publish versioned artifacts that this repo pins, verifies, and deploys — their source lives in separate repositories.

## What this repo is

| Layer | What it does | Where it lives |
|---|---|---|
| **Portal** | Browser UI, API, relay, and control plane for operators and end users | `portal/` |
| **Platform** | Backend infrastructure that runs agents, connects them to the portal, and manages tenants | `portal/packages/{bff,relay,control-plane,backend-runtime}` + `deploy/` |
| **Deployment** | Terraform, artifact pipeline, and service definitions that actually serve the app | `deploy/modules/*`, `deploy/environments/*`, `deploy/daytona/*` |
| **Sandboxes** | On-demand Daytona sandboxes that host agents with S3-backed vaults | `deploy/daytona/agent-gateway/`, `portal/packages/control-plane/src/*daytona*`, `docs/plans/0008-daytona-agent-sandboxes/` |
| **Contracts** | Versioned interface that every backend agent must implement | `contracts/backend-runtime-v1/` |
| **Seed content** | Vault skeleton, packs, and setup assets dropped onto new tenant hosts | `client-core/` |

Backend agents (`hermes_upstream`, `hermes_lanyard`, `lanyard_agent`) are **not** vendored here. They are consumed as signed tarballs (`manifest/backend.json` + `bin/company-brain-backend`) via `compatibility/` pins and `contracts/backend-runtime-v1`.

## Architecture at a glance

```
Browser  →  CloudFront + WAF + S3 (static) ─┐
         →  ALB → BFF (Hono + Node) ────────┤→  Valkey (ElastiCache)  →  Relay (ws)  ←→  Agent gateway
         →  ALB → Relay (ws) ───────────────┘         ↕                        ↕
                                                    Control Plane (Hono + Postgres) → S3 vault + Secrets Manager
                                                          ↕
                                                     Daytona API (sandbox lifecycle)
```

*Portal static edge* serves a **TanStack Start SPA** (`/chat`, `/vault`, `/settings`) packed as `portal-web.tar.gz`. *BFF* and *Relay* are public ALB + Fargate services. *Control Plane* is an **internal-only** ALB + Fargate service backed by RDS Postgres (`portal_cp`). Product Prisma data uses a **separate** Postgres database (`portal_app`). BFF and Relay share state through Valkey/Redis. Agents connect outbound over WSS to the Relay and receive work via Brain RPC. Daytona sandboxes are provisioned lazily by the Control Plane's Instance Orchestrator — tenants never call Daytona directly.

For operational topology see [`portal/docs/deployment-resource-registry.md`](portal/docs/deployment-resource-registry.md) and [`deploy/INDEX.md`](deploy/INDEX.md).

## Stack — exact versions

All versions are read from the source manifests in this repo. Pin or bump them there; this table is a snapshot.

### Portal frontend — Meta Astryx UI

The portal web package is a **Meta Astryx** design-system UI (package namespace `@astryxdesign`).

| Concern | Technology | Version / source |
|---|---|---|
| Language | TypeScript | `^5.7.3` (web), `^5.8.3` (control-plane) |
| Runtime | Node | `>=22` (portal workspace), `>=20` (control-plane) |
| Package manager | pnpm workspaces | `portal/pnpm-workspace.yaml` → `apps/*` + `packages/*` |
| Browser build | Vite + TanStack Start (SPA) + `@vitejs/plugin-react` | `vite ^7.0.0`, `@tanstack/react-start ^1.168.32`, `@vitejs/plugin-react ^5.0.0` |
| Routing | TanStack Router file routes | `@tanstack/react-router ^1.170.18` — `/chat`, `/vault`, `/settings` ([ADR 0008](docs/adr/0008-tanstack-start-portal-web.md)) |
| UI framework | React + React DOM | `^19.0.0` |
| Design system | `@astryxdesign/core` + `@astryxdesign/theme-neutral` + `@astryxdesign/cli` | `0.1.4` (all three) |
| Styling | Tailwind CSS + `@tailwindcss/vite` | `tailwindcss ^4.1.11`, `@tailwindcss/vite ^4.1.11` |
| Icons | `@heroicons/react` | `^2.2.0` |
| Animation | `motion` | `^12.23.26` |
| Charts | `recharts` (`rechart` in deps is `3.8.0`) / `echarts >=6.1.0` (override floor) | `recharts 3.8.0`, `echarts >=6.1.0` |
| Document preview | `docx-preview`, `pptx-preview`, SheetJS `xlsx` (CDN tarball), `jszip` | `docx-preview ^0.4.0`, `pptx-preview 1.0.7`, `xlsx 0.20.3`, `jszip ^3.10.1` |
| Tests (web) | Vitest + Testing Library + jsdom | `vitest ^3.2.6`, `@testing-library/react ^16.2.0`, `jsdom ^26.0.0` |
| CLI | `pnpm -C portal astryx --` (`@astryxdesign/cli`) | `0.1.4` |
| Lint floors (patches) | `uuid >=11.1.1`, `postcss >=8.5.18`, `esbuild >=0.25.0`, `ws >=8.21.0` | `portal/package.json` `pnpm.overrides` |

Tenant web source: [`portal/apps/web/src/`](portal/apps/web/src/) — `routes/` (`__root`, `_portal/{chat,vault,settings}`), `features/{auth,chat,projects,settings,vault}`, `layout/`, `hooks/`, `api/`, `server/` (Start functions). Production artifact is still a static tarball (`portal/scripts/pack-web.sh` → `dist/client/index.html`). Platform admin is a separate Start app at [`portal/apps/admin/`](portal/apps/admin/) (Vite `:3001`, `/_protected`). See [ADR 0011](docs/adr/0011-tenant-web-and-platform-admin-apps.md).

### Portal backend services

| Service | Package | Runtime | Key deps |
|---|---|---|---|
| **BFF** | `portal/packages/bff` (`@lanyard/bff`) | Hono on Node (`@hono/node-server ^2.0.12`, `hono ^4.7.10`), `tsx watch` dev | `@aws-sdk/client-cognito-identity-provider ^3.864.0`, `ioredis ^5.11.1`, `jose ^5.10.0`, `zod ^3.25`, `ws ^8.21.0`, `yaml ^2.9.0`, workspace `@lanyard/backend-runtime`, `@lanyard/hermes-compat`, `@lanyard/shared` |
| **Relay** | `portal/packages/relay` (`@lanyard/relay`) | Node + `ws ^8.21.0` | `ioredis ^5.11.1`, `@lanyard/shared` |
| **Control Plane** | `portal/packages/control-plane` (`@lanyard/control-plane`) | Hono on Node, `tsx watch src/server.ts` | `hono ^4.7.10`, `pg ^8.16.0`, `jose ^5.10.0`, `zod ^3.25`, `@lanyard/shared` — owns `portal_cp` (tenants, RBAC, registry) |
| **Product DB** | `portal/packages/db` (`@lanyard/db`) | Prisma 7 + `pg` against Postgres `portal_app` | `@prisma/client ^7.9.0`, `@prisma/adapter-pg ^7.9.0` — **not** the control-plane database ([ADR 0009](docs/adr/0009-prisma-product-database.md)) |
| **Auth** | `portal/packages/auth` (`@lanyard/auth`) | Start middleware: BFF `lanyard_session` + Cognito admin for invites | `@aws-sdk/client-cognito-identity-provider`, workspace `@lanyard/db` / `@lanyard/shared` — no Supabase ([ADR 0010](docs/adr/0010-cognito-password-idp.md), [ADR 0011](docs/adr/0011-tenant-web-and-platform-admin-apps.md)) |
| **Shared** | `portal/packages/shared` | Pure TS types/helpers | — |
| **Backend Runtime** | `portal/packages/backend-runtime` | BFF ↔ backend adapter, Brain RPC, fake backend/harness | `@lanyard/shared` |
| **Web Settings Schema** | `portal/packages/web-settings-schema` | Pure control descriptors driven by `settings.snapshot` + capabilities | — |
| **Hermes Compat** | `portal/packages/hermes-compat` | `HERMES_*` → `BACKEND_*` env aliases, `/hermes/*` deprecation notes | — |
| **Control Plane Fields** | `portal/packages/control-plane-fields` | Backend-neutral field types, `hermes_*` alias map | — |

Local multi-service compose: [`portal/docker-compose.yml`](portal/docker-compose.yml) — `postgres:16-alpine` with two databases (`portal_cp` default + `portal_app` via [`portal/docker/postgres-init/`](portal/docker/postgres-init/)), `bff:4000`, `relay:8787`, `control-plane:3100` (loopback-only `127.0.0.1:3100:3100` per G1.3). Existing Postgres volumes do not re-run init — `CREATE DATABASE portal_app;` if the volume predates this split.

### Platform & backend — how the agent is hosted

* The **platform** is everything that lets a customer agent run and stay connected to the portal: tenant registry, presence, wake/reap, S3 vault, relay bus, and session handling.
* Backend agents are **versioned tarballs** (`s3://…/hermes-lanyard/vX.Y.Z/backend.tar.gz` + `sha256`) declared in [`deploy/compatibility/pins.example.yaml`](deploy/compatibility/pins.example.yaml) and rendered onto hosts by Terraform `user_data`. See [`contracts/backend-runtime-v1/`](contracts/backend-runtime-v1/) for the full contract (manifest, filesystem layout, Brain RPC, profiles, capabilities, secrets envelope).
* Two host modes share one gateway env contract (`GATEWAY_RELAY_*`, `VAULT_ROOT`, `BACKEND_HOME`):
  * **EC2 legacy** — `deploy/modules/company-brain-ec2` (EC2 + EBS + DLM snapshots, `company-brain-backend` systemd unit, Omnibox bubblewrap sandbox).
  * **Daytona** — on-demand sandboxes (see below). Dual-run is a per-instance `runtime_kind = ec2 | daytona` field, not a global flag.

### AWS infrastructure (what Terraform provisions)

Each row is a module under [`deploy/modules/`](deploy/modules/). All are `infra_ready` (validated offline) and composed in [`deploy/environments/platform-staging/`](deploy/environments/platform-staging/) — platform-staging is currently torn down (`OPERATOR-HOLD-LOCALHOST-ONLY.md`) to save cost; localhost is the default dev target.

| Module | AWS services |
|---|---|
| `platform-vpc` | VPC (2 AZ public/private), NAT, VPC endpoints (ECR/Logs/SM/SSM/S3) |
| `control-plane-rds` | Private encrypted RDS Postgres (`db.*`, engine `16.x`), Secrets Manager `CONTROL_PLANE_DATABASE_URL` (`portal_cp`) |
| `portal-cognito` | Cognito User Pool + confidential BFF client (`ADMIN_USER_PASSWORD_AUTH`) — **infra_ready, not auto-applied** ([ADR 0010](docs/adr/0010-cognito-password-idp.md)) |
| `portal-valkey` | Private encrypted ElastiCache Valkey/Redis (`engine valkey 8.0` or `redis 7.2`), Secrets Manager `REDIS_URL` (TLS) |
| `portal-bff-service` | Public ALB + Fargate, image **digest** pin, `/health`, `REDIS_URL` via secrets map; `COGNITO_CLIENT_SECRET` via secrets map only |
| `portal-relay-service` | Public ALB + Fargate, digest pin, `/health`, `REDIS_URL` (bus/JTI/leases) |
| `portal-control-plane-service` | **Internal** ALB + Fargate only, digest pin, `/health` — never public (G1.3) |
| `portal-static-edge` | CloudFront OAC + private S3, ordered behaviors `/*/api/*` + `/api/*`, SPA routing |
| `portal-dns-tls` | Route53 + ACM (us-east-1 CloudFront cert + regional ALB certs) |
| `portal-waf` | WAFv2 WebACL (CloudFront + regional ALBs) — CommonRuleSet + KnownBadInputs + optional rate-based |
| `product-artifact-infra` | Private S3 artifact bucket (`hermes/`, `client-core/`, `portal-web/`, versioning + Object Lock) + Portal ECR (immutable tags) + optional GHA OIDC |
| `security-observability` | VPC Flow Logs, GuardDuty → SNS, security SNS, snapshot-age checks |
| `customer-gateway-relay` | Wires `GATEWAY_RELAY_*` from control-plane provision (egress-only WSS) |
| `customer-account-access` | Cross-account `sts:AssumeRole` + `ExternalId` + artifact-read scope (Track B) |
| `account-factory` | Account-per-tenant factory contract + SCP JSON (Track A) |
| `tier3-dedicated-relay` | Optional per-tenant dedicated relay ALB + Fargate (infra_ready, not auto-applied) |
| `staging-document-server` | Staging ONLYOFFICE Document Server — public Docs ALB + Fargate, JWT via SM |
| `company-brain-ec2` | Legacy per-tenant EC2 host (EBS, DLM, Tailscale, Omnibox, `company-brain-backend` units) — skipped when `runtime_kind=daytona` |

Shared artifact + staging docs: [`docs/architecture/portal-document-server-topology.md`](docs/architecture/portal-document-server-topology.md), [`deploy/docs/`](deploy/docs/).

### Daytona Sandboxes

Daytona replaces always-on per-tenant EC2 with on-demand sandboxes provisioned through the Control Plane's **Instance Orchestrator** (a Daytona managed-CP client). Tenants never call Daytona.

* **Image (Bucket A)** — [`deploy/daytona/agent-gateway/`](deploy/daytona/agent-gateway/) — `Dockerfile` (linux/amd64), `entrypoint.sh`, `install-agent-runtime.sh`, `fake-gateway.sh`. Product CLIs are **prebaked** in the snapshot; no install-on-boot. Published to ECR via `.github/workflows/agent-gateway-image.yml`.
* **Entrypoint contract** — wait until `VAULT_ROOT` is readable (poll `LANYARD_ENTRY_VAULT_WAIT_SEC=60`, optional `LANYARD_ENTRY_VAULT_READY_FILE`), refresh `$BACKEND_HOME/gateway.env` (`0600`, secrets never logged), `exec company-brain-backend gateway`. See [`deploy/daytona/agent-gateway/README.md`](deploy/daytona/agent-gateway/README.md).
* **Vault (Bucket B)** — Lanyard S3 Mountpoint, opaque per-tenant prefix `tenants/{tenant_id}/vault/` under `lanyard-mocklab-vault-123456789012` (pilot). Mount is guest-side (`ensure-mounted` is idempotent; no remount tax each wake).
* **Wake inject (Bucket C)** — `GATEWAY_RELAY_URL`, `GATEWAY_RELAY_ID`, `GATEWAY_RELAY_SECRET`, `VAULT_ROOT`, `BACKEND_HOME` are injected on wake; `LANYARD_ENTRY_*` helpers are stripped before gateway exec.
* **Lifecycle** — `instance_id` (permanent, Control Plane) vs `sandbox_id` (ephemeral, Daytona). Provision leaves `sandbox_id` null; first `ensure_online` creates the sandbox + mounts the vault. Idle grace `30 min`, auto-stop, warm pools. Docs: [`docs/plans/0008-daytona-agent-sandboxes/overview.md`](docs/plans/0008-daytona-agent-sandboxes/overview.md), [`presence-state-machine.md`](docs/plans/0008-daytona-agent-sandboxes/presence-state-machine.md), [`provision-runbook-daytona.md`](docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md).

Pinned pilot snapshot: `4c16521a la-pilot-20260806-cfg2` (see `deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml`).

### Authentication

| Surface | Mechanism | Where |
|---|---|---|
| **Password IdP** | AWS Cognito User Pool; BFF `AdminInitiateAuth` / `AdminCreateUser` then mints `lanyard_session`. Email/password AuthView is unchanged. Hosted UI / Amplify are not used. Local-dev without Cognito may fall back to control-plane password hashes. | `portal/packages/bff/src/{password-auth,cognito-aws,cognito-fake}.ts`, `deploy/modules/portal-cognito/` ([ADR 0010](docs/adr/0010-cognito-password-idp.md)) |
| **Browser → BFF** | `lanyard_session` cookie (Hono `hono/cookie`), `lanyard_csrf` double-submit, `SessionStore` (memory single-task / Valkey `bff:v1:sess:*` multi-task, 7-day sliding TTL, 30-day absolute), `tenant-resolver` | `portal/packages/bff/src/session.ts`, `session-factory.ts`, `middleware/*`, `redis-session-store.ts` |
| **BFF → Control Plane** | `CONTROL_PLANE_SERVICE_TOKEN` (shared header), `CONTROL_PLANE_URL` | `portal/packages/bff/src/control-plane-client.ts`, `portal/docker-compose.yml` |
| **Gateway → Relay (WSS)** | HMAC `HWS` upgrade token with **JTI replay resistance** — legacy `base64url(gatewayId:exp:sig)` + `v1j` `base64url(gatewayId:exp:jti:sig)` (`jti` ≥22 chars, 16 random bytes), `MAX_UPGRADE_TTL 300s`, `JTI_SKEW 30s`, legacy gated by `policy.requireJti` / `RELAY_ALLOW_LEGACY_UPGRADE_TOKEN` | `portal/packages/relay/src/auth.ts`, `jti-store.ts`, `relay-auth-policy.ts`, `portal/docs/adr/g2a-relay-replay-resistance.md` |
| **Relay bus** | Valkey-backed JTI store + presence + leases; `ws ^8.21.0` + `ioredis ^5.11.1` | `portal/packages/relay/src/{jti-store,relay-session,chat-delivery-hub}.ts` |
| **Backend secrets** | AWS Secrets Manager JSON envelope (`schema_version: 1`, `env`, optional `oauth`, `custom_providers`, `config_secret_overlay`, `files`) materialized to `$BACKEND_HOME/.env.secrets` + `$HERMES_HOME/auth.json` / `oauth.enc` at `0600` | `contracts/backend-runtime-v1/secrets-envelope.schema.json`, `deploy/modules/company-brain-ec2/scripts/materialize-backend-secrets.sh` (+ Python harness) |
| **Multi-provider** | LiteLLM proxy (`deploy/litellm/config.yaml`) — `OPENAI_API_KEY` / `XAI_API_KEY` / `ANTHROPIC_API_KEY` from env, `LITELLM_MASTER_KEY` for Agent↔proxy, `LANYARD_OAUTH_KEY` for `oauth.enc`, custom providers via `key_env`/`api_key_env` | `deploy/litellm/`, `docs/architecture/lanyard-agent-multi-provider-secrets.md` |
| **Control Plane auth** | `CONTROL_PLANE_AUTH_MODE`, `jose ^5.10.0` JWTs, `rbac.ts` | `portal/packages/control-plane/src/{auth-mode,rbac,google-auth}.ts` |
| **Isolation** | Omnibox bubblewrap profiles (`scripts/omnibox/`, `deploy/modules/company-brain-ec2/scripts/ensure-omnibox.sh`), capability-gated tool allowlists, Vault path ACL (contributor vs admin) | `docs/architecture/portal-active-human-edit-agent-write-policy.md` |

Never commit real secrets. Local defaults live only in `.env.mocklab-agent-dev` (lab only). Cloud injects via Secrets Manager / env files with `0600`.

### Deployment & Terraform

* **Artifact coordinates** — `backend: { kind, version, url, sha256 }` + `client_core: { version, url, sha256 }` in `deploy/compatibility/pins.*.yaml` → Terraform `backend_artifact_*` vars → EC2 `user_data` renders and `company-brain-bootstrap` downloads, verifies (`sha256` + optional Ed25519 attestation when `REQUIRE_ARTIFACT_ATTESTATION=1`), installs, seeds the vault, writes provenance, and starts `company-brain-backend` / `hermes-gateway` systemd units.
* **Terraform roots** — [`deploy/environments/platform-staging/`](deploy/environments/platform-staging/) (VPC + RDS + BFF/relay/CP + edge + optional Valkey/DNS/WAF) and [`deploy/deployments/mocklab/`](deploy/deployments/mocklab/) (mocklab tenant). Template for new tenants: [`deploy/templates/tenant/`](deploy/templates/tenant/).
* **Build & push** — Portal images are Fargate + **ECR digest pins** (never `:latest` in production). Daytona gateway is a separate `linux/amd64` ECR image + Daytona snapshot.
* **Offline checks** — `bash scripts/validate.sh` covers docs links, pin schemas, contract fixtures, harness, tarball conformance, bootstrap/systemd scaffolds, litellm, vault mount IAM, and staging compose — no network required. Policy-as-code guards (`scripts/policy-as-code-security.sh`, `scripts/validate-production-gates.sh`) enforce private-by-default, no public control-plane ALB, S3 TLS, IMDS, egress, and attestation gates.
* **Document server** — Lab `dev/lab-shared-compose-ds` (Compose) and staging `modules/staging-document-server` (ALB + Fargate, JWT via SM) for ONLYOFFICE inline preview. See [`docs/architecture/portal-document-server-topology.md`](docs/architecture/portal-document-server-topology.md).

## Repository layout

```
.
├── portal/                       # Portal monorepo (pnpm workspace root)
│   ├── packages/
│   │   ├── web/                  # React 19 + Vite 7 + TanStack Start SPA + Astryx 0.1.4 + Tailwind 4
│   │   ├── bff/                  # Hono BFF (Cognito password, session, Brain RPC, vault, office)
│   │   ├── db/                   # Prisma product schema → Postgres portal_app
│   │   ├── relay/                # WebSocket relay (JTI, presence)
│   │   ├── control-plane/        # Tenant/presence/orchestrator API + Postgres portal_cp
│   │   ├── shared/               # Wire types
│   │   ├── backend-runtime/      # Backend adapter + fake backend
│   │   ├── web-settings-schema/  # Settings control descriptors
│   │   ├── hermes-compat/        # HERMES_* compat aliases
│   │   └── control-plane-fields/ # Backend-neutral field types
│   ├── docker-compose.yml        # postgres (portal_cp + portal_app) + bff + relay + control-plane
│   └── docs/                     # Portal ADRs, policies, runbooks
├── deploy/                       # Terraform + bootstrap + Daytona + LiteLLM
│   ├── modules/                  # Validated modules (see AWS table above; includes portal-cognito)
│   ├── environments/platform-staging/
│   ├── deployments/{mocklab,_example-tenant}/
│   ├── daytona/agent-gateway/    # Bucket A image + entrypoint
│   ├── litellm/                  # Multi-slot proxy seed
│   ├── compatibility/            # Pin schemas + examples
│   └── artifacts/demo-vault/     # Lab seed vault fixture
├── client-core/                  # Vault seed, packs (crm, gws, wacli, …), skills
├── contracts/backend-runtime-v1/ # Artifact manifest, config, profiles, Brain RPC, secrets envelope, harness
├── contracts/connectors-v1/      # Portal connector enums + command → action_class map
├── compatibility/                # Example pins (legacy path — canonical is deploy/compatibility)
├── docs/
│   ├── adr/                      # 0001–0010 + portal ADRs
│   ├── architecture/             # Current service & contract docs (see below)
│   ├── plans/                    # Active plans (0014 Start/Prisma/Cognito, Daytona, …)
│   └── runbooks/                 # Local dev, secrets hygiene, relay lifecycle
├── .github/workflows/            # ci, release, conformance, agent-gateway-image
└── scripts/validate.sh           # Offline-by-default gate (no network)
```

### What lives here vs. what is external

* **In this repo** — everything above. It is the only place that defines the platform contract, the deployment topology, and the portal product tree.
* **External (versioned artifacts only)** — backend agent source (`hermes_upstream`, `hermes_lanyard`, `lanyard_agent`) is consumed as `backend.tar.gz` releases. Do not vendor it; add a pin and run the conformance harness.

## Contracts

`contracts/backend-runtime-v1/` is the single source of truth for a backend to be swappable:

* `artifact-manifest.schema.json` + `examples/*.manifest.json` — `manifest/backend.json` inside the tarball
* `filesystem-layout.md` — `BACKEND_HOME` tree and `HERMES_HOME` alias
* `config.schema.json` + `profiles.schema.json` + `capabilities.schema.json`
* `brain-rpc.schema.json` + `examples/brain-rpc.*.json` — seven required methods (`ping`, `health`, `vault.*`, `settings.*`, `projects.*`, `capabilities`)
* `secrets-envelope.schema.json` — AWS SM `SecretString` shape (`env` + `oauth` + `custom_providers` + `files`)
* `harness/` — offline fake relay + Brain RPC conformance (`python3 contracts/backend-runtime-v1/harness/run_tests.py`)
* `conformance.md` + `docs/architecture/backend-compatibility-matrix.md` — kind×version×contract×capability matrix

Harness quick check (no network):

```bash
python3 contracts/backend-runtime-v1/harness/run_tests.py
python3 contracts/backend-runtime-v1/harness/run_brain_rpc_conformance.py
bash scripts/validate.sh
```

## Local development

```bash
# Portal (pnpm workspace rooted at portal/)
pnpm -C portal install
pnpm -C portal build
pnpm -C portal test                  # all workspace packages
pnpm -C portal --filter @lanyard/bff test
pnpm -C portal --filter @lanyard/web test
pnpm -C portal --filter @lanyard/web build
bash portal/scripts/pack-web.sh --version v0.0.0-local   # static portal-web tarball (index.html)

# Full local stack (postgres + bff + relay + control-plane)
docker compose -f portal/docker-compose.yml up -d postgres
docker compose -f portal/docker-compose.yml build && docker compose -f portal/docker-compose.yml up -d
curl -sf http://127.0.0.1:4000/health   # bff
curl -sf http://127.0.0.1:8787/health   # relay
curl -sf http://127.0.0.1:3100/health   # control-plane (127.0.0.1 only)

# Product Prisma DB (separate from portal_cp)
# New volumes: init script creates portal_app. Existing volumes:
#   docker compose -f portal/docker-compose.yml exec postgres psql -U portal -c 'CREATE DATABASE portal_app;'
export DATABASE_URL=postgres://portal:portal@127.0.0.1:5432/portal_app
pnpm -C portal --filter @lanyard/db exec prisma validate
pnpm -C portal --filter @lanyard/db migrate

# Offline repo gate (no network)
bash scripts/validate.sh
```

Docs entry points: [`portal/docs/README.md`](portal/docs/README.md), [`docs/runbooks/local-dev-monorepo.md`](docs/runbooks/local-dev-monorepo.md), [`docs/architecture/end-to-end-architecture.md`](docs/architecture/end-to-end-architecture.md).

AWS staging is currently **torn down** for cost. Do not `terraform apply` `platform-staging` or raise ECS desired counts unless an operator explicitly lifts the hold (`deploy/environments/platform-staging/OPERATOR-HOLD-LOCALHOST-ONLY.md`).

## Docs — what to read

Current docs only — historical planning archives are not linked here.

* **ADRs:** [`docs/adr/`](docs/adr/) (0001 monorepo boundary, 0002 external backends, 0003 runtime v1, 0004 workspace paths, 0006 document server, 0007 model routing, [0008 Start SPA](docs/adr/0008-tanstack-start-portal-web.md), [0009 Prisma `portal_app`](docs/adr/0009-prisma-product-database.md), [0010 Cognito password IdP](docs/adr/0010-cognito-password-idp.md), [0011 tenant web + admin apps](docs/adr/0011-tenant-web-and-platform-admin-apps.md))
* **Architecture:** [`docs/architecture/end-to-end-architecture.md`](docs/architecture/end-to-end-architecture.md), [`backend-runtime-contract.md`](docs/architecture/backend-runtime-contract.md), [`backend-compatibility-matrix.md`](docs/architecture/backend-compatibility-matrix.md), [`workspace-map.md`](docs/architecture/workspace-map.md), [`ci-and-release.md`](docs/architecture/ci-and-release.md)
* **Portal:** [`portal/docs/`](portal/docs/) — `brain-rpc.md`, `control-plane-db-migration.md`, `deployment-resource-registry.md`, `policies/log-redaction.md`
* **Daytona:** [`docs/plans/0008-daytona-agent-sandboxes/overview.md`](docs/plans/0008-daytona-agent-sandboxes/overview.md), [`gateway-env-contract.md`](docs/plans/0008-daytona-agent-sandboxes/gateway-env-contract.md), [`provision-runbook-daytona.md`](docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md)
* **Cloudflare restart:** [`docs/plans/0020-cloudflare-platform-revamp/overview.md`](docs/plans/0020-cloudflare-platform-revamp/overview.md) (`lp-bhcg`) — localhost first, then D1, R2, Durable Objects, and Workers. Does not lift the staging hold.
* **Start / Prisma / Cognito:** [`docs/plans/0014-tanstack-start-prisma/overview.md`](docs/plans/0014-tanstack-start-prisma/overview.md)
* **Runbooks:** [`docs/runbooks/`](docs/runbooks/) — `local-dev-monorepo.md`, `backend-runtime-secrets.md`, `relay-jti-dual-accept.md`, [`daytona-sandbox-archive-hygiene.md`](docs/runbooks/daytona-sandbox-archive-hygiene.md), [`provision-prod-tenant.md`](docs/runbooks/provision-prod-tenant.md) (second tenant in prod; MockLab is UAT)

## Security notes

See the full assessment in the hand-back below. Highlights:

* Relay JTI replay resistance is dual-accept (legacy → `v1j`); production should set `policy.requireJti` / `RELAY_ALLOW_LEGACY_UPGRADE_TOKEN=0`.
* Control Plane is internal-ALB only; `portal/docker-compose.yml` enforces `127.0.0.1:3100:3100`. Never publish it on a public ALB or CloudFront origin.
* Secrets never appear in git/tfvars/outputs — they live in Secrets Manager envelopes and are materialized to `0600` files on the host. `COGNITO_CLIENT_SECRET` must go through the BFF secrets map, never plaintext ECS env. Prisma `DATABASE_URL` (`portal_app`) must not reuse `CONTROL_PLANE_DATABASE_URL` (`portal_cp`).
* WAF + CloudFront OAC + private artifact buckets (Object Lock, no public ACLs) are the edge defaults.
* `pnpm.overrides` floor patched transitives (`uuid`, `echarts`, `postcss`, `esbuild`, `ws`) per `lp-p37.12`; re-audit on dependency bumps.

## License

Private. All rights reserved.
