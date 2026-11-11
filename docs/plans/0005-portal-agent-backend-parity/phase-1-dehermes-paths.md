# Phase 1 — De-Hermes paths and preferred APIs

**Back-link:** [overview.md](./overview.md)  
**Bead:** `lp-rt5.3`

## Goal

Portal BFF and web stop treating `HERMES_HOME` / `~/.hermes` / Hermes-only API paths as the only product surface. Preferred names and dual-mount deprecations match `hermes-compat` and `backend-runtime-v1`.

## Changes

- Resolve home via `BACKEND_HOME` with `HERMES_HOME` legacy alias (`@lanyard/hermes-compat` / shared helper), not `resolveHermesHome` only.
- Dual-mount agent projects routes: preferred `/api/agent/projects` + legacy `/api/hermes/projects` with deprecation headers.
- Web clients call preferred paths for projects (and settings if any Hermes-named clients remain).
- Honesty / source labels accept backend-neutral sources (`brain_rpc`, `backend`, fixture); stop implying only `hermes` | `fixture`.
- Settings chrome: drop “Hermes & tools” product branding for neutral “Agent & tools” (or equivalent).
- Grep gate: no new product code paths that hardcode `~/.hermes` without going through alias resolution.

## Data structures

- `resolveBackendHome(env)` effective path (preferred + legacy).
- Endpoint catalog already in `@lanyard/hermes-compat` (`preferredPath` / `legacyPath`).

## Verification

**Static:** unit tests for home resolution (BACKEND_HOME wins; HERMES_HOME fallback; default path documented). Web/BFF tests for preferred projects client path. Lint/grep for accidental `~/.hermes` string literals outside compat/tests.

**Runtime:** local BFF with `BACKEND_HOME` pointing at a fixture tree serves settings/projects without setting `HERMES_HOME`.

## Sister awareness

Agent plan phase on layout must place contract files under `$BACKEND_HOME` so this resolution works for LA once RPC exists. Local FS fallback is migration aid only; production path remains Brain RPC.
