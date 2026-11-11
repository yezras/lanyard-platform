# Phase 4 — Chat to harness (no tools)

Back: [overview](./overview.md). Beads: `lp-oop.14`–`.17`, `.26`.

## Goal

When `CHAT_DELIVERY=harness`, POST message does not call Relay. SSE shapes stay the same.

## Changes

- BFF harness client (service token, same idea as `CONTROL_PLANE_SERVICE_TOKEN`).
- Route POST `/api/chat/threads/:id/messages` and GET events / interrupt.
- Lanyard Agent: HTTP turn server in that repo. Platform bead `.26` tracks the LA PR.
- Flag default `relay`. Existing chat tests stay green.

## Data structures

`TurnRequest` / `TurnId`. SSE = existing `RelayChatEvent` plus existing `agent_starting` wake events if CP wake is still in front.

## Verification

BFF integration tests against fake harness. Browser contract unchanged (HTTP + SSE).
