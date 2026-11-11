# syntax=docker/dockerfile:1
#
# Production-oriented agent gateway image for Daytona sandboxes (lp-e9l / lp-b7w).
# Pilot isolation class: container (linux-vm optional hardening later).
# Platforms: linux/amd64 (Daytona container snapshot) + linux/arm64 (Fargate / multi-arch).
#
# Plan §4.3 (docs/plans/0008-daytona-agent-sandboxes/overview.md):
#   - Agent is a guest: does not own sandbox lifecycle
#   - Bucket A (this image): agent binary + product CLIs prebaked once per release
#   - Bucket B: tenant vault on S3 (mounted at wake; not baked here)
#   - Bucket C: Relay secrets + mount material injected at wake (not baked here)
#   - Entrypoint (lp-b7w / lp-zuh.6): ensure Mountpoint → wait vault → refresh env → exec gateway
#   - Gateway death → container non-zero exit (foreground exec)
#   - No package-install on boot (no apt/pip/npm in entrypoint)
#   - mount-s3 + fuse prebaked (lp-zuh.9.3) — never install-on-boot
#
# Stages:
#   toolbox        — product CLIs + mount-s3 + mempalace (shared)
#   tool-only      — short-stack guest (lp-oop.21). Skips AGENT_TARBALL / lanyard-agent.
#                    Not the live MockLab pin. Do not bump DAYTONA_DEFAULT_SNAPSHOT.
#   agent-gateway  — default last stage. Today's guest-gateway (live pin recipe unchanged).
#
# Env parity: docs/plans/0008-daytona-agent-sandboxes/gateway-env-contract.md
#
# Build (linux/amd64, local proof — no ECR required):
#   bash deploy/daytona/agent-gateway/build-local.sh --run-smoke
# Tool-only (lp-oop.21; skips AGENT_TARBALL; not a live pin):
#   bash deploy/daytona/agent-gateway/build-local.sh --tool-only
#   docker build --platform linux/amd64 --target tool-only \
#     -t lanyard/agent-gateway:tool-only-local \
#     -f deploy/daytona/agent-gateway/Dockerfile \
#     deploy/daytona/agent-gateway
# Multi-arch:
#   PLATFORM=linux/arm64 bash deploy/daytona/agent-gateway/build-local.sh
# CI → ECR digest (lp-wu1): .github/workflows/agent-gateway-image.yml
#   docs/plans/0008-daytona-agent-sandboxes/agent-gateway-ecr-push.md
# Raw docker (default = agent-gateway, live recipe):
#   docker build --platform linux/amd64 \
#     -t lanyard/agent-gateway:local \
#     -f deploy/daytona/agent-gateway/Dockerfile \
#     deploy/daytona/agent-gateway
#
# Optional: bake a real backend-runtime-v1 / lanyard-agent tarball:
#   docker build --platform linux/amd64 \
#     --build-arg AGENT_TARBALL=backend-release.tar.gz \
#     -t lanyard/agent-gateway:local \
#     -f deploy/daytona/agent-gateway/Dockerfile \
#     deploy/daytona/agent-gateway
#   (place the tarball in the build context first; never commit secrets)
#   AGENT_TARBALL is ignored for --target tool-only (lp-oop.21).
# Live pin (lp-na7d): bake real agent — REQUIRE_REAL_AGENT=1 fails closed on stub:
#   docker build --platform linux/amd64 \
#     --build-arg AGENT_TARBALL=lanyard-agent-0.0.0-main.8835654f4ecd.tar.gz \
#     --build-arg LANYARD_REQUIRE_REAL_AGENT=1 \
#     -t lanyard/agent-gateway:live \
#     -f deploy/daytona/agent-gateway/Dockerfile \
#     deploy/daytona/agent-gateway
#
# Local run smoke (vault mount required; secrets via -e only):
#   mkdir -p /tmp/vault-smoke && touch /tmp/vault-smoke/.vault-ready
#   docker run --rm --platform linux/amd64 \
#     -e VAULT_ROOT=/mnt/vault \
#     -e BACKEND_HOME=/var/lib/company-brain-backend \
#     -e GATEWAY_RELAY_URL=wss://relay.example/ws \
#     -e GATEWAY_RELAY_ID=inst_local \
#     -e GATEWAY_RELAY_INSTANCE_ID=inst_local \
#     -e GATEWAY_RELAY_SECRET=local-not-a-real-secret \
#     -e LANYARD_ENTRY_VAULT_READY_FILE=.vault-ready \
#     -e LANYARD_FAKE_GATEWAY_SLEEP_SEC=0 \
#     -v /tmp/vault-smoke:/mnt/vault:ro \
#     lanyard/agent-gateway:local
#
# Snapshot pin: lp-zuh.9.3 / agent-snapshot-bump-runbook.md
# Tool-only must not write DAYTONA_DEFAULT_SNAPSHOT or MockLab agent_snapshot_id.

ARG BASE_IMAGE=debian:bookworm-slim
# Empty = ship stub gateway for local/CI proof builds without product tarball.
# Non-empty = context-relative path to a backend-runtime-v1 / LA release tarball.
# Unused by --target tool-only (lp-oop.21).
ARG AGENT_TARBALL=
# Fail-closed gate for live pin (lp-na7d): when 1, image must contain real agent,
# not fake-gateway stub. Local proof may leave 0 (stub allowed). Live publish
# sets this to 1 and must provide AGENT_TARBALL or a single archive in agent-release/.
ARG LANYARD_REQUIRE_REAL_AGENT=0
# Pin Mountpoint for Amazon S3 (spike-proven 1.23.0). Override only for deliberate bumps.
ARG MOUNT_S3_VERSION=1.23.0
# Pin MemPalace CLI (PyPI). Override only for deliberate bumps (lp-zuh.10.2).
ARG MEMPALACE_VERSION=3.7.0

# Platform is set by `docker build --platform linux/amd64|linux/arm64` (see build-local.sh).
FROM ${BASE_IMAGE} AS toolbox

LABEL org.opencontainers.image.title="lanyard-agent-gateway" \
      org.opencontainers.image.description="Company Brain gateway guest image for Daytona (Bucket A; plan §4.3)" \
      org.opencontainers.image.source="https://github.com/LanyardBrain/lanyard-platform" \
      lanyard.plan="0008-daytona-agent-sandboxes" \
      lanyard.plan_section="4.3" \
      lanyard.bead="lp-e9l" \
      lanyard.entrypoint_bead="lp-b7w" \
      lanyard.mount_s3_bead="lp-zuh.9.3" \
      lanyard.mempalace_bead="lp-zuh.10.2" \
      lanyard.track="phase2-image" \
      lanyard.isolation="container" \
      lanyard.platforms="linux/amd64,linux/arm64"

# ---------------------------------------------------------------------------
# PRODUCT CLI PREBAKE (Bucket A) — install once per image build, never on boot
# ---------------------------------------------------------------------------
# Shared tools intended for all tenants (agent tools / vault skills). Extend
# this list when product tools require additional host CLIs; do not apt/pip in
# entrypoint.sh (plan §4.3 anti-pattern).
#
# Prebake set (pilot):
#   - git, curl, ca-certificates  — clone / HTTPS
#   - jq                          — JSON tooling for skills/scripts
#   - python3                     — agent/script runtime (no pip-on-boot)
#   - openssh-client              — git+ssh / remote ops skills
#   - unzip, tar, gzip, xz-utils  — archive handling
#   - procps, coreutils, findutils, bash — process + shell basics
#   - tini                        — PID 1 signal forwarding
#   - mount-s3 (pinned) + fuse + fusermount — S3 vault Mountpoint (lp-zuh.9.3)
#   - util-linux                  — findmnt for entrypoint ensure_vault_mount
#   - mempalace (pinned PyPI)     — vault semantic recall CLI (lp-zuh.10.2)
#
# Agent binary: optional AGENT_TARBALL —
#   - backend-runtime-v1 (bin/company-brain-backend), or
#   - lanyard-agent product tarball (source+dist-v1; install-agent-runtime wraps it)
# Without a tarball: stub bin/company-brain-backend for local proof.
# --target tool-only (lp-oop.21) skips AGENT_TARBALL / install-agent-runtime.
#
# Node 22 is required when baking a real Lanyard Agent product tarball
# (pnpm install + node gateway). Stub-only builds still get Node so
# install-agent-runtime can detect `node` when a tarball is present.
# ---------------------------------------------------------------------------
ARG NODE_VERSION=22.15.0
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      coreutils \
      curl \
      findutils \
      git \
      gzip \
      jq \
      openssh-client \
      procps \
      python3 \
      tar \
      tini \
      unzip \
      xz-utils \
 && arch="$(dpkg --print-architecture)" \
 && case "${arch}" in \
      amd64) node_arch=x64 ;; \
      arm64) node_arch=arm64 ;; \
      *) echo "unsupported arch ${arch} for Node prebake" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
      | tar -xJ -C /usr/local --strip-components=1 \
 && corepack enable \
 && corepack prepare pnpm@11.3.0 --activate \
 && rm -rf /var/lib/apt/lists/* \
 && git --version \
 && curl --version \
 && jq --version \
 && python3 --version \
 && node --version \
 && pnpm --version

# Layout defaults (paths only — secret values come from wake inject / Bucket C).
ENV BACKEND_INSTALL_PATH=/opt/company-brain-backend/current \
    BACKEND_HOME=/var/lib/company-brain-backend \
    VAULT_ROOT=/mnt/vault \
    PATH="/opt/company-brain-backend/current/bin:${PATH}"

# Non-root guest user (orchestrator still mounts vault as configured).
# /mnt/vault: brain-owned for empty local fallback only. Production path is
# Mountpoint after ensure_vault_mount (lp-zuh.6); FUSE then replaces this dir.
RUN groupadd --system --gid 990 brain \
 && useradd --system --uid 990 --gid brain --home-dir /var/lib/company-brain-backend \
      --shell /usr/sbin/nologin brain \
 && mkdir -p \
      /opt/company-brain-backend/current/bin \
      /var/lib/company-brain-backend \
      /mnt/vault \
      /usr/local/lib/lanyard \
 && chown -R brain:brain /var/lib/company-brain-backend /opt/company-brain-backend \
 && chown brain:brain /mnt/vault \
 && chmod 0755 /mnt/vault \
 && (grep -Eq '^[[:space:]]*user_allow_other' /etc/fuse.conf 2>/dev/null \
      || echo 'user_allow_other' >> /etc/fuse.conf)
# user_allow_other: non-root brain may pass mount-s3 --allow-other (lp-zuh.9.4)

# Re-declare ARG after FROM so it is available for COPY/RUN (Docker scoping).
ARG MOUNT_S3_VERSION=1.23.0
ARG MEMPALACE_VERSION=3.7.0

COPY --chown=root:root entrypoint.sh /usr/local/lib/lanyard/entrypoint.sh
COPY --chown=root:root install-mount-s3.sh /usr/local/lib/lanyard/install-mount-s3.sh
COPY --chown=root:root install-mempalace.sh /usr/local/lib/lanyard/install-mempalace.sh
COPY --chown=root:root gws /usr/local/bin/gws

RUN chmod 0755 \
      /usr/local/lib/lanyard/entrypoint.sh \
      /usr/local/lib/lanyard/install-mount-s3.sh \
      /usr/local/lib/lanyard/install-mempalace.sh \
      /usr/local/bin/gws \
 && /usr/local/lib/lanyard/install-mount-s3.sh "${MOUNT_S3_VERSION}" \
 && /usr/local/lib/lanyard/install-mempalace.sh "${MEMPALACE_VERSION}" \
 && command -v git \
 && command -v curl \
 && command -v jq \
 && command -v python3 \
 && command -v mount-s3 \
 && command -v fusermount \
 && command -v mempalace \
 && command -v gws \
 && gws --help \
 && gws --help | grep -q "GOOGLE_WORKSPACE_CLI_TOKEN" \
 && mount-s3 --version \
 && mempalace --version \
 && test -d /mnt/vault \
 && test "$(stat -c '%u:%g' /mnt/vault)" = "990:990" \
 && test ! -e /opt/company-brain-backend/current/lanyard-agent

# Deliberately NO ENV for GATEWAY_RELAY_SECRET, API keys, or tenant ids.
# Those are Bucket C (wake inject) or Bucket B (vault) — never image layers.

# ---------------------------------------------------------------------------
# tool-only (lp-oop.21): short-stack toolbox guest.
# Skips AGENT_TARBALL / install-agent-runtime.sh. No lanyard-agent/ tree.
# Not the live MockLab pin — do not change DAYTONA_DEFAULT_SNAPSHOT.
# lp-na7d: tool-only gate keeps stub; it is not subject to LANYARD_REQUIRE_REAL_AGENT.
# ---------------------------------------------------------------------------
FROM toolbox AS tool-only

LABEL org.opencontainers.image.title="lanyard-tool-only" \
      org.opencontainers.image.description="Short-stack tool-only Daytona guest (no lanyard-agent; lp-oop.21)" \
      lanyard.image_kind="tool-only" \
      lanyard.bead="lp-oop.21" \
      lanyard.plan="0015-short-stack" \
      lanyard.live_pin="untouched"

ENV LANYARD_IMAGE_KIND=tool-only

# Defense in depth: never ship the agent product tree on this target.
RUN rm -rf /opt/company-brain-backend/current/lanyard-agent \
 && test ! -e /opt/company-brain-backend/current/lanyard-agent \
 && test ! -e /opt/company-brain-backend/current/bin/company-brain-backend \
 && command -v git \
 && command -v python3 \
 && command -v jq \
 && command -v mount-s3

USER brain
WORKDIR /var/lib/company-brain-backend

# tini so PID 1 reaps; entrypoint mounts vault then idles for toolbox exec.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/lib/lanyard/entrypoint.sh"]
CMD ["sleep", "infinity"]

# ---------------------------------------------------------------------------
# agent-gateway: default last stage. Live guest-gateway recipe (lp-na7d).
# docker build without --target still produces today's image.
# lp-na7d: live pin must bake real lanyard-agent, not fake-gateway stub.
# When LANYARD_REQUIRE_REAL_AGENT=1 the build fails closed if no real tarball
# was baked. Publish path sets this flag; local proof may leave 0.
# ---------------------------------------------------------------------------
FROM toolbox AS agent-gateway

# Re-declare after FROM (Docker scoping). Unused by tool-only.
ARG AGENT_TARBALL=
ARG LANYARD_REQUIRE_REAL_AGENT=0

LABEL org.opencontainers.image.title="lanyard-agent-gateway" \
      org.opencontainers.image.description="Company Brain gateway guest image for Daytona (Bucket A; plan §4.3)" \
      lanyard.image_kind="agent-gateway" \
      lanyard.bead="lp-e9l"

# Stub gateway implements `company-brain-backend gateway` for local proof.
# When AGENT_TARBALL is set, the real release overwrites the install tree.
COPY --chown=brain:brain fake-gateway.sh /opt/company-brain-backend/current/bin/company-brain-backend
# MockLab default projects.db seed (lp-zuh.10.7): Workspace → /mnt/vault/Projects/Workspace
COPY --chown=root:root seed-default-projects.py /usr/local/lib/lanyard/seed-default-projects.py
# Lab-only MCP (lp-zuh.10.6): secret-free stdio echo server + kitchen-sink fragment.
# Not auto-merged into config.yaml (LA Zod residual lp-vw3). Optional wake:
#   LANYARD_ENTRY_SEED_MCP=1
COPY --chown=root:root lab-mcp/ /opt/lanyard/lab-mcp/
COPY --chown=root:root kitchen-sink-mcp.fragment.yaml /usr/local/lib/lanyard/kitchen-sink-mcp.fragment.yaml
# Optional tarball: if build-arg unset, copy a zero-byte placeholder path via
# multi-stage pattern is heavy — instead always COPY a local optional dir.
# Build context may include agent-release/*.tar.gz; install script picks it up.
COPY --chown=root:root install-agent-runtime.sh /usr/local/lib/lanyard/install-agent-runtime.sh
COPY agent-release/ /tmp/agent-tarball-stage/

RUN chmod 0755 \
      /opt/company-brain-backend/current/bin/company-brain-backend \
      /usr/local/lib/lanyard/seed-default-projects.py \
      /opt/lanyard/lab-mcp/lab_echo_server.py \
      /usr/local/lib/lanyard/install-agent-runtime.sh \
  && chmod 0644 /usr/local/lib/lanyard/kitchen-sink-mcp.fragment.yaml \
  && /usr/local/lib/lanyard/install-agent-runtime.sh \
       "${AGENT_TARBALL}" \
       /tmp/agent-tarball-stage \
       /opt/company-brain-backend/current \
  && rm -rf /tmp/agent-tarball-stage \
  && test -x /opt/company-brain-backend/current/bin/company-brain-backend \
  && /opt/company-brain-backend/current/bin/company-brain-backend version \
  && test -x /opt/lanyard/lab-mcp/lab_echo_server.py \
  && test -f /usr/local/lib/lanyard/kitchen-sink-mcp.fragment.yaml \
  && if [ "${LANYARD_REQUIRE_REAL_AGENT}" = "1" ]; then \
       echo "lp-na7d: REQUIRE_REAL_AGENT=1 — verifying real agent baked" >&2; \
       if grep -q "fake-gateway" /opt/company-brain-backend/current/bin/company-brain-backend 2>/dev/null; then \
         echo "FAIL: LANYARD_REQUIRE_REAL_AGENT=1 but image still contains fake-gateway stub (lp-na7d)" >&2; \
         echo "hint: pass AGENT_TARBALL=lanyard-agent-0.0.0-main.<sha>.tar.gz or place one tarball in agent-release/" >&2; \
         exit 1; \
       fi; \
       if [ ! -d /opt/company-brain-backend/current/lanyard-agent ]; then \
         echo "FAIL: LANYARD_REQUIRE_REAL_AGENT=1 but lanyard-agent tree missing at /opt/company-brain-backend/current/lanyard-agent (lp-na7d)" >&2; \
         exit 1; \
       fi; \
       if [ ! -f /opt/company-brain-backend/current/lanyard-agent/apps/gateway/dist/main.js ]; then \
         echo "FAIL: LANYARD_REQUIRE_REAL_AGENT=1 but gateway main.js missing (lp-na7d)" >&2; \
         exit 1; \
       fi; \
       if ! grep -q "lanyard-agent" /opt/company-brain-backend/current/bin/company-brain-backend 2>/dev/null; then \
         echo "FAIL: LANYARD_REQUIRE_REAL_AGENT=1 but gateway wrapper missing lanyard-agent reference (lp-na7d)" >&2; \
         exit 1; \
       fi; \
       echo "lp-na7d: real agent bake verified (lanyard-agent tree + wrapper)" >&2; \
     fi

USER brain
WORKDIR /var/lib/company-brain-backend

# tini so PID 1 reaps and forwards signals; entrypoint execs the gateway.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/lib/lanyard/entrypoint.sh"]
# Default: contract gateway subcommand (override with docker run … args).
CMD ["gateway"]
