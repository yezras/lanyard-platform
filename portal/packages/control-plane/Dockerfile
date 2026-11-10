# syntax=docker/dockerfile:1
#
# @lanyard/control-plane — multi-stage monorepo image
# Postgres via `pg` (no native better-sqlite3 toolchain).
#
# Build from repo root (workspace context required):
#   docker build -f packages/control-plane/Dockerfile -t lanyard/control-plane:local .
#
# Image tags here are local build artifacts. Production must pin ECR digests
# (or immutable tags + digest), never :latest alone — see G7.P3 image release.
#
# Runtime requires CONTROL_PLANE_DATABASE_URL or DATABASE_URL (postgres://…).
# Do not bake secrets into the image — inject from the secret store.

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
COPY packages/relay/package.json packages/relay/package.json
COPY packages/control-plane/package.json packages/control-plane/package.json
COPY packages/control-plane-fields/package.json packages/control-plane-fields/package.json
COPY packages/web-settings-schema/package.json packages/web-settings-schema/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/admin/package.json apps/admin/package.json
# ignore-scripts: workspace prepare hooks need full package sources (build stage).
RUN pnpm config set minimum-release-age 0 \
 && pnpm install --frozen-lockfile --ignore-scripts --filter "@lanyard/control-plane..."

# --- build shared + control-plane ---
FROM deps AS build
COPY packages/shared packages/shared
COPY packages/connectors packages/connectors
COPY packages/control-plane packages/control-plane
# ignore-scripts: sibling workspace packages are COPY'd as package.json only
# (frozen lockfile). Their prepare/postinstall must not run during deploy.
RUN pnpm config set ignore-scripts true \
 && pnpm --filter @lanyard/shared build \
 && pnpm --filter @lanyard/control-plane build \
 && pnpm --filter @lanyard/control-plane deploy --prod --legacy /out

# --- minimal runtime ---
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    CONTROL_PLANE_PORT=3100
WORKDIR /app
RUN groupadd --system --gid 991 nodejs \
 && useradd --system --uid 991 --gid nodejs portal
COPY --from=build --chown=portal:nodejs /out /app
USER portal
EXPOSE 3100
# Health: GET /health (CONTROL_PLANE_PORT, default 3100)
# DB: CONTROL_PLANE_DATABASE_URL or DATABASE_URL (required; postgres://…)
CMD ["node", "dist/server.js"]
