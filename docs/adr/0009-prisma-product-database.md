# ADR 0009: Prisma product database separate from control-plane Postgres

- Status: Accepted
- Date: 2026-08-14

## Context

Control-plane Postgres (`portal_cp` / RDS) already owns `tenants`, `users`, RBAC, gateway instances, and audit. The product domain (Business, Folder, OAuth tokens, model-provider tokens) needs its own schema. Prisma maps `User` → `users`, which collides with the control-plane table if they share a database.

## Decision

Product data lives in Prisma package `@lanyard/db` against a **separate** Postgres database `portal_app`. Control-plane Postgres stays the deploy / RBAC / registry store. Do not share tables or schemas.

`User.authUserId` is the Cognito `sub` (UUID). There is no foreign key to an IdP table — Cognito is not in Postgres.

## Consequences

- Local compose Postgres runs two databases: `portal_cp` and `portal_app`.
- Prisma `DATABASE_URL` must never reuse `CONTROL_PLANE_DATABASE_URL`.
- Application APIs over Prisma are a follow-up; this ADR only splits ownership.
