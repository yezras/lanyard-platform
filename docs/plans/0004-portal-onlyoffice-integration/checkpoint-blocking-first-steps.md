# Checkpoint: blocking first steps (document pane + ONLYOFFICE)

**Bead:** `lp-5q6.1`  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Playbook item:** Feature throughput checkpoint — *blocking first steps*  
**Status:** Recorded (pre fan-out)  
**Related plan branch (source):** `docs/onlyoffice-portal-office-integration` (feasibility; not merged)

This note must be updated if gate ownership changes before code fans out.
It is the durable gate map for `lp-5q6`, not a substitute for HOW (`lp-5q6.5`)
or ARCH (`lp-5q6.6`) deep dives.

---

## 1. First safe path vs first unsafe path

| Path | What it is | Gate |
| --- | --- | --- |
| **First safe** | Preview-only chat document pane using existing vault previews, citations, and tool progress | Re-ground boundaries (this doc + `lp-5q6.5`); no Document Server required |
| **First unsafe** | ONLYOFFICE Document Server callback writeback into customer vault | Blocked until binary transfer (`lp-5q6.17`), typed `vault.write` (`lp-5q6.18`), callback security (`lp-5q6.9` / `lp-5q6.35`), and production license + topology decisions (`lp-5q6.7`, `lp-5q6.8`) |

**Rule:** Ship pane UX first with existing client-side previews. Do not route production Office open/edit through `vault.read` JSON/base64 or `/api/vault/content` as if that were a binary editing plane.

---

## 2. Re-grounded boundaries (today)

Source of truth is monorepo `main` as of this checkpoint. Stale branch docs are not sufficient for implementation; HOW bead `lp-5q6.5` re-traces paths in code.

### 2.1 Portal web — chat

| Fact | Location / evidence |
| --- | --- |
| Chat is a single primary column | `portal/packages/web/src/features/chat/chatLayout.ts` — comment: artifact panel omitted |
| Citations deep-link to vault paths | `ChatMessageContent.tsx` / tests: `onCitationClick`, `resolveVaultCitationPath` |
| No shipped chat-side document pane | Product gap for `lp-5q6.13` and related UI beads |
| Tool progress is live-delivery, not a document session model | Relay classifies `tool_progress`; web renders progress in timeline |

**Boundary:** Chat owns conversation UX and navigation hooks into vault paths. It does **not** own Office document bytes, Document Server sessions, or vault write semantics.

### 2.2 Portal web — vault previews

| Fact | Location / evidence |
| --- | --- |
| Read-only Office-family previews | `VaultReader.tsx`, `vaultOffice.ts` (`docx-preview`, SheetJS, pptx helpers, PDF iframe) |
| Previews are fidelity-limited | Explicit product stance: keep for ordinary view; do not replace with ONLYOFFICE solely for render quality |
| Vault deep links exist | `VaultDeepLinkContext.tsx`, vault path helpers |

**Boundary:** Client previews are the default view path. ONLYOFFICE is a human **editor** (and optional high-fidelity view), not a mandatory renderer.

### 2.3 BFF vault

| Fact | Location / evidence |
| --- | --- |
| Routes: tree, entries, content, search | `portal/packages/bff/src/vault/service.ts` — list / read / search only |
| Path ACL enforced | `acl-filter.ts`; integration tests deny cross-path content |
| No write in VaultService | No POST/write method on the vault service surface today |
| Content path is preview-oriented | `/api/vault/content` returns JSON-friendly body for browser preview |

**Boundary:** BFF is the **only** HTTP storage boundary Document Server may call later (signed download + callback). Document Server must never speak Brain RPC or touch relay sockets.

### 2.4 Brain RPC vault methods

| Method | Contract status | Capability | Notes |
| --- | --- | --- | --- |
| `vault.list` | required v1 | `vault_read` / `vault_full` | Directory listing, capped |
| `vault.stat` | required v1 | `vault_read` / `vault_full` | Metadata only |
| `vault.read` | required v1 | `vault_read` / `vault_full` | **Size-capped:** default max **1 MiB**, hard max **4 MiB**; body as UTF-8 or base64 in JSON |
| `vault.write` | **optional expansion placeholder** | `vault_write` / `vault_full` → UI `vault_editor` / `ui.can.vault_edit` | Params/result are `#/$defs/params_expansion_placeholder` — **not** a production write schema |

Sources: `contracts/backend-runtime-v1/brain-rpc.schema.json`, `capabilities.schema.json`, `docs/architecture/portal-capabilities-bff.md`.

**Boundary:** `vault.read` is a small-file / preview API. It is **not** the production transfer path for large Office binaries. Production Office save requires a real `vault.write` schema (`lp-5q6.18`) plus a binary transfer design (`lp-5q6.17`).

### 2.5 Relay / live delivery

| Fact | Location / evidence |
| --- | --- |
| Live chat events include `tool_progress` | `portal/packages/relay/src/chat-delivery-hub.ts` |
| Classification uses `metadata.portal_event === "tool_progress"` | Same module; optional `tool_label` |
| No first-class `ArtifactEvent` protocol yet | Contract bead `lp-5q6.10`; parser bead `lp-5q6.11` |

**Boundary:** Relay delivers host/gateway events to Portal sessions. Document pane state must be derived in web (and optionally BFF session store for Office), not by inventing a second write path through relay.

### 2.6 Deploy / private-by-default

| Fact | Location / evidence |
| --- | --- |
| Customer vault on tenant Company Brain hosts | Deploy + Brain RPC data plane |
| Threat model: private-by-default | `deploy/references/threat-model-private-by-default.md` |
| Document Server placement is a product/security decision | `lp-5q6.8` — lab may share; production private tenants prefer per-tenant DS near vault |
| License path is commercial/legal | `lp-5q6.7` — blocks production ship, not lab spike or preview pane |

**Boundary:** Deploy owns Document Server topology, secrets (JWT), and purge story **after** decisions land. Preview-only pane work does not require Document Server Terraform.

---

## 3. Blocking gates (ordered)

Gates are **what must exist before a class of work is safe**, not a total serial order of every bead.

### Gate A — Grounding (blocks all implementation that assumes wrong storage path)

| Gate | Owner beads | Blocks |
| --- | --- | --- |
| HOW pass: chat, vault, BFF, relay, Brain RPC document paths | `lp-5q6.5` | Treating `/api/vault/content` or `vault.read` as Office binary plane; wrong file touch lists |
| ARCH pass: typed document session + artifact model | `lp-5q6.6` | Scattered pane booleans; untyped events; stale Document Server keys |

**Status at this checkpoint:** Boundaries re-grounded in §2 of this note. Deep code traces and type sketches remain on `lp-5q6.5` / `lp-5q6.6`.

### Gate B — Preview-only chat pane (safe after grounding + lightweight contracts)

Does **not** require license, topology, Document Server, or `vault.write`.

| Needed | Beads |
| --- | --- |
| Artifact event protocol (open / progress / updated / error / close) | `lp-5q6.10` (preferred before multi-file UI wiring; can sketch UI shell with local events first) |
| Pane shell + existing previews | `lp-5q6.12`, `lp-5q6.13`, `lp-5q6.14`, `lp-5q6.15`, `lp-5q6.16` |
| Shared event parse from relay metadata | `lp-5q6.11` |

### Gate C — Production ONLYOFFICE **deployment** (not preview pane)

| Gate | Owner beads | Does **not** block |
| --- | --- | --- |
| License path (lab vs staging vs production editions) | `lp-5q6.7` | Preview-only pane; fixture lab if legal allows eval DS |
| Topology + data residency (shared lab vs per-tenant prod DS) | `lp-5q6.8` | Preview-only pane |
| Staging DS + secrets | `lp-5q6.34` (after C) | Preview-only pane |

**Explicit stance:** License and topology decisions are **blockers for production ONLYOFFICE deployment**, not for preview-only chat document pane work.

### Gate D — Production callback **writeback** (customer Office save)

| Gate | Owner beads | Blocks |
| --- | --- | --- |
| Binary vault transfer + revision semantics | `lp-5q6.17` | Streaming Office bytes through JSON/base64 `vault.read`; undefined etag/key policy |
| Typed `vault.write` schema (replace placeholder) | `lp-5q6.18` | Callback persist path; capability honesty for `vault_editor` |
| Host `vault.write` on target backend pin | `lp-5q6.20` (+ BFF expose `lp-5q6.19`) | Real customer save |
| Threat notes + security review of signed download / callback / JWT / ACL / retention | `lp-5q6.9`, `lp-5q6.35` | Staging/prod writeback claim |
| Active human edit vs agent write policy | `lp-5q6.32` (with checkpoint `lp-5q6.3`) | Silent agent overwrite of dirty human sessions |

**Explicit stance:** Binary vault transfer and `vault.write` schema work **block production callback writeback**. Lab fixture writeback may prove open/edit/save mechanically only after JWT/callback threat notes are at least drafted (`lp-5q6.9`) and must not claim production readiness.

### Gate E — Lab spike (prove bridge; not production)

| Gate | Owner beads | Notes |
| --- | --- | --- |
| Lab topology + compose/runbook | `lp-5q6.25` | Depends on license/topology *lab* portion of `lp-5q6.7` / `lp-5q6.8` |
| BFF session, signed download, callback, JWT mint | `lp-5q6.21`–`lp-5q6.26` | Prefer after `lp-5q6.17` direction chosen so spike does not cement the wrong transfer |
| Lab round-trip DOCX/XLSX | `lp-5q6.28` | Fixture vault allowed; production Brain RPC writeback still under Gate D |

---

## 4. Beads safe to parallelize **before** full fan-out

Until Gates A deep-dives and contract directions stabilize, keep fan-out narrow. The following may run **in parallel now** without waiting for Document Server or production license sign-off.

### 4.1 Safe now (docs / decisions / contracts — no product code migration)

| Stream | Beads | Why safe |
| --- | --- | --- |
| Remaining pstack checkpoints | `lp-5q6.2`, `lp-5q6.3`, `lp-5q6.4` | Docs-only throughput items; share epic context |
| HOW / ARCH | `lp-5q6.5`, `lp-5q6.6` | Read-only grounding + design; serialize only if they edit the same new doc files |
| License decision draft | `lp-5q6.7` | Decision record; `needs_human` for commercial/legal accept |
| Topology decision draft | `lp-5q6.8` | Decision record; independent of UI code |
| Threat notes (draft) | `lp-5q6.9` | Docs; informs later security review |
| Artifact event protocol (contract draft) | `lp-5q6.10` | Shared types/docs; serialize with `lp-5q6.6` if both touch the same model file |
| Binary transfer + revision contract draft | `lp-5q6.17` | Contract only; blocks writeback, not pane shell |
| Typed `vault.write` schema draft | `lp-5q6.18` | Contract only; may touch `brain-rpc.schema.json` — **serialize** with any other Brain RPC contract work |

### 4.2 Safe after minimal grounding (preview pane product code)

Start when `lp-5q6.5` notes file touch list (or this §2 remains undisputed) and preferably after `lp-5q6.6` / `lp-5q6.10` sketch pane/event types.

| Stream | Beads | Ownership |
| --- | --- | --- |
| Web pane shell + previews + a11y + citations routing + progress UI | `lp-5q6.12`–`lp-5q6.16` | `portal/packages/web` chat + vault preview host only |
| Relay metadata parse helpers | `lp-5q6.11` | `portal/packages/shared` or web; avoid inventing BFF Office routes |

**Do not** start BFF Office download/callback/JWT (`lp-5q6.21`–`lp-5q6.26`) or web ONLYOFFICE host (`lp-5q6.27`+) until Gate C lab portion and Gate D contract direction exist.

### 4.3 Must stay serialized (shared contracts / write path)

| Serialized cluster | Beads | Reason |
| --- | --- | --- |
| Brain RPC `vault.write` schema + harness examples | `lp-5q6.18` then `lp-5q6.19` / `lp-5q6.20` | Single schema file; capability mapping |
| Binary transfer choice | `lp-5q6.17` before production download streaming | Wrong choice → rework BFF + host |
| Document key / revision invalidation | `lp-5q6.24` after revision identity in `lp-5q6.17` / `lp-5q6.6` | Stale Document Server cache is a security/product bug |
| Conflict policy | `lp-5q6.3` + `lp-5q6.32` before dual write paths | Human dirty vs agent overwrite |
| Production DS deploy | `lp-5q6.34` after `lp-5q6.7` + `lp-5q6.8` | License + residency |

### 4.4 Fan-out rule for executors

`beads-execute` (or human agents) may fan out leaves when:

1. This checkpoint note is current (or superseded with a newer note on the bead).
2. Independent workstream map (`lp-5q6.2`) is recorded.
3. For **preview pane** leaves: no dependency on Document Server or `vault.write`.
4. For **Office lab** leaves: lab license/topology notes exist and binary transfer direction is chosen.
5. For **production writeback** leaves: Gates C + D closed or explicitly waived for a named non-production environment only.

---

## 5. Acceptance checklist (`lp-5q6.1`)

| Criterion | Evidence |
| --- | --- |
| Existing chat, vault, BFF, Brain RPC, relay, and deploy boundaries re-grounded | §2 |
| License and topology treated as production ONLYOFFICE blockers, not preview-pane blockers | §1, Gate C, §3 |
| Binary transfer + `vault.write` schema block production callback writeback | Gate D, §1 |
| Note naming beads safe to parallelize before fan-out | §4 |

---

## 6. Principles applied (named)

From epic design / pstack Feature playbook:

- **Foundational thinking** — storage bridge and caps before React Document Server widget.
- **Boundary discipline** — BFF is the only Document Server-facing storage boundary.
- **Laziness / experience-first** — keep client previews; pane first; pay DS ops only for real edit.
- **Sequence verifiable units** — preview pane shippable without license close.
- **Separate before serializing shared state** — human dirty session vs agent write (later `lp-5q6.3`).
- **Type-system discipline** — document session model before scattered UI flags (`lp-5q6.6`).

---

## 7. Out of scope for this checkpoint

- Implementing pane UI, BFF Office routes, or Document Server compose.
- Closing license/topology human gates (decision beads write drafts; commercial/legal accept is separate).
- Migrating unrelated product code into this monorepo.

## References

- Epic `lp-5q6` and children in Beads.
- Feasibility overview (unmerged): branch `docs/onlyoffice-portal-office-integration` → `docs/plans/0004-portal-onlyoffice-integration/overview.md`.
- `contracts/backend-runtime-v1/brain-rpc.schema.json` — vault method caps and `vault.write` placeholder.
- `contracts/backend-runtime-v1/capabilities.schema.json` — `vault_editor` / `vault_write`.
- `docs/architecture/portal-capabilities-bff.md`.
- `deploy/references/threat-model-private-by-default.md`.
- ONLYOFFICE Docs API concepts: https://api.onlyoffice.com/docs/docs-api/get-started/basic-concepts/
