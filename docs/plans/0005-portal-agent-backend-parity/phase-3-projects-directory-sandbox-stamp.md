# Phase 3 — Agent projects Directory + sandbox stamp

**Back-link:** [overview.md](./overview.md)  
**Bead:** `lp-rt5.5`  
**Depends on:** phase 1

## Goal

Directory / project picker is driven by `projects.list` (agent projects). Selecting a project stamps chat `working_directory` / context from `primary_path` so the host can enforce cwd sandbox (grill Q3, Q5). Control-plane vault ACL projects remain authz, not the agent project store.

## Changes

- Ensure production composition always uses agent projects handlers over Brain RPC when enabled.
- Web Directory uses preferred agent projects API; map `primary_path` → UI fields already used for vault_path display where appropriate.
- Chat send path continues/extends stamping of working directory from selected project; document the wire field the host reads.
- Soft UI hint when scoped (“Scoped to &lt;project&gt;”) without locking vault browser tree (grill rejected hard multi-layer UI lockdown as primary).
- Fail closed when projects.list is unavailable: empty Directory + honest message, not Hermes fixture masquerading as live projects.

## Data structures

- `BackendProject`: id, name, primary_path, folders (contract).
- Chat context: selected project id + working_directory string.

## Verification

**Static:** projects-bff tests; web Directory mapping tests; chat stamp unit test.

**Runtime:** fake backend with two projects → select B → outbound chat frame carries B’s primary_path. With projects capability off → Directory hidden/empty honestly.

## Sister awareness

Agent plan implements `projects.list` (+ store equivalent to projects.db), returns honest primary_path values, and **enforces** tool path ACL to that tree. Portal does not implement sandbox FS checks.
