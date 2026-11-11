import { serve } from "@hono/node-server";
import { createLogger } from "@lanyard/shared";

import { createApp } from "./app.js";
import { resolveAuthMode, resolveDevOpenMode } from "./auth-mode.js";
import { parsePositiveIntEnv } from "./env-parse.js";
import {
  daytonaConfigLogSummary,
  formatDaytonaDomainAllowList,
  isDaytonaConfigReady,
  loadDaytonaConfig,
} from "./daytona-config.js";
import { createDaytonaSdkClient } from "./daytona-sdk-client.js";
import { resolveDatabaseUrl } from "./db.js";
import {
  createIdleReaperJob,
  resolveIdleReaperEnv,
  type IdleReaperJob,
} from "./idle-reaper.js";
import {
  resolveInstanceSecretMaterialStore,
  summarizeInstanceSecretMaterialStoreForLog,
} from "./gateway-relay-env.js";
import { createInstanceOrchestrator } from "./instance-orchestrator.js";
import { createInMemoryWarmPool } from "./warm-pool.js";
import { resolveSandboxVaultMountStsFromEnv } from "./sandbox-vault-mount-sts.js";
import {
  resolveS3VaultObjectStoreFromEnv,
  summarizeS3VaultObjectStoreForLog,
} from "./s3-vault-object-store.js";
import {
  createWakeRateLimiter,
  resolveWakeRateLimitConfig,
} from "./wake-rate-limit.js";
import {
  createHttpRelayCredentialsNotifier,
  resolveRelayInternalBaseUrl,
} from "./relay-credentials.js";
import { createHttpRelayPresence } from "./relay-presence.js";
import { DEFAULT_SHARED_RELAY_WSS_URL } from "./relay-tier.js";
import {
  assertProductionServiceToken,
  resolveServiceToken,
} from "./service-auth.js";
import { ControlPlaneStore } from "./store.js";
import { resolveConnectorKmsFromEnv } from "./connector-kms.js";

const log = createLogger({ service: "control-plane" });
const port = Number(process.env.CONTROL_PLANE_PORT ?? "3100");
const sharedRelayWssUrl =
  process.env.SHARED_RELAY_WSS_URL?.trim() || DEFAULT_SHARED_RELAY_WSS_URL;
const authMode = resolveAuthMode(process.env);
const serviceToken = resolveServiceToken(process.env);
const devOpen =
  authMode === "development" && resolveDevOpenMode(process.env);

// G1.2 production fail-closed: refuse to start without a real service token.
if (authMode === "production" || process.env.NODE_ENV === "production") {
  assertProductionServiceToken(serviceToken);
}

// lp-k8n: Daytona managed-client config (default off). When enabled, missing
// keys fail closed outside test. Summary fields never include secrets.
const daytonaConfig = loadDaytonaConfig(process.env);

// Resolve early so misconfiguration fails before bind (URL value is never logged).
resolveDatabaseUrl();

// lp-9my / lp-3a1.2 / lp-oop.37.6: material for register/rotate → inject.
// Default in-memory. PATH+KEY = encrypted file (ephemeral on Fargate /tmp).
// SM_SECRET_ID+KEY = same envelope in Secrets Manager (survives task recycle).
// Never put plaintext in Postgres.
const resolvedSecretMaterial = resolveInstanceSecretMaterialStore(process.env);
const secretMaterial = resolvedSecretMaterial.store;
const resolvedConnectorKms = resolveConnectorKmsFromEnv(process.env);

const store = await ControlPlaneStore.create({
  sharedRelayWssUrl,
  secretMaterial,
  connectorKms: resolvedConnectorKms.kms,
});
const orchestratorInstances = store.asOrchestratorInstanceStore();
// lp-04r: webhook HMAC secret — never log the value (name-only in ops docs).
const daytonaWebhookSecret = process.env.DAYTONA_WEBHOOK_SECRET?.trim() || "";

// lp-nus / lp-0y3: bind InstanceOrchestrator when managed Daytona is ready.
// Shared by ensure-online HTTP and idle reaper (singleflight + SDK client).
// EC2-only boots (DAYTONA_ENABLED off / incomplete keys) leave orchestrator
// null → ensure-online returns 501; reaper does not start.
let idleReaperJob: IdleReaperJob | null = null;
const idleReaperTiming = resolveIdleReaperEnv(process.env);

let instanceOrchestrator: ReturnType<typeof createInstanceOrchestrator> | null =
  null;
/** Shared Daytona client for orchestrator + deprovision archive (lp-e96). */
let daytonaClient: ReturnType<typeof createDaytonaSdkClient> | null = null;
/** lp-rr5: true when orchestrator waits for Relay connected after Started. */
let relayPresenceWaitEnabled = false;
// lp-57ha: fakes removed — orchestrator now requires real Daytona SDK + HARNESS_URL.
// Local harness tests use portal/test/harness-local.ts against real lanyard-agent on 127.0.0.1.
if (daytonaConfig.enabled && isDaytonaConfigReady(daytonaConfig)) {
    // lp-4f2: vendor autoStopInterval as safety net above CP idle reaper (30m)
  // and mid-turn max hold (45m). Default 90m from config; not the primary stop.
  // lp-ccp: create-time domainAllowList from DAYTONA_DOMAIN_ALLOWLIST (fail-closed
  // when empty — omit field; no open-world default). Production hostnames:
  // docs/plans/0008-daytona-agent-sandboxes/production-network-allowlist.md
  daytonaClient = createDaytonaSdkClient({
    config: daytonaConfig,
    autoStopIntervalMinutes: daytonaConfig.autoStopIntervalMinutes,
    domainAllowList: formatDaytonaDomainAllowList(
      daytonaConfig.domainAllowList,
    ),
    logSafe: (event) => {
      log.info("daytona_sdk", {
        op: event.op,
        method: event.method,
        path: event.path,
        status: event.status,
        sandbox_id: event.sandbox_id ?? null,
        error_code: event.error_code,
        duration_ms: event.duration_ms,
        // envSummary is already redacted (lp-pec.1); never raw env secrets.
        env_keys: event.envSummary?.keys,
      });
    },
  });
  // lp-rr5: poll Relay owner endpoint after sandbox Started before online.
  // HTTP base (not WSS). Token never logged.
  const relayInternalUrl = resolveRelayInternalBaseUrl(process.env);
  const relayInternalToken = process.env.RELAY_INTERNAL_TOKEN?.trim() || "";
  const relayPresence =
    relayInternalUrl && relayInternalToken
      ? createHttpRelayPresence({
          baseUrl: relayInternalUrl,
          internalToken: relayInternalToken,
        })
      : null;
  relayPresenceWaitEnabled = relayPresence != null;
  // lp-rq1: process-local wake rate limits (env; 0/unset = disabled).
  const wakeRateLimitConfig = resolveWakeRateLimitConfig(process.env);
  const wakeRateLimiter = createWakeRateLimiter({
    config: wakeRateLimitConfig,
  });
  // lp-zuh.9.2: vault bucket + optional STS issuer for mount-s3 wake inject.
  // Role ARN from TF module output; omit → skip AWS_* inject (mount helpers
  // may still get S3_VAULT_PREFIX / LANYARD_VAULT_BUCKET when bucket set).
  const vaultBucketForOrchestrator =
    process.env.S3_VAULT_BUCKET?.trim() || null;
  const vaultMountStsResolved = resolveSandboxVaultMountStsFromEnv(process.env);
  instanceOrchestrator = createInstanceOrchestrator({
    daytona: daytonaClient,
    instances: orchestratorInstances,
    defaultSnapshotId: daytonaConfig.defaultSnapshotId,
    defaultRegion: daytonaConfig.region,
    idleGraceMs: idleReaperTiming.idleGraceMs,
    daytonaConfig,
    relayPresence,
    // lp-kng.6.7: operator-tunable relay-connect wait. Cold Mountpoint mounts
    // can take minutes before the guest entrypoint starts the gateway; the
    // baked 45s window caused kill+recreate churn (relay_never_connect).
    // Unset → product default (45s).
    ...(parsePositiveIntEnv(process.env.ORCHESTRATOR_RELAY_CONNECT_TIMEOUT_MS)
      ? {
          relayConnectTimeoutMs: parsePositiveIntEnv(
            process.env.ORCHESTRATOR_RELAY_CONNECT_TIMEOUT_MS,
          ),
        }
      : {}),
    // lp-9my: same material store register/rotate put into — create-time inject.
    secretMaterial,
    // lp-2qs.4: tenant Class B provider secrets (CP Postgres + KMS) win over
    // process env for that slot on cold create.
    tenantProviderSecrets: {
      listEnvValues: (tenantId) =>
        store.getTenantProviderWakeEnvValues(tenantId),
    },
    // lp-rq1: reject new wake starts under global/tenant sliding window.
    wakeRateLimiter: wakeRateLimiter.isEnabled() ? wakeRateLimiter : null,
    // lp-6bg / lp-vqr0.10: start-from-stopped default; optional in-process pool.
    // Cap is 1–2 MockLab. Do not enable DAYTONA_WARM_POOL_ENABLED on the paid
    // org from CI. Replenish is off the ensure_online stack.
    retainSandboxOnStop: daytonaConfig.retainSandboxOnStop,
    warmPoolEnabled: daytonaConfig.warmPoolEnabled,
    warmPoolTenantAllowlist: daytonaConfig.warmPoolTenantAllowlist,
    warmPool: daytonaConfig.warmPoolEnabled
      ? createInMemoryWarmPool({ cap: daytonaConfig.warmPoolSize })
      : null,
    archiveRestoreOnWake: daytonaConfig.archiveRestoreOnWake,
    // lp-hjo / lp-zuh.9.2: platform vault bucket on create mounts + env.
    vaultBucket: vaultBucketForOrchestrator,
    // lp-zuh.9.2: STS mint + AWS_* inject when SANDBOX_VAULT_MOUNT_ROLE_ARN set.
    vaultMountSts: vaultMountStsResolved.issuer,
    awsRegion: vaultMountStsResolved.awsRegion,
    // lp-77d: wake latency / start failures / concurrent (safe fields only).
    logSafe: (fields) => {
      log.info("orchestrator_metric", fields);
    },
  });
  // Safe status only — never role external id, keys, or secret material.
  log.info("vault_mount_sts", {
    configured: vaultMountStsResolved.configured,
    role_arn_configured: vaultMountStsResolved.roleArnConfigured,
    duration_seconds: vaultMountStsResolved.durationSeconds,
    aws_region: vaultMountStsResolved.awsRegion,
    vault_bucket_configured: Boolean(vaultBucketForOrchestrator),
  });
  if (wakeRateLimiter.isEnabled()) {
    log.info("wake_rate_limit", {
      enabled: true,
      global_max_wakes: wakeRateLimitConfig.globalMaxWakes,
      tenant_max_wakes: wakeRateLimitConfig.tenantMaxWakes,
      window_ms: wakeRateLimitConfig.windowMs,
    });
  }
  idleReaperJob = createIdleReaperJob({
    reaper: instanceOrchestrator,
    idleGraceMs: idleReaperTiming.idleGraceMs,
    intervalMs: idleReaperTiming.intervalMs,
    logSafe: (event) => {
      log.info("idle_reaper", { ...event });
    },
  });
  idleReaperJob.start();
}

// lp-3a1.3: best-effort push of register/rotate secrets into Relay (multi-instance).
// Same RELAY_INTERNAL_URL + RELAY_INTERNAL_TOKEN as presence; omit when unset.
const relayInternalUrlForCredentials = resolveRelayInternalBaseUrl(process.env);
const relayInternalTokenForCredentials =
  process.env.RELAY_INTERNAL_TOKEN?.trim() || "";
const relayCredentials =
  relayInternalUrlForCredentials && relayInternalTokenForCredentials
    ? createHttpRelayCredentialsNotifier({
        baseUrl: relayInternalUrlForCredentials,
        internalToken: relayInternalTokenForCredentials,
      })
    : null;

// lp-oop.37.1: CP HTTP vault list/stat/get on live S3. Independent of
// Daytona — tree/list/get must not wake a sandbox. Safe fields only.
const vaultObjectStoreResolved = resolveS3VaultObjectStoreFromEnv(process.env);
log.info("vault_object_store", summarizeS3VaultObjectStoreForLog(vaultObjectStoreResolved));

const app = createApp(store, {
  serviceToken,
  authMode,
  devOpen,
  internalOpsToken: process.env.INTERNAL_OPS_TOKEN,
  daytonaWebhookSecret,
  orchestratorInstances,
  instanceOrchestrator,
  // lp-e96: archive sandboxes on revoke/deprovision when Daytona is ready.
  daytonaClient,
  // lp-9my / lp-e96: same material store — revoke path deletes wake-inject secret.
  secretMaterial,
  // lp-3a1.3: multi-instance secret seed after register/rotate (best-effort).
  relayCredentials,
  vaultBucket: process.env.S3_VAULT_BUCKET?.trim() || null,
  // lp-oop.37.1: live S3 adapter when S3_VAULT_BUCKET is set. Assumes
  // SANDBOX_VAULT_MOUNT_ROLE_ARN (task role has no direct S3). Omit → 501.
  vaultObjectStore: vaultObjectStoreResolved.store,
});

const dbKind = "postgres";
const dbSource = process.env.CONTROL_PLANE_DATABASE_URL
  ? "CONTROL_PLANE_DATABASE_URL"
  : "DATABASE_URL";

serve({ fetch: app.fetch, port }, (info) => {
  log.info("listening", {
    address: info.address,
    port: info.port,
    // Never log connection strings/secrets (G2b.2).
    db_kind: dbKind,
    db_source: dbSource,
    auth_mode: authMode,
    service_auth: serviceToken
      ? "configured"
      : devOpen
        ? "open"
        : "required",
    dev_open: devOpen,
    debug_payloads: log.debugPayloads,
    // Safe Daytona status only (lp-k8n) — never apiKey / allowlist ids.
    ...daytonaConfigLogSummary(daytonaConfig),
    // lp-0y3: reaper status (counts only; no instance ids at boot).
    idle_reaper_running: idleReaperJob?.isRunning() ?? false,
    idle_reaper_grace_ms: idleReaperTiming.idleGraceMs,
    idle_reaper_interval_ms: idleReaperTiming.intervalMs,
    // lp-rr5: whether ensure_online waits for Relay connected (no URLs/tokens).
    relay_presence_wait: relayPresenceWaitEnabled,
    // lp-3a1.2 / lp-oop.37.6: kind only (never KEY, envelope, or plaintext).
    secret_material: summarizeInstanceSecretMaterialStoreForLog(
      resolvedSecretMaterial,
    ),
    connector_kms: resolvedConnectorKms.kind,
  });
});
