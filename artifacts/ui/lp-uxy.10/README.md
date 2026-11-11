# lp-uxy.10 — parse_document (Firecrawl AnyDoc)

**Parent feature:** `lp-uxy.10`  
**This directory:** discovery + later UI/QA evidence  
**F0 step bead:** `lp-uxy.10.1` (how + blast radius)  
**F1 step bead:** `lp-uxy.10.2` (throughput checkpoint / ship order)  
**F2 step bead:** `lp-uxy.10.3` (architect tool args / result)  
**F3 step bead:** `lp-uxy.10.4` (host tool local anydoc)  
**F4 step bead:** `lp-uxy.10.5` (Portal label + tool_progress UI)  
**F5 step bead:** `lp-uxy.10.6` (scanned OCR Firecrawl Parse cost-gate)  
**F6 step bead:** `lp-uxy.10.7` (prove attach→parse→answer)  
**Date:** 2026-08-04

## F0 — HOW + blast radius

| Artifact | Role |
| --- | --- |
| `f0-blast-radius.json` | Machine-readable discovery summary + residuals |
| [`docs/architecture/portal-parse-document-anydoc.md`](../../../docs/architecture/portal-parse-document-anydoc.md) | Normative HOW / costs / blast radius |

### What F0 proves (offline, monorepo)

1. Portal already routes structured `tool_progress` (running → complete/error) and
   durable history for any host tool id — including a future `parse_document`.
2. Staging attach → send stamps vault-absolute `/staging/uploads/…` paths into the
   user message (`[staging uploads]` block); soft-open remains human preview only.
3. AnyDoc (MIT) is the local primary converter; focr remains offline worker OCR.
4. **Residual:** default BFF staging store is in-memory fixture — agent **path**
   visibility is proven; **byte** readability on pilot vault FS is **not** proven
   offline and must be closed by deploy/provider wiring before F6 E2E.

### What F0 does **not** ship

- Host `parse_document` implementation (F3 / external HL+LA)
- Portal label `"Parsing a document"` (F4 — **shipped**; see F4 section)
- Firecrawl Parse OCR (F5, cost-gated)
- Live attach → parse → answer screenshots (F6)

## F1 — Throughput checkpoint (ship order)

| Artifact | Role |
| --- | --- |
| `f1-throughput-checkpoint.json` | Machine-readable ship order + binding decisions |
| [`docs/architecture/portal-parse-document-f1-throughput-checkpoint.md`](../../../docs/architecture/portal-parse-document-f1-throughput-checkpoint.md) | Normative F1 sequence |

### Binding order (summary)

1. **HL local anydoc first** (pilot pin kind `hermes_lanyard`).
2. **Portal labels** in the same monorepo wave when HL dual-emits `tool_progress`.
3. **LA parity** as sister track (same F2 contract; not a gate on HL first ship).
4. **OCR deferred** — F5 cost-gated; does **not** block local anydoc v1 or F6 happy path.

After F2 locks types, **F3 (host) ∥ F4 (labels)**. F6 needs both. F5 optional after F3.

### What F1 does **not** ship

- Host tool, Portal label map, OCR, E2E screenshots, pin bump (F2–F7).

### Cost gate

No live `FIRECRAWL_API_KEY` calls. Local anydoc is $0 SaaS; OCR remains paid and
optional.

## F2 — Architect tool args / result

| Artifact | Role |
| --- | --- |
| `f2-architect-tool-args-result.json` | Machine-readable locked Args/Result + ownership |
| [`docs/architecture/portal-parse-document-f2-tool-contract.md`](../../../docs/architecture/portal-parse-document-f2-tool-contract.md) | Normative F2 contract |
| `contracts/backend-runtime-v1/examples/parse-document.*.json` | Example args / success / error payloads |

### Locked (summary)

| Item | Value |
| --- | --- |
| Tool id | `parse_document` (alias `extract_document_text`) |
| Default `max_chars` | `48000` (clamp `[1000, 200000]`) |
| Sidecar | default on → `<stem>.parse.md` (soft-fail write) |
| Path ACL | vault profile roots + `/staging/uploads` |
| Portal label | **Parsing a document** (F4 maps; host may emit `tool_label`) |
| Host module | external `tools/parse_document` (F3) |

### What F2 does **not** ship

- Runtime anydoc install / host tool (F3)
- Portal label map code (F4 — **shipped**; see F4 section)
- OCR / E2E / pin bump (F5–F7)

## F3 — Host tool local anydoc

| Artifact | Role |
| --- | --- |
| `f3-host-tool-local-anydoc.json` | Machine-readable F3 delivery + acceptance |
| [`docs/architecture/portal-parse-document-f3-host-tool.md`](../../../docs/architecture/portal-parse-document-f3-host-tool.md) | F3 behaviour + integration checklist |
| [`contracts/backend-runtime-v1/reference/tools/parse_document/`](../../../contracts/backend-runtime-v1/reference/tools/parse_document/) | Portable tool + tests + `firecrawl-anydoc` pin |

### What F3 proves (offline monorepo)

1. Reference `parse_document` / `extract_document_text` implements F2 Args/Result.
2. Path ACL (vault + `/staging/uploads`), truncation, sidecar, dual-emit progress.
3. Live anydoc converts minimal `.docx`, `.xlsx`, text `.pdf` when package installed.
4. Scanned/empty PDF fails closed (`unsupported_scanned` / `no_ocr_key`); no paid OCR.

### What F3 does **not** ship

- Portal label map (F4 — **shipped**; see F4 section)
- Firecrawl Parse OCR (F5)
- Live attach→parse UI proof (F6)
- External HL/LA product pin bump (F7) — monorepo holds the normative reference

## F4 — Portal labels + tool_progress UI

| Artifact | Role |
| --- | --- |
| `f4-portal-labels.json` | Machine-readable F4 acceptance + validation |
| [`docs/architecture/portal-parse-document-f4-portal-labels.md`](../../../docs/architecture/portal-parse-document-f4-portal-labels.md) | Normative F4 note |
| `portal/packages/web/src/features/chat/chatToolCallMapper.ts` | Label map + CONTEXT_GATHERING |
| `portal/packages/web/src/features/chat/chatToolCallMapper.test.ts` | Unit tests (35 pass including F4 cases) |

### Shipped (summary)

| Item | Value |
| --- | --- |
| `parse_document` | **Parsing a document** |
| `extract_document_text` | **Parsing a document** |
| Host `tool_label` | Preferred when human activity language |
| CONTEXT_GATHERING | Both ids + friendly **"Parsing a document"** |
| BFF parse | **None** — labels only |

### What F4 does **not** ship

- Host anydoc / dual-emit on pilot pin (F3 — **shipped** on main as monorepo reference)
- OCR (F5 — **shipped** as cost-gate; see F5 section); attach→parse→answer screenshots (F6)

## F5 — Scanned PDF OCR cost-gate (Firecrawl Parse)

| Artifact | Role |
| --- | --- |
| `f5-scanned-ocr-cost-gate.json` | Machine-readable F5 gates + acceptance |
| [`docs/architecture/portal-parse-document-f5-scanned-ocr.md`](../../../docs/architecture/portal-parse-document-f5-scanned-ocr.md) | Normative F5 cost-gate |
| `contracts/.../parse_document/parse_document_tool.py` | OCR escalation + fail-closed |
| `contracts/.../examples/parse-document.result.ocr.json` | Example `parser: firecrawl_parse` result |

### Shipped (summary)

| Item | Value |
| --- | --- |
| Escalation | anydoc unsupported/empty PDF → OCR if `force_ocr` **or** (`auto_ocr` + policy ready) |
| Gates | `allow_ocr` + live `FIRECRAWL_API_KEY` (placeholders rejected) |
| Success parser | `firecrawl_parse` |
| Fail closed | `unsupported_scanned` / `no_ocr_key` / `parse_failed` |
| Live paid in CI | **false** — injected mock only |
| BFF key | **never** |

### What F5 does **not** ship

- Browser attach→parse→OCR proof (F6)
- External HL/LA pin bump with env flags (F7)
- OCR (F5); attach→parse→answer screenshots (F6 — **shipped** offline proof)

## F6 — Prove attach → parse → answer

| Artifact | Role |
| --- | --- |
| `f6-prove-attach-parse-answer.json` | Machine-readable host prove + acceptance |
| [`docs/architecture/portal-parse-document-f6-prove.md`](../../../docs/architecture/portal-parse-document-f6-prove.md) | Normative F6 note |
| `ParseDocumentProofStory.tsx` | Auth-free `?story=parse-document` |
| `prove_parse_document_f6.py` | Offline host attach→parse→answer + negatives |
| `f6-*.png` (optional) | Browser screenshots of the story |

### What F6 proves (offline monorepo)

1. Staging attach paths → `parse_document` → Markdown markers for docx + text PDF.
2. Dual-emit running→complete/error; Portal label **Parsing a document**.
3. Simulated model answer cites both markers.
4. Negatives: `path_denied` outside ACL; `unsupported_scanned` / `no_ocr_key` without OCR.
5. No BFF parse; no live paid Firecrawl OCR.

### What F6 does **not** ship

- External HL/LA pilot pin bump (F7)
- Live Firecrawl Parse OCR happy path (F5)
- Live mocklab against real agent host vault FS (residual until pin ships)

## Later evidence (F7)

| Expected | Owner step |
| --- | --- |
| Pin / version when host tool ships on pilot | F7 |
| Live mocklab attach→parse against real host | F7 / deploy |
