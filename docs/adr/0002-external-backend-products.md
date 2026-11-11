# ADR 0002: External backend products

- Status: Accepted
- Date: 2026-07-20

## Context

Portal should be able to use different backend agents without changing Portal behavior. Hermes-Lanyard tracks a Nous/Hermes upstream line and needs independent release and sync. Lanyard Agent is a separate backend product with its own lifecycle.

If backend source lives inside the platform monorepo, backend swapping looks like a source-layout problem, Hermes upstream sync becomes painful, and product release boundaries blur.

## Decision

**Backend agent source stays outside this monorepo.** Explicit exclusions:

| Backend product | Repository stays external | Integration mode |
| --- | --- | --- |
| Hermes upstream | Yes | Publishes versioned artifacts that may seek conformance |
| Hermes-Lanyard | Yes | Reference implementation for `backend-runtime-v1`; ships tarballs |
| Lanyard Agent | Yes (default) | Conforms to the same contract; ships tarballs |

This monorepo **must not**:

- Copy, vendor, or subtree-merge backend product source trees
- Treat Hermes-specific install paths or service names as the long-term platform API
- Store backend source as a substitute for release pins

This monorepo **does**:

- Own the runtime contract backends must implement ([ADR 0003](0003-backend-runtime-v1-contract.md))
- Pin immutable artifact coordinates (URL, version, SHA-256, kind)
- Validate, deploy, and conformance-test against those pins
- Document backends as swappable products, not monorepo packages

Hermes-Lanyard remains the version 1 reference implementation. Lanyard Agent moves into the monorepo only if a later ADR explicitly changes this boundary.

## Consequences

- Deploy and Portal depend on artifact pins and contracts, not on backend git checkouts.
- Backend teams keep independent release trains and upstream sync workflows.
- Conformance tests become the gate for “Portal can run this backend.”
- Agents working in this repo should not migrate backend product code unless a Bead and ADR authorize it.
