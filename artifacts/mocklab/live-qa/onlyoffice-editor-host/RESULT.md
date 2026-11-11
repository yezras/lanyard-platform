# lp-zuh.12.4 — OnlyOffice editor host mounts DocsAPI (nonblank canvas)

**Bead:** `lp-zuh.12.4`  
**Parent epic:** `lp-zuh.12` — OnlyOffice MockLab/staging editor GO  
**When (UTC):** 2026-08-18T13:08:09Z  
**Verdict:** **`PASS`**

No secrets in this package (no passwords, JWT, CSRF, download tokens, or SM values).

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Open vault Office file from chat pane or vault | **GO (story pane Office open)** — live vault UI residual documented in track B |
| 2 | onlyoffice-editor-host mounts | **GO** — story `data-testid=onlyoffice-editor-host` |
| 3 | DocsAPI script/iframe present; canvas nonblank (or mock DS lab surface) | **GO (mock DS lab surface)**; lab real DocsAPI **skip/fail** |
| 4 | No silent preview fallback when editor claimed on | **GO** — onlyoffice renderer; flag_off control uses preview |
| 5 | Screenshots + RESULT.md verdict PASS | **PASS** — this package |

---

## Track A — story mock DocsAPI lab surface (product-allowed)

- Base: `http://127.0.0.1:3027`
- Passed: `True`
- Checks: `{"story_mode":"onlyoffice","story_url":"http://127.0.0.1:3027/chat?story=document-pane&mode=onlyoffice&layout=split","renderer":"onlyoffice","editor_host_visible":true,"mock_surface_text_snip":"ONLYOFFICE editor (mock)\nProposal.docx \u2014 nonblank mount for lab screenshot (lp-5q6.27 / lp-5q6.37).\nDocument Server api.js is mocked; BFF mint is not required f","mock_surface_box":{"x":1001,"y":57,"width":439,"height":843},"preview_text_count":0,"data_preview_fallback":"0","root_story_redirect_url":"http://127.0.0.1:3027/chat?story=document-pane&mode=onlyoffice&layout=split","root_story_mode":"onlyoffice","flag_off_mode":"flag_off","flag_off_preview_fallback":"1","flag_off_renderer":"preview","flag_off_screenshot":"02-story-flag-off-preview-fallback.png","screenshot":"01-story-onlyoffice-editor-host-nonblank.png","screenshot_bytes":80079}`

## Track B — live MockLab residual (not editor GO)

- Base: `https://app.withlanyard.com/mocklab`
- Residuals: `https_ds_residual, mocklab_spa_not_found`
- Shell: `{"url":"https://app.withlanyard.com/mocklab/chat","not_found":true,"shell_buttons":0,"body_snip":"Not Found"}`
- Mint: `{"status":201,"ct":"application/json","spa":false,"session_id_present":true,"document_key_present":true,"editor_config_present":true,"token_present":true,"error":null}`
- SPA bake: `{"ok":true,"js_path":"/assets/index-DzazbXcP.js","js_bytes":1342260,"VITE_ONLYOFFICE_EDITOR":"true","VITE_ONLYOFFICE_DS_URL":"https://lanyard-platform-staging-docs-al-238458258.us-east-1.elb.amazonaws.com"}`

## Track C — localhost lab real DocsAPI (optional)

- Skipped: `True` reason=`LP_ZUH124_SKIP_LAB`
- Passed: `None`
- Checks: `{}`

---

## Residuals (honest)

1. **`https_ds_residual`** — Staging Docs ALB HTTP-only; SPA bakes HTTPS DS URL (`lp-zuh.12.2`).
2. **`mocklab_spa_not_found`** — Live `/mocklab/*` client Not Found until `lp-zuh.12.6` pin promote.
3. **Live DocsAPI host GO** — blocked by (1)+(2); not claimed. Mock lab surface satisfies acceptance criterion 3.

## Screenshots

- `screenshots/01-story-onlyoffice-editor-host-nonblank.png`
- `screenshots/02-story-flag-off-preview-fallback.png`
- `screenshots/03-live-mocklab-chat-shell.png`
- `screenshots/04-live-mocklab-vault.png`
- `screenshots/05-lab-docsapi-docx-nonblank.png` (when track C runs)

## Re-run

```bash
# Story host:
#   cd portal/apps/web && pnpm exec vite --port 3027 --host 127.0.0.1
# Optional lab BFF (real DocsAPI):
#   pnpm --filter @lanyard/bff exec tsx scripts/lab-onlyoffice-live-server.mts
export STORY_BASE_URL=http://127.0.0.1:3027
# Auth for track B: MOCKLAB_AGENT_* from gitignored .env.mocklab-agent-dev
python3 artifacts/mocklab/live-qa/onlyoffice-editor-host/run_editor_host_docsapi_probe.py
```

## Secret hygiene

- No passwords, JWT, CSRF, session, download tokens, or callback nonces written.
- `.env.mocklab-agent-dev` never copied into artifacts.
- `editor_config.token` recorded as presence-only when mint is probed.

