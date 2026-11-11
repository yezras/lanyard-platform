# parse_document — F1 throughput checkpoint (ship order)

**Bead:** `lp-uxy.10.2` (F1) · parent feature `lp-uxy.10` · epic `lp-uxy`  
**Playbook item:** pstack Feature — **throughput checkpoint**  
**Status:** Recorded (2026-08-04) — sequencing only; no host tool or Portal label shipped in this step  
**Depends on:** `lp-uxy.10.1` (F0 HOW + blast radius)  
**Feeds:** `lp-uxy.10.3`–`lp-uxy.10.7` (architect → implement → prove)  
**Related:**

- HOW + blast radius: [`portal-parse-document-anydoc.md`](./portal-parse-document-anydoc.md)
- F2 locked tool contract: [`portal-parse-document-f2-tool-contract.md`](./portal-parse-document-f2-tool-contract.md)
- F3 host tool reference: [`portal-parse-document-f3-host-tool.md`](./portal-parse-document-f3-host-tool.md)
- Tool progress wire: [`portal-chat-tool-events.md`](./portal-chat-tool-events.md)
- Evidence: [`artifacts/ui/lp-uxy.10/`](../../artifacts/ui/lp-uxy.10/)

This checkpoint freezes **delivery order** so later F-steps land with one
verifiable output each. It does **not** implement `parse_document`, Portal
labels, OCR, or E2E proof.

---

## 1. Binding decisions

### D1 — First shippable path is local anydoc on Hermes-Lanyard

| Track | What ships | Blocks v1? |
| --- | --- | --- |
| **First ship** | Host tool `parse_document` on **Hermes-Lanyard** using local `@firecrawl/anydoc` / `firecrawl-anydoc` (MIT, CPU, **$0 SaaS**) | — |
| **Same monorepo wave** | Portal friendly label **"Parsing a document"** + prefer host `tool_label` when present | No — can land in monorepo PR when HL starts dual-emitting `tool_progress` |
| **Sister track** | **Lanyard Agent** parity (same args/result contract from F2) | No — does not block HL first ship |
| **Deferred** | Scanned PDF via Firecrawl Parse OCR (F5) | **No** — v1 ships without paid OCR |

**Rule:** Do not wait on LA or OCR to declare first useful product value. Local
office + text-PDF → Markdown on HL + a readable Portal tool row is enough for
the first pin bump.

### D2 — OCR must not gate local anydoc

- F5 is optional and **cost-gated** (`FIRECRAWL_API_KEY` on host secrets only).
- Without key / policy: fail closed with `unsupported_scanned` or `no_ocr_key`
  (no silent empty Markdown).
- Never put the key on BFF; never commit real keys.
- Live paid Firecrawl calls remain forbidden without an explicit budget-approved key.

### D3 — Portal does not parse customer document bytes

- Portal ships **labels + `tool_progress` UI only** (F4).
- No BFF-side `anydoc` / OCR of customer uploads in this feature.
- Soft-open / document pane remains human preview (non-goal to replace).

### D4 — One verifiable output per later F-step

Reviewers must not require the whole feature to validate a leaf PR. Each
open child bead below lists a single done-when output.

---

## 2. Ship order (ordered)

```text
F0 HOW + blast          ✓ closed (lp-uxy.10.1)
        │
        ▼
F1 throughput (this)    ship order + parallelization locked
        │
        ▼
F2 architect types      ParseDocumentArgs/Result, module ownership
        │
        ├──────────────────────────────┐
        ▼                              ▼
F3 host tool (HL first)         F4 Portal labels (monorepo)
   local anydoc + ACL              "Parsing a document"
   dual-emit tool_progress         + CONTEXT_GATHERING
        │                              │
        │         ┌────────────────────┘
        │         │
        ▼         ▼
F6 prove attach→parse→answer   (needs F3 + F4)
        │
        ├─ F5 OCR (optional, after F3; cost-gated; does not block F6 local path)
        │
        ▼
F7 open PRs + pin notes (monorepo labels/docs; external HL/LA + pin bump)
```

### Ordered table

| Order | Step | Bead | Owner plane | Verifiable output (done when) | Must not include |
| --- | --- | --- | --- | --- | --- |
| 0 | HOW + blast | `lp-uxy.10.1` | Monorepo docs | Discovery note + residual staging fixture filed | Host tool, labels, OCR |
| 1 | Throughput | **`lp-uxy.10.2`** | Monorepo docs | This checkpoint: HL-first, labels parallel, LA sister, OCR deferred | Implementation |
| 2 | Architect | `lp-uxy.10.3` | Monorepo contracts/docs (+ external HL/LA type mirror) | Locked `ParseDocumentArgs` / `ParseDocumentResult`, tool id + alias, truncation + sidecar policy, module paths — see [`portal-parse-document-f2-tool-contract.md`](./portal-parse-document-f2-tool-contract.md) | Runtime anydoc install |
| 3a | Host tool | `lp-uxy.10.4` | **External HL first**; LA sister in same bead or follow-on | Local anydoc converts `.docx` + (`.pptx` or `.xlsx`) + text `.pdf`; path ACL vault+staging; dual-emit running→complete/error | Firecrawl Parse live calls; BFF parse |
| 3b | Portal labels | `lp-uxy.10.5` | Monorepo Portal web | `humanToolActivityLabel` → **Parsing a document**; unit tests; no BFF parse | Host anydoc package (**F4 shipped** in monorepo) |
| 4 | Prove | `lp-uxy.10.7` | Monorepo evidence + pilot pin when available | Attach→send→parse→answer proof; negatives path deny + scanned without key; `artifacts/ui/lp-uxy.10/` | Requiring OCR success |
| 5 | OCR (optional) | `lp-uxy.10.6` | Host + deploy secrets | Escalation only when key+policy; fail closed otherwise | Unblocking local anydoc v1 |
| 6 | PRs / pins | parent F7 / release notes | Monorepo + external | Draft/merge PRs; pin/version when host ships | Swallowing residual staging FS wiring |

**Parallel after F2:** `lp-uxy.10.4` (F3) and `lp-uxy.10.5` (F4) are intentionally
independent once types are locked — different repos/planes.

**Serialization:** F6 waits on F3 **and** F4. F5 waits on F3 only. F5 does **not**
block F6 for the local anydoc happy path.

---

## 3. HL first, LA parity, monorepo labels

| Product surface | Order | Notes |
| --- | --- | --- |
| **Hermes-Lanyard** | **First** host implementation | Pilot pin is `hermes_lanyard` (`compatibility/pins.hermes-lanyard-staging.example.yaml`). Ship tool + anydoc native dep on HL image/gateway; dual-emit `tool_progress` with `tool_target` path. |
| **Portal (monorepo)** | **Same wave as HL emit** | Labels + mapper tests only. Prefer host `tool_label` when present. Can merge monorepo PR even if LA not yet pinned. |
| **Lanyard Agent** | **Sister** after or beside HL | Same F2 contract; do not invent a second args shape. Parity bead work may trail HL pin bump. |
| **Deploy secrets** | F5 only for OCR | Reuse existing `FIRECRAWL_API_KEY` teaching slot (lp-uxy.7); omit from live SM until budget-approved. |

### PR strategy (from parent F7)

1. **External HL PR:** `tools/parse_document` (or skills wrapper) + anydoc package + dual-emit + ACL.
2. **Monorepo PR(s):** F2 types/docs → F4 labels → F6 evidence/docs; secrets docs for OCR slot (no real keys).
3. **External LA PR:** parity when HL lands or shortly after (sister track).
4. **Pin bump notes:** only when host artifact version includes the tool.

---

## 4. Residuals that affect schedule (not F1 scope)

From F0 — still open; **do not** solve in F1:

| Residual | Blocks | Owner later |
| --- | --- | --- |
| Default BFF staging is in-memory fixture (path stamp yes, vault-byte write not offline-proven) | Full F6 attach→parse E2E on pilot topology | Deploy / staging provider + F3 path resolve |
| No `parse_document` on pilot pin `v0.1.0-g7h3` | Live chat proof | F3 external + pin bump |
| Live AWS apply still human-gated | Staging EC2 proof | Ops runbook |

Architect (F2), HL local tool (F3), and Portal labels (F4) may proceed without
closing the staging-fixture residual. F6 must either use a vault-backed staging
topology or document a fixture/mock path with explicit residual.

---

## 5. What F1 explicitly does **not** ship

- Host `parse_document` / anydoc install (F3)
- Locked production types beyond parent design sketch (F2 owns lock)
- Portal `humanToolActivityLabel` map entry (F4)
- Firecrawl Parse OCR or live paid calls (F5)
- Attach→parse→answer screenshots (F6)
- Pin/version bump (F3/F7)

---

## 6. Costs (unchanged; restate for ship gate)

| Path | Cost | Ship gate |
| --- | --- | --- |
| Local anydoc | **$0 SaaS** | Required for first ship |
| Portal labels | $0 | Required for first *visible* ship |
| Firecrawl Parse OCR | Paid | Optional F5; never required for F1–F4 or local F6 |

---

## 7. F1 acceptance checklist

| Criterion (this step) | Result |
| --- | --- |
| Record ship order: HL local anydoc first | Done — D1 + §2–§3 |
| Portal labels in same monorepo wave when HL emits | Done — D1 / 3b parallel after F2 |
| LA parity as sister (not gate) | Done — D1 + §3 |
| OCR deferred; does not block v1 | Done — D2 |
| Checkpoint durable in monorepo + parent notes | This file + `artifacts/ui/lp-uxy.10/f1-throughput-checkpoint.json` + parent `lp-uxy.10` notes |
| Later F-steps not swallowed | F2–F7 remain open implementation beads |

---

## Changelog

| Date | Note |
| --- | --- |
| 2026-08-04 | Initial F1 throughput checkpoint (`lp-uxy.10.2`) from parent design + F0 residuals. |
