# @lanyard/control-plane

Lanyard control plane service: tenant registry, gateway relay **instance register / rotate**, deployment/resource registry metadata (cbd-mta.3.3), deprovision/revoke, and metadata-only audit log.

Implements [Core#5](https://github.com/LanyardBrain/Core/issues/5) (portal issue slice 3). G2.1 makes **register** the canonical path from control plane → host secret material. **G2.2** adds **rotate** (new secret version + operator runbook for SSM overwrite). **cbd-mta.3.3** adds central deployment/resource registry fields and first-class audit boundary columns.

## Data model

Metadata-only control plane (cbd-mta.3.1 + 3.3). **Canonical Company Brain file bodies are not stored here** — vault content lives on the customer host and is accessed via [Brain RPC](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/brain-rpc-contract.md). Full ownership/FK/RLS notes: [docs/control-plane-schema-boundary.md](../../docs/control-plane-schema-boundary.md). Registry design: [docs/deployment-resource-registry.md](../../docs/deployment-resource-registry.md).

| Table | Ownership | Fields (summary) |
|-------|-----------|------------------|
| `tenants` | Global root | `tenant_id`, UNIQUE `tenant_slug`, display name, `relay_tier`, retention flags (L5 `interaction_export_*` + L10 `chat_corpus_enabled` / `chat_corpus_retention_days`, default off) — `chat_delivery` **dropped Phase 10** `lp-k5c4.13` (rollback SQL in `migrate.ts`) |
| `users` | Tenant | `user_id`, `tenant_id`, UNIQUE `(tenant_id, email)`, `display_name`, `tenant_role` (`tenant_admin`\|`member`), optional `google_sub` / password **hashes** |
| `roles` / `role_path_prefixes` / `user_roles` | Tenant | Hermes profile + path **prefixes**; membership trigger blocks cross-tenant |
| `gateway_instances` | Tenant | Instance id + secret **hashes** (no plaintext); soft revoke; registry: `label`, `last_seen_at`, `health_status`, `credential_rotated_at`, `secret_param_arn`, `ec2_instance_id`, `aws_region`; Daytona (`lp-nye`): `runtime_kind` (`ec2`\|`daytona`), `sandbox_id`, `presence`, `agent_snapshot_id`, `s3_vault_prefix` — `chat_delivery` **dropped Phase 10** `lp-k5c4.13` |
| `tenant_deployments` | Tenant | Hosting track, isolation mode, account/region, pin versions, status, primary instance — **not** Terraform state |
| `tenant_resource_refs` | Tenant | Minimal non-secret AWS refs (`aws_id`/`arn`/`secret_arn`); soft retire |
| `projects` | Tenant | Name + `vault_path` reference only (not file body) |
| `session_share_grants` | Tenant | Thread id + owner/grantee; soft revoke; same-tenant trigger |
| `canonical_connectors` | Global | Live connector ids (seeded first-class + promoted/custom); `source` + unique `source_entry_id`; delete archives so the id stays reserved |
| `canonical_connector_aliases` | Global | Domain alias → canonical id (never mint `gmail`) |
| `tenant_connector_entitlements` | Tenant | FK `connector_id` → canonical; `enabled`; HubSpot `hubspot_portal_id` pin |
| `role_connector_grants` | Tenant | Legacy Hermes role×connector rows; **not** SaaS ACL |
| `person_connector_grants` | Tenant | Person grant presence `(tenant_id, user_id, connector_id)`; insert on, delete off |
| `connector_connections` | Tenant | UNIQUE `(tenant_id, user_id, connector_id)`; status + account label + sticky JSON; **KMS envelope** in `secrets_ciphertext` (never returned on public GET) |
| `audit_log` | Tenant or platform | Action + redacted `metadata_json`; nullable `tenant_id` FK; `instance_id`, `result`, `request_id` |

Plaintext relay secrets are returned **once** at register and **once** at rotate. Only scrypt hashes are persisted (plus optional previous-hash during rotation grace). Subsequent list/GET endpoints return identity metadata only — never the secret. Audit entries store action metadata only — never message bodies or secrets. `recordAudit` runs metadata through `redactAuditMetadata` (G2b.2) so secrets/payload keys cannot land in `audit_log` even if a caller passes them by mistake.

**Registry ≠ vault:** Company Brain file bodies stay on the customer host (Brain RPC). See deploy [deployment-resource-registry.md](https://github.com/LanyardBrain/company-brain-deploy/blob/main/references/deployment-resource-registry.md).

**RLS:** deferred — see schema-boundary doc (app path authz + FKs + triggers + private CP).

### Logging (G2b.2)

| Env | Default | Meaning |
|-----|---------|---------|
| `LOG_LEVEL` | `info` | Min structured log level |
| `PORTAL_DEBUG_PAYLOADS` | off | Explicit payload-bearing debug only; secrets still redacted |
| `CONTROL_PLANE_AUTH_MODE` | from `NODE_ENV` | `production` \| `development` |
| `CONTROL_PLANE_SERVICE_TOKEN` | unset | BFF↔CP service credential; required in production |
| `CONTROL_PLANE_DEV_OPEN` | off | Explicit local-dev open mode (`1`/`true`/`yes`/`on`). When set **and** auth mode is development **and** no service token is configured, non-health routes are left open for unit/integration convenience. Default is **fail closed**. |
| `DAYTONA_ENABLED` | off | Managed Daytona client path (`lp-k8n`). Default **off**. When on, non-test env requires `DAYTONA_API_KEY`, `DAYTONA_ORG_ID`, `DAYTONA_REGION`, `DAYTONA_DEFAULT_SNAPSHOT`. |
| `DAYTONA_API_KEY` | unset | **Secret** — Daytona org API key (never logged; never injected to agent). |
| `DAYTONA_ORG_ID` | unset | Daytona organization id |
| `DAYTONA_REGION` | unset | Default sandbox region |
| `DAYTONA_DEFAULT_SNAPSHOT` | unset | Platform default agent snapshot pin (offline placeholder ok, e.g. `offline:agent-default`; see pin convention) |
| `DAYTONA_TENANT_ALLOWLIST` | empty | Comma-separated tenant ids; empty deny-all when enabled |
| `DAYTONA_RETAIN_SANDBOX_ON_STOP` | **on** | `lp-6bg`: keep `sandbox_id` after stop for start-from-stopped re-wake (`0`/`false` clears) |
| `DAYTONA_WARM_POOL_ENABLED` | off | `lp-vqr0.10`: claim a pre-created stopped sandbox on unbound cold path, then start (`warm_pool`). Miss still `cold_create`. Default **off**. Do not enable against the paid org from CI. Tests use LocalDaytona only. |
| `DAYTONA_WARM_POOL_TENANT_ALLOWLIST` | empty | Premium tenants for warm pool when enabled (empty = all) |
| `DAYTONA_WARM_POOL_SIZE` | 2 | In-process pool cap. MockLab ceiling **2**; values clamp to 0–2. Replenish is off the `ensure_online` stack. |
| `DAYTONA_ARCHIVE_RESTORE_ON_WAKE` | off | `lp-6bg`: try start-while-archived before cold create |
| `INSTANCE_SECRET_MATERIAL_PATH` | unset | Encrypted-file store (`lp-3a1.2`). Fargate `/tmp` is **ephemeral** — do not use on live. |
| `INSTANCE_SECRET_MATERIAL_KEY` | unset | AES key for file or SM envelope. **Secret** — inject via SM/SSM, never log. |
| `INSTANCE_SECRET_MATERIAL_SM_SECRET_ID` | unset | SM name/ARN for the same envelope (`lp-oop.37.6`). Pair with KEY; do not also set PATH. |
| `CONNECTOR_KMS_KEY_ID` | unset | AWS KMS key id/ARN for connector secret envelopes (lp-xhf4.2). Wins over local key. |
| `CONNECTOR_KMS_LOCAL_KEY` | unset | Lab AES master (64-hex / 32-byte base64 / passphrase ≥16). Never log. Public CRUD works without KMS; encrypt/decrypt fail closed. |

Instance secret material (register/rotate → guest_gateway wake inject) lives in `InstanceSecretMaterialStore`, never Postgres. Harness `tool_only` and `VaultPlane=cp_s3` do not read it. Live durable path: [instance-secret-material.md](../../docs/runbooks/instance-secret-material.md).

Daytona config schema: [docs/plans/0008-daytona-agent-sandboxes/cp-daytona-config.md](../../docs/plans/0008-daytona-agent-sandboxes/cp-daytona-config.md). Snapshot pin convention (placeholders + Phase 2 links): [docs/plans/0008-daytona-agent-sandboxes/agent-snapshot-pin.md](../../docs/plans/0008-daytona-agent-sandboxes/agent-snapshot-pin.md). Wake strategy / warm pool: [warm-pool-snapshot-wake.md](../../docs/plans/0008-daytona-agent-sandboxes/warm-pool-snapshot-wake.md) (`lp-6bg`). Startup logs use `daytonaConfigLogSummary` only (`configured`/`missing`, allowlist **count** — never the API key).

### Daytona SDK HTTP client (`lp-012`)

Real managed-API client implementing `DaytonaClient` (`create` / `start` / `stop` / `archive` / `get` / `list`) against `https://app.daytona.io/api`. API key + org from `loadDaytonaConfig` only. Injectable `fetch` for offline unit tests (no live calls in CI).

| Export | Use |
|--------|-----|
| `createDaytonaSdkClient` / `DaytonaSdkClient` | Construct from ready `DaytonaConfig` |
| `DaytonaTimeoutError` | Per-request AbortSignal timeout |
| `DaytonaHttpError` | Non-2xx with scrubbed body snippet |
| `DEFAULT_DAYTONA_API_BASE_URL` | `https://app.daytona.io/api` |

Create/GET parse path always runs `parseDaytonaSandboxApiBody` before `logSafe` callbacks.

### Daytona toolbox client (`lp-oop.24`)

Short-stack tool exec: `POST {toolboxBase}/toolbox/{sandbox_id}/process/execute`. Domain type is `ToolboxExec { sandbox_id, argv, cwd, timeout_ms }` → `{ stdout, stderr, exit_code }` (`@lanyard/shared`). Default toolbox host is `https://proxy.app.daytona.io` (Phase 0 spike). Injectable `fetch` — no live Daytona in tests.

`logSafe` events use `redactToolboxExecForLog`: **argv / command are always `[REDACTED]`**. Logs may keep `sandbox_id`, `argv_count`, `cwd`, `timeout_ms`, `exit_code`, and stdout/stderr **byte lengths**. Fake toolbox is `lp-oop.25`.

Harness bind (`lp-oop.28`): `bindEnsureOnlineToolbox` (shared) calls `ensure_online(tenant, user)` then execs only on that `sandbox_id`. The bind (and BFF `ChatDelivery=harness`) send `sandbox_create_profile=tool_only`. Cold create then **omits provider keys, `GATEWAY_RELAY_SECRET`, harness HTTP search keys, and MCP secrets**. Default profile stays `guest_gateway` (today's Relay + provider inject).

Vault stdio MCP (`lp-oop.38.19`) uses `DaytonaToolboxSessionClient` (create / attach / exec / input / logs / teardown). That is JSON-RPC over `process/session`, not one-shot `process/execute`. Session API: [daytona-process-session-mcp.md](../../../docs/architecture/daytona-process-session-mcp.md).

| Export | Use |
|--------|-----|
| `createDaytonaToolboxClient` / `DaytonaToolboxClient` | Construct from ready `DaytonaConfig` |
| `createDaytonaToolboxSessionClient` / `DaytonaToolboxSessionClient` | Vault MCP process session (lp-oop.38.19) |
| `DEFAULT_DAYTONA_TOOLBOX_BASE_URL` | `https://proxy.app.daytona.io` |
| `redactToolboxExecForLog` (shared) | Log-boundary argv redaction |
| `bindEnsureOnlineToolbox` (shared) | ensure_online(tenant, user) → bound toolbox |
| `SHORT_STACK_CREATE_ENV_DENYLIST` | Provider keys + `GATEWAY_RELAY_SECRET` + harness HTTP search keys (`TAVILY`/`BRAVE`/`FIRECRAWL`/`X_BEARER_TOKEN`; `XAI_API_KEY` is already a provider wake key) |

### Daytona create/GET env redaction (`lp-pec.1`)

Managed Daytona create (and some GET) responses **echo the full process `env` map**, including `GATEWAY_RELAY_SECRET`. Orchestrator clients must redact before any log/CI dump.

| Export | Use |
|--------|-----|
| `redactDaytonaApiResponseForLog` | Deep-redact raw create/GET JSON |
| `daytonaEnvLogSummary` | Keys present + secret length/fingerprint (`sha256:` + 12 hex) — never raw |
| `parseDaytonaSandboxApiBody` | Parse-path helper for real SDK (`lp-012`) |
| `withDaytonaResponseRedaction` | Optional middleware around parsers |

**Policy:** log env **keys**, secret **length**, optional **fingerprint**; never raw secrets or unredacted env dumps. Throwaway tokens only in tests. Details: [daytona-response-redaction.md](../../docs/plans/0008-daytona-agent-sandboxes/daytona-response-redaction.md).

### Mid-turn protection (`lp-053`)

While an agent turn / tools are active, the idle reaper must **not** stop the sandbox.

| Mechanism | Detail |
|-----------|--------|
| Arm / clear | `POST …/signal-activity` with `mid_turn: true\|false` (also bumps `last_activity_at`) or `setMidTurn` |
| Timeout safety | `mid_turn_until` default **45 min** (`DEFAULT_MID_TURN_MAX_HOLD_MS`); reaper clears expired locks |
| Durable fields | `gateway_instances.mid_turn`, `mid_turn_until` |
| Docs | [mid-turn-protection.md](../../docs/plans/0008-daytona-agent-sandboxes/mid-turn-protection.md) |

### Instance Orchestrator internal API (`lp-biq` / `lp-nus`)

Internal (service-token) routes for on-demand sandbox lifecycle:

| Method | Path | Status |
|--------|------|--------|
| `POST` | `/internal/instances/:instanceId/ensure-online` | **200** when Daytona orchestrator wired (`lp-nus` singleflight wake + `lp-rr5` Relay connected wait when injected); **501** when not; timeout **504**; wake fail **502**; rate limit **429** (`lp-rq1`) |
| `GET` | `/internal/instances/:instanceId/presence` | **200** field read |
| `POST` | `/internal/instances/:instanceId/signal-activity` | **200** bumps `last_activity_at` (`lp-84f`) |
| `POST` | `/internal/instances/:instanceId/stop` | **501** until orchestrator stop |

Full contract: [docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md](../../docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md). Types exported from `@lanyard/control-plane` (`ORCHESTRATOR_API_PATHS`, `InstanceOrchestratorService`, …). BFF client methods on `ControlPlaneAuthClient` compile against the same paths.

### Connector APIs (`lp-xhf4.2`)

BFF-only (service token). Public JSON never includes `secrets_ciphertext` or plaintext tokens. `GET/PUT …/secrets` is the inject/write path for BFF, not the SPA.

| Method | Path |
|--------|------|
| `GET` `PUT` | `/internal/tenants/:tenantId/connector-entitlements[/:connectorId]` |
| `GET` `PUT` | `/internal/tenants/:tenantId/roles/:roleId/connector-grants[/:connectorId]` |
| `GET` `PUT` `DELETE` | `/internal/tenants/:tenantId/users/:userId/connectors[/:connectorId]` |
| `GET` `PUT` | `/internal/tenants/:tenantId/users/:userId/connectors/:connectorId/secrets` |
| `GET` | `/internal/tenants/:tenantId/users/:userId/connectors/:connectorId/access` |

Closed ids: `google` `hubspot` `whatsapp`. UNIQUE `(tenant_id, user_id, connector_id)`. Envelope encrypt uses AWS KMS `GenerateDataKey` when `CONNECTOR_KMS_KEY_ID` is set.

### Wake rate limits (`lp-rq1`)

Process-local sliding-window limits on **new** ensure_online wake starts (not singleflight joiners, not already_online short-circuits):

| Env | Role |
|-----|------|
| `ENSURE_ONLINE_GLOBAL_MAX_WAKES` | Max new wakes per window (all tenants); `0`/unset = off |
| `ENSURE_ONLINE_TENANT_MAX_WAKES` | Max new wakes per window per tenant; `0`/unset = off |
| `ENSURE_ONLINE_RATE_LIMIT_WINDOW_MS` | Window length (default **60_000**) |

Reject → HTTP **429** `ENSURE_ONLINE_RATE_LIMITED` + metrics `sandbox_wake_rejected` / `wake_rejected_total`. Tests: `test/wake-rate-limit.test.ts`.

### Relay connected wait (`lp-rr5`)

After sandbox **Started**, ensure_online waits for Relay to report the gateway `instance_id` connected (WSS) before presence → `online`. Sandbox start alone is not online.

| Mechanism | Detail |
|-----------|--------|
| Port | `RelayPresence.isConnected(instance_id)` — fake in tests; HTTP owner lookup live |
| Never-connect policy | Kill sandbox, recreate **once**, wait again; still fail → presence `error` |
| Server inject | `RELAY_INTERNAL_URL` (or `RELAY_URL`) + `RELAY_INTERNAL_TOKEN` when Daytona ready |
| Docs | [relay-connected-wait.md](../../docs/plans/0008-daytona-agent-sandboxes/relay-connected-wait.md) |

### Failure-mode unit matrix (`lp-2tz`)

Offline LocalDaytona (+ FakeRelay) coverage for ensure_online edge cases (no real network):

| Mode | Expected |
|------|----------|
| Daytona API down | `EnsureOnlineWakeError` + presence `error` |
| Start timeout (warm / cold+start delay) | `EnsureOnlineTimeoutError` + presence `error` |
| Start hard fail (cold create→start) | `EnsureOnlineWakeError` + presence `error` |
| Never-connect (Relay) | kill+recreate once → `EnsureOnlineWakeError` |
| Concurrent wake | singleflight shares one create/start |
| Vault mount invalid | fail closed before create; presence `error` |

Tests: `test/ensure-online-failure-modes.test.ts`. Helpers: `setApiDown`, `holdNextStart` / `setStartError` on `real harness via harness-local.ts`.

### Idle reaper (`lp-0y3`)

Background job stops online **Daytona** sandboxes after **10 min** without activity (`last_activity_at`, `lp-kng.8`). EC2 `runtime_kind` is never reaped. Mid-turn rows are skipped (`mid_turn`; full lock `lp-053`).

| Export / knob | Role |
|---------------|------|
| `createIdleReaperJob` / `reapIdle` | Job loop + one-pass scan |
| `DEFAULT_IDLE_GRACE_MS` | 10 minutes |
| `DEFAULT_IDLE_REAPER_INTERVAL_MS` | Scan interval (60s) |
| `IDLE_REAPER_GRACE_MS` / `IDLE_REAPER_INTERVAL_MS` | Env overrides (ms) |

CP `server.ts` starts the loop only when `DAYTONA_ENABLED` + ready keys. Unit tests use LocalDaytona + injectable clock (no live network). Details: [idle-reaper.md](../../docs/plans/0008-daytona-agent-sandboxes/idle-reaper.md).

### Platform scheduled-task fire path (`lp-jzl.7`)

When a scheduled job is due (evaluator: `lp-jzl.10.2`), the platform fire helper wakes compute outside the ephemeral guest:

| Step | Call |
|------|------|
| 1. Wake | `ensure_online(instance)` |
| 1b. Bind stream (lp-fn5.5.3) | optional `ensureJobStream(job)` → same `thread_id` every fire |
| 2. Protect | `setMidTurn(true)` + `signalActivity({ mid_turn: true })` |
| 3. Run | injectable `runJob({ …, thread_id })` (Relay deliver-inbound / internal run-job) |
| 3b. Append stream | optional `appendJobStreamTurn` (user + optional assistant on job chat) |
| 4. Clear | `setMidTurn(false)` + activity bump (starts idle grace) |
| 5. Stop | idle reaper after grace (does not clear durable job registry) |

| Export | Role |
|--------|------|
| `fireScheduledTask` | Orchestrated fire path |
| `createInMemoryScheduledTaskJobRegistry` | Offline durable job SoT for tests |
| `AgentJobRunner` | Inject production deliver/run-job hook |
| `ensureJobStream` / `appendJobStreamTurn` | Optional deps: portal job stream binding + history (lp-fn5.5.3) |
| `PORTAL_THREAD_DELIVER` | Job `deliver` mode for portal stream chat_id |

Job definitions live in a platform registry (not guest RAM) so they survive idle stop. Integration: `test/scheduled-task-fire.integration.test.ts` (LocalDaytona + fake clock). Live MockLab one-fire is `lp-jzl.8` — evidence pack: [artifacts/daytona-pilot/scheduled-task-fire/](../../artifacts/daytona-pilot/scheduled-task-fire/EVIDENCE.md) (offline smoke PASS; live residual under OPERATOR HOLD). Plan: [0012-scheduled-tasks](../../docs/plans/0012-scheduled-tasks/overview.md).

### Daytona vendor autoStop safety net (`lp-4f2`)

Create-time Daytona `autoStopInterval` is a **vendor backstop** above the CP reaper — not the primary stop path and not mid-turn-aware.

| Knob | Default | Notes |
|------|---------|--------|
| `DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES` | **90** | Must stay above 10m idle grace and 45m mid-turn max hold |
| `DAYTONA_AUTO_STOP_INTERVAL_MINUTES` | env override | Loaded on `DaytonaConfig.autoStopIntervalMinutes` |
| Server wiring | `createDaytonaSdkClient({ autoStopIntervalMinutes })` | Only when Daytona enabled + ready |

Invariant: `10m reaper < 45m mid-turn hold < 90m vendor autoStop`. Docs: [daytona-autostop-safety-net.md](../../docs/plans/0008-daytona-agent-sandboxes/daytona-autostop-safety-net.md).

### Dual-run via per-instance `runtime_kind` (`lp-gu2`)

Dual-run is **not** a global-only cutover. Compute path is the instance field `gateway_instances.runtime_kind` (`ec2` \| `daytona`):

| Operator action | Surface |
|-----------------|---------|
| Set path at provision | `POST /tenants/:id/instances/register` body `{ "runtime_kind": "daytona" }` (default `ec2`) |
| Dual-run update | `PATCH /tenants/:id/instances/:instanceId/registry` with `runtime_kind` (+ prefix/snapshot for daytona) |
| Lifecycle branch | `ensure_online` / `stop` / idle reaper read the field; never flip it as a side-effect |

`DAYTONA_ENABLED` + `DAYTONA_TENANT_ALLOWLIST` gate the managed Daytona client path; they do **not** rewrite every tenant’s `runtime_kind`. Two tenants can differ in the same env (one EC2 always-on, one Daytona lazy sandbox).

Normative operator note: [dual-run-runtime-kind.md](../../docs/plans/0008-daytona-agent-sandboxes/dual-run-runtime-kind.md). Tests: `test/runtime-kind-dual-run.test.ts` (LocalDaytona + store coexistence).

### Dual-run via per-tenant / per-instance `chat_delivery` — **dropped Phase 10** (`lp-k5c4.13`)

Chat path was `instance > tenant > env > relay`. After `lp-k5c4.14` closed EC2 residual, every tenant is Daytona and `HARNESS_URL` wired → spine. Column `chat_delivery` dropped on both tables (see `migrate.ts` for rollback SQL). `PATCH /internal/tenants/:id/chat-delivery` is deprecated (audit-only, no column write after drop). Do not set global `CHAT_DELIVERY=harness`.

Plan: [phase-8-dual-run-proof.md](../../docs/plans/0015-short-stack/phase-8-dual-run-proof.md).

See [docs/policies/log-redaction.md](../../docs/policies/log-redaction.md).

Tenant host mapping: `{tenant_slug}.withlanyard.com`.
