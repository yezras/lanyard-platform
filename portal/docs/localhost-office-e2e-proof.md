# Localhost Office E2E proof (lp-5q6.38)

Prove the free-track Office product chain on **localhost mocklab + lab Document Server**.

## Chain

| Step | Offline residual | Live GO requirement |
|------|------------------|---------------------|
| Chat / pane open | web reducer + story `e2e_chain` | lab BFF mint + DocsAPI open |
| Agent write | artifact progress events | `POST /lab/e2e/agent-write` (real OOXML) |
| Pane revision refresh | `openGeneration` bump | `document_key` rotates after save |
| Human save | memory DS callback | **DocsAPI edit + DS forcesave + DS assemble URL** |
| Vault reopen | poison DS map | reopen sha == human; vault overwrite tracks vault |

## Run

```bash
# From monorepo root
bash deploy/scripts/prove-localhost-office-e2e.sh
```

FULL PRODUCT GO requires `REQUIRE_LIVE=1` (default) and:

- `save-callback-evidence.json` → `write_observed=true`
- `through_document_server=true` (`assembled_fetch_source=document_server`)
- `document_key` before ≠ after human save
- reopen download sha equals human vault sha

## Evidence hygiene

Committed evidence must **not** include:

- JWT secrets or editor/command tokens (`eyJ…`)
- Full session ids / download tokens / callback nonces
- Document bodies

Use prefixes only (`session_id_prefix`, `document_key_prefix`, `*_sha256_prefix`).

## Non-claims

This proof does **not** authorize AWS staging or production customer Office edit.
