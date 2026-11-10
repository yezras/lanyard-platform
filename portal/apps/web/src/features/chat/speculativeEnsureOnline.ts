/**
 * One-shot speculative wake when Chat is the active Portal tab (T7).
 *
 * ChatView stays mounted (keep-alive) on Vault/Settings. Kick only when
 * the Agents tab is showing, and at most once per mount.
 */

export type SpeculativeKickDecision =
  | { kick: true }
  | { kick: false; reason: "inactive" | "already_kicked" };

export function decideSpeculativeEnsureOnlineKick(input: {
  isActive: boolean;
  alreadyKicked: boolean;
}): SpeculativeKickDecision {
  if (!input.isActive) {
    return { kick: false, reason: "inactive" };
  }
  if (input.alreadyKicked) {
    return { kick: false, reason: "already_kicked" };
  }
  return { kick: true };
}
