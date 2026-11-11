# lp-uxy.15.10 — parse_document / AnyDoc tool path ship QA

**Shipped feature:** lp-uxy.10 (parse_document via Firecrawl AnyDoc)
**Base URL:** `http://demo.localhost:3010`
**Login:** `dev@demo.local` / `local-dev-password`
**Method:** web-ui-testing (Playwright headless Chromium)
**When:** 2026-08-05 (live run)

## Verdict

| Surface | Result |
|---------|--------|
| Portal UI story (`?story=parse-document`) | **PASS** |
| Live agent attach + parse_document (LA host) | **FAIL host tools** |
| Overall ship-qa for Portal consumer | **PASS_FIXTURE_PATH_HOST_TOOL_RESIDUAL** |

## Acceptance mapping

- [x] story-attach-stamp: staging uploads sample.docx + sample.pdf
- [x] story-tool-lifecycle-labels: **Parsing a document** running/complete/error (5 tool calls)
- [x] story-markdown-results: markers in markdown previews + final answer
- [x] story-negatives: `path_denied` + `unsupported_scanned`
- [x] story-boundary-no-bff-parse: `data-bff-parse=false` `data-cost-gated=true`
- [x] live-login-home / brain-rpc / attach / prompt sent
- [ ] live-parse-tool-lifecycle: **FAIL** — `NO_PARSE_DOCUMENT_TOOL`
- [x] live-response-captured

## Story fixture (`?story=parse-document`)

Deterministic attach → parse_document → answer proof (lp-uxy.10 F6). **No BFF parse**; OCR cost-gated.

- Root: `data-parse-document-live="false"` / `data-bff-parse="false"` / friendly **Parsing a document**
- Attach panel stamps `[staging uploads]` paths
- Tool rows dual-emit running → complete/error with markdown previews (`anydoc` markers)
- Answer cites `LANYARD_F6_DOCX_Q3_REVENUE_MARKER` + `LANYARD_F6_PDF_POLICY_MARKER`
- Negatives: path outside ACL → `path_denied`; scanned PDF without key → `unsupported_scanned`

Shots: `01`–`05`.

## Live attach + parse (Lanyard Agent via Brain RPC)

| Check | Result |
|-------|--------|
| Login + New chat + attach docx + send | OK |
| brain_rpc / kind | True / lanyard_agent |
| Parsing a document tool row | **False** |
| Marker cited from parse | **False** |
| Host response | `NO_PARSE_DOCUMENT_TOOL` |

Root cause (host product): Lanyard Agent does not register `parse_document` /
`extract_document_text` yet. Monorepo holds normative reference tool + Portal labels;
F7 residual is product pin / host register (ADR 0002).

## Fix bead

Filed: **lp-uxy.20** — LA/HL ship parse_document host tool (AnyDoc) for live attach→parse
(discovered-from lp-uxy.15.10).

## Artifacts

| File | What |
|------|------|
| `01-story-attach-panel.png` | Staging attach stamp |
| `02-story-tool-lifecycle.png` | Parsing a document tool rows + markdown |
| `03-story-markdown-results.png` | Markdown previews + markers |
| `04-story-negatives-answer.png` | Negatives + answer |
| `05-story-full-page.png` | Full story page |
| `10`–`15` live `*.png` | Live LA attach/parse attempt |
| `REPORT.json` / `RESULT.md` / `PASS_FAIL.md` | Evidence |

## Notes

- Brain RPC: lp-uxy.15.1 enabled (`kind=lanyard_agent`).
- Story path is normative Portal proof when host tool not pinned.
- Offline host prove: `artifacts/ui/lp-uxy.10/` + `contracts/.../parse_document/`.
- No Portal code change required for this QA bead.
