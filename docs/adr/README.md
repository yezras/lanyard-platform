# Architecture Decision Records

This directory is the permanent ADR index for the Lanyard Platform monorepo.

ADRs record decisions that shape repository boundaries, contracts, deploy, and Portal integration. They are the durable source of truth for *why* the monorepo is shaped the way it is. Migration plans under `docs/plans/` describe *how* to get there.

## Process

1. Propose a decision when a boundary, contract, or long-lived interface would otherwise live only in chat or a plan doc.
2. Add a new file as `NNNN-short-title.md` using the next free number.
3. Use status: `Proposed`, `Accepted`, `Superseded by ADR NNNN`, or `Deprecated`.
4. Link the ADR from this index when accepted.
5. Prefer small, single-decision ADRs over large multi-topic documents.
6. When a decision changes, write a new ADR that supersedes the old one; do not silently rewrite history.

Template skeleton:

```markdown
# ADR NNNN: Title

- Status: Proposed | Accepted | Superseded by ADR NNNN | Deprecated
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences
```

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-platform-monorepo-boundary.md) | Platform monorepo boundary | Accepted |
| [0002](0002-external-backend-products.md) | External backend products | Accepted |
| [0003](0003-backend-runtime-v1-contract.md) | Backend runtime v1 contract | Accepted |
| [0004](0004-monorepo-workspace-paths.md) | Monorepo workspace paths | Accepted |
| [0005](0005-history-preserving-import-strategy.md) | History-preserving import strategy | Accepted |
| [0006](0006-document-server-topology-and-data-residency.md) | Document Server topology and data residency | Accepted |
| [0007](0007-composer-model-intelligence-routing.md) | Composer model intelligence routing | Accepted |
| [0008](0008-tanstack-start-portal-web.md) | TanStack Start for Portal web (SPA mode) | Accepted |
| [0009](0009-prisma-product-database.md) | Prisma product database separate from control-plane Postgres | Accepted |
| [0010](0010-cognito-password-idp.md) | AWS Cognito is the password identity provider | Accepted |
| [0011](0011-tenant-web-and-platform-admin-apps.md) | Tenant web and platform admin as separate Start apps | Superseded by ADR 0014 |
| [0012](0012-short-stack-harness.md) | Short stack harness and vault planes | Accepted |
| [0013](0013-daytona-chat-relay-retire.md) | Retire Relay from the Daytona harness chat hop | Accepted |
| [0014](0014-platform-ops-console-on-web-tarball.md) | Platform ops console on the tenant web tarball | Accepted |

## Related docs

- [Root README — repository boundary](../../README.md#repository-boundary)
- [Workspace map](../architecture/workspace-map.md)
- [Client-core path and ownership](../architecture/client-core-path-ownership.md)
- [Import strategy (operational runbook)](../architecture/import-strategy.md)
- [Migration overview](../plans/0001-platform-monorepo-migration/overview.md)
- [Short stack (plan 0015)](../plans/0015-short-stack/overview.md)
- [Portal chat delivery and streaming](../architecture/portal-chat-delivery.md)
- [Backend runtime contract (architecture notes)](../architecture/backend-runtime-contract.md)
- [Current architecture evaluation](../architecture/current-architecture-evaluation.md)
- [Machine-readable contract placeholder](../../contracts/backend-runtime-v1/README.md)
- [Document Server topology (detailed)](../architecture/portal-document-server-topology.md)
