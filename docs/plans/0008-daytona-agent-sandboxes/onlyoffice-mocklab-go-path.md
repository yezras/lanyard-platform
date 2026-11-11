# OnlyOffice MockLab GO path (lp-zuh.10.3)

**Bead:** `lp-zuh.10.3`  
**Parent epic:** `lp-zuh.10` — MockLab kitchen-sink feature GO residuals  
**Live residual source:** `lp-zuh.7.7` PASS_WITH_RESIDUAL  
**Date:** 2026-08-14  
**No secrets** in this file.

Related:

- Residual package: [`artifacts/mocklab/live-qa/residuals/onlyoffice/`](../../../artifacts/mocklab/live-qa/residuals/onlyoffice/)
- New-tenant checklist §6: [`artifacts/mocklab/live-qa/NEW-TENANT-CHECKLIST.md`](../../../artifacts/mocklab/live-qa/NEW-TENANT-CHECKLIST.md)
- Staging DS runbook: [`deploy/references/runbooks/staging-document-server.md`](../../../deploy/references/runbooks/staging-document-server.md)
- Operate DS / flags: [`deploy/references/runbooks/operate-onlyoffice-document-server.md`](../../../deploy/references/runbooks/operate-onlyoffice-document-server.md)
- Edge SPA risk: [`deploy/modules/portal-static-edge/README.md`](../../../deploy/modules/portal-static-edge/README.md)
- Vault mount foundation: `lp-zuh.9` (closed via `lp-zuh.9.4`)

---

## 1. Operator summary

| Question | Answer (2026-08-14) |
|----------|---------------------|
| Why did live QA mint return SPA HTML? | CloudFront SPA `custom_error_response` rewrites **distribution-wide 403/404 → `index.html` 200**. Office mint returned **404 missing_file** (empty/missing vault docx) and the edge masked JSON as HTML. |
| Is the BFF office route missing? | **No** on current MockLab — authenticated `POST /mocklab/api/office/sessions` hits BFF (returns JSON for non-office types; missing docx was 404→SPA). |
| What unblocks JSON mint? | Seed a real vault `.docx` **and** ship BFF mint that uses **422** (not 404) for `missing_file` (`lp-zuh.10.3` code fix). |
| Why no DocsAPI host? | SPA build lacks `VITE_ONLYOFFICE_EDITOR` + HTTPS `VITE_ONLYOFFICE_DS_URL` / allowlist (build-time only). |
| Why no Edit affordance? | `ui.can.vault_edit=false` until BFF env `BFF_OFFICE_VAULT_EDIT=true` (fail-closed default). |
| Is production customer OnlyOffice claimed? | **No** — free-track / MockLab lab writeback only. |

---

## 2. Residual taxonomy (from live QA + re-probe)

| Residual | Live signal | Unblock |
|----------|-------------|---------|
| `mint_spa_html_fallback` | `POST …/api/office/sessions` → `text/html` when BFF would 404 | Seed vault docx + mint `missing_file`→**422** (this bead); confirm POST reaches BFF |
| `ui.can.vault_edit=false` | `GET /api/context` → `vault_edit: false` | Set `BFF_OFFICE_VAULT_EDIT=true` on MockLab BFF (lab writeback only) |
| `vault_write=false` / empty tree roots | Capabilities / vault UI empty for Office paths | `lp-zuh.9` mount+seed; agent `vault_write` when product advertises it |
| `VITE_ONLYOFFICE_*` off | No DocsAPI `api.js`; `__LANYARD_FEATURE_FLAGS__` null in prod | Rebuild SPA with flags (§3); promote pin |
| `https_required` / DS residual | Staging DS always-on residual separate from web flags | HTTPS Docs ALB + CSP origins aligned with build allowlist |
| JWT align | Mint 503/4xx after flags | Same SM JWT for DS + `BFF_OFFICE_JWT_SECRET` |

---

## 3. Web build flags (staging MockLab)

Vite injects OnlyOffice at **pack/build time**. Runtime query overrides are **rejected** in production builds.  
`onlyOfficeFeatureFlag.ts` uses **static** `import.meta.env.VITE_ONLYOFFICE_*` reads so packs bake keys into the client env object (`lp-zuh.12.1`).

| Env | MockLab GO value | Notes |
|-----|------------------|--------|
| `VITE_ONLYOFFICE_EDITOR` | `true` | Enables editor host |
| `VITE_ONLYOFFICE_DS_URL` | `https://<docs-host>` | **HTTPS**, non-loopback |
| `VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS` | DS origin **+** `https://app.withlanyard.com` | Comma-separated; must align with edge CSP for DS |
| Edge `onlyoffice_document_server_origins` | `["https://<docs-host>"]` | `portal-static-edge` CSP synthesis (HTTPS only) |

**Live staging DS (2026-08):** HTTP ALB  
`lanyard-platform-staging-docs-al-238458258.us-east-1.elb.amazonaws.com` (`api.js` **200** on `:80`; no `:443`).  
Bake the **HTTPS** form of that host (or a future CF/custom Docs hostname from `lp-zuh.12.2`). Until TLS lands, DocsAPI fetch fails after flag-on — document residual `https_ds_residual`, do not claim editor GO.

Pack (from `portal/`):

```bash
# Preferred recipe (lp-zuh.12.1)
./scripts/pack-web-mocklab-oo.sh --version "vX.Y.Z-mocklab-oo"
# or source portal/scripts/pack-web-mocklab-oo.env.example then:
# ./scripts/pack-web.sh --version "vX.Y.Z-mocklab-oo"
# build.env in tarball records the VITE_ONLYOFFICE_* stamps (non-secret)
```

CI: `workflow_dispatch` on `release-static-web.yml` accepts optional `vite_onlyoffice_*` inputs (empty = product default off).

Promote via existing static web pin contract (`portal.web.version` / `sha256` / `url`) → origin sync → CloudFront invalidation.  
See [`portal/apps/web/RELEASE.md`](../../../portal/apps/web/RELEASE.md).

---

## 4. BFF office mint JSON (tenant path)

Canonical browser path:

```text
POST https://app.withlanyard.com/<tenant_slug>/api/office/sessions
```

Edge must route `/*/api/*` (and bare `/api/*`) to BFF with **POST/PUT** allowed (`portal-static-edge`).

### 4.1 SPA HTML vs JSON (diagnose)

| Observation | Meaning |
|-------------|---------|
| `Content-Type: text/html` + `<!doctype html>` + `server: AmazonS3` | SPA fallback (default behavior or **403/404 rewritten**) |
| `application/json` error body | Hit BFF |
| `201` + `session_id` + `editor_config.token` (presence only in logs) | Mint success |

**Do not log JWT / download tokens.**

### 4.2 Code honesty (`lp-zuh.10.3`)

`mintOfficeEditorSession` returns **HTTP 422** for `missing_file` (not 404) so CloudFront SPA error routing does not replace the JSON body with `index.html`.

Other mint failures already use 400/403/503 (403 ACL still SPA-risk — prefer fixing edge long-term; see static-edge README).

---

## 5. `BFF_OFFICE_VAULT_EDIT=true` (lab writeback only)

| Setting | Default | MockLab lab writeback |
|---------|---------|------------------------|
| `BFF_OFFICE_VAULT_EDIT` | `false` (fail-closed) | **`true`** when kitchen-sink Office **Edit** + callback write is desired |

Effects:

- Merged into `GET /api/context` → `ui.can.vault_edit`
- Gates mint `mode=edit` (`missing_write_capability` when false)
- Does **not** alone grant agent `vault_write` brain feature or vault ACL

Private `terraform.tfvars` (never commit secrets):

```hcl
bff_environment_variables = {
  # …other non-secrets…
  BFF_OFFICE_VAULT_EDIT = "true" # MockLab / dogfood lab writeback only
}
```

Production customer edit remains blocked by free-track license decision until reopened.

Rollback: set `BFF_OFFICE_VAULT_EDIT=false` (or omit) and force-new-deployment BFF.

---

## 6. Vault docx open path (after `lp-zuh.9`)

```text
S3 vault mount R/W (/mnt/vault)
  → seed/agent write .docx under vault tree
    → Portal vault browser lists path
      → Edit / open Office host (flag on)
        → POST /api/office/sessions → JSON mint
          → browser loads DocsAPI api.js from VITE_ONLYOFFICE_DS_URL
            → DS fetches BFF download URL (BFF_OFFICE_PUBLIC_BASE_URL)
              → callback writeback when BFF_OFFICE_VAULT_EDIT=true
```

If HTTPS DS or JWT not ready: document residual `https_required` / JWT; keep **preview** path working without DS.

---

## 7. Operator apply checklist (MockLab)

1. **Vault content:** cold ensure_online R/W vault (`lp-zuh.9.4`); seed a `.docx` under a vault path Portal can list.
2. **BFF image:** deploy build that includes office mint routes + `missing_file`→422.
3. **BFF env:** `BFF_OFFICE_PUBLIC_BASE_URL`, `BFF_OFFICE_DOCUMENT_SERVER_HOSTS`, `BFF_OFFICE_JWT_SECRET` (SM), and for lab writeback `BFF_OFFICE_VAULT_EDIT=true`.
4. **Web pin:** rebuild SPA with §3 VITE flags; promote static edge pin; set `onlyoffice_document_server_origins` for CSP.
5. **Staging DS:** enable/health per staging-document-server runbook (HTTPS `api.js`).
6. **Verify (no secrets):**

```bash
HOST="${HOST:-app.withlanyard.com}"
TENANT="${TENANT:-mocklab}"

# Context gate
curl -sS "https://${HOST}/${TENANT}/api/context" | jq '{vault_edit:.ui.can.vault_edit}'

# Mint must be JSON (auth cookies + CSRF required for success path).
# Missing file → 422 JSON after lp-zuh.10.3; success → 201 + session_id.
```

7. **Browser re-QA:** residual script under `artifacts/mocklab/live-qa/residuals/onlyoffice/`.

---

## 8. Acceptance map (`lp-zuh.10.3`)

| # | Acceptance | Evidence |
|---|------------|----------|
| 1 | Web build VITE flags + DS allowlist for staging MockLab | §3 + pack-web `build.env` stamps + OPERATOR-APPLY |
| 2 | BFF mint returns real session JSON on tenant path (not SPA) | `missing_file`→422; residual network notes; operator seed |
| 3 | Document `BFF_OFFICE_VAULT_EDIT=true` for lab writeback | §5 + staging runbook cross-link |
| 4 | Open vault docx in OnlyOffice host **or** document HTTPS residual | Residual RESULT; remaining DS/VITE promote is operator |
| 5 | Evidence screenshots + network notes (no secrets) | `artifacts/mocklab/live-qa/residuals/onlyoffice/` |

---

## 9. Honesty

- Not a production customer OnlyOffice claim.
- Live AWS apply / SPA pin promote / BFF force-deploy remain **operator-owned**.
- DS always-on residual is separate from web build flags (document both).

## 10. Zero-waiver status (`lp-zuh.11.3`)

**Date:** 2026-08-14 (auth mint re-proof)  
**Evidence:** [`artifacts/mocklab/live-qa/zero-waiver-go/onlyoffice/`](../../../artifacts/mocklab/live-qa/zero-waiver-go/onlyoffice/)

| Item | Live status (2026-08-14) |
|------|---------------------------|
| BFF mint `missing_file`→422 image | **Deployed** staging BFF task def **:26** (digest `sha256:94181a15…`) |
| `BFF_OFFICE_VAULT_EDIT` | **true** → `ui.can.vault_edit=true` |
| Edge mint JSON (not SPA) | **Authenticated GO** — missing `.docx` → **422 JSON** (view+edit) with session+CSRF; CSRF **403** no-cookie path still SPA-masked |
| SPA `VITE_ONLYOFFICE_*` bake | **On** live pin `v0.1.6-mocklab-oo-zuh121-20260818` (`lp-zuh.12.1` — see `artifacts/mocklab/live-qa/lp-zuh.12.1-web-vite-onlyoffice/`) |
| Staging DS | **HTTP** ALB healthy (`api.js` 200); **HTTPS residual** for prod SPA (`lp-zuh.12.2`) |
| Editor host DocsAPI GO | **Not claimed** — HTTPS DS + vault seed path for mint **201** still required |

Password login restores MockLab agent session when BFF memory sessions wipe (use gitignored `MOCKLAB_AGENT_*` + Playwright; storage_state under `artifacts/ui/.auth/`). DocsAPI host still needs HTTPS DS (`lp-zuh.12.2`).

## 11. HTTPS Document Server (`lp-zuh.12.2` residual → `lp-zuh.12.9` GO)

**Date:** 2026-08-19  
**Evidence:** [`artifacts/mocklab/live-qa/lp-zuh.12.9-ds-https/`](../../../artifacts/mocklab/live-qa/lp-zuh.12.9-ds-https/) (prior: [`lp-zuh.12.2-ds-https/`](../../../artifacts/mocklab/live-qa/lp-zuh.12.2-ds-https/))  
**Runbook:** [staging-document-server.md §6](../../../deploy/references/runbooks/staging-document-server.md)

| Item | Live status (2026-08-19) |
|------|---------------------------|
| HTTP Docs ALB `/healthcheck` + `api.js` | **200** |
| HTTPS via CloudFront → HTTP ALB | **GO** — `https://d3sqcebajd6ueb.cloudfront.net` (`E1OQ5SAD1WR60T`) |
| Custom Docs hostname / ALB `:443` | Still blocked (Squarespace DNS; no docs.* ACM) — Option A deferred |
| SPA pin | `v0.1.9-mocklab-oo-zuh129-20260819` with HTTPS CF `VITE_ONLYOFFICE_DS_URL` |
| BFF allowlist | CF domain + ALB DNS |
| Verdict | **`HTTPS_GO`** for api.js/health; DocsAPI iframe Playwright **`PASS`** (`lp-zuh.13.2`) |
| Compose | `document_server_enable_cloudfront_https=true` (+ import live CF into TF state) |

Re-probe: `bash deploy/scripts/probe-staging-document-server-https.sh --host d3sqcebajd6ueb.cloudfront.net --scheme https`.

## 11b. DocsAPI iframe Playwright (`lp-zuh.13.2`)

**Date:** 2026-08-19  
**Evidence:** [`artifacts/mocklab/live-qa/lp-zuh.13.2-docsapi-iframe/`](../../../artifacts/mocklab/live-qa/lp-zuh.13.2-docsapi-iframe/)  
**Verdict:** **`PASS`** — vault `lp-zuh123-mint-proof.docx` opens with `iframe_count>=1`, `window.DocsAPI` present, left Loading editor….

| Signal | Result |
|--------|--------|
| SPA bake | `VITE_ONLYOFFICE_DS_URL=https://d3sqcebajd6ueb.cloudfront.net` (`index-CEVUgujx.js`) |
| Mint | `POST /mocklab/api/office/sessions` 200/201 JSON |
| DocsAPI iframe | **GO** — src `…/documenteditor/main/index.html` over HTTPS CF |
| Post-mount | Editor chrome visible; document **download** dialog residual cleared by `lp-zuh.13.3` (CF `CloudFront-Forwarded-Proto` ORP) |

Re-run: `python3 artifacts/mocklab/live-qa/lp-zuh.13.2-docsapi-iframe/run_docsapi_iframe_probe.py`

## 11c. Document download residual (`lp-zuh.13.3`)

**Date:** 2026-08-19  
**Evidence:** [`artifacts/mocklab/live-qa/lp-zuh.13.3-doc-download/`](../../../artifacts/mocklab/live-qa/lp-zuh.13.3-doc-download/)  
**Root cause:** CF→HTTP ALB left OnlyOffice emitting `http://d3sqcebajd6ueb.cloudfront.net/cache/files/…` (mixed content). CF origin custom_header `X-Forwarded-Proto` is stripped; OnlyOffice 9.4 prefers `CloudFront-Forwarded-Proto`.

| Signal | Result |
|--------|--------|
| Live CF ORP | `Managed-AllViewerAndCloudFrontHeaders-2022-06` (`33f36d7e-…`) |
| Module | `docs_cf_origin_request_policy_id` matches that managed ORP |
| Acceptance | iframe stays; no Download failed; document body/canvas visible |

Re-run: `python3 artifacts/mocklab/live-qa/lp-zuh.13.3-doc-download/run_doc_download_probe.py`

## 11d. Tool-only office/vault polish (`lp-oop.38.9`)

**Date:** 2026-08-20  
**Scope:** documents on MockLab without a guest agent (BFF → CP → S3). No terraform/ECS from this leaf.

| Residual | Status | Evidence |
|----------|--------|----------|
| Vault/Office open on `VaultPlane=cp_s3` (no Brain RPC / `ensure_online`) | **Closed** | BFF `vault-office-cp-s3.integration.test.ts` (tree/content/mint/signed GET + 38.9 cited markdown/office paths) |
| Docs HTTPS + iframe mount | **Closed** | `lp-zuh.12.9` / `lp-zuh.13.2` |
| Document **download** dialog (`http://cache/files` mixed content) | **Closed** | `lp-zuh.13.3` RESULT **PASS** (iframe stays; no Download failed; canvas body visible; CF ORP `Managed-AllViewerAndCloudFrontHeaders-2022-06`) |
| Callback **writeback** CP put / CAS | **Closed (mechanical)** | `lp-zuh.12.7` / `lp-zuh.13.1` `GO_LIVE_WRITEBACK` + BFF `office-cp-s3-callback-writer.test.ts`. Live in-editor human save UX **not re-probed** this bead. |
| Chat document/file refs (harness 38.7 `read` + citations) | **Closed (mapped)** | Harness `read`/`completed` now promote to `artifact.open`; citation click → pane; pane/office bytes via CP S3. Live Playwright waived (no auth in this worktree). |

Honest leftovers (not claimed PASS here):

- `lp-zuh.13.3` REPORT recorded two console `500` resource loads; mixed-content CF table flag vs empty console samples. Download dialog itself was gone.
- In-editor human File→Save round-trip on live MockLab after the 38.7 image roll.
- Poisoned DS `document.key` cache after mixed-content still needs a fresh Docs task if body fails to paint.

## 12. Editor host Playwright (`lp-zuh.12.4`)

**Date:** 2026-08-18  
**Evidence:** [`artifacts/mocklab/live-qa/onlyoffice-editor-host/`](../../../artifacts/mocklab/live-qa/onlyoffice-editor-host/)  
**Verdict:** **`PASS`** via product-allowed **mock DocsAPI lab surface** (acceptance criterion 3). Live DocsAPI host **not claimed**.

| Track | Result |
|-------|--------|
| A — Vite `?story=document-pane&mode=onlyoffice` | **GO** — `onlyoffice-editor-host` + nonblank mock surface; no silent preview fallback; `/?story=` preserves search on `/`→`/chat` redirect |
| B — live MockLab | Residuals: `https_ds_residual`, `mocklab_spa_not_found` (`lp-zuh.12.6`); mint happy-path still **201** JSON |
| C — localhost lab real DocsAPI | Optional; skipped when lab BFF not up |

Re-run: `python3 artifacts/mocklab/live-qa/onlyoffice-editor-host/run_editor_host_docsapi_probe.py` (story host on `:3027`).

## 13. Lab edit writeback (`lp-zuh.12.5`) — optional after view GO

**Date:** 2026-08-19  
**Evidence:** [`artifacts/mocklab/live-qa/onlyoffice-callback-writeback-live/`](../../../artifacts/mocklab/live-qa/onlyoffice-callback-writeback-live/) (live) · [`onlyoffice-edit-writeback/`](../../../artifacts/mocklab/live-qa/onlyoffice-edit-writeback/) (flag/route) · [`onlyoffice-callback-writeback-cp-s3/`](../../../artifacts/mocklab/live-qa/onlyoffice-callback-writeback-cp-s3/) (local CAS)  
**Verdict:** **`GO_LIVE_WRITEBACK`** (`lp-zuh.13.1`)

| Item | Live status (2026-08-19) |
|------|---------------------------|
| `BFF_OFFICE_VAULT_EDIT` | **true** → `ui.can.vault_edit=true` (MockLab dogfood only; default elsewhere remains false) |
| Edit mint | **201** JSON (`mode=edit`, `permissions.edit=true`) |
| Callback status 1 | **200** `ignored` |
| Callback status 2 → `vault.write` CAS | **GO** — **200** `saved` after CP+BFF force-redeploy (`lp-zuh.13.1`); CP `vault/put` + BFF `createCpS3OfficeCallbackVaultWriter` (`lp-zuh.12.7` / #525) |
| Fixture / lab CAS | **GO** — BFF vitest `office-lab-roundtrip` + `office-callback` + `office-cp-s3-callback-writer` (replace_if_match → new revision) |
| Live durable writeback | **GO** — vault content-hash + `document.key` advanced; evidence [`onlyoffice-callback-writeback-live/`](../../../artifacts/mocklab/live-qa/onlyoffice-callback-writeback-live/) |

### Ops toggle vs Secrets Manager

| Knob | Where it lives | Notes |
|------|----------------|-------|
| `BFF_OFFICE_VAULT_EDIT` | **Plain** `bff_environment_variables` / ECS env | Not a secret. Set `"true"` only for MockLab/dogfood lab writeback. |
| `BFF_OFFICE_JWT_SECRET` | **Secrets Manager** (shared with DS `JWT_SECRET`) | Never plain env on staging/production-like labels. |
| `BFF_OFFICE_PUBLIC_BASE_URL` / `BFF_OFFICE_DOCUMENT_SERVER_HOSTS` | Plain env | Reachability + SSRF allowlist (non-secret). |

```hcl
# private terraform.tfvars — never commit secrets; this flag is non-secret
bff_environment_variables = {
  BFF_OFFICE_VAULT_EDIT = "true" # MockLab lab writeback only
}
```

Rollback: omit/`false` + force-new-deployment BFF. View-only editor GO does **not** require this flag.

Re-run: `python3 artifacts/mocklab/live-qa/onlyoffice-edit-writeback/run_edit_writeback_probe.py`.
