# 0020 issue map

Epic: **`lp-bhcg`** — Revamp Lanyard onto Cloudflare, starting from localhost.

Plan: [overview.md](./overview.md).

`bd ready` at filing shows `lp-bhcg.1`, `lp-bhcg.4`, and `lp-bhcg.18`. Everything else waits on those.

| Order | Bead | Title | Depends |
| --- | --- | --- | --- |
| 1 | `lp-bhcg.1` | Boot the current portal on localhost and record the agent loop | — **ready** |
| 2 | `lp-bhcg.2` | Connect an agent backend with a base URL and an API key | `.1` |
| 3 | `lp-bhcg.3` | Run two personas on localhost with separate keys, crons, and memory | `.2` |
| 4 | `lp-bhcg.4` | Accept the Cloudflare service map before any Workers code | — **ready** (decision) |
| 5 | `lp-bhcg.5` | Move control-plane and product tables onto local D1 | `.4` `.1` |
| 6 | `lp-bhcg.6` | Store the agent filesystem on R2 | `.4` `.1` |
| 7 | `lp-bhcg.7` | Replace Valkey sessions, leases, and cron alarms with Durable Objects | `.4` |
| 8 | `lp-bhcg.8` | Add a Cloudflare API token for Workers, D1, R2, and Durable Objects | `.4` **human** |
| 9 | `lp-bhcg.9` | Serve BFF, control plane, and the portal from Workers | `.2` `.5` `.6` `.7` `.8` `.20`–`.28` |
| 10 | `lp-bhcg.10` | Wake a Daytona sandbox from Workers and attach the R2 filesystem | `.9` |
| 11 | `lp-bhcg.11` | Show each agent's cron jobs and wake the sandbox when one is due | `.10` |
| 12 | `lp-bhcg.12` | Keep persistent memory and recent working memory across sandbox idle | `.6` `.10` |
| 13 | `lp-bhcg.13` | Spike `agent-browser` on the local machine | `.1` |
| 14 | `lp-bhcg.14` | Run `agent-browser` inside the Daytona sandbox and show the session | `.13` `.10` |
| 15 | `lp-bhcg.15` | Let an agent install programs onto its persistent disk | `.10` |
| 16 | `lp-bhcg.16` | Open a vault document in local ONLYOFFICE | `.1` |
| 17 | `lp-bhcg.17` | Accept a signed webhook as a trigger that wakes the agent | `.10` |
| 18 | `lp-bhcg.18` | Keep AWS staging parked while this revamp is the active path | — **ready** |

First implementation bead: `lp-bhcg.1`. Accept or amend `lp-bhcg.4` before `lp-bhcg.5`, `.6`, or `.7`. The API token (`lp-bhcg.8`) is only required before the Workers deploy (`lp-bhcg.9`).

After `.1`, these can proceed in parallel: `.2` (then `.3`), `.13`, `.16`, and — once `.4` is accepted — `.5`, `.6`, `.7`, `.8`.

## Portal experience, before a live deploy

Filed before any Workers deploy. Each of these blocks `lp-bhcg.9`. They can run beside the service-map decision. They do not start Cloudflare.

| Bead | Title | Depends |
| --- | --- | --- |
| `lp-bhcg.20` | Remove the model selector from chat | blocks `.9` |
| `lp-bhcg.21` | Let an admin set the model catalog and route with LiteLLM | `.20`, blocks `.9` |
| `lp-bhcg.22` | Make agent chat a continuous bubble thread | blocks `.9` |
| `lp-bhcg.23` | Remove Halt from the agent chat header | blocks `.9` |
| `lp-bhcg.24` | Drop the memory section from the agent side nav | blocks `.9` |
| `lp-bhcg.25` | Remove Brain wording from the portal | blocks `.9` |
| `lp-bhcg.26` | Group connectors into Apps and Skills | blocks `.9` |
| `lp-bhcg.27` | Move Settings under the account menu | blocks `.9` |
| `lp-bhcg.28` | Show the vault as the agent computer's files | `.25`, blocks `.9` |

`lp-bhcg.20`–`.28` are done on localhost and still gate `lp-bhcg.9`. Chat asks LiteLLM for `lanyard-auto` (`auto_router/complexity_router` in `deploy/litellm/config.yaml`). The portal does not classify the message. The catalog only decides whether a model is available. `lp-bhcg.24` removes the side-nav memory list added in `lp-bhcg.3`. Memory files can stay on disk. `lp-bhcg.28` does not add a live Daytona desktop. A one-line request ("I want to revamp") was not filed.
