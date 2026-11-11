# parse_document — host tool reference (F3 + F5)

**Beads:** `lp-uxy.10.4` (F3 local anydoc) · `lp-uxy.10.6` (F5 OCR cost-gate)  
**Parent:** `lp-uxy.10` · epic `lp-uxy`  
**Contract:** [`docs/architecture/portal-parse-document-f2-tool-contract.md`](../../../../../docs/architecture/portal-parse-document-f2-tool-contract.md)  
**F3 note:** [`docs/architecture/portal-parse-document-f3-host-tool.md`](../../../../../docs/architecture/portal-parse-document-f3-host-tool.md)  
**F5 note:** [`docs/architecture/portal-parse-document-f5-scanned-ocr.md`](../../../../../docs/architecture/portal-parse-document-f5-scanned-ocr.md)

Portable host agent tool:

| Item | Value |
| --- | --- |
| Canonical tool id | `parse_document` |
| Alias | `extract_document_text` |
| Primary parser | Firecrawl AnyDoc (`firecrawl-anydoc` / `@firecrawl/anydoc`) — **$0 SaaS** |
| OCR parser | Firecrawl Parse hosted API (`parser: "firecrawl_parse"`) — **paid, cost-gated** |
| Path ACL | Vault profile roots ∪ `/staging/uploads` (refuse escape) |
| Dual-emit | `tool_progress` running → complete/error via progress callback |
| Sidecar | `<stem>.parse.md` (default on; soft-fail) |
| OCR default | **Off** — `allow_ocr=false`; no live calls without live key |

## Layout

| File | Role |
| --- | --- |
| `parse_document_tool.py` | Normative logic + OCR client + OpenAI-style schemas + handler factory |
| `test_parse_document_tool.py` | Offline ACL/progress/F5 cost-gate tests; live anydoc when installed |
| `requirements.txt` | `firecrawl-anydoc` pin for agent images |
| `hermes_register_snippet.py` | Example HL `registry.register` + OCR env flags |
| `hermes_register_snippet.py` | Example HL `registry.register` wiring (not imported by HL by default) |
| `prove_parse_document_f6.py` | F6 attach→parse→answer + ACL/scanned negatives (writes evidence JSON) |

## Install (agent host / image)

```bash
pip install -r contracts/backend-runtime-v1/reference/tools/parse_document/requirements.txt
# or: pip install 'firecrawl-anydoc>=0.1.2'
```

Node hosts (Lanyard Agent sister track) use `@firecrawl/anydoc` and mirror the
same Args/Result JSON shape — do not invent a second contract.

## OCR cost gate (F5)

Live paid OCR requires **all** of:

1. Host env `FIRECRAWL_API_KEY` that is **not** a git placeholder
2. `PARSE_DOCUMENT_ALLOW_OCR=true` (or `ParseDocumentConfig.allow_ocr=True`)
3. Escalation trigger: tool arg `force_ocr=true` **or** `PARSE_DOCUMENT_AUTO_OCR=true`

Fail closed:

| Situation | `error_code` |
| --- | --- |
| Scanned PDF, no force/auto | `unsupported_scanned` |
| force_ocr but no policy/key | `no_ocr_key` |
| OCR HTTP / empty body | `parse_failed` |

**Never** put the key on Portal BFF. Reuse the lp-uxy.7 secrets slot.

## Run tests (offline)

```bash
# Offline suite (injected converter + mock OCR; no network):
python3 contracts/backend-runtime-v1/reference/tools/parse_document/test_parse_document_tool.py

# With live anydoc (optional; still no Firecrawl HTTP):
python3 -m venv /tmp/anydoc-venv && /tmp/anydoc-venv/bin/pip install -r \
  contracts/backend-runtime-v1/reference/tools/parse_document/requirements.txt
/tmp/anydoc-venv/bin/python \
  contracts/backend-runtime-v1/reference/tools/parse_document/test_parse_document_tool.py
```

## Prove F6 (attach → parse → answer)

```bash
python3 contracts/backend-runtime-v1/reference/tools/parse_document/prove_parse_document_f6.py
# optional live anydoc:
# /path/to/venv/bin/python .../prove_parse_document_f6.py
```

Portal story: `/?story=parse-document` · docs: `portal-parse-document-f6-prove.md`.

## Integrate into Hermes-Lanyard

1. Copy `parse_document_tool.py` into product `tools/parse_document.py` (or
   import from a vendored path).
2. Register both ids (see `hermes_register_snippet.py`).
3. Wire `progress` to the existing Portal dual-emit path when the host does not
   already dual-emit for every tool automatically.
4. Pass profile vault roots + staging root into `ParseDocumentConfig`.
5. Add `firecrawl-anydoc` to the agent image / gateway env.
6. For OCR: materialize `FIRECRAWL_API_KEY` on host only; set
   `PARSE_DOCUMENT_ALLOW_OCR` after budget approval.

## Integrate into Lanyard Agent

Port `parse_document` / `extract_document_text` onto the agent-core tool
allowlist with the same Args/Result. Prefer `@firecrawl/anydoc`
`toMarkdownBytes`. Reuse sandbox roots + staging path ACL rules from this
module’s `resolve_allowed_path` semantics. OCR client may call the same
`POST /v2/parse` multipart shape (or Firecrawl SDK) behind the same gates.

## Non-goals (this tree)

- Portal labels (F4 — shipped separately)
- Attach→parse→answer UI proof (F6)
- Portal labels (F4)
- Live Firecrawl Parse OCR (F5)
- Attach→parse→answer UI proof (F6 — see `prove_parse_document_f6.py` + `?story=parse-document`)
- BFF-side parse of customer bytes (forbidden)
- Live paid Firecrawl calls in monorepo CI

## Product status (lp-uxy.21.5)

| Product | Status |
| --- | --- |
| **Lanyard Agent** | Ships `parse_document` + `extract_document_text` on the v1 allowlist via `@firecrawl/anydoc` (`packages/agent-core` tool). Path ACL = vault_root ∪ `/staging/uploads`. Dual-emit label **Parsing a document**. OCR cost-gated (`PARSE_DOCUMENT_ALLOW_OCR` + live `FIRECRAWL_API_KEY`). |
| Hermes-Lanyard | Still copy from this reference + `hermes_register_snippet.py` (Python first track). |

Live re-QA: Portal attach → agent `parse_document` on demo host after LA image rebuild / gateway restart with `BRAIN_RPC_ENABLED=1`.

### Staging materialization (same-host pilot)

Portal BFF defaults to an **in-memory** staging fixture. For live attach → host
`parse_document`, set matching roots:

| Side | Env | Role |
| --- | --- | --- |
| Portal BFF | `STAGING_FS_ROOT` | Filesystem provider writes `/staging/uploads/...` suffix under this dir |
| Lanyard Agent | `PARSE_DOCUMENT_STAGING_ROOT` | Physical staging ACL root; rewrites logical `/staging/uploads` stamps onto this dir |

Example (local pilot):

```bash
mkdir -p ~/.lanyard-agent/staging/uploads
export STAGING_FS_ROOT=$HOME/.lanyard-agent/staging/uploads
export PARSE_DOCUMENT_STAGING_ROOT=$HOME/.lanyard-agent/staging/uploads
# restart BFF + LA gateway
```

