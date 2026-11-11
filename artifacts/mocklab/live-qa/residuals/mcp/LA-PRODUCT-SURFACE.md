# lp-zuh.14.3 — LA MCP product surface (implements lp-vw3)

**Date:** 2026-08-19  
**Platform bead:** `lp-zuh.14.3`  
**Closes tracker:** `lp-vw3` (after live UI QA PASS)  
**External LA:** [lanyard-agent#239](https://github.com/LanyardBrain/lanyard-agent/issues/239) · [PR #245](https://github.com/LanyardBrain/lanyard-agent/pull/245)

## What landed (Lanyard Agent — external)

1. Zod `mcp_servers` (stdio / command / args / enabled) on strict `configSchema`
2. Stdio MCP client + `registerMcpServers` → hidden `mcp__{server}__{tool}`
3. Gateway `agentCoreCatalogFromConfig` enables catalog search when MCP present
4. `settings.patch` `mcp.set_enabled` writes when servers exist
5. Unit tests: config schema, mcp-stdio + lab_echo fixture, settings patch
6. Typecheck fix: ChildProcess `.on` typing gap (same pattern as `apps/cli` gateway)

### Local verification (2026-08-19)

| Check | Result |
|-------|--------|
| `pnpm typecheck` | PASS |
| `@lanyard-agent/config` tests | 158 PASS |
| `@lanyard-agent/agent-core` tests (incl. mcp-stdio) | 500 PASS |
| `@lanyard-agent/adapters-portal` tests (incl. settings mcp.set_enabled) | 218 PASS |
| GitHub Actions CI on PR #245 | **BLOCKED** — org billing / spending limit (not a code failure) |

## Platform (this repo)

- Path already shipped (`lp-zuh.10.6`): lab_echo binary, fragment, optional seed
- Docs / residual updated for activation after MCP-capable pin
- Default seed still omits `mcp_servers` (older-pin safe)
- Offline: `smoke-entrypoint.sh` PASS · `scripts/validate.sh` PASS · lab_echo JSON-RPC probe PASS

## Remaining for acceptance criterion 4 (live PASS) — UI QA / human gates

1. Redeploy BFF with fixtures packaging + `SETTINGS_SEED_LAB_MCP=1` (tool-only / cp_s3 SoT)
2. Roll harness to LA ≥ `#245` with MCP registered + non-echo runner
3. Re-run `artifacts/ui/lp-86d/mcp/run_mcp_qa.py` (MOCKLAB_* env) → expect **PASS**
4. Archive RESULT under `artifacts/ui/lp-86d/mcp/`

Local path: `SETTINGS_SEED_LAB_MCP=1` + portal mock-gateway (emits `mcp__lab_echo__lab_echo`).

See [DECISION-tool-only-activation.md](./DECISION-tool-only-activation.md).

`needs_ui_qa=true` until step 3–4 complete.  
`needs_human=true` for live BFF env + harness image roll.
