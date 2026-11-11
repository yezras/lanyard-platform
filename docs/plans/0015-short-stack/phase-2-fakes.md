# Phase 2 — Fakes

Back: [overview](./overview.md). Beads: `lp-oop.5`–`.8`.

## Goal

Offline servers that implement the new ports so BFF and CP tests never need Daytona or live S3.

## Changes

- In-process fake harness: `POST /internal/turns`, SSE events, interrupt.
- `FakeS3ObjectStore` implements list + get (in-memory map).
- Contract tests: happy path, unknown tenant, cancel, list pagination.

## Data structures

Fake harness session map keyed by `TurnId`. Fake S3 map keyed by object key.

## Verification

Vitest only. No network except localhost if a tiny listen is simpler than in-process.
