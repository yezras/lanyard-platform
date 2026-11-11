# Binary vault transfer and revision semantics (Office editing)

**Bead:** `lp-5q6.17` (contract: binary vault transfer and revision semantics for Office editing)  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Status:** Normative contract (docs + schema examples; no product implementation in this bead)  
**Principles:** boundary-discipline, type-system-discipline, separate-before-serializing-shared-state  
**Depends on:** `lp-5q6.6` domain model, `lp-5q6.3` conflict policy, `lp-5q6.5` HOW grounding, `lp-5q6.8` topology  
**Feeds:** `lp-5q6.18` (`vault.write` schema), `lp-5q6.21`–`lp-5q6.24` (session, signed download, callback, document key), `lp-5q6.22` (BFF download endpoint)

## Purpose

Protect the system from accidentally **base64-shuttling large customer Office
files through JSON and logs**. This note decides:

1. How bytes larger than `vault.read` hard cap move for Office open/save.
2. How **revision identity** is formed and compared (CAS).
3. Size / type / sniffing policy for Office transfer.
4. How the BFF streams between Document Server and host without logging bodies.

Related durable policy:

- Domain types: [`portal-document-session-domain-model.md`](./portal-document-session-domain-model.md)
- Conflict / document keys: [`portal-document-shared-state-conflict-policy.md`](./portal-document-shared-state-conflict-policy.md)
- Topology: [`portal-document-server-topology.md`](./portal-document-server-topology.md)
- HOW size wall: [`../plans/0004-portal-onlyoffice-integration/how-source-grounding.md`](../plans/0004-portal-onlyoffice-integration/how-source-grounding.md)
- Wire shapes: `contracts/backend-runtime-v1/brain-rpc.schema.json` (`documentRevision`),  
  `contracts/backend-runtime-v1/examples/office-binary-transfer.*`

---

## 1. Decision: binary transfer approach

### 1.1 Choice (normative)

| Plane | Chosen approach | Rationale |
| --- | --- | --- |
| **Document Server ↔ BFF** | **BFF-mediated short-lived signed HTTP URLs** streaming raw bytes (`application/octet-stream`) | ONLYOFFICE requires a fetchable URL; DS must never call Brain RPC or see vault paths as authority |
| **BFF ↔ Company Brain host** | **Chunked Brain RPC content transfer** over the existing **egress-only** relay WebSocket (`vault.read_chunk` / write body modes defined with `vault.write`) | Host has no inbound HTTP; cannot rely on host-generated public URLs. Single-shot `vault.read` JSON/base64 is hard-capped and must not be stretched |
| **Browser previews (non-edit)** | Existing `vault.read` → `GET /api/vault/content` JSON/base64 **only within hard cap** | Unchanged for small previews; not an Office production plane |

**Rejected alternatives**

| Alternative | Why rejected |
| --- | --- |
| Raise `vault.read` hard max and base64 entire DOCX/XLSX/PPTX in JSON | Memory/log blow-ups; WS frame pressure; couples preview ACL cache to editor; fails closed product stance in HOW/checkpoints |
| Host-generated short-lived HTTP URLs as the **primary** host path | Conflicts with **egress-only** host posture (no reliable inbound fetch from BFF without new ingress attack surface) |
| Direct Document Server → host / vault FS | Violates topology hard boundary (DS never reaches vault or Brain RPC) |
| Chunked binary as the browser/DS path | DS and browser should only see BFF HTTP; chunks stay on BFF↔host |

**Optional future upgrade (not required for MVP):** host-side private content lease URLs **inside the tenant partition** (e.g. BFF pulls from a host agent HTTP loopback only when deploy topology guarantees it). Until that is a named deploy feature, **chunked Brain RPC remains the portable default**.

### 1.2 End-to-end byte path (Office open)

```text
Document Server
  GET {bff}/api/office/sessions/{session_id}/content?token=…
        │  Authorization: signed short-lived single-purpose token
        │  Response: 200 application/octet-stream  (raw bytes, streamed)
        ▼
Portal BFF
  1. Validate token → OfficeDocumentSession (tenant, user, path, base_revision, expiry)
  2. Re-check path ACL + session lifecycle
  3. vault.stat(path) → confirm file exists and revision.token matches base_revision
  4. Loop vault.read_chunk { path, offset, max_bytes, expected_revision }
        until eof; write each decoded chunk to the HTTP response stream
  5. Never assemble a full base64 string for logging or metrics
        ▼
Company Brain host (Brain RPC over relay)
  Returns chunk metadata + base64 chunk body only on the RPC result frame
  (bounded chunk size; see §5)
```

### 1.3 End-to-end byte path (Office save / callback)

```text
Document Server
  POST {bff}/api/office/callback  (status ready-to-save + url)
        ▼
Portal BFF
  1. Validate callback JWT/nonce → session; path is server-side only
  2. HTTP GET edited bytes from Document Server url (host allowlist; size cap)
  3. Stream into vault.write (lp-5q6.18) with:
       mode: replace_if_match
       expected_revision: session.base_revision
       content via chunked session or bounded transfer (never log body)
  4. On CAS match → new DocumentRevision; mark session saved
     On mismatch → conflict; no partial write
```

### 1.4 Explicit ban: production Office via JSON/base64 preview API

| Surface | Production Office open/edit/save | Lab / fixture exception |
| --- | --- | --- |
| Brain RPC `vault.read` | **Forbidden** as the Office binary plane | Allowed only for fixtures **≤ hard max (4 MiB)** and non-production claims |
| Portal `GET /api/vault/content` | **Forbidden** for Document Server download and for production edit writeback | Allowed for **VaultReader** small-file previews and lab fixtures under the same cap |
| BFF signed Office content URL | **Required** for Document Server download | Same |
| Logging of file bodies (any plane) | **Forbidden** (see §6) | **Forbidden** even in lab |

Product rule (fail closed):

> If a code path is about to put Office-family bytes into a JSON `content`
> field for Document Server or for production writeback, **stop**. Use the
> signed binary URL plane (DS↔BFF) and chunked/host write transfer (BFF↔host).

Feature flags / env gates for lab may allow “mechanical open/save with fixture
under 4 MiB via vault.read” only when `deployment_tier ∈ {lab, test}` and the
file is a known fixture path. Staging and production must not ship that path
as the Office plane.

---

## 2. Revision identity

### 2.1 Wire type (`DocumentRevision`)

Normative JSON Schema: `#/$defs/documentRevision` in
`contracts/backend-runtime-v1/brain-rpc.schema.json`.

```typescript
// Domain model (lp-5q6.6) — wire uses snake_case
type DocumentRevision = {
  /** Opaque token; host compares with constant-time equality. */
  token: string;
  /** How the token was produced. */
  kind: "etag" | "content_hash" | "host_revision" | "mtime_size_fallback";
  size_bytes?: number;
  /** ISO-8601; UI only — never sole CAS key. */
  modified_at?: string;
};
```

### 2.2 Kind preference (host production)

| Priority | `kind` | Production Office edit | Notes |
| --- | --- | --- | --- |
| 1 | `content_hash` | **Preferred** | e.g. `sha256:<hex>` of file bytes; strongest cache/CAS semantics |
| 2 | `etag` | **Allowed** | Opaque strong etag from host FS/object metadata when equivalent to content identity |
| 3 | `host_revision` | **Allowed** | Monotonic or UUID revision issued by host vault metadata store |
| 4 | `mtime_size_fallback` | **Lab / preview only** | `"{mtime_ms}-{size_bytes}"` style; **must not** mint production Office `document.key` or accept as sole CAS for production writeback |

**Rules**

1. `vault.stat` **SHOULD** return `revision` for every file entry once the host
   implements Office support; **MUST** return it before BFF mints an edit session.
2. Minting ONLYOFFICE `document.key` without a revision token is **forbidden**.
3. Production Office edit session create **MUST reject**
   `kind === "mtime_size_fallback"` (fail closed; force host upgrade or lab tier).
4. Same path + different `revision.token` ⇒ different document key material
   (see conflict policy §4).
5. Preview pane may operate without revision (best-effort reload); edit path may not.

### 2.3 Exposure surfaces

| Surface | Carries revision? |
| --- | --- |
| `vault.stat` / `vault.list` entries | Optional `revision` object (required for Office open) |
| `vault.read` result | Optional `revision` (echo); still size-capped preview API |
| `vault.read_chunk` result | `revision` of the file being read (must match `expected_revision` when supplied) |
| `vault.write` result (`lp-5q6.18`) | New `revision` after successful write |
| BFF `OfficeDocumentSession.base_revision` | Frozen at open |
| Artifact events / pane state | `DocumentRevision` as in domain model |
| Logs / metrics / errors | **token may appear hashed or truncated**; never file body |

---

## 3. Expected-revision behavior for writes

Full `vault.write` params/results are owned by **`lp-5q6.18`**. This bead fixes
CAS semantics those schemas must implement.

### 3.1 Modes (normative intent)

| Mode | Requires | Behavior |
| --- | --- | --- |
| `create_new` | path must not exist | Create; conflict if exists |
| `replace_if_match` | `expected_revision` **required** | Compare-and-swap: write only if current host revision token equals expected; else `conflict` / `revision_mismatch`, **no partial write** |
| `replace_if_absent` / create-only variants | per `.18` | Idempotent create helpers |
| Blind overwrite without expected revision | — | **Forbidden** as default for Office callback and agent replace of existing files |

### 3.2 Compare rules

1. Host loads current revision for `path` (or treats missing as not_found).
2. For `replace_if_match`, compare `expected_revision.token` to current
   `revision.token` with **constant-time** equality on the token string.
3. `kind` on the request is advisory for debug; host authoritative kind is on
   the stored revision. Callers should pass through the token from `vault.stat`.
4. On match: write all bytes (or commit chunked session), then publish **new**
   revision (content_hash preferred). Return new revision on success.
5. On mismatch: return structured error:

```json
{
  "code": "conflict",
  "message": "revision_mismatch",
  "retryable": false,
  "details": {
    "path": "/Projects/Acme/proposal.docx",
    "reason": "revision_mismatch",
    "expected_revision_token": "…",
    "actual_revision_token": "…"
  }
}
```

6. Office callback always uses `replace_if_match` with
   `expected_revision = session.base_revision`.
7. **Idempotency:** retries with the same `idempotency_key` and identical body
   hash after a successful write must converge to success with the **same**
   resulting revision (`.18` owns key lifetime). Do not double-apply side effects.

### 3.3 Interaction with dirty human sessions

Per conflict policy: when a dirty Office session owns path `P`, agents must not
overwrite `P`; they write checkpoints. Host CAS remains the last line of defense
if a stale `expected_revision` is presented.

---

## 4. Size limits, extensions, MIME, sniffing

### 4.1 Size limits

| Limit | Value | Applies to |
| --- | --- | --- |
| `vault.read` default max | **1 MiB** (1_048_576) | Preview JSON API (unchanged) |
| `vault.read` hard max | **4 MiB** (4_194_304) | Preview JSON API (unchanged) |
| Chunk size (`vault.read_chunk` / write chunk) | Default **256 KiB**, max **1 MiB** decoded bytes per chunk | BFF↔host binary plane |
| Office single-file max (open or save) | Default **52_428_800** (50 MiB); deploy-configurable up to **104_857_600** (100 MiB) | BFF download stream + callback download + vault.write aggregate |
| Concurrent Office body buffer on BFF | Prefer stream-through; if spool required, same as Office max; encrypt-at-rest if disk spool | BFF |
| Oversized | `payload_too_large` — **no partial vault commit** | All planes |

Lab fixtures should stay well under 4 MiB so preview and Office lab paths remain easy to exercise.

### 4.2 Allowed extensions (Office editing plane)

| Extension | Default editor mode | Notes |
| --- | --- | --- |
| `.docx` | edit (when licensed) | |
| `.xlsx` | edit (when licensed) | |
| `.pptx` | edit (when licensed) | |
| `.pdf` | **view** only for MVP | No production PDF edit writeback unless a later bead expands |
| `.doc`, `.xls`, `.ppt` (legacy) | **reject** or view-only convert in lab | Prefer OOXML; production edit of legacy binary formats is out of scope |

Preview pane may continue to render other types via existing VaultReader rules;
this table gates **Office session create** and **signed download**.

### 4.3 MIME checks

| Source | Rule |
| --- | --- |
| Extension → declared MIME | `.docx` → `application/vnd.openxmlformats-officedocument.wordprocessingml.document`; `.xlsx` → spreadsheetml; `.pptx` → presentationml; `.pdf` → `application/pdf` |
| `vault.stat` / write `mime_type` | Host may guess; BFF treats mismatch between extension map and declared MIME as **soft warn** in lab, **reject** (`invalid_argument` / `invalid_type`) in production Office open when mismatch is gross (e.g. `.docx` claimed as `text/plain`) |
| Callback / write body | Must match session’s expected family; empty body → reject |

### 4.4 Content sniffing policy

1. **Do not** trust browser `Content-Type` alone.
2. BFF **SHOULD** sniff the first **8 KiB** of Office open (host chunk 0) and
   of callback download:
   - OOXML: ZIP local file header `PK\x03\x04` (or empty PK variants) plus
     presence of `[Content_Types].xml` in zip directory when fully buffered
     for save (optional deep check on save).
   - PDF: `%PDF-` magic.
3. Sniff failure on Office session create/download → `unsupported_type` /
   `invalid_argument`; do not stream to Document Server.
4. Sniff is **not** a malware scanner. Virus scanning, if required, is a
   separate deploy control outside this contract.
5. Never log sniffed payload bytes — only boolean pass/fail and detected class
   (`ooxml`, `pdf`, `unknown`).

---

## 5. Chunked host transfer sketch (contract)

Expansion methods (optional until implemented and advertised). Full JSON Schema
params/results may land with host implementation beads; **behavior here is
normative**.

### 5.1 `vault.read_chunk` (expansion)

**Params (intent)**

| Field | Required | Description |
| --- | --- | --- |
| `path` | yes | Vault path |
| `offset` | yes | Byte offset ≥ 0 |
| `max_bytes` | yes | 1 … chunk hard max (1 MiB) |
| `expected_revision` | no | If set, host fails with `conflict` when file revision moved |

**Result (intent)**

| Field | Description |
| --- | --- |
| `path` | Echo |
| `offset` | Echo |
| `encoding` | `base64` only for chunk body on JSON RPC |
| `content` | Base64 of **this chunk only** (≤ max_bytes decoded) |
| `size_bytes` | Decoded length of this chunk |
| `eof` | true when `offset + size_bytes` covers the file |
| `file_size_bytes` | Total file size |
| `revision` | Current `documentRevision` |
| `mime_type` | Optional |

**Errors:** `not_found`, `forbidden`, `invalid_argument` (directory, bad offset),
`payload_too_large` (file over Office max when BFF/host enforces), `conflict`
(revision), `unavailable`.

BFF must request chunks sequentially (or pipelined with strict offset accounting)
and **decode → write to HTTP stream → drop** each chunk. Do not concatenate all
base64 strings into one in-memory document unless under a test-only spool flag.

### 5.2 Write transfer (owned by `lp-5q6.18`, constraints here)

`vault.write` must support at least one of:

1. **Inline** body with encoding utf-8|base64 and **decoded size ≤ write inline
   cap** (recommend same as `vault.read` hard max **or lower** for safety).
2. **Chunked write session**: `vault.write_begin` / `vault.write_chunk` /
   `vault.write_commit` **or** a single method with `content_ref` to a
   host-accepted upload session — exact shape in `.18`.

Office callback production path **MUST NOT** rely on stuffing a 50 MiB base64
blob into one Brain RPC frame. Prefer chunked commit with
`expected_revision` on begin/commit.

---

## 6. BFF streaming and no-body logging

### 6.1 Streaming requirements

| Requirement | Detail |
| --- | --- |
| DS download response | `Content-Type: application/octet-stream` (or precise Office MIME); `Content-Length` when known from `vault.stat`; body is raw bytes |
| Backpressure | Propagate HTTP client abort to stop chunk reads |
| Timeout | Align with session token TTL and Brain RPC per-call timeouts; overall download budget deploy-configurable |
| Range requests | Not required for MVP; Document Server full GET is enough |
| Cache headers | `Cache-Control: no-store` on signed download |

### 6.2 What must never be logged

| Forbidden in logs, metrics labels, error messages, audit blobs, traces | Allowed |
| --- | --- |
| File body bytes (raw or base64) | path (when policy allows), size_bytes, mime class, revision token (optionally truncated), session_id, duration_ms, status codes |
| Full signed download token / JWT | token fingerprint (hash prefix), expiry |
| Callback body including DS file url query secrets beyond host allowlist host | callback status enum, error codes |

Redaction defaults: structured log fields allowlist; debug “dump request body”
flags must hard-exclude Office content routes.

### 6.3 Metrics (safe)

- `office_download_bytes_total` (counter)
- `office_download_duration_ms` (histogram)
- `office_download_errors_total{reason=…}` where reason ∈
  `expired_token|forbidden|not_found|revision_mismatch|payload_too_large|unsupported_type|upstream`
- **No** path high-cardinality labels in shared multi-tenant metrics without
  aggregation policy; prefer tenant_id only where cardinality is controlled.

---

## 7. Schema and example index

| Artifact | Role |
| --- | --- |
| `contracts/backend-runtime-v1/brain-rpc.schema.json` `#/$defs/documentRevision` | Normative revision object |
| `vaultEntry.revision` | Optional on list/stat |
| `x-lanyard-office-binary-transfer` | Catalog constants (caps, bans, methods) |
| `examples/brain-rpc.vault-stat.result.json` | Includes revision example |
| `examples/office-binary-transfer.policy.json` | Machine-readable policy fixture |
| `examples/office-binary-transfer.read-chunk.request.json` / `.result.json` | Chunked read shape examples |
| `examples/office-binary-transfer.bff-download.meta.json` | BFF download metadata (no body) |
| `scripts/validate-brain-rpc.py` | Validates revision def + office transfer examples |

Typed `vault.write` remains **`lp-5q6.18`** (blocked on this bead’s semantics).

---

## 8. Acceptance checklist (`lp-5q6.17`)

| Criterion | Where satisfied |
| --- | --- |
| Decide and document binary transfer for files larger than `vault.read` hard cap | §1 (BFF signed URL + chunked Brain RPC) |
| Forbid production Office editing through `/api/vault/content` JSON/base64 except small lab fixtures | §1.4 |
| Define revision identity | §2 + `documentRevision` schema |
| Define expected-revision write behavior | §3 |
| Define size limits, extensions, MIME, sniffing | §4 |
| Define BFF streaming without logging bodies | §6 |
| Contract tests or schema examples for chosen path | §7 + examples + validate-brain-rpc |

---

## 9. Downstream mapping

| Item | Bead |
| --- | --- |
| Concrete `vault.write` schema (modes, idempotency, content encoding) | `lp-5q6.18` |
| Host implement write + revision mint | `lp-5q6.20` |
| Session store | `lp-5q6.21` |
| Signed download endpoint | `lp-5q6.22` |
| Callback writeback | `lp-5q6.23` |
| Document key invalidation | `lp-5q6.24` |
| Threat notes (token TTL, no bodies in logs) | `lp-5q6.9` |

## 10. References

- Domain model `DocumentRevision` / session open-save flows: `portal-document-session-domain-model.md`
- Conflict policy CAS + document keys: `portal-document-shared-state-conflict-policy.md`
- Topology storage boundary: `portal-document-server-topology.md` / ADR 0006
- Brain RPC baseline: `contracts/backend-runtime-v1/brain-rpc.schema.json`
- Preview size wall: HOW grounding §2
