# Security review: signed download and callback writeback

**Bead:** `lp-5q6.35`  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Date:** 2026-07-24  
**Scope:** Actual BFF implementation of Office signed download (`lp-5q6.22`) and ONLYOFFICE callback writeback (`lp-5q6.23`), plus session authorize / token helpers (`lp-5q6.21`) and host write path used by the callback.  
**Threat model baseline:** [portal-office-document-bridge-threat-notes.md](portal-office-document-bridge-threat-notes.md) (`lp-5q6.9`)

> **Verdict:** **PASS WITH RESIDUALS** for the implemented download and callback bridge.  
> No **new critical** defects were found in the code paths reviewed. Staging/production **Office edit readiness is still not authorized** — open upstream gates and residuals below remain blocking for production-intent claims. This review is **not** a pen-test or production security sign-off.

---

## 1. What was inspected

| Surface | Code (absolute under repo root) | Routes |
| --- | --- | --- |
| Download authorize + helpers | `portal/packages/bff/src/office/download.ts` | — |
| Download token hash / secrets | `portal/packages/bff/src/office/tokens.ts` | — |
| Session purpose gates | `portal/packages/bff/src/office/authorize.ts` | — |
| Session store (memory + Redis) | `portal/packages/bff/src/office/store.ts`, `redis-store.ts` | — |
| Binary read adapter | `portal/packages/bff/src/office/binary-source.ts` | — |
| Callback pipeline + SSRF | `portal/packages/bff/src/office/callback.ts` | — |
| HTTP wiring | `portal/packages/bff/src/app.ts` (~1430–1679) | `POST /api/office/callback`, `GET /api/office/sessions/:sessionId/content` |
| Host write (callback origin) | `portal/packages/backend-runtime/src/vault-bff.ts` (`writeCallback` / `parseCallbackVaultWriteBody`) | via Brain RPC `vault.write` |
| Tests | `portal/packages/bff/test/office-download.test.ts`, `office-callback.test.ts`, `office-document-session.test.ts` | unit + HTTP |

**Not in this bead’s implementation scope (still open / separate):**

| Item | Bead | Relevance |
| --- | --- | --- |
| Editor JWT mint + secret boot | `lp-5q6.26` | Threat notes §5.3; callback JWT verification when DS JWT is on |
| Document key policy (tenant+path+rev) | `lp-5q6.24` | CF-4 cache uniqueness on shared DS |
| DS purge / JWT rotation runbook | `lp-5q6.36` | CF-5 forgotten files |
| Free-track license | `lp-5q6.7` | Legal/commercial gate |
| Staging DS topology deploy | `lp-5q6.34` | Blocked by this review historically; still needs residual gates |

---

## 2. Acceptance matrix (threat notes → code)

### 2.1 JWT signing / editor config

| Control (threat notes) | Implementation evidence | Status |
| --- | --- | --- |
| BFF mints editor JWT; secret not in web bundle | **Not implemented** — `lp-5q6.26` open | **Deferred** (tracked) |
| Callback verifies ONLYOFFICE JWT when enabled | `callback.ts` accepts optional `token` field but **does not verify** it; auth is **callback nonce** only | **Residual R-JWT-1** (blocked by `.26`) |
| Compensating controls without JWT | Nonce + session map + SSRF allowlist + CAS write present | **Met** for nonce-based lab path |

**Review conclusion:** JWT signing is **out of scope of shipped `.22`/`.23` code**. Callback security today rests on **session-bound nonce**, not DS JWT. That matches the threat-notes “JWT **or** shared-secret/nonce” compensating set **if** nonces stay high-entropy and unlogged. Enabling DS JWT without verification would be a footgun — `lp-5q6.26` must verify JWT **before** fetch/write when JWT mode is on.

### 2.2 Token TTL (signed download)

| Control | Evidence | Status |
| --- | --- | --- |
| Short-lived download capability | `DEFAULT_OFFICE_DOWNLOAD_TTL_SECONDS = 120`, hard max `300` (`types.ts`); enforced via `download_expires_at` in `authorizeOfficeDownload` | **Met** |
| Session absolute expiry | `DEFAULT_OFFICE_SESSION_TTL_SECONDS = 3600`; `authorizeOfficeSession` fails closed | **Met** |
| Expired → no body | HTTP 403 + structured code; tests cover expired token | **Met** |
| Purpose-bound (download ≠ callback) | Download uses `download_token` / hash; callback uses `callback_nonce` | **Met** |

### 2.3 Callback nonce / replay / idempotency

| Control | Evidence | Status |
| --- | --- | --- |
| Nonce required | `authorizeOfficeCallback` → missing nonce 401 | **Met** |
| Constant-time compare | `verifyCallbackNonce` (`timingSafeEqual`) | **Met** |
| Duplicate final save (status 2) | Lifecycle `saved` short-circuits to `{ error: 0, code: "duplicate" }` without second write | **Met** |
| Host idempotency key | `office-cb:{session_id}:{status}:{content_sha256_prefix}` in `buildOfficeCallbackWriteParams` | **Met** |
| Nonce rotation after successful save | Nonce is **static** for session lifetime | **Residual R-REPLAY-1** (Medium) — mitigated by lifecycle + content-hash idempotency |
| Nonce stored hashed | Download token is SHA-256 hashed; **callback_nonce stored plaintext** in session record | **Residual R-STORE-1** (Medium) |

### 2.4 SSRF (callback `url` fetch)

| Control | Evidence | Status |
| --- | --- | --- |
| Host allowlist | `assertOfficeCallbackUrlAllowed`; empty allowlist **fail closed** | **Met** |
| Env config | `BFF_OFFICE_DOCUMENT_SERVER_HOSTS` / `ONLYOFFICE_DOCUMENT_SERVER_HOSTS` | **Met** |
| Scheme allowlist | Default `http`/`https` | **Met** |
| Block credentials in URL | username/password rejected | **Met** |
| Block metadata / link-local | `169.254.*`, IPv6 `fe80`/`fc`/`fd` hard-blocked even if listed | **Met** |
| No redirect follow | `redirect: "manual"`; 3xx → `bad_url` | **Met** |
| Tests | Metadata URL, off-allowlist host, bad URL HTTP path | **Met** |
| DNS rebinding after hostname allowlist | Fetch uses hostname; resolved IP not re-checked | **Residual R-SSRF-1** (Medium) — accept for lab/VPC-private BFF; harden before hostile multi-tenant edge |

### 2.5 ACL

| Control | Evidence | Status |
| --- | --- | --- |
| ACL at session create | No public create/mint route yet (`lp-5q6.26`); store accepts caller-supplied path | **Deferred to mint** |
| ACL at download (host re-check) | Download reads via `OfficeBinaryContentSource` by **session path only** — **no RBAC re-check** on GET | **Residual R-ACL-1** (Medium) |
| ACL at writeback | Callback writer loads CP RBAC for session user; stamps `pathPrefixes` into backend context; host `vault.write` enforces again | **Met** (defense-in-depth at host) |
| Path authority on callback | Path **only** from `OfficeDocumentSession`; body cannot retarget | **Met** |

**R-ACL-1 note:** Short download TTL (≤2 min default) bounds the window after mid-session ACL revoke. Full threat-notes “re-check on every GET” is **not** implemented; file as residual, not critical while mint-time ACL is enforced and TTL stays short.

### 2.6 Path traversal

| Control | Evidence | Status |
| --- | --- | --- |
| Normalize / reject `..` at vault FS layer | `normalizeVaultPath` + root escape checks in vault FS providers | **Met** for FS reads |
| Session stores path as given | Create does not re-normalize in office store | **Residual R-PATH-1** (Low) — mint must normalize once before store |
| Path/type binding | `pathMatchesOfficeFileType` on download | **Met** |
| Content-Disposition filename | Last path segment; quotes stripped only | **Residual R-LOG-1** (Low disclosure of filename) |

### 2.7 Tenant isolation

| Control | Evidence | Status |
| --- | --- | --- |
| Session carries `tenant_id` from create context | Store field required | **Met** |
| Download/callback require host-resolved tenant match | `authorizeOfficeSession` / callback auth | **Met**; HTTP tests wrong-tenant host |
| Download token not cross-session reusable | Hash bound to session record; wrong session id → not found / invalid | **Met** |
| Document key includes tenant | Policy not coded (`lp-5q6.24`); callers pass free-form `document_key` | **Blocked by `lp-5q6.24`** (CF-4) |
| Shared staging DS residual | Topology ADR 0006 — accepted for **staging only** | **Accepted residual** |

### 2.8 Cache key uniqueness (`document.key`)

| Control | Evidence | Status |
| --- | --- | --- |
| Digest(tenant + normalized path + revision) | Not implemented in BFF office module | **Open `lp-5q6.24`** |
| Soft key match on save | Save rejects `payload.key !== session.document_key` when key present | **Partial** (depends on mint policy) |

### 2.9 Conflict handling (CAS)

| Control | Evidence | Status |
| --- | --- | --- |
| `expected_revision` / `ifMatch` from session | `buildOfficeCallbackWriteParams` uses `saved_revision ?? revision` | **Met** |
| Host conflict → no silent overwrite | `mapWriteError` → lifecycle `conflict`, `{ error: 0, code: "conflict" }` for DS | **Met** |
| Force-save advances base revision | Session `revision` updated to `newRevision` after successful write | **Met** |
| View mode cannot write | `authorizeOfficeSession` purpose `write` requires `mode === "edit"` | **Met** |

### 2.10 Logs / metrics / error bodies

| Control | Evidence | Status |
| --- | --- | --- |
| No token/nonce/body in logs | Download/callback log `session_id`, `tenant_id`, reason/status only; redact helpers for URLs | **Met** (code review) |
| Error bodies are codes | `officeDownloadErrorBody`, callback `{ error, code }` | **Met** |
| Default path omitted from download ok log | Comment + fields in `app.ts` | **Met** |
| Metrics labels | `lp-5q6.33` separate | Out of scope |

### 2.11 Size limits

| Control | Evidence | Status |
| --- | --- | --- |
| Download max | Default 50 MiB, hard 100 MiB; early reject on known size | **Met** |
| Callback fetch max | Same max via `resolveOfficeDownloadMaxBytes` | **Met** |
| Inline vault.write hard max | `VAULT_WRITE_INLINE_HARD_MAX_BYTES = 4 MiB` in backend-runtime; callback route passes `min(officeMax, 4_194_304)` | **Fail closed** (good security) — **product residual R-SIZE-1**: Office files >4 MiB cannot write via inline content until content_ref / higher hard max |

---

## 3. CSRF exemption (threat notes §5.4)

| Endpoint | Cookie CSRF | Compensating controls | Verdict |
| --- | --- | --- | --- |
| `GET .../content` | No cookie | Capability token, short TTL, session bind | **OK** |
| `POST /api/office/callback` | No cookie | Nonce, session map, SSRF allowlist, CAS, idempotency | **OK** for current nonce design |
| Future cookieed `POST /api/office/sessions` | Must use existing BFF CSRF | — | **Required when mint lands** (`lp-5q6.26`) |

CF-9 is **satisfied for the non-cookie callback** with compensating controls. JWT remains optional until `.26`.

---

## 4. Critical findings (CF) disposition

| ID | From threat notes | Disposition after code review |
| --- | --- | --- |
| CF-1 | Callback high-privilege write boundary | **Implemented** — nonce, status matrix, path authority, CAS |
| CF-2 | SSRF on callback URL | **Implemented** — allowlist + redirect ban + metadata block |
| CF-3 | Signed download TTL / binding | **Implemented** — 120s default / 300s hard max, hash-bound token |
| CF-4 | Document key tenant/revision | **Open** — `lp-5q6.24` (blocking for shared-DS production claim) |
| CF-5 | Forgotten files / purge | **Open** — `lp-5q6.36` |
| CF-6 | Bodies/tokens in logs | **Implemented** in `.22`/`.23` log sites reviewed |
| CF-7 | Review of real code before writeback claim | **This document** (`lp-5q6.35`) |
| CF-8 | Shared prod DS without opt-in | **Decision** ADR 0006 (no code change) |
| CF-9 | CSRF exempt without compensations | **Compensations present** (nonce path) |

### New findings from this review

| ID | Severity | Finding | Action |
| --- | --- | --- | --- |
| R-ACL-1 | Medium | Download path does not re-check host/Portal ACL | Residual; keep download TTL short; enforce ACL at session mint (`lp-5q6.26`) |
| R-JWT-1 | Medium | Optional callback JWT field not verified | Block enabling DS JWT until `lp-5q6.26` verifies |
| R-STORE-1 | Medium | `callback_nonce` stored plaintext (vs hashed download token) | Residual; prefer hash-at-rest in a follow-up if Redis shared |
| R-REPLAY-1 | Medium | Nonce not rotated after save | Residual; lifecycle + content-hash idempotency mitigate |
| R-SSRF-1 | Medium | Hostname allowlist without post-DNS IP pin | Residual for private BFF; harden before public-edge BFF |
| R-PATH-1 | Low | Office store does not normalize path on create | Enforce at mint |
| R-SIZE-1 | Medium (availability) | Inline write hard max 4 MiB ≪ Office download 50 MiB | Product/contract follow-up — **not** a privilege escalation (fail closed) |
| R-LOG-1 | Low | Filename may appear in `Content-Disposition` | Acceptable for DS; avoid logging header dumps |
| R-NONCE-QUERY-1 | Medium (info disclosure) | Callback auth nonce remains in `callbackUrl` query (`?session_id=&nonce=`) | **Accepted residual (lp-p37.9)** — see §4.1 |

**No new Critical findings** requiring a fresh blocking bead beyond already-open `lp-5q6.24`, `lp-5q6.26`, `lp-5q6.36`, and license/topology gates.

### 4.1 Residual decision: callback nonce in query string (lp-p37.9)

**Finding:** ONLYOFFICE Document Server POSTs to the editor-config `callbackUrl` as an opaque URL. Today the BFF mints  
`/api/office/callback?session_id=…&nonce=…`. The nonce is a capability secret; query strings can appear in reverse-proxy access logs, `Referer` (if any intermediate returned HTML), browser history (not applicable to DS server-side POST), and crash dumps.

**Can we move auth out of the URL?**

| Option | ONLYOFFICE support | Status |
| --- | --- | --- |
| Custom HTTP header on DS → BFF callback | Document Server does **not** let the integrator set arbitrary callback headers | Not available |
| Nonce only in callback JSON body | DS sends its own status payload; integrator-controlled body fields are not a supported auth channel | Not available as sole auth |
| ONLYOFFICE JWT in callback body (`token`) | Supported when DS JWT is enabled; BFF already accepts optional body/header nonce and is planned to **verify** DS JWT (`R-JWT-1` / mint path) | Complementary, not a full replacement for session binding today |
| Query nonce (current) | Required by DS `callbackUrl` contract | **Retained** |

**Decision (2026-07-27, lp-p37.9):** Keep nonce (and session_id) in the callback URL query. Compensating controls:

1. Nonce is high-entropy, session-bound, constant-time compared; wrong nonce never fetches DS bytes.
2. Logs redact `nonce` via `redactOfficeCallbackUrl` / shared secret key patterns; access logs must not be shipped with raw query in multi-tenant production without redaction (ops).
3. BFF also accepts `x-office-callback-nonce` and body `nonce` for non-DS callers/tests — DS itself still uses the query form.
4. When DS JWT verification lands, treat JWT as defense-in-depth; query nonce remains the session-binding secret unless ONLYOFFICE adds a header auth path.

**Residual risk owner:** Portal BFF / Office bridge. **Not** a production unblocker by itself; production writeback remains gated by license, topology, JWT mint verification, and purge.

---

## 5. Staging / production gate statement

| Claim | Allowed after this review? |
| --- | --- |
| Lab fixture open/edit/save with nonce auth + allowlisted DS | **Yes** (mechanics) |
| “Signed download + callback implementation reviewed against threat notes” | **Yes** — this doc |
| Staging Document Server **secrets deploy** (`lp-5q6.34`) | **Not solely unblocked by code quality** — still require empty-allowlist ops config, secrets, license decision (`lp-5q6.7`), topology (`lp-5q6.8`/ADR 0006), and operator acceptance of shared-staging residual |
| Production customer writeback / production-ready Office edit | **No** — CF-4/5, JWT mint, purge evidence, private-by-default host posture, free-track license |
| Pen-test pass | **No** |

**Explicit:** Do **not** set production customer callback writeback live based only on this review. Medium residuals above must not be waived silently for multi-tenant production shared DS.

---

## 6. Test evidence

Inspected tests cover (non-exhaustive):

- Download: valid stream, Bearer token, expired TTL, wrong tenant, wrong session, missing file, oversized, unsupported type, path/type mismatch, closed session, token redaction
- Callback: status 1/2/3/4/6/7, force save, duplicate, bad nonce, view mode, tenant mismatch, CAS conflict, SSRF bad URL / metadata, no fetch before auth
- Session store: fields, expiry, lifecycle authorize, idempotent create

Local worktree note: full `office-download` / `office-callback` suite import requires built `@lanyard/backend-runtime` package; `office-document-session.test.ts` (22 tests) passed in isolation on 2026-07-24. CI on merge of `#97` / `#98` remains the integration signal.

---

## 7. Reviewer checklist (acceptance `lp-5q6.35`)

| Criterion | Result |
| --- | --- |
| Review covers JWT signing, token TTL, callback nonce, replay, SSRF, ACL, path traversal, tenant isolation, cache key uniqueness, conflict handling, and logs | **Yes** — §2 |
| Reviewer inspects actual BFF routes and host write code | **Yes** — §1 file list + `app.ts` routes + `writeCallback` |
| Critical findings fixed or filed as blocking beads | **No new criticals**; existing CF-4/5/JWT tracked on open beads |
| Staging remains blocked while critical findings open | **Production-intent staging remains gated** on open critical process/product beads (§5); download/callback code path itself is not a remaining critical defect |
| Review result recorded in bead notes or linked doc | **This document** |

---

## 8. Related documents

- [portal-office-document-bridge-threat-notes.md](portal-office-document-bridge-threat-notes.md) — design-time threat notes (`lp-5q6.9`)
- [portal-document-session-domain-model.md](portal-document-session-domain-model.md) — session/route model
- [portal-document-shared-state-conflict-policy.md](portal-document-shared-state-conflict-policy.md) — CAS / dirty human
- [portal-document-server-topology.md](portal-document-server-topology.md) + [ADR 0006](../adr/0006-document-server-topology-and-data-residency.md)
- [deploy/references/threat-model-private-by-default.md](../../deploy/references/threat-model-private-by-default.md)
- [deploy/references/brain-rpc-contract.md](../../deploy/references/brain-rpc-contract.md) — no vault bodies in audit

---

## 9. Revision history

| Date | Change |
| --- | --- |
| 2026-07-24 | Initial implementation security review for `lp-5q6.35` (download + callback) |
