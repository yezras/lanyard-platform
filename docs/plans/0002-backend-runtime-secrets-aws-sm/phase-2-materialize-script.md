# Phase 2. Materialize script

Back to [overview](overview.md).

## Goal

Ship an offline-tested host tool that turns an SM envelope into files on disk without SSH interaction at steady state (invoked by bootstrap/systemd).

## Tool

`deploy/scripts/materialize-backend-secrets.sh` (or `.py` if validation is cleaner)

### Inputs (env or flags)

| Input | Meaning |
| --- | --- |
| `BACKEND_RUNTIME_SECRETS_ARN` or `--secret-arn` | SM secret id/ARN |
| `BACKEND_HOME` / `HERMES_HOME` | Runtime home (default Hermes path if only HERMES_HOME set) |
| `BACKEND_KIND` | Optional; for path selection |
| `AWS_REGION` | Region for GetSecretValue |
| `--dry-run` | Print actions, write nothing |

### Behavior

1. `aws secretsmanager get-secret-value` (fail closed if missing/denied).
2. Parse JSON; validate against envelope schema (fail closed).
3. Write **managed** env file, e.g. `$HOME/.env.secrets` with mode `0600`, owner service user.
4. Merge strategy for primary `.env`:
   - Prefer: systemd loads **both** `EnvironmentFile=-.env` and `EnvironmentFile=-.env.secrets` (order: secrets last wins), **or**
   - Atomically rewrite a managed block between markers `# BEGIN BACKEND_RUNTIME_SECRETS` / `# END …` in `.env`.
5. If `config_secret_overlay` present: write `config.secrets.yaml` and/or merge secret keys into config using a documented deep-merge (idempotent).
6. Never log secret values.
7. Exit non-zero on schema or AWS failure so systemd does not start with empty keys when required.

### Idempotency

- Re-run with same SM payload produces byte-identical managed files (stable key sort).
- Re-run after SM rotation updates files; no duplicate keys.
- Does not delete operator-managed keys **outside** the managed block / `.env.secrets`.

## Changes

- Materialize script under `deploy/scripts/`
- Offline smoke: fixture JSON secret via `AWS_ENDPOINT_URL` mock **or** file fixture mode `--from-file` for CI without AWS
- Unit tests for merge/markers
- Optional: `deploy/scripts/smoke-materialize-backend-secrets.sh`

## Verification

- `--from-file` fixture: writes expected env keys, mode 0600 when run as appropriate user in smoke
- Second run no-op (same checksum)
- Invalid schema → non-zero
- `bash scripts/validate.sh` includes smoke when present

## Beads

Implementable leaf under epic phase 2.
