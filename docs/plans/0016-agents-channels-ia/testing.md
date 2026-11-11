# Testing — Portal Agents / Channels IA

**Back-link:** [overview.md](overview.md)

Vertical TDD per bead. Playwright on `http://demo.localhost:3010` for UI beads. A screenshot is not proof.

| ID | Behavior | Phase |
| --- | --- | --- |
| I1 | Agents sidenav lists durable agents, one row per agent, not project folders | 2 |
| I2 | Sections are Channels, Agents, Scheduled Tasks. No Projects. Tab label Agents | 2 |
| I3 | New agent creates catalog row + one 1:1; second New agent is a different person | 3 |
| I4 | New channel without two members cannot submit | 4 |
| I5 | New channel with two created/picked agents + required name creates a channel | 4 |
| I6 | Empty catalog: channel popup Create agent twice, then submit | 4 |
| I7 | Add/remove members after create; cannot go below two | 5 |
| I8 | Delete channel; both agents still in Agents with 1:1 history | 5 |
| I9 | Un-mentioned channel message stamps lead only | 6 |
| I10 | `@Legal` in a channel stamps Legal | 7 |
| I11 | `@Legal` in a 1:1 does not start a Legal turn | 7 |
| I12 | Remove lead: LLM pick or tenure fallback; system notice in channel | 8 |
| I13 | Delete agent from Agents: gone from channels and job bind; confirm required | 9 |
| I14 | New scheduled task on + binds one agent; stream under Scheduled Tasks | 10 |
| I15 | Legacy interactive chats migrate 1:1 → one agent each; no auto-channels | 11 |
| I16 | Duplicate legacy titles get a suffix; avatars preserved | 11 |

**Prove (UI):** pytest under `portal/packages/web/ui-testing` with artifacts `artifacts/ui/agents-channels-ia/`.  
**Prove (BFF):** `pnpm -C portal/packages/bff test` for store/wake/migration units.
