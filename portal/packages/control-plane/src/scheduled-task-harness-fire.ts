/**
 * Short-stack scheduled-task fire: harness HTTP turn, not guest cron
 * (lp-oop.38.8 / plan 0015 follow-on of lp-jzl).
 *
 * Platform evaluator / ops call this instead of a guest ticker:
 *   1. ensure_online(instance, sandbox_create_profile=tool_only)
 *   2. mid_turn while the harness turn runs
 *   3. POST /internal/turns with tenant_id, user_id, instance_id, thread_id,
 *      message = job prompt
 *   4. clear mid_turn
 *
 * Idle sandbox stays tool-only — no GATEWAY_RELAY_SECRET on create env.
 * Guest `$BACKEND_HOME/cron/jobs.json` is not the fire SoT (vault is).
 *
 * Live always-on ticker (`SCHEDULE_EVALUATOR_ENABLED`) is opt-in and is
 * **not** rolled this wave — call {@link fireScheduledTaskHarnessTurn} /
 * {@link evaluateDueScheduledJobs} with this fire fn from tests or ops.
 */

import type { TurnRequest } from "@lanyard/shared";

import type { SandboxCreateProfile } from "./short-stack-create-env.js";
import {
  fireScheduledTask,
  PORTAL_THREAD_DELIVER,
  type AgentJobRunResult,
  type AgentJobRunner,
  type FireScheduledTaskDeps,
  type FireScheduledTaskInput,
  type FireScheduledTaskResult,
  type ScheduledTaskJobDefinition,
} from "./scheduled-task-fire.js";

/** Cold-create profile for harness fire wake. Guest is toolbox-only. */
export const HARNESS_SCHEDULED_TASK_CREATE_PROFILE: SandboxCreateProfile =
  "tool_only";

/**
 * Harness turn identity for one scheduled-task fire.
 * Required fields match {@link TurnRequest} so BFF/harness do not fork the
 * chat mapper.
 */
export type HarnessScheduledTaskTurn = TurnRequest & {
  job_id: string;
};

export type StartHarnessScheduledTaskTurn = (
  request: HarnessScheduledTaskTurn,
) => Promise<{ turn_id: string }>;

export type HarnessScheduledTaskIdentity = {
  tenant_id: string;
  user_id: string;
};

export type FireScheduledTaskHarnessDeps = FireScheduledTaskDeps & {
  /** POST /internal/turns. Tests inject real harness via HarnessClient. */
  startTurn: StartHarnessScheduledTaskTurn;
  /**
   * Tenant/user stamped on the harness turn when the job row omits them.
   * Job fields win when set (vault create writes both).
   */
  identity: HarnessScheduledTaskIdentity;
};

export type FireScheduledTaskHarnessResult = FireScheduledTaskResult & {
  /** Harness turn id when startTurn succeeded. */
  harness_turn_id?: string;
  /** Exact TurnRequest sent (no prompt logging in production log sinks). */
  harness_turn?: HarnessScheduledTaskTurn;
};

function requireIdentityField(
  value: string | undefined,
  field: "tenant_id" | "user_id",
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`scheduled-task harness fire requires ${field}`);
  }
  return trimmed;
}

export function resolveHarnessScheduledTaskIdentity(
  job: ScheduledTaskJobDefinition,
  fallback: HarnessScheduledTaskIdentity,
): HarnessScheduledTaskIdentity {
  return {
    tenant_id: requireIdentityField(
      job.tenant_id || fallback.tenant_id,
      "tenant_id",
    ),
    user_id: requireIdentityField(job.user_id || fallback.user_id, "user_id"),
  };
}

/**
 * Build the harness TurnRequest for a job fire. `message` is the job prompt
 * (tenant content — do not log). `thread_id` is the durable job stream when
 * provided, else a stable per-job fallback so two fires share one chat_id.
 */
export function buildHarnessScheduledTaskTurn(input: {
  job: ScheduledTaskJobDefinition;
  instance_id: string;
  identity: HarnessScheduledTaskIdentity;
  thread_id?: string;
  sandbox_id?: string | null;
}): HarnessScheduledTaskTurn {
  const identity = resolveHarnessScheduledTaskIdentity(
    input.job,
    input.identity,
  );
  const threadId =
    input.thread_id?.trim() || `scheduled-task:${input.job.id}`;
  const message = input.job.prompt?.trim() || input.job.name;
  if (!message) {
    throw new Error("scheduled-task harness fire requires a prompt or name");
  }
  const sandboxId = input.sandbox_id?.trim();
  return {
    tenant_id: identity.tenant_id,
    user_id: identity.user_id,
    instance_id: input.instance_id,
    thread_id: threadId,
    message,
    job_id: input.job.id,
    ...(sandboxId ? { sandbox_id: sandboxId } : {}),
  };
}

/**
 * AgentJobRunner that starts a harness HTTP turn (not guest deliver-inbound).
 */
export function createHarnessScheduledTaskRunner(input: {
  startTurn: StartHarnessScheduledTaskTurn;
  identity: HarnessScheduledTaskIdentity;
  /** Optional sink so fireScheduledTaskHarnessTurn can surface the turn. */
  onTurn?: (turn: HarnessScheduledTaskTurn, turnId: string) => void;
}): AgentJobRunner {
  return async ({ instance_id, job, sandbox_id, thread_id }) => {
    const turn = buildHarnessScheduledTaskTurn({
      job,
      instance_id,
      identity: input.identity,
      thread_id,
      sandbox_id,
    });
    const started = await input.startTurn(turn);
    const turnId = started.turn_id?.trim();
    if (!turnId) {
      return {
        status: "error",
        error: "Harness scheduled-task start turn response missing turn_id",
      };
    }
    input.onTurn?.(turn, turnId);
    return {
      status: "ok",
      turn_id: turnId,
      detail: { path: "harness", turn_id: turnId, job_id: job.id },
    };
  };
}

/**
 * Platform fire path for ChatDelivery=harness: tool_only wake + harness turn.
 *
 * Spine (lp-k5c4.6): wrap `startTurn` with BFF `spineStartTurnForCron` so
 * the fire shares the room lease. Do not POST harness directly for spine
 * tenants. Classifier sets sandbox_need from sandbox_create_profile.
 *
 * Does not rematerialize guest cron/jobs.json. Does not inject
 * GATEWAY_RELAY_SECRET (tool_only create-env denylist).
 */
export async function fireScheduledTaskHarnessTurn(
  deps: FireScheduledTaskHarnessDeps,
  input: FireScheduledTaskInput,
): Promise<FireScheduledTaskHarnessResult> {
  let harnessTurn: HarnessScheduledTaskTurn | undefined;
  let harnessTurnId: string | undefined;

  const runJob = createHarnessScheduledTaskRunner({
    startTurn: deps.startTurn,
    identity: deps.identity,
    onTurn(turn, turnId) {
      harnessTurn = turn;
      harnessTurnId = turnId;
    },
  });

  const result = await fireScheduledTask(
    {
      orchestrator: deps.orchestrator,
      jobs: deps.jobs,
      runJob,
      now: deps.now,
      ensureJobStream: deps.ensureJobStream,
      appendJobStreamTurn: deps.appendJobStreamTurn,
      resolveFireInstance: deps.resolveFireInstance,
      injectJobConnectors: deps.injectJobConnectors,
    },
    {
      ...input,
      sandbox_create_profile: HARNESS_SCHEDULED_TASK_CREATE_PROFILE,
    },
  );

  return {
    ...result,
    harness_turn_id: harnessTurnId,
    harness_turn: harnessTurn,
  };
}

/** Default deliver mode for vault/harness creates (portal job stream). */
export const HARNESS_SCHEDULED_TASK_DELIVER = PORTAL_THREAD_DELIVER;
