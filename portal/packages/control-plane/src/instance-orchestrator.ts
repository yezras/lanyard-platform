/**
 * Instance Orchestrator module boundary (lp-7v5) + ensure_online singleflight
 * with timeout (lp-kng.2.1 offline + lp-nus Phase 4 HTTP wire) + presence store /
 * signal-activity / idle reaper (lp-kng.2.2) + runtime_kind dual-path (lp-kng.2.11)
 * + Relay connected wait after sandbox Started (lp-rr5)
 * + Orchestrator metrics: wake latency, start failures, concurrent (lp-77d)
 * + Wake rate limits / abuse controls on new ensure_online starts (lp-rq1)
 * + Wake strategy order + warm pool flag + retain-on-stop (lp-6bg / spike-bnd)
 * + Durable scheduled-job registry rematerialize on wake (lp-jzl.10.1).
 *
 * The orchestrator is a **client** of managed Daytona via {@link DaytonaClient}
 * only — never import the Daytona SDK. Offline tests inject
 * {@link real harnessClient}; live SDK wrapper is {@link createDaytonaSdkClient}
 * (`lp-012`).
 *
 * Dual-path (runtime_kind on instance model):
 *   ec2     → always-on short-circuit; no Daytona create/stop (path unchanged)
 *   daytona → ensure_online / stop via fake or live DaytonaClient
 *
 * Wake path (presence-state-machine.md / identity-model.md / spike-bnd) — lp-nus + lp-rr5 + lp-6bg:
 *   online + sandbox_id → return already_online (no second create)
 *   offline|error → waking → strategy order (fastest measured default):
 *     1. start existing stopped sandbox (start_from_stopped) when sandbox_id bound
 *        Bound+stopped never falls through to create (lp-vqr0.6 / T1).
 *     2. reuse a Daytona box already labeled with this instance_id (lp-vqr0.15)
 *     3. optional warm pool claim when premium/env flag on (unbound only)
 *     4. cold create from snapshot pin (cold_create) — only when unbound
 *        with no labeled box, or stale baked env (lp-180p)
 *     5. archive restore (start while archived) only when archiveRestoreOnWake
 *   create-ahead (lp-vqr0.7): ensureBoundStoppedSandbox create+start+stop+retain
 *     when sandbox_id is null so the next ensure_online is start_from_stopped
 *   when deps.relayPresence set: wait Relay WSS connected before online
 *     (sandbox Started alone is NOT online)
 *   vault_writable is independent (lp-vqr0.4): presence online = agent_ready;
 *     file tools wait via waitVaultWritable; ensure_online does not.
 *   never-connect: restart the same sandbox once, wait again; still fail → error
 *     (lp-vqr0.15: never cold-create a second box on Relay miss)
 *   concurrent ensure_online per instance_id joins one in-flight wake (singleflight)
 *   wait_timeout_ms while still waking → EnsureOnlineTimeoutError; inflight stays
 *     so retries join (lp-vqr0.15: 504 must not mint another Daytona create)
 *   new wake starts only: per-tenant + global sliding-window rate limit (lp-rq1);
 *     joiners / already_online / ec2 short-circuit do not consume quota
 *   when scheduledJobRegistry + guestCronMaterializer wired (lp-jzl.10.1): after
 *     sandbox Started (+ Relay wait), rematerialize platform SoT → guest
 *     `$BACKEND_HOME/cron/jobs.json` so stop/re-wake keeps a complete job list
 *
 * Idle path (lp-kng.2.2 offline + lp-0y3 job/loop + lp-84f signal-activity + lp-053 + lp-k5c4.4):
 *   signal-activity bumps last_activity_at
 *   createIdleReaperJob / reapIdle stops sandboxes past 10 min grace (real harness or live SDK)
 *   spine toolbox rooms annotate stop_after = last_turn_at + 45s; reaper honors it
 *   mid_turn lock blocks reaper while agent turn/tools active (timeout safety)
 *   idle_stop no-ops when mid_turn is active
 *   Default (lp-6bg): retain sandbox_id after stop so re-wake uses start_from_stopped
 *
 * Offline track: no live AWS, no real Daytona sandbox create/stop against paid org.
 * No tenant flips: runtime_kind is never mutated by ensure/stop.
 *
 * Metrics catalog: docs/plans/0008-daytona-agent-sandboxes/sandbox-orchestrator-metrics.md
 * Wake strategy: docs/plans/0008-daytona-agent-sandboxes/warm-pool-snapshot-wake.md
 * Durable jobs: docs/plans/0012-scheduled-tasks/durable-job-registry.md
 */

import type {
  CreateSandboxParams,
  DaytonaClient,
  DaytonaSandbox,
} from "./daytona-client.js";
import { isDaytonaClient } from "./daytona-client.js";
import {
  replenishWarmPool,
  scheduleWarmPoolReplenishOffStack,
  type WarmPool,
} from "./warm-pool.js";
import type { DaytonaConfig } from "./daytona-config.js";
import {
  applyGatewayRelayEnvToCreateParams,
  buildGatewayRelayEnv,
  MissingInstanceSecretMaterialError,
  type InstanceSecretMaterialStore,
} from "./gateway-relay-env.js";
import type {
  EnsureOnlineRequest,
  EnsureOnlineResponse,
  EnsureOnlineWakePath,
  InstancePresenceResponse,
  SignalActivityRequest,
  SignalActivityResponse,
  StopInstanceRequest,
  StopInstanceResponse,
} from "./orchestrator-api.js";
import { applyPresenceReason } from "./presence.js";
import {
  DEFAULT_VAULT_WRITABLE_POLL_INTERVAL_MS,
  DEFAULT_VAULT_WRITABLE_TIMEOUT_MS,
  instanceReadiness,
  isVaultWritableProbe,
  parseVaultWritable,
  waitUntilVaultWritable,
  type VaultWritableProbe,
  type WaitUntilVaultWritableOptions,
} from "./readiness.js";
import {
  assertRuntimeKindUnchanged,
  DaytonaPathGatedError,
  decideEnsureOnlinePath,
  decideStopPath,
} from "./runtime-path.js";
import {
  decideCreateAhead,
  type EnsureBoundStoppedSandboxResponse,
} from "./sandbox-create-ahead.js";
import {
  decideBoundSandboxWake,
  decideSandboxCreateGuard,
} from "./sandbox-wake-path.js";
import {
  applyVaultMountToCreateParams,
  buildSandboxVaultMountParams,
  DEFAULT_VAULT_MOUNT_PATH,
} from "./sandbox-vault-mount.js";
import {
  applySandboxVaultMountStsEnvToCreateParams,
  buildSandboxVaultMountStsEnv,
  DEFAULT_SANDBOX_VAULT_MOUNT_AWS_REGION,
  MAX_SANDBOX_VAULT_MOUNT_DURATION_SECONDS,
  SandboxVaultMountStsError,
  type SandboxVaultMountStsIssuer,
} from "./sandbox-vault-mount-sts.js";
import {
  applyProviderWakeEnvToCreateParams,
  buildProviderWakeEnv,
} from "./provider-wake-env.js";
import {
  applyShortStackCreateEnvInvariants,
  parseSandboxCreateProfile,
  type SandboxCreateProfile,
} from "./short-stack-create-env.js";
import { assertNoConnectorSecretsOnTenantEnv } from "./connector-user-sandbox.js";
import type { InstancePresence, RuntimeKind } from "./types.js";
import { assertS3VaultPrefixBoundToTenant } from "./vault-prefix.js";
import {
  DEFAULT_RELAY_CONNECT_POLL_INTERVAL_MS,
  DEFAULT_RELAY_CONNECT_TIMEOUT_MS,
  isRelayPresence,
  RELAY_CONNECT_RECREATE_ATTEMPTS,
  waitForRelayConnected,
  type RelayPresence,
} from "./relay-presence.js";
import {
  buildOrchestratorSafeLogFields,
  classifyOrchestratorFailure,
  OrchestratorMetrics,
  type OrchestratorSafeLogFields,
  type OrchestratorWakeOutcome,
  type OrchestratorWakePath,
} from "./orchestrator-metrics.js";
import {
  rematerializeScheduledJobsOnWake,
  type GuestCronMaterializer,
  type ScheduledJobRegistry,
} from "./scheduled-job-registry.js";
import {
  EnsureOnlineRateLimitedError,
  type WakeRateLimiter,
} from "./wake-rate-limit.js";

/** Re-export for callers that imported mount path from the orchestrator. */
export { DEFAULT_VAULT_MOUNT_PATH };

/** Default wait when request omits wait_timeout_ms (or passes 0 = use default). */
export const DEFAULT_ENSURE_ONLINE_WAIT_TIMEOUT_MS = 60_000;

/**
 * Idle grace before reaper stops a Daytona sandbox (10 minutes, lp-kng.8).
 *
 * Sandbox is agent compute only; Portal chat transcript lives in BFF.
 * Stop+retain after short idle cuts vCPU cost; next message uses
 * start_from_stopped. Override with `IDLE_REAPER_GRACE_MS`.
 */
export const DEFAULT_IDLE_GRACE_MS = 10 * 60 * 1000;

/**
 * Spine toolbox hot window (plan 0019 §4.4 / lp-k5c4.4).
 *
 * After a toolbox room lease drains, `stop_after = last_turn_at + 45s`.
 * The idle reaper honors it instead of waiting the 10m grace. CP remains
 * the sole Daytona stop owner.
 */
export const DEFAULT_SPINE_HOT_WINDOW_MS = 45_000;

/**
 * Max hold for a mid-turn lock when callers do not refresh (lp-053 safety).
 * Default 45 minutes — above the idle grace so a stuck lock cannot
 * pin a sandbox forever; BFF/gateway should re-signal mid_turn during long turns.
 */
export const DEFAULT_MID_TURN_MAX_HOLD_MS = 45 * 60 * 1000;

/**
 * lp-180p: max age of create-time guest env before warm start is refused.
 *
 * Cold create bakes vault-mount STS credentials (and gateway.env) into the
 * sandbox env; `daytona.start()` reuses that env and Daytona has no post-create
 * env PATCH. STS mount creds expire after
 * {@link MAX_SANDBOX_VAULT_MOUNT_DURATION_SECONDS} (1h), so waking a stopped
 * sandbox whose env is older than this TTL mounts with expired creds
 * (`Forbidden: The provided token has expired` → Mountpoint EPERM) while chat
 * relay still works. When the guard is active, wake treats such sandboxes as
 * cold-create so fresh AssumeRole + env inject land. Override with
 * deps.vaultEnvMaxAgeMs.
 */
export const DEFAULT_VAULT_ENV_MAX_AGE_MS =
  MAX_SANDBOX_VAULT_MOUNT_DURATION_SECONDS * 1000;

/**
 * Build the store patch for set/clear mid-turn (shared by orchestrator + HTTP).
 * When active, always sets an expiry (`mid_turn_until`) for timeout safety.
 */
export function resolveMidTurnPatch(
  active: boolean,
  now: Date,
  maxHoldMs: number = DEFAULT_MID_TURN_MAX_HOLD_MS,
): { mid_turn: boolean; mid_turn_until: string | null } {
  if (!active) {
    return { mid_turn: false, mid_turn_until: null };
  }
  const hold =
    Number.isFinite(maxHoldMs) && maxHoldMs > 0
      ? maxHoldMs
      : DEFAULT_MID_TURN_MAX_HOLD_MS;
  return {
    mid_turn: true,
    mid_turn_until: new Date(now.getTime() + hold).toISOString(),
  };
}

/**
 * Lease-driven stop_after annotation (lp-k5c4.4).
 *
 * `spine_work_arrived` clears the hot window (toolbox enqueue).
 * `spine_lease_empty` arms `stop_after = at + hotWindowMs`.
 * Work-arrived wins if both are set. Omitted → leave stop_after unchanged.
 */
export function resolveSpineHotWindowPatch(
  request: {
    spine_work_arrived?: boolean;
    spine_lease_empty?: boolean;
  },
  at: Date,
  hotWindowMs: number = DEFAULT_SPINE_HOT_WINDOW_MS,
): { stop_after: string | null } | undefined {
  if (request.spine_work_arrived === true) {
    return { stop_after: null };
  }
  if (request.spine_lease_empty !== true) {
    return undefined;
  }
  const hold =
    Number.isFinite(hotWindowMs) && hotWindowMs >= 0
      ? hotWindowMs
      : DEFAULT_SPINE_HOT_WINDOW_MS;
  return { stop_after: new Date(at.getTime() + hold).toISOString() };
}

/**
 * Whether a mid-turn lock currently blocks idle stop.
 * - mid_turn false/undefined → inactive
 * - mid_turn true + mid_turn_until in the future → active
 * - mid_turn true + mid_turn_until null (legacy seed) → active until explicit clear
 * - mid_turn true + mid_turn_until past → expired (caller should clear)
 */
export function isMidTurnLockActive(
  rec: {
    mid_turn?: boolean;
    mid_turn_until?: string | null;
  },
  nowMs: number,
): boolean {
  if (!rec.mid_turn) {
    return false;
  }
  if (rec.mid_turn_until == null || rec.mid_turn_until === "") {
    return true;
  }
  const untilMs = Date.parse(rec.mid_turn_until);
  if (Number.isNaN(untilMs)) {
    return true;
  }
  return nowMs < untilMs;
}

/**
 * Minimal instance row the orchestrator mutates during wake / activity / stop.
 * Maps to gateway_instances dual-run fields (lp-nye); store can be in-memory
 * for unit tests (lp-kng.2.2) or CP Postgres via createSqlOrchestratorInstanceStore
 * / ControlPlaneStore.asOrchestratorInstanceStore() (lp-omt).
 */
export type OrchestratorInstanceRecord = {
  instance_id: string;
  tenant_id: string;
  runtime_kind: RuntimeKind;
  presence: InstancePresence;
  sandbox_id: string | null;
  agent_snapshot_id: string | null;
  s3_vault_prefix: string | null;
  /**
   * Last activity ISO timestamp for idle reaper grace.
   * Bumped by signal-activity; set on successful ensure_online wake.
   */
  last_activity_at: string | null;
  /**
   * Mid-turn protection (lp-053): when true, idle reaper skips stop.
   * Cleared on turn end, explicit stop, or mid_turn_until timeout safety.
   */
  mid_turn?: boolean;
  /**
   * ISO expiry for mid_turn lock (lp-053). Null when lock inactive or
   * (legacy) when no expiry was recorded — treat as hold until clear.
   */
  mid_turn_until?: string | null;
  /** Soft-revoke; ensure_online rejects when set. */
  revoked_at?: string | null;
  /**
   * Mountpoint accepted a write (lp-vqr0.4). Independent of `presence`.
   * Default false. Wake to `online` does not set this true.
   */
  vault_writable?: boolean;
  /**
   * Spine toolbox hot-window deadline (lp-k5c4.4). ISO timestamp.
   * When set, the idle reaper stops at `stop_after` instead of 10m grace.
   * Null/omitted → default last_activity_at grace. Cleared on wake / work arrived.
   */
  stop_after?: string | null;
};

/** Presence + sandbox + activity patch surface. */
export type OrchestratorInstancePatch = {
  presence?: InstancePresence;
  sandbox_id?: string | null;
  last_activity_at?: string | null;
  mid_turn?: boolean;
  mid_turn_until?: string | null;
  vault_writable?: boolean;
  stop_after?: string | null;
};

/**
 * Instance metadata port for the orchestrator (offline in-memory or CP store).
 * Implementations must be safe for single-process concurrent awaits.
 *
 * Presence-sensitive paths (timeout → error, wake_succeeded) must use
 * {@link OrchestratorInstanceStore.compareAndUpdate} so a stale read cannot
 * clobber a concurrent transition (e.g. timeout overwriting online→error).
 */
export type OrchestratorInstanceStore = {
  get(instanceId: string): Promise<OrchestratorInstanceRecord | null>;
  update(
    instanceId: string,
    patch: OrchestratorInstancePatch,
  ): Promise<OrchestratorInstanceRecord>;
  /**
   * Atomic compare-and-swap on presence: apply `patch` only when current
   * presence equals `expectedPresence`. Returns the updated record, or `null`
   * when the instance is missing or presence no longer matches (lost race).
   */
  compareAndUpdate(
    instanceId: string,
    expectedPresence: InstancePresence,
    patch: OrchestratorInstancePatch,
  ): Promise<OrchestratorInstanceRecord | null>;
  /**
   * List all instance rows (idle reaper scan). Offline in-memory returns all;
   * live CP store may filter to daytona runtime later.
   */
  list(): Promise<OrchestratorInstanceRecord[]>;
};

/** Outcome of one idle reaper pass (unit-testable; fake Daytona only offline). */
export type IdleReaperResult = {
  /** How many instance rows were scanned. */
  scanned: number;
  /** instance_ids that were idle-stopped (fake stop invoked when sandbox bound). */
  stopped: string[];
  /** instance_ids skipped because mid_turn was set. */
  skipped_mid_turn: string[];
  /** instance_ids still within idle grace (or not online daytona). */
  skipped_not_idle: string[];
  /** Per-instance stop failures (best-effort reaper continues). */
  errors: Array<{ instance_id: string; error: string }>;
};

/** Options for {@link InstanceOrchestrator.reapIdle}. */
export type ReapIdleOptions = {
  /** Override clock (tests inject fixed time). */
  now?: Date;
  /** Override idle grace ms (default deps.idleGraceMs / 10 min). */
  idleGraceMs?: number;
};

/**
 * Dependencies the orchestrator may use.
 * `daytona` is required; `instances` is required for ensureOnline / activity / reaper.
 */
export type InstanceOrchestratorDeps = {
  /** Managed Daytona client (fake offline; real SDK live after lp-012). */
  daytona: DaytonaClient;
  /**
   * Instance presence / sandbox_id / last_activity_at store.
   * Required for ensureOnline, signalActivity, stop, reapIdle.
   */
  instances?: OrchestratorInstanceStore;
  /** Platform default snapshot when instance.agent_snapshot_id is null. */
  defaultSnapshotId?: string;
  /** Default region for create when not otherwise configured. */
  defaultRegion?: string;
  /**
   * Default wait_timeout_ms when request omits it or passes 0.
   * @default DEFAULT_ENSURE_ONLINE_WAIT_TIMEOUT_MS
   */
  defaultWaitTimeoutMs?: number;
  /**
   * Guest mount path for `s3_vault_prefix` (= gateway `VAULT_ROOT`).
   * @default DEFAULT_VAULT_MOUNT_PATH (`/mnt/vault`, entrypoint parity)
   */
  vaultMountPath?: string;
  /**
   * Platform vault bucket bare name (`vault.bucket` / pilot lab bucket).
   * When set with `s3_vault_prefix`, create params include `s3Bucket` on the
   * mount spec and `LANYARD_VAULT_BUCKET` env for Mountpoint helpers (lp-hjo).
   */
  vaultBucket?: string | null;
  /**
   * STS issuer for short-lived AWS mount creds (lp-zuh.9.2 / lp-zuh.8).
   * When set with `s3_vault_prefix` + `vaultBucket`, cold create AssumeRoles
   * the shared vault-mount role with a tenant-bound session policy and injects
   * AWS_ACCESS_KEY_ID / SECRET / SESSION_TOKEN + AWS_REGION into guest env.
   * Fail closed on AssumeRole failure. Omit for pure offline mount-param tests.
   * Re-issue on every cold create (warm start reuses create-time env; Daytona
   * has no post-create env PATCH).
   */
  vaultMountSts?: SandboxVaultMountStsIssuer | null;
  /**
   * lp-180p: max age (ms) of create-time guest env before a stopped sandbox
   * is cold-created instead of warm-started. Only applies when expiring env
   * was actually baked (vaultMountSts + s3_vault_prefix + vaultBucket set);
   * instances without vault mounts always keep the fast warm path.
   * @default DEFAULT_VAULT_ENV_MAX_AGE_MS (1h, matches STS TTL)
   */
  vaultEnvMaxAgeMs?: number;
  /**
   * Guest AWS_REGION / AWS_DEFAULT_REGION for Mountpoint (lp-zuh.9.2).
   * @default process AWS_REGION / AWS_DEFAULT_REGION / us-east-1
   */
  awsRegion?: string | null;
  /**
   * Clock for last_activity_at + idle reaper.
   * @default () => new Date()
   */
  now?: () => Date;
  /**
   * Idle grace before reaper stops online Daytona sandboxes.
   * @default DEFAULT_IDLE_GRACE_MS (10 minutes)
   */
  idleGraceMs?: number;
  /**
   * Max mid-turn lock hold when set without refresh (lp-053).
   * @default DEFAULT_MID_TURN_MAX_HOLD_MS (45 minutes)
   */
  midTurnMaxHoldMs?: number;
  /**
   * Optional platform Daytona config for dual-path gates (lp-kng.2.11).
   * When set, ensure_online on runtime_kind=daytona requires enabled + allowlist.
   * Omit for pure offline unit tests (daytona kind always uses fake wake).
   * Never flips runtime_kind; fails closed with {@link DaytonaPathGatedError}.
   */
  daytonaConfig?: Pick<DaytonaConfig, "enabled" | "tenantAllowlist"> | null;
  /**
   * Relay presence port (lp-rr5). When set, ensure_online waits for gateway
   * WSS connected after sandbox Started before presence → online.
   * Omit only for pure Daytona unit tests that do not cover Relay; production
   * and relay-wait tests must inject FakeRelayPresence or HTTP adapter.
   */
  relayPresence?: RelayPresence | null;
  /**
   * Guest Mountpoint write probe (lp-vqr0.4). File-tool wait uses this.
   * ensure_online must not wait on it. Omit in tests that do not cover vault.
   */
  vaultWritable?: VaultWritableProbe | null;
  /**
   * Per-attempt wait for Relay connected after sandbox Started (lp-rr5).
   * @default DEFAULT_RELAY_CONNECT_TIMEOUT_MS (45s)
   */
  relayConnectTimeoutMs?: number;
  /**
   * Poll interval while waiting for Relay connected (lp-rr5).
   * @default DEFAULT_RELAY_CONNECT_POLL_INTERVAL_MS (250ms)
   */
  relayConnectPollIntervalMs?: number;
  /**
   * Wake / stop metrics sink (lp-77d). When omitted, a private
   * {@link OrchestratorMetrics} instance is created for this orchestrator.
   */
  metrics?: OrchestratorMetrics;
  /**
   * Optional structured log sink for wake/stop metric events (safe fields only).
   * Never pass secrets; fields are already scrubbed via buildOrchestratorSafeLogFields.
   */
  logSafe?: (fields: Record<string, unknown>) => void;
  /**
   * Platform plaintext material for GATEWAY_RELAY_* create-time inject (lp-9my).
   * When set, cold create resolves material by instance_id and merges env
   * (spike-4l5 path). Missing material → fail closed with
   * {@link MissingInstanceSecretMaterialError}. Warm start does not re-inject
   * (Daytona has no post-create env PATCH; rotation = next cold recreate).
   * Omit only for pure Daytona unit tests that do not cover Relay dial.
   */
  secretMaterial?: InstanceSecretMaterialStore | null;
  /**
   * Optional wake rate limiter for new ensure_online starts (lp-rq1).
   * When omitted or disabled (max 0), no rate limiting.
   * Does not apply to singleflight joiners or already_online short-circuits.
   */
  wakeRateLimiter?: WakeRateLimiter | null;
  /**
   * lp-6bg: after idle/explicit stop, keep `sandbox_id` bound so the next
   * ensure_online can use start-from-stopped (spike-bnd fastest warm path).
   * When false, clear binding (forces cold_create on re-wake).
   * @default true
   */
  retainSandboxOnStop?: boolean;
  /**
   * lp-6bg / lp-vqr0.10: optional warm pool for premium / flagged tenants.
   * When true (or tenant is on the warm-pool allowlist), unbound cold path
   * claims a pre-created stopped id then starts (path `warm_pool`). Miss
   * still cold_creates. Inject {@link warmPool} for real hits.
   * @default false
   */
  warmPoolEnabled?: boolean;
  /**
   * Optional tenant allowlist for warm pool (premium flag stub).
   * When non-empty, only listed tenants attempt pool claim even if
   * `warmPoolEnabled` is true. Empty + warmPoolEnabled → all tenants.
   */
  warmPoolTenantAllowlist?: readonly string[];
  /**
   * In-process pool of stopped sandbox ids keyed by snapshot pin (lp-vqr0.10).
   * Not the instance table. Omit → attempts miss (metrics still increment).
   */
  warmPool?: WarmPool | null;
  /**
   * Schedule replenish off the ensure_online stack after a claim attempt.
   * Default is `setImmediate`. Tests inject a collector to prove Send
   * does not wait on refill creates.
   */
  scheduleWarmPoolReplenish?: (task: () => Promise<void>) => void;
  /**
   * lp-6bg: when bound sandbox is **archived**, try `start` (restore) before
   * cold create. Default false — archive is extended-idle / cost tier only
   * (spike-bnd: not the product idle-reaper path).
   * @default false
   */
  archiveRestoreOnWake?: boolean;
  /**
   * lp-jzl.10.1: platform SoT for scheduled job definitions (survives guest
   * BACKEND_HOME wipe). When set with {@link guestCronMaterializer}, ensure_online
   * rematerializes jobs into the guest after sandbox Started.
   * Omit for pure Daytona unit tests that do not cover cron durability.
   */
  scheduledJobRegistry?: ScheduledJobRegistry | null;
  /**
   * lp-jzl.10.1: guest writer for `$BACKEND_HOME/cron/jobs.json`.
   * Fake in-memory for offline tests; live Daytona FS adapter is follow-on.
   */
  guestCronMaterializer?: GuestCronMaterializer | null;
  /**
   * Guest BACKEND_HOME absolute path used when rematerializing jobs (lp-jzl.10.1).
   * @default DEFAULT_GUEST_BACKEND_HOME (`/var/lib/company-brain-backend`)
   */
  guestBackendHome?: string;
  /**
   * lp-2qs.4: per-tenant Class B provider secrets (CP Postgres + KMS).
   * When set, cold create decrypts env-kind slots for `tenant_id`; those
   * values win over process-env providers for the same slot. Omit for pure
   * offline tests without tenant secrets.
   */
  tenantProviderSecrets?: TenantProviderSecretSource | null;
};

/**
 * Minimal decrypt surface so tests inject a fake instead of Postgres + KMS.
 * Values are secrets — never log the returned map.
 */
export type TenantProviderSecretSource = {
  listEnvValues(tenantId: string): Promise<Record<string, string>>;
};

/**
 * Compute strategy labels used by ensureSandboxStarted (lp-6bg / spike-bnd).
 * Distinct from short-circuit paths (already_online / joined / ec2).
 *
 * `cold_create_env_expired` (lp-180p) is a cold create that was forced because
 * the bound stopped sandbox's baked env (vault STS creds) was past its TTL —
 * kept distinct from plain cold_create so warm-vs-cold latency comparisons
 * are not polluted by expiry-driven recreates.
 */
export type OrchestratorComputeWakePath =
  | "start_from_stopped"
  | "cold_create"
  | "cold_create_env_expired"
  | "archive_restore"
  | "warm_pool";

/** Thrown when ensure_online targets an unknown instance_id. */
export class OrchestratorInstanceNotFoundError extends Error {
  readonly code = "ORCHESTRATOR_INSTANCE_NOT_FOUND" as const;
  readonly instanceId: string;

  constructor(instanceId: string) {
    super(`Instance not found: ${instanceId}`);
    this.name = "OrchestratorInstanceNotFoundError";
    this.instanceId = instanceId;
  }
}

/** Thrown when ensure_online is called for a revoked instance. */
export class OrchestratorInstanceRevokedError extends Error {
  readonly code = "ORCHESTRATOR_INSTANCE_REVOKED" as const;
  readonly instanceId: string;

  constructor(instanceId: string) {
    super(`Instance is revoked: ${instanceId}`);
    this.name = "OrchestratorInstanceRevokedError";
    this.instanceId = instanceId;
  }
}

/**
 * Thrown when wait_timeout_ms elapses while presence is still waking.
 * Presence is transitioned to `error` (wake_failed) best-effort.
 */
export class EnsureOnlineTimeoutError extends Error {
  readonly code = "ENSURE_ONLINE_TIMEOUT" as const;
  readonly instanceId: string;
  readonly waitTimeoutMs: number;

  constructor(instanceId: string, waitTimeoutMs: number) {
    super(
      `ensure_online timed out after ${waitTimeoutMs}ms for instance ${instanceId}`,
    );
    this.name = "EnsureOnlineTimeoutError";
    this.instanceId = instanceId;
    this.waitTimeoutMs = waitTimeoutMs;
  }
}

/** Thrown when wake create/start fails (presence → error). */
export class EnsureOnlineWakeError extends Error {
  readonly code = "ENSURE_ONLINE_WAKE_FAILED" as const;
  readonly instanceId: string;
  readonly causeError: unknown;

  constructor(instanceId: string, cause: unknown) {
    const msg =
      cause instanceof Error ? cause.message : `wake failed: ${String(cause)}`;
    super(`ensure_online wake failed for instance ${instanceId}: ${msg}`);
    this.name = "EnsureOnlineWakeError";
    this.instanceId = instanceId;
    this.causeError = cause;
  }
}

/** Thrown when create-ahead create/start/stop fails (lp-vqr0.7). */
export class EnsureBoundStoppedSandboxError extends Error {
  readonly code = "ENSURE_BOUND_STOPPED_FAILED" as const;
  readonly instanceId: string;
  readonly causeError: unknown;

  constructor(instanceId: string, cause: unknown) {
    const msg =
      cause instanceof Error
        ? cause.message
        : `create-ahead failed: ${String(cause)}`;
    super(
      `ensureBoundStoppedSandbox failed for instance ${instanceId}: ${msg}`,
    );
    this.name = "EnsureBoundStoppedSandboxError";
    this.instanceId = instanceId;
    this.causeError = cause;
  }
}

/**
 * Bound orchestrator handle: Daytona lifecycle + ensure_online singleflight +
 * presence activity / idle reaper (lp-kng.2.2) + runtime_kind dual-path (lp-kng.2.11).
 */
export type InstanceOrchestrator = {
  readonly daytona: DaytonaClient;
  /**
   * Create-from-snapshot via the injected client (wake building block).
   */
  createSandbox(params: CreateSandboxParams): Promise<DaytonaSandbox>;
  startSandbox(sandboxId: string): Promise<DaytonaSandbox>;
  stopSandbox(sandboxId: string): Promise<DaytonaSandbox>;
  archiveSandbox(sandboxId: string): Promise<DaytonaSandbox>;
  getSandbox(sandboxId: string): Promise<DaytonaSandbox>;
  listSandboxes: DaytonaClient["list"];
  /**
   * Wake path: offline|error → waking → Started → (Relay connected) → online.
   * Dual-path: ec2 short-circuits without Daytona; daytona uses client.
   * When relayPresence is set, does not mark online on sandbox start alone (lp-rr5).
   * Concurrent calls for the same instance_id singleflight.
   * Timeout while waking → presence error + {@link EnsureOnlineTimeoutError}.
   * Successful wake sets last_activity_at so idle grace starts.
   */
  ensureOnline(
    instanceId: string,
    request?: EnsureOnlineRequest,
  ): Promise<EnsureOnlineResponse>;
  /**
   * Create-ahead (lp-vqr0.7): when sandbox_id is null, create+start+stop+retain
   * so the next ensure_online is start_from_stopped. Idempotent if already bound
   * (does not create, does not stop a live session).
   * Does not wait Relay or promote presence online.
   */
  ensureBoundStoppedSandbox(
    instanceId: string,
  ): Promise<EnsureBoundStoppedSandboxResponse>;
  /** Read presence + dual-run fields including last_activity_at. */
  getPresence(instanceId: string): Promise<InstancePresenceResponse>;
  /**
   * File-tool path: wait until vault_writable (lp-vqr0.4 / T3).
   * Does not change presence. Chat / ensure_online must not call this.
   */
  waitVaultWritable(
    instanceId: string,
    options?: WaitVaultWritableRequest,
  ): Promise<WaitVaultWritableResult>;
  /**
   * Bump last_activity_at (idle timer refresh). Optional `at` ISO timestamp.
   */
  signalActivity(
    instanceId: string,
    request?: SignalActivityRequest,
  ): Promise<SignalActivityResponse>;
  /**
   * Stop path dual-path (lp-kng.2.11) + presence offline:
   * - ec2: no-op always-on (does not call Daytona; host stays up)
   * - daytona: stop bound sandbox if any; retain sandbox_id by default (lp-6bg)
   *   so re-wake can start-from-stopped; presence → offline
   * Never mutates runtime_kind. Clears mid_turn on stop.
   */
  stop(
    instanceId: string,
    request?: StopInstanceRequest,
  ): Promise<StopInstanceResponse>;
  /**
   * Mid-turn protection (lp-053): when active, reapIdle skips this instance.
   * Sets mid_turn_until = now + maxHoldMs (timeout safety). Clears on active=false.
   */
  setMidTurn(
    instanceId: string,
    active: boolean,
    options?: SetMidTurnOptions,
  ): Promise<SetMidTurnResult>;
  /**
   * Scan presence store; stop online Daytona instances past idle grace.
   * Invokes fake/live Daytona stop only — no live AWS.
   * Mid-turn rows are skipped; expired mid_turn locks are cleared (timeout safety).
   */
  reapIdle(options?: ReapIdleOptions): Promise<IdleReaperResult>;
  /** Test/ops: number of in-flight singleflight wakes. */
  inflightWakeCount(): number;
  /** lp-77d: wake latency / failure / concurrent sandbox metrics. */
  metrics(): OrchestratorMetrics;
};

/** Options for {@link InstanceOrchestrator.setMidTurn}. */
export type SetMidTurnOptions = {
  /** Override max hold ms (default deps.midTurnMaxHoldMs / 45 min). */
  maxHoldMs?: number;
  /** Override clock for until computation (tests). */
  at?: Date;
};

/** Result of set/clear mid-turn. */
export type SetMidTurnResult = {
  instance_id: string;
  mid_turn: boolean;
  mid_turn_until: string | null;
};

/** File-tool wait on Mountpoint writable (lp-vqr0.4). Not a chat gate. */
export type WaitVaultWritableRequest = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: WaitUntilVaultWritableOptions["sleep"];
  now?: WaitUntilVaultWritableOptions["now"];
};

export type WaitVaultWritableResult = {
  instance_id: string;
  presence: InstancePresence;
  agent_ready: boolean;
  vault_writable: boolean;
};

/**
 * Bind an orchestrator to a {@link DaytonaClient} (+ optional instance store).
 * @throws {TypeError} when `deps.daytona` does not implement the interface
 */
export function createInstanceOrchestrator(
  deps: InstanceOrchestratorDeps,
): InstanceOrchestrator {
  if (!isDaytonaClient(deps.daytona)) {
    throw new TypeError(
      "InstanceOrchestrator requires a DaytonaClient (create/start/stop/archive/get/list)",
    );
  }
  const daytona = deps.daytona;
  const instances = deps.instances;
  const defaultSnapshotId = deps.defaultSnapshotId?.trim() || "";
  const defaultRegion = deps.defaultRegion?.trim() || "us";
  const defaultWaitTimeoutMs =
    deps.defaultWaitTimeoutMs !== undefined && deps.defaultWaitTimeoutMs > 0
      ? deps.defaultWaitTimeoutMs
      : DEFAULT_ENSURE_ONLINE_WAIT_TIMEOUT_MS;
  const vaultMountPath =
    deps.vaultMountPath?.trim() || DEFAULT_VAULT_MOUNT_PATH;
  const vaultBucket = deps.vaultBucket?.trim() || null;
  const vaultMountSts = deps.vaultMountSts ?? null;
  // lp-180p: warm start refuses baked env older than this (STS TTL default).
  const vaultEnvMaxAgeMs =
    deps.vaultEnvMaxAgeMs !== undefined && deps.vaultEnvMaxAgeMs > 0
      ? deps.vaultEnvMaxAgeMs
      : DEFAULT_VAULT_ENV_MAX_AGE_MS;
  const awsRegion =
    deps.awsRegion?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    DEFAULT_SANDBOX_VAULT_MOUNT_AWS_REGION;
  const nowFn = deps.now ?? (() => new Date());
  const defaultIdleGraceMs =
    deps.idleGraceMs !== undefined && deps.idleGraceMs >= 0
      ? deps.idleGraceMs
      : DEFAULT_IDLE_GRACE_MS;
  const defaultMidTurnMaxHoldMs =
    deps.midTurnMaxHoldMs !== undefined && deps.midTurnMaxHoldMs > 0
      ? deps.midTurnMaxHoldMs
      : DEFAULT_MID_TURN_MAX_HOLD_MS;
  const daytonaConfig = deps.daytonaConfig ?? null;
  const relayPresence =
    deps.relayPresence && isRelayPresence(deps.relayPresence)
      ? deps.relayPresence
      : null;
  const vaultWritableProbe =
    deps.vaultWritable && isVaultWritableProbe(deps.vaultWritable)
      ? deps.vaultWritable
      : null;
  const relayConnectTimeoutMs =
    deps.relayConnectTimeoutMs !== undefined && deps.relayConnectTimeoutMs > 0
      ? deps.relayConnectTimeoutMs
      : DEFAULT_RELAY_CONNECT_TIMEOUT_MS;
  const relayConnectPollIntervalMs =
    deps.relayConnectPollIntervalMs !== undefined &&
    deps.relayConnectPollIntervalMs >= 0
      ? deps.relayConnectPollIntervalMs
      : DEFAULT_RELAY_CONNECT_POLL_INTERVAL_MS;
  const metrics = deps.metrics ?? new OrchestratorMetrics();
  const logSafe = deps.logSafe;
  const secretMaterial = deps.secretMaterial ?? null;
  const wakeRateLimiter =
    deps.wakeRateLimiter && deps.wakeRateLimiter.isEnabled()
      ? deps.wakeRateLimiter
      : null;
  // lp-6bg defaults: retain binding for start-from-stopped; warm pool off;
  // archive restore opt-in only (extended idle, not product idle grace).
  const retainSandboxOnStop = deps.retainSandboxOnStop !== false;
  const warmPoolEnabled = deps.warmPoolEnabled === true;
  const warmPoolTenantAllowlist = (deps.warmPoolTenantAllowlist ?? [])
    .map((t) => t.trim())
    .filter(Boolean);
  const warmPool = deps.warmPool ?? null;
  const scheduleWarmPoolReplenish =
    deps.scheduleWarmPoolReplenish ?? scheduleWarmPoolReplenishOffStack;
  const archiveRestoreOnWake = deps.archiveRestoreOnWake === true;
  const scheduledJobRegistry = deps.scheduledJobRegistry ?? null;
  const guestCronMaterializer = deps.guestCronMaterializer ?? null;
  const guestBackendHome = deps.guestBackendHome?.trim() || undefined;
  const tenantProviderSecrets = deps.tenantProviderSecrets ?? null;

  /** Per-instance_id singleflight: one wake promise at a time. */
  const inflight = new Map<string, Promise<EnsureOnlineResponse>>();
  /** Per-instance_id singleflight for create-ahead (lp-vqr0.7). */
  const createAheadInflight = new Map<
    string,
    Promise<EnsureBoundStoppedSandboxResponse>
  >();

  function tenantMayUseWarmPool(tenantId: string): boolean {
    if (!warmPoolEnabled) return false;
    if (warmPoolTenantAllowlist.length === 0) return true;
    return warmPoolTenantAllowlist.includes(tenantId.trim());
  }

  function schedulePoolReplenish(snapshotId: string): void {
    if (!warmPool) return;
    const pin = snapshotId.trim();
    if (!pin) return;
    scheduleWarmPoolReplenish(async () => {
      await replenishWarmPool({
        daytona,
        pool: warmPool,
        snapshotId: pin,
        region: defaultRegion,
      });
    });
  }

  function emitMetricLog(fields: OrchestratorSafeLogFields): void {
    if (!logSafe) return;
    try {
      logSafe(buildOrchestratorSafeLogFields(fields));
    } catch {
      // never fail wake/stop because of logging
    }
  }

  function recordWakeAndLog(
    input: Parameters<OrchestratorMetrics["recordWake"]>[0],
  ): void {
    metrics.setConcurrentWaking(inflight.size);
    const fields = metrics.recordWake(input);
    emitMetricLog(fields);
  }

  function outcomeFromError(err: unknown): OrchestratorWakeOutcome {
    if (err instanceof EnsureOnlineTimeoutError) return "timeout";
    if (err instanceof OrchestratorInstanceNotFoundError) return "not_found";
    if (err instanceof OrchestratorInstanceRevokedError) return "revoked";
    if (err instanceof DaytonaPathGatedError) return "path_gated";
    if (err instanceof EnsureOnlineRateLimitedError) return "rate_limited";
    return "error";
  }

  function requireStore(): OrchestratorInstanceStore {
    if (!instances) {
      throw new TypeError(
        "InstanceOrchestrator presence/wake/stop/reaper requires deps.instances (OrchestratorInstanceStore)",
      );
    }
    return instances;
  }

  function isoNow(override?: Date): string {
    return (override ?? nowFn()).toISOString();
  }

  async function loadInstance(
    store: OrchestratorInstanceStore,
    instanceId: string,
  ): Promise<OrchestratorInstanceRecord> {
    const rec = await store.get(instanceId);
    if (!rec) {
      throw new OrchestratorInstanceNotFoundError(instanceId);
    }
    if (rec.revoked_at) {
      throw new OrchestratorInstanceRevokedError(instanceId);
    }
    return rec;
  }

  function toResponse(
    rec: OrchestratorInstanceRecord,
    flags: { already_online: boolean; wake_joined: boolean },
  ): EnsureOnlineResponse {
    const readiness = instanceReadiness(rec.presence, rec.vault_writable);
    return {
      instance_id: rec.instance_id,
      tenant_id: rec.tenant_id,
      presence: rec.presence,
      sandbox_id: rec.sandbox_id,
      runtime_kind: rec.runtime_kind,
      already_online: flags.already_online,
      wake_joined: flags.wake_joined,
      agent_ready: readiness.agent_ready,
      vault_writable: readiness.vault_writable,
    };
  }

  function toEnsureOnlineWakePath(
    path: OrchestratorWakePath,
  ): EnsureOnlineWakePath {
    if (path === "cold") return "cold_create";
    if (path === "warm") return "start_from_stopped";
    return path;
  }

  /**
   * Timeout / failure helper: presence waking → error **only if still waking**.
   * Uses compare-and-swap so a successful wake that raced to online is not
   * clobbered (TOCTOU: get-then-unconditional-update is unsafe across awaits).
   */
  async function markErrorIfWaking(instanceId: string): Promise<boolean> {
    const store = requireStore();
    try {
      const updated = await store.compareAndUpdate(instanceId, "waking", {
        presence: applyPresenceReason("waking", "wake_failed"),
      });
      return updated !== null;
    } catch {
      // best-effort for timeout path
      return false;
    }
  }

  /**
   * Build create params for cold wake (snapshot + vault mount + optional)
   * STS mount creds lp-zuh.9.2 + GATEWAY_RELAY_* inject when secretMaterial is
   * wired — lp-9my / spike-4l5).
   *
   * `tool_only` (lp-oop.28): skip Relay secret + provider keys; guest is a
   * toolbox, not a host. Default `guest_gateway` keeps today's inject.
   */
  async function buildCreateParams(
    rec: OrchestratorInstanceRecord,
    snapshotId: string,
    profile: SandboxCreateProfile,
  ): Promise<CreateSandboxParams> {
    let createParams: CreateSandboxParams = {
      snapshotId,
      region: defaultRegion,
      labels: {
        instance_id: rec.instance_id,
        tenant_id: rec.tenant_id,
      },
    };
    if (rec.s3_vault_prefix) {
      // lp-3a1.1: re-validate shape + tenant segment before create env inject.
      // Mis-set / foreign CP prefix must fail closed (no mount of other tenant).
      const boundPrefix = assertS3VaultPrefixBoundToTenant(
        rec.s3_vault_prefix,
        rec.tenant_id,
      );
      const vaultMount = buildSandboxVaultMountParams({
        s3VaultPrefix: boundPrefix,
        vaultRoot: vaultMountPath,
        vaultBucket,
      });
      createParams = applyVaultMountToCreateParams(createParams, vaultMount);

      // lp-zuh.9.2: when vault is fully configured (prefix + bucket) and an STS
      // issuer is wired, mint short-lived AWS_* for mount-s3. Fail closed on
      // AssumeRole failure so cold boot does not land without vault creds.
      const mountBucket = vaultMount.vaultBucket?.trim() || null;
      if (vaultMountSts && mountBucket) {
        try {
          const creds = await vaultMountSts.mint({
            instanceId: rec.instance_id,
            tenantId: rec.tenant_id,
            vaultBucket: mountBucket,
            s3VaultPrefix: vaultMount.s3Prefix,
          });
          const stsEnv = buildSandboxVaultMountStsEnv({
            credentials: creds,
            awsRegion,
          });
          createParams = applySandboxVaultMountStsEnvToCreateParams(
            createParams,
            stsEnv,
          );
        } catch (err) {
          if (err instanceof SandboxVaultMountStsError) {
            throw err;
          }
          const msg =
            err instanceof Error ? err.message : "vault mount STS mint failed";
          throw new SandboxVaultMountStsError(
            "ASSUME_ROLE_FAILED",
            `vault mount STS mint failed for instance ${rec.instance_id}: ${msg}`,
            { cause: err },
          );
        }
      }
    }
    if (profile === "tool_only") {
      // Harness holds provider keys, Relay, and HTTP search keys.
      // Guest create env is denylisted (lp-oop.28 / lp-oop.38.12).
      return guardConnectorCreateEnv(
        applyShortStackCreateEnvInvariants(createParams),
      );
    }
    // Bucket C: Relay credentials from platform material store (not Postgres).
    if (secretMaterial) {
      const material = await secretMaterial.get(rec.instance_id);
      if (!material?.secret) {
        throw new MissingInstanceSecretMaterialError(rec.instance_id);
      }
      const relayEnv = buildGatewayRelayEnv({
        instanceId: rec.instance_id,
        relayWssUrl: material.relay_wss_url,
        secret: material.secret,
      });
      createParams = applyGatewayRelayEnvToCreateParams(createParams, relayEnv);
    }
    // Model/provider keys from CP process env (ECS SM) → guest LiteLLM.
    // lp-2qs.4: tenant Class B rows (ops secrets UI) win over process env for
    // that slot; missing slots keep the shared process-env fallback.
    let providerWakeEnv = buildProviderWakeEnv();
    if (tenantProviderSecrets) {
      const tenantEnv = await tenantProviderSecrets.listEnvValues(
        rec.tenant_id,
      );
      providerWakeEnv = { ...providerWakeEnv, ...tenantEnv };
    }
    createParams = applyProviderWakeEnvToCreateParams(
      createParams,
      providerWakeEnv,
    );
    return guardConnectorCreateEnv(createParams);
  }

  /** Lazy inject is post-wake; create env must never carry connector secrets. */
  function guardConnectorCreateEnv(
    params: CreateSandboxParams,
  ): CreateSandboxParams {
    assertNoConnectorSecretsOnTenantEnv(params.env);
    return params;
  }

  /**
   * Cold create (+ start if create lands stopped). Does not warm-start an
   * existing sandbox_id — used for first wake and for never-connect recreate.
   *
   * Daytona create often returns transitional `creating` before the sandbox is
   * fully up. Poll get until started/stopped/error so we do not fail-closed on
   * the first response and thrash create (CPU quota).
   */
  async function coldCreateStarted(
    rec: OrchestratorInstanceRecord,
    snapshotId: string,
    profile: SandboxCreateProfile,
  ): Promise<DaytonaSandbox> {
    let sandbox = await daytona.create(
      await buildCreateParams(rec, snapshotId, profile),
    );
    sandbox = await waitSandboxReady(sandbox);
    if (sandbox.state === "stopped") {
      sandbox = await daytona.start(sandbox.sandboxId);
      sandbox = await waitSandboxReady(sandbox);
    }
    if (sandbox.state !== "started") {
      throw new Error(
        `Sandbox ${sandbox.sandboxId} not started (state=${sandbox.state})`,
      );
    }
    return sandbox;
  }

  /**
   * Poll Daytona until the sandbox leaves transitional states (`creating`) or
   * the deadline elapses. Returns the last observed record.
   */
  async function waitSandboxReady(
    sandbox: DaytonaSandbox,
    options?: { timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<DaytonaSandbox> {
    const timeoutMs =
      options?.timeoutMs !== undefined && options.timeoutMs > 0
        ? options.timeoutMs
        : 120_000;
    const pollIntervalMs =
      options?.pollIntervalMs !== undefined && options.pollIntervalMs >= 0
        ? options.pollIntervalMs
        : 1_000;
    const deadline = Date.now() + timeoutMs;
    let current = sandbox;
    while (
      (current.state === "creating" ||
        (current.state as string) === "starting") &&
      Date.now() < deadline
    ) {
      await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
      try {
        current = await daytona.get(current.sandboxId);
      } catch {
        // transient get blip — keep last known state until deadline
      }
    }
    return current;
  }

  /**
   * lp-180p: whether this wake carries expiring create-time env that a warm
   * start cannot refresh. True only when the cold path actually bakes STS
   * mount creds (issuer wired + tenant vault prefix + bucket configured) —
   * instances without vault mounts keep the fast warm path forever.
   */
  function bakedVaultEnvExpires(rec: OrchestratorInstanceRecord): boolean {
    return (
      vaultMountSts !== null &&
      Boolean(rec.s3_vault_prefix?.trim()) &&
      Boolean(vaultBucket)
    );
  }

  /**
   * lp-180p: stale = updatedAt (last state change ≈ stop time) older than
   * vaultEnvMaxAgeMs. Unparseable timestamps fail safe to stale so an unknown
   * age can never warm-start with possibly-expired creds.
   */
  function sandboxEnvIsStale(sandbox: DaytonaSandbox, nowMs: number): boolean {
    const updatedMs = Date.parse(sandbox.updatedAt);
    if (Number.isNaN(updatedMs)) {
      return true;
    }
    return nowMs - updatedMs >= vaultEnvMaxAgeMs;
  }

  /**
   * Default wake strategy order (lp-6bg / spike-bnd latencies):
   *   1. start_from_stopped — bound sandbox_id in stopped (or already started)
   *      Bound+stopped never falls through to create (lp-vqr0.6 / T1).
   *   2. labeled reuse — Daytona list by instance_id (lp-vqr0.15)
   *   3. warm_pool — optional premium flag; claim stopped id then start
   *   4. cold_create — create-from-snapshot pin (unbound, no labeled box,
   *      or stale env)
   *   5. archive_restore — only when archiveRestoreOnWake and state=archived
   *      (tried as part of bound-sandbox branch before labeled/cold)
   *
   * lp-180p: when the instance bakes expiring vault STS env, a stopped/archived
   * sandbox whose last state change is older than vaultEnvMaxAgeMs is NOT
   * started — `daytona.start()` reuses create-time env (no post-create PATCH),
   * so mount-s3 would come up with expired credentials. Those wakes fall
   * through to cold create (path label `cold_create_env_expired`).
   *
   * Returns path label for metrics (cold_create vs start_from_stopped, …).
   */
  async function reuseOrStartSandbox(
    sandboxId: string,
    path: OrchestratorComputeWakePath,
  ): Promise<{ sandbox: DaytonaSandbox; path: OrchestratorComputeWakePath }> {
    let current: DaytonaSandbox | null = null;
    try {
      current = await daytona.get(sandboxId);
    } catch {
      current = null;
    }
    if (current?.state === "creating") {
      current = await waitSandboxReady(current);
    }
    if (current?.state === "started") {
      return { sandbox: current, path };
    }
    const started = await daytona.start(sandboxId);
    const ready =
      started.state === "creating" ? await waitSandboxReady(started) : started;
    if (ready.state === "started") {
      return { sandbox: ready, path };
    }
    throw new Error(
      `Sandbox ${sandboxId} start returned state=${ready.state}; Send must not cold_create`,
    );
  }

  async function ensureSandboxStarted(
    rec: OrchestratorInstanceRecord,
    snapshotId: string,
    options?: { forceCold?: boolean; profile?: SandboxCreateProfile },
  ): Promise<{ sandbox: DaytonaSandbox; path: OrchestratorComputeWakePath }> {
    const profile = options?.profile ?? "guest_gateway";
    // Re-read before create so create-ahead bind wins over a stale null rec.
    if (!options?.forceCold && instances) {
      const latest = await instances.get(rec.instance_id);
      if (latest?.sandbox_id) {
        rec = { ...rec, sandbox_id: latest.sandbox_id };
      }
    }
    const envExpiryGuardActive = bakedVaultEnvExpires(rec);
    // Set when the lp-180p guard actually skipped a warm start/archive restore.
    let expiredEnvForcedCold = false;
    // Bound id that Daytona no longer has. Labeled recovery / create may replace.
    let boundMissing = false;
    if (!options?.forceCold && rec.sandbox_id) {
      const boundId = rec.sandbox_id;
      let current: DaytonaSandbox | null = null;
      try {
        current = await daytona.get(boundId);
      } catch {
        current = null;
      }

      const decision = decideBoundSandboxWake({
        state: current?.state ?? null,
        envExpiryGuardActive,
        envIsStale: current
          ? sandboxEnvIsStale(current, nowFn().getTime())
          : false,
        archiveRestoreOnWake,
      });

      if (decision.action === "use_running") {
        if (!current) {
          throw new Error(
            `Bound sandbox ${boundId} classified running but get returned nothing`,
          );
        }
        return { sandbox: current, path: decision.path };
      }

      if (decision.action === "start" || decision.action === "wait") {
        // T1/T5 / lp-vqr0.15: do not catch and cold-create.
        return reuseOrStartSandbox(boundId, decision.path);
      }

      if (decision.action === "restore") {
        return reuseOrStartSandbox(boundId, decision.path);
      }

      if (decision.action === "force_cold") {
        expiredEnvForcedCold = true;
      } else if (decision.action === "unusable") {
        if (!decision.allows_create) {
          throw new Error(
            `Bound sandbox ${boundId} unusable; Send must not cold_create`,
          );
        }
        if (decision.reason === "not_restorable") {
          boundMissing = true;
        } else {
          try {
            return await reuseOrStartSandbox(boundId, "start_from_stopped");
          } catch {
            boundMissing = true;
          }
        }
      }
    }

    if (!expiredEnvForcedCold) {
      let labeled: DaytonaSandbox[] = [];
      try {
        labeled = await daytona.list({
          label: { key: "instance_id", value: rec.instance_id },
        });
      } catch {
        labeled = [];
      }
      const guard = decideSandboxCreateGuard({
        bound_sandbox_id: boundMissing ? null : rec.sandbox_id,
        labeled,
      });
      if (!guard.allows_create) {
        return reuseOrStartSandbox(guard.reuse_sandbox_id, "start_from_stopped");
      }
    }

    // Optional warm pool (premium / env flag). Unbound cold need only.
    // Bound+stopped never reaches here (lp-vqr0.6). Replenish is off-stack.
    if (tenantMayUseWarmPool(rec.tenant_id)) {
      const claimed = warmPool?.claim(snapshotId) ?? {
        outcome: "miss" as const,
      };
      if (claimed.outcome === "hit") {
        try {
          const started = await daytona.start(claimed.sandboxId);
          if (started.state === "started") {
            metrics.recordWarmPoolAttempt("hit");
            schedulePoolReplenish(snapshotId);
            return { sandbox: started, path: "warm_pool" };
          }
        } catch {
          // Claimed box unusable — miss and cold-create.
        }
      }
      metrics.recordWarmPoolAttempt("miss");
      schedulePoolReplenish(snapshotId);
    }

    const sandbox = await coldCreateStarted(rec, snapshotId, profile);
    return {
      sandbox,
      path: expiredEnvForcedCold ? "cold_create_env_expired" : "cold_create",
    };
  }

  /**
   * lp-rr5: after sandbox Started, wait until Relay reports instance connected.
   * On never-connect: restart the same sandbox once, wait again; still fail → throw.
   * lp-vqr0.15: never cold-create a second box (start then create was the leak).
   * When relayPresence is not injected, skip wait (Daytona-only unit tests).
   */
  async function waitRelayConnectedOrRecreate(
    instanceId: string,
    sandbox: DaytonaSandbox,
    profile: SandboxCreateProfile,
  ): Promise<DaytonaSandbox> {
    // tool_only guests have no GATEWAY_RELAY_SECRET; do not wait on Relay.
    if (!relayPresence || profile === "tool_only") {
      return sandbox;
    }

    let current = sandbox;
    // attempt 0 = first wait; after fail, stop+start the same box once.
    for (
      let restartUsed = 0;
      restartUsed <= RELAY_CONNECT_RECREATE_ATTEMPTS;
      restartUsed += 1
    ) {
      let connected = false;
      try {
        connected = await waitForRelayConnected(relayPresence, instanceId, {
          timeoutMs: relayConnectTimeoutMs,
          pollIntervalMs: relayConnectPollIntervalMs,
        });
      } catch (err) {
        if (restartUsed >= RELAY_CONNECT_RECREATE_ATTEMPTS) {
          throw new Error(
            `Relay presence unreachable after restart for instance ${instanceId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        connected = false;
      }

      if (connected) {
        return current;
      }

      if (restartUsed >= RELAY_CONNECT_RECREATE_ATTEMPTS) {
        throw new Error(
          `Gateway never connected to Relay for instance ${instanceId} after sandbox start and one restart`,
        );
      }

      try {
        await daytona.stop(current.sandboxId);
      } catch {
        // already gone / stop failed — still try start of the same id
      }
      current = (await reuseOrStartSandbox(current.sandboxId, "start_from_stopped"))
        .sandbox;
    }

    // Unreachable: loop always returns or throws.
    throw new Error(
      `Gateway never connected to Relay for instance ${instanceId}`,
    );
  }

  /**
   * Leader path: transition to waking, create/start sandbox, wait Relay
   * connected (lp-rr5), online (or error).
   * Attaches wakePath for lp-77d metrics (not part of HTTP response).
   */
  async function runWake(
    instanceId: string,
    profile: SandboxCreateProfile,
  ): Promise<EnsureOnlineResponse & { _wakePath?: OrchestratorWakePath }> {
    const store = requireStore();
    let rec = await loadInstance(store, instanceId);
    const kindBefore = rec.runtime_kind;

    // Dual-path branch on runtime_kind (lp-kng.2.11).
    const pathDecision = decideEnsureOnlinePath({
      runtime_kind: rec.runtime_kind,
      tenant_id: rec.tenant_id,
      config: daytonaConfig,
    });
    if (pathDecision.action === "short_circuit_already_online") {
      // EC2 always-on: no Daytona create; report already-online short-circuit.
      assertRuntimeKindUnchanged(kindBefore, rec.runtime_kind);
      return {
        ...toResponse(rec, { already_online: true, wake_joined: false }),
        _wakePath: "ec2_short_circuit",
      };
    }
    if (pathDecision.action === "deny_daytona_path_gated") {
      throw new DaytonaPathGatedError(
        instanceId,
        rec.tenant_id,
        pathDecision.reason,
      );
    }

    // Already online with a bound sandbox — idempotent.
    // Toolbox enqueue still clears stop_after so the reaper does not
    // honor a stale hot window mid-turn.
    if (rec.presence === "online" && rec.sandbox_id) {
      if (rec.stop_after) {
        rec = await store.update(instanceId, { stop_after: null });
        assertRuntimeKindUnchanged(kindBefore, rec.runtime_kind);
      }
      return {
        ...toResponse(rec, { already_online: true, wake_joined: false }),
        _wakePath: "already_online",
      };
    }

    // offline|error → waking; waking → waking (leader of abandoned join).
    const nextPresence = applyPresenceReason(rec.presence, "ensure_online");
    if (nextPresence !== rec.presence) {
      rec = await store.update(instanceId, {
        presence: nextPresence,
        vault_writable: false,
      });
      assertRuntimeKindUnchanged(kindBefore, rec.runtime_kind);
    }

    let wakePath: OrchestratorWakePath = "unknown";
    try {
      const snapshotId =
        rec.agent_snapshot_id?.trim() || defaultSnapshotId || "";
      if (!snapshotId) {
        throw new Error(
          "No agent_snapshot_id on instance and no defaultSnapshotId configured",
        );
      }

      // Create/start sandbox to Started — presence stays waking until Relay
      // connected (when relayPresence is set; lp-rr5).
      const started = await ensureSandboxStarted(rec, snapshotId, { profile });
      wakePath = started.path;
      let sandbox = started.sandbox;

      // Bind as soon as Daytona has a box so 504 retries reuse, not create.
      rec = await store.update(instanceId, { sandbox_id: sandbox.sandboxId });

      // Wait Relay WSS connected; restart the same box once on never-connect.
      sandbox = await waitRelayConnectedOrRecreate(
        instanceId,
        sandbox,
        profile,
      );

      if (sandbox.state !== "started") {
        throw new Error(
          `Sandbox ${sandbox.sandboxId} not started (state=${sandbox.state})`,
        );
      }

      // lp-jzl.10.1: rematerialize platform SoT → guest jobs.json on every wake
      // (cold create and start_from_stopped). Ephemeral BACKEND_HOME alone is
      // insufficient after stop; guest list must match durable registry.
      await rematerializeScheduledJobsOnWake({
        instanceId,
        sandboxId: sandbox.sandboxId,
        registry: scheduledJobRegistry,
        materializer: guestCronMaterializer,
        backendHome: guestBackendHome,
        now: nowFn,
      });

      // CAS waking → online so a concurrent timeout cannot leave us writing
      // online over error, and we never overwrite a non-waking state.
      // Seed last_activity_at so idle grace starts at wake success.
      const promoted = await store.compareAndUpdate(instanceId, "waking", {
        presence: applyPresenceReason("waking", "wake_succeeded"),
        sandbox_id: sandbox.sandboxId,
        last_activity_at: isoNow(),
        stop_after: null,
      });
      if (promoted) {
        assertRuntimeKindUnchanged(kindBefore, promoted.runtime_kind);
        return {
          ...toResponse(promoted, {
            already_online: false,
            wake_joined: false,
          }),
          _wakePath: wakePath,
        };
      }

      // Lost race: re-read and decide (timeout already → error, or already online).
      const latest = await store.get(instanceId);
      if (!latest) {
        throw new OrchestratorInstanceNotFoundError(instanceId);
      }
      assertRuntimeKindUnchanged(kindBefore, latest.runtime_kind);
      if (latest.presence === "error") {
        throw new EnsureOnlineWakeError(
          instanceId,
          new Error("wake aborted (presence already error)"),
        );
      }
      if (latest.presence === "online" && latest.sandbox_id) {
        return {
          ...toResponse(latest, {
            already_online: true,
            wake_joined: false,
          }),
          _wakePath: wakePath,
        };
      }
      throw new EnsureOnlineWakeError(
        instanceId,
        new Error(`unexpected presence after wake: ${latest.presence}`),
      );
    } catch (cause) {
      if (
        cause instanceof EnsureOnlineWakeError ||
        cause instanceof OrchestratorInstanceNotFoundError ||
        cause instanceof OrchestratorInstanceRevokedError ||
        cause instanceof DaytonaPathGatedError
      ) {
        throw cause;
      }
      // Best-effort presence → error when still waking (CAS, no TOCTOU clobber).
      await markErrorIfWaking(instanceId);
      throw new EnsureOnlineWakeError(instanceId, cause);
    }
  }

  async function awaitWake(
    flight: Promise<EnsureOnlineResponse>,
    instanceId: string,
    waitTimeoutMs: number,
    wakeJoined: boolean,
  ): Promise<EnsureOnlineResponse> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        flight,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            // 504 the waiter only. Keep inflight + presence=waking so a retry
            // joins this wake instead of minting a second Daytona box
            // (lp-vqr0.15). The background flight may still reach online.
            reject(new EnsureOnlineTimeoutError(instanceId, waitTimeoutMs));
          }, waitTimeoutMs);
        }),
      ]);
      return {
        ...result,
        wake_joined: wakeJoined || result.wake_joined,
      };
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  async function ensureOnline(
    instanceId: string,
    request?: EnsureOnlineRequest,
  ): Promise<EnsureOnlineResponse> {
    const startedAt = Date.now();
    const store = requireStore();
    const id = instanceId?.trim();
    if (!id) {
      const err = new OrchestratorInstanceNotFoundError(instanceId ?? "");
      recordWakeAndLog({
        outcome: "not_found",
        path: "unknown",
        reason: "not_found",
        latency_ms: Date.now() - startedAt,
        instance_id: instanceId,
      });
      throw err;
    }

    const waitTimeoutMs =
      request?.wait_timeout_ms !== undefined && request.wait_timeout_ms > 0
        ? request.wait_timeout_ms
        : defaultWaitTimeoutMs;
    const sandboxCreateProfile = parseSandboxCreateProfile(
      request?.sandbox_create_profile,
    );

    const ahead = createAheadInflight.get(id);
    if (ahead) {
      await ahead.catch(() => undefined);
    }

    let current: OrchestratorInstanceRecord;
    try {
      current = await loadInstance(store, id);
    } catch (err) {
      recordWakeAndLog({
        outcome: outcomeFromError(err),
        path: "unknown",
        reason: classifyOrchestratorFailure(err),
        latency_ms: Date.now() - startedAt,
        instance_id: id,
      });
      throw err;
    }

    // Dual-path: ec2 short-circuit / gated deny before singleflight (lp-kng.2.11).
    const pathDecision = decideEnsureOnlinePath({
      runtime_kind: current.runtime_kind,
      tenant_id: current.tenant_id,
      config: daytonaConfig,
    });
    if (pathDecision.action === "short_circuit_already_online") {
      // EC2: short-circuit without Daytona (doc: already-online without create).
      assertRuntimeKindUnchanged(current.runtime_kind, current.runtime_kind);
      const response = toResponse(current, {
        already_online: true,
        wake_joined: false,
      });
      recordWakeAndLog({
        outcome: "already_online",
        path: "ec2_short_circuit",
        latency_ms: Date.now() - startedAt,
        instance_id: response.instance_id,
        tenant_id: response.tenant_id,
        sandbox_id: response.sandbox_id,
        already_online: true,
        wake_joined: false,
        count_as_new_online: false,
      });
      return { ...response, path: "ec2_short_circuit" };
    }
    if (pathDecision.action === "deny_daytona_path_gated") {
      const err = new DaytonaPathGatedError(
        id,
        current.tenant_id,
        pathDecision.reason,
      );
      recordWakeAndLog({
        outcome: "path_gated",
        path: "unknown",
        reason: "path_gated",
        latency_ms: Date.now() - startedAt,
        instance_id: id,
        tenant_id: current.tenant_id,
      });
      throw err;
    }

    // Fast path: already online.
    if (current.presence === "online" && current.sandbox_id) {
      const response = toResponse(current, {
        already_online: true,
        wake_joined: false,
      });
      recordWakeAndLog({
        outcome: "already_online",
        path: "already_online",
        latency_ms: Date.now() - startedAt,
        instance_id: response.instance_id,
        tenant_id: response.tenant_id,
        sandbox_id: response.sandbox_id,
        already_online: true,
        wake_joined: false,
        count_as_new_online: false,
      });
      return { ...response, path: "already_online" };
    }

    // Singleflight join or start per instance_id.
    // Synchronous get→set after awaits so concurrent callers in this process
    // join the same promise (JS run-to-completion between awaits).
    // Rate limit (lp-rq1) applies only to **new** wake leaders — joiners and
    // already_online short-circuits above do not consume quota.
    let wakeJoined = false;
    let flight = inflight.get(id);
    if (flight) {
      wakeJoined = true;
    } else {
      if (wakeRateLimiter) {
        const decision = wakeRateLimiter.tryAcquire(current.tenant_id);
        if (!decision.allowed) {
          const err = new EnsureOnlineRateLimitedError({
            instanceId: id,
            tenantId: current.tenant_id,
            scope: decision.scope,
            limit: decision.limit,
            windowMs: decision.windowMs,
            retryAfterMs: decision.retryAfterMs,
            current: decision.current,
          });
          recordWakeAndLog({
            outcome: "rate_limited",
            path: "unknown",
            reason: "rate_limited",
            latency_ms: Date.now() - startedAt,
            instance_id: id,
            tenant_id: current.tenant_id,
            wake_joined: false,
            count_as_new_online: false,
            rate_limit_scope: decision.scope,
          });
          throw err;
        }
      }
      const started = runWake(id, sandboxCreateProfile).finally(() => {
        if (inflight.get(id) === started) {
          inflight.delete(id);
        }
        metrics.setConcurrentWaking(inflight.size);
      });
      flight = started;
      inflight.set(id, flight);
      metrics.setConcurrentWaking(inflight.size);
    }

    try {
      const result = await awaitWake(flight, id, waitTimeoutMs, wakeJoined);
      const wakePath =
        (result as EnsureOnlineResponse & { _wakePath?: OrchestratorWakePath })
          ._wakePath ?? (wakeJoined ? "joined" : "unknown");
      const outcome: OrchestratorWakeOutcome = result.already_online
        ? "already_online"
        : wakeJoined
          ? "joined_success"
          : "success";
      const path: OrchestratorWakePath = result.already_online
        ? wakePath === "ec2_short_circuit"
          ? "ec2_short_circuit"
          : "already_online"
        : wakeJoined
          ? "joined"
          : wakePath;

      // Strip internal metric field; stamp the remapped path on the public body
      // so spine enqueue can observe warm_pool vs start_from_stopped (lp-k5c4.5).
      const { _wakePath: _ignored, ...publicResult } = result as EnsureOnlineResponse & {
        _wakePath?: OrchestratorWakePath;
      };
      void _ignored;
      const publicPath = toEnsureOnlineWakePath(path);

      recordWakeAndLog({
        outcome,
        path,
        latency_ms: Date.now() - startedAt,
        instance_id: publicResult.instance_id,
        tenant_id: publicResult.tenant_id,
        sandbox_id: publicResult.sandbox_id,
        already_online: publicResult.already_online,
        wake_joined: publicResult.wake_joined,
        // Only the leader that newly reached online bumps concurrent gauge.
        count_as_new_online:
          outcome === "success" && publicResult.presence === "online",
      });
      return { ...publicResult, path: publicPath };
    } catch (err) {
      recordWakeAndLog({
        outcome: outcomeFromError(err),
        path: wakeJoined ? "joined" : "unknown",
        reason: classifyOrchestratorFailure(err),
        latency_ms: Date.now() - startedAt,
        instance_id: id,
        tenant_id: current.tenant_id,
        wake_joined: wakeJoined,
        count_as_new_online: false,
      });
      throw err;
    }
  }

  async function getPresence(
    instanceId: string,
  ): Promise<InstancePresenceResponse> {
    const store = requireStore();
    const id = instanceId?.trim();
    if (!id) {
      throw new OrchestratorInstanceNotFoundError(instanceId ?? "");
    }
    const rec = await store.get(id);
    if (!rec) {
      throw new OrchestratorInstanceNotFoundError(id);
    }
    const readiness = instanceReadiness(rec.presence, rec.vault_writable);
    return {
      instance_id: rec.instance_id,
      tenant_id: rec.tenant_id,
      presence: rec.presence,
      sandbox_id: rec.sandbox_id,
      runtime_kind: rec.runtime_kind,
      agent_snapshot_id: rec.agent_snapshot_id,
      s3_vault_prefix: rec.s3_vault_prefix,
      last_activity_at: rec.last_activity_at,
      revoked_at: rec.revoked_at ?? null,
      agent_ready: readiness.agent_ready,
      vault_writable: readiness.vault_writable,
    };
  }

  /**
   * File-tool callers wait here. Presence / ensure_online never do.
   * Probe (when injected) is the live Mountpoint signal; store is the
   * durable flag GET presence returns after a successful wait.
   */
  async function waitVaultWritable(
    instanceId: string,
    options?: WaitVaultWritableRequest,
  ): Promise<WaitVaultWritableResult> {
    const store = requireStore();
    const rec = await loadInstance(store, instanceId?.trim() || instanceId);
    if (parseVaultWritable(rec.vault_writable)) {
      const readiness = instanceReadiness(rec.presence, true);
      return {
        instance_id: rec.instance_id,
        presence: rec.presence,
        agent_ready: readiness.agent_ready,
        vault_writable: true,
      };
    }

    const probe: VaultWritableProbe = vaultWritableProbe ?? {
      async isWritable(id) {
        const latest = await store.get(id);
        return parseVaultWritable(latest?.vault_writable);
      },
    };
    const timeoutMs =
      options?.timeoutMs !== undefined && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_VAULT_WRITABLE_TIMEOUT_MS;
    const writable = await waitUntilVaultWritable(probe, rec.instance_id, {
      timeoutMs,
      pollIntervalMs:
        options?.pollIntervalMs ?? DEFAULT_VAULT_WRITABLE_POLL_INTERVAL_MS,
      sleep: options?.sleep,
      now: options?.now,
    });
    if (writable && !parseVaultWritable(rec.vault_writable)) {
      await store.update(rec.instance_id, { vault_writable: true });
    }
    const latest = (await store.get(rec.instance_id)) ?? rec;
    const readiness = instanceReadiness(latest.presence, latest.vault_writable);
    return {
      instance_id: latest.instance_id,
      presence: latest.presence,
      agent_ready: readiness.agent_ready,
      vault_writable: readiness.vault_writable,
    };
  }

  async function signalActivity(
    instanceId: string,
    request?: SignalActivityRequest,
  ): Promise<SignalActivityResponse> {
    const store = requireStore();
    const rec = await loadInstance(store, instanceId?.trim() || instanceId);

    let atIso: string;
    let atDate: Date;
    if (request?.at !== undefined) {
      const parsed = Date.parse(request.at);
      if (Number.isNaN(parsed)) {
        throw new TypeError(
          `signalActivity invalid at timestamp: ${request.at}`,
        );
      }
      atDate = new Date(parsed);
      atIso = atDate.toISOString();
    } else {
      atDate = nowFn();
      atIso = atDate.toISOString();
    }

    // lp-053: optional mid_turn on activity signal (BFF/gateway turn start/end).
    const patch: OrchestratorInstancePatch = {
      last_activity_at: atIso,
    };
    if (request?.mid_turn !== undefined) {
      const mid = resolveMidTurnPatch(
        request.mid_turn,
        atDate,
        defaultMidTurnMaxHoldMs,
      );
      patch.mid_turn = mid.mid_turn;
      patch.mid_turn_until = mid.mid_turn_until;
    }
    const hotWindow = resolveSpineHotWindowPatch(request ?? {}, atDate);
    if (hotWindow) {
      patch.stop_after = hotWindow.stop_after;
    }

    const updated = await store.update(rec.instance_id, patch);

    return {
      instance_id: updated.instance_id,
      tenant_id: updated.tenant_id,
      presence: updated.presence,
      last_activity_at: updated.last_activity_at ?? atIso,
      mid_turn: updated.mid_turn ?? false,
      mid_turn_until: updated.mid_turn_until ?? null,
      stop_after: updated.stop_after ?? null,
    };
  }

  async function stop(
    instanceId: string,
    request?: StopInstanceRequest,
  ): Promise<StopInstanceResponse> {
    const store = requireStore();
    const id = instanceId?.trim();
    if (!id) {
      throw new OrchestratorInstanceNotFoundError(instanceId ?? "");
    }

    const rec = await loadInstance(store, id);
    const kindBefore = rec.runtime_kind;
    // Idle stop is idempotent and no-ops while mid_turn is active so the
    // reaper and a concurrent CP stop cannot fight (plan 0019 §4.4).
    if (
      request?.reason === "idle_stop" &&
      isMidTurnLockActive(rec, nowFn().getTime())
    ) {
      return {
        instance_id: rec.instance_id,
        tenant_id: rec.tenant_id,
        presence: rec.presence,
        sandbox_id: rec.sandbox_id,
        stopped: false,
      };
    }
    const decision = decideStopPath(rec.runtime_kind);

    if (decision.action === "no_op_always_on") {
      // EC2 path unchanged: host stays up; no Daytona; runtime_kind stable.
      assertRuntimeKindUnchanged(kindBefore, rec.runtime_kind);
      return {
        instance_id: rec.instance_id,
        tenant_id: rec.tenant_id,
        presence: rec.presence,
        sandbox_id: rec.sandbox_id,
        stopped: false,
      };
    }

    // daytona: stop compute; keep instance_id + s3_vault_prefix.
    // lp-6bg: retain sandbox_id by default so re-wake uses start_from_stopped
    // (spike-bnd). Clear binding when retain is off or sandbox is gone.
    let didStopSandbox = false;
    let sandboxGone = false;
    const boundSandboxId = rec.sandbox_id;
    if (boundSandboxId) {
      try {
        await daytona.stop(boundSandboxId);
        didStopSandbox = true;
      } catch {
        // Sandbox may already be gone; clear binding so next wake is cold_create.
        didStopSandbox = true;
        sandboxGone = true;
      }
    }

    const stopReason =
      request?.reason === "idle_stop" ? "idle_stop" : "explicit_stop";
    const nextPresence = applyPresenceReason(rec.presence, stopReason);
    const wasLive =
      rec.presence === "online" ||
      rec.presence === "waking" ||
      rec.sandbox_id != null;
    const wasOnline = rec.presence === "online";

    // Retain bound id when stop succeeded and retainSandboxOnStop (default).
    const nextSandboxId =
      retainSandboxOnStop && boundSandboxId && !sandboxGone
        ? boundSandboxId
        : null;

    const updated = await store.update(id, {
      presence: nextPresence,
      sandbox_id: nextSandboxId,
      mid_turn: false,
      mid_turn_until: null,
      vault_writable: false,
      stop_after: null,
    });
    assertRuntimeKindUnchanged(kindBefore, updated.runtime_kind);

    emitMetricLog(
      metrics.recordStop({
        instance_id: updated.instance_id,
        tenant_id: updated.tenant_id,
        was_online: wasOnline,
      }),
    );

    return {
      instance_id: updated.instance_id,
      tenant_id: updated.tenant_id,
      presence: updated.presence,
      sandbox_id: updated.sandbox_id,
      stopped: didStopSandbox || wasLive,
    };
  }

  async function setMidTurn(
    instanceId: string,
    active: boolean,
    options?: SetMidTurnOptions,
  ): Promise<SetMidTurnResult> {
    const store = requireStore();
    const id = instanceId?.trim() || instanceId;
    await loadInstance(store, id);
    const at = options?.at ?? nowFn();
    const maxHoldMs =
      options?.maxHoldMs !== undefined && options.maxHoldMs > 0
        ? options.maxHoldMs
        : defaultMidTurnMaxHoldMs;
    const mid = resolveMidTurnPatch(active, at, maxHoldMs);
    const updated = await store.update(id, mid);
    return {
      instance_id: updated.instance_id,
      mid_turn: updated.mid_turn ?? false,
      mid_turn_until: updated.mid_turn_until ?? null,
    };
  }

  function isIdleCandidate(
    rec: OrchestratorInstanceRecord,
    nowMs: number,
    idleGraceMs: number,
  ): "idle" | "mid_turn" | "not_idle" {
    // EC2 always-on; only Daytona sandboxes are reaped.
    if (rec.runtime_kind !== "daytona") {
      return "not_idle";
    }
    // Only stop online compute; offline/error already stopped; waking is mid-wake.
    if (rec.presence !== "online") {
      return "not_idle";
    }
    if (isMidTurnLockActive(rec, nowMs)) {
      return "mid_turn";
    }
    // Spine toolbox hot window: lease-annotated stop_after beats 10m grace.
    if (rec.stop_after) {
      const stopAfterMs = Date.parse(rec.stop_after);
      if (!Number.isNaN(stopAfterMs)) {
        return nowMs >= stopAfterMs ? "idle" : "not_idle";
      }
    }
    // No activity recorded while online → treat as idle (conservative cost control).
    if (!rec.last_activity_at) {
      return "idle";
    }
    const lastMs = Date.parse(rec.last_activity_at);
    if (Number.isNaN(lastMs)) {
      return "idle";
    }
    if (nowMs - lastMs >= idleGraceMs) {
      return "idle";
    }
    return "not_idle";
  }

  async function reapIdle(
    options?: ReapIdleOptions,
  ): Promise<IdleReaperResult> {
    const store = requireStore();
    const now = options?.now ?? nowFn();
    const nowMs = now.getTime();
    const idleGraceMs =
      options?.idleGraceMs !== undefined && options.idleGraceMs >= 0
        ? options.idleGraceMs
        : defaultIdleGraceMs;

    const rows = await store.list();
    const result: IdleReaperResult = {
      scanned: rows.length,
      stopped: [],
      skipped_mid_turn: [],
      skipped_not_idle: [],
      errors: [],
    };

    for (const rec of rows) {
      let effective = rec;
      // lp-053 timeout safety: clear stale mid_turn locks before idle decision.
      if (rec.mid_turn && !isMidTurnLockActive(rec, nowMs)) {
        try {
          effective = await store.update(rec.instance_id, {
            mid_turn: false,
            mid_turn_until: null,
          });
        } catch (cause) {
          const msg =
            cause instanceof Error ? cause.message : String(cause);
          result.errors.push({ instance_id: rec.instance_id, error: msg });
          continue;
        }
      }

      const verdict = isIdleCandidate(effective, nowMs, idleGraceMs);
      if (verdict === "mid_turn") {
        result.skipped_mid_turn.push(effective.instance_id);
        continue;
      }
      if (verdict === "not_idle") {
        result.skipped_not_idle.push(effective.instance_id);
        continue;
      }

      try {
        await stop(effective.instance_id, { reason: "idle_stop" });
        result.stopped.push(effective.instance_id);
      } catch (cause) {
        const msg =
          cause instanceof Error ? cause.message : String(cause);
        result.errors.push({
          instance_id: effective.instance_id,
          error: msg,
        });
      }
    }

    return result;
  }

  function toBoundStoppedResponse(
    rec: OrchestratorInstanceRecord,
    flags: { already_bound: boolean; created: boolean },
  ): EnsureBoundStoppedSandboxResponse {
    return {
      instance_id: rec.instance_id,
      tenant_id: rec.tenant_id,
      runtime_kind: rec.runtime_kind,
      presence: rec.presence,
      sandbox_id: rec.sandbox_id,
      already_bound: flags.already_bound,
      created: flags.created,
    };
  }

  function inUseByWake(rec: OrchestratorInstanceRecord): boolean {
    return (
      rec.presence === "online" ||
      rec.presence === "waking" ||
      inflight.has(rec.instance_id)
    );
  }

  async function runCreateAhead(
    instanceId: string,
  ): Promise<EnsureBoundStoppedSandboxResponse> {
    const store = requireStore();
    const rec = await loadInstance(store, instanceId);
    const decision = decideCreateAhead({
      runtime_kind: rec.runtime_kind,
      sandbox_id: rec.sandbox_id,
    });
    if (decision.action === "noop") {
      return toBoundStoppedResponse(rec, {
        already_bound: decision.reason === "already_bound",
        created: false,
      });
    }

    const pathDecision = decideEnsureOnlinePath({
      runtime_kind: rec.runtime_kind,
      tenant_id: rec.tenant_id,
      config: daytonaConfig,
    });
    if (pathDecision.action === "deny_daytona_path_gated") {
      throw new DaytonaPathGatedError(
        instanceId,
        rec.tenant_id,
        pathDecision.reason,
      );
    }

    const snapshotId =
      rec.agent_snapshot_id?.trim() || defaultSnapshotId || "";
    if (!snapshotId) {
      throw new Error(
        "No agent_snapshot_id on instance and no defaultSnapshotId configured",
      );
    }

    let sandbox;
    try {
      sandbox = await coldCreateStarted(rec, snapshotId, "guest_gateway");
    } catch (cause) {
      throw new EnsureBoundStoppedSandboxError(instanceId, cause);
    }

    const latest = await store.get(instanceId);
    if (!latest) {
      try {
        await daytona.stop(sandbox.sandboxId);
      } catch {
        // extra box; instance is gone
      }
      throw new OrchestratorInstanceNotFoundError(instanceId);
    }
    if (latest.sandbox_id && latest.sandbox_id !== sandbox.sandboxId) {
      try {
        await daytona.stop(sandbox.sandboxId);
      } catch {
        // extra box; keep the winner
      }
      return toBoundStoppedResponse(latest, {
        already_bound: true,
        created: false,
      });
    }

    const updated =
      latest.sandbox_id === sandbox.sandboxId
        ? latest
        : await store.update(instanceId, { sandbox_id: sandbox.sandboxId });

    if (inUseByWake(updated)) {
      return toBoundStoppedResponse(updated, {
        already_bound: false,
        created: true,
      });
    }

    try {
      await daytona.stop(sandbox.sandboxId);
    } catch {
      // Binding is the invariant. Stop failure leaves the box started;
      // Send is use_running / start_from_stopped, not cold_create.
    }

    const after = (await store.get(instanceId)) ?? updated;
    return toBoundStoppedResponse(after, {
      already_bound: false,
      created: true,
    });
  }

  async function ensureBoundStoppedSandbox(
    instanceId: string,
  ): Promise<EnsureBoundStoppedSandboxResponse> {
    const store = requireStore();
    const id = instanceId?.trim();
    if (!id) {
      throw new OrchestratorInstanceNotFoundError(instanceId ?? "");
    }

    const wake = inflight.get(id);
    if (wake) {
      await wake.catch(() => undefined);
    }

    const rec = await loadInstance(store, id);
    const early = decideCreateAhead({
      runtime_kind: rec.runtime_kind,
      sandbox_id: rec.sandbox_id,
    });
    if (early.action === "noop") {
      return toBoundStoppedResponse(rec, {
        already_bound: early.reason === "already_bound",
        created: false,
      });
    }

    let flight = createAheadInflight.get(id);
    if (!flight) {
      const started = runCreateAhead(id).finally(() => {
        if (createAheadInflight.get(id) === started) {
          createAheadInflight.delete(id);
        }
      });
      flight = started;
      createAheadInflight.set(id, flight);
    }
    return flight;
  }

  return {
    daytona,
    createSandbox: (params) => daytona.create(params),
    startSandbox: (sid) => daytona.start(sid),
    stopSandbox: (sid) => daytona.stop(sid),
    archiveSandbox: (sid) => daytona.archive(sid),
    getSandbox: (sid) => daytona.get(sid),
    listSandboxes: (filter) => daytona.list(filter),
    ensureOnline,
    ensureBoundStoppedSandbox,
    getPresence,
    waitVaultWritable,
    signalActivity,
    stop,
    setMidTurn,
    reapIdle,
    inflightWakeCount: () => inflight.size,
    metrics: () => metrics,
  };
}

/**
 * Normalize a seed row so last_activity_at is always present (null default).
 */
function normalizeInstanceRecord(
  r: OrchestratorInstanceRecord,
): OrchestratorInstanceRecord {
  return {
    ...r,
    last_activity_at:
      r.last_activity_at === undefined ? null : r.last_activity_at,
    mid_turn: r.mid_turn ?? false,
    mid_turn_until:
      r.mid_turn_until === undefined ? null : r.mid_turn_until,
    vault_writable: parseVaultWritable(r.vault_writable),
    stop_after: r.stop_after === undefined ? null : r.stop_after,
  };
}

/**
 * In-memory {@link OrchestratorInstanceStore} for unit tests / offline piping
 * (lp-kng.2.2 presence store). Not multi-process; no Postgres.
 */
export function createInMemoryOrchestratorInstanceStore(
  seed: Iterable<OrchestratorInstanceRecord> = [],
): OrchestratorInstanceStore & {
  /** Test helper: direct snapshot. */
  snapshot(): OrchestratorInstanceRecord[];
  seed(record: OrchestratorInstanceRecord): void;
  clear(): void;
} {
  const map = new Map<string, OrchestratorInstanceRecord>();
  for (const r of seed) {
    map.set(r.instance_id, normalizeInstanceRecord(r));
  }

  return {
    async get(instanceId: string) {
      const rec = map.get(instanceId);
      return rec ? { ...rec } : null;
    },
    async update(instanceId: string, patch: OrchestratorInstancePatch) {
      const existing = map.get(instanceId);
      if (!existing) {
        throw new OrchestratorInstanceNotFoundError(instanceId);
      }
      const next: OrchestratorInstanceRecord = {
        ...existing,
        ...patch,
      };
      map.set(instanceId, next);
      return { ...next };
    },
    async compareAndUpdate(
      instanceId: string,
      expectedPresence: InstancePresence,
      patch: OrchestratorInstancePatch,
    ) {
      const existing = map.get(instanceId);
      if (!existing || existing.presence !== expectedPresence) {
        return null;
      }
      const next: OrchestratorInstanceRecord = {
        ...existing,
        ...patch,
      };
      map.set(instanceId, next);
      return { ...next };
    },
    async list() {
      return [...map.values()].map((r) => ({ ...r }));
    },
    snapshot() {
      return [...map.values()].map((r) => ({ ...r }));
    },
    seed(record: OrchestratorInstanceRecord) {
      map.set(record.instance_id, normalizeInstanceRecord(record));
    },
    clear() {
      map.clear();
    },
  };
}
