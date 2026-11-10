# syntax=docker/dockerfile:1
#
# @lanyard/relay — multi-stage monorepo image
#
# Build from repo root (workspace context required):
#   docker build -f packages/relay/Dockerfile -t lanyard/relay:local .
#
# Image tags here are local build artifacts. Production must pin ECR digests
# (or immutable tags + digest), never :latest alone — see G7.P3 image release.
#
# Base image: pin by tag for local/dev; replace with digest in release pipelines.
#   e.g. node:22-bookworm-slim@sha256:<digest>

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_ENV=development
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /app

# --- install workspace manifests (cache-friendly) ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend-runtime/package.json packages/backend-runtime/package.json
COPY packages/hermes-compat/package.json packages/hermes-compat/package.json
COPY packages/chat-corpus/package.json packages/chat-corpus/package.json
COPY packages/connectors/package.json packages/connectors/package.json
COPY packages/bff/package.json packages/bff/package.json
# Sibling package.json files keep the workspace graph complete for frozen lockfile.
COPY packages/relay/package.json packages/relay/package.json
COPY packages/control-plane/package.json packages/control-plane/package.json
COPY packages/control-plane-fields/package.json packages/control-plane-fields/package.json
COPY packages/web-settings-schema/package.json packages/web-settings-schema/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/admin/package.json apps/admin/package.json
# ignore-scripts: workspace prepare hooks need full package sources (build stage).
# minimum-release-age 0: allow freshly published lockfile deps in rebuilds (pnpm 11).
RUN pnpm config set minimum-release-age 0 \
 && pnpm install --frozen-lockfile --ignore-scripts --filter "@lanyard/relay..."

# --- build shared + relay ---
FROM deps AS build
COPY packages/shared packages/shared
COPY packages/relay packages/relay
# ignore-scripts: sibling workspace packages are COPY'd as package.json only
# (frozen lockfile). Their prepare/postinstall must not run during deploy.
RUN pnpm config set ignore-scripts true \
 && pnpm --filter @lanyard/shared build \
 && pnpm --filter @lanyard/relay build \
 && pnpm --filter @lanyard/relay deploy --prod --legacy /out

# --- minimal runtime ---
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    RELAY_PORT=8787 \
    RELAY_HOST=0.0.0.0
WORKDIR /app
RUN groupadd --system --gid 991 nodejs \
 && useradd --system --uid 991 --gid nodejs portal
COPY --from=build --chown=portal:nodejs /out /app
USER portal
EXPOSE 8787
# Health: GET /health (PORT/RELAY_PORT, default 8787)
CMD ["node", "dist/index.js"]
