# OnlyOffice exercise path (MockLab)

**Bead:** `lp-zuh.10.3`  
**No secrets.**

## One-line path

```text
Vault .docx (lp-zuh.9 seed)
  → BFF_OFFICE_VAULT_EDIT (+ vault ACL)
    → SPA VITE_ONLYOFFICE_EDITOR + HTTPS DS URL/allowlist
      → POST /<tenant>/api/office/sessions → JSON mint (not SPA HTML)
        → DocsAPI api.js from Document Server
          → DS download via BFF_OFFICE_PUBLIC_BASE_URL
            → callback writeback when edit mode + vault_edit
```

## Offline / curl probes (auth cookies required for success)

```bash
# From monorepo root with .env.mocklab-agent-dev readable (never commit)
python3 artifacts/mocklab/live-qa/residuals/onlyoffice/run_residual_onlyoffice_probe.py
```

## Live re-QA after operator apply

Expect:

- `mint.looks_like_spa_html == false`
- `mint.status` in `{201, 422}` (201 with session_id when docx exists + JWT wired)
- `context.can_vault_edit == true` when lab writeback flag on
- Optional: DocsAPI network fetch when SPA pin promoted
