# ADR 0008: TanStack Start for Portal web (SPA mode)

- Status: Accepted
- Date: 2026-08-14

## Context

`@lanyard/web` was a Vite SPA with in-memory Agents / Vault / Tools tabs and no URL routing. Production ships a static `portal-web` tarball to S3 + CloudFront (`pack-web.sh`). A sibling iteration already used TanStack Start.

## Decision

Convert `@lanyard/web` to **TanStack Start** with file routes (`/chat`, `/vault`, `/settings`) in **SPA mode**. The Hono BFF remains the API edge. The static `portal-web` artifact remains the production shape until a later decision to run a Start Node server.

## Consequences

- Client URLs are real routes; CloudFront continues to fall unknown paths back to `index.html`.
- BFF `/api` (and `/<tenant>/api`) is unchanged.
- Start `createServerFn` / SSR hosting was deferred here; [ADR 0011](0011-tenant-web-and-platform-admin-apps.md) allows server functions in `portal/apps/{web,admin}` while the tenant production artifact stays a static SPA.
