# Zero-waiver MCP package (`lp-zuh.11.5`)

Live MockLab probe: **lab MCP tool path** when configured, else **explicit product N/A** (`lp-vw3`) with human sign-off material.

| File | Purpose |
|------|---------|
| [RESULT.md](./RESULT.md) | Acceptance map + explicit waiver narrative |
| [PRODUCT-NA-SIGNOFF.md](./PRODUCT-NA-SIGNOFF.md) | Human gate decision record |
| [REPORT.json](./REPORT.json) | Machine-readable probe output |
| [RESULT.auto.md](./RESULT.auto.md) | Auto summary from last probe run |
| [run_zero_waiver_mcp_probe.py](./run_zero_waiver_mcp_probe.py) | Playwright + offline lab_echo harness |
| [screenshots/](./screenshots/) | Auth + Tools → MCP evidence |
| [logs/](./logs/) | Offline probe transcript + sanitized report |

## Run

```bash
set -a; source .env.mocklab-agent-dev; set +a
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
# optional force re-login:
# export LP_ZUH115_FORCE_LOGIN=1
python artifacts/mocklab/live-qa/zero-waiver-go/mcp/run_zero_waiver_mcp_probe.py
```

Never commit secrets, tokens, or `.env.mocklab-agent-dev`.

## Verdicts

| Verdict | Meaning |
|---------|---------|
| `PRODUCT_NA_SIGNED_WAIVER` | Live empty MCP; explicit N/A + human_signoff (current MockLab) |
| `LAB_MCP_PATH_GO` | Non-empty inventory + chat tool signal |
| `LAB_MCP_INVENTORY_GO_CHAT_UNPROVEN` | Inventory only |
| `BLOCKED_AUTH` / `BLOCKED_NO_PLAYWRIGHT` | Harness/environment failure |
