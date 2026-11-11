# Phase 6. Deploy migration

Back to [overview](overview.md).

## Goal

Move company-brain-deploy into the monorepo and update it to the backend artifact contract.

Bead: `lp-k7g.10`.

## Changes

- Move Terraform modules, environments, scripts, and runbooks into `deploy/` (final path per [ADR 0004](../../adr/0004-monorepo-workspace-paths.md); source repo `company-brain-deploy`) via history-preserving import ([ADR 0005](../../adr/0005-history-preserving-import-strategy.md)).
- Update relative paths and bootstrap injection paths.
- Rename Hermes-specific variables, outputs, docs, and systemd units where the runtime is now generic.
- Keep carefully scoped legacy aliases for existing environments.
- Update security, observability, rollback, and artifact runbooks.

## Data structures

- `TenantBackendSelection`: tenant, backend kind, version, artifact pin, contract versions.
- `BootstrapPinsEnv`: generic backend artifact variables plus client-core variables.
- `BackendServiceUnit`: user, env files, working directory, entrypoint, writable paths.

## Verification

- Terraform validates for staging examples. (`lp-k7g.10.6`: `deploy/scripts/validate-staging-roots.sh`; monorepo offline gate check 17 in `scripts/validate.sh`)
- Bootstrap smoke tests pass with Hermes-Lanyard through generic backend variables. (extract/inject/backend-install + platform-staging compose)
- Runtime hardening still restricts writable paths correctly. (`smoke-host-runtime-hardening.sh`)
