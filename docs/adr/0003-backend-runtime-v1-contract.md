# ADR 0003: Backend runtime v1 contract

- Status: Accepted
- Date: 2026-07-20

## Context

Portal and deploy still know Hermes-specific names, paths, and fields in several places. That blocks true backend swapping. Different backends (Hermes-Lanyard, Hermes upstream, Lanyard Agent) must present one external shape so the platform can select an implementation at deploy time.

Machine-readable schemas will live under `contracts/backend-runtime-v1/`. Architecture notes already describe the target shape in `docs/architecture/backend-runtime-contract.md`.

## Decision

The platform owns a versioned **backend runtime contract** (`backend-runtime-v1`). Every supported backend family implements that contract; the monorepo does not special-case backend internals in Portal or deploy long term.

Contract version 1 covers:

- Artifact manifest and immutable release archive layout
- Runtime filesystem layout under a backend home directory
- Standard gateway entrypoint (`bin/company-brain-backend gateway`)
- Relay protocol and Brain RPC method set
- Profile/capability model and settings/config schema
- Vault and project access behavior as seen by Portal

**Reference implementation:** Hermes-Lanyard for version 1.

**Supported backend kinds (target):**

- `hermes_lanyard`
- `hermes_upstream`
- `lanyard_agent`

Schemas, layout docs, and conformance suites are authored in this monorepo under `contracts/backend-runtime-v1/`. External backends publish artifacts that claim and pass conformance.

## Consequences

- Portal talks to the selected backend through relay and Brain RPC, not by reading backend-specific files on the host.
- Deploy pins a `backend.*` product coordinate rather than Hermes-only fields.
- Hermes-compatible env aliases may exist for transition; the stable platform names are backend-oriented.
- Detailed schemas are filled in during phase 2 beads; this ADR fixes ownership and version-1 intent.
