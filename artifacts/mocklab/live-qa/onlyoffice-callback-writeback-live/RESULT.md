# lp-zuh.13.1 — Redeploy MockLab CP+BFF and prove OnlyOffice callback writeback live

**Bead:** `lp-zuh.13.1`  
**Parent epic:** `lp-zuh.13` — OnlyOffice live editor unblock (HTTPS DS + writeback)  
**When (UTC):** 2026-08-19T11:50:51Z  
**Base URL:** `https://app.withlanyard.com/mocklab`  
**Verdict:** **`GO_LIVE_WRITEBACK`**

No secrets in this package (no passwords, JWT, CSRF, download tokens, callback nonces, or SM values).

Closes the live residual left by `lp-zuh.12.7` / PR #525 after operator redeploy of CP + BFF.

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Redeploy staging CP + BFF with `VAULT_PLANE=cp_s3` and `BFF_OFFICE_VAULT_EDIT=true` for MockLab | **GO** — force-new-deployment both services at `2026-08-19T11:45:04Z`; env confirmed on task defs |
| 2 | Edit mint → callback status 2 → new `DocumentRevision` on vault path | **GO** — mint **201**; status 2 **200** `saved`; vault content-hash advanced and matched assembled bytes; `document.key` advanced |
| 3 | Evidence under `artifacts/mocklab/live-qa/onlyoffice-callback-writeback-live/` | **GO** — this package |
| 4 | Fail-closed when edit flag false still holds | **GO** — vitest `office-editor-config` **403** without `vault_edit`; product default remains omit/`false` (MockLab lab stays `true`) |

---

## Redeploy

| Service | Cluster | Task def | Image tag | Digest (short) | Rollout |
|---------|---------|----------|-----------|----------------|---------|
| CP | `lanyard-platform-staging-portal-cp` | `…-cp:26` | `lp-oop37-cp-43e10186` | `a4ceafd9…` | COMPLETED (new task ~11:45:43Z) |
| BFF | `lanyard-platform-staging-portal` | `…-bff:34` | `lp-oop37-f353341e` (#525) | `638a0295…` | COMPLETED (new task ~11:45:57Z) |

| Env (BFF task def) | Value |
|--------------------|-------|
| `VAULT_PLANE` | `cp_s3` |
| `BFF_OFFICE_VAULT_EDIT` | `true` |

Images already carried #525 (`f353341e`) / post-#525 HEAD (`43e10186`). This bead **force-redeployed** both services and re-proved live writeback (pre-redeploy residual was `write_unavailable` in `lp-zuh.12.5`).

AWS profile: `lanyard-main` (account `123456789012`).

---

## Live signals

| Signal | Evidence |
|--------|----------|
| Auth | password+CSRF → `GET /api/auth/me` **200** |
| `ui.can.vault_edit` | **true**; `vault_plane=cp_s3` |
| Mint edit | **201** JSON; `editorConfig.mode=edit`; `permissions.edit=true` |
| Callback status 1 | **200** `{"error":0,"code":"ignored"}` |
| Callback status 2 | **200** `{"error":0,"code":"saved"}` (was **503** `write_unavailable` pre-redeploy) |
| Vault sha256 before | `282cf8fc…7365fcd` (1368 bytes) |
| Assembled DS body sha256 | `b5bea41b…67e12b` (Docs ALB `/healthcheck`) |
| Vault sha256 after | `b5bea41b…67e12b` (**matches** assembled; size 4) |
| `document.key` prefix | `030c1a3fba44` → `013a352dda02` (changed) |
| Restore | S3 backup/restore of vault object; post-restore sha256 matches before |

**Revision honesty:** OnlyOffice callback HTTP body is `{error,code}` only. `DocumentRevision` (`kind=content_hash`) is the sha256 of vault bytes — proved by vault content hash advance + remint `document.key` change.

Assembled-file URL used the staging Docs ALB `/healthcheck` (allowlisted host) only to exercise fetch→CP put; body bytes are not claimed as Office content. Original `.docx` restored via S3 after the probe.

---

## Fail-closed (edit flag false)

| Surface | Evidence |
|---------|----------|
| Vitest | `office-editor-config.test.ts` — **403** when edit requested without `vault_edit` (`missing_write_capability`) |
| Vitest | `office-cp-s3-callback-writer.test.ts` — **6** passed (CP put → new revision; createApp wire) |
| Totals | **31** passed (`logs/bff-failclosed-writeback-vitest.txt`) |
| Live MockLab | Flag **intentionally true** for lab writeback; product default elsewhere remains omit/`false` |

Do **not** flip live `BFF_OFFICE_VAULT_EDIT` to false for this proof — that would break lab edit mint. Fail-closed is the code/default path.

---

## Re-run

```bash
export AWS_PROFILE=lanyard-main AWS_REGION=us-east-1
# Auth: MOCKLAB_AGENT_* from gitignored .env.mocklab-agent-dev (never commit)
set -a; source .env.mocklab-agent-dev; set +a

# Optional re-redeploy:
# aws ecs update-service --cluster lanyard-platform-staging-portal-cp \
#   --service lanyard-platform-staging-cp --force-new-deployment
# aws ecs update-service --cluster lanyard-platform-staging-portal \
#   --service lanyard-platform-staging-bff --force-new-deployment

python3 artifacts/mocklab/live-qa/onlyoffice-callback-writeback-live/run_live_writeback_probe.py

cd portal && pnpm --filter @lanyard/bff... build
pnpm --filter @lanyard/bff exec vitest run \
  test/office-editor-config.test.ts \
  test/office-cp-s3-callback-writer.test.ts
```

## Secret hygiene

- No passwords, JWT, CSRF, session, download tokens, or callback nonces written.
- `.env.mocklab-agent-dev` never copied into artifacts.
- S3 vault backup binary gitignored under `logs/`.
- `editor_config.token` / callback query recorded as presence-only.
