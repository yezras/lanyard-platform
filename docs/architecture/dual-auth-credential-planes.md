# Dual-auth credential planes, `/admin` routes, and secrets flow

**Status:** Frozen design (`lp-2qs.1`, 2026-08-21). Not fully implemented.  
**Bead:** `lp-2qs.1` under epic `lp-2qs`.  
**Follow-ons:** `lp-2qs.2` (ops session), `lp-2qs.3` (SPA + CloudFront), `lp-2qs.4` (secrets UI), `lp-2qs.5` (tenants/instances/roles/audit).  
**Connectors surface:** [portal-connectors.md](./portal-connectors.md).  
**Supersedes hosting in** [ADR 0011](../adr/0011-tenant-web-and-platform-admin-apps.md) via [ADR 0014](../adr/0014-platform-ops-console-on-web-tarball.md).

This note is the ops-console contract. It covers operator vs tenant session, CloudFront `/admin*` vs `/_platform`, private Control Plane, and the secrets write path. Admin-only routes never wake a sandbox.

The super-admin gap this closes is [end-to-end-architecture.md](./end-to-end-architecture.md) §15.6 (scaffolded `@lanyard/admin`, no shipped ops SPA) plus the deferred ops UI in [pilot-model-keys-sm-inject-decision.md](../plans/0008-daytona-agent-sandboxes/pilot-model-keys-sm-inject-decision.md) (`lp-kng.7.1`).

---

## 1. Domain model

Two credential planes. They are not roles of one session.

```ts
type AuthPlane = "tenant" | "ops";

type TenantSession = {
  plane: "tenant";
  cookie: "lanyard_session";
  tenantId: string;
  userId: string;
};

type OpsSession = {
  plane: "ops";
  cookie: "lanyard_ops_session";
  operatorId: string;
  email: string;
};

type CredentialPlane = TenantSession | OpsSession;
```

A session record with both `tenantId` and `operatorId` is illegal. `User.isAdmin` (tenant admin inside one company) never mints an ops session. Prisma `PlatformAdmin` is an email allowlist, not a cookie.

| Plane | Cookie | UI | API | Bound to |
| --- | --- | --- | --- | --- |
| Tenant | `lanyard_session` | `https://app.withlanyard.com/<slug>/…` | `/<slug>/api/*` (path-first) or `/api/*` (legacy host) | One `tenant_id` |
| Ops | `lanyard_ops_session` | `https://app.withlanyard.com/admin` | `/api/admin/*` | Operator identity, no tenant |

Cookie `Path=/` on both. `/api/admin` would not see a `Path=/admin` cookie. Authorization is which cookie the route reads, not the cookie path.

Fail-closed:

- `/api/admin/*` reads only `lanyard_ops_session`. A tenant cookie is unauthenticated.
- Tenant APIs read only `lanyard_session` bound to that tenant. An ops cookie is unauthenticated (already proven for connector OAuth start).
- Both cookies on one browser is allowed. Each route still uses one plane.
- Ops cookie on `/demo` is not god-mode.
- Tenant cookie on `/admin` is unauthenticated.

Users never finish work in `/admin`. Ops never complete Google or HubSpot consent and never scan WhatsApp.

`/_platform` is an S3 vault marker (`tenants/{id}/_platform/…`). It is not a URL, not a CloudFront behavior, and not a SPA path.

---

## 2. Hosting shapes (picked)

### Shape A. Separate Start app (`@lanyard/admin`)

ADR 0011. Vite `:3001`, `/_protected`, TanStack Start server functions, Prisma `portal_app`. Production Node host TBD. Not CloudFront static. Not an `/admin` route on the tenant tarball.

Rejected for production. A second host and a second auth join (`lanyard_session` + `PlatformAdmin` by email) is the super-admin gap. It also makes a tenant cookie sufficient for cross-tenant ops.

### Shape B. Same `@lanyard/web` tarball, reserved `/admin` (chosen)

One static artifact. Client router mounts the ops shell when the first path segment is `admin`. BFF exposes `/api/admin/*`. Control Plane stays private. Local `@lanyard/admin` may remain as a scaffold until `lp-2qs.3` lands routes on web. It is not the production path.

Constants live in `@lanyard/shared` (`auth-planes.ts`, `PLATFORM_ADMIN_PATH_SEGMENT`).

---

## 3. CloudFront path plan

Existing `portal-static-edge` ordered behaviors (highest first among API/asset rules):

| Pattern | Origin | Role |
| --- | --- | --- |
| `/*/api/*` | BFF | Path-first tenant APIs |
| `/api/*` | BFF | Bare APIs, including `/api/admin/*` and `/api/public/*` |
| `/admin*` | S3 | Ops SPA (`lp-2qs.3`). Same tarball as default. Never BFF |
| `/assets/*` | S3 | Hashed static assets |
| default | S3 | SPA. Optional custom error 403/404 → `index.html` |

`/admin` and `/admin/*` are the same `@lanyard/web` tarball. Explicit CloudFront `/admin*` targets S3. Do not point `/admin*` at BFF. That would serve API JSON instead of the SPA.

`/api/admin/*` already matches bare `/api/*` → BFF. Caching stays disabled. Cookies and CSRF headers already forward.

Rejected API layout `/admin/api/*`. That pattern matches `/*/api/*` with slug `admin`. Even with the reserved slug, CloudFront would treat it as a tenant API path.

Vite (`apps/web`) already proxies `/api` to BFF. First segment `admin` must be reserved so `/admin/api/*` is not treated as a tenant API. Tenant slug `admin` is forbidden (`RESERVED_TENANT_PATH_SEGMENTS` and the web reserved set).

`lp-2qs.3` added the explicit S3 `/admin*` ordered behavior. Origin stays `portal-static-s3`.

SPA custom-error mapping still applies distribution-wide. Admin API errors from BFF must not be 403/404 if operators keep `enable_spa_error_routing`. Prefer 401/422 on `/api/admin/*`, same as other BFF APIs.

---

## 4. Request path (admin-only, no sandbox)

```text
Browser  →  CloudFront
              ├── GET /admin*          → S3 portal-web (SPA)
              └── /api/admin/*         → public ALB → BFF
                                            │  ops cookie + CSRF
                                            ▼
                                      Control Plane (private only)
                                            │  ciphertext / metadata
                                            ▼
                                      Postgres (+ KMS)
```

Browser never talks to Control Plane, Relay internals, or Daytona. Listing tenants, writing a provider key, toggling connector entitlement, and reading audit are BFF → CP only. Those handlers must not call `ensure_online`.

Wake inject happens later, on a **user** (or tenant) sandbox, when a chat or tool path needs the material. See §6.

---

## 5. Operator login (`lp-2qs.2`)

Mint `lanyard_ops_session` from an ops login, not from tenant login.

Allowed:

- Google sign-in on `/api/admin/auth/google` against a closed operator allowlist.
- BFF allowlist is `PLATFORM_OPERATOR_EMAILS` (comma-separated). Prisma `PlatformAdmin` stays the Start scaffold table; BFF does not query `portal_app`. A CP directory is a later equivalent.
- Optional password path later. Same cookie. Local-dev stub is `POST /api/admin/auth/google/stub` (same `DEV_TENANT_SLUG` gate as tenant stub) and still requires the allowlist.

Forbidden:

- Promoting a tenant `lanyard_session` because `User.isAdmin` or `PlatformAdmin` matches the email.
- Completing tenant OAuth (`/api/connectors/*/oauth/*`) with an ops cookie.
- Calling tenant chat, vault, or Brain RPC with an ops cookie.

`@lanyard/auth` `requirePlatformAdmin` today joins tenant `lanyard_session` to Prisma `PlatformAdmin`. That join is the ADR 0011 scaffold. `lp-2qs.2` replaces it with the ops cookie plane. Tenant Start functions keep `lanyard_session`.

Ops CSRF reuses `lanyard_csrf` (double-submit, `Path=/`). Mutating `/api/admin/*` requires it.

---

## 6. Secrets lifecycle

Three classes. Same CP Postgres + KMS store. Different keys and inject timing.

### Class A. User-principal connector material

Normative in [portal-connectors.md](./portal-connectors.md) §4. Row `(tenant_id, user_id, connector_id)`. Lazy inject into that **user** sandbox on first use. Ops never writes tokens. Ops writes tenant entitlement only.

### Class B. Tenant-principal provider keys and OAuth slots

This is the ops secrets UI (`lp-2qs.4`). Slots are a closed allowlist, not free text.

```ts
type OpsSecretSlot =
  | { kind: "env_key"; env_name: ProviderWakeEnvKey }
  | { kind: "oauth_slot"; provider_id: string };
```

`env_name` members match `PROVIDER_WAKE_ENV_KEYS` in Control Plane (`OPENAI_API_KEY`, `XAI_API_KEY`, `POOLSIDE_API_KEY`, …). `oauth_slot` members match the secrets-envelope oauth ids (`xai-grok`, `openai-codex`, …) when ops manages those grants.

**SoT for ops writes is Control Plane Postgres with KMS ciphertext**, one row per `(tenant_id, slot)`. Not the SM tenant envelope. Ops does not patch envelope JSON.

Why not SM for the console:

- Per-tenant `GetSecretValue` / `PutSecretValue` from BFF expands IAM and races on one JSON blob.
- Connector tokens already use CP ciphertext.
- Wake inject already runs inside Control Plane. Decrypt at inject time.
- Admin write must work with Daytona down.

SM envelope remains the EC2 **materialize** bootstrap and import path ([backend-runtime-secrets.md](./backend-runtime-secrets.md)). The ops console is not that path. A later EC2 sync from CP → envelope is optional and out of `lp-2qs.1`.

Write path:

```text
Ops SPA  →  PUT /api/admin/tenants/{id}/secrets/{slot}
         →  BFF (ops session)
         →  CP private HTTP
         →  encrypt + upsert ciphertext
         →  audit metadata only (slot, actor, timestamp; never value)
```

SPA sees `present`, optional fingerprint (`sha256` first 12 hex), `rotated_at`. Never plaintext, never refresh tokens.

Inject path (Daytona, existing Bucket C):

1. `ensure_online` / cold create for a tenant or user instance.
2. CP decrypts Class B rows for that `tenant_id`.
3. `buildProviderWakeEnv` becomes per-tenant. CP rows **win** over process env for that slot.
4. Process-env fallback (today’s shared ECS/SM inject) applies only when the tenant has **no row** for that slot. That keeps MockLab alive during migration.
5. Idle stop drops guest env. Next wake re-injects. Rotation is “write CP, next cold wake.”
6. Do not bake keys into snapshots, vault objects, or `/_platform` markers.

Class A still injects lazily per connector on first use, on the **user** sandbox. Class B may inject at create/start for tenant-shared model keys (LiteLLM in the guest or harness). Short-stack harness keeps provider keys on the harness task when that is the product path ([short-stack-tool-placement.md](./short-stack-tool-placement.md)). The SoT is still CP ciphertext. The inject target is the process that calls the model.

### Class C. Tenant-principal registry connector secrets

Registry connectors (Stripe restricted key, Linear, …) are not Class B and not guest inject. Key `(tenant_id, connector_id, surface_id)` (`mcp` | `api` | `cli`). KMS envelope on `tenant_connector_class_c_secrets`. First-class `google` / `hubspot` / `whatsapp` / `github` stay Class A.

Request-time attach is on the **harness HTTP client**. `Authorization` is set on that fetch. Tool schemas have no secret fields. Never `buildProviderWakeEnv`. Never `mcp-auth.json` or any token file on Daytona. Never BFF-as-guest.

Admin-only paths never wait on that inject.

---

## 7. Control Plane stays private

Hard rules from the end-to-end architecture still hold.

| Rule | Ops console |
| --- | --- |
| Browser never hits CP | Only BFF with the service token talks to CP |
| CP never on a public ALB | No change in `portal-control-plane-service` |
| No raw CP exposure in staging proof | `lp-2qs.5` lists tenants via BFF |

Existing CP HTTP (`/tenants`, `/tenants/:id/roles`, `/tenants/:id/audit`, gateway instances) is the data plane for `lp-2qs.5`. BFF admin gate wraps those routes. Do not invent a second public admin ALB.

---

## 8. Implementation sketch (types)

Shared (`@lanyard/shared`):

- `TENANT_SESSION_COOKIE`, `OPS_SESSION_COOKIE`
- `PLATFORM_ADMIN_PATH_SEGMENT` (`admin`), `PLATFORM_ADMIN_UI_BASE` (`/admin`), `PLATFORM_ADMIN_API_PREFIX` (`/api/admin`)
- `S3_VAULT_PLATFORM_PREFIX` (`_platform`)
- `authPlaneForPathname`, `isOpsConsolePath`
- `OpsSecretSlot` / `OpsSecretStatus` (no secret values)

BFF (`lp-2qs.2`, shipped):

- Ops session store. `OpsSessionRecord` has no `tenantId`.
- `/api/admin/auth/*` mint/clear ops cookie.
- Middleware. Tenant cookie ≠ ops. Allowlist: `PLATFORM_OPERATOR_EMAILS`.

Web (`lp-2qs.3`, shipped):

- Client route `/admin` on `@lanyard/web` (`AuthenticatedOpsConsole`).
- `apiPrefix` on `/admin` stays `/api` because `admin` is reserved.
- Fetch `/api/admin/…` via existing `withApiBase`.
- CloudFront `/admin*` → S3. `/api/admin/*` → BFF.

CP (`lp-2qs.4`):

- Ciphertext table for Class B slots.
- Per-tenant `buildProviderWakeEnv`.

---

## 9. v1 non-goals

- Replacing tenant Settings or Connectors for end users.
- Tenant-paste provider keys in Settings.
- `/_platform` as a product URL.
- Public Control Plane.
- Waking Daytona to save a secret or list tenants.
- Baking vault or keys into snapshots.
- Ops impersonation of a tenant user (Disconnect, OAuth, QR).
- Deleting `@lanyard/admin` in this bead.

---

## 10. Proof later (not this note)

| Check | Owner |
| --- | --- |
| Operator logs in. Tenant cookie cannot call `/api/admin/*`. | `lp-2qs.2` |
| `https://app.withlanyard.com/admin` is the ops shell, not tenant Chat. | `lp-2qs.3` |
| Set `XAI_API_KEY` / `POOLSIDE_API_KEY` in ops UI. Next cold wake has the key. | `lp-2qs.4` |
| List MockLab tenant + instance via BFF. No public CP. | `lp-2qs.5` |
| Admin-only those four without Daytona. | epic `lp-2qs` |

This bead’s proof is the doc, the shared plane types, reserved `admin` on both slug parsers, and the markdown link from the end-to-end architecture.
}
