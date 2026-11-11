# lp-zuh.10.3 — OnlyOffice residual probe

**Bead:** `lp-zuh.10.3`  
**When:** 2026-08-14T17:13:06Z  
**Base URL:** `https://app.withlanyard.com/mocklab`  
**Docx path probed:** `/workflows/.lp-zuh103-probe.docx`  
**Cookie source:** `artifacts/ui/.auth/mocklab-agent.json`  
**Verdict:** **PASS_WITH_RESIDUAL**

## Acceptance map

| Criterion | Result |
|-----------|--------|
| Mint returns JSON not SPA HTML | `spa=True` status=`200` ct=`text/html` |
| `ui.can.vault_edit` | `False` |
| Control: mint non-office path hits BFF | status=`400` spa=`False` |
| SPA bundle OnlyOffice strings | see REPORT.json `spa_bundle` |

## Residuals

- mint_spa_html_fallback: POST office/sessions returned SPA HTML (likely CF 403/404 rewrite of missing_file, or edge miss)
- ui.can.vault_edit=false — set BFF_OFFICE_VAULT_EDIT=true for lab writeback
- vault_content_spa_html: GET vault/content for docx path returned SPA (404 missing file masked by CF SPA routing)
- control_ok: mint of .txt path returns BFF JSON (route live)

## Network notes (no secrets)

- Tenant path mint URL: `POST https://app.withlanyard.com/mocklab/api/office/sessions`
- Missing vault file historically returned BFF **404**, rewritten by CloudFront SPA
  error routing to `index.html` (AmazonS3). Code fix: mint `missing_file` → **422**.
- `BFF_OFFICE_VAULT_EDIT=true` required for edit mint + `ui.can.vault_edit`.
- VITE flags are **build-time**; promote SPA pin after rebuild.

## Operator apply

See [OPERATOR-APPLY.md](./OPERATOR-APPLY.md) and
[onlyoffice-mocklab-go-path.md](../../../../docs/plans/0008-daytona-agent-sandboxes/onlyoffice-mocklab-go-path.md).

## Screenshots

- `screenshots/01-authenticated-shell.png` — MockLab authenticated shell
- `screenshots/02-vault-shell.png` — Vault UI residual (editor host not mounted)

## Logs

- `logs/probes-sanitized.json`
- `REPORT.json`

## Secret hygiene

- CSRF/session values not written.
- JWT / editor tokens redacted if present.
- `.env.mocklab-agent-dev` never copied into artifacts.
