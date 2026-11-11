# Independent workstreams — document pane and ONLYOFFICE

**Bead:** `lp-5q6.2` (pstack Feature throughput checkpoint)  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Status:** Durable parallelization map (historical; see residual note)  
**Related checkpoints:** `lp-5q6.1` (blocking first steps), `lp-5q6.3` (shared mutable state), `lp-5q6.4` (smallest safe decomposition)  
**Current shipped/residual:** [overview.md](overview.md) (`lp-5q6.39`)

This document is the Feature playbook **independent workstreams** checkpoint. It names which slices may run in parallel, which paths must serialize, and when **`/beads-execute`** (or equivalent multi-leaf fan-out) is safe.

Principle: **separate-before-serializing-shared-state**. Disjoint file trees, services, and repos parallelize. Shared schemas, event types, and route contracts serialize until green.

---

## 1. Repo and service boundaries

| Plane | Repo / path (default) | Role for this epic |
| --- | --- | --- |
| Portal web | `portal/packages/web` | Chat document pane, vault previews, ONLYOFFICE editor host |
| Portal BFF | `portal/packages/bff` | Vault ACL, Office session, signed download, callback writeback, JWT config mint |
| Portal backend-runtime client | `portal/packages/backend-runtime` | Brain RPC client types and vault method wrappers |
| Portal shared | `portal/packages/shared` | Cross-package types shared by web and BFF |
| Portal relay | `portal/packages/relay` | Session/metadata path if artifact events ride relay |
| Monorepo contracts | `contracts/backend-runtime-v1` | Brain RPC method schemas, capabilities, binary transfer shape |
| Monorepo deploy | `deploy/` | Lab/staging Document Server topology, secrets, compose/TF |
| Monorepo docs | `docs/` | Plans, runbooks, threat notes, architecture records |
| External backend (Hermes-Lanyard) | **outside monorepo** (versioned pin) | Host `vault.write`, artifact emit, revision semantics on disk |
| External Document Server | ONLYOFFICE Docs process (lab/staging/prod) | Open, edit assembly, callback; not Lanyard source |

Cross-repo backend work (Hermes-Lanyard / host pin) is **never** mixed into Portal web or BFF PRs. Track host work as separate beads (`lp-5q6.20`, `lp-5q6.31`, and related). Portal consumes published capabilities and Brain RPC shapes only.

---

## 2. Independent streams (file / service ownership)

Each stream owns a disjoint primary tree. After **serialized contract beads** are closed (see §3 and §5), workers on different streams may land PRs in parallel without stepping on the same files.

### Stream A — Portal web: chat document pane (preview-first)

| | |
| --- | --- |
| **Owns** | Chat layout and pane shell; path open from citations and tool targets; preview host reuse; responsive/a11y pane chrome |
| **Primary paths** | `portal/packages/web/src/features/chat/` (`ChatView.tsx`, `chatLayout.ts`, timeline/composer) · `portal/packages/web/src/features/vault/` (`VaultReader.tsx`, `vaultOffice.ts`, path helpers) · `portal/packages/web/src/app/ai-chat/` |
| **New expected paths** | e.g. `portal/packages/web/src/features/chat/documentPane*` (reducer, shell, open-target routing) under web only |
| **Beads** | `lp-5q6.12`, `lp-5q6.13`, `lp-5q6.14`, `lp-5q6.15`, `lp-5q6.16` |
| **Does not own** | BFF routes, Brain RPC schemas, Document Server deploy |
| **Consumes** | Existing vault content/preview APIs; later typed artifact events from Stream C; Office editor host from Stream F only after contracts + lab |

### Stream B — Portal BFF: Office session and storage bridge

| | |
| --- | --- |
| **Owns** | Office session store/lifecycle; signed download for Document Server; callback writeback; JWT editor config mint; document key invalidation helpers used by BFF |
| **Primary paths** | `portal/packages/bff/src/vault/` (`service.ts`, ACL, providers) · new `portal/packages/bff/src/office/` (or equivalent) for session, download, callback, JWT · BFF route registration under `portal/packages/bff/src/` |
| **Beads** | `lp-5q6.21`, `lp-5q6.22`, `lp-5q6.23`, `lp-5q6.24` (BFF half), `lp-5q6.26` |
| **Does not own** | React UI, host `vault.write` implementation, Document Server images |
| **Consumes** | Binary transfer + `vault.write` contract from Stream D; capability gates from backend-runtime package |

### Stream C — Shared artifact event parsing (web + thin shared)

| | |
| --- | --- |
| **Owns** | Parse/normalize relay or chat metadata into a document-pane artifact model; timeline mapping for progress and checkpoints |
| **Primary paths** | Prefer pure modules under `portal/packages/shared/src/` **or** web-local parsers under `portal/packages/web/src/features/chat/` that only depend on the **frozen event contract** · tests colocated with parsers |
| **Beads** | `lp-5q6.11` (and consumers in `lp-5q6.16`) |
| **Does not own** | Host emission of events (Stream E); BFF Office HTTP |
| **Serializes on** | `lp-5q6.10` chat artifact event protocol (must land first) |

### Stream D — Monorepo contracts: vault write + binary transfer

| | |
| --- | --- |
| **Owns** | Typed Brain RPC expansion for `vault.write`; binary vault transfer and revision semantics; capability examples; contract fixtures |
| **Primary paths** | `contracts/backend-runtime-v1/brain-rpc.schema.json` · `capabilities.schema.json` · related examples/fixtures under `contracts/backend-runtime-v1/` · architecture notes under `docs/architecture/` when contracts require prose |
| **Beads** | `lp-5q6.17`, `lp-5q6.18` |
| **Does not own** | Host implementation or BFF route code (those **depend** on this stream) |
| **Note** | Today `vault.write` is `optional_expansion` with placeholder params/result refs. Replacing that placeholder is **serialized** work (one owner at a time on the schema files). |

### Stream E — Cross-repo backend (Hermes-Lanyard host pin)

| | |
| --- | --- |
| **Owns** | Implementing `vault.write` on the target backend pin; emitting artifact events for agent file work; host-side revision/idempotency; human-edit vs agent-write policy enforcement on host where required |
| **Primary paths** | **External** Hermes-Lanyard (or pin-specific) source; not under `portal/` · pin/compatibility updates under `compatibility/` and deploy pins only when cutting a new artifact |
| **Beads** | `lp-5q6.19` (BFF exposure half may touch Portal after contract green), `lp-5q6.20`, `lp-5q6.31`, `lp-5q6.32` (policy may span product + host) |
| **Separation rule** | Ship host changes as their own PRs/releases. Portal web/BFF PRs pin a version and consume methods/capabilities. Do not open a single PR that mixes Hermes-Lanyard source with Portal UI. |
| **Blocks** | Production callback writeback and staging E2E that require real host write |

### Stream F — ONLYOFFICE lab + web editor host

| | |
| --- | --- |
| **Owns** | Lab Document Server wiring; open/edit/save/callback proof; feature-flagged web editor host; vault edit entrypoint gated by capabilities; chat pane using editor when ready |
| **Primary paths** | `deploy/` lab compose/runbook fragments · `docs/runbooks/` · `portal/packages/web` editor host modules (new, flag-gated) · optional vault entry UI in `portal/packages/web/src/features/vault/` |
| **Beads** | `lp-5q6.25`, `lp-5q6.28`, `lp-5q6.27`, `lp-5q6.29`, `lp-5q6.30` |
| **Does not own** | Production license/topology decisions (human gates `lp-5q6.7`, `lp-5q6.8`) · production staging topology (`lp-5q6.34`) until decisions land |
| **Consumes** | Stream B endpoints; Stream D write contracts for real vault writeback |

### Stream G — Deploy, observability, security docs, ops runbooks

| | |
| --- | --- |
| **Owns** | Staging Document Server topology and secrets; Office metrics without payload leaks; threat notes; JWT rotation and forgotten-file purge runbooks; plan updates |
| **Primary paths** | `deploy/` · `docs/runbooks/` · `docs/architecture/` · `deploy/references/` threat model extensions · `docs/plans/0004-portal-onlyoffice-integration/` |
| **Beads** | `lp-5q6.9`, `lp-5q6.33`, `lp-5q6.34`, `lp-5q6.35`, `lp-5q6.36`, `lp-5q6.39` |
| **Parallelism** | Docs/runbooks/threat prose can draft early. **Staging deploy and security sign-off** wait on license, topology, and implementation of signed download/callback. |

### Stream H — Verification (lab, browser QA, full-chain E2E)

| | |
| --- | --- |
| **Owns** | Lab round-trip proof; browser verification for pane + editor; full-chain chat → agent write → pane refresh → human save |
| **Primary paths** | Tests under `portal/packages/web`, `portal/packages/bff`; lab scripts/docs under `deploy/` and `docs/`; proof records under `artifacts/lab/` or `artifacts/localhost/` |
| **Beads** | `lp-5q6.28` (lab GO, closed), `lp-5q6.37` (browser QA, closed), `lp-5q6.38` (**localhost mocklab** full-chain E2E, residual) |
| **Rule** | Verification beads trail the streams they prove. Environment of record for free-track E2E is **localhost + lab DS**, not AWS staging (`lp-5q6.40` deferred). |

---

## 3. Serialized work (shared files and contracts)

These paths and concerns must **not** be edited by parallel workers. One bead owner at a time; merge before the next serializer starts.

### 3.1 Shared contracts (hard serialize)

| Shared surface | Paths / artifacts | Owning beads (order) | Why serialize |
| --- | --- | --- | --- |
| Chat artifact event protocol | Contract doc + any shared TypeScript event types (shared package or dual web/BFF import) | `lp-5q6.10` → then `lp-5q6.11` | Event shape is the fan-in for pane progress and host emit |
| Binary vault transfer + revision | `contracts/backend-runtime-v1/*` (+ architecture note) | `lp-5q6.17` | Office open/save sizes and revision rules affect BFF and host |
| Typed `vault.write` schema | `brain-rpc.schema.json`, capabilities, examples | `lp-5q6.18` → `lp-5q6.19` / `lp-5q6.20` | Placeholder expansion changes method surface for all consumers |
| Document session domain model | Architecture / types used by web + BFF | `lp-5q6.6` (architect) before reducer/session store code | Prevents divergent pane vs Office session models |
| Document key + revision invalidation policy | Shared policy text + BFF/web key helpers | `lp-5q6.24` after `lp-5q6.17` / `lp-5q6.6` | Cache key collisions are a security and correctness hazard |
| BFF Office route contracts | Route paths, auth, JWT claims, error shapes | Before or inside first of `lp-5q6.21`–`lp-5q6.23`, `lp-5q6.26` — single design owner | Parallel route invention causes incompatible Document Server config |

### 3.2 Shared product files (soft serialize / file locks)

| File / area | Streams that touch it | Rule |
| --- | --- | --- |
| `portal/packages/web/src/features/chat/chatLayout.ts` | Stream A (pane shell) | Single owner for layout chrome; land pane shell before a11y polish on same file |
| `portal/packages/web/src/features/chat/ChatView.tsx` | Stream A | Serialize open-target wiring vs shell if both open; prefer stacked PRs |
| `portal/packages/web/src/features/vault/VaultReader.tsx` | Stream A (preview), Stream F (editor flag) | Preview pane reuse first; editor host behind flag in a follow-up PR |
| `portal/packages/bff/src/vault/service.ts` | Stream B | Avoid concurrent Office adapter + unrelated vault ACL refactors |
| `portal/packages/shared/src/*` | Stream C (+ occasional B/A) | Add new modules rather than rewrite unrelated shared exports mid-flight |
| `contracts/backend-runtime-v1/brain-rpc.schema.json` | Stream D only until closed | No parallel schema PRs |

### 3.3 Decision gates (human serialize for production)

| Decision | Bead | Blocks |
| --- | --- | --- |
| ONLYOFFICE license path | `lp-5q6.7` | Production ship of Document Server embedding |
| Document Server topology / data residency | `lp-5q6.8` | Staging/production deploy topology (`lp-5q6.34`) |
| Security review of signed download + callback | `lp-5q6.35` | Production writeback confidence |

Preview-only chat pane work (Stream A with existing vault previews) is **not** blocked by license or topology.

---

## 4. Cross-repo backend vs Portal (web / BFF)

| Work | Where it lives | How it couples |
| --- | --- | --- |
| Typed method + capability contracts | Monorepo `contracts/backend-runtime-v1` | Versioned contract; Portal and host both conform |
| Host `vault.write` implementation | External Hermes-Lanyard (or pin product) | Published via backend artifact pin; Portal does not vendor host source |
| Host artifact event emission | External gateway/backend | Shape must match monorepo event protocol (`lp-5q6.10`) |
| BFF vault.read / future vault.write handlers | `portal/packages/bff` + `portal/packages/backend-runtime` | Calls Brain RPC only; no Document Server on host |
| Document Server download/callback | Portal BFF HTTP only | Document Server never speaks Brain RPC |
| Chat pane + previews + editor iframe | `portal/packages/web` | Talks to BFF and existing chat/relay client APIs |

**Separation checklist for PR authors**

1. Host pin PR: backend source + pin notes only.  
2. Contract PR: `contracts/` (+ docs) only.  
3. BFF Office PR: `portal/packages/bff` (+ tests); depends on contract version.  
4. Web pane PR: `portal/packages/web` only; no schema edits.  
5. Deploy/runbook PR: `deploy/` + `docs/` only unless a lab compose path is the explicit deliverable.

---

## 5. When `/beads-execute` can safely fan out leaves

### 5.1 Not yet (do not fan out implementation leaves)

Do **not** run multi-leaf implementation fan-out until the following are closed or explicitly waived with notes on `lp-5q6.1`:

| Gate | Beads | Reason |
| --- | --- | --- |
| HOW ground | `lp-5q6.5` | Paths and existing surfaces must be re-grounded |
| Architect domain model | `lp-5q6.6` | Session/artifact/Office types stabilize consumers |
| Artifact event contract | `lp-5q6.10` | Stream C and host emit depend on one shape |
| Binary transfer + revision | `lp-5q6.17` | Blocks real Office writeback design |
| Typed `vault.write` | `lp-5q6.18` | Blocks host and BFF write handlers |

Checkpoint siblings `lp-5q6.1`–`lp-5q6.4` may complete in parallel as **docs/checkpoints only**. Decision beads `lp-5q6.7` / `lp-5q6.8` may run in parallel with HOW/ARCH as **decision drafts** (human gate for production).

### 5.2 Safe early fan-out (after §5.1 gates, preview path)

Once `lp-5q6.5`, `lp-5q6.6`, and `lp-5q6.10` are green, **`/beads-execute` may claim these disjoint leaves in parallel**:

| Parallel set | Streams | Leaves (examples) |
| --- | --- | --- |
| Preview pane UI | A | `lp-5q6.12`, `lp-5q6.13`, `lp-5q6.14`, `lp-5q6.15` (serialize only if two claim the same ChatView/layout file) |
| Artifact parse | C | `lp-5q6.11` then `lp-5q6.16` (`.16` may wait on `.11` + pane shell) |
| Threat / ops drafts | G | `lp-5q6.9`, early runbook outlines |
| Contract finish | D | If `lp-5q6.17` / `lp-5q6.18` still open, keep **one** worker on contracts |

Still **serialize** any two beads that both edit `chatLayout.ts`, `ChatView.tsx`, or `VaultReader.tsx`.

### 5.3 Safe second fan-out (Office bridge + host)

After `lp-5q6.17` and `lp-5q6.18` are green:

| Parallel set | Streams | Leaves (examples) |
| --- | --- | --- |
| BFF Office endpoints | B | `lp-5q6.21`, then `lp-5q6.22` / `lp-5q6.26` / `lp-5q6.23` as stacked or carefully split PRs on `bff` office module |
| Host write | E | `lp-5q6.20` (and capability exposure `lp-5q6.19` after contract) **in the external repo / pin track** |
| Lab Document Server | F / G | `lp-5q6.25` (compose/runbook) parallel to BFF fixture adapter work |
| Observability sketches | G | `lp-5q6.33` metric names (no payload fields until routes exist) |

Do **not** parallelize two writers on `portal/packages/bff/src/vault/service.ts` without an agreed file split (prefer new `office/` module).

### 5.4 Safe third fan-out (editor UI + verification)

After lab bridge proof (`lp-5q6.28`) and BFF session/download/callback exist:

| Parallel set | Streams | Leaves |
| --- | --- | --- |
| Flagged editor host | F | `lp-5q6.27`, `lp-5q6.29`, then `lp-5q6.30` |
| Host artifact emit | E | `lp-5q6.31` (contract already frozen) |
| Browser QA | H | `lp-5q6.37` |
| Ops polish | G | `lp-5q6.36`, `lp-5q6.39` |

Staging module `lp-5q6.34` is **infra_ready** on main; live AWS apply is deferred (`lp-5q6.40`). Residual E2E is localhost mocklab (`lp-5q6.38`). Security review `lp-5q6.35` is closed (PASS WITH RESIDUALS) and does not authorize production writeback.

### 5.5 Fan-out recipe (operators)

```text
1. Close HOW + ARCH + event/binary/write contracts (or document waiver on lp-5q6.1).
2. beads-execute (or claim-and-ship) Stream A preview leaves + Stream C parser + doc drafts.
3. When contracts green: parallel Stream B (BFF) + Stream E (host pin) + Stream F lab compose.
4. After lab open/edit/save proof: parallel editor host UI + QA + runbooks.
5. Localhost full-chain E2E last (`lp-5q6.38`); AWS re-apply only if spend returns (`lp-5q6.40`).
```

**Rewrite this map** when a phase boundary lands. Append a short revision note at the bottom rather than silent drift. Current truth: [overview.md](overview.md).

---

## 6. Stream ↔ bead index (quick)

| Stream | Label | Bead IDs |
| --- | --- | --- |
| A | Portal web pane | `.12` `.13` `.14` `.15` `.16` |
| B | Portal BFF Office | `.21` `.22` `.23` `.24` `.26` |
| C | Artifact parse | `.11` (+ `.16` consumer) |
| D | Monorepo contracts | `.17` `.18` |
| E | Cross-repo backend | `.19` `.20` `.31` `.32` |
| F | ONLYOFFICE lab + editor UI | `.25` `.27` `.28` `.29` `.30` |
| G | Deploy / obs / security / docs | `.9` `.33` `.34` `.35` `.36` `.39` |
| H | Verification | `.28` `.37` `.38` |
| Checkpoints / decisions / how-arch | Meta | `.1` `.2` `.3` `.4` `.5` `.6` `.7` `.8` `.10` |

---

## 7. Acceptance mapping (`lp-5q6.2`)

| Criterion | Where satisfied |
| --- | --- |
| Independent streams listed with file or service ownership | §2 streams A–H |
| Shared files and shared contracts called out as serialized work | §3 |
| Cross-repo backend work separated from Portal web and BFF | §1 table, Stream E, §4 |
| Note when beads-execute can safely fan out leaves | §5 |

---

## Revision history

| Date | Note |
| --- | --- |
| 2026-07-24 | Initial map from epic `lp-5q6` bead set and Feature throughput checkpoint `lp-5q6.2`. |
| 2026-07-26 | Residual rewrite (`lp-5q6.39`). free-track product path mostly shipped; `lp-5q6.38` is localhost mocklab E2E (not AWS staging); `lp-5q6.40` defers AWS re-apply under $0 spend. Canonical status lives in [overview.md](overview.md). |
