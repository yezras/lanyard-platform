# Operator apply — OnlyOffice MockLab GO (`lp-zuh.10.3`)

## Goal

Clear `lp-zuh.7.7` residuals so MockLab kitchen-sink can open a vault `.docx` in
OnlyOffice (lab writeback) or leave an explicit HTTPS/DS residual.

**Normative path:** [onlyoffice-mocklab-go-path.md](../../../../docs/plans/0008-daytona-agent-sandboxes/onlyoffice-mocklab-go-path.md)

**No secrets** in this file or residual logs.

## Root cause (live 2026-08-14)

| Symptom | Cause |
|---------|--------|
| `POST /mocklab/api/office/sessions` → SPA `text/html` | BFF returned **404** `missing_file` (no vault docx); CloudFront SPA error routing rewrites **403/404 → index.html 200** |
| `GET /api/vault/content?path=*.docx` → SPA HTML | Same 404→SPA mask when file missing |
| `ui.can.vault_edit=false` | `BFF_OFFICE_VAULT_EDIT` default false |
| No DocsAPI | SPA not built with `VITE_ONLYOFFICE_EDITOR` + HTTPS DS URL |
| Empty Office paths | Vault seed / mount residual (mitigated by `lp-zuh.9`) |

Authenticated probes proved BFF office routes exist: mint of non-office path
returns JSON `unsupported_file_type`; vault tree returns JSON roots.

## Apply order

### 1. BFF image (mint JSON honesty)

Deploy BFF with `lp-zuh.10.3` (`missing_file` → **422**). Force new deployment.

### 2. Lab writeback gate (`lp-zuh.12.5`)

Private tfvars / ECS env (**non-secret** flag — not Secrets Manager):

```hcl
bff_environment_variables = {
  BFF_OFFICE_VAULT_EDIT = "true"
}
```

Also ensure Office bridge env when staging DS is on:

- `BFF_OFFICE_PUBLIC_BASE_URL` (plain)
- `BFF_OFFICE_DOCUMENT_SERVER_HOSTS` (plain)
- `BFF_OFFICE_JWT_SECRET` via **SM** (same ARN as DS `JWT_SECRET`)

Live check (2026-08-18): flag **on** → edit mint **201** + callback status 1 **ignored**. Status 2 may return `write_unavailable` until `lp-zuh.12.7` (CP put + `cp_s3` writer). Probe: `artifacts/mocklab/live-qa/onlyoffice-edit-writeback/`.
### 3. Vault seed

After `lp-zuh.9` R/W mount, ensure a `.docx` exists under a vault path Portal
lists (agent write or kitchen-sink seed). Mint still returns **JSON** 422 if
missing (no SPA mask after step 1).

### 4. SPA rebuild + edge CSP (`lp-zuh.12.1`)

```bash
cd portal
./scripts/pack-web-mocklab-oo.sh --version "vX.Y.Z-mocklab-oo"
# Env recipe: scripts/pack-web-mocklab-oo.env.example
#   VITE_ONLYOFFICE_EDITOR=true
#   VITE_ONLYOFFICE_DS_URL=https://<docs-host>          # HTTPS preferred
#   VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS=https://<docs-host>,https://app.withlanyard.com
# promote portal.web.* pin → origin sync → CloudFront invalidation
# (RELEASE.md § Operator promote; AWS profile with staging artifact + origin buckets)
```

Set `portal-static-edge.onlyoffice_document_server_origins = ["https://<docs-host>"]`.  
If Docs ALB is still HTTP-only, keep residual `https_ds_residual` (`lp-zuh.12.2`) — do not claim DocsAPI GO.

### 5. Staging Document Server

Follow [staging-document-server.md](../../../../deploy/references/runbooks/staging-document-server.md):
HTTPS health + `api.js`. Document residual if DS not applied.

### 6. Verify

```bash
python3 artifacts/mocklab/live-qa/residuals/onlyoffice/run_residual_onlyoffice_probe.py
# Expect: mint Content-Type application/json (422 missing or 201 success)
# Expect: context.ui.can.vault_edit true when flag applied
```

## Failure codes

| Signal | Fix |
|--------|-----|
| mint SPA HTML + AmazonS3 | Still 403/404 at edge, or request never hit BFF; redeploy BFF 422 fix; check WAF |
| mint 422 missing_file JSON | Seed vault docx (expected until seed) |
| mint 503 JWT / public base | Wire SM JWT + `BFF_OFFICE_PUBLIC_BASE_URL` |
| mint 403 edit without vault_edit | Set `BFF_OFFICE_VAULT_EDIT=true` |
| no DocsAPI | Rebuild SPA with VITE flags + HTTPS DS |
| `https_required` | Non-loopback HTTP DS URL rejected in prod builds |

## Rollback

1. `BFF_OFFICE_VAULT_EDIT=false` (or omit)
2. SPA pin without `VITE_ONLYOFFICE_EDITOR`
3. Document Server `desired_count=0` — chat previews keep working
