# ADR 0001: Platform monorepo boundary

- Status: Accepted
- Date: 2026-07-20

## Context

Lanyard work is spread across separate repositories: Portal, client-core, company-brain-deploy, Lanyard Agent, Hermes-Lanyard, and Hermes upstream. Docs, deploy pins, Beads, and shared contracts are fragmented. Agents need too much context before a safe change.

Putting every repository into one monorepo would couple Hermes upstream sync and blur backend product release boundaries. Keeping every repository separate preserves release isolation but leaves platform concerns scattered.

## Decision

Create a **platform monorepo** (`lanyard-platform`) that owns:

- Portal (web, BFF, relay, control-plane, shared packages)
- Client-core seed content and setup assets
- Company Brain deploy (modules, bootstrap, pins, runbooks)
- Shared contracts, conformance tests, product docs, ADRs, and Beads

**In-scope source repositories** (to migrate over time):

- `portal`
- `client-core`
- `company-brain-deploy`

**Out-of-scope source repositories** (remain external):

- Hermes upstream
- Hermes-Lanyard
- Lanyard Agent (unless a later ADR moves it in)

Runtime secrets, live customer configuration, and deploy credentials never live in this git repository.

## Consequences

- Platform code, deploy pipeline, contracts, and backlog share one repo and one Beads workspace.
- Backend agent source is not a monorepo concern; integration is via versioned artifacts and contracts (see [ADR 0002](0002-external-backend-products.md)).
- Product code is not migrated until a Bead explicitly requests that work.
- Permanent workspace paths are decided in [ADR 0004](0004-monorepo-workspace-paths.md) (`portal/`, `client-core/`, `deploy/`, plus platform-native `contracts/`, `docs/`, `compatibility/`).
