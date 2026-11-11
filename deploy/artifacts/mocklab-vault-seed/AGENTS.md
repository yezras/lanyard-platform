# AGENTS.md — MockLab vault seed

<!-- mocklab-vault-seed:lp-zuh.9.5 -->

This is the **MockLab Daytona** durable vault root (`VAULT_ROOT=/mnt/vault`,
S3 prefix `tenants/{tenant_id}/vault/`).

## Do this first

1. Read `INDEX.md` and this file before substantive work.
2. Prefer project work under `Projects/Workspace/` (default chat cwd /
   `primary_path` target for Directory).
3. Skills live under `skills/` (`skills_roots: [/mnt/vault/skills]`).
4. Workflow definitions under `workflows/` when not using builtins.
5. Durable cron / mempalace / workflow run state also under this vault root
   (see kitchen-sink `config.yaml` — harness BACKEND_HOME, lp-oop.38.18).

## Operating rules

- Synthetic lab content only — no real customer data or secrets.
- Agent-primary vault; Portal Vault UI lists this tree when mount is healthy.
- Idempotent seed gate: presence of this `AGENTS.md` skips re-seed
  (`deploy/scripts/seed-mocklab-s3-vault.sh`, control-plane `bootstrapTenantVaultSeed`).
- Do not delete `.seed/` provenance.

## Folder spine

| Path | Purpose |
|------|---------|
| `Projects/Workspace/` | Default project primary_path |
| `skills/` | Discoverable skill packages (`SKILL.md`) |
| `workflows/` | Workflow definition root (`research-lite.yaml`) |
| `config.yaml` | Kitchen-sink harness flags (subagents, workflow, mempalace, cron, catalog_search) |
| `Knowledge/` | Lab knowledge scaffold |
| `cron/` | Durable cron state dir (product) |
| `mempalace/` | Durable MemPalace path |
| `mcp/` | Vault-required stdio MCP (`vault_fs_server.py`). Daytona process session, not toolbox execute. |
