# lp-zuh.10.7 — Projects primary_path + working directory defaults for MockLab

**Date:** 2026-08-14  
**Bead:** `lp-zuh.10.7`  
**Depends on:** `lp-zuh.9.5` (vault filesystem seed)

## Acceptance

| # | Criterion | Result |
|---|-----------|--------|
| 1 | ≥1 default project with `primary_path` under vault | **GO** — offline smoke + **live guest** `$BACKEND_HOME/projects.db` has `Workspace` → `/mnt/vault/Projects/Workspace` |
| 2 | Agent tools use that cwd for vault-relative work | **GO (contract + live path)** — Portal stamps selected project `primary_path` as `metadata.working_directory` / `project_vault_path`. Live guest: welcome.md readable under primary_path; health `lanyard-agent-gateway` ok |
| 3 | Live proof via projects API + chat | **GO (guest registry)** — live sandbox seed updated `workspace` primary_path to vault; list-only shows non-empty. **Browser** Directory + chat stamp remains `needs_ui_qa` (Cognito SPA auth not exercised in this agent run) |

## Root cause

| Layer | Before | After |
|-------|--------|-------|
| Vault FS (`lp-zuh.9.5`) | `Projects/Workspace/` + `.seed/default-projects.json` | unchanged |
| LA boot `seedDefaultProject` | `primary_path=$BACKEND_HOME/workspace` (ephemeral) | no-ops when store already non-empty |
| Platform entrypoint | no projects.db seed | `ensure_default_projects` seeds vault path **before** gateway exec |
| Live residual (`lp-zuh.7.6`) | `projects.list` empty / wrong cwd | product default closes gap after bake or guest re-seed |

## Implementation

| Path | Role |
|------|------|
| `deploy/daytona/agent-gateway/seed-default-projects.py` | Idempotent SQLite seeder (create / repair primary_path) |
| `deploy/daytona/agent-gateway/entrypoint.sh` → `ensure_default_projects` | Cold-start product default |
| `deploy/daytona/agent-gateway/Dockerfile` | COPY seed helper into image |
| `deploy/scripts/seed-mocklab-agent-projects.sh` | Operator wrapper (guest or monorepo) |
| `deploy/scripts/smoke-seed-mocklab-agent-projects.sh` | Offline smoke |
| `deploy/artifacts/mocklab-vault-seed/.seed/default-projects.json` | Vault document (bead `lp-zuh.10.7`) |

## Offline checks

```bash
bash deploy/scripts/smoke-seed-mocklab-agent-projects.sh
bash deploy/daytona/agent-gateway/smoke-entrypoint.sh
```

Expected:

- projects.db has `workspace` with `primary_path` under `VAULT_ROOT/Projects/Workspace`
- entrypoint happy path logs `default projects seed OK`
- re-run is idempotent; wrong ephemeral path is repaired

## Live MockLab guest apply (2026-08-14)

| Field | Value |
|-------|--------|
| Sandbox | `32d6e20f-3c8e-4141-b20e-a11c514f5ba2` (started) |
| Tenant | `319d3808-e533-44db-bfdf-7b6ef8caaae1` |
| Method | Daytona toolbox `process/execute` (no secrets in artifacts) |
| Before | `projects.db` existed; Workspace `primary_path` was **not** vault (LA default `$BACKEND_HOME/workspace`) |
| Action | Upload + run `seed-default-projects.py` with vault `.seed/default-projects.json` |
| After | `updated: workspace id=p_e01d297b → /mnt/vault/Projects/Workspace` |
| Folders | primary folder row matches vault path |
| Health | `{"ok":true,"service":"lanyard-agent-gateway"}` |
| Read | `/mnt/vault/Projects/Workspace/welcome.md` (seed marker `lp-zuh.9.5`) |

Logs (sanitized): `live-seed.json`, `live-guest-projects.txt`, `live-probe.json`

### Operator re-apply (pre-bake image)

```bash
# Post-bake (helper in image):
python3 /usr/local/lib/lanyard/seed-default-projects.py \
  --backend-home "${BACKEND_HOME:-/var/lib/company-brain-backend}" \
  --vault-root "${VAULT_ROOT:-/mnt/vault}"

# Pre-bake: toolbox-copy monorepo seeder (this run) or wait for snapshot bake.
# Portal: GET /api/agent/projects → ≥1; select Workspace; chat stamp working_directory
```

## Working directory stamp (Portal — already landed)

- Thread create with `project_id` → `project_vault_path = primary_path`
- Inbound events carry `metadata.working_directory` + `metadata.project_vault_path`
- Host enforces tool path ACL under that tree

## Residuals

| Item | Owner |
|------|--------|
| Snapshot bake + pin so entrypoint ships to MockLab | agent-gateway image pipeline / `lp-zuh.10.9` or bake bead |
| Browser Directory + chat stamp re-QA | `needs_ui_qa` (this bead) |
| Optional LA change: seedDefaultProject prefer vault Workspace | external `lanyard-agent` (nice-to-have; platform pre-seed sufficient) |

## New-tenant checklist

`artifacts/mocklab/live-qa/NEW-TENANT-CHECKLIST.md` §4.4 promoted to **R** for MockLab kitchen-sink with seed levers above.
