# Phase 2. Backend runtime contract

Back to [overview](overview.md).

## Goal

Define the backend contract that lets Portal and deploy swap Hermes-Lanyard, Hermes upstream, and Lanyard Agent.

Bead: `lp-k7g.6`.

## Changes

- Add schema for backend artifact manifests.
- Add schema for backend config and settings.
- Document the runtime filesystem layout.
- Document required relay and Brain RPC versions.
- Define backend capability reporting.
- Define profile capabilities and path ACL behavior.

## Data structures

- `BackendKind`: `hermes_upstream`, `hermes_lanyard`, `lanyard_agent`.
- `BackendArtifactPin`: kind, version, url, sha256, contract versions.
- `BackendManifest`: artifact metadata, entrypoint, config schema, capabilities.
- `BackendProfile`: profile name, capabilities, allowed path prefixes.

## Verification

- Schema examples validate.
- Hermes-Lanyard's current layout can be represented without special fields.
- Lanyard Agent gaps are listed as contract deltas, not Portal exceptions:
  [lanyard-agent-conformance-gaps.md](../../architecture/lanyard-agent-conformance-gaps.md),
  [conformance.md](../../../contracts/backend-runtime-v1/conformance.md).
