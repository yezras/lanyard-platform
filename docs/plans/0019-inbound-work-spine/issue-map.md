# 0019 issue map

Epic: **`lp-k5c4`** Replace chat delivery with inbound work spine.

Plan: [overview.md](./overview.md) (D1–D10 locked 2026-08-26). Short lock: [inbound-work-spine.md](../../architecture/inbound-work-spine.md).

| Bead | Plan phase | Title | Depends |
| --- | --- | --- | --- |
| `lp-k5c4.1` | 0 | Plan 0019 + inbound-work-spine.md on disk | — **closed** `aaf13f6d` |
| `lp-k5c4.11` | 0b | This issue-map | — |
| `lp-k5c4.2` | 1 | `InboundWorkItem` parse (`source` + `sandbox_need`, reject unknown) | — **ready** |
| `lp-k5c4.3` | 2 | `enqueueInbound` + Postgres `SKIP LOCKED`; Portal send behind `spineEnabled` | `.2` |
| `lp-k5c4.4` | 3 | Toolbox `ensure_online` at enqueue; start-from-stopped; reaper `stop_after` | `.2` `.3` |
| `lp-k5c4.6` | 4 | Adapters/cron/mailbox enqueue with §4.2 classifier | `.3` `.4` |
| `lp-k5c4.12` | 5a | Durable `harness_turns` + live-events hub (multi-replica BFF) | `.3` |
| `lp-k5c4.7` | 5b | Always arm `mid_turn`; 120s harness SSE stall watchdog | `.3` |
| `lp-k5c4.5` | 6 | Warm pool claim for unbound first toolbox bind | `.4` |
| `lp-k5c4.8` | 7 | `spineEnabled` gate flip MockLab Daytona Send/SSE/cancel | `.6` |
| `lp-k5c4.9` | 8 later | Rust leaser, same enqueue HTTP (`portal/packages/inbound-leaser/`) | `.3` |
| `lp-k5c4.10` | 9 | MockLab evidence pack; OPERATOR HOLD | `.5` `.6` `.7` `.8` `.12` |
| `lp-k5c4.14` | D10 | Cut over EC2 Company Brains to Fargate spine (not Relay) | — **closed** 2026-08-27: operator list empty; MockLab already daytona+harness |
| `lp-k5c4.13` | 10 last | Drop `chat_delivery` persist from request path — **closed** `lp-k5c4.13` Phase 10 (HARNESS_URL wired → spine, no persist read, column drop, EC2 residual `lp-k5c4.14` closed) | `.10` `.14` |
| `lp-k5c4.15` | A2A | **Bug:** `@NonLead` in a channel also wakes the lead (Alpha answers `@Drift`) | `.13` **closed** PR 718 |
| `lp-k5c4.16` | A2A | **Feature:** mailbox hop — Messaged `@X` notice, target 1:1 inbound, no human in the loop | `.13` (sibling `lp-v62i` / `lac-r9w`) **closed** PR 720 — origin chrome only until `.18` |
| `lp-k5c4.17` | QA | **Chore:** Muse Spark via LiteLLM provider contract; delete local `metaComplete()` wrapper | `.13` **closed** |
| `lp-k5c4.18` | A2A | **Bug:** mailbox icon without target inbound (tools runner + prove Drift 1:1) | discovered-from `.16` |
| `lp-k5c4.19` | A2A | **Feature:** sticky addressee — after `@Drift`, un-@ follow-ups still wake Drift | discovered-from `.15` |
| `lp-k5c4.20` | A2A | **Feature:** `channel.add_member` tool so non-members can be invited then `@`'d | discovered-from `.16` |
| `lp-k5c4.21` | A2A | **Feature:** host playbook + tools (mailbox, invite, cron, workflow) — not a raw `/api` dump | `.18` `.20` |

`lp-k5c4.15` supersedes the locked lp-v62i.3.5 rule “human inbound = lead PLUS @s” for spine/harness. Update that doctrine in the same change. `.19` then keeps the last `@` as addressee for the next un-@ human turns in that channel.

`lp-k5c4.16` is not a prompt tweak. Local LA is no-tools; BFF hop chrome can paint Messaged `@X` while the target 1:1 stays empty. D8 still holds: A2A = `mailbox.send` + enqueue `source=mailbox` on the **target** thread. `.18` is the remaining prove-it bead (tools-capable runner + both rooms).

`lp-k5c4.17` is localhost QA only (`/tmp/lp-k5c4.13-serve-la.mjs`). Not a Portal gateway.

Do **not** inject Portal HTTP routes for the model to fetch. Tools are the contract; the host enqueues. No writable “all communications” stream (Jack SSE is a view). Recursion stays fused: hop cap, 40/hour, ≤8 consecutive a2a.

First implementation bead: `lp-k5c4.2`. Do not start at `.9`.

Parallel drain and file groups: [parallel-waves.md](./parallel-waves.md). Workflow: `.grok/workflows/inbound-spine-ship.rhai`.
