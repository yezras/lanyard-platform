# Mocklab agent-parity compose (joint GO)

**Bead:** `lp-rt5.8`  
**Topology:** [docs/architecture/mocklab-agent-parity-topology.md](../../../docs/architecture/mocklab-agent-parity-topology.md)  
**Prove:** `bash deploy/scripts/prove-mocklab-agent-parity.sh`

## What this is

A **lab-only** compose topology for Portal + optional Document Server, used as
the Docker mocklab shape for joint GO with Lanyard Agent.

Lanyard Agent source is **external** (ADR 0002). Run LA as:

1. **Host process** (pilot path) with `GATEWAY_RELAY_*` aligned to relay secrets, or
2. **Published image pin** once the agent track publishes one (`lac-yt3.6`).

Do **not** put production secrets or `.env.mocklab-agent-dev` contents in git.

## Services

| Service | Image / build | Host ports |
| --- | --- | --- |
| postgres | `postgres:16-alpine` | `5432` |
| control-plane | monorepo `portal` CP image | `127.0.0.1:3100` |
| relay | monorepo relay | `8787` |
| bff | monorepo BFF (`BRAIN_RPC_ENABLED=1`) | `4000` |
| web (optional) | monorepo web or Vite host | `3010` |
| documentserver (optional) | OnlyOffice lab DS | `127.0.0.1:8080` |

LA dials **out** to `ws://host.docker.internal:8787/relay` (or host
`ws://127.0.0.1:8787/relay` when LA is on host).

## Quick start (operator)

```bash
# 1) Portal core stack (from monorepo portal/ or this compose)
cd portal && source .data/demo-env.sh   # lab secrets, not committed elsewhere
pnpm dev:control-plane &               # or docker compose up
# ensure relay is up with RELAY_DEV_SECRETS matching LA instance
pnpm dev:relay &
BRAIN_RPC_ENABLED=1 pnpm dev:bff &
pnpm dev:web &

# 2) Lanyard Agent (from lanyard-agent checkout on main)
# lp-uxy.3: BACKEND_HOME is LA runtime home (never Hermes ~/.hermes). Product
# cron store must share this tree ($BACKEND_HOME/cron/jobs.json) so Portal
# settings.snapshot + cron.set_enabled see the same jobs as /cron and ticker.
export BACKEND_HOME="${BACKEND_HOME:-$HOME/.lanyard-agent}"
# Optional explicit pin if product defaults stateDir elsewhere:
#   config.cron.state_dir = $BACKEND_HOME   (or env documented by LA)
set -a; source ~/.lanyard-agent/env; set +a
# GATEWAY_RELAY_* must match portal RELAY_DEV_SECRETS
node apps/gateway/dist/main.js

# 3) Joint prove
cd /path/to/lanyard-platform
bash deploy/scripts/prove-mocklab-agent-parity.sh
```

Optional lab DS:

```bash
LIVE=1 bash deploy/scripts/smoke-lab-onlyoffice-compose.sh
```

## Files

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | Portal CP/relay/BFF/postgres (+ optional DS profile) |
| `.env.example` | Non-secret names + placeholders only |
| `README.md` | This note |

## Non-claims

- Not AWS mocklab EC2 / staging ALB
- Not production customer topology
- Compose alone does not equal joint GO — run the prove script
