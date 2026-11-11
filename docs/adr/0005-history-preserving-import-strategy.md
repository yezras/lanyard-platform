# ADR 0005: History-preserving import strategy

- Status: Accepted
- Date: 2026-07-20

## Context

Phase 1 fixed permanent workspace paths ([ADR 0004](0004-monorepo-workspace-paths.md)):

| Source repository | Target path |
| --- | --- |
| `LanyardBrain/Portal` | `portal/` |
| `LanyardBrain/client-core` | `client-core/` |
| `LanyardBrain/company-brain-deploy` | `deploy/` |

Product source is not imported yet. When later Beads request imports (phases 5, 6, and cutover dry-runs in phase 8), the monorepo needs a single, documented git method so history, tags, and rollback are predictable.

### Alternatives considered

1. **`git filter-repo` path rewrite, then merge**  
   Clone each source, rewrite every commit so the tree lives under the target prefix (`portal/`, `client-core/`, or `deploy/`), then merge the rewritten branch into platform `main` (or a long-lived import branch). Preserves full commit history and authorship; SHAs change because trees change. Industry default for one-shot monorepo assembly.

2. **`git subtree` add / subtree split**  
   `git subtree add --prefix=<path> <remote> <ref>` brings history under a prefix without a separate rewrite tool. Simpler for a single remote, but history is harder to re-split cleanly later, merge commits are noisy, and large repos (Portal) often need repeated conflict resolution. Suitable as a fallback when filter-repo is unavailable, not the preferred path.

3. **Squash import (single commit of HEAD tree)**  
   One commit with current files under the target prefix. Maximum simplicity and no rewritten history noise, but **loses blame, `git log` per file, and tag→commit linkage inside the monorepo**. Acceptable only if a source history is corrupted, secret-contaminated, or otherwise unusable after review.

4. **`git submodule` or nested remotes**  
   Keeps separate histories forever. Contradicts the platform monorepo boundary ([ADR 0001](0001-platform-monorepo-boundary.md)) and agent/context goals of this migration.

## Decision

### Import method (per repository)

Use the **same primary method for all three product repositories**:

| Source repository | Target path | Selected method | Squash? |
| --- | --- | --- | --- |
| `LanyardBrain/client-core` | `client-core/` | **`git filter-repo`** prefix rewrite → merge | No (default) |
| `LanyardBrain/Portal` | `portal/` | **`git filter-repo`** prefix rewrite → merge | No (default) |
| `LanyardBrain/company-brain-deploy` | `deploy/` | **`git filter-repo`** prefix rewrite → merge | No (default) |

**Fallback:** If `git-filter-repo` cannot be installed in the import environment, use **`git subtree add --prefix=<path>`** from a frozen source ref. Document the fallback in the import PR. Do not mix filter-repo and subtree for different product repos in the same cutover wave without a follow-up note in this ADR’s consequences or a superseding ADR.

**Squash exception:** Squash only if a pre-import review finds history that is unusable (e.g. irreversible secret material that rewrite cannot safely scrub, or empty/corrupt git metadata). Justify the exception in the import Bead and the import PR. Prefer history scrub with filter-repo over squash when secrets can be removed cleanly.

Import **order** remains as ADR 0004: platform-native trees (already present) → `client-core/` → `portal/` → `deploy/`. Mechanism here does not change order.

### Recommended procedure (outline)

Operational detail lives in [import-strategy.md](../architecture/import-strategy.md). Decision-level steps:

1. Freeze a source ref (branch tip or release tag) per product repo; record SHA and tag name in the import Bead.
2. Clone the source to a disposable directory (never rewrite the shared source remote in place).
3. Run `git filter-repo` so every path is under the target prefix (e.g. `--to-subdirectory-filter portal`).
4. Add the rewritten clone as a remote on the platform monorepo; fetch the rewritten branch.
5. Merge into an import branch (e.g. `import/client-core`, then into `main` after review). Prefer merge commits (not rebase onto main of thousands of rewritten commits) so the import boundary is a single reversible parent edge.
6. Run path-level verification from [workspace-map.md](../architecture/workspace-map.md) before promoting.
7. Do **not** execute product import until the corresponding phase Bead explicitly requests it. This ADR is documentation only until then.

### History tradeoffs

| Aspect | Behavior under selected method |
| --- | --- |
| Commit messages and authorship | Preserved from source. |
| Commit SHAs | **New** (tree paths changed). Source SHAs remain valid only on source remotes / archives. |
| File-level `git log` / `git blame` | Works inside monorepo under the prefix after import. |
| Merge topology | Source merge commits preserved in rewritten form when filter-repo is used with default history flags. |
| Platform commits before import | Unchanged; import is a merge that adds the product tree. |
| Cross-repo history | No automatic linking between Portal and deploy histories beyond merge dates on platform `main`. |

### Tag tradeoffs

| Policy | Choice |
| --- | --- |
| Import source release tags into monorepo | **No** — do not bulk-import or rewrite product tags onto monorepo refs by default. |
| Where tags remain authoritative | **Source remotes** (and post-cutover **read-only archives** of those remotes). |
| Monorepo tags | Platform-owned only (`platform/…`, deploy release tags, contract versions, etc.) after cutover CI exists. |
| Mapping source tag → monorepo commit | Optional one-line map in the import PR description or Bead notes (`source-tag` → `import-merge-sha`), not as git tags, to avoid colliding tag namespaces. |
| If a tag must be preserved in-tree | Prefer an annotated note or docs table over rewriting `v1.2.3` from Portal onto monorepo `main` history. |

Rationale: rewritten commits have new SHAs, so raw tag moves would either point at wrong trees or flood the monorepo with three products’ version schemes. Source archives keep tags intact for archaeology and rollback of **artifact** releases that still pin old repo SHAs.

### Rollback path

Rollback is layered. Prefer the least destructive step that restores a known-good state.

1. **Before merge to `main` — abandon the import branch**  
   - Delete or leave unmerged the feature/import branch (`import/<product>`).  
   - Drop the temporary remote and disposable filter-repo clone.  
   - Source repositories are untouched. No monorepo history rewrite required.

2. **After merge to `main`, before cutover / production**  
   - Revert the import merge commit (`git revert -m 1 <import-merge-sha>`) on a cleanup branch, or reset `main` only if the merge has not been shared and policy allows non-FF recovery.  
   - Prefer revert on shared branches so collaborators do not lose platform-native commits.  
   - Product trees disappear from `main`; platform docs/contracts/compatibility remain.

3. **After partial multi-product import**  
   - Revert only the failing product’s import merge when imports were separate merge commits (required: one merge commit per product).  
   - Do not squash three products into one merge if independent rollback is desired.

4. **Source repos as safety net (until cutover complete)**  
   - Keep `LanyardBrain/Portal`, `LanyardBrain/client-core`, and `LanyardBrain/company-brain-deploy` **writable only for emergency hotfixes** during migration; default stance is **read-only archive intent** once monorepo import PR is open, and **hard read-only** after successful production cutover ([phase 8](../plans/0001-platform-monorepo-migration/phase-8-cutover.md)).  
   - Artifact pins and deploy runbooks continue to be able to ship from **pre-import** source releases until monorepo publish is proven.  
   - Abandoning the monorepo import never requires deleting source history.

5. **After production cutover**  
   - Infrastructure rollback uses **artifact pins and deploy state**, not git archaeology of the monorepo import ([phase 8](../plans/0001-platform-monorepo-migration/phase-8-cutover.md) `RollbackPoint`).  
   - Source archives remain available for blame/history that predates monorepo SHAs.  
   - Do not force-push monorepo `main` to remove years of product history without a new ADR.

### Explicit non-goals

- Importing Hermes, Hermes-Lanyard, or Lanyard Agent source ([ADR 0002](0002-external-backend-products.md)).
- Running the actual product import in this planning phase.
- Rewriting monorepo history that already exists for docs/contracts/compatibility.

## Consequences

- Phase 5 (`lp-k7g.9`), phase 6 (`lp-k7g.10`), and phase 8 dry-runs (`lp-k7g.12.1`–`12.3`) implement imports using this method and order.
- Operators need `git-filter-repo` (or documented subtree fallback) on the machine performing the import.
- Blame and log work under `portal/`, `client-core/`, and `deploy/` after import; old SHAs stay on archived remotes.
- Tag and release continuity for **artifacts** stays pin-based; git tags in the monorepo start a new platform namespace.
- Each product import must be a **separate merge commit** to preserve per-repo rollback.
- Operational runbook: [import-strategy.md](../architecture/import-strategy.md). Workspace map migration-method column points here.
- Supersedes the open “mechanism TBD” notes in ADR 0004 and the workspace map regarding filter-repo vs subtree.
