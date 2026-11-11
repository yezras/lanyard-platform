# ADR 0014: Platform ops console on the tenant web tarball

- Status: Accepted
- Date: 2026-08-21
- Epic: `lp-2qs`
- Bead: `lp-2qs.1`
- Supersedes: [ADR 0011](0011-tenant-web-and-platform-admin-apps.md) for production hosting of platform ops
- Design: [dual-auth-credential-planes.md](../architecture/dual-auth-credential-planes.md)

## Context

ADR 0011 put platform superadmin in a separate TanStack Start app (`@lanyard/admin`, Vite `:3001`, `/_protected`). Production Node hosting was a follow-up. That app is a scaffold. It is not shipped on CloudFront. Tenant `lanyard_session` plus Prisma `PlatformAdmin` by email is the auth join.

Frozen product (`lp-2qs`, [portal-connectors.md](../architecture/portal-connectors.md)) needs `https://app.withlanyard.com/admin` on the same `@lanyard/web` tarball, cookie `lanyard_ops_session`, and BFF-gated admin APIs. `/_platform` stays an S3 vault prefix, not a URL.

## Decision

1. Production ops UI is routes under `/admin` inside the existing `portal-web` static artifact. CloudFront default SPA behavior serves it. Bare `/api/admin/*` already goes to BFF.
2. Dual-auth is two cookies and two session records. Tenant admin (`User.isAdmin`) is not an ops session.
3. Control Plane stays private. Secrets ops writes go to CP Postgres KMS ciphertext, not the SM tenant envelope. Admin-only handlers do not wake Daytona.
4. `@lanyard/admin` may remain as a local scaffold until those routes exist on web. It is not the production host.

## Consequences

- ADR 0011 still describes the unused Start app and Prisma `PlatformAdmin` allowlist. Production hosting, “not an `/admin` route”, and “admin is not a CloudFront SPA” no longer hold.
- `lp-2qs.2` mints `lanyard_ops_session`. `lp-2qs.3` ships `/admin` routes and any CloudFront comments. `lp-2qs.4` / `.5` sit on `/api/admin/*`.
- Tenant login, Cognito, and BFF AuthView are unchanged.
}
