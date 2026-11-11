# lp-zuh.9.6 — Re-QA durable surfaces after mount (vault write, workflow, cron state_dir)

**Bead:** `lp-zuh.9.6`  
**When:** 2026-08-14T17:08:23Z  
**Method:** live Daytona toolbox guest exec on MockLab sandbox + external `aws s3` durability  
**Base product URL:** `https://app.withlanyard.com/mocklab` (UI re-QA residual — see below)  
**Verdict:** **PASS** (guest + S3 durable surfaces)

## Acceptance

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Vault write of a note under `/mnt/vault` | **GO** — GPU note written as `brain` + durable on S3 |
| 2 | Workflow `state_dir` under vault (no mkdir EACCES) | **GO** — `mkdir` + write under `/mnt/vault/workflows/…/state` |
| 3 | Cron `state_dir` under vault | **GO** — `/mnt/vault/cron/jobs.json` present; probe write OK |
| 4 | Config kitchen-sink vault paths only | **GO** — `vault_root` / `cron.state_dir` / `workflow.state_dir` / `mempalace.path` / `skills_roots` / `definition_roots` under `/mnt/vault`; session sqlite process-local only |
| 5 | Evidence under `artifacts/mocklab/live-qa/post-mount/` | **GO** — this file + `REPORT.json` + `logs/` |

Also: mount is `mountpoint-s3` (not empty root stub); seed from `lp-zuh.9.5` visible (`AGENTS.md`, `Projects/Workspace/welcome.md`, skills).

## Env checklist (no secrets)

| Key | Value / presence |
|-----|------------------|
| Operator AWS profile | `lanyard-main` (account `123456789012`) |
| Daytona org | present (SM / ops env; not committed) |
| Tenant | `319d3808-e533-44db-bfdf-7b6ef8caaae1` |
| Instance | `452b1348-772a-49d0-8038-a410eda8accf` |
| Sandbox (started for re-QA) | `32d6e20f-3c8e-4141-b20e-a11c514f5ba2` |
| Snapshot | `lanyard-la-main-508b0b736ad5-mounts3-zuh94-20260814` (`41e87f4d-…` pin from 9.4) |
| Vault bucket | `lanyard-mocklab-vault-123456789012` |
| Vault prefix | `tenants/319d3808-e533-44db-bfdf-7b6ef8caaae1/vault/` |
| Secrets in this report | `False` |

## Live results (guest)

### Mount + writability

```text
uid=990(brain) gid=990(brain)
/mnt/vault  mountpoint-s3  fuse  rw,...,user_id=990,group_id=990,...,allow_other
WRITABLE_YES
```

Log: `logs/01-mount.txt`

### Seed (post lp-zuh.9.5)

- `AGENTS.md` present
- `Projects/Workspace/welcome.md` readable (seed marker `mocklab-vault-seed:lp-zuh.9.5`)
- `skills/`, `workflows/`, `cron/`, `mempalace/` present

Log: `logs/02-seed.txt`

### 1) Vault write note

Guest path:

`/mnt/vault/Projects/Workspace/notes/lp-zuh96-gpu-note-20260814T170823Z.md`

Marker: `lp-zuh.9.6-vault-write`  
Guest: `WRITE_OK` as uid `brain`  
S3 object: same key under tenant vault prefix (246 bytes) — content match

Logs: `logs/03-vault-write.txt`, `logs/08-s3-durability.txt`

### 2) Workflow state_dir (no EACCES)

```text
mkdir -p /mnt/vault/workflows/lp-zuh96-run-20260814T170823Z/state
→ probe.txt written; WORKFLOW_MKDIR_OK
S3: …/workflows/lp-zuh96-run-20260814T170823Z/state/probe.txt
```

Log: `logs/04-workflow-mkdir.txt`

### 3) Cron state_dir

```text
/mnt/vault/cron/jobs.json present (existing)
.lp-zuh96-probe written; CRON_STATE_OK
S3: …/cron/.lp-zuh96-probe + jobs.json
```

Log: `logs/05-cron-state.txt`

### 4) Kitchen-sink config vault paths only

Config: `/var/lib/company-brain-backend/config.yaml`

| Surface | Path |
|---------|------|
| `vault_root` | `/mnt/vault` |
| `skills_roots` | `/mnt/vault/skills` |
| `mempalace.path` | `/mnt/vault/mempalace` |
| `cron.state_dir` | `/mnt/vault` |
| `workflow.state_dir` | `/mnt/vault` |
| `workflow.definition_roots` | `/mnt/vault/workflows` |
| `session.sqlite_path` (process-local OK) | `/var/lib/company-brain-backend/state/sessions.db` |

- Hybrid durable residual: **NO** (`HYBRID_RESIDUAL_NO`; path audit `non_vault_path_candidates []`)
- EACCES on workflows/cron/notes/mempalace mkdir: **NONE**

Logs: `logs/06-config.txt`, `logs/06b-config-grep.txt`, `logs/06c-path-audit.txt`, `logs/07-eacces.txt`

## Machine report

`REPORT.json` — all acceptance checks `true` except hybrid residual `false` (desired).

## UI / Playwright residual

| Surface | Status |
|---------|--------|
| Vault UI tree + open `welcome.md` | **Residual** — headless Playwright not installed in implementer env; SPA routes HTML for bare `/api/*` without browser session |
| Chat read seeded file / NL vault write | **Residual** — same; product path still available for UIQA |
| Harness | Unmerged `lp-zuh.7.1` PR #438 (`artifacts/mocklab/live-qa/harness/`); optional re-run when harness lands on main |

`needs_ui_qa=true` for browser proof of Vault pane listing the seed + post-mount note. Guest+S3 is the durable-surface SoT for this bead.

## Residuals (out of scope / follow-up)

- `lp-zuh.10.5` — live research-lite workflow **run** leaving host state exclusively under vault (this bead proves mkdir/config path only)
- `lp-zuh.10.4` — cron **fire** proof with jobs surviving recreate
- `lp-zuh.10.7` — host `projects.list` / primary_path registry
- UI re-QA when Playwright harness merged

## Operator re-verify

```bash
# Guest (toolbox on started MockLab sandbox)
findmnt /mnt/vault
ls /mnt/vault/Projects/Workspace/notes/
test -w /mnt/vault/workflows && mkdir -p /mnt/vault/workflows/_probe && rmdir /mnt/vault/workflows/_probe
grep -E 'vault_root|state_dir' /var/lib/company-brain-backend/config.yaml

# External S3
AWS_PROFILE=lanyard-main aws s3 ls \
  s3://lanyard-mocklab-vault-123456789012/tenants/319d3808-e533-44db-bfdf-7b6ef8caaae1/vault/Projects/Workspace/notes/
AWS_PROFILE=lanyard-main aws s3 ls \
  s3://lanyard-mocklab-vault-123456789012/tenants/319d3808-e533-44db-bfdf-7b6ef8caaae1/vault/cron/

# Scripted re-run (requires DAYTONA_* + AWS profile; never commit secrets)
bash artifacts/mocklab/live-qa/post-mount/scripts/run_post_mount_re_qa.sh
```

## Related evidence

- Mount program: `artifacts/daytona-pilot/lp-zuh.9-proof/EVIDENCE.md` (`lp-zuh.9.4`)
- Seed: `artifacts/daytona-pilot/lp-zuh.9.5-seed/EVIDENCE.md`
- Prior empty-vault QA residual: unmerged `lp-zuh.7.6` RESULT (vault write denied root stub)
