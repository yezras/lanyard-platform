/**
 * Platform schedule evaluator + fire trigger (lp-jzl.10.2).
 *
 * Runs on Control Plane (or always-on worker) — **not** the in-guest cron
 * ticker. Offline sandboxes still fire: the evaluator reads the durable
 * platform job registry and calls {@link fireScheduledTask}, which
 * ensure_online → mid_turn → run-job → clear.
 *
 * Design:
 * - Scan platform SoT / fire-path job registry for due rows (fake clock OK)
 * - Skip disabled, missing, or already-running jobs
 * - On due: fireScheduledTask(instance_id, job_id); last_run marked by fire path
 * - Advance next_run_at after fire so the same tick does not re-fire
 * - Optional background tick loop (env opt-in) for CP server wiring
 *
 * No live MockLab (lp-jzl.8). No dependency on guest ticker while stopped.
 *
 * Short-stack (lp-oop.38.8): pass `fire: fireScheduledTaskHarnessTurn` so
 * due jobs start a harness HTTP turn (tool_only create env). Live CP
 * background loop remains opt-in (`SCHEDULE_EVALUATOR_ENABLED`) and is
 * not enabled this wave.
 */

import type { ScheduledJob, ScheduledJobRegistry } from "./scheduled-job-registry.js";
import {
  fireScheduledTask,
  ScheduledTaskJobNotFoundError,
  type AgentJobRunner,
  type FireScheduledTaskDeps,
  type FireScheduledTaskResult,
  type ScheduledTaskFireOrchestrator,
  type ScheduledTaskJobDefinition,
  type ScheduledTaskJobRegistry,
  type ScheduledTaskSchedule,
} from "./scheduled-task-fire.js";

// ---------------------------------------------------------------------------
// Timing / env
// ---------------------------------------------------------------------------

/** Default scan interval for the background evaluator loop (60s). */
export const DEFAULT_SCHEDULE_EVALUATOR_INTERVAL_MS = 60_000;

/** Env: scan interval override (ms). Document only — never secrets. */
export const SCHEDULE_EVALUATOR_INTERVAL_ENV =
  "SCHEDULE_EVALUATOR_INTERVAL_MS" as const;

/**
 * Env: when truthy (`1` / `true` / `yes` / `on`), CP may start the background
 * evaluator loop. Default off until production wiring is ready.
 */
export const SCHEDULE_EVALUATOR_ENABLED_ENV =
  "SCHEDULE_EVALUATOR_ENABLED" as const;

// ---------------------------------------------------------------------------
// Due detection
// ---------------------------------------------------------------------------

/**
 * Whether a durable job row is due at `now`.
 *
 * Rules:
 * - disabled → not due
 * - state `running` → not due (in-flight fire)
 * - once: due when now >= run_at and never has last_run_at
 * - cron / other: due when next_run_at is set and now >= next_run_at
 */
export function isScheduledJobDue(
  job: ScheduledTaskJobDefinition,
  now: Date,
): boolean {
  if (!job.enabled) return false;
  if (job.state === "running") return false;

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return false;

  if (job.schedule.kind === "once") {
    if (job.last_run_at) return false;
    const runAt = Date.parse(job.schedule.run_at);
    if (!Number.isFinite(runAt)) return false;
    return nowMs >= runAt;
  }

  // Prefer explicit next_run_at (product store + platform SoT).
  if (job.next_run_at) {
    const next = Date.parse(job.next_run_at);
    if (!Number.isFinite(next)) return false;
    return nowMs >= next;
  }

  // No next_run_at → not due until a writer assigns one (create path / advance).
  return false;
}

/**
 * Compute the next `next_run_at` after a fire so the evaluator does not
 * re-fire the same occurrence on every scan.
 *
 * - once → null (and fire path already set last_run_at)
 * - cron with 5-field expr → next matching UTC wall time after `from`
 * - fallback → from + 24h (safe non-re-fire bound when expr unparsable)
 */
export function computeNextRunAt(
  job: ScheduledTaskJobDefinition,
  from: Date,
): string | null {
  if (job.schedule.kind === "once") {
    return null;
  }

  const expr =
    job.schedule.kind === "cron" ? job.schedule.expr?.trim() : undefined;
  if (expr) {
    const next = nextCronOccurrenceUtc(expr, from);
    if (next) return next.toISOString();
  }

  // Fallback: one day later so due scan is not stuck re-firing every tick.
  return new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Minimal 5-field cron next-occurrence (minute hour dom month dow) in UTC.
 * Supports star, single integers, lists (1,3), ranges (1-5), and steps (star/n).
 * Returns null when the expression cannot be parsed.
 */
export function nextCronOccurrenceUtc(
  expr: string,
  from: Date,
): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minF, hourF, domF, monF, dowF] = parts;
  const minutes = expandCronField(minF, 0, 59);
  const hours = expandCronField(hourF, 0, 23);
  const doms = expandCronField(domF, 1, 31);
  const months = expandCronField(monF, 1, 12);
  const dows = expandCronField(dowF, 0, 6);
  if (!minutes || !hours || !doms || !months || !dows) return null;

  // Start at the next full minute after the given from time.
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  // Search up to ~366 days of minutes (bounded).
  const limitMs = from.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= limitMs) {
    const m = cursor.getUTCMinutes();
    const h = cursor.getUTCHours();
    const dom = cursor.getUTCDate();
    const mon = cursor.getUTCMonth() + 1;
    const dow = cursor.getUTCDay(); // 0=Sun

    if (
      minutes.has(m) &&
      hours.has(h) &&
      months.has(mon) &&
      doms.has(dom) &&
      dows.has(dow)
    ) {
      return new Date(cursor.getTime());
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}

function expandCronField(
  field: string | undefined,
  min: number,
  max: number,
): Set<number> | null {
  if (!field) return null;
  const f = field.trim();
  if (f === "*") {
    return rangeSet(min, max);
  }
  const out = new Set<number>();
  for (const token of f.split(",")) {
    const t = token.trim();
    if (!t) return null;

    // */step or range/step
    const stepParts = t.split("/");
    const base = stepParts[0] ?? "";
    const step =
      stepParts.length === 2 ? Number(stepParts[1]) : stepParts.length === 1 ? 1 : NaN;
    if (!Number.isInteger(step) || step < 1) return null;

    let start = min;
    let end = max;
    if (base === "*") {
      start = min;
      end = max;
    } else if (base.includes("-")) {
      const [a, b] = base.split("-");
      start = Number(a);
      end = Number(b);
      if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
      if (start < min || end > max || start > end) return null;
    } else {
      const n = Number(base);
      if (!Number.isInteger(n) || n < min || n > max) return null;
      start = n;
      end = n;
    }

    for (let v = start; v <= end; v += step) {
      out.add(v);
    }
  }
  return out.size > 0 ? out : null;
}

function rangeSet(min: number, max: number): Set<number> {
  const s = new Set<number>();
  for (let i = min; i <= max; i++) s.add(i);
  return s;
}

// ---------------------------------------------------------------------------
// Platform SoT → fire-path job shape
// ---------------------------------------------------------------------------

/**
 * Map a platform SoT {@link ScheduledJob} row into the fire-path definition.
 * Returns null when id/schedule cannot be interpreted.
 */
export function toScheduledTaskJobDefinition(
  instanceId: string,
  job: ScheduledJob,
): ScheduledTaskJobDefinition | null {
  const id = String(job.id ?? "").trim();
  if (!id) return null;
  const schedule = normalizeSchedule(job.schedule);
  if (!schedule) return null;

  const enabled = job.enabled !== false;
  const tenantId =
    typeof job.tenant_id === "string" && job.tenant_id.trim()
      ? job.tenant_id.trim()
      : undefined;
  const userId =
    typeof job.user_id === "string" && job.user_id.trim()
      ? job.user_id.trim()
      : undefined;
  const ownerUserId =
    typeof job.owner_user_id === "string" && job.owner_user_id.trim()
      ? job.owner_user_id.trim()
      : undefined;
  const connectorIds = Array.isArray(job.connector_ids)
    ? job.connector_ids.map(String).map((s) => s.trim()).filter(Boolean)
    : undefined;
  return {
    id,
    instance_id: instanceId,
    ...(tenantId ? { tenant_id: tenantId } : {}),
    ...(userId ? { user_id: userId } : {}),
    ...(ownerUserId ? { owner_user_id: ownerUserId } : {}),
    ...(connectorIds && connectorIds.length > 0
      ? { connector_ids: connectorIds }
      : {}),
    name: typeof job.name === "string" && job.name.trim() ? job.name : id,
    enabled,
    schedule,
    prompt: typeof job.prompt === "string" ? job.prompt : "",
    skills: Array.isArray(job.skills)
      ? job.skills.map(String).filter(Boolean)
      : undefined,
    deliver: typeof job.deliver === "string" ? job.deliver : undefined,
    created_at:
      typeof job.created_at === "string" && job.created_at
        ? job.created_at
        : new Date(0).toISOString(),
    next_run_at:
      job.next_run_at === undefined
        ? undefined
        : job.next_run_at === null
          ? null
          : String(job.next_run_at),
    last_run_at:
      job.last_run_at === undefined
        ? undefined
        : job.last_run_at === null
          ? null
          : String(job.last_run_at),
    last_status:
      job.last_status === undefined
        ? undefined
        : job.last_status === null
          ? null
          : String(job.last_status),
    state:
      job.state === undefined
        ? undefined
        : job.state === null
          ? null
          : String(job.state),
  };
}

function normalizeSchedule(
  raw: ScheduledJob["schedule"],
): ScheduledTaskSchedule | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const expr = raw.trim();
    if (!expr) return null;
    return { kind: "cron", expr };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return null;

  const kind = String(raw.kind ?? "cron").toLowerCase();
  if (kind === "once") {
    const runAt =
      typeof raw.run_at === "string" ? raw.run_at.trim() : "";
    if (!runAt || !Number.isFinite(Date.parse(runAt))) return null;
    return {
      kind: "once",
      run_at: runAt,
      display: typeof raw.display === "string" ? raw.display : undefined,
    };
  }

  const expr =
    typeof raw.expr === "string"
      ? raw.expr.trim()
      : typeof raw.expression === "string"
        ? String(raw.expression).trim()
        : "";
  if (!expr) return null;
  return {
    kind: "cron",
    expr,
    display: typeof raw.display === "string" ? raw.display : undefined,
    timezone: typeof raw.timezone === "string" ? raw.timezone : undefined,
  };
}

/**
 * Adapter: platform {@link ScheduledJobRegistry} → fire-path
 * {@link ScheduledTaskJobRegistry} with listAll for the evaluator.
 *
 * Job ids are unique within an instance; across instances the fire registry
 * keys by job id only. Production dual-write should use globally unique job
 * ids (or namespaced ids). Tests seed one instance or unique ids.
 */
export function createFireJobRegistryFromPlatformSoT(
  platform: ScheduledJobRegistry,
): ScheduledTaskJobRegistry & {
  listAll(): Promise<ScheduledTaskJobDefinition[]>;
} {
  async function listAll(): Promise<ScheduledTaskJobDefinition[]> {
    const instanceIds = await platform.listInstanceIds();
    const out: ScheduledTaskJobDefinition[] = [];
    for (const instanceId of instanceIds) {
      const jobs = await platform.list(instanceId);
      for (const row of jobs) {
        const def = toScheduledTaskJobDefinition(instanceId, row);
        if (def) out.push(def);
      }
    }
    return out;
  }

  async function findByJobId(
    jobId: string,
  ): Promise<{ instanceId: string; job: ScheduledJob } | null> {
    const id = jobId?.trim() ?? "";
    if (!id) return null;
    for (const instanceId of await platform.listInstanceIds()) {
      const jobs = await platform.list(instanceId);
      const hit = jobs.find((j) => j.id === id);
      if (hit) return { instanceId, job: hit };
    }
    return null;
  }

  return {
    async get(jobId: string) {
      const hit = await findByJobId(jobId);
      if (!hit) return null;
      return toScheduledTaskJobDefinition(hit.instanceId, hit.job);
    },

    async update(jobId, patch) {
      const hit = await findByJobId(jobId);
      if (!hit) {
        throw new ScheduledTaskJobNotFoundError(jobId);
      }
      const current = toScheduledTaskJobDefinition(hit.instanceId, hit.job)!;
      const next: ScheduledTaskJobDefinition = { ...current, ...patch };
      await platform.putJob(hit.instanceId, {
        ...hit.job,
        id: next.id,
        name: next.name,
        enabled: next.enabled,
        schedule: next.schedule,
        prompt: next.prompt,
        skills: next.skills,
        deliver: next.deliver,
        created_at: next.created_at,
        next_run_at: next.next_run_at,
        last_run_at: next.last_run_at,
        last_status: next.last_status,
        state: next.state,
        ...(next.tenant_id ? { tenant_id: next.tenant_id } : {}),
        ...(next.user_id ? { user_id: next.user_id } : {}),
        ...(next.owner_user_id ? { owner_user_id: next.owner_user_id } : {}),
        ...(next.connector_ids ? { connector_ids: next.connector_ids } : {}),
      });
      return next;
    },

    listAll,
  };
}

// ---------------------------------------------------------------------------
// Evaluate + fire pass
// ---------------------------------------------------------------------------

export type ScheduleEvaluatorPassResult = {
  /** Jobs considered from the durable registry. */
  scanned: number;
  /** Jobs that were due at pass clock. */
  due: number;
  /** Successful fireScheduledTask completions (run_status ok or error both count as fired). */
  fired: string[];
  /** Job ids skipped (disabled / not due / running). */
  skipped: number;
  /** Per-job fire errors (missing mid-pass, fire threw, etc.). */
  errors: Array<{ job_id: string; instance_id?: string; message: string }>;
  /** Full fire results for tests/ops. */
  results: FireScheduledTaskResult[];
  /** ISO clock used for this pass. */
  at: string;
};

export type EvaluateDueScheduledJobsDeps = {
  /** Fire-path registry (get/update + optional listAll). */
  jobs: ScheduledTaskJobRegistry;
  /**
   * When jobs.listAll is absent, scan this platform SoT instead.
   * Prefer wiring listAll via {@link createFireJobRegistryFromPlatformSoT}.
   */
  platformRegistry?: ScheduledJobRegistry;
  orchestrator: ScheduledTaskFireOrchestrator;
  runJob: AgentJobRunner;
  /** Injectable clock (fake clock in tests). */
  now?: () => Date;
  /**
   * Optional fire implementation (defaults to {@link fireScheduledTask}).
   * Tests may spy / stub.
   */
  fire?: (
    deps: FireScheduledTaskDeps,
    input: { instance_id: string; job_id: string },
  ) => Promise<FireScheduledTaskResult>;
  /** Max jobs to fire in one pass (default unlimited). */
  maxFiresPerPass?: number;
  /** lp-xhf4.13: retarget Gmail/HubSpot/WhatsApp jobs onto the owner sandbox. */
  resolveFireInstance?: FireScheduledTaskDeps["resolveFireInstance"];
  injectJobConnectors?: FireScheduledTaskDeps["injectJobConnectors"];
};

/**
 * One evaluator pass: scan durable jobs, fire each due job via the platform
 * fire path (ensure_online + run). Does not require guest ticker or online
 * sandbox before the pass.
 */
export async function evaluateDueScheduledJobs(
  deps: EvaluateDueScheduledJobsDeps,
): Promise<ScheduleEvaluatorPassResult> {
  const nowFn = deps.now ?? (() => new Date());
  const now = nowFn();
  const at = now.toISOString();
  const fireFn = deps.fire ?? fireScheduledTask;

  const candidates = await listCandidateJobs(deps);
  const fired: string[] = [];
  const errors: ScheduleEvaluatorPassResult["errors"] = [];
  const results: FireScheduledTaskResult[] = [];
  let due = 0;
  let skipped = 0;
  const maxFires =
    deps.maxFiresPerPass !== undefined &&
    Number.isFinite(deps.maxFiresPerPass) &&
    deps.maxFiresPerPass >= 0
      ? Math.floor(deps.maxFiresPerPass)
      : Number.POSITIVE_INFINITY;

  for (const job of candidates) {
    if (!isScheduledJobDue(job, now)) {
      skipped += 1;
      continue;
    }
    due += 1;
    if (fired.length >= maxFires) {
      skipped += 1;
      continue;
    }

    // Re-check presence in registry (may have been deleted between list and fire).
    const latest = await deps.jobs.get(job.id);
    if (!latest) {
      errors.push({
        job_id: job.id,
        instance_id: job.instance_id,
        message: "job missing at fire time",
      });
      continue;
    }
    if (!latest.enabled || !isScheduledJobDue(latest, nowFn())) {
      skipped += 1;
      due -= 1;
      continue;
    }

    try {
      const result = await fireFn(
        {
          orchestrator: deps.orchestrator,
          jobs: deps.jobs,
          runJob: deps.runJob,
          now: nowFn,
          resolveFireInstance: deps.resolveFireInstance,
          injectJobConnectors: deps.injectJobConnectors,
        },
        { instance_id: latest.instance_id, job_id: latest.id },
      );
      results.push(result);
      fired.push(latest.id);

      // Advance next_run_at after fire (last_run already set by fire path).
      const finished = nowFn();
      const nextRun = computeNextRunAt(
        { ...latest, last_run_at: result.job.last_run_at },
        finished,
      );
      try {
        await deps.jobs.update(latest.id, { next_run_at: nextRun });
      } catch {
        // Best-effort; next pass may re-fire if next_run_at stuck — ops can repair.
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      errors.push({
        job_id: latest.id,
        instance_id: latest.instance_id,
        message,
      });
    }
  }

  return {
    scanned: candidates.length,
    due,
    fired,
    skipped,
    errors,
    results,
    at,
  };
}

async function listCandidateJobs(
  deps: EvaluateDueScheduledJobsDeps,
): Promise<ScheduledTaskJobDefinition[]> {
  if (typeof deps.jobs.listAll === "function") {
    return deps.jobs.listAll();
  }
  if (deps.platformRegistry) {
    const adapter = createFireJobRegistryFromPlatformSoT(deps.platformRegistry);
    return adapter.listAll();
  }
  return [];
}

// ---------------------------------------------------------------------------
// Background job (optional CP loop)
// ---------------------------------------------------------------------------

/** Safe structured log event (no secrets / prompt bodies). */
export type ScheduleEvaluatorLogEvent = {
  event:
    | "schedule_evaluator_pass"
    | "schedule_evaluator_error"
    | "schedule_evaluator_started"
    | "schedule_evaluator_stopped";
  scanned?: number;
  due?: number;
  fired?: number;
  skipped?: number;
  errors?: number;
  interval_ms?: number;
  error_message?: string;
};

export type ScheduleEvaluatorTimers = {
  setInterval: (handler: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export type ScheduleEvaluatorJobDeps = EvaluateDueScheduledJobsDeps & {
  /**
   * Scan interval (ms) for the background loop.
   * @default DEFAULT_SCHEDULE_EVALUATOR_INTERVAL_MS
   */
  intervalMs?: number;
  /** Timer port (tests inject fake interval). Defaults to global timers. */
  timers?: ScheduleEvaluatorTimers;
  /** Optional safe log sink. Never receives secrets or job prompts. */
  logSafe?: (event: ScheduleEvaluatorLogEvent) => void;
  /**
   * When true, the first interval tick runs immediately on start.
   * Default false — call {@link ScheduleEvaluatorJob.runOnce} for an immediate pass.
   */
  runOnStart?: boolean;
};

export type ScheduleEvaluatorJob = {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  runOnce(): Promise<ScheduleEvaluatorPassResult>;
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
export function parseScheduleEvaluatorIntervalEnv(
  value: string | undefined,
): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value.trim());
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

/** Truthy env flag parser for SCHEDULE_EVALUATOR_ENABLED. */
export function parseScheduleEvaluatorEnabledEnv(
  value: string | undefined,
): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Resolve evaluator interval + enabled flag from env. Pure; no I/O.
 */
export function resolveScheduleEvaluatorEnv(
  env: NodeJS.ProcessEnv = process.env,
): {
  intervalMs: number;
  enabled: boolean;
} {
  return {
    intervalMs:
      parseScheduleEvaluatorIntervalEnv(env[SCHEDULE_EVALUATOR_INTERVAL_ENV]) ??
      DEFAULT_SCHEDULE_EVALUATOR_INTERVAL_MS,
    enabled: parseScheduleEvaluatorEnabledEnv(
      env[SCHEDULE_EVALUATOR_ENABLED_ENV],
    ),
  };
}

/**
 * Create a schedule evaluator job that can be started as a CP background loop.
 *
 * Opt-in via {@link SCHEDULE_EVALUATOR_ENABLED_ENV}. Does not import Daytona SDK;
 * wake goes through fireScheduledTask → orchestrator.ensureOnline.
 */
export function createScheduleEvaluatorJob(
  deps: ScheduleEvaluatorJobDeps,
): ScheduleEvaluatorJob {
  const intervalMs = resolvePositiveMs(
    deps.intervalMs,
    DEFAULT_SCHEDULE_EVALUATOR_INTERVAL_MS,
  );
  const timers: ScheduleEvaluatorTimers = deps.timers ?? {
    setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
    clearInterval: (handle) => {
      globalThis.clearInterval(handle as ReturnType<typeof setInterval>);
    },
  };
  const logSafe = deps.logSafe;
  const runOnStart = deps.runOnStart === true;

  let handle: unknown = null;
  let running = false;
  let passInFlight: Promise<ScheduleEvaluatorPassResult> | null = null;

  function emit(event: ScheduleEvaluatorLogEvent): void {
    if (!logSafe) return;
    try {
      logSafe(event);
    } catch {
      // Logging must never break evaluator passes.
    }
  }

  function runOnce(): Promise<ScheduleEvaluatorPassResult> {
    if (passInFlight) {
      return passInFlight;
    }

    const pass = (async () => {
      try {
        const result = await evaluateDueScheduledJobs(deps);
        emit({
          event: "schedule_evaluator_pass",
          scanned: result.scanned,
          due: result.due,
          fired: result.fired.length,
          skipped: result.skipped,
          errors: result.errors.length,
          interval_ms: intervalMs,
        });
        return result;
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        emit({
          event: "schedule_evaluator_error",
          error_message: msg,
          interval_ms: intervalMs,
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
    void runOnce().catch(() => {
      /* logged */
    });
  }

  function start(): void {
    if (running) return;
    running = true;
    handle = timers.setInterval(tick, intervalMs);
    emit({
      event: "schedule_evaluator_started",
      interval_ms: intervalMs,
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
      event: "schedule_evaluator_stopped",
      interval_ms: intervalMs,
    });
  }

  return {
    start,
    stop,
    isRunning: () => running,
    runOnce,
    intervalMs,
  };
}
