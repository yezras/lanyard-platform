/**
 * Create-ahead decision (lp-vqr0.7).
 *
 * Bind a stopped sandbox before Send so the first click is
 * start_from_stopped, not cold_create. Already-bound instances are a
 * no-op (do not create, do not stop a box someone may be using).
 */

import type { InstancePresence, RuntimeKind } from "./types.js";

export type CreateAheadInput = {
  runtime_kind: RuntimeKind;
  sandbox_id: string | null;
};

export type CreateAheadDecision =
  | {
      action: "noop";
      reason: "already_bound";
      sandbox_id: string;
    }
  | {
      action: "noop";
      reason: "ec2_always_on";
    }
  | {
      action: "create_start_stop_retain";
    };

export type EnsureBoundStoppedSandboxResponse = {
  instance_id: string;
  tenant_id: string;
  runtime_kind: RuntimeKind;
  presence: InstancePresence;
  sandbox_id: string | null;
  /** True when `sandbox_id` was already set; this call did not create. */
  already_bound: boolean;
  /** True when this call created (and then stopped+retained) a sandbox. */
  created: boolean;
};

function boundSandboxId(sandboxId: string | null): string | null {
  const trimmed = sandboxId?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * Pure intent for ensureBoundStoppedSandbox.
 * Callers execute create+start+stop+retain only when action is create.
 */
export function decideCreateAhead(input: CreateAheadInput): CreateAheadDecision {
  if (input.runtime_kind === "ec2") {
    return { action: "noop", reason: "ec2_always_on" };
  }
  const sandboxId = boundSandboxId(input.sandbox_id);
  if (sandboxId) {
    return {
      action: "noop",
      reason: "already_bound",
      sandbox_id: sandboxId,
    };
  }
  return { action: "create_start_stop_retain" };
}
