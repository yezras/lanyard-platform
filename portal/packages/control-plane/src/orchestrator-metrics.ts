/**
 * Instance Orchestrator observability (lp-77d).
 *
 * In-process counters + latency histogram-equivalent for:
 * - ensure_online wake latency
 * - start / wake failure counts
 * - concurrent online sandboxes (gauge)
 *
 * Labels and log fields are **codes and IDs only** — never secrets, vault
 * content, raw Daytona env, or Relay tokens.
 *
 * Catalog: docs/plans/0008-daytona-agent-sandboxes/sandbox-orchestrator-metrics.md
 */

/** Stable metric event names (Prometheus-ready strings). */
export type OrchestratorMetricEvent =
  | "sandbox_wake"
  | "sandbox_start_failure"
  | "sandbox_wake_rejected"
  | "sandbox_stop"
  | "sandbox_concurrent";

/**
 * ensure_online outcome for counters.
 * `joined_success` = singleflight waiter that observed a successful wake.
 * `rate_limited` = new wake start rejected by lp-rq1 abuse controls.
 */
export type OrchestratorWakeOutcome =
  | "success"
  | "already_online"
  | "joined_success"
  | "timeout"
  | "error"
  | "path_gated"
  | "not_found"
  | "revoked"
  | "rate_limited";

/**
 * How compute was obtained on the leader wake path (lp-6bg / spike-bnd).
 * Prefer specific strategy labels so latency can be compared cold_create vs
 * start_from_stopped (and optional archive_restore / warm_pool).
 * Joiners / short-circuits use the matching non-leader labels.
 *
 * Legacy aliases `cold` / `warm` remain accepted for older scrapes; new
 * emissions use the specific strategy names.
 */
export type OrchestratorWakePath =
  | "cold_create"
  | "cold_create_env_expired"
  | "start_from_stopped"
  | "archive_restore"
  | "warm_pool"
  /** @deprecated Prefer cold_create (lp-6bg). Still accepted on recordWake. */
  | "cold"
  /** @deprecated Prefer start_from_stopped (lp-6bg). Still accepted on recordWake. */
  | "warm"
  | "already_online"
  | "joined"
  | "ec2_short_circuit"
  | "unknown";
/**
 * Low-cardinality failure reasons for start / wake failures.
 * Prefer these over free-form error.message as metric labels.
 */
export type OrchestratorFailureReason =
  | "timeout"
  | "create_failed"
  | "start_failed"
  | "relay_never_connect"
  | "relay_unreachable"
  | "snapshot_missing"
  /** CP InstanceSecretMaterialStore empty (e.g. /tmp store wiped on task recycle). */
  | "missing_secret_material"
  /** Vault mount STS AssumeRole / mint failure before Daytona create. */
  | "vault_mount_sts_failed"
  | "wake_aborted"
  | "path_gated"
  | "not_found"
  | "revoked"
  | "rate_limited"
  | "unexpected_presence"
  | "other";

/** Coarse latency buckets for wake histogram-equivalent (ms). */
export type OrchestratorLatencyBucket =
  | "lt_500ms"
  | "500ms_2s"
  | "2s_5s"
  | "5s_15s"
  | "15s_30s"
  | "30s_60s"
  | "gte_60s";

export type OrchestratorMetricsSnapshot = {
  /** Total ensure_online completions (all outcomes). */
  wake_total: number;
  wake_by_outcome: Record<string, number>;
  wake_by_path: Record<string, number>;
  /**
   * Wake latency histogram-equivalent.
   * Buckets + sum_ms + count for avg reconstruction (leader + joiners).
   */
  wake_latency_count: number;
  wake_latency_sum_ms: number;
  wake_latency_by_bucket: Record<OrchestratorLatencyBucket, number>;
  /**
   * Failure counter (timeouts + create/start/relay/other wake failures).
   * Subset of wake_total where outcome is timeout|error|path_gated|…
   * Includes rate_limited rejections (lp-rq1).
   */
  start_failures_total: number;
  start_failures_by_reason: Record<string, number>;
  /**
   * Rejected new wakes (lp-rq1 rate limit). Subset of wake_total where
   * outcome is `rate_limited`. Also counted in start_failures_*.
   */
  wake_rejected_total: number;
  wake_rejected_by_reason: Record<string, number>;
  /**
   * Gauge: online Daytona sandboxes known to this process after wake/stop.
   * Approximate across multi-process CP; single-process truth for unit tests.
   */
  concurrent_sandboxes: number;
  /** Gauge: in-flight singleflight wakes (updated when callers set it). */
  concurrent_waking: number;
  /** Successful stops that cleared online compute (idle or explicit). */
  stop_total: number;
  /**
   * Optional warm pool (lp-6bg / lp-vqr0.10): attempts / hits / misses.
   * Hits bind a pre-created stopped id and start (`warm_pool`). Misses
   * fall through to cold_create.
   */
  warm_pool_attempts: number;
  warm_pool_hits: number;
  warm_pool_misses: number;
};

export type OrchestratorSafeLogFields = {
  event?: OrchestratorMetricEvent;
  instance_id?: string;
  tenant_id?: string;
  sandbox_id?: string | null;
  outcome?: OrchestratorWakeOutcome;
  path?: OrchestratorWakePath;
  reason?: OrchestratorFailureReason;
  latency_ms?: number;
  latency_bucket?: OrchestratorLatencyBucket;
  wake_joined?: boolean;
  already_online?: boolean;
  concurrent_sandboxes?: number;
  concurrent_waking?: number;
  /** Rate-limit scope when outcome is rate_limited (lp-rq1). */
  rate_limit_scope?: "global" | "tenant";
  /** HTTP-ish status for ops correlation when known. */
  status?: number | string;
};

const LATENCY_BUCKETS: readonly OrchestratorLatencyBucket[] = [
  "lt_500ms",
  "500ms_2s",
  "2s_5s",
  "5s_15s",
  "15s_30s",
  "30s_60s",
  "gte_60s",
] as const;

const emptyLatencyBuckets = (): Record<
  OrchestratorLatencyBucket,
  number
> => ({
  lt_500ms: 0,
  "500ms_2s": 0,
  "2s_5s": 0,
  "5s_15s": 0,
  "15s_30s": 0,
  "30s_60s": 0,
  gte_60s: 0,
});

const emptySnapshot = (): OrchestratorMetricsSnapshot => ({
  wake_total: 0,
  wake_by_outcome: {},
  wake_by_path: {},
  wake_latency_count: 0,
  wake_latency_sum_ms: 0,
  wake_latency_by_bucket: emptyLatencyBuckets(),
  start_failures_total: 0,
  start_failures_by_reason: {},
  wake_rejected_total: 0,
  wake_rejected_by_reason: {},
  concurrent_sandboxes: 0,
  concurrent_waking: 0,
  stop_total: 0,
  warm_pool_attempts: 0,
  warm_pool_hits: 0,
  warm_pool_misses: 0,
});

function bump(map: Record<string, number>, key: string, n = 1): void {
  const safe = key.slice(0, 64) || "unknown";
  map[safe] = (map[safe] ?? 0) + n;
}

/**
 * Map wall-clock wake duration → coarse bucket for metric labels.
 * Prefer buckets over exact ms when exporting as Prometheus labels.
 */
export function orchestratorLatencyBucket(
  latencyMs: number | undefined | null,
): OrchestratorLatencyBucket {
  if (
    latencyMs === undefined ||
    latencyMs === null ||
    !Number.isFinite(latencyMs) ||
    latencyMs < 0
  ) {
    return "lt_500ms";
  }
  if (latencyMs < 500) return "lt_500ms";
  if (latencyMs < 2_000) return "500ms_2s";
  if (latencyMs < 5_000) return "2s_5s";
  if (latencyMs < 15_000) return "5s_15s";
  if (latencyMs < 30_000) return "15s_30s";
  if (latencyMs < 60_000) return "30s_60s";
  return "gte_60s";
}

/**
 * Classify ensure_online / wake errors into low-cardinality failure reasons.
 */
export function classifyOrchestratorFailure(
  err: unknown,
): OrchestratorFailureReason {
  if (err == null) return "other";
  // EnsureOnlineWakeError wraps the underlying cause — classify that first.
  if (
    typeof err === "object" &&
    err !== null &&
    "causeError" in err &&
    (err as { causeError?: unknown }).causeError != null
  ) {
    const nested = classifyOrchestratorFailure(
      (err as { causeError: unknown }).causeError,
    );
    if (nested !== "other") return nested;
  }
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  const name =
    err instanceof Error ? err.name : typeof err === "string" ? "" : "";
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (
    code === "ENSURE_ONLINE_TIMEOUT" ||
    name === "EnsureOnlineTimeoutError" ||
    lower.includes("timed out")
  ) {
    return "timeout";
  }
  if (
    code === "ORCHESTRATOR_INSTANCE_NOT_FOUND" ||
    name === "OrchestratorInstanceNotFoundError"
  ) {
    return "not_found";
  }
  if (
    code === "ORCHESTRATOR_INSTANCE_REVOKED" ||
    name === "OrchestratorInstanceRevokedError"
  ) {
    return "revoked";
  }
  if (
    code === "DAYTONA_PATH_GATED" ||
    name === "DaytonaPathGatedError" ||
    lower.includes("daytona path gated")
  ) {
    return "path_gated";
  }
  if (
    code === "ENSURE_ONLINE_RATE_LIMITED" ||
    name === "EnsureOnlineRateLimitedError" ||
    lower.includes("rate limited") ||
    lower.includes("rate_limited")
  ) {
    return "rate_limited";
  }
  if (
    lower.includes("never connected") ||
    lower.includes("gateway never connected")
  ) {
    return "relay_never_connect";
  }
  if (
    lower.includes("relay presence unreachable") ||
    lower.includes("relay unreachable")
  ) {
    return "relay_unreachable";
  }
  if (
    lower.includes("no agent_snapshot_id") ||
    lower.includes("no defaultsnapshotid") ||
    lower.includes("snapshot")
  ) {
    return "snapshot_missing";
  }
  if (lower.includes("wake aborted")) {
    return "wake_aborted";
  }
  if (lower.includes("unexpected presence")) {
    return "unexpected_presence";
  }
  // lp-zuh.10.11: cold create fails closed before Daytona create when the
  // ephemeral InstanceSecretMaterialStore is empty (CP task /tmp wipe) or STS
  // mint fails — classify instead of opaque "other" so ops sees rotate/redeploy.
  if (
    code === "MISSING_INSTANCE_SECRET_MATERIAL" ||
    name === "MissingInstanceSecretMaterialError" ||
    lower.includes("missing instance secret material") ||
    lower.includes("no secret material")
  ) {
    return "missing_secret_material";
  }
  if (
    code === "ASSUME_ROLE_FAILED" ||
    code === "SANDBOX_VAULT_MOUNT_STS" ||
    name === "SandboxVaultMountStsError" ||
    lower.includes("vault mount sts") ||
    lower.includes("assume role")
  ) {
    return "vault_mount_sts_failed";
  }
  if (
    lower.includes("create") ||
    lower.includes("create failed") ||
    lower.includes("createerror")
  ) {
    return "create_failed";
  }
  if (
    lower.includes("start") ||
    lower.includes("start failed") ||
    lower.includes("not started")
  ) {
    return "start_failed";
  }
  return "other";
}

/** Keys that must never appear in orchestrator metric log fields. */
export const ORCHESTRATOR_FORBIDDEN_LOG_KEYS: ReadonlySet<string> = new Set([
  "token",
  "api_key",
  "apikey",
  "authorization",
  "password",
  "secret",
  "env",
  "raw_env",
  "gateway_relay_secret",
  "body",
  "content",
  "vault_content",
]);

/** Strip forbidden keys (shallow) from a log fields object. */
export function scrubOrchestratorLogFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (ORCHESTRATOR_FORBIDDEN_LOG_KEYS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

/** Build a structured log object with only safe fields. */
export function buildOrchestratorSafeLogFields(
  fields: OrchestratorSafeLogFields,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields.event !== undefined) out.event = fields.event;
  if (fields.instance_id !== undefined) out.instance_id = fields.instance_id;
  if (fields.tenant_id !== undefined) out.tenant_id = fields.tenant_id;
  if (fields.sandbox_id !== undefined) out.sandbox_id = fields.sandbox_id;
  if (fields.outcome !== undefined) out.outcome = fields.outcome;
  if (fields.path !== undefined) out.path = fields.path;
  if (fields.reason !== undefined) out.reason = fields.reason;
  if (fields.latency_ms !== undefined) {
    out.latency_ms = Math.max(0, Math.round(fields.latency_ms));
  }
  if (fields.latency_bucket !== undefined) {
    out.latency_bucket = fields.latency_bucket;
  }
  if (fields.wake_joined !== undefined) out.wake_joined = fields.wake_joined;
  if (fields.already_online !== undefined) {
    out.already_online = fields.already_online;
  }
  if (fields.concurrent_sandboxes !== undefined) {
    out.concurrent_sandboxes = fields.concurrent_sandboxes;
  }
  if (fields.concurrent_waking !== undefined) {
    out.concurrent_waking = fields.concurrent_waking;
  }
  if (fields.rate_limit_scope !== undefined) {
    out.rate_limit_scope = fields.rate_limit_scope;
  }
  if (fields.status !== undefined) out.status = fields.status;
  return scrubOrchestratorLogFields(out);
}

export type RecordWakeInput = {
  outcome: OrchestratorWakeOutcome;
  path?: OrchestratorWakePath;
  reason?: OrchestratorFailureReason;
  latency_ms: number;
  instance_id?: string;
  tenant_id?: string;
  sandbox_id?: string | null;
  wake_joined?: boolean;
  already_online?: boolean;
  /**
   * When true (default for success that newly came online), bump concurrent
   * sandboxes gauge. already_online / joiners should pass false.
   */
  count_as_new_online?: boolean;
  /** lp-rq1: which limit rejected the wake (`global` | `tenant`). */
  rate_limit_scope?: "global" | "tenant";
};

export type RecordStopInput = {
  instance_id?: string;
  tenant_id?: string;
  /** When true, decrement concurrent online gauge. */
  was_online?: boolean;
};

/**
 * In-process orchestrator metrics (lp-77d).
 * Safe for unit tests via {@link OrchestratorMetrics.reset}.
 */
export class OrchestratorMetrics {
  private snap: OrchestratorMetricsSnapshot = emptySnapshot();

  /** Reset all counters and gauges (tests). */
  reset(): void {
    this.snap = emptySnapshot();
  }

  /** Deep-ish copy for operators / tests. */
  snapshot(): OrchestratorMetricsSnapshot {
    return {
      wake_total: this.snap.wake_total,
      wake_by_outcome: { ...this.snap.wake_by_outcome },
      wake_by_path: { ...this.snap.wake_by_path },
      wake_latency_count: this.snap.wake_latency_count,
      wake_latency_sum_ms: this.snap.wake_latency_sum_ms,
      wake_latency_by_bucket: { ...this.snap.wake_latency_by_bucket },
      start_failures_total: this.snap.start_failures_total,
      start_failures_by_reason: { ...this.snap.start_failures_by_reason },
      wake_rejected_total: this.snap.wake_rejected_total,
      wake_rejected_by_reason: { ...this.snap.wake_rejected_by_reason },
      concurrent_sandboxes: this.snap.concurrent_sandboxes,
      concurrent_waking: this.snap.concurrent_waking,
      stop_total: this.snap.stop_total,
      warm_pool_attempts: this.snap.warm_pool_attempts,
      warm_pool_hits: this.snap.warm_pool_hits,
      warm_pool_misses: this.snap.warm_pool_misses,
    };
  }

  /**
   * Record a warm-pool claim attempt (lp-vqr0.10). Hit starts the claimed
   * id; miss falls through to cold_create.
   */
  recordWarmPoolAttempt(result: "hit" | "miss"): void {
    this.snap.warm_pool_attempts += 1;
    if (result === "hit") {
      this.snap.warm_pool_hits += 1;
    } else {
      this.snap.warm_pool_misses += 1;
    }
  }

  /** Update concurrent waking gauge from singleflight map size. */
  setConcurrentWaking(n: number): void {
    this.snap.concurrent_waking = Math.max(0, Math.floor(n));
  }

  /**
   * Force concurrent online gauge (e.g. reconcile from store.list after boot).
   */
  setConcurrentSandboxes(n: number): void {
    this.snap.concurrent_sandboxes = Math.max(0, Math.floor(n));
  }

  /**
   * Record one ensure_online completion (success or failure).
   * Emits latency histogram sample + outcome/path counters.
   * Failures also bump start_failures_total.
   */
  recordWake(input: RecordWakeInput): OrchestratorSafeLogFields {
    const latency = Math.max(0, Math.round(input.latency_ms));
    const bucket = orchestratorLatencyBucket(latency);
    const path = input.path ?? "unknown";

    this.snap.wake_total += 1;
    bump(this.snap.wake_by_outcome, input.outcome);
    bump(this.snap.wake_by_path, path);

    this.snap.wake_latency_count += 1;
    this.snap.wake_latency_sum_ms += latency;
    this.snap.wake_latency_by_bucket[bucket] += 1;

    const isRateLimited = input.outcome === "rate_limited";
    const isFailure =
      input.outcome === "timeout" ||
      input.outcome === "error" ||
      input.outcome === "path_gated" ||
      input.outcome === "not_found" ||
      input.outcome === "revoked" ||
      isRateLimited;

    if (isFailure) {
      const reason =
        input.reason ??
        (input.outcome === "timeout"
          ? "timeout"
          : input.outcome === "path_gated"
            ? "path_gated"
            : input.outcome === "not_found"
              ? "not_found"
              : input.outcome === "revoked"
                ? "revoked"
                : input.outcome === "rate_limited"
                  ? "rate_limited"
                  : "other");
      this.snap.start_failures_total += 1;
      bump(this.snap.start_failures_by_reason, reason);
    }

    if (isRateLimited) {
      this.snap.wake_rejected_total += 1;
      const rejectKey =
        input.rate_limit_scope ?? input.reason ?? "rate_limited";
      bump(this.snap.wake_rejected_by_reason, rejectKey);
    }

    if (input.count_as_new_online) {
      this.snap.concurrent_sandboxes += 1;
    }

    return {
      event: isRateLimited
        ? "sandbox_wake_rejected"
        : isFailure
          ? "sandbox_start_failure"
          : "sandbox_wake",
      instance_id: input.instance_id,
      tenant_id: input.tenant_id,
      sandbox_id: input.sandbox_id ?? null,
      outcome: input.outcome,
      path,
      reason: input.reason,
      latency_ms: latency,
      latency_bucket: bucket,
      wake_joined: input.wake_joined,
      already_online: input.already_online,
      concurrent_sandboxes: this.snap.concurrent_sandboxes,
      concurrent_waking: this.snap.concurrent_waking,
      rate_limit_scope: input.rate_limit_scope,
      status: isRateLimited ? 429 : undefined,
    };
  }

  /** Record stop that may free an online sandbox slot. */
  recordStop(input: RecordStopInput = {}): OrchestratorSafeLogFields {
    this.snap.stop_total += 1;
    if (input.was_online && this.snap.concurrent_sandboxes > 0) {
      this.snap.concurrent_sandboxes -= 1;
    }
    return {
      event: "sandbox_stop",
      instance_id: input.instance_id,
      tenant_id: input.tenant_id,
      concurrent_sandboxes: this.snap.concurrent_sandboxes,
      concurrent_waking: this.snap.concurrent_waking,
    };
  }
}

/** Process-wide default for production wiring (tests should inject their own). */
export const orchestratorMetrics = new OrchestratorMetrics();

/** Exported for tests / docs. */
export const ORCHESTRATOR_LATENCY_BUCKETS = LATENCY_BUCKETS;
