# Signed operation ledger domain

**Beads:** `lp-ye4.5` (phase 1 domain), `lp-ye4.6` (phase 2 fake harness), `lp-ye4.7` (phase 3 history/head RPC), `lp-ye4.8` (phase 4 vault.write ledger), `lp-ye4.9` (phase 5 access grants), `lp-ye4.11` (phase 6 Portal currentness UX), `lp-ye4.12` (phase 7 durable host ledger)  
**Epic:** `lp-ye4` — multiplayer versioning and access ledger  
**Status:** Schema + shared types + fixtures + in-memory fake ledger/heads + gated Brain RPC history/head reads + vault.write → ledger commit metadata + access grants / unknown-agent identity + Portal currentness / history UX + **durable host ledger + ed25519 signing (lp-ye4.12)**  
**Contract:** [`contracts/backend-runtime-v1/signed-operation.schema.json`](../../contracts/backend-runtime-v1/signed-operation.schema.json), [`access-grant.schema.json`](../../contracts/backend-runtime-v1/access-grant.schema.json), `result_vault_write.commit` in brain-rpc  
**Shared types:** `@lanyard/backend-runtime` (`signed-operation.ts`, `access-grant.ts`, `access-grant-bff.ts`, `fake-runtime-ledger.ts`, `durable-runtime-ledger.ts`, `ledger-signing.ts`, `history-bff.ts`, `fake-backend.writeVault`)

## Purpose

Define the **authoritative domain** for multiplayer versioning when humans and
unknown agents operate on the same vault files:

1. **Signed operation events** — append-only history of observed commits and
   rejected attempts.
2. **Artifact heads** — currentness for a single vault path.
3. **Workspace heads** — currentness for the workspace tree fingerprint.
4. **Actor identity** — safe provenance fields (no secrets, no browser ACL).

This phase freezes shapes so phase 2 (fake harness), phase 3 (history/head RPC),
and later host durability can share one contract.

## Non-goals

- Replacing `vault.write` CAS or `write_checkpoint` policy.
- Production cryptographic grant verification wiring beyond key_id trust (phase 5 defines trust config + key_id binding; hosts supply real verifiers for grant signatures).
- Shipping ledger durability inside external agent product tarballs (Hermes / Lanyard Agent) — this monorepo ships the **reference host durable store + signing** that those products must conform to when they advertise history/heads.

## Core separation: operation id ≠ DocumentRevision

| Concept | Identity | Used for |
| --- | --- | --- |
| **DocumentRevision** | `revision.token` + `kind` | Vault byte CAS (`expected_revision` / `if_match`), Office `document.key`, `vault.stat` |
| **operation_id** | `op_…` ledger id | History, current-head pointers, audit, multiplayer ordering |
| **body_hash** | SHA-256 of body bytes | Content fingerprint independent of revision token formatting |

Hosts **must not** use `operation_id` as a `vault.write` CAS token. Existing
`DocumentRevision` wire shapes remain unchanged and are **reused** on ledger
results and artifact heads.

## Record types

### `signed_operation`

Append-only event after ACL/CAS verification (or after a structured reject).

Required fields:

- `schema_version` (const `1`), `record_type` (`signed_operation`)
- `operation_id`, `tenant_id`, `instance_id`, `occurred_at`
- `kind`, `actor`, `target`, `parents`, `result`, `signature`

Optional: `body_hash`, `idempotency_key`, `vault_write_mode`,
`advances_artifact_head`, `advances_workspace_head`, `meta`.

**Kinds**

| Kind | Typical source | Heads |
| --- | --- | --- |
| `file_create` | `vault.write` `create_new` / successful create via `replace_if_absent` | Advance artifact + workspace |
| `file_replace` | `vault.write` `replace_if_match` success | Advance artifact + workspace |
| `file_checkpoint` | `vault.write` `write_checkpoint` success | Advance checkpoint path head + workspace; **not** canonical source path |
| `file_delete` / `file_rename` | Future host ops | Advance workspace; remove/move artifact head |
| `workspace_tree_advance` | Explicit tree-only label (rare) | Workspace only |
| `operation_rejected` | CAS / policy failure | **No** head advance |

### `artifact_head`

Materialized current head for one path:

- `path`, `operation_id`, `revision` (DocumentRevision), `updated_at`
- `head_kind`: `canonical` | `checkpoint`
- `source_path` when checkpoint

### `workspace_head`

Materialized workspace currentness:

- `workspace_id` (`default` for single-workspace tenants)
- `tree_root_hash` (sha256 hex of canonical path→revision fingerprint)
- `operation_id` of last advancing commit

## Actor model

```text
kind: human | agent | system | delegated_agent
subject_id: required stable id
optional: portal_user_id, agent_id, run_id, session_id, backend_profile, grant_id, display_name
```

| Kind | Typical source |
| --- | --- |
| `human` | Portal user / Office callback (session stamp) |
| `agent` | Known backend agent tool subject |
| `system` | Host-internal maintenance |
| `delegated_agent` | Unknown or short-lived agent run under a signed grant |

Phase 5 binds **access grants** (`grant_id`, tenant, session, path prefixes, capabilities, expiry, signing `key_id`) and stamps safe actor provenance into `BackendRuntimeContext` + ledger events. Never secrets, raw tokens, or browser-supplied ACL.

## Compatibility with vault.write CAS

| vault.write mode | Ledger kind (committed) | Notes |
| --- | --- | --- |
| `create_new` | `file_create` | Conflict → `operation_rejected` / `path_exists` |
| `replace_if_match` | `file_replace` | Mismatch → `operation_rejected` / `revision_mismatch` |
| `replace_if_absent` | `file_create` or `file_replace` by outcome | |
| `write_checkpoint` | `file_checkpoint` | `target.source_path` = canonical; `target.path` = checkpoint destination |

Idempotency: same `idempotency_key` + body fingerprint → same `operation_id`,
same `result.revision`, same heads (`result.idempotent_replay` may be true on
replay metadata; event identity does not fork).

Dirty human Office ownership continues to force `write_checkpoint` or refuse
(`human_edit_active`) per `lp-5q6.32` / `lp-ye4.10` — ledger records the
checkpoint commit or reject; it does not invent a new overwrite mode.

## Signature

```text
signature: { alg, key_id, value, signed_at, signed_fields? }
alg: ed25519 | hmac-sha256 | none
```

- Production durable hosts sign **after** ACL/CAS with **ed25519** (phase 7 / `lp-ye4.12`).
- Fixtures use shape-valid placeholder `value`s.
- `alg: none` is offline/fake only — never for durable production ledger entries that advertise signed history.

### Phase 7 canonicalization (normative)

Host signature payload is the **unsigned event envelope** — all event fields
except `signature` and `meta`, using the default field set in
`DEFAULT_LEDGER_SIGNED_FIELDS` (`@lanyard/backend-runtime` / `ledger-signing.ts`).

**Canonical JSON rules:**

1. Objects: keys sorted lexicographically (UTF-16 code unit order); recurse into values.
2. Arrays: element order preserved; each element canonicalized.
3. No insignificant whitespace.
4. Finite numbers / booleans / null / strings as JSON; UTF-8 encode the result.
5. Omitted optional fields are absent from the envelope (not `null`).

`signature.signed_fields` records the field list when the host uses the default
set (or an explicit subset). Verifiers recompute the canonical payload from the
event + `signed_fields` (or the default set when omitted) and check ed25519.

**Key rotation:**

| Rule | Behavior |
| --- | --- |
| `signature.key_id` | Identifies the signing key for verify |
| Active key | Used for **new** signatures only |
| Retired keys | Remain in the host key ring for **verify** until operators drop them |
| Validity window | Optional `notBefore` / `notAfter` on ring entries; fail closed outside window |
| Client signatures | **Never** authoritative — durable hosts re-sign observed commits |

Implementation: `createEd25519HostLedgerSigner`, `rotateHostLedgerActiveKey`,
`DurableRuntimeLedger`.

## Fixtures

| File | Covers |
| --- | --- |
| `examples/signed-operation.human-write.json` | Human Office callback replace_if_match commit |
| `examples/signed-operation.agent-checkpoint.json` | Agent write_checkpoint while human owns canonical |
| `examples/signed-operation.conflict.json` | revision_mismatch reject; heads must not advance |
| `examples/signed-operation.workspace-tree-advance.json` | file_create that advances workspace tree |
| `examples/artifact-head.canonical.json` | Canonical path head after human write |
| `examples/artifact-head.checkpoint.json` | Checkpoint path head |
| `examples/workspace-head.default.json` | Workspace head after tree advance |

## Phase 2: fake runtime ledger harness (`lp-ye4.6`)

`FakeBackendRuntimeService` owns an in-memory
[`FakeRuntimeLedger`](../../portal/packages/backend-runtime/src/fake-runtime-ledger.ts):

| Surface | Behavior |
| --- | --- |
| `commitLedgerMutation` / `ledger.commit` | Create, replace, checkpoint, rename, delete, tree-advance intents; CAS via `expectedRevision` |
| `appendLedgerEvent` / `ledger.appendEvent` | Load contract fixtures; materialize heads when `advances_*=true` and committed |
| `listLedgerEvents` | Append-only history (rejected ops included) |
| `getArtifactHead` / `getWorkspaceHead` | Materialized currentness |

**Idempotency:** same `idempotencyKey` + mutation fingerprint → original
`operation_id`, original `result.revision`, same heads (no second append).

**CAS conflict:** `file_replace` with mismatched `expectedRevision` appends
`operation_rejected` / `revision_mismatch` and **does not** move artifact or
workspace heads.

**Tree root:** `workspace_head.tree_root_hash` is sha256 of the sorted
path→revision→head_kind fingerprint over all artifact heads; it changes on
committed create, replace, rename, and delete (and checkpoint path create).

Signatures on the fake use `alg: "none"` / `value: "unsigned"` — offline only.


## Phase 3: Brain RPC history and head reads (`lp-ye4.7`)

Optional expansion methods (advertise only when implemented):

| Method | Params | Result | Capability |
| --- | --- | --- | --- |
| `history.list` | `path`, optional `limit` / `cursor` / `include_rejected` | `{ path, events[], truncated, next_cursor }` | `features.history_read` + method listed |
| `heads.artifact` | `path` | `artifact_head` | `features.heads_read` + method listed |
| `heads.workspace` | optional `workspace_id` | `workspace_head` | `features.heads_read` + method listed |

**BFF** (`history-bff.ts`): stamps `BackendRuntimeContext` from session/gateway,
enforces path ACL before returning history or artifact heads, and fails closed
with `method_not_found` when capabilities do not advertise the method.

**Fake host:** `FakeBackendRuntimeService({ supportLedgerReads: true })` +
`createFakeBrainRpcInvoker` serve the three methods over the same ledger
harness as phase 2.

```bash
cd portal/packages/backend-runtime && npm test -- test/history-bff.test.ts
python3 scripts/validate-brain-rpc.py
```

## Phase 4: vault.write commit ledger integration (`lp-ye4.8`)

Successful `vault.write` commits append authoritative ledger events and may
return optional **`result.commit`** metadata for currentness consumers:

| Field | Meaning |
| --- | --- |
| `commit.operation_id` | Ledger `op_…` id (history/head pointer; **not** CAS) |
| `commit.kind` | `file_create` / `file_replace` / `file_checkpoint` |
| `commit.workspace_id` / `tree_root_hash` | Workspace head after advance (when known) |
| `commit.advances_*` | Whether artifact/workspace heads moved |

**Mode → kind mapping** (via `vaultWriteModeToOperationKind`):

| vault.write mode | Ledger kind (committed) |
| --- | --- |
| `create_new` | `file_create` |
| `replace_if_match` | `file_replace` |
| `replace_if_absent` | `file_create` or `file_replace` by outcome |
| `write_checkpoint` | `file_checkpoint` |

**Fake host (`FakeBackendRuntimeService.writeVault`):**

1. File-store CAS/policy remains the mutation SoT (unchanged modes).
2. On success: `ledger.commit` with the mapped kind, body hash, idempotency
   key, and `vault_write_mode`; result includes `commit`.
3. On CAS/policy conflict: `ledger.recordRejection` (`operation_rejected`)
   **without** advancing heads; error details still expose safe
   `reason` / revision tokens only.
4. Idempotency key + body fingerprint replay returns the **same**
   `revision` and `commit.operation_id` (no second ledger append).

Clients that ignore `commit` remain compatible (`additionalProperties: false`
on the result object; `commit` is optional).

```bash
cd portal/packages/backend-runtime && npm test -- test/vault-bff.test.ts test/fake-runtime-ledger.test.ts
python3 scripts/validate-brain-rpc.py
```

## Phase 5: access grants and unknown-agent identity (`lp-ye4.9`)

Humans and **unknown agents** present **signed, scoped access grants**. The BFF
validates grants at the boundary and stamps authority into
`BackendRuntimeContext` — it never trusts browser-supplied ACL, agent
`pathPrefixes`, or client-forged `actor` / `grant_id` claims.

**Contract:** [`access-grant.schema.json`](../../contracts/backend-runtime-v1/access-grant.schema.json)

| Field | Role |
| --- | --- |
| `grant_id` | Stable id (`grant_…`); stored on ledger `actor.grant_id` |
| `tenant_id` | Must match request tenant |
| `session_id` | Optional binding to Portal/Office session. **When set, fail-closed:** request must present the same `sessionId` (omit or mismatch → `wrong_session`) |
| `subject` | `human` \| `agent` \| `system` \| `delegated_agent` + ids |
| `path_prefixes` | Effective vault ACL after validation |
| `capabilities` | e.g. `vault.write`, `history.list` (optional `vault.*`) |
| `issued_at` / `not_before` / `expires_at` | Time window |
| `signature.key_id` | Signing key id for trust lookup / rotation |

**BFF surfaces** (`access-grant.ts`, `access-grant-bff.ts`):

| Helper | Behavior |
| --- | --- |
| `validateAccessGrant` | Parse + trust key_id + expiry + tenant + **session binding (fail-closed)** + path + capability |
| `stampContextFromAccessGrant` | Fail closed; stamp `ctx.actor`, `ctx.grantId`, grant path prefixes |
| `assertNoClientAuthorityFields` | Reject client identity/ACL bags on write envelopes |
| `actorFromGrant` | Safe ledger actor (no secrets / raw tokens / signature) |

**Fake host:** `FakeBackendRuntimeService.actorFromContext` prefers
`ctx.actor` (grant-stamped) so ledger events carry delegated_agent + `grant_id`.

**Fixtures:** `examples/access-grant.human-session.json`,
`access-grant.agent.json`, `access-grant.delegated-agent.json`.

**Tests cover:** expired grant, wrong tenant, path denial, session-bound omit /
mismatch (fail-closed), unbound grant without request session, allowed
checkpoint write with ledger actor provenance.

```bash
python3 scripts/validate-access-grant.py
cd portal/packages/backend-runtime && npm test -- test/access-grant.test.ts
```

## Phase 6: Portal currentness and history UX (`lp-ye4.11`)

Expose current-head and history state in Portal so users can see when a document
changed and inspect signed operation history — **without** treating chat/event
payloads as vault body bytes.

| Surface | Behavior |
| --- | --- |
| `GET /api/vault/history?path=` | BFF → `listArtifactHistory` (ACL + capability) |
| `GET /api/vault/heads/artifact?path=` | BFF → `getArtifactHeadRead` |
| `GET /api/vault/heads/workspace` | BFF → `getWorkspaceHeadRead` |
| Artifact pane currentness strip | Revision token, `operation_id`, actor, canonical/checkpoint |
| History panel | Toggle loads history API; client re-filters by ACL prefixes |
| Stale open document | Clean → reload banner; dirty → conflict actions; checkpoint → soft offer |
| Thread collab mode | **Separate** from vault write authority (share mode never grants `vault.write`) |

Web modules: `documentPane/currentness.ts`, `useDocumentPaneCurrentness.ts`,
`ArtifactHistoryPanel.tsx`. BFF: `createHistoryHandlers` wired in `app.ts`;
tests may inject `backendRuntimeService` (fake ledger host).

```bash
cd portal/packages/web && pnpm test -- src/features/chat/documentPane/currentness.test.ts src/api/vault.test.ts
cd portal/packages/bff && pnpm test -- test/history.integration.test.ts
cd portal/packages/backend-runtime && npm test -- test/history-bff.test.ts
```

## Phase 7: host durable ledger + signing (`lp-ye4.12`)

Hosts that claim history/currentness capabilities must persist ledger state
under **backend-owned** storage and sign observed commits after ACL/CAS.

### Filesystem layout (`$BACKEND_HOME/ledger/`)

| Path | Role |
| --- | --- |
| `events.jsonl` | Append-only SoT (one `signed_operation` JSON object per line); fsynced on append |
| `artifact_heads.json` | Materialized path heads (atomic rewrite) |
| `workspace_heads.json` | Materialized workspace heads (atomic rewrite) |
| `idempotency.json` | Idempotency key → fingerprint + `operation_id` (atomic rewrite) |
| `meta.json` | tenant/instance, active key id, event count |

Crash recovery: replay `events.jsonl` into memory (SoT). Idempotency
fingerprints are **recomputed from each committed event** on open (same
canonical hash as `commit()`), so a crash after `events.jsonl` append but
before `idempotency.json` rewrite — or a stale dual-hash snapshot — self-heals
on next open. Head snapshot files may lag; materialization follows the event
log. Empty / omitted workspace id normalizes to the ledger default.

Reference implementation: `DurableRuntimeLedger` + `ledger-signing.ts` in
`@lanyard/backend-runtime`. Fake host wiring:
`FakeBackendRuntimeService({ durableLedger: { stateDir, signer } })`.

### Host rules

1. **Persist** events, idempotency records, artifact heads, and workspace heads.
2. **Sign** with ed25519 after ACL/CAS; re-sign any client-supplied signature.
3. **Reject forged actors**: empty `subject_id`; `delegated_agent` without
   host-validated `grant_id` on the durable path.
4. **Advertise** `features.history_read` / `features.heads_read` and the three
   Brain RPC methods **only when** the durable store opened successfully.
5. **Idempotency** must survive process restart (same key + fingerprint → same
   `operation_id` and heads).

```bash
cd portal/packages/backend-runtime && npm test -- test/durable-runtime-ledger.test.ts
```

## Verification

```bash
python3 scripts/validate-signed-operation.py
python3 scripts/validate-access-grant.py
# also: bash scripts/validate.sh  (signed-operation + access-grant checks)
cd portal && pnpm --filter @lanyard/backend-runtime test
# focused:
cd portal/packages/backend-runtime && npm test -- \
  test/fake-runtime-ledger.test.ts test/history-bff.test.ts \
  test/vault-bff.test.ts test/access-grant.test.ts \
  test/durable-runtime-ledger.test.ts
cd portal/packages/bff && pnpm test -- test/history.integration.test.ts
cd portal/packages/web && pnpm test -- src/features/chat/documentPane/currentness.test.ts
python3 scripts/validate-brain-rpc.py
```

## Phase map

| Phase | Bead | Delivers |
| --- | --- | --- |
| 0 | `lp-ye4.10` | `write_checkpoint` TypeScript alignment |
| 1 | `lp-ye4.5` | Domain contract (schema + types + fixtures) |
| 2 | `lp-ye4.6` | Fake runtime in-memory ledger + heads |
| 3 | `lp-ye4.7` | Brain RPC history/head reads |
| 4 | `lp-ye4.8` | vault.write commit metadata + ledger append |
| 5 | `lp-ye4.9` | Access grants + unknown-agent identity |
| 6 | `lp-ye4.11` | Portal currentness / history UX |
| **7** | **`lp-ye4.12`** | **Host durable ledger + real signing** |
| 8 | `lp-ye4.13` | Local mocklab multiplayer proof |

## Related docs

- [portal-document-shared-state-conflict-policy.md](./portal-document-shared-state-conflict-policy.md)
- [portal-active-human-edit-agent-write-policy.md](./portal-active-human-edit-agent-write-policy.md)
- [portal-binary-vault-transfer-and-revision.md](./portal-binary-vault-transfer-and-revision.md)
- [portal-document-session-domain-model.md](./portal-document-session-domain-model.md)
- Brain RPC: `contracts/backend-runtime-v1/brain-rpc.schema.json` (`documentRevision`, `vault.write`)
