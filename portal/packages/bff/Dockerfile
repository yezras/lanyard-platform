# syntax=docker/dockerfile:1
#
# @lanyard/bff — multi-stage monorepo image
#
# Build from portal monorepo root (workspace context required):
#   docker build -f packages/bff/Dockerfile -t lanyard/bff:local .
#
# Image tags here are local build artifacts. Production must pin ECR digests
# (or immutable tags + digest), never :latest alone — see G7.P3 image release.

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
 && pnpm install --frozen-lockfile --ignore-scripts --filter "@lanyard/bff..."

# --- build workspace packages required by BFF ---
FROM deps AS build
COPY packages/shared packages/shared
COPY packages/backend-runtime packages/backend-runtime
COPY packages/hermes-compat packages/hermes-compat
COPY packages/chat-corpus packages/chat-corpus
COPY packages/connectors packages/connectors
COPY packages/bff packages/bff
# ignore-scripts: sibling workspace packages are COPY'd as package.json only
# (frozen lockfile). Their prepare/postinstall must not run during deploy.
RUN pnpm config set ignore-scripts true \
 && pnpm --filter @lanyard/shared build \
 && pnpm --filter @lanyard/backend-runtime build \
 && pnpm --filter @lanyard/hermes-compat build \
 && pnpm --filter @lanyard/chat-corpus build \
 && pnpm --filter @lanyard/connectors build \
 && pnpm --filter @lanyard/bff build \
 && pnpm --filter @lanyard/bff deploy --prod --legacy /out

# --- minimal runtime ---
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    BFF_PORT=4000
WORKDIR /app
RUN groupadd --system --gid 991 nodejs \
 && useradd --system --uid 991 --gid nodejs portal
COPY --from=build --chown=portal:nodejs /out /app
USER portal
EXPOSE 4000
# Health: GET /health (BFF_PORT, default 4000)
CMD ["node", "dist/index.js"]
