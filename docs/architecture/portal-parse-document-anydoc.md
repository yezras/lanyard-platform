# parse_document via Firecrawl AnyDoc — HOW + blast radius (F0)

**Bead:** `lp-uxy.10.1` (F0) · parent feature `lp-uxy.10` · epic `lp-uxy`  
**Status:** Source-grounded discovery (2026-08-04) — read-only; no host tool shipped yet  
**Audience:** Hermes-Lanyard / Lanyard Agent tool authors, Portal UI, deploy operators  
**Related:**

- Wire lifecycle: [`portal-chat-tool-events.md`](./portal-chat-tool-events.md)
- Soft-open ≠ model ingest: [`portal-document-session-domain-model.md`](./portal-document-session-domain-model.md)
- Web Firecrawl (search/scrape, **not** office parse): [`portal-web-search-firecrawl.md`](./portal-web-search-firecrawl.md)
- Host citations contract: [`portal/artifacts/hermes-lanyard-tool-citations-contract.md`](../../portal/artifacts/hermes-lanyard-tool-citations-contract.md)
- Offline OCR pack: [`client-core/packs/focr/`](../../client-core/packs/focr/)
- AnyDoc upstream: <https://github.com/firecrawl/anydoc> (MIT)
- F1 ship order: [`portal-parse-document-f1-throughput-checkpoint.md`](./portal-parse-document-f1-throughput-checkpoint.md)
- F2 locked tool contract: [`portal-parse-document-f2-tool-contract.md`](./portal-parse-document-f2-tool-contract.md)
- F3 host tool (local anydoc): [`portal-parse-document-f3-host-tool.md`](./portal-parse-document-f3-host-tool.md)
- Evidence: [`artifacts/ui/lp-uxy.10/`](../../artifacts/ui/lp-uxy.10/)

---

## 1. Product intent (from parent design)

Users attach PDFs / Office files (or agents fetch non-text docs). Portal only
stamps **paths** into chat; soft-open is **human preview**, not model ingest.
Binary / non-text docs need conversion to Markdown so the model can reason.

| Decision | Choice |
| --- | --- |
| Tool id | `parse_document` (alias `extract_document_text` OK) |
| Primary placement | **Host agent tool** on Hermes-Lanyard + Lanyard Agent |
| Local converter | Firecrawl **AnyDoc** (`@firecrawl/anydoc` / `firecrawl-anydoc`) — MIT, local CPU, **$0 SaaS** |
| Portal role | Friendly labels + `tool_progress` UI only — **no BFF-side parse of customer files** |
| Scanned PDF OCR | Firecrawl **Parse** hosted API only in F5, cost-gated on `FIRECRAWL_API_KEY` |
| Sidecar | Optional `<stem>.parse.md` next to source when writable |

**Not Firebase.** Distinct from Firecrawl crawl/search (`lp-uxy.7`).

---

## 2. End-to-end HOW (target architecture)

```text
User attach report.pdf
  → POST /api/staging/upload
  → path: /staging/uploads/<project|_inbox>/report.pdf
User send
  → BFF appends [staging uploads] path list (message_type=document)
Agent turn
  → tool_progress running  parse_document  tool_target=<path>
  → host: anydoc.to_markdown / to_markdown_bytes (local)
       OR Firecrawl Parse OCR if scanned + key (F5)
  → optional write <stem>.parse.md sidecar
  → tool_progress complete  result=Markdown (truncated)
  → model uses extracted text in context
```

### Soft-open vs parse (do not conflate)

| Surface | Purpose | Model ingest? |
| --- | --- | --- |
| Document pane soft-open / citation chip | Human preview of vault path | **No** |
| Staging path stamp in user message | Tell the agent **where** the file is | Path only |
| `parse_document` host tool | Convert bytes → Markdown for the turn | **Yes** |
| focr pack offline ingest | Worker `.parse.md` for bulk vault promotion | Offline, not chat turn |

---

## 3. Source grounding (what exists today)

### 3.1 Tool progress wire (Portal ready)

Preferred host shape (already implemented in relay + web):

```json
{
  "op": "send",
  "chat_id": "<thread_id>",
  "metadata": {
    "portal_event": "tool_progress",
    "tool_name": "parse_document",
    "tool_call_id": "stable-id",
    "tool_status": "running",
    "tool_target": "/staging/uploads/_inbox/report.pdf",
    "tool_label": "Parsing a document"
  }
}
```

Then `tool_status: "complete"` (or `"error"`) with truncated Markdown in
`result` / expandable body, optional `duration`, `error_message` on failure.

| Layer | Path | Status for parse_document |
| --- | --- | --- |
| Relay classify | `portal/packages/relay/src/chat-delivery-hub.ts` | Ready — generic `tool_progress` |
| Web mapper | `portal/packages/web/src/features/chat/chatToolCallMapper.ts` | Ready for lifecycle; **label map F4** |
| Timeline | `ChatTimeline` + `useChatEvents` | Ready — dual-emit + history tee required |
| Friendly label | `humanToolActivityLabel` | **F4 shipped** — `parse_document` / `extract_document_text` → **Parsing a document**; prefers host `tool_label` |
| Context-gathering collapse | `CONTEXT_GATHERING_NAME_RE` | **F4 shipped** — both tool ids included; friendly "Parsing a document" collapses too |

Normative dual-emit + durable history rules:
[`portal-chat-tool-events.md`](./portal-chat-tool-events.md) § Residual host dual-emit.

### 3.2 Staging upload path stamp (Portal ready)

| Step | Implementation | Notes |
| --- | --- | --- |
| Path helpers | `portal/packages/shared/src/staging/paths.ts` | Root `/staging/uploads`; `_inbox` vs project subpath; RBAC via vault prefixes |
| Upload API | `POST /api/staging/upload` (`portal/packages/bff/src/app.ts`) | CSRF; size cap (`DEFAULT_STAGING_MAX_UPLOAD_BYTES` 25 MiB) |
| Composer attach | `ChatView` → `uploadStagingFile` → pending paths on send | Web only stamps paths; does not parse |
| Message stamp | `formatStagingReferences` | Appends `\n\n[staging uploads]\n- <path>…` |
| Message type | `message_type: "document"` when any staging path | Relay / host can treat as document turn |

Stamp helper:

```82:88:portal/packages/bff/src/staging/service.ts
export function formatStagingReferences(paths: readonly string[]): string {
  if (paths.length === 0) {
    return "";
  }
  const lines = paths.map((path) => `- ${path}`);
  return `\n\n[staging uploads]\n${lines.join("\n")}`;
}
```

### 3.3 Agent read of staging on pilot pin — **partial + residual**

**Pilot pin shape** (`compatibility/pins.hermes-lanyard-staging.example.yaml`):

| Pin | Value |
| --- | --- |
| `backend.kind` | `hermes_lanyard` |
| `backend.version` | `v0.1.0-g7h3` |
| Vault root (host) | `/opt/company-brain` (`VAULT_ROOT`; client-core, **not** swapped with backend) |
| Backend home | `/var/lib/company-brain-backend` (`BACKEND_HOME`; `HERMES_HOME` alias) |

**What is proven offline from monorepo source:**

1. **Path strings reach the agent** on send: BFF always appends
   `[staging uploads]` lines when `staging_paths` is non-empty. The model/host
   can see vault-absolute paths under `/staging/uploads/…`.
2. **client-core layout reserves** `staging/uploads/` as the inbound upload tree
   (`client-core/index.yaml`, `client-core/AGENTS.md`).
3. **Host file tools** on HL/LA can read vault-root-relative paths that exist on
   disk under the allowed profile/path_prefixes (see
   [`docs/security/lp-uxy.6-agent-sandbox-path-acl-omnibox.md`](../security/lp-uxy.6-agent-sandbox-path-acl-omnibox.md)).
   `read_file` on a binary PDF still does **not** produce model-usable text —
   that is exactly why `parse_document` exists.

**Residual (file explicitly for F3 / deploy):**

| Residual | Owner | Detail |
| --- | --- | --- |
| Default BFF staging store is **in-memory fixture** | Portal BFF / deploy | `createFixtureStagingStorageProvider()` in `portal/packages/bff/src/index.ts` — **not** written to `VAULT_ROOT`. Fixture comment: production needs customer transfer (vault FS write / SFTP sidecar / agent pull). |
| Live pilot bytes on vault FS | Deploy + host | Offline pin + monorepo code **do not prove** that `POST /api/staging/upload` lands bytes under `/opt/company-brain/staging/uploads/` on a live EC2 host. |
| No `parse_document` on pilot pin | HL / LA products | Pin `v0.1.0-g7h3` has no documented anydoc tool; F3 ships host tool externally. |
| Live AWS staging E2E | Ops | Staging HL pin is shape + coordinates; live apply still human-gated (`docs/runbooks/staging-hermes-lanyard-backend-pins.md`). |

**Implication for F3:** host `parse_document` path ACL should accept:

- vault roots the profile may already read, **and**
- `/staging/uploads/…` (and refuse escape outside vault + staging roots),

and implementers must verify the **staging storage provider** on the target
topology actually materializes files where the agent resolves those paths
(or document an agent-side pull step). Without that, path stamps alone yield
`path_denied` / missing-file errors even with a correct tool.

---

## 4. AnyDoc API (local, primary path)

| Package | Language | Import |
| --- | --- | --- |
| `@firecrawl/anydoc` | Node / TS | `import { toMarkdown, toMarkdownBytes, toDocument } from '@firecrawl/anydoc'` |
| `firecrawl-anydoc` | Python | `import anydoc` → `anydoc.to_markdown` / `to_markdown_bytes` |
| `anydoc` crate | Rust | `anydoc::to_markdown` / `to_markdown_bytes` |

**License:** MIT. **Cost:** local CPU only ($0 SaaS). Median convert ~single-digit ms (upstream bench ~4.7 ms).

**Formats (content-based detection):** Word (`.doc`/`.docx`/…), PowerPoint, Excel, ODF, RTF, EPUB, CSV, text PDF.

**PDF notes (upstream):**

- Text PDFs: local via pdf-inspector → Markdown (`to_markdown` / `to_markdown_bytes`).
- Scanned / image-only PDFs: anydoc returns **unsupported** — do not treat as empty success.
  Route to Firecrawl Parse OCR only when cost-gated (F5) or fail with
  `error_code: "unsupported_scanned"` / `"no_ocr_key"`.

Sketch (Python host — HL-shaped):

```python
import anydoc

md = anydoc.to_markdown(path)           # path on vault/staging
# or
md = anydoc.to_markdown_bytes(data)     # content-detected format
```

Sketch (Node):

```ts
import { toMarkdown, toMarkdownBytes } from "@firecrawl/anydoc";
const markdown = await toMarkdown(path);
const fromBytes = await toMarkdownBytes(bytes);
```

### Host types (locked in F2)

Parent design sketch is now **normative** in the F2 contract (defaults, clamps,
extra error codes, ACL, dual-emit). Do not invent a second shape on HL/LA.

```ts
type ParseDocumentArgs = {
  path: string;            // vault or /staging/uploads/... absolute
  max_chars?: number;      // default 48_000; clamp [1000, 200000]
  force_ocr?: boolean;     // optional cloud OCR path (F5)
  write_sidecar?: boolean; // default true → <stem>.parse.md when writable
};

type ParseDocumentResult = {
  markdown: string;
  format: string;          // docx|pdf|...
  parser?: "anydoc" | "firecrawl_parse" | "pdftotext" | "focr";
  chars: number;           // post-truncation markdown length
  truncated: boolean;
  sidecar_path?: string;
  error_code?:
    | "unsupported_scanned"
    | "path_denied"
    | "too_large"
    | "no_ocr_key"
    | "unsupported_format"
    | "parse_failed";
  error_message?: string;
};
```

Normative detail (truncation, sidecar, path ACL, module ownership):
[`portal-parse-document-f2-tool-contract.md`](./portal-parse-document-f2-tool-contract.md).

---

## 5. focr doctrine (offline — do not replace with chat tool)

| Item | focr pack | parse_document (this feature) |
| --- | --- | --- |
| When | Offline ingest workers | Chat turn-time agent tool |
| Where | Dedicated OCR host ≥ ~8 GB RAM | Agent gateway host (local anydoc CPU) |
| Office | **Not** handled by focr wrapper — escalate | **Primary** via anydoc |
| Digital PDF | `pdftotext` when text layer sufficient | anydoc text-PDF path |
| Scanned PDF | `focr ocr` → `.parse.md` | Optional Firecrawl Parse OCR (F5) or clear error |
| Sidecar | `<stem>.parse.md` | Same convention when `write_sidecar` |

Sources: `client-core/packs/focr/infra/focr/AGENTS.md`, `INDEX.md`,
`references/deployment.md`. Non-goal: building a second OCR stack for chat when
focr already covers offline workers.

---

## 6. Costs (document early)

| Path | Cost | Gate |
| --- | --- | --- |
| Local anydoc (office + text PDF) | **$0 SaaS** — host CPU | Always preferred |
| Firecrawl Parse OCR (scanned) | **Paid API** | `FIRECRAWL_API_KEY` on **host** secrets envelope only; never BFF; never commit real keys |
| Portal labels / UI | $0 | Monorepo F4 |
| focr offline workers | Host RAM + model cache (~3.9 GB) | Pack enable / separate worker |

`FIRECRAWL_API_KEY` already has a **cost-gated** teaching slot in
`contracts/backend-runtime-v1` examples and `deploy/litellm/env.secrets.example`
from `lp-uxy.7` (web). Reuse the same env for Parse OCR — still omit from live
SM until budget-approved. No second BFF secret.

---

## 7. Blast radius (what changes by later F-step)

| Surface | F-step | Change | Risk if wrong |
| --- | --- | --- | --- |
| HL / LA tool package + image deps | F3 | Add anydoc native binding; new tool module | Image size / arch wheels; fail closed if binary missing |
| Path ACL | F3 | Restrict to vault + `/staging/uploads`; refuse `..` / absolute escape | Data exfil or host FS read |
| Dual-emit tool_progress | F3 | running → complete/error + history tee | Timeline / reload lose rows |
| Sidecar `.parse.md` | F3 | Write beside source when allowed | ACL / disk fill; never commit customer bodies |
| Portal `humanToolActivityLabel` | F4 **shipped** | `parse_document` / `extract_document_text` → **Parsing a document** | Ugly technical id in UI |
| CONTEXT_GATHERING set | F4 **shipped** | Include parse tool so multi-reads collapse | Noisy timeline |
| Deploy secrets | F5 only | OCR uses existing `FIRECRAWL_API_KEY` slot | Accidental paid OCR without key policy |
| BFF | **None for parse** | Labels only; no customer-byte parse on BFF | Violates ADR 0002 boundary if BFF parses |
| Soft-open / document pane | Non-goal | Unchanged | Do not couple parse to pane open |
| lp-uxy.7 web Firecrawl | Orthogonal | Search/scrape stays separate tools | Do not overload `firecrawl_scrape` for Office |

### Out of scope (parent non-goals)

- Replacing document pane soft-open.
- Parsing every upload on Portal BFF pre-send.
- Building chat-turn OCR via focr on the Hermes box.

---

## 8. Module ownership (locked in F2)

| Module | Owner | Notes |
| --- | --- | --- |
| `tools/parse_document` (or skills wrapper) | Hermes-Lanyard + Lanyard Agent (external) | Local anydoc first; OCR optional |
| `humanToolActivityLabel` + CONTEXT_GATHERING | Portal web (`chatToolCallMapper.ts`) | F4 monorepo |
| Staging vault-backed provider (if still fixture) | Portal BFF + deploy | Residual blocker for attach→parse E2E |
| Secrets envelope OCR | Deploy / host SM | Host-only key; cost-gated |
| Optional skill doc | client-core | Point agents at `parse_document` |
| Proof attach→parse→answer | F6 **done** (offline + story); live pin F7 | `artifacts/ui/lp-uxy.10/f6-*` + pin notes |

Full ownership table + args/result lock:
[`portal-parse-document-f2-tool-contract.md`](./portal-parse-document-f2-tool-contract.md) §9.

---

## 9. F0 acceptance checklist

| Criterion (this step) | Result |
| --- | --- |
| Read portal-chat-tool-events | Done — dual-emit + history tee ready; parse tool id not special-cased yet |
| Read staging upload path | Done — stamp + RBAC helpers ready; storage provider residual filed |
| Read focr doctrine | Done — offline ingest; not chat turn; Office not in focr wrapper |
| Read anydoc API | Done — MIT local to_markdown / to_markdown_bytes; scanned → unsupported |
| Confirm agent can read staging on pilot pin | **Partial** — path stamp yes; bytes on vault FS **not** proven offline (fixture provider + live host residual) |
| Docs note + evidence | This file + `artifacts/ui/lp-uxy.10/` |

Later steps own sequencing and implementation (F1–F7). Do not swallow them in F0.

---

## 10. F1 ship order (pointer)

Throughput checkpoint (`lp-uxy.10.2`) freezes delivery order:

1. **HL local anydoc first** (external host tool).
2. **Portal labels** in the same monorepo wave when HL dual-emits.
3. **LA parity** as sister track (same F2 contract; not a gate on HL first ship).
4. **OCR cost-gated** (F5 — see [`portal-parse-document-f5-scanned-ocr.md`](./portal-parse-document-f5-scanned-ocr.md); not a local-anydoc v1 gate).

After F2 locks types, F3 (host) and F4 (labels) may run in parallel. F6 needs
both; F5 is optional after F3.

Normative sequence + PR strategy:
[`portal-parse-document-f1-throughput-checkpoint.md`](./portal-parse-document-f1-throughput-checkpoint.md).

### F2 contract pointer

Locked `ParseDocumentArgs` / `ParseDocumentResult`, truncation (default 48000),
sidecar `<stem>.parse.md`, path ACL, and module paths:
[`portal-parse-document-f2-tool-contract.md`](./portal-parse-document-f2-tool-contract.md)  
Evidence: [`artifacts/ui/lp-uxy.10/f2-architect-tool-args-result.json`](../../artifacts/ui/lp-uxy.10/f2-architect-tool-args-result.json).
