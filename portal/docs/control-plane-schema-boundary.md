# Control-plane Postgres schema boundary (cbd-mta.3.1)

**Status:** Product schema audited and completed for tenant-scoped metadata.  
**DDL authority:** `packages/control-plane/src/migrate.ts` (`migrateControlPlaneSchema`).  
**Cross-repo contract:** company-brain-deploy  
[`references/brain-rpc-contract.md`](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/brain-rpc-contract.md)  
(canonical Company Brain content stays on the **customer host**; CP is not a vault DB).

---

## Doctrine

| May store centrally | Must **not** store centrally |
|---------------------|------------------------------|
| Tenant identity (slug, display name, relay tier, retention **policy flags**) | Canonical vault / Company Brain **file bodies** |
| Users + OIDC subjects (`google_sub`), optional password **hashes** (lab/demo) | Plaintext passwords or reusable relay secrets |
| Roles, Hermes profile names, path **prefix grants** | Full-tree vault dumps or chat message bodies |
| Gateway instance identity + scrypt **hashes** (show-once secret only at register/rotate) | Unhashed `GATEWAY_RELAY_SECRET` after issue |
| Project rows: name + **vault_path** references | Project file content |
| Session-share grants: `thread_id` + users (not thread bodies) | Durable chat transcript bodies (BFF/Redis or host-local) |
| Audit actions + redacted metadata JSON | Secrets, vault bodies, raw tokens in `metadata_json` |
| Connector entitlements, role grants, connection **metadata** | Plaintext OAuth tokens or WhatsApp `session.db`. Durable secrets are **KMS envelope ciphertext** on `connector_connections.secrets_ciphertext` only (lp-xhf4.2). |

Vault and settings content are reached only via **Brain RPC** on the customer Hermes host (egress-only relay). See deploy brain-rpc contract §1, §3, §6.

---

## Entity inventory and ownership

| Entity / table | Ownership | Keys / uniqueness | Notes |
|----------------|-----------|-------------------|--------|
| `tenants` | **Global** registry root | PK `tenant_id`; UNIQUE `tenant_slug` | Platform-wide; not nested under another tenant |
| `users` | **Tenant** | PK `user_id`; UNIQUE `(tenant_id, email)`; UNIQUE `(tenant_id, google_sub)` where sub set | OIDC subject scoped per tenant. `display_name`; `tenant_role` `tenant_admin`\|`member` (no invited) |
| `roles` | **Tenant** | PK `role_id`; UNIQUE `(tenant_id, name)` | Hermes profile label + name |
| `role_path_prefixes` | **Tenant** (via `role_id`) | PK `(role_id, path_prefix)`; FK role ON DELETE CASCADE | Path **prefixes only** — not file bodies |
| `user_roles` | **Tenant** (via user + role) | PK `(user_id, role_id)`; CASCADE delete | **Trigger** rejects cross-tenant user↔role pairs |
| `gateway_instances` | **Tenant** | PK `instance_id`; index on `tenant_id` (+ partial active) | Credential **metadata** (hashes); revoke via `revoked_at` |
| `projects` | **Tenant** | PK `project_id`; parent self-FK CASCADE; index `(tenant_id, vault_path)` | **Trigger** requires parent same tenant |
| `session_share_grants` | **Tenant** | PK `grant_id`; partial UNIQUE active `(tenant_id, thread_id, grantee)` | **Trigger** requires owner/grantee in tenant; soft revoke |
| `canonical_connectors` | **Global** | PK `id` (slug); UNIQUE `source_entry_id` when set | Live registry. Seeded `google\|hubspot\|whatsapp\|github`. Promote/custom compile snapshots. Delete archives; id stays reserved. |
| `canonical_connector_aliases` | **Global** | PK `alias`; FK `connector_id` | google/hubspot domain aliases. Domain is not unique. |
| `tenant_connector_entitlements` | **Tenant** | PK `(tenant_id, connector_id)` | FK to canonical id; HubSpot pin nullable |
| `role_connector_grants` | **Tenant** | PK `(tenant_id, role_id, connector_id)` | **Trigger** requires role in tenant. Not SaaS ACL. |
| `person_connector_grants` | **Tenant** | PK `(tenant_id, user_id, connector_id)` | Person grant presence. **Trigger** requires user in tenant. |
| `connector_connections` | **Tenant** | PK `connection_id`; UNIQUE `(tenant_id, user_id, connector_id)` | Public DTO omits `secrets_ciphertext`. **Trigger** requires user in tenant. Hard-delete on disconnect. |
| `audit_log` | **Tenant or platform** | PK `audit_id`; nullable `tenant_id` FK ON DELETE SET NULL | Platform-level events may use `tenant_id` NULL |

### Deletion semantics

| Operation | Behavior |
|-----------|----------|
| Instance revoke / tenant deprovision | Soft: set `revoked_at`; secrets never re-issued from store |
| Role / user delete | CASCADE memberships and path prefixes |
| Tenant hard delete | **Not** a product API; FKs without CASCADE to tenant block casual DELETE; audit rows SET NULL if FK path used |
| Session share revoke | Soft: `revoked_at` |

---

## Authorization layers (not only schema)

1. **Path + headers (G1a):** `packages/control-plane/src/tenant-authz.ts` — path `tenant_id`, optional `x-lanyard-tenant-id` / portal role; cross-tenant header mismatch → **403**.
2. **Store queries:** every mutating/list path filters by `tenant_id` (instances, users, roles, projects, shares).
3. **DB triggers:** same-tenant for `user_roles`, `session_share_grants`, `projects` parent.
4. **Service auth (G1.2):** BFF ↔ CP token; private topology (G1.3).
5. **Brain RPC subject:** BFF stamps RBAC from CP; host re-checks profile/path ACL.

Cross-tenant API tests: `packages/control-plane/test/tenant-authz.integration.test.ts`,  
`packages/control-plane/test/schema-boundary.integration.test.ts`.

**Live staging proofs** (G1.4 / G1a live) remain a **separate** deploy gate — product tests alone do not flip production security readiness.

---

## RLS decision

| Option | Decision |
|--------|----------|
| Postgres **Row Level Security** | **Deferred** for current release |
| Rationale | Single control-plane service role owns all rows; isolation is enforced in app + triggers + path authz. RLS needs per-request `SET LOCAL app.tenant_id` (or equivalent) wired through every pool checkout — valuable defense-in-depth but not required to claim schema completeness. |
| Compensating controls | Tenant FKs, uniqueness, triggers, G1a middleware, service auth, private CP network, redacted audit (G2b.2) |
| When to revisit | Multi-service direct DB access, read replicas with analyst roles, or compliance demand for DB-enforced tenant predicates |

Do **not** claim “RLS enabled in production” until implemented and tested.

---

## Migrate / rollback

| Path | Evidence |
|------|----------|
| Greenfield migrate | `migrateControlPlaneSchema` on process start (G4.1) |
| SQLite → Postgres data copy | `scripts/migrate-sqlite-to-postgres.mjs` + `docs/control-plane-db-migration.md` (G4.2, Portal #19) |
| Offline proof | `bash scripts/test-migrate-sqlite-to-postgres.sh` (requires lab Postgres) |
| Rollback | Postgres restore / `pg_restore` (not “switch back to SQLite” post-G4.1) |

---

## Out of scope here

| Item | Owner |
|------|--------|
| Deployment/resource registry tables | cbd-mta.3.3 |
| Production OIDC secret injection via ECS | cbd-mta.3.2 |
| RDS Terraform apply | company-brain-deploy G4.3 (**infra_ready**, not auto-applied) |
| Live G1/G1a staging proofs | cbd-mta.6.2 / readiness matrix |

---

## Related product docs

- `packages/control-plane/README.md` — API + data model summary  
- `docs/control-plane-db-migration.md` — G4.2 migrate/rollback  
- `docs/brain-rpc.md` — Portal call path; contract authority is deploy brain-rpc  
- company-brain-deploy `modules/control-plane-rds/README.md` — private RDS module honesty  
