# ADR 0011: Tenant web and platform admin as separate Start apps

- Status: Superseded by [ADR 0014](0014-platform-ops-console-on-web-tarball.md) for production ops hosting
- Date: 2026-08-16

## Context

`@lanyard/web` is the per-tenant product SPA (Chat, Vault, Tools) packed as a static `portal-web` tarball ([ADR 0008](0008-tanstack-start-portal-web.md)). Platform superadmin (cross-tenant businesses, operators) lived in a sibling repo `apps/admin` and was explicitly not copied during plan 0014.

Operators need a distinct admin app with TanStack Start server functions against Prisma `portal_app` ([ADR 0009](0009-prisma-product-database.md)). Mixing that into the tenant SPA would couple CloudFront static hosting with privileged platform APIs.

## Decision

Portal UI is two workspace apps under `portal/apps/`:

| App | Package | Role | Hosting today |
| --- | --- | --- | --- |
| Tenant | `@lanyard/web` | Per-tenant Chat / Vault / Tools | Static `portal-web` artifact (SPA). BFF remains the `/api` edge. |
| Admin | `@lanyard/admin` | Platform superadmin | TanStack Start server in Vite dev (`:3001`). Production Node hosting is a follow-up. |

Shared libraries stay in `portal/packages/*`. Both apps may use `createServerFn`. Do not copy Nitro, Vercel, or Cognito Hosted UI. `@lanyard/auth` verifies the BFF `lanyard_session` cookie (Cognito + Prisma `portal_app`); do not reintroduce Supabase. Sibling `@lanyard/ui` / LoginForm stay out — tenant login remains the BFF AuthView.

## Consequences

- Tenant production remains CloudFront + BFF; server functions in `@lanyard/web` are for `vite dev` until a Start Node host is chosen.
- Admin is not a CloudFront SPA and is not an `/admin` route on the tenant app.
- ADR 0008 still holds for the tenant artifact; its “`createServerFn` deferred” line is superseded by this ADR for both apps.
- Start functions join the BFF session to Prisma `User` / `PlatformAdmin` by email. Inviting a Prisma user does not create a control-plane user; BFF login still requires that link.
- Admin `GET /api/auth/me` uses the tenant slug from the Referer path, or `DEV_TENANT_SLUG` on localhost.
