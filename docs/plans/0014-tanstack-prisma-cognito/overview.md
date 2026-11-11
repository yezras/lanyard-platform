# 0014 — TanStack Start, Prisma product DB, Cognito password auth

Convert Portal web to TanStack Start (SPA), land `@lanyard/db` on Postgres `portal_app`, and authenticate passwords through AWS Cognito while keeping the BFF session cookie.

## Decisions

- [ADR 0008](../../adr/0008-tanstack-start-portal-web.md) — Start SPA, static `portal-web` artifact
- [ADR 0009](../../adr/0009-prisma-product-database.md) — Prisma `portal_app` vs control-plane `portal_cp`
- [ADR 0010](../../adr/0010-cognito-password-idp.md) — Cognito IdP, BFF session

## Copy source

Sibling repo `/Users/operator/Desktop/Lanyard/lanyard` (`packages/db`, Start Vite plugin, `apps/admin` as a port source). Do not copy Nitro, Vercel, Supabase auth, or Hosted UI. Platform admin lives at `portal/apps/admin` ([ADR 0011](../../adr/0011-tenant-web-and-platform-admin-apps.md)).

## Out of scope

- Prisma-backed domain APIs / Start server functions
- Wiring Prisma models into the UI
- Cognito Hosted UI or Google federation through Cognito
- Start Node server instead of CloudFront static edge

## Testing

See [testing.md](./testing.md).
