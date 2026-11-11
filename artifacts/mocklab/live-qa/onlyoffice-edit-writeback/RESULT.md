# lp-zuh.12.5 — Lab edit writeback optional: `BFF_OFFICE_VAULT_EDIT` + callback roundtrip

**Bead:** `lp-zuh.12.5`  
**Parent epic:** `lp-zuh.12` — OnlyOffice MockLab/staging editor GO  
**When (UTC):** 2026-08-18T13:58:30Z  
**Base URL:** `https://app.withlanyard.com/mocklab`  
**Verdict:** **`PASS_FLAG_CALLBACK_ROUTE__WRITE_UNAVAILABLE`**

No secrets in this package (no passwords, JWT, CSRF, download tokens, callback nonces, or SM values).

Not required for view-only editor GO (`lp-zuh.12` view path remains independent).

---

## Acceptance map

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Enable `BFF_OFFICE_VAULT_EDIT` for MockLab lab only (fail-closed default stays false elsewhere) | **GO** — live `ui.can.vault_edit=true`; product default remains omit/`false` (see ops docs) |
| 2 | Edit → callback → `vault.write` CAS proof | **PARTIAL** — edit mint **201** + callback status **1** `ignored`; status **2** → **`write_unavailable`** on MockLab short-stack. **Mechanical CAS** still **GO** via BFF vitest lab roundtrip (`office-lab-roundtrip` / `office-callback`, 44 passed). Live durable write → follow-up **`lp-zuh.12.7`** |
| 3 | Document ops toggle / SM env | **GO** — staging runbook §7 + operate runbook + `onlyoffice-mocklab-go-path.md` §13 (plain env vs SM JWT) |
| 4 | Evidence roundtrip RESULT | **GO** — this package |

---

## Live signals

| Signal | Evidence |
|--------|----------|
| Auth | `GET /api/auth/me` **200** |
| `ui.can.vault_edit` | **true** (`BFF_OFFICE_VAULT_EDIT=true` on staging BFF) |
| Mint edit | **201** JSON; `editorConfig.mode=edit`; `permissions.edit=true`; callback query has `session_id` + `nonce` (presence only) |
| Callback status 1 | **200** `{"error":0,"code":"ignored"}` |
| Callback status 2 | **503** `{"error":1,"code":"write_unavailable"}` after allowlisted DS host fetch |
| Lab CAS (fixture) | vitest: DOCX/XLSX open → status-2 writeback → new revision (`logs/bff-office-cas-vitest.txt`) |

---

## Residual: why status 2 is `write_unavailable`

MockLab BFF office callback default writer calls Brain RPC `vaultHandlers.writeCallback`. Lanyard Agent / short-stack does **not** advertise a durable `vault.write` for this path. `VaultPlane=cp_s3` today exposes CP HTTP **list/stat/get** only (`lp-oop.9`) — **no put/CAS** and no `createCpS3OfficeCallbackVaultWriter`.

Follow-up: **`lp-zuh.12.7`** — CP vault put + BFF `cp_s3` office callback writer + live MockLab status-2 → new `DocumentRevision`.

Assembled-file URL in this probe used the staging Docs ALB `/healthcheck` (allowlisted host) only to exercise fetch→write; body bytes are not claimed as Office content.

---

## Ops toggle (summary)

| Knob | Store | MockLab lab writeback | Default elsewhere |
|------|-------|------------------------|-------------------|
| `BFF_OFFICE_VAULT_EDIT` | **Plain ECS/tfvars env** (not SM) | `"true"` | omit / `"false"` (fail-closed) |
| `BFF_OFFICE_JWT_SECRET` | **Secrets Manager** (same ARN as DS `JWT_SECRET`) | required for mint | required when Office on |
| `BFF_OFFICE_PUBLIC_BASE_URL` | plain env | DS→BFF download/callback base | when DS on |
| `BFF_OFFICE_DOCUMENT_SERVER_HOSTS` | plain env | Docs hostname + ALB DNS | when DS on |

Rollback: set `BFF_OFFICE_VAULT_EDIT=false` (or omit) + force-new-deployment BFF. Chat previews keep working.

Normative: [staging-document-server.md §7](../../../../deploy/references/runbooks/staging-document-server.md) · [onlyoffice-mocklab-go-path.md §5/§13](../../../../docs/plans/0008-daytona-agent-sandboxes/onlyoffice-mocklab-go-path.md)

---

## Re-run

```bash
# Auth: MOCKLAB_AGENT_* from gitignored .env.mocklab-agent-dev (never commit)
# Optional: artifacts/ui/.auth/mocklab-agent.json storage_state
python3 artifacts/mocklab/live-qa/onlyoffice-edit-writeback/run_edit_writeback_probe.py

# Mechanical CAS (fixture vault writer — no live AWS):
cd portal && pnpm --filter @lanyard/bff... build
pnpm --filter @lanyard/bff exec vitest run \
  test/office-callback.test.ts test/office-lab-roundtrip.integration.test.ts
```

## Secret hygiene

- No passwords, JWT, CSRF, session, download tokens, or callback nonces written.
- `.env.mocklab-agent-dev` never copied into artifacts.
- `editor_config.token` / callback query recorded as presence-only.
