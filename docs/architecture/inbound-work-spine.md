# Inbound work spine

One inbound envelope, one harness path, Daytona only when the turn needs a computer.

Locked after the chat-delivery / Relay-retire discussion. Implementation plan for review: [0019 inbound work spine](../plans/0019-inbound-work-spine/overview.md). Related: [portal-chat-delivery.md](portal-chat-delivery.md), [short-stack-tool-placement.md](short-stack-tool-placement.md), [0017 first-chat speed](../plans/0017-sandbox-first-chat-speed/overview.md), [warm pool](../plans/0008-daytona-agent-sandboxes/warm-pool-snapshot-wake.md), [idle reaper](../plans/0008-daytona-agent-sandboxes/idle-reaper.md).

Portal Settings does not own these knobs. BFF never talks to Daytona or S3. CP is the only Daytona client.

## The rule

Every trigger becomes one work item and the same worker:

```text
Portal send | Slack | email | WhatsApp | cron due | mailbox.send
  → InboundWorkItem
  → keyed lease (tenant_id, thread_id)
  → ensure_online only if sandbox_need=toolbox
  → harness startTurn
  → room log
  → Jack SSE / outbound fan-out is a view, not the hop
```

There is no Relay path on this spine. Dual-run `CHAT_DELIVERY=relay` stays for unflipped EC2 guests until those tenants move. New inbound does not add `deliverInbound`.

Do not round-robin events across workers. Serialize per room. Parallelize across rooms.

## Work item

Reuse harness `TurnRequest` plus:

| Field | Values | Meaning |
| --- | --- | --- |
| `source` | `web` `slack` `email` `whatsapp` `cron` `mailbox` | Why it woke |
| `sandbox_need` | `none` `toolbox` | Same as `HarnessSandboxNeed` in `chat-instance-resolve.ts` |
| `tenant_id` `user_id` `instance_id` `thread_id` `message` | required | Same as `TurnRequest` |
| `sandbox_id` | optional | Stamped after wake, for toolbox |

`none`: no `ensure_online`. Pure LLM / web_search-style turns on Fargate. Today Portal harness send hard-codes `sandboxNeed: "none"` (`lp-vqr0.11`).

`toolbox`: file/bash. Kick `ensure_online` **at enqueue**, join singleflight, stamp `sandbox_id` on the turn. Classifier is BFF at enqueue (§4.2 in plan): web `none` by default, channel `toolbox` on attachment/vault intent, cron from `sandbox_create_profile`, mailbox inherits.

Cron does not wake a channel. Mailbox wakes `to` in the chosen room. Channel human send still uses lead plus `@`s as the wake set, each as its own work item on the **same** `thread_id` (serial).

## Sandbox speed

Do not cold-create on the event. Bound `sandbox_id` + retain-on-stop is the default. Next toolbox event is `start_from_stopped` (measured p95 about 5s, live re-wake about 1s). First-ever bind is provision, `/chat` land, or warm-pool claim, off the click.

| `sandbox_need` | Wake | Stop |
| --- | --- | --- |
| `none` | skip Daytona | n/a |
| `toolbox` | `ensure_online` at enqueue; never wait CloudFront for the start | after the room lease is empty plus a short hot window, **stop and retain** `sandbox_id`. Do not archive. Do not delete. |

Hot window is ~45s (`stop_after = last_turn_at + 45s`) after the last turn on that thread, not the 10 minute idle grace, for toolbox rooms on this spine — **CP reaper remains the sole Daytona stop owner; the lease annotates `stop_after` and `CP stop` is idempotent (no-ops if `mid_turn` active).** Burst stays warm. Next event is start-from-stopped, not create.

`agent_ready` and `vault_writable` stay independent. Chat / `startTurn` may run before Mountpoint is writable. File tools wait on writable.

Warm pool (`DAYTONA_WARM_POOL_ENABLED`, size clamped 1–2 on MockLab): claim a pre-created stopped id when the instance has no `sandbox_id`. Replenish off the event path. Tests use real harness (via harness-local). Do not enable the paid org from CI.

`mid_turn` is armed on every `message`/`toolbox` work item even when `SIGNAL_ACTIVITY_ENABLED` is unset (the 2026-08-26 stall); flag gates only `tool_progress`/`brain_rpc`. Harness SSE has a 120s stall watchdog that emits `error`.

Wake caps stay: `ENSURE_ONLINE_TENANT_MAX_WAKES` / global. One tenant cannot start every box.

## Workers

Lease key `(tenant_id, thread_id)`. One in-flight speaker per room. Steal only unleased rooms.

The leaser is not an HTTP load balancer and not the agent. BFF verifies webhooks and maps them to a work item. The leaser leases and calls existing `HARNESS_URL /internal/turns`. Fargate runs the loop. CP starts and stops Daytona.

A first version is **durable Postgres row with `SKIP LOCKED` leases** (TS, `portal/packages/control-plane` owns the table; BFF enqueues). A small Rust leaser is an **allowed swap only after that contract proves on real harness (via harness-local)/real harness** (`portal/packages/inbound-leaser/` if kept). It does not terminate Portal TLS, parse Slack, or talk to Daytona.

Outbound (Portal SSE, Slack reply, email send) fans out from the room log. It is not the same queue.

## Already in tree

| Piece | Where |
| --- | --- |
| `HarnessSandboxNeed` `none` \| `toolbox` | `portal/packages/bff/src/chat-instance-resolve.ts` |
| No-tool harness skips wake | `lp-vqr0.11` |
| Speculative ensure_online on `/chat` | `lp-vqr0.9` |
| Detach POST while waking | `lp-vqr0.8` |
| Retain-on-stop, start-from-stopped | `DAYTONA_RETAIN_SANDBOX_ON_STOP` default on |
| Warm pool claim + replenish | `lp-vqr0.10`, default **off** |
| Cron fire function | `fireScheduledTaskHarnessTurn` (`lp-oop.38.8`); live evaluator off |
| Channel adapter compose | `deliverChannelAdapterInbound` still ends in Relay `deliverInbound` |

## Not this spine

- Global `CHAT_DELIVERY=harness` while EC2 guests still exist
- Sleeping Fargate, BFF, CP, or ONLYOFFICE
- Agent↔agent token pipes; A2A is `mailbox.send` then a work item
- Per-event Daytona **create** or **archive**
- Per-channel sandbox identity
