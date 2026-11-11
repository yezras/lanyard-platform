/**
 * Idle reaper job/loop (lp-0y3).
 *
 * Periodically scans the orchestrator instance store and stops online Daytona
 * sandboxes whose `last_activity_at` is past the idle grace (default 10 min).
 * Delegates selection + stop to {@link InstanceOrchestrator.reapIdle} so
 * mid-turn protection, dual-path (ec2 skip), and real harness unit tests share
 * one code path.
 *
 * Design:
 * - Default grace: {@link DEFAULT_IDLE_GRACE_MS} (10 minutes).
 * - Scan interval is independent of grace (default 60s) so cost control reacts
 *   without waiting a full grace between checks.
 * - Injectable clock + timers for unit tests (no real wall-clock waits).
 * - Safe structured log sink only — never secrets / raw sandbox env.
 *
 * Plan: docs/plans/0008-daytona-agent-sandboxes/presence-state-machine.md
 *       docs/plans/0008-daytona-agent-sandboxes/identity-model.md
 */

import {
  DEFAULT_IDLE_GRACE_MS,
  type IdleReaperResult,
  type InstanceOrchestrator,
  type ReapIdleOptions,
} from "./instance-orchestrator.js";

/** Default how often the loop scans for idle sandboxes (1 minute). */
export const DEFAULT_IDLE_REAPER_INTERVAL_MS = 60_000;

/** Env var for scan interval override (ms). Document only — never secrets. */
export const IDLE_REAPER_INTERVAL_ENV = "IDLE_REAPER_INTERVAL_MS";

/** Env var for idle grace override (ms). Default 10 min when unset. */
export const IDLE_REAPER_GRACE_ENV = "IDLE_REAPER_GRACE_MS";

/** Safe structured log event from the reaper job (no secrets). */
export type IdleReaperLogEvent = {
  event: "idle_reaper_pass" | "idle_reaper_error" | "idle_reaper_started" | "idle_reaper_stopped";
  scanned?: number;
  stopped?: number;
  skipped_mid_turn?: number;
  skipped_not_idle?: number;
  errors?: number;
  idle_grace_ms?: number;
  interval_ms?: number;
  error_message?: string;
};

/**
 * Minimal timer port so unit tests inject a fake clock / deterministic schedule
 * without real `setInterval` wall time.
 */
export type IdleReaperTimers = {
  setInterval: (handler: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export type IdleReaperJobDeps = {
  /**
   * Orchestrator that owns presence store + Daytona stop.
   * Tests inject real harness-backed createInstanceOrchestrator.
   */
  reaper: Pick<InstanceOrchestrator, "reapIdle">;
  /**
   * Idle grace before stop (ms).
   * @default DEFAULT_IDLE_GRACE_MS (10 minutes)
   */
  idleGraceMs?: number;
  /**
   * Scan interval (ms) for the background loop.
   * @default DEFAULT_IDLE_REAPER_INTERVAL_MS
   */
  intervalMs?: number;
  /** Clock for reaper pass (tests inject fixed / stepped time). */
  now?: () => Date;
  /** Timer port (tests inject fake interval). Defaults to global timers. */
  timers?: IdleReaperTimers;
  /**
   * Optional safe log sink. Never receives secrets or raw Daytona env.
   */
  logSafe?: (event: IdleReaperLogEvent) => void;
  /**
   * When true, the first interval tick is deferred (default).
   * Call {@link IdleReaperJob.runOnce} for an immediate pass (ops/tests).
   */
  runOnStart?: boolean;
};

export type IdleReaperJob = {
  /** Start the background scan loop (idempotent). */
  start(): void;
  /** Stop the background scan loop (idempotent). */
  stop(): void;
  /** Whether the loop is currently scheduled. */
  isRunning(): boolean;
  /**
   * Run one reaper pass immediately (ops trigger + unit tests).
   * Uses job grace/clock unless options override.
   */
  runOnce(options?: ReapIdleOptions): Promise<IdleReaperResult>;
  /** Configured idle grace ms. */
  readonly idleGraceMs: number;
  /** Configured scan interval ms. */
  readonly intervalMs: number;
};

function resolvePositiveMs(value: number | undefined, fallback: number): number {
  if (value !== undefined && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return fallback;
}

/**
 * Parse optional positive integer env (ms). Invalid / empty → undefined.
 */
export function parsePositiveMsEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value.trim());
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

/**
 * Resolve reaper timing from env (interval + grace). Pure; no I/O.
 */
export function resolveIdleReaperEnv(env: NodeJS.ProcessEnv = process.env): {
  intervalMs: number;
  idleGraceMs: number;
} {
  return {
    intervalMs:
      parsePositiveMsEnv(env[IDLE_REAPER_INTERVAL_ENV]) ??
      DEFAULT_IDLE_REAPER_INTERVAL_MS,
    idleGraceMs:
      parsePositiveMsEnv(env[IDLE_REAPER_GRACE_ENV]) ?? DEFAULT_IDLE_GRACE_MS,
  };
}

/**
 * Create an idle reaper job that can be started as a CP background loop.
 *
 * The job never imports the Daytona SDK; stop goes through the orchestrator
 * (real harness offline / Sdk client live).
 */
export function createIdleReaperJob(deps: IdleReaperJobDeps): IdleReaperJob {
  const idleGraceMs = resolvePositiveMs(deps.idleGraceMs, DEFAULT_IDLE_GRACE_MS);
  const intervalMs = resolvePositiveMs(
    deps.intervalMs,
    DEFAULT_IDLE_REAPER_INTERVAL_MS,
  );
  const nowFn = deps.now ?? (() => new Date());
  const timers: IdleReaperTimers = deps.timers ?? {
    setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
    clearInterval: (handle) => {
      globalThis.clearInterval(handle as ReturnType<typeof setInterval>);
    },
  };
  const logSafe = deps.logSafe;
  const runOnStart = deps.runOnStart === true;

  let handle: unknown = null;
  let running = false;
  /** Serialize passes so overlapping interval ticks do not double-stop. */
  let passInFlight: Promise<IdleReaperResult> | null = null;

  function emit(event: IdleReaperLogEvent): void {
    if (!logSafe) return;
    try {
      logSafe(event);
    } catch {
      // Logging must never break reaper passes.
    }
  }

  // Non-async so concurrent callers receive the *same* Promise identity
  // (async functions always wrap returns in a new promise).
  function runOnce(options?: ReapIdleOptions): Promise<IdleReaperResult> {
    if (passInFlight) {
      return passInFlight;
    }

    const pass = (async () => {
      const now = options?.now ?? nowFn();
      const grace =
        options?.idleGraceMs !== undefined && options.idleGraceMs >= 0
          ? options.idleGraceMs
          : idleGraceMs;
      try {
        const result = await deps.reaper.reapIdle({
          now,
          idleGraceMs: grace,
        });
        emit({
          event: "idle_reaper_pass",
          scanned: result.scanned,
          stopped: result.stopped.length,
          skipped_mid_turn: result.skipped_mid_turn.length,
          skipped_not_idle: result.skipped_not_idle.length,
          errors: result.errors.length,
          idle_grace_ms: grace,
        });
        return result;
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        emit({
          event: "idle_reaper_error",
          error_message: msg,
          idle_grace_ms: grace,
        });
        throw cause;
      } finally {
        passInFlight = null;
      }
    })();

    passInFlight = pass;
    return pass;
  }

  function tick(): void {
    // Fire-and-forget; errors already logged inside runOnce.
    void runOnce().catch(() => {
      /* logged */
    });
  }

  function start(): void {
    if (running) return;
    running = true;
    handle = timers.setInterval(tick, intervalMs);
    emit({
      event: "idle_reaper_started",
      interval_ms: intervalMs,
      idle_grace_ms: idleGraceMs,
    });
    if (runOnStart) {
      tick();
    }
  }

  function stop(): void {
    if (!running) return;
    running = false;
    if (handle !== null) {
      timers.clearInterval(handle);
      handle = null;
    }
    emit({
      event: "idle_reaper_stopped",
      interval_ms: intervalMs,
      idle_grace_ms: idleGraceMs,
    });
  }

  return {
    start,
    stop,
    isRunning: () => running,
    runOnce,
    idleGraceMs,
    intervalMs,
  };
}
