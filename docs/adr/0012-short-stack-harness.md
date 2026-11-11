# ADR 0012: Short stack harness and vault planes

- Status: Accepted
- Date: 2026-08-14
- Epic: `lp-oop`
- Plan: [0015-short-stack](../plans/0015-short-stack/overview.md)
- Source: [lanyard-platform#450](https://github.com/LanyardBrain/lanyard-platform/issues/450)

## Context

The Daytona guest runs the Lanyard Agent loop on the same disk as tenant tools. That is a self-edit hole and a fat snapshot. We want the loop off the guest without adding AWS products.

## Decision

1. Chat target path is Browser → BFF → Harness → Daytona toolbox. The harness is the Lanyard Agent host in `LanyardBrain/lanyard-agent`, always on, not a Portal package.
2. BFF ↔ Harness is HTTP + SSE using existing Relay chat event shapes. Not gRPC.
3. Vault UI and OnlyOffice on the new path are BFF → Control Plane → S3. CP is the only AWS S3 client. Opening Directory does not wake a sandbox.
4. Agent file/shell tools use Daytona toolbox on a sandbox resolved by `ensure_online(tenant, user)`.
5. Dual-run: guest-gateway + Relay stay default. Short stack is a new path. Do not rewrite today's snapshot into the harness.
6. One sandbox per concurrent user. Plan 0010 still chooses which instance and which vault prefix.
7. No new AWS products. Relay may leave the Daytona chat path after MockLab proof.

## Consequences

- LA must grow an HTTP turn server and a toolbox-backed file/shell adapter.
- CP must list and get vault objects and resolve `ensure_online` by tenant + user (fallback: tenant primary).
- BFF gains two flags (`CHAT_DELIVERY`, vault plane). Defaults preserve today's behavior.
- Office Document Server still fetches a BFF signed HTTP URL. Bytes come from CP `getObject`, not Brain RPC chunks.

Every chat tool has a placement: harness in-process, Daytona toolbox execute, or platform-then-harness. See [short-stack-tool-placement.md](../architecture/short-stack-tool-placement.md). Do not add a per-tool HTTP API to the sandbox. `web_search`, `parse_document`, and `x_search` stay on the harness (`lp-oop.38.12`).

Runtime hop, SSE, `chat_delivery` resolve, and idle-reaper interaction: [portal-chat-delivery.md](../architecture/portal-chat-delivery.md).

See [ADR 0013](0013-daytona-chat-relay-retire.md) for the post-proof Daytona harness hop (no `deliverInbound`) and the EC2/guest dual-run that still uses Relay.
