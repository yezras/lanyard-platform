# parse_document — F5 scanned PDF OCR (Firecrawl Parse cost-gate)

**Bead:** `lp-uxy.10.6` (F5) · parent feature `lp-uxy.10` · epic `lp-uxy`  
**Playbook item:** pstack Feature — **scanned PDF escalation (optional, cost-gated)**  
**Status:** Reference implementation shipped in monorepo (2026-08-04)  
**Depends on:** `lp-uxy.10.4` (F3 host local anydoc)  
**Feeds:** `lp-uxy.10.7` (F6 prove — negative scanned without key)  
**Related:**

- F2 contract: [`portal-parse-document-f2-tool-contract.md`](./portal-parse-document-f2-tool-contract.md)
- F3 host tool: [`portal-parse-document-f3-host-tool.md`](./portal-parse-document-f3-host-tool.md)
- Web search cost gate (same key slot): [`portal-web-search-firecrawl.md`](./portal-web-search-firecrawl.md)
- Secrets envelope: [`backend-runtime-secrets.md`](./backend-runtime-secrets.md)
- Reference code: [`contracts/backend-runtime-v1/reference/tools/parse_document/`](../../contracts/backend-runtime-v1/reference/tools/parse_document/)
- Evidence: [`artifacts/ui/lp-uxy.10/f5-scanned-ocr-cost-gate.json`](../../artifacts/ui/lp-uxy.10/f5-scanned-ocr-cost-gate.json)

---

## 1. What F5 ships

| Deliverable | Location |
| --- | --- |
| Cost-gated OCR escalation in host tool | `parse_document_tool.py` — `force_ocr` / `auto_ocr` + `allow_ocr` + live key |
| Firecrawl Parse upload client (stdlib) | `firecrawl_parse_upload` → `POST {api_base}/parse` multipart |
| Fail-closed error codes | `unsupported_scanned`, `no_ocr_key`, `parse_failed` |
| Offline unit tests (injected OCR; **no network**) | `test_parse_document_tool.py` F5 class |
| HL wiring sketch | `hermes_register_snippet.py` — `PARSE_DOCUMENT_ALLOW_OCR` / `AUTO_OCR` |
| Deploy secret comment | `deploy/litellm/env.secrets.example` — dual use web + OCR |
| This note + evidence JSON | docs + `artifacts/ui/lp-uxy.10/` |

**Plane:** host agent only (HL/LA). Portal remains labels-only (F4). **Never** put `FIRECRAWL_API_KEY` on BFF. **Never** commit real keys.

---

## 2. Product behaviour

```text
local anydoc.to_markdown_bytes
  ├─ success text → parser: anydoc (F3) — $0 SaaS
  └─ unsupported / empty PDF (scanned)
        ├─ no force_ocr and (not auto_ocr or policy not ready)
        │     → error_code: unsupported_scanned
        ├─ force_ocr (or auto_ocr when ready) but allow_ocr=false
        │     → error_code: no_ocr_key  (processor/budget not approved)
        ├─ OCR wanted but key missing / placeholder
        │     → error_code: no_ocr_key
        └─ allow_ocr + live FIRECRAWL_API_KEY
              → POST Firecrawl /v2/parse (PDF mode=ocr)
                    ├─ markdown → parser: firecrawl_parse (paid)
                    └─ API/empty fail → parse_failed
```

### Triggers

| Trigger | Meaning |
| --- | --- |
| `force_ocr: true` (tool arg) | Explicitly request OCR path after local anydoc fails scanned |
| `auto_ocr: true` (host config) | Auto escalate scanned PDFs **only when** `allow_ocr` + live key |

`auto_ocr` without a live key stays at `unsupported_scanned` (does **not** spam `no_ocr_key` on every scan). `force_ocr` without policy/key always returns `no_ocr_key`.

### Gates (all required for live paid call)

| Gate | Source | Default |
| --- | --- | --- |
| `allow_ocr` | Host config / `PARSE_DOCUMENT_ALLOW_OCR` | **false** |
| Live `FIRECRAWL_API_KEY` | Host secrets envelope (SM materialize) | omitted / placeholder in git |
| Not a placeholder | `is_live_firecrawl_key` rejects `fc-placeholder-…`, `unused`, `replace-me`, … | — |

### Key hygiene

- Reuse the same env slot as lp-uxy.7 web crawl/scrape.
- Git templates keep `fc-placeholder-firecrawl-unused`.
- Live SM **omits** the key until budget sign-off.
- Placeholder keys never open an HTTP request.

### API (reference client)

```http
POST https://api.firecrawl.dev/v2/parse
Authorization: Bearer <FIRECRAWL_API_KEY>
Content-Type: multipart/form-data

options={"formats":["markdown"],"parsers":[{"type":"pdf","mode":"ocr"}]}
file=<bytes; filename=…>
```

Stdlib `urllib` only — no Firecrawl SDK required on the reference path. Hosts may inject `firecrawl_parse=` for tests or alternate clients.

Success result:

```json
{
  "markdown": "# OCR body\n\n…",
  "format": "pdf",
  "parser": "firecrawl_parse",
  "chars": 1234,
  "truncated": false,
  "sidecar_path": "/staging/uploads/_inbox/scan.parse.md"
}
```

---

## 3. Costs

| Path | Cost | When |
| --- | --- | --- |
| Local anydoc | **$0 SaaS** (host CPU) | Always preferred first |
| Firecrawl Parse OCR | **Paid** (per page / plan) | F5 only; gates above |
| Portal labels | $0 | F4 |

Monorepo CI and `scripts/validate.sh` run **offline** with an injected mock parse — **zero** live Firecrawl calls.

---

## 4. Deploy / operator checklist

1. **Do not** enable OCR until budget approved.
2. Materialize live `FIRECRAWL_API_KEY` into host `$BACKEND_HOME/.env.secrets` (mode `0600`) — same path as web tools.
3. Set on agent host only:
   - `PARSE_DOCUMENT_ALLOW_OCR=true` (processor approved)
   - optional `PARSE_DOCUMENT_AUTO_OCR=true` (auto escalate scanned)
4. Confirm key is **not** present on Portal BFF env.
5. Prefer `force_ocr` from the model only when the user/task needs scanned content; auto policy is opt-in.

---

## 5. What F5 does **not** ship

| Residual | Owner later |
| --- | --- |
| Live attach→parse→OCR browser proof | F6 (`lp-uxy.10.7`) |
| External HL/LA product pin bump with OCR flags | F7 |
| Second OCR stack / focr at chat turn | Non-goal |
| BFF-side parse of customer bytes | Forbidden |

---

## 6. Tests / validation

```bash
python3 contracts/backend-runtime-v1/reference/tools/parse_document/test_parse_document_tool.py
bash scripts/validate.sh
```

Offline coverage includes: placeholder key rejected; `allow_ocr=false` → `no_ocr_key`; force + live key → `parser=firecrawl_parse` + dual-emit complete; auto without key → `unsupported_scanned`; API failure → `parse_failed`; local anydoc success never calls OCR.

---

## 7. F5 acceptance checklist

| Criterion (this step) | Result |
| --- | --- |
| On anydoc unsupported → OCR only if force_ocr **or** auto_policy + key | Done |
| Fail closed when no key / processor not approved | Done — `no_ocr_key` / `unsupported_scanned` |
| Never put key on BFF | Done — host config + docs only |
| No live paid calls without live key | Done — placeholder rejection + default allow_ocr=false |
| `parser: "firecrawl_parse"` on OCR success | Done |
| Costs documented | Done — this file + evidence |
| Evidence + docs | This file + `f5-scanned-ocr-cost-gate.json` |
| Later F-steps not swallowed | F6–F7 remain open |

---

## Changelog

| Date | Note |
| --- | --- |
| 2026-08-04 | F5 cost-gated Firecrawl Parse OCR in monorepo reference tool (`lp-uxy.10.6`). |
