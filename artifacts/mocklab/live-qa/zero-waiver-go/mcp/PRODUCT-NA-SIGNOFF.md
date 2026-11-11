# Product N/A sign-off — MockLab MCP (`lp-zuh.11.5`)

**Status:** APPROVED (human gate on PR #488 / `lp-zuh.11.5` close)  
**Bead:** `lp-zuh.11.5`  
**Parent epic:** `lp-zuh.11` (zero-waiver kitchen-sink GO)  
**Date (UTC):** 2026-08-14 (decision) · approved by 2026-08-17 close  
**Decision kind:** product N/A waiver (not a silent residual)

This document is the durable decision record required when lab MCP is **not**
configured on live MockLab. It exists so the zero-waiver close gate
(`lp-zuh.11.6`) cannot treat empty MCP as green without human acknowledgement.

---

## Decision

**Accept MockLab kitchen-sink MCP as product N/A for the zero-waiver matrix**,
with explicit residual code `mcp_unavailable`, until Lanyard Agent ships the
MCP product surface tracked by **`lp-vw3`** (external
[lanyard-agent#239](https://github.com/LanyardBrain/lanyard-agent/issues/239)).

| Item | Decision |
|------|----------|
| Claim live MCP inventory GO? | **No** |
| Claim live chat MCP tool-row GO? | **No** |
| Treat empty MCP as kitchen-sink fail? | **No** (checklist §1.7 Optional) |
| Silent waiver? | **No** — this file + RESULT + REPORT |
| Platform lab path retained? | **Yes** — lab_echo / fragment / optional seed (default off) |

---

## Evidence that forces product N/A (not lab-path GO)

| Check | Live result (2026-08-14T23:11:43Z) | Source |
|-------|-------------------------------------|--------|
| `GET /api/settings/snapshot` | `mcp_count=0`, `mcp_servers=[]`, `source=lanyard_agent` | `REPORT.json` |
| Tools → MCP UI | "No MCP servers in this snapshot." | `screenshots/03-tools-mcp.png` |
| Chat MCP tool path | Not exercised (empty inventory) | RESULT branch `product_na` |
| Offline lab_echo | **Works** (initialize / tools/list / tools/call) | offline probe |
| `LANYARD_ENTRY_SEED_MCP` | Default **off** (strict-LA safe) | entrypoint + smoke |

Normative platform path:
[`docs/plans/0008-daytona-agent-sandboxes/mcp-product-surface-mocklab.md`](../../../../docs/plans/0008-daytona-agent-sandboxes/mcp-product-surface-mocklab.md)

Prior residual closeout:
[`artifacts/mocklab/live-qa/residuals/mcp/RESULT.md`](../../residuals/mcp/RESULT.md)

---

## Why enabling lab MCP now is rejected

Preferring "make lab MCP work" is correct **only if** the pinned LA accepts and
runs `mcp_servers`. On pin `LA 0.0.0-main.9bcada6780d2` / snapshot
`f4d947f3-bd03-4f6c-b8a2-b2034872feba`:

1. **Zod strict config** rejects unknown `mcp_servers` → gateway fail-closed on wake.
2. **No stdio MCP client** → no `registerHidden` / `mcp__*` catalog entries.
3. **`mcp.set_enabled`** remains `not_found` without servers (LA product gap).

Therefore forcing `LANYARD_ENTRY_SEED_MCP=1` would **regress** MockLab
availability without delivering UI/chat MCP GO. Product N/A is the honest path.

---

## What remains open (do not close as done)

| Work | Owner | Bead / link |
|------|-------|-------------|
| Zod `mcp_servers` + stdio client + registerHidden | Lanyard Agent | `lp-vw3` / LA#239 |
| Honest `mcp.set_enabled` write path | Lanyard Agent | `lp-vw3` |
| Live non-empty snapshot + Tools → MCP table | Platform re-QA after LA pin | re-run this probe |
| Chat MCP tool rows (Finished/Error) | Portal + LA | `run_mcp_qa.py` → PASS |

---

## Human approval checklist

Human reviewer (platform + product):

- [x] Acknowledges live MockLab `mcp_servers=[]` is honest, not a harness bug
- [x] Accepts MCP kitchen-sink row as **product N/A** for `lp-zuh.11` zero-waiver close
- [x] Confirms we must **not** set `LANYARD_ENTRY_SEED_MCP=1` on customer tenants
- [x] Confirms `lp-vw3` remains the unblocker for LAB_MCP_PATH_GO
- [x] Approves language for `lp-zuh.11.6` GO report: MCP = PRODUCT_NA (explicit)

| Field | Value |
|-------|--------|
| Approver name | Human gate (merge review PR #488) |
| Date | 2026-08-17 (bead close: human gate approved) |
| Notes | Recorded on `lp-zuh.11.5` close_reason; aggregate gate `lp-zuh.11.6` RESULT.md |

---

## Linked sources

1. Live probe RESULT: [`RESULT.md`](./RESULT.md)
2. Live REPORT: [`REPORT.json`](./REPORT.json)
3. Platform path residual: [`../../residuals/mcp/RESULT.md`](../../residuals/mcp/RESULT.md)
4. Product surface plan: [`mcp-product-surface-mocklab.md`](../../../../docs/plans/0008-daytona-agent-sandboxes/mcp-product-surface-mocklab.md)
5. Prior UI gap: [`artifacts/ui/lp-86d/mcp/RESULT.md`](../../../ui/lp-86d/mcp/RESULT.md) (`PASS_PARTIAL_GAP`)
6. Fix bead: `lp-vw3`
7. External: https://github.com/LanyardBrain/lanyard-agent/issues/239
