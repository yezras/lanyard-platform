# lp-zuh.12.7 — MockLab office callback writeback: CP vault put + BFF cp_s3 writer

**Bead:** `lp-zuh.12.7`  
**Parent epic:** `lp-zuh.12` — OnlyOffice MockLab/staging editor GO  
**When (UTC):** 2026-08-18T14:32:00Z  
**Verdict:** **`PASS_LOCAL_CAS__LIVE_NEEDS_REDEPLOY`**

No secrets in this package (no passwords, JWT, CSRF, download tokens, callback nonces, or SM values).

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | CP HTTP vault put (or equivalent) with etag/CAS under tenant prefix; no `@aws-sdk` in BFF | **GO** — `PUT /internal/tenants/:tenantId/vault/put`; `if_match` accepts etag **or** content_hash; cross-tenant prefix 403; FakeS3 vitest |
| 2 | BFF wires `officeCallbackVaultWriter` when `VAULT_PLANE=cp_s3` | **GO** — `createCpS3OfficeCallbackVaultWriter` in `portal/packages/bff/src/index.ts` + `app.ts` selection |
| 3 | Live MockLab: edit mint → callback status 2 → new `DocumentRevision` on vault path | **BLOCKED on operator redeploy** — code not yet on live ECS; pre-deploy residual remains `write_unavailable` until CP+BFF ship this branch |
| 4 | Fail-closed when `BFF_OFFICE_VAULT_EDIT=false` | **GO** — unchanged mint/capability gate (`officeCanVaultEdit` / env parse); product default omit/`false` |
| 5 | Evidence under `artifacts/mocklab/live-qa/` (no secrets) | **GO** — this package |

---

## Mechanical proof (local)

| Surface | Evidence |
|---------|----------|
| CP put + CAS | `portal/packages/control-plane` vitest `test/vault-http.test.ts` — 25 passed (`logs/cp-vault-http-vitest.txt`) |
| BFF cp_s3 writer | vitest `test/office-cp-s3-callback-writer.test.ts` — 6 passed (FakeS3 CP put → new revision; createApp wire; conflict map) |
| Regression | `office-callback` + `office-lab-roundtrip` — 44 passed (`logs/bff-office-cp-s3-writer-vitest.txt`) |
| No BFF AWS SDK | catalog asserts `@aws-sdk/client-s3` absent from BFF deps; writer source has no `@aws-sdk` import |

### CAS shape

- Mint revision remains **content_hash** (sha256 of vault bytes).
- CP `replace_if_match` accepts `if_match` equal to **content_hash** or store **etag**.
- Success returns `revision: { token, kind: "content_hash", size_bytes, modified_at }` + optional `etag`.
- Mismatch → **409** `VAULT_REVISION_CONFLICT`.

---

## Live MockLab residual (honest)

Until this PR is merged and **control-plane + BFF** are force-redeployed on MockLab staging:

| Signal | Pre-deploy (from `lp-zuh.12.5`) |
|--------|----------------------------------|
| `BFF_OFFICE_VAULT_EDIT` | **true** |
| Edit mint | **201** |
| Callback status 2 | **503** `write_unavailable` (Brain RPC writer; no CP put yet on live) |

**Operator after merge:**

1. Deploy CP (exposes `vault/put`) + BFF (`VAULT_PLANE=cp_s3` already; picks up `createCpS3OfficeCallbackVaultWriter`).
2. Keep `BFF_OFFICE_VAULT_EDIT=true` on MockLab lab only.
3. Re-run: `python3 artifacts/mocklab/live-qa/onlyoffice-edit-writeback/run_edit_writeback_probe.py` (or extend for revision assert).
4. Expect status 2 → **200** `saved` with new `DocumentRevision` token ≠ base.

---

## Files (implementation)

| Area | Path |
|------|------|
| CP put/CAS | `portal/packages/control-plane/src/vault-http.ts` |
| CP route | `portal/packages/control-plane/src/app.ts` |
| BFF writer | `portal/packages/bff/src/office/cp-s3-callback-writer.ts` |
| BFF wire | `portal/packages/bff/src/index.ts`, `app.ts`, `types.ts` |
| Tests | `control-plane/test/vault-http.test.ts`, `bff/test/office-cp-s3-callback-writer.test.ts` |

## Secret hygiene

- No passwords, JWT, CSRF, session, download tokens, or callback nonces written.
- Vitest logs may include opaque `office_session_id` (not a capability secret); no nonces in this package.
