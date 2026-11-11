# Lanyard Platform — End-to-End Architecture

## Overview

Lanyard is a **multi-tenant “Company Brain” platform**: each customer (tenant) gets an isolated AI agent host (usually an EC2 “Company Brain”) plus a shared **Portal** edge for chat, vault, and settings.

The monorepo owns **Portal**, **deploy**, **client-core** (vault seed content), and the **backend-runtime-v1 contract**. Backend agent *source* (Hermes-Lanyard, Lanyard Agent, Hermes upstream) stays **external** and is installed as versioned tarballs.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PLATFORM PLANE (Lanyard AWS)                        │
│  CloudFront → S3 (static web)                                               │
│            → ALB → BFF (public API)                                         │
│            → ALB → Relay (public WSS for gateways)                          │
│  Private: Control Plane + RDS  ·  optional Valkey  ·  WAF/DNS/TLS           │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ egress-only WSS (host dials out)
┌───────────────────────────────▼─────────────────────────────────────────────┐
│                    TENANT DATA PLANE (per tenant EC2)                       │
│  Hermes gateway (systemd) · vault on EBS · profiles/RBAC · model APIs       │
│  No inbound Portal ports. Chat + Brain RPC over the same relay session.     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Big picture: who talks to whom

```
 Browser (tenant user)
    │  HTTPS
    ▼
 CloudFront
    ├── static SPA  →  S3 (portal-web)
    └── /*/api/*    →  public ALB → BFF
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
    Control Plane      Relay            (office DS lab/prod)
    (private only)   (public WSS edge)
          │               ▲
          │               │ WSS /relay  (customer host dials OUT)
          │               │
          └──── metadata only ──── Customer EC2 Company Brain
                                   (Hermes gateway + vault EBS)
```

**Hard rules**

| Rule | Meaning |
|------|---------|
| Browser never hits Control Plane | Only BFF (service token) talks to CP |
| Browser never hits EC2 | No public inbound to the brain host |
| Host is egress-only | Gateway opens WSS to Relay; Lanyard does not open host ports for Portal |
| CP is private-only | Never on a public ALB (G1) |

---

## 2. Portal packages (front end + edge)

| Package | Role | Exposure |
|---------|------|----------|
| `@lanyard/web` | Tenant React SPA: **Chat · Vault · Settings** plus ops routes at `/admin` (`portal/apps/web`) | Public (S3 + CloudFront) |
| `@lanyard/admin` | Local Start scaffold (`portal/apps/admin`, `/_protected`). Not the production host ([ADR 0014](../adr/0014-platform-ops-console-on-web-tarball.md)) | Vite `:3001` only |
| `@lanyard/bff` | Session, tenant routing, chat, vault proxy, Brain RPC, `/api/admin/*` | Public ALB |
| `@lanyard/control-plane` | Tenants, users, roles, gateway instances, deploy registry | **Private** |
| `@lanyard/relay` | WebSocket bus to customer gateways | Public WSS (+ private internal HTTP) |
| `@lanyard/shared` | Wire types, tenant host helpers, vault ACL helpers | Library |
| `@lanyard/backend-runtime` | Backend-neutral host-ops (Brain RPC composition) | Inside BFF |

### Admin page — how it fits

Product UI is still the per-tenant app. Frozen ops-console design: [dual-auth-credential-planes.md](./dual-auth-credential-planes.md) and [portal-connectors.md](./portal-connectors.md). URL is `/admin`, not `/_platform`. SPA routes + CloudFront `/admin*` shipped (`lp-2qs.3`). Secrets and tenant pages are follow-ons.

| What people call “admin” | What it actually is |
|--------------------------|---------------------|
| **Tenant admin (role)** | Portal role `admin` + Hermes profile `admin`. Team grants on Connectors, not a second app |
| **Connectors UI** | Frozen design. Tools tab renamed. Google / HubSpot / WhatsApp. Tenant cookie |
| **Settings / Tools today** | Host snapshot (skills, models, MCP, integrations) |
| **Lanyard ops** | `app.withlanyard.com/admin` + `lanyard_ops_session`. Same web tarball. Shell shipped (`lp-2qs.3`); secrets/tenant pages not yet |
| **Ops / provisioning today** | Control-plane HTTP APIs + deploy runbooks |

Local `@lanyard/admin` remains a scaffold. Production hosting is CloudFront static `/admin` ([ADR 0014](../adr/0014-platform-ops-console-on-web-tarball.md)).

---

## 3. Multi-tenant model (and “sub-multi-tenant”)

### Tenant = company isolation boundary

Control-plane entities (Postgres):

| Entity | Scope |
|--------|--------|
| `tenants` | Global root (`tenant_slug`, retention, `relay_tier`) |
| `users` | Per tenant (`email` unique within tenant; optional password / `google_sub`) |
| `roles` + `user_roles` + path prefixes | Per tenant RBAC |
| `gateway_instances` | Per tenant EC2 brain identity + secret **hash** |
| `tenant_deployments` / `tenant_resource_refs` | Hosting track, AWS refs, pin versions |
| `projects`, `session_share_grants`, `audit_log` | Per tenant metadata |

URL identity (not body spoofing):

- Path-first: `https://app.withlanyard.com/<tenant_slug>/…`
- Legacy: `https://<slug>.withlanyard.com/…`

Sessions are **bound to `tenant_id`**. Switching host/path to another tenant invalidates the session for that cookie.

### Is there sub-multi-tenant?

**Yes — role-based multi-user *inside* one tenant. No nested companies.**

```
Platform
 └── Tenant A (slug: acme)
      ├── Users: alice@acme, bob@acme
      ├── Roles: admin, contributor  (+ path_prefixes e.g. /Projects/Legal)
      ├── Gateway instance(s) → one primary EC2 brain
      └── Vault on that host (ACL by profile + path prefixes)
 └── Tenant B  (fully separate DB rows, host, KMS/account)
```

| Layer | What it enforces |
|-------|------------------|
| **Portal RBAC** | CP roles → `admin` vs `contributor` permissions (manage roles/instances vs user-scoped only) |
| **Hermes profiles on host** | Capability seeds: admin gets `vault_full`, `shell_exec`, ops; contributor gets chat + vault R/W only |
| **Path prefixes** | Vault ACL: union of role prefixes; stamped by BFF on Brain RPC / chat inject |
| **AWS isolation** | Account-per-tenant (target) or VPC-per-tenant interim — not shared vault disks |

**Not** multi-tenant-on-one-EC2: production model is **one brain host (or account) per tenant**, with many users/roles *on that tenant*.

---

## 4. How features / config differ per tenant

Not one “feature flags” table. Stacked layers:

| Layer | Per-tenant knobs |
|-------|------------------|
| **Control plane** | Retention, relay tier (shared vs dedicated WSS), roles/users |
| **Deploy TF** | Hosting track, VPC/account, instance size, artifact pins, Omnibox on/off, KMS |
| **Host runtime** | Backend kind/version, `config.yaml`, skills, models, cron, packs under vault |
| **Capabilities** | BFF `GET /api/context` → backend capabilities / UI affordances (chat, vault, settings, projects…) |
| **Platform env** | e.g. `BRAIN_RPC_ENABLED` (platform-wide gate today, not a CP column) |

Web is supposed to branch on **capabilities / `ui.can.*`**, not `if (hermes)`.

---

## 5. Auth, permissions, login ↔ tenants

```
User → BFF POST /api/auth/login  or  Google OIDC via BFF
         → CP POST /auth/login  or  /auth/google/callback
         → session cookie lanyard_session (tenant-bound)
         → each API: resolve tenant from Host/path
                    → load RBAC from CP
                    → stamp hermes_profile + path_prefixes on host ops
```

| Mechanism | Detail |
|-----------|--------|
| **Password** | CP stores hash; BFF injects resolved `tenant_id` |
| **Google OIDC** | BFF starts OAuth; CP verifies id_token / code; user tied by `google_sub` + tenant |
| **Service auth** | BFF↔CP: `CONTROL_PLANE_SERVICE_TOKEN`; BFF↔Relay: `RELAY_INTERNAL_TOKEN` |
| **Ops** | `INTERNAL_OPS_TOKEN` for retention / relay-tier mutations |
| **Roles** | `POST /tenants/:id/roles`, `PUT …/users/:userId/roles` |
| **Effective profile** | First assigned role’s `hermes_profile` (by role name sort); **path prefixes = union** of all roles |

Dual credential planes (architecture):

| Plane | What | System of record |
|-------|------|------------------|
| **A** | Tenant-shared model API keys | AWS Secrets Manager envelope → host materialize |
| **B** | Per-user SaaS integrations | CP Postgres (encrypted) — design; not fully productized in tree |

---

## 6. Service communication & API map

### A. Chat (agent turn)

```
Browser  POST /api/chat/threads/:id/messages
  → BFF (+ session + RBAC)
  → CP GET /internal/tenants/:id/primary-instance
  → Relay POST /internal/deliver-inbound
  → WSS type=inbound → Hermes on EC2
  → WSS type=outbound → Relay ChatDeliveryHub
  → Browser GET /api/chat/threads/:id/events  (SSE via BFF → Relay internal)
```

### B. Host ops (vault / settings / projects) — Brain RPC

```
Browser  GET /api/brain/*  or  /api/vault/*  /api/settings/*  (when BRAIN_RPC_ENABLED)
  → BFF stamps auth subject from CP RBAC (never trusts browser)
  → Relay POST /internal/brain-rpc
  → WSS brain_rpc_request → host handlers
  → brain_rpc_result
```

Required Brain RPC methods (v1):  
`brain.ping`, `brain.health`, `vault.list|stat|read`, `settings.snapshot`, `projects.list`

### C. Key BFF browser APIs

(under `/api` or `/:tenantSlug/api`)

| Area | Paths |
|------|--------|
| Health | `GET /health`, `GET /ready` |
| Context | `GET /context` |
| Auth | `/auth/csrf`, `/auth/login|register|logout|me`, `/auth/google*` |
| Chat | `/chat/threads…`, messages, cancel, **SSE** `/events`, history, shares |
| Vault | `/vault/*` |
| Settings | `/settings/*` |
| Brain | `/brain/ping`, `/brain/health` |
| Projects | `/projects/*`, `/hermes/projects` |
| Org | `/org/members` |

### D. Control plane (private)

| Area | Paths |
|------|--------|
| Tenants | `POST /tenants`, `GET /tenants/:id`, `…/by-slug/:slug` |
| Instances | `…/instances/register` (alias `provision`), `rotate`, `revoke`, `deprovision` |
| Auth | `POST /auth/login`, `POST /auth/google/callback` |
| RBAC | `…/roles`, `…/users/:id/roles` |
| Deploy registry | `…/deployment`, `…/resources` |
| BFF internal | `/internal/tenants/by-slug/*`, `…/primary-instance`, `…/rbac`, projects, session-shares |
| Ops | `…/retention`, `…/relay-tier` (+ internal ops token) |

### E. Relay

| Path | Purpose |
|------|---------|
| **WS** `/relay` | Customer gateway dial-out |
| `POST /internal/deliver-inbound` | Chat → host |
| `POST /internal/interrupt-inbound` | Cancel |
| `POST /internal/brain-rpc` | Host ops hop |
| `GET /internal/chat/:id/events` | Internal SSE for BFF |
| `POST /internal/instances/:id/revoke` | Force close **4401** |

### F. Yes, there is a BFF and a control plane and WebSockets

| Service | Kind | Job |
|---------|------|-----|
| **BFF** | HTTP + SSE | Public API façade, sessions, stamps auth, proxies host ops |
| **Control plane** | Private HTTP + RDS | Tenant registry, users/RBAC, gateway credentials (hashes), deploy metadata |
| **Relay** | WebSocket + internal HTTP | Multiplexes many EC2 gateways; chat frames + Brain RPC |
| **Valkey (optional)** | Redis-compatible | Multi-instance BFF sessions (G5), multi-relay bus/JTI/leases (G6) |

---

## 7. Backend that reaches EC2 — and AWS around it

**Yes:** the path is **BFF → Relay (internal) → WSS → EC2 gateway**. There is no separate “SSH into EC2 for UI.”

### Platform AWS (Portal)

| Service | Use |
|---------|-----|
| CloudFront + S3 OAC | Static web |
| ALB + ECS Fargate | BFF, Relay (public); CP (**internal ALB only**) |
| RDS Postgres | Control-plane DB |
| ElastiCache Valkey | Shared state (optional / G5–G6) |
| ECR | Immutable image digests for portal services |
| Secrets Manager | DB URL, REDIS_URL, service tokens refs |
| Route53 + ACM | DNS/TLS |
| WAF v2 | Edge + regional ALBs |
| VPC + endpoints | Private subnets, NAT/endpoints |

Most portal modules are marked **infra_ready**, operator-applied — not auto-applied from git examples.

### Tenant AWS (Company Brain)

| Service | Use |
|---------|-----|
| **EC2** | Hermes / backend gateway |
| **EBS** (encrypted, optional dedicated data volume) | Root + vault data |
| **DLM** | Daily volume snapshots |
| **KMS** | Per-tenant CMK (production expectation) |
| **SSM** | Session Manager access; SecureString for relay secret |
| **IAM instance role** | Artifact S3 read, secret fetch, no shared multi-tenant roles |
| **CloudWatch** | Status / optional snapshot-age alarms |
| **S3** (platform artifacts) | Backend + client-core tarballs |
| Optional Tailscale | Secondary access (not primary) |

---

## 8. Storage, snapshots, EFS — direct answers

| Question | Answer |
|----------|--------|
| **Is vault on Elastic File System (EFS)?** | **No.** No EFS in deploy Terraform. Vault lives on **local EBS** (root and/or data volume). |
| **Are there backups?** | **Yes — DLM daily EBS snapshots** (default on), tagged `Backup=daily` + `Project=<project_name>`, retain ~14 days. |
| **“Three backups” / EFS as three backups?** | **Not in this architecture.** No EFS triple-backup design. What exists: (1) DLM primary, (2) optional AWS Backup *vault* in account-factory baseline (does not replace DLM), (3) optional opt-in cross-region/DR copy (default **off**). |
| **RPO / RTO (documented defaults)** | ~**24h** RPO / ~**4h** RTO; restore runbooks + quarterly drill |
| **Chat transcripts** | BFF store + relay hub buffer (not long-term SoT on relay) |
| **CP DB** | RDS automated backups (platform plane) |

```
Vault durability (tenant):
  Live:  EBS volume (encrypted, Project-tagged)
  Backup: DLM snapshot daily (same account/region by default)
  Restore: scripts/restore-from-snapshot.sh + DLM restore drill
  NOT: EFS, GitHub as backup, shared multi-tenant snapshot sink
```

---

## 9. How services are deployed

### Platform plane

`deploy/environments/platform-staging/` composes:

```
product-artifact-infra → platform-vpc → control-plane-rds
  → portal-control-plane (private)
  → portal-bff + portal-relay (public ALBs)
  → portal-static-edge
  → optional Valkey / DNS-TLS / WAF
```

Images pinned by **digest** (not `latest`).

### Tenant plane

```
templates/tenant  →  copy to deployments/<tenant_slug>
  modules: company-brain-ec2 + customer-gateway-relay
           (+ security-observability, optional)
```

**Artifact pins** (YAML → host env): backend (Hermes-Lanyard) + **separate** client-core pin.

Isolation tracks:

| Track | Isolation |
|-------|-----------|
| `lanyard_hosted` | Account-per-tenant (target); interim VPC-per-tenant + unique project + KMS + DLM tags |
| `customer_account` | Customer’s AWS account is the hard boundary |

---

## 10. Onboarding a new tenant

```
1. CP  POST /tenants  { tenant_slug, display_name, hosting_track }
2. CP  POST /tenants/:id/instances/register
      → instance_id, one-time secret, relay_wss_url, tier
3. Store secret in SSM (not Terraform tfvars)
4. Seed roles admin/contributor; assign users
5. TF: copy templates/tenant → apply EC2 + relay wiring
6. Bootstrap on host (SSM):
      download/verify Hermes + client-core
      install /opt/hermes-lanyard, seed /opt/company-brain
      ensure profiles, hardening, .env with GATEWAY_RELAY_*
      systemctl enable --now hermes-gateway
7. Portal smoke: https://app.withlanyard.com/<slug> → login → chat
8. Offboard: revoke instance / deprovision → WS 4401 → delete secret → TF destroy when done
```

---

## 11. Backend agent harness — and the EC2 host

### Two meanings of “harness”

| Meaning | What it is |
|---------|------------|
| **Conformance harness** | `contracts/backend-runtime-v1/harness/` — offline fake relay + FakeBrainRpcHost for CI. **Not** production. |
| **Host agent runtime** | External product binary (`hermes gateway` / `company-brain-backend gateway`) on EC2 that runs the agent loop, tools, models, vault I/O, Brain RPC host. |

### What the host looks like

```
EC2 (tenant)
├── /opt/hermes-lanyard/          # install tree (legacy product path)
│     or /opt/company-brain-backend/versions/<ver> + current/
├── BACKEND_HOME  (= HERMES_HOME for Hermes)
│     config.yaml, projects.db, profiles/{admin,contributor}.json
│     skills/, cron/, logs/, sessions/, workspace/
│     .env, .env.secrets, auth.json
├── VAULT_ROOT=/opt/company-brain # client-core seed + live vault (separate pin)
└── systemd: hermes-gateway.service  (or company-brain-backend.service)
      User=hermes | company-brain
      Egress: model APIs + WSS to relay
```

Gateway **dials out** with `GATEWAY_RELAY_URL`, `GATEWAY_RELAY_ID`, `GATEWAY_RELAY_SECRET`.

---

## 12. Sandboxes — are agents in sandboxes?

**Not microVM / E2B / multi-tenant container sandboxes.** Two real isolation layers:

| Layer | Scope | Default |
|-------|--------|---------|
| **systemd sandbox** | Long-lived gateway process (`ProtectSystem=strict`, `ProtectHome`, `NoNewPrivileges`, …) | On (unit design) |
| **Omnibox Mode A** | **Tool children only** (e.g. shell) under bubblewrap; denies secrets; not the whole agent | **Off** (`enable_omnibox=false`) |

Agents run as the **gateway process on the tenant’s own EC2**, sandboxed by systemd (+ optional bwrap for tools). Residual risk is **shared-kernel** (documented), not hardware isolation.

---

## 13. End-to-end visual: one request path per concern

```
┌──────────┐   static    ┌────────────┐
│  Browser │────────────►│ CloudFront │──► S3 SPA
└────┬─────┘             └─────┬──────┘
     │ /{slug}/api/*           │
     ▼                         ▼
┌─────────┐  service token  ┌────────────────┐
│   BFF   │────────────────►│ Control Plane  │──► RDS
└────┬────┘                 │ (private)      │
     │                      └────────────────┘
     │ internal token
     ▼
┌─────────┐  WSS /relay   ┌──────────────────────────┐
│  Relay  │◄──────────────│ EC2 Hermes gateway       │
│         │  NDJSON frames│  + EBS vault + profiles  │
└────┬────┘               └──────────────────────────┘
     │
     │ SSE back to BFF → browser for chat events
     ▼
  Browser EventSource
```

**Data residency summary**

| Data | Where it lives |
|------|----------------|
| Users, roles, instance registry | Control-plane RDS (platform) |
| Vault files, agent sessions, projects.db | Tenant EC2 EBS |
| Chat stream | Relay hop + BFF history store |
| Model API keys (tenant-shared) | SM → host materialize |
| Snapshots | DLM → EBS snapshots (tenant-scoped tags) |

---

## 14. Mental model cheat sheet

| Question | Short answer |
|----------|--------------|
| Front-end UI? | Portal web: Chat / Vault / Settings per tenant |
| Admin page? | `/admin` ops shell on the web tarball (`lp-2qs.3`). Secrets/tenant pages still CP/deploy |
| Multi-tenant? | Yes — `tenants` + per-tenant EC2 |
| Sub-tenant? | Users + roles + path ACL inside one tenant |
| UI → EC2? | BFF → Relay WSS → host (egress-only) |
| BFF / CP / WS? | All three: BFF public, CP private, Relay WSS |
| Backend agent? | External Hermes-Lanyard (ref) on EC2 via contract |
| Harness? | Offline conformance fakes **or** live gateway process |
| Sandboxes? | systemd + optional Omnibox bwrap; not EFS/microVM fleets |
| Backups? | EBS + DLM daily; **not** EFS “three backups” |
| Onboard? | CP register → SSM secret → TF → bootstrap → chat smoke |
| Permissions? | CP roles ↔ Hermes profiles + path prefixes, dual-enforced |

---

## 15. Known sharp edges (so the diagram matches reality)

1. **Hermes naming is still deep** — units, paths, fields (`hermes_profile`, `/opt/hermes-lanyard`) while platform moves to generic `backend_*` / `company-brain-backend`.
2. **Brain RPC is feature-flagged** (`BRAIN_RPC_ENABLED` default off → fail-closed 503).
3. **Lanyard Agent** can chat via relay but is **not** full Brain RPC v1 yet.
4. **Portal platform modules** are often **infra_ready / not auto-applied** from repo examples.
5. **Relay secret store** in product code still leans env/in-memory; production lifecycle is register → SSM → rotate/revoke.
6. **Ops console shell is shipped** (`/admin` on `@lanyard/web`, `lp-2qs.3`). Secrets and tenant list pages are not. `/_platform` is an S3 vault prefix, not a URL. `@lanyard/admin` is a local scaffold only.

---

## Where to go deeper in-repo

| Topic | Doc / path |
|-------|------------|
| Topology | `portal/artifacts/portal-production-topology.md` |
| Brain RPC | `portal/docs/brain-rpc.md` |
| Tenant isolation | `deploy/references/tenant-isolation-decision.md` |
| Provision | `deploy/references/provision-runbook.md` |
| Host RBAC | `deploy/references/hermes-profile-rbac.md` |
| Runtime contract | `contracts/backend-runtime-v1/` |
| Module map | `deploy/INDEX.md` |
| Dual-auth planes | [dual-auth-credential-planes.md](./dual-auth-credential-planes.md) |
| Connectors + `/admin` | [portal-connectors.md](./portal-connectors.md) |
| Workspace map | `docs/architecture/workspace-map.md` |
| Current evaluation | `docs/architecture/current-architecture-evaluation.md` |
