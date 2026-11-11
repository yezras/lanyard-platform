# lp-zuh.12.3 — BFF live office mint happy path (real vault docx)

**Bead:** `lp-zuh.12.3`  
**Parent epic:** `lp-zuh.12` — OnlyOffice MockLab/staging editor GO  
**When (UTC):** 2026-08-18  
**Base URL:** `https://app.withlanyard.com/mocklab`  
**Verdict:** **`GO_MINT_HAPPY_PATH`**

No secrets in this package (no passwords, JWT, CSRF, download tokens, callback nonces, or SM values).

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Seed or create vault `.docx` under MockLab vault | **GO** — S3 put `…/Projects/Workspace/office/lp-zuh123-mint-proof.docx` (1322 bytes) under tenant prefix |
| 2 | Authenticated `POST /api/office/sessions` → success with `session_id`, `document_key`, `editor_config` (token redacted) | **GO** — view **201** created; same `caller_key` replay **200** `idempotent_replay=true`; fields present |
| 3 | view mode works; edit mode only if `BFF_OFFICE_VAULT_EDIT=true` | **GO** — view **201**; edit **201** with `ui.can.vault_edit=true` (lab intentional) |
| 4 | Not SPA HTML fallback | **GO** — all mint responses `application/json` (not `text/html` / S3 SPA) |
| 5 | Evidence under `artifacts/mocklab/live-qa/onlyoffice-editor-go/` | **GO** — this package |

**Editor host / DocsAPI canvas:** not claimed here (sibling `lp-zuh.12.4`).

---

## Live signals

| Signal | Evidence |
|--------|----------|
| Auth | `GET /api/auth/me` **200** |
| `ui.can.vault_edit` | **true** (`BFF_OFFICE_VAULT_EDIT=true` on staging BFF) |
| Vault tree (CP S3) | `GET /api/vault/tree` **200** (no sandbox wake) |
| Vault content | `GET /api/vault/content?path=…docx` **200** base64 body |
| Mint view (create) | **201** + `session_id` + `document_key` + `editor_config` |
| Mint view (replay) | **200** + `idempotent_replay=true` |
| Mint edit | **201** + `editorConfig.mode=edit` + `permissions.edit=true` |
| Controls | markdown path **400** JSON; missing docx **422** JSON |

HTTP status note: BFF returns **201** for a newly created office session and **200** for idempotent replay (`caller_key`). Acceptance “200” is met by the replay path; create path is also non-SPA JSON success.

---

## Unblock applied (CP VaultObjectStore)

First probes against the seeded docx returned BFF **500** JSON:

`ControlPlaneRequestError: Vault object store is not configured (inject VaultObjectStore; lp-oop.9)`

Code for the live S3 adapter already merged as `lp-oop.37.1` (`96b1c2e6`) but staging CP was still on task def **:24** / image `lp-oop-flip-cp-20260818`.

This bead:

1. Built/pushed CP image tag `lp-zuh123-cp-s3-store-202608181240`  
   digest `sha256:48a80a87c3d192ffed0c2ccad0d271d560defdde5463f3b197edbe922b6f367c`
2. Registered + rolled **`lanyard-platform-staging-cp:25`**
3. Boot log: `vault_object_store configured=true assumed_role=true bucket_configured=true`

See `logs/cp-deploy.json`.

---

## Vault seed

| Field | Value |
|-------|-------|
| Bucket | `lanyard-mocklab-vault-123456789012` |
| Key | `tenants/319d3808-e533-44db-bfdf-7b6ef8caaae1/vault/Projects/Workspace/office/lp-zuh123-mint-proof.docx` |
| Portal path | `/Projects/Workspace/office/lp-zuh123-mint-proof.docx` |
| Source | `artifacts/ui/lp-uxy.15.10/sample-shipqa.docx` (lab fixture) |

---

## Residuals (honest — out of this bead)

1. **DocsAPI / browser editor host** — `lp-zuh.12.4` (HTTPS DS residual from `lp-zuh.12.2` may still block canvas).
2. **CP secret material** — recycle may wipe `/tmp` material store until `lp-oop.37.6` / durable path lands (known ops residual).
3. **First-create status is 201** — product contract; clients should accept 200/201.

---

## Re-run

```bash
# Auth: MOCKLAB_AGENT_* from gitignored .env.mocklab-agent-dev (never commit)
# Optional: artifacts/ui/.auth/mocklab-agent.json storage_state
python3 artifacts/mocklab/live-qa/onlyoffice-editor-go/run_office_mint_happy_path_probe.py
```

## Secret hygiene

- No passwords, JWT, CSRF, session, download tokens, or callback nonces written.
- `.env.mocklab-agent-dev` never copied into artifacts.
- `editor_config.token` recorded as presence-only (`token_present`).
- Document download URLs logged as host+path only (query stripped).
