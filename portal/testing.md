# Portal local testing

How to run the full dev stack in **tmux**, seed demo tenant IDs, and verify chat/RBAC before manual UI testing.

**Monorepo path:** this file lives at `portal/testing.md` after the platform import
(`lp-k7g.12.1`). The pnpm workspace root is **`portal/`**, not the platform monorepo root.

**See also:** `README.md` (package overview + monorepo command table), [Core PRD](https://github.com/LanyardBrain/Core/blob/main/docs/prd/lanyard-web-portal.md) (product scope), [Astryx frontend migration plan](artifacts/astryx-frontend-migration-plan.md) (React UI epic + locked dev-auth decisions), **[docs/staging-proofs.md](docs/staging-proofs.md)** (G1.4 / G3.4 staging harnesses — fail closed without `STAGING_*` env; local topology partial evidence only).

## Monorepo path mapping (platform repo → portal workspace)

Commands below that say `pnpm …` assume the **portal workspace root** (`portal/`).
From the **platform monorepo root**, prefix with `pnpm -C portal` (or `cd portal` first).

| Intent | From `portal/` (imported layout) | From platform monorepo root |
| --- | --- | --- |
| Install | `pnpm install` | `pnpm -C portal install` |
| Build all packages | `pnpm build` | `pnpm -C portal build` |
| Test all packages | `pnpm test` | `pnpm -C portal test` |
| Test one package | `pnpm --filter @lanyard/bff test` | `pnpm -C portal --filter @lanyard/bff test` |
| Product packages | `@lanyard/{bff,web,relay,control-plane,shared}` | same filter names |
| Phase-4 scaffolds | `@lanyard/{backend-runtime,control-plane-fields,web-settings-schema,hermes-compat}` | same filter names |
| Dev stack (tmux) | `pnpm dev:tmux` | `pnpm -C portal dev:tmux` |
| Scripts under `scripts/` | `./scripts/…` or `bash scripts/…` | `bash portal/scripts/…` |
| Package sources / tests | `packages/<name>/…` | `portal/packages/<name>/…` |

Scaffold packages still support offline per-package checks without the full portal
install graph (useful when product deps are not installed yet):

```bash
# From platform monorepo root — each scaffold has its own package-lock + vitest
(cd portal/packages/backend-runtime && npm test)
(cd portal/packages/control-plane-fields && npm test)
(cd portal/packages/web-settings-schema && npm test)
(cd portal/packages/hermes-compat && npm test)
```

### Dry-run validation notes (`lp-k7g.12.1`)

| Check | Result / requirement |
| --- | --- |
| Workspace discovery | `pnpm -C portal list -r --depth -1` lists **10** projects (5 product + 4 phase-4 scaffolds + root) |
| Install | `pnpm -C portal install` (lockfile includes scaffold importers after import) |
| Unit tests (no Postgres) | After `pnpm -C portal build` (or at least `@lanyard/shared` build): `pnpm -C portal --filter @lanyard/{shared,web,backend-runtime,control-plane-fields,web-settings-schema,hermes-compat,relay} test` |
| Control-plane / BFF DB-backed integration | **One command:** `pnpm -C portal test:db-integration` (starts compose postgres if needed; see [DB-backed integration suites](#db-backed-integration-suites-lpp372)) |
| Full recursive test | Prefer `pnpm -C portal build && pnpm -C portal test` with Postgres available for CP integration suites |
| Relay package `tsc` | Source freeze may fail `packages/relay` `build` if `createRelayClusterFromEnv` is only re-exported (not value-imported) in `src/index.ts` — pre-existing product issue; unit/integration vitest still passes after shared build |

## Prerequisites

- **Node.js 22+**, pnpm 9+ (monorepo target per migration plan; required for `@lanyard/web` Astryx tooling after Phase 0)
- `tmux`
- From **portal workspace root** (`portal/`): `pnpm install && pnpm build` (first time or after dependency changes)
  - Platform monorepo equivalent: `pnpm -C portal install && pnpm -C portal build`

## Kill and restart (clean tmux session)

Use this when services are stuck, ports are in use, or you want a fresh stack after changing control-plane data.

```bash
# Stop the dev session (all windows: control-plane, relay, mock-gateway, bff, web)
tmux kill-session -t lanyard-portal 2>/dev/null || true

# Start again: control-plane first, then seed, then relay / bff / web
pnpm dev:tmux
```

**Non-interactive start** (e.g. from automation or when you should not attach to tmux):

```bash
PORTAL_TMUX_NO_ATTACH=1 pnpm dev:tmux
tmux attach -t lanyard-portal   # when you want the panes
```

Session name defaults to `lanyard-portal` (`PORTAL_TMUX_SESSION` overrides).

## What `pnpm dev:tmux` does

Implemented in `scripts/dev-tmux.sh`:

1. Creates tmux session `lanyard-portal` if it does not exist (otherwise attaches to the existing session).
2. Window **control-plane** — Postgres via `CONTROL_PLANE_DATABASE_URL` (default `postgres://portal:portal@127.0.0.1:5432/portal_cp`; start with `docker compose up -d postgres`). Starts with **`CONTROL_PLANE_SERVICE_TOKEN`** (default local placeholder `placeholder-control-plane-service-token`) so G1.2 fail-closed development accepts BFF/seed service calls without setting `CONTROL_PLANE_DEV_OPEN`.
3. Waits until `GET http://127.0.0.1:3100/health` succeeds.
4. Runs **`scripts/seed-demo-tenant.sh`** (idempotent; presents `x-control-plane-service-token` matching the CP token).
5. Runs **`scripts/assign-demo-member-roles.sh`** (all users on demo tenant → `member` role; same service token header).
6. Windows **relay**, **mock-gateway**, **bff**, **web** — all source `.data/demo-env.sh` when present (includes `CONTROL_PLANE_SERVICE_TOKEN` for BFF; web needs `VITE_ONLYOFFICE_*` at Vite process start for OnlyOffice **Edit**; default open is still client preview).

**G1.2 local service token:** `dev-tmux` and `docker compose` use the documented placeholder `placeholder-control-plane-service-token` (never for production). Override with `CONTROL_PLANE_SERVICE_TOKEN=…` before `pnpm dev:tmux` if you need a custom local value — set the same value on CP, seed, and BFF (seed writes it into `.data/demo-env.sh`).

**Local chat requires `mock-gateway`** — without a WebSocket brain connected to relay, sends fail with `Gateway not connected or handshake incomplete`. The mock window echoes replies for UI testing; production uses a real Hermes gateway on EC2.

Detach: `Ctrl-b d`. Re-attach: `tmux attach -t lanyard-portal`. Cycle windows: `Ctrl-b n` / `Ctrl-b p`.

## Seeding demo IDs

`scripts/seed-demo-tenant.sh` talks to the control plane and writes **`.data/demo-env.sh`** (and `last-relay-secret.txt` when a secret is known) with **owner-only permissions** (`chmod 600`; `.data/` is `700`).

| Output / env var | Purpose |
|------------------|---------|
| `PORTAL_DEMO_TENANT_ID` | Demo tenant UUID (`slug=demo`) |
| `PORTAL_DEMO_MEMBER_ROLE_ID` | `member` role with `hermes_profile: default`, `path_prefixes: ["/"]` |
| `RELAY_DEV_SECRETS` | JSON array for relay dev auth (new gateway instance secret on first provision) |
| `DEV_TENANT_SLUG` | `demo` — BFF localhost bypass |
| `CONTROL_PLANE_URL`, `RELAY_URL`, `RELAY_INTERNAL_TOKEN` | Wired for relay + BFF windows |
| `CONTROL_PLANE_SERVICE_TOKEN` | G1.2 BFF↔CP service credential (default `placeholder-control-plane-service-token`; must match CP process env) |
| `VITE_ONLYOFFICE_EDITOR`, `VITE_ONLYOFFICE_DS_URL` | Lab OnlyOffice **Edit** (lp-upc). Sourced by `pnpm dev:web` / dev-tmux web. Default **open** remains VaultReader client preview; Edit needs flag + DS + `ui.can.vault_edit`. |

Re-run seed anytime control plane is up (safe to repeat). Seed always sends `x-control-plane-service-token` (defaults to the local placeholder when unset):

```bash
CONTROL_PLANE_URL=http://127.0.0.1:3100 ./scripts/seed-demo-tenant.sh
# If CP was started with a non-default token:
# CONTROL_PLANE_SERVICE_TOKEN=… CONTROL_PLANE_URL=http://127.0.0.1:3100 ./scripts/seed-demo-tenant.sh
```

If a gateway instance already exists, relay may need the last provisioned secret from `.data/last-relay-secret.txt` (seed restores `RELAY_DEV_SECRETS` when that file exists).

**Secret hygiene:** keep relay env, last-relay-secret, mocklab env (`.env.mocklab*`), and Playwright auth state (`artifacts/ui/.auth/*`) at `chmod 600`. Fix/audit:

```bash
bash scripts/secure-local-secrets.sh
bash scripts/secure-local-secrets.sh --check
```

See monorepo [docs/runbooks/local-secret-hygiene.md](../docs/runbooks/local-secret-hygiene.md).

## UI URL

- **Preferred:** http://demo.localhost:3010  
- **Fallback:** http://localhost:3010 with `DEV_TENANT_SLUG=demo` (set in `demo-env.sh` for BFF when using tmux)

BFF: http://127.0.0.1:4000 · Relay: ws://127.0.0.1:8787/relay · Control plane: http://127.0.0.1:3100

## Seeded dev user (local only)

**Canonical credentials** for manual UI testing (documented here only — **not** for production):

| Field | Value |
|-------|--------|
| Email | `dev@demo.local` |
| Password | `local-dev-password` |

**Platform admin (`/admin`) local stub:** BFF in local dev (`DEV_TENANT_SLUG` set) allowlists these operator emails when `PLATFORM_OPERATOR_EMAILS` is unset. Open `http://localhost:3010/admin` and sign in with any of:

| Email |
|-------|
| `dev@demo.local` |
| `ops@lanyard.local` |
| `agent-dev@mocklab.example.com` |

`scripts/seed-demo-tenant.sh` creates this user on the demo tenant with the **`member`** role already assigned. Re-run seed anytime to restore credentials or role assignment.

**Fallback:** create an account with [Register via API](#register-via-api-curl-only) — in local dev (`DEV_TENANT_SLUG=demo`), BFF auto-assigns `member`; otherwise run `./scripts/assign-demo-member-roles.sh`.

## Sign in (web UI)

**Target (Astryx Auth, bead #4):** **Login-only** — email/password with the [seeded dev user](#seeded-dev-user-local-only). No in-app registration.

**Google (local dev):**

- With **`GOOGLE_CLIENT_ID`** (and secret) on BFF/control plane: use **Sign in with Google** → `GET /api/auth/google`.
- Without OAuth config: use **Sign in with Google (dev stub)** on the login screen (local dev only). Stub identity:

  | Field | Value |
  |-------|--------|
  | `email` | `dev-google-stub@demo.local` |
  | `google_sub` | `dev-google-stub` |

  (UI calls `POST /api/auth/google/stub` with CSRF; same values work in curl — see [Google stub via curl](#google-stub-via-curl).)

**Interim (vanilla `main.ts` until React cutover):** the legacy UI may still use **register-on-401** on first form submit. Prefer the seeded user or curl register below for parity with the migration plan.

## Hermes profile (required for chat threads)

RBAC is **fail closed**: without a role assignment, `/api/context` has no `hermes_profile` and creating chat threads returns **403**.

Demo `member` maps to **`hermes_profile: "default"`** and vault prefix **`/`**.

`pnpm dev:tmux` runs **`assign-demo-member-roles.sh`** after seed so existing users get `member`. New registrations on the demo tenant in local dev (`DEV_TENANT_SLUG=demo`) auto-assign `member` via BFF. For users created before auto-assign, or when BFF lacks `DEV_TENANT_SLUG`, run assign again after [curl register](#register-via-api-curl-only):

```bash
./scripts/assign-demo-member-roles.sh
```

Manual assign (replace `<USER_ID>`):

```bash
source .data/demo-env.sh
curl -X PUT "http://127.0.0.1:3100/tenants/$PORTAL_DEMO_TENANT_ID/users/<USER_ID>/roles" \
  -H 'content-type: application/json' \
  -d "{\"role_ids\":[\"$PORTAL_DEMO_MEMBER_ROLE_ID\"]}"
```

Confirm when logged in: `GET /api/context` → `hermes_profile: "default"`, then create a thread and send a message.

**Note:** BFF `ChatThreadStore` is in-memory by default (restarting the **bff** tmux window clears threads). Set `CHAT_STORE_PATH` (e.g. `.data/chat.db`) to persist threads + history across BFF restarts via SQLite (`node:sqlite`). That path stores **message bodies** on the BFF host (cleartext SQLite, owner-only `0600` — not app-level encryption); relay history remains process-lifetime. Cap is 2000 events/thread (not a time TTL). Interaction export to long-term Lanyard stores stays **off** by default and is metadata-only when ops-enabled. Details: [docs/runbooks/local-secret-hygiene.md](../docs/runbooks/local-secret-hygiene.md).

## Register via API (curl only)

The React portal does **not** expose registration. For extra local users:

```bash
source .data/demo-env.sh

# CSRF + session cookie
curl -s -c /tmp/portal-cookies.txt -b /tmp/portal-cookies.txt \
  http://demo.localhost:4000/api/auth/csrf >/dev/null
CSRF=$(grep lanyard_csrf /tmp/portal-cookies.txt | awk '{print $7}')

curl -s -b /tmp/portal-cookies.txt -c /tmp/portal-cookies.txt \
  -X POST http://demo.localhost:4000/api/auth/register \
  -H "content-type: application/json" \
  -H "x-csrf-token: $CSRF" \
  -d '{"email":"you@example.com","password":"your-password-here"}'
```

With `DEV_TENANT_SLUG=demo` on BFF (from `demo-env.sh`), `member` is assigned automatically. Otherwise run `./scripts/assign-demo-member-roles.sh`.

## Google stub via curl

Local dev only; production must not expose stub sign-in.

```bash
source .data/demo-env.sh

curl -s -c /tmp/portal-cookies.txt -b /tmp/portal-cookies.txt \
  http://demo.localhost:4000/api/auth/csrf >/dev/null
CSRF=$(grep lanyard_csrf /tmp/portal-cookies.txt | awk '{print $7}')

curl -s -b /tmp/portal-cookies.txt -c /tmp/portal-cookies.txt \
  -X POST http://demo.localhost:4000/api/auth/google/stub \
  -H "content-type: application/json" \
  -H "x-csrf-token: $CSRF" \
  -d '{"email":"dev-google-stub@demo.local","google_sub":"dev-google-stub"}'
```

## Hermes-only tools + citations (recommended)

**Preferred local + production brain is Hermes.** Mock is optional for UI demos without a real agent.

Canonical wire contract (structured `tool_progress`, `metadata.citations`, path projection, phases):

**[`artifacts/hermes-lanyard-tool-citations-contract.md`](./artifacts/hermes-lanyard-tool-citations-contract.md)**

### One gateway only

Relay keeps **one WebSocket session per `instanceId`** (last connect wins). Hermes and mock share the seeded demo credentials — **do not run both**.

| Brain | How it connects | Role |
|-------|-----------------|------|
| **Hermes** | `hermes-gateway.service` or `./scripts/dev-lanyard-hermes-gateway.sh` | **SoT** — real tools/answers |
| **mock-gateway** | `pnpm dev:mock-gateway` / tmux | Optional canned ChatToolCalls demo |

### Switch modes

```bash
# Real Hermes brain (stop mock)
./scripts/portal-gateway-mode.sh hermes

# Optional UI demo without Hermes (stop Hermes)
./scripts/portal-gateway-mode.sh mock

./scripts/portal-gateway-mode.sh status
```

### Hermes tools / citations expectations

| Source | Portal UI |
|--------|-----------|
| `metadata.portal_event: "tool_progress"` + `tool_call_id` / `tool_name` / `tool_status` / `tool_target` | Durable Astryx `ChatToolCalls` (best) |
| Pure emoji tool chrome only (no prose mix) | Degraded tool rows (relay heuristic) |
| Final `metadata.citations: [{path,title}]` | Citation chips → Vault tab |
| File-like `tool_target` on tools, no citations array | Client may derive chips on finalize |

Paths for citations must be vault-absolute (`/…`). See the contract sketch for the full field table and lifecycle (`running` → `complete` → final answer).

## Mock gateway (optional UI demo only)

Not required for Hermes-only or production. Emits a canned `tool_progress` + citations sequence for Astryx UI checks.

```bash
source .data/demo-env.sh
./scripts/portal-gateway-mode.sh mock   # stops hermes-gateway.service, starts mock
# or: systemctl --user stop hermes-gateway.service && pnpm dev:mock-gateway
```

Included as the **mock-gateway** tmux window when using `pnpm dev:tmux` (tmux also stops Hermes so mock can own the session). Standalone: start **after** relay is listening on `8787`.

## Real brain — Hermes + `$HOME/Lanyard` vault (local)

Use your **company brain** at `$HOME/Lanyard` (MemPalace / vault) with a real **Hermes gateway**. This is the default path for tools and chat.

### Filesystem vault provider (`VAULT_ROOT`)

By default the BFF serves a **fixture** vault tree (CI-safe). For a local workspace mirror, point the BFF at a directory:

```bash
export VAULT_ROOT="$HOME/Lanyard"   # or any project vault folder
# restart BFF — log line: VAULT_ROOT=… (filesystem vault provider)
```

- Vault API paths are root-relative POSIX paths (`/` = `VAULT_ROOT`).
- Role **ACL `path_prefixes` still apply** (fixture and FS providers both go through `VaultService`).
- Demo `member` with prefix `/` sees the whole tree; narrower roles only see allowed prefixes.
- Search index remains the fixture MemPalace stub unless a separate index provider is wired.
- **Live tree:** the Vault UI polls `/api/vault/tree` about every 8s and refreshes on window focus, so new files under `VAULT_ROOT` appear without a full page reload.
- **Empty tree:** if the rail shows “No files available”, confirm `VAULT_ROOT` is set on the BFF process and your role’s `path_prefixes` allow the path you expect.
- **Deep-link:** chat citations call `openVaultPath(path)` → switch to Vault + open the reader for that path.
- **Hermes tools + citations (SoT):** see [`artifacts/hermes-lanyard-tool-citations-contract.md`](./artifacts/hermes-lanyard-tool-citations-contract.md). Prefer structured `portal_event: "tool_progress"` and final `metadata.citations`. Chrome-only and path derivation are degraded fallbacks.
- **Optional mock demo:** only if Hermes is stopped — canned tools/citations for UI checks (`portal-gateway-mode.sh mock`).

**Prerequisites:** Portal stack up (control-plane, relay, bff, web), `hermes` on PATH, demo tenant seeded (`.data/demo-env.sh`). Demo `member` role uses `hermes_profile: "default"` — match with `hermes profile use default` if you use multiple profiles.

1. Stop mock so Hermes owns the session: `./scripts/portal-gateway-mode.sh hermes` (or kill **mock-gateway** tmux window / stop `pnpm dev:mock-gateway`).
2. In another terminal (if not using `hermes-gateway.service`):

```bash
cd /home/operator/portal
./scripts/dev-lanyard-hermes-gateway.sh
```

This reads `RELAY_DEV_SECRETS` from `.data/demo-env.sh`, sets `GATEWAY_RELAY_*` for `lanyard_web`, sets `TERMINAL_CWD` to `$HOME/Lanyard` (override with `LANYARD_BRAIN_ROOT`), and runs `hermes gateway run`.

3. Open http://demo.localhost:3010 → sign in → Chat: create a thread and send a message that uses tools. Replies stream from Hermes through relay SSE; tool rows and citations appear per the contract (structured metadata preferred).

**Optional tmux window** after `pnpm dev:tmux`:

```bash
tmux new-window -t lanyard-portal -n hermes-brain -c "$HOME/Lanyard" \
  "cd /home/operator/portal && ./scripts/dev-lanyard-hermes-gateway.sh"
```

Do **not** run **mock-gateway** and **hermes-brain** / **hermes-gateway.service** at the same time (same `gatewayId` + `instanceId`). Prefer Hermes-only: `./scripts/portal-gateway-mode.sh hermes`.

### Lanyard Hermes fork / weekly sync (ops)

Local gateway code lives under `~/.hermes/hermes-agent` on branch **`lanyard/portal-integration`** (fork `LanyardBrain/hermes-agent`, upstream `NousResearch/hermes-agent`). Full plan + runbook: [`artifacts/hermes-lanyard-fork-sync-plan.md`](./artifacts/hermes-lanyard-fork-sync-plan.md). Host one-pager: `~/.hermes/README-LANYARD.md`.

| Task | Command / note |
|------|----------------|
| Manual sync | Actions → **Sync upstream (Lanyard portal)** → Run workflow (or wait for Sun ~00:00 Eastern) |
| After green sync | Optional: `systemctl --user restart hermes-gateway` when ready (workflow does **not** auto-restart) |
| Dirty-tree refuse | Commit/stash under `hermes-agent/` only, re-run workflow |
| Rebase conflict | SSH host, fix in `~/.hermes/hermes-agent`, `git rebase --continue`, push, re-run |
| Runner offline | `systemctl --user status actions.runner.LanyardBrain-hermes-agent.hermes-sync-spark-0a00` |

**Safety:** never `rm -rf ~/.hermes`; only operate on `hermes-agent/` git state. Cron, skills, MCP, config, `projects.db` are outside git sync.

## Quick smoke checks (curl)

```bash
# Tenant resolution (demo host, unauthenticated)
curl -s http://demo.localhost:4000/api/context | head

# Control plane health
curl -s http://127.0.0.1:3100/health
```

## Automated tests

From **portal workspace** (`portal/`):

```bash
pnpm test
```

From **platform monorepo root**:

```bash
pnpm -C portal test
```

Package-level unit/integration tests; does not replace the tmux + browser flow above for full chat E2E.

After Astryx **Phase 0**, CI also runs `pnpm --filter @lanyard/web build` and `astryx doctor`. After **Phase 3**, add `pnpm --filter @lanyard/web test` locally before PRs that touch the React app.

### DB-backed integration suites (`lp-p37.2`)

Control-plane and BFF integration tests call `createTestStore()` and require a reachable Postgres via `CONTROL_PLANE_DATABASE_URL` or `DATABASE_URL`. Without that URL the suites fail fast instead of verifying auth, RBAC, tenant isolation, settings, vault, projects, or session sharing.

**One command (preferred)** — starts lab Postgres via compose if not already reachable, builds `@lanyard/shared`, runs both packages:

```bash
# From portal/
pnpm test:db-integration

# From platform monorepo root
pnpm -C portal test:db-integration
# or
bash portal/scripts/run-db-backed-integration-tests.sh
```

Paired package-only / security-focus variants (same DB setup):

| Intent | Command (from `portal/`) |
| --- | --- |
| Both packages (default) | `pnpm test:db-integration` |
| Control-plane only | `pnpm test:db-integration:cp` |
| BFF only | `pnpm test:db-integration:bff` |
| Security audit subset | `pnpm test:db-integration:security` |
| Fully disposable Postgres | `bash scripts/run-db-backed-integration-tests.sh --disposable` |
| Write markdown evidence | `bash scripts/run-db-backed-integration-tests.sh --security-focus --evidence ../artifacts/security/lp-p37.2-db-backed-integration.md` |

Lab default URL (compose service `postgres` in `docker-compose.yml`):

```text
postgres://portal:portal@127.0.0.1:5432/portal_cp
```

**Isolation / idempotency:** each test file opens a unique schema `cp_test_<uuid>` and `DROP SCHEMA … CASCADE` on close (`packages/control-plane/test/pg-test-store.ts`). Parallel vitest files do not share tables. Re-running the script against the same lab DB is safe.

**Cleanup (local):**

```bash
# Leave DB up for day-to-day dev, or:
docker compose -f portal/docker-compose.yml stop postgres
docker compose -f portal/docker-compose.yml down        # stop stack
docker compose -f portal/docker-compose.yml down -v     # also drop portal-pg-data

# Disposable mode auto-removes its container unless --keep-db
docker rm -f portal-db-backed-test-pg   # only if you used --keep-db
```

**Security-focus coverage** (`--security-focus` / `pnpm test:db-integration:security`):

| Package | Suites |
| --- | --- |
| control-plane | `auth`, `rbac`, `tenant-authz`, `tenant-members`, `service-auth`, `session-shares`, `schema-boundary` integration tests |
| bff | `auth`, `settings`, `vault`, `projects`, `session-sharing`, `session-shares-list`, `org-members`, `rbac`, `staging` integration tests |

Session-share **org isolation** (member directory tenant scope, share-only-within-tenant, outsider 404, revoke) is also covered by the security-focus set, or manually:

```bash
export CONTROL_PLANE_DATABASE_URL="${CONTROL_PLANE_DATABASE_URL:-postgres://portal:portal@127.0.0.1:5432/portal_cp}"

pnpm --filter @lanyard/bff exec vitest run \
  test/session-sharing.integration.test.ts \
  test/org-members.integration.test.ts

pnpm --filter @lanyard/control-plane exec vitest run \
  test/session-shares.integration.test.ts \
  test/tenant-members.integration.test.ts
```

## Manual multi-user session share check (demo org)

Use this after UI share work (MoreMenu → Share) to confirm org isolation by hand. Stack: `pnpm dev:tmux` (demo tenant seeded).

**No extra env** beyond the usual demo stack / `demo-env.sh`. Register extra users on the **same** demo tenant via [Register via API](#register-via-api-curl-only) (React login is login-only), then assign `member` if needed:

```bash
# User A (owner), User B (invitee), User C (same-org outsider)
# Use distinct cookie jars so sessions do not clobber each other.
for email in owner-a@demo.local invitee-b@demo.local outsider-c@demo.local; do
  jar="/tmp/portal-${email}.txt"
  curl -s -c "$jar" -b "$jar" http://demo.localhost:4000/api/auth/csrf >/dev/null
  CSRF=$(grep lanyard_csrf "$jar" | awk '{print $7}')
  curl -s -b "$jar" -c "$jar" -X POST http://demo.localhost:4000/api/auth/register \
    -H "content-type: application/json" -H "x-csrf-token: $CSRF" \
    -d "{\"email\":\"$email\",\"password\":\"password123\"}"
done
./scripts/assign-demo-member-roles.sh
```

| Step | Action | Expected |
|------|--------|----------|
| 1 | Browser profile/window 1 → http://demo.localhost:3010 → sign in as **owner-a** | Chat UI loads for demo org |
| 2 | Create a chat thread; open MoreMenu → **Share** | Picker lists **invitee-b** and **outsider-c** only (same tenant). Self not listed. No free-text email for other orgs. |
| 3 | Share with **invitee-b** (Read or Collaborate) | Success; grant created |
| 4 | Browser profile/window 2 → sign in as **invitee-b** on demo | Shared thread appears (read or collaborate access) |
| 5 | Browser profile/window 3 → sign in as **outsider-c** on demo | Shared thread **not** listed; direct thread URL/events → no access (404) |
| 6 | Owner revokes the share (manage UI if available, or `DELETE /api/chat/threads/:id/shares/:granteeUserId`) | Invitee loses the thread from list / events 404 |
| 7 | Optional cross-slug: open another tenant host (e.g. a non-demo slug if seeded) as a user that only exists there | That user never appears in demo Share picker; API share with their email → **404** grantee not found |

**API-only smoke** (owner cookies after login/register as above). Re-read CSRF from the **owner** jar — the register loop leaves `$CSRF` as the last user (`outsider-c`), which would 403 against the owner session.

```bash
# CSRF must match the owner cookie jar (not leftover from the register loop)
CSRF=$(grep lanyard_csrf /tmp/portal-owner-a@demo.local.txt | awk '{print $7}')

# List same-tenant members (excludes self)
curl -s -b /tmp/portal-owner-a@demo.local.txt http://demo.localhost:4000/api/org/members | jq .

# Share create with non-tenant email must fail with 404 (grantee not found).
# Replace <THREAD_ID> with a real thread id owned by owner-a (create one in the UI or via POST /api/chat/threads).
curl -s -b /tmp/portal-owner-a@demo.local.txt \
  -X POST "http://demo.localhost:4000/api/chat/threads/<THREAD_ID>/shares" \
  -H "content-type: application/json" -H "x-csrf-token: $CSRF" \
  -d '{"grantee_email":"nobody@other-slug.example","mode":"read"}'
```

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `Attaching to existing session` but stack is broken | `tmux kill-session -t lanyard-portal` then `pnpm dev:tmux` |
| Login fails for seeded user | Re-run `seed-demo-tenant.sh`; or use curl register + assign |
| 403 on thread create / no Hermes profile | Run `./scripts/assign-demo-member-roles.sh` after register |
| `Gateway not connected or handshake incomplete` on send | Start **mock-gateway** *or* Hermes (not both); `./scripts/portal-gateway-mode.sh status`; ensure relay loaded `RELAY_DEV_SECRETS` from `demo-env.sh` |
| No ChatToolCalls / no citation chips with Hermes | Ensure mock is stopped (`portal-gateway-mode.sh hermes`); Hermes should emit structured `tool_progress` / `citations` (see contract sketch). Chrome-only needs pure tool lines, not mixed prose |
| Need UI-only tool/citation demo without Hermes | `./scripts/portal-gateway-mode.sh mock` (optional; not production) |
| Relay auth errors after re-seed | New instance provision only on first seed; use `last-relay-secret.txt` or reprovision via control plane APIs |
| Unknown tenant subdomain | Use `demo.localhost` host or `DEV_TENANT_SLUG=demo` on BFF |
| Google stub works in curl but not UI | Expected until Auth bead **#4**; use curl or email/password login |
| `astryx doctor` / web build fails | Use Node **22+**; see migration plan Phase 0 |
