# lp-86d.7 — MCP servers: settings inventory + tool use indicator

**Base URL:** `http://demo.localhost:3010`
**Login:** `dev@demo.local`
**Verdict:** `PASS`
**Acceptance met:** `True`

## Settings MCP

- Mode: `listed`
- Nav present: `True`
- API mcp_count: `3`
- Empty message: `False`
- Servers: `[{'name': 'lab_echo', 'transport': 'stdio', 'command': 'python3', 'enabled': True}, {'name': 'gmail', 'transport': 'stdio', 'command': 'gws'}, {'name': 'slack', 'transport': 'stdio', 'command': 'slack-mcp'}]`

## Chat MCP tool indicator

- Tool rows present: `True`
- MCP name/status indicator: `True`
- Scan: ```json
{
  "chat_tool_calls_roots": 1,
  "humanized_button_count": 1,
  "labels_in_tool_roots": [
    "Searching files"
  ],
  "duration_markers": 3,
  "collapsed_tool_pill": 0,
  "finished_labels": 0,
  "error_labels": 0,
  "mcp_name_hits": [
    "search_tool"
  ],
  "toolish_count": 2
}
```
- Assistant preview: "Mcp lab echo lab echo\nlab_echo\n2\nSearching files\ncli:remote-server\nsearch_tool\n40ms\nMcp lab echo lab echo\ncli:remote-server\nlab_echo\n55ms\nDemo brain (local mock) used MCP meta-tools for:\nIMPORTANT: Do not run workflows. Do not call /workflow. You have meta-tools search_tool and use_tool for MCP/integration tools. First call search_tool with query 'mcp' (or 'web' / 'search'). If any MCP-qualified tool name is returned (mcp__… or server__…), call use_tool on one of them with minimal args. If the catalog is empty, call a normal web search or a single builtin list_dir/ls tool once, then stop. Reply with one short sentence summarizing what tools you found or used. Do not ask questions. Marker: lp86d7-mcp-ui-marker\nCalled search_tool → use_tool on mcp__lab_echo__lab_echo (lab_echo). Marker path "

## Gap

- Unproven chat MCP indicator: `False`
- Reason: None
- Fix bead recommended: `False`

## Checks

- [x] login: dev@demo.local
- [x] settings-snapshot-api: {"http_status": 200, "source": "fixture", "mcp_count": 3, "skills_count": 2}
- [x] settings-nav-inventory: nav=['Skills', 'Workflows', 'MCP', 'Models', 'Integrations'] mcp_nav=True tools_rail=1
- [x] mcp-inventory-list: advertised=True table=1 names=['lab_echo', 'gmail', 'slack'] in_ui=['lab_echo', 'gmail', 'slack']
- [x] settings-mcp-acceptance: mode=listed
- [x] new-chat: opened
- [x] prompt-sent: marker=lp86d7-mcp-ui-marker visible=True
- [x] chat-tool-rows-present: {"chat_tool_calls_roots": 1, "humanized_button_count": 1, "labels_in_tool_roots": ["Searching files"], "duration_markers": 3, "collapsed_tool_pill": 0, "finished_labels": 0, "error_labels": 0, "mcp_name_hits": ["search_tool"], "toolish_count": 2}
- [x] mcp-tool-name-status-indicator: mcp_hits=['search_tool'] labels=['Searching files'] toolish=2 assistant='Mcp lab echo lab echo\nlab_echo\n2\nSearching files\ncli:remote-server\nsearch_tool\n40ms\nMcp lab echo lab echo\ncli:remote-server\nlab_echo\n55ms\nDemo brain (local mock) used MCP meta-tools for:\nIMPORTANT: Do not run workflows. Do not call /workflo'
- [x] assistant-reply: Mcp lab echo lab echo
lab_echo
2
Searching files
cli:remote-server
search_tool
40ms
Mcp lab echo lab echo
cli:remote-server
lab_echo
55ms
Demo brain (local mock) used MCP meta-tools for:
IMPORTANT: Do not run workflows. Do not call /workflow. You have meta-tools search_tool and use_tool for MCP/integration tools. First call search_tool with query 'mcp' (or 'web' / 'search'). If any MCP-qualified tool name is returned (mcp__… or server__…), call use_tool on one of them with minimal args. If the catalog is empty, call a normal web search or a single builtin list_dir/ls tool once, then stop. Repl

## Screenshots

- `01-live-home.png`
- `02-tools-overview.png`
- `03-tools-mcp.png`
- `04-live-new-chat.png`
- `05-live-prompt-sent.png`
- `06-live-tool-rows.png`
- `07-live-tools-expanded.png`
