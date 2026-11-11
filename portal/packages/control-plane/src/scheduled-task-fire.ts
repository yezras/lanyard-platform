/**
 * Platform scheduled-task fire path (lp-jzl.7 / lp-jzl.10).
 *
 * Durable schedule evaluation lives outside the ephemeral guest. When a job
 * is due, the platform:
 *   1. ensure_online(instance) — wake stopped/offline sandbox
 *   2. arm mid_turn while the agent job runs
 *   3. invoke agent job run (deliver-inbound / internal run-job hook)
 *   4. clear mid_turn on completion
 *   5. allow idle reaper to stop after grace
 *
 * Job definitions live in a platform-side registry (not guest RAM), so they
 * survive idle stop. Schedule evaluator (lp-jzl.10.2) calls this helper.
 *
 * Offline-testable with real harness + injectable clock. No live MockLab
 * (that is lp-jzl.8).
 */

import type {
  EnsureOnlineRequest,
  EnsureOnlineResponse,
} from "./orchestrator-api.js";
import type { InstanceOrchestrator } from "./instance-orchestrator.js";
import type { SandboxCreateProfile } from "./short-stack-create-env.js";
import { TenantSandboxConnectorInjectError } from "./connector-user-sandbox.js";
import {
  TenantCronUserConnectorError,
  scheduledTaskConnectorNeedFromJob,
  type ScheduledTaskConnectorNeed,
  type ScheduledTaskFireTarget,
} from "./scheduled-task-connectors.js";

// ---------------------------------------------------------------------------
// Job definition (platform durable SoT — survives sandbox stop)
// ---------------------------------------------------------------------------

/** Cron schedule on a durable job row. */
export type ScheduledTaskCronSchedule = {
  kind: "cron";
  expr: string;
  display?: string;
  timezone?: string;
};

/** One-shot schedule on a durable job row. */
export type ScheduledTaskOnceSchedule = {
  kind: "once";
  run_at: string;
  display?: string;
};

export type ScheduledTaskSchedule =
  | ScheduledTaskCronSchedule
  | ScheduledTaskOnceSchedule;

/**
 * Durable scheduled-task / cron job definition.
 * Compatible with LA `$BACKEND_HOME/cron/jobs.json` projection and Brain RPC
 * `cron.create` / `cron.update` rows (lp-jzl.3). Stored on platform SoT so
 * idle stop does not lose the definition.
 */
export type ScheduledTaskJobDefinition = {
  id: string;
  /** Owning gateway instance (presence / ensure_online target). */
  instance_id: string;
  /**
   * Tenant/user stamped at create (lp-oop.38.8). Harness fire puts these
   * on the TurnRequest. Optional on the guest/relay fire path.
   */
  tenant_id?: string;
  user_id?: string;
  /**
   * Owner of user-principal connectors on this job (lp-xhf4.13).
   * Required when connector_ids is non-empty. Same as user_id at create.
   */
  owner_user_id?: string;
  /** User-principal connectors this job needs (google / hubspot / whatsapp). */
  connector_ids?: string[];
  name: string;
  enabled: boolean;
  schedule: ScheduledTaskSchedule;
  prompt: string;
  skills?: string[];
  deliver?: string;
  created_at: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: "ok" | "error" | "running" | string | null;
  state?: string | null;
};

/** Patch surface for fire-path status updates. */
export type ScheduledTaskJobPatch = {
  last_run_at?: string | null;
  last_status?: string | null;
  next_run_at?: string | null;
  state?: string | null;
  enabled?: boolean;
};

/**
 * Platform-side job registry. Must outlive ephemeral sandboxes (in-memory for
 * tests; Postgres / vault-backed production later).
 */
export type ScheduledTaskJobRegistry = {
  get(jobId: string): Promise<ScheduledTaskJobDefinition | null>;
  update(
    jobId: string,
    patch: ScheduledTaskJobPatch,
  ): Promise<ScheduledTaskJobDefinition>;
  /**
   * Optional full scan for the platform schedule evaluator (lp-jzl.10.2).
   * When omitted, evaluator adapters list via platform SoT instead.
   */
  listAll?(): Promise<ScheduledTaskJobDefinition[]>;
};

// ---------------------------------------------------------------------------
// Agent job run hook
// ---------------------------------------------------------------------------

/** Outcome of one agent job invocation (deliver-inbound / run-job). */
export type AgentJobRunResult = {
  status: "ok" | "error";
  error?: string;
  /** Optional opaque detail for logs/tests (no secrets). */
  detail?: unknown;
  /**
   * Optional assistant/result text for the durable job stream chat
   * (lp-fn5.5.3). When {@link FireScheduledTaskDeps.appendJobStreamTurn} is
   * wired, this is appended as a `message_send` on the bound thread.
   */
  result_text?: string;
  /** Harness turn id when the runner started POST /internal/turns. */
  turn_id?: string;
};

/**
 * Invokes the agent to run a scheduled job after the sandbox is online.
 * Production: Relay deliver-inbound (portal_thread → bound chat_id) or
 * Brain RPC / internal run-job. Tests: Fake runner that records calls.
 */
export type AgentJobRunner = (input: {
  instance_id: string;
  job: ScheduledTaskJobDefinition;
  sandbox_id: string | null;
  started_at: string;
  /**
   * Bound portal job stream thread when {@link FireScheduledTaskDeps.ensureJobStream}
   * is wired (lp-fn5.5.3). Production deliver-inbound must use this as
   * `source.chat_id` so outbound lands on the job stream — never a new chat.
   */
  thread_id?: string;
}) => Promise<AgentJobRunResult>;

// ---------------------------------------------------------------------------
// Job stream binding (lp-fn5.5.3 — portal durable chat per job)
// ---------------------------------------------------------------------------

/**
 * Result of resolving the durable scheduled-task stream for a job.
 * Same job must yield the same `thread_id` across fires.
 */
export type JobStreamBinding = {
  thread_id: string;
  created?: boolean;
};

/**
 * Job `deliver` mode that targets the portal job stream chat.
 * Other values (e.g. `local`) remain valid; stream append is controlled by
 * whether {@link FireScheduledTaskDeps.ensureJobStream} is wired.
 */
export const PORTAL_THREAD_DELIVER = "portal_thread" as const;

export function isPortalThreadDeliver(
  deliver: string | undefined | null,
): boolean {
  if (deliver == null || deliver === "") return false;
  return deliver.trim().toLowerCase() === PORTAL_THREAD_DELIVER;
}

// ---------------------------------------------------------------------------
// Fire API
// ---------------------------------------------------------------------------

/** Subset of the orchestrator required by the fire path. */
export type ScheduledTaskFireOrchestrator = Pick<
  InstanceOrchestrator,
  "ensureOnline" | "setMidTurn" | "signalActivity" | "getPresence"
>;

export type FireScheduledTaskDeps = {
  orchestrator: ScheduledTaskFireOrchestrator;
  jobs: ScheduledTaskJobRegistry;
  runJob: AgentJobRunner;
  /** Injectable clock (fake clock in tests). */
  now?: () => Date;
  /**
   * lp-fn5.5.3: resolve the durable job stream chat before the agent run.
   * When provided, fire always binds to the same `thread_id` per job (via
   * portal `ensureForJob` / BFF hooks) and passes it to {@link runJob}.
   * Failures here fail the fire (no agent run without a stream target when
   * the hook is configured).
   */
  ensureJobStream?: (input: {
    job: ScheduledTaskJobDefinition;
    instance_id: string;
  }) => Promise<JobStreamBinding>;
  /**
   * lp-fn5.5.3: append one fire turn to the bound stream after the run
   * completes (user prompt + optional assistant `result_text` / error).
   * Best-effort: append errors are recorded on the result but do not flip
   * an ok agent run to error.
   */
  appendJobStreamTurn?: (input: {
    thread_id: string;
    job: ScheduledTaskJobDefinition;
    run_status: "ok" | "error";
    run_error?: string;
    started_at: string;
    finished_at: string;
    result_text?: string;
  }) => Promise<void>;
  /**
   * lp-xhf4.13: user-principal jobs (Gmail/HubSpot/WhatsApp) wake the
   * owner sandbox, not the tenant primary. When omitted, connector jobs
   * still refuse a tenant target if {@link injectJobConnectors} is wired.
   */
  resolveFireInstance?: (input: {
    job: ScheduledTaskJobDefinition;
    requested_instance_id: string;
    need: ScheduledTaskConnectorNeed;
  }) => Promise<ScheduledTaskFireTarget>;
  /**
   * lp-xhf4.13: lazy-inject the job's connectors onto the woken user
   * sandbox. Must throw {@link TenantSandboxConnectorInjectError} when
   * the target is tenant-scoped.
   */
  injectJobConnectors?: (input: {
    job: ScheduledTaskJobDefinition;
    need: ScheduledTaskConnectorNeed;
    instance_id: string;
    sandbox_id: string | null;
  }) => Promise<void>;
};

export type FireScheduledTaskInput = {
  instance_id: string;
  job_id: string;
  /** Forwarded to ensure_online when waking. */
  wait_timeout_ms?: number;
  /**
   * Cold-create env profile forwarded to ensure_online.
   * Harness fire passes `tool_only` so GATEWAY_RELAY_SECRET stays off
   * the guest (lp-oop.38.8). Omitted → CP default (`guest_gateway`).
   */
  sandbox_create_profile?: SandboxCreateProfile;
  /**
   * When true (default), refuse to fire disabled jobs.
   * Schedule evaluator may pass false only for explicit force-run ops.
   */
  require_enabled?: boolean;
};

export type FireScheduledTaskResult = {
  instance_id: string;
  job_id: string;
  /** ensure_online outcome (wake or already_online). */
  wake: EnsureOnlineResponse;
  /** Agent run outcome. */
  run_status: "ok" | "error";
  run_error?: string;
  /** True when mid_turn was cleared in the finally path. */
  mid_turn_cleared: boolean;
  started_at: string;
  finished_at: string;
  /** Job row after last_run_at / last_status update. */
  job: ScheduledTaskJobDefinition;
  /**
   * Bound portal job stream thread when ensureJobStream was wired and
   * succeeded (lp-fn5.5.3). Two fires of the same job share this id.
   */
  thread_id?: string;
  /** True when appendJobStreamTurn completed without throwing. */
  job_stream_appended?: boolean;
};

export class ScheduledTaskJobNotFoundError extends Error {
  readonly code = "SCHEDULED_TASK_JOB_NOT_FOUND" as const;
  readonly jobId: string;

  constructor(jobId: string) {
    super(`scheduled task job not found: ${jobId}`);
    this.name = "ScheduledTaskJobNotFoundError";
    this.jobId = jobId;
  }
}

export class ScheduledTaskJobDisabledError extends Error {
  readonly code = "SCHEDULED_TASK_JOB_DISABLED" as const;
  readonly jobId: string;

  constructor(jobId: string) {
    super(`scheduled task job is disabled: ${jobId}`);
    this.name = "ScheduledTaskJobDisabledError";
    this.jobId = jobId;
  }
}

export class ScheduledTaskInstanceMismatchError extends Error {
  readonly code = "SCHEDULED_TASK_INSTANCE_MISMATCH" as const;
  readonly jobId: string;
  readonly expectedInstanceId: string;
  readonly jobInstanceId: string;

  constructor(jobId: string, expectedInstanceId: string, jobInstanceId: string) {
    super(
      `scheduled task job ${jobId} belongs to instance ${jobInstanceId}, not ${expectedInstanceId}`,
    );
    this.name = "ScheduledTaskInstanceMismatchError";
    this.jobId = jobId;
    this.expectedInstanceId = expectedInstanceId;
    this.jobInstanceId = jobInstanceId;
  }
}

/**
 * Platform fire path: wake sandbox → bind job stream → mid_turn → run job →
 * append stream turn → clear mid_turn.
 *
 * Does **not** stop the sandbox; idle reaper stops after grace once activity
 * ages out (post-run signalActivity starts the grace clock).
 *
 * When {@link FireScheduledTaskDeps.ensureJobStream} is wired (lp-fn5.5.3),
 * every fire reuses the same portal `thread_id` for the job — never a new
 * chat per run. Production runJob should deliver-inbound with that chat_id.
 */
export async function fireScheduledTask(
  deps: FireScheduledTaskDeps,
  input: FireScheduledTaskInput,
): Promise<FireScheduledTaskResult> {
  const nowFn = deps.now ?? (() => new Date());
  const instanceId = input.instance_id?.trim() || input.instance_id;
  const jobId = input.job_id?.trim() || input.job_id;
  const requireEnabled = input.require_enabled !== false;

  const job = await deps.jobs.get(jobId);
  if (!job) {
    throw new ScheduledTaskJobNotFoundError(jobId);
  }
  const need = scheduledTaskConnectorNeedFromJob(job);
  if (job.instance_id !== instanceId && need.kind !== "user_principal") {
    throw new ScheduledTaskInstanceMismatchError(
      jobId,
      instanceId,
      job.instance_id,
    );
  }
  if (requireEnabled && !job.enabled) {
    throw new ScheduledTaskJobDisabledError(jobId);
  }

  let fireInstanceId = instanceId;
  if (need.kind === "user_principal") {
    if (!deps.resolveFireInstance) {
      throw new TenantCronUserConnectorError(need.connector_ids);
    }
    const target = await deps.resolveFireInstance({
      job,
      requested_instance_id: instanceId,
      need,
    });
    if (target.scope === "tenant") {
      throw new TenantSandboxConnectorInjectError(
        "User-principal scheduled tasks cannot fire on a tenant sandbox",
      );
    }
    fireInstanceId = target.instance_id;
  }

  const startedAt = nowFn();
  const startedIso = startedAt.toISOString();

  const ensureReq: EnsureOnlineRequest | undefined =
    input.wait_timeout_ms !== undefined ||
    input.sandbox_create_profile !== undefined
      ? {
          ...(input.wait_timeout_ms !== undefined
            ? { wait_timeout_ms: input.wait_timeout_ms }
            : {}),
          ...(input.sandbox_create_profile
            ? { sandbox_create_profile: input.sandbox_create_profile }
            : {}),
        }
      : undefined;

  // 1. Wake (offline|error|stopped → online). already_online short-circuits.
  // User-principal connector jobs wake the owner sandbox, not tenant primary.
  const wake = await deps.orchestrator.ensureOnline(fireInstanceId, ensureReq);

  let midTurnCleared = false;
  let runStatus: "ok" | "error" = "ok";
  let runError: string | undefined;
  let resultText: string | undefined;
  let threadId: string | undefined;
  let jobStreamAppended: boolean | undefined;

  try {
    // 1b. lp-fn5.5.3: resolve durable job stream before agent run so deliver
    // and history share one thread_id across fires.
    if (deps.ensureJobStream) {
      const binding = await deps.ensureJobStream({
        job,
        instance_id: fireInstanceId,
      });
      const bound = binding.thread_id?.trim();
      if (!bound) {
        throw new Error("ensureJobStream returned empty thread_id");
      }
      threadId = bound;
    }

    // 1c. lp-xhf4.13: inject user-principal connectors onto the woken
    // user sandbox. Tenant targets fail closed.
    if (need.kind === "user_principal" && deps.injectJobConnectors) {
      await deps.injectJobConnectors({
        job,
        need,
        instance_id: fireInstanceId,
        sandbox_id: wake.sandbox_id,
      });
    }

    // 2. Arm mid_turn + refresh idle timer for the duration of the run.
    await deps.orchestrator.setMidTurn(fireInstanceId, true, { at: startedAt });
    await deps.orchestrator.signalActivity(fireInstanceId, {
      at: startedIso,
      mid_turn: true,
    });

    // Mark running in durable registry (survives if guest dies mid-run).
    await deps.jobs.update(jobId, {
      state: "running",
      last_status: "running",
    });

    // 3. Invoke agent job run (deliver-inbound / internal run-job).
    // Pass bound thread_id so production deliver uses portal job stream chat.
    const runResult = await deps.runJob({
      instance_id: fireInstanceId,
      job,
      sandbox_id: wake.sandbox_id,
      started_at: startedIso,
      thread_id: threadId,
    });

    if (runResult.status === "error") {
      runStatus = "error";
      runError = runResult.error ?? "agent job run failed";
    }
    if (typeof runResult.result_text === "string") {
      resultText = runResult.result_text;
    }
  } catch (cause) {
    runStatus = "error";
    runError = cause instanceof Error ? cause.message : String(cause);
  } finally {
    // 4. Clear mid_turn so idle reaper may stop after grace.
    const finishedAt = nowFn();
    const finishedIso = finishedAt.toISOString();
    try {
      await deps.orchestrator.setMidTurn(fireInstanceId, false, {
        at: finishedAt,
      });
      await deps.orchestrator.signalActivity(fireInstanceId, {
        at: finishedIso,
        mid_turn: false,
      });
      midTurnCleared = true;
    } catch {
      // Best-effort clear; leave mid_turn_cleared false for caller observability.
      midTurnCleared = false;
    }

    // 4b. lp-fn5.5.3: append fire turn to bound stream (best-effort).
    if (deps.appendJobStreamTurn && threadId) {
      try {
        await deps.appendJobStreamTurn({
          thread_id: threadId,
          job,
          run_status: runStatus,
          run_error: runError,
          started_at: startedIso,
          finished_at: finishedIso,
          result_text: resultText,
        });
        jobStreamAppended = true;
      } catch {
        jobStreamAppended = false;
      }
    }

    // Persist run outcome on durable job row (survives subsequent idle stop).
    try {
      await deps.jobs.update(jobId, {
        last_run_at: finishedIso,
        last_status: runStatus,
        state: runStatus === "ok" ? "scheduled" : "error",
      });
    } catch {
      // Registry write failure does not undo wake/run; surface via re-get.
    }
  }

  const finishedAt = nowFn();
  const finishedIso = finishedAt.toISOString();
  const updatedJob =
    (await deps.jobs.get(jobId)) ??
    ({
      ...job,
      last_run_at: finishedIso,
      last_status: runStatus,
    } satisfies ScheduledTaskJobDefinition);

  return {
    instance_id: fireInstanceId,
    job_id: jobId,
    wake,
    run_status: runStatus,
    run_error: runError,
    mid_turn_cleared: midTurnCleared,
    started_at: startedIso,
    finished_at: finishedIso,
    job: updatedJob,
    thread_id: threadId,
    job_stream_appended: jobStreamAppended,
  };
}

// ---------------------------------------------------------------------------
// In-memory registry (unit / integration tests)
// ---------------------------------------------------------------------------

/**
 * In-memory {@link ScheduledTaskJobRegistry} for real harness fire-path tests.
 * Not multi-process; production will use durable CP/vault storage.
 */
export function createInMemoryScheduledTaskJobRegistry(
  seed: Iterable<ScheduledTaskJobDefinition> = [],
): ScheduledTaskJobRegistry & {
  listAll(): Promise<ScheduledTaskJobDefinition[]>;
  snapshot(): ScheduledTaskJobDefinition[];
  seed(job: ScheduledTaskJobDefinition): void;
  clear(): void;
} {
  const map = new Map<string, ScheduledTaskJobDefinition>();
  for (const j of seed) {
    map.set(j.id, {
      ...j,
      skills: j.skills ? [...j.skills] : undefined,
      connector_ids: j.connector_ids ? [...j.connector_ids] : undefined,
    });
  }

  function cloneJob(j: ScheduledTaskJobDefinition): ScheduledTaskJobDefinition {
    return {
      ...j,
      skills: j.skills ? [...j.skills] : undefined,
      connector_ids: j.connector_ids ? [...j.connector_ids] : undefined,
    };
  }

  return {
    async get(jobId: string) {
      const j = map.get(jobId);
      return j ? cloneJob(j) : null;
    },
    async update(jobId: string, patch: ScheduledTaskJobPatch) {
      const existing = map.get(jobId);
      if (!existing) {
        throw new ScheduledTaskJobNotFoundError(jobId);
      }
      const next: ScheduledTaskJobDefinition = {
        ...existing,
        ...patch,
      };
      map.set(jobId, next);
      return cloneJob(next);
    },
    async listAll() {
      return [...map.values()].map(cloneJob);
    },
    snapshot() {
      return [...map.values()].map(cloneJob);
    },
    seed(job: ScheduledTaskJobDefinition) {
      map.set(job.id, cloneJob(job));
    },
    clear() {
      map.clear();
    },
  };
}
