# Short-stack tool placement

How a Lanyard Agent tool runs after the MockLab cutover: Browser → BFF → Harness (Fargate) → Daytona toolbox.

This is the rule for every new tool. If a PR cannot name a placement from this doc, it is not ready.

Related: [ADR short-stack harness](../adr/0012-short-stack-harness.md); plan [0015](../plans/0015-short-stack/overview.md); chat hop and SSE: [portal-chat-delivery.md](portal-chat-delivery.md); agent allowlist in `lanyard-agent` `packages/agent-core/src/tools/allowlist.ts`.

## The rule

The model always talks to LiteLLM from the harness. Daytona is a computer, not a second agent.

There is no per-tool "AI API" from Fargate to the sandbox. File and CLI tools share one client:

```text
ToolboxClient.execute({ sandbox_id, argv, cwd, timeout_ms })
  → POST {daytona}/toolbox/{sandbox_id}/process/execute
  → { stdout, stderr, exit_code }
```

Pick one placement. Do not invent a third hop.

| Placement | Runs where | Use when |
|---|---|---|
| **Harness in-process** | Fargate Node process | HTTP APIs, in-process libraries, nested model loops, schedule create |
| **Toolbox (one-shot CLI)** | Daytona `process/execute` | Tenant disk, snapshot binaries, untrusted argv |
| **Platform then harness** | CP evaluator → harness HTTP turn | Time-based fire (scheduled tasks) |
| **Not a chat tool** | BFF / CP / Portal | Vault UI, OnlyOffice, auth, skills markdown |

Guest create-env stays `tool_only`: no `GATEWAY_RELAY_SECRET`, no provider keys, no `TAVILY`/`BRAVE`/`FIRECRAWL`/`XAI` search keys. Those stay on the harness task.

## Ask this, in order

1. Does it need `/mnt/vault` or a binary baked into the tool-only snapshot? → toolbox.
2. Is it `fetch` to a vendor API, or a library already in the harness image? → harness in-process.
3. Is it another model loop (subagent, workflow stage)? → harness agent-core. Child file tools still use the same toolbox client.
4. Is it "run this prompt later"? → durable job store + CP evaluator + harness turn. Not a guest ticker.
5. Is it MCP?
   - HTTP / SSE MCP → harness.
   - stdio MCP that does not need the vault → harness child process (same as today's `McpStdioClient`).
   - stdio MCP that must see the vault → **not** one-shot toolbox. That needs a long-lived Daytona process session. Do not ship that as `process/execute`. Track it as a later MCP session bind.
6. Is it inbound Slack / email / WhatsApp? → harness channel adapter. Not a chat tool and not Daytona.
7. Is it `edit` / `write` / `browser` / `screenshot` / `computer`? → **denied** on the v1 allowlist (`CODING_PRODUCT_TOOL_NAMES`). File mutation, if needed, is `bash` on toolbox. Browser/computer, if we ever want it, is a Daytona computer API, not Chrome on Fargate.

If none of those fit, stop and extend this doc in the same PR as the tool.

## Inventory (v1 allowlist)

Canonical names: `lanyard-agent` `V1_TOOL_NAMES`. Harness runner binds file/bash plus `memory_read` by default (lp-oop.38.13). Fargate has no guest `config.yaml`; absent `mempalace.enabled` is not off.

| Tool | Placement | How it executes | MockLab now |
|---|---|---|---|
| `bash`, `read`, `grep`, `find`, `ls` | Toolbox | argv on the bound sandbox, cwd `/mnt/vault` | Live-proved (`lp-oop.38.3`). Cwd fix `#250` may still need image roll. |
| `web_search` | Harness HTTP | Tavily / Brave / Firecrawl / DuckDuckGo from Fargate. Keys on the harness task. | Bound on `createEnvToolsTurnRunner` (`lp-oop.38.12`). Structured `tool_progress` hits; DDG when paid keys are absent. Live Fargate roll still needs the LA pin. |
| `x_search` | Harness HTTP | xAI / X API from Fargate. Register only when `XAI_API_KEY` is a live non-placeholder value. | Bound only with credentials (`lp-oop.38.12`). |
| `parse_document`, `extract_document_text` | Harness library | Toolbox `base64` read of the vault path, then AnyDoc on Fargate. Paid Firecrawl parse stays cost-gated on harness env. | Bound (`lp-oop.38.12`). Fail closed without `sandbox_id`. |
| `memory_read`, `memory_write` | Toolbox CLI | `MemoryClient` with spawn = toolbox. Binary `/usr/local/bin/mempalace` on the tool-only snapshot. Palace dir `/mnt/vault/mempalace`. Argv `[/usr/local/bin/mempalace, --palace, /mnt/vault/mempalace, search, query, …]`, cwd `/mnt/vault`. Missing `sandbox_id` fail-closes (not Fargate PATH, not `BINARY_MISSING`). | Live `:11` / `la-c41aca0` (`lp-oop.38.13`). Turn `turn_3` called `memory_read`; result `No memory hits.` (unmined palace), not `BINARY_MISSING`, not `TOOL_NOT_AVAILABLE`. Bound in `createEnvToolsTurnRunner` by default (kitchen-sink search-only). Fargate has no guest `$BACKEND_HOME/config.yaml`; absent `mempalace.enabled` is not off. Explicit `enabled: false` / `HARNESS_MEMPALACE_ENABLED=0` omit `memory_read`. `write_policy` disabled omits `memory_write`. Companion LA `c41aca0` stacked on live spawn `2477b22`. Bake keeps `HARNESS_REQUIRE_SPAWN`. `HARNESS_REQUIRE_MEMORY=1` fails boot when `memory_read` is missing. |
| `spawn_subagent`, `get_subagent_output`, `kill_subagent` | Harness in-process | Nested agent-core session in the same Node process. Child file tools reuse toolbox. Isolation `none` for MockLab v1. | Live `:10` / `la-2477b22` (`lp-oop.38.14`). Unknown spawn names fail closed when off. |
| `workflow` | Harness engine | `runWorkflow` on Fargate. `spawn_agent` stages are the same subagent runtime. Definitions from builtins + `BACKEND_HOME/workflows`. Run state is mirrored to guest `/mnt/vault/workflows/runs/{run_id}/state.json` via toolbox. Portal citations and vault GET are vault-root-relative (`/workflows/runs/{run_id}/state.json`). Citation SoT is CP S3: BFF create-if-absent PUT on `workflow_progress`, citation paths, and GET of a missing run `state.json` (so the pane does not 404 into SPA HTML). Persist failure logs `workflow_run_vault_persist_failed`. | Bound when `workflow.enabled` (`lp-oop.38.15`). Citation read + S3 persist (`lp-oop.38.22`). Builtin `research-lite`. Guest stays tool-only. |
| `scheduled_task` | Harness tool + platform fire | See [Scheduled tasks](#scheduled-tasks) below. | Create/fire functions exist (`lp-oop.38.8`). Chat tool not on the runner. Live CP ticker not enabled. |
| `search_tool`, `use_tool` | Harness catalog | Meta-tools. Hidden MCP rows stay off LiteLLM `tools[]`. | Partial: vault MCP names only. `use_tool` / stdio execute fail closed. |
| `mcp__{server}__{tool}` | Harness stdio *or* HTTP | Hidden catalog. Invoke via `use_tool`. See [MCP](#mcp). | Catalog-only. Live seed is `lp-jzfc`. |

### Not tools (do not add LiteLLM schemas)

| Surface | Where it lives |
|---|---|
| Skills | Markdown loaded into context from vault. `/name` in the user message. Not a function call. |
| Charts | Prompt fence. Harness already asks for ` ```chart ` in the system prompt. |
| Vault tree / Office | BFF → CP → S3. Opening Directory must not wake a sandbox. |
| Slack, email, WhatsApp | Channel adapters on the harness process if we want them later. |
| Portal Settings toggles | Harness `GET/PATCH /internal/settings/*` over vault `config.yaml`. |

### Explicitly never on Company Brain sessions

`edit`, `write`, `browser`, `screenshot`, `computer`. Pi coding-agent chrome. Do not register them on the harness runner to "get feature parity with Cursor."

## Scheduled tasks

Three different jobs. People keep collapsing them into "cron on the sandbox."

```text
Create (chat `scheduled_task` or Settings)
  → durable job row (vault `cron/jobs.json` via CP S3 on short stack)
  → no guest `$BACKEND_HOME`, no fat gateway

Tick (always-on)
  → Control Plane `evaluateDueScheduledJobs`
  → env `SCHEDULE_EVALUATOR_ENABLED` (not rolled live as of lp-oop.38.8)
  → does not require the sandbox to be online

Fire (when due, or ops)
  → `fireScheduledTaskHarnessTurn`
       1. ensure_online(..., sandbox_create_profile=tool_only)
       2. POST harness /internal/turns  { tenant_id, user_id, instance_id, message: job prompt }
       3. harness runs a normal tools turn
       4. file/bash during that turn still go through toolbox
```

The sandbox is not the scheduler. Fargate is not the scheduler either. CP is. The harness is only the worker that runs the prompt when CP says it is due.

`lp-jzl.10.1` wanted a CP-native registry so fire does not depend on Mountpoint. Short stack stores the same document in vault because CP already reads S3 without the guest. Do not put the ticker back on Daytona.

A job that only needs `web_search` still wakes tool-only today (ensure_online is in the fire helper). That wake is for jobs that then touch the vault. It is acceptable for v1. Do not special-case "no sandbox" until someone measures it.

## MCP

MCP tools are hidden catalog entries, not builtins.

| Transport | Placement | Notes |
|---|---|---|
| HTTP / SSE | Harness `fetch` | Same as `web_search`. |
| stdio, no vault | Harness `McpStdioClient` child process | Lab echo, network-only servers. Keys on the harness. |
| stdio, needs `/mnt/vault` | **Not toolbox execute** | JSON-RPC session, not one argv. Needs a Daytona process session or an HTTP MCP in front of the vault. Out of v1 unless a bead names the session API. |

Do not dump every MCP schema into LiteLLM `tools[]`. `search_tool` finds them, `use_tool` calls them (`tools.catalog_search.enabled`).

## CLI commands and other HTTP APIs

Same two buckets as builtins.

**One-shot CLI on the snapshot** (`mempalace`, `jq`, tenant scripts under `/mnt/vault`): wrap argv through `ToolboxClient`. Inject that spawn into the existing client (see `MemPalaceCliBackendOptions.spawn`). Do not copy the palace onto Fargate.

**HTTP API** (Tavily, xAI, Firecrawl scrape, Stripe, whatever): harness `fetch`. Search/provider keys stay on the harness task env. **Registry Class C** (tenant-principal Stripe/Linear/…) is CP KMS keyed `(tenant, connector, surface)` and attached as `Authorization` on that fetch at request time (`lp-hdzm.24`). Never `buildProviderWakeEnv`. Never Daytona create-env. Never a token file on the guest (`mcp-auth.json` included).

**Long-running daemon** (MCP stdio, local browser, language server): not `process/execute`. Either harness child, or a Daytona session API we do not have yet. Write that down before coding.

## Adding a new tool

Do this in the same change as the implementation.

1. Name the canonical tool id (allowlist in `lanyard-agent`, not a Portal-only label).
2. State placement: `harness` | `toolbox` | `platform-then-harness` | `not-a-tool`.
3. If toolbox: show argv, cwd, which snapshot binary, fail-closed when `sandbox_id` is missing.
4. If harness HTTP: name the env key, confirm it is **not** on guest create-env.
5. If nested loop: reuse `SubagentRuntime`; do not spawn a second Fargate service.
6. Emit existing Relay `tool_progress` shapes. Do not add a Prisma event bus.
7. Add a row to the inventory table in this file.
8. Prove one live MockLab turn that actually calls it (or an honest N/A if config-gated).

Platform bead under `lp-oop.38` (or the owning epic). Lanyard Agent PR plus platform pin/roll. Do not bake a fat `lanyard-agent/` snapshot to "make the tool easier."

## Forbidden

- Per-tool HTTP API from harness to Daytona besides toolbox execute / a future documented session API.
- Provider keys, `GATEWAY_RELAY_SECRET`, or `TAVILY`/`BRAVE`/`FIRECRAWL`/`XAI` search keys on the guest.
- Provider keys or `GATEWAY_RELAY_SECRET` on the guest.
- Running `mempalace` (or any vault CLI) on Fargate against a missing palace.
- Putting the agent loop back on the sandbox.
- New AWS products for search or memory.
- Registering denied coding-product tools to skip this doc.
