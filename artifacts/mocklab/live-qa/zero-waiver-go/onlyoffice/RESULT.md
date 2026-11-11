# lp-zuh.11.3 — OnlyOffice zero-waiver live probe

**Bead:** `lp-zuh.11.3`  
**Parent epic:** `lp-zuh.11` — MockLab kitchen-sink zero-waiver GO  
**When (UTC):** 2026-08-14T22:15Z–23:05Z (re-auth + mint proof refresh)  
**Base URL:** `https://app.withlanyard.com/mocklab`  
**Verdict:** **GO_PARTIAL_MINT_PLATFORM / HARD_RESIDUAL_EDITOR_HOST**

Clears the **platform path** residual from `lp-zuh.10.8` on live staging:

- BFF mint honesty (`missing_file` → **422 JSON**, not SPA HTML)
- Lab `ui.can.vault_edit=true`
- **Authenticated** mint **422** proven via Playwright + CSRF (SHIP review gap closed)

Full **editor host GO** (DocsAPI mount on vault docx) remains blocked by SPA bake + HTTPS Document Server residuals.

No secrets in this package (no passwords, JWT, CSRF values, session tokens, SM values).

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Confirm web `VITE_ONLYOFFICE_*` for mocklab origin **or rebuild** | **Residual** — live SPA pin `index-Dp3vcifp.js` Vite env object is only `{BASE_URL,DEV,MODE,PROD,SSR}` (no OnlyOffice bake). Code strings for `VITE_ONLYOFFICE_*` / `DocsAPI` exist; enablement is off. See `logs/spa-vite-analysis.json`. |
| 2 | BFF `POST /api/office/sessions` returns **JSON** (not SPA HTML) | **Platform GO** — authenticated mint missing docx → **422** `{"error":"Vault file not found"}` application/json (not SPA); edit mode same 422 with `vault_edit=true`; non-office path → **400** JSON; no-cookie mint still SPA-masked via CF **403→index.html**. See `logs/mint-edge-json-proof.json`, `logs/playwright-auth-probes.json`. |
| 3 | Open vault docx in OnlyOffice host **or** document hard residual | **Hard residual (HTTPS/DS + SPA + vault seed edge)** — DS healthy on **HTTP** ALB only; prod SPA requires HTTPS non-loopback. `PUT /api/vault/content` SPA-masked at edge in this run (seed 201 not claimed). **GO not claimed** for DocsAPI host mount. |
| 4 | Playwright screenshots + network notes | `screenshots/`, `logs/` (no secrets) |

---

## Live platform actions (this bead)

| Action | Detail |
|--------|--------|
| BFF Dockerfile | Workspace packages (`hermes-compat`, `chat-corpus`), `--ignore-scripts` install, `minimum-release-age 0` for rebuilds |
| TS compile fixes | `mint.ts` imports `OfficeDocumentSessionStore` from `store.js`; office mint logs use `latency_ms` |
| ECR image | `lanyard-platform-staging/portal/bff@sha256:94181a154aa4b0840e8f06efd726de8828791d28d8463525d985372ae40ddcc1` tag `main-93b83f4-zuh113-oo-20260814` |
| ECS | `lanyard-platform-staging-bff:26` desired/running 1 (prior deploy; still serving mint 422) |
| Env | `BFF_OFFICE_VAULT_EDIT=true` (plus existing `BFF_OFFICE_PUBLIC_BASE_URL`, `BFF_OFFICE_DOCUMENT_SERVER_HOSTS`, JWT SM) |
| CloudFront | Invalidation `I4T6XSMYNP2JT093Y6QUPNKJ6Y` on `E2UZ8B72J70GQ1` (`app.withlanyard.com`) |

### Proven live signals (re-auth run)

| Signal | Evidence |
|--------|----------|
| Password login works | Playwright email/password → app shell; `GET /api/auth/me` **200** |
| `ui.can.vault_edit=true` | `GET /mocklab/api/context` → `ui.can.vault_edit=true` |
| Authenticated mint **422** JSON | `POST …/office/sessions` missing `.docx` → **422** `Vault file not found` (view + edit); not SPA |
| Non-office control **400** JSON | Markdown path → **400** unsupported file type |
| Mint hits BFF (unauth edge) | Expired/no-cookie path still documents SPA mask on CSRF 403; unauth with bad session cookie → JSON 401 when cookie present |
| DS HTTP healthy | Prior: `http://…docs-al…/web-apps/apps/api/documents/api.js` → **200** |
| DS HTTPS | No :443 listener (residual) |
| SPA Vite OnlyOffice | Off — `wI` has no `VITE_ONLYOFFICE_*` keys |

---

## Residuals (honest — not silent green)

1. **`vite_onlyoffice_editor_off`** — Rebuild SPA with `VITE_ONLYOFFICE_EDITOR=true`, HTTPS `VITE_ONLYOFFICE_DS_URL` + allowlist; promote `portal.web.*` pin + CF invalidation; set edge `onlyoffice_document_server_origins`.
2. **`https_ds_residual`** — Staging Document Server ALB is HTTP-only. Production SPA rejects non-loopback HTTP (`https_required`). Enable HTTPS per staging-document-server runbook.
3. **`cf_403_spa_mask`** — CloudFront still rewrites origin **403/404** to SPA HTML. CSRF failures remain SPA-masked; mint missing_file fixed via **422**.
4. **`vault_put_spa_mask`** — Live `PUT /mocklab/api/vault/content` returned SPA HTML even with CSRF in browser; seed docx for mint **201** not completed this run. Authenticated **422** still proves mint honesty.
5. **`docsapi_not_mounted`** — No `window.DocsAPI` without SPA bake + HTTPS DS.

---

## Network notes (no secrets)

- Tenant mint: `POST https://app.withlanyard.com/mocklab/api/office/sessions`
- Auth for mutating routes requires `lanyard_session` + `x-csrf-token` from `lanyard_csrf` cookie
- CF behaviors: `/*/api/*` and `/api/*` → BFF origin; default → static S3; custom_error **403/404 → /index.html 200**
- Pre-bead residual: missing docx mint SPA via **404** rewrite; path fix is BFF **422**
- Post-bead: authenticated mint **422 JSON** proven live (Playwright + urllib)
- DS hosts BFF already has: `BFF_OFFICE_DOCUMENT_SERVER_HOSTS=lanyard-platform-staging-docs-al-238458258.us-east-1.elb.amazonaws.com`
- `BFF_OFFICE_PUBLIC_BASE_URL=https://app.withlanyard.com`

---

## Operator / UIQA follow-ups (editor host GO)

1. Unblock edge `PUT /api/vault/content` (or seed docx via sandbox/agent write) → mint **201**.
2. SPA rebuild + HTTPS DS + CSP origins (residuals #1–2).
3. Re-run `run_zero_waiver_onlyoffice_probe.py` / Playwright expecting DocsAPI host + vault docx open screenshots.

Password login is available for MockLab agent (`MOCKLAB_AGENT_*` from gitignored env). Storage state: `artifacts/ui/.auth/mocklab-agent.json` (gitignored). Memory sessions still wipe on BFF recycle.

---

## Screenshots

- `screenshots/00-pre-login.png` — sign-in card
- `screenshots/00-post-password-login.png` — post-login shell
- `screenshots/01-auth-shell.png` — authenticated app shell
- `screenshots/02-vault.png` / `03-vault-nav.png` / `04-docx-in-ui.png` — vault UI
- `screenshots/05-no-docsapi-host.png` — no DocsAPI editor host (residual)

## Logs

- `logs/mint-edge-json-proof.json` — auth 422 + no-cookie SPA matrix
- `logs/playwright-auth-probes.json` — full Playwright acceptance probe
- `logs/spa-vite-analysis.json` — live SPA bake analysis
- `logs/probes-sanitized.json` / `network-sanitized.json`
- `REPORT.json` — machine-readable summary

## Secret hygiene

- No passwords, JWT, CSRF, or session values written.
- `.env.mocklab-agent-dev` never copied into artifacts.
- Auth storage_state remains gitignored under `artifacts/ui/.auth/`.

---

## Relationship to kitchen-sink waiver

| `lp-zuh.10.8` waiver | This bead |
|---------------------|-----------|
| OO operator apply (BFF 422, vault_edit, VITE, DS) | BFF **422 live + vault_edit live + auth mint 422**; VITE/HTTPS **still operator** |
| Live mint SPA HTML | **Cleared for authenticated missing_file path** (422 JSON) |
| No DocsAPI host | Hard residual (SPA + HTTPS DS) — **not GO** |
