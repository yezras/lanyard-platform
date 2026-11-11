# parse_document — F3 host tool (local AnyDoc)

**Bead:** `lp-uxy.10.4` (F3) · parent feature `lp-uxy.10` · epic `lp-uxy`  
**Playbook item:** pstack Feature — **implement host tool (local anydoc)**  
**Status:** Reference implementation shipped in monorepo (2026-08-04); external HL/LA product copy + pin bump follow F7  
**Depends on:** `lp-uxy.10.3` (F2 locked contract)  
**Feeds:** `lp-uxy.10.5` (F4 labels parallel), `lp-uxy.10.6` (F5 OCR), `lp-uxy.10.7` (F6 prove)  
**Related:**

- F2 contract: [`portal-parse-document-f2-tool-contract.md`](./portal-parse-document-f2-tool-contract.md)
- F1 ship order: [`portal-parse-document-f1-throughput-checkpoint.md`](./portal-parse-document-f1-throughput-checkpoint.md)
- F0 HOW: [`portal-parse-document-anydoc.md`](./portal-parse-document-anydoc.md)
- Tool progress wire: [`portal-chat-tool-events.md`](./portal-chat-tool-events.md)
- Reference code: [`contracts/backend-runtime-v1/reference/tools/parse_document/`](../../contracts/backend-runtime-v1/reference/tools/parse_document/)
- Evidence: [`artifacts/ui/lp-uxy.10/f3-host-tool-local-anydoc.json`](../../artifacts/ui/lp-uxy.10/f3-host-tool-local-anydoc.json)

---

## 1. What F3 ships

| Deliverable | Location |
| --- | --- |
| Portable host tool logic | `contracts/backend-runtime-v1/reference/tools/parse_document/parse_document_tool.py` |
| Offline + optional live anydoc tests | `…/test_parse_document_tool.py` |
| Agent image dep pin | `…/requirements.txt` → `firecrawl-anydoc>=0.1.2,<0.2` |
| HL register sketch | `…/hermes_register_snippet.py` |
| This note + evidence JSON | docs + `artifacts/ui/lp-uxy.10/` |

**Owner plane (F2 T10):** external Hermes-Lanyard first; Lanyard Agent sister. The monorepo holds the **normative reference** so HL/LA copy the same Args/Result without inventing a second shape (ADR 0002 — backends remain external products).

---

## 2. Behaviour (implements F2)

### Tool identity

- `parse_document` (canonical) and `extract_document_text` (alias)
- Default `tool_label`: **Parsing a document** (Portal hard-map lands in F4)

### Args / result

Matches locked F2 types:

- `path` required absolute under vault roots **or** `/staging/uploads`
- `max_chars` default `48000`, clamp `[1000, 200000]`, pure code-point slice
- `write_sidecar` default `true` → `<stem>.parse.md` full text (soft-fail)
- `force_ocr` accepted but **not** live in F3 — scanned/empty PDF → `unsupported_scanned`; with `force_ocr` and no host key → `no_ocr_key`
- Success: `parser: "anydoc"`, `markdown`, `format`, `chars`, `truncated`, optional `sidecar_path`
- Errors: stable `error_code` (no silent empty success for office/PDF)

### Path ACL

Allowed roots = configured vault profile roots ∪ staging root (default `/staging/uploads`).

Refuse:

- Relative paths
- Lexical `..` escape outside roots
- Symlink chains that leave roots
- Missing paths, non-regular files
- Source size &gt; 25 MiB → `too_large`

### Dual-emit `tool_progress`

Every invocation emits at least:

1. `tool_status: "running"` with `tool_target` = path and `tool_label` = "Parsing a document"
2. Terminal `complete` or `error` (structured JSON `ParseDocumentResult` preferred in `result`)

Hosts that already dual-emit for all tools via the agent loop still benefit from explicit `tool_target` / `tool_label` when the progress callback is wired; the reference module always produces the pair when `progress=` is passed.

### Local converter

```text
pip install 'firecrawl-anydoc>=0.1.2,<0.2'
import anydoc
md = anydoc.to_markdown_bytes(data)   # content-based format detection
```

Proven offline in unit tests (when package installed):

| Fixture | Result |
| --- | --- |
| Minimal `.docx` | Markdown contains source text |
| Minimal `.xlsx` | Markdown table includes cell text |
| Text-layer `.pdf` | Markdown contains PDF string |
| Unrecognized binary | `unsupported_format` or `parse_failed` (not empty success) |

**Cost:** local CPU only — **$0 SaaS**. No live Firecrawl HTTP in F3.

---

## 3. Product integration checklist

### Hermes-Lanyard (first ship)

1. Vendor/copy `parse_document_tool.py` → `tools/parse_document.py` (or importable package path).
2. `registry.register` both tool ids (see `hermes_register_snippet.py`).
3. Pass `VAULT_ROOT` (and profile path_prefixes) + staging root into `ParseDocumentConfig`.
4. Install `firecrawl-anydoc` on the agent image / gateway env (native wheel).
5. Confirm Portal dual-emit path carries `tool_target` for this tool (generic host loop or explicit progress hook).
6. Pin/version note when the host artifact includes the tool (F7).

### Lanyard Agent (sister)

1. Add `parse_document` (+ alias) to the v1 tool allowlist / registry.
2. Implement with `@firecrawl/anydoc` `toMarkdownBytes` using the **same** JSON Args/Result.
3. Reuse sandbox vault_root + staging ACL semantics from this reference.
4. Dual-emit via existing `portal-telemetry` / adapter `sendToolProgress`.

### Portal / deploy (not this bead)

| Surface | Step |
| --- | --- |
| Friendly label map | F4 (`lp-uxy.10.5`) |
| `FIRECRAWL_API_KEY` live OCR | F5 (`lp-uxy.10.6`) — never BFF |
| Attach→parse proof | F6 (`lp-uxy.10.7`) |

---

## 4. Residuals (explicit)

| Residual | Impact | Owner later |
| --- | --- | --- |
| Reference lives in monorepo; pilot pin `v0.1.0-g7h3` does not yet ship the tool | Live chat needs external HL PR + pin bump | F7 / product release |
| Default BFF staging fixture is in-memory | Attach path stamps may not materialize vault bytes offline | Deploy + F6 topology |
| OCR escalation | F5 cost-gate shipped in monorepo reference | `lp-uxy.10.6` — see [`portal-parse-document-f5-scanned-ocr.md`](./portal-parse-document-f5-scanned-ocr.md) |

F3 **does not** require closing staging-fixture residual or pin bump to be done; it ships the implementable tool + proof of local conversion + ACL + dual-emit.

---

## 5. Tests / validation

```bash
# Offline (injected converter always; live anydoc skipped if missing)
python3 contracts/backend-runtime-v1/reference/tools/parse_document/test_parse_document_tool.py

# Full suite including live anydoc
python3 -m venv /tmp/anydoc-venv
/tmp/anydoc-venv/bin/pip install -r \
  contracts/backend-runtime-v1/reference/tools/parse_document/requirements.txt
/tmp/anydoc-venv/bin/python \
  contracts/backend-runtime-v1/reference/tools/parse_document/test_parse_document_tool.py

bash scripts/validate.sh
```

---

## 6. F3 acceptance checklist

| Criterion (this step) | Result |
| --- | --- |
| Host tool module with anydoc path | Done — reference `parse_document_tool.py` + requirements |
| Path ACL vault + staging; refuse escape | Done — unit tests path deny / `..` / missing |
| Dual-emit running→complete/error with `tool_target` | Done — progress callback + tests |
| Local convert docx + (pptx\|xlsx) + text pdf | Done — live anydoc tests for docx, xlsx, text pdf |
| Truncation + sidecar policy | Done — tests for max_chars + `.parse.md` full text |
| Scanned / empty PDF not silent success | Done — `unsupported_scanned` / `no_ocr_key` |
| No live paid OCR / no BFF parse | Done — F5 deferred; no BFF code |
| Evidence + docs | This file + `artifacts/ui/lp-uxy.10/f3-host-tool-local-anydoc.json` |
| Later F-steps not swallowed | F4–F7 remain open |

---

## Changelog

| Date | Note |
| --- | --- |
| 2026-08-04 | F3 reference host tool + tests + docs (`lp-uxy.10.4`). |
