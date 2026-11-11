# Active human edit versus agent write policy

**Bead:** `lp-5q6.32`  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Status:** Accepted product + backend policy (helpers + contract shapes; live host enforcement trails on Hermes-Lanyard pin)  
**Related:** [portal-document-shared-state-conflict-policy.md](portal-document-shared-state-conflict-policy.md) §2.3 / §3, [portal-document-session-domain-model.md](portal-document-session-domain-model.md) §1.5 / §5.3, [portal-document-key-invalidation.md](portal-document-key-invalidation.md) §4.3, [portal-host-artifact-event-emission.md](portal-host-artifact-event-emission.md), typed `vault.write` (`lp-5q6.18`)

## 1. Problem

A human can hold an **active dirty Office edit session** on vault path `P` while an
agent tool simultaneously finishes a rewrite of the same logical document.

Without an explicit product/backend policy:

1. The agent may **silently overwrite** `P` and wipe unsaved human work (or force
   a CAS conflict only after the human already lost context).
2. Tool code may treat “write the path the user mentioned” as always-canonical.
3. Chat UX may claim the open editor was updated when only a headless write ran.

This bead freezes **agent tool behavior**, **host write modes**, **BFF ownership
checks**, and **UX copy** so concurrent human edit + agent authoring is safe by
default.

## 2. Product stance (binding)

| Rule | Detail |
| --- | --- |
| **P1 — No silent overwrite while dirty** | When BFF reports a **dirty** primary Office session on path `P`, agent tools **must not** commit `replace_if_match` / `create_new` / `replace_if_absent` against canonical `P`. |
| **P2 — Staged checkpoint is the default** | Default agent action under dirty ownership is `vault.write` mode **`write_checkpoint`**: bytes land on a deterministic sibling path; canonical `P` is unchanged. |
| **P3 — Refuse is always valid** | Tools may instead **refuse** the write with structured conflict reason `human_edit_active` (no body write). Prefer checkpoint when the skill can produce a useful alternate artifact. |
| **P4 — Clean / view is not dirty ownership** | Preview-only or non-dirty edit sessions do **not** block canonical CAS writes. Prefer soft pane reload / “document updated” UX (`lp-5q6.24`). Optional product flag may still prefer checkpoints for clean sessions; default is allow CAS. |
| **P5 — Host CAS remains defense in depth** | Even when ownership checks fail open (misconfig), Office callback writeback and agent replaces still use `expected_revision`. Last-writer-wins is never the default. |
| **P6 — Agents are not live co-authors** | Agent work never pretends to be a cursor inside Document Server. Progress and checkpoints surface in the chat document pane. |
| **P7 — Promote is explicit** | Replacing canonical `P` with a checkpoint requires an explicit user action (or a confirmed tool) **after** dirty sessions clear, using `replace_if_match` + CAS. |

## 3. Authority placement

```text
Agent tool / gateway
  │ 1. Ask BFF: path ownership for (tenant, P)?
  │ 2. resolveAgentWritePolicy(ownership, intent)
  │ 3a. write_checkpoint → vault.write mode write_checkpoint
  │ 3b. refuse → no vault write; emit artifact.error human_edit_active
  │ 3c. allow_canonical → vault.write replace_if_match | create_new | …
  ▼
Portal BFF session store  ← authoritative dirty ownership for Office edits
  │
  ▼
Host vault.write          ← CAS / create / checkpoint path ACL + bytes
```

| Check | Owner | Fail closed? |
| --- | --- | --- |
| Dirty Office ownership of `P` | BFF `OfficeDocumentSessionStore.findActiveOwnership` | Yes for agent overwrite of `P` |
| Write mode + path ACL + CAS | Host `vault.write` | Yes |
| Pane dirty flag | Web only (UX) | **Not** authority for overwrite |
| Document key auto-swap while dirty | BFF/web invalidation (`lp-5q6.24`) | Never auto-swap under dirty |

## 4. Ownership model

### 4.1 What counts as blocking dirty ownership

A path `P` has **blocking dirty ownership** when BFF has at least one session such that:

| Field | Required |
| --- | --- |
| `tenant_id` | Matches caller tenant |
| `path` | Normalized equal to `P` |
| `mode` | `edit` |
| `dirty` | `true` |
| `lifecycle` | One of `active`, `saving`, `conflict`, `superseded_base` (not `closed` / `expired` / clean `saved` with dirty cleared) |
| `expires_at` | Still in the future |

**Conservative default (from conflict policy §2.1):** open edit mode ⇒ `dirty=true`
until successful writeback or discard/close. Implementations must not require a
Document Server “changed” callback before treating edit sessions as dirty for
agent blocking.

### 4.2 Non-blocking

| Situation | Agent may write canonical `P`? |
| --- | --- |
| No Office session | Yes (with normal ACL + CAS) |
| View-only session | Yes |
| Edit session with `dirty=false` after clean save and still open | Yes (prefer CAS); UI reloads |
| Expired / closed session | Yes |
| Checkpoint path under `.lanyard/checkpoints/` open in preview | Yes for that checkpoint path; does **not** transfer dirty ownership of canonical |

## 5. Decision table (agent intends to write logical doc at `P`)

| Dirty ownership of `P`? | Default decision | `vault.write` shape | Artifact / UX |
| --- | --- | --- | --- |
| **Yes** | **write_checkpoint** | `mode: write_checkpoint`, `source_path: P`, `path: <checkpoint>` | `artifact.updated` with `write_kind: checkpoint`, `source_path: P`; pane offers “Open agent checkpoint” |
| **Yes** (tool cannot stage) | **refuse** | No write | `artifact.error` `error_code: human_edit_active` |
| **No** + file exists | **allow_canonical** | `replace_if_match` + `expected_revision` / `if_match` | `artifact.updated` `write_kind: replace` (or omit); clean pane reloads |
| **No** + file missing | **allow_canonical** | `create_new` or `replace_if_absent` | `artifact.updated` `write_kind: create` |

**Hard rules**

1. Never map a dirty-owned intended path to bare `replace_if_match` without an
   explicit, audited override (none in v1 product surface).
2. Checkpoint writes never use the canonical path as the write destination.
3. Refuse responses must not include file bodies in error text.

## 6. Checkpoint path convention

Deterministic sibling layout (tenant vault ACL still applies):

```text
# Canonical
/Projects/Acme/proposal.docx

# Agent checkpoint
/Projects/Acme/.lanyard/checkpoints/proposal.docx/<run_id>.docx
```

| Component | Rule |
| --- | --- |
| Parent of canonical file | Unchanged directory prefix |
| Marker segment | `.lanyard/checkpoints` |
| Leaf name folder | Basename of canonical file (including extension) |
| Run id | Tool run / agent turn / idempotency fragment; `[A-Za-z0-9._-]+` only |
| Extension | Same as canonical when present |

Optional human conflict save-as (Office callback conflict, not agent default):

```text
/Projects/Acme/proposal.conflict-<shortid>.docx
```

Pure helper: `buildAgentCheckpointPath` in `@lanyard/shared`  
(`portal/packages/shared/src/document-pane/agent-write-policy.ts`).

## 7. Contract shapes (`vault.write`)

### 7.1 Mode `write_checkpoint` (lp-5q6.32 expansion of lp-5q6.18)

| Param | Rule |
| --- | --- |
| `mode` | `write_checkpoint` |
| `source_path` | **Required.** Canonical path the agent intended (ownership subject). |
| `path` | **Required.** Destination checkpoint path (must not equal `source_path`). |
| Content plane | Same as other modes: inline `content`+`encoding` **or** `content_ref`. |
| `expected_revision` | Not required for checkpoint create (destination is new). Host may use `create_new` semantics on `path`. |
| ACL | Both `path` and `source_path` must pass path ACL (source proves caller could have targeted the logical doc). |

### 7.2 Structured refuse / conflict detail

When an agent (or miswired gateway) still targets dirty-owned canonical `P` with
`replace_if_match` / `create_new` / `replace_if_absent`:

| Field | Value |
| --- | --- |
| `error.code` | `conflict` |
| `error.retryable` | `false` |
| `error.details.reason` | `human_edit_active` |
| `error.details.path` | Canonical path |
| `error.details.session_id` | Optional opaque Office session id (never tokens) |
| `error.message` | Short product copy (see §8); no body |

Hosts that only see Brain RPC (no BFF ownership query) still benefit when the
**gateway** consults BFF first. BFF-enforced pre-check is the product path;
host CAS alone is insufficient for dirty buffers that have not advanced host
revision.

### 7.3 Success result hints (optional)

Checkpoint success may include:

| Field | Meaning |
| --- | --- |
| `path` | Checkpoint path written |
| `source_path` | Echo of canonical source |
| `write_kind` | `checkpoint` |

## 8. UX copy (normative strings)

Use these (or semantic equivalents) so chat, tools, and pane stay consistent.

| Situation | Audience | Copy |
| --- | --- | --- |
| Checkpoint written while human dirty | Pane conflict / offer | `Agent wrote a checkpoint while you have an active edit. Open the checkpoint without discarding your buffer.` |
| Soft checkpoint while preview / clean | Pane soft offer | `Agent saved a checkpoint. Open it without leaving your current document.` |
| Tool refuse `human_edit_active` | Chat / artifact.error | `Human edit session owns this path; wrote checkpoint instead` **or** when truly refused: `Human edit session owns this path; agent write blocked` |
| Tool success checkpoint | Tool result summary | `Saved agent checkpoint at {checkpoint_path} (canonical path has an active human edit).` |
| Canonical replace while dirty (should not happen) | Conflict banner | `Document changed outside the editor` / revision conflict actions from `lp-5q6.24` |
| Promote checkpoint (future UI) | Confirm dialog | `Replace the vault file with this checkpoint? Unsaved editor changes must be discarded or saved first.` |

Constants: `AGENT_WRITE_UX_COPY` in shared agent-write-policy module.

## 9. Implementation map

| Layer | Module / artifact | Role |
| --- | --- | --- |
| Contract | `contracts/backend-runtime-v1/brain-rpc.schema.json` | `write_checkpoint` mode, `source_path`, conflict `human_edit_active` |
| Examples | `brain-rpc.vault-write-checkpoint.request.json`, `brain-rpc.vault-write-human-edit-active.result.json` | Offline fixtures |
| Shared pure policy | `portal/packages/shared/src/document-pane/agent-write-policy.ts` | Checkpoint path + `resolveAgentWritePolicy` + UX copy |
| BFF ownership | `OfficeDocumentSessionStore.findActiveOwnership` | Authoritative dirty query |
| BFF decision glue | `portal/packages/bff/src/office/agent-write-policy.ts` | Ownership → policy decision |
| Host / gateway | Hermes-Lanyard (external) | Call BFF or mirror policy before `vault.write`; emit artifact events (`lp-5q6.31`) |
| Web pane | Existing reducer (`human_edit_active`, checkpoint offer) | Surface offers; not write authority |

## 10. Worked examples

### 10.1 Dirty human + agent rewrite → checkpoint

1. Human opens `/Projects/Acme/proposal.docx` edit → session dirty, base `R1`.
2. Agent intends rewrite of same path; gateway calls `findActiveOwnership` → dirty.
3. `resolveAgentWritePolicy` → `write_checkpoint` at  
   `/Projects/Acme/.lanyard/checkpoints/proposal.docx/<run>.docx`.
4. `vault.write` succeeds; host emits `artifact.updated` with `write_kind: checkpoint`.
5. Pane shows conflict/offer with alternate checkpoint; human buffer untouched.
6. Human save still uses `expected_revision=R1` on canonical path.

### 10.2 Dirty human + tool cannot stage → refuse

1. Same dirty ownership.
2. Tool configured `onDirty: "refuse"`.
3. No `vault.write`; emit `artifact.error` `human_edit_active`.
4. Canonical bytes and editor buffer unchanged.

### 10.3 Preview only + agent replace

1. Pane preview (no dirty edit session).
2. Policy → `allow_canonical` with `replace_if_match`.
3. Host advances revision; pane reloads when clean (`lp-5q6.24`).

## 11. Out of scope

- Live agent co-edit inside ONLYOFFICE (epic non-goal).
- Automatic three-way merge of Office binaries.
- Production Document Server license / topology gates (`lp-5q6.7`, `lp-5q6.8`).
- E2E staging proof of dirty human + agent checkpoint (`lp-5q6.38`).
- Shipping Hermes-Lanyard host source into this monorepo.

## 12. Acceptance checklist (`lp-5q6.32`)

- [x] Durable policy: dirty human edit blocks agent overwrite of canonical path (checkpoint default or refuse).
- [x] Checkpoint path convention documented and pure helper tested.
- [x] `vault.write` gains `write_checkpoint` + `source_path`; conflict detail `human_edit_active` documented with examples.
- [x] Pure `resolveAgentWritePolicy` decision table covered by unit tests.
- [x] BFF session store can answer active dirty ownership for a tenant path.
- [x] Normative UX copy frozen for pane / tool / error surfaces.
- [x] Cross-links from conflict policy, key invalidation, host emission, and plan index.

## 13. References

- Conflict checkpoint: `lp-5q6.3` → [portal-document-shared-state-conflict-policy.md](portal-document-shared-state-conflict-policy.md)
- Domain model: `lp-5q6.6` → [portal-document-session-domain-model.md](portal-document-session-domain-model.md)
- Typed write base: `lp-5q6.18` → `contracts/backend-runtime-v1/brain-rpc.schema.json`
- Artifact events: `lp-5q6.10` / `lp-5q6.31`
- Key invalidation while dirty: `lp-5q6.24`
