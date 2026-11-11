# Cutover dry-run: deploy import (`lp-k7g.12.3`)

Back to [phase 8](phase-8-cutover.md) · [phase 6](phase-6-deploy-migration.md) · [deploy/README.md](../../../deploy/README.md).

## Goal

Re-verify the **already-imported** monorepo `deploy/` tree after phase 6 rewires:
module path resolution, `terraform validate` on example roots, and bootstrap script
path injection from tenant / EC2 templates.

This is a **cutover dry-run check**, not a second history import. Import landed
in phase 6 (`lp-k7g.10.1`); path rewires and staging validation in `lp-k7g.10.2`–
`lp-k7g.10.6`.

## Freeze and import provenance

| Field | Value |
| --- | --- |
| Source repository | `https://github.com/LanyardBrain/company-brain-deploy.git` |
| Freeze SHA (pre-rewrite) | `301d313c23ea62de087118615f2c1494fffbc1c4` |
| Monorepo path | `deploy/` |
| Import method | `git filter-repo --to-subdirectory-filter deploy` → merge |
| Import merge | `e2c9506` — `import: company-brain-deploy history under deploy/ (source SHA 301d313…)` |
| Phase-6 follow-ons | `lp-k7g.10.2` module paths, `lp-k7g.10.3` user_data pins, `lp-k7g.10.4` hardening, `lp-k7g.10.5` security docs, `lp-k7g.10.6` staging roots |
| Path assumptions inventory | [deploy/docs/import-path-assumptions.md](../../../deploy/docs/import-path-assumptions.md) |

## Acceptance evidence

### 1. Module paths resolve

Relative `source = "../../modules/<name>"` from example roots resolve to real
module directories under `deploy/modules/` (no floating `ref=main` / remote git
sources on platform-staging compose layers).

| Consumer | Module sources | On-disk `main.tf` |
| --- | --- | --- |
| `deploy/environments/platform-staging` | `product-artifact-infra`, `platform-vpc`, `control-plane-rds`, `portal-valkey`, `portal-control-plane-service`, `portal-bff-service`, `portal-relay-service`, `portal-static-edge`, `portal-dns-tls`, `portal-waf` | **All present** |
| `deploy/templates/tenant` | `security-observability`, `company-brain-ec2`, `customer-gateway-relay` | **All present** |
| CI roots (validate-staging-roots) | 16 module/template/env roots + dual-provider smokes for `portal-dns-tls` / `portal-waf` | **All present** |

Offline compose check:

```bash
bash deploy/scripts/smoke-platform-staging-compose.sh
# Also scripts/validate.sh check 17 (SKIP_TERRAFORM=1 by default)
```

Observed: all compose layers use relative module sources; no `git::` / `ref=main`
float on the staging root.

### 2. Terraform validate passes for examples

Full staging-root suite (requires Terraform CLI + provider init, no AWS apply):

```bash
bash deploy/scripts/validate-staging-roots.sh
```

| Root | `terraform init -backend=false && validate` |
| --- | --- |
| `modules/company-brain-ec2` | **PASS** |
| `modules/customer-gateway-relay` | **PASS** |
| `modules/tier3-dedicated-relay` | **PASS** |
| `modules/product-artifact-infra` | **PASS** |
| `modules/security-observability` | **PASS** |
| `modules/control-plane-rds` | **PASS** |
| `modules/platform-vpc` | **PASS** |
| `modules/portal-valkey` | **PASS** |
| `modules/portal-static-edge` | **PASS** |
| `modules/portal-bff-service` | **PASS** |
| `modules/portal-relay-service` | **PASS** |
| `modules/portal-control-plane-service` | **PASS** |
| `modules/customer-account-access` | **PASS** |
| `modules/account-factory` | **PASS** |
| `templates/tenant` | **PASS** |
| `environments/platform-staging` | **PASS** |
| `modules/portal-dns-tls` (dual-provider smoke) | **PASS** |
| `modules/portal-waf` (dual-provider smoke) | **PASS** |
| `terraform fmt -check -recursive` (from `deploy/`) | **PASS** |

Terraform CLI used for this dry-run: **v1.15.6** (linux_arm64).

### 3. Bootstrap script path resolves

Tenant template injects the product bootstrap via monorepo-relative path:

```hcl
# deploy/templates/tenant/main.tf
bootstrap_script_b64 = base64gzip(file("${path.module}/../../scripts/bootstrap-host.sh"))
```

| Check | Result |
| --- | --- |
| `${path.module}/../../scripts/bootstrap-host.sh` from `templates/tenant` | **Resolves** → `deploy/scripts/bootstrap-host.sh` |
| File exists and is executable | **OK** (`deploy/scripts/bootstrap-host.sh`) |
| Platform generic install helper | **OK** (`deploy/scripts/bootstrap-backend-install.sh`) |
| `smoke-bootstrap-inject.sh` (base64gzip round-trip, user_data inject, tenant wiring) | **PASS** |
| `smoke-bootstrap-extract.sh` (archive formats, checksums, fail-closed) | **PASS** |
| `smoke-bootstrap-backend-install.sh` (versioned install + provenance) | **PASS** |
| user_data render embeds bootstrap under 16 KiB | **PASS** (≈14829 bytes) |
| Stable on-host install path | `/usr/local/sbin/company-brain-bootstrap` |

## Offline monorepo gate

```bash
bash scripts/validate.sh
```

Includes check **17** (staging roots after move: platform-staging files + bootstrap
extract/inject + platform-staging compose with `SKIP_TERRAFORM=1`). Full terraform
validate remains operator/CI-side via `validate-staging-roots.sh` (provider download).

Observed on this branch: **30 checks passed** (offline, no network).

## Commands to re-run

From platform monorepo root:

```bash
# Module path + compose wiring (offline; optional terraform validate inside)
bash deploy/scripts/smoke-platform-staging-compose.sh

# Bootstrap path + injection contract
bash deploy/scripts/smoke-bootstrap-extract.sh
bash deploy/scripts/smoke-bootstrap-inject.sh
bash deploy/scripts/smoke-bootstrap-backend-install.sh

# Full terraform fmt + validate example roots (needs terraform CLI)
bash deploy/scripts/validate-staging-roots.sh

# Offline monorepo gate (check 17 = deploy staging roots without provider download)
bash scripts/validate.sh
```

## Related docs

- [deploy/docs/import-path-assumptions.md](../../../deploy/docs/import-path-assumptions.md) — post-import path inventory
- [deploy/docs/bootstrap-backend-install.md](../../../deploy/docs/bootstrap-backend-install.md)
- [import-strategy.md](../../architecture/import-strategy.md)
- [workspace-map.md](../../architecture/workspace-map.md)
- [validation-plan.md](../../architecture/validation-plan.md)
- [ADR 0004](../../adr/0004-monorepo-workspace-paths.md) · [ADR 0005](../../adr/0005-history-preserving-import-strategy.md)
