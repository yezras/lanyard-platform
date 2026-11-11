# Current architecture evaluation

## Summary

The current architecture is close to the right shape. Portal already talks to customer hosts through an egress-only relay, and Hermes-Lanyard already implements the host-side Brain RPC pattern. The main problem is naming and ownership. Several Portal and deploy paths still know Hermes directly, which blocks true backend swapping.

## What works

- Portal uses BFF, relay, and control-plane as separate services.
- Relay provides the right network boundary. Customer hosts dial out rather than accepting inbound traffic.
- Brain RPC exists as the host operations path for vault, settings, health, and project operations.
- Hermes-Lanyard already has the reference runtime layout with `HERMES_HOME`, `config.yaml`, `projects.db`, `profiles/`, `skills/`, and `cron/jobs.json`.
- Lanyard Agent already uses Hermes-compatible relay environment names and has a Portal adapter.
- The deploy repo already uses immutable release pins for Hermes and client-core tarballs.

## Main blockers

- Portal BFF has Hermes-specific service names and file reads.
- Portal settings discovery reads Hermes home directly instead of asking the selected backend.
- Control-plane stores fields like `hermes_version` and `hermes_profile`.
- Relay capability descriptors describe connector behavior, not backend runtime capabilities.
- Lanyard Agent does not yet implement the Brain RPC request path needed for host-backed Portal settings. Full gap list, compatibility matrix, and external follow-up: [lanyard-agent-conformance-gaps.md](lanyard-agent-conformance-gaps.md) · [backend-compatibility-matrix.md](backend-compatibility-matrix.md) · [contracts/backend-runtime-v1/conformance.md](../../contracts/backend-runtime-v1/conformance.md).
- Deploy bootstrap installs `/opt/hermes-lanyard` and starts `hermes-gateway.service` instead of a generic backend service.
- Artifact pin files use `hermes.*` instead of a backend product coordinate.

## Decision

Do not make Portal support several backend internals. Make every backend implement one backend runtime contract, with Hermes-Lanyard as the version 1 reference.

