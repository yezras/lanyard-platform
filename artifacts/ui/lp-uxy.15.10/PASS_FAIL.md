# lp-uxy.15.10 — pass/fail

**Result: PASS_FIXTURE_PATH_HOST_TOOL_RESIDUAL**

- Base: `http://demo.localhost:3010`
- Shipped: lp-uxy.10
- Login: `dev@demo.local`
- story_ok: True
- portal_ui_ok: True
- live_path_exercised: True
- live_host_tool_observed: False
- live_host_tool_success: False
- live detail: agent replied **NO_PARSE_DOCUMENT_TOOL** (no Parsing a document tool rows)

**Fix bead:** lp-uxy.20 (LA/HL ship parse_document host tool / AnyDoc)

Portal story parse_document UI **PASS**. Live LA does not expose `parse_document` yet
(F7 product pin residual). No Portal code fix required for this bead.
