# syntax=docker/dockerfile:1
#
# lp-oop.38.1 — LA createHarnessTurnServer image for the EXISTING
# lanyard-platform-staging-harness Fargate service (cluster
# lanyard-platform-staging-portal-cp, internal CP ALB :8080).
#
# Build context = staged tree from a lanyard-agent checkout already
# built at the pin SHA (c41aca03268446ed13299572250ec7709e6eb342 /
# PR 252 memory_read stacked on PR 253 spawn 2477b22). Extra context
# `platform` = this directory (start wrapper). Do not bake mempalace CLI.
#
#   bash deploy/scripts/build-la-harness-image.sh
#
# Does NOT push ECR. Does NOT terraform apply. Does NOT ecs update-service.
# Not a Daytona snapshot. Agent loop stays off the guest.
# No unauthenticated /health on PR 242 — ECS health is TCP :8080.
#
# Fargate harness ships adapters-portal harness subtree + providers
# (LiteLLM HTTP client) + agent-core and required workspace packages so
# `import '@lanyard-agent/agent-core'` resolves for a tools runner.
# Production npm deps come from the operator LA checkout (pnpm store).
# Do not npm install on boot.
#
# Do NOT COPY this tree onto the Daytona guest snapshot. Guest remains
# tool-only (smoke-no-lanyard-agent-tree).
# Optional LiteLLM runner is loaded from harness/index exports
# (createEnvLiteLlmTurnRunner), which statically imports
# @lanyard-agent/providers.

FROM node:22-bookworm-slim

WORKDIR /opt/lanyard-agent

# Prebuilt tree from the operator checkout (pnpm build).
# Do not npm/pnpm install on boot. Agent-core is copied onto this Fargate
# harness only — never onto the Daytona guest snapshot.
COPY packages/adapters-portal/package.json packages/adapters-portal/package.json
COPY packages/adapters-portal/dist packages/adapters-portal/dist
COPY packages/adapters-portal/fixtures packages/adapters-portal/fixtures

# providers is the LiteLLM HTTP client (node builtins only).
# createEnvLiteLlmTurnRunner imports this specifier.
COPY packages/providers/package.json packages/providers/package.json
COPY packages/providers/dist packages/providers/dist

# agent-core + required workspace packages (config, logging, memory, session).
# Do not invent these packages in the platform repo.
COPY packages/agent-core/package.json packages/agent-core/package.json
COPY packages/agent-core/dist packages/agent-core/dist
COPY packages/config/package.json packages/config/package.json
COPY packages/config/dist packages/config/dist
COPY packages/logging/package.json packages/logging/package.json
COPY packages/logging/dist packages/logging/dist
COPY packages/memory/package.json packages/memory/package.json
COPY packages/memory/dist packages/memory/dist
COPY packages/session/package.json packages/session/package.json
COPY packages/session/dist packages/session/dist
COPY packages/workflow/package.json packages/workflow/package.json
COPY packages/workflow/dist packages/workflow/dist

# Production pnpm store + package-level node_modules from the operator
# checkout so @earendil-works/pi-*, @firecrawl/anydoc, yaml, zod, and
# better-sqlite3 resolve. Relative symlinks target node_modules/.pnpm.
COPY node_modules/.pnpm node_modules/.pnpm
COPY packages/agent-core/node_modules packages/agent-core/node_modules
COPY packages/config/node_modules packages/config/node_modules
COPY packages/session/node_modules packages/session/node_modules
COPY packages/adapters-portal/node_modules packages/adapters-portal/node_modules

RUN mkdir -p node_modules/@lanyard-agent \
  && ln -s /opt/lanyard-agent/packages/providers node_modules/@lanyard-agent/providers \
  && ln -s /opt/lanyard-agent/packages/agent-core node_modules/@lanyard-agent/agent-core \
  && ln -s /opt/lanyard-agent/packages/config node_modules/@lanyard-agent/config \
  && ln -s /opt/lanyard-agent/packages/logging node_modules/@lanyard-agent/logging \
  && ln -s /opt/lanyard-agent/packages/memory node_modules/@lanyard-agent/memory \
  && ln -s /opt/lanyard-agent/packages/session node_modules/@lanyard-agent/session \
  && ln -s /opt/lanyard-agent/packages/workflow node_modules/@lanyard-agent/workflow

COPY --from=platform start-la-harness.mjs /opt/harness/start-la-harness.mjs
COPY --from=platform merge-lab-echo-mcp.mjs /opt/harness/merge-lab-echo-mcp.mjs
COPY --from=platform merge-vault-fs-mcp.mjs /opt/harness/merge-vault-fs-mcp.mjs

# lab_echo stdio MCP runs on this Fargate task (lp-oop.38.17), not Daytona
# toolbox execute. Same path as the kitchen-sink fragment so vault config
# does not need a guest binary. Start wrapper fill-missing-merges it into
# BACKEND_HOME/config.yaml (Tools snapshot + use_tool SoT).
# vault_fs catalog also lives in BACKEND_HOME/config.yaml (lp-oop.38.19).
# The vault stdio binary is on Daytona /mnt/vault (vault seed), not this image.
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=labmcp . /opt/lanyard/lab-mcp/
RUN chmod -R a+rX /opt/lanyard/lab-mcp \
  && mkdir -p /var/lib/lanyard-backend /var/lib/lanyard-agent \
  && chown node:node /var/lib/lanyard-backend /var/lib/lanyard-agent
USER node
COPY --from=platform --chown=node:node config.yaml /var/lib/lanyard-agent/config.yaml
COPY --from=platform --chown=node:node ensure-subagents-config.mjs /opt/harness/ensure-subagents-config.mjs
COPY --from=platform --chown=node:node merge-vault-fs-mcp.mjs /opt/harness/merge-vault-fs-mcp.mjs
COPY --from=platform --chown=node:node start-la-harness.mjs /opt/harness/start-la-harness.mjs

# Kitchen-sink vault document as harness BACKEND_HOME (lp-oop.38.18).
# Same config.yaml + skills/ + workflows/ CP/S3 serves. Not a fat guest snapshot.
# Build: --build-context vaultseed=deploy/artifacts/mocklab-vault-seed
RUN mkdir -p /var/lib/lanyard-backend/state \
  /var/lib/lanyard-backend/mempalace \
  /var/lib/lanyard-backend/cron
COPY --from=vaultseed --chown=node:node config.yaml /var/lib/lanyard-backend/config.yaml
COPY --from=vaultseed --chown=node:node skills /var/lib/lanyard-backend/skills
COPY --from=vaultseed --chown=node:node workflows /var/lib/lanyard-backend/workflows
RUN chown -R node:node /var/lib/lanyard-backend

ENV NODE_ENV=production
ENV HARNESS_HOST=0.0.0.0
ENV HARNESS_PORT=8080
ENV BACKEND_HOME=/var/lib/lanyard-backend
# Harness subtree + providers + agent-core (specifier resolve).
# Package-root adapters-portal re-exports gateway-core + ws (not present).
ENV HARNESS_MODULE=/opt/lanyard-agent/packages/adapters-portal/dist/harness/index.js
ENV HARNESS_KIND=createHarnessTurnServer
ENV BACKEND_HOME=/var/lib/lanyard-agent
# Fail boot when baked JS has no spawn_subagent (live SPAWN_TOOL_MISSING).
ENV HARNESS_REQUIRE_SPAWN=1
# Fail boot when baked JS has no memory_read (live TOOL_NOT_AVAILABLE).
ENV HARNESS_REQUIRE_MEMORY=1

# Token arrives at runtime from ECS secrets map. Never bake it.
EXPOSE 8080

USER node
CMD ["node", "/opt/harness/start-la-harness.mjs"]
