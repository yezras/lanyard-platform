# `client-core/` — vault seed, packs, and publish tooling

**Status:** Product tree **imported** (`lp-k7g.9.2`). Path and ownership remain
locked at this top-level prefix ([ADR 0004](../docs/adr/0004-monorepo-workspace-paths.md)).

| Decision | Value |
| --- | --- |
| Final monorepo path | `client-core/` (top-level) |
| Source repository | `https://github.com/LanyardBrain/client-core.git` |
| Freeze SHA (pre-rewrite) | `4225110cb7549db615b01176884957d932cb2a3b` |
| Import method | `git filter-repo --to-subdirectory-filter client-core` → merge ([ADR 0005](../docs/adr/0005-history-preserving-import-strategy.md)) |
| Import merge | `import: client-core history under client-core/ (source SHA 4225110…)` |
| Ownership / review / package + deploy boundaries | [client-core-path-ownership.md](../docs/architecture/client-core-path-ownership.md) |
| Workspace map | [workspace-map.md](../docs/architecture/workspace-map.md) |
| Phase plan | [phase-5-client-core-migration.md](../docs/plans/0001-platform-monorepo-migration/phase-5-client-core-migration.md) |
| Import runbook | [import-strategy.md](../docs/architecture/import-strategy.md) |

## What lives here

History-preserving import placed the full client-core product under this prefix:

- **Seed content** — vault defaults (`AGENTS.md`, `INDEX.md`, `index.yaml`,
  `Clients/`, `Knowledge/`, `Projects/`, `memory/`, `agents/`, `templates/`,
  `.seed/`, etc.)
- **Packs** — opt-in packs under `packs/` (crm, gws, granola, focr, …)
- **Scripts** — `scripts/enable-pack.sh`, `setup-local.sh`, `pack-release.sh`, …
- **Skills / product docs** — always-on skills and client-core docs
- **Publish CI** — `.github/workflows/release-artifact.yml` (path-scoped under
  this tree after rewrite)

This monorepo **entrypoint README** (from `lp-k7g.9.1`) was kept alongside the
imported tree; the source repo had no root `README.md`.

Toolchain stays **independent of the Portal pnpm workspace**. Pack and publish
scripts run from `client-core/`; they do not become `portal/` packages.

## History plan (completed)

| Step | Result |
| --- | --- |
| Freeze source ref | `main` @ `4225110cb7549db615b01176884957d932cb2a3b` |
| Disposable rewrite clone | `git filter-repo --to-subdirectory-filter client-core` |
| Merge | Unrelated-histories merge into platform branch (one merge commit) |
| Tags | **Not** imported into monorepo tag namespace (ADR 0005); remain on source remote / archive |
| Authorship / messages | Preserved; commit SHAs are rewritten (expected) |
| Local-only / generated | Not present — only tracked source files; see `.gitignore` |

Rollback: revert the import merge with `git revert -m 1 <import-merge-sha>`
(see [import-strategy.md](../docs/architecture/import-strategy.md)).

Pack validation (`lp-k7g.9.3`), publish-from-subpath (`lp-k7g.9.4`), and seed
idempotency (`lp-k7g.9.5`) are in tree.

## Deploy artifact boundary (do not break)

Client-core remains a **separate deploy artifact** from every backend:

| Surface | Rule |
| --- | --- |
| Compatibility pins | Top-level `client_core.{version,url,sha256}` — never nested under `backend` |
| Object store | `s3://$BUCKET/client-core/<version>/client-core.tar.gz` (not under `backends/`) |
| Terraform | Separate `client_core_artifact_*` variables (not `backend_artifact_*`) |
| Host install | Vault root (`VAULT_ROOT`); independent of `BACKEND_HOME` / backend kind |
| Backend swap | Changing `backend.kind` or backend pin must not rewrite the client-core pin |

See [client-core-path-ownership.md](../docs/architecture/client-core-path-ownership.md)
and [compatibility/README.md](../compatibility/README.md).

## Ownership (summary)

| Area | Primary review |
| --- | --- |
| Everything under `client-core/` | Client-core maintainers |
| Pin/deploy install of the published tarball | Deploy maintainers (preserve separation) |
| Renaming this path | Platform architects via superseding ADR |

CODEOWNERS-style path rules and the full review checklist live in
[client-core-path-ownership.md](../docs/architecture/client-core-path-ownership.md).

## Verification

```bash
# Seed and history under the permanent prefix
test -f client-core/AGENTS.md
test -d client-core/packs
test -x client-core/scripts/enable-pack.sh
git log --oneline -5 -- client-core/

# Executable bits preserved in git (mode 100755)
git ls-files -s client-core/scripts/

# Pack catalog discoverable + metadata validation (lp-k7g.9.3)
bash client-core/scripts/enable-pack.sh list
python3 client-core/scripts/validate-packs.py
# Wired into monorepo offline gate as check 14:
bash scripts/validate.sh

# Pack/tarball from monorepo subpath (lp-k7g.9.4) — offline dry-run
bash client-core/scripts/pack-release.sh --dry-run v0.0.0-local-test
bash client-core/scripts/smoke-pack-release.sh
# Emits dist/client-core-<ver>.tar.gz + .sha256 + .meta.env + .pins.yaml
# URL shape: s3://$ARTIFACT_BUCKET/client-core/<ver>/client-core-<ver>.tar.gz
# See client-core/docs/RELEASE.md

# Vault seed idempotency (lp-k7g.9.5) — offline smoke
# First-run empty vault only; existing AGENTS.md skips extract (preserve live)
bash client-core/scripts/smoke-seed-idempotency.sh
# Manual: bash client-core/scripts/seed-vault.sh --vault /tmp/vault \
#   --tarball client-core/dist/client-core-v….tar.gz
```

## Related beads

| Bead | Work |
| --- | --- |
| `lp-k7g.9.1` | Path + ownership (entrypoint README + architecture doc) |
| `lp-k7g.9.2` | Migrate seed content with history plan (**this import**) |
| `lp-k7g.9.3` | Migrate pack scripts and validation |
| `lp-k7g.9.4` | Publish artifact from monorepo subpath |
| `lp-k7g.9.5` | Test seed idempotency |
| `lp-k7g.12.2` | Cutover dry-run: re-verify seed vs freeze, pack-release dry-run, pack validation ([evidence](../docs/plans/0001-platform-monorepo-migration/cutover-client-core-dry-run.md)) |
