# parse_document — F2 tool contract (args / result / ownership)

**Bead:** `lp-uxy.10.3` (F2) · parent feature `lp-uxy.10` · epic `lp-uxy`  
**Playbook item:** pstack Feature — **architect types + module ownership**  
**Status:** Locked (2026-08-04) — normative for F3 (host) and F4 (Portal labels)  
**Depends on:** `lp-uxy.10.1` (F0), `lp-uxy.10.2` (F1 ship order)  
**Feeds:** `lp-uxy.10.4` (F3 host anydoc), `lp-uxy.10.5` (F4 labels), later F5–F7  
**Related:**

- HOW + blast radius: [`portal-parse-document-anydoc.md`](./portal-parse-document-anydoc.md)
- Ship order: [`portal-parse-document-f1-throughput-checkpoint.md`](./portal-parse-document-f1-throughput-checkpoint.md)
- F3 host reference: [`portal-parse-document-f3-host-tool.md`](./portal-parse-document-f3-host-tool.md)
- Tool progress wire: [`portal-chat-tool-events.md`](./portal-chat-tool-events.md)
- Evidence: [`artifacts/ui/lp-uxy.10/f2-architect-tool-args-result.json`](../../artifacts/ui/lp-uxy.10/f2-architect-tool-args-result.json)

This document **locks** the host tool identity, `ParseDocumentArgs` /
`ParseDocumentResult`, truncation + sidecar policy, path ACL roots, and module
ownership. It does **not** install anydoc, implement the host tool, or change
Portal label maps (F3 / F4).

---

## 1. Binding decisions (F2)

| ID | Decision | Binding value |
| --- | --- | --- |
| **T1** | Canonical tool id | `parse_document` |
| **T2** | Documented alias | `extract_document_text` — same args/result; hosts may register either or both; Portal F4 maps **both** to **"Parsing a document"** |
| **T3** | Args / result types | §2–§3 below — HL and LA **must** share this shape (no second contract) |
| **T4** | Default truncation | `max_chars` default **`48000`** Unicode code points (JS string length / Python `len` on str) |
| **T5** | Sidecar default | `write_sidecar` default **`true`** → write `<stem>.parse.md` beside source when writable |
| **T6** | Path ACL roots | Vault profile roots **and** `/staging/uploads` (and under); refuse escape |
| **T7** | Primary parser v1 | Local Firecrawl **AnyDoc** (`parser: "anydoc"`) — $0 SaaS |
| **T8** | OCR | `force_ocr` + auto escalation are **F5 only**; v1 may ignore `force_ocr` except fail-closed codes |
| **T9** | Portal role | Labels + `tool_progress` UI only — **no** BFF parse of customer bytes |
| **T10** | Module ownership | §7 — HL/LA external tool module; monorepo labels; deploy OCR key slot only |

---

## 2. Tool identity

| Field | Value |
| --- | --- |
| Canonical `tool_name` | `parse_document` |
| Alias `tool_name` | `extract_document_text` |
| Friendly default label | `Parsing a document` (host should dual-emit as `tool_label`; Portal F4 hard-maps both ids) |
| Placement | **Host agent tool** on Hermes-Lanyard and Lanyard Agent (ADR 0002 — not BFF) |
| Soft-open / document pane | Unchanged non-goal — not a substitute for this tool |

Model-facing description (recommended, not wire-normative):

> Convert an office or PDF document at a vault or staging path to Markdown so
> it can be reasoned over. Prefer this over `read_file` for binary/non-text docs.

---

## 3. ParseDocumentArgs (locked)

```ts
/** Host tool arguments — parse_document / extract_document_text */
type ParseDocumentArgs = {
  /** Absolute path under vault roots or /staging/uploads/… */
  path: string;

  /**
   * Max characters of Markdown returned in the tool result body.
   * Default: 48_000. Clamped to [1_000, 200_000] by the host.
   */
  max_chars?: number;

  /**
   * When true, request hosted OCR path after local anydoc reports unsupported
   * scanned PDF. F5 only; without FIRECRAWL_API_KEY → error_code "no_ocr_key".
   * v1 (F3 local): may treat as no-op and still return "unsupported_scanned"
   * if the file is scanned.
   */
  force_ocr?: boolean;

  /**
   * When true (default), write full (pre-truncation) Markdown to
   * <stem>.parse.md next to the source when the directory is writable under ACL.
   * Sidecar write failure must not fail a successful parse — omit sidecar_path.
   */
  write_sidecar?: boolean;
};
```

### Args norms

| Field | Required | Default | Validation |
| --- | --- | --- | --- |
| `path` | **yes** | — | Non-empty string; after resolve must stay under ACL roots (§5) |
| `max_chars` | no | `48000` | Host clamps to `[1000, 200000]`; values outside clamp silently to bounds |
| `force_ocr` | no | `false` | Boolean; F5 semantics |
| `write_sidecar` | no | `true` | Boolean |

**Rejected extra args:** hosts **should** ignore unknown keys (forward-compat), not hard-fail.

**Not in args (explicit non-goals):**

- Raw file bytes / base64 — path only (bytes stay on host FS).
- `url` remote fetch — out of scope (use web scrape tools for HTTP; this tool is FS path).
- BFF-only options or Portal session ids.

---

## 4. ParseDocumentResult (locked)

```ts
type ParseDocumentParser =
  | "anydoc"            // local Firecrawl AnyDoc (v1 primary)
  | "firecrawl_parse"   // hosted Firecrawl Parse OCR (F5)
  | "pdftotext"         // optional host fallback for text PDF
  | "focr";             // offline worker path only if host bridges it (non-goal for chat v1)

type ParseDocumentErrorCode =
  | "unsupported_scanned" // image-only / scanned PDF; no OCR path taken
  | "path_denied"         // outside ACL, missing, or not a regular file
  | "too_large"           // source bytes exceed host input cap
  | "no_ocr_key"          // OCR requested/required but FIRECRAWL_API_KEY absent
  | "unsupported_format"  // detected type not convertible by available parsers
  | "parse_failed";       // library/IO failure after ACL pass

type ParseDocumentResult = {
  /** Truncated Markdown body for tool result / model context (may be "" on error). */
  markdown: string;

  /** Detected or declared format token, e.g. "docx" | "pdf" | "pptx" | "xlsx" | "unknown". */
  format: string;

  /** Which converter produced markdown (omit or leave unset only on early path_denied). */
  parser?: ParseDocumentParser;

  /**
   * Character count of the **returned** `markdown` string (post-truncation).
   * Always set on success; on error typically 0.
   */
  chars: number;

  /** True when full conversion exceeded max_chars and markdown was cut. */
  truncated: boolean;

  /** Absolute path of written sidecar when write_sidecar succeeded. */
  sidecar_path?: string;

  /** Stable machine code when the tool fails or cannot produce usable text. */
  error_code?: ParseDocumentErrorCode;

  /** Optional human message for tool_progress error_message / expandable row. */
  error_message?: string;
};
```

### Success vs error shape

| Outcome | `error_code` | `markdown` | `tool_status` (wire) |
| --- | --- | --- | --- |
| Happy path | omitted | non-empty Markdown (unless empty source) | `complete` |
| Truncated happy path | omitted | first `max_chars` chars; `truncated: true` | `complete` |
| Scanned PDF, no OCR | `unsupported_scanned` | `""` | `error` (or `complete` with empty + code — **prefer `error`**) |
| OCR wanted, no key | `no_ocr_key` | `""` | `error` |
| Path ACL / missing | `path_denied` | `""` | `error` |
| Oversize source | `too_large` | `""` | `error` |
| Unknown format | `unsupported_format` | `""` | `error` |
| Library crash / IO | `parse_failed` | `""` | `error` |

**No silent empty success:** if conversion yields no usable text for a binary/scanned input, hosts **must** set `error_code` (not `complete` with empty markdown and no code).

---

## 5. Truncation policy (locked)

| Rule | Value |
| --- | --- |
| Default `max_chars` | **`48000`** |
| Clamp range | **`[1000, 200000]`** |
| What is truncated | The **tool-result** `markdown` field only |
| Sidecar content | **Full** Markdown **before** truncation (when sidecar is written) |
| `chars` | `markdown.length` **after** truncation |
| `truncated` | `true` iff full text length `>` effective `max_chars` |
| Cut boundary | Code-point safe slice at `max_chars` (no mid-surrogate pair in UTF-16 hosts). Do **not** require sentence boundaries. |
| Marker | Optional trailing `\n\n…[truncated]` is **allowed** and counts toward `max_chars` if appended; prefer pure slice without marker so models get max body. **v1: pure slice, no marker.** |

Rationale: ~48k keeps a large doc usable in context while leaving room for system/user turns; sidecar preserves full text for humans / later vault promotion without re-parse.

---

## 6. Sidecar policy (locked)

| Rule | Value |
| --- | --- |
| Default | `write_sidecar: true` |
| Filename | `<stem>.parse.md` where `stem` is the source basename **without** its last extension (e.g. `report.pdf` → `report.parse.md`; `archive.tar.gz` → `archive.tar.parse.md` — last suffix only) |
| Location | Same directory as source file |
| Contents | Full converted Markdown (pre-truncation), UTF-8 |
| Overwrite | Overwrite existing `<stem>.parse.md` from a prior parse of the same stem |
| ACL | Write only if directory is under the same ACL roots and writable by the agent profile |
| Failure mode | Log/soft-fail: successful parse still returns `complete` **without** `sidecar_path` |
| Staging | Prefer write when staging FS is writable; fixture-only topologies may always omit sidecar |
| Customer data | Sidecar is customer content — never commit into monorepo git; never ship in evidence dumps |

Aligns with focr offline convention (`<stem>.parse.md`) so vault promotion tooling stays familiar without requiring focr at chat turn time.

---

## 7. Path ACL (locked for F3)

Allowed roots (union):

1. **Vault roots** already granted to the agent profile / path_prefixes (same as other file tools).
2. **Staging tree:** paths under `/staging/uploads` (absolute) as stamped by Portal BFF.

Refuse:

- Path escape via `..`, symlink chains that leave allowed roots, or absolute paths outside the union.
- Non-regular files (directories, devices).
- Missing files → `path_denied` (do not invent content).

Input size cap (source file bytes, before parse):

| Cap | Value |
| --- | --- |
| Default max source bytes | **`26214400`** (25 MiB) — align with `DEFAULT_STAGING_MAX_UPLOAD_BYTES` |
| On exceed | `error_code: "too_large"`; do not load whole file into memory when size is known from `stat` |

---

## 8. tool_progress wire (dual-emit)

Same lifecycle as all host tools ([`portal-chat-tool-events.md`](./portal-chat-tool-events.md)).

### Running

```json
{
  "op": "send",
  "chat_id": "<thread_id>",
  "metadata": {
    "portal_event": "tool_progress",
    "tool_name": "parse_document",
    "tool_call_id": "<stable-id>",
    "tool_status": "running",
    "tool_target": "/staging/uploads/_inbox/report.pdf",
    "tool_label": "Parsing a document"
  }
}
```

### Complete (success)

- `tool_status`: `"complete"`
- `tool_target`: same path
- `result`: truncated Markdown string **or** JSON-serialized `ParseDocumentResult`  
  - **Prefer** structured JSON string of `ParseDocumentResult` so Portal can expand metadata later; plain Markdown-only `result` is acceptable for v1 if `truncated` / `parser` are not needed in UI.
  - Minimum v1: Markdown body usable by the model in the tool result channel the host already uses for other tools.
- History tee: durable row retained (same as other tools).

### Error

- `tool_status`: `"error"`
- `error_message`: short human text (may mirror `error_message` / code)
- `result` optional: JSON `ParseDocumentResult` with `error_code` set

**Dual-emit is mandatory:** at least one `running` and one terminal `complete` or `error` for every invocation.

---

## 9. Module ownership (locked)

| Module / surface | Owner plane | Path / artifact (normative intent) | Step |
| --- | --- | --- | --- |
| Host tool implementation | **External Hermes-Lanyard first**; LA sister | `tools/parse_document` (or skills-pack wrapper that registers the same id) | F3 |
| Local converter dep | HL / LA image / gateway env | Python `firecrawl-anydoc` **or** Node `@firecrawl/anydoc` | F3 |
| Path ACL + dual-emit | HL / LA | Same module; reuse profile path helpers where possible | F3 |
| Portal friendly label | **Monorepo** Portal web | `portal/packages/web/src/features/chat/chatToolCallMapper.ts` — `humanToolActivityLabel` + `CONTEXT_GATHERING_NAME_RE` | F4 (**shipped** — see `portal-parse-document-f4-portal-labels.md`) |
| Deploy OCR secret | Deploy / host SM | Existing `FIRECRAWL_API_KEY` teaching slot only; never BFF; omit live SM until budget-approved | F5 |
| Optional agent skill pointer | client-core (optional) | Skill/doc text pointing models to call `parse_document` on staging/vault office paths | post-F3 / optional |
| Normative monorepo contract | This repo | This file + `artifacts/ui/lp-uxy.10/f2-architect-tool-args-result.json` | **F2 (this)** |
| Type mirror on host | HL / LA repos | Copy or codegen from this contract; **do not invent a second shape** | F3 |

### What monorepo must **not** own

- Customer document bytes in BFF parse pipeline.
- Live Firecrawl Parse calls from Portal.
- Replacing soft-open with automatic parse.

---

## 10. Example payloads

### Args (staging upload)

```json
{
  "path": "/staging/uploads/_inbox/q2-report.docx",
  "max_chars": 48000,
  "write_sidecar": true
}
```

### Result (success, truncated)

```json
{
  "markdown": "# Q2 Report\n\n…",
  "format": "docx",
  "parser": "anydoc",
  "chars": 48000,
  "truncated": true,
  "sidecar_path": "/staging/uploads/_inbox/q2-report.parse.md"
}
```

### Result (path denied)

```json
{
  "markdown": "",
  "format": "unknown",
  "chars": 0,
  "truncated": false,
  "error_code": "path_denied",
  "error_message": "Path outside vault or staging roots"
}
```

### Result (scanned PDF, no OCR)

```json
{
  "markdown": "",
  "format": "pdf",
  "parser": "anydoc",
  "chars": 0,
  "truncated": false,
  "error_code": "unsupported_scanned",
  "error_message": "Scanned PDF requires OCR; set force_ocr with FIRECRAWL_API_KEY (F5) or use offline focr"
}
```

---

## 11. Costs (restated for implementers)

| Path | Cost | When |
| --- | --- | --- |
| Local anydoc | **$0 SaaS** (host CPU) | F3 required path |
| Portal labels | $0 | F4 |
| Firecrawl Parse OCR | **Paid** | F5 — host `FIRECRAWL_API_KEY` + `allow_ocr`; see [`portal-parse-document-f5-scanned-ocr.md`](./portal-parse-document-f5-scanned-ocr.md) |

No live paid Firecrawl calls in F2–F4 work. F5 monorepo tests stay offline (injected mock).

---

## 12. What F2 explicitly does **not** ship

- Host `parse_document` runtime / anydoc install (F3)
- Portal `humanToolActivityLabel` map entry (F4 — shipped in monorepo; see f4 doc)
- Firecrawl Parse OCR (F5)
- Attach→parse→answer proof (F6)
- Pin/version bump (F3/F7)
- Closing staging fixture residual (deploy / F6)

---

## 13. F2 acceptance checklist

| Criterion (this step) | Result |
| --- | --- |
| Lock tool name + alias | Done — T1/T2 (`parse_document` / `extract_document_text`) |
| Lock `ParseDocumentArgs` | Done — §3 |
| Lock `ParseDocumentResult` + error codes | Done — §4 (includes `unsupported_format`, `parse_failed` for implementer clarity) |
| Lock truncation policy | Done — §5 default 48000, clamp, pure slice |
| Lock sidecar policy | Done — §6 `<stem>.parse.md`, soft-fail write |
| Lock path ACL roots + size cap | Done — §7 |
| Lock module ownership | Done — §9 |
| Evidence artifact | `artifacts/ui/lp-uxy.10/f2-architect-tool-args-result.json` |
| Later F-steps not swallowed | F3–F7 remain open; no anydoc install / labels here |

---

## Changelog

| Date | Note |
| --- | --- |
| 2026-08-04 | Initial F2 locked contract (`lp-uxy.10.3`) from parent design + F0/F1. |
