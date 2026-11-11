# Phase 3 — Vault and Office via CP → S3

Back: [overview](./overview.md). Beads: `lp-oop.9`–`.13`.

## Goal

Directory and OnlyOffice on the new path read S3 through CP. No sandbox wake.

## Changes

- CP internal HTTP: list/stat/get under the tenant vault prefix. ACL from stamped tenant + path prefixes. No `@aws-sdk` in BFF.
- CP internal HTTP **put/CAS** (`lp-zuh.12.7`): `PUT /internal/tenants/:tenantId/vault/put` with `if_match` (etag or content_hash). Used by Office callback writeback on the short stack.
- BFF `CpS3VaultProvider` behind `VaultPlane=cp_s3`. Default plane unchanged.
- Office `OfficeBinaryContentSource` streams CP `getObject` for the signed download URL.
- BFF `createCpS3OfficeCallbackVaultWriter` when `VaultPlane=cp_s3` — Office callback status 2/6 writes via CP put (no Brain RPC `vault.write`).
- `GET /api/vault/tree` must not call `ensure_online` on this plane.

## Data structures

Reuse vault tree/entries/content JSON. CP get returns bytes + etag + size.

## Verification

CP tests on FakeS3. BFF vault + office tests with fake CP. Assert no orchestrator call on tree GET.
