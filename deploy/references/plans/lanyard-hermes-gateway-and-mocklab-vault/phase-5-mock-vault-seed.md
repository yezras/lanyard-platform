# Phase 5: Mock vault seed (synthetic client content)

**Bead:** `cbd-ukg.8`  
**Depends on:** `cbd-ukg.7` preferred (can parallel with 4 if gateway already healthy)  
**Status:** implemented (Option A lever + host seed)

## Goal

Realistic but **synthetic** vault under `/opt/company-brain` for Portal + mocklab UX.

## Why not client-core release

client-core is intentionally an empty spine (data boundary). Demo content for mocklab must not ship to every customer on every bootstrap.

## Recommended layout (MVP)

```text
/opt/company-brain/
├── Projects/
│   ├── INDEX.md
│   ├── Legal/{AGENTS.md,INDEX.md,memo.md,exhibits/checklist.md}
│   └── Operations/{AGENTS.md,INDEX.md,runbook.md,Subfolder/detail.md}
├── Knowledge/
│   └── Company/{AGENTS.md,handbook-snippet.md}
└── Clients/Active/Acme_Demo/
    ├── AGENTS.md, RECALL.md, PROJECTS-INDEX.md
    └── notes/2026-07-01-kickoff.md
```

Rules: fictional org only; no real customer or employee-vault content; short markdown.

## Lever (Option A — chosen)

| Piece | Path |
|-------|------|
| Seed script | `scripts/seed-demo-vault.sh` |
| Content tree | `artifacts/demo-vault/` |
| Offline smoke | `scripts/smoke-seed-demo-vault.sh` |
| Operator note | `deployments/mocklab/INDEX.md` |

### Script properties

| Property | Behavior |
|----------|----------|
| Default target | `VAULT_ROOT=/opt/company-brain` |
| Idempotent | Safe re-run; identical files → unchanged |
| Non-demo preserve | Existing files **without** `company-brain-demo-vault` marker are skipped unless `--force` |
| Employee vault refuse | Exit 3 if path looks like `/…/Lanyard`, `employee-vault`, etc. |
| Ownership | As root: `chgrp -R hermes` + `chmod -R g+rwX` (matches `ensure-runtime-hardening`); `--no-ownership` to skip |
| Marker | `/opt/company-brain/.seed/demo-vault.seeded` |

### Operator commands (mocklab)

From a checkout of this repo (or after copying script + `artifacts/demo-vault/` to the host):

```bash
# Offline smoke (laptop / CI)
bash scripts/smoke-seed-demo-vault.sh

# On host via SSM (after bootstrap; requires sudo for /opt + hermes group)
sudo bash scripts/seed-demo-vault.sh
# or explicit:
sudo VAULT_ROOT=/opt/company-brain bash scripts/seed-demo-vault.sh

# Verify
ls -la /opt/company-brain/Projects/Legal /opt/company-brain/Projects/Operations
find /opt/company-brain/Projects /opt/company-brain/Knowledge /opt/company-brain/Clients -type f | sort
```

**Ownership for Hermes:** service user `hermes` (unit `User=hermes`) needs group RW on the vault. The seed script applies the same group-access pattern as `scripts/ensure-runtime-hardening.sh` when run as root. If the `hermes` group is missing, create it via runtime hardening first, or re-run seed as root after.

Demo content is **not** in the client-core tarball; re-bootstrap will not remove seeded files (client-core extract only runs when `AGENTS.md` is absent). Re-seed after wipe with the same script.

## Work checklist

1. [x] Option A: `scripts/seed-demo-vault.sh` + `artifacts/demo-vault/`
2. [x] Idempotent; no overwrite of non-demo without `--force`; employee-vault refuse; default `/opt/company-brain`
3. [x] Run on mocklab host; ownership notes (hermes group)
4. [x] Document operator step (this plan + mocklab INDEX)

## Verification

- [x] Paths exist under vault root (host evidence below)
- [x] `ls` via SSM shows Projects/Legal and Operations
- [x] Re-run does not destroy custom edits without force (offline smoke)

## Acceptance

- [x] Seed lever exists in company-brain-deploy (not client-core main artifact)
- [x] Mocklab host has synthetic content
- [x] No live secrets or real client names

---

## Execution appendix (`cbd-ukg.8`)

| Field | Value |
|-------|-------|
| Date (UTC) | 2026-07-19T18:16:08Z |
| Instance | `i-08655012ee8702842` (mocklab-brain-hermes) |
| Account | via `AWS_PROFILE=lanyard-main` (123456789012) |
| Lever | Option A — in-repo tree + script |
| Offline smoke | `bash scripts/smoke-seed-demo-vault.sh` → OK |
| Host seed | **pass** — SSM `57941425-487c-4b8a-8bd9-5048b67f97e9` Success |
| First run | written=14 unchanged=0 skipped=1 (`Projects/INDEX.md` spine preserved) |
| Re-run | written=0 unchanged=14 skipped=1 (idempotent) |
| Ownership | `root:hermes` vault 770; files 664; dirs 775; hermes uid/gid present |

### Host evidence

```text
/opt/company-brain/Projects/Legal/{AGENTS.md,INDEX.md,memo.md,exhibits/checklist.md}
/opt/company-brain/Projects/Operations/{AGENTS.md,INDEX.md,runbook.md,Subfolder/detail.md}
/opt/company-brain/Knowledge/Company/{AGENTS.md,handbook-snippet.md}
/opt/company-brain/Clients/Active/Acme_Demo/{AGENTS.md,RECALL.md,PROJECTS-INDEX.md,notes/2026-07-01-kickoff.md}
/opt/company-brain/.seed/demo-vault.seeded
```

`Projects/INDEX.md` from client-core spine was **not** overwritten (non-demo marker; correct). Use `--force` only if operators want the demo INDEX text.
