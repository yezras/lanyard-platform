# Locked IA — Agents, Channels, Scheduled Tasks

**Date:** 2026-08-22  
**Source:** grill-me session after Buzz extract / `lac-bx3`  
**Split:** Portal IA = new platform epic. Harness = `lac-bx3` (this repo).

v1 is **one human, many durable agents**. Multi-human rooms are a later epic.

## Objects

| Noun | Rule |
| --- | --- |
| **Agent** | Durable identity. The **Agents** sidenav row **is** the agent. Exactly **one** persistent 1:1 log with the user. No extra 1:1 “threads.” |
| **Channel** | Named multi-agent room. Required name at create. **≥2** agents. Same agents as the catalog; membership is a pointer, not a copy. Separate log from every 1:1. |
| **Lead** | Channel field. First agent added at create; user can change it. Un-mentioned messages wake **only the lead**. |
| **Scheduled task** | Binds to **one** durable agent. Fires append to that job’s stream under **Scheduled Tasks**. Cron does not wake a channel. |

Same agent may sit in that one 1:1 **and** many channels at once. Session key stays per `(agent, thread)`.

## UI

- Top tab stays **Agents**.
- Sidenav: **Channels / Agents / Scheduled Tasks**.
- **Projects** gone from the UI (host `projects.*` may linger as a shim).
- **+**: **New agent**, **New channel**, **New scheduled task**.
- **New agent**: write catalog + open the one 1:1.
- **New channel**: popup, required name, pick existing and/or **Create a new agent**, cannot finish until **two** members.
- Membership after create: add/remove, **floor of two**. Last pair only leave by deleting the **channel**. Delete channel does **not** delete agents or 1:1s.
- Delete the Agents row = delete the person (confirm). Leaves every channel; jobs bound to them need the same confirm. No channel-only ghosts. If removing them would drop a channel below two members, **delete that channel** (the remaining agent and their 1:1 stay).
- `@` **wakes only in channels**. In a 1:1, `@Legal` does not run Legal.

## Lead succession

When the lead is removed or the agent is deleted and the channel still has ≥2 members: **LLM** picks the new lead from **channel** log slice + remaining agents’ objectives (not 1:1s). On fail/timeout: **longest-tenure** (join time; same-picker order as tie-break) + system notice “Lead is now X.” User can change lead afterward.

## Vault

All agents for that user/tenant see **global vault files**. No per-agent vault ACL. A channel is not a file jail. (Personal vs shared vault for a second human is out of v1.)

## Context

Channel turn: **channel log + roster + vault**. Do not stitch the 1:1 into the channel prompt. 1:1 turn: that 1:1 log only.

## Migration

Each existing **interactive** chat → one durable agent + that history (keep title, avatar). Duplicate names get a suffix. Project folders disappear; rows land in **Agents**. Scheduled-task streams stay in Scheduled Tasks (bind an agent from the stream title if needed). **No auto-channels.**

## Split

| Epic | Repo | Owns |
| --- | --- | --- |
| Platform IA (new `lp-*`) | lanyard-platform | Catalog=row, sidenav, pickers, migration, delete cascade, lead field in BFF, `@` routing in Portal |
| `lac-bx3` | lanyard-agent | Persona session keys, refuse unstamped group inbound, prompt layers, hop cap, impersonation, queue, doctrine |

`group-rooms-v1` is the contract both consume.

## Explicitly out of v1

- Multi-human / session-share rooms
- Extra 1:1 threads per agent
- Per-agent file permissions
- Project folders as product
- Auto-creating channels from old projects
- `@` wake in 1:1s
- Keyword triggers on
- Scheduling a whole channel
- Slack/Teams multi-identity
- Buzz relay / Nostr
