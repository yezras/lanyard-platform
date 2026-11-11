# Decision — MCP activation after tool-only pin (`lp-zuh.14.3`)

**Date:** 2026-08-19  
**Bead:** `lp-zuh.14.3` (closes tracker `lp-vw3` after UI QA PASS)  
**Status:** Decision draft for human / operator gate  
**No secrets.**

## Context

LA MCP product surface landed ([lanyard-agent#245](https://github.com/LanyardBrain/lanyard-agent/pull/245)).
Platform guest path (`LANYARD_ENTRY_SEED_MCP` + lab_echo fragment) landed earlier (`lp-zuh.10.6`).

Live MockLab then flipped to **tool-only** Daytona snapshot (`lp-oop.37.5`) with:

| Field | Live value (observed 2026-08-19) |
|-------|-----------------------------------|
| `chat_delivery` | `harness` |
| `vault_plane` | `cp_s3` |
| Guest LA / gateway | **Absent** (tool-only) |
| Settings SoT | BFF snapshot/discover (`lp-oop.37.3`) — **not** guest Brain RPC |

## Decision

1. **Guest `LANYARD_ENTRY_SEED_MCP` alone cannot satisfy live Tools → MCP** while the
   default snapshot is tool-only (no guest config.yaml / no guest Brain RPC settings).
2. **Short-stack settings inventory seed** is BFF env `SETTINGS_SEED_LAB_MCP=1`
   (alias: `LANYARD_ENTRY_SEED_MCP=1` on the BFF task). This prepends secret-free
   `lab_echo` into `settings.snapshot.mcp_servers` on the cp_s3 / fixture path.
3. **BFF image must ship `fixtures/`** (`package.json` `files` includes `fixtures`).
   Missing fixtures caused live `GET /api/settings/snapshot` → **500** after the
   cp_s3 settings cutover (Tools → MCP showed Internal server error).
4. **Chat MCP ChatToolCalls rows on live** still require the harness LA image to
   include MCP product surface (#245) **and** a non-echo runner that registers
   `mcp__*` tools. Inventory-only seed does not invent chat tool events.

## Operator activation (live MockLab)

1. Redeploy BFF with this bead (fixtures packaged + seed flag).
2. Set ECS/task env `SETTINGS_SEED_LAB_MCP=1` (lab only).
3. Confirm `GET /api/settings/snapshot` → `mcp_count >= 1`, `lab_echo` present.
4. Roll harness image to LA main (≥ `c2f81d0` / #245) with MCP + LiteLLM runner;
   ensure harness config can list/register `lab_echo` (stdio binary or equivalent).
5. Re-run `artifacts/ui/lp-86d/mcp/run_mcp_qa.py` with `MOCKLAB_BASE_URL` +
   `MOCKLAB_AGENT_*` → expect verdict **PASS**.

## Local proof path (no AWS)

```bash
# Portal tmux stack + mock-gateway
SETTINGS_SEED_LAB_MCP=1 PORTAL_TMUX_NO_ATTACH=1 portal/scripts/dev-tmux.sh
# mock-gateway window must see SETTINGS_SEED_LAB_MCP=1 (re-export in that pane)
SETTINGS_SEED_LAB_MCP=1 portal/packages/web/ui-testing/.venv/bin/python \
  artifacts/ui/lp-86d/mcp/run_mcp_qa.py
```

Mock gateway emits `search_tool` + `mcp__lab_echo__lab_echo` tool_progress when the
prompt mentions MCP (lp-zuh.14.3), so ChatToolCalls indicator can PASS locally.

## Evidence — local `run_mcp_qa.py` PASS (2026-08-19)

Archived under `artifacts/ui/lp-86d/mcp/` (verdict **PASS**, `mcp_count=3` incl. `lab_echo`,
`mcp_name_hits` includes `search_tool`, ChatToolCalls present). Base URL
`http://demo.localhost:3010` with `SETTINGS_SEED_LAB_MCP=1` + mock-gateway MCP tool path.

## Human gates

- `needs_ui_qa=false` for AC4 after local PASS archived (this bead)
- `needs_human=true` for **live** MockLab: BFF redeploy (fixtures + `SETTINGS_SEED_LAB_MCP=1`) + harness MCP image roll — does not block closing AC4 on local evidence

## Superseded on short-stack harness SoT (`lp-oop.38.17`, 2026-08-20)

After `lp-oop.38.4` / `.6`, live Tools snapshot is `source=harness`. BFF
`SETTINGS_SEED_LAB_MCP` is **not** applied on that path (inventory-only overlay
would lie: UI `lab_echo` with no harness `use_tool`).

Live catalog seed is harness `BACKEND_HOME/config.yaml`. The Fargate start
wrapper fill-missing-merges `lab_echo` when `/opt/lanyard/lab-mcp/lab_echo_server.py`
is on the image. `lp-jzfc` BFF env is not the invoke SoT.

Kitchen-sink real-harness (local UI QA) runs a real lab_echo stdio
JSON-RPC `tools/call` when the prompt asks for `search_tool` / `use_tool` /
`lab_echo` and the snapshot row is enabled. Reply is not `echo: <prompt>`.
Vault-required stdio stays fail-closed (not toolbox execute). Live MockLab
chat invoke still needs the harness image roll + LA `#256`.
