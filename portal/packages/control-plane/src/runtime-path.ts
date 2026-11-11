/**
 * runtime_kind dual-path plumbing (lp-kng.2.11).
 *
 * Branches platform orchestration on `gateway_instances.runtime_kind`:
 * - **ec2** — always-on host path (today). ensure_online short-circuits;
 *   stop does **not** tear down the host. No Daytona create/start/stop.
 * - **daytona** — on-demand sandbox via Instance Orchestrator + DaytonaClient
 *   ({@link real harnessClient} offline; live SDK after human gate / Phase 4).
 *
 * **Hard rules (offline track / dual-run safety):**
 * - Never mutates `runtime_kind` (no implicit tenant flips in shared envs).
 * - Default remains `ec2` on the instance model (lp-nye); cutover is explicit
 *   provision/migration (`lp-6jx` / Phase 7), not this module.
 * - Dual-run is **per-instance** `runtime_kind` (`lp-gu2`) — not a global-only flip.
 * - Daytona path uses the orchestrator fake offline — no live AWS/Daytona.
 *
 * Design anchors:
 *   docs/plans/0008-daytona-agent-sandboxes/identity-model.md
 *   docs/plans/0008-daytona-agent-sandboxes/dual-run-runtime-kind.md
 *   docs/plans/0008-daytona-agent-sandboxes/offline-piping.md
 *   docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md
 */

import type { DaytonaConfig } from "./daytona-config.js";
import { isTenantOnDaytonaAllowlist } from "./daytona-config.js";
import type { RuntimeKind } from "./types.js";

/** Compute path identity — mirrors {@link RuntimeKind}. */
export type RuntimePath = RuntimeKind;

/** Resolve the dual-path branch from an instance's runtime_kind field. */
export function resolveRuntimePath(kind: RuntimeKind): RuntimePath {
  return kind;
}

export function isEc2RuntimePath(kind: RuntimeKind): boolean {
  return kind === "ec2";
}

export function isDaytonaRuntimePath(kind: RuntimeKind): boolean {
  return kind === "daytona";
}

/**
 * Always-on host compute: ensure_online reports already-online without create;
 * stop is a no-op for the host (does not call Daytona).
 */
export function isAlwaysOnCompute(kind: RuntimeKind): boolean {
  return kind === "ec2";
}

/** True when lifecycle ops may touch managed Daytona for this kind. */
export function usesDaytonaCompute(kind: RuntimeKind): boolean {
  return kind === "daytona";
}

// ---------------------------------------------------------------------------
// ensure_online decision
// ---------------------------------------------------------------------------

export type EnsureOnlinePathDecision =
  | {
      path: "ec2";
      action: "short_circuit_already_online";
      /** Never calls DaytonaClient. */
      calls_daytona: false;
    }
  | {
      path: "daytona";
      action: "wake_via_orchestrator";
      calls_daytona: true;
    }
  | {
      path: "daytona";
      action: "deny_daytona_path_gated";
      calls_daytona: false;
      reason: "disabled" | "not_allowlisted";
    };

/**
 * Decide ensure_online branch from the instance model (+ optional platform config).
 *
 * When `config` is omitted (unit tests / pure offline dual-path), `runtime_kind=daytona`
 * always wakes via the orchestrator fake. When `config` is provided, `DAYTONA_ENABLED`
 * + tenant allowlist gate the live path **without** flipping tenants' `runtime_kind`.
 */
export function decideEnsureOnlinePath(input: {
  runtime_kind: RuntimeKind;
  tenant_id: string;
  /**
   * Optional platform Daytona config. Omit for pure offline dual-path tests
   * (always wake when kind=daytona). Provide in CP/BFF wiring to enforce gates.
   */
  config?: Pick<DaytonaConfig, "enabled" | "tenantAllowlist"> | null;
}): EnsureOnlinePathDecision {
  if (input.runtime_kind === "ec2") {
    return {
      path: "ec2",
      action: "short_circuit_already_online",
      calls_daytona: false,
    };
  }

  // runtime_kind=daytona
  if (input.config != null) {
    if (!input.config.enabled) {
      return {
        path: "daytona",
        action: "deny_daytona_path_gated",
        calls_daytona: false,
        reason: "disabled",
      };
    }
    // enabled but empty allowlist / missing tenant → fail closed (no tenant flip)
    if (
      !isTenantOnDaytonaAllowlist(
        input.config as DaytonaConfig,
        input.tenant_id,
      )
    ) {
      return {
        path: "daytona",
        action: "deny_daytona_path_gated",
        calls_daytona: false,
        reason: "not_allowlisted",
      };
    }
  }

  return {
    path: "daytona",
    action: "wake_via_orchestrator",
    calls_daytona: true,
  };
}

// ---------------------------------------------------------------------------
// stop decision
// ---------------------------------------------------------------------------

export type StopPathDecision =
  | {
      path: "ec2";
      action: "no_op_always_on";
      calls_daytona: false;
    }
  | {
      path: "daytona";
      action: "stop_sandbox_if_bound";
      calls_daytona: true;
    };

/**
 * Decide stop branch from runtime_kind.
 * EC2 hosts stay up (always-on). Daytona stops/clears ephemeral sandbox only.
 */
export function decideStopPath(runtime_kind: RuntimeKind): StopPathDecision {
  if (runtime_kind === "ec2") {
    return {
      path: "ec2",
      action: "no_op_always_on",
      calls_daytona: false,
    };
  }
  return {
    path: "daytona",
    action: "stop_sandbox_if_bound",
    calls_daytona: true,
  };
}

// ---------------------------------------------------------------------------
// Safety helpers
// ---------------------------------------------------------------------------

/**
 * Dual-path plumbing never mutates runtime_kind. Call sites that patch instance
 * rows should not change kind as a side-effect of ensure_online / stop.
 */
export function assertRuntimeKindUnchanged(
  before: RuntimeKind,
  after: RuntimeKind,
): void {
  if (before !== after) {
    throw new Error(
      `runtime_kind must not flip in dual-path plumbing (was ${before}, now ${after}); ` +
        `tenant cutover is explicit provision/migration only`,
    );
  }
}

/**
 * Thrown when runtime_kind=daytona but platform config gates the path
 * (DAYTONA_ENABLED off or tenant not on allowlist). Does not flip kind.
 */
export class DaytonaPathGatedError extends Error {
  readonly code = "DAYTONA_PATH_GATED" as const;
  readonly instanceId: string;
  readonly tenantId: string;
  readonly reason: "disabled" | "not_allowlisted";

  constructor(
    instanceId: string,
    tenantId: string,
    reason: "disabled" | "not_allowlisted",
  ) {
    super(
      reason === "disabled"
        ? `Daytona path gated: DAYTONA_ENABLED is off (instance ${instanceId})`
        : `Daytona path gated: tenant ${tenantId} is not on DAYTONA_TENANT_ALLOWLIST (instance ${instanceId})`,
    );
    this.name = "DaytonaPathGatedError";
    this.instanceId = instanceId;
    this.tenantId = tenantId;
    this.reason = reason;
  }
}
