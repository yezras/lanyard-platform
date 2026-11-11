# `deploy/` — company-brain-deploy product tree + platform scaffolds

**Status:** Product tree **imported** (`lp-k7g.10.1`) under this prefix. Final path remains
`deploy/` per [ADR 0004](../docs/adr/0004-monorepo-workspace-paths.md).

| Decision | Value |
| --- | --- |
| Final monorepo path | `deploy/` (top-level) |
| Source repository | `https://github.com/LanyardBrain/company-brain-deploy.git` |
| Freeze SHA (pre-rewrite) | `301d313c23ea62de087118615f2c1494fffbc1c4` |
| Import method | `git filter-repo --to-subdirectory-filter deploy` → merge ([ADR 0005](../docs/adr/0005-history-preserving-import-strategy.md)) |
| Import merge | `import: company-brain-deploy history under deploy/ (source SHA 301d313…)` |
| Workspace map | [workspace-map.md](../docs/architecture/workspace-map.md) |
| Phase plan | [phase-6-deploy-migration.md](../docs/plans/0001-platform-monorepo-migration/phase-6-deploy-migration.md) |
| Import runbook | [import-strategy.md](../docs/architecture/import-strategy.md) |
| **Old path assumptions (for 10.2)** | [docs/import-path-assumptions.md](docs/import-path-assumptions.md) |

## What lives here

History-preserving import placed the full company-brain-deploy product under this prefix:

- **Modules** — Terraform modules (`company-brain-ec2`, `product-artifact-infra`, portal/*, VPC, RDS, …)
- **Environments** — `environments/platform-staging/`
- **Templates** — `templates/tenant/` tenant root (**EC2 path only**; `runtime_kind=daytona` fails closed — `lp-4nf` / plan §4.11)
- **Scripts** — bootstrap, smoke, security, omnibox, compatibility validators
- **Daytona agent image** — `daytona/agent-gateway/` (snapshot build; not tenant EC2)
- **References / runbooks** — `references/` (provision, upgrade, security, plans);
  monorepo backend-runtime secrets lifecycle:
  [`docs/runbooks/backend-runtime-secrets.md`](../docs/runbooks/backend-runtime-secrets.md)
  (API keys + OAuth + custom providers; mocklab cutover under
  `deployments/mocklab/CUTOVER-backend-runtime-secrets.md`)
- **Compatibility (product v1)** — `compatibility/` pins + schema (alongside monorepo root `compatibility/` v2)
- **Artifacts / deployments** — artifact docs, demo vault seed, deployment registry examples
- **CI history** — `.github/workflows/ci.yml` (nested; monorepo does not auto-run it)

### Provision branches (`runtime_kind`)

| Path | Operator docs | Tenant compute TF |
|------|---------------|-------------------|
| **`ec2`** | [`references/provision-runbook.md`](references/provision-runbook.md) | `templates/tenant` → `modules/company-brain-ec2` |
| **`daytona`** | [`docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md`](../docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md) | **None** — CP register + S3 vault; lazy sandbox on `ensure_online` |

Platform phase-3 scaffolds from `lp-k7g.7.3`–`7.7` were **kept and merged additively**:

| Scaffold area | Paths (additive) |
| --- | --- |
| Backend artifact TF interface | `modules/company-brain-ec2/backend_artifact_*.tf`, tenant `backend_artifact_*.tf` |
| Bootstrap install reference | `scripts/bootstrap-backend-install.sh`, `schemas/`, `examples/` |
| Generic systemd unit | `modules/company-brain-ec2/systemd/company-brain-backend.service` (+ drop-ins) |
| Landing-zone stubs | `modules/product-artifact-infra/*.tf.example` |
| Design pointers | `docs/*.md` → `docs/architecture/deploy-*.md` |

Imported product files (e.g. `hermes-gateway.service`, `bootstrap-host.sh`, live module `.tf`) sit
next to these scaffolds. **Content wiring** (stubs → live module) is phase-6 follow-on work, not
this import bead.

## History plan (completed)

| Step | Result |
| --- | --- |
| Freeze source ref | `origin/main` @ `301d313c23ea62de087118615f2c1494fffbc1c4` |
| Disposable rewrite clone | `git filter-repo --to-subdirectory-filter deploy` |
| Merge | Unrelated-histories merge (one merge commit); conflict resolved on `modules/product-artifact-infra/README.md` |
| Tags | **Not** imported (remain on source remote / archive) |
| Authorship / messages | Preserved; commit SHAs rewritten (expected) |
| Local-only / generated | Excluded — only tracked source; no `.terraform/`, tfstate, secrets, dirty caches |

Rollback: `git revert -m 1 <import-merge-sha>` (see [import-strategy.md](../docs/architecture/import-strategy.md)).

## Layout (high level)

```text
deploy/
├── modules/           # product modules + platform *.tf.example / backend_artifact_* scaffolds
├── environments/      # platform-staging root
├── templates/tenant/  # tenant root + backend_artifact_* scaffolds
├── scripts/           # product bootstrap/smokes + platform smoke/bootstrap-backend-install
├── references/        # runbooks, contracts, plans
├── compatibility/     # product pin examples (v1 shape)
├── artifacts/         # artifact README + demo vault seed
├── deployments/       # tenant deployment registry examples
├── docs/              # monorepo pointers + import-path-assumptions.md
├── schemas/ examples/ # platform provenance schema/examples
├── AGENTS.md INDEX.md index.yaml
└── .github/           # nested product CI (not monorepo root workflows)
```

## Executable scripts

Git mode `100755` is preserved on product shell scripts (bootstrap, smokes, ensure-*, omnibox
helpers, module `setup.sh` / `tailscale-enroll.sh`) and on platform scaffold smokes. Verify with:

```bash
git ls-files -s deploy/ | awk '$1 ~ /^100755/ {print $4}'
```

## What does **not** live here

- Live AWS state, private `terraform.tfvars`, private `backend.tf`
- Backend agent **source** (Hermes / Hermes-Lanyard / Lanyard Agent remain external artifacts)
- Portal / client-core product trees (siblings `portal/`, `client-core/`)
- Monorepo platform pin schema v2 (root `compatibility/`)

## Merge notes (remaining phase 6)

1. ~~Import history-preserving `company-brain-deploy` into this tree~~ **done (`lp-k7g.10.1`)**.
2. ~~Update Terraform module paths / external refs after import~~ **done (`lp-k7g.10.2`)** ([path assumptions](docs/import-path-assumptions.md)).
3. Wire `backend_artifact_*` stubs into live `user_data.sh.tftpl` / tenant module args → **`lp-k7g.10.3`**.
4. Merge `bootstrap-backend-install.sh` versioned layout into `bootstrap-host.sh`.
5. Prefer `company-brain-backend.service` over `hermes-gateway.service` with compatibility aliases.
6. Expand product-artifact-infra to `backends/<kind-slug>/` per landing-zone stubs.
7. Remove temporary `hermes_*` aliases / `hermes/` prefix only after tenant tfvars, bootstrap, and publish workflows read the new names.

## Verification

```bash
# Monorepo planning + scaffold checks
bash scripts/validate.sh

# Platform offline smokes (ROOT = monorepo root)
bash deploy/scripts/smoke-backend-systemd-unit.sh
bash deploy/scripts/smoke-bootstrap-backend-install.sh
bash deploy/scripts/smoke-artifact-landing-zones.sh

# Product-style checks (ROOT = deploy/)
bash deploy/scripts/smoke-product-artifact-iam.sh
test -d deploy/modules && test -d deploy/environments && test -d deploy/scripts
test -d deploy/references && test -d deploy/compatibility
```
