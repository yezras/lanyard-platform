# lp-zuh.13.2 — Playwright: DocsAPI iframe mounts after HTTPS DS

**Bead:** `lp-zuh.13.2`  
**Parent epic:** `lp-zuh.13` — OnlyOffice live editor unblock (HTTPS DS + writeback)  
**When (UTC):** 2026-08-19T13:36:52Z  
**Verdict:** **`PASS`**

No secrets in this package (no passwords, JWT, CSRF, download tokens, or SM values).

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Open vault Office file on MockLab | **GO** — `lp-zuh123-mint-proof.docx` |
| 2 | `iframe_count>=1` / DocsAPI present; leave Loading editor… | **GO** — iframe_count=`1`, DocsAPI=`True`, loading_text=`False`, loading_overlay_visible=`False` |
| 3 | Screenshot + RESULT.md PASS | **PASS** — this package |

---

## Preconditions (lp-zuh.12.9)

| Signal | Value |
|--------|-------|
| HTTPS DS origin | `https://d3sqcebajd6ueb.cloudfront.net` |
| `GET …/healthcheck` | `{"url": "https://d3sqcebajd6ueb.cloudfront.net/healthcheck", "status": 200, "content_type": "text/plain; charset=utf-8", "bytes": 4, "ok": true}` |
| `GET …/web-apps/apps/api/documents/api.js` | `{"url": "https://d3sqcebajd6ueb.cloudfront.net/web-apps/apps/api/documents/api.js", "status": 200, "content_type": "application/javascript", "bytes": 65363, "ok": true}` |
| SPA bake | `{
  "ok": true,
  "js_path": "/assets/index-CEVUgujx.js",
  "js_bytes": 1345122,
  "VITE_ONLYOFFICE_EDITOR": "true",
  "VITE_ONLYOFFICE_DS_URL": "https://d3sqcebajd6ueb.cloudfront.net",
  "VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS": "https://d3sqcebajd6ueb.cloudfront.net,https://app.withlanyard.com"
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
    "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/apps/documenteditor/main/index.html"
  ],
  "document_builder_not_online": false,
  "mixed_content": false,
  "body_excerpt": "Skip to content\nLanyard Portal\nAgents\nVault\nTools\nA\nagent-dev@mocklab.example.com\nSearch\ncron\nKnowledge\nlp-kng67-demo\nmempalace\nProjects\nWorkspace\nnotes\noffice\nlp-zuh123-mint-proof.docx\nlp-zuh123-mint-proof.docx\nSEED-NOTE.txt\nAGENTS.md\nwelcome.md\nhello-pilot.txt\nINDEX.md\nskills\nwf_201a8d6b422d6a9c\nwf_3c7074c04166c77c\nwf_4e8440b25d42613a\nwf_56a547dbdbd8842c\nwf_7fad97d2e324fa00\nwf_80ac44d36ec5f758\nwf_84a44a85ccd25697\nwf_c479abbbd1507563\nwf_d20a40c5e4236d12\nworkflows\nAGENTS.md\nentities.json\nIND\u2026",
  "page_frames": 2
}` |
| Wait seconds | `20` |
| Network office | `[
  {
    "method": "POST",
    "url": "https://app.withlanyard.com/mocklab/api/office/sessions",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/web-apps/apps/api/documents/api.js",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/apps/documenteditor/main/index.html",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/vendor/requirejs/require.js",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/apps/documenteditor/main/resources/css/app.css",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/apps/documenteditor/main/app.js",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/apps/common/locale.js",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/apps/common/IrregularStack.js",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/vendor/socketio/socket.io.min.js",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/apps/documenteditor/main/locale/en.json",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/vendor/underscore/underscore.js",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/sdkjs/common/AllFonts.js",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/vendor/xregexp/xregexp-all-min.js",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/vendor/jquery/jquery.js",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/apps/common/Gateway.js",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/apps/common/Analytics.js",
    "status": 200
  },
  {
    "method": "GET",
    "url": "https://d3sqcebajd6ueb.cloudfront.net/9.4.0-1fd3daad6bb6a0e32491c0f87844e96d/web-apps/vendor/backbone/backbone.js",
    "status": 200
  },
  {
    "method": "POST",
    "url": "https://app.withlanyard.com/mocklab/api/office/sessions",
    "status": 200
  }
]` |

---

## Post-mount observation

- Mount captured at **`1.35s`** after vault docx click.
- Screenshot `04-docsapi-iframe.png`: OnlyOffice toolbar (File/Home/Insert/…) visible inside DocsAPI iframe; left Loading editor….
- Settle `05-docsapi-settle.png`: editor host still mounted; **document download dialog** ("Download failed" / "The document could not be downloaded") — **not** an iframe-mount fail. Separate residual: DS fetching BFF document URL (and/or CF→HTTP ALB missing `X-Forwarded-Proto: https` for absolute https:// cache URLs).
- Follow-up (optional): add CloudFront origin custom header `X-Forwarded-Proto=https` on staging-document-server CF edge; prove document body paints.

---

## Screenshots

- `screenshots/01-auth-home.png`
- `screenshots/02-vault.png`
- `screenshots/03-office-open.png`
- `screenshots/04-docsapi-iframe.png`
- `screenshots/05-docsapi-settle.png`

---

## Re-run

```bash
# Auth from gitignored .env.mocklab-agent-dev (never commit)
set -a; source .env.mocklab-agent-dev; set +a
python3 artifacts/mocklab/live-qa/lp-zuh.13.2-docsapi-iframe/run_docsapi_iframe_probe.py
```

## Secret hygiene

- No passwords, JWT, CSRF, session, download tokens, or callback nonces written.
- `.env.mocklab-agent-dev` never copied into artifacts.
- `editor_config.token` recorded as presence-only.
