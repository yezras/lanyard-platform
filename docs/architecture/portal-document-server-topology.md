# Document Server topology and data residency

**Bead:** `lp-5q6.8` (decision: choose Document Server topology and data residency model)  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Status:** Accepted (2026-07-24) — lab/staging unblocked; production DS still gated by free-track license + security  
**ADR:** [0006-document-server-topology-and-data-residency.md](../adr/0006-document-server-topology-and-data-residency.md)  
**Date:** 2026-07-24  

Related:

| Doc / bead | Role |
| --- | --- |
| [ADR 0006](../adr/0006-document-server-topology-and-data-residency.md) | Short binding decision |
| [portal-document-shared-state-conflict-policy.md](portal-document-shared-state-conflict-policy.md) | Sessions, document keys, dirty-human policy (`lp-5q6.3`) |
| [checkpoint-blocking-first-steps.md](../plans/0004-portal-onlyoffice-integration/checkpoint-blocking-first-steps.md) | Gate C topology blocks production DS, not preview pane |
| `deploy/references/threat-model-private-by-default.md` | Vault is critical asset on tenant host |
| `deploy/references/tenant-isolation-decision.md` | Account/VPC/KMS partitions for production |
| `lp-5q6.7` | License path (separate decision; both required for prod DS) |
| `lp-5q6.9` / `lp-5q6.35` | Threat notes ([portal-office-document-bridge-threat-notes.md](portal-office-document-bridge-threat-notes.md)) + implementation review ([portal-office-signed-download-callback-security-review.md](portal-office-signed-download-callback-security-review.md)) |
| `lp-5q6.25` | Lab compose/runbook (consumes lab topology below) |
| `lp-5q6.34` | Staging DS deploy (consumes staging topology below) |
| `lp-5q6.36` | Day-2 ops: start/stop/upgrade, JWT rotate, forgotten-file purge — [operate-onlyoffice-document-server.md](../../deploy/references/runbooks/operate-onlyoffice-document-server.md) |

---

## 1. Why this decision exists

ONLYOFFICE Document Server is not a pure browser widget:

1. The **browser** must load Document Server static assets (`api.js`) and open a WebSocket/HTTP session to the editing service.
2. **Document Server** must **HTTP GET** a document download URL and **HTTP POST** a save callback.
3. A JWT or signed token does **not** create network reachability. If Document Server cannot reach the BFF download/callback URLs, open and save fail regardless of crypto.

Vault bytes live on private Company Brain hosts under `VAULT_ROOT`. Document Server is an **untrusted transient cache** of those bytes for the duration of an edit session (and any forgotten-file window until purge). Placement therefore decides:

- Whether customer bytes leave the tenant isolation boundary while being edited.
- Cross-tenant residual risk on shared editor disks/caches.
- Deploy automation shape for lab vs staging vs production.

Preview-only chat document pane work (`lp-5q6.12`–`lp-5q6.16`) does **not** require Document Server and is **not** blocked by this decision.

---

## 2. Decision summary (named topologies)

| Environment | Named topology | Customer / tenant vault bytes may leave tenant host? | Shared multi-tenant DS allowed? |
| --- | --- | --- | --- |
| **Lab** | **`lab-shared-compose-ds`** — single Docker Document Server on the developer workstation or CI-like lab host | Lab/fixture only (never production tenant vault) | Yes (single shared lab instance) |
| **Staging** | **`staging-platform-shared-ds`** — one platform-operated Document Server in the **staging** account/VPC, serving staging tenants | Staging data only; staging hosts are non-production. Bytes leave staging tenant hosts via BFF signed download into the shared staging DS | Yes (staging only, with JWT + document-key isolation) |
| **Production (default)** | **`prod-per-tenant-ds`** — Document Server **per tenant** inside that tenant’s isolation boundary (same account/VPC partition as the Company Brain host, on or beside that host) | **No** multi-tenant platform or third-party DS. Bytes leave the vault volume only through BFF-mediated signed download into **that tenant’s** DS working set | **No** as default |
| **Production (opt-in only)** | **`prod-shared-ds-opt-in`** — shared platform Document Server for named tenants | Yes, transiently, under explicit commercial/security opt-in, isolation evidence, and purge SLOs | Only with written opt-in + evidence |
| **Not default anywhere production** | ONLYOFFICE **Cloud** / third-party hosted Docs | Customer content leaves Lanyard enclave | Demo/eval only unless customer-contracted opt-in |

**Binding production default:** private-by-default tenants use **`prod-per-tenant-ds`**. Shared production Document Server is **not** the default path.

---

## 3. Storage and network roles (all environments)

Normative integration shape (unchanged by topology choice):

```text
Browser (Portal web)
  │  loads api.js + editor from Document Server URL
  │  receives JWT-signed editor config from Portal BFF
  ▼
Document Server (editing service + transient cache)
  │  GET  document.url  → Portal BFF signed download
  │  POST callbackUrl   → Portal BFF writeback handler
  ▼
Portal BFF (only storage boundary Document Server may call)
  │  open:  stream vault bytes (binary transfer; not vault.read JSON)
  │  save:  vault.write with ACL, expected_revision, size/type policy
  ▼
Company Brain host (vault under VAULT_ROOT via Brain RPC)
```

| Role | Owner | Rule |
| --- | --- | --- |
| Document manager | Portal web | Opens pane/editor; never holds DS JWT secret |
| Document storage service | Portal BFF | Signed download + callback + session store + JWT mint |
| Document editing service | Document Server | Transient open/convert/co-edit/assemble |
| Vault authority | Company Brain host | Sole mutator of vault bytes and revision tokens |

**Hard boundary:** Document Server must **never** speak Brain RPC, open relay sockets, or read `VAULT_ROOT` directly. BFF is the only HTTP storage plane DS may call.

---

## 4. Lab topology — `lab-shared-compose-ds`

### 4.1 Named shape

| Field | Value |
| --- | --- |
| **Name** | `lab-shared-compose-ds` |
| **Deploy form** | Docker Compose (or equivalent single-host container) on a developer machine or dedicated lab host |
| **Instances** | One shared lab Document Server |
| **Vault** | Fixture / local FS / non-production mock only |
| **Secrets** | Lab-only JWT secret (not production SM values; not committed as prod) |
| **Owning bead** | `lp-5q6.25` (runbook + compose wiring) |
| **Compose** | `deploy/dev/lab-shared-compose-ds/` |
| **Runbook** | `deploy/references/runbooks/lab-onlyoffice-document-server.md` |
| **Offline smoke** | `bash deploy/scripts/smoke-lab-onlyoffice-compose.sh` (optional `LIVE=1` for api.js) |

### 4.2 Reachability

| Path | Lab requirement |
| --- | --- |
| **Browser → Document Server** | Browser loads `api.js` from lab DS URL (e.g. `http://localhost:<ds-port>` or lab hostname). CORS/mixed-content: prefer same-scheme lab stack or documented exceptions for local HTTPS. |
| **Document Server → BFF download** | DS container must resolve and GET the BFF signed download URL. Typical patterns: `host.docker.internal`, published host port, or compose network alias to the BFF service. **Token alone is insufficient.** |
| **Document Server → BFF callback** | Same network path as download; callback URL must be absolute and reachable from inside the DS container (not `localhost` meaning the browser). |
| **BFF → vault** | Fixture provider or local Brain RPC pin; never a production tenant host. |

### 4.3 Data residency (lab)

- Customer production vault bytes **must not** be pointed at lab DS.
- Lab may retain open documents on DS cache until compose teardown / volume wipe.
- Teardown expectation: stop stack, remove DS data volumes, rotate lab JWT if leaked.

### 4.4 Cross-tenant risk (lab)

Not applicable beyond multi-developer shared lab hosts. If a shared lab host is used, treat all data as non-sensitive fixture.

### 4.5 What lab proves

Open → edit → callback round-trip mechanics and latency (`lp-5q6.28`). Lab green does **not** authorize staging/production enablement without license (`lp-5q6.7`), security (`lp-5q6.9`/`lp-5q6.35`), and contracts (`lp-5q6.17`/`lp-5q6.18`).

---

## 5. Staging topology — `staging-platform-shared-ds`

### 5.1 Named shape

| Field | Value |
| --- | --- |
| **Name** | `staging-platform-shared-ds` |
| **Deploy form** | Platform-operated Document Server service in the **staging** AWS account / VPC — Terraform module `deploy/modules/staging-document-server/` composed from `deploy/environments/platform-staging/` (`enable_staging_document_server`) |
| **Instances** | One (or HA pair) shared staging Document Server |
| **Audience** | Staging tenants / dogfood only |
| **Secrets** | Staging JWT + optional license shell in AWS Secrets Manager (not git); BFF injects same JWT ARN as `BFF_OFFICE_JWT_SECRET` |
| **Owning bead** | `lp-5q6.34` |
| **Runbook** | `deploy/references/runbooks/staging-document-server.md` |
| **Offline smoke** | `bash deploy/scripts/smoke-staging-document-server.sh` |

### 5.2 Reachability

| Path | Staging requirement |
| --- | --- |
| **Browser → Document Server** | Stable staging Docs hostname (or path-first docs edge) reachable by browser clients used in staging proofs. Health check on that edge. |
| **Document Server → BFF** | DS must reach **staging BFF** Office download and callback URLs over HTTPS. Prefer private path if BFF and DS share staging VPC; public staging BFF URL is acceptable if TLS + JWT + allowlists hold. |
| **BFF → staging vault hosts** | Existing Brain RPC / backend-runtime path for staging Company Brain pins. |

### 5.3 Data residency (staging)

| Question | Answer |
| --- | --- |
| May staging vault bytes leave the staging tenant host? | **Yes, transiently** — via BFF signed download into the **shared staging** Document Server working set. |
| Production customer vault? | **Never** on staging DS. |
| Staging as production proxy? | **No.** Staging shared DS is an integration and security-proof environment, not the production residency model. |

### 5.4 Purge and cross-tenant (staging)

| Control | Expectation |
| --- | --- |
| Document keys | Must include **tenant**, path identity, and content revision (see shared-state policy). No path-only keys. |
| JWT | Staging secret distinct from lab and production; rotated via SM/runbook. |
| Session TTL | Short-lived download URLs; expired sessions fail closed on download/callback. |
| Forgotten files | Staging purge job or documented DS cleanup interval; no indefinite retention of assembled files. |
| Cross-tenant residual | **Accepted for staging only.** Disk-level co-residency of staging tenants on one DS is a residual risk mitigated by keys/JWT/ACL, not by account isolation. Production must not inherit this residual by default. |
| Logs | No file bodies in logs/metrics/errors (feeds `lp-5q6.9` / `lp-5q6.33`). |

### 5.5 Staging vs production

Staging may ship shared DS first to prove the bridge. Production deploy automation (`prod-per-tenant-ds`) is a **separate** topology; success of staging shared DS is necessary evidence, not a silent production default flip.

---

## 6. Production topology — `prod-per-tenant-ds` (default)

### 6.1 Named shape

| Field | Value |
| --- | --- |
| **Name** | `prod-per-tenant-ds` |
| **Deploy form** | Document Server instance **dedicated to one tenant**, deployed **inside that tenant’s isolation boundary** — on the Company Brain host (Docker/systemd) **or** a sibling host/service in the **same** tenant account/VPC partition |
| **Isolation alignment** | Follows `deploy/references/tenant-isolation-decision.md` (account-per-tenant target; interim VPC-per-tenant with dedicated roles/KMS/logs) |
| **Vault coupling** | Same partition as `VAULT_ROOT` / Company Brain data plane |
| **Owning beads** | Deploy/runtime follow-ons after this decision + license + security (not lab compose) |

### 6.2 Data residency (production default) — explicit

| Question | Decision |
| --- | --- |
| May customer vault bytes leave the **tenant isolation boundary** for editing? | **No** for the default path. Working copies may exist only on **that tenant’s** Document Server. |
| May bytes leave the **vault EBS volume**? | **Yes, transiently**, through the BFF storage boundary (Brain RPC binary transfer → signed download → tenant DS). That is still inside the tenant partition for `prod-per-tenant-ds`. |
| May bytes go to a **Lanyard multi-tenant shared** Document Server? | **No** without `prod-shared-ds-opt-in`. |
| May bytes go to **ONLYOFFICE Cloud** or other third-party Docs hosting? | **No** as product default. Customer-contracted opt-in only; not the private-by-default story. |

### 6.3 Reachability (production default)

Company Brain hosts are private-by-default (no public IP production posture). Browser clients still need a Document Server URL.

| Path | Production requirement |
| --- | --- |
| **Browser → Document Server** | Tenant-scoped **editor edge**: dedicated hostname (recommended) or explicitly approved path that terminates TLS and reverse-proxies **only** Document Server editor/API traffic for that tenant. Must not expose vault FS, Brain RPC, or SSM. Pattern family is similar to Tier-3 dedicated public edge for a single tenant service — exact TF is future deploy work. |
| **Document Server → BFF** | Tenant DS must reach Portal BFF Office endpoints (`document.url` download + `callbackUrl`) over HTTPS. Typical: public product BFF URL (path-first Portal edge) with short-lived signed tokens; optional private link if product networking later co-locates them. Fail closed if unreachable. |
| **BFF → tenant host** | Existing private data plane (relay + Brain RPC). Document Server never joins that plane. |

```text
                    Internet
                       │
          ┌────────────┴────────────┐
          │ Portal public edge      │  browser → BFF (config, signed URLs)
          │ (BFF / static / …)      │  browser → tenant Docs edge (api.js)
          └────────────┬────────────┘
                       │
     ┌─────────────────┼──────────────────┐
     │ Tenant boundary │                  │
     │  ┌──────────────▼──────────────┐   │
     │  │ Tenant Docs edge → DS       │   │  transient Office cache
     │  └──────────────┬──────────────┘   │
     │                 │ GET/POST to BFF  │
     │  ┌──────────────▼──────────────┐   │
     │  │ Company Brain + VAULT_ROOT  │◄──┘  only via BFF/Brain RPC, not DS
     │  └─────────────────────────────┘
     └────────────────────────────────────┘
```

### 6.4 Purge expectations (production default)

| Control | Expectation |
| --- | --- |
| Session end | Force-save / callback completes or fails closed; session marked terminal in BFF. |
| Cache keys | New content revision ⇒ new document key; prior keys must not reopen stale content as authoritative. |
| Forgotten files | Operators must have a documented purge for DS cache/forgotten files; default interval or on-session-destroy cleanup required before production claim. Procedure: [operate-onlyoffice-document-server.md](../../deploy/references/runbooks/operate-onlyoffice-document-server.md) §8 (`lp-5q6.36`). |
| Host decommission | Tenant offboarding wipes DS volumes with the vault host/account — same isolation lifecycle as Company Brain. |
| JWT | Per-tenant or per-environment secret in SM/SSM; rotation runbook; never git. |

### 6.5 Cross-tenant risk (production default)

| Risk | Stance |
| --- | --- |
| Shared DS disk co-residency | **Eliminated by default** — one tenant per DS instance/partition. |
| Document key collision | Still forbidden: keys include tenant + path identity + revision even for single-tenant DS (defense in depth for shared-lab mistakes and future opt-in shared). |
| Platform BFF multi-tenancy | BFF remains multi-tenant product surface; isolation relies on ACL, session mapping, and signed URL binding — covered by threat notes `lp-5q6.9`. |
| Neighbor tenant network | No SG/peer paths from tenant A DS to tenant B vault/DS (align with tenant isolation decision). |

---

## 7. Production opt-in — `prod-shared-ds-opt-in`

Allowed **only** when all of the following are true:

1. Written commercial/security **opt-in** for named tenants (or a named product tier).
2. Strict **logical isolation**: per-tenant JWT claims, document keys with tenant id, callback session maps that cannot cross tenants, network allowlists.
3. **Purge evidence**: measured forgotten-file cleanup, no indefinite cache, incident runbook for cross-tenant suspicion.
4. Security review (`lp-5q6.35`) explicitly covers shared-DS residual risk.
5. Feature flags keep non-opted tenants on preview-only or per-tenant DS.

Without those, shared production DS is **rejected** (same spirit as rejecting unpartitioned shared-account multi-tenant vault hosts).

---

## 8. Rejected / non-default placements

| Placement | Status | Reason |
| --- | --- | --- |
| ONLYOFFICE Cloud as production default | **Rejected** | Customer content leaves private-by-default enclave; ops convenience is not worth residency loss. |
| Shared production DS without opt-in | **Rejected** | Cross-tenant cache/disk residual conflicts with private-by-default and tenant isolation. |
| Document Server with direct vault/Brain RPC access | **Rejected** | Boundary discipline: BFF only. |
| Routing production Office open through `vault.read` / `/api/vault/content` JSON | **Rejected** | Size-capped preview API; wrong plane (`lp-5q6.17`). |
| Browser-only “token” without DS→BFF reachability design | **Rejected** | Tokens do not create network paths. |

---

## 9. Environment comparison (acceptance matrix)

| Acceptance item | Lab `lab-shared-compose-ds` | Staging `staging-platform-shared-ds` | Production `prod-per-tenant-ds` |
| --- | --- | --- | --- |
| Topology **named** | Yes | Yes | Yes |
| Customer prod bytes leave tenant host to multi-tenant DS? | N/A (no prod bytes) | N/A (staging data only) | **No** (default) |
| Browser → DS | Local/lab URL | Staging Docs edge | Tenant Docs edge |
| DS → BFF download/callback | Compose/host network to lab BFF | Staging network/HTTPS to staging BFF | HTTPS to product BFF from tenant DS |
| Purge | Volume wipe / teardown | Staging cleanup job + TTL | Per-tenant wipe + forgotten-file SLO |
| Cross-tenant residual | Fixture-level only | Accepted staging residual | Minimized (dedicated DS) |

---

## 10. What this decision unblocks / still blocks

### Unblocks (after human accept of this draft as working guidance)

- Lab compose design against **`lab-shared-compose-ds`** (`lp-5q6.25`).
- Threat notes that assume per-tenant prod vs shared staging (`lp-5q6.9`).
- Staging TF/module sketches targeting **`staging-platform-shared-ds`** (implement only after lab + security gates).

### Still blocked for production enablement

- Human/legal/commercial accept of production topology (this bead’s `needs_human`).
- License path (`lp-5q6.7`).
- Binary transfer + typed `vault.write` (`lp-5q6.17`, `lp-5q6.18`).
- Security review of signed download/callback (`lp-5q6.35`).
- Deploy evidence for `prod-per-tenant-ds` (follow-on after staging).

### Not blocked

- Preview-only chat document pane.
- Architecture/domain model and contracts that are topology-agnostic (as long as they honor BFF-as-storage-boundary).

---

## 11. Human gate checklist

Before marking production Document Server work unblocked:

- [ ] Security owner accepts `prod-per-tenant-ds` default and staging shared residual.
- [ ] Deploy owner accepts editor-edge + per-tenant DS ops cost (CPU/RAM per tenant).
- [ ] Product/commercial owner accepts that shared production DS requires explicit opt-in.
- [ ] Confirmation that ONLYOFFICE Cloud is not sold as the private-by-default default.
- [ ] Cross-link to accepted license decision (`lp-5q6.7`).

---

## 12. Linked sources

| Source | Use |
| --- | --- |
| ONLYOFFICE Docs API — basic concepts | Integrator storage URL + callback model; Document Server must fetch URLs |
| Feasibility plan branch `docs/onlyoffice-portal-office-integration` overview | Placement table (shared / per-tenant / cloud) |
| `lp-5q6` epic design + `lp-5q6.8` bead design | Recommended stance formalized here |
| `deploy/references/threat-model-private-by-default.md` | Vault criticality; private host posture |
| `deploy/references/tenant-isolation-decision.md` | Account/VPC partitions production must respect |
| [portal-document-shared-state-conflict-policy.md](portal-document-shared-state-conflict-policy.md) | Document key and session ownership |
| [portal-office-document-bridge-threat-notes.md](portal-office-document-bridge-threat-notes.md) | Bridge threat notes (`lp-5q6.9`): download TTL, callback, JWT, SSRF, purge |
| Plan checkpoints `lp-5q6.1`–`lp-5q6.4` | Gate C: topology blocks production DS deploy, not preview pane |

---

## 13. Revision history

| Date | Change |
| --- | --- |
| 2026-07-24 | Initial decision draft for `lp-5q6.8` |
| 2026-07-25 | `lp-5q6.34`: staging module path `deploy/modules/staging-document-server/`, runbook + smoke |
