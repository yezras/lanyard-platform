# Control Plane Daytona config schema (`lp-k8n`)

**Status:** Offline schema + loader (no live Daytona keys required to accept).  
**Bead:** `lp-k8n`  
**Code:** `portal/packages/control-plane/src/daytona-config.ts`  
**Related:** [gateway-env-contract.md](./gateway-env-contract.md) (agent never sees these keys), [identity-model.md](./identity-model.md), [offline-piping.md](./offline-piping.md)

## Purpose

Document and load **platform-only** configuration for the Lanyard Control Plane as a client of **managed Daytona**. This is the config boundary for the Instance Orchestrator (`lp-7v5` client, `lp-kng.2.1` ensure_online).

Tenants and the agent guest **never** receive Daytona credentials (overview §4.3 / §4.11).

## Env catalog

| Env | Required when `DAYTONA_ENABLED` | Secret? | Meaning |
|-----|----------------------------------|---------|---------|
| `DAYTONA_ENABLED` | — (default **off**) | no | Opt-in flag: `1` \| `true` \| `yes` \| `on`. Fail-closed default keeps EC2 path only. |
| `DAYTONA_API_KEY` | **yes** | **yes** | Org API key for Daytona managed API. |
| `DAYTONA_ORG_ID` | **yes** | no | Daytona organization id. |
| `DAYTONA_REGION` | **yes** | no | Default region for sandbox create/start. |
| `DAYTONA_DEFAULT_SNAPSHOT` | **yes** | no | Platform default `agent_snapshot_id` when instance pin is null. Offline placeholder ok (e.g. `offline:agent-default`). Pin convention: [agent-snapshot-pin.md](./agent-snapshot-pin.md) (`lp-kng.2.7`). |
| `DAYTONA_TENANT_ALLOWLIST` | no (empty = **deny all**) | no | Comma-separated `tenant_id` allowlist. Empty list fails closed for tenant wake. |
| `DAYTONA_DOMAIN_ALLOWLIST` | no (empty = **omit create field**) | no | Comma-separated create-time egress hosts for Daytona `domainAllowList` (`lp-ccp`). Empty fails closed (no Lanyard-granted open egress). Production catalog: [production-network-allowlist.md](./production-network-allowlist.md). |
| `DAYTONA_WEBHOOK_SECRET` | no (webhook returns 503 if unset) | **yes** | HMAC-SHA256 secret for `POST /webhooks/daytona` (`lp-04r`). Header: `x-daytona-signature` = `sha256=<hex>` over raw body. |
| `DAYTONA_AUTO_STOP_INTERVAL_MINUTES` | no (default **90**) | no | Create-time Daytona `autoStopInterval` (minutes). Vendor **safety net** above CP idle reaper (30m) and mid-turn max hold (45m). See [daytona-autostop-safety-net.md](./daytona-autostop-safety-net.md) (`lp-4f2`). `0` disables vendor auto-stop when API accepts it (not recommended for pilot). |

Values live in env / deploy secret store / SSM SecureString — **never** in git (same pattern as `CONTROL_PLANE_SERVICE_TOKEN`).

### Webhook receiver (`lp-04r`)

| Item | Value |
|------|--------|
| Path | `POST /webhooks/daytona` |
| Auth | HMAC only (skips BFF service-token gate; CP still private-network G1.3) |
| Event applied | `sandbox.state.updated` → presence via `OrchestratorInstanceStore` |
| Bad signature | HTTP **401** (no store write) |
| Missing secret | HTTP **503** `not_configured` |
| Replay | Idempotent — re-delivery after transition is HTTP **200** (`ignored` / `unknown_sandbox`) |
| Code | `daytona-webhook.ts` (`handleDaytonaWebhookRequest`), route in `app.ts` |

## Fail-closed rules

1. **Flag default off.** Unset `DAYTONA_ENABLED` → config loads with `enabled: false`; CP boot for EC2-only is unchanged; incomplete keys are allowed.
2. **Enabled + non-test env.** When `DAYTONA_ENABLED` is on and `NODE_ENV` is not `test` (and not Vitest), missing `DAYTONA_API_KEY`, `DAYTONA_ORG_ID`, `DAYTONA_REGION`, or `DAYTONA_DEFAULT_SNAPSHOT` throws at load / startup (`DaytonaConfigError`). Error text names env vars only — never secret values.
3. **Test exemption.** `NODE_ENV=test` or `VITEST` may load partial config so unit tests and fakes do not need real keys.
4. **Allowlist deny-by-default.** Even when ready, `isTenantOnDaytonaAllowlist` returns false for empty allowlist and unknown tenants.
5. **Domain egress deny-by-default (`lp-ccp`).** Empty `DAYTONA_DOMAIN_ALLOWLIST` → omit create-time `domainAllowList` (no open-world default). Invalid entries (bare `*`, schemes, paths) throw `DaytonaConfigError`. Catalog: [production-network-allowlist.md](./production-network-allowlist.md).
6. **No live calls offline.** Loader does not contact Daytona. Real SDK use is live-phase only after `lp-kng.1`.

## Logging (no secrets)

Use `daytonaConfigLogSummary(config)` for structured logs:

| Field | Example |
|-------|---------|
| `daytona_enabled` | `false` |
| `daytona_api_key` | `"configured"` \| `"missing"` (never the value) |
| `daytona_org_id` | `"configured"` \| `"missing"` |
| `daytona_region` | region string or `null` |
| `daytona_default_snapshot` | `"configured"` \| `"missing"` |
| `daytona_allowlist_count` | integer (not the id list) |
| `daytona_domain_allowlist_count` | integer (egress host count; not the host list; lp-ccp) |
| `daytona_ready` | boolean |
| `daytona_auto_stop_interval_minutes` | integer (resolved vendor autoStop; lp-4f2) |

Do not put `apiKey`, raw env maps, or allowlist id lists into log / audit metadata. Shared redaction (`api_key` / secret-shaped keys) remains defense-in-depth (G2b.2).

## Resolved type (CP)

```ts
type DaytonaConfig = {
  enabled: boolean;
  apiKey: string;              // secret — client only
  orgId: string;
  region: string;
  defaultSnapshotId: string;
  tenantAllowlist: readonly string[];
  domainAllowList: readonly string[]; // create-time egress hosts (lp-ccp)
  autoStopIntervalMinutes: number; // create-time vendor safety net (default 90)
};
```

Helpers:

- `loadDaytonaConfig(env)` — parse + optional fail-closed assert
- `assertDaytonaConfigReady(config)` — explicit gate before real client use
- `isTenantOnDaytonaAllowlist(config, tenantId)`
- `parseDaytonaDomainAllowList` / `formatDaytonaDomainAllowList` — egress allowlist (lp-ccp)
- `resolveAgentSnapshotId(config, instanceSnapshotId)` — instance pin wins over platform default
- `resolveDaytonaAutoStopIntervalMinutes(env)` — default 90; env `DAYTONA_AUTO_STOP_INTERVAL_MINUTES`
- `daytonaConfigLogSummary(config)` — safe log fields

## Snapshot resolution

1. If `gateway_instances.agent_snapshot_id` is non-empty → use it.  
2. Else use `DAYTONA_DEFAULT_SNAPSHOT`.  
3. Else null → orchestrator must fail closed before create (not provision-time Daytona call).

**Pin convention (offline placeholders, per-env table, live pipeline links):**  
→ **[agent-snapshot-pin.md](./agent-snapshot-pin.md)** (`lp-kng.2.7`)

Helpers: `resolveAgentSnapshotId`, `OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER` (`offline:agent-default`), `isOfflineAgentSnapshotPlaceholder`, `isValidAgentSnapshotPinShape`.

Offline: any non-empty fake pin is valid for fake Daytona; recommended default is `offline:agent-default` until Phase 2 (`lp-4xa` / `lp-1wa`) registers a real snapshot id.

## Out of scope (this bead)

- Real Daytona SDK / network client (`lp-7v5`, `lp-012`)
- ensure_online singleflight (`lp-kng.2.1`)
- Snapshot pin naming convention details (done in `lp-kng.2.7` / [agent-snapshot-pin.md](./agent-snapshot-pin.md))
- Terraform / SSM parameter wiring (live deploy)
- Injecting any of these keys into the agent guest env

## Acceptance evidence

- [x] Config keys documented (this file + module header) and loaded in CP (`loadDaytonaConfig` + server boot)
- [x] Missing key fails closed in non-test env when enabled
- [x] No secrets in logs (`daytonaConfigLogSummary` + unit tests with `redactForLog`)
