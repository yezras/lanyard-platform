/**
 * BFF glue for active human edit vs agent write policy (lp-5q6.32).
 *
 * Combines session-store ownership lookup with shared pure decision helpers.
 * Gateway/host callers should use this before targeting vault.write on a path
 * a human may be editing in ONLYOFFICE.
 *
 * Policy: docs/architecture/portal-active-human-edit-agent-write-policy.md
 */

import {
  type ActivePathOwnership,
  type AgentWriteIntent,
  type AgentWritePolicyDecision,
  resolveAgentWritePolicy,
} from "@lanyard/shared";

import type { ActiveOfficePathOwnership } from "./types.js";
import type { OfficeDocumentSessionStore } from "./store.js";

export {
  AGENT_WRITE_UX_COPY,
  buildAgentCheckpointPath,
  formatCheckpointSuccessMessage,
  isAgentCheckpointPath,
  isBlockingDirtyOwnership,
  resolveAgentWritePolicy,
  type ActivePathOwnership,
  type AgentWriteIntent,
  type AgentWritePolicyDecision,
} from "@lanyard/shared";

export type { ActiveOfficePathOwnership };

/** Map BFF ownership projection into shared ActivePathOwnership. */
export function toSharedOwnership(
  ownership: ActiveOfficePathOwnership | null,
): ActivePathOwnership | null {
  if (!ownership) return null;
  return {
    path: ownership.path,
    tenant_id: ownership.tenant_id,
    dirty: ownership.dirty,
    mode: ownership.mode,
    ...(ownership.session_id ? { session_id: ownership.session_id } : {}),
    ...(ownership.base_revision_token
      ? { base_revision_token: ownership.base_revision_token }
      : {}),
    ...(ownership.user_id ? { user_id: ownership.user_id } : {}),
  };
}

/**
 * Look up BFF dirty ownership for a path and resolve agent write policy.
 */
export async function resolveAgentWritePolicyForPath(
  store: OfficeDocumentSessionStore,
  input: {
    tenant_id: string;
    intent: AgentWriteIntent;
    now?: Date;
  },
): Promise<{
  ownership: ActiveOfficePathOwnership | null;
  decision: AgentWritePolicyDecision;
}> {
  const ownership = await store.findActiveOwnership({
    tenant_id: input.tenant_id,
    path: input.intent.intended_path,
    now: input.now,
  });
  const decision = resolveAgentWritePolicy(
    toSharedOwnership(ownership),
    input.intent,
  );
  return { ownership, decision };
}
