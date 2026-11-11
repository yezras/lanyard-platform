/**
 * Bound-sandbox wake decision (lp-vqr0.6 / T1) and one-box-per-instance
 * create guard (lp-vqr0.15).
 *
 * Encode "Send never cold_create when sandbox_id is bound and the sandbox
 * is stopped" as a closed decision, not an if/else fall-through in the
 * orchestrator. Unbound first toolbox bind claims the in-process warm pool
 * (path `warm_pool`, lp-k5c4.5) when stocked; miss still cold-creates, but
 * only after labeled reuse misses and only off the click if replenish or
 * create-ahead already ran.
 *
 * Stale baked vault STS (lp-180p) is the only bound path that still
 * allows create (`cold_create_env_expired`).
 */

import type { DaytonaSandboxState } from "./daytona-client.js";

export type BoundSandboxWakeInput = {
  /** `get(sandbox_id)` result; null when the id is missing or get failed. */
  state: DaytonaSandboxState | null;
  /** True when this instance bakes expiring vault STS into guest env. */
  envExpiryGuardActive: boolean;
  /** True when sandbox.updatedAt is older than the STS TTL. */
  envIsStale: boolean;
  archiveRestoreOnWake: boolean;
};

/**
 * `allows_create: false` is the T1/T5 / lp-vqr0.15 invariant: execute start
 * (or use the already-running box). Do not fall through to Daytona create.
 */
export type BoundSandboxWakeDecision =
  | {
      action: "use_running";
      path: "start_from_stopped";
      allows_create: false;
    }
  | {
      action: "start";
      path: "start_from_stopped";
      allows_create: false;
    }
  | {
      action: "wait";
      path: "start_from_stopped";
      allows_create: false;
    }
  | {
      action: "restore";
      path: "archive_restore";
      allows_create: false;
    }
  | {
      action: "force_cold";
      path: "cold_create_env_expired";
      allows_create: true;
      reason: "stale_baked_env";
    }
  | {
      action: "unusable";
      allows_create: false;
      reason: "error";
    }
  | {
      action: "unusable";
      allows_create: true;
      reason: "missing" | "not_restorable";
    };

/** Daytona row the create guard can reuse instead of minting another box. */
export type SandboxReuseCandidate = {
  sandboxId: string;
  state: DaytonaSandboxState | null;
};

export type SandboxCreateGuardInput = {
  bound_sandbox_id: string | null;
  labeled: readonly SandboxReuseCandidate[];
};

/**
 * Closed create permission. One Daytona box per `instance_id`.
 * 504/start-fail retries must reuse, not create.
 */
export type SandboxCreateGuard =
  | {
      allows_create: false;
      reuse_sandbox_id: string;
      source: "bound" | "labeled";
    }
  | { allows_create: true };

const REUSABLE_LABELED_STATES: readonly DaytonaSandboxState[] = [
  "started",
  "stopped",
  "creating",
];

function staleEnvForcesCold(input: BoundSandboxWakeInput): boolean {
  return input.envExpiryGuardActive && input.envIsStale;
}

/**
 * Pure wake intent for a bound `sandbox_id`.
 * Callers execute the action; they must not create when `allows_create` is false.
 */
export function decideBoundSandboxWake(
  input: BoundSandboxWakeInput,
): BoundSandboxWakeDecision {
  if (input.state === "started") {
    return {
      action: "use_running",
      path: "start_from_stopped",
      allows_create: false,
    };
  }

  if (input.state === "creating") {
    return {
      action: "wait",
      path: "start_from_stopped",
      allows_create: false,
    };
  }

  if (input.state === "error") {
    return {
      action: "unusable",
      allows_create: false,
      reason: "error",
    };
  }

  if (input.state === "stopped") {
    if (staleEnvForcesCold(input)) {
      return {
        action: "force_cold",
        path: "cold_create_env_expired",
        allows_create: true,
        reason: "stale_baked_env",
      };
    }
    return {
      action: "start",
      path: "start_from_stopped",
      allows_create: false,
    };
  }

  if (input.state === "archived" && input.archiveRestoreOnWake) {
    if (staleEnvForcesCold(input)) {
      return {
        action: "force_cold",
        path: "cold_create_env_expired",
        allows_create: true,
        reason: "stale_baked_env",
      };
    }
    return {
      action: "restore",
      path: "archive_restore",
      allows_create: false,
    };
  }

  return {
    action: "unusable",
    allows_create: true,
    reason: input.state === null ? "missing" : "not_restorable",
  };
}

export function pickReusableLabeledSandbox(
  labeled: readonly SandboxReuseCandidate[],
): SandboxReuseCandidate | null {
  for (const wanted of REUSABLE_LABELED_STATES) {
    const hit = labeled.find(
      (row) => row.sandboxId.trim().length > 0 && row.state === wanted,
    );
    if (hit) {
      return hit;
    }
  }
  return null;
}

/**
 * Pure create permission for one instance_id. Callers must not Daytona-create
 * when `allows_create` is false (lp-vqr0.15).
 */
export function decideSandboxCreateGuard(
  input: SandboxCreateGuardInput,
): SandboxCreateGuard {
  const bound = input.bound_sandbox_id?.trim() || null;
  if (bound) {
    return {
      allows_create: false,
      reuse_sandbox_id: bound,
      source: "bound",
    };
  }
  const labeled = pickReusableLabeledSandbox(input.labeled);
  if (labeled) {
    return {
      allows_create: false,
      reuse_sandbox_id: labeled.sandboxId,
      source: "labeled",
    };
  }
  return { allows_create: true };
}
