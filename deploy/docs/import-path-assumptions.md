# Old path assumptions after company-brain-deploy import

**Bead:** `lp-k7g.10.1` (list) · **Rewire work:** `lp-k7g.10.2` and later phase-6 beads  
**Import:** history under `deploy/` via `git filter-repo --to-subdirectory-filter deploy`  
**Freeze:** `LanyardBrain/company-brain-deploy` @ `301d313c23ea62de087118615f2c1494fffbc1c4`

This file inventories path, CWD, and naming assumptions after the **standalone**
`company-brain-deploy` repository landed under `deploy/`. **`lp-k7g.10.2` completed
the Terraform module-path / validate rewire**; remaining rows are later phase-6 work.

## What already works under `deploy/`

| Assumption | Status after import / 10.2 |
| --- | --- |
| Relative module sources `../../modules/<name>` from `environments/` and `templates/tenant/` | **OK** — same relative layout under `deploy/` |
| Product scripts with `ROOT="$(cd "$(dirname "$0")/.." && pwd)"` | **OK** — resolves to `deploy/` (product tree root) |
| Platform phase-3 scaffolds with monorepo-root ROOT (`…/../..`) | **OK** — still resolve to monorepo root |
| Additive scaffold filenames (`backend_artifact_*.tf`, `company-brain-backend.service`, …) | **OK** — coexist; 10.2 de-duplicated conflicting hermes_* declarations |
| `bootstrap_script_b64` via `${path.module}/../../scripts/bootstrap-host.sh` | **OK** — resolves to `deploy/scripts/bootstrap-host.sh` |
| `terraform validate` on `environments/platform-staging`, `templates/tenant`, `modules/company-brain-ec2` | **OK** after 10.2 (init `-backend=false`) |

## Needs update (for 10.2 / phase 6)

### 1. Terraform module sources (primary 10.2) — **done in 10.2**

| Location | Assumption | Status |
| --- | --- | --- |
| `templates/tenant/main.tf` (commented) | External git source `…company-brain-deploy.git//modules/…` | **Rewired** — comment prefers monorepo-relative `../../modules/…` or `//deploy/modules/…` |
| Platform `backend_artifact_*.tf` vs product `variables.tf` | Duplicate `hermes_*` / `relay_contract_major` | **Rewired** — new names only in scaffold files; legacy names stay in product `variables.tf` / `outputs.tf` |
| Docs / runbooks that say “clone company-brain-deploy” | Standalone checkout path | **Partially updated** (architecture + deploy/docs); historical plans may still name the old repo |
| Any out-of-tree consumers (operator notes, private roots) | `source = "…company-brain-deploy.git//modules/…"` | Repoint when monorepo is the release surface |

In-tree relative `source = "../../modules/…"` paths from `deploy/environments/platform-staging` and
`deploy/templates/tenant` **did not need a prefix rewrite** solely because of the import.

### 2. Dual script ROOT conventions

| Script class | ROOT computation | Intended root |
| --- | --- | --- |
| Imported product smokes / gates (`smoke-*.sh`, `validate-compatibility.sh`, `bootstrap-host.sh` helpers, …) | `dirname/..` | `deploy/` |
| Platform scaffolds (`smoke-backend-systemd-unit.sh`, `smoke-bootstrap-backend-install.sh`, `smoke-artifact-landing-zones.sh`) | `dirname/../..` | monorepo root |

**Risk:** Operators running “all smokes” from the wrong CWD, or future scripts copying the wrong pattern.  
**Follow-up:** Document which root each class uses; optionally normalize behind a small helper; ensure
monorepo CI invokes each with the correct expected tree.

### 3. Nested CI (`.github` under `deploy/`)

| Path | Assumption |
| --- | --- |
| `deploy/.github/workflows/ci.yml` | Repo root is the deploy product; steps run `bash scripts/…`, `modules/…` without a `deploy/` prefix |

GitHub only auto-runs workflows from the monorepo **root** `.github/`. This nested workflow is
**history + reference** until a monorepo workflow is added that `cd deploy` (or uses path filters)
and prefixes paths. Do not delete without replacing coverage.

### 4. Compatibility pin trees (v1 product vs v2 platform)

| Path | Role |
| --- | --- |
| `deploy/compatibility/` | Imported product pins (`schema_version: 1` shape, Hermes-top-level keys, real-release examples) |
| `compatibility/` (monorepo root) | Platform v2 pins (`backend` block, `backends/<kind>/` URL examples) |

**Follow-up:** Clarify operator source of truth; migrate product validators / docs that still say
“compatibility/ at repo root” when meaning product pins; keep pin translation docs current
(`compatibility/translation-v1-to-v2.md`).

### 5. Product vs platform bootstrap and systemd (not pure path renames)

| Product (imported) | Platform scaffold (pre-import) | Merge intent |
| --- | --- | --- |
| `scripts/bootstrap-host.sh` | `scripts/bootstrap-backend-install.sh` | Generic versioned install + provenance into host bootstrap |
| `modules/company-brain-ec2/systemd/hermes-gateway.service` | `…/company-brain-backend.service` (+ drop-ins) | Generic unit name/entrypoint; keep Hermes alias where needed |
| `modules/company-brain-ec2/variables.tf` / `user_data.sh.tftpl` | `backend_artifact_*.tf`, `user_data_backend_pins.fragment.tftpl` | Wire `backend_artifact_*` into live module |
| `modules/product-artifact-infra/*.tf` (prefixes `hermes/`, …) | `artifact_prefixes.tf.example`, `publisher_repos.tf.example`, … | Expand to `backends/<kind-slug>/` + dual-write |
| `templates/tenant/variables.tf` | `backend_artifact_variables.tf`, … | Tenant roots consume backend artifact vars |

These are **content merges**, tracked by phase-6 beads beyond pure path fixups.

### 6. Docs and operator path strings

Examples of strings that still assume the old repo or local clones (non-exhaustive):

| Pattern | Examples |
| --- | --- |
| Repo name as product identity | `index.yaml` `name: company-brain-deploy`; AWS default tags `Project = "company-brain-deploy"` |
| Local absolute clone (historical) | former `/home/operator/Lanyard-Dev/company-brain-deploy`; use monorepo `deploy/` |
| “From company-brain-deploy root” | Runbooks under `references/runbooks/`, `INDEX.md`, `AGENTS.md` |
| Validation CWD `cd modules/…` | Module READMEs assuming deploy is git root |
| External “company-brain-deploy is not imported yet” | Platform docs under `docs/architecture/deploy-*.md` (status prose; update when convenient) |

Tag values like `Project = "company-brain-deploy"` may stay for AWS continuity; treat renames as an
explicit operator decision, not a blind search-replace.

### 7. Cross-repo / monorepo references outside `deploy/`

| Area | Note |
| --- | --- |
| `client-core/docs/RELEASE.md`, pack scripts | Still name `company-brain-deploy` bootstrap / product-artifact-infra |
| Monorepo `docs/architecture/*` pre-import status lines | Say deploy not imported yet |
| Root `README.md` migration table | Source → `deploy/` mapping still correct |

Update as operators start using monorepo paths day-to-day; not all are 10.2 blockers.

## Exclusions (never import; not path rewires)

- `.terraform/`, `*.tfstate*`, lockfiles from local applies
- Live secrets / private `terraform.tfvars` / `backend.tf`
- Untracked local caches and dirty worktree content (~5.7G on some workstations)
- Source `.beads` product DB
- Source tags (remain on `LanyardBrain/company-brain-deploy`)

## Verification after rewires (10.2+)

```bash
# From monorepo root
bash scripts/validate.sh
bash deploy/scripts/smoke-artifact-landing-zones.sh
bash deploy/scripts/smoke-backend-systemd-unit.sh
bash deploy/scripts/smoke-bootstrap-backend-install.sh
# From deploy tree (product-style ROOT)
bash deploy/scripts/smoke-product-artifact-iam.sh
bash deploy/scripts/validate-compatibility.sh deploy/compatibility/pins.example.yaml
# When terraform CLI available:
# terraform -chdir=deploy/environments/platform-staging init -backend=false
# terraform -chdir=deploy/environments/platform-staging validate
```

## Staging roots validation after move (`lp-k7g.10.6`)

Post-import evidence that example roots and bootstrap still validate under `deploy/`:

| Check | Result |
| --- | --- |
| `terraform fmt -check -recursive` (from `deploy/`) | **PASS** (fmt applied to `modules/company-brain-ec2` alignment only) |
| `terraform init -backend=false && terraform validate` for CI roots (modules listed in `deploy/.github/workflows/ci.yml`, `templates/tenant`, `environments/platform-staging`) | **PASS** (16 roots); `portal-dns-tls` / `portal-waf` via dual-provider smokes |
| `bash deploy/scripts/smoke-bootstrap-extract.sh` | **PASS** |
| `bash deploy/scripts/smoke-bootstrap-inject.sh` | **PASS** |
| `bash deploy/scripts/smoke-bootstrap-backend-install.sh` | **PASS** |
| `bash deploy/scripts/smoke-backend-systemd-unit.sh` | **PASS** |
| `bash deploy/scripts/smoke-platform-staging-compose.sh` | **PASS** (includes full terraform validate when CLI present) |
| `bash deploy/scripts/smoke-host-runtime-hardening.sh` | **PASS** |
| Monorepo `bash scripts/validate.sh` check **17** | Offline bootstrap extract/inject + platform-staging compose with `SKIP_TERRAFORM=1` |

Full terraform fmt/validate stays operator/CI-side (needs provider downloads). Offline monorepo gate covers path wiring without registry access.

```bash
# Full staging suite (from deploy/)
cd deploy
terraform fmt -check -recursive
bash scripts/smoke-platform-staging-compose.sh
bash scripts/smoke-bootstrap-extract.sh
bash scripts/smoke-bootstrap-inject.sh
for d in modules/* templates/tenant environments/platform-staging; do
  case "$d" in
    modules/portal-dns-tls) bash scripts/smoke-portal-dns-tls.sh; continue ;;
    modules/portal-waf) bash scripts/smoke-portal-waf.sh; continue ;;
  esac
  [ -f "$d/main.tf" ] || continue
  (cd "$d" && terraform init -backend=false -input=false && terraform validate)
done
```
