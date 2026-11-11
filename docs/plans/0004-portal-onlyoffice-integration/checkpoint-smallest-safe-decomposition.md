# Checkpoint: smallest safe decomposition for delivery

**Bead:** `lp-5q6.4`  
**Epic:** `lp-5q6` — Portal document pane and ONLYOFFICE editing  
**Kind:** pstack Feature playbook throughput checkpoint  
**Principle:** `principle-sequence-verifiable-units` (small units; verify each before advancing)  
**Status:** Accepted for delivery sequencing (historical slices; residual note in Slice 6)  
**Current shipped/residual:** [overview.md](overview.md) (`lp-5q6.39`)

## Purpose

Keep early product value high and blast radius low. The chat document pane
improves Portal even if ONLYOFFICE is deferred for licensing, topology, or
security reasons. This checkpoint freezes the delivery sequence so each later
bead lands with **one verifiable output** and never requires a full epic merge
to prove progress.

## Decisions (binding for implementers)

### D1 — First shippable slice is preview-only

The first user-visible ship is a **preview-only chat document pane** that reuses
existing vault preview code. It must:

- Open beside chat without leaving the Chat tab.
- Render markdown, text, image, PDF, DOCX, XLSX, and PPTX via current client
  previews (not Document Server).
- Support close, reload, open-in-vault, and download.
- Keep the composer usable and the chat column readable.

**Primary beads:** `lp-5q6.12` → `lp-5q6.13` → `lp-5q6.14` / `lp-5q6.15`, with
optional progress display `lp-5q6.16` once artifact events exist.

**Ship gate:** unit tests for open/close + desktop screenshot. No Document
Server, no JWT mint, no writeback.

### D2 — ONLYOFFICE lab is separated from production editing

Lab spike work is **explicitly non-production**:

| Track | Goal | Beads (core) |
| --- | --- | --- |
| **Lab spike** | Prove open → edit → callback write on fixture storage | `lp-5q6.25`, `lp-5q6.21`–`lp-5q6.24`, `lp-5q6.26`–`lp-5q6.28` |
| **Production editing** | Real vault writeback for customers | Still blocked (free-track license + prod topology). Lab/editor UI shipped; customer edit needs paid license (or counsel) + `prod-per-tenant-ds` |

Rules:

1. Lab may use shared/single Document Server, fixture vault, and developer JWT
   secrets documented in runbooks only.
2. Lab success is a go/no-go for production editing work — not a license to
   enable the editor for tenants.
3. Feature flags keep the ONLYOFFICE React host off by default
   (`lp-5q6.27`, `lp-5q6.30`).
4. Lab callback write must not hit production tenant vault paths until
   contracts and security review pass.

### D3 — Production editing waits on four gates

Production human edit (Document Server → callback → vault.write on customer
bytes) is **blocked** until all of the following are closed with evidence:

| Gate | Bead(s) | Verifiable output |
| --- | --- | --- |
| **Write contract** | `lp-5q6.18`, host/BFF expose `lp-5q6.19`–`lp-5q6.20` | Typed `vault.write` schema + capability-gated handlers; no placeholder |
| **Binary transfer** | `lp-5q6.17` | Documented transfer path for large Office files; forbids production JSON/base64 via `/api/vault/content` |
| **Security** | `lp-5q6.9`, `lp-5q6.35` | Threat notes + review of signed download, callback, JWT, ACL, retention |
| **License (+ topology)** | `lp-5q6.7`, `lp-5q6.8` | Written lab/staging/production license and topology decisions; human/legal gate on production license |

Staging Document Server **module** (`lp-5q6.34`) landed as **infra_ready** compose after lab GO (`lp-5q6.28`). Live AWS apply is deferred (`lp-5q6.40`). Full-chain product proof is localhost mocklab (`lp-5q6.38`), not staging AWS.

### D4 — One verifiable output per later bead

Each non-checkpoint bead below must merge only when its listed output is green.
Reviewers must not require the entire epic to validate a leaf PR.

## Smallest useful path (ordered slices)

```text
0  Grounding + domain  ──► 1 Preview pane  ──► 2 Artifact events
                              (shippable)         (pane progress)
         │
         ▼
3  Binary + write contracts  ──► 4 ONLYOFFICE lab  ──► 5 Vault edit MVP
   (gates production)            (spike only)         (gated by D3)
         │
         ▼
6  Residual: localhost E2E (`lp-5q6.38`); AWS re-apply deferred (`lp-5q6.40`)
```

| Slice | Name | Outcome a user/operator can check | Must not include |
| --- | --- | --- | --- |
| **0** | Grounding + domain | HOW/ARCH notes + typed models exist | Product UI, Document Server |
| **1** | Preview pane | Chat opens vault file in side pane with existing previews | ONLYOFFICE, vault.write, binary bridge |
| **2** | Artifact events + progress | Agent file work opens/refreshes pane and shows progress | Editor, production writeback |
| **3** | Binary + write contracts | Schemas and transfer docs + offline contract tests | Live Document Server |
| **4** | ONLYOFFICE lab | DOCX/XLSX open-edit-save-callback on lab fixture | Staging tenants, production license claim |
| **5** | Vault edit MVP | Capability-gated edit in vault/chat when flags + write live | Cloud Document Server as default |
| **6** | Staging + E2E | Staging chat → agent write → pane refresh → human save | Shipping without security review |

## Slice → bead map with verifiable outputs

### Slice 0 — Grounding and domain (docs / types only)

| Bead | Verifiable output (done when) |
| --- | --- |
| `lp-5q6.1` | Blocking gates recorded; preview-only path called safe; writeback called unsafe until gates |
| `lp-5q6.2` | Independent streams + serialization points listed |
| `lp-5q6.3` | Shared mutable state enumerated; dirty human vs agent write policy stated |
| `lp-5q6.4` | This document: first ship = preview pane; lab ≠ production; D3 gates; per-bead outputs |
| `lp-5q6.5` | HOW pass: chat, vault, BFF, relay, Brain RPC document paths traced |
| `lp-5q6.6` | ARCH: typed models for session, artifact events, revisions, conflicts |
| `lp-5q6.7` | License decision record (lab/staging/production); production needs human accept |
| `lp-5q6.8` | Topology decision record (lab/staging/production + residency) |
| `lp-5q6.9` | Threat notes for Office bridge (download, callback, JWT, retention) |

### Slice 1 — First shippable product (preview-only pane)

| Bead | Verifiable output (done when) |
| --- | --- |
| `lp-5q6.12` | `ArtifactPanelState` reducer + path resolution tests (closed / opening / previewing / error, …) |
| `lp-5q6.13` | **Ship slice:** chat right-pane shell using existing vault previews; unit + screenshot |
| `lp-5q6.14` | Citation / tool target opens pane by default; secondary control still opens full Vault |
| `lp-5q6.15` | Desktop resizable pane; mobile full-screen drawer; a11y basics |

**Epic merge not required:** a PR that only lands `lp-5q6.12`+`lp-5q6.13` is reviewable
and demoable with fixtures and existing vault read APIs.

### Slice 2 — Artifact events and progress (still no ONLYOFFICE)

| Bead | Verifiable output (done when) |
| --- | --- |
| `lp-5q6.10` | Event protocol + parse tests for `artifact.open|progress|updated|error|close` |
| `lp-5q6.11` | Shared parser normalizes relay metadata into typed chat events |
| `lp-5q6.16` | Pane header shows agent operation; progress updates without duplicate spam |
| `lp-5q6.31` | Gateway/backend emits artifact events for agent file work (may trail UI fixtures) |

**Epic merge not required:** fixture-injected events prove pane progress before
backend emission lands.

### Slice 3 — Contracts that gate production writeback

| Bead | Verifiable output (done when) |
| --- | --- |
| `lp-5q6.17` | Binary transfer + revision semantics doc; contract tests/examples; ban on large JSON/base64 Office path |
| `lp-5q6.18` | Concrete `vault.write` schema (params, result, errors, idempotency, expected-revision) |
| `lp-5q6.19` | BFF/`BackendRuntimeService` capability-gated `writeVault` |
| `lp-5q6.20` | Target Hermes-Lanyard pin implements `vault.write` when advertised |
| `lp-5q6.32` | Product/backend policy: active human dirty edit vs agent write (staged copy default) |

### Slice 4 — ONLYOFFICE lab spike (isolated)

| Bead | Verifiable output (done when) |
| --- | --- |
| `lp-5q6.25` | Lab runbook/compose: Document Server + JWT; local `api.js` loads |
| `lp-5q6.21` | Server-owned `OfficeDocumentSession` lifecycle |
| `lp-5q6.22` | Signed short-lived download endpoint Document Server can fetch |
| `lp-5q6.23` | Callback endpoint handles status codes; status 2/6 pull and write fixture |
| `lp-5q6.24` | Document key includes tenant + path + revision; invalidation policy |
| `lp-5q6.26` | BFF mints editor config + JWT for a session |
| `lp-5q6.27` | Web editor host behind feature flag (default off) |
| `lp-5q6.28` | **Lab go/no-go:** DOCX + XLSX open/edit/save/callback evidence (no body logs) |

**Epic merge not required:** lab compose + fixture write is sufficient proof for
`lp-5q6.28` without staging deploy.

### Slice 5 — Vault edit MVP (after D3)

| Bead | Verifiable output (done when) |
| --- | --- |
| `lp-5q6.29` | Vault edit affordance only when type supported + `ui.can.vault_edit` |
| `lp-5q6.30` | Chat pane chooses preview vs ONLYOFFICE from type, capability, flag, mode |
| `lp-5q6.35` | Security review of implemented download/callback/writeback |
| `lp-5q6.33` | Metrics for open/save/callback/pane without payload leaks |
| `lp-5q6.36` | Ops runbook: start/stop/upgrade, JWT rotate, forgotten-file purge |

### Slice 6 — Staging module, browser QA, residual E2E, plan honesty

| Bead | Verifiable output (done when) | Residual note (2026-07-26) |
| --- | --- | --- |
| `lp-5q6.34` | Staging Document Server module matches topology; secrets from secret store | **Closed:** infra_ready module; live AWS apply deferred → `lp-5q6.40` |
| `lp-5q6.37` | Browser verification for pane + editor (desktop/mobile) | Closed (lab editor path) |
| `lp-5q6.38` | Full-chain proof: chat → agent write → pane refresh → human save | **Open residual:** localhost mocklab + lab DS (not AWS staging) |
| `lp-5q6.39` | Plan docs state shipped limits, free track, residuals | This honesty pass |
| `lp-5q6.40` | Re-apply AWS staging DS + Office API | **Deferred** until spend re-enable |

## What must not be bundled

| Anti-pattern | Why it is unsafe |
| --- | --- |
| Pane UI + Document Server in one PR | Couples shippable UX to license/ops unknowns |
| Callback writeback without `vault.write` + binary contract | Risk of base64/large-file abuse and partial writes |
| Enabling editor flag for staging tenants before `lp-5q6.7`/`lp-5q6.8`/`lp-5q6.35` | Legal, residency, and security exposure |
| Requiring `lp-5q6.38` to accept preview pane | Defeats sequence-verifiable-units; delays value |
| Agent live co-edit in ONLYOFFICE as MVP | Out of epic; headless skills + pane refresh only |

## Relationship to other checkpoint beads

| Checkpoint | Owns |
| --- | --- |
| `lp-5q6.1` | What blocks first steps (gates vs preview-safe work) |
| `lp-5q6.2` | Who can parallelize after contracts (stream ownership) |
| `lp-5q6.3` | How shared state and conflicts are separated |
| **`lp-5q6.4` (this)** | In what order value ships; first slice; lab vs prod; per-bead proof |

Implementers read all four before fan-out. This document does not replace the
HOW (`lp-5q6.5`), ARCH (`lp-5q6.6`), license, topology, or threat beads — it
sequences them.

## Acceptance checklist (this bead)

- [x] First shippable slice is preview-only chat document pane (`D1`, Slice 1, `lp-5q6.13`).
- [x] ONLYOFFICE lab spike is separated from production editing (`D2`, Slice 4 vs 5–6).
- [x] Production editing waits for write contract, binary transfer, security, and license decisions (`D3`).
- [x] Each later bead has one verifiable output and does not require a full epic merge to prove (`D4`, tables above).

## Sources

- Epic `lp-5q6` design stance (pane first; ONLYOFFICE for human edit; headless agents).
- Canonical status: [overview.md](overview.md) (`lp-5q6.39` shipped vs residual).
- Principle skill: sequence verifiable units (small unit, verify, then advance).
- Portal baseline at checkpoint time: vault client previews; BFF vault was read-only; `vault.write` was a placeholder. Most of that path has since shipped on the free track.
