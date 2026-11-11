# lp-p37.2 DB-backed integration evidence

| Field | Value |
| --- | --- |
| timestamp_utc | 2026-07-27T19:42:50Z |
| mode | security-focus |
| database | `postgres://portal:portal@127.0.0.1:5432/portal_cp` |
| started_db_here | 0 (disposable=0) |
| control-plane | **pass** (exit 0) |
| control-plane files | Test Files  7 passed (7) |
| control-plane tests | Tests  52 passed (52) |
| bff | **pass** (exit 0) |
| bff files | Test Files  9 passed (9) |
| bff tests | Tests  39 passed (39) |
| overall | **PASS** |

## Pass / fail counts (audit follow-up)

| Suite | Files | Tests | Result |
| --- | --- | --- | --- |
| control-plane (security-focus) | Test Files  7 passed (7) | Tests  52 passed (52) | pass |
| bff (security-focus) | Test Files  9 passed (9) | Tests  39 passed (39) | pass |
| **overall** | | | **PASS** |

## Coverage (security-focus file set)

Control-plane: auth, rbac, tenant-authz, tenant-members, service-auth, session-shares, schema-boundary.

BFF: auth, settings, vault, projects, session-sharing, session-shares-list, org-members, rbac, staging.

## Command

```bash
bash portal/scripts/run-db-backed-integration-tests.sh --security-focus
```

## Cleanup

```bash
docker compose -f portal/docker-compose.yml down        # stop stack
docker compose -f portal/docker-compose.yml down -v     # also drop portal-pg-data
# disposable mode removes its container on exit unless --keep-db
```
