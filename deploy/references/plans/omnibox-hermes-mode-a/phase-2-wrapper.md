# Phase 2: Wrapper CLI

Back-link: [overview.md](./overview.md)  
**Bead:** `cbd-o9s.8`  
**Depends on:** phase 1

## Goal

Ship `run-under-omnibox` as the single entrypoint Hermes (or bootstrap) invokes for host-impacting commands.

## Changes

- Create `scripts/omnibox/run-under-omnibox.sh`
- Install target documented: `/usr/local/sbin/run-under-omnibox` (ensure script installs in phase 3)

## Data structures

- CLI: `--profile`, repeated `--path-prefix`, optional `--workdir`, then `--` and command argv.
- Exit non-zero if profile unknown or backend missing when required.

## Verification

**Static:** Shellcheck if available; script executable in tree.  
**Runtime (lab or dry layout):**

- Fail: read secrets path.
- Fail: blocked egress.
- Pass: touch under granted vault/workspace.

## Acceptance

- [ ] Wrapper implements profile load + sandbox invoke per phase 0 choice.
- [ ] Does not require Omnigent server.
- [ ] Documented env contract for Hermes (`OMNIBOX_WRAPPER` path).
