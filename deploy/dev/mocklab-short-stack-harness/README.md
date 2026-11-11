# MockLab short-stack harness — lab compose

**Bead:** `lp-oop.30` (lab compose) / `lp-oop.37.4` (LA image recipe + live echo replacement pin)  
**Topology:** existing-ECS *or* this lab compose ([ADR 0012](../../../docs/adr/0012-short-stack-harness.md))  
**Operator runbook:** [references/runbooks/mocklab-short-stack-harness.md](../../references/runbooks/mocklab-short-stack-harness.md)  
**Echo → LA cutover:** [references/runbooks/mocklab-replace-echo-harness-la.md](../../references/runbooks/mocklab-replace-echo-harness-la.md)  
**Offline smoke:** `bash deploy/scripts/smoke-mocklab-short-stack-harness.sh`  
**LA replacement smoke:** `bash deploy/scripts/smoke-mocklab-replace-echo-harness-la.sh`

Lab-only wiring for the always-on Lanyard Agent HTTP turn server (`POST /internal/turns`). Not AWS apply. Not a new AWS product. Not production.

## Default: host process

Lanyard Agent is external (ADR 0002). Run the PR 242 server from a local checkout:

```bash
cd deploy/dev/mocklab-short-stack-harness
cp .env.example .env          # lab token; chmod 0600
export LANYARD_AGENT_ROOT=/path/to/lanyard-agent
bash run-lab-harness.sh
# listens 127.0.0.1:8080
```

Point lab BFF at `HARNESS_URL=http://127.0.0.1:8080` and the same `HARNESS_SERVICE_TOKEN`. Leave `CHAT_DELIVERY` unset (`relay`) unless you are exercising the flag.

## Optional: compose image

When a published (or locally built) harness image exists:

```bash
export HARNESS_IMAGE=lanyard/harness:local   # digest pin in live; tag OK for lab
docker compose --profile harness up -d
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/internal/turns
# expect 401 without token
```

## Dual-run

This compose does **not** flip live MockLab. Guest-gateway + Relay stay default. Live enable is the existing ECS path in the runbook.

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Optional `harness` profile; loopback publish |
| `.env.example` | Non-secret names + lab-only placeholder token |
| `run-lab-harness.sh` | Start LA `createHarnessTurnServer` from `LANYARD_AGENT_ROOT` |
| `start-la-harness.mjs` | Image entrypoint (`lp-oop.37.4` / `lp-oop.38.14` / `lp-oop.38.18`). Binds tools, then LiteLLM, then lab `createToolsTurnRunner` (`runner=tools-lab`). Seeds `subagents.enabled`, merges `lab_echo` (`lp-oop.38.17`) and `vault_fs` (`lp-oop.38.19`) into `BACKEND_HOME/config.yaml` before the factory. Not an agent |
| `merge-lab-echo-mcp.mjs` | Fill-missing `mcp_servers.lab_echo` (harness stdio, no vault). SoT for Tools MCP + `use_tool`, not BFF `SETTINGS_SEED_LAB_MCP` |
| `merge-vault-fs-mcp.mjs` | Fill-missing `mcp_servers.vault_fs` (vault stdio, Daytona process session). SoT for Tools MCP + `use_tool` on vault-required servers |
| `ensure-subagents-config.mjs` | MockLab v1 subagents block: write when omitted, never clobber `enabled: false` |
| `config.yaml` | Image-baked `subagents.enabled: true` (`default_isolation: none`, `max_depth: 1`) |
| `Dockerfile` | Fargate image recipe from a built LA checkout (no ECR push). Ships python3 + `/opt/lanyard/lab-mcp`. Kitchen-sink `BACKEND_HOME=/var/lib/lanyard-backend` |
| `task-definition.example.json` | Example Fargate task family for the **existing** CP cluster (no live secrets) |
| `README.md` | This note |

## Non-claims

- Not a new ECS cluster / OpenSearch / Valkey / Lambda / public ALB
- Not live `lp-oop.31` turn evidence
- Compose up ≠ MockLab `chat_delivery=harness`
