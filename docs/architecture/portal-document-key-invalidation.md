# Portal document key and revision invalidation policy

**Bead:** `lp-5q6.24`  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Status:** Accepted design + implementation helpers (lab/staging; production still gated by license + security review)  
**Related:** [portal-document-shared-state-conflict-policy.md](portal-document-shared-state-conflict-policy.md) §4, [portal-document-session-domain-model.md](portal-document-session-domain-model.md) §5.1–§5.2, [portal-office-document-bridge-threat-notes.md](portal-office-document-bridge-threat-notes.md) CF-4

## 1. Problem

ONLYOFFICE Document Server caches editor content by `document.key`. A wrong or
reused key can show another tenant’s bytes, a previous revision after an agent
rewrite, or stale content after a successful save. Cache key collisions are a
**security and correctness** hazard (threat CF-4).

This bead freezes:

1. How Portal **mints** `document.key` (BFF-owned).
2. How BFF and web **invalidate / react** when host content revision advances
   while a pane or Office session is open.

## 2. Ownership

| Concern | Owner | Must not |
| --- | --- | --- |
| Mint `document.key` | Portal BFF (`mintDocumentKey`) | Browser, Document Server, agent tools |
| Store key on session | BFF `OfficeDocumentSession.document_key` | Client-supplied key accepted as authority |
| Host content revision | Host vault (`DocumentRevision.token`) | UI clocks / mtime alone as sole CAS |
| Dirty human buffer | Web `localDirty` (UX) + BFF session `dirty` (authority) | Auto-swap key while dirty |
| Conflict / reload banner | Web pane (`ArtifactPanelState` + shell) | Silent overwrite of unsaved human work |

## 3. Document key composition

### 3.1 Required material

Every mint includes:

| Component | Source | Why |
| --- | --- | --- |
| `key_version` | Constant `v1` | Future format changes without ambiguous digests |
| `tenant_id` | Authenticated BFF session / deployment tenant | Cross-tenant isolation on shared Document Server |
| `path_id` | Canonical vault path via `normalizeVaultPath` | Stable path identity; no `..`; consistent encoding |
| `content_revision` | `DocumentRevision.token` from vault.stat / open snapshot | New bytes ⇒ new key |
| `mode` | `view` \| `edit` | Avoid permission bleed if the same material were reused across modes |

### 3.2 Canonical serialization

```text
v1|{tenant_id}|{normalized_path}|{revision.token}|{mode}
```

Rules:

- UTF-8 string join with `|` (pipe). Components must not be empty after trim.
- Path is **normalized** before join (`normalizeVaultPath` / equivalent).
- **Never** use the raw path string as `document.key`.
- Missing tenant, path, or revision token → **fail closed** (throw / refuse mint).

### 3.3 Encoding (ONLYOFFICE constraints)

ONLYOFFICE restricts key charset and length (practical limit **≤ 128** chars;
alphanumeric plus limited punctuation). Portal uses:

| Property | Value |
| --- | --- |
| Algorithm | SHA-256 over the canonical UTF-8 material |
| Encoding | lowercase **hex** (64 characters) |
| Charset | `[0-9a-f]` only |
| Length | exactly 64 (≤ 128) |

Same material ⇒ same key (reconnect / multi-user co-edit on same revision).  
Any change to tenant, path, revision token, or mode ⇒ different key.

### 3.4 Collision matrix (acceptance)

| Case | Outcome |
| --- | --- |
| Same path, different tenants | Different keys |
| Same tenant+path, different content revision | Different keys |
| Same tenant+path+revision+mode | Same key |
| Long paths | Digested; never truncated path prefixes |
| `view` vs `edit` same bytes | Different keys (mode in material) |
| Agent write advances revision | Next open mints new key |

## 4. Revision invalidation policy

### 4.1 Definitions

| Term | Meaning |
| --- | --- |
| **Base revision** | Revision frozen at Office open / last successful save (`session.revision` / pane `knownRevision`) |
| **Current revision** | Latest host revision for the path (`vault.stat` / artifact `updated` event) |
| **Dirty** | Human has unsaved editor work (`localDirty` or session `dirty` / lifecycle editing) |
| **Document key for open session** | Fixed at mint; does **not** change for the life of that Office session |

### 4.2 Decision table

When BFF or web learns that **current revision ≠ base revision** for the open path:

| Dirty? | Decision | Auto-refresh / auto-swap key? | UI |
| --- | --- | --- | --- |
| No (preview or clean view) | **reload** | Yes — accept new revision; next edit open mints new key | Optional soft “document updated” / silent preview reload |
| Yes (edit dirty or editing session) | **conflict** | **No** | Conflict / “document changed outside editor” banner |
| Revisions equal | **none** | No-op | — |

**Hard rules**

1. Open dirty sessions do **not** auto-swap `document.key` under the human.
2. BFF marks session lifecycle `superseded_base` (or equivalent) when external
   advance is detected for a dirty/edit session; callback writeback remains
   CAS-protected with `expected_revision = base`.
3. After human **reload / discard_local**, web clears dirty, drops opaque
   session id, and re-opens; BFF mints a **new** session + key at the new
   revision.
4. Successful save advances base revision; subsequent mint uses the new token.

### 4.3 Agent write while human edits

Aligned with conflict policy §3–§4 and product policy [`portal-active-human-edit-agent-write-policy.md`](portal-active-human-edit-agent-write-policy.md) (`lp-5q6.32`):

- Prefer agent **checkpoint** / staged path when canonical path has dirty Office ownership.
- If host bytes still advance on the open path, dirty UI takes the **conflict**
  branch (banner + offered actions: reload, save_as_conflict_copy, discard_local).
- Never treat a new Document Server key alone as authority to overwrite the
  human buffer.

### 4.4 Pure helpers (implementation map)

| Package | Module | Role |
| --- | --- | --- |
| BFF | `portal/packages/bff/src/office/document-key.ts` | `mintDocumentKey`, charset validation, BFF invalidation decision |
| Web | `portal/packages/web/src/features/chat/documentPane/documentKeyInvalidation.ts` | Pure reload vs conflict decision + banner copy |
| Web | `artifactPanelReducer` (`updated` while dirty) | Applies conflict without auto key swap |
| Web | `DocumentPaneShell` | Renders conflict / reload banner |

## 5. Security notes

- Document key is **not** an ACL token. Download and callback still require
  session id + capability secrets (lp-5q6.22 / `.23`).
- Tenant in key material is defense-in-depth against Document Server cache
  confusion on shared lab/staging DS; primary isolation remains JWT + session
  store + network policy.
- Do not log full vault bodies or raw download tokens alongside keys.

## 6. Acceptance checklist (`lp-5q6.24`)

- [x] Document key includes tenant, stable path identity, and content revision (or hash token).
- [x] Key conforms to ONLYOFFICE allowed character and length constraints (hex, 64 chars).
- [x] External agent write to same path produces a new key on next open / reload state when clean.
- [x] Human dirty edit blocks auto-refresh and shows a conflict or reload banner.
- [x] Tests cover same content stable key, changed content new key, cross-tenant uniqueness, and long path hashing.

## 7. Out of scope

- Minting editor JWT / full editor config (`lp-5q6.26`).
- Active human vs agent write product policy details — landed in [`portal-active-human-edit-agent-write-policy.md`](portal-active-human-edit-agent-write-policy.md) (`lp-5q6.32`).
- Forgotten-file purge on Document Server (`lp-5q6.36`).
- Live agent co-edit inside Document Server (epic non-goal).
