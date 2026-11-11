# History-preserving import strategy

Decision record: [ADR 0005](../adr/0005-history-preserving-import-strategy.md).  
Paths: [ADR 0004](../adr/0004-monorepo-workspace-paths.md) · [workspace-map.md](workspace-map.md).

This document is the operational runbook for importing product git history into the Lanyard Platform monorepo. **Do not run product imports until a Bead explicitly requests that work** (phase 5, 6, or phase 8 dry-runs). Planning shell only until then.

## Summary

| Source repository | Target prefix | Method | Tags in monorepo | Squash |
| --- | --- | --- | --- | --- |
| `LanyardBrain/client-core` | `client-core/` | `git filter-repo` → merge | No (keep on source) | No |
| `LanyardBrain/Portal` | `portal/` | `git filter-repo` → merge | No (keep on source) | No |
| `LanyardBrain/company-brain-deploy` | `deploy/` | `git filter-repo` → merge | No (keep on source) | No |

**Order:** `client-core/` → `portal/` → `deploy/` (after platform-native `docs/`, `contracts/`, `compatibility/` already present).

**Fallback:** `git subtree add --prefix=<path> <remote> <ref>` if filter-repo is unavailable.

**Squash:** only if source history is unusable; justify on the import Bead/PR.

## Why filter-repo

- Rewrites each commit so files already live under the permanent monorepo prefix; no second path-fix pass after merge.
- Preserves commit messages, authors, and (rewritten) topology for `git log` / `git blame` under the prefix.
- Cleaner than repeated `git subtree` merges for three large product histories.
- SHAs change; that is expected and recorded as a tradeoff in ADR 0005.

Subtree remains a documented fallback for environments that cannot install `git-filter-repo`. Squash is last resort only.

## Prerequisites

- `git` and [`git-filter-repo`](https://github.com/newren/git-filter-repo) installed on the import workstation.
- Read access to each source remote; write access only to the platform monorepo.
- Frozen source ref per product (tag or branch tip SHA recorded in the Bead).
- Empty target prefix on the branch receiving the import (`portal/`, `client-core/`, or `deploy/` must not already contain conflicting product trees).
- Platform branch up to date (docs/contracts/compatibility as needed for that phase).

## Procedure (per product)

Example uses `client-core`. Repeat with `portal` / `Portal` or `deploy` / `company-brain-deploy` as appropriate.

### 1. Record freeze point

```bash
# On a clone of the source repo (read-only intent)
git fetch origin
git rev-parse <freeze-ref>   # record full SHA in the Bead
git describe --tags --exact-match HEAD 2>/dev/null || true
```

### 2. Disposable rewrite clone

```bash
git clone --no-local <source-url> /tmp/import-client-core
cd /tmp/import-client-core
git checkout <freeze-ref>
git filter-repo --to-subdirectory-filter client-core
```

Notes:

- Use a fresh clone so the shared source remote is never rewritten.
- After filter-repo, the default branch tip has all paths under `client-core/`.
- Do not push this rewritten history back to `LanyardBrain/client-core`.

### 3. Merge into the platform monorepo

```bash
cd /path/to/lanyard-platform
git checkout -b import/client-core
git remote add import-client-core /tmp/import-client-core
git fetch import-client-core
git merge import-client-core/<rewritten-branch> \
  --allow-unrelated-histories \
  -m "import: client-core history under client-core/ (source SHA <freeze-sha>)"
```

Requirements:

- One **merge commit per product** (enables independent revert).
- Message includes source repository name and freeze SHA.
- Resolve any conflicts only at the monorepo root (should be rare if prefixes are empty).

### 4. Verify before promote

Use the verification column in [workspace-map.md](workspace-map.md). Minimum planning checks plus product checks when code is present:

```bash
git log --oneline -5 -- client-core/
test -d client-core
# After real import, product-specific:
# pack/tarball from client-core/; or pnpm -C portal …; or terraform -chdir=deploy/…
```

### 5. Clean up local import scaffolding

```bash
git remote remove import-client-core
rm -rf /tmp/import-client-core
```

Promote via normal PR review onto `main` when the phase Bead says so. Do not force-push rewritten history to product source remotes.

## Subtree fallback

```bash
git remote add src-client-core <source-url>
git fetch src-client-core <freeze-ref>
git checkout -b import/client-core
git subtree add --prefix=client-core src-client-core <freeze-ref> \
  -m "import: client-core via subtree (source SHA <freeze-sha>)"
```

Record in the PR that subtree was used instead of filter-repo. Prefer still one merge/subtree commit per product for rollback.

## Tags

| Action | Policy |
| --- | --- |
| Bulk-move or rewrite source tags into monorepo | **Do not** |
| Authoritative historical tags | Source remotes / post-cutover read-only archives |
| Monorepo tags | Platform release namespace only, after cutover CI |
| Optional mapping | Note `source-tag` → `import-merge-sha` in Bead or PR body |

Release continuity for deployed systems is via **artifact pins and SHAs**, not by recreating every product git tag on monorepo `main`.

## History tradeoffs (quick reference)

| Keep | Change / lose in monorepo |
| --- | --- |
| Authors, messages, relative order | Original commit SHAs |
| Ability to blame files under prefix | Exact source tag → monorepo commit equality |
| Source repo tags on archive remotes | Automatic three-repo shared ancestry before import merges |

## Rollback

### A. Abandon import branch (not on `main`)

```bash
git checkout main
git branch -D import/client-core
git remote remove import-client-core 2>/dev/null || true
# disposable clone can be deleted
```

Source repos unchanged. Safest path during dry-runs (`lp-k7g.12.x`).

### B. Revert import merge already on `main`

```bash
git checkout -b revert/import-client-core
git revert -m 1 <import-merge-sha>
# PR and merge; product tree leaves main; platform history stays linear via revert
```

Use `-m 1` so the mainline parent is kept. Revert only the product that failed if imports were separate merges.

### C. Source archive continues shipping

Until production cutover succeeds:

- Source repositories remain the backup for hotfixes and for pins that still point at pre-import releases.
- Mark sources read-only when monorepo publish is the sole release path ([phase 8](../plans/0001-platform-monorepo-migration/phase-8-cutover.md)).
- Infrastructure rollback uses pin/deploy rollback runbooks, not monorepo history surgery.

### D. After production cutover

- Do not rewrite monorepo `main` to drop product history without a new ADR.
- Keep archived source remotes readable for pre-monorepo SHAs and tags.

## Phase mapping

| Phase / Beads | Import action |
| --- | --- |
| Phase 1 `lp-k7g.5.3` | Strategy docs only (this file + ADR 0005). |
| Phase 5 `lp-k7g.9.x` | Execute `client-core/` import when Beads request. |
| Phase 6 `lp-k7g.10.x` | Execute `deploy/` import when Beads request. |
| Portal path work in phase 4/8 | Execute `portal/` import when Beads request (order still before deploy). |
| Phase 8 `lp-k7g.12.1`–`12.3` | Dry-run each import with this procedure; practice rollback A/B. |

## Related docs

- [ADR 0005 — History-preserving import strategy](../adr/0005-history-preserving-import-strategy.md)
- [ADR 0004 — Monorepo workspace paths](../adr/0004-monorepo-workspace-paths.md)
- [Workspace map](workspace-map.md)
- [Phase 1 — Repository foundation](../plans/0001-platform-monorepo-migration/phase-1-repository-foundation.md)
- [Phase 5 — Client-core migration](../plans/0001-platform-monorepo-migration/phase-5-client-core-migration.md)
- [Phase 6 — Deploy migration](../plans/0001-platform-monorepo-migration/phase-6-deploy-migration.md)
- [Phase 8 — Cutover](../plans/0001-platform-monorepo-migration/phase-8-cutover.md)
