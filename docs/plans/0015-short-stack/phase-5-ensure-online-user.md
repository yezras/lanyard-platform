# Phase 5 — ensure_online(tenant, user)

Back: [overview](./overview.md). Beads: `lp-oop.18`–`.20`.

## Goal

Resolve a sandbox by tenant + user without waiting for all of plan 0010.

## Changes

- Pure resolver: if a `scope=user` instance exists for `(tenant, user)`, use it. Else tenant primary. Fail closed if neither.
- `POST /internal/tenants/:tenantId/users/:userId/ensure-online` → existing `ensureOnline(instanceId)`.
- BFF/harness call the resolver on the harness path. Relay path may keep `getPrimaryGatewayInstance` until cutover.

## Data structures

`SandboxKey { tenant_id, user_id }`. Do not add user onto the Daytona API. Wake stays `instance_id`.

## Verification

CP tests: fallback to primary; two users with 0010-shaped fixtures get two instance ids; missing both → 4xx.
