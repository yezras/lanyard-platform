# `portal/` — Lanyard Web Portal (imported)

**Status:** Product tree **imported** (`lp-k7g.12.1` dry-run) under this prefix.
Final path remains `portal/` per [ADR 0004](../docs/adr/0004-monorepo-workspace-paths.md).

| Decision | Value |
| --- | --- |
| Final monorepo path | `portal/` (top-level; **pnpm workspace root**) |
| Source repository | `https://github.com/LanyardBrain/Portal.git` (**ARCHIVED**; live tree is monorepo `portal/` only) |
| Freeze SHA (pre-rewrite) | `981c727c3a2877301c5c60eb859495012a6d2dba` |
| Import method | `git filter-repo --to-subdirectory-filter portal` → merge ([ADR 0005](../docs/adr/0005-history-preserving-import-strategy.md)) |
| Import merge | `import: Portal history under portal/ (source SHA 981c727…)` |
| Workspace map | [workspace-map.md](../docs/architecture/workspace-map.md) |
| Phase plan | [phase-8-cutover.md](../docs/plans/0001-platform-monorepo-migration/phase-8-cutover.md) |
| Import runbook | [import-strategy.md](../docs/architecture/import-strategy.md) |
| Local testing | [testing.md](testing.md) (commands from this directory) |

## Monorepo commands

pnpm workspace is **rooted at `portal/`** (not the platform monorepo root). From the platform repo root:

```bash
pnpm -C portal install
pnpm -C portal build
pnpm -C portal test
pnpm -C portal --filter @lanyard/bff test
pnpm -C portal --filter @lanyard/web test
pnpm -C portal --filter @lanyard/control-plane test
pnpm -C portal --filter @lanyard/relay test
pnpm -C portal --filter @lanyard/shared test
pnpm -C portal --filter @lanyard/db exec prisma validate
# Platform phase-4 scaffolds (also under packages/*):
pnpm -C portal --filter @lanyard/backend-runtime test
pnpm -C portal --filter @lanyard/control-plane-fields test
pnpm -C portal --filter @lanyard/web-settings-schema test
pnpm -C portal --filter @lanyard/hermes-compat test
```

Equivalent: `cd portal && pnpm install && pnpm test`.

## Product packages (imported)

| Package | Path | Purpose |
| --- | --- | --- |
| `@lanyard/web` | `packages/web` | Browser UI (TanStack Start SPA) |
| `@lanyard/bff` | `packages/bff` | Portal BFF API (Cognito password → `lanyard_session`) |
| `@lanyard/db` | `packages/db` | Prisma product schema (`portal_app`) |
| `@lanyard/shared` | `packages/shared` | Shared wire types + helpers |
| `@lanyard/relay` | `packages/relay` | WebSocket relay server |
| `@lanyard/control-plane` | `packages/control-plane` | Tenants, relay registry (`portal_cp`) |

## Platform scaffolding packages (retained from phase 4)

These monorepo-owned packages pre-date the product import and remain under `packages/*`
so they join the same pnpm workspace (`pnpm-workspace.yaml` → `packages/*`):

| Package | Path | Role |
| --- | --- | --- |
| `@lanyard/backend-runtime` | `packages/backend-runtime` | `BackendRuntimeService`, Hermes adapter, Brain RPC BFF stubs, fake backend tests |
| `@lanyard/control-plane-fields` | `packages/control-plane-fields` | Backend-neutral control-plane fields / `hermes_*` aliases |
| `@lanyard/web-settings-schema` | `packages/web-settings-schema` | Pure web settings control descriptors |
| `@lanyard/hermes-compat` | `packages/hermes-compat` | Hermes deployment compatibility aliases |

Design docs: [portal-backend-runtime-service.md](../docs/architecture/portal-backend-runtime-service.md),
[portal-control-plane-backend-fields.md](../docs/architecture/portal-control-plane-backend-fields.md),
[portal-web-settings-schema.md](../docs/architecture/portal-web-settings-schema.md),
[portal-hermes-deployment-compat.md](../docs/architecture/portal-hermes-deployment-compat.md).

## History (dry-run)

| Step | Result |
| --- | --- |
| Freeze | `981c727c3a2877301c5c60eb859495012a6d2dba` (PR #43 merge on source main) |
| Rewrite | Disposable clone; `git filter-repo --to-subdirectory-filter portal` |
| Merge | `--allow-unrelated-histories`; one merge commit per product (rollback via `-m 1`) |
| Excluded | Untracked/local: `node_modules/`, `dist/`, `.env*`, `.data/`, dirty worktree caches |
| Tags | **Not** promoted as monorepo release tags (source tags remain on Portal remote) |
| Conflicts | `portal/README.md` add/add → this integrated monorepo entrypoint |

---

# Lanyard Portal (product README)

Monorepo for the Lanyard Web Portal (`https://<tenant>.withlanyard.com`).

**PRD:** [LanyardBrain/Core — `docs/prd/lanyard-web-portal.md`](https://github.com/LanyardBrain/Core/blob/main/docs/prd/lanyard-web-portal.md)  
**Doctrine:** [lanyard-portal.md](https://github.com/LanyardBrain/Core/blob/main/Business/Business%20Plan/SecondBrain/lanyard-portal.md)  
**Customer brain Terraform:** [Core `infra/portal/`](https://github.com/LanyardBrain/Core/tree/main/infra/portal)

## Docs (policies, ADRs, runbooks)

| Doc | Topic |
|-----|--------|
| [docs/README.md](docs/README.md) | Index |
| [docs/runbooks/relay-credential-lifecycle.md](docs/runbooks/relay-credential-lifecycle.md) | **G2.4** Production register / rotate / revoke (lab path labeled non-prod) |
| [docs/policies/log-retention-and-access.md](docs/policies/log-retention-and-access.md) | **G2b.1** Log retention TTL + access |
| [docs/adr/g5-bff-shared-state.md](docs/adr/g5-bff-shared-state.md) | **G5.1** BFF shared session/state store ADR |
| [docs/adr/g2a-relay-replay-resistance.md](docs/adr/g2a-relay-replay-resistance.md) | **G2a.1** Relay upgrade-token replay resistance |
| [docs/adr/g6-relay-routing-bus.md](docs/adr/g6-relay-routing-bus.md) | **G6.1** Multi-relay routing bus + shared revocation |
| [docs/image-release.md](docs/image-release.md) | G7 ECR image release / digests |

## Packages

| Package | Purpose |
|---------|---------|
| `@lanyard/web` | Browser UI — web chat (#9) |
| `@lanyard/bff` | Portal BFF API — tenant routing (#5) + auth (#6) + chat (#9) + brain RPC slice (G3.3) |
| `@lanyard/shared` | Hermes relay v1 wire types + brain RPC frames + log redaction helpers (G2b.2) + conformance tests |
| `@lanyard/relay` | WebSocket relay server (#4) + brain RPC internal hop (G3.3) |
| `@lanyard/control-plane` | Tenants, relay instance registry (#5) |
| `@lanyard/connectors` | Closed connector enums + command → action_class map (`lp-xhf4.1`) |

**Brain RPC (G3.3):** feature-flagged host ops via relay — see **[docs/brain-rpc.md](./docs/brain-rpc.md)** (`BRAIN_RPC_ENABLED`, `/api/brain/ping`, fail-closed).

## Prerequisites

- Node.js 20+ (engines: `>=22` preferred for Docker / production)
- [pnpm](https://pnpm.io/) 9+
- Docker (optional; for service images and `/health` smoke)

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

## Docker (bff / relay / control-plane)

Layout: **one Dockerfile per service** under `packages/<svc>/Dockerfile`. Build context is always the **monorepo root** so `@lanyard/shared` and the pnpm workspace resolve.

| Image tag (local) | Dockerfile | Port | Health |
|-------------------|------------|------|--------|
| `lanyard/bff:local` | `packages/bff/Dockerfile` | `4000` (`BFF_PORT`) | `GET /health` |
| `lanyard/relay:local` | `packages/relay/Dockerfile` | `8787` (`PORT` / `RELAY_PORT`) | `GET /health` |
| `lanyard/control-plane:local` | `packages/control-plane/Dockerfile` | `3100` (`CONTROL_PLANE_PORT`) | `GET /health` |

```bash
# Build all three and curl /health (must pass)
bash scripts/docker-smoke.sh

# Or build / run via compose
docker compose build
docker compose up -d
curl -sf http://127.0.0.1:4000/health
curl -sf http://127.0.0.1:8787/health
# CP is loopback-published only (G1.3) — not a public listener
curl -sf http://127.0.0.1:3100/health
```

Production topology ADR (private CP, public BFF edge): [`artifacts/portal-production-topology.md`](./artifacts/portal-production-topology.md).

Single-service example:

```bash
docker build -f packages/bff/Dockerfile -t lanyard/bff:local .
docker run --rm -p 4000:4000 lanyard/bff:local
```

**Base images:** Dockerfiles use `node:22-bookworm-slim` by tag for local/dev. That is a *build convenience*, not a production pin story.

**Production pins:** released images must be pinned by **ECR digest** (or immutable tag + digest), never `:latest` alone. Local tags like `lanyard/<svc>:local` are smoke/build artifacts only.

**Image release (ECR):** [`.github/workflows/release-images.yml`](.github/workflows/release-images.yml) builds and pushes `bff` / `relay` / `control-plane` on release tags (`v*`), assumes the portal OIDC publisher role, and uploads `portal-image-digests-<version>.json` for company-brain-deploy compatibility pins. Operator setup and pin copy steps: **[docs/image-release.md](docs/image-release.md)**.

**Staging proofs (G1.4 / G3.4):** private control-plane + brain RPC E2E harnesses fail closed without staging env. Operator checklists and LOCAL partial evidence: **[docs/staging-proofs.md](docs/staging-proofs.md)**. Topology ADR: **[artifacts/portal-production-topology.md](artifacts/portal-production-topology.md)**.

```bash
pnpm proof:local-topology          # LOCAL only — partial G1 topology
pnpm proof:staging-g1              # exit 2 without STAGING_* (fail closed)
pnpm proof:staging-g3              # exit 2 without STAGING_* (fail closed)
```
**Log redaction (G2b.2):** shared sinks never get vault/chat body dumps by default. Structured logger + audit metadata redaction live in `@lanyard/shared`. Operator debug payloads are gated by `PORTAL_DEBUG_PAYLOADS` (off by default). See **[docs/policies/log-redaction.md](docs/policies/log-redaction.md)**.

Required repository variables: `AWS_ROLE_ARN`, `AWS_REGION`, `ECR_NAME_PREFIX` (no hard-coded account IDs; registry comes from `amazon-ecr-login`).

**control-plane Postgres (G4.1):** set `CONTROL_PLANE_DATABASE_URL` or `DATABASE_URL` (`postgres://…`). Local: `docker compose up -d postgres` (user/password/db `portal`/`portal`/`portal_cp`). Cloud: inject the URL from the secret store — GitHub Secrets names `DATABASE_URL` / `CONTROL_PLANE_DATABASE_URL` (never commit credentials). SQLite `CONTROL_PLANE_DB_PATH` is removed.

**DB-backed integration tests (`lp-p37.2`):** one command starts lab Postgres if needed and runs control-plane + BFF suites (auth/RBAC/tenant isolation/settings/vault/projects/session-share):

```bash
pnpm test:db-integration                 # from portal/
pnpm -C portal test:db-integration       # from monorepo root
pnpm test:db-integration:security        # security-audit subset + pass/fail summary
```

See **[testing.md § DB-backed integration suites](testing.md#db-backed-integration-suites-lpp372)** for disposable DB mode, cleanup, and evidence output.

**Data migration (G4.2):** one-shot SQLite→Postgres copy, backups, and rollback: **[docs/control-plane-db-migration.md](docs/control-plane-db-migration.md)** (`pnpm migrate:sqlite-to-postgres`, `pnpm test:migrate-sqlite-to-postgres`).

**web:** the SPA is **not** a required runtime container. Production ships a static tarball to S3 (`portal-web/`), not a web ECR image. `.dockerignore` keeps web sources out of the backend build context while leaving `packages/web/package.json` so the workspace stays valid. The ECR image-release workflow does **not** push a web container.

### Static web release (`@lanyard/web` → S3 `portal-web/`)

Canonical docs: [`packages/web/RELEASE.md`](./packages/web/RELEASE.md).

| Contract field | Value |
|----------------|--------|
| Prefix | `portal-web/` |
| Object | `portal-web/<version>/portal-web.tar.gz` |
| Pins | `portal.web.version`, `portal.web.sha256`, `portal.web.url` |

Versions must be **immutable labels** (e.g. `v0.1.0`) — never `main` / `master` / `HEAD` / `latest`.

```bash
# Local pack (no AWS) — builds TanStack Start SPA (`dist/client`) and writes tarball + SHA-256
./scripts/pack-web.sh --version v0.0.0-test
# → dist/portal-web/portal-web-v0.0.0-test.tar.gz
# → dist/portal-web/portal-web-v0.0.0-test.tar.gz.sha256
```

Publish workflow: [`.github/workflows/release-static-web.yml`](./.github/workflows/release-static-web.yml) (tag `v*` / GitHub Release / `workflow_dispatch`). Uses OIDC (`AWS_ROLE_ARN`, `ARTIFACT_BUCKET`, `AWS_REGION`) to upload under `portal-web/<version>/`. Backend image digests remain separate (`portal.images.*`).

## Development

**All services in tmux (recommended)**

```bash
pnpm install
pnpm dev:tmux             # 4-pane stack; seeds demo tenant; opens UI hints
```

Re-attach later: `tmux attach -t lanyard-portal`. Control-plane data lives in local Postgres (`docker compose` service `postgres`, volume `portal-pg-data`).

**Kill/restart, seed IDs, register + role assignment:** `testing.md`.

```bash
pnpm dev:web              # http://localhost:3010
pnpm dev:bff              # http://localhost:4000
pnpm dev:relay            # ws://localhost:8787/relay
pnpm dev:control-plane    # http://127.0.0.1:3100
```

### BFF tenant host routing (local)

Production URLs are `https://<tenant>.withlanyard.com`. The BFF resolves the tenant from the HTTP `Host` header and attaches `tenant_id` to all `/api/*` routes.

**Option A — localhost bypass (simplest)**

1. Start control plane and create a tenant: `POST http://127.0.0.1:3100/tenants` with `{ "slug": "demo", "display_name": "Demo" }`.
2. Run BFF with the slug pinned:

```bash
DEV_TENANT_SLUG=demo CONTROL_PLANE_URL=http://127.0.0.1:3100 pnpm dev:bff
```

3. Call APIs on `http://localhost:4000` (Host is `localhost`, so `DEV_TENANT_SLUG` is used):

```bash
curl http://localhost:4000/api/context
```

**Option B — hosts file (closer to production)**

Add to `/etc/hosts`:

```
127.0.0.1 demo.withlanyard.com
```

Then:

```bash
CONTROL_PLANE_URL=http://127.0.0.1:3100 pnpm dev:bff
curl -H 'Host: demo.withlanyard.com' http://127.0.0.1:4000/api/context
```

**Option C — `slug.localhost`**

Some browsers resolve `demo.localhost` to loopback without `/etc/hosts`:

```bash
curl http://demo.localhost:4000/api/context
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `BFF_PORT` | `4000` | BFF listen port |
| `CONTROL_PLANE_URL` | `http://127.0.0.1:3100` | Tenant slug → `tenant_id` lookup |
| `DEV_TENANT_SLUG` | _(unset)_ | Tenant slug when Host is `localhost` / `127.0.0.1` |

Unknown subdomains return `404` JSON: `{ "error": "Unknown tenant subdomain: …" }`.

### BFF auth (#8)

Auth routes run **after** tenant middleware. Sessions are bound to the resolved `tenant_id`; switching the `Host` header to another tenant invalidates the session for `/api/auth/me`.

```bash
# CSRF token (required for POST mutations)
curl -c cookies.txt http://demo.localhost:4000/api/auth/csrf

# Register (include CSRF header + cookie)
curl -b cookies.txt -c cookies.txt \
  -H 'X-CSRF-Token: <csrf_from_cookie>' \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"password123"}' \
  http://demo.localhost:4000/api/auth/register

# Current user
curl -b cookies.txt http://demo.localhost:4000/api/auth/me
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `SESSION_SECRET` | dev placeholder | Signs OAuth state |
| `GOOGLE_CLIENT_ID` | _(unset)_ | Enables `GET /api/auth/google` and `GET /api/admin/auth/google` redirect |
| `GOOGLE_CLIENT_SECRET` | _(unset)_ | Ops Google code exchange on BFF (`/api/admin/auth/google/callback`). Secret store / ECS secrets map only — never commit |
| `GOOGLE_REDIRECT_PATH` | `/api/auth/google/callback` | Tenant OAuth callback path |
| `PLATFORM_OPERATOR_EMAILS` | _(unset)_ | Closed ops allowlist (comma-separated). Empty is fail-closed. Required to mint `lanyard_ops_session` |
| `CONTROL_PLANE_SERVICE_TOKEN` | `placeholder-control-plane-service-token` | **G1.2** BFF↔CP service credential (`x-control-plane-service-token`). Production rejects the dev placeholder |
| `CONTROL_PLANE_INTERNAL_TOKEN` / `INTERNAL_OPS_TOKEN` | _(unset)_ | Optional elevated ops header for CP ops routes |
| `NODE_ENV=production` | — | Sets `Secure` on session cookies; requires non-dev `CONTROL_PLANE_SERVICE_TOKEN` |
| `BFF_SESSION_BACKEND` | `memory` | **G5.2** Session store: `memory` (lab / desired count = 1) or `redis` (shared; required when multi-task) |
| `REDIS_URL` | _(unset)_ | **G5.2** Redis/Valkey URL (`redis://` or `rediss://` + auth). **GitHub Secret / SSM only — never commit.** Required when `BFF_SESSION_BACKEND=redis` |
| `BFF_MULTI_INSTANCE` | _(unset)_ | **G5.2** When `true`/`1`, startup fail-closed unless backend is `redis` + `REDIS_URL` |
| `SESSION_TTL_SECONDS` | `604800` (7d) | Sliding session TTL (Redis `EXPIRE` refresh on read) |
| `SESSION_MAX_AGE_SECONDS` | `2592000` (30d) | Absolute max age from `createdAt` |

**G5 shared sessions:** BFF `desired count > 1` requires `BFF_SESSION_BACKEND=redis` and a real `REDIS_URL` (ElastiCache Redis/Valkey). Keys: `bff:v1:sess:{sessionId}` (tenant) and `bff:v1:ops-sess:{sessionId}` (ops). Liveness is `GET /health` (no Redis dependency); readiness is `GET /ready` (PINGs Redis when backend is redis). Redis unreachable → authenticated routes fail closed (401), never fall back to a process-local map. Dual-instance sticky-less coverage lives in `packages/bff/test/dual-instance-session.integration.test.ts` (uses `ioredis-mock` in CI; optional real Redis via `REDIS_URL`). **Deploy residual (`lp-t7q.8`):** pilot/mocklab often leave Valkey **off** (single-task memory sessions); Valkey module is **infra_ready** only — not production certification. Live dual-BFF staging proof is **deferred** with reason in `deploy/references/runbooks/portal-valkey-g5-enable.md`; enable path and matrix honesty live there.

Relay validates gateway secrets via control plane `POST /internal/instances/validate` (see `packages/control-plane/README.md`).

### Multi-relay routing bus (G6.2)

Default relay is **single-node** (process-local session map). For `desired count > 1`, set:

| Variable | Purpose |
|----------|---------|
| `RELAY_CLUSTER_MODE=bus` | Redis owner lease + pub/sub deliver/interrupt/revoke |
| `REDIS_URL` | ElastiCache URL (**secret name only** — never commit values) |
| `RELAY_ADVERTISE_URL` | Internal base URL for chat SSE/history stickiness |

See [`packages/relay/README.md`](./packages/relay/README.md) for key layout, `/ready` fail-closed rules, and owner lookup.

### Web chat E2E (#9)

Logged-in users send messages through the BFF → relay `POST /internal/deliver-inbound` → customer Hermes gateway WebSocket. Gateway replies (`send` / `edit` outbound ops) publish to `ChatDeliveryHub` and stream to the browser via BFF SSE.

**Local stack**

```bash
# Terminal 1 — control plane
pnpm dev:control-plane

# Terminal 2 — relay (share internal token with BFF)
RELAY_INTERNAL_TOKEN=placeholder-relay-internal-token pnpm dev:relay

# Terminal 3 — BFF
RELAY_URL=http://127.0.0.1:8787 RELAY_INTERNAL_TOKEN=placeholder-relay-internal-token \
  DEV_TENANT_SLUG=demo CONTROL_PLANE_URL=http://127.0.0.1:3100 pnpm dev:bff

# Terminal 4 — web (proxies /api → BFF)
pnpm dev:web
```

Create tenant + gateway instance, then open `http://demo.localhost:3010` (or hosts entry for `demo.withlanyard.com`).

**Tool progress + vault citations (Hermes-first)**

**Production / local real brain = Hermes only.** Do not run mock alongside Hermes on the same relay `instanceId` (last connect wins). Switch with:

```bash
./scripts/portal-gateway-mode.sh hermes   # real brain
./scripts/portal-gateway-mode.sh status
```

Canonical Hermes → Portal wire contract (structured `tool_progress`, final `metadata.citations`, phases, path projection):

**[`artifacts/hermes-lanyard-tool-citations-contract.md`](./artifacts/hermes-lanyard-tool-citations-contract.md)**

ChatToolCalls lifecycle, status aliases, context-gathering collapse, and residual host dual-emit requirements (`lp-dpr.3`):

**[`../docs/architecture/portal-chat-tool-events.md`](../docs/architecture/portal-chat-tool-events.md)**

Agents surface tool work as durable Astryx `ChatToolCalls` via:

1. **Outbound metadata (preferred / Hermes SoT):** `metadata.portal_event: "tool_progress"` plus `tool_name`, `tool_call_id`, `tool_status`, `tool_target`, optional `duration` / `result` (expandable CodeBlock), `additions`/`deletions`, `node` on a `send`/`edit` outbound action.
2. **Content prefix:** `content` starting with `🔧 tool: <label>`.
3. **Hermes chrome (degraded fallback):** pure emoji tool lines (e.g. `🔍 Searching…`) when not mixed with prose — weaker names/targets; multi-line often keeps only the last tool.

The relay normalizes these into SSE `tool_progress` events.

**Vault citations:** on the final answer `send`, attach:

```json
"metadata": {
  "citations": [
    { "path": "/Projects/README.md", "title": "README.md" }
  ]
}
```

Optional: put `[1]` markers in the answer body for inline Astryx Markdown citation chips. If citations metadata is omitted, the web client also promotes **file-like** `tool_target` paths from the same turn into citation chips. Paths must be vault-absolute (`/…`) openable by the Vault API.

**Mock gateway (optional UI demo only):** `pnpm dev:mock-gateway` / `./scripts/portal-gateway-mode.sh mock` emits a canned `tool_progress` + citations sequence without Hermes. Not required for Hermes-only or production.

**MCQ bubbles convention (#16)**

Agents can present multiple-choice prompts; the portal renders tap targets and posts a normalized inbound event when the user selects one.

**Outbound (gateway → portal)** — on a `send` outbound action:

```json
{
  "op": "send",
  "chat_id": "<thread_id>",
  "content": "Which department should own this?",
  "metadata": {
    "portal_event": "mcq",
    "mcq_id": "dept-pick-001",
    "choices": [
      { "id": "sales", "label": "Sales" },
      { "id": "ops", "label": "Operations" }
    ]
  }
}
```

- `metadata.portal_event` must be `"mcq"`.
- `metadata.mcq_id` — stable id for correlating the user's tap (required).
- `metadata.choices` — 2–8 objects with `id` and `label` (required).
- `content` (or optional `metadata.prompt`) — bubble header text.

`WebPlatformAdapter` publishes SSE `mcq` events with `mcq_id`, `choices`, and `content`.

**Inbound (portal → gateway)** — when the user taps a choice, the BFF delivers:

```json
{
  "text": "Sales",
  "message_type": "mcq_selection",
  "reply_to_message_id": "<prompt message_id when known>",
  "metadata": {
    "portal_inbound": "mcq_selection",
    "mcq_id": "dept-pick-001",
    "choice_id": "sales",
    "choice_label": "Sales"
  },
  "source": { "...": "SessionSource per §3" }
}
```

Portal POST body (BFF): `POST /api/chat/threads/:threadId/messages` with `{ "mcq_selection": { "mcq_id", "choice_id", "label", "prompt_message_id?" } }`.

Agents/skills should treat `message_type: "mcq_selection"` and `metadata.portal_inbound === "mcq_selection"` as the structured signal; `text` / `choice_label` carry the human-readable label.

### Projects and vault folder binding (#11)

**Hermes is source of truth for chat Directory / agent working directories** (portal-e5k.3).

- Hermes DB (host): `$HERMES_HOME/projects.db` (default `~/.hermes/projects.db`)
- BFF: `GET/POST /api/hermes/projects` → `{ projects: HermesProject[] }` with absolute `primary_path` + `folders[]`
- **Production** (`BRAIN_RPC_ENABLED=1`): list/create via Brain RPC (`projects.list` / capability-gated `projects.create`) on the customer host — not BFF-local `projects.db` / CLI
- **Local/dev** (flag off): list may read local `projects.db`; create shells Hermes when available
  - Set `HERMES_BIN` to the binary (e.g. `/opt/hermes-lanyard/bin/hermes`) or put `hermes` on `PATH`
  - Well-known fallbacks: `/opt/hermes-lanyard/bin/hermes`, `/opt/company-brain/hermes-lanyard/bin/hermes`
  - Do **not** expect cloud BFF to run `hermes project create` against customer-host paths
- Chat Directory lists Hermes projects by **name**; selection binds threads to `primary_path`
- `POST /api/chat/threads` accepts Hermes `project_id`; inject sets `SessionSource.chat_topic` to absolute `primary_path`

**Lanyard Hermes fork + weekly upstream sync** (epic `portal-emr`): agent source is the fork [`LanyardBrain/hermes-agent`](https://github.com/LanyardBrain/hermes-agent) on branch `lanyard/portal-integration` (not a dirty Nous checkout). Self-hosted runner label `hermes-sync` rebases onto Nous `main` weekly. Canonical ops plan/runbook: [`artifacts/hermes-lanyard-fork-sync-plan.md`](./artifacts/hermes-lanyard-fork-sync-plan.md). Fork/remotes/sync touch only `~/.hermes/hermes-agent/` git state — never `HERMES_HOME` cron/skills/MCP/config/projects.

Control plane still stores optional **projects** / **subprojects** with `vault_path` (ACL vault records) via `GET/POST /api/projects` — not used as SoT for chat Directory.

### RBAC and Hermes profiles (#10)

Control plane stores **roles** (`hermes_profile` + `path_prefixes`) and assigns them to portal users. The BFF fails closed: chat inject and vault APIs require a mapped profile.

- Ops: `POST /tenants/:id/roles`, `PUT /tenants/:id/users/:userId/roles`
- BFF vault browser (#12): `GET /api/vault/tree`, `GET /api/vault/entries?path=...`, `GET /api/vault/content?path=...` (ACL via `isVaultPathAllowed`; CI uses fixture provider)
- Relay chat inject sets `SessionSource.profile` from the user's role

Customer runbook: [Core `infra/portal/hermes-profile-rbac.md`](https://github.com/LanyardBrain/Core/blob/main/infra/portal/hermes-profile-rbac.md).

| Variable | Default | Purpose |
|----------|---------|---------|
| `RELAY_URL` | `http://127.0.0.1:8787` | BFF → relay HTTP boundary |
| `RELAY_INTERNAL_TOKEN` | `placeholder-relay-internal-token` | Protects relay `/internal/*` routes |

### Backend retention policy (#19)

Per [Company-Brain-Security-Guardrails §6b](https://github.com/LanyardBrain/Core/blob/main/Business/Business%20Plan/SecondBrain/References/Company-Brain-Security-Guardrails.md): **no long-term retention of message bodies at Lanyard by default**. Optional interaction export is **Lanyard ops–controlled in the backend** — there is **no portal UI toggle** for tenants or end users.

**Defaults**

- New tenants: `interaction_export_enabled: false`, `retention_mode: "none"`.
- Relay `shouldPersistInteraction()` returns `false` unless ops has enabled export for that tenant.
- Audit log records metadata only (`tenant.retention_updated`); never message bodies.

**Internal ops API** (requires `x-internal-ops-token` = `INTERNAL_OPS_TOKEN`)

```bash
# Read policy
curl -H "x-internal-ops-token: $INTERNAL_OPS_TOKEN" \
  http://127.0.0.1:3100/internal/tenants/<tenant_id>/retention

# Enable export pipeline for a tenant (metadata-only jobs; no user toggle)
curl -X PATCH -H "x-internal-ops-token: $INTERNAL_OPS_TOKEN" \
  -H "content-type: application/json" \
  -H "x-lanyard-actor: lanyard-ops" \
  -d '{"interaction_export_enabled":true,"retention_mode":"interaction_export"}' \
  http://127.0.0.1:3100/internal/tenants/<tenant_id>/retention
```

**Relay hook**

On each inbound chat delivery, relay calls `shouldPersistInteraction(tenantId)` (read-only). When export is off, the future export job is a no-op. When enabled, a metadata-only export job may be enqueued — message bodies are never written to long-term Lanyard stores from this path.

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONTROL_PLANE_AUTH_MODE` | `development` (`production` if `NODE_ENV=production`) | G1.1: production fail-closed CP access |
| `CONTROL_PLANE_SERVICE_TOKEN` | _(required in production)_ | **G1.2** service credential; same value on BFF + CP (GitHub Secret / SSM name only in docs) |
| `INTERNAL_OPS_TOKEN` | _(unset)_ | Elevated ops for retention/relay-tier; alt production credential for operators |
| `GOOGLE_CLIENT_ID` | _(unset)_ | OIDC audience for Google ID token verification on CP |
| `GOOGLE_CLIENT_SECRET` | _(unset)_ | Google code exchange (secret store only — never commit) |
| `CONTROL_PLANE_URL` | `http://127.0.0.1:3100` | Relay → control plane retention lookup |
| `RELAY_INTERACTION_EXPORT_DEFAULT` | `false` | Fallback when control plane is unreachable |

**Production topology (G1.3):** control plane is **private-only** — never on a public ALB. See [`artifacts/portal-production-topology.md`](./artifacts/portal-production-topology.md).

### Manual E2E with real EC2 Hermes

Use a demo tenant and one test EC2 brain imaged per [Core `infra/portal/INDEX.md`](https://github.com/LanyardBrain/Core/blob/main/infra/portal/INDEX.md). **Do not commit secrets.**

1. **Provision portal tenant** — `POST /tenants` on control plane with `{ "slug": "demo", "display_name": "Demo" }`; note `tenant_id`.
2. **Provision gateway instance** — `POST /tenants/:tenant_id/instances/provision`; save `instance_id` and `secret` in your password manager (not in git).
3. **Apply customer Terraform** — from [Core `infra/portal/customer-gateway-relay/`](https://github.com/LanyardBrain/Core/tree/main/infra/portal/customer-gateway-relay), set relay URL to your staging relay (`wss://<relay-host>/relay`) and inject the provisioned secret into the EC2 Hermes env template.
4. **Confirm gateway connected** — Hermes gateway process running on EC2; relay logs show WebSocket handshake with `lanyard_web` descriptor; `GET /health` on relay returns ok.
5. **Portal user** — register/login on `https://demo.withlanyard.com` (or local hosts equivalent).
6. **Send chat** — open web chat, send “hello brain”; verify inbound reaches Hermes session and streaming markdown reply appears in the UI.
7. **Tool progress / citations (Hermes)** — with Hermes exclusive (`./scripts/portal-gateway-mode.sh hermes`), run a skill that uses tools; confirm Astryx `ChatToolCalls` rows (structured metadata preferred; see `artifacts/hermes-lanyard-tool-citations-contract.md`). Optional mock-only demo: `portal-gateway-mode.sh mock`.

## Relay contract

Types and tests: `@lanyard/shared` — https://github.com/NousResearch/hermes-agent/blob/main/docs/relay-connector-contract.md