# Residual — MockLab MCP product surface (`lp-zuh.10.6` / `lp-zuh.14.3` / `lp-vw3`)

**Bead:** `lp-zuh.10.6` (platform path, closed) · implement `lp-zuh.14.3` (closes `lp-vw3`) · live UI QA gate remains  
**External LA:** [lanyard-agent#239](https://github.com/LanyardBrain/lanyard-agent/issues/239)  
**Date:** 2026-08-14 (updated 2026-08-19)  
**Verdict:** **PLATFORM_PATH_READY** + **LA_PRODUCT_SURFACE_LANDED** + **SHORT_STACK_SEED_PATH** (BFF `SETTINGS_SEED_LAB_MCP` + fixtures packaging fix) — live MockLab PASS still gated on BFF redeploy + seed env + harness MCP roll + UI QA (`needs_ui_qa` / `needs_human`)  
**Kitchen-sink fail?** **No** — checklist 1.7 Optional until seed intentionally enabled  
**No secrets** in this package.  
**See:** [DECISION-tool-only-activation.md](./DECISION-tool-only-activation.md)

## Evidence summary

| Check | Result |
|-------|--------|
| Live MockLab `settings.snapshot.mcp_servers` (historical) | `[]` (`lp-86d.7` PASS_PARTIAL_GAP) |
| Kitchen-sink default seed includes `mcp_servers` | **No** (opt-in via `LANYARD_ENTRY_SEED_MCP=1`) |
| Lab MCP binary shipped in agent-gateway tree | **Yes** — `deploy/daytona/agent-gateway/lab-mcp/lab_echo_server.py` |
| Merge fragment documented | **Yes** — `kitchen-sink-mcp.fragment.yaml` |
| LA Zod accepts `mcp_servers` | **Yes** — `lp-zuh.14.3` / LA #239 implementation |
| LA stdio client + `mcp__*` catalog register | **Yes** — `packages/agent-core/src/mcp/` |
| LA `mcp.set_enabled` write | **Yes** when servers exist |
| Secrets invented | **No** |
| Live chat MCP tool rows / `run_mcp_qa.py` PASS | **Pending** UI QA after BFF redeploy + seed + harness MCP (`needs_ui_qa`) |
| Live `GET /api/settings/snapshot` (2026-08-19) | **500** until BFF ships `fixtures/` (packaging fix in this bead) |

## Why default empty remains honest

1. Entrypoint kitchen-sink (`ensure_agent_config`) intentionally omits `mcp_servers` so older LA pins never brick on wake.
2. **Tool-only / cp_s3:** guest seed is N/A — use BFF `SETTINGS_SEED_LAB_MCP=1` (see decision doc).
3. **Fat guest (optional):** after an MCP-capable LA pin, operators may still set `LANYARD_ENTRY_SEED_MCP=1` on the sandbox entrypoint.
4. Portal already handles empty inventory honestly (`lp-86d.7`); listed inventory works when snapshot advertises ≥1 server.

## Path to live PASS

1. LA MCP surface on main (`#245` / `c2f81d0`) — **done**.
2. Redeploy BFF with fixtures packaged + optional `SETTINGS_SEED_LAB_MCP=1`.
3. Confirm `GET /api/settings/snapshot` → `mcp_count >= 1` (`lab_echo`).
4. Roll harness to MCP-capable LA + non-echo runner that can invoke `mcp__*`.
5. Re-run `artifacts/ui/lp-86d/mcp/run_mcp_qa.py` (MOCKLAB_* env) → expect verdict **PASS**.

See [PATH.md](./PATH.md) and
[mcp-product-surface-mocklab.md](../../../../docs/plans/0008-daytona-agent-sandboxes/mcp-product-surface-mocklab.md).

## Residual code

| Code | Meaning | Owner to clear |
|------|---------|----------------|
| `mcp_unavailable` | Host advertises zero MCP servers | Enable seed after MCP-capable pin |
| `mcp_ui_unproven` | Snapshot non-empty but chat rows missing | Portal re-QA `run_mcp_qa.py` |

## Related artifacts

- Zero-waiver branch (`lp-zuh.11.5`): [`../../zero-waiver-go/mcp/`](../../zero-waiver-go/mcp/) — prior **PRODUCT_NA_SIGNED_WAIVER**
- QA: [`artifacts/ui/lp-86d/mcp/RESULT.md`](../../../ui/lp-86d/mcp/RESULT.md)
- Checklist: [`../NEW-TENANT-CHECKLIST.md`](../NEW-TENANT-CHECKLIST.md) §1.7
- Offline smoke: `bash deploy/daytona/agent-gateway/smoke-entrypoint.sh`
