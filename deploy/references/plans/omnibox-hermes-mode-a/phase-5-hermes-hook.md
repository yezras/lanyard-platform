# Phase 5: Hermes shell / host-tool hook

Back-link: [overview.md](./overview.md)  
**Bead:** `cbd-o9s.11`  
**Depends on:** phase 4

## Goal

When `OMNIBOX_ENABLED=1`, admin (or any allowed) `shell_exec` and similar host-impacting tools invoke `run-under-omnibox` with session profile from relay inject.

## Changes

- Prefer config-only if Hermes already has pre-exec.
- Else minimal change in `hermes-lanyard` shell/tool backend.
- Deploy docs: `references/omnibox-mode-a-hermes-hook.md` contract.

## Data structures

- Session: `profile` + `path_prefixes`.
- Missing profile fail-closed to contributor grants or deny shell.

## Verification

**Static:** Unit test that wrapper argv includes `--profile contributor` for contributor session.  
**Runtime:** Staging or lab gateway: admin shell cannot cat `.env`; contributor shell still denied by allowlist.

## Acceptance

- [ ] Hook only when OMNIBOX_ENABLED.
- [ ] Profile from session source.
- [ ] Vault-only tools need not go through Omnibox unless they shell out.
