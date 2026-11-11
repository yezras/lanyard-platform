# MockLab MCP product surface path (lp-zuh.10.6 ↔ lp-vw3)

**Beads:** `lp-zuh.10.6` (platform path / residual) · **`lp-zuh.11.5`** (zero-waiver MCP branch) · **`lp-zuh.14.3` / `lp-vw3`** (LA product surface + live UI) · **`lp-oop.38.17`** (harness invoke)  
**External LA issue:** [LanyardBrain/lanyard-agent#239](https://github.com/LanyardBrain/lanyard-agent/issues/239)  
**Parent epic:** `lp-zuh.14` Phase 10 residual closeout · zero-waiver parent `lp-zuh.11`  
**Date:** 2026-08-14 (updated 2026-08-20)  
**Status:** Platform path shipped (`lp-zuh.10.6`). **LA MCP product surface implemented** under `lp-zuh.14.3` / [lanyard-agent#245](https://github.com/LanyardBrain/lanyard-agent/pull/245). After **tool-only** live pin (`lp-oop.37.5`), guest `LANYARD_ENTRY_SEED_MCP` and BFF `SETTINGS_SEED_LAB_MCP` do **not** populate `source=harness` Tools snapshots. **Invoke** is harness `search_tool` / `use_tool` (`lp-oop.38.17`): stdio without vault and HTTP/SSE run on Fargate; vault-required stdio is fail-closed (not toolbox execute). **Live catalog seed** is harness `BACKEND_HOME/config.yaml` (start wrapper fill-missing-merges `lab_echo` when `/opt/lanyard/lab-mcp/lab_echo_server.py` is on the image). Decision: [`artifacts/mocklab/live-qa/residuals/mcp/DECISION-tool-only-activation.md`](../../../artifacts/mocklab/live-qa/residuals/mcp/DECISION-tool-only-activation.md).  
**No secrets** in this file.

Related:

- Zero-waiver live package: [`artifacts/mocklab/live-qa/zero-waiver-go/mcp/`](../../../artifacts/mocklab/live-qa/zero-waiver-go/mcp/) (`lp-zuh.11.5` RESULT + PRODUCT-NA-SIGNOFF)
- Live QA gap: [`artifacts/ui/lp-86d/mcp/RESULT.md`](../../../artifacts/ui/lp-86d/mcp/RESULT.md) (`PASS_PARTIAL_GAP`)
- Residual closeout: [`artifacts/mocklab/live-qa/residuals/mcp/`](../../../artifacts/mocklab/live-qa/residuals/mcp/)
- Kitchen-sink seed: [`deploy/daytona/agent-gateway/entrypoint.sh`](../../../deploy/daytona/agent-gateway/entrypoint.sh) `ensure_agent_config`
- Lab MCP binary: [`deploy/daytona/agent-gateway/lab-mcp/lab_echo_server.py`](../../../deploy/daytona/agent-gateway/lab-mcp/lab_echo_server.py)
- Merge fragment (gated): [`deploy/daytona/agent-gateway/kitchen-sink-mcp.fragment.yaml`](../../../deploy/daytona/agent-gateway/kitchen-sink-mcp.fragment.yaml)
- Contract: [`contracts/backend-runtime-v1/config.schema.json`](../../../contracts/backend-runtime-v1/config.schema.json) `mcp_servers`
- ADR: external backends stay out of monorepo ([ADR 0002](../../adr/0002-external-backend-products.md))

---

## 1. Operator summary

| Question | Answer today (2026-08-19) |
|----------|---------------------------|
| Why is Tools → MCP empty on MockLab? | Harness snapshot reads `BACKEND_HOME/config.yaml`. Empty home / no `mcp_servers` → honest `mcp_count=0`. BFF `SETTINGS_SEED_LAB_MCP` is a dead path on `source=harness`. |
| Can kitchen-sink enable MCP via config alone? | **Yes** — harness start merges `kitchen-sink-mcp.fragment.yaml` into `BACKEND_HOME/config.yaml` when the lab_echo binary is on the Fargate image. |
| Is empty MCP a kitchen-sink fail? | **Yes on live MockLab after this image roll** if `lab_echo` is missing. Honest empty remains valid for tenants with no MCP. |
| Lab MCP without inventing tokens? | **Yes** — prebaked stdio `lab_echo` (no network, no secrets). |
| When does live chat show MCP tool rows? | After harness image roll with lab_echo + LA `search_tool`/`use_tool` (`lp-oop.38.17` / [lanyard-agent#256](https://github.com/LanyardBrain/lanyard-agent/pull/256)) → `mcp__lab_echo__lab_echo` → ChatToolCalls. Hidden MCP schemas stay off LiteLLM `tools[]`. Re-QA: `run_mcp_qa.py`. |
| Where does MCP execute on short stack? | HTTP/SSE and stdio that does **not** need `/mnt/vault` → harness (`McpStdioClient` / fetch). stdio that must see the vault → **out of v1** (Daytona process session, not `process/execute`). |
| Guest create-env MCP secrets? | **Never.** MCP tokens stay on the harness task. `tool_only` denylist strips keys whose names contain `MCP`. |

---

## 2. Root cause (split ownership)

```
Portal Tools → MCP  ◄── BFF GET /settings/snapshot  ◄── Brain RPC settings.snapshot
                                                          │
                                                          ▼
                                              LA collectMcpServers(raw yaml)
                                                          │
                              ┌───────────────────────────┴──────────────────────────┐
                              │ Raw YAML may list mcp_servers                        │
                              │ Gateway loadConfig uses STRICT Zod (no mcp_servers)  │
                              │ → key cannot be present without breaking boot        │
                              │ No stdio MCP client → no registerHidden / mcp__*     │
                              └──────────────────────────────────────────────────────┘
```

| Layer | Owner | Gap |
|-------|-------|-----|
| Portal MCP inventory + ChatToolCalls mapper | Platform (done in `lp-86d.7`) | UI ready when host advertises ≥1 server / tool |
| Kitchen-sink seed **without** MCP key by default | Platform (done in `lp-zuh.4`) | Intentional; enable via `LANYARD_ENTRY_SEED_MCP=1` |
| Lab MCP binary + fragment + docs | Platform (`lp-zuh.10.6`) | Path ready; optional merge |
| Zod `mcp_servers` + stdio client + catalog register | **Lanyard Agent** (`lp-zuh.14.3` / #239) | **Implemented** — pin + wake with seed to activate |
| `mcp.set_enabled` patch write | **Lanyard Agent** (`lp-zuh.14.3`) | **Implemented** when `mcp_servers` exist |

LA code refs (external checkout, not vendored):

- `packages/config/src/schema.ts` — optional `mcp_servers` (stdio / command / args / enabled)
- `packages/adapters-portal/.../collect.ts` — `collectMcpServers` redacted name/transport/enabled
- `packages/adapters-portal/.../patch.ts` — `mcp.set_enabled` writes `enabled` when server exists
- `packages/agent-core/src/mcp/` — stdio client + `registerMcpServers` → `mcp__{server}__{tool}`
- `apps/gateway/src/agent-wiring.ts` — `agentCoreCatalogFromConfig` enables catalog search when MCP present

---

## 3. End-to-end path (when LA lands)

### 3.1 Lab-only server (no secrets)

Image path (Bucket A prebake):

```text
/opt/lanyard/lab-mcp/lab_echo_server.py
```

Offline probe (host or container):

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | python3 deploy/daytona/agent-gateway/lab-mcp/lab_echo_server.py
```

Expect `serverInfo.name=lab_echo` and tool `lab_echo`.

### 3.2 Config fragment (merge only after LA Zod accepts)

```yaml
mcp_servers:
  lab_echo:
    transport: stdio
    enabled: true
    command: python3
    args:
      - /opt/lanyard/lab-mcp/lab_echo_server.py
```

Canonical file: `deploy/daytona/agent-gateway/kitchen-sink-mcp.fragment.yaml`.

Optional future entrypoint gate (lab only, **default off**):

| Env | Effect |
|-----|--------|
| `LANYARD_ENTRY_SEED_MCP=1` | After kitchen-sink seed, append fragment if binary present. **Requires** LA pin that accepts `mcp_servers` or gateway fails closed on parse. |

Do **not** set this on production customer tenants.

### 3.3 Product expectations after merge + LA support

| Surface | Expected |
|---------|----------|
| `settings.snapshot.mcp_servers` | `[{ name: "lab_echo", transport: "stdio", enabled: true }]` |
| Tools → MCP | mcp-table with `lab_echo` (not honest-empty) |
| Chat | Agent may `search_tool` / `use_tool` → `mcp__lab_echo__lab_echo` (or host naming) → ChatToolCalls Finished/Error. Local kitchen-sink real harness runs real lab_echo JSON-RPC (not `echo: <prompt>`) when the prompt asks for MCP and lab_echo is enabled. Live MockLab still needs the harness image roll + LA `#256`. |
| Re-QA | `artifacts/ui/lp-86d/mcp/run_mcp_qa.py` → verdict **`PASS`** (not `PASS_PARTIAL_GAP`) |

### 3.4 Activation runbook (operators)

1. Confirm LA pin includes harness `search_tool` / `use_tool` invoke ([lanyard-agent#256](https://github.com/LanyardBrain/lanyard-agent/pull/256)).
2. Rebuild the **Fargate harness** image (`build-la-harness-image.sh`) so it copies `/opt/lanyard/lab-mcp/` + python3 + `merge-lab-echo-mcp.mjs`. Guest snapshot stays tool-only.
3. Roll the existing harness ECS service. Start merges `lab_echo` into `$BACKEND_HOME/config.yaml` (default `/var/lib/lanyard-backend`). Do **not** set BFF `SETTINGS_SEED_LAB_MCP` expecting Tools MCP — snapshot `source=harness` ignores it.
4. `GET /api/settings/snapshot` → `source=harness` and `mcp_count >= 1` with `lab_echo`.
5. Run `run_mcp_qa.py` / `artifacts/ui/lp-oop.38.17/run_qa.py` against MockLab; require an actual `search_tool`/`use_tool` row, not `MCP_NOT_AVAILABLE`.

---

## 4. What this bead does **not** do

- Does **not** vendor Lanyard Agent source into the monorepo.
- Does **not** auto-merge `mcp_servers` into the **guest** kitchen-sink seed (tool-only; `LANYARD_ENTRY_SEED_MCP` stays default off).
- **Does** fill-missing-merge `lab_echo` into **harness** `BACKEND_HOME/config.yaml` (`lp-oop.38.17`).
- Does **not** invent Granola/Gmail/GitHub tokens or OAuth for MockLab.
- Does **not** dump MCP secrets into guest create-env.

---

## 5. Acceptance map (`lp-zuh.10.6`)

| # | Criterion | How met |
|---|-----------|---------|
| 1 | Link or implement path so MockLab can exercise ≥1 MCP tool path | Path §3 + lab_echo server + fragment + entrypoint optional seed |
| 2 | `settings.snapshot` non-empty when configured **OR** honest residual closed | Honest residual: [`residuals/mcp/RESULT.md`](../../../artifacts/mocklab/live-qa/residuals/mcp/RESULT.md); non-empty deferred to `lp-vw3` |
| 3 | Do not invent secrets; lab-only MCP if any | `lab_echo` only; no tokens |

Live full close of `lp-vw3` remains a separate product + UI-QA bead.
