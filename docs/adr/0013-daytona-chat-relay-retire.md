# ADR 0013: Retire Relay from the Daytona harness chat hop

- Status: Accepted
- Date: 2026-08-17
- Epic: `lp-oop`
- Bead: `lp-oop.35`
- Plan: [0015 phase 9](../plans/0015-short-stack/phase-9-relay-retire.md)
- Supplements: [ADR 0012](0012-short-stack-harness.md)

## Context

ADR 0012 locked the Daytona target path as Browser → BFF → Harness → Daytona toolbox and said Relay may leave that hop after MockLab proof. Phase 8 kitchen-sink is `GO_WITH_WAIVERS`. Live AWS `chat_delivery` was **not** flipped. EC2 and guest-gateway tenants still need Relay.

## Decision

1. The Daytona harness chat hop has no Relay `deliverInbound` or `interruptInbound`. BFF send/cancel use a discriminated input so the harness variant cannot carry a Relay client.
2. EC2 and guest-gateway dual-run stay on `ChatDelivery=relay` until those tenants move. Default process env remains `relay`.
3. This decision does not delete the Relay service, does not set global `CHAT_DELIVERY=harness`, and does not flip live MockLab persist.
4. Slack, email, and scheduled-task inbound stay on Relay until those planes get their own cutover.

## Consequences

- Daytona tenants that persist or env-select `harness` never touch Relay on Portal chat send, SSE, or cancel.
- Operators still flip MockLab alone via persisted `chat_delivery` after the harness task is healthy.
- EC2 chat keeps today's BFF → Relay → guest-gateway hop.

Runtime map of Send / SSE / cancel and the flags on that path: [portal-chat-delivery.md](../architecture/portal-chat-delivery.md).
