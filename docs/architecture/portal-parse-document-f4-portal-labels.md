# parse_document — F4 Portal labels + tool_progress UI

**Feature:** `lp-uxy.10`  
**Step bead:** `lp-uxy.10.5`  
**Date:** 2026-08-04  
**Status:** Complete (Portal monorepo labels only)

## Scope

Map host document-parse tool ids to a friendly ChatToolCalls activity label and
include them in context-gathering collapse. **No BFF-side parse** of customer
files; no host anydoc install (that is F3).

| Item | Value |
| --- | --- |
| Canonical tool id | `parse_document` |
| Documented alias | `extract_document_text` |
| Friendly label | **Parsing a document** |
| Prefer host | `tool_label` when it is already human activity language |
| CONTEXT_GATHERING | Both ids included so multi-read batches collapse |

## Implementation

| Surface | Path | Change |
| --- | --- | --- |
| Label map | `portal/packages/web/src/features/chat/chatToolCallMapper.ts` | `humanToolActivityLabel` → **Parsing a document** for both ids (+ MCP bare key) |
| Host label verbs | same file `isHumanActivityHostLabel` | Recognize leading **Parsing…** as activity chrome |
| Collapse set | `CONTEXT_GATHERING_NAME_RE` | `parse_document` \| `extract_document_text` |
| Display collapse | `isContextGatheringTool` | Friendly **"Parsing a document"** / `parsing …` prefixes |
| Unit tests | `chatToolCallMapper.test.ts` | Labels, `mapToolCallFields` lifecycle, collapse |
| tool_progress UI | Existing `mapToolCallFields` + ChatTimeline | No new chrome — dual-emit running/complete/error already works for any tool id |

### Boundary (non-goals for F4)

- **No** Portal BFF `to_markdown` / anydoc / Firecrawl Parse of customer bytes.
- **No** host tool implementation (F3 external HL/LA).
- **No** OCR key or deploy secret changes (F5).
- **No** live attach → parse → answer proof (F6 — see `portal-parse-document-f6-prove.md`).

## Prefer host `tool_label`

When Hermes-Lanyard / Lanyard Agent dual-emits:

```json
{
  "type": "tool_progress",
  "tool_name": "parse_document",
  "tool_label": "Parsing a document",
  "tool_target": "/staging/uploads/…/report.pdf",
  "tool_status": "running"
}
```

Portal keeps the host label when it passes `isHumanActivityHostLabel` (e.g.
**Parsing a document**, **Parsing report.pdf**). Technical-only labels
(`parse_document`) fall through to the monorepo map so the row never shows a
raw snake_case id.

## Acceptance (this step)

| Criterion | Result |
| --- | --- |
| Map `parse_document` → Parsing a document | Done |
| Map `extract_document_text` → same | Done |
| Prefer host `tool_label` when human | Done (existing hostLabel path + `parsing` verb) |
| Unit tests on mapper | Done (`chatToolCallMapper.test.ts`) |
| No BFF parse of customer files | Confirmed — labels only |
| Evidence under `artifacts/ui/lp-uxy.10/` | `f4-portal-labels.json` |

## Related

- F0 HOW: [`portal-parse-document-anydoc.md`](./portal-parse-document-anydoc.md)
- F1 ship order: [`portal-parse-document-f1-throughput-checkpoint.md`](./portal-parse-document-f1-throughput-checkpoint.md)
- F2 contract: [`portal-parse-document-f2-tool-contract.md`](./portal-parse-document-f2-tool-contract.md)
- Tool events: [`portal-chat-tool-events.md`](./portal-chat-tool-events.md) § Document parse
- Evidence: [`artifacts/ui/lp-uxy.10/`](../../artifacts/ui/lp-uxy.10/)
