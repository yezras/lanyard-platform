# lp-zuh.9.5 — Vault seed: skills/projects/AGENTS for MockLab prefix

**Date:** 2026-08-14T16:59:38Z  
**Operator profile:** `AWS_PROFILE=lanyard-main` (account `123456789012`)  
**Bead:** `lp-zuh.9.5`

## Acceptance

| # | Criterion | Result |
|---|-----------|--------|
| 1 | vault.tree non-empty | **GO** — S3 prefix lists AGENTS.md, skills/, Projects/Workspace/, workflows/, Knowledge/ (see `s3-list.txt`; 37 objects under vault/) |
| 2 | projects.list has primary_path | **PARTIAL → path seeded** — filesystem + `.seed/default-projects.json` document `primary_path=/mnt/vault/Projects/Workspace`. Host agent `projects.db` / Brain RPC `projects.list` population is residual **`lp-zuh.10.7`** (product defaults after seed). |
| 3 | chat can read a seeded file | **GO (durable content)** — `Projects/Workspace/welcome.md` present on S3 with distinctive body; guest path after mount: `/mnt/vault/Projects/Workspace/welcome.md`. UI/chat re-QA under `lp-zuh.9.6`. |

## Live apply

| Field | Value |
|-------|--------|
| Tenant | `319d3808-e533-44db-bfdf-7b6ef8caaae1` |
| `s3_vault_prefix` | `tenants/319d3808-e533-44db-bfdf-7b6ef8caaae1/vault/` |
| Bucket | `lanyard-mocklab-vault-123456789012` |
| Command | `AWS_PROFILE=lanyard-main bash deploy/scripts/seed-mocklab-s3-vault.sh --use-mocklab-default` |
| Result | `result=seeded` (17 pack objects + provenance); re-run `result=skipped reason=agents_md_present` |
| Platform marker | `tenants/…/_platform/bootstrap.json` (seed_version=lp-zuh.9.5) |

## Seed pack (repo)

- `deploy/artifacts/mocklab-vault-seed/` — AGENTS.md, INDEX, skills, Projects/Workspace, workflows
- `deploy/scripts/seed-mocklab-s3-vault.sh` — S3 or local; AGENTS.md gate; no delete
- `deploy/scripts/smoke-seed-mocklab-s3-vault.sh` — offline smoke **PASS**
- CP: `mockLabVaultSeedPack()` in `portal/packages/control-plane/src/vault-seed.ts`

## Key objects (guest-relative)

```text
AGENTS.md
INDEX.md
Projects/Workspace/welcome.md   ← chat/vault read target
Projects/Workspace/AGENTS.md
skills/mocklab-research/SKILL.md
skills/note-taking/obsidian/SKILL.md
workflows/README.md
.seed/default-projects.json     ← intended projects.list primary_path
.seed/provenance.json
```

## Offline checks

```bash
bash deploy/scripts/smoke-seed-mocklab-s3-vault.sh
# vitest vault-seed (control-plane package)
```

## Residuals

- `lp-zuh.10.7` — register default Workspace into agent `projects.list` (host projects.db)
- `lp-zuh.9.6` — Re-QA durable surfaces (Vault UI tree, chat read welcome.md, workflows/cron)

## Operator re-verify

```bash
AWS_PROFILE=lanyard-main aws s3 ls \
  s3://lanyard-mocklab-vault-123456789012/tenants/319d3808-e533-44db-bfdf-7b6ef8caaae1/vault/ \
  --recursive | head
AWS_PROFILE=lanyard-main aws s3 cp \
  s3://lanyard-mocklab-vault-123456789012/tenants/319d3808-e533-44db-bfdf-7b6ef8caaae1/vault/Projects/Workspace/welcome.md -
```
