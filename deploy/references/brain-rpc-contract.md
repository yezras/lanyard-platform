# Brain RPC contract (G3.1)

**Status:** Contract **defined** (deploy-repo authority). Hermes handlers (**G3.2**) landed (hermes-agent **#2**). Portal vertical slice (**G3.3**) in product (Portal **#14**). **G3 overall remains blocked** until **G3.4 staging E2E** — do not claim production vault/settings/projects support from contract or unit tests alone.

**Authority:** This document is the cross-repo RPC contract for customer-host operations. Product implementers:

| Implementer | Repo | Scope |
|-------------|------|--------|
| Host handlers | `LanyardBrain/hermes-agent` / hermes-lanyard Lanyard path | Execute methods against local vault / Hermes home; enforce host profiles |
| Portal call path | `LanyardBrain/Portal` (`@lanyard/bff`, `@lanyard/relay`) | Session → tenant → instance routing; browser API surface; never local `VAULT_ROOT` in production |
| Deploy wiring | This repo | Egress-only relay posture, instance identity pins, profile seeds, honesty gates |

**Related:** `references/hermes-profile-rbac.md`, `modules/customer-gateway-relay/`, `references/readiness-matrix.md` (G3), Portal ADR `artifacts/portal-production-topology.md` (G3a/G3b), Hermes [relay-connector-contract](https://github.com/NousResearch/hermes-agent/blob/main/docs/relay-connector-contract.md) (transport substrate, not this method set).

---

## 1. Purpose and doctrine

Brain RPC lets Portal **invoke read-oriented (MVP) operations on the customer brain host** where the vault and Hermes runtime live (encrypted EBS). It does **not** move the canonical vault to platform S3 or to the BFF process.

| Must | Must not |
|------|----------|
| Run vault/settings/projects ops **on the customer EC2** | Open inbound portal/API ports on the brain host |
| Ride the **existing egress-only WSS** relay path | Invent a public host listener for brain RPC |
| Bind **tenant + instance + role/profile** fail-closed | Accept unauthenticated or cross-tenant calls |
| Return **bounded** metadata / single-file reads | Bulk vault dump, recursive full-tree export without caps |
| Redact secrets from settings payloads | Log vault body content to shared debug sinks by default |
| Align roles **admin** / **contributor** | Elevate contributor to admin via request fields |

Pilot/production product rule (Portal topology): disable vault/settings/projects UI unless this contract, product vertical slice, **and** G3.4 staging E2E pass. Chat-only pilot may proceed without brain RPC.

### 1.1 Control-plane database boundary (cbd-mta.3.1 / cbd-mta.3.3)

The **central control-plane Postgres** (product store; deploy `modules/control-plane-rds` when applied) is **not** a Company Brain content store.

| CP DB may hold | CP DB must **not** hold |
|----------------|-------------------------|
| Tenants, slugs, OIDC subjects, memberships/roles, path **prefix** grants | Canonical vault / Company Brain **file bodies** |
| Gateway instance identity + credential **hashes** + registry health / secret **ARN** refs | Reusable plaintext relay secrets after show-once issue |
| Deployment/resource registry: hosting track, account/region, non-secret AWS ids/ARNs, pin **versions** | Terraform state, provider credentials, or full resource graphs |
| Project rows: name + `vault_path` references | Project/file content bytes |
| Session-share grants (`thread_id` only) | Durable chat/vault transcripts as system of record |
| Audit: actor, tenant, instance, action, result, request_id + redacted metadata | Secrets or vault bodies in audit JSON |

**Authority for vault bytes:** this Brain RPC contract — methods run **on the customer host** over the egress-only relay.  
**Deployment/resource registry contract:** `references/deployment-resource-registry.md` (cbd-mta.3.3) — CP IDs are authority; AWS ids are metadata only; registry ≠ tfstate.  
Portal schema inventory + RLS decision (RLS **deferred**; app + triggers + private network compensating): Portal `docs/control-plane-schema-boundary.md` / `docs/deployment-resource-registry.md`.  
Readiness honesty: `references/readiness-matrix.md` (G3 blocked until staging E2E; G4 product schema **ready**, RDS module **infra_ready** only; registry product-ready does **not** imply live apply).

---

## 2. Transport assumptions

### 2.1 Path (normative topology)

```text
Browser
  → path-first BFF  /<tenant_slug>/api/*
    → (private) Portal relay control plane / internal API
      → existing authenticated WSS session with customer Hermes
        → Hermes brain-RPC dispatcher (host-local)
          → vault FS / Hermes home / projects.db
```

Deploy-owned wiring today:

- Hermes dials **out** to `GATEWAY_RELAY_URL` with `GATEWAY_RELAY_ID` / `GATEWAY_RELAY_INSTANCE_ID` + `GATEWAY_RELAY_SECRET` (`modules/customer-gateway-relay`).
- Customer SG doctrine: **no inbound portal ports**; optional SSH/SSM/Tailscale for operators only.
- Relay **production security** (register/rotate/revoke, replay) is product **G2** and may still be **blocked** — this contract still requires fail-closed auth semantics once G2 material is present.

### 2.2 Substrate

| Assumption | Detail |
|------------|--------|
| Channel | Authenticated **outbound** WebSocket from Hermes → Portal relay (same trust domain as chat relay) |
| No host inbound HTTP for RPC | Host must not expose a public brain-RPC port for Portal |
| Multiplexing | Request/response frames share the relay session; see §2.3 |
| Relay contract major | Compatible with pin `relay_contract.major` (today `1`); brain RPC has its own version field (§8) |
| Not TUI gateway JSON-RPC | Local `tui_gateway` / `hermes serve` is **out of scope** for production Portal |
| Not OpenAI-compatible API server | Model HTTP surface is not the brain RPC surface |

Implementers **may** refine frame names in product repos; semantics in this document are normative.

### 2.3 Wire envelope (schema-level)

Newline-delimited JSON frames on the authenticated relay socket (direction relative to Hermes):

**Request (Portal/relay → Hermes):**

```json
{
  "type": "brain_rpc_request",
  "contract_version": 1,
  "request_id": "01JEXAMPLEUUIDORULID",
  "method": "vault.list",
  "timeout_ms": 10000,
  "auth": {
    "tenant_id": "ten_…",
    "instance_id": "inst_…",
    "subject": {
      "portal_user_id": "usr_…",
      "hermes_profile": "contributor",
      "roles": ["contributor"],
      "path_prefixes": ["/Projects/Legal"]
    },
    "session_id": "sess_…",
    "issued_at": "2026-07-12T00:00:00.000Z",
    "expires_at": "2026-07-12T00:05:00.000Z"
  },
  "params": {
    "path": "/Projects/Legal"
  },
  "idempotency_key": null
}
```

**Result (Hermes → Portal/relay):**

```json
{
  "type": "brain_rpc_result",
  "contract_version": 1,
  "request_id": "01JEXAMPLEUUIDORULID",
  "ok": true,
  "result": { },
  "error": null,
  "meta": {
    "duration_ms": 12,
    "hermes_profile": "contributor",
    "host_time": "2026-07-12T00:00:00.100Z"
  }
}
```

Error result:

```json
{
  "type": "brain_rpc_result",
  "contract_version": 1,
  "request_id": "01JEXAMPLEUUIDORULID",
  "ok": false,
  "result": null,
  "error": {
    "code": "forbidden",
    "message": "path not allowed for profile",
    "retryable": false,
    "details": { "path": "/Secrets" }
  },
  "meta": {
    "duration_ms": 3,
    "hermes_profile": "contributor",
    "host_time": "2026-07-12T00:00:00.050Z"
  }
}
```

**Field rules:**

| Field | Rule |
|-------|------|
| `request_id` | Required, unique per attempt; echo on result |
| `contract_version` | Integer; currently `1`. Mismatch → `version_unsupported` |
| `method` | Dotted name from §4 |
| `timeout_ms` | Caller budget; host should abort and return `timeout` if exceeded (see §7) |
| `auth` | Required; reject if missing/invalid (**fail-closed**) |
| `params` | Method-specific object; unknown fields ignored for forward-compat within major |
| `idempotency_key` | Optional string; meaningful for future writes; MVP reads may ignore |
| `ok` | Boolean; when false, `error` required and `result` null |
| `meta` | Optional diagnostics; **must not** include vault file bodies |

Relay-internal BFF↔relay hop (service token) is product-owned (same class as existing `x-relay-internal-token`). It is **not** a substitute for instance + subject auth on the host.

---

## 3. Auth model

### 3.1 Who calls whom

| Direction | Party | Role |
|-----------|-------|------|
| Caller | Portal BFF (on behalf of authenticated browser user) | Initiates method after session + RBAC |
| Transport | Portal relay | Routes to the **socket owner** for `instance_id` / tenant |
| Callee | Hermes on customer host | Enforces host profile + path ACL; executes method |
| Never caller | Browser → Hermes direct | Forbidden |
| Never caller | Unauthenticated internet → host | Forbidden (no inbound RPC port) |

### 3.2 Credential layers (all required)

Fail-closed: **any** layer failure rejects the call. Prefer generic messages to the browser; detailed reason only in host/relay ops logs **without vault content**.

| Layer | What | Who verifies | Failure |
|-------|------|--------------|---------|
| **L0 — Channel** | Per-instance relay secret / upgrade token (G2 lifecycle when ready) | Portal relay at WS upgrade | Close **4401** / no RPC delivery |
| **L1 — Tenant binding** | `instance_id` ↔ `tenant_id` from **connector store**, not body assertion alone | Relay | `forbidden` / drop |
| **L2 — Portal session** | Verified OIDC/user session (G1 product) | BFF | HTTP 401 before RPC |
| **L3 — Subject on request** | `portal_user_id`, `hermes_profile`, `path_prefixes`, `roles` stamped by BFF from control-plane RBAC — **not** trusted from browser | BFF stamps; Hermes re-checks against host profile matrix | `unauthenticated` / `forbidden` |
| **L4 — Host profile** | Profile file capabilities (`admin` / `contributor` seeds) | Hermes | `forbidden` if method needs missing capability |
| **L5 — Path ACL** | Vault paths must fall under `path_prefixes` (and profile caps) | Hermes (+ BFF pre-check recommended) | `forbidden` |

**Do not trust:** client-supplied `hermes_profile`, elevated `path_prefixes`, or foreign `tenant_id` / `instance_id` from the browser. BFF derives subject from control plane; Hermes treats stamped subject as **claims to enforce**, not free elevation.

### 3.3 Role → capability map (MVP)

Aligned with `scripts/hermes-profiles/*.json` and `references/hermes-profile-rbac.md`:

| Portal role | `hermes_profile` | Host capabilities (seed) | Brain RPC methods allowed |
|-------------|------------------|--------------------------|---------------------------|
| Admin | `admin` | `vault_full`, `vault_read`, `vault_write`, `chat`, ops caps | All MVP methods; settings snapshot full redacted view |
| Contributor | `contributor` | `vault_read`, `vault_write`, `chat` only | `brain.*`, `vault.*` (read), `projects.list`; settings snapshot **allowed** but redacted; **no** ops methods |

MVP is **read-heavy**. Future write methods (`vault.write`, settings patch) require `vault_write` / admin ops as applicable and are **non-goals** of this version (§9).

### 3.4 Explicit rejects

| Condition | Code |
|-----------|------|
| Missing/expired `auth`, bad channel | `unauthenticated` |
| Tenant/instance mismatch, wrong socket | `forbidden` |
| Profile lacks capability | `forbidden` |
| Path outside prefixes / path escape (`..`, absolute breakout) | `forbidden` or `invalid_argument` |
| Method unknown | `method_not_found` |
| `contract_version` unsupported | `version_unsupported` |

---

## 4. MVP method set

Minimal vertical slice: health + vault metadata/list + optional single-file read + settings snapshot + projects list. Enough for Portal to stop using local `VAULT_ROOT` / fixture-only providers in production mode.

### 4.1 `brain.ping`

**Purpose:** Liveness through the RPC path.  
**Auth:** L0–L3 minimum; host may skip vault ACL.  
**Params:** `{}` or `{ "echo": "<string ≤ 64 chars>" }`  
**Result:**

```json
{
  "pong": true,
  "echo": "optional",
  "instance_id": "inst_…",
  "contract_version": 1
}
```

### 4.2 `brain.health`

**Purpose:** Structured readiness for pilot gates (not a public status page).  
**Auth:** Authenticated subject for tenant/instance.  
**Params:** `{}`  
**Result:**

```json
{
  "status": "ok",
  "checks": {
    "vault_root_readable": true,
    "hermes_home_present": true,
    "profiles_present": true,
    "projects_db_present": false
  },
  "versions": {
    "brain_rpc": 1,
    "hermes_artifact": "v0.0.0-example",
    "client_core_seed": "v0.0.0-example"
  },
  "profile": "contributor"
}
```

| `status` | Meaning |
|----------|---------|
| `ok` | MVP read path usable |
| `degraded` | Partial (e.g. projects.db missing) but vault list may work |
| `unavailable` | Cannot serve vault reads |

Versions are **best-effort** from host provenance (`/opt/company-brain/.seed/`, artifact pins); never invent false digests.

### 4.3 `vault.list`

**Purpose:** Directory listing (names/kinds/paths) — **metadata only**.  
**Capability:** `vault_read` or `vault_full`.  
**Params:**

```json
{
  "path": "/Projects/Legal",
  "cursor": null,
  "limit": 200
}
```

| Field | Rule |
|-------|------|
| `path` | Vault-root-relative POSIX path starting with `/`; normalize; reject `..` segments |
| `limit` | Default 200; max **500** |
| `cursor` | Opaque pagination; null for first page |

**Result:**

```json
{
  "path": "/Projects/Legal",
  "entries": [
    {
      "name": "memo.md",
      "path": "/Projects/Legal/memo.md",
      "kind": "file",
      "mime_type": "text/markdown",
      "size_bytes": 1024,
      "mtime": "2026-07-12T00:00:00.000Z"
    },
    {
      "name": "exhibits",
      "path": "/Projects/Legal/exhibits",
      "kind": "directory",
      "mime_type": null,
      "size_bytes": null,
      "mtime": "2026-07-11T00:00:00.000Z"
    }
  ],
  "next_cursor": null,
  "truncated": false
}
```

Aligns with Portal `VaultEntry` (`name`, `path`, `kind`, optional `mime_type`) plus optional size/mtime. **No file bodies.**

### 4.4 `vault.stat`

**Purpose:** Single-path metadata without content.  
**Capability:** `vault_read` or `vault_full`.  
**Params:** `{ "path": "/Projects/Legal/memo.md" }`  
**Result:** One entry object as in `vault.list` entries, or `not_found`.

### 4.5 `vault.read`

**Purpose:** Single-file content for pilot vault UI (G3b-style slice).  
**Capability:** `vault_read` or `vault_full`.  
**Params:**

```json
{
  "path": "/Projects/Legal/memo.md",
  "max_bytes": 1048576
}
```

| Field | Rule |
|-------|------|
| `max_bytes` | Caller cap; host enforces **min(caller, host_max)**. Host default max **1 MiB**; hard max **4 MiB** for MVP |
| Oversized file | `payload_too_large` (do not stream partial vault dumps) |

**Result:**

```json
{
  "path": "/Projects/Legal/memo.md",
  "kind": "file",
  "mime_type": "text/markdown",
  "encoding": "utf-8",
  "content": "# Memo\n…",
  "size_bytes": 1234
}
```

| `encoding` | When |
|------------|------|
| `utf-8` | Text-like MIME |
| `base64` | Binary MIME |

Directories → `invalid_argument`. Missing → `not_found`. Aligns with Portal `VaultFileContent`.

### 4.6 `settings.snapshot`

**Purpose:** Redacted Hermes settings discovery for Portal settings surfaces.  
**Capability:** Authenticated admin **or** contributor (both receive **redacted** payloads).  
**Params:** `{ "include": ["skills", "crons", "mcp_servers", "models", "integrations"] }`  
(`include` optional; default all listed keys.)

**Result (schema-level, aligned with BFF `RedactedSettingsSnapshot`):**

```json
{
  "exported_at": "2026-07-12T00:00:00.000Z",
  "hermes_home": "/home/hermes/.hermes",
  "source": "hermes",
  "skills": [{ "id": "…", "name": "…", "enabled": true, "path": "…", "source": "hermes" }],
  "crons": [{ "id": "…", "name": "…", "schedule": "…", "enabled": true }],
  "mcp_servers": [{ "name": "…", "transport": "stdio", "enabled": true }],
  "models": [{ "provider": "…", "model": "…", "is_active": true, "connected": true }],
  "integrations": [{ "id": "…", "name": "…", "type": "cli" }]
}
```

**Redaction (normative):** Strip keys matching secret patterns (`api_key`, `token`, `password`, `authorization`, `headers`, `env`, etc.). Host **must** redact before send; BFF **must** re-assert no secrets. Never put raw provider API keys on the wire.

### 4.7 `projects.list`

**Purpose:** Stub/list Hermes projects (agent working directories) for Portal project pickers.  
**Capability:** `vault_read` or `vault_full` (or admin).  
**Params:** `{ "include_archived": false }`  
**Result:**

```json
{
  "projects": [
    {
      "id": "…",
      "slug": "legal",
      "name": "Legal",
      "primary_path": "/Projects/Legal",
      "folders": [
        { "path": "/Projects/Legal", "label": null, "is_primary": true }
      ]
    }
  ],
  "source": "hermes_projects_db"
}
```

If `projects.db` absent: `ok: true` with `"projects": []` and `"source": "none"` **or** `status: degraded` via empty list — prefer empty list for MVP simplicity. Aligns with Portal `HermesProject`.

### 4.8 `projects.create` (expansion)

**Purpose:** Create an agent project registry row / working-directory binding.  
**Capability:** `features.projects_create` or `brain_rpc_methods` includes `projects.create`.  
**Params:** `{ "name": "…", "folders"?: ["…"] }`  
**Result:** project row (`id`, `name`, …) same shape as `projects.list` items.

### 4.9 `projects.delete` (expansion — soft-archive only)

**Purpose:** Soft-archive an agent project so it leaves the Directory list (`projects.list` with `include_archived: false`).  
**Capability:** `features.projects_delete` or `brain_rpc_methods` includes `projects.delete`.  
**Params:** `{ "id": "…" }`  
**Result:**

```json
{
  "id": "…",
  "archived": true
}
```

**Normative semantics (lp-uxy.5):**

| Does | Does **not** |
|------|----------------|
| Mark registry row archived / unlist from default `projects.list` | Delete vault or workspace folders on agent disk |
| Return `{ id, archived: true }` | `rmtree`, purge, or irreversible file destruction |
| Leave files on host workspace disk | Hard-delete the projects.db row without archive trail (prefer archive flag) |

Portal confirm copy **must** match this: project leaves Directory; workspace/vault files stay on disk. Hard purge is **not** part of this method’s default and is not shipped without a separate capability + double-confirm UI.

Control-plane vault ACL projects (`/api/projects`) remain a separate surface from agent working-directory projects.

---

## 5. Error model

### 5.1 Error object

```json
{
  "code": "forbidden",
  "message": "human-readable, non-secret",
  "retryable": false,
  "details": {}
}
```

| Field | Rule |
|-------|------|
| `code` | Stable machine enum (§5.2) |
| `message` | Safe for operator UI; no vault excerpts, no secrets |
| `retryable` | Hint for BFF/client backoff |
| `details` | Optional structured non-sensitive context (`path`, `limit`, `method`) |

### 5.2 Codes

| Code | Retryable | Typical meaning | HTTP (BFF map) | Notes |
|------|-----------|-----------------|----------------|-------|
| `unauthenticated` | no | Missing/invalid auth | **401** | |
| `forbidden` | no | ACL / tenant / profile | **403** | |
| `not_found` | no | Path or resource missing | **404** | |
| `invalid_argument` | no | Bad path/params | **400** | |
| `payload_too_large` | no | Read/list over cap | **413** | |
| `timeout` | yes | Host exceeded budget | **504** | |
| `unavailable` | yes | Host degraded / vault unreadable | **503** | |
| `conflict` | no* | Future writes / version conflict | **409** | *rarely retry with new key |
| `method_not_found` | no | Unknown method | **404** or **501** | Prefer 404 for API opacity |
| `version_unsupported` | no | contract_version mismatch | **400** | |
| `rate_limited` | yes | Optional throttle | **429** | |
| `internal` | yes | Unexpected host error | **500** | Log server-side; sanitize message |

### 5.3 Mapping guidance

- Browser only sees BFF HTTP errors; BFF maps `error.code` → status above.
- Relay WS close **4401** = channel revoked (G2 deprovision) — treat as terminal for that instance, not a soft RPC error.
- Do not map host `forbidden` to `404` for vault paths **by default** in admin debug tools; product may choose 404-obscurity for contributors (document if so). MVP: honest **403**.

---

## 6. Logging, privacy, and data handling

| Rule | Detail |
|------|--------|
| Vault content | **Not** to shared debug sinks, multi-tenant log drains, or default relay payload logs |
| Settings | Redacted only; G2b payload retention still product-gated |
| Request logs | `request_id`, `method`, `tenant_id`, `instance_id`, `portal_user_id`, path **prefix** or hashed path, duration, code — avoid full file paths if policy requires |
| Processors | Vault-derived payloads on relay are high sensitivity (`references/approved-data-processors.md` → `relay_session` / `vault_content`) |
| Failures | Prefer codes + safe messages; stack traces stay host-local |

---

## 7. Timeouts, idempotency, concurrency

| Topic | Guidance |
|-------|----------|
| Default timeout | **10s** for list/stat/ping/health/projects; **15s** for `vault.read` / `settings.snapshot` |
| Max timeout | Caller must not set `timeout_ms` > **30s** for MVP |
| Host abort | On timeout, return `timeout` with `retryable: true` when safe to retry read |
| Idempotency | MVP methods are **read-only** and naturally idempotent. `idempotency_key` reserved for future writes (at-least-once relay delivery) |
| Concurrency | Host should bound parallel RPC (suggest max **8** in-flight per instance); excess → `unavailable` or `rate_limited` |
| Pagination | Prefer `vault.list` limits over unbounded tree walks |
| Retries | BFF may retry **once** on `timeout` / `unavailable` / `rate_limited` with jitter; never retry non-retryable codes |

---

## 8. Versioning and compatibility

| Item | Policy |
|------|--------|
| `contract_version` | Integer **1** for this document |
| Evolution within v1 | **Additive only** (new optional params/result fields, new methods) |
| Breaking change | Bump `contract_version`; coordinated Hermes + Portal release; pin notes in `compatibility/` when product wires brain RPC version |
| Relay connector contract | Orthogonal substrate (`relay_contract.major`); brain RPC must not break chat frames |
| Deploy pin | No separate artifact pin until product ships handlers; readiness stays honest |
| Golden fixtures | Product G3a should add fixtures in Portal/Hermes; this repo holds **schema-level** authority only |

---

## 9. Non-goals (explicit)

- Full vault sync / backup over RPC (use DLM snapshots / restore runbooks)
- Arbitrary shell, `system_ops`, or `gateway_config` via brain RPC
- Cross-tenant operations or admin-of-all-tenants from one call
- Bulk recursive tree dump without caps
- Public inbound HTTP/JSON-RPC port on customer host
- Replacing chat `MessageEvent` path with brain RPC
- Mutating vault or settings (write path = later contract revision)
- Claiming G3 **ready** from this document alone
- Implementing handlers in this deploy repository
- Fake staging proof or invented digests/SHA pins
- Storing canonical Company Brain file bodies in control-plane Postgres (see §1.1)

---

## 10. Implementation checklist (downstream)

### G3.2 — Hermes (`LanyardBrain/hermes-lanyard`)

- [ ] Accept `brain_rpc_request` on authenticated relay session only
- [ ] Enforce L4/L5 (profile capabilities + path prefixes); reject unauthenticated
- [ ] Implement MVP methods §4
- [ ] Redact settings; cap read/list sizes
- [ ] Emit `brain_rpc_result` with error model §5
- [ ] Unit tests / golden fixtures for auth fail-closed and path escape

### G3.3 — Portal (`LanyardBrain/Portal`)

- [ ] BFF production providers call brain RPC (no `VAULT_ROOT` / local projects.db in production mode)
- [ ] Stamp `auth.subject` from control-plane RBAC + session
- [ ] Map methods to existing `/api/vault/*`, `/api/settings/snapshot`, `/api/hermes/projects` shapes
- [ ] Hide or hard-disable vault/settings/projects UI until slice health checks pass
- [ ] Relay routing to correct `instance_id` socket; timeouts/retries per §7

### Deploy (this repo)

- [x] Contract document (this file)
- [x] Readiness matrix honesty: G3 blocked until handlers + slice
- [ ] After G3.2/G3.3: update readiness evidence only with product proof — never flip G3 ready from docs alone

---

## 11. Acceptance mapping (bead G3.1)

| Acceptance item | Where covered |
|-----------------|---------------|
| Methods for MVP customer-host ops | §4 |
| Auth model (who/credentials/fail-closed) | §3 |
| Error model (codes, retryability, mapping) | §5 |
| Clear enough for G3.2/G3.3 | §2 envelope, §4 shapes, §10 checklist |
| Transport without public host inbound | §2 |
| Non-goals | §9 |

---

## 12. Doc index

| Doc | Relationship |
|-----|----------------|
| `references/readiness-matrix.md` | G3 status **blocked** until implementation; G4 schema boundary product-ready |
| `references/hermes-profile-rbac.md` | Profile/capability matrix |
| `references/provision-runbook.md` | Instance provision + relay secret path |
| `references/runbooks/relay-secret-lifecycle.md` | Secret storage / revoke (4401) |
| `references/approved-data-processors.md` | Sensitivity of vault on relay |
| `modules/customer-gateway-relay/README.md` | Env wiring only |
| `modules/control-plane-rds/README.md` | Private RDS module (**infra_ready**); not a content DB |
| Portal `docs/control-plane-schema-boundary.md` | CP entity ownership, FKs, RLS deferral, Brain RPC boundary |
| Portal production topology ADR | G3a contract / G3b vertical slice product gates |
| Hermes relay-connector-contract | Chat/relay substrate |
