/**
 * spineEnabled gate (plan 0019 §6 / lp-k5c4.3 / lp-k5c4.8 / lp-k5c4.13).
 *
 * Phase 10 (lp-k5c4.13): request path does NOT branch on
 * `tenants.chat_delivery` for Daytona spine tenants. EC2 residual
 * `lp-k5c4.14` is closed (0 runtime_kind=ec2 rows) — every tenant is
 * Daytona. When HARNESS_URL is wired the BFF is always spine.
 *
 * `tenantChatDelivery` remains as an optional deprecated param for
 * rollback / honesty display. Send / SSE / cancel MUST NOT consult it
 * (lp-k5c4.13 last leaf). Process env `CHAT_DELIVERY` stays `relay`;
 * do not set it globally to `harness`.
 */

import {
  DEFAULT_CHAT_DELIVERY,
  type ChatDelivery,
} from "./config.js";

export function spineEnabled(input: {
  harnessUrlWired: boolean;
  /** @deprecated lp-k5c4.13 — request path no longer branches on persist */
  tenantChatDelivery?: ChatDelivery | null;
}): boolean {
  return input.harnessUrlWired;
}

/**
 * Discriminated hop for Portal Send / SSE / cancel.
 * Spine has no `chatDelivery` field so request-path dual-run is unrepresentable.
 * Phase 10: tenant persist is NOT consulted for the hop (column drop).
 */
export type ChatHop =
  | { kind: "spine" }
  | { kind: "legacy"; chatDelivery: ChatDelivery };

export function resolveChatHop(input: {
  /** @deprecated lp-k5c4.13 — not consulted for spine decision */
  tenantChatDelivery?: ChatDelivery | null;
  harnessUrlWired: boolean;
  envChatDelivery?: ChatDelivery | null;
}): ChatHop {
  if (
    spineEnabled({
      harnessUrlWired: input.harnessUrlWired,
    })
  ) {
    return { kind: "spine" };
  }
  return {
    kind: "legacy",
    chatDelivery: input.envChatDelivery ?? DEFAULT_CHAT_DELIVERY,
  };
}

/** Spine is always harness. Legacy keeps env only (lp-k5c4.13). */
export function chatHopDelivery(hop: ChatHop): ChatDelivery {
  return hop.kind === "spine" ? "harness" : hop.chatDelivery;
}

export function isHarnessChatHop(hop: ChatHop): boolean {
  return hop.kind === "spine" || hop.chatDelivery === "harness";
}
