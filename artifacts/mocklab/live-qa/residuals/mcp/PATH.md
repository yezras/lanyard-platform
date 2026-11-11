# MCP exercise path (MockLab lab-only)

**Bead:** `lp-zuh.10.6`  
**No secrets.**

## One-line path

```text
lab_echo_server.py (Bucket A)
  → config.mcp_servers.lab_echo (fragment / LANYARD_ENTRY_SEED_MCP)
    → LA stdio MCP client + registerHidden (lp-vw3)
      → settings.snapshot.mcp_servers non-empty
        → Tools → MCP table
          → search_tool / use_tool / mcp__lab_echo__*
            → Portal ChatToolCalls row
```

## Offline lab binary probe

```bash
cd "$(git rev-parse --show-toplevel)"
python3 deploy/daytona/agent-gateway/lab-mcp/lab_echo_server.py <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"lab_echo","arguments":{"text":"mocklab-mcp-ok"}}}
EOF
```

Expect JSON-RPC results for initialize, tools/list (`lab_echo`), and tools/call text `mocklab-mcp-ok`.

## Config fragment (do not merge until LA pin supports MCP)

File: `deploy/daytona/agent-gateway/kitchen-sink-mcp.fragment.yaml`

## Live re-QA (after lp-vw3)

```bash
# Against MockLab Portal base URL with auth as in lp-86d.7 harness
python3 artifacts/ui/lp-86d/mcp/run_mcp_qa.py
# Expect verdict PASS (not PASS_PARTIAL_GAP)
```
