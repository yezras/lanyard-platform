# Zero-waiver MockLab live-QA

Post-snapshot-pin (`lp-zuh.11.1`) Playwright matrix with **no `PARTIAL_WAIVED`** for kitchen-sink core surfaces, plus OnlyOffice / MemPalace / MCP packages.

## Close gate

| Artifact | Bead | Role |
|----------|------|------|
| **[RESULT.md](./RESULT.md)** | `lp-zuh.11.6` | Aggregate GO report — **overall GO** when matrix green |
| **[REPORT.json](./REPORT.json)** | `lp-zuh.11.6` | Machine-readable aggregate matrix |

## Child packages

| Package | Bead | Surfaces | Verdict (gate) |
|---------|------|----------|----------------|
| [core/](./core/) | `lp-zuh.11.2` | shell auth, vault, projects primary_path, tools/web_search, sub-agents, workflows, cron | **GO** |
| [onlyoffice/](./onlyoffice/) | `lp-zuh.11.3` | OnlyOffice mint + editor host residual | **GO mint** / **EXPLICIT_HARD_RESIDUAL** editor |
| [mempalace/](./mempalace/) | `lp-zuh.11.4` | MemPalace ready + search | **GO** |
| [mcp/](./mcp/) | `lp-zuh.11.5` | MCP lab path **or** product N/A signed (`PRODUCT_NA_SIGNED_WAIVER`) | **PRODUCT_NA signed** |

Checklist alignment: [../NEW-TENANT-CHECKLIST.md](../NEW-TENANT-CHECKLIST.md) (Gate column includes `lp-zuh.11.6`).

## Re-run

MCP:

```bash
set -a; source .env.mocklab-agent-dev; set +a
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
python artifacts/mocklab/live-qa/zero-waiver-go/mcp/run_zero_waiver_mcp_probe.py
```

Core:

```bash
set -a; source .env.mocklab-agent-dev; set +a
# optional: DAYTONA_API_KEY + DAYTONA_ORG_ID for guest durable probes
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
python artifacts/mocklab/live-qa/zero-waiver-go/core/run_zero_waiver_core_matrix.py
```

MemPalace:

```bash
set -a; source .env.mocklab-agent-dev; set +a
# DAYTONA_API_KEY + DAYTONA_ORG_ID for guest ready/search probes
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
python artifacts/mocklab/live-qa/zero-waiver-go/mempalace/run_zero_waiver_mempalace_probe.py
```

OnlyOffice:

```bash
set -a; source .env.mocklab-agent-dev; set +a
source "$HOME/.grok/skills/web-ui-testing/.venv/bin/activate"
python artifacts/mocklab/live-qa/zero-waiver-go/onlyoffice/run_zero_waiver_onlyoffice_probe.py
```

Never commit secrets, tokens, or `.env.mocklab-agent-dev`.
