# CRM pipeline hygiene (DB ↔ vault buckets)

Execute when the user replies **YES** (or equivalent) to **weekly-crm-refresh** section *CRM hygiene notes*, or when they ask to align `pipeline_stage` with folder buckets.

## Canonical stages

`clients_crm.db.pipeline_stage` must match folder bucket names:

`Active | Discovery | Prospect | Graveyard`

Legacy `Lead` in the DB breaks reporting — migrate to the bucket that matches the client folder on disk (or engagement level if user approved a bump).

## Procedure

### 1. Inventory

```bash
find <VaultRoot>/Clients -maxdepth 2 -type d | sort
sqlite3 <VaultRoot>/Clients/clients_crm.db \
  "SELECT name, pipeline_stage FROM clients ORDER BY name;"
```

Compare `Clients/<Bucket>/<Client>/` paths to DB rows. Note:

- DB name may differ from folder slug (e.g. `Example Org` vs `ExampleOrg`, `Example Capital` vs `ExampleCapital`).
- Duplicate folders (e.g. Discovery + Prospect stubs) — keep canonical path in `INDEX.md`; stub `AGENTS.md` should point to canonical.

### 2. Batch-update DB stages

Map each client **name** (as in DB) to its **folder bucket**, then:

```bash
DB=<VaultRoot>/Clients/clients_crm.db
sqlite3 "$DB" "UPDATE clients SET pipeline_stage='Active', updated_at=datetime('now') WHERE name IN ('AcmeCo','AcmeActive');"
# Repeat per bucket for Discovery / Prospect / Graveyard sets derived from disk + approved bumps.
sqlite3 "$DB" "SELECT COUNT(*) FROM clients WHERE pipeline_stage='Lead';"  # expect 0
```

Engagement bump (example): post-workshop **AcmeCo** — user/cron approved **Discovery** while folder was **Prospect/** → set DB to Discovery, `mv Prospect/AcmeCo Discovery/AcmeCo`, update client `AGENTS.md` + `RECALL.md` ingest path + `INDEX.md`.

### 3. Sync client AGENTS.md pipeline fields

For each touched client, set **Pipeline Stage** / **CRM pipeline stage** / **Folder bucket** to match DB and disk.

### 4. Native Granola policy sweep

Replace stale “delegate to Codex/Grok” lines in **bucket-level** `Clients/<Bucket>/<Client>/AGENTS.md` only (not workshop HTML, not historical notes unless asked).

Run:

```bash
python3 ~/.hermes/skills/crm/client-crm-organization/scripts/bulk-fix-granola-agents-md.py
```

Canonical instruction line:

`- Use native \`mcp_granola_*\` for meeting notes (see \`Clients/AGENTS.md\`).`

See `references/native-tools-policy.md`.

### 5. INDEX.md

Update ASCII tree when:

- Client moved between buckets
- New folder on disk missing from map (e.g. `ExampleAdvisors`, `ExampleAI`)
- Redirect stubs documented

Add one-line rule under DB sync: avoid legacy `Lead` in reporting.

### 6. Finish

```bash
cd <VaultRoot> && ob sync
```

If a second `ob sync` returns *“Another sync instance is already running”*, the first run likely succeeded — do not treat as a failed hygiene pass.

Optional: `mempalace mine` for wings whose ingest path changed.

## Out of scope unless user asks

- Editing old meeting notes that mention “processed by Codex”
- Adding DB rows for folder-only clients (e.g. `ExampleAI` with no `clients` row)
- Removing orphan paths (e.g. legacy `Clients/AcmeCo/` without bucket)