# lp-86d.7 — MCP servers QA

Live mocklab proof for Tools → MCP inventory honesty and chat MCP tool-use indicator.

## Run

```bash
# Local demo (portal + mock-gateway). Seed lab_echo + MCP tool rows:
SETTINGS_SEED_LAB_MCP=1 \
portal/packages/web/ui-testing/.venv/bin/python \
  artifacts/ui/lp-86d/mcp/run_mcp_qa.py

# Live MockLab (never print credentials):
set -a && source .env.mocklab-agent-dev && set +a
portal/packages/web/ui-testing/.venv/bin/python \
  artifacts/ui/lp-86d/mcp/run_mcp_qa.py
# Uses MOCKLAB_BASE_URL + MOCKLAB_AGENT_EMAIL/PASSWORD when set.
```

## Artifacts

- `RESULT.md` / `REPORT.json` — checks + verdict
- `03-tools-mcp.png` — Tools → MCP empty honest state
- `05-live-prompt-sent.png` … `07-live-tools-expanded.png` — chat attempt

## Related

- Gap fix: **lp-vw3** (LA MCP product surface)
- Unit contract: `portal/packages/web/src/features/chat/chatToolCallMapper.test.ts`
