# Phase 1 — Contracts and flags

Back: [overview](./overview.md). Beads: `lp-oop.2`–`.4`.

## Goal

Name the unions and ports before any runtime path flips. Defaults stay today's behavior.

## Changes

- New harness turn types (new files under `portal/packages/shared` or `contracts/`). `TurnRequest`, `TurnId`, event aliases of existing `RelayChatEvent`.
- BFF `ChatDelivery = 'relay' | 'harness'` parsed like other env flags. Default `relay`.
- CP `VaultObjectStore` port grows `listPrefix` + `getObject`. Types only plus FakeS3 stubs that fail closed until phase 2.

## Data structures

Discriminated unions `ChatDelivery` and `VaultPlane`. Branded `TurnId`. No parallel booleans.

## Verification

`tsc` / package tests. Flags off → existing tests still pass.
