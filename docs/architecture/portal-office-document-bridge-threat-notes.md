# Office document bridge — threat notes

**Bead:** `lp-5q6.9` (security: threat notes for Office document bridge)  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Status:** Design-time threat notes. Implementation review of signed download + callback: [portal-office-signed-download-callback-security-review.md](portal-office-signed-download-callback-security-review.md) (`lp-5q6.35`, 2026-07-24). **Still not** a production pen-test or full Office-edit production sign-off.  
**Date:** 2026-07-24  
**Method:** Boundary inventory + STRIDE-style surfaces; assets → threats → required controls → residual → implementing beads.

> **Gate rule:** Do not claim **production** customer callback writeback or production Office edit readiness until license (`lp-5q6.7`), topology (ADR 0006), implementation review residuals (see `lp-5q6.35` review §4–§5), document keys (`lp-5q6.24`), JWT mint (`lp-5q6.26`), and purge/runbook (`lp-5q6.36`) are closed with evidence. Lab fixture open/edit/save may prove mechanics without production readiness.

---

## 1. Purpose and non-claims

### Purpose

Document the security posture of the **Office document bridge**: the BFF-owned path that lets ONLYOFFICE Document Server open vault files and write them back without ever touching Brain RPC, the relay, or `VAULT_ROOT` directly.

### Non-claims

| Non-claim | Why |
| --- | --- |
| Production pen-test pass | No independent test executed as part of this bead |
| Production writeback authorized | Free-track license (`lp-5q6.7`) + open residuals in `lp-5q6.35` review still gate |
| Deploy-host threat model complete | Host/vault posture lives in private-by-default model; this doc is the **product bridge** overlay |
| Implementation verified | Download/callback reviewed in [portal-office-signed-download-callback-security-review.md](portal-office-signed-download-callback-security-review.md); JWT mint / document keys still open |

### Linked platform security docs (required)

| Doc | What it already owns |
| --- | --- |
| [`deploy/references/threat-model-private-by-default.md`](../../deploy/references/threat-model-private-by-default.md) | Vault as critical asset on tenant EC2; TB-HOST / TB-VPC / TB-ACCOUNT; no public IP production; relay residual honesty |
| [`deploy/references/brain-rpc-contract.md`](../../deploy/references/brain-rpc-contract.md) §1 / §logging | No vault bodies in audit JSON; redacted settings; request logs without body content; fail-closed ACL |
| [`deploy/references/security-observability.md`](../../deploy/references/security-observability.md) | Tenant log partitions; do not ship vault content by default |
| [`deploy/references/tenant-isolation-decision.md`](../../deploy/references/tenant-isolation-decision.md) | Account/VPC/KMS partitions production isolation must respect |
| [ADR 0006](../adr/0006-document-server-topology-and-data-residency.md) / [topology](portal-document-server-topology.md) | Lab shared / staging shared / production per-tenant DS default |
| [Conflict policy](portal-document-shared-state-conflict-policy.md) | Session ownership, document keys, dirty human vs agent |
| [Domain model](portal-document-session-domain-model.md) | `OfficeDocumentSession`, routes, callback path authority |

---

## 2. System context and trust boundaries

```text
  Browser (Portal web)
    │  cookie/session auth for session create / editor config
    │  never holds DS JWT secret or signed download secret
    ▼
  Portal BFF  ──────────────────────────────────────────────┐
    │  owns OfficeDocumentSession store                     │
    │  mints editor JWT + document.key                      │
    │  mints short-lived signed download URL                │
    │  handles DS callback → vault.write CAS                │
    │                                                       │
    │  Brain RPC (authenticated product path only)          │
    ▼                                                       │
  Company Brain host (VAULT_ROOT)                           │
    vault bytes + content revision                          │
                                                            │
  Document Server (ONLYOFFICE)  ◄── browser editor UI       │
    │  GET  signed download URL  ───────────────────────────┘
    │  POST callback (status + optional url)  ──────────────► BFF
    │
    never speaks Brain RPC, never mounts VAULT_ROOT,
    never holds long-lived vault credentials
```

| Boundary | Inside | Outside | Notes |
| --- | --- | --- | --- |
| **TB-BFF-OFFICE** | Session store, JWT mint, signed download, callback handler | Browser, Document Server, Brain RPC callers | **Highest product risk** — external-service callback that can write vault |
| **TB-DS** | Document Server process + transient working set / forgotten files | Browser, network, shared-disk neighbors on shared topologies | Untrusted cache of vault bytes for session TTL + purge window |
| **TB-HOST-VAULT** | Customer vault on Company Brain | Portal multi-tenant control plane | Bytes leave only via BFF-mediated transfer (topology doc) |
| **TB-BROWSER** | Pane + editor iframe/host | User machine, XSS in Portal | Must not learn vault path ACL tokens beyond opaque `session_id` + editor config |

Document Server talks **only** to BFF Office endpoints for storage. Preview-only panes that never open Document Server are **out of scope** for this bridge (still subject to existing vault preview ACL).

---

## 3. Assets

| Asset | Sensitivity | Where it lives |
| --- | --- | --- |
| Vault file bytes (Office family) | Critical | Host `VAULT_ROOT`; transient on DS during edit |
| Content revision / CAS token | High | Host; mirrored on session as `base_revision` |
| `OfficeDocumentSession` map (tenant, user, path, revision, mode, keys, nonces) | High | BFF session store only |
| Signed download token / URL | High (capability) | Query/header on DS→BFF GET; short TTL |
| Editor config JWT (ONLYOFFICE) | High (capability) | Minted by BFF; browser holds until expiry; DS validates |
| Callback auth material (JWT / shared secret + session nonce) | High | BFF + DS config; never in git |
| Document key material inputs | Medium–High | Derived digest of tenant+path+revision (not raw path as key) |
| DS forgotten-file / cache residual | Critical if multi-tenant disk | DS volumes until purge |
| Metrics / logs / audit of Office events | Medium if redacted; Critical if body/token leak | BFF, DS, host, CloudWatch |

---

## 4. Adversaries (bridge-focused)

| Actor | Capability | Goals |
| --- | --- | --- |
| Internet / unauthenticated caller | Hit public BFF Office routes | Forge download or callback → read/write vault |
| Malicious or compromised tenant user | Valid Portal session for own tenant | Path traversal, ACL bypass, open neighbor paths, CSRF-style abuse of cookieed endpoints |
| Compromised Document Server (or shared-DS neighbor) | Can GET any URL it is given; holds working copies | Exfil other sessions’ bytes; SSRF via callback `url`; residual disk read |
| Stolen signed URL / JWT (logs, proxy, browser history) | Replay until expiry | Unauthorized download or re-open editor |
| Cross-tenant attacker on shared staging DS | Co-resident cache keys / forgotten files | Read another staging tenant’s document residual |
| Insider with BFF logs / metrics | Read product observability | Reconstruct document content or secrets from payloads |
| Agent / host tool concurrent with human edit | Host write path | Overwrite dirty human buffer (product policy, conflict doc) |

---

## 5. Required controls by surface

Implementation beads must fail closed. Design-time defaults below are normative for `lp-5q6.21`–`.26` and for review `lp-5q6.35`.

### 5.1 Signed download URL (TTL and capability)

**Route sketch:** `GET /api/office/sessions/:id/content` (or equivalent) with **signed token**, not browser cookie alone ([domain model §4](portal-document-session-domain-model.md)).

| Control | Requirement |
| --- | --- |
| **TTL** | Short-lived (target: **≤ 5 minutes** wall clock from mint; prefer **60–120s** if DS latency allows). Expired token → **401/403**, no body. |
| **Binding** | Token cryptographically binds at least: `session_id`, `tenant_id`, `path_id` or session hash, `content_revision`, expiry, purpose=`office_download`. |
| **Purpose** | Download-only. Cannot be reused as callback auth or editor JWT. |
| **Re-check** | On every GET: session exists and not closed/expired; tenant match; path/revision still match session; **host ACL re-validated** (or fail closed if host unreachable). |
| **Replay** | Prefer single-session multi-GET within TTL (DS may retry). Do **not** require single-use if that breaks DS retries; compensate with short TTL + session binding. Log replay-after-close as security signal. |
| **Size limits** | Enforce max stream size from session/file-type policy; oversized → fail before buffering whole body in BFF memory. Align with binary contract `lp-5q6.17`. |
| **Logging** | Never log token, Authorization header, or file body. Log `session_id`, `tenant_id`, result code, byte length optional, duration. |

**Threats covered:** stolen URL, cross-session download, stale revision download after close.

### 5.2 Callback authentication (external-service write boundary)

**Route sketch:** `POST /api/office/callback` (Document Server → BFF).

Treat this like a **payment/webhook callback**, not a normal browser POST.

| Control | Requirement |
| --- | --- |
| **Authn** | Verify ONLYOFFICE callback JWT (or shared-secret signature per DS config) **before** parsing action side effects. Invalid → **403**, no fetch of `url`, no vault write. |
| **Session mapping** | Resolve `session_id` (or key embedded in callback JWT claims) to **server-side** `OfficeDocumentSession`. Unknown/expired/closed → fail closed. |
| **Tenant** | Session’s `tenant_id` is authoritative; never accept tenant from callback body or URL query as override. |
| **Path** | Write path is **only** `session.path`. Callback body must not retarget path (`path_retarget_denied`). |
| **Status** | Explicit handling for ONLYOFFICE statuses `1,2,3,4,6,7` (see `lp-5q6.23`). Only statuses that mean “save ready” (`2`, `6` typically) may fetch bytes and write. |
| **URL host allowlist (SSRF)** | When status requires downloading assembled file from a `url` field, fetch **only** if host (and scheme) is on the **Document Server allowlist** for that environment. Block link-local, metadata IPs, arbitrary internet. |
| **Expected revision** | Write uses `expected_revision = session.base_revision` via typed `vault.write` (`lp-5q6.18`). Mismatch → conflict, no silent overwrite. |
| **Idempotency** | Stable `idempotency_key` per `(session_id, callback_save_generation or DS key)` so DS retries converge without duplicate divergent writes. |
| **Nonce / one-shot save** | Session carries `callback_nonce` (or save generation). Successful save advances generation; stale nonce rejected or treated as idempotent no-op if already saved same body hash. |
| **Response shape** | Return ONLYOFFICE-expected `{ "error": 0 }` only after accepted handling; errors use non-zero per integrator contract without leaking vault paths/bodies. |

**Threats covered:** unauthenticated write, path injection, tenant confusion, SSRF, replay storms, double write.

### 5.3 Editor JWT (ONLYOFFICE config)

| Control | Requirement |
| --- | --- |
| **Mint** | Only BFF (`lp-5q6.26`); secret from SM/SSM/env — never web bundle, never git. |
| **Claims** | document.key, permissions (view/edit), callback URL, document.url (signed download), user id display, expiry. |
| **TTL** | Align with session `expires_at` (short edit session; refresh via new mint, not infinite JWT). |
| **Key material** | `document.key` = digest of `tenant + normalized path + content_revision` ([conflict policy §4](portal-document-shared-state-conflict-policy.md)). |
| **Rotation** | Lab/staging/prod secrets distinct. Procedure: [operate-onlyoffice-document-server.md](../../deploy/references/runbooks/operate-onlyoffice-document-server.md) §6 (`lp-5q6.36`). |
| **Browser** | Web may hold JWT for editor load only; must not log it to analytics. |

### 5.4 CSRF exemption reasoning

| Endpoint class | Browser cookie auth? | CSRF posture |
| --- | --- | --- |
| `POST /api/office/sessions` (create) | Yes (Portal session) | **CSRF-protected** like other BFF mutations (SameSite cookie + CSRF token / custom header pattern already used by Portal BFF). |
| `GET/DELETE /api/office/sessions/:id` | Yes | Same as other session APIs. |
| `GET .../content` signed download | **No** cookie required | Auth is **capability token**. Not a CSRF vector from browser cookie; threat is token theft (TTL + binding). |
| `POST /api/office/callback` | **No** cookie | **Exempt from cookie CSRF defenses by design.** Document Server is not a browser origin and cannot present Portal CSRF tokens. **Compensating controls:** callback JWT/signature, session map, nonce, SSRF allowlist, CAS write. Exempting CSRF **without** those controls is forbidden. |

**Explicit ban:** Do not “fix” CSRF on the callback by requiring browser cookies — that would break DS and/or invite confused-deputy designs where the browser posts saves.

### 5.5 Path traversal and ACL

| Control | Requirement |
| --- | --- |
| **Normalize once** | On session create: vault-root-relative path, reject `..`, absolute paths, null bytes, alternate encodings that escape root. Store **normalized** path only. |
| **ACL at create** | BFF checks Portal/host path ACL for the authenticated user **before** minting session. |
| **ACL at download** | Re-check (host or cached policy with short TTL); deny if grant revoked mid-session. |
| **ACL at writeback** | Host `vault.write` enforces write ACL again; BFF does not skip host. |
| **No client path on callback** | Callback cannot supply a new path (domain model invariant). |

### 5.6 Tenant confusion

| Control | Requirement |
| --- | --- |
| Session row includes `tenant_id` from authenticated Portal context at create | |
| Download token binds tenant | Mismatch → deny |
| Document key includes tenant | Prevents shared-DS cache collision across tenants |
| Callback cannot switch tenant | |
| Metrics/audit always include `tenant_id` | Never log cross-tenant path strings without tenant |

**Shared staging residual:** logical isolation (JWT + keys + ACL) is accepted for **staging only** ([topology](portal-document-server-topology.md)). Production default is **per-tenant DS** so disk residual is not multi-tenant.

### 5.7 Replay

| Vector | Control |
| --- | --- |
| Replayed signed download after expiry | Fail closed on `exp` |
| Replayed signed download after session close | Session state check |
| Replayed callback after successful save | Idempotency key + nonce/generation; second success is no-op or same revision |
| Replayed editor JWT after session expiry | DS/BFF reject; user must re-mint |
| Stolen long-lived JWT secret | Rotation runbook §6; environment separation |

### 5.8 Idempotency

| Write path | Key |
| --- | --- |
| Callback save | `office-callback:{session_id}:{save_generation}` (or content hash once known) |
| Host `vault.write` | Pass idempotency through contract (`lp-5q6.18`) so relay/host retries do not fork revisions |
| Session create | Optional client `Idempotency-Key` for double-click open; server may return existing open session for same user+path+revision |

### 5.9 Size limits

| Limit | Guidance |
| --- | --- |
| Download stream | Cap by product policy (e.g. tens of MiB for Office MVP); reject with structured code, no partial vault dump to wrong caller |
| Callback fetch | Cap equal to download; reject DS-returned body over cap before `vault.write` |
| BFF memory | Stream host↔DS; do not hold full multi‑MB buffers in request logs |
| Preview path | Existing `/api/vault/content` stays small-file only — **not** this bridge |

### 5.10 Forgotten files and cache purge

Document Server may retain **forgotten files** and cache entries after the browser closes.

| Control | Requirement |
| --- | --- |
| **Session end** | Prefer force-save or explicit close; mark BFF session terminal |
| **Key churn** | New content revision ⇒ new `document.key`; never reopen stale key as authoritative |
| **Purge** | Operators must purge DS cache/forgotten files on a defined interval and on teardown. Production claim requires purge evidence (ADR 0006). Procedure: [operate-onlyoffice-document-server.md](../../deploy/references/runbooks/operate-onlyoffice-document-server.md) §8 (`lp-5q6.36`). |
| **Lab** | Compose volume wipe on teardown; never point lab DS at production vault |
| **Staging shared** | Accept residual co-residency; mitigate with keys/JWT/TTL + scheduled purge |
| **Production per-tenant** | Residual confined to tenant partition; still purge on decommission |

### 5.11 No file bodies in logs, metrics, errors, or audit metadata

Aligns with Brain RPC logging doctrine and G2b-style redaction.

| Sink | Allowed | Forbidden |
| --- | --- | --- |
| BFF request logs | `request_id`, route, `tenant_id`, `session_id`, status, duration, **byte length**, error **code** | File body, base64, JWT, signed token, full vault path if policy requires hash-only (prefer path prefix or hash) |
| Metrics (`lp-5q6.33`) | Counters/histograms: open, save, callback result, conflict, latency — catalog in [portal-office-observability.md](portal-office-observability.md) | Labels containing path, filename, user PII beyond tenant, token fragments |
| Error responses to DS/browser | Stable `error_code`, safe message | Vault excerpts, stack traces with file contents |
| Audit / CP | Actor, tenant, action (`office.session_create` / `office.callback_save`), result, revision ids | Secrets or vault bodies ([brain-rpc-contract](../../deploy/references/brain-rpc-contract.md) § CP DB boundary) |
| Document Server logs | Ops health only | Shipping DS logs that include document text to multi-tenant drains without review |

**Host logs:** do not enable vault content shipping ([security-observability](../../deploy/references/security-observability.md)).

---

## 6. STRIDE summary (bridge surfaces)

| Surface | S | T | R | I | D | E |
| --- | --- | --- | --- | --- | --- | --- |
| Session create | Portal session spoof → product auth | Tamper path → normalize+ACL | Audit create | — | Spam sessions → rate limit residual | — |
| Signed download | Stolen token | Token rewrite → MAC/JWT | Download audit | Body in logs | Large GET DoS → size cap | — |
| Callback | Forged POST | Status/url/path tamper | Callback audit | SSRF / body leak | Retry storms → idempotency | Write as other user → session bind |
| Editor JWT | Secret theft | Claim rewrite | — | JWT in analytics | — | Edit without ACL → mint-time ACL only + host write |
| Shared DS disk | — | Cache key collision → tenant+rev in key | — | Forgotten file residual | Disk fill | Cross-tenant read on shared staging |

---

## 7. Topology-specific residual risk

| Topology | Residual | Accept? | Mitigations |
| --- | --- | --- | --- |
| `lab-shared-compose-ds` | Lab DS holds fixture bytes; JWT lab secret weak if committed | Lab only | Fixture vault only; rotate if leaked; wipe volumes |
| `staging-platform-shared-ds` | **Cross-tenant disk residual** on one DS | Staging only | JWT isolation, document keys, purge job, no production data |
| `prod-per-tenant-ds` | Per-tenant DS RCE still sees that tenant’s working set | Default prod | Private-by-default host posture; BFF still sole storage API |
| `prod-shared-ds-opt-in` | Multi-tenant residual like staging but production data | **Only with written opt-in** | Same as staging + stronger purge SLO + review |
| ONLYOFFICE Cloud | Third-party processor of vault bytes | Not private-by-default default | Contractual + explicit product opt-in only |

This overlay does **not** relax [private-by-default](../../deploy/references/threat-model-private-by-default.md) host controls.

---

## 8. Critical findings → blocking follow-up beads

Findings that are **blocking** for production-grade staging/production Office writeback. Most already have beads; this table is the durable map. New beads only when a gap remains.

| ID | Finding | Severity | Follow-up bead | Status of coverage |
| --- | --- | --- | --- | --- |
| CF-1 | Callback is a high-privilege external write boundary (auth, status, path authority, CAS) | Critical | `lp-5q6.23` implement; `lp-5q6.35` review | **Reviewed** — implemented (see `lp-5q6.35` review) |
| CF-2 | Callback `url` fetch is an **SSRF** footgun without host allowlist | Critical | `lp-5q6.23` (allowlist acceptance); re-check in `lp-5q6.35` | **Reviewed** — allowlist + redirect ban |
| CF-3 | Signed download without short TTL / binding leaks vault bytes | Critical | `lp-5q6.22` | **Reviewed** — 120s default / 300s hard max |
| CF-4 | Document key missing tenant/revision → cache confusion / wrong bytes | Critical | `lp-5q6.24` (+ conflict policy) | Open implementation |
| CF-5 | Forgotten files / DS cache retain customer content after session | Critical (shared DS) | Ops runbook purge §8; purge evidence before prod claim | Covered (procedure); prod claim still needs live purge evidence |
| CF-6 | File bodies or tokens in logs/metrics/audit | Critical (disclosure) | `lp-5q6.22`/`.23`/`.33` acceptance; doctrine above | **Reviewed** for `.22`/`.23` log sites |
| CF-7 | Production writeback before review of **real** code | Critical (process) | `lp-5q6.35` review doc | **Done** (PASS WITH RESIDUALS) |
| CF-8 | Shared production DS without opt-in | Critical (isolation) | Topology ADR 0006; no new bead | Covered by decision |
| CF-9 | CSRF exemption on callback without compensating JWT/nonce/SSRF/CAS | Critical | Encode in `lp-5q6.23` + this doc §5.4; verify in `lp-5q6.35` | **Reviewed** — nonce + SSRF + CAS present |

No additional Beads were created: every critical finding maps to an existing child of `lp-5q6`. If implementation introduces a new critical residual not listed here, **file a blocking bead** and link it from `lp-5q6.35` notes before unblocking staging production-intent Office edit.

---

## 9. Implementation checklist (for `lp-5q6.21`–`.26` authors)

Copy into PR descriptions as needed:

- [ ] Session store: tenant, user, normalized path, base_revision, mode, document_key, callback_nonce, lifecycle, dirty
- [ ] Download: signed, short TTL, purpose-bound, ACL re-check, size cap, no token/body logs
- [ ] Callback: verify JWT/signature first; status matrix; SSRF allowlist; server-side path; CAS + idempotency; no cookie CSRF dependency
- [ ] JWT mint: secret from env/SM; claims match session; distinct lab/staging/prod secrets
- [ ] CSRF: protect cookieed session APIs; document callback exemption + compensations
- [ ] Path: reject traversal; host ACL on create/download/write
- [ ] Tenant: bound in session, token, document.key
- [ ] Metrics: counters only; no path/body labels (`lp-5q6.33`)
- [x] Purge story linked for DS volumes (`lp-5q6.36` → [operate-onlyoffice-document-server.md](../../deploy/references/runbooks/operate-onlyoffice-document-server.md) §8)
- [ ] Tests: expired token, wrong tenant, bad signature, bad URL host, conflict revision, duplicate callback, oversized body

---

## 10. Acceptance checklist (`lp-5q6.9`)

| Criterion | Where |
| --- | --- |
| Signed download URL TTL, callback auth, JWT, CSRF exemption reasoning, path traversal, ACL, tenant confusion, replay, idempotency, size limits | §5.1–§5.9, §6 |
| Document Server forgotten files and cache purge | §5.10, §7 |
| No file bodies in logs, metrics, errors, or audit metadata | §5.11 |
| Links to private-by-default and log redaction docs | §1 linked table; §5.11; brain-rpc + security-observability |
| Critical findings → blocking follow-up beads | §8 |

---

## 11. Related beads (quick index)

| Bead | Role |
| --- | --- |
| `lp-5q6.8` | Topology / residency (Accepted) |
| `lp-5q6.9` | **This document** |
| `lp-5q6.17` / `.18` | Binary transfer + typed `vault.write` |
| `lp-5q6.21`–`.24`, `.26` | Session, download, callback, keys, JWT mint |
| `lp-5q6.33` | Metrics without payload leaks |
| `lp-5q6.35` | Security **review of implementation** → [portal-office-signed-download-callback-security-review.md](portal-office-signed-download-callback-security-review.md) |
| `lp-5q6.36` | Operate DS, rotate JWT, purge forgotten files |

---

## 12. Revision history

| Date | Change |
| --- | --- |
| 2026-07-24 | Initial threat notes for `lp-5q6.9` |
| 2026-07-24 | Linked `lp-5q6.35` implementation review; updated CF disposition + gate language |
