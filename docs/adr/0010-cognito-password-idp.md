# ADR 0010: AWS Cognito is the password identity provider

- Status: Accepted
- Date: 2026-08-14

## Context

Portal password login previously verified hashes in the control-plane `users` table. The sibling iteration used Supabase Auth. This platform is AWS-hosted and already issues a BFF `lanyard_session` cookie used by CSRF, SSE, and `/api`.

## Decision

AWS Cognito User Pool is the password IdP. The existing email/password AuthView posts to the BFF. The BFF authenticates **server-side** (`AdminInitiateAuth` / `AdminCreateUser`) and then mints the existing `lanyard_session` after resolving the control-plane user by email (tenant/RBAC unchanged).

Google OIDC on the BFF is unchanged until a later federated-IdP bead. Cognito Hosted UI and Amplify are not used.

Prisma `User.authUserId` stores the Cognito `sub` when product users are created (follow-up).

## Consequences

- Production BFF requires `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_REGION`. Client secret is injected via the secrets map, never plaintext env.
- Local/dev without Cognito may fall back to control-plane password verification (`isLocalDevMode`).
- Terraform module `deploy/modules/portal-cognito` is infra_ready and **not auto-applied**.
