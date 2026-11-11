# Portal document shared state and conflict policy

**Bead:** `lp-5q6.3` (pstack checkpoint: shared mutable state and conflict policy)  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Status:** Design checkpoint (pre-implementation)  
**Principle:** separate-before-serializing-shared-state  
**Related beads:** `lp-5q6.6` (domain model), `lp-5q6.17` (binary + revision contract), `lp-5q6.21` (Office session store), `lp-5q6.24` (document key invalidation), `lp-5q6.32` (active human vs agent write policy)

## Purpose

Document the conflict policy **before** implementation so concurrent writers
(human editor, Document Server callback, headless agent, vault host) cannot
accidentally race on the same mutable object.

Goals:

1. Make accidental same-file concurrent writes **hard to express** in APIs and
   types, not merely discouraged in comments.
2. Give the **BFF** exclusive ownership of active Office sessions and conflict
   checks that Document Server cannot bypass.
3. Make the **host** enforce expected revision (or idempotency key) on vault
   writes so last-writer-wins is never the default.

This document is the throughput checkpoint item for shared mutable state under
the Feature playbook. Implementation beads (`lp-5q6.21`, `.24`, `.32`,
`vault.write` schema) must conform to it or propose an explicit revision.

## Default stance: separate before serializing

When two actors might write the same vault path:

1. **Prefer separate write targets.** Agent work lands on a checkpoint path,
   staged copy, or new revision artifact. The human keeps the canonical path
   while an active dirty Office session exists.
2. **Serialize only when one canonical object is a real product invariant**
   (for example the human explicitly saves the Office editor back to the same
   path, or the user confirms “replace with agent version”).
3. **Do not rely on soft conventions** (“agents should not overwrite open
   files”). Encode ownership in session records, write params, and fail-closed
   host checks.

Agents never pretend to be live co-authors inside ONLYOFFICE. Headless
authoring skills write files; the pane reloads or shows a checkpoint.

## 1. Shared mutable state inventory

| ID | State object | Writers | Readers | Location of truth |
| --- | --- | --- | --- | --- |
| S1 | **Vault file bytes** at a path | Host `vault.write` (human callback writeback, agent tools, future Portal write UI) | `vault.read` / binary download, Document Server via BFF URL, previews | Company Brain host under `VAULT_ROOT` |
| S2 | **Vault content revision** (etag / content hash / host revision token) | Host on successful write | BFF session mint, document key, write CAS | Host metadata; exposed on `vault.stat` / write results (contract bead `lp-5q6.17`) |
| S3 | **Office document session** (opaque id → tenant, user, path, revision, mode, keys, nonces) | BFF create / refresh / expire / mark-saved | BFF download + callback; web only sees opaque session id + editor config | BFF session store (`lp-5q6.21`) |
| S4 | **ONLYOFFICE document key** | BFF when minting editor config | Document Server cache; browser editor | Derived, not stored as an independent product record; always recomputed from (tenant, path identity, content revision) |
| S5 | **Document Server in-memory/disk cache** for a key | Document Server | Editor UI | Document Server (outside Lanyard DB); treated as **untrusted cache** of S1@S2 |
| S6 | **Callback / save status** for a session (pending, saved, failed, superseded) | BFF on Document Server callback | Web status UI, observability | BFF session record |
| S7 | **Chat document pane UI state** (open path, mode preview/edit, dirty flag, conflict banner, last known revision) | Portal web reducer | Portal web | Browser per tab; **not** authority for ACL or overwrite |
| S8 | **Agent write target intent** (path the skill intends to create/replace) | Agent runtime / tool call | BFF or host conflict check before write | Ephemeral tool args; must pass host policy |

### Not shared mutable product state

| Object | Why it is not concurrent shared mutation |
| --- | --- |
| Preview render blobs in the browser | Local derivation of vault bytes; discarded on navigate |
| JWT editor config | Short-lived capability token; mint is idempotent for same session |
| Relay chat frames / tool progress events | Append-only signals; they open or refresh the pane but do not write vault bytes |
| Capability descriptors | Read-mostly discovery |

## 2. Ownership rules

### 2.1 Human Office edit sessions → BFF

| Rule | Detail |
| --- | --- |
| Owner | Portal **BFF** owns `OfficeDocumentSession` lifecycle. |
| Client role | Web may request create/close and receive opaque `session_id` + editor config. Web does **not** supply vault path or ACL on the Document Server callback. |
| Document Server role | Fetches bytes only via BFF signed download URL; saves only via BFF callback. Never reaches Brain RPC. |
| Active session | For `(tenant_id, path)` at most one **primary edit** session per user is encouraged; multi-tab is allowed only if each session tracks the same `base_revision` and writeback uses CAS. |
| Dirty definition | Session is **dirty** after the editor reports change (or conservatively after open in edit mode until clean close) until a successful callback writeback advances revision, or the user discards. Conservative default: treat open edit mode as dirty for agent-write blocking. |
| Expiry | Expired sessions cannot download or writeback. Callback with expired/unknown session fails closed. |

### 2.2 Document Server cache keys → derived identity

| Rule | Detail |
| --- | --- |
| Owner | BFF mints `document.key`; Document Server only caches by that key. |
| Composition | Key material **must** include **tenant**, **stable path identity**, and **content revision** (see §4). |
| Collision | Two tenants or two revisions of the same path must never share a key. Raw path alone is forbidden. |
| Invalidation | Any successful write that changes content revision ⇒ new key for the next open. External agent write to the same path invalidates prior keys. |
| Stale sessions | An open editor whose `base_revision` no longer matches host `vault.stat` is **stale**; auto-refresh is blocked while dirty (§3). |

### 2.3 Agent writes → staged path by default under human ownership

| Rule | Detail |
| --- | --- |
| Owner of policy check | Host enforces revision/idempotency; BFF (or agent gateway) consults active dirty sessions before targeting a human-open path. |
| Default target | When a dirty human Office session owns path `P`, agent tools write to a **staged sibling** (see §3.2), not `P`. |
| Canonical replace | Overwriting `P` requires either: no dirty session, or explicit user-accepted merge/replace after clean close. |
| Agent UX | Tool results and chat progress report the staged path and offer “open checkpoint” in the pane. Never claim silent replace of the open editor buffer. |

### 2.4 Vault revisions → host CAS

| Rule | Detail |
| --- | --- |
| Owner | Company Brain **host** is the sole mutator of vault bytes and revision tokens. |
| Write API | Typed `vault.write` (bead `lp-5q6.18`) requires either `expected_revision` (compare-and-swap) or an `idempotency_key` with stable semantics for create-only / exact-body retry. |
| Failure | Mismatched `expected_revision` → structured conflict error (`conflict` / `revision_mismatch`); no partial write. |
| Callback path | Office callback writeback supplies the session’s `base_revision` as `expected_revision`. If the host advanced (agent or other writer), callback fails closed and BFF surfaces conflict to the human. |
| Preview-only | `vault.read` and client previews never mint revisions; they consume them. |

### 2.5 Pane state → local UI only

| Rule | Detail |
| --- | --- |
| Owner | Portal web reducer (`ArtifactPanelState` / pane state; bead `lp-5q6.6`). |
| Authority | Pane dirty flag may improve UX but **must not** be the only gate for agent overwrite. Server-side session + host CAS are authoritative. |
| Events | Artifact events open/update/close the pane; they do not write vault bytes. |

## 3. Conflict policy matrix

### 3.1 Actors × write targets

| Scenario | Default behavior | Encoded how |
| --- | --- | --- |
| Human saves Office editor to path `P` (clean base) | Writeback to `P` with `expected_revision = session.base_revision` | BFF callback + host CAS |
| Human saves but `P` changed under them | **Block** writeback; show conflict; offer reload or save-as staged | CAS failure → conflict UI |
| Agent wants `P` while **no** Office session | Write `P` with `expected_revision` if replacing, or create-new | Host write schema |
| Agent wants `P` while session open, **clean** (view-only or undirtied edit) | Prefer staged copy; optional replace only if product flag allows and CAS still holds | BFF dirty/ownership query |
| Agent wants `P` while session **dirty** | **Must not** overwrite `P`. Write staged checkpoint path; emit artifact event for pane | Fail closed on direct write to `P` when BFF reports dirty ownership |
| Two agents write same path | Host CAS / idempotency; loser gets conflict; no silent merge | Host |
| Two humans co-edit same path via ONLYOFFICE | Allowed only inside **one** Document Server session (native co-edit). Second independent Portal session on same path+revision shares key by design; second session on **stale** revision is blocked or forced reload | document key + session store |
| Preview tab open, agent writes `P` | Pane shows “updated, reload”; no conflict banner required | artifact event + new revision |

### 3.2 Staged-copy path convention

When separation is required, agents write checkpoints under a deterministic
sibling layout (exact root is product-configurable; recommended default):

```text
# Canonical path
/Projects/Acme/proposal.docx

# Agent checkpoint (timestamp or run id; never overwrites canonical while dirty)
/Projects/Acme/.lanyard/checkpoints/proposal.docx/<run_id>.docx

# Optional human save-as on conflict
/Projects/Acme/proposal.conflict-<shortid>.docx
```

Rules:

- Checkpoint paths remain inside the tenant vault and subject to path ACL.
- Checkpoint files are first-class vault files with their own revisions.
- Pane may open a checkpoint as a **preview** without transferring dirty
  ownership of the canonical path.
- Promoting a checkpoint to canonical is an explicit user (or confirmed tool)
  action that uses CAS on the canonical path after dirty sessions clear.

### 3.3 Making concurrent overwrite hard to express

Structural constraints for later contract/impl beads:

1. **`vault.write` params** include a required write mode enum, e.g.
   `create_new | replace_if_match | write_checkpoint`, not a bare path+bytes.
2. **`replace_if_match`** requires `expected_revision` (non-optional in the type).
3. **`write_checkpoint`** requires a canonical `source_path` and produces a new
   path; it never takes the canonical path as the write destination.
4. BFF Office callback only allows writeback for the session’s registered path
   and base revision — path is server-side, not client-supplied on callback.
5. Agent tools that target a dirty path auto-select `write_checkpoint` or fail
   with a structured `human_edit_active` error (no body write).

These shapes land in `lp-5q6.18` / `lp-5q6.32`; this checkpoint locks the
policy they must implement.

## 4. Document key policy (tenant + path + revision)

ONLYOFFICE caches by `document.key`. A wrong key shows the wrong bytes.

### 4.1 Required key material

Every mint of `document.key` includes:

| Component | Source | Notes |
| --- | --- | --- |
| `tenant_id` | Authenticated session / deployment tenant | Prevents cross-tenant cache collision on shared Document Server lab hosts |
| `path_id` | Canonical vault path (normalized) or stable content id | Path normalized: vault-root-relative, no `..`, consistent encoding |
| `content_revision` | Host revision token for current bytes | From `vault.stat` / open-time snapshot; changes on every successful content write |

Optional hardening (recommended):

| Component | Purpose |
| --- | --- |
| `mode` (`view` \| `edit`) | Avoid accidental permission bleed if the same key were reused across modes |
| `key_version` | Schema version prefix for future format changes |

### 4.2 Encoding constraints

- ONLYOFFICE restricts key character set and length. Use a **hex or base64url
  digest** of the material above (e.g. SHA-256 truncated to ≤128 chars of
  allowed charset), not the raw path string.
- Digest input is a canonical serialization, for example:

  ```text
  v1|{tenant_id}|{normalized_path}|{content_revision}
  ```

- Same inputs ⇒ same key (stable for reconnect to the same revision).
- Any change to tenant, path, or revision ⇒ different key.

### 4.3 Cache collision impossibility (acceptance)

| Case | Required outcome |
| --- | --- |
| Same path, different tenants | Different keys |
| Same tenant+path, different content revision | Different keys |
| Same tenant+path+revision | Same key (reconnect / multi-user co-edit) |
| Long paths | Digested; never truncated path prefixes that could collide |
| Agent write advances revision | Next open mints new key; open dirty session does **not** auto-swap key under the human |

### 4.4 Interaction with dirty edits

When an external revision advance is detected for an open dirty session:

1. BFF marks session `superseded_base` (or equivalent).
2. Web shows conflict / “document changed outside editor” banner.
3. Auto-reload is **off** while dirty (avoids wiping unsaved human work).
4. Human may: discard local changes and reload at new revision; or save-as to a
   conflict path; callback replace of canonical remains CAS-protected and will
   fail until they choose.

## 5. Authority and check placement

```text
                    ┌──────────────────────┐
                    │  Portal web (pane)   │  local UI only
                    └──────────┬───────────┘
                               │ session create / editor config
                               ▼
                    ┌──────────────────────┐
                    │  Portal BFF          │  owns OfficeDocumentSession
                    │  conflict checks     │  mints document.key
                    │  signed download     │  callback writeback
                    └──────────┬───────────┘
                               │ Brain RPC (never Document Server)
                               ▼
                    ┌──────────────────────┐
                    │  Host vault          │  owns bytes + revision
                    │  expected_revision   │  fail-closed CAS
                    └──────────────────────┘

  Document Server ◄──► BFF only (download URL + callback)
  Agent tools     ───► Host vault.write (mode + revision policy)
                  ───► BFF query: is path dirty-owned?
```

| Check | Where | Fail closed? |
| --- | --- | --- |
| Path ACL | Host (+ BFF mirror for UX) | Yes |
| Active dirty Office ownership | BFF session store | Yes for agent overwrite of `P` |
| `expected_revision` match | Host | Yes |
| Callback session validity / nonce | BFF | Yes |
| Document key components present | BFF mint | Yes (refuse mint without revision) |

## 6. Worked examples

### 6.1 Agent authors while human edits

1. Human opens `/Projects/Acme/proposal.docx` in edit mode → BFF session
   `S`, `base_revision=R1`, `document.key=K(tenant,path,R1)`, dirty.
2. Agent skill finishes a rewrite of the same logical doc.
3. Gateway/BFF sees dirty ownership of path → tool uses `write_checkpoint` →
   `/Projects/Acme/.lanyard/checkpoints/proposal.docx/<run>.docx` at `Rnew`.
4. Chat emits artifact event; pane offers “open agent checkpoint” without
   replacing the human buffer.
5. Human finishes → callback writeback `expected_revision=R1` → host stores
   `R2` on canonical path (if still `R1`) or conflict if something else won.

### 6.2 Agent writes, human has preview only

1. Pane open in preview (no edit session, or view-only session).
2. Agent `replace_if_match` with `expected_revision` succeeds → revision `R2`.
3. Pane receives update event → reload preview with new key material.
4. No staged copy required (no dirty human ownership).

### 6.3 Stale callback after agent replace (should be rare)

1. Human dirty session on `R1`.
2. Operator or misconfigured path bypass writes `R2` on host (should not
   happen for agents if policy is enforced; defense in depth remains).
3. Human save → callback supplies `expected_revision=R1` → host
   `revision_mismatch` → BFF keeps human bytes out of canonical path; UI
   conflict.

## 7. Out of scope (this checkpoint)

- Choosing license or Document Server topology (`lp-5q6.7`, `lp-5q6.8`).
- Binary transfer mechanism for large Office files (`lp-5q6.17`) — see [`portal-binary-vault-transfer-and-revision.md`](./portal-binary-vault-transfer-and-revision.md).
- Typed JSON Schema for `vault.write` (`lp-5q6.18`) — must implement §3.3.
- Runtime session store implementation (`lp-5q6.21`).
- ONLYOFFICE JWT and callback auth details — design-time notes in
  [`portal-office-document-bridge-threat-notes.md`](portal-office-document-bridge-threat-notes.md)
  (`lp-5q6.9`); implementation review in `lp-5q6.35`.

## 8. Acceptance checklist (lp-5q6.3)

| Criterion | Where satisfied |
| --- | --- |
| Shared mutable state is enumerated | §1 table S1–S8 |
| Human edit sessions, Document Server cache keys, agent writes, and vault revisions have an ownership rule | §2.1–§2.4 |
| Dirty human edits block agent overwrite or force a staged-copy path | §3.1–§3.2, §6.1 |
| Document keys include tenant, path, and content revision so cache collisions are impossible | §4 |

## 9. Downstream implementation mapping

| Policy item | Implementing bead(s) |
| --- | --- |
| Domain types (`OfficeDocumentSession`, `DocumentRevision`, `ConflictState`) | `lp-5q6.6` |
| Revision identity + binary transfer | `lp-5q6.17` |
| Typed `vault.write` with modes + `expected_revision` | `lp-5q6.18` |
| Session store | `lp-5q6.21` |
| Key mint + invalidation tests | `lp-5q6.24` → [portal-document-key-invalidation.md](portal-document-key-invalidation.md) |
| Agent tool behavior + UX copy | `lp-5q6.32` → [portal-active-human-edit-agent-write-policy.md](portal-active-human-edit-agent-write-policy.md) |
| E2E human dirty + agent checkpoint | `lp-5q6.38` |

## 10. References

- Feature epic notes: bead `lp-5q6`
- Principle: separate-before-serializing-shared-state
- ONLYOFFICE Docs API: document `key` is the cache identity for a document
  version; integrators must change the key when content changes
- Platform capabilities: [`portal-capabilities-bff.md`](./portal-capabilities-bff.md)
- Brain RPC vault baseline: `contracts/backend-runtime-v1/brain-rpc.schema.json`
  (`vault.stat` mtime/size today; revision token is an expansion for Office)
- Plan overview (branch `docs/onlyoffice-portal-office-integration`):
  `docs/plans/0004-portal-onlyoffice-integration/overview.md` when merged
