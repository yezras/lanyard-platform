# Control-plane DB: SQLite → Postgres migration & rollback (G4.2)

Private Portal product docs for moving control-plane data from **legacy SQLite** (`CONTROL_PLANE_DB_PATH` / better-sqlite3) to **Postgres** (`CONTROL_PLANE_DATABASE_URL` / `DATABASE_URL`).

| Gate | Repo / PR | What it owns |
|------|-----------|--------------|
| **G4.1** | Portal [PR #15](https://github.com/LanyardBrain/Portal/pull/15) `feat/g4.1-control-plane-postgres` | Product store on `pg`; schema migrate on startup; no SQLite driver |
| **G4.2** | This doc + `scripts/migrate-sqlite-to-postgres.mjs` | One-shot **data** copy, backups, rollback procedure, dry-run proof |
| **G4.3** | company-brain-deploy (later) | Deploy-owned RDS/Postgres module — **not** this change |

**Honesty:** After G4.1 merges, the product is **Postgres-only**. Rollback is primarily **Postgres restore**, not “switch back to SQLite,” unless you deliberately redeploy a **pre-G4.1** control-plane image and still have the SQLite file.

**Secrets:** Never commit connection URLs, passwords, or plaintext relay secrets. Inject `CONTROL_PLANE_DATABASE_URL` / `DATABASE_URL` from a secret store. This doc and the migration script never log credentials or secret material (only row counts and table names).

---

## Scope of data

Control plane stores **metadata and credentials hashes only** — never chat bodies, canonical Company Brain file bodies, or plaintext relay secrets (show-once at register/rotate). Vault content stays on the customer host via Brain RPC (deploy `references/brain-rpc-contract.md` §1.1). Full ownership/FK/RLS inventory: [control-plane-schema-boundary.md](./control-plane-schema-boundary.md) (cbd-mta.3.1).

| Table | Notes |
|-------|--------|
| `tenants` | Slug, display name, retention, relay tier |
| `users` | Email, password hash/salt, optional `google_sub` |
| `gateway_instances` | Instance identity + **scrypt hashes** (and optional previous-hash during rotation grace) |
| `audit_log` | Action metadata JSON only |
| `roles`, `role_path_prefixes`, `user_roles` | RBAC (same-tenant trigger on memberships) |
| `projects` | Project tree / vault **paths** (not file bodies) |
| `session_share_grants` | Session share grants (`thread_id` only) |

Schema DDL (greenfield) lives in G4.1 `packages/control-plane/src/migrate.ts` (`migrateControlPlaneSchema`). The one-shot script embeds the same table list and applies `CREATE IF NOT EXISTS` on the target before copy.

---

## Backup requirements

### Before any migration or cutover

| Artifact | How | Retention |
|----------|-----|-----------|
| **SQLite file copy** | Cold copy of `CONTROL_PLANE_DB_PATH` (stop writers or copy with `sqlite3 .backup`) | Keep until cutover + soak is accepted (min 7 days recommended for lab/staging) |
| **SQLite integrity** | `sqlite3 "$PATH" 'PRAGMA integrity_check;'` → `ok` | Record output in change ticket |
| **Row-count inventory** | `node scripts/migrate-sqlite-to-postgres.mjs --sqlite "$PATH" --dry-run` | Attach counts to ticket |
| **Postgres empty/target snapshot** | If target already has data: `pg_dump` before import | Same as SQLite backup window |
| **Post-migration Postgres dump** | `pg_dump --format=custom` (or plain SQL) of `portal_cp` (or prod DB name) | Primary rollback artifact after cutover |
| **App pin** | Record control-plane image digest / git SHA **before** and **after** G4.1 deploy | Required for image rollback |

### Backup commands (lab / staging patterns)

```bash
# --- SQLite (legacy) ---
SRC="${CONTROL_PLANE_DB_PATH:-./control-plane.db}"
cp -f "$SRC" "./control-plane.db.bak.$(date -u +%Y%m%dT%H%M%SZ)"
sqlite3 "$SRC" 'PRAGMA integrity_check;'

# Consistent online backup when CP may still be writing:
sqlite3 "$SRC" ".backup './control-plane.db.onlinebak'"

# --- Postgres (after G4.1 target exists) ---
# Prefer env from secret store; do not echo the URL.
export CONTROL_PLANE_DATABASE_URL  # postgres://… injected, not committed
pg_dump "$CONTROL_PLANE_DATABASE_URL" --format=custom -f "portal_cp.$(date -u +%Y%m%dT%H%M%SZ).dump"

# Restore example (destructive to target DB — confirm env first):
# pg_restore --clean --if-exists -d "$CONTROL_PLANE_DATABASE_URL" portal_cp.YYYYMMDD.dump
```

### Cloud / RDS (when G4.3 exists)

- Prefer automated snapshots + a **manual snapshot** immediately before migration maintenance window.
- Capture parameter group / engine version; restore is snapshot → new instance or in-place restore per AWS runbook.
- Still take an application-level `pg_dump` if you need portable logical rollback independent of AWS snapshot UX.

### What not to back up into git

- Any `*.db`, `*.dump`, connection strings, or copies under the repo tree that might be committed.
- Store backups in operator-controlled private storage (encrypted volume, S3 with SSE, etc.).

---

## Migration steps (SQLite / dev → Postgres)

### A. Greenfield (no SQLite data to keep)

Typical for new envs after G4.1:

1. Provision Postgres 16+ (local: `docker compose up -d postgres` from monorepo root on the G4.1 branch).
2. Inject `CONTROL_PLANE_DATABASE_URL=postgres://…` (lab compose defaults are **not** for production).
3. Start control-plane (G4.1+). Schema is applied on process start via `migrateControlPlaneSchema`.
4. Smoke: `curl -sf "$CP/health"`, create a tenant, register an instance (capture secret once into secret store).

No one-shot data script required.

### B. One-shot data migration (preserve existing SQLite)

Use when a lab, staging, or early private deploy still has a SQLite file and you are cutting over to G4.1 Postgres.

#### Prerequisites

- Node.js **22+** (monorepo engines; script uses `node:sqlite`).
- Root `pg` package available (`pnpm install` after this change; or G4.1 tree with `pg` in the workspace).
- Target Postgres reachable; prefer an **empty** database or accept idempotent `ON CONFLICT DO NOTHING` (existing PKs are skipped).
- SQLite file integrity_check = `ok`.
- Backups taken (table above).
- Maintenance window: stop control-plane writers (and BFF paths that mutate CP) for the copy, or accept that rows written after the SQLite snapshot are lost.

#### Procedure

```bash
# 1) Stop control-plane (and anything that writes CP) in the source env.
# 2) Backup SQLite (see above).

# 3) Ensure Postgres is up (lab example — G4.1 compose service):
docker compose up -d postgres
export CONTROL_PLANE_DATABASE_URL='postgres://portal:portal@127.0.0.1:5432/portal_cp'  # lab only

# 4) Dry-run: print source counts; no writes.
node scripts/migrate-sqlite-to-postgres.mjs \
  --sqlite "$CONTROL_PLANE_DB_PATH" \
  --dry-run

# 5) Apply schema + copy rows (idempotent inserts).
node scripts/migrate-sqlite-to-postgres.mjs \
  --sqlite "$CONTROL_PLANE_DB_PATH" \
  --database-url "$CONTROL_PLANE_DATABASE_URL"

# 6) Verify counts (script exits non-zero on mismatch).
node scripts/migrate-sqlite-to-postgres.mjs \
  --sqlite "$CONTROL_PLANE_DB_PATH" \
  --database-url "$CONTROL_PLANE_DATABASE_URL" \
  --verify-only

# 7) Post-migration Postgres dump (rollback artifact).
pg_dump "$CONTROL_PLANE_DATABASE_URL" --format=custom -f "portal_cp.post-migrate.dump"

# 8) Deploy / start G4.1+ control-plane with CONTROL_PLANE_DATABASE_URL only
#    (do not set CONTROL_PLANE_DB_PATH — unsupported after G4.1).

# 9) Functional smoke (staging or local):
#    GET /health
#    tenant by slug, login or OIDC path, internal validate for a known instance hash path
#    (plaintext secrets are NOT in the DB — hosts keep secrets in SSM / local env)
```

#### Ordering and semantics

- Insert order respects FKs: `tenants` → `users` / `gateway_instances` / `audit_log` → RBAC → `projects` (parents before children) → `session_share_grants`.
- Missing legacy columns (e.g. pre-rotation SQLite) get G4.1 defaults (`relay_tier=shared`, null previous-secret columns, etc.).
- **Idempotent:** re-running skips existing primary keys (`ON CONFLICT DO NOTHING`). It does **not** merge field-level updates to existing rows.
- **Projects:** multi-level trees are inserted in waves (null parent first, then children).
- Script never prints the database URL or row payloads for hash/salt columns.

#### Local compose mapping (G4.1)

| Item | Lab value |
|------|-----------|
| Image | `postgres:16-alpine` |
| User / password / DB | `portal` / `portal` / `portal_cp` |
| URL | `postgres://portal:portal@127.0.0.1:5432/portal_cp` |
| Env (CP) | `CONTROL_PLANE_DATABASE_URL` (preferred) or `DATABASE_URL` |

Production: inject URL from secret store; RDS module is **G4.3**.

---

## Rollback plan

Product after G4.1 is **Postgres-only**. Plan for three phases.

### Phase 0 — Before cutover (safest)

- Keep serving pre-G4.1 image with SQLite.
- Discard or wipe the unused Postgres DB if a practice migration was loaded.
- **No production impact.**

### Phase 1 — After data load, before traffic cutover

1. Do **not** point production traffic / BFF at the new CP deploy.
2. Optionally `DROP SCHEMA public CASCADE` + recreate (lab) or restore empty DB.
3. Fix issues; re-run migration from the frozen SQLite backup.

### Phase 2 — After traffic cutover (G4.1+ live on Postgres)

**Primary rollback (preferred):** restore Postgres from the **post-migration** or **pre-incident** dump/snapshot, keep G4.1+ app:

```bash
# Example logical restore (maintenance window; CP stopped):
pg_restore --clean --if-exists -d "$CONTROL_PLANE_DATABASE_URL" portal_cp.post-migrate.dump
# Start control-plane (G4.1+) again; smoke /health + auth + instance validate.
```

**Secondary rollback (pre-G4.1 image only):** only if you still have:

1. Pre-G4.1 control-plane image digest, and  
2. Unmodified SQLite backup from before cutover, and  
3. Acceptance that any Postgres-only writes after cutover are lost.

Then: redeploy pre-G4.1 image, set `CONTROL_PLANE_DB_PATH` to the restored file, unset Postgres URL. **Not available** once pre-G4.1 images are retired.

### What rollback does **not** do

- Reconstruct plaintext relay secrets from the DB (only hashes are stored). Host/SSM secrets remain the source of runtime gateway auth.
- Automatically reverse app deploys — pair DB restore with the matching image pin.
- Cross-restore SQLite from Postgres without a dedicated export (not provided; product path is Postgres-forward).

### Staging rollback “tested” (no live staging required)

Acceptance for G4.2 allows **dry-run procedure + local script proof** when a shared staging env is unavailable:

1. Run `bash scripts/test-migrate-sqlite-to-postgres.sh` (creates temp SQLite, migrates into local Postgres, verifies counts, exercises dry-run + verify-only, leaves evidence in logs).
2. Operator dry-run checklist (tick in change ticket):

   - [ ] SQLite backup + integrity_check documented  
   - [ ] `--dry-run` counts captured  
   - [ ] Migrate + `--verify-only` exit 0  
   - [ ] `pg_dump` post-migrate artifact stored off-git  
   - [ ] Rollback drill: restore dump into a **scratch** database and `SELECT` count(*) per table  
   - [ ] Confirm G4.1 app boots against restored DB (`CONTROL_PLANE_DATABASE_URL` only)

---

## Failure modes & mitigations

| Failure | Mitigation |
|---------|------------|
| Partial copy / FK error | Script runs schema first; ordered inserts; failed run leaves partial data — wipe target or rely on `ON CONFLICT` re-run after fix |
| Writers continued during copy | Stop CP; use `.backup`; re-copy from frozen file |
| Count mismatch on verify | Do not cut over; compare missing PKs; restore target from empty + re-migrate |
| G4.1 app rejects URL | Ensure `postgres://` URL (not `file:` / `.db`); see G4.1 `resolveDatabaseUrl` |
| Auth breaks after migrate | Password/OIDC hashes copy as-is; check tenant_id/email uniqueness and google_sub index |
| Relay validate fails | Secrets are not in DB; confirm host still presents same secret; hashes must match migrated `secret_hash`/`secret_salt` |

---

## Operator checklist (copy into change ticket)

```text
[ ] G4.1 control-plane image/digest known
[ ] SQLite path + integrity_check=ok
[ ] SQLite cold copy stored off-git
[ ] CONTROL_PLANE_DATABASE_URL injected from secret store (not chat/git)
[ ] Maintenance window: CP writers stopped
[ ] migrate --dry-run counts attached
[ ] migrate apply exit 0
[ ] migrate --verify-only exit 0
[ ] pg_dump post-migrate stored off-git
[ ] G4.1 CP /health OK
[ ] Auth smoke (password and/or Google path)
[ ] Instance validate path OK for known host
[ ] Rollback owner + dump path identified
[ ] Soak period before deleting SQLite backup
```

---

## Script reference

| Path | Purpose |
|------|---------|
| [`scripts/migrate-sqlite-to-postgres.mjs`](../scripts/migrate-sqlite-to-postgres.mjs) | One-shot schema ensure + data copy / dry-run / verify |
| [`scripts/test-migrate-sqlite-to-postgres.sh`](../scripts/test-migrate-sqlite-to-postgres.sh) | Local proof: seed SQLite → migrate → verify → optional restore drill |

```text
node scripts/migrate-sqlite-to-postgres.mjs --help
```

Environment (alternative to flags):

| Variable | Role |
|----------|------|
| `CONTROL_PLANE_DB_PATH` / `SQLITE_PATH` | Source SQLite file |
| `CONTROL_PLANE_DATABASE_URL` / `DATABASE_URL` | Target Postgres URL (never commit) |

---

## Related

- G4.1 product Postgres: Portal PR #15 / `packages/control-plane` (`db.ts`, `migrate.ts`, README “Local Postgres”)
- Deploy RDS module: company-brain-deploy **G4.3** (blocked until product Postgres lands)
- Relay secret lifecycle (plaintext never in DB): company-brain-deploy `references/runbooks/relay-secret-lifecycle.md`
