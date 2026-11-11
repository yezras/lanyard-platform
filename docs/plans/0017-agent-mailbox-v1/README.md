# 0017 — Agent mailbox v1 (inspect-only doctrine)

**Plan id:** `docs/plans/0017-agent-mailbox-v1/`  
**Beads:** platform epic `lp-v62i`; inspect-only pointer `lp-v62i.1.2`; live MockLab gate `lp-v62i.4.1`; agent sibling `lac-r9w` (`docs/plans/10-agent-mailbox-v1/` in lanyard-agent)  
**Status:** docs-only. Doctrine pointer + operator runbook. No runtime from this directory. No second map.  
**Date:** 2026-08-25 (gate runbook 2026-08-26)

The lock lives outside this repo. Workers: read the wayfinder file, then execute only the claimed leaf.

This directory is **docs only**. Do not touch `portal/packages`, `apps/web`, BFF, or contracts from this leaf. Neighbor `docs/plans/0017-sandbox-first-chat-speed/` is a different plan (`lp-vqr0`).

## Source of truth

- Destination map (keep / throw-out, nine checks, domain model): `/home/operator/Lanyard-Dev/wayfinder/agent-mailbox-v1.md`
- Beads graph (waves, file ownership, closed-epic policy): `/home/operator/Lanyard-Dev/wayfinder/reviews/beads-graph.md`
- Live MockLab nine-check operator runbook (this leaf `lp-v62i.4.1`): [mocklab-nine-checks-runbook.md](./mocklab-nine-checks-runbook.md)

Do not copy the map here. If this README and the map disagree, the map wins.

## Product locks (wave 0)

- Mailbox is transport, not a screen. No mailbox UI or inbox.
- No file `@`. Plus stays attach or vault.
- Halt chrome is not wired this wave.
- Composer `@` picker is UI only this wave.
- No Hermes as product runtime.
- `lp-v62i.1.2` is inspect-only. If you start implementing send, you are in the wrong leaf.

## Closed epics — do not reopen

| Id | Stance |
| --- | --- |
| `lac-xsb` | Closed. Failed “hope `@` in the user stream is enough.” |
| `lac-bx3` | Closed. Same failed talk path. Live MockLab never talked. |
| `lac-37a` | Closed. Do not reopen as parent. |
| `lp-cxhb` | Closed. Do not reopen as parent. |
| `lp-8sh4` | Stays as-is. Open sibling, **not** a parent of `lp-v62i`. |
| `lp-8sh4.6` | Closed composer-503 bug. **Not talk.** Do not patch it and call it talk. |
| `lp-jnrj` | **Closed.** PR https://github.com/LanyardBrain/lanyard-platform/pull/661 merged as `53cd6c2f`. Relay Dockerfile copies `packages/connectors`. Image **publish** + MockLab pin/redeploy remain operator work on `lp-v62i.4.1` — [mocklab-nine-checks-runbook.md](./mocklab-nine-checks-runbook.md). Protocol was never blocked on this bug. |

New work after the map is `lp-v62i` / `lac-r9w`, not children of those closed ids.

## Keep vs throw-out

Quoted from the wayfinder map. Full tables stay there.

**Keep**

- Portal channel + 1:1 chrome (`lp-8sh4` UI children)
- `RelayChatEvent` / BFF SSE / Astryx bubbles
- Unmentioned human channel inbound wakes lead; `@Name` wakes only the named personas (`lp-k5c4.15` supersedes `lp-v62i.3.5` lead-plus-`@`s)
- One gateway, personas, display names
- `ThreadTurnQueue` serial-per-room
- Schedule / workflow list/detail, edit/pause/delete
- Composer plus for attach + vault
- Existing agent tools that create schedules and workflows

**Throw out**

- Inferring talk only from `@` in a user stream with no send primitive
- The live mention-hop path, in the same change as `mailbox.send`
- Today’s “previous speaker reply is the whole prompt” wake wire
- Vault JSON handoffs as the agent bus
- Mailbox inbox UI, tappable pointer cards, tool dump in channels
- Create chrome for schedules and workflows (chat plus, wizard, top-left plus)
- File `@` in 1:1 and channels
- Durable mailbox outbox in v1
- Reopening `lac-xsb` / `lac-bx3` / `lp-cxhb`

## Nine destination checks

Proof is live MockLab (`app.withlanyard.com/mocklab`), not a fake local gateway. Checklist is the map’s destination list; details stay in `/home/operator/Lanyard-Dev/wayfinder/agent-mailbox-v1.md`.

- [ ] Speak in a channel; lead replies.
- [ ] Lead (or Jack) `@` another agent; that agent replies in the chosen room.
- [ ] From a 1:1, bare `@Fizz` continues in Fizz’s 1:1 with Jack. Fizz’s 1:1 shows only her reply. Bill’s 1:1 gets a text-only “A message has been sent to Fizz.”
- [ ] From a 1:1, `@Fizz` plus a room continues in that channel. Bill’s 1:1 gets nothing. The channel shows Bill’s bubble.
- [ ] Walk away; they continue in that room until halt or the hidden fuse.
- [ ] An agent can message another with no user message that day, if they share a channel.
- [ ] A scheduled job can write Jack’s 1:1 with that sender.
- [ ] An agent in a 1:1 or channel can create a schedule or workflow (no create chrome). Jack can still open, edit, pause, delete it.
- [ ] `@` in composer offers agents, then provisioned connectors. File `@` is gone. Plus attaches a file or vault item.

Gate bead: `lp-v62i.4.1`. Protocol/UI leaves and `lp-jnrj` are closed. Remaining: image pin, entitle, real gateway snapshot, Jack’s nine checks. Runbook: [mocklab-nine-checks-runbook.md](./mocklab-nine-checks-runbook.md).
