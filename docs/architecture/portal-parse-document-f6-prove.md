# parse_document — F6 prove attach → parse → answer

**Bead:** `lp-uxy.10.7` (F6) · parent feature `lp-uxy.10` · epic `lp-uxy`  
**Playbook item:** pstack Feature — **prove it works**  
**Status:** Offline monorepo proof shipped (2026-08-04); live pilot pin residual → F7  
**Depends on:** `lp-uxy.10.4` (F3 host tool), `lp-uxy.10.5` (F4 Portal labels)  
**Related:**

- F3 host: [`portal-parse-document-f3-host-tool.md`](./portal-parse-document-f3-host-tool.md)
- F4 labels: [`portal-parse-document-f4-portal-labels.md`](./portal-parse-document-f4-portal-labels.md)
- F2 contract: [`portal-parse-document-f2-tool-contract.md`](./portal-parse-document-f2-tool-contract.md)
- Tool events: [`portal-chat-tool-events.md`](./portal-chat-tool-events.md)
- Evidence: [`artifacts/ui/lp-uxy.10/`](../../artifacts/ui/lp-uxy.10/)
- Story: `/?story=parse-document`

---

## 1. What F6 proves

| Layer | Proof |
| --- | --- |
| Host tool | Attach-shaped paths under staging/vault → `parse_document` → Markdown with unique markers |
| Dual-emit | `tool_progress` **running → complete/error** with `tool_target` + `tool_label` **Parsing a document** |
| Model answer | Tool result channel contains markers so an answer can cite document content |
| Path ACL | Paths outside vault/staging → `path_denied` (error emit, no silent empty success) |
| Scanned PDF | Empty/image PDF without OCR key → `unsupported_scanned` (or `no_ocr_key` with `force_ocr`) |
| Portal UI | Auth-free story shows attach stamp, tool rows, answer markers, negatives |
| Cost | Local anydoc **$0 SaaS**; **no** live `FIRECRAWL_API_KEY` / paid OCR in this proof |

**Boundary (unchanged):** Portal does **not** parse customer document bytes on the BFF. Soft-open remains human preview only.

---

## 2. Deliverables

| Deliverable | Path |
| --- | --- |
| Host prove harness | `contracts/backend-runtime-v1/reference/tools/parse_document/prove_parse_document_f6.py` |
| Portal story | `portal/packages/web/src/features/chat/ParseDocumentProofStory.tsx` |
| RTL tests | `ParseDocumentProofStory.test.tsx` |
| Story mount | `/?story=parse-document` via `portal/packages/web/src/main.tsx` |
| This note | `docs/architecture/portal-parse-document-f6-prove.md` |
| Evidence JSON | `artifacts/ui/lp-uxy.10/f6-prove-attach-parse-answer.json` |
| Screenshots (when captured) | `artifacts/ui/lp-uxy.10/f6-*.png` |

---

## 3. How to re-run

```bash
# Host attach→parse→answer + negatives (offline; live anydoc when installed)
python3 contracts/backend-runtime-v1/reference/tools/parse_document/prove_parse_document_f6.py

# Optional: install local anydoc for real docx/pdf conversion ($0 SaaS, no network API)
python3 -m venv /tmp/anydoc-venv
/tmp/anydoc-venv/bin/pip install -r \
  contracts/backend-runtime-v1/reference/tools/parse_document/requirements.txt
/tmp/anydoc-venv/bin/python \
  contracts/backend-runtime-v1/reference/tools/parse_document/prove_parse_document_f6.py

# Portal RTL story
cd portal/packages/web
pnpm exec vitest run src/features/chat/ParseDocumentProofStory.test.ts

# Browser story (dev server)
# open http://localhost:5173/?story=parse-document

bash scripts/validate.sh
```

### Markers (shared host + story)

| Fixture | Marker |
| --- | --- |
| sample.docx | `LANYARD_F6_DOCX_Q3_REVENUE_MARKER` |
| sample.pdf (text layer) | `LANYARD_F6_PDF_POLICY_MARKER` |

---

## 4. Acceptance mapping (F6)

| Criterion | Evidence |
| --- | --- |
| Attach sample.docx + text PDF; tool row + model cites content | prove harness + story answer panel |
| Story or mocklab UI QA under `artifacts/ui/` | `f6-prove-attach-parse-answer.json` + story + optional PNGs |
| Negative: path outside tree denied | `path_denied` dual-emit error |
| Negative: scanned PDF without key errors cleanly | `unsupported_scanned` / `no_ocr_key` |
| Portal label **Parsing a document** | F4 map exercised by story + RTL |
| No BFF parse / no live paid OCR | `data-bff-parse="false"` / `data-cost-gated="true"` |

---

## 5. Residuals (explicit)

| Residual | Owner |
| --- | --- |
| External HL/LA product pin ships tool on pilot | F7 (`lp-uxy.10.8`) |
| Live mocklab against real agent host + vault FS bytes | F7 / deploy topology |
| Firecrawl Parse OCR happy path | F5 (`lp-uxy.10.6`) cost-gated |

F6 is **done** when offline host prove + Portal story/RTL pass and evidence is committed. Live pilot chat is gated on F7 pin bump, not on re-opening F3/F4.
