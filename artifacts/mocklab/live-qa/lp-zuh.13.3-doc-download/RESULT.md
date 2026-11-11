# lp-zuh.13.3 — Docs CF X-Forwarded-Proto + document download residual

**Bead:** `lp-zuh.13.3`  
**Parent epic:** `lp-zuh.13` — OnlyOffice live editor unblock (HTTPS DS + writeback)  
**When (UTC):** 2026-08-19T14:05:34Z  
**Verdict:** **`PASS`**

No secrets in this package (no passwords, JWT, CSRF, download tokens, or SM values).

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Reopen vault docx; iframe stays | **GO** — iframe_count=`1`, DocsAPI=`True` |
| 2 | No Download failed dialog | **GO** — download_fail=`False` |
| 3 | Document body visible | **GO** — canvas_nonzero=`1`, body_visible=`True` |
| 4 | Screenshot + RESULT | **PASS** — this package |
| 5 | CF ORP forwards `CloudFront-Forwarded-Proto` on `E1OQ5SAD1WR60T` | **GO** |

---

## CloudFront edge (`lp-zuh.12.9` + this bead)

| Signal | Value |
|--------|-------|
| Distribution | `E1OQ5SAD1WR60T` / `https://d3sqcebajd6ueb.cloudfront.net` |
| Origin custom header | `[{"HeaderName": "X-Forwarded-Proto", "HeaderValue": "https"}]` |
| Status at probe | `Deployed` |
| Comment | `lp-zuh.13.3 Docs HTTPS edge: ORP AllViewer+CF headers (CloudFront-Forwarded-Proto) for OO scheme` |
| Mixed-content http://cache/files in console | `True` |
| HTTPS cache/files network hits | `[{"method": "GET", "url": "https://d3sqcebajd6ueb.cloudfront.net/cache/files/data/030c1a3fba441460cfdbab67fbfce39807b391679746310370dca52d88a1ba4f/origin.docx/origin.docx", "status": 200}]` |
| HTTP cache/files network hits | `[]` |
| BFF office content downloads (from DS) | `[]` |

---

## Preconditions

| Signal | Value |
|--------|-------|
| HTTPS DS origin | `https://d3sqcebajd6ueb.cloudfront.net` |
| `GET …/healthcheck` | `{"url": "https://d3sqcebajd6ueb.cloudfront.net/healthcheck", "status": 200, "content_type": "text/plain; charset=utf-8", "bytes": 4, "ok": true}` |
| `GET …/api.js` | `{"url": "https://d3sqcebajd6ueb.cloudfront.net/web-apps/apps/api/documents/api.js", "status": 200, "content_type": "application/javascript", "bytes": 65363, "ok": true}` |
| SPA bake | `{
  "ok": true,
  "js_path": "/assets/index-CEVUgujx.js",
  "js_bytes": 1345122,
  "VITE_ONLYOFFICE_EDITOR": "true",
  "VITE_ONLYOFFICE_DS_URL": "https://d3sqcebajd6ueb.cloudfront.net",
  "VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS": "https://d3sqcebajd6ueb.cloudfront.net,https://app.withlanyard.com"
}` |

---

## Live path

| Step | Result |
|------|--------|
| Login / shell | `https://app.withlanyard.com/mocklab/chat` |
| Vault open | `{"ok": true, "via": "nav_vault"}` |
| Office click | `{"ok": true, "label": "lp-zuh123-mint-proof.docx", "via": "exact_basename", "path": "/Projects/Workspace/office/lp-zuh123-mint-proof.docx"}` |
| Mint probe (edit) | `{
  "status": 200,
  "ct": "application/json",
  "spa": false,
  "session_id_present": true,
  "document_key_present": true,
  "editor_config_present": true,
  "token_present": true,
  "document_url_path": "https://app.withlanyard.com/mocklab/api/office/sessions/w4aXZhC9FXj_lDLI6GndmuUS3deLgQAGXhquiQ4dC-w/content",
  "document_server_url": null,
  "error": null
}` |
| UI final | `{
  "vault_document_host": true,
  "editor_host": true,
  "editor_frame": false,
  "editor_error": null,
  "loading_overlay_count": 0,
  "loading_overlay_visible": false,
  "loading_editor_text": false,
  "docsapi_present": true,
  "iframe_count": 1,
  "iframe_srcs": [
    "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-9b6570de27e6af706ff4c9963a12654e/web-apps/apps/documenteditor/main/index.html"
  ],
  "download_fail_dialog": false,
  "canvas_count": 0,
  "canvas_nonzero": 1,
  "document_body_visible": true,
  "frames": [
    {
      "depth": 0,
      "href": "https://app.withlanyard.com/mocklab/vault",
      "body_excerpt": "Skip to content\nLanyard Portal\nAgents\nVault\nTools\nA\nagent-dev@mocklab.example.com\nSearch\ncron\nKnowledge\nlp-kng67-demo\nmempalace\nProjects\nWorkspace\nnotes\noffice\nlp-zuh123-mint-proof.docx\nlp-zuh123-mint-proof.docx\nSEED-NOTE.txt\nAGENTS.md\nwelcome.md\nhello-pilot.txt\nINDEX.md\nskills\nwf_201a8d6b422d6a9c\nwf_3c7074c04166c77c\nwf_4e8440b25d42613a\nwf_56a547dbdbd8842c\nwf_7fad97d2e324fa00\nwf_80ac44d36ec5f7",
      "download_fail": false,
      "canvas_count": 0,
      "canvas_nonzero": 0,
      "has_id_viewport": false,
      "has_id_editor": false
    },
    {
      "depth": 1,
      "href": "<cross-origin>",
      "body_excerpt": "",
      "download_fail": false,
      "canvas_count": 0,
      "canvas_nonzero": 0,
      "has_id_viewport": false,
      "has_id_editor": false
    }
  ],
  "document_builder_not_online": false,
  "mixed_content": false,
  "body_excerpt": "Skip to content\nLanyard Portal\nAgents\nVault\nTools\nA\nagent-dev@mocklab.example.com\nSearch\ncron\nKnowledge\nlp-kng67-demo\nmempalace\nProjects\nWorkspace\nnotes\noffice\nlp-zuh123-mint-proof.docx\nlp-zuh123-mint-proof.docx\nSEED-NOTE.txt\nAGENTS.md\nwelcome.md\nhello-pilot.txt\nINDEX.md\nskills\nwf_201a8d6b422d6a9c\nwf_3c7074c04166c77c\nwf_4e8440b25d42613a\nwf_56a547dbdbd8842c\nwf_7fad97d2e324fa00\nwf_80ac44d36ec5f758\nwf_84a44a85ccd25697\nwf_c479abbbd1507563\nwf_d20a40c5e4236d12\nworkflows\nAGENTS.md\nentities.json\nIND\u2026",
  "page_frames": 2,
  "canvas_hint": true,
  "body_hint": true,
  "frame_texts": [
    {
      "url": "https://app.withlanyard.com/mocklab/vault",
      "download_fail": false,
      "excerpt": "Skip to content\nLanyard Portal\nAgents\nVault\nTools\nA\nagent-dev@mocklab.example.com\nSearch\ncron\nKnowledge\nlp-kng67-demo\nmempalace\nProjects\nWorkspace\nnotes\noffice\nlp-zuh123-mint-proof.docx\nlp-zuh123-mint-proof.docx\nSEED-NOTE.txt\nAGENTS.md\n"
    },
    {
      "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-9b6570de27e6af706ff4c9963a12654e/web-apps/apps/documenteditor/main/index.html",
      "download_fail": false,
      "excerpt": "\u00a0\n\u00a0\n\u00a0\n\u00a0\n\u00a0\nA\nFile\nHome\nInsert\nDraw\nLayout\nReferences\nCollaboration\nProtection\nView\n\u00a0\n\u00a0\n\u00a0\n\t\n\u00a0\n\u00a0\n\t\n\u00a0\n\u00a0\n\u00a0\n\u00a0 \u00a0 \u00a0 \u00a0 \u00a0 \u00a0 \u00a0\n \u00a0\n \u00a0\n\t\n\u00a0\n \u00a0\n \u00a0 \u00a0 \u00a0 \u00a0 \u00a0\n\u00a0 \u00a0 \u00a0 \u00a0 \u00a0\n \u00a0\n \u00a0\n\t\n\t\n\u00a0\n\u00a0\n\u00a0\n\u00a0\n\u00a0\n\u00a0\n\u00a0\n\u00a0\n\u00a0\n\u00a0\n\u00a0\nPage 1 of 1\n\u00a0Word count\nEnglish \u2013 United States\n\u00a0\n\u00a0\n\u00a0\n\u00a0\n\u00a0\n"
    }
  ]
}` |
| Wait / settle seconds | `90` / `40` |
| Console mixed-content samples | `[]` |
| Errors | `[]` |

---

## Screenshots

- `screenshots/01-auth-home.png`
- `screenshots/02-vault.png`
- `screenshots/03-office-open.png`
- `screenshots/04-docsapi-iframe.png`
- `screenshots/05-doc-settle.png`
- `screenshots/06-document-body.png`

---

## Re-run

```bash
# Auth from gitignored .env.mocklab-agent-dev (never commit)
set -a; source .env.mocklab-agent-dev; set +a
export AWS_PROFILE=lanyard-main AWS_REGION=us-east-1
python3 artifacts/mocklab/live-qa/lp-zuh.13.3-doc-download/run_doc_download_probe.py
```

## Secret hygiene

- No passwords, JWT, CSRF, session, download tokens, or callback nonces written.
- `.env.mocklab-agent-dev` never copied into artifacts.
- Mint `document.url` recorded as origin+path only (token stripped).

---

## BFF download proof (DS→BFF)

Server-side fetch is not visible in the browser network log. CloudWatch (sanitized):

- `artifacts/mocklab/live-qa/lp-zuh.13.3-doc-download/logs/bff-office-events.json`
- Live: `office_download` **success** status **200**, `size_bytes=1368`, file_type=`docx` at `2026-08-19T14:04:53.559Z` (session present, no tokens).

Screenshot `06-document-body.png` shows canvas text `lp-zuh.12.3 mint proof` with OnlyOffice toolbar; no Download failed dialog.

## Root cause notes

1. CloudFront **strips** origin custom_header `X-Forwarded-Proto` (AWS sensitive header). HTTP ALB would also set `X-Forwarded-Proto=http` for CF→ALB.
2. OnlyOffice **9.4** nginx maps `$http_cloudfront_forwarded_proto` first for `$the_scheme`.
3. Fix: CF origin request policy **Managed-AllViewerAndCloudFrontHeaders-2022-06** (`33f36d7e-f396-46d9-90e0-52428a34d9dc`).
4. Poisoned DS document-key cache after prior mixed-content failures required a fresh Docs task before body painted.
