# 0019 — Replace chat delivery with an inbound work spine

**Status:** Reviewed 2026-08-26. D1–D10 locked. Beads epic `lp-k5c4` cut from revised §9. First impl `lp-k5c4.2`.  
**Date:** 2026-08-26  
**Audience:** Reviewing agents and humans. Implementation agents after a reviewed lock.  
**Shorthand lock:** [inbound-work-spine.md](../../architecture/inbound-work-spine.md)  
**Related:** [portal-chat-delivery.md](../../architecture/portal-chat-delivery.md), [ADR 0012](../../adr/0012-short-stack-harness.md), [ADR 0013](../../adr/0013-daytona-chat-relay-retire.md), [0015 short stack](../0015-short-stack/overview.md), [0017 first-chat speed](../0017-sandbox-first-chat-speed/overview.md), [warm pool](../0008-daytona-agent-sandboxes/warm-pool-snapshot-wake.md), [mailbox v1](../0017-agent-mailbox-v1/README.md), [scheduled tasks](../0012-scheduled-tasks/overview.md)

Beads epic: **`lp-k5c4`**. Leaf table: [issue-map.md](./issue-map.md). Parallel drain: [parallel-waves.md](./parallel-waves.md). First implementation bead is `lp-k5c4.2`. Rust leaser (`lp-k5c4.9`) is a later swap, not v1. EC2 residual is `lp-k5c4.14`.

---

## 1. Why this plan exists

Portal chat delivery is two products glued together. `CHAT_DELIVERY=relay|harness` plus tenant persist. Slack and email still `deliverInbound` on Relay. Cron has a guest fire and a harness fire. Mailbox freeze/thaw still calls `relayClient` on a harness send. Agent-to-agent never worked on live MockLab. Turns stall when `SIGNAL_ACTIVITY_ENABLED` is unset and the idle reaper stops the box with `skipped_mid_turn=0`.

The intended product is already written in ADR 0012: Browser → BFF → always-on Lanyard Agent Fargate → Daytona toolbox. Dual-run was supposed to be a cutover. It became the architecture.

This plan replaces the **delivery hop** with one inbound spine. It does **not** rewrite Portal, Control Plane, Lanyard Agent, or auth in a new language.

Reviewers should attack the decisions in §3 and the open questions in §12. If those hold, a later pass may turn §9 into beads.

---

## 2. Problem

### 2.1 What is broken

| Symptom | Cause in current code |
| --- | --- |
| Two hops, five callers | `requestChatDelivery` on Portal send; adapters ignore it and always Relay |
| Live harness stall 2026-08-26 | Tenant persist `harness`, env `relay`, `SIGNAL_ACTIVITY_ENABLED` unset, no mid_turn, reaper `skipped_mid_turn=0`, SSE no watchdog on `main` |
| A2A "never talked" | Closed `lac-xsb` / `lac-bx3`. Mention-hop retired. `mailbox.send` helpers exist; BFF `app.ts` does not call them for a second `startTurn` |
| Slack / email not on harness | `deliverChannelAdapterInbound` ends in Relay `deliverInbound` |
| Cron split-brain | Guest `deliverInbound` vs `fireScheduledTaskHarnessTurn`. Live `SCHEDULE_EVALUATOR_ENABLED` off |
| History can disagree with Send | Process env vs tenant persist on some routes |
| Instance `chat_delivery` unused | Documented instance > tenant > env. BFF Send uses tenant + env only |

### 2.2 What is bloat, not mystery

- Discriminated `DeliverChatTurnInput` so harness cannot carry `relayClient`, then thaw/halt still using Relay
- `CHAT_DELIVERY` env, tenant column, instance column, honesty UI, operator HOLD docs
- Guest gateway WSS + G6 routing bus (`getInstanceOwner`) for a path we want to leave
- Two SSE proxies (`openChatEventStream` vs `proxyHarnessTurnsUntilAbort`)

### 2.3 What is **not** the problem

`TurnRequest`, `startTurn`, harness SSE shapes, `HarnessSandboxNeed`, CP `ensure_online`, retain-on-stop, real harness warm pool, BFF thread store, webhook verify, Fargate LA. Those are the target. Throwing them away to "start from scratch" would rebuild the same contracts and keep the same ops bugs.

---

## 3. Decisions for review

Lock or reject these. Do not silently invert them in a beads graph.

| # | Decision | Chosen | Rejected |
| --- | --- | --- | --- |
| D1 | Replace the hop, not the platform | One inbound envelope → harness `startTurn`. Delete Relay from Portal chat, Slack, email, cron, mailbox on the Daytona/short-stack path. | Greenfield Rust BFF, Rust agent, new SSE protocol |
| D2 | One path for new inbound | No `ChatDelivery` branch on new callers. No new `deliverInbound`. | Keep dual-run as the long-term product |
| D3 | `sandbox_need` on every work item | `none` skips Daytona. `toolbox` wakes at enqueue. Same union as `HarnessSandboxNeed` today. | Start a sandbox for every LLM-only turn |
| D4 | Fast sandbox = retain + start-from-stopped | Never cold-create on the event. Warm pool for unbound first bind. Stop + retain after lease empty plus a 30–60s hot window. | Per-event Daytona create/destroy. Archive on that stop. Sleep Fargate/BFF/CP/Office |
| D5 | Parallelize by room, not by event | Lease key `(tenant_id, thread_id)`. Serial in a room. Parallel across rooms. | Global FIFO. Round-robin messages. One worker for the whole org |
| D6 | Rust is the leaser, **later swap, not v1** | **Phase 2 is TS only: BFF + durable Postgres row (`SKIP LOCKED`).** Rust binary is an *allowed swap leaf after the enqueue→lease→POST HARNESS contract is stable and proven on real harness/real harness.* Scope when it exists: enqueue/lease/heartbeat + `POST HARNESS_URL /internal/turns` only. Does not parse Slack, terminate Portal TLS, or call Daytona. Crate location if kept: `portal/packages/inbound-leaser/` (or `portal/packages/control-plane/src/inbound-leaser/` if CP owns the table). Top-level `Cargo.toml` is not created in v1. | Rust HTTP load balancer in front of CloudFront. Rust rewrite of Lanyard Agent. Top-level random crate in v1. |
| D7 | Outbound is not the inbound queue | Turn SSE → room log → Portal SSE / Slack reply / email send. | One bus for inbound and outbound |
| D8 | A2A is mailbox then a work item | `mailbox.send` appends, then enqueue a wake for `to`. No peer token streams. No mention-hop. | Agent SSE to agent. Reopen `lac-xsb` / `lac-bx3` |
| D9 | CP remains the only Daytona and S3 client | Leaser/BFF call CP `ensure_online` / `stop`. | BFF or Rust imports Daytona SDK or S3 |
| D10 | EC2 guest-loop tenants — **locked: MockLab+Daytona spine-only first, EC2 stays Relay** | **Locked:** `runtime_kind=ec2` stays on deprecated `Relay WSS / G6` as an explicit residual, not a silent forever dual-run. It does **not** block the MockLab/Daytona spine flip. Global `CHAT_DELIVERY=harness` is forbidden while EC2 loops live (`portal-chat-delivery.md`, `provision-prod-tenant.md`). A tracked residual leaf `lp-k5c4.ec2-cutover` (move or explicit wontfix) retires it later. | Global `CHAT_DELIVERY=harness` tomorrow while EC2 loops still live on the guest |

---

## 4. Target runtime

Always-on: BFF, Control Plane, Fargate LA harness. Sleepy: Daytona toolbox VM, stopped with `sandbox_id` retained.

```text
Slack Events / inbound email / WhatsApp / Portal POST / CP cron due / mailbox.send
        │
        ▼
 BFF (auth, verify, map tenant/thread/persona/source/sandbox_need)
        │
        ▼
 enqueueInbound(InboundWorkItem)     ← durable row + keyed lease
        │
        ├─ if sandbox_need=toolbox: CP ensure_online (singleflight, at enqueue)
        │         start_from_stopped if sandbox_id bound
        │         warm_pool claim if unbound
        │         never cold_create on this event
        │
        ▼
 worker holds lease (tenant_id, thread_id)
        │
        ▼
 POST HARNESS_URL/internal/turns   TurnRequest + sandbox_id if toolbox
        │
        ▼
 Fargate LA turn → toolbox only if tools need /mnt/vault
        │
        ▼
 BFF thread log + GET …/events SSE (Jack's view)
        │
        ▼
 lease empty + hot window → CP stop, retain sandbox_id, do not archive
```

Fargate does not poll Gmail. CP ticks cron. Vendors push webhooks. Daytona is a computer for that turn.

### 4.1 `InboundWorkItem`

Reuse `TurnRequest` from `portal/packages/shared/src/harness/turn.ts`:

```text
tenant_id, user_id, instance_id, thread_id, message
sandbox_id?          // stamped after wake
metadata.persona?
metadata.room_tail?
metadata.hidden_instruction?
```

Add:

```text
source          = web | slack | email | whatsapp | cron | mailbox
sandbox_need    = none | toolbox
correlation_id  = opaque id for logs / retries
enqueue_at      = ms
```

Unknown `sandbox_need` **rejects at parse** (HTTP 400 / row reject, not fail-closed to `none`). A typo must not silently skip a needed box and defeat the wake. Lock: reject.

### 4.2 `sandbox_need`

| Value | Daytona | Examples |
| --- | --- | --- |
| `none` | No `ensure_online` | Portal "hi", Slack text with no file tools, LLM-only cron |
| `toolbox` | `ensure_online` at enqueue | bash/read/grep, `parse_document` that needs vault bytes, memory_read on `/mnt/vault` |

Today Portal harness send **hard-codes** `sandboxNeed: "none"` in `app.ts`. That is correct for no-tool Send. It is wrong as the only value once Slack or cron may need files. Classification is part of mapping, not a user setting.

**Classifier (locked):** BFF decides at enqueue; callers do not choose `sandbox_need`.

| Source | `sandbox_need` rule | Why |
| --- | --- | --- |
| `web` | `none` unless prompt intent needs files (contains `/mnt/vault`, `parse_document`, `memory_read`, `bash`/`read`/`grep` tool intent) | Portal "hi" stays wake-free |
| `slack`/`email`/`whatsapp` | `toolbox` if attachment present or prompt references file/vault tools; else `none` | Channel adapter wraps `channel-adapter-deliver.ts` enqueue wrappers do the sniff |
| `cron` | `toolbox` if `ScheduledTaskJobDefinition` has `sandbox_create_profile=tool_only`, else `none` | Cron store already carries the profile |
| `mailbox` | inherit target thread's prior need, or `none` for plain `hidden_instruction` wake | Keeps A2A LLM-only by default |

If classification is uncertain, `toolbox` is safer and slower. Do not default the whole spine to `toolbox` — `none` is the common fast path for plain chat.

Implementation lives in `chat-instance-resolve.ts` + enqueue wrappers around `channel-adapter-deliver.ts` / `scheduled-task-harness-fire.ts` / `mailbox-hop.ts`.

### 4.3 Lease and parallelism

| Rule | Why |
| --- | --- |
| Key = `(tenant_id, thread_id)` | One speaker per room. `ThreadTurnQueue` doctrine. |
| One lease per key | Two `startTurn`s in one room is overlapping bubbles / old hop-chain |
| Many keys at once | Jack's 1:1 and Acme's cron do not share a line |
| Steal unleased keys only | Work stealing on partitions, not on an in-flight room |
| Per-tenant inflight cap | Same idea as `ENSURE_ONLINE_TENANT_MAX_WAKES` |
| Crash → lease TTL | Heartbeat. Expired lease is retryable |

Capacity is `min(ready_rooms, harness_slots)`, not `min(events, workers)`.

First implementation: **durable Postgres row with `SELECT ... FOR UPDATE SKIP LOCKED` leases** owned by `portal/packages/control-plane` (or BFF + CP table). Same HTTP contract: `POST /enqueue`, workers `POST` harness. Rust swap is a later leaf only after this contract proves on real harness.

SQS FIFO `MessageGroupId=tenant:thread` is a *deploy-time alternate* only — not the phase-2 choice. It adds an AWS product not in the MockLab deploy and duplicates the CP DB you already run. It is not a third hop in front of CloudFront.

**BFF horizontal scale gap:** `HarnessTurnRegistry` and `threadLiveEvents` in `app.ts` are in-process memory today. Two BFF replicas lose `turn_id` visibility and live events. Spine must add a durable `harness_turns` table (or Redis hub) or sticky `thread_id` routing before multi-replica; phase 5a below.

### 4.4 Sandbox lifecycle on this spine

Measured Daytona API only (`lp-bnd`): create p50 ~0.7s tail ~19s. start-from-stopped p50 ~2.8s p95 ~5s. Live re-wake ~1.1s. User-visible minutes were mount, writable wait, gateway, Relay. Chat must not wait on `vault_writable` (0017).

| Path | When allowed on an event |
| --- | --- |
| `already_online` | Box up |
| `start_from_stopped` | `sandbox_id` bound, stopped. **Default toolbox path.** |
| `warm_pool` | No `sandbox_id`. Claim stopped pre-create, bind, start. Off the interactive click if possible. |
| `cold_create` | **Forbidden on the event.** Create-ahead at provision, land, or pool replenish. |
| `archive_restore` | Not the event path. Do not archive on spine stop. |

Stop: when the room lease has no queued items and the hot window (30–60s) elapsed, **request `CP stop` idempotently** with `DAYTONA_RETAIN_SANDBOX_ON_STOP` on. Presence `offline`. Same `sandbox_id`. Next toolbox event starts that box. Leaser/BFF **never call Daytona directly** — CP is the only Daytona client (D9).

Idle reaper remains the sole Daytona stop owner (`idle-reaper.ts` scans every 60s, default 10m grace, `skipped_mid_turn` when `mid_turn` active). Spine-managed toolbox rooms do not wait 10m: the lease annotates `stop_after = last_turn_at + 45s` and the reaper honors it (or `CP stop` is idempotent and no-ops if `mid_turn` still active). This prevents double-stop / mid_turn fights. Leaser never clears `mid_turn` early; clear is on `turn_complete` (prefer) or 45m max hold expiry.

Kick `ensure_online` at **enqueue**, join existing singleflight. Webhook returns 200 after the row exists. Worker waits `agent_ready` or attaches to the in-flight wake. Do not hold CloudFront 60s.

Warm pool: existing `lp-vqr0.10` / `DAYTONA_WARM_POOL_*`. Default off in CI against the paid org. MockLab cap 1–2. Replenish after the ensure_online stack, not on Send.

---

## 5. Caller map (must all use enqueue)

| Caller today | Today’s hop | Spine |
| --- | --- | --- |
| `POST /api/chat/threads/:id/messages` | `requestChatDelivery` → Relay or `startTurn` | Always enqueue. `source=web`. `sandbox_need=none` unless the send is classified toolbox |
| `GET …/events` | Relay hub or `proxyHarnessTurnsUntilAbort` | Harness turn SSE only for spine tenants |
| `POST …/cancel` | `interruptInbound` or `interruptTurn` | Interrupt remembered `turn_id` |
| `deliverChannelAdapterInbound` | always `deliverInbound` | enqueue `source=slack\|email\|whatsapp`. Same primary `instance_id` |
| `fireScheduledTask` guest | `deliverInbound` | delete for spine tenants |
| `fireScheduledTaskHarnessTurn` | already `startTurn` | call enqueue so it shares the room lease |
| `mailbox.send` / hop helpers | not wired to a second turn | enqueue `source=mailbox`, `thread_id` of target room |
| `thawMailboxRoom` / halt | `relayClient` | BFF thread-store freeze bit. No socket |
| Brain RPC `invokeBrainRpc` | Relay WSS | **Not** the chat spine. Vault UI stays `VAULT_PLANE=cp_s3`. Settings stay harness HTTP snapshot. Residual: leftover `brain.*` on guests |
| EC2 `runtime_kind=ec2` chat | Relay WSS to guest loop | Named residual (§3 D10) |

Channel adapters share one primary instance. No per-Slack sandbox.

Cron does not wake a channel (0016 IA). Job stream stays that agent's scheduled-task thread.

Human channel send: wake set is lead plus `@`s. Each persona is a work item on the **same** `thread_id`, so they serialize. They do not peer-stream.

---

## 6. What to delete (same wave as callers move)

Outcome-oriented: migrate callers, then delete the hop. Do not leave `ChatDelivery` as a forever flag on the spine — but do not delete the gate early and strand history.

**Gated migration (not early delete):** keep `resolveChatDelivery` / `requestChatDelivery` (`portal/packages/bff/src/app.ts` + `config.ts`) as the read path. Add a `spineEnabled(tenant)` gate (`tenants.chat_delivery=harness` + `HARNESS_URL` wired → spine; else legacy) that routes *spine tenants'* Send/SSE/cancel through `enqueueInbound`. `requestChatDelivery` branching is removed only after Phase 9 MockLab proof.

For spine tenants, stop calling:

- `deliverRelayChatTurns` / `interruptInbound` from Portal chat (route through enqueue instead)
- `deliverChannelAdapterInbound` → `deliverInbound` (enqueue)
- Guest scheduled-task `deliverInbound` (enqueue harness fire)
- Mention-hop / `onTurnComplete` hop chain
- Mailbox freeze RPCs on Relay once the bit lives on the thread store (`mailbox-halt.ts` → thread-store bit)

Keep in-tree until EC2 residual (`lp-k5c4.ec2-cutover`) is gone or explicitly wontfix:

- Relay ECS service
- Guest WSS, G6 owner map, JTI
- `CHAT_DELIVERY` / `chat_delivery` persist column for rollback during MockLab flip only — **column drop is the last leaf**, not phase 6

Honesty UI that explains "this tenant is on harness" can stay as a one-line fact. It should not teach dual-run as the design.

---

## 7. Mid-turn and idle

Spine toolbox events that wake a box **must** arm CP `mid_turn` (or equivalent) so the reaper cannot `idle_stop` during the turn. Do not depend on process env `SIGNAL_ACTIVITY_ENABLED` default off. That was the 2026-08-26 hole.

Locked: every `message` and `toolbox` work item **always** `POST signal-activity {mid_turn:true}` before `startTurn`, **ignoring `SIGNAL_ACTIVITY_ENABLED` for those sources** — same intent as unmerged `lp-v62i.8` / PR #670, without waiting on that PR. The 2026-08-26 hole was `flag_off` → no `mid_turn` → reaper `skipped_mid_turn=0` → idle stop on a live turn. Flag continues to gate only `tool_progress` refresh (debounced 30s) and `brain_rpc`. Clear `mid_turn` on `turn_complete` so the hot window can stop the box; 45m max hold is the safety expiry.

After the turn, clear mid_turn or let max hold (45m) expire. Prefer clear on turn complete so the hot window can stop the box.

Harness SSE stall watchdog (**120s silent stream → `error`**, do not hang forever) **must land on this spine** in `portal/packages/bff/src/chat-delivery-events.ts` (`proxyHarnessTurnsUntilAbort`). It is missing on current `main` — the MockLab `turn_37` hang shipped because of it.

---

## 8. Rust leaser (if reviewers keep D6)

Scope of the binary:

- `POST /enqueue` with service token from BFF
- Durable items + leases
- Heartbeat / expire
- `POST` leased `TurnRequest` to `HARNESS_URL`
- Metrics: queue depth per tenant, lease age, startTurn latency, wake path label

Out of scope:

- Cookie auth, Slack signing secret, MIME
- Daytona SDK
- SSE to the browser (BFF still proxies `openTurnEventStream`)
- ALB / TLS for `app.withlanyard.com`

Language is not a phase-0 requirement. **Phase 2 is TS** with the same contract tests. Rust is a swap of that process only after the contract is stable and proven on real harness/real harness.

This repo has no `Cargo.toml` today. If kept, crate lives under `portal/packages/inbound-leaser/` (preferred — colocated with BFF callers) or `portal/packages/control-plane/src/inbound-leaser/` if CP owns the lease table. Not a top-level experiment, not `deploy/` sibling.

---

## 9. Suggested phases (for a later beads graph, not the graph)

Do not create these beads until review. Order is the claim.

| Phase | Outcome | Proof |
| --- | --- | --- |
| 0 | This plan reviewed. D1–D10 locked (D6 later-swap, D10 EC2 residual `lp-k5c4.ec2-cutover`). §4.2 classifier, §4.4 stop owner, §6 gate locked. | Written review in this file. Human or lead agent sign-off. |
| 1 | `InboundWorkItem` parse/reject tests. Unknown `sandbox_need` rejects. No hop change. | Unit tests only (`turn.ts` wrap) |
| 2 | `enqueueInbound` + per-thread lease (**durable Postgres `SKIP LOCKED` row**). Portal harness send uses it behind `spineEnabled` gate. Still `POST HARNESS_URL /internal/turns`. No Relay on that tenant. | Offline: two threads parallel, one thread serial. Two events same thread serialize. Fake harness. |
| 3 | `sandbox_need=toolbox` kicks `ensure_online` **at enqueue** (singleflight). Bound id → `start_from_stopped` only. `none` does not wake. Stop+retain via **CP reaper** (`stop_after` hot window 45s), idempotent. | real harness path labels. Zero `cold_create` on bound Send. Reaper `skipped_mid_turn` when mid_turn active. |
| 4 | Channel adapter + cron fire + mailbox hop call enqueue with §4.2 classifier. Tests fail if `deliverInbound` is called for spine tenants. | Adapter/cron/mailbox unit tests. `sandbox_need` matrix covered. |
| 5a | **Durable `harness_turns` + live-events hub** so multi-replica BFF does not lose `turn_id`. `threadLiveEvents` backed by Postgres/Redis or sticky routing. | Kill one BFF replica mid-turn, SSE still streams. Registry survives restart. |
| 5b | **Mid_turn always armed on `message`/`toolbox` ignoring `SIGNAL_ACTIVITY_ENABLED`; 120s harness SSE stall watchdog** in `chat-delivery-events.ts`. | Regression for 2026-08-26 shape: reaper `skipped_mid_turn>0` during turn; idle `turn_37` watchdog fires `error`, not infinite hang. |
| 6 | **Warm pool on real harness** for unbound first toolbox bind (claim stopped pre-create, bind, start). Live MockLab pool still `OPERATOR HOLD` / cap 1–2; replenish off-stack. | Existing `lp-vqr0.10` tests plus spine claim on first-bind path. |
| 7 | **Gate flip MockLab Daytona tenants** to `spineEnabled` (persist `harness` + `HARNESS_URL` wired) for Send/SSE/cancel. `requestChatDelivery` branching removed *only for those tenants* behind gate. Not yet global. | `chat-relay-retire` style tests: `deliverInbound` call count 0 for spine tenants; legacy tenants still Relay. |
| 8 | **Optional Rust leaser swap** behind the same enqueue HTTP (`portal/packages/inbound-leaser/`). TS impl remains fallback. Contract tests against both. Not required for MockLab proof. | Contract tests green on both; perf/fairness delta documented. |
| 9 | **Live MockLab proof:** persist `harness`, cron evaluator `on` or ops fire, one Slack or mail fixture if available, `SIGNAL_ACTIVITY` always-arm verified, watchdog verified. Residual list explicit. | Evidence pack under `artifacts/`. |
| 10 | **Column drop last leaf:** `chat_delivery` persist column dropped from request path (or made always-spine) after EC2 residual resolved. | Migration + rollback note. |

OPERATOR HOLD still forbids restaging torn-down AWS unless a human lifts it. Offline real harness / real harness first, same as 0015/0017.

---

## 10. Non-goals

- Rewriting `@lanyard/web` chat UI
- Merging BFF and harness
- gRPC
- Per-chat Daytona boxes
- Per-channel sandbox identity
- Sleeping Fargate, BFF, CP, RDS, or ONLYOFFICE
- Agent↔agent token pipes / A2A as a live bus
- Reopening closed talk epics `lac-xsb`, `lac-bx3`, `lp-cxhb`
- Making Relay a better multi-task bus (G6) for this path
- Raising CloudFront origin timeout as the speed fix
- Enabling paid Daytona warm pool from CI

---

## 11. Files that will move or die

Read these before reviewing. Do not treat the list as an edit license.

| Path | Role now | Spine |
| --- | --- | --- |
| `portal/packages/bff/src/app.ts` | Send/SSE/cancel, dual hop, thaw | Enqueue + harness SSE |
| `portal/packages/bff/src/chat-delivery-send.ts` | `deliverHarnessPersonaTurns` / Relay turns | Persona fan-out becomes N work items on one thread |
| `portal/packages/bff/src/chat-delivery-events.ts` | Harness SSE drain, no stall timer | Watchdog |
| `portal/packages/bff/src/chat-instance-resolve.ts` | `HarnessSandboxNeed` | Keep. Classification feeds the work item |
| `portal/packages/bff/src/channel-adapter-deliver.ts` | Relay inbound | Enqueue |
| `portal/packages/bff/src/relay-client.ts` | WSS bus client | Unused on spine tenants |
| `portal/packages/bff/src/harness-client.ts` | `startTurn` | Keep |
| `portal/packages/shared/src/harness/turn.ts` | `TurnRequest` | Extend or wrap as work item |
| `portal/packages/bff/src/mailbox-hop.ts` | Authorize hop, not wired | Enqueue `to` |
| `portal/packages/control-plane/src/scheduled-task-harness-fire.ts` | Harness cron fire | Enqueue so it shares the lease |
| `portal/packages/control-plane/src/warm-pool.ts` | Pool | Claim on unbound toolbox |
| `portal/packages/control-plane/src/idle-reaper.ts` | 10m grace | Backstop. Spine stop is sooner |
| `portal/packages/bff/src/signal-activity.ts` | Flag-gated | Always arm on send/toolbox |

---

## 12. Questions for reviewing agents — **locked answers after review (2026-08-26)**

> Previous open questions are answered below. Quote this section if amending.

1. **D1.** **Locked: replace the hop, keep `TurnRequest`/harness/CP** (`portal/packages/shared/src/harness/turn.ts`, `harness-client.ts`, `instance-orchestrator.ts`, `retain-on-stop`). Greenfield Rust BFF/agent would rebuild the same `HTTP+SSE` contract from ADR 0012. Browser cookies + SSE stay BFF-owned.
2. **D6.** **Locked: later, not v1; allowed swap only after TS contract proves.** If kept, crate under `portal/packages/inbound-leaser/` (preferred) or `portal/packages/control-plane/src/inbound-leaser/` if CP owns the lease table. No top-level `Cargo.toml` in v1.
3. **D10.** **Locked: EC2 `runtime_kind=ec2` stays on deprecated Relay** (G6/WSS) as explicit residual `lp-k5c4.ec2-cutover`; does not block MockLab+Daytona spine flip. Global `CHAT_DELIVERY=harness` stays forbidden while EC2 loops live.
4. **`sandbox_need` classification.** **Locked: BFF decides at enqueue (static per source + prompt-intent sniff, §4.2).** Not a user setting, not model-bound per turn. Web `none` by default, toolbox only when file/vault intent detected; Slack/email/toolbox on attachment or vault keywords; cron from `sandbox_create_profile`; mailbox inherits. Fail to `toolbox` only when intent references `/mnt/vault`/file tools — do not default whole spine to `toolbox`.
5. **Hot window 30–60s vs 10m reaper.** **Locked: CP reaper is the sole Daytona stop owner.** Lease annotates `stop_after = last_turn_at + ~45s`; reaper honors it or `CP stop` idempotently no-ops if `mid_turn` active. Prevents double-stop / mid_turn fights.
6. **Always arm mid_turn** — **Locked: yes.** Every `message`/`toolbox` work item arms `mid_turn:true` ignoring `SIGNAL_ACTIVITY_ENABLED` for those sources (flag gates only `tool_progress` debounce + `brain_rpc`). Was the 2026-08-26 stall. Clear on `turn_complete`, 45m expiry is safety.
7. **Persona fan-out.** **Locked: N serial work items on same `thread_id` for lead+`@`** (same thread, serial via lease). Each carries `TurnRequestMetadata.persona`. Single mailbox wake alone would regress `lp-znef.1` channel UX.
8. **Brain RPC.** **Locked: `VAULT_PLANE=cp_s3` + harness `GET /settings/snapshot` is enough to delete Relay for MockLab.** Residual `brain.*` on guests is a tagged leftover, not a spine blocker.
9. **Durable store.** **Locked: durable Postgres row with `SKIP LOCKED` leases for phase 2.** SQS FIFO is deploy-time alternate only. In-process map alone loses leases on restart and duplicates work.
10. **Success metric — amended:** MockLab Taste send + one `toolbox` turn + one cron fire, **zero `deliverInbound` spies for spine tenants**, **`cold_create=0` when `sandbox_id` bound**, **no infinite SSE (120s watchdog fires `error`)**, **`mid_turn` armed even with `SIGNAL_ACTIVITY_ENABLED` unset (`skipped_mid_turn>0` during turn)**, **multi-replica safe (durable `harness_turns`)**.

---

## 13. Reviewer protocol

1. Read this file and [inbound-work-spine.md](../../architecture/inbound-work-spine.md).
2. Read ADR 0012/0013 and `portal-chat-delivery.md` if the hop is unfamiliar.
3. Do not implement. Do not `bd create` a full graph.
4. Return: accept / accept with amendments / reject, per decision D1–D10, plus answers to §12.
5. Amendments land in this file before beads.

A later implementation epic should be created only from the amended plan, with one leaf per phase row in §9 or a finer vertical slice. Vertical slices beat "write the Rust leaser" as a first bead.
