# Hermes-Lanyard host `vault.write` (lp-5q6.20)

**Bead:** `lp-5q6.20` — backend: implement vault.write on the target Hermes-Lanyard backend pin  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Status:** Implemented on Hermes-Lanyard product source (external pin); tracked here for Portal/deploy consumers  
**Contract:** typed expansion `lp-5q6.18` (`params_vault_write` / `result_vault_write` in `brain-rpc.schema.json`)  
**Principles:** boundary-discipline, make-operations-idempotent  

## Purpose

The Company Brain **host** is the final authority for vault bytes. Portal and BFF
must not claim `vault_editor` / `ui.can.vault_edit` from static defaults when the
host does not implement `vault.write`. This note records the Hermes-Lanyard pin
behavior so monorepo consumers stay honest until a published artifact is pinned.

## Implementation location

| Surface | Location |
| --- | --- |
| Product source | **External:** `hermes-lanyard` repo `gateway/brain_rpc/vault_ops.py` (`vault_write`), registered in `handlers.HANDLERS` |
| Capability honesty | `handle_brain_capabilities` derives `features.vault_write` and `ui_affordances.vault_editor` from `HANDLERS` keys only |
| Profile caps | `METHOD_CAPABILITIES["vault.write"] = {vault_write, vault_full}` in `gateway/brain_rpc/auth.py` |
| Platform contracts | `contracts/backend-runtime-v1/brain-rpc.schema.json` (`x-lanyard-vault-write`) |
| Host PR | https://github.com/LanyardBrain/hermes-lanyard/pull/21 |

Hermes-Lanyard source is **not** vendored into this monorepo. Cut over staging by
publishing a backend artifact that includes the write handler and pinning
`backend.version` / `backend.sha256` under `compatibility/` + deploy roots.

## Acceptance map

| Criterion | How Hermes-Lanyard meets it |
| --- | --- |
| Advertise `vault.write` only when live | Method registered in `HANDLERS`; capabilities feature flags derived from registration |
| Profile capabilities + path prefixes | Auth any-of `vault_write`/`vault_full`; `path_allowed` L5 ACL on every write |
| Reject traversal / directories / bad extensions / oversized / revision conflict | `normalize_vault_path` rejects `..`; directories → `invalid_argument`; executable denylist → `invalid_type`; inline cap (1–4 MiB) → `payload_too_large`; CAS mismatch → `conflict`/`revision_mismatch` |
| Atomic write | Temp file in parent dir + `os.replace` |
| Revision identity | `content_hash` tokens `sha256:<hex>`; returned on write; `vault.stat` includes `revision` for CAS open |
| Tests | `tests/gateway/brain_rpc/test_handlers.py` — create, CAS, deny outside prefix, traversal, extension, oversized, idempotent replay |

## Content planes

| Plane | Host pin status |
| --- | --- |
| Inline `content` + `encoding` (`utf-8` \| `base64`) | **Implemented** (same size plane as `vault.read`) |
| `content_ref` (BFF spool / upload session / chunked) | **Fail closed** (`invalid_argument`) until spool integration lands with BFF writeback (`lp-5q6.19` / `lp-5q6.23`) |

Production ONLYOFFICE callback for large Office files must use the staged plane
(see `portal-binary-vault-transfer-and-revision.md` / `lp-5q6.17`). Inline is
sufficient for small text/knowledge writes and lab fixtures under the hard cap.

## Modes

| Mode | Behavior |
| --- | --- |
| `create_new` | Create; `conflict` if path exists |
| `replace_if_match` | Requires `expected_revision` or `if_match`; constant-time token compare; no partial write on mismatch |
| `replace_if_absent` | Create only when missing; same-body present → idempotent success |

`idempotency_key` is required. Process-local store converges retries with the
same key + body fingerprint; body mismatch with reused key → `conflict`.

## Portal / BFF honesty

Until the host pin is deployed:

1. Do **not** force `features.vault_write: true` from static Portal defaults when
   the live host descriptor omits `vault.write`.
2. BFF exposure of write handlers is **`lp-5q6.19`** (capability-gated).
3. Example descriptors under `contracts/backend-runtime-v1/examples/` may list
   `vault.write` as the **target** shape for a full Hermes-Lanyard product; live
   capability discovery remains authoritative.

## Downstream

| Item | Bead |
| --- | --- |
| Typed schema | `lp-5q6.18` (done) |
| BFF capability-gated handlers | `lp-5q6.19` |
| ONLYOFFICE callback writeback | `lp-5q6.23` |
| Publish + pin HL artifact with write | deploy/staging pin cutover after HL merge |

## References

- Contract: `contracts/backend-runtime-v1/brain-rpc.schema.json` `#/$defs/params_vault_write`
- Conflict / CAS product policy: [`portal-document-shared-state-conflict-policy.md`](./portal-document-shared-state-conflict-policy.md)
- Binary transfer: `lp-5q6.17` / Office transfer examples
- Independent streams: [`../plans/0004-portal-onlyoffice-integration/independent-workstreams.md`](../plans/0004-portal-onlyoffice-integration/independent-workstreams.md) Stream E
