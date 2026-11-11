/**
 * Control Plane internal Instance Orchestrator API surface (lp-biq).
 *
 * Declares routes + request/response shapes for:
 *   ensure-online | ensure-bound-stopped | presence | signal-activity | stop
 *
 * Bodies may return HTTP 501 `not_implemented` until offline orchestrator
 * (`lp-kng.2.1`) / Phase 4 live SDK fill them. Presence GET can read the
 * existing `gateway_instances` field catalog (lp-nye) without Daytona.
 *
 * Normative design:
 *   docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md
 * Presence SM:
 *   docs/plans/0008-daytona-agent-sandboxes/presence-state-machine.md
 * Identity:
 *   docs/plans/0008-daytona-agent-sandboxes/identity-model.md
 *
 * Offline track: no live Daytona create/start; feature flags for ensure_online
 * default off at BFF (`lp-kng.2.8`).
 */

import { z } from "zod";

import type { ResolveInstanceSource } from "./resolve-instance.js";
import type { EnsureBoundStoppedSandboxResponse } from "./sandbox-create-ahead.js";
import {
  SANDBOX_CREATE_PROFILES,
  type SandboxCreateProfile,
} from "./short-stack-create-env.js";
import {
  INSTANCE_PRESENCE_STATES,
  RUNTIME_KINDS,
  type InstancePresence,
  type RuntimeKind,
} from "./types.js";

/**
 * Hono route templates (param `:instanceId`).
 * HTTP surface lives under `/internal/instances/:instanceId/*`.
 */
export const ORCHESTRATOR_ROUTE_TEMPLATES = {
  ensureOnline: "/internal/instances/:instanceId/ensure-online",
  ensureBoundStopped: "/internal/instances/:instanceId/ensure-bound-stopped",
  presence: "/internal/instances/:instanceId/presence",
  signalActivity: "/internal/instances/:instanceId/signal-activity",
  stop: "/internal/instances/:instanceId/stop",
} as const;

/** Stable path builders for BFF / clients (concrete instance id). */
export const ORCHESTRATOR_API_PATHS = {
  ensureOnline: (instanceId: string) =>
    `/internal/instances/${instanceId}/ensure-online`,
  ensureBoundStopped: (instanceId: string) =>
    `/internal/instances/${instanceId}/ensure-bound-stopped`,
  presence: (instanceId: string) =>
    `/internal/instances/${instanceId}/presence`,
  signalActivity: (instanceId: string) =>
    `/internal/instances/${instanceId}/signal-activity`,
  stop: (instanceId: string) => `/internal/instances/${instanceId}/stop`,
  /**
   * lp-oop.19 — resolve tenant+user then wake the chosen instance.
   * Wake itself stays `ensureOnline(instanceId)`.
   */
  ensureOnlineByUser: (tenantId: string, userId: string) =>
    `/internal/tenants/${tenantId}/users/${userId}/ensure-online`,
} as const;

/**
 * Hono template for POST ensure-online by tenant+user (lp-oop.19).
 * Not under `/internal/instances/:instanceId` — resolver picks the id.
 */
export const ENSURE_ONLINE_BY_USER_ROUTE_TEMPLATE =
  "/internal/tenants/:tenantId/users/:userId/ensure-online";

/** Wire operation ids for 501 bodies and logs. */
export const ORCHESTRATOR_OPERATIONS = [
  "ensure_online",
  "ensure_bound_stopped",
  "get_presence",
  "signal_activity",
  "stop",
] as const;

export type OrchestratorOperation = (typeof ORCHESTRATOR_OPERATIONS)[number];

/** Structured 501 body when a method is stubbed. */
export type OrchestratorNotImplementedBody = {
  error: "not_implemented";
  code: "ORCHESTRATOR_NOT_IMPLEMENTED";
  operation: OrchestratorOperation;
  instance_id: string;
  message: string;
};

export function orchestratorNotImplementedBody(
  operation: OrchestratorOperation,
  instanceId: string,
  message?: string,
): OrchestratorNotImplementedBody {
  return {
    error: "not_implemented",
    code: "ORCHESTRATOR_NOT_IMPLEMENTED",
    operation,
    instance_id: instanceId,
    message:
      message ??
      `Orchestrator operation "${operation}" is not implemented yet (lp-biq stub; fill in lp-kng.2.1 / Phase 4)`,
  };
}

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

/**
 * POST ensure-online body.
 * `wait_timeout_ms` — optional upper bound to wait on singleflight wake.
 * Omitted / 0 = implementation default (later beads).
 */
export type EnsureOnlineRequest = {
  wait_timeout_ms?: number;
  /**
   * Cold-create env profile (lp-oop.28). Default `guest_gateway` (Relay +
   * provider inject). Harness / tool-only path passes `tool_only`.
   */
  sandbox_create_profile?: SandboxCreateProfile;
};

/**
 * Wake strategy returned on ensure_online (plan 0019 D4 / lp-k5c4.5).
 * Bound toolbox is `start_from_stopped`. Unbound first bind is `warm_pool`
 * when the in-process pool is stocked; miss still `cold_create`.
 */
export const ENSURE_ONLINE_WAKE_PATHS = [
  "cold_create",
  "cold_create_env_expired",
  "start_from_stopped",
  "archive_restore",
  "warm_pool",
  "already_online",
  "joined",
  "ec2_short_circuit",
  "unknown",
] as const;

export type EnsureOnlineWakePath = (typeof ENSURE_ONLINE_WAKE_PATHS)[number];

export type EnsureOnlineResponse = {
  instance_id: string;
  tenant_id: string;
  presence: InstancePresence;
  sandbox_id: string | null;
  runtime_kind: RuntimeKind;
  /**
   * True when presence was already `online` and no create/start was required.
   */
  already_online: boolean;
  /**
   * True when this caller joined an in-flight singleflight wake (presence was
   * or became `waking` and waited).
   */
  wake_joined: boolean;
  /**
   * Relay/harness up. Same fact as `presence === "online"` (lp-vqr0.4).
   * Independent of `vault_writable`.
   */
  agent_ready: boolean;
  /**
   * Mountpoint accepted a write. File tools may wait; chat must not.
   * Presence may be `online` while this is false (T3).
   */
  vault_writable: boolean;
  /**
   * How compute was obtained. Optional on stubs; live orchestrator always
   * stamps it so spine toolbox enqueue can observe `warm_pool` vs
   * `start_from_stopped` without scraping metrics.
   */
  path?: EnsureOnlineWakePath;
};

/**
 * POST ensure-online-by-user response (lp-oop.19).
 * Same wake payload as instance-scoped ensure-online, plus who resolved it.
 */
export type EnsureOnlineByUserResponse = EnsureOnlineResponse & {
  user_id: string;
  source: ResolveInstanceSource;
};

/** GET presence response (metadata only — no secrets). */
export type InstancePresenceResponse = {
  instance_id: string;
  tenant_id: string;
  presence: InstancePresence;
  sandbox_id: string | null;
  runtime_kind: RuntimeKind;
  agent_snapshot_id: string | null;
  s3_vault_prefix: string | null;
  /**
   * Last activity ISO timestamp for idle reaper.
   * Null until first activity or successful wake (`lp-omt` / offline `lp-kng.2.2`).
   */
  last_activity_at: string | null;
  /** Instance soft-revoke timestamp; null when active. */
  revoked_at: string | null;
  /**
   * Relay/harness up. Same fact as `presence === "online"` (lp-vqr0.4).
   * Independent of `vault_writable`.
   */
  agent_ready: boolean;
  /**
   * Mountpoint accepted a write. File tools may wait; chat must not.
   */
  vault_writable: boolean;
};

/**
 * POST signal-activity body.
 * Touches last_activity_at so idle reaper grace restarts.
 * Optional mid_turn integrates agent-turn protection (lp-053).
 */
export type SignalActivityRequest = {
  /** Optional ISO timestamp; default server now when implemented. */
  at?: string;
  /**
   * When set, arm (`true`) or clear (`false`) the mid-turn lock that blocks
   * idle reaper stop while the agent turn / tools are active (lp-053).
   * Omitted → activity bump only (no lock change).
   */
  mid_turn?: boolean;
  /**
   * Spine toolbox enqueue (lp-k5c4.4). Clears `stop_after` so the reaper
   * does not honor a stale hot window. Wins over `spine_lease_empty`.
   */
  spine_work_arrived?: boolean;
  /**
   * Spine toolbox room drained (lp-k5c4.4). Arms
   * `stop_after = at + ~45s` for the idle reaper.
   */
  spine_lease_empty?: boolean;
};

export type SignalActivityResponse = {
  instance_id: string;
  tenant_id: string;
  presence: InstancePresence;
  last_activity_at: string;
  /** Current mid-turn lock state after this signal (lp-053). */
  mid_turn?: boolean;
  /** ISO expiry of mid-turn lock; null when inactive (lp-053). */
  mid_turn_until?: string | null;
  /** Spine toolbox hot-window deadline; null when unset (lp-k5c4.4). */
  stop_after?: string | null;
};

/** POST stop body — explicit API stop or idle-path reason. */
export type StopInstanceRequest = {
  reason?: "explicit_stop" | "idle_stop";
};

export type StopInstanceResponse = {
  instance_id: string;
  tenant_id: string;
  presence: InstancePresence;
  sandbox_id: string | null;
  /** True when a live sandbox was stopped or presence moved offline. */
  stopped: boolean;
};

export type { EnsureBoundStoppedSandboxResponse };

// ---------------------------------------------------------------------------
// Zod (request validation at the HTTP edge)
// ---------------------------------------------------------------------------

export const ensureOnlineRequestSchema = z
  .object({
    wait_timeout_ms: z
      .number()
      .int()
      .nonnegative()
      .max(600_000)
      .optional(),
    sandbox_create_profile: z.enum(SANDBOX_CREATE_PROFILES).optional(),
  })
  .strict();

export const signalActivityRequestSchema = z
  .object({
    at: z.string().datetime().optional(),
    /** Arm/clear mid-turn lock (lp-053); omit to leave lock unchanged. */
    mid_turn: z.boolean().optional(),
    /** Toolbox enqueue: clear stop_after (lp-k5c4.4). */
    spine_work_arrived: z.boolean().optional(),
    /** Toolbox room drained: arm stop_after = at + 45s (lp-k5c4.4). */
    spine_lease_empty: z.boolean().optional(),
  })
  .strict();

export const stopInstanceRequestSchema = z
  .object({
    reason: z.enum(["explicit_stop", "idle_stop"]).optional(),
  })
  .strict();

/** Catalog re-exports for client compile-time checks without importing types.ts. */
export const ORCHESTRATOR_PRESENCE_STATES = INSTANCE_PRESENCE_STATES;
export const ORCHESTRATOR_RUNTIME_KINDS = RUNTIME_KINDS;

// ---------------------------------------------------------------------------
// Service interface (RPC-style; HTTP routes delegate here later)
// ---------------------------------------------------------------------------

/**
 * Instance Orchestrator port used by HTTP handlers and unit tests.
 * Stub implementations throw {@link OrchestratorNotImplementedError}.
 */
export type InstanceOrchestratorService = {
  ensureOnline(
    instanceId: string,
    request?: EnsureOnlineRequest,
  ): Promise<EnsureOnlineResponse>;
  ensureBoundStoppedSandbox(
    instanceId: string,
  ): Promise<EnsureBoundStoppedSandboxResponse>;
  getPresence(instanceId: string): Promise<InstancePresenceResponse>;
  signalActivity(
    instanceId: string,
    request?: SignalActivityRequest,
  ): Promise<SignalActivityResponse>;
  stop(
    instanceId: string,
    request?: StopInstanceRequest,
  ): Promise<StopInstanceResponse>;
};

/** Thrown by stub service methods; map to HTTP 501. */
export class OrchestratorNotImplementedError extends Error {
  readonly code = "ORCHESTRATOR_NOT_IMPLEMENTED" as const;
  readonly operation: OrchestratorOperation;
  readonly instanceId: string;
  readonly httpStatus = 501 as const;

  constructor(operation: OrchestratorOperation, instanceId: string) {
    super(
      `Orchestrator operation "${operation}" is not implemented yet (instance ${instanceId})`,
    );
    this.name = "OrchestratorNotImplementedError";
    this.operation = operation;
    this.instanceId = instanceId;
  }

  toBody(): OrchestratorNotImplementedBody {
    return orchestratorNotImplementedBody(this.operation, this.instanceId);
  }
}

/**
 * Pure stub service: every method throws not-implemented.
 * Replace with real/fake orchestrator in `lp-kng.2.1` without changing routes.
 */
export function createNotImplementedOrchestrator(): InstanceOrchestratorService {
  return {
    async ensureOnline(instanceId) {
      throw new OrchestratorNotImplementedError("ensure_online", instanceId);
    },
    async ensureBoundStoppedSandbox(instanceId) {
      throw new OrchestratorNotImplementedError(
        "ensure_bound_stopped",
        instanceId,
      );
    },
    async getPresence(instanceId) {
      throw new OrchestratorNotImplementedError("get_presence", instanceId);
    },
    async signalActivity(instanceId) {
      throw new OrchestratorNotImplementedError("signal_activity", instanceId);
    },
    async stop(instanceId) {
      throw new OrchestratorNotImplementedError("stop", instanceId);
    },
  };
}
