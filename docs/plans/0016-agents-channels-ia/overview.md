# 0016 — Portal Agents / Channels IA

**Plan id:** `docs/plans/0016-agents-channels-ia/`  
**Beads epic:** `lp-cxhb`  
**Integration branch:** `integrate/lac-bx3` (same train as agent harness; merge here, not `main`, until QA is green)  
**Sibling:** lanyard-agent `lac-bx3` (`docs/plans/09-group-agent-rooms/`)  
**Status:** locked IA; plan docs first; no product code in this commit except docs + beads  
**Date:** 2026-08-22

Normative lock file (copy also in agent repo): [decision-locked-ia.md](decision-locked-ia.md).

## Context

lp-fn5 made the directory look like “Agents” but each row is still a 1:1 **thread**, grouped by **project** (vault cwd). Users want durable agents, 1:1s that *are* those agents, and **channels** as multi-agent rooms. Projects as a sidebar noun go away. Vault stays global for that user/tenant; channels are rosters, not ACLs.

Harness work stays in `lac-bx3`. This epic owns Portal: catalog, sidenav, pickers, migration, BFF lead/membership, Playwright.

## Who this is for

| Audience | What changes |
|----------|----------------|
| Tenant user (v1: one human) | + New agent / New channel / New scheduled task; Channels, Agents, Scheduled Tasks |
| Implementers | BFF types + web sidenav; do not implement LiteLLM session keys here |
| Maintainers | Agent row = catalog. Channel points at agent ids |

## Scope

### In

1. Durable agent catalog: Agents row **is** the agent; one persistent 1:1.
2. Channels: named, ≥2 members, editable, floor two, lead, `@` wake only here.
3. Kill Projects from UI (+ menu, sidenav folders, “scoped to”).
4. + New scheduled task binds one existing or new agent; stream stays under Scheduled Tasks.
5. Migration: each old interactive chat → one agent + history. No auto-channels.
6. Delete agent confirm (channels + jobs). Delete channel keeps agents.
7. Lead succession: LLM pick + tenure fallback + notice.
8. Wire stamps `target_persona_ids` / lead so `lac-bx3` can honor them.

### Out

- Multi-human rooms
- Extra 1:1 threads per agent
- Per-agent vault ACL
- Host `projects.db` deletion (shim OK)
- Agent LiteLLM loop / session key formula (agent repo)
- Keyword triggers, Slack multi-identity, Buzz relay

## Alternatives

| Approach | Verdict |
|----------|---------|
| 1:1 is a one-member channel | Rejected. Separate object. |
| New Skip per chat | Rejected. One durable agent. |
| Channel = project folder | Rejected. Channel is a roster. Vault is global. |
| One epic for UI + harness | Rejected. Split. |

## Phases

See [testing.md](testing.md). Beads from [create-beads.sh](create-beads.sh).

## Beads

Epic: `lp-cxhb`

| Id | Title |
| --- | --- |
| `lp-cxhb.1` | P0 plan docs |
| `lp-cxhb.2` | P1 durable agent catalog |
| `lp-cxhb.3` | P2 sidenav; kill Projects |
| `lp-cxhb.4` | P3 New agent |
| `lp-cxhb.5` | P4 New channel ≥2 |
| `lp-cxhb.6` | P5 membership floor two |
| `lp-cxhb.7` | P6 lead + wake stamp |
| `lp-cxhb.8` | P7 `@` only in channels |
| `lp-cxhb.9` | P8 lead succession |
| `lp-cxhb.10` | P9 delete agent cascade |
| `lp-cxhb.11` | P10 New scheduled task |
| `lp-cxhb.12` | P11 migrate legacy chats |
| `lp-cxhb.13` | P12 Playwright I1–I16 |

Ready after P0: P1 and P2.

## Integration

Worktrees branch from `integrate/lac-bx3` in this repo and merge back there. Do not PR to `main` until this epic’s Playwright catalog and `lac-bx3` E1–E5 are both green (or we explicitly cut a smaller slice).
